# Stride WMS (Production) — PDF Generation Architecture

> **Audience:** Whoever builds the PDF system in the real Stride WMS web app (the
> Supabase/React replacement for the GS Inventory Sheets bridge).
>
> **Purpose:** Lock in the right architecture from day one so the production WMS
> never inherits the Drive quota bottleneck that caused "User rate limit
> exceeded" warnings in the GS Inventory Sheets system.
>
> **Status:** Recommendation, not implemented. This doc reflects lessons learned
> from the temporary GS Inventory system. Treat it as the default path unless a
> concrete requirement pushes you off it.

---

## TL;DR — Lock these decisions before writing any code

| Decision | Choice | Why |
|---|---|---|
| **Where PDFs are generated** | Client-side in the browser (React) | Zero server calls, sub-100ms, no quotas, works offline |
| **PDF library** | `pdfmake` | Best table support of the JS PDF libs; declarative doc definitions; strong font control |
| **Where PDFs are stored** | Supabase Storage buckets (per-entity) | Signed URLs, RLS-aware access, CDN-backed, effectively infinite quota |
| **Drive role** | Optional human-browsable mirror only | Not in critical path. App functions fully without it. |
| **Templates** | React/TS component functions returning pdfmake document definitions | Version-controlled, unit-testable, live preview in Storybook |
| **Email attachments** | Generate PDF → upload to Storage → send email with download link OR inline attachment via Supabase client | No dependency on Drive for email flow |

**Do not build a PDF pipeline that calls `Drive.Files.copy` or any Google Workspace PDF conversion endpoint.** That path is what caused the temporary GS Inventory system to hit throttling at low scale. The entire point of this doc is to make sure that mistake is not repeated.

---

## What went wrong in the GS Inventory (temporary) system

The temporary Sheets system generates PDFs through `api_generateDocPdf_` in `StrideAPI.gs`. Each PDF costs **6 Drive/Docs API calls**:

1. `DriveApp.createFile(htmlBlob)` — create temp HTML file
2. `POST files/{id}/copy` with `mimeType: application/vnd.google-apps.document` — **this is the expensive one**
3. `POST docs/{id}:batchUpdate` — margin control
4. `GET docs/{id}/export?format=pdf` — PDF export
5. `folder.createFile(pdfBlob)` — save to shipment folder
6. `setTrashed()` — clean up temp doc

Symptoms observed in production:
- Intermittent `HTTP 403 "User rate limit exceeded"` on step 2, even with just a handful of PDFs generated that day
- Root cause: Drive throttles `files.copy` far more aggressively than the documented per-user quota suggests. Burst protection kicks in when multiple copies land within a few seconds.
- Compounding factor: Apps Script projects without a linked GCP project use a tiny shared default quota pool — another 10x penalty on top of the normal limit.

Mitigations applied in the temp system (do not carry these forward to production):
- Retry with exponential backoff on 403/429/5xx (StrideAPI.gs v38.8.0, `api_fetchWithRetry_`)
- Linked a dedicated GCP project to raise quota ~10x
- Enabled Drive, Docs, Sheets, Apps Script APIs explicitly on the linked project

These mitigations **work for the temp system's bridge lifespan** but do not scale past ~100-150 active clients at typical 3PL receive/task volume. **The production WMS must not depend on them.**

---

## The chosen architecture

### Flow (happy path)

```
User clicks "Complete Shipment" in React
  ↓
React app:
  1. Writes shipment + inventory + billing rows to Supabase (Postgres)
  2. Builds pdfmake document definition from template function + row data
  3. Generates PDF blob client-side (~50-100ms)
  4. Uploads blob to Supabase Storage: bucket `shipment-pdfs`, path `{tenant_id}/{shipment_no}.pdf`
  5. Stores the storage path on the shipment row
  6. Optionally: triggers an edge function to send the email with the PDF attached or linked
  ↓
User sees "Shipment Received" instantly — PDF is already viewable via signed URL
```

### Why every step matters

- **Write to DB first, PDF second.** The shipment is saved whether or not the PDF succeeds. PDF generation is never in the critical path of the business data write.
- **Generate client-side.** The browser already has all the row data (it just submitted the form). Building the PDF there avoids a server round-trip, server CPU cost, and any server quota limits.
- **Upload raw blob to Supabase Storage.** One HTTP PUT. No transcoding. No Google involvement. Supabase Storage is backed by S3 under the hood and easily handles thousands of uploads per minute per bucket.
- **Store the path, not the URL.** URLs expire; paths don't. Generate signed URLs on demand when the user clicks "View PDF".
- **Edge function for emails.** Supabase Edge Functions can fetch the stored PDF and attach it to outbound email via Resend / Postmark / SendGrid. Still no Drive, still no Gmail API throttling.

### Scale envelope

| Scale | PDFs/day | Client-side cost | Storage cost (Supabase) | API calls to Google |
|---|---|---|---|---|
| 60 clients | ~600 | ~0ms server | <$0.10/mo | **0** |
| 200 clients | ~4,000 | ~0ms server | ~$0.50/mo | **0** |
| 500 clients | ~15,000 | ~0ms server | ~$2/mo | **0** |
| 2,000 clients | ~60,000 | ~0ms server | ~$8/mo | **0** |

The quota bottleneck disappears entirely because Google Drive is no longer on the critical path.

---

## Library choice: `pdfmake`

Evaluated alternatives:

| Library | Tables | Fonts | Bundle size | Verdict |
|---|---|---|---|---|
| **pdfmake** | Excellent (declarative, auto-paging, cell merging) | Custom fonts via VFS | ~800 KB | **Pick this** |
| jsPDF + jspdf-autotable | Good (plugin required, less flexible) | Custom fonts via addFont | ~300 KB | Good for simple docs; weaker on multi-page tables with repeating headers |
| pdf-lib | None (manual drawing) | Manual embedding | ~400 KB | Only if you need to modify existing PDFs |
| react-pdf (@react-pdf/renderer) | OK | Limited | ~800 KB | JSX is nice but the renderer has bugs with complex layouts |
| @react-pdf/renderer + server render | OK | Limited | Server-side | Brings back server cost |

Receiving docs, work orders, will call release slips, and invoices all need:
- Multi-row item tables that can span pages with repeated headers
- A header/footer on every page (logo, client name, document number)
- Mixed-weight text (bold headers, regular body, small disclaimers)
- Precise alignment of currency columns

pdfmake handles all of those out of the box. jsPDF can too but you fight it for every table. pdfmake's document definition is JSON-shaped which means templates become pure functions that take data and return a definition object — dead easy to unit-test, snapshot-test, and version.

---

## Supabase Storage setup

### Buckets

Create one bucket per document type (not one giant bucket):

```
shipment-pdfs        ← receiving confirmations
task-work-orders     ← inspection / assembly / minor touch-up WOs
repair-work-orders   ← repair WOs
will-call-releases   ← WC release documents
invoices             ← client invoices
claim-settlements    ← claim settlement docs
```

Why separate buckets:
- Independent retention policies (invoices kept 7 years, WOs kept 1 year, etc.)
- Independent RLS policies (claims are more sensitive than WOs)
- Independent access patterns for caching
- Easier to reason about in the Supabase dashboard

### Path convention

Every bucket uses this path shape:

```
{tenant_id}/{year}/{month}/{entity_id}.pdf
```

Example: `shipment-pdfs/abc123.../2026/04/SHP-000095.pdf`

Year/month partitioning keeps directory listings fast even at scale and makes retention automation (e.g. "delete anything older than X months") trivial.

### RLS on storage

Supabase Storage has RLS policies on the `storage.objects` table. The standard pattern for this app:

```sql
-- Staff/admin can read any PDF
CREATE POLICY "staff read all shipment pdfs" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'shipment-pdfs'
    AND (auth.jwt() ->> 'role') IN ('staff', 'admin')
  );

-- Client users can only read PDFs from their own tenant
CREATE POLICY "client read own shipment pdfs" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'shipment-pdfs'
    AND (storage.foldername(name))[1] = (auth.jwt() ->> 'tenant_id')
  );
```

Same pattern for every bucket. Clients cannot see other clients' PDFs even if they guess the URL.

### Signed URLs

Never hand out public URLs. Always generate signed URLs when the user clicks "View PDF":

```ts
const { data } = await supabase
  .storage
  .from('shipment-pdfs')
  .createSignedUrl(`${tenantId}/2026/04/${shipmentNo}.pdf`, 3600); // 1 hour
```

Signed URLs expire, so links shared in emails or screenshots can't be used forever.

---

## Template pattern

Templates live as **pure functions** that take a data object and return a pdfmake document definition:

```ts
// src/pdf/templates/receivingConfirmation.ts
import { TDocumentDefinitions } from 'pdfmake/interfaces';

export interface ReceivingData {
  client: { name: string; logoUrl?: string };
  shipmentNumber: string;
  receiveDate: string;
  carrier: string;
  trackingNumber: string;
  items: Array<{
    itemId: string;
    description: string;
    vendor: string;
    class: 'XS' | 'S' | 'M' | 'L' | 'XL';
    qty: number;
    sidemark: string;
    location: string;
  }>;
  receivedBy: string;
  notes?: string;
}

export function buildReceivingConfirmationDoc(data: ReceivingData): TDocumentDefinitions {
  return {
    pageSize: 'LETTER',
    pageMargins: [40, 60, 40, 60],
    header: { /* logo + doc title */ },
    footer: (currentPage, pageCount) => ({ /* page counter + disclaimer */ }),
    content: [
      { text: `Receiving Confirmation — ${data.shipmentNumber}`, style: 'title' },
      /* client info block */
      /* items table with repeating headers */
      /* signature lines */
    ],
    styles: {
      title: { fontSize: 18, bold: true, marginBottom: 12 },
      /* ... */
    },
    defaultStyle: { font: 'Inter' }
  };
}
```

And a thin wrapper that generates the blob:

```ts
// src/pdf/generate.ts
import pdfMake from 'pdfmake/build/pdfmake';
import pdfFonts from 'pdfmake/build/vfs_fonts';
(pdfMake as any).vfs = pdfFonts.pdfMake.vfs;

export async function generatePdfBlob(docDefinition: TDocumentDefinitions): Promise<Blob> {
  return new Promise((resolve) => {
    pdfMake.createPdf(docDefinition).getBlob((blob) => resolve(blob));
  });
}
```

And the orchestration in the feature component:

```ts
// src/features/receiving/handleCompleteShipment.ts
const docDef = buildReceivingConfirmationDoc(rowData);
const blob = await generatePdfBlob(docDef);
const path = `${tenantId}/${year}/${month}/${shipmentNo}.pdf`;
const { error } = await supabase.storage
  .from('shipment-pdfs')
  .upload(path, blob, { contentType: 'application/pdf', upsert: false });
if (error) throw error;
await supabase.from('shipments').update({ pdf_path: path }).eq('id', shipmentId);
```

That's the entire PDF pipeline. No server code, no Drive, no templates-in-a-sheet-tab, no token replacement, no `UrlFetchApp`.

---

## Testing strategy

Because templates are pure functions, testing is easy:

1. **Snapshot tests** — feed each template a fixture data object, compare the returned document definition JSON to a saved snapshot. Catches any unintended layout drift in a PR.
2. **Visual regression** — in Storybook, render each template with fixture data through `pdfmake.createPdf().open()` so a designer can eyeball every PDF during review.
3. **Unit tests for data shaping** — the function that takes DB rows and maps them to `ReceivingData` is pure and trivially testable.
4. **No integration tests needed** for the Storage upload path because Supabase Storage is a well-tested Supabase primitive — just mock the client.

---

## Migration mirror to Drive (optional, for staff browsing)

Some staff workflows still want a Google Drive folder they can browse manually. That's fine — make it a **background sync**, not a blocking path:

- On successful Supabase Storage upload, fire an `on-pdf-uploaded` database trigger
- The trigger calls a Supabase Edge Function that copies the blob to a Drive folder via the Drive API
- If the Drive copy fails, log it and continue — the PDF is safely in Supabase regardless
- Drive is now an **eventual mirror**, not a source of truth

This gives staff the "open the folder" experience without putting Drive back on the critical path.

---

## What this doc is not

- **Not a retrofit of the GS Inventory Sheets system.** That system is temporary and the retry + GCP project link is sufficient for its lifespan.
- **Not a prescription to rewrite the stride-gs-app React frontend.** That app ships PDFs through the StrideAPI.gs Web App endpoint and will retire with the Sheets system.
- **Not prescriptive about the email provider.** Use whatever the production WMS picks (Resend is the current default recommendation). What matters is that emails come from the same infrastructure as the app, not from GmailApp inside an Apps Script project.

---

## Summary

If you remember one thing from this document: **the production Stride WMS must generate PDFs in the browser and store them in Supabase Storage.** Everything else is implementation detail. Avoid any design that puts `Drive.Files.copy` — or any Google Workspace PDF conversion step — on the critical path of a user-facing action.

Doing it this way the first time is no harder than doing it the wrong way. It's a one-day setup, not a one-week migration, and it sets the ceiling on how many clients you can serve at roughly the size of Supabase's free tier (~10,000+ PDFs/month) before you even start paying.
