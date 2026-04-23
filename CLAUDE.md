# GS Inventory — System Reference

> **Temporary Google Sheets system** for Stride Logistics (3PL warehouse, Kent WA). A full Stride WMS web app is being built separately — this runs operations (~49 active clients, ~60 total) until that's ready.

**Owner:** Justin — manages ~60 client accounts, tests immediately.

## ⚠️ This is NOT the Stride WMS Web App

Do NOT use these skills — they're for the separate React/Supabase web app:
- `stride-wms-domain`, `stride-build-instructions` — reference SALA / RLS / SYSTEM_MASTER docs not applicable here.

This project uses Google Apps Script + Google Sheets + Drive + **Supabase as a read cache + audit log + failure tracking layer**. Simpler pattern than the WMS app — don't inherit those assumptions.

---

## ENTITY PAGE REDESIGN — DESIGN SPEC (LOCKED)

> Session 80+. Replacing slide-out detail panels with full-page entity views. Design is locked — do not deviate.

### Visual Language

| Token | Theme value | Usage |
|---|---|---|
| Page background | `theme.v2.colors.bgPage` (#F5F2EE) | Warm beige — all entity pages |
| Tab bar background | `theme.v2.colors.bgDark` (#1C1C1C) | Dark strip containing tab cards |
| Active tab | `theme.colors.orange` bg, `#fff` text | Orange filled card |
| Inactive tab | transparent bg, `rgba(255,255,255,0.55)` text | Muted white text on dark |
| Notification dot | `theme.colors.statusRed` (red) | Small dot on tab label when unread content |
| Sub-tab pills | active: `theme.colors.orange` bg; inactive: `rgba(255,255,255,0.1)` bg | Inside Photos/Notes/Activity for source filter |
| Content cards | `theme.colors.bgCard` bg, `theme.radii.xl` radius | White cards on beige page |
| Field labels | `theme.colors.orange`, `theme.typography.sizes.xs`, 500 weight, uppercase | Above every field value |
| Footer bar bg | `theme.v2.colors.bgDark` | Slim sticky bottom bar |
| Footer primary CTA | `theme.colors.orange` bg, `#fff` text | Right-aligned |
| Footer secondary | `rgba(255,255,255,0.12)` bg, `#fff` text | Left-aligned |

### Layout

- **Single column**, full-width, no max-width
- **Header — 2 rows (compact)**:
  - Row 1: `← Back` button + entity type label (e.g. "INVENTORY") + entity ID (large, bold) + status badge
  - Row 2: Client name · Sidemark · field badges (Vendor, Class, Location pills)
- **Header right**: Edit toggle (pencil icon) + overflow Actions dropdown (Resend Email, View in Inventory, etc.)
- **No summary strip** at the top of the page — content starts immediately with the header.
- **Tab bar**: sticky on desktop (`position: sticky; top: 0; z-index: 10`, `min-width: 768px`). On mobile, tabs **scroll with the page** (not sticky) and the tab row scrolls horizontally. Dark background, tabs are rectangular cards with 8px radius.
- **Tab body**: White cards, 16px padding, gap between cards 12px
- **Sticky bottom bar**: `position: sticky; bottom: 0; background: theme.v2.colors.bgDark`. Left: secondary quick-action buttons (Create Task, Repair Quote, Add to WC, etc.). Right: primary state-aware CTA. Height: 56px.

### Back button & URL behavior

- **Back button uses browser history** (`navigate(-1)`) — goes back to wherever the user came from (Dashboard, entity list, another entity page). Does NOT hardcode a route.
- **URL state preservation**: list pages (Inventory, Tasks, Repairs, WillCalls, Shipments) encode client filter + sort state in the URL. When the user navigates to an entity page and presses Back, the browser restores the exact previous URL — client filter, sort column, and scroll position all come back automatically via URL params.
- **Pages are bookmarkable and shareable** — the full URL `#/inventory/62391?client=<sheetId>` always resolves to the correct entity for any user with access.
- **Client filter sync**: `useClientFilterUrlSync` keeps `?client=<sheetId>` in the URL. The `backTo` prop on EntityPage is not used — always use `navigate(-1)`.

### Entity ID deep links

- **All entity IDs are clickable orange links** (`theme.colors.orange`) throughout the app — in history sections, task/repair/WC cards, shipment references, notes, etc.
- Clicking any entity ID navigates to that entity's full page: Item IDs → `#/inventory/:id`, Task IDs → `#/tasks/:id`, Repair IDs → `#/repairs/:id`, WC numbers → `#/will-calls/:id`, Shipment numbers → `#/shipments/:id`.
- Use the existing `buildDeepLink()` utility for constructing these links.

### Edit mode

- **Edit mode is per-card, toggled by an Edit button on each card** — not inline editing.
- Pencil icon in the card header activates edit mode for that card only. Other cards stay in read mode.
- Save / Cancel buttons appear within the card while editing.
- The header-level Edit toggle (pencil icon) is for the Details tab overall if a card-level toggle isn't appropriate. **No inline cell editing** on entity pages.

### Quick actions placement

- **Quick actions (Create Task, Repair Quote, Add to Will Call, etc.) live in the bottom bar only** — as secondary buttons on the left side.
- **Do NOT put quick action cards or buttons on the Details tab itself.**
- **Resend Email, View in Inventory, and other navigation/utility actions** go in the **Actions dropdown menu** (overflow `⋯` button in the header right slot) — not on any tab.

### State-aware bottom bar

- The bottom bar primary CTA **changes based on entity status** (not static):
  - Task: Open → "Start Task"; In Progress → "Pass" / "Fail"; Completed → "Reopen" (link)
  - Repair: Pending Quote → "Send Quote" + `$amount` input; Quote Sent → "Approve" / "Decline"; Approved → "Start Repair"; In Progress → "Pass" / "Fail"
  - Will Call: Active → "Release All Items"; partial → "Release Some"
  - Item: always "Edit Item" as primary; quick actions (Create Task, Add to WC) as secondary
  - Shipment: "Close" only (read-mostly)
- Secondary buttons (left side) are also state-aware — e.g. "Cancel Task" only shows when Open/In Progress.

### Will Call — items table

- Will Call Details tab includes an **items table with checkboxes** for partial release selection.
- Columns: checkbox, Item ID + badges, Description, Vendor, Location, Qty, Released status.
- Checkbox selection drives "Release Selected" footer action.
- COD payment section: bold text showing `$amount`. **COD button pulses** (CSS animation) when payment is required and not yet collected — orange pulse matching `theme.colors.orange`. Stops pulsing once paid.

### Drive folder buttons

- **Legacy Drive folder buttons** (Task Folder, Shipment Folder, Photos Folder) **only render when a URL exists** — check `task.folderUrl`, `item.shipmentFolderUrl`, etc. before rendering. Never show a disabled/empty folder button.
- Folder buttons live in the Photos tab or Docs tab (whichever is most relevant), not on the Details card.

### Notes tab — item notes rule

- **Item notes field does NOT appear on the Details tab.** All notes (item notes, task notes, internal notes) live in the Notes tab only.
- Details tab shows only structured fields: Vendor, Class, Location, Qty, Sidemark, Room, Reference, dates.

### Client loading — no empty state

- **All entity pages load all accessible clients by default.** There is no "select a client first" empty state on entity pages.
- The client is resolved from the entity's `tenant_id` / `clientSheetId` — entity pages are always scoped to one specific entity and its client.

### Tabs per entity

| Tab | Photos | Notes | Docs | Activity | Entity-specific |
|---|---|---|---|---|---|
| **Item** | EntitySourceTabs (All/Item/Task/Repair) | EntitySourceTabs | yes | Filter pills (All/Shipment/Tasks/Repairs/WC/Billing) | Details, Coverage |
| **Task** | EntitySourceTabs (if itemId) | EntitySourceTabs (if itemId) | yes | Filter pills (All/Status/Field Changes) | Details |
| **Repair** | EntitySourceTabs (if itemId) | EntitySourceTabs (if itemId) | yes | Filter pills | Details |
| **Will Call** | — | — | yes | Filter pills | Details, Items |
| **Shipment** | — | — | yes | Filter pills | Details, Items |

### Activity filter pills

The Activity tab in EntityPage shows `EntityHistory` entries with optional filter pills above:
- "All", "Status Changes", "Field Updates", "Created" (map to action types from `entity_audit_log`)
- Pills: same sub-tab pill style (dark/orange), `font-size: 11px`

### URL routes

```
#/inventory/:itemId
#/tasks/:taskId         (already exists — TaskJobPage, will migrate to TaskPage later)
#/repairs/:repairId     (already exists — RepairJobPage)
#/will-calls/:wcNumber  (already exists — WillCallJobPage)
#/shipments/:shipmentNo (already exists — ShipmentJobPage)
```

### Shared shell: EntityPage.tsx

`src/components/shared/EntityPage.tsx` — the new full-page shell (NOT TabbedDetailPanel, which is for slide-out panels). Ports the `builtInTabs` pattern (Photos/Docs/Notes/Activity) with the new dark tab bar visual. Five entity configs plug into it.

### Implementation order (session 80)

1. CLAUDE.md spec ✓
2. Backup detail panel files to `_backups/entity-redesign-start/`
3. Build `EntityPage.tsx` shell
4. Add `useItemDetail` hook + `fetchItemByIdFromSupabase`
5. Add `/inventory/:itemId` route in App.tsx
6. Build `ItemPage.tsx` (first consumer)
7. Update `Inventory.tsx` row click → `navigate('/inventory/:id')`

---

## Archive pointers (load on demand)

Most detail lives in `_archive/` so CLAUDE.md stays loadable. Open these when you need the full story:

| File | When to read |
|---|---|
| `_archive/Docs/REPO_STRUCTURE.md` | Canonical branch model + full deploy flow + health checks |
| `_archive/Docs/Archive/Deployment_Reference.md` | Full deployment troubleshooting, auth prereqs, every npm command |
| `_archive/Docs/Archive/Architectural_Decisions_Log.md` | Full numbered list of 53 decisions — the "why" behind each feature |
| `_archive/Docs/Archive/Session_History.md` | One-liner per builder session (70+ entries) — historical context |
| `_archive/Docs/Stride_GS_App_Build_Status.md` | What currently exists in the React app + feature parity matrix. **Updated every session.** |
| `_archive/Docs/Archive/Supabase_Integration_Plan.md` | Phase 1-4 Supabase integration reference |
| `_archive/Docs/DT_Integration_Build_Plan.md` | DispatchTrack full build plan + locked decisions |
| `_archive/Docs/PAYMENTS_REDESIGN_PLAN.md` | Payments redesign plan (DRAFT) |
| `_archive/Docs/Future_WMS_PDF_Architecture.md` | Future WMS PDF architecture reference |

**Template sources** (runtime copies live in Supabase — these are the import seed):
- `_archive/EMAIL TEMPLATES/` — source .txt for 19 email templates. Supabase `email_templates` is authoritative.
- `_archive/Doc Templates/` — source for invoice/work-order/settlement/quote templates. Supabase-authoritative.
- `_archive/INSTRUCTION GUIDES/` — WMS user-facing .docx guides.

---

## Rules for Claude

### Must-do

- **BRANCH FIRST. Never commit directly to `source`.** Every task starts with `git checkout -b feat/<stream>/<desc>` from a fresh `source`. Streams: `feat/warehouse/*` (inventory/tasks/repairs/WC/billing/receiving/claims), `feat/delivery/*` (DT / orders / customer portal), `feat/fix/*` (hotfixes). Commit to branch, push with `-u origin <branch>`, then use `gh pr create --base source --head <branch>` (`gh` is installed + authed) and `gh pr merge <n> --squash --delete-branch`. If you don't use gh, give the user the compare URL `https://github.com/Stride-dotcom/Stride-GS-app/compare/source...<branch>`. **This is load-bearing for multi-builder parallelism** — committing directly to source causes Dropbox sync conflicts that silently overwrite another builder's work (happened in session 77 mid-Stage-B).
- **Deploy AFTER merge.** Feature branches don't deploy. After the PR is squash-merged, `git checkout source && git pull origin source`, then run deploy commands. The deploy script's parent-repo commit step assumes an up-to-date source.
- **Deploy before reporting done.** Execute deploy commands via Bash — don't describe them. Only exception: user explicitly asks for instructions.
- **Version header on every script edit.** Lines 1-3 of every `.gs`/`.js`:
  ```
  /* ===================================================
     SCRIPT_NAME — vX.Y.Z — YYYY-MM-DD HH:MM AM/PM PST
     =================================================== */
  ```
  Patch bump for fixes, minor for features. PST timestamps (Justin is WA). Never overwrite existing headers — prepend.
- **Header-based column mapping.** Use `getHeaderMap_()` / `headerMapFromRow_()`. Never positional indexes.
- **Read files before editing.** Grep for all references before removing a variable or moving logic.
- **Non-destructive header updates.** Rename legacy + append missing. Never reorder/remove.
- **Work incrementally.** Small changes, deploy, test, fix. Don't write massive refactors in one pass.
- **Update docs at end of session.** Replace `_archive/Docs/Stride_GS_App_Build_Status.md` Recent Changes with THIS session only (move previous session's Recent Changes out as a one-liner in `_archive/Docs/Archive/Session_History.md`).

### Must-not-do

- **Never use `getLastRow()` for insert positions** — use `getLastDataRow_()`. `getLastRow()` gets false-positives from validations on empty rows.
- **Dropbox sync warning:** Main chat ONLY writes files. Subagents are READ-ONLY (Explore agents for research, never writes). Never use `isolation: "worktree"`. Dropbox sync conflicts with concurrent writes.
- **React never calculates billing.** All billing logic lives server-side in Apps Script. React only displays what the API returns.
- **Never deploy the React bundle from a worktree.** `stride-gs-app/dist/` in a worktree has no `.git` of its own — git commands there fall back to the parent and push raw `.tsx`/`.gs` to `origin/main`, serving source to GitHub Pages. **Has broken the live app twice.** If working in a worktree, copy `stride-gs-app/.env` from the parent first, build in the worktree, then `cp -r dist/. <parent>/stride-gs-app/dist/`, then run `npm run deploy` from the parent's `stride-gs-app/`.
- **Never edit `dist/` by hand.** Only `npm run build` writes there. Manual edits clobber on next deploy.
- **Never edit the Master Price List sheet directly.** Edit in the app (Price List page → inline edit), then click Sync to Sheet.
- **Never commit `.env`, `.credentials.json`, or any secrets.**
- **Never re-enable `deploy.yml` / `ci.yml` in `.github/workflows/`** without confirming the session-77 TLS transport issues are resolved. They're renamed `*.disabled` for a reason — they silently failed and left `origin/main` behind `source`.

### Task Board parity

When changing client-side functions or columns, check whether the Task Board script needs matching changes (shared handlers, editable sets, header arrays, exclusion lists). Shared handlers use `SH_` prefix with `SHARED_HANDLER_VERSION` constant.

---

## Deploy Reference

**Golden rule:** Web App deployments are **frozen snapshots**. `push-*` pushes SOURCE; the live Web App serves the last DEPLOYMENT. Always run the matching `deploy-*` after every push for Web-App-facing scripts.

All backend commands run from `AppScripts/stride-client-inventory/`. React commands run from `stride-gs-app/` (parent workspace, never a worktree).

| Change touched… | Push | Deploy | Live in |
|---|---|---|---|
| `stride-gs-app/src/**` (React) | `npm run deploy -- "what changed"` (single command: build → force-push `dist/` to `origin/main` → commit+push source) | GitHub Pages auto, CDN 1–5 min | 1–2 min |
| `stride-gs-app/supabase/migrations/*.sql` | MCP `apply_migration` (preferred) OR `gh workflow run migrate.yml` OR Supabase Dashboard SQL editor | seconds | seconds |
| `AppScripts/stride-api/StrideAPI.gs` | `npm run push-api` | `npm run deploy-api` | ~20s |
| `AppScripts/Consolidated Billing Sheet/**` | `npm run push-cb` | `npm run deploy-cb` | ~20s |
| `AppScripts/stax-auto-pay/**` | `npm run push-stax` | — | ~10s |
| `AppScripts/QR Scanner/**` | `npm run push-scanner` | `npm run deploy-cb` | ~20s |
| `AppScripts/stride-client-inventory/src/*.gs` (per-client) | `npm run rollout` | `npm run deploy-clients` | 3–4 min/47 clients |
| `AppScripts/Master Price list script.txt` | `npm run push-master` | — | ~10s |
| Email template content | Settings → Email Templates → Edit in app | instant (Supabase) | instant |
| Doc template content | Settings → Doc Templates → Edit in app | instant (Supabase) | instant |
| Service rate / catalog | Price List page → inline edit | instant (Supabase); click "Sync to Sheet" if GAS still reads sheet | instant |

**All-at-once after a big backend session:**
```bash
cd AppScripts/stride-client-inventory
npm run push-api && npm run deploy-api
npm run rollout && npm run deploy-clients
# Then React (from stride-gs-app/):
npm run deploy -- "session summary"
```

### Supabase Migrations (MCP tool)

- **Project ID:** `uqplppugeickmamycpuz`
- **Migration files:** `stride-gs-app/supabase/migrations/YYYYMMDDHHMMSS_name.sql`
- Always write the SQL file first (commits to git as source of truth), then apply via `apply_migration(project_id, name, query)`. `list_migrations` / `list_tables` / `execute_sql` available for inspection + ad-hoc queries.

### React build safeguards

`npm run build` (from `stride-gs-app/`) routes through `scripts/build.js`. Four phases: verify-entry → tsc -b → vite build → post-build sanity checks (module count ≥ 500, bundle size ≥ 500 KB). Catches the session-58 silent-stale-bundle failure mode. `npm run build:raw` is an escape hatch that disables the guards — **never normalize**. Before every React deploy from a worktree, `cp <parent>/stride-gs-app/.env <worktree>/stride-gs-app/.env` or Vite inlines `undefined` and the bundle crashes at module load.

### Troubleshooting

- **React change pushed, site still old** → (1) check you ran `npm run deploy` (not just `git push` — Actions is disabled); (2) hard-refresh (Ctrl+Shift+R), CDN is ~1–5 min; (3) compare DevTools main `index-*.js` hash against local `dist/assets/`; if push fails with `schannel SEC_E_MESSAGE_ALTERED`, retry or `git config http.version HTTP/1.1`.
- **GAS change pushed but Web App runs old code** → you skipped `deploy-api`. Always chain `push-api && deploy-api`.
- **Supabase migration applied but app 400s on write** → `src/lib/supabase.types.ts` is stale. Regen via `generate_typescript_types` OR hand-add the new column to the insert payload.
- **Template edit doesn't show in next email** → GAS caches 10 min. Wait, or Settings → Maintenance → Refresh Caches.
- **Price List change doesn't bill right** → Phase 5 cutover still reads MPL sheet. Click "Sync to Sheet" on Price List page.
- **Stale deployment bug:** if an API call returns `ok:true` but the side-effect is missing, 95% chance you pushed without deploying. Run `npm run deploy-api` / `deploy-clients`.

---

## Architecture (compact)

```
Master Price List     →  pricing, class map, email/invoice templates (Supabase-authoritative now)
Consolidated Billing  →  storage charges, invoicing, client mgmt, QB export
Client Inventory (×N) →  per-client sheet: Inventory, Shipments, Tasks, Repairs, Will_Calls, Billing_Ledger
Task Board            →  cross-client task dashboard (decommissioning)

StrideAPI.gs (standalone)  →  Web App doPost endpoint backing the React app
React app (mystridehub.com)  →  GitHub Pages, reads StrideAPI + Supabase cache
Supabase  →  read cache mirror of 12 entity types (inventory/tasks/repairs/will_calls/will_call_items/
             shipments/billing/clients/claims/cb_users/locations/marketing_*) + item_id_ledger +
             move_history + delivery_zones + dt_orders + entity_audit_log + gs_sync_events + profiles +
             messages + in_app_notifications
```

### Cross-tab Realtime sync — condensed

Writes travel GAS → Google Sheet (authoritative) → Supabase (best-effort write-through via `api_writeThrough_` or `api_fullClientSync_`) → Realtime publication fires on INSERT/UPDATE → React `useSupabaseRealtime` (mounted once in AppLayout, 20+ listeners, 500ms debounced) → `entityEvents.emitFromRealtime` → every relevant hook (`useInventory`/`useTasks`/etc) refetches → UI updates in ~1–2s across every open tab. Fan-out fields (e.g. Inventory field change propagating to Tasks/Repairs with same Item ID) require handler-level resync after the sheet writes settle — `api_writeThrough_` only mirrors the primary entity. NOT in Realtime: Autocomplete DB, email_templates, cb_users, marketing_*. Detail in `_archive/Docs/Archive/Session_History.md` session-72.

### Modules ported from WMS

Some components were ported from the separate Stride WMS app (`_archive/_wms_reference/`). **Fully ported:** `MultiCapture` (take-many save-once camera), `QRScanner` (BarcodeDetector + html5-qrcode fallback). **Partial:** document scanner (single JPEG, no multi-page PDF yet), OCR on documents (`documents.ocr_text` column exists but Tesseract never wired), drag-to-reorder (up/down buttons only — no `@dnd-kit`). **Not ported:** AccountPricingTab, EditAdjustmentDialog, StocktakeManifest — different domain model. When porting, always check `_archive/_wms_reference/` first; but be prepared to adapt (WMS uses shadcn+Tailwind, GS uses inline styles + v2 theme tokens).

---

## Google Sheets tab structure

**Master Price List:** `Price_List`, `Class_Map`, `Email_Templates`, `Invoice_Templates`, `Settings`.
**Consolidated Billing:** `Clients`, `Locations`, `Users`, `Claims`, `Claim_Items`, `Claim_History`, `Claim_Files`, `Claims_Config`, `Unbilled_Report`, `Consolidated_Ledger`, `Billing_Log`, `Settings`, `QB_Service_Mapping`.
**Client Sheet (×N):** `Inventory`, `Shipments`, `Tasks`, `Repairs`, `Will_Calls`, `WC_Items`, `Billing_Ledger`, `Move_History`, `Settings`, `Setup_Instructions`, `Price_Cache`, `Class_Cache`, `Location_Cache`, `Email_Template_Cache`, `Autocomplete_DB`.

---

## Key workflows (one-liner each)

1. **Receiving** — Stride Warehouse → Complete Shipment → creates shipment folder + inventory items + RCVG billing + PDF + email.
2. **Task creation** — Menu-driven batch; heavy work (Drive/PDF) deferred to "Start Task" checkbox.
3. **Start Task** — Creates task folder inside shipment folder, generates Work Order PDF, hyperlinks Task ID cell, sets Status=In Progress.
4. **Storage billing** — Stride Billing → Generate Storage Charges → per-item STOR charges (dedup by Task ID, respects FREE_STORAGE_DAYS + discounts).
5. **Invoicing** — Unbilled Report → Create & Send Invoices → grouped by client (optionally by sidemark) → Google Doc template PDF → email.
6. **Will Calls** — Create → assigns items + COD → Complete → updates inventory + WC billing (PDF at release only).
7. **Release Items** — Batch set Release Date + Status=Released, records in Item Notes (staff/admin only).
8. **Tasks/Repairs completion** — Result edit → billing on completion → email notification.
9. **Transfer Items** — Moves items + unbilled billing between client sheets. Writes Move History on both sheets. Transferred ledger rows adopt destination rates (REPAIR/RPR excluded).
10. **Import Inventory** — Migration tool: old client tabs → new format (`IMP-MMDDYYHHMMSS` shipment #).
11. **Client Onboarding** — CB Clients tab checkbox or React modal → creates Drive folders + spreadsheet from template + syncs settings.

---

## Billing schema

**Consolidated_Ledger is the single source of truth** for header names. Client Billing_Ledger syncs from it.

**Client Billing_Ledger headers:**
```
Status | Invoice # | Client | Date | Svc Code | Svc Name | Category |
Item ID | Description | Class | Qty | Rate | Total | Task ID | Repair ID |
Shipment # | Item Notes | Ledger Row ID | Invoice Date | Invoice URL
```
Sidemark is NOT a Billing_Ledger column — resolved at read time from Inventory via `api_buildInvFieldsByItemMap_()`. Supabase `billing` table has a `sidemark` column for write-through parity.

**Service codes:** `STOR`, `RCVG`, `INSP`, `ASM`, `MNRTU`, `WC`, `REPAIR`, plus `PLLT`, `PICK`, `LABEL`, `DISP`, `RSTK`, `NO_ID`, `MULTI_INS`, `SIT`, `RUSH`.

**Status values:**
- **Billing:** `Unbilled` → `Invoiced` → `Billed` | `Void`
- **Inventory:** `Active` | `Released` | `On Hold` | `Transferred`
- **Tasks:** `Open` | `In Progress` | `Completed` | `Failed` | `Cancelled`
- **Repairs:** `Pending Quote` | `Quote Sent` | `Approved` | `Declined` | `In Progress` | `Completed` | `Failed` | `Cancelled`
- **Will Calls:** `Pending` | `Scheduled` | `Partial` | `Released` | `Cancelled`

---

## Settings keys

**Client Settings** (synced from CB Clients tab → client Settings tab, one-way):
`CLIENT_NAME, CLIENT_EMAIL, MASTER_SPREADSHEET_ID, CONSOLIDATED_BILLING_SPREADSHEET_ID, DRIVE_PARENT_FOLDER_ID, PHOTOS_FOLDER_ID, MASTER_ACCOUNTING_FOLDER_ID, FREE_STORAGE_DAYS, DISCOUNT_STORAGE_PCT, DISCOUNT_SERVICES_PCT, PAYMENT_TERMS, ENABLE_RECEIVING_BILLING, ENABLE_SHIPMENT_EMAIL, ENABLE_NOTIFICATIONS, AUTO_INSPECTION, SEPARATE_BY_SIDEMARK, QB_CUSTOMER_NAME, LOGO_URL, PARENT_CLIENT`

**CB Settings:** `MASTER_SPREADSHEET_ID, CLIENT_PARENT_FOLDER_ID, CLIENT_INVENTORY_TEMPLATE_ID, DOC_TEMPLATES_FOLDER_ID, OWNER_EMAIL, NOTIFICATION_EMAILS, IIF_EXPORT_FOLDER_ID, NEXT_ITEM_ID` (auto-ID counter, starts at 80000).

**StrideAPI.gs Script Properties:** `API_TOKEN, CB_SPREADSHEET_ID, MASTER_PRICE_LIST_SPREADSHEET_ID, CAMPAIGN_SHEET_ID, SUPABASE_URL, SUPABASE_SERVICE_KEY, STAX_API_KEY`.

---

## ⚠️ Deep Links — DO NOT BREAK

Email CTA buttons ("View in Stride Hub") link to the React app and auto-open the entity detail panel. This has broken multiple times — **read this before touching any deep-link code.**

**The correct URL format — query-param style on the LIST PAGE with `&client=`:**
```
https://www.mystridehub.com/#/tasks?open=INSP-62391-1&client=<spreadsheetId>
https://www.mystridehub.com/#/repairs?open=RPR-00123&client=<spreadsheetId>
https://www.mystridehub.com/#/will-calls?open=WC-00456&client=<spreadsheetId>
https://www.mystridehub.com/#/shipments?open=SHP-001234&client=<spreadsheetId>
https://www.mystridehub.com/#/inventory?open=62391&client=<spreadsheetId>
```

**Why not route-style (`/#/tasks/INSP-62391-1`):** Gmail's link tracker strips the `#` fragment, landing users on the list page with no context. The query-param format always works because the list page has deep-link handlers that:
1. Read `?open=` → store in `pendingOpenRef`
2. Read `?client=` → store in `deepLinkPendingTenantRef`
3. When `apiClients` loads → auto-select the client
4. When data loads → auto-open the matching entity's detail panel

**Without `&client=`**, step 3 never fires → detail panel never opens. **Most common breakage mode.**

**Two emission sites — both must include `&client=`:**

| System | Where | Token |
|---|---|---|
| Client-bound scripts | `Emails.gs`, `Triggers.gs`, `Shipments.gs` | `{{APP_DEEP_LINK}}` — uses `encodeURIComponent(ss.getId())` |
| StrideAPI.gs | `api_sendTemplateEmail_` (~line 9148) | `{{TASK_DEEP_LINK}}`, `{{REPAIR_DEEP_LINK}}`, `{{WC_DEEP_LINK}}`, `{{SHIPMENT_DEEP_LINK}}`, `{{ITEM_DEEP_LINK}}` — auto-injected from entity IDs. v38.101.0 added a self-heal scanner that appends `&client=` to any `mystridehub.com/#/<entity>?open=ID` URL missing it at send time. |

**Rules:**
1. Never use route-style deep links — always query-param.
2. Always include `&client=<spreadsheetId>`. From `ss.getId()` in client-bound scripts or `settings["CLIENT_SPREADSHEET_ID"]` in StrideAPI.gs.
3. Don't change `APP_BASE_URL_` — must include the `#`.
4. React deep-link handler lives in each list page as two effects. Dependency must be `[apiClients.length]` (stable number), NOT `[apiClients]` (unstable array → React #300).
5. `useClientFilterUrlSync` keeps URL's `?client=` in sync with the dropdown — manual picks become shareable.

---

## Load-bearing architectural invariants

Top decisions that affect code generation on every task. **Full 53-item list with implementation notes:** `_archive/Docs/Archive/Architectural_Decisions_Log.md`.

1. **Consolidated_Ledger = authoritative billing schema.** Client ledgers sync from it. "Ledger Row ID" is canonical.
2. **Header-based column mapping only.** Never positional indexes. Non-destructive updates (rename legacy + append missing, never reorder/remove).
3. **Settings sync is one-way:** CB Clients tab → client Settings tab. Never the reverse.
4. **Drive folders are flat entity subfolders** under `DRIVE_PARENT_FOLDER_ID`: `Shipments/`, `Tasks/`, `Repairs/`, `Will Calls/`. `getOrCreateEntitySubfolder_()` self-heals on first use.
5. **Discount convention:** negative = discount, positive = surcharge, range **-100 to +100**. Formula `rate * (1 + pct / 100)`. Transferred rows adopt destination rates (REPAIR/RPR excluded).
6. **Storage rate** = base per cuFt × class cubic volume × discount. Classes: XS=10, S=25, M=50, L=75, XL=110 cuFt.
7. **Web App deployments are frozen snapshots.** Push ≠ deploy. Always run matching `deploy-*` after `push-*`.
8. **onEdit parity for React:** Apps Script programmatic writes don't fire onEdit triggers. onEdit side-effects must be replicated in StrideAPI.gs POST endpoints.
9. **Role-based access:** 3 tiers — admin = full, staff = no Billing/Claims/Payments/Settings, client = own data only. Enforced in sidebar + `RoleGuard` route protection.
10. **Server cache invalidation:** CacheService 600s TTL on GET endpoints, invalidated on every relevant write. `noCache=1` bypasses for refresh buttons.
11. **LockService on concurrent-sensitive writes:** Start Task, completeTask, completeRepair, processWcRelease, getNextItemId, all Stax financial writes, claim create, campaign runNow, reopen* handlers. Use `getUserLock()` for per-user scopes, `getScriptLock()` for global.
12. **Parent/Child accounts:** one-level hierarchy via `PARENT_CLIENT` on CB Clients. `getAccessibleClientScope_()` resolves scope with 60s cache. Parent users see own + children combined; email routing never auto-CCs parent.
13. **Sidemark on billing:** not a ledger column. Resolved at read time from Inventory via `api_buildInvFieldsByItemMap_()`. Supabase `billing` table has a `sidemark` column for write-through parity.
14. **PDF generation has retry-with-backoff** on Drive 403/429/5xx via `api_fetchWithRetry_` (1s/2s/4s/8s). StrideAPI.gs runs on GCP project `1011527166052` for higher Drive quotas.
15. **Supabase is a read cache, not authority.** GAS writes are the execution authority; Supabase mirrors via best-effort write-through. Never block a GAS write on a Supabase failure.
16. **`item_id_ledger` is the authoritative cross-tenant registry** (legitimate exception to #15) — Supabase-resident, globally unique, rows never deleted, status evolves (`active`/`released`/`transferred`/`voided`). `completeShipment` pre-check rejects cross-tenant collisions with `ITEM_ID_COLLISION`.
17. **Inventory is the single source of truth for all item-level fields.** Every handler (Tasks/Repairs/WC/Billing/Dashboard) OVERRIDES Location/Vendor/Sidemark/Description/Room/Shipment#/etc. from Inventory at read time. React mirrors this via `_fetchInvFieldMap()` for Supabase-first reads. **Never snapshot item fields on entity mirrors — always overlay from Inventory.**
18. **CB Clients canonical Title Case:** "Client Name", "Client Email", "Contact Name", "Phone", "Stax Customer ID", "Payment Terms", "QB_CUSTOMER_NAME" (ALL-CAPS by QB convention). `api_ensureColumn_` is case-insensitive on read so pre-existing mis-cased headers are reused not duplicated.
19. **`useClients` is a per-consumer hook.** Per-instance, but short-circuits on the in-memory cache so array references converge. Load-bearing mitigation for React #300 on Inventory: `clientNameMap` ref-stabilization pattern in the 6 data hooks (`useInventory`/`useTasks`/`useRepairs`/`useWillCalls`/`useShipments`/`useBilling`). Always use the ref pattern when a hook builds a memo from `clients` and closes over it in a `useCallback` dep array.
20. **Stax Autopay** is a two-stage pipeline under a single lock. Daily trigger → `_prepareEligiblePendingInvoicesForChargeRun` → `_executeChargeRun`. Per-run cap (25/max 100), 1500ms throttle, 3-failure circuit breaker, 5m30s wall-time watchdog. 5xx/network/0/401/403 count as breaker fuel; 404/400/422 are row-level bad data (reset counter). Auto Charge override: invoice TRUE wins, FALSE skips, blank falls back to CB Clients with distinct `CLIENT_AUTO_DISABLED` vs `UNKNOWN_CLIENT` buckets.
21. **Activity log** lives in Supabase `entity_audit_log` (`entity_type`, `entity_id`, `tenant_id`, `action`, `changes` jsonb, `performed_by`, `performed_at`, `source`). Written by `api_auditLog_` from 40+ router cases (session 77 filled the coverage gaps). React `EntityHistory` component reads it, wired into every detail panel via `TabbedDetailPanel.builtInTabs.activity` or customTabs escape hatch. Historical events pre-audit-log seeded by `handleBackfillActivity_` (`source='backfill:v1'`, idempotent via `api_tenantBackfilled_`).

---

## Current versions

- **StrideAPI.gs:** v38.105.0 (Apps Script deployment v361) — session 77 Stage C: audit-log coverage + back-fill. v38.104.0 Stage B: reopen handlers + repair result corrector. v38.103.0 Stage A: mirror drift cleanup + will_call_items table + hide Start for client role. v38.102.0 Tier 1: inventory shipment_folder_url. Prior sessions: DOC_QUOTE template + token audit, messaging, email/doc templates on Supabase, manual billing charges, Reference+Sidemark propagation, receiving add-ons, Phase 5 rate cutover shadow mode, task due date + priority, admin-set-password + auth-user ensure + resync.
- **Supabase schema (new this session):** `inventory` + `shipment_folder_url`/`needs_inspection`/`needs_assembly` (mig 20260422010000); `shipments` + `photos_url`/`invoice_url`; `will_calls` + `created_by`/`pickup_phone`/`requested_by`/`actual_pickup_date`/`total_wc_fee`; `repairs` + `source_task_id`/`parts_cost`/`labor_hours`/`invoice_id`/`approved`/`billed`; new `will_call_items` table (mig 20260422020000).
- **React bundle:** `Inventory-C8gg-CyW.js` (post-Stage-B) + `index-DS-hNIRJ.js`.
- **StaxAutoPay.gs:** v4.6.0 — Supabase write-through wired; **requires `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` Script Properties on the Stax Auto Pay project** (see open items).
- **Client scripts** (rolled out to all 49 active clients): `Code.gs` v4.6.0, `Import.gs` v4.3.0, `Emails.gs` v4.6.0, `Shipments.gs` v4.3.2, `WillCalls.gs` v4.4.0, `Triggers.gs` v4.7.1, `RemoteAdmin.gs` v1.5.1.

See `_archive/Docs/Stride_GS_App_Build_Status.md` for the full per-script version matrix + feature-parity table.

---

## Project IDs & URLs

**React app:** https://www.mystridehub.com · repo: `github.com/Stride-dotcom/Stride-GS-app` · QR Scanner repo: `github.com/Stride-dotcom/Stride-GS-Scanner`.

**Google Sheets:**
- Master Price List: `1inonw5cd1YBaPA-dgkP-Rub9wOpqAgOlNE1sOJIdJPY`
- Campaign Spreadsheet: `1p7dmJlqij2KzwAFiXCUBbUTeF5JVvQF7TQlrofp9tcg`
- Client sheets: see `AppScripts/stride-client-inventory/admin/clients.json`

**Apps Script projects:**
- **Stride API:** `134--evzE23rsA3CV_vEFQvZIQ86LE9boeSPBpGMYJ3pLbcW_Te6uqZ1M` ([open](https://script.google.com/home/projects/134--evzE23rsA3CV_vEFQvZIQ86LE9boeSPBpGMYJ3pLbcW_Te6uqZ1M/edit))
- **Consolidated Billing:** `1o38NMWpP7FrdCyNLo5Yd-AwHlzcHr2PxZ_QyYwlF20_5ljx_bukOScJQ` ([open](https://script.google.com/u/0/home/projects/1o38NMWpP7FrdCyNLo5Yd-AwHlzcHr2PxZ_QyYwlF20_5ljx_bukOScJQ/edit))
- **Master Price List:** `10ToAAlw-OYm0GDfy4xVwAX72hIPb6ZeDNrP1_qIxZv3BhG4Z2Hb_cZHc`
- **Task Board:** `1RgsXWnAfZfpU5M58SE19ZFf7cuh0HtC5eUMZ86IxQ2jQwL5Pl5UJZvMg`
- **Stax Auto Pay:** `1n_AkHhTB1ijUxLdfH8qCcYitHHBD30gCz2FKB1-q33wkJrXLiCpVqmt4`

Client inventory scripts aren't edited via direct URLs — use `npm run rollout`. Each client has its own bound copy.

**GCP:** StrideAPI.gs linked to project `1011527166052` (Stride GS Inventory System) for higher Drive quotas. If the link breaks, re-link via Apps Script editor → Project Settings → GCP Project → Change.

---

## Current phase & open work

**Auth + Phase 7 read/write endpoints + Phase 8 features:** COMPLETE. See Build Status doc for the full matrix.

### Open items

- [ ] **Stage A backfill pending** — user to re-run `reconcileAllClientsNow` from the Apps Script editor to populate new mirror columns (`shipments.photos_url`, `will_calls.created_by`, `repairs.parts_cost`, `will_call_items` rows, etc.). First run (Tier 1) already completed.
- [ ] **Stage C activity back-fill pending** — user to run `backfillActivityAllClientsNow()` (~30–60 min, resumable) to populate historical `entity_audit_log` rows from existing sheet timestamps.
- [ ] **Quote Tool PDF wire-up** — Quote PDF generation using Supabase `DOC_QUOTE` template (in progress — React end next).
- [ ] **DispatchTrack Phase 1c** — webhook ingest Edge Function. Needs DT account API credentials + webhook secret.
- [ ] **Phase 5 billing cutover flip** — shadow mode logging parity. Switch to Supabase-primary once operator confirms zero drift on Justin Demo Account.
- [ ] **GitHub clone out of Dropbox** — repo is on GitHub; local clone lives in Dropbox and causes write-conflict bugs. Move clone to a non-synced path.
- [ ] **Standalone Repair / Will Call detail pages** — `#/repairs/:repairId` and `#/will-calls/:wcNumber` (same pattern as Task detail, not started).
- [ ] **Generate Work Order button** — manual PDF from TaskDetailPanel. Backend handler exists; needs React wiring + router case.
- [ ] **Seed Stax Supabase caches (one-time)** — Open Stride API editor → run `seedAllStaxToSupabase()` once. Until then Payments falls back to GAS on first load.
- [ ] **Set Supabase Script Properties on Stax Auto Pay project** — `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`. Until set, Stax write-through is a silent no-op.
- [ ] **Auto-Print Labels from Receiving** — toggle for inline label printing.
- [ ] **Parent Transfer Access** — allow parent users to transfer items between their own children.
- [ ] **Global search expansion** — add shipments / billing / claims entities + missing fields.
- [ ] **Autocomplete DB in React** — Sidemark / Vendor / Description per client (currently GAS-fallback).
- [ ] **Invoice-level `invoiceDate` field** — add to `InvoiceGroup` so re-sorted children don't shift the displayed date.
- [ ] **Invoice number link in summary row** — wire `invoiceUrl` through `InvoiceGroup`.
- [ ] **DetailPanel internals v2 polish** — outer panel is v2, deep interiors (action rows, field grids) still have 8–10px corners.
- [ ] **Sync delivery zones to MPL sheet tab** — data now in Supabase; bidirectional mirror is deferred (no GAS consumer today).

### Known bugs (unresolved)

- **GitHub Pages CDN caching gotcha** — hard-refresh (Ctrl+Shift+R) after deploy to verify new bundle hash.
- `populateUnbilledReport_()` in CB Code.gs.js uses OLD header names ("Billing Status", "Service Date").
- `CB13_addBillingStatusValidation()` looks for "Billing Status" instead of "Status".
- Transfer Items dialog needs processing animation + disable buttons after complete.
- Repair discounts — should disable.
- Receiving page uses hardcoded table (no TanStack Table / no column reorder — v76 rebuild in progress).

---

## Tools reference (compact)

Full details: `_archive/Docs/Archive/Deployment_Reference.md`.

**Backend rollout (`AppScripts/stride-client-inventory/`):**
- `npm run rollout` / `rollout:dry` / `rollout:pilot` — push `.gs` to all client bound scripts. Run `npm run sync` first.
- `npm run sync` — pull CB Clients → `admin/clients.json`. Rejects template scriptId.
- `npm run deploy-clients` / `deploy-api` / `deploy-cb` — create new Web App deployment versions (mandatory after `push-*`).
- `npm run deploy-all` — clients + API + CB in one shot.
- `npm run push-api` / `push-cb` / `push-master` / `push-taskboard` / `push-stax` / `push-scanner` / `push-templates` — push source only (not Web-App-live until matching `deploy-*`).
- `npm run verify` / `refresh-caches` / `sync-caches` / `update-headers` / `install-triggers` / `health-check` — remote admin operations on all clients.
- `npm run remote -- --fn=FunctionName` — generic remote function runner.

**React (`stride-gs-app/`):**
- `npm run dev` — Vite dev server on `http://localhost:5173`.
- `npm run deploy -- "msg"` — **THE deploy command.** Build → push dist to `origin/main` → commit+push source.
- `npm run build` — build only (safeguards on). `npm run build:raw` — no safeguards (only when certain).
- `npm run lint` / `preview`.

**MCP tools available:**
- **Supabase** (project `uqplppugeickmamycpuz`): `apply_migration`, `execute_sql`, `list_migrations`, `list_tables`, `get_advisors`, `get_logs`, `generate_typescript_types`, `deploy_edge_function`.
- **Scheduled tasks / CronCreate** — recurring prompts (in-session or persistent).

**Sub-agents (`Agent` tool):** `Explore` (read-only research), `Plan` (implementation strategy), `general-purpose`, `claude-code-guide`. **Dropbox sync warning: sub-agents are READ-ONLY. Never `isolation: "worktree"`.**

---

## Document maintenance policy

**Hot docs (update every session):**
- `CLAUDE.md` (this file): rules, invariants, current open items, known bugs, versions.
- `_archive/Docs/Stride_GS_App_Build_Status.md`: current-session changes (REPLACE each session, don't accumulate), feature matrix.

**Cold docs (update rarely):**
- `_archive/Docs/Archive/Session_History.md`: one-line entry per session.
- `_archive/Docs/Archive/Architectural_Decisions_Log.md`: add new numbered decision when one is made.

**Trimming rules:**
- Session entries in CLAUDE.md "Open Work" → only `[ ]` open items, never `[x]` done.
- Completed phase plans → move full plan to `_archive/Docs/Archive/`, leave a one-liner.
- Known bugs: remove once fixed and deployed.
- Never expand session history into full changelogs — one line per session, max ~200 chars (exception: session-77 is longer because it covered three tiers + workflow change).
