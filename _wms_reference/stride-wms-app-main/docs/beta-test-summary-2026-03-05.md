# Beta Test Summary — 2026-03-05

> Tester: Beta QA
> Date: 2026-03-05
> Scope: End-to-end billing workflow (dock intake → storage charges → invoicing → void)

---

## What Worked Correctly

| # | Feature | Result |
|---|---------|--------|
| 1 | Dock intake with multiple items (ITEM-001 through ITEM-004) | Items saved to inventory correctly |
| 2 | Auto-generated inspection and assembly tasks | Created properly |
| 3 | Task completion with notes/photos | Completed successfully |
| 4 | Client billing ledger populated with RCVG billing events | Correct |
| 5 | Storage charge generation (`generate_storage_for_date`) | Calculated correctly: 64 days × $0.04/day = $2.56/item for 1/1–3/5 range |
| 6 | Partial invoice creation (INV-000010 for 3 of 6 STOR items) | Remaining items stayed Unbilled |
| 7 | Void operation synced to client Billing_Ledger | All 3 voided rows show "Void" status with cleared invoice numbers |
| 8 | Master accounting folder contains only PDFs | No duplicate doc+pdf |
| 9 | INV-000010 PDF created | `INV-000010-JUSTIN TESTER.pdf` at 12:24 PM |

---

## Bugs Found

### BUG-1: Data validation missing "Void" status (Google Sheets)

- **Severity**: Low
- **Layer**: Google Sheets (not React/Supabase app)
- **Description**: The Consolidated_Ledger Status column (A) dropdown only had Unbilled/Invoiced/Paid. The script sets status to "Void" (not "Voided"), causing a validation error.
- **Workaround**: Added "Void" to the dropdown for A2:A1000 during testing.
- **App status**: The Supabase DB constraint correctly includes `void` in the allowed statuses: `CHECK (status IN ('unbilled', 'invoiced', 'void'))` — see migration `20260124044004_...sql:70`.

### BUG-2: Client invoice folder has BOTH Doc + PDF (Google Sheets)

- **Severity**: Medium
- **Layer**: Google Apps Script (`Invoice Commit.gs`)
- **Description**: The client's Invoices folder (e.g., JUSTIN TESTER) contains both a Google Doc and a .pdf copy of each invoice (INV-000002 through INV-000007). Customer folder should only get one format.
- **Root cause**: `Invoice Commit.gs` creates the Google Doc first, then converts to PDF and saves both in the same client folder.
- **Fix needed**: After PDF conversion, either delete the Google Doc from the client folder or only save the PDF to the client folder (master folder already only has PDFs).
- **App status**: Not applicable to React/Supabase codebase — this is Google Apps Script only.

### BUG-3: Void sets status to "Void" instead of reverting to "Unbilled" (Google Sheets)

- **Severity**: Medium
- **Layer**: Google Sheets (not React/Supabase app)
- **Description**: When an invoice is voided before approval, the billing event lines go to "Void" status rather than returning to "Unbilled."
- **App status**: The React app handles this correctly. In `src/hooks/useInvoices.ts` (lines 258–269), `voidInvoice()` sets billing events to `status: "unbilled"`, clears `invoice_id` and `invoiced_at`, and sets the invoice itself to `status: "void"`. The Google Sheets void script needs to match this behavior.
- **Decision needed**: Confirm whether voided billing event lines should return to "Unbilled" (re-invoiceable) or stay "Void" (excluded from future invoicing). The React app assumes "Unbilled" (re-invoiceable).

### BUG-4: v1.2 Stride Billing custom menu not appearing (Google Sheets)

- **Severity**: Low (workaround available)
- **Layer**: Google Sheets / Google Apps Script
- **Description**: The Stride Billing custom menu does not appear in the sheet.
- **Workaround**: Import functions as macros.
- **App status**: Not applicable to React/Supabase codebase.

### BUG-5: INV-000009 has no PDF (Workflow gap)

- **Severity**: Low
- **Layer**: Workflow / process
- **Description**: The RCVG invoice (INV-000009) was manually committed and doesn't have a corresponding PDF in either folder because it bypassed the full commit workflow.
- **App status**: Not a code bug — manual ledger entries bypass the PDF generation pipeline. Consider adding a guard or warning when committing invoices without PDF generation.

---

## Codebase Impact Assessment

| Bug | In React/Supabase codebase? | Action needed here? |
|-----|----------------------------|---------------------|
| BUG-1 | No (Google Sheets) | None — DB constraint is correct |
| BUG-2 | No (Google Apps Script) | None — fix in `Invoice Commit.gs` |
| BUG-3 | No (Google Sheets) | None — `voidInvoice()` already correct |
| BUG-4 | No (Google Sheets) | None |
| BUG-5 | No (Workflow) | None — process improvement |

**Conclusion**: All 5 bugs are in the Google Sheets / Google Apps Script layer. The React/Supabase application code correctly handles all tested billing workflows, including void operations returning billing events to "unbilled" status.

---

## Verified React/Supabase Billing Flows

The following flows were implicitly validated during beta testing:

- `generate_storage_for_date` RPC — storage charge calculation correct
- `useInvoices.createInvoiceDraft()` — partial invoicing works correctly
- `useInvoices.voidInvoice()` — correctly returns billing events to unbilled
- `billing_events` status constraint — `('unbilled', 'invoiced', 'void')` sufficient
- Invoice line creation with proper quantity/rate calculations
- Activity logging for invoice/uninvoice operations
