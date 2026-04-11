# GS Inventory — System Reference

> **Temporary Google Sheets system** for Stride Logistics (3PL warehouse, Kent WA). A full Stride WMS web app is being built separately — this runs operations (~60 clients) until that's ready.

**Owner:** Justin — manages ~60 client accounts, tests immediately.

## ⚠️ This is NOT the Stride WMS Web App

Do NOT use these skills — they're for the separate React/Supabase web app:
- `stride-wms-domain` — references SALA, RLS, SYSTEM_MASTER docs — not applicable here
- `stride-build-instructions` — same, not applicable

This project uses Google Apps Script, Google Sheets, Google Drive APIs — **plus Supabase as a read cache + failure tracking layer**. The Supabase integration is simpler than the WMS app's pattern; don't inherit WMS skill assumptions.

---

## Archive pointers (load on demand)

Historical and rarely-needed reference material has been moved to `Docs/Archive/`. Read these files only when relevant to the current task:

| File | When to read |
|---|---|
| `Docs/Archive/Session_History.md` | Need context on when a feature was built or a decision made — 68 session one-liners |
| `Docs/Archive/Deployment_Reference.md` | Full deployment guide, troubleshooting, auth prereqs, all npm commands |
| `Docs/Archive/Supabase_Integration_Plan.md` | Phase 1-4 Supabase integration details; open risks, manual steps |
| `Docs/Archive/Marketing_Manager_Plan.md` | Marketing Campaign Manager build plan (all 5 phases complete) |
| `Docs/Archive/QR_Scanner_Next_Phase.md` | Scanner Supabase direct lookup + auto-print labels build plan (not started) |
| `Docs/Archive/Architectural_Decisions_Log.md` | Full numbered list of 53 decisions — the "why" behind feature implementations |
| `Docs/Archive/Performance_Track_History.md` | Completed performance phases 1-3 with version numbers |

Companion living doc: **`Docs/Stride_GS_App_Build_Status.md`** — current session changes, what's next, feature parity matrix.

---

## Rules for Claude

### Must-do
- **Deploy before reporting done.** After every code change, run the deploy commands via Bash — don't describe them. See deploy table below. Only exception: user explicitly asks for instructions instead of execution.
- **Version header on every script edit.** Lines 1-3 of every `.gs`/`.js` file:
  ```
  /* ===================================================
     SCRIPT_NAME — vX.Y.Z — YYYY-MM-DD HH:MM AM/PM PST
     =================================================== */
  ```
  Patch bump for small fixes, minor bump for new features. Timestamps use PST (Justin is in WA). Never overwrite existing headers — use non-destructive updates.
- **Header-based column mapping.** Use `getHeaderMap_()` / `headerMapFromRow_()` everywhere. Never positional indexes.
- **Read files before editing.** Don't guess script contents. Grep for all references before removing a variable or moving logic.
- **Non-destructive header updates.** Rename legacy + append missing, never reorder/remove.
- **Work incrementally.** Small changes, deploy, test, fix. Don't write massive refactors in one pass.
- **Update docs at end of session.** See `Docs/Stride_GS_App_Build_Status.md` Recent Changes — CURRENT SESSION ONLY, don't accumulate. Add a one-line entry to `Docs/Archive/Session_History.md`.

### Must-not-do
- **Never use `getLastRow()` for insert positions** — use `getLastDataRow_()`. `getLastRow()` returns false positives due to validations on empty rows.
- **Dropbox sync warning:** Main chat ONLY writes files. Subagents are READ-ONLY (use Explore agents for research, never for writes). Never use `isolation: "worktree"`. Dropbox sync conflicts with concurrent writes.
- **React never calculates billing.** All billing logic stays server-side in Apps Script. The React app only displays what the API returns.

### Task Board parity
When changing client-side functions or columns, check whether the Task Board script needs matching changes (shared handlers, editable sets, header arrays, exclusion lists). Shared handlers use `SH_` prefix with `SHARED_HANDLER_VERSION` constant.

---

## Deploy Reference (one table, one source of truth)

**Golden rule:** Web App deployments are **frozen snapshots**. `npm run rollout` / `push-api` push SOURCE but the live Web App serves the last DEPLOYMENT. You must run the matching `deploy-*` command after every push to Web App code. If in doubt, `npm run deploy-all`. See `Docs/Archive/Deployment_Reference.md` for full troubleshooting.

All commands run from: `AppScripts/stride-client-inventory/` (except React, which runs from `stride-gs-app/`).

| Change type | Push | Deploy (MANDATORY if Web App-facing) |
|---|---|---|
| `stride-client-inventory/src/*.gs` | `npm run rollout` | `npm run deploy-clients` |
| `StrideAPI.gs` | `npm run push-api` | `npm run deploy-api` |
| QR Scanner scripts | `npm run push-scanner` | `npm run deploy-cb` |
| CB scripts (if Web App touched) | `npm run push-cb` | `npm run deploy-cb` |
| Master Price List | `npm run push-master` | — |
| Task Board | `npm run push-taskboard` | — |
| Stax Auto Pay | `npm run push-stax` | — |
| Email templates | `npm run push-templates` | `npm run refresh-caches` |
| React app | (from `stride-gs-app/`) `npx tsc --noEmit && npm run build` then `cd dist && git add -A && git commit -m "Deploy: ..." && git push origin main --force` | GitHub Pages auto (CDN 1-5 min; hard-refresh to verify) |

**All-at-once after a big session:**
```bash
npm run push-api && npm run deploy-api
npm run rollout && npm run deploy-clients
# Then React build from stride-gs-app/
```

**`npm run deploy-all`** updates clients + StrideAPI Web App deployments in one shot. Idempotent, safe to run anytime.

### How to spot a stale deployment bug
If a remote admin or API call returns `ok: true` but the expected side-effect is missing (new column not added, new payload field ignored, new response field missing), **first check: did I run `deploy-*` after the last `push-*`?** 95% of the time that's the answer.

---

## Architecture

4 interconnected Google Sheets, each with bound Apps Script, plus a standalone API project and a React frontend:

```
Master Price List (1)  →  pricing, class map, email/invoice templates
        ↓ reads pricing
Consolidated Billing (1)  →  storage charges, invoicing, client mgmt, QB export
        ↓ manages N clients
Client Inventory (N)  →  per-client: inventory, shipments, tasks, repairs, will calls, billing
Task Board (1)  →  cross-client task dashboard (decommissioning)

StrideAPI.gs (standalone)  →  Web App doPost endpoint backing the React app
React app (mystridehub.com)  →  GitHub Pages, reads StrideAPI + Supabase cache
Supabase  →  read cache mirror of 6 entity types + failure tracking
```

---

## File Structure (compact)

All scripts under `AppScripts/`:

```
AppScripts/
├── stride-client-inventory/src/    — 13 .gs modular client files (deploy: npm run rollout)
│   ├── Code.gs AutocompleteDB.gs Billing.gs Emails.gs Import.gs
│   ├── RemoteAdmin.gs Repairs.gs Shipments.gs Tasks.gs Transfer.gs
│   ├── Triggers.gs Utils.gs WillCalls.gs
│   └── admin/                      — rollout tools (Node.js): rollout.mjs, sync-clients.mjs,
│                                     verify-triggers.mjs, run-remote.mjs, setup-auth.mjs,
│                                     update-deployments.mjs, .credentials.json, clients.json
├── stride-api/StrideAPI.gs         — standalone API for React (deploy: push-api + deploy-api)
├── Consolidated Billing Sheet/     — 11 .js files (deploy: push-cb)
├── Master Price list script.txt    — (deploy: push-master)
├── task board script.txt           — (deploy: push-taskboard)
├── QR Scanner/                     — 5 files (deploy: push-scanner)
├── stax-auto-pay/StaxAutoPay.gs    — (deploy: push-stax)
└── Email Campaign App/             — stridecampaignv2.5.gs, separate project
```

Other folders: `Doc Templates/`, `EMAIL TEMPLATES/`, `INSTRUCTION GUIDES/`, `Docs/`, `Docs/Archive/`.

**React app source:** `stride-gs-app/src/` (Vite + React + TypeScript + TanStack Table + Lucide icons + HashRouter).

---

## Google Sheets Tab Structure

**Master Price List:** `Price_List`, `Class_Map`, `Email_Templates`, `Invoice_Templates`, `Settings`

**Consolidated Billing:** `Clients`, `Locations`, `Users`, `Claims`, `Claim_Items`, `Claim_History`, `Claim_Files`, `Claims_Config`, `Unbilled_Report`, `Consolidated_Ledger`, `Billing_Log`, `Settings`, `QB_Service_Mapping`

**Client Sheet (×N):** `Inventory`, `Shipments`, `Tasks`, `Repairs`, `Will_Calls`, `WC_Items`, `Billing_Ledger`, `Move_History`, `Settings`, `Setup_Instructions`, `Price_Cache`, `Class_Cache`, `Location_Cache`, `Email_Template_Cache`, `Autocomplete_DB`

---

## Key Workflows

1. **Receiving** — Stride Warehouse → Complete Shipment → creates shipment folder + inventory items + RCVG billing + PDF + email.
2. **Task Creation** — Menu-driven (batch), lightweight rows only. Heavy work (Drive/PDF) deferred to "Start Task" checkbox.
3. **Start Task** — Creates task folder inside shipment folder, generates Work Order PDF, hyperlinks Task ID, sets Status to "In Progress".
4. **Storage Billing** — Stride Billing → Generate Storage Charges → per-item STOR charges (dedup by Task ID, respects FREE_STORAGE_DAYS + discounts).
5. **Invoicing** — Unbilled Report → Create & Send Invoices → grouped by client (optionally by sidemark) → Google Doc template PDF → email.
6. **Will Calls** — Create → assigns items + COD → Complete → updates inventory + WC billing. PDF generated at release time only.
7. **Release Items** — Batch set Release Date + Status=Released, records in Item Notes (staff/admin only).
8. **Tasks/Repairs Completion** — Result edit → billing on completion → email notification.
9. **Transfer Items** — Moves items + unbilled billing between client sheets. Writes Move History row on both sheets. Transferred ledger rows adopt destination rates (except REPAIR/RPR).
10. **Import Inventory** — Migration tool: old client tabs → new format (`IMP-MMDDYYHHMMSS` shipment #).
11. **Client Onboarding** — CB Clients tab checkbox or React modal → creates Drive folders + spreadsheet from template + syncs settings.

---

## Billing Schema

**Consolidated_Ledger is the single source of truth** for header names. Client Billing_Ledger syncs from it.

### Client Billing_Ledger Headers
```
Status | Invoice # | Client | Date | Svc Code | Svc Name | Category |
Item ID | Description | Class | Qty | Rate | Total | Task ID | Repair ID |
Shipment # | Item Notes | Ledger Row ID | Invoice Date | Invoice URL
```
Note: Sidemark is NOT a Billing_Ledger column. The API resolves it at read time from Inventory via `api_buildInvFieldsByItemMap_()` (StrideAPI.gs v38.6.0+).

### Service Codes
`STOR` (Storage), `RCVG` (Receiving), `INSP` (Inspection), `ASM` (Assembly), `MNRTU` (Minor Touch-Up), `WC` (Will Call), `REPAIR` (Repair), plus `PLLT`, `PICK`, `LABEL`, `DISP`, `RSTK`, `NO_ID`, `MULTI_INS`, `SIT`, `RUSH`.

### Status Values
- **Billing:** `Unbilled` → `Invoiced` → `Billed` | `Void`
- **Inventory:** `Active` | `Released` | `On Hold` | `Transferred`
- **Tasks:** `Open` | `In Progress` | `Completed` | `Failed` | `Cancelled`
- **Repairs:** `Pending Quote` | `Quote Sent` | `Approved` | `Declined` | `In Progress` | `Completed` | `Failed` | `Cancelled`
- **Will Calls:** `Pending` | `Scheduled` | `Partial` | `Released` | `Cancelled`

---

## Settings Keys

**Client Settings** (synced from CB Clients tab → client Settings tab):
`CLIENT_NAME, CLIENT_EMAIL, MASTER_SPREADSHEET_ID, CONSOLIDATED_BILLING_SPREADSHEET_ID, DRIVE_PARENT_FOLDER_ID, PHOTOS_FOLDER_ID, MASTER_ACCOUNTING_FOLDER_ID, FREE_STORAGE_DAYS, DISCOUNT_STORAGE_PCT, DISCOUNT_SERVICES_PCT, PAYMENT_TERMS, ENABLE_RECEIVING_BILLING, ENABLE_SHIPMENT_EMAIL, ENABLE_NOTIFICATIONS, AUTO_INSPECTION, SEPARATE_BY_SIDEMARK, QB_CUSTOMER_NAME, LOGO_URL, PARENT_CLIENT`

**CB Settings:**
`MASTER_SPREADSHEET_ID, CLIENT_PARENT_FOLDER_ID, CLIENT_INVENTORY_TEMPLATE_ID, DOC_TEMPLATES_FOLDER_ID, OWNER_EMAIL, NOTIFICATION_EMAILS, IIF_EXPORT_FOLDER_ID, NEXT_ITEM_ID` (auto-ID counter, starts at 80000)

**StrideAPI.gs Script Properties:**
`API_TOKEN, CB_SPREADSHEET_ID, MASTER_PRICE_LIST_SPREADSHEET_ID, CAMPAIGN_SHEET_ID, SUPABASE_URL, SUPABASE_SERVICE_KEY, STAX_API_KEY`

---

## Load-bearing Architectural Invariants

These are the top decisions that affect code generation on every task. For the full 53-item list with implementation notes, see `Docs/Archive/Architectural_Decisions_Log.md`.

1. **Consolidated_Ledger = authoritative billing schema.** Client ledgers sync from it. "Ledger Row ID" is canonical.
2. **Header-based column mapping only.** Never positional indexes.
3. **Non-destructive header updates.** Rename legacy + append missing, never reorder/remove.
4. **Settings sync is one-way:** CB Clients tab → client Settings tab.
5. **Drive folders are flat entity subfolders** under `DRIVE_PARENT_FOLDER_ID`: `Shipments/`, `Tasks/`, `Repairs/`, `Will Calls/`. `getOrCreateEntitySubfolder_()` self-heals on first use.
6. **Discount convention:** negative = discount, positive = surcharge, range **-100 to +100** (outside range is silently ignored as typo rail). Formula `rate * (1 + pct / 100)`. Transferred rows adopt destination rates (REPAIR/RPR excluded).
7. **Storage rate** = base per cuFt × class cubic volume × discount. Classes: XS=10, S=25, M=50, L=75, XL=110 cuFt.
8. **Task creation is menu-driven (batch).** Heavy work deferred to "Start Task" checkbox.
9. **Email/doc templates cached locally** (`Email_Template_Cache` tab). Check local first, fall back to Master.
10. **Storage charge dedup:** skip only Invoiced/Billed/Void; unbilled STOR rows deleted + recreated on each run.
11. **Remote admin uses Web App `doPost()`** (not `scripts.run` — blocked by 403 in this Workspace). Each client has a Web App deployment registered in `admin/clients.json`.
12. **Web App deployments are frozen snapshots.** Push ≠ deploy. Always run the matching `deploy-*` after `push-*`.
13. **onEdit parity for React:** Apps Script programmatic writes don't fire onEdit triggers. All onEdit side-effects must be replicated in StrideAPI.gs POST endpoints (field propagation to Tasks/Repairs, Task Notes aggregation, WC auto-promote).
14. **Role-based access:** 3-tier nav — admin = full, staff = no Billing/Claims/Payments/Settings, client = own data only. Enforced both in sidebar rendering and via `RoleGuard` route protection.
15. **Server cache invalidation:** CacheService 600s TTL on GET endpoints, invalidated on every relevant write. `noCache=1` bypasses cache for refresh buttons.
16. **LockService on concurrent-sensitive writes:** Start Task, completeTask, completeRepair, processWcRelease, getNextItemId, all Stax financial writes, claim create, campaign runNow.
17. **Parent/Child accounts:** One-level hierarchy via `PARENT_CLIENT` column on CB Clients. `getAccessibleClientScope_()` resolves scope with 60s cache. Parent users see own + children's data combined; email routing never auto-CCs parent.
18. **Sidemark on billing:** not a ledger column. Resolved at read time from Inventory via `api_buildInvFieldsByItemMap_()`. Supabase `billing` table has a `sidemark` column for write-through parity.
19. **PDF generation has retry-with-backoff** on Drive 403/429/5xx via `api_fetchWithRetry_` (1s/2s/4s/8s). StrideAPI.gs runs on a dedicated GCP project (number `1011527166052`) for higher Drive quotas.
20. **Supabase is a read cache, not authority.** GAS writes are the execution authority; Supabase mirrors via best-effort write-through. Never block a GAS write on a Supabase failure.
21. **Stax Autopay is a two-stage pipeline under a single lock** (Phase 4A, StaxAutoPay.gs v4.4.0+). Daily trigger → `_prepareEligiblePendingInvoicesForChargeRun` (auto-pushes eligible PENDING rows to CREATED via `_createStaxInvoicesForRows_`) → `_executeChargeRun` (charges the CREATED rows). A PENDING row due today with Auto Charge enabled is no longer stranded — it's pushed and charged in the same run. Manual `runCharges()` uses the identical path.
22. **Stax Autopay batch controls** (Phase 4B, StaxAutoPay.gs v4.5.0+). Charge stage runs sequentially with per-run cap (`MAX_AUTO_CHARGES_PER_RUN`, default 25, max 100), throttle delay (`AUTO_CHARGE_DELAY_MS`, default 1500ms), consecutive-failure circuit breaker (`AUTO_CHARGE_CIRCUIT_BREAKER_COUNT`, default 3), and wall-time watchdog (5m30s hard budget). Only 5xx/network/0/401/403 errors count as breaker fuel — 404/400/422 are treated as row-level bad data (logged, counter reset). Deferred rows stay CREATED with no sheet mutation and process on the next run. Config keys are seeded append-only on first read via `_getIntConfig_`.
23. **Stax Autopay Auto Charge override policy** is identical in the prepare and charge stages. Invoice TRUE always wins; invoice FALSE always skips (no log); blank invoice falls back to CB Clients with two distinct exception buckets — `CLIENT_AUTO_DISABLED` (client row exists with AUTO CHARGE=FALSE) and `UNKNOWN_CLIENT` (client not found in CB Clients). Both stages write Exceptions rows with stage-prefixed reason strings so operators can tell where the skip happened. Fixed the prior charge-stage divergence where `undefined` fell through and auto-charged.
24. **CB Clients column convention is canonical Title Case** (StrideAPI.gs v38.40.0+). All `setCol_` callers use the exact header case that ships in the sheet template ("Client Name", "Client Email", "Contact Name", "Phone", "Stax Customer ID", "Payment Terms", "QB_CUSTOMER_NAME" — the last is ALL-CAPS by QB convention). `api_ensureColumn_` does a case-insensitive match before auto-creating, so an existing bad-case header is reused instead of spawning a duplicate column. A prominent CONVENTION comment block above `setCol_` documents the rule. Read path is already case-tolerant via the `hMap` in `api_clientRowToPayload_`, so previously-saved rows with mis-cased headers surface their data immediately after deploy — no manual sheet cleanup needed.

---

## Current Versions

- **StrideAPI.gs:** v38.40.0 (Web App v228)
- **StaxAutoPay.gs:** v4.5.0
- See `Docs/Stride_GS_App_Build_Status.md` for the full per-script version matrix and session history.

---

## Project IDs & URLs

**React App (GitHub Pages):**
- Live: https://www.mystridehub.com
- Repo: https://github.com/Stride-dotcom/Stride-GS-app
- QR Scanner repo: https://github.com/Stride-dotcom/Stride-GS-Scanner

**Google Sheets Spreadsheet IDs:**
- Master Price List: `1inonw5cd1YBaPA-dgkP-Rub9wOpqAgOlNE1sOJIdJPY`
- Campaign Spreadsheet: `1p7dmJlqij2KzwAFiXCUBbUTeF5JVvQF7TQlrofp9tcg`
- Client sheets: see `admin/clients.json`

**Apps Script Project IDs:**
- **Stride API:** `134--evzE23rsA3CV_vEFQvZIQ86LE9boeSPBpGMYJ3pLbcW_Te6uqZ1M` ([open](https://script.google.com/home/projects/134--evzE23rsA3CV_vEFQvZIQ86LE9boeSPBpGMYJ3pLbcW_Te6uqZ1M/edit))
- **Consolidated Billing:** `1o38NMWpP7FrdCyNLo5Yd-AwHlzcHr2PxZ_QyYwlF20_5ljx_bukOScJQ` ([open](https://script.google.com/u/0/home/projects/1o38NMWpP7FrdCyNLo5Yd-AwHlzcHr2PxZ_QyYwlF20_5ljx_bukOScJQ/edit))
- **Master Price List:** `10ToAAlw-OYm0GDfy4xVwAX72hIPb6ZeDNrP1_qIxZv3BhG4Z2Hb_cZHc` ([open](https://script.google.com/u/0/home/projects/10ToAAlw-OYm0GDfy4xVwAX72hIPb6ZeDNrP1_qIxZv3BhG4Z2Hb_cZHc/edit))
- **Task Board:** `1RgsXWnAfZfpU5M58SE19ZFf7cuh0HtC5eUMZ86IxQ2jQwL5Pl5UJZvMg` ([open](https://script.google.com/u/0/home/projects/1RgsXWnAfZfpU5M58SE19ZFf7cuh0HtC5eUMZ86IxQ2jQwL5Pl5UJZvMg/edit))
- **Stax Auto Pay:** `1n_AkHhTB1ijUxLdfH8qCcYitHHBD30gCz2FKB1-q33wkJrXLiCpVqmt4` ([open](https://script.google.com/u/0/home/projects/1n_AkHhTB1ijUxLdfH8qCcYitHHBD30gCz2FKB1-q33wkJrXLiCpVqmt4/edit))

Client inventory scripts are NOT edited via direct URLs — use `npm run rollout`. Each client has its own bound copy. See `admin/clients.json` for client script IDs and Web App URLs.

**GCP:** StrideAPI.gs is linked to project `1011527166052` (Stride GS Inventory System) — eliminates Drive burst throttling. If the link ever gets broken, re-link via Apps Script editor → Project Settings → GCP Project → Change.

---

## Current Phase & Open Work

**Phase 6 Auth:** COMPLETE ✅ (email + password only, 3-tier role-based access, RoleGuard route protection)
**Phase 7A/7B/7C:** COMPLETE ✅ (all read endpoints, all 32+11 write endpoints, Claims end-to-end)
**Phase 8 (Additional Features):** mostly complete — see `Docs/Stride_GS_App_Build_Status.md` for the full matrix

### Active open items

- [ ] **Standalone Repair Detail Page (Phase 2)** — `#/repairs/:repairId` — same pattern as Task Detail, pending.
- [ ] **Standalone Will Call Detail Page (Phase 3)** — `#/will-calls/:wcNumber` — same pattern, requires WC items parity audit.
- [ ] **Generate Work Order button** — Manual PDF generation from TaskDetailPanel. Backend handler exists, needs React wiring + router case.
- [ ] **Scanner Supabase Direct Lookup** — Replace CacheService index with direct Supabase query (~50ms vs 3-30s). See `Docs/Archive/QR_Scanner_Next_Phase.md` Feature A
- [ ] **Auto-Print Labels from Receiving** — Toggle on Receiving page for inline label printing. See `Docs/Archive/QR_Scanner_Next_Phase.md` Feature B
- [ ] **Parent Transfer Access** — Allow parent users to transfer items between their own children only (currently staff-only)
- [ ] **Global search expansion** — Add shipments, billing, claims entities + missing fields per audit
- [ ] **Autocomplete DB in React** — Sidemark/Vendor/Description per client
- [ ] **Invoice-level `invoiceDate` field** — Billing invoice summary currently falls back to earliest child date. Add a true `invoiceDate` to `InvoiceGroup` (sourced from Consolidated_Ledger "Invoice Date" column) so re-sorted children don't shift the displayed date.
- [ ] **Invoice number link in summary row** — Wire `invoiceUrl` through `InvoiceGroup` so the Invoice # cell renders as an anchor when a PDF URL exists (currently always renders as bold text).

### Known bugs (unresolved)

- `populateUnbilledReport_()` in CB `Code.gs.js` uses OLD header names ("Billing Status", "Service Date")
- `CB13_addBillingStatusValidation()` looks for "Billing Status" instead of "Status"
- Transfer Items dialog needs processing animation + disable buttons after complete
- Multi-row selection only picks last row for Will Call creation and other functions
- Repair discount behavior — should disable discounts on repairs
- Autocomplete dropdowns in React: Room + Sidemark data mixed together
- Receiving page uses hardcoded table (no TanStack Table / no column reorder)
- **GitHub Pages CDN caching gotcha:** hard-refresh (Ctrl+Shift+R) after `git push` to verify deployed bundle hash

---

## Document Maintenance Policy

### Hot docs (update every session)
- **`CLAUDE.md`** (this file): architecture, rules, invariants, current open items, known bugs
- **`Docs/Stride_GS_App_Build_Status.md`**: current session changes (REPLACE each session — do not accumulate), feature matrix, what's next

### Cold docs (update rarely, only when scope shifts)
- **`Docs/Archive/Session_History.md`**: add one-line entry per session
- **`Docs/Archive/Architectural_Decisions_Log.md`**: add new numbered decision when one is made; trim nothing
- Other archive files: update when the feature/phase they describe gets a major change

### Trimming rules
- Session entries in CLAUDE.md "Current Phase & Open Work" → only open items, never `[x] done`
- Completed phase plans → move the full plan to `Docs/Archive/`, leave a one-liner in CLAUDE.md
- Known bugs: remove once fixed and deployed
- Never expand session history into full changelogs — keep it one line per session, max ~200 chars
