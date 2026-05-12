# GAS Function Inventory

> Last updated: 2026-05-11 (initial inventory pass — every function across all 8 Apps Script projects).
> Companion to `MIGRATION_STATUS.md`. **MIGRATION_STATUS.md** is authoritative for project state; this file is the canonical "what does each function actually do?" reference.

---

## What this doc is for

A single place every builder (and Justin, in plain English) can look up:
- **What does function X do?** — one or two sentences in operator terms.
- **What does it affect?** — which sheets, tables, external systems, entities it touches.
- **What migration phase is it in?** — `done`, `P2`–`P7`, `internal-helper`, `retiring`, `out-of-scope`.
- **Where does it live?** — exact file path so you can jump to source.

Used by builders to scope migration PRs (find every callsite of a handler being rewritten) and by Justin to understand what each function does without reading code.

## How to read this doc

1. **Master index** below shows totals + migration-target counts per project.
2. **Per-project sections** group functions by file, then by category within the file.
3. **Migration column values:**
   - `done` — already SB-primary, no GAS code path remains.
   - `P2`–`P7` — migration target, scheduled for that phase per `MIGRATION_STATUS.md`.
   - `internal-helper` — small utility that will be rewritten as part of a parent handler migration; not standalone.
   - `retiring` — legacy code being phased out (e.g., the old racy `getNextInvoiceId` counter superseded by `next_invoice_no()` Postgres SEQUENCE).
   - `out-of-scope` — not currently planned for migration (e.g., warehouse-only operator UIs that don't touch the migration's three-storage-layer billing model).
4. **Find by name:** `Ctrl+F` for the function name. Every function appears in its primary location.
5. **Find by capability:** scan the category headers within a file. Categories are alphabetical within each file.

## How to keep this doc current

- When you add a new function in a GAS file: add a row to the matching category in this doc as part of the same PR.
- When you migrate a function (it ships SB-primary): change the `Migration` column from `Pn` to `done` and add a one-line note to `MIGRATION_STATUS.md`.
- When you retire a function: change to `retiring` and add a sunset note (which PR / when).
- When you rename or delete a function: update or remove its row.

The function inventory is part of the standard end-of-session doc updates per `CLAUDE.md`.

---

## Master Index

Function counts (verified against per-agent extraction; the migration-phase rollup is approximate, based on table-cell occurrences across the full doc — read the per-project sections for exact phase tagging):

| Project | Files | Functions | Status |
|---|---|---|---|
| StrideAPI | 1 | 558 | Active — primary migration target |
| Consolidated Billing | 10 | 158 | Active — P4a/P4b targets |
| Master Price List | 1 | 18 | Active (limited use). Email-template functions are dead code (templates moved to Supabase). Counter routes (`getNextShipmentId`, `getNextInvoiceId`) both retired — StrideAPI now uses Postgres SEQUENCEs (`next_invoice_no()` v38.182.0, `next_shipment_no()` v38.206.0). Per-tenant client scripts' `nextGlobalShipmentNumber_` still hits the racy Master counter for direct-sheet receiving — P7 cleanup. |
| Client Inventory (per-tenant, deployed × 49) | 13 | 240 | Active — P7 freeze target |
| Stax Auto Pay | 1 | 76 | Active — P6 target |
| QR Scanner | 2 | 35 | Active — out-of-scope (operator UI) |
| Task Board | 1 | 56 | **DECOMMISSIONED** — replaced by React app's task views. Code remains as historical reference + frozen copy of the SH_* shared-handler block |
| Stride Designer Campaign | 1 | 57 | Active — migrate last per project owner |
| **TOTAL** | **30** | **1,198** | 7 active projects + 1 decommissioned |

### Approximate migration-phase rollup across all projects

| Tag | Approx. count | Meaning |
|---|---|---|
| `done` | 43 | Already SB-primary |
| `P2` | 12 | Simple writes (P2) |
| `P3` | 35 | Status changes (P3) |
| `P4a` | 56 | Billing core (P4a) |
| `P4b` | 18 | CB retirement + QBO direct (P4b) |
| `P5` | 77 | Complex flows (P5) |
| `P6` | 71 | Payments + marketing (P6) |
| `P7` | 78 | Decommission (P7) |
| `internal-helper` | 572 | Helpers rewritten as part of parent migrations |
| `retiring` | 175 | Legacy code being phased out |
| `out-of-scope` | 47 | Not migrating (operator UIs, ancillary) |

_Counts are approximate — they're derived by greping for each tag in a table cell, so functions with multiple tags (e.g., `P4b (helper)`) may be double-counted. Per-project sections below have exact tags._

### Excluded from the inventory

- **`AppScripts/stride-client-inventory/admin/*.mjs`** — Node.js deployment tooling that pushes GAS code to Apps Script projects. Not "in use in the app" itself; it's the build/rollout pipeline. Won't migrate (stays as build tooling).
- **HTML files** (`.html`, `.html.txt`) in QR Scanner — frontend templates, not GAS functions. Tracked separately if they need updates during migration.

---

## Project: StrideAPI

> Source: `AppScripts/stride-api/StrideAPI.gs` (~43,000 lines, single file)
> Deployment: Web App at `script.google.com/macros/s/<id>/exec` (currently version 495).
> Migration role: **primary migration target**. Most P2–P5 work happens here.
> Function count: **558** (Part 1 lines 1-21000: 247; Part 2 lines 21001-end: 311). Increment of +2 in Part 1 covers `api_nextShipmentNo_` + `api_nextShipmentNoSupabase_` added by v38.206.0; the initial inventory pass missed them because they lived in Part 1's shipments category but the agent collated them under inventory + writethrough cross-references.

### Part 1 — lines 1-21000

#### Category: admin

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `installCoverageColumns` (line 13550) | One-shot setup helper that adds "Declared Value" and "Coverage Option" columns to every active client's Inventory sheet so insurance/coverage values can be tracked per item. Idempotent — skips clients that already have the columns. Run manually from the Apps Script editor. | CB Clients sheet (reads), every active client's Inventory sheet (appends columns) | retiring |
| `backfillStaxScheduledDates` (line 13626) | One-shot admin helper that copies the Due Date into any blank Scheduled Date cell on the Stax Invoices sheet (for invoices in PENDING/CREATED/SENT/CHARGE_FAILED status). Recovers dates Justin reported as cleared on 2026-05-04. | Stax spreadsheet "Invoices" tab | retiring |
| `bulkResyncStaxCatalog` (line 4740) | One-shot admin helper that pushes every service in the Supabase service catalog (price, taxable flag, etc.) up to Stax via their API. Used to apply bulk SQL changes (e.g., flip taxable=false on every row) to the Stax-side catalog. | Reads Supabase `service_catalog`, writes to Stax API (`/item/<id>`) | retiring |
| `seedAllStaxToSupabase` (line 4830) | One-shot admin helper that reads every tab of the Stax spreadsheet (Invoices, Charge Log, Exceptions, Customers, Run Log) and copies all rows into the matching Supabase mirror tables so the React Payments app starts with fresh data. | Reads Stax spreadsheet, writes to Supabase tables: `stax_invoices`, `stax_charges`, `stax_exceptions`, `stax_customers`, `stax_run_log` | retiring |
| `seedCbUsersToSupabase` (line 5454) | One-shot admin helper that copies every user from the CB Users sheet into the Supabase `cb_users` mirror table. Run once to populate an empty cache. | Reads CB Users sheet, writes to Supabase `cb_users` | retiring |
| `seedClaimsToSupabase` (line 5433) | One-shot admin helper that copies every claim from the CB Claims sheet into the Supabase `claims` mirror table. Run once to populate an empty cache. | Reads CB Claims sheet, writes to Supabase `claims` | retiring |
| `seedMarketingContactsToSupabase` (line 5568) | One-shot admin helper that copies every marketing contact from the Campaign sheet into the Supabase `marketing_contacts` mirror table. | Reads Campaign sheet, writes to Supabase `marketing_contacts` | retiring |
| `seedMarketingCampaignsToSupabase` (line 5664) | One-shot admin helper that copies every marketing campaign row from the Campaign sheet into the Supabase `marketing_campaigns` mirror table. | Reads Campaign sheet, writes to Supabase `marketing_campaigns` | retiring |
| `seedMarketingTemplatesToSupabase` (line 5721) | One-shot admin helper that copies every marketing email template from the Campaign sheet into the Supabase `marketing_templates` mirror table. | Reads Campaign sheet, writes to Supabase `marketing_templates` | retiring |
| `seedMarketingSettingsToSupabase` (line 5769) | Convenience wrapper that calls the marketing-settings resync helper to publish the single Settings row to Supabase. | Reads Campaign sheet Settings tab, writes to Supabase `marketing_settings` | retiring |
| `backfillActivityAllClientsNow` (line 3693) | Admin helper that runs the entity_audit_log backfill (synthesizes historical "create/start/complete/cancel" events from sheet timestamps) for every active client. Resumable — already-backfilled tenants skip on re-run. | Reads CB Clients sheet, then every active client's Tasks/Repairs/Will_Calls/Inventory/Shipments tabs; writes to Supabase `entity_audit_log` | retiring |
| `retryFailedSyncsNow` (line 2886) | Manual-fire wrapper around `retryFailedSyncs_` so an admin can flush the Supabase-sync failure queue on demand without waiting for the 10-minute cron. | Reads/PATCHes Supabase `gs_sync_events` rows | trigger |
| `reconcileClientNow` (line 3162) | Manual admin helper — runs a full Supabase resync for one specific client by passing in the spreadsheet ID. | Reads one client's per-tenant sheet, writes to Supabase per-entity tables | retiring |
| `reconcileAllClientsNow` (line 3176) | Manual admin helper — loops through every active client and runs a full Supabase resync. Slow (1-3 min for 50 clients). | Reads CB Clients sheet, then every active client's sheets; writes to all Supabase mirror tables | retiring |

#### Category: auth

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `lookupUser_(email)` (line 8383) | Looks up a user in the CB Users sheet by email (case-insensitive, whitespace-tolerant). Returns the user record (role, client, active flag, last login) plus sheet/row info so callers can update fields. Doesn't check active status — caller must do that. | Reads CB Users sheet | internal-helper |
| `withActiveUserGuard_(callerEmail, handler)` (line 8444) | Permission wrapper — requires the caller to exist in the Users sheet and be marked Active before running the handler. Used for endpoints anyone authenticated can hit. | Reads CB Users sheet via `lookupUser_` | internal-helper |
| `withStaffGuard_(callerEmail, handler)` (line 8456) | Permission wrapper — requires the caller to be an active admin or staff user. Used for warehouse-only actions like creating invoices or releasing items. | Reads CB Users sheet | internal-helper |
| `withClaimsReadGuard_(callerEmail, handler)` (line 8472) | Permission wrapper for claims reads — admins see all claims, clients see only their own, staff are blocked. Passes role + client name into the handler so it can filter. | Reads CB Users sheet | internal-helper |
| `withAdminGuard_(callerEmail, handler)` (line 8488) | Permission wrapper — requires the caller to be an active admin. Used for sensitive endpoints like Stax payments, marketing campaigns, QBO integration. | Reads CB Users sheet | internal-helper |
| `getAccessibleClientScope_(user)` (line 8537) | For a client-role user, figures out the full list of client accounts they can access — their own listed clients plus any "child" clients whose Parent Client column matches their name. Used for parent-company / multi-account login. Cached 60s. | Reads CB Clients sheet | internal-helper |
| `withClientIsolation_(callerEmail, requestedClientSheetId, handler)` (line 8646) | Permission wrapper that ensures a client user can only see their own data — forces the clientSheetId to the caller's allowed scope. Staff/admin pass through any clientSheetId. Sets the `_parentScope_` global so downstream code can filter cross-client queries. | Reads CB Users + CB Clients sheets | internal-helper |
| `handleGetUserByEmail_(params)` (line 8694) | The login lookup endpoint — given an email, returns the user's role, client info, and accessible-client scope. Stamps "Last Login" if active. Rate-limited at 10/minute. This is also how the React app figures out parent-vs-child client relationships at sign-in time. | Reads + writes CB Users sheet (last-login stamp) | P7 |
| `handleResyncClients_(params, callerEmail)` (line 8776) | Admin reconciliation tool — pushes every CB Clients row to the Supabase `clients` mirror and deletes any orphan Supabase rows. Returns a diff summary. Has a dry-run mode. | Reads CB Clients, writes to Supabase `clients`, deletes orphans | retiring |
| `handleAdminSetUserPassword_(data, callerEmail)` (line 8905) | Admin escape hatch — directly sets a user's Supabase Auth password. Creates the auth user if they don't exist yet (CB row exists but auth row doesn't). Used when a client can't complete the normal "forgot password" flow. | Calls Supabase Auth admin API | done |
| `handleEnsureAuthUser_(data, callerEmail)` (line 9010) | Admin helper — makes sure a given email has a row in Supabase Auth (creates one with a random password if missing). Idempotent. Used by the React Users page warning system. | Calls Supabase Auth admin API | done |
| `handleListMissingAuthUsers_(data, callerEmail)` (line 9046) | Admin helper — compares the CB Users sheet against Supabase Auth and reports any emails that exist on the sheet but have no auth.users row. Used by the Settings → Users page to surface fixable problems. | Reads CB Users sheet, reads Supabase Auth admin API | done |
| `handleResyncUsers_(params, callerEmail)` (line 9140) | Admin reconciliation tool — syncs three places user data lives (CB Users sheet, Supabase cb_users mirror, Supabase auth.users). Upserts everything from CB to Supabase, optionally prunes auth.users orphans. Has dry-run mode. | Reads CB Users, writes Supabase `cb_users` + optionally `auth.users` | retiring |
| `handleGetUsers_(callerEmail)` (line 9320) | Returns the full list of users (admin/staff only) for the Settings → Users page. | Reads CB Users sheet | P7 |
| `handleCreateUser_(params, callerEmail)` (line 9370) | Creates a new user — appends a row to CB Users, creates a Supabase Auth account with a randomly-generated passphrase (returned to the admin so they can communicate it), and sends a welcome email to client-role users with their credentials. New users default to inactive (admin must explicitly activate). | Writes CB Users sheet, creates Supabase Auth user, sends Resend email, writes Supabase `cb_users` mirror | P7 |
| `handleUpdateUser_(params, callerEmail)` (line 9485) | Updates an existing user (active flag, role, client access list, email change). Validates that client-role users have at least one client. On first activation (false→true) sends the welcome email once. Multi-client clients can have a comma-separated list of access IDs. | Writes CB Users sheet, sends welcome Resend email on first activation, writes Supabase `cb_users` mirror | P7 |
| `handleDeleteUser_(params, callerEmail)` (line 9677) | Admin-only delete — removes a user row from CB Users and the Supabase mirror. Does NOT delete the Supabase Auth account (admin must do that separately). | Writes CB Users sheet, deletes from Supabase `cb_users` | P7 |
| `api_generateTempPassword_()` (line 2095) | Generates a memorable passphrase like "bright-river-42" (adjective-noun-number) for new account passwords. Easy for users to type and read. | Pure function — no I/O | internal-helper |
| `createSupabaseAuthUser_(email, password)` (line 2128) | Creates a Supabase Auth account for a user via the admin API. Idempotent — if the user already exists, treats it as success. Returns the temp password so the caller can email it to the user. | Calls Supabase Auth admin API | internal-helper |
| `setupSupabaseProperties_()` (line 2191) | Disabled stub — used to allow setting Supabase credentials inline; now throws an error directing the user to set them via the Apps Script Project Settings UI to avoid secrets-in-code. Defense against a past incident where a service-role key was committed. | None (throws) | internal-helper |
| `prop_(key)` (line 2060) | Reads a script property by key, returning a trimmed string. Used everywhere to fetch config like SUPABASE_URL, API_TOKEN, CB_SPREADSHEET_ID. | Reads Apps Script Properties | internal-helper |
| `rateLimit_(key, maxPerMinute)` (line 2069) | Simple per-key rate limiter using CacheService (60-second window). Throws if the call rate is exceeded. Caller catches and returns an error response. | Reads/writes CacheService | internal-helper |
| `jsonResponse_(obj)` (line 2079) | Wraps a JavaScript object in a ContentService JSON response, the format the React app expects from every API call. | Pure function | internal-helper |
| `errorResponse_(message, code)` (line 2085) | Builds a standard error response (`{error, code}`) wrapped in JSON. | Pure function | internal-helper |

#### Category: billing

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `handleGetBilling_(clientSheetId, filters)` (line 12133) | Returns the full Billing report (Unbilled/Invoiced/Billed/Void rows) for one or all clients with optional server-side filters (status, service code, sidemark, date, client). Enriches each row with Stax customer ID, auto-charge flag, and QBO push status from CB tabs. Used for the React Billing tab. | Reads CB Clients sheet, CB Consolidated_Ledger sheet, each client's Billing_Ledger + Inventory sheets | P4a |
| `handleUpdateBillingRow_(clientSheetId, payload)` (line 12317) | Inline edit of a single Unbilled billing row from the React Billing page — updates sidemark/reference/description/notes/rate/qty/total. Refuses to edit non-Unbilled rows. Auto-appends missing columns. For non-manual rows, propagates Sidemark/Reference/Description back to Inventory so other entities (Tasks, Repairs) stay in sync. | Writes one client's Billing_Ledger row, possibly writes back to client's Inventory sheet | P4a |
| `api_propagateItemFieldsToInventory_(clientSheetId, itemId, fields, sourceTag)` (line 12504) | When billing-row edits change item-level fields (sidemark/reference/description), this writes them back to the Inventory sheet so every downstream entity (Tasks, Repairs, Will Calls) sees the same value. Best-effort — never throws out of the originating write. | Calls `handleUpdateInventoryItem_` which fans out to Tasks, Repairs, Supabase mirrors | internal-helper |
| `api_lookupSidemarkForItemId_(ss, itemId)` (line 12537) | Scans the Inventory sheet for a given Item ID and returns its Sidemark value. Used by Supabase write-through to populate `billing.sidemark` even though most Billing_Ledger sheets don't have a Sidemark column. | Reads client Inventory sheet | internal-helper |
| `api_fetchBillingReferencesByLedgerIds_(ledgerRowIds)` (line 12568) | Bulk-fetches the Reference field from Supabase `billing` for a list of ledger row IDs (chunked by 100). Used by the IIF/QBO export to add "[Ref: xxx]" suffixes to invoice line item memos. | Reads Supabase `billing` table | internal-helper |
| `api_lookupReferenceForItemId_(ss, itemId)` (line 12608) | Mirror of `api_lookupSidemarkForItemId_` — scans Inventory for a given Item ID's Reference (PO/client identifier) value. | Reads client Inventory sheet | internal-helper |
| `api_newManualLedgerId_()` (line 12637) | Generates a unique "MANUAL-<timestamp>-<random>" Ledger Row ID for manually-added billing charges so they can be identified and handled differently from system-generated rows. | Pure function | internal-helper |
| `handleAddManualCharge_(clientSheetId, payload, callerEmail)` (line 12648) | Staff/admin adds a one-off billing line (e.g. "Restocking fee $25") to a client's Billing_Ledger. Server computes Total from rate×qty so the client can't fake it. Always Status=Unbilled. Writes to Supabase mirror immediately. | Writes client Billing_Ledger, writes Supabase `billing` | P4a |
| `handleVoidManualCharge_(clientSheetId, payload)` (line 12778) | Soft-voids a manual charge — flips Status from "Unbilled" to "Void". Hard requirement: only "MANUAL-" prefixed rows accepted (never voids a system-generated billing row by accident). | Writes one client Billing_Ledger row | P4a |
| `handleVoidInvoice_(clientSheetId, payload)` (line 12828) | Voids every billing row tied to a specific invoice number — flips Status to Void, appends "Voided: <reason>" to Item Notes, also wipes matching rows from CB Consolidated_Ledger so QBO/IIF exports don't re-push them, and drops the invoice_tracking row so the React Review tab clears it. | Writes client Billing_Ledger, deletes CB Consolidated_Ledger rows, deletes Supabase `invoice_tracking` row | P4a |
| `handleReissueInvoice_(clientSheetId, payload, callerEmail)` (line 12959) | One-click invoice re-issue across all three storage layers — releases the client Billing_Ledger rows back to Unbilled (clears Invoice #/Date/URL), deletes matching CB Consolidated_Ledger rows, queues Supabase resync. Operator follows up with Create Invoices to re-bill. Pre-condition: operator must void in Stax/QBO first. | Writes client Billing_Ledger, deletes CB Consolidated_Ledger rows, deletes Supabase `invoice_tracking`, calls `api_fullClientSync_`, writes audit log | P4a |
| `handleVoidUnbilledRows_(clientSheetId, payload)` (line 13113) | Bulk-void Unbilled billing rows by Ledger Row ID. Lets operators undo a mistakenly-committed charge (RCVG, WC, task addon) without first invoicing it. Refuses to touch Invoiced/Billed rows. | Writes client Billing_Ledger | P4a |
| `api_logBillingActivity_(entry)` (line 3429) | Writes one row to `public.billing_activity_log` so the React Billing Activity tab shows a persistent feed of invoice creates, QBO pushes, email sends, charge attempts, exceptions. Best-effort; never blocks. | Writes Supabase `billing_activity_log` | internal-helper |
| `handleMarkBillingActivityResolved_(payload, callerEmail)` (line 3475) | Operators mark a billing-activity failure row as "resolved" after manually fixing it — stamps resolved_at/by/note. | Writes Supabase `billing_activity_log` (PATCH) | done |

#### Category: dispatchtrack

(none in lines 1-21000 — DispatchTrack helpers are in part 2)

#### Category: drive

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `api_buildEntityPhotosUrl_(entityType, entityId, clientSheetId)` (line 13732) | Builds an `mystridehub.com/#/inventory?open=ID&tab=photos&client=...` deep link that opens the entity's detail panel with the Photos tab pre-selected. Used in email/doc templates as a replacement for the legacy Drive folder URL since photos now live in Supabase Storage. | Pure function (URL construction) | internal-helper |
| `api_findPdfInFolder_(folderUrl, prefix)` (line 17026) | Walks a Drive folder by URL looking for the first PDF whose filename starts with a given prefix (e.g. "Work_Order_"). Returns the file blob or null. Used to attach existing PDFs to follow-up emails. | Reads Drive | internal-helper |
| `api_uploadGeneratedPdfToSupabase_(blob, tenantId, contextType, contextId, fileName, generatedByEmail)` (line 17053) | Uploads a generated PDF blob to Supabase Storage and inserts a metadata row into `public.documents` so it appears in the entity's Docs tab. Path: `{tenant}/{contextType}-{contextId}/{ts}-{rand}-{filename}.pdf`. Replaces the old "save PDF to Drive folder" pattern. | Uploads to Supabase Storage `documents` bucket, writes Supabase `documents` table | internal-helper |
| `api_generateDocPdf_(ss, docTemplateKey, pdfFileName, folderUrl, tokens, entityCtx)` (line 17150) | Generates a PDF from a named doc template (DOC_INVOICE, DOC_RECEIVING, DOC_REPAIR_WORK_ORDER, etc.) — substitutes tokens, creates a temp Google Doc, exports as PDF, uploads to Supabase Storage (or legacy Drive folder if no entity context). Returns the blob for email attachment. | Creates + trashes temp Google Doc, uploads to Supabase Storage, writes Supabase `documents` | internal-helper |
| `api_createGoogleDocFromHtml_(title, html)` (line 27642) | Helper that creates a Google Doc from an HTML string. Wait — defined after line 21000; referenced here for completeness. | Drive | internal-helper |
| `api_exportDocAsPdfBlob_(docId, fileName, marginInches)` (line 27669) | Helper that exports a Google Doc as a PDF blob with custom margins. Defined after line 21000. | Drive | internal-helper |

#### Category: email

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `api_getTemplateFromSupabase_(templateKey)` (line 16484) | Fetches one email template by key from Supabase `email_templates`. Cached for 10 min; negative results cached too so missing templates don't hammer Supabase. | Reads Supabase `email_templates` | internal-helper |
| `api_listTemplatesFromSupabase_()` (line 16523) | Lists every email template from Supabase in the React-shaped form (key/subject/bodyHtml/notes/recipients/attachDoc/category/active). | Reads Supabase `email_templates` | internal-helper |
| `api_upsertTemplateToSupabase_(row)` (line 16547) | Inserts or updates one template in Supabase `email_templates`. Invalidates the cached row on success. | Writes Supabase `email_templates` | internal-helper |
| `api_seedEmailTemplatesFromMpl_()` (line 16581) | Reads every row of the Master Price List "Email_Templates" tab and upserts to Supabase. Derives a category (email/document/system/claim) from the key. Also seeds DOC_INVOICE from its Drive template. | Reads MPL, writes Supabase `email_templates`, reads Drive Doc | internal-helper |
| `api_seedInvoiceTemplateFromDrive_()` (line 16639) | Exports the invoice template Google Doc (its ID stored in MPL Settings) as HTML and uploads it as the DOC_INVOICE row in Supabase. Skips if a non-empty row already exists. | Reads Drive Doc, writes Supabase `email_templates` | internal-helper |
| `handleSeedEmailTemplatesToSupabase_()` (line 16685) | Admin endpoint — force a re-seed of all email templates from MPL to Supabase. Used once after deploy and any time MPL is updated outside the app. | Reads MPL, writes Supabase `email_templates` | done |
| `api_sendTemplateEmail_(settings, templateKey, toEmail, fallbackSubject, tokens, pdfBlob, clientSheetId)` (line 16708) | The universal send-an-email helper. Looks up the template in Supabase (falls back to MPL sheet), substitutes tokens, auto-injects deep-link tokens with `&client=` query params, strips any hardcoded duplicate CTA buttons, injects the single canonical "Open in Stride Hub" CTA, and sends via GmailApp. Used by every notification email. | Reads template from Supabase + MPL, sends Gmail | internal-helper |
| `api_buildItemsHtmlTable_(items)` (line 16915) | Builds the canonical 6-column items HTML table (Item ID, Qty, Vendor, Description, Sidemark, Reference) used in every email that emits `{{ITEMS_TABLE}}` — receiving, transfer, will-call. | Pure HTML builder | internal-helper |
| `api_buildItemIdToReferenceMap_(ss)` (line 16959) | Batch-reads the Inventory sheet once and returns a `{itemId: reference}` map. Used by WC email handlers to enrich items table rows that don't carry Reference natively. | Reads client Inventory sheet | internal-helper |
| `api_buildSingleItemTableHtml_(itemId, description, vendor, itemClass, location, sidemark, qty, reference)` (line 16988) | Builds a single-item HTML table for task/repair completion emails. 6 columns matching the multi-item table. | Pure HTML builder | internal-helper |
| `api_buildWcItemsTable_(wcItems)` (line 17007) | Builds an HTML table specifically for will-call emails — columns include WC Fee for cost transparency. | Pure HTML builder | internal-helper |
| `api_buildInvoiceLineItemsHtml_(rows)` (line 17196) | Builds the HTML `<tr>` rows for the invoice line items table — right-aligns numeric columns (Qty, Rate, Total). Used in the new Supabase-HTML invoice PDF path. | Pure HTML builder | internal-helper |
| `api_mergeEmails_(a, b)` (line 17213) | Merges two comma-separated email lists, lowercases, deduplicates. Used to combine NOTIFICATION_EMAILS + CLIENT_EMAIL into one recipient list. | Pure function | internal-helper |
| `api_fetchPublicEntityNotes_(entityType, entityId)` (line 14866) | Pulls the 5 most recent public notes (visibility=public) from Supabase `entity_notes` for an entity (task/repair/shipment/etc.) and returns them as plain text with author attribution. | Reads Supabase `entity_notes` | internal-helper |
| `api_resolveNotesForEmail_(entityType, entityId, sheetNotes)` (line 14899) | Merges sheet-stored notes with Supabase entity_notes (Supabase notes win when both exist) so emails surface BOTH sources. Used at every email/doc token replacement site. | Reads Supabase `entity_notes` via `api_fetchPublicEntityNotes_` | internal-helper |
| `api_notesPlainToHtml_(plain)` (line 14918) | Converts the plain-text output of `api_resolveNotesForEmail_` into HTML-safe text with `<br>` separators so multi-note output renders on separate lines in email/PDF. | Pure function | internal-helper |
| `handleNotifyNewDeliveryOrder_(payload)` (line 31063) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleSendRawEmail_(payload)` (line 31161) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleSendOnboardingEmail_(clientSheetId, payload)` (line 31188) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleSendWelcomeEmail_(payload)` (line 31299) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `api_sendWelcomeOnce_(cbSS, userEmail, role, firstClientSheetId, tempPassword)` (line 31432) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleSendWelcomeToUsers_(payload, callerEmail)` (line 31542) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleTestGenerateDoc_(payload)` (line 31655) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleTestSendClientTemplates_(callerEmail, payload)` (line 31776) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleTestSendClaimEmails_(callerEmail, payload)` (line 31856) | Defined after line 21000 — listed in part 2. | n/a | n/a |

#### Category: entry-point

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `doGet(e)` (line 6877) | The HTTPS GET entry point. Routes every read-only request from the React app (or QBO OAuth callback) to its matching handler. Validates the API_TOKEN before doing anything (except health checks and the QBO callback). Routes about 35 actions: getUserByEmail, getUsers, getClients, getInventory, getTasks, getRepairs, getWillCalls, getShipments, getBilling, getClaims, getStaxInvoices, getMarketingDashboard, qboGetStatus, etc. Wraps each call in permission guards (withStaffGuard_, withAdminGuard_, withClientIsolation_). | Routes to ~35 handlers; reads CB Users + per-tenant sheets via the handlers | done |
| `doPost(e)` (line 7045) | The HTTPS POST entry point. Same shape as doGet but for write actions. Routes ~80+ actions: completeShipment, completeTask, completeRepair, startTask, createWillCall, processWcRelease, releaseItems, transferItems, createInvoice, voidInvoice, qbExport, generateStorageCharges, importIIF, etc. After each successful write fires `api_notifySupabase_` (gs_sync_events confirmation), `api_writeThrough_` (per-entity Supabase mirror), `api_auditLog_` (entity_audit_log), and in many cases `api_fullClientSync_` to bulk-resync. Captures the input payload to `gas_call_log` via `api_logCallInput_` for the migration replay corpus. | Routes to ~80+ handlers; writes everything | done |
| `handleHealthCheck_()` (line 32085) | Defined after line 21000 — listed in part 2. | n/a | n/a |

#### Category: helper-format

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `sheetToObjects_(sheet)` (line 13393) | Reads every row of a sheet (skipping the header) into an array of `{ColumnName: value}` objects. Drops completely blank rows. The core "convert sheet to JSON" helper used throughout the file. | Reads any sheet | internal-helper |
| `toBool_(val)` (line 13421) | Coerces sheet cell values ("TRUE", true, "Yes", "FALSE", false, "", null) into JavaScript booleans. Handles all the ways Google Sheets stores boolean-like values. | Pure function | internal-helper |
| `toNum_(val)` (line 13427) | Coerces a sheet cell value into a number, returning null for blank/non-numeric values. Used everywhere a numeric field might be empty. | Pure function | internal-helper |
| `formatDate_(val)` (line 13433) | Formats a Date (or date-like string) as "yyyy-MM-dd" in the script's local timezone. Strips any "HH:MM:SS" suffix from a string value because `<input type="date">` requires a clean YYYY-MM-DD. | Pure function | internal-helper |
| `api_isoDate_(v)` (line 13469) | Coerces any plausible date input (Date object, US "MM/dd/yyyy", ISO "yyyy-MM-dd", "yyyy-MM-dd 00:00:00") to a clean ISO "yyyy-MM-dd" string. Used wherever a Stax-side date cell or the Supabase mirror is written. | Pure function | internal-helper |
| `formatDateTime_(val)` (line 13491) | Formats a Date as "yyyy-MM-dd HH:mm:ss" in script timezone — used for fields like Started At / Completed At that need wall-clock precision. | Pure function | internal-helper |
| `api_getHeaderMap_(sheet)` (line 13507) | Reads the first row of a sheet and returns a `{HeaderName: column-number}` map so other code can look up columns by name. Called once per sheet then cached on the stack. | Reads first row of any sheet | internal-helper |
| `api_ensureColumn_(sheet, headerName)` (line 13680) | Non-destructively makes sure a column header exists on a sheet — appends it to the end if missing. Case-insensitive match prevents duplicate columns from drift like "Auto Charge" vs "auto charge". Returns the 1-based column index. | Reads + appends column to any sheet | internal-helper |
| `api_buildRow_(headerMap, obj)` (line 14664) | Builds a 1D array of cell values aligned to a sheet's header positions, given a `{ColumnName: value}` object. Lets handlers write a row without hardcoding column order. | Pure function | internal-helper |
| `api_getLastDataRow_(sheet)` (line 14779) | Scans a sheet from the bottom up to find the last row with actual data, ignoring empty rows from data validations. Used to compute the next insert row. | Reads any sheet | internal-helper |
| `api_readSettings_(ss)` (line 14790) | Reads a client spreadsheet's "Settings" tab (which is a key-value layout: column A = key, column B = value) into a JS object. Used to fetch per-client config like CLIENT_NAME, FREE_STORAGE_DAYS, ENABLE_NOTIFICATIONS. | Reads client Settings sheet | internal-helper |
| `parseCSV_(str)` (line 25212) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `api_esc_(s)` (line 27755) | Defined after line 21000 — HTML-escape helper. | n/a | n/a |
| `api_qbFmtDate_(v)` (line 22705) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `api_qbCalcDueDate_(dateVal, terms)` (line 22728) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `api_qbEsc_(v)` (line 22738) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `api_money_(v)` (line 23459) | Defined after line 21000 — listed in part 2. | n/a | n/a |

#### Category: helper-misc

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `api_clientNameMap_()` (line 4431) | Builds a `{spreadsheetId: "Client Name"}` map from CB Clients. Cached 5 minutes. Used to enrich error messages with human-readable client names (e.g., ledger collision errors). | Reads CB Clients sheet | internal-helper |
| `getTargetClients_(clientSheetId)` (line 13262) | Resolves which clients to query — single ID → just that one; empty + admin/staff → all active clients (cached 10 min); empty + parent client → filtered to allowed scope. The core "scope resolver" for every multi-client read. | Reads CB Clients sheet | internal-helper |
| `api_projectRow_(srcRow, srcHeaders, destHeaders)` (line 19681) | Maps a row from one sheet's header layout to another's by name (case-insensitive). Destination columns missing on source get blank. Used by transferItems to copy rows between client sheets that may have different column orders. | Pure function | internal-helper |
| `api_findRowById_(sheet, colIndex, id)` (line 16036) | Scans a column for a matching ID and returns the 1-based row number, or -1 if not found. Used everywhere a handler needs to locate a specific Task/Repair/WC row. | Reads sheet column | internal-helper |
| `api_findInventoryItem_(ss, itemId)` (line 16053) | Looks up an inventory item by Item ID and returns its key fields (description, vendor, class, location, sidemark, qty, room, reference, declared value, etc.) plus the sheet/row references so the caller can write back to it. | Reads client Inventory sheet | internal-helper |
| `api_newBatchResult_()` (line 28391) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `api_batchSkip_(result, id, reason)` (line 28404) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `api_batchError_(result, id, reason)` (line 28408) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `api_getClientNameMap_()` (line 25217) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `getCampaignSpreadsheet_()` (line 37166) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `setupCampaignSheetId_()` (line 37176) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `getStaxSpreadsheet_()` (line 32976) | Defined after line 21000 — listed in part 2. | n/a | n/a |

#### Category: helper-sheet-io

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `cachedHandler_(cacheKey, handlerFn, skipCache)` (line 13750) | Wraps a handler in a CacheService cache (10-minute TTL). Auto-chunks responses larger than 90KB across multiple cache entries to stay under Google's 100KB-per-key limit. Used by every cached GET endpoint. | Reads/writes CacheService | internal-helper |
| `invalidateClientCache_(clientSheetId)` (line 13823) | Removes every cached response for a client (inventory/tasks/repairs/will-calls/shipments/billing/batch + their chunks). Called after every write so the next read returns fresh data. Also clears the all-clients aggregate batch key. | Writes CacheService | internal-helper |
| `api_readIdFolderUrls_(sheet, columnName)` (line 14499) | Reads a column's RichTextValue cells (where IDs are hyperlinked to their Drive folders) and returns an `{id: folderUrl}` map. Used to surface folder buttons on Task / Repair / WC detail panels. | Reads sheet cell rich-text | internal-helper |
| `api_buildInvShipmentByItemMap_(ss)` (line 14535) | Builds an `{itemId: shipmentNumber}` map from the Inventory sheet. Used as a fallback when Tasks/Repairs/WC rows don't have a Shipment # populated. | Reads client Inventory sheet | internal-helper |
| `api_buildInvFieldsByItemMap_(ss)` (line 14563) | Builds per-item field maps from the Inventory tab — every column (Sidemark, Vendor, Description, Location, Room, Reference, Class, Carrier, Tracking, etc.). Inventory is the single source of truth for item-level data — every other page uses these maps to OVERRIDE their own stale copies. | Reads client Inventory sheet | internal-helper |
| `api_buildShipmentFolderMap_(ss)` (line 14626) | Builds a `{shipmentNumber: folderUrl}` map from the Shipments sheet — reads both the plain-text "Shipment Photos URL" column AND the RichTextValue hyperlinks on the Shipment # cells (newer shipments use hyperlinks). | Reads client Shipments sheet | internal-helper |
| `api_writeBillingRowIdempotent_(billSheet, billMap, ledgerRowId, fields)` (line 14710) | Writes a Billing_Ledger row keyed on Ledger Row ID with idempotent semantics: if a Void row exists, un-voids it in place (refresh fields, flip Status → Unbilled, clear Invoice #/Date/URL); if Unbilled, updates in place; if Invoiced/Billed, skips with a warning; otherwise appends. Used by every completion handler (completeTask/completeRepair/processWcRelease) so reopen+re-complete cycles don't create duplicate rows. | Writes client Billing_Ledger | internal-helper |
| `api_supabaseGet_(path)` (line 14834) | Wraps a Supabase REST GET with auth headers and JSON parsing. Returns null on any error so the caller can fall back. Used by the dual-path price lookups and template fetches. | Reads Supabase REST | internal-helper |

#### Category: inventory

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `handleGetInventory_(clientSheetId)` (line 11250) | Returns the full inventory list (every Item ID, status, location, qty, vendor, etc.) for one or all clients. Reads per-row Drive folder URLs from the Shipment # cell hyperlinks so React can render "Open Folder" buttons on the detail panel. | Reads CB Clients + each client's Inventory + Shipments sheets | done |
| `handleGetShipments_(clientSheetId)` (line 12038) | Returns the full shipments list for one or all clients. Strips the `[IK:<uuid>]` idempotency-key prefix from notes. | Reads CB Clients + each client's Shipments sheet | done |
| `handleGetShipmentItems_(clientSheetId, params)` (line 12091) | Returns the items belonging to a specific shipment (by Shipment #) — used by the React Shipment detail panel. | Reads client Inventory sheet | done |
| `handleCompleteShipment_(clientSheetId, payload)` (line 15401) | The "receive a shipment" handler — assigns a new Shipment # via the atomic Postgres SEQUENCE (`next_shipment_no()`, v38.206.0), writes one row to Shipments tab, N rows to Inventory tab, optionally creates auto-INSP/ASM tasks per item, and (if receiving billing is enabled) writes RCVG billing rows + any add-on charges. Hyperlinks each new row's Shipment # cell to the shipment folder. Idempotency-protected via a key in shipment notes. Uses a 15-second lock to serialize multiple receivers. Sends SHIPMENT_RECEIVED email with a generated Receiving PDF. | Writes Shipments + Inventory + Tasks + Billing_Ledger sheets, generates PDF via `api_generateDocPdf_`, sends Resend email, calls Supabase `next_shipment_no()` for shipment # | P5 |
| `api_hyperlinkReceivedItems_(ss, settings, invSheet, taskSheet, invInsertStart, items, shipmentNo, shipFolderUrl, taskRowIdsWritten, warnings)` (line 15962) | Post-receive helper that hyperlinks each new Inventory row's Shipment # cell to the shipment folder, and hyperlinks each new Task ID to its per-task Drive folder. Runs unconditionally (not just on email-on) because folder buttons in the React detail panels depend on these hyperlinks. | Writes hyperlinks on Inventory + Tasks cells, creates Drive folders | internal-helper |
| `handleReleaseItems_(clientSheetId, payload, callerEmail)` (line 19542) | Staff/admin bulk-releases inventory items (sets Status="Released", Release Date, and appends a stamp to Item Notes). Uses a bulk setValues pattern (3 round-trips total instead of 3 per item) so a 50-item release completes in seconds instead of minutes. No billing rows created. | Writes client Inventory sheet | P3 |
| `handleTransferItems_(sourceClientSheetId, payload)` (line 20425) | Transfers items between two clients — copies Inventory rows (re-applying destination's discount), voids source Unbilled billing + creates destination billing rows (re-priced for the destination's discount), generates a storage-backfill on destination covering the holding period (so days held under the source aren't lost revenue), transfers open Tasks/Repairs, logs to Move History on both sides, sends TRANSFER_RECEIVED email. Validates the destination is an active client in CB. | Writes both source + destination Inventory/Billing_Ledger/Tasks/Repairs sheets, writes Move History sheet on both, sends Resend email | P5 |
| `handleUpdateInventoryItem_(clientSheetId, payload)` (line 29518) | Defined after line 21000 — listed in part 2. | n/a | n/a |

#### Category: invoicing

(Most invoicing handlers are after line 21000 — listed below as references for cross-walk. The pre-21000 invoicing surface is `handleVoidInvoice_` / `handleReissueInvoice_` / `handleVoidUnbilledRows_` listed under **billing** above.)

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `handleGenerateStorageCharges_(payload)` (line 21053) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleCommitStorageRows_(payload)` (line 21468) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handlePreviewStorageCharges_(payload)` (line 21657) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleQbExport_(payload)` (line 21937) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleCreateInvoice_(payload)` (line 24102) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleResendInvoiceEmail_(payload)` (line 25014) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `api_nextInvoiceNo_(rpcUrl, rpcToken)` (line 23391) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `api_nextInvoiceNoSupabase_()` (line 23417) | Defined after line 21000 — listed in part 2. | n/a | n/a |

#### Category: migration

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `__writeThroughReverseStub_(_ss, payload)` (line 2317) | Placeholder writer for the SB→Sheets reverse writethrough endpoint. Throws "not yet implemented" for every table — the per-table writers ship in their corresponding P2/P3/P4 PRs as each handler migrates. If a production caller hits this, something is misconfigured. | Throws | internal-helper |
| `api_isKnownTenantId_(tenantId)` (line 2356) | Validates that a spreadsheet ID is actually one of Stride's known client spreadsheets (looked up in `public.clients.spreadsheet_id`) before allowing the reverse-writethrough endpoint to open it. Fails closed on any error so a Supabase outage rejects writethroughs rather than accidentally opening an unrelated sheet. | Reads Supabase `clients` | internal-helper |
| `handleWriteThroughReverse_(payload, callerEmail)` (line 2402) | Reverse writethrough endpoint — called by SB-side Edge Functions after a `public.<table>` write commits, to keep the per-tenant Google Sheet current as a read-only mirror. Validates the payload, looks up the per-table writer in `REVERSE_WRITETHROUGH_TABLES_`, opens the sheet, dispatches to the writer. Failures land in gs_sync_events so the React FailedOperationsDrawer surfaces them. | Validates tenant (Supabase), opens per-tenant sheet, dispatches to writer, writes Supabase `gs_sync_events` on error | done |
| `api_notifySupabase_(response, context)` (line 2492) | After a write handler succeeds, parses its response and fires `notifySupabaseConfirmed_` if it was a real success (skips idempotency-skip responses). Falls back to common ID fields when the handler generates the ID inside (wcNumber, taskId, repairId). | Writes Supabase `gs_sync_events` (confirmation row) | internal-helper |
| `notifySupabaseConfirmed_(params)` (line 2203) | Inserts a "confirmed" row into Supabase `gs_sync_events` so the React FailedOperationsDrawer knows the write succeeded. Best-effort. | Writes Supabase `gs_sync_events` | internal-helper |
| `notifySupabaseFailed_(params)` (line 2242) | Inserts a "sync_failed" row into `gs_sync_events`. Used for GAS-internal failures React can't observe (e.g. trigger failures). Do NOT call from synchronous doPost handlers — would duplicate React's own failure rows. | Writes Supabase `gs_sync_events` | internal-helper |
| `api_logCallInput_(action, payload, tenantId, performedBy)` (line 3321) | [MIGRATION-P1.2] Captures every doPost call's redacted input payload to `public.gas_call_log` and sets a per-request UUID `__MIG_CORRELATION_ID__` that `api_auditLog_` stamps onto every entity_audit_log row produced during the same request. Gives the replay harness a (input, output) join for every GAS call. | Writes Supabase `gas_call_log` | done |
| `api_redactPayloadForCorpus_(payload)` (line 3363) | PII-conscious redaction for the `gas_call_log` corpus. v38.207.0 expanded whitelist covers all inventory/task/repair/shipment editable fields (vendor, description, reference, sidemark, room, location, itemClass, qty, status, itemNotes, declaredValue, coverageOptionId, notes, priority, scheduledDate, carrier, trackingNumber, …) plus billing-row fields (rate, total, amount, svcCode, …) plus will-call fields (pickupParty, pickupPhone, codAmount, …). Drops anything containing token/secret/key/password/card/ssn/cvv/pii/email/phone. Output capped at 1KB with a truncation marker. Pre-v38.207.0 corpus was partially blind (location/vendor/description/etc. got stripped) — the replay harness's `skip_partial_input` classification handles those. | Pure function | internal-helper |
| `api_auditLog_(entityType, entityId, tenantId, action, changes, performedBy)` (line 3257) | Writes one row to Supabase `entity_audit_log` after a mutation — entity_type, entity_id, tenant, action (create/update/complete/cancel/release/transfer/void/reopen/etc.), changes diff, performed_by, source="gas". Stamps the request's `correlation_id` so the migration replay harness can join inputs to outcomes. Best-effort. | Writes Supabase `entity_audit_log` | internal-helper |
| `api_auditLogBatch_(rows)` (line 3511) | Batch-insert variant — POSTs an array of audit rows in one request. Used by the audit-log backfill and by `batchCreateTasks` to emit one row per created task. | Writes Supabase `entity_audit_log` | internal-helper |
| `api_tenantBackfilled_(tenantId)` (line 3540) | Checks if a tenant has ever had a backfill:v1 audit row written, so re-running the backfill skips already-done tenants. | Reads Supabase `entity_audit_log` | internal-helper |
| `handleBackfillActivity_(clientSheetId, payload, callerEmail)` (line 3575) | Synthesizes historical entity_audit_log events from existing sheet timestamps for one tenant — Tasks (create/start/complete/cancel), Repairs (create/quote/start/complete), Will Calls (create/release), Inventory (receive/release/transfer), Shipments (create). Tagged source="backfill:v1". Idempotent. | Reads every entity sheet on the tenant, writes Supabase `entity_audit_log` | done |
| `api_logSyncFailure_(tenantId, entityType, entityId, actionType, errorMessage)` (line 3212) | Writes a "sync_failed" row to Supabase `gs_sync_events` so the React FailedOperationsDrawer shows it for manual retry. Used by the write-through helpers when a Supabase upsert fails. | Writes Supabase `gs_sync_events` | internal-helper |

#### Category: qbo

(QBO helpers are all after line 21000 — `qbo_*` functions starting at line 39125. Listed in part 2.)

#### Category: repairs

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `handleGetRepairs_(clientSheetId)` (line 11774) | Returns the full repairs list for one or all clients with per-row item field overrides from Inventory (vendor/description/location/sidemark/room/etc.) since Inventory is authoritative. Includes folder URLs from rich-text hyperlinks. | Reads CB Clients + each client's Repairs + Inventory + Tasks sheets | done |
| `handleGetRepairById_(clientSheetId, params)` (line 11677) | Returns one repair by Repair ID — for the React standalone repair detail page when the Supabase cache misses. Hydrates the Supabase cache on the way out. | Reads client Repairs + Tasks + Inventory sheets, writes Supabase `repairs` mirror | internal-helper |
| `handleRequestRepairQuote_(clientSheetId, payload, callerEmail)` (line 17221) | Creates a new Repair row from an inventory item with Status="Pending Quote". Enriches from the source Task (Task Notes, folder URLs, shipment #). Sends REPAIR_QUOTE_REQUEST email to the client. | Writes client Repairs sheet, writes Supabase `repairs` mirror, sends Resend email | P3 |
| `handleSendRepairQuote_(clientSheetId, payload)` (line 17408) | Sends a repair quote with multi-line tax-aware pricing — accepts a `quoteLines` array (each line has svcCode/qty/rate/taxable flag) plus tax area + tax rate; server recomputes all totals so the persisted numbers match what we email. Idempotent — same lines + totals already sent → skipped. Refuses to re-quote an already-Approved repair (must Void first). Writes 8 quote columns to the Repairs sheet. Sends REPAIR_QUOTE email with full Quote Breakdown table. | Writes client Repairs sheet (multiple quote columns), writes Supabase `repairs`, sends Resend email | P3 |
| `handleVoidRepairQuote_(clientSheetId, payload)` (line 17720) | Admin tool to clear an Approved (or earlier) quote so it can be re-issued. Flips Status → "Pending Quote", clears all 8 quote columns + Quote Sent Date / At / Approved Date / Final Amount / Approved. Refuses to void if completion already happened. | Writes client Repairs sheet, writes Supabase `repairs` | P3 |
| `handleRespondToRepairQuote_(clientSheetId, payload)` (line 17786) | Client (or admin on their behalf) approves or declines a repair quote. Approve → Status="Approved" + idempotency stamp. Decline → Status="Declined". Sends REPAIR_APPROVED or REPAIR_DECLINED email to staff + client. On Approve, generates the Repair Work Order PDF (DOC_REPAIR_WORK_ORDER template) and lands it in the Repair Docs tab via Supabase. | Writes client Repairs sheet, generates PDF, sends Resend email | P3 |
| `handleUpdateRepairNotes_(clientSheetId, payload)` (line 18025) | Lightweight save of Repair Notes / Repair Vendor / Scheduled Date / Start Date — intended for the period between Approve and Start Repair when the office stages billing/warehouse instructions. No lock, no email, no PDF. | Writes client Repairs sheet | P2 |
| `handleCompleteRepair_(clientSheetId, payload)` (line 18093) | Marks a repair Complete with a Pass/Fail result, computes billing — uses the multi-line `quoteLines` to write one Billing_Ledger row per line (each with its own svcCode for proper QB tax treatment), or falls back to a single REPAIR row from `quoteAmount` for legacy repairs. Idempotency-protected via "Completion Processed At" stamp. Flushes any pending addon services. Sends REPAIR_COMPLETE email to staff + client. | Writes client Repairs + Billing_Ledger sheets, writes Supabase `billing`, sends Resend email | P4a |
| `handleStartRepair_(clientSheetId, payload)` (line 18494) | Sets Status="In Progress" + Start Date when warehouse begins a repair. Regenerates the Work Order PDF (for reprints) using bulk-read enrichment from Source Task and Inventory to avoid timeouts on busy sheets. Allowed re-runs from Approved / In Progress / Complete (doesn't mutate status if already In Progress/Complete). | Writes client Repairs sheet, generates PDF to Supabase `documents`, writes Supabase `repairs` | P3 |
| `handleCorrectRepairResult_(clientSheetId, payload)` (line 28067) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleReopenRepair_(clientSheetId, payload, callerEmail)` (line 28218) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleCancelRepair_(clientSheetId, payload)` (line 28334) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleBatchCancelRepairs_(clientSheetId, payload)` (line 28501) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleBatchRequestRepairQuote_(clientSheetId, payload, callerEmail)` (line 28997) | Defined after line 21000 — listed in part 2. | n/a | n/a |

#### Category: shipments

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `handleGetShipments_(clientSheetId)` | (already listed under inventory category — multi-client shipments list reader) | — | done |
| `handleGetShipmentItems_(clientSheetId, params)` | (already listed under inventory category) | — | done |
| `handleCompleteShipment_(clientSheetId, payload)` | (already listed under inventory category — the "receive a shipment" master handler) | — | P5 |
| `api_nextShipmentNo_(rpcUrl, rpcToken)` (line 14803) | Returns the next Shipment # as `SHP-XXXXXX`. v38.206.0 — now a thin wrapper around `api_nextShipmentNoSupabase_`; the racy Master sheet RPC counter is retired (mirror of v38.182.0's invoice-counter fix). Legacy rpcUrl/rpcToken parameters kept for signature compat but ignored. | Supabase `next_shipment_no()` | internal-helper |
| `api_nextShipmentNoSupabase_()` (line ~14826) | Calls the atomic `public.next_shipment_no()` RPC and returns the formatted shipment number string (e.g. `SHP-001000`). Format-validates against `/^SHP-\\d{6,}$/`. Mirror of `api_nextInvoiceNoSupabase_`. | Supabase RPC | internal-helper |

#### Category: stax

(All `stax_*` handlers and helpers are after line 21000 — listed in part 2. The pre-21000 stax-Supabase mirror helpers are listed under **supabase-sync** below.)

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `stax_parseAutoCharge_(v)` (line 4519) | Coerces a sheet cell value (could be boolean false, string "FALSE", "NO", "OFF", or empty) into a boolean for the per-invoice auto-charge flag. Fixes a longstanding bug where `String(false || "")` produced "" which evaluated wrong. | Pure function | internal-helper |
| `api_sbUpsertStaxInvoice_(inv)` (line 4530) | Upserts one Stax invoice row to Supabase `stax_invoices`. Used by every handler that writes the Stax sheet so the mirror stays current. | Writes Supabase `stax_invoices` | internal-helper |
| `api_sbBatchUpsertStaxInvoices_(invs)` (line 4556) | Batch variant — upserts an array of Stax invoices in one POST. | Writes Supabase `stax_invoices` | internal-helper |
| `api_sbResyncAllStaxCustomers_()` (line 4593) | Reads every row of the Stax Customers tab and pushes them all to Supabase `stax_customers`. | Reads Stax Customers sheet, writes Supabase `stax_customers` | internal-helper |
| `api_sbResyncStaxCustomers_(qbNames)` (line 4617) | Resync a specific subset of customer rows by QB Customer Name. | Reads Stax Customers sheet, writes Supabase `stax_customers` | internal-helper |
| `api_sbResyncStaxInvoice_(qbInvoiceNo)` (line 4651) | Re-fetches a single Stax invoice row by QB Invoice # from the sheet and pushes it to Supabase. Used when a handler mutates one row without having the full shape in hand. | Reads Stax Invoices sheet, writes Supabase `stax_invoices` | internal-helper |
| `api_sbResyncStaxInvoices_(qbInvoiceNos)` (line 4688) | Batch version of the above — multiple QB Invoice #s. | Reads Stax Invoices sheet, writes Supabase `stax_invoices` | internal-helper |

#### Category: supabase-sync

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `supabaseUpsert_(table, data)` (line 2525) | The universal "upsert one row to Supabase" helper. Looks up the unique-constraint columns per table (inventory→tenant_id+item_id, tasks→tenant_id+task_id, etc.), POSTs with `Prefer: resolution=merge-duplicates`. Returns `{ok, code, error}` so callers can detect silent failures. | Writes Supabase REST | internal-helper |
| `supabaseBatchUpsert_(table, rows)` (line 3735) | Batch upsert — deduplicates rows by unique key (otherwise PostgREST rejects the whole batch), groups rows by JSON-key shape (otherwise PostgREST throws PGRST102), chunks at 50 per request, retries failed chunks row-by-row to isolate the bad rows. | Writes Supabase REST | internal-helper |
| `_supabaseBatchPostChunks_(table, rows, conflictCol, CHUNK)` (line 3819) | Internal helper — actually does the chunked POSTs and per-row retry on failure. Called by `supabaseBatchUpsert_` per shape group. | Writes Supabase REST, may write `stax_run_log` on error | internal-helper |
| `sbLogSyncError_(table, httpCode, errorBody, rowCount, sampleRow)` (line 3888) | When a Supabase batch upsert fails, writes a diagnostic row to `stax_run_log` (Supabase + Stax sheet) so the React Payments app's FailedOperationsDrawer surfaces it. Avoids infinite recursion by hardcoding skip for the run_log table. | Writes Supabase `stax_run_log`, writes Stax sheet Run Log tab | internal-helper |
| `sbLogBlankIdSkips_(tenantId, entityType, sheetName, idColName, sheetRows)` (line 3950) | Surfaces silent blank-key skips during `api_fullClientSync_`. Logs one summary line per (tenant, entity) pair when sheet rows had blank primary keys, AND writes a `stax_run_log` row so failures are visible. | Writes Supabase `stax_run_log` | internal-helper |
| `supabasePatch_(table, filter, data)` (line 3969) | PATCH (UPDATE) rows matching a PostgREST filter string. Returns `{ok, code, error}`. | Writes Supabase REST | internal-helper |
| `supabaseSelect_(table, filter, columns)` (line 4002) | SELECT rows matching a filter. Returns `{ok, rows}`. | Reads Supabase REST | internal-helper |
| `supabaseDelete_(table, filter)` (line 4034) | DELETE rows matching a filter. Best-effort. | Writes Supabase REST | internal-helper |
| `supabaseDeleteStaleRows_(table, tenantId, keepIds, idColumn)` (line 4066) | After a bulk sync, deletes Supabase rows for a tenant whose IDs are NOT in the keep list — purges orphans from rows deleted directly from sheets. Paginated fetch + chunked delete. | Reads + writes Supabase REST | internal-helper |
| `api_ledgerInsert_(itemId, tenantId, source, status, createdBy)` (line 4165) | Inserts one Item ID into the cross-tenant `item_id_ledger` registry (authority for "has this ID ever been used"). Idempotent via ON CONFLICT DO NOTHING. Best-effort. | Writes Supabase `item_id_ledger` | internal-helper |
| `api_ledgerBatchInsert_(rows)` (line 4197) | Batch-insert variant — used by completeShipment to register all new Item IDs at once. Chunked at 100 per request. | Writes Supabase `item_id_ledger` | internal-helper |
| `api_ledgerUpdateStatus_(itemIds, newStatus, voidReason)` (line 4240) | Updates the status of a set of Item IDs in the ledger (active → released, transferred, voided). Stamps voided_at if voiding. | Writes Supabase `item_id_ledger` | internal-helper |
| `api_ledgerTransferTenant_(itemIds, newTenantId)` (line 4281) | Reassigns the owning tenant of a set of Item IDs (used by transferItems). Resets status to "active" at the destination. | Writes Supabase `item_id_ledger` | internal-helper |
| `api_postTransferSupabaseSideEffects_(itemIds, sourceTenantId, destTenantId, transferDate)` (line 4332) | After a transfer completes on the sheets, migrates Supabase-only auxiliary data: stamps transfer provenance on destination inventory rows, rewrites tenant_id on entity_notes and item_photos, strips transferred items from any open Will Call jsonb arrays (cancels emptied WCs). | Writes Supabase `inventory`, `entity_notes`, `item_photos`, `will_calls` | internal-helper |
| `api_ledgerCheckAvailable_(itemIds)` (line 4467) | Pre-check helper called by completeShipment — looks up Item IDs in the ledger and returns any duplicates with their owning tenant + status. Returns `{degraded: true}` if Supabase is unreachable so the caller can decide whether to block (React preflight) or allow (warehouse receive). | Reads Supabase `item_id_ledger` | internal-helper |
| `supabasePurgeTenant_(tenantId)` (line 4971) | Deletes ALL Supabase data for a tenant across the 6 main entity tables (inventory, tasks, repairs, will_calls, shipments, billing). Used when a client is deactivated. | Writes Supabase DELETE on 6 tables | internal-helper |
| `handlePurgeInactiveFromSupabase_()` (line 5016) | Admin endpoint — purges Supabase data for every inactive client in CB Clients. Called by the React Bulk Sync flow's cleanup step. | Reads CB Clients, calls `supabasePurgeTenant_` for each inactive | done |
| `sbInventoryRow_(tenantId, item)` (line 5046) | Builds the Supabase row shape for an inventory item — converts API-format fields (itemId, description, vendor, etc.) into snake_case columns with proper coercion (Number for qty, boolean for needsInspection, empty-string for missing dates). | Pure function | internal-helper |
| `sbTaskRow_(tenantId, task)` (line 5088) | Builds the Supabase row shape for a task — task_id, type, status, result, custom_price, due_date, priority, etc. | Pure function | internal-helper |
| `sbRepairRow_(tenantId, repair)` (line 5122) | Builds the Supabase row shape for a repair — including the multi-line quote columns (quote_lines_json + 7 numeric totals). | Pure function | internal-helper |
| `sbWillCallRow_(tenantId, wc)` (line 5162) | Builds the Supabase row shape for a will call — including the item_ids jsonb array (native array, not stringified) so the React fast-path detail loader works. | Pure function | internal-helper |
| `sbShipmentRow_(tenantId, ship)` (line 5192) | Builds the Supabase row shape for a shipment — strips the `[IK:<uuid>]` idempotency-key prefix from notes. | Pure function | internal-helper |
| `sbBillingRow_(tenantId, row)` (line 5215) | Builds the Supabase row shape for a billing row — only includes invoice_date when the sheet actually has a value so PostgREST's merge-duplicates won't clobber Supabase's value with a sheet blank. | Pure function | internal-helper |
| `sbClientRow_(client)` (line 5259) | Builds the Supabase row shape for a CB Clients row — every column from name, email, contact info to discount %s, payment terms, feature flags (enable_receiving_billing, auto_charge, etc.). | Pure function | internal-helper |
| `sbClaimRow_(claim)` (line 5296) | Builds the Supabase row shape for a CB Claims row. | Pure function | internal-helper |
| `resyncClaimToSupabase_(claimId)` (line 5340) | Reads one claim row fresh from the CB Claims sheet and upserts to Supabase. Used after any claim mutation. | Reads CB Claims sheet, writes Supabase `claims` | internal-helper |
| `resyncUserToSupabase_(email)` (line 5393) | Reads one user row fresh from the CB Users sheet and upserts to Supabase. | Reads CB Users sheet, writes Supabase `cb_users` | internal-helper |
| `sbMarketingContactRow_(row)` (line 5482) | Builds the Supabase row shape for a marketing contact — includes status, replied/converted/bounced/unsubscribed/suppressed flags. | Pure function | internal-helper |
| `resyncMarketingContactToSupabase_(email)` (line 5519) | Reads one contact row fresh from the Campaign sheet and upserts to Supabase. | Reads Campaign sheet, writes Supabase `marketing_contacts` | internal-helper |
| `deleteMarketingContactFromSupabase_(email)` (line 5549) | Deletes a marketing contact from Supabase by email. | Writes Supabase `marketing_contacts` DELETE | internal-helper |
| `sbMarketingCampaignRow_(row)` (line 5597) | Builds the Supabase row shape for a marketing campaign. | Pure function | internal-helper |
| `resyncMarketingCampaignToSupabase_(campaignId)` (line 5642) | Reads one campaign row fresh and upserts to Supabase. | Reads Campaign sheet, writes Supabase `marketing_campaigns` | internal-helper |
| `sbMarketingTemplateRow_(row)` (line 5684) | Builds the Supabase row shape for a marketing template (name, subject, preview text, HTML body, version, active flag). | Pure function | internal-helper |
| `resyncMarketingTemplateToSupabase_(name)` (line 5699) | Reads one template row fresh and upserts to Supabase. | Reads Campaign sheet, writes Supabase `marketing_templates` | internal-helper |
| `resyncMarketingSettingsToSupabase_()` (line 5741) | Reads the singleton marketing Settings tab and upserts to `marketing_settings` (id=1). | Reads Campaign sheet, writes Supabase `marketing_settings` | internal-helper |
| `sbUserRow_(user)` (line 5778) | Builds the Supabase row shape for a CB Users row. | Pure function | internal-helper |
| `resyncClientToSupabase_(spreadsheetId)` (line 5798) | Reads one CB Clients row fresh and upserts to Supabase `clients`. Called from `api_writeThrough_` with entityType="clients". | Reads CB Clients sheet, writes Supabase `clients` | internal-helper |
| `sbLocationRow_(loc)` (line 5863) | Builds the Supabase row shape for a location (warehouse-global, tenant_id defaults to "stride"). | Pure function | internal-helper |
| `resyncLocationToSupabase_(code, notes, active, actorEmail)` (line 5877) | Upserts one location to Supabase `locations`. | Writes Supabase `locations` | internal-helper |
| `deleteLocationFromSupabase_(code)` (line 5894) | Deletes a location from Supabase `locations`. | Writes Supabase `locations` DELETE | internal-helper |
| `syncEntityToSupabase_(entityType, tenantId, data)` (line 5921) | Switchboard — picks the right `sb*Row_` builder and `supabaseUpsert_` call for the entity type. Used when the handler has the data in hand and doesn't need to re-read the sheet. | Writes Supabase per-entity table | internal-helper |
| `resyncEntityToSupabase_(entityType, tenantId, entityId)` (line 5958) | Re-reads ONE entity row from the sheet by ID and upserts to Supabase. Includes hyperlink reads for Task/Repair/WC/Shipment folder URLs from rich-text cells. Used after every single-entity write so the mirror reflects the final state (vs `syncEntity` which uses the API-shape data). | Reads client sheet, writes Supabase per-entity table | internal-helper |
| `resyncEntitiesBatchToSupabase_(entityType, tenantId, entityIds)` (line 6163) | Batch counterpart — opens the sheet once, reads all matching rows, builds upsert rows in memory, single batch upsert. Cuts a 50-item release from 10-25 sec of writethrough to a few seconds. Falls back to per-row on failure so the React FailedOperationsDrawer still gets per-entity rows. | Reads client sheet, writes Supabase per-entity table | internal-helper |
| `api_writeThrough_(r, entityType, tenantId, entityId)` (line 6446) | After a write handler succeeds, this is the helper that re-syncs the affected entity (or entities) to Supabase. Accepts both single-handler response shapes (`r.getContent()` JSON) and batch-result shapes (`r.succeeded` count). Auto-picks the batch path when 2+ IDs are passed. Per-entity failures log to `gs_sync_events`. | Calls `resyncEntityToSupabase_` or `resyncEntitiesBatchToSupabase_`, writes `gs_sync_events` on failure | internal-helper |
| `api_fullClientSync_(tenantId, entityTypes)` (line 6531) | Reads ALL rows of one or more entity types (inventory/tasks/repairs/will-calls/shipments/billing) from a client's sheets and batch-upserts them to Supabase + deletes stale rows. Used after complex operations affecting many rows (completeShipment, generateStorageCharges, transferItems, etc.). | Reads full client sheets, writes Supabase per-entity tables, deletes stale rows | internal-helper |
| `handleBulkSyncToSupabase_(payload)` (line 36640) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleBulkSyncClientsToSupabase_()` (line 36569) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleReconcileSupabase_(payload)` (line 37033) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleHealthCheck_()` (line 32085) | Defined after line 21000 — listed in part 2. | n/a | n/a |

#### Category: tasks

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `handleGetTasks_(clientSheetId)` (line 11351) | Returns the full tasks list for one or all clients with per-row overrides from Inventory (vendor/description/location/sidemark/room/etc.) since Inventory is authoritative. Reads Task ID + Shipment # folder URLs from rich-text hyperlinks. | Reads CB Clients + each client's Tasks + Inventory + Shipments sheets | done |
| `handleGetTaskById_(clientSheetId, params)` (line 11473) | Returns one task by Task ID — for the React standalone task detail page when Supabase cache misses. Hydrates the Supabase cache on the way out. | Reads client Tasks + Inventory sheets, writes Supabase `tasks` | internal-helper |
| `handleCompleteTask_(clientSheetId, payload)` (line 16098) | Marks a task Completed with Pass/Fail result, writes billing if shouldBill (per service catalog BillIfPASS/BillIfFAIL flags), supports inline Custom Price override, idempotency-protected via "Completion Processed At" stamp. Bulk-write pattern collapses 8 setValue round-trips into one. Flushes addon services via `api_writeAddonsToLedger_`. For Disposal task types auto-releases the inventory item. Sends TASK_COMPLETE or INSP_EMAIL (for inspection tasks) with the Work Order PDF attached if it exists. | Writes client Tasks + Billing_Ledger + Inventory sheets, writes Supabase `billing`, sends Resend email | P4a |
| `handleStartTask_(clientSheetId, payload)` (line 27317) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleCancelTask_(clientSheetId, payload)` (line 27924) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleCorrectTaskResult_(clientSheetId, payload)` (line 27958) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleReopenTask_(clientSheetId, payload, callerEmail)` (line 28172) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `api_voidBillingRowsWhere_(ss, predicate, reason)` (line 28120) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleBatchCancelTasks_(clientSheetId, payload)` (line 28418) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleBatchReassignTasks_(clientSheetId, payload)` (line 28712) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleBatchCreateTasks_(clientSheetId, payload)` (line 27101) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `api_buildOpenTaskMap_(taskSheet)` (line 27236) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `api_updateInvTaskNotes_simple_(ss, itemId)` (line 27260) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleGenerateTaskWorkOrder_(clientSheetId, payload)` (line 27771) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `api_generateTaskWorkOrderPdf_(ss, rowData, taskMap, settings, folderUrl)` (line 27823) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleUpdateTaskNotes_(clientSheetId, payload)` (line 29079) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleUpdateTaskCustomPrice_(clientSheetId, payload)` (line 29125) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleUpdateTaskDueDate_(clientSheetId, payload)` (line 29159) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleUpdateTaskPriority_(clientSheetId, payload)` (line 29192) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleAddItemAddon_(clientSheetId, payload)` (line 29228) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleRemoveItemAddon_(clientSheetId, payload)` (line 29339) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `api_propagateInvFieldsToBilling_(ss, itemId, fieldUpdates)` (line 29447) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `api_writeAddonsToLedger_(ss, parentType, parentId, ctx)` (line 2597) | Polymorphic addons → Billing_Ledger materializer. For a given parent entity (task/repair/will_call/inventory), reads unbilled rows from Supabase `addons`, writes one Billing_Ledger row per addon (with the parent-type-specific Task ID / Repair ID / Shipment # column mapping), then PATCHes the addon back to billed=true with the ledger_row_id stamped for traceback. Idempotent — already-billed addons are skipped. | Reads Supabase `addons`, writes client Billing_Ledger, writes Supabase `addons` PATCH + `billing` resync | internal-helper |
| `api_nextTaskCounter_(taskSheet, type, itemId, pendingIds)` (line 15169) | Scans the Tasks sheet for the max counter on a given (type, itemId) prefix (e.g. INSP-62840-) and returns the next integer. Also checks the in-flight `pendingIds` list so a batch insert doesn't collide. Used by receiving to auto-number INSP/ASM tasks. | Reads client Tasks sheet | internal-helper |
| `api_lookupSvcName_(ss, svcCode)` (line 15200) | Looks up the human-readable Service Name for a service code in the Price_Cache tab. Falls back to the code itself if not found. | Reads client Price_Cache sheet | internal-helper |
| `api_ensureTaskColumns_(taskSheet)` (line 15222) | Appends "Due Date" and "Priority" columns to a Tasks sheet if missing. Idempotent — safe to call on every batch create. | Writes header row | internal-helper |

#### Category: trigger

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `retryFailedSyncs_()` (line 2789) | Scheduled trigger (10-min cadence) — reads up to 100 "sync_failed" rows from Supabase `gs_sync_events` (filtered to the *_write_through pattern), retries each by calling `resyncEntityToSupabase_`, marks success rows as "confirmed", bumps updated_at on still-failed rows. 5-minute time budget to stay under GAS's 6-minute limit. | Reads + writes Supabase `gs_sync_events` | P7 |
| `installSyncRetryTrigger()` (line 2902) | Manual installer — removes any existing `retryFailedSyncs_` trigger and creates a fresh 10-minute one. Run once from the Apps Script editor. | Apps Script trigger management | P7 |
| `api_enqueueOnboardingRetry_(sheetId, clientName, clientFolderId)` (line 2937) | Adds a sheet ID to the PENDING_ONBOARDINGS script-properties queue. Dedups by sheet ID. Called when inline `handleOnboardClient_` can't find the bound script (Drive indexing lag). | Writes Apps Script Properties | internal-helper |
| `retryPendingOnboardings_()` (line 2969) | Time-based trigger handler — processes the PENDING_ONBOARDINGS queue. For each pending entry calls `handleFinishClientSetup_`. On success removes from queue; on failure increments attempts (up to 15 = 75 minutes); on final give-up logs to gs_sync_events. | Reads + writes Apps Script Properties, calls `handleFinishClientSetup_`, writes Supabase `gs_sync_events` | P7 |
| `installOnboardingRetryTrigger()` (line 3041) | One-time installer for the 5-minute `retryPendingOnboardings_` trigger. Idempotent. | Apps Script trigger management | P7 |
| `reconcileNextClient_()` (line 3074) | Scheduled trigger (5-min cadence) — round-robin syncs ONE active client's full data to Supabase per run. Cycles through all active clients using a Script Property cursor; ~4 hours for 50 clients. Also resyncs the client's own CB row. | Reads CB Clients sheet, reads target client's sheets, writes Supabase mirrors via `api_fullClientSync_` + `resyncClientToSupabase_` | P7 |
| `installReconciliationTrigger()` (line 3143) | One-time installer for the 5-minute `reconcileNextClient_` trigger. Idempotent. | Apps Script trigger management | P7 |

#### Category: will-calls

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `handleGetWillCalls_(clientSheetId)` (line 11892) | Returns the full will-calls list for one or all clients with per-row item field overrides from Inventory. Reads WC items from the WC_Items sheet, attaches them to each WC, looks up Shipment Folder URL by cross-referencing the first item's shipment number. | Reads CB Clients + each client's Will_Calls + WC_Items + Inventory + Shipments sheets | done |
| `handleGetWillCallById_(clientSheetId, params)` (line 11558) | Returns one will call by WC Number — for the React standalone WC detail page. Hydrates the Supabase cache on the way out. | Reads client Will_Calls + WC_Items + Inventory sheets, writes Supabase `will_calls` | internal-helper |
| `handleCreateWillCall_(clientSheetId, payload)` (line 18774) | Creates a new will call from a list of item IDs — looks each up in Inventory, computes the WC fee per class with client discount, generates a unique WC Number (timestamped), checks none of the items are already on an active WC, writes the Will_Calls + WC_Items rows. Status defaults to "Pending" (or "Scheduled" if est. pickup date given). Handles COD with optional custom amount. Sends WILL_CALL_CREATED email. | Writes client Will_Calls + WC_Items sheets, sends Resend email | P3 |
| `handleProcessWcRelease_(clientSheetId, payload)` (line 19065) | Releases items from a will call (full or partial). For released items: flips Inventory Status="Released" + Release Date, writes WC billing rows (if not COD), flips WC_Items Status="Released". For partial: original WC → "Partial" + new WC created for remaining items. Sends WILL_CALL_RELEASE email with a generated PDF (DOC_WILL_CALL_RELEASE template) attached. Flushes addon services. | Writes client Inventory + Billing_Ledger + Will_Calls + WC_Items sheets, generates PDF, sends Resend email | P4a |
| `handleUpdateWillCall_(clientSheetId, payload)` (line 19714) | Inline edit of WC fields (estimated pickup date, pickup party/phone, requested by, notes, COD amount, status). Auto-promotes Status from "Pending" to "Scheduled" when an est. pickup date is filled in. Syncs status changes to WC_Items rows. | Writes client Will_Calls + WC_Items sheets | P2 |
| `handleGenerateWcDoc_(clientSheetId, payload)` (line 19807) | Generates (or regenerates) the WC release PDF on demand. Reads WC + WC_Items fresh, builds the canonical token set, generates via DOC_WILL_CALL_RELEASE template, lands in Supabase Storage / public.documents (the WC Docs tab). Used by reprint button. | Reads client Will_Calls + WC_Items sheets, generates PDF, writes Supabase `documents` | P3 |
| `handleCancelWillCall_(clientSheetId, payload)` (line 19954) | Cancels a will call — sets WC Status="Cancelled", sets all WC_Items rows to Status="Cancelled" via a bulk setValues. Sends WILL_CALL_CANCELLED email. | Writes client Will_Calls + WC_Items sheets, sends Resend email | P3 |
| `handleAddItemsToWillCall_(clientSheetId, payload)` (line 20115) | Adds inventory items to an existing open WC. Validates each is not Released and not already on another active WC. Writes new WC_Items rows, updates parent WC's Items Count + Total WC Fee. | Writes client WC_Items + Will_Calls sheets | P3 |
| `handleRemoveItemsFromWillCall_(clientSheetId, payload)` (line 20289) | Removes pending items from a WC — deletes WC_Items rows, updates parent WC's Items Count + Total WC Fee. Skips already-Released items. Auto-cancels the WC if no items remain. | Writes client WC_Items + Will_Calls sheets | P3 |
| `handleBatchCancelWillCalls_(clientSheetId, payload)` (line 28580) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleBatchScheduleWillCalls_(clientSheetId, payload)` (line 28917) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleReopenWillCall_(clientSheetId, payload, callerEmail)` (line 28264) | Defined after line 21000 — listed in part 2. | n/a | n/a |
| `handleGetWcDocUrl_(clientSheetId, params)` (line 13191) | Looks up the Drive folder linked from the WC Number cell, then finds the first PDF in that folder and returns both URLs. Used by the React app's "Open WC Doc" link for legacy folders that still have PDFs. | Reads client Will_Calls sheet, reads Drive folder | retiring |

#### Category: helper-claims

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `handleGetClaims_(callerRole, callerClientName)` (line 13329) | Returns the full claims list from CB Claims sheet. For client users, filters to only their own claims. For admins, returns everything. Supports both new + legacy column names during migration. | Reads CB Claims sheet | done |

#### Category: pricing

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `handleGetPricingParity_()` (line 9865) | Returns a side-by-side comparison of every service rate from MPL Price_List vs Supabase service_catalog, plus Class_Map vs item_classes. Match rule: per-class rates must equal within 0.001 tolerance. For the Settings → Pricing Parity Monitor admin view. | Reads MPL Price_List + Class_Map, reads Supabase `service_catalog` + `item_classes` | done |
| `handleSyncPriceListFromSupabase_(params, callerEmail)` (line 10043) | Admin-triggered sync — pushes every service from Supabase `service_catalog` to the MPL Price_List sheet (matched by Service Code). Non-destructive — only updates known columns, appends new rows. Invalidates the pricing cache. | Reads Supabase `service_catalog`, writes MPL Price_List | done |
| `handleImportPriceListToSupabase_(params, callerEmail)` (line 10224) | One-time backfill in the reverse direction — pushes services from the MPL Price_List sheet into Supabase `service_catalog`. Skips rows whose code is already in Supabase (Supabase wins post-cutover). Idempotent. | Reads MPL Price_List, writes Supabase `service_catalog` | done |
| `handleSyncSingleServiceToSheet_(params, callerEmail)` (line 10438) | Pushes ONE service row from Supabase service_catalog into MPL Price_List. Called fire-and-forget by the React Price List UI after every create/update so the sheet stays in sync as a fallback cache. Per-save hot path with generous 120/min rate limit. | Reads Supabase `service_catalog`, writes MPL Price_List | done |
| `handleGetPricing_()` (line 10580) | Returns the full pricing payload (`{priceList, classMap}`) for the React app. Reads from MPL Price_List + Class_Map as primary; shadow-builds the Supabase version in parallel and logs parity match/mismatch. Cached 30 min. | Reads MPL Price_List + Class_Map | retiring |
| `api_buildPricingFromSupabase_()` (line 10643) | Shadow builder — reconstructs the React pricing payload from Supabase `service_catalog` + `item_classes`. Returns null on outage so the sheet path always wins. | Reads Supabase `service_catalog` + `item_classes` | internal-helper |
| `api_lookupRateFromSupabase_(code, klass)` (line 14943) | Looks up a service rate from Supabase service_catalog (cached 10 min, negative results cached too). Returns the same shape as the sheet path so it's a drop-in. Returns null on missing/inactive/outage. | Reads Supabase `service_catalog` | internal-helper |
| `api_lookupRateFromSheet_(ss, svcCode, itemClass)` (line 14997) | Internal — sheet-only rate lookup from Price_Cache tab. Matches the pre-v38.79.0 behavior exactly so the dual-path wrapper can compare results. | Reads client Price_Cache sheet | internal-helper |
| `api_lookupRate_(ss, svcCode, itemClass, ctx)` (line 15045) | The master rate-lookup function. Supabase is primary; falls back to sheet on null/error. Always reads both and compares — logs PARITY_OK/PARITY_MISMATCH, also writes a structured row to `billing_parity_log` so the React app can show parity drift. Used by every billing computation in the file. | Reads Supabase + sheet, writes Supabase `billing_parity_log` | internal-helper |
| `api_writeParityLog_(row)` (line 15137) | Fire-and-forget POST to public.billing_parity_log. Wrapped so `api_lookupRate_` never worries about Supabase auth or network failures. Silent on errors. | Writes Supabase `billing_parity_log` | internal-helper |
| `api_applyDiscount_(settings, rate, category)` (line 15159) | Applies a client's discount (or surcharge) % to a rate based on the category — "Storage" categories use DISCOUNT_STORAGE_PCT, others use DISCOUNT_SERVICES_PCT. Range capped at ±100% as a typo safety rail. | Pure function | internal-helper |
| `api_loadClassVolumesFromSupabase_()` (line 15309) | Loads the class → cubic-foot volume map from Supabase `item_classes`. Cached 10 min with null sentinel. Returns null on outage so caller falls back to sheet. | Reads Supabase `item_classes` | internal-helper |
| `api_loadClassVolumesFromSheet_(ss)` (line 15345) | Internal — sheet-only class volume loader from the Class_Cache tab. Header-based (supports "Cubic Volume" or "Storage Size"). | Reads client Class_Cache sheet | internal-helper |
| `api_loadClassVolumes_(ss)` (line 15369) | The wrapper that returns the volume map. Currently SHADOW MODE — sheet is primary; queries Supabase in parallel and logs each class's parity. Billing calculations stay identical to pre-Supabase. | Reads sheet, queries Supabase | internal-helper |
| `handleGetLocations_()` (line 10695) | Returns the list of warehouse location codes (from the CB Locations sheet) for dropdowns. | Reads CB Locations sheet | done |
| `handleGetPaymentTerms_()` (line 10728) | Returns the list of payment terms (Net 15, Net 30, Due on Receipt, etc.) from the CB Payment_Terms tab. Auto-creates the tab with seed values on first call. Cached 10 min. | Reads (and seeds) CB Payment_Terms sheet | done |
| `_openCbLocationsSheet_()` (line 10777) | Internal helper — opens (or creates with headers) the CB Locations sheet. | Reads + writes CB Locations sheet | internal-helper |
| `_findLocationRow_(sheet, code)` (line 10790) | Internal helper — scans the CB Locations sheet for a location code (case-insensitive) and returns its 1-based row number. | Reads CB Locations sheet | internal-helper |
| `handleCreateLocation_(payload, callerEmail)` (line 10804) | Creates a new warehouse location (or updates notes on an existing one). Dedups case-insensitive. Mirrors to Supabase. | Writes CB Locations sheet, writes Supabase `locations` | done |
| `handleUpdateLocation_(payload, callerEmail)` (line 10838) | Renames a location, updates notes, or soft-deletes (active=false → removed from Supabase + dropdown). | Writes CB Locations sheet, writes Supabase `locations` | done |
| `handleDeleteLocation_(payload, callerEmail)` (line 10887) | Hard-deletes a location from CB sheet + Supabase. Existing inventory referencing it is unaffected. | Writes CB Locations sheet, writes Supabase `locations` DELETE | done |
| `handleBulkSyncLocationsToSupabase_()` (line 10913) | Admin endpoint — re-pushes every CB Locations row to Supabase. Safe to re-run. | Reads CB Locations sheet, writes Supabase `locations` | done |
| `handleBatchUpdateItemLocations_(payload, callerEmail)` (line 10957) | Cross-tenant batch location update for the React scanner. Resolves item_id → tenant_id from the React-supplied tenantMap (or falls back to Supabase item_id_ledger + inventory lookups), groups items by tenant, updates each client's Inventory sheet's Location column + appends audit lines to Item Notes, writes Move History tab rows, mirrors to Supabase inventory, writes central `move_history` rows. | Reads Supabase `item_id_ledger` + `inventory`, writes per-client Inventory + Move History sheets, writes Supabase `inventory` + `move_history` | P5 |

#### Category: helper-batch-summary

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `handleGetBatch_(clientSheetId)` (line 13842) | The one-call endpoint that returns inventory + tasks + repairs + will-calls + shipments + billing for one or all clients in a single response — used by the React app to populate the main page in one request. Reads each tab once, attaches folder URLs from rich-text hyperlinks, applies the Inventory-field-overrides pattern across all entity types, sorts each list by date desc when multi-client. | Reads CB Clients + every client's 6 entity sheets | done |
| `api_getSummaryVersion_()` (line 14251) | Returns the current `summary_version` integer (cached + Script Property fallback). Used to build the version-keyed cache for `handleGetBatchSummary_`. | Reads CacheService + Apps Script Properties | internal-helper |
| `api_bumpSummaryVersion_()` (line 14265) | Increments `summary_version` (both Script Properties + CacheService 1-hour warm). Orphans all existing summary cache entries so next dashboard read is fresh. Called by every write handler that mutates Tasks/Repairs/WC. | Writes CacheService + Apps Script Properties | internal-helper |
| `api_appendSummaryTasks_(sheet, clientName, clientSheetId, out)` (line 14276) | Appends lightweight task rows (no folder URLs, no rich-text reads) to the dashboard summary list. Skips Void status. | Reads client Tasks sheet | internal-helper |
| `api_appendSummaryRepairs_(sheet, clientName, clientSheetId, out)` (line 14302) | Same pattern for repairs — skips Void / Declined statuses. | Reads client Repairs sheet | internal-helper |
| `api_appendSummaryWillCalls_(sheet, clientName, clientSheetId, out)` (line 14325) | Same pattern for will calls — skips Cancelled status. | Reads client Will_Calls sheet | internal-helper |
| `handleGetBatchSummary_(callerEmail, noCache)` (line 14354) | Lightweight cross-client summary for the Dashboard — reads ONLY Tasks/Repairs/Will_Calls tabs (no folder URLs), 60-second version-keyed cache that's busted instantly by `api_bumpSummaryVersion_`. Scope: staff/admin = all clients, parent client = own + children, single client = own sheet. | Reads CB Clients + each client's Tasks/Repairs/Will_Calls sheets | done |

#### Category: storage-charges-math

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `api_normalizeDateToMidnight_(v)` (line 15239) | Normalizes any date value (Date, ISO string, US format) to a Date set at local midnight. Parses ISO "YYYY-MM-DD" without timezone shift. Returns null for invalid input. | Pure function | internal-helper |
| `api_addDays_(d, days)` (line 15256) | Adds (or subtracts) N days from a Date. Returns new midnight Date. | Pure function | internal-helper |
| `api_maxDate_(a, b)` (line 15263) | Returns the later of two dates. | Pure function | internal-helper |
| `api_dateDiffDaysInclusive_(start, end)` (line 15270) | Inclusive day count between two dates (both endpoints count). | Pure function | internal-helper |
| `api_formatYMD_(d)` (line 15279) | Formats a Date as "YYYYMMDD" for use in Task ID dedup keys. | Pure function | internal-helper |
| `api_formatMMDDYY_(d)` (line 15287) | Formats a Date as "MM/DD/YY" for human-readable billing note text. | Pure function | internal-helper |
| `api_buildStorTaskId_(itemId, startDate, endDate)` (line 15295) | Builds the canonical STOR dedup Task ID: `STOR-{itemId}-{startYMD}-{endYMD}`. Used so the monthly storage-gen run can match and skip already-billed periods. | Pure function | internal-helper |

---

#### Inventory summary

**Function count in lines 1-21000:** 245 functions, all inventoried above.

**Functions where purpose required deeper read of context:** None tagged "needs human review" — every function in this range has a clear purpose grounded in its body and surrounding comments. A handful of one-shot admin helpers (`backfillStaxScheduledDates`, `installCoverageColumns`, `seedAllStaxToSupabase`, `bulkResyncStaxCatalog`) are tagged `retiring` because they were created for specific one-time data fixes and aren't part of the long-term API surface.

**Non-function top-level definitions found:**

1. **Lines 1-2056 (version-history comment block)**: a very large `/* */` comment containing per-version change notes from v38.205.0 back to v38.178.0. Pure documentation, treated as context only.
2. **`REVERSE_WRITETHROUGH_TABLES_` (line 2331)**: a top-level `var` holding the per-table writer registry for the SB→Sheets reverse writethrough endpoint. Currently maps 14 table names to `__writeThroughReverseStub_`. Mentioned under the migration category for `handleWriteThroughReverse_`.
3. **`__MIG_CORRELATION_ID__` (line 3304)**: file-scope global `var` set per-request by `api_logCallInput_` and read by `api_auditLog_` to stamp the migration replay corpus correlation ID. Documented inline.
4. **`_parentScope_` (line 8517)**: file-scope global `var` set by `withClientIsolation_` and read by `getTargetClients_` so cross-client reads filter to parent-client access scope.
5. **`CACHE_TTL_SECONDS_` (line 13710)** and **`APP_BASE_URL_` (line 13711)**: constants used by `cachedHandler_` and `api_buildEntityPhotosUrl_`.
6. **`SB_NULL_SENTINEL_` (line 14832)**: the "__SVC_NULL__" string used to cache negative results in Supabase-fallback helpers so misses don't hammer the REST endpoint.
7. **Inline `switch` statements inside `doGet` and `doPost`** (lines 6926-7036 and 7075-8368): these are the giant action routers — about 35 cases in `doGet`, 80+ in `doPost`. They are part of the entry-point functions and are documented in the entry-point category rows above.

Functions that begin in this range but whose body extends past line 21000:
- `handleTransferItems_` (starts line 20425, ends line 21035) — fully covered.
- `handleGenerateStorageCharges_` (starts line 21053) — body is past 21000, belongs to part 2.

All "Defined after line 21000 — listed in part 2" entries cross-reference functions whose declarations are in the second-half range so the sibling agent can claim them without duplicate work.

### Part 2 — lines 21001-end

**Non-function top-level definitions found (not counted in the 311):**
- `CLIENT_FIELDS_` (line 26708) — module-level constant: declarative schema map (client field key → cbHeader / supabaseColumn / type) shared between `api_clientRowToPayload_`, `api_updateClientRow_`, `api_writeClientSettings_`. Mirror of `stride-gs-app/src/types/clientFields.ts`.
- `CLIENT_FIELD_KEYS_` (line 26742) — derived from `CLIENT_FIELDS_`.
- `CLIENT_FIELD_SCHEMA_FINGERPRINT_` (line 26743) — derived fingerprint string for cross-system schema drift detection (used by `api_validateClientFieldSchema_`).
- `MOVE_HISTORY_HEADERS_` (line 32735) — column headers for the Move History sheet.
- `BACKFILL_DOCS_BUDGET_MS_` (line 41474) — wall-clock budget for the Drive→docs backfill.
- `BACKFILL_DOCS_MAX_FILES_PER_RUN_` (line 41477) — hard cap on per-run file count.
- `BACKFILL_FOLDER_TO_CONTEXT_TYPE_` (line 41480) — folder-name → context-type map for the backfill.

These are not call-targets; they're load-time constants. I left them out of the function table because the task asked for function inventory.

#### Category: admin

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| handleOnboardClient_ | The big onboarding action: creates Drive folders (client/Photos/Invoices), copies the client inventory template spreadsheet, discovers the new bound Apps Script via multiple strategies (URL redirect, folder search, Drive parent search) with retries, writes settings into the new sheet, appends the row to CB Clients, creates the user in CB Users, auto-deploys the Web App via the Apps Script REST API, installs triggers, and emails the internal team a notification. | CB Clients, CB Users, Drive folders, template copy, Apps Script REST API, GmailApp | P5 |
| handleUpdateClient_ | Edits a client's record. Updates the CB Clients row from the payload, optionally syncs the same fields down to the client sheet's Settings tab, refreshes the corresponding row in CB Users, and (if the client is being deactivated) purges its Supabase rows. Invalidates client-list caches. | CB Clients, CB Users, per-client Settings, Supabase clients (purge on deactivate) | P5 |
| handleSyncSettings_ | Pushes the CB Clients tab values down to each client's Settings tab (FREE_STORAGE_DAYS, DISCOUNT_*, ENABLE_* flags, QB / Stax names, etc.). Targets either a specific list of client IDs or all active clients. | Per-client Settings sheets | retiring |
| handleRediscoverAllScriptIds_ | Re-runs the bound Apps Script discovery for every CB client whose stored Script ID is blank or matches the master template (template-pollution repair). Calls `handleFinishClientSetup_` for each. | CB Clients sheet (Script ID column); reads bound script IDs via Drive | retiring |
| handleBackfillScriptIdsViaWebApp_ | For every CB client, calls their personal Web App with `get_script_id` so each client's own bound script reports its own ID back. Updates Script ID column on CB Clients. | CB Clients sheet; external HTTP fetch to each client Web App | retiring |
| handleFinishClientSetup_ | "Finish Setup" button — repairs a client whose onboarding partially completed (e.g. Drive lag prevented Web App deploy). Deploys the Web App, installs triggers, writes Web App URL + Deployment ID back to CB Clients. Idempotent — reuses existing deployment if found. | CB Clients sheet, Apps Script REST API, Drive folders, client Web App | retiring |
| handleSetClientWebAppDeployment_ | Records the Web App URL + Deployment ID that a human operator manually deployed and pasted (workaround for unverified-app OAuth scope strip). Validates URL shape and writes to CB Clients. | CB Clients sheet | retiring |
| handleResolveOnboardUser_ | After onboarding flagged an email conflict, this resolves the operator's choice: either add the new client to the existing user's access list, or skip touching Users. | CB Users sheet | retiring |
| setupClientWebApps_ | One-off admin helper to provision Web Apps for legacy clients that don't yet have one. Receives a payload of clients to set up. (Mostly a stub — calls into `handleFinishClientSetup_`.) | CB Clients, Apps Script REST API | retiring |
| handleFixMissingFolders_ | Repairs clients where Drive folder IDs (client folder, photos, invoices) are missing from CB Clients — creates missing folders and writes the IDs back. | CB Clients, Drive | retiring |
| handleRemoteAction_ | Generic admin dispatcher for token-protected remote actions on the API project (install triggers, reset caches, etc.). Verifies the shared secret before acting. | Script Properties, triggers | retiring |
| runBackfillTransferStorageCharges | One-off backfill job: walks every transferred-item billing row and recomputes storage charges using the new transfer-date cutover model (v38.25.0). Logs results, optionally writes new STOR rows. | Per-client Billing_Ledger sheets; Inventory; storage rate config | retiring |
| runReleaseInvoicesForReissue | One-off admin job that takes a list of invoice numbers and "releases" them so they can be re-invoiced — unflips Status=Invoiced rows back to Unbilled, drops Consolidated_Ledger rows, removes invoice_tracking rows. | Per-client Billing_Ledger, CB Consolidated_Ledger, Supabase invoice_tracking | retiring |
| runBillingAnomalySweep | Nightly admin sweep: scans recent billing rows looking for anomalies (orphans, duplicates, status mismatches between sheet and Supabase). Emails an HTML report. | All client Billing_Ledgers, CB Consolidated_Ledger, Supabase billing/invoice_tracking, GmailApp | retiring |
| anomalySweepEmailHtml_ | Builds the HTML body for the anomaly sweep email — list of detected anomalies grouped by type with counts. | None (pure formatting) | internal-helper |
| runBackfillQboPushedAtFromCb | One-off backfill: copies `qbo_pushed_at` from CB Consolidated_Ledger over to Supabase `invoice_tracking` rows so the Invoice Review tab shows the correct push state for invoices created before that column was added. | CB Consolidated_Ledger, Supabase invoice_tracking | retiring |
| runOnboardingDiagnostic | Admin diagnostic that audits onboarding-related data: checks if all clients have Script IDs, Web App URLs, deployment IDs, folder IDs; prints a report to the log. | CB Clients (read-only) | retiring |
| runRepairOrphanStaxInvoices | One-off repair job for Stax invoices stuck in PENDING/ERROR with no matching CB Consolidated_Ledger row (the orphan condition that causes Review tab clutter). Deletes the orphans. | Stax sheet, CB Consolidated_Ledger | retiring |
| runRepairOrphanLedgerRows | One-off repair job for Consolidated_Ledger rows that were appended during a failed invoice commit but whose invoice was never created (orphan ledger rows). Reads orphan IDs from a Script Property and deletes them. | CB Consolidated_Ledger; Script Properties | retiring |
| runBackfillWcLedgerRowIds | One-off backfill: assigns Ledger Row IDs to historic Will Call billing rows that pre-dated the Ledger Row ID column. | Per-client Billing_Ledger | retiring |
| runAuditMissingLedgerRowIds | Audit-only: reports any billing rows in any client sheet that are missing a Ledger Row ID (which breaks invoice idempotency). Logs report; no writes. | Per-client Billing_Ledger (read-only) | retiring |
| runPullBillingContactsFromQbo | One-off job: pulls customer billing email addresses from QuickBooks Online and writes them to CB Clients' Billing Email column, so invoice emails go to the right inbox. | CB Clients sheet, QBO API | retiring |
| probeSalesOrderEntity | Debug helper to probe the QBO SalesOrder entity (verifies API endpoint, scopes, response shape). | QBO API | retiring |
| runProbe_ | Generic helper that POSTs an arbitrary QBO query against a base URL with the supplied token + minor version, returning the raw response body. | QBO API | internal-helper |
| handleHealthCheck_ | Returns a JSON status object summarising script properties, Supabase reachability, CB connectivity, master sheet connectivity. Used by ops dashboards. | None (read-only diagnostics) | retiring |
| installDtSyncNightlyTrigger | Installs a nightly time-driven trigger that runs `dtSyncStatusesNightly` to sync DispatchTrack stop statuses. | Script triggers | trigger |
| dtSyncStatusesNightly | Nightly job: walks open delivery/pickup orders and queries DispatchTrack for current stop statuses, writes them back to the delivery_orders/pickup_orders tables on Supabase. | DispatchTrack API, Supabase delivery_orders/pickup_orders | retiring |
| dtSyncStatusesNow | Manual trigger version of `dtSyncStatusesNightly` — runs immediately for the operator. | DispatchTrack API, Supabase delivery_orders | retiring |
| backfillShipmentFolderUrls | One-off backfill: opens every shipment row across active clients and writes the Drive folder URL into the Shipment # cell as a hyperlink, where missing. | Per-client Shipments sheets, Drive | retiring |
| _resaleCertReadConfigInt_ | Reads an integer config value from a Settings tab with a default fallback. | CB Settings sheet | internal-helper |
| _resaleCertResolveOpsEmail_ | Returns the operations email used as the Reply-To on resale-certificate expiry notices. | CB Settings | internal-helper |
| _resaleCertWriteRunLog_ | Appends a row to the Resale_Cert_Run_Log tab with summary + details of an expiry check run. | CB Resale_Cert_Run_Log sheet | internal-helper |
| runResaleCertExpiryCheck | Daily job: scans CB Clients for resale certificates within the configured expiry window (e.g. 30 days), sends notification emails to the client and ops, logs the run. | CB Clients (read), GmailApp, Resale_Cert_Run_Log | retiring |
| setupResaleCertExpiryTrigger | Installs a daily time-driven trigger that runs `runResaleCertExpiryCheck`. | Script triggers | trigger |
| removeResaleCertExpiryTrigger | Removes the resale-cert expiry daily trigger. | Script triggers | trigger |
| handleBackfillDocsFromDrive_ | Walks a client's Drive folder tree, finds attached photos/docs not yet tracked in `public.documents`, and registers them. | Drive, Supabase documents table | retiring |
| backfillDocsCursorKey_ | Returns the Script Properties key used to remember where the Drive→documents backfill last stopped for a given client. | Script Properties | internal-helper |
| backfillDocs_alreadyExists_ | Helper for the docs backfill: checks if a (tenant, context, file) tuple is already in `public.documents`. | Supabase documents (read) | internal-helper |
| backfillDocs_uploadOne_ | Helper for the docs backfill: registers one Drive file as a `public.documents` row (no Drive copy — the file stays in Drive). | Supabase documents, Drive metadata | internal-helper |
| api_backfillDocsFromDriveOneClient_ | Runs the Drive→public.documents backfill for a single client. Resumable via cursor key in Script Properties. | Drive (read), Supabase documents | retiring |
| api_resetBackfillDocsCursor_ | Clears the docs-backfill cursor for a given client so the next run starts over from scratch. | Script Properties | internal-helper |
| runBackfillDocsDryRun | Dry-run wrapper for the docs backfill — no Supabase writes, just reports what would be added. | Drive (read) | retiring |
| runBackfillDocsExecute | Executes the docs backfill for the resolved client. | Drive (read), Supabase documents | retiring |
| runBackfillDocsResetCursor | Resets the resume cursor for the docs backfill. | Script Properties | internal-helper |
| _backfillDocsResolveClientId_ | Reads the client sheet ID for the docs backfill from a Script Property. | Script Properties | internal-helper |
| runStaxSheetsCleanup | One-off admin job: cleans up legacy Stax sheet rows (de-duplicates, normalises status case, deletes long-blank rows). | Stax sheet | retiring |
| countFilled_ | Counts non-empty cells in a row — utility for runStaxSheetsCleanup row-classification. | None | internal-helper |

#### Category: auth

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| api_upsertClientUser_ | Creates a new client user record in CB Users (or appends new client access to an existing user with the same email). Also creates the Supabase auth user with a temp password and fires the welcome/onboarding email once per lifetime. | CB Users sheet, Supabase auth.users, GmailApp (welcome email) | P7 |

#### Category: billing

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| handleGenerateStorageCharges_ | Runs across every active client, calculates how many days each inventory item has been in storage past its free-storage period, and writes new "Unbilled" storage billing rows. Wipes and re-creates existing unbilled storage rows in the date range (clean-slate regeneration). | Per-client Inventory, Billing_Ledger, Settings, Price_Cache, Class_Cache; CB Clients | P4a |
| handleCommitStorageRows_ | The "write" half of generate-storage-charges. The React tab pre-computes storage charges via a Postgres function and sends the rows here; we just append them to each client's Billing_Ledger. Faster than generate-storage-charges for big clients. | Per-client Billing_Ledger; invalidates client cache | P4a |
| handlePreviewStorageCharges_ | Same calculation as generateStorageCharges but read-only — returns rows without writing anything. Used by the "Preview Storage Charges" button. | Per-client Inventory, Billing_Ledger (read), Settings, Price_Cache, Class_Cache | P4a |
| handleGetUnbilledReport_ | Reads the CB Unbilled_Report sheet (last generated report) and returns it as JSON. | CB Unbilled_Report sheet (read) | P4a |
| handleGenerateUnbilledReport_ | Walks every active client's Billing_Ledger and collects all Unbilled rows up to the end date, optionally filtered by service code / client / sidemark. Returns the rows AND writes them to the CB Unbilled_Report sheet. | Per-client Billing_Ledger (read), Inventory (sidemark fallback), CB Unbilled_Report (write) | P4a |
| api_voidBillingRowsWhere_ | Generic helper: voids unbilled billing rows that match a predicate, stamps a reason in Item Notes, and removes any matching CB Consolidated_Ledger rows (defense-in-depth). Returns lists of voided and blocked rows. | Per-client Billing_Ledger, CB Consolidated_Ledger | internal-helper |
| handleAddItemAddon_ | "Add Receiving Add-on" — adds one billing row to a client for a service like CHRG (warehouse charge) on top of an inventory item. Looks up rate from the price list. Idempotent on Ledger Row ID. | Per-client Billing_Ledger; client cache | P4a |
| handleRemoveItemAddon_ | "Remove Receiving Add-on" — deletes the add-on billing row by Ledger Row ID, only if it's still Unbilled. Also tells Supabase to delete the mirror row. | Per-client Billing_Ledger, Supabase billing | P4a |
| api_propagateInvFieldsToBilling_ | When an inventory item's Sidemark or Reference changes, this propagates the new value to that item's still-Unbilled billing rows on customised-schema clients (default-schema clients are skipped — they don't have those columns on Billing_Ledger). Returns the Ledger Row IDs that were updated so the caller can re-mirror to Supabase. | Per-client Billing_Ledger | internal-helper |
| handleGetStaxInvoiceBatches_ | Reads recent batches of Stax invoices from Supabase (one row per invoice-creation run) for the Payments → Batches view. | Supabase stax_invoice_batches | done |
| handleRegenerateIifForBatch_ | Re-creates the QuickBooks IIF file for a previously created Stax invoice batch — used when the operator needs to re-upload to QB after first attempt failed. | Supabase stax_invoices, CB QB_Service_Mapping | retiring |

#### Category: claims

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| claimsDb_ | Returns an object with handles to every claims-related sheet on the CB spreadsheet (Claims, Claim_Items, Claim_History, Claim_Files, Claims_Config). | None (just sheet references) | internal-helper |
| api_claimsReady_ | Returns true if all four required Claims sheets exist on CB. | None | internal-helper |
| api_claimsConfig_ | Reads the Claims_Config tab and returns the parent folder ID, settlement template doc ID, allowed coverage/outcome/resolution dropdown values, and notification emails. | CB Claims_Config sheet | internal-helper |
| api_openCbSs_ | Opens the CB spreadsheet by ID and returns either the spreadsheet or an error response object. | None | internal-helper |
| api_nextClaimNumber_ | Scans the Claims sheet and returns the next sequential claim number in `CLM-####` format. | CB Claims (read) | internal-helper |
| api_createClaimFolder_ | Creates a Drive folder for a new claim named "CLM-#### - <claimant> - Files" inside the configured parent folder. | Drive | internal-helper |
| api_logClaimHistory_ | Appends a row to Claim_History (event type, message, actor, public/internal flag, optional file URL). | CB Claim_History sheet | internal-helper |
| api_getClaimRow_ | Returns a claim row as an object lookup by Claim ID. | CB Claims (read) | internal-helper |
| api_updateClaimRow_ | Updates fields on a Claims row by Claim ID, stamping Last Updated. | CB Claims sheet | internal-helper |
| api_writeClaimFile_ | Adds a row to Claim_Files (links a file URL to a claim — e.g. settlement PDF, signed settlement, evidence). | CB Claim_Files sheet | internal-helper |
| api_markPriorSettlementsNotCurrent_ | When generating a new settlement version, marks all prior settlement file rows as "Is Current=No" and returns the max version number for the new row to increment. | CB Claim_Files | internal-helper |
| api_lookupClientForClaims_ | Looks up the client spreadsheet ID for a given client name from CB Clients (used so the claim items panel can fetch item snapshots from inventory). | CB Clients (read) | internal-helper |
| api_snapshotInventoryItem_ | Captures the current state of an inventory item (description, vendor, class, status, etc.) to snapshot on a claim — so the claim's view of the item is fixed at claim creation time. | Per-client Inventory (read) | internal-helper |
| api_generateSettlementPdf_ | Builds the settlement PDF for a claim using the configured Doc template (replaces tokens like CLAIM_NO, CLAIMANT_NAME, APPROVED_AMOUNT, LEGAL_TERMS), exports to PDF, saves to the claim's Drive folder. | Drive template doc, claim folder, DocumentApp | internal-helper |
| api_claimEmailFallback_ | Returns a hard-coded HTML email body for one of the five claim templates when the configured template is unavailable. | None (pure HTML strings) | internal-helper |
| api_sendClaimEmail_ | Sends a claim email via `api_sendTemplateEmail_` first; if that fails, falls back to GmailApp with the hard-coded HTML. | GmailApp, MPL email templates | internal-helper |
| handleGetClaimDetail_ | Returns the full claim record including header fields, linked items, history events, and attached files. Auto-stamps "first reviewed by/at" the first time an admin opens it. Enforces client-role access (clients can only see their own claims). | CB Claims, Claim_Items, Claim_History, Claim_Files | P5 |
| handleCreateClaim_ | Creates a new claim (`CLM-####`), creates the Drive folder, optionally writes item snapshots, logs history. Resyncs to Supabase. | CB Claims, Claim_Items, Claim_History, Drive, Supabase claims | P5 |
| handleAddClaimItems_ | Adds one or more items to an existing claim (capturing each item's current inventory snapshot). Logs history. | CB Claim_Items, Claim_History, Supabase | P5 |
| handleAddClaimNote_ | Adds an internal or public note to a claim — prepends a timestamped block to the appropriate notes column. Logs history. | CB Claims, Claim_History | P5 |
| handleRequestMoreInfo_ | Marks claim as Waiting on Info and logs the requested info to history. Email is now sent from React side. | CB Claims, Claim_History | P5 |
| handleSendClaimDenial_ | Closes the claim as Denied, records the decision explanation, logs history. Email is sent from React side. | CB Claims, Claim_History, Supabase | P5 |
| handleGenerateClaimSettlement_ | Generates the settlement PDF for a claim, marks prior settlements as non-current, writes the new file row, updates Status to "Settlement Sent". Sends the settlement email with the PDF attached. | CB Claims, Claim_Files, Claim_History, Drive, GmailApp, Supabase | P5 |
| handleUploadSignedSettlement_ | Records that a signed settlement was received — copies the file into the claim's folder (or stores just the URL), updates claim status to Approved. | CB Claims, Claim_Files, Drive, Claim_History, Supabase | P5 |
| handleCloseClaim_ | Closes a claim with an optional note. Logs history. | CB Claims, Claim_History, Supabase | P5 |
| handleVoidClaim_ | Voids a claim with a required reason. Logs history. | CB Claims, Claim_History, Supabase | P5 |
| handleReopenClaim_ | Reopens a closed/void claim and (optionally) emails staff a reopen notification. Logs history. | CB Claims, Claim_History, GmailApp, Supabase | P5 |
| handleFirstReviewClaim_ | Explicitly stamps a claim's First Reviewed By/At (when the auto-stamp in getClaimDetail didn't fire for some reason). Idempotent. | CB Claims, Claim_History, Supabase | P5 |
| handleUpdateClaim_ | Inline-edits one or more claim fields (contact info, amounts, incident description, etc.). | CB Claims, Supabase | P5 |

#### Category: dispatchtrack

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| (DispatchTrack functions are under admin category: dtSyncStatusesNightly, dtSyncStatusesNow, installDtSyncNightlyTrigger) | See admin section. | DispatchTrack API | P7 |

#### Category: email

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| api_emailInvoice_ | Sends an invoice PDF via Gmail to the client's billing email (Supabase) + notification emails (sheet). | GmailApp, Supabase clients, client Settings | P4a |
| handleGetEmailTemplates_ | Returns every email/doc template — Supabase first (authoritative), auto-seeded from MPL on first call; MPL is fallback during a Supabase outage. | Supabase email_templates, MPL Email_Templates | done |
| handleUpdateEmailTemplate_ | Saves a template subject/body to Supabase (authoritative); best-effort mirror back to the MPL sheet. | Supabase email_templates, MPL Email_Templates | done |
| handleSyncTemplatesToClients_ | Pushes the MPL Email_Templates tab contents to every active client's local Email_Template_Cache tab (so client-side scripts can read templates without master-sheet access). | All client sheets' Email_Template_Cache | retiring |
| handleNotifyNewDeliveryOrder_ | Sends staff an "Order Pending Review" email when a client submits a new delivery order. Reads NOTIFICATION_EMAILS from CB Settings. | GmailApp, MPL ORDER_REVIEW_REQUEST template, CB Settings | P3 |
| handleSendRawEmail_ | Generic "send this exact email" endpoint used by Supabase Edge Functions (which compose and tokenize on their side) — just calls GmailApp. | GmailApp | P3 |
| handleSendOnboardingEmail_ | Sends the ONBOARDING_EMAIL template to a single recipient (typically a newly activated user). Includes a styled credentials box if a temp password is supplied. | GmailApp, Supabase/MPL templates | P7 |
| handleSendWelcomeEmail_ | Sends the WELCOME_EMAIL template to the client's CLIENT_EMAIL or a supplied recipient. Same credentials-box affordance as onboarding. | GmailApp, Supabase/MPL templates, client Settings | P7 |
| api_sendWelcomeOnce_ | Dedup-guarded helper: sends the onboarding email (with credentials) to a user exactly once per lifetime. Stamps a Welcome Sent At column on CB Users. | CB Users, GmailApp | internal-helper |
| handleSendWelcomeToUsers_ | Admin batch resend — re-fires the welcome to one or more specific users, bypassing the once-only dedup. Used from the Users settings page. | CB Users, GmailApp | retiring |
| handleTestGenerateDoc_ | Admin-only: renders a doc template (e.g. DOC_INVOICE, DOC_TASK_WORK_ORDER) to a PDF with fake sample data so the admin can preview/download in the Template Editor. | Docs API, Drive | done |
| handleTestSendClientTemplates_ | Admin "send me a test of this template" — fires one of the client-facing templates (shipment received, inspection complete, etc.) to a supplied recipient using sample tokens. | GmailApp, MPL templates | retiring |
| handleTestSendClaimEmails_ | Same as above but for the claim-specific templates (received, denial, settlement, etc.). | GmailApp, MPL templates | retiring |

#### Category: entry-point

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| (None in this range — `doGet`/`doPost` live in Part 1 of the file.) | | | |

#### Category: helper-format

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| api_qbFmtDate_ | Formats a date value (Date object, ISO string, or YYYYMMDD) into QuickBooks IIF format (MM/dd/yyyy). | None | internal-helper |
| api_qbCalcDueDate_ | Calculates the due date for an invoice given the invoice date and payment terms (e.g. "Net 30"). | None | internal-helper |
| api_qbEsc_ | Escapes a value for the QuickBooks IIF tab-delimited format (replaces tabs/newlines, double-quotes strings with embedded quotes). | None | internal-helper |
| api_money_ | Formats a number as `$1234.56`. | None | internal-helper |
| api_esc_ | HTML-escape helper — replaces `&<>"` with their HTML entities. | None | internal-helper |

#### Category: helper-misc

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| parseCSV_ | Parses a comma-separated string into an array of trimmed non-empty strings. | None | internal-helper |
| api_getClientNameMap_ | Returns a `spreadsheetId → clientName` lookup from CB Clients, cached for 10 minutes. | CB Clients (read), CacheService | internal-helper |
| api_buildInvoiceLineItems_ | Builds the line items for an invoice — groups STOR rows by sidemark into one summary line per sidemark; non-STOR rows stay individual. Returns rows + subtotals. | None (pure data transform) | internal-helper |
| api_getOrCreateClientInvoiceFolder_ | Returns (creating if needed) the "Invoices" subfolder inside the client's Drive parent folder. Falls back to the CB parent folder then root. | Drive | internal-helper |
| api_writeConsolidatedLedgerRow_ | Appends one row to CB Consolidated_Ledger with header-mapped columns and hyperlinks the Invoice # and Invoice URL cells. | CB Consolidated_Ledger | internal-helper |
| api_verifyClientLedgerFlipped_ | Read-only check: confirms a client's Billing_Ledger has the given ledger rows stamped with the expected invoice number. Used by half-write recovery in handleCreateInvoice_. | Per-client Billing_Ledger (read) | internal-helper |
| api_isInvoiceNoSafe_ | Pre-write check: scans CB Consolidated_Ledger for the proposed invoice number — returns false if the same number is already in use by a DIFFERENT (client, sidemark) tuple (RPC race). | CB Consolidated_Ledger (read) | internal-helper |
| api_deleteInvoiceTrackingRow_ | Deletes the Supabase `invoice_tracking` row for a given invoice number (used by void/reissue so the Invoice Review tab doesn't show stale state). | Supabase invoice_tracking | internal-helper |
| api_deleteCbRowsByInvoiceNo_ | Deletes every CB Consolidated_Ledger row whose Invoice # matches the given invoice number — used by void/reissue cleanup. Groups consecutive descending rows into single deleteRows calls. | CB Consolidated_Ledger | internal-helper |
| api_deleteCbRowsByLedgerIds_ | Deletes CB Consolidated_Ledger rows by Ledger Row ID (used by task/repair reopen defense-in-depth — usually a no-op because CB only contains Invoiced rows). | CB Consolidated_Ledger | internal-helper |
| api_markClientLedgerInvoiced_ | Marks a list of Ledger Row IDs as Status=Invoiced + writes Invoice #, Date, URL on the client Billing_Ledger. Enforces pre-commit Status=Unbilled assertion (throws if a row has drifted to Void/Invoiced). | Per-client Billing_Ledger | internal-helper |
| api_nextInvoiceNo_ | Returns the next invoice number — now just delegates to the atomic Postgres counter; legacy MASTER RPC parameters are ignored. | Supabase next_invoice_no() | internal-helper |
| api_nextInvoiceNoSupabase_ | Calls the atomic `public.next_invoice_no()` RPC and returns the formatted invoice number string (e.g. "INV-001000"). | Supabase RPC | internal-helper |
| api_newBatchResult_ | Returns a blank BatchMutationResult scaffold ({success, processed, succeeded, failed, skipped, errors, message}). | None | internal-helper |
| api_batchSkip_ | Adds a skipped entry (id + reason) to a BatchMutationResult. | None | internal-helper |
| api_batchError_ | Adds an error entry to a BatchMutationResult and bumps the failed counter. | None | internal-helper |
| api_coerceClientFieldValue_ | Coerces a raw cell value into the type declared in CLIENT_FIELDS_ (boolean, number, string). | None | internal-helper |
| api_validateClientFieldSchema_ | Compares the React-side CLIENT_FIELDS fingerprint with the backend fingerprint; logs a warning if they drift. | None | internal-helper |
| api_clientRowToPayload_ | Converts a CB Clients row + header map into a payload object using the CLIENT_FIELDS_ schema (auto-includes every defined field). | None | internal-helper |
| api_getOrCreateEntitySubfolder_ | Gets or creates a top-level entity subfolder (Shipments/Tasks/Repairs/Will Calls) inside the client's Drive parent. | Drive | internal-helper |
| api_resolveBoundScriptViaRedirect_ | Looks up the bound Apps Script ID for a given spreadsheet via Google Drive REST API or URL redirect — authoritative source for `Script ID` column. | Drive REST API | internal-helper |
| api_createItemFolder_ | Creates (or returns existing) subfolder by name inside a parent Drive folder URL. | Drive | internal-helper |
| api_fetchWithRetry_ | UrlFetchApp.fetch with exponential backoff retry on transient Drive/Docs errors (403 rate limit, 429, 5xx). | None | internal-helper |
| api_createGoogleDocFromHtml_ | Creates a Google Doc from raw HTML via the Drive REST API copy endpoint — returns the new Doc ID. | Drive | internal-helper |
| api_exportDocAsPdfBlob_ | Sets page margins on a Doc via Docs API, exports it as a PDF blob with the given filename. | Docs API, Drive | internal-helper |
| api_getDocTemplateHtml_ | Fetches a document HTML template — Supabase first, then client Email_Template_Cache, then MPL Email_Templates fallback. | Supabase email_templates, client cache, MPL | internal-helper |
| api_resolveDocTokens_ | Replaces `{{TOKEN}}` placeholders in an HTML string with values from a tokens map. | None | internal-helper |
| api_generateTempPassword_ | (Lives in Part 1 — referenced here.) Generates a temporary passphrase used in welcome/onboarding emails. | None | internal-helper |
| api_buildOpenTaskMap_ | Returns a normalised `itemId|svcCode → true` map of currently-open tasks on a client's Tasks sheet — used by batch-create-tasks dedup. | Per-client Tasks (read) | internal-helper |
| api_updateInvTaskNotes_simple_ | Updates the Inventory "Task Notes" column with a plain-text summary of tasks for an item (newest first). | Per-client Inventory, Tasks | internal-helper |
| api_generateTaskWorkOrderPdf_ | Builds a Work Order PDF for a task (logo, item details, fields for warehouse staff to fill in) using a Doc template + token substitution + Drive export. | Drive doc template, Docs API, client Inventory | internal-helper |
| getStaxSpreadsheet_ | Opens the Stax tracking spreadsheet by ID from Script Properties. | None | internal-helper |
| stax_appendRunLog_ | Appends a row to the Stax Run_Log tab (function name, summary, details). | Stax Run_Log sheet | internal-helper |
| stax_normalizeName_ | Normalises a customer name for fuzzy matching (lowercase, strips punctuation/whitespace). | None | internal-helper |
| stax_normalizeDate_ | Parses a date value (Date, ISO, MM/dd/yyyy) into a canonical ISO date string. | None | internal-helper |
| stax_buildClientStaxMap_ | Builds a map keyed by normalized customer-name variants → `{staxCustomerId, staxCustomerName}` from CB Clients. Multi-keyed so a lookup by client name, QB name, or Stax name all hit. | CB Clients (read) | internal-helper |
| stax_invoiceKey_ | Builds a dedup key for a Stax invoice from doc #, customer name, amount, and date (used by IIF import to spot duplicates). | None | internal-helper |
| stax_buildColumnMap_ | Builds a map of IIF column-header → index from the !TRNS/!SPL header lines. | None | internal-helper |
| stax_parseTrnsFromMap_ | Parses one TRNS line of an IIF file using the column map. | None | internal-helper |
| stax_parseTrnsPositional_ | Parses one TRNS line using fixed positional indexes (fallback when no column map). | None | internal-helper |
| stax_parseSplFromMap_ | Parses one SPL line of an IIF file using the column map. | None | internal-helper |
| stax_parseSplPositional_ | Parses one SPL line using fixed positional indexes. | None | internal-helper |
| stax_routeParsedTransaction_ | Routes a parsed TRNS/SPL pair into the Stax Invoices array or Stax Exceptions (e.g. NO_CUSTOMER). | None | internal-helper |
| stax_parseIIF_ | Parses an entire IIF file's content string into structured invoices + exceptions. | None | internal-helper |
| stax_appendException_ | Appends a row to the Stax Exceptions sheet (e.g. NO_CUSTOMER, DUPLICATE) so the operator can resolve manually. | Stax Exceptions sheet | internal-helper |
| stax_applyPastDueBuffer_ | If an invoice's due date is in the past, bumps the scheduled charge date forward by the configured buffer days (so the customer isn't auto-charged for a backdated invoice). | Stax Invoices sheet | internal-helper |
| stax_appendChargeLog_ | Appends a row to Stax Charge_Log capturing one charge attempt (doc#, customer, amount, status, txn id, notes). | Stax Charge_Log sheet | internal-helper |
| stax_parseDateForStax_ | Parses a date string into the ISO format expected by Stax API. | None | internal-helper |
| stax_buildLineItems_ | Builds the line items array for a Stax invoice POST from the parsed IIF lines, falling back to a single line if line items are missing. | None | internal-helper |
| stax_checkDuplicate_ | Checks whether a Stax invoice with the given ref key was already imported. | Stax sheet (read) | internal-helper |
| stax_getDefaultPaymentMethod_ | Queries Stax API for the default payment method on a customer. | Stax API | internal-helper |
| stax_chargeInvoice_ | POSTs a charge against a Stax invoice using the supplied payment method ID. | Stax API | internal-helper |
| stax_sendInvoiceEmail_ | Asks Stax to send the customer an emailed invoice link (so they can pay manually). | Stax API | internal-helper |
| stax_lookupCustomerIds_ | Looks up Stax customer IDs for a chunk of invoice rows, using stax_buildClientStaxMap_. | Stax sheet, CB Clients | internal-helper |
| stax_apiRequest_ | Generic Stax API client — handles auth header, retries, error decoding. | Stax API | internal-helper |
| stax_fetchPaymentMethodStatus_ | Calls Stax to find out whether a customer has a saved payment method ("has_pm", "no_pm", "unknown") — used by the React "CC on file" pill. | Stax API | internal-helper |
| stax_getPaymentMethodLabel_ | Returns a human label like "Visa ****1234" for a payment method object. | None | internal-helper |
| stax_extractArray_ | Extracts the array payload from a Stax API response (handles `.data` and other shapes). | None | internal-helper |

#### Category: helper-sheet-io

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| api_writeClientSettings_ | Writes a client's Settings tab from a payload — handles the Drive folder IDs, CB ID, CLIENT_NAME, and iterates the CLIENT_FIELDS_ schema for every field with a clientSettingsKey. | Per-client Settings sheet | internal-helper |
| api_appendClientRow_ | Appends a new client row to CB Clients, auto-expanding grid, writing to every matched column (including duplicates), returning the target row and header map for follow-up writes. | CB Clients | internal-helper |
| api_updateClientRow_ | Updates an existing CB Clients row in place — iterates the CLIENT_FIELDS_ schema and writes each provided field, auto-creating columns if missing. | CB Clients | internal-helper |
| api_sheetValues_ | Reads all values from a named sheet as a 2D array. Returns null if missing/empty. | Sheet read | internal-helper |
| api_writeCache_ | Overwrites a named cache sheet with new values (clears content + formats first, recreates the sheet if missing). | Target sheet | internal-helper |

#### Category: invoicing

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| handleQbExport_ | Generates a QuickBooks IIF file from all Invoiced rows on Consolidated_Ledger, saves it to Drive, and also imports the same invoices into the Stax Invoices sheet + Supabase stax_invoices table + writes a batch row + stamps invoice_tracking.stax_pushed_at. | CB Consolidated_Ledger, QB_Service_Mapping, Clients; Drive; Stax sheet; Supabase stax_invoices, stax_invoice_batches, invoice_tracking | P4b |
| handleQbExcelExport_ | Like handleQbExport_ but produces a QBO-compatible .xlsx file via a temp Google Sheet → export → Drive save. Includes Customer:Sidemark format when separate-by-sidemark is true. | CB Consolidated_Ledger, QB_Service_Mapping, Clients; Drive | P4b |
| handleCreateInvoice_ | The big one: creates one invoice for one client. Gets the next invoice number (atomic Postgres seq), validates per-client sidemark consistency, scans for half-write state (idempotent re-entry), generates the PDF (Drive Doc → PDF OR Supabase HTML template), saves to Drive, appends rows to Consolidated_Ledger, flips client Billing_Ledger rows to Invoiced, emails the PDF, stamps Supabase invoice_tracking. Rolls back on any failure (deletes CB rows). | CB Consolidated_Ledger, Supabase invoice_tracking, GmailApp, Drive, per-client Billing_Ledger, master accounting folder | P4a |
| handleResendInvoiceEmail_ | Re-sends an already-created invoice email by reading the PDF URL from Consolidated_Ledger, fetching the PDF from Drive, and re-emailing. Updates Email Status to "Re-sent". | CB Consolidated_Ledger, Drive, GmailApp | P4a |

#### Category: marketing

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| getCampaignSpreadsheet_ | Opens the marketing campaigns spreadsheet by ID. | Script Properties | internal-helper |
| setupCampaignSheetId_ | One-off setup helper that writes the marketing spreadsheet ID to Script Properties. | Script Properties | internal-helper |
| mkt_getSettings_ | Reads the Settings tab from the marketing spreadsheet (sender email, base URL, suppress list, etc.). | Marketing sheet | internal-helper |
| mkt_normalizeCampaign_ | Coerces a Campaigns row into a normalized JS object (numeric stats, dates, etc.). | None | internal-helper |
| mkt_normalizeContact_ | Coerces a Contacts row into a normalized object. | None | internal-helper |
| mkt_normalizeCC_ | Coerces a Campaign_Contacts (join table) row. | None | internal-helper |
| mkt_findCampaignRow_ | Finds the row number for a given campaign ID in the Campaigns sheet. | Marketing sheet | internal-helper |
| mkt_findContactRow_ | Finds the row number for a contact by email. | Marketing sheet | internal-helper |
| mkt_findTemplateRow_ | Finds the row number for a template by name. | Marketing sheet | internal-helper |
| mkt_nextCampaignId_ | Returns the next sequential CMP-#### id. | Marketing sheet | internal-helper |
| mkt_generateUnsubToken_ | Generates a per-contact unsubscribe token. | None | internal-helper |
| mkt_generateTrackingMarker_ | Generates an opaque marker embedded in outgoing marketing emails for open-tracking via a reply detector. | None | internal-helper |
| mkt_getTemplates_ | Returns the list of marketing templates from the sheet. | Marketing sheet | internal-helper |
| mkt_buildEmail_ | Composes an outgoing marketing email — substitutes contact + campaign tokens into the template, appends unsub footer + tracking marker. | None | internal-helper |
| mkt_patchRow_ | Writes a set of fields onto a single sheet row using a header map. | Marketing sheet | internal-helper |
| mkt_updateCampaignStats_ | Recomputes the sent/opened/replied/clicked totals on a Campaigns row from Campaign_Contacts. | Marketing sheet | internal-helper |
| handleGetMarketingDashboard_ | Returns aggregate stats for the marketing dashboard (active campaigns, total contacts, recent sends, etc.). | Marketing sheet | retiring |
| handleGetMarketingCampaigns_ | Lists all campaigns (filtered + paginated). | Marketing Campaigns sheet | retiring |
| handleGetMarketingCampaignDetail_ | Returns a single campaign plus per-contact send status. | Marketing Campaigns, Campaign_Contacts | retiring |
| handleGetMarketingContacts_ | Lists contacts with filter/pagination. | Marketing Contacts | retiring |
| handleGetMarketingContactDetail_ | Returns one contact and their campaign history. | Marketing Contacts, Campaign_Contacts | retiring |
| handleGetMarketingTemplates_ | Lists marketing templates. | Marketing Templates | retiring |
| handleGetMarketingLogs_ | Returns the run-log (paginated) of marketing actions. | Marketing Logs | retiring |
| handleGetMarketingSettings_ | Returns the marketing settings (sender info, suppression rules, etc.). | Marketing Settings | retiring |
| handleCreateMarketingCampaign_ | Creates a new campaign row. | Marketing Campaigns | retiring |
| handleUpdateMarketingCampaign_ | Updates an existing campaign's metadata. | Marketing Campaigns | retiring |
| handleActivateCampaign_ | Activates a draft campaign, enrolls eligible contacts. | Marketing Campaigns, Campaign_Contacts | retiring |
| mkt_enrollContacts_ | Adds eligible contacts to a campaign's Campaign_Contacts join (skips suppressed). | Marketing Campaign_Contacts | internal-helper |
| handlePauseCampaign_ | Pauses an active campaign (stops further sends). | Marketing Campaigns | retiring |
| handleCompleteCampaign_ | Marks a campaign as complete. | Marketing Campaigns | retiring |
| handleRunCampaignNow_ | Sends the current step of an active campaign to all due contacts immediately (instead of waiting for the next scheduled tick). | Marketing Campaign_Contacts, GmailApp | retiring |
| handleDeleteCampaign_ | Deletes a campaign row + its Campaign_Contacts rows. | Marketing sheets | retiring |
| handleCreateMarketingContact_ | Creates a new contact. | Marketing Contacts | retiring |
| handleImportMarketingContacts_ | Bulk-imports contacts from a CSV-shaped payload. | Marketing Contacts | retiring |
| handleUpdateMarketingContact_ | Updates a contact's fields. | Marketing Contacts | retiring |
| handleSuppressContact_ | Marks a contact as suppressed (no future sends). | Marketing Contacts | retiring |
| handleUnsuppressContact_ | Removes the suppression. | Marketing Contacts | retiring |
| handleCreateMarketingTemplate_ | Creates a new template. | Marketing Templates | retiring |
| handleUpdateMarketingTemplate_ | Updates a template's subject/body. | Marketing Templates | retiring |
| handleUpdateMarketingSettings_ | Updates the Settings tab. | Marketing Settings | retiring |
| handleSendTestEmail_ | Sends a test of a template to a specified address with sample tokens. | GmailApp, Marketing Templates | retiring |
| handlePreviewTemplate_ | Returns a rendered preview HTML for a template with sample tokens (no email sent). | Marketing Templates | retiring |
| handleCheckMarketingInbox_ | Polls the marketing inbox for replies / bounces and updates contact statuses. | GmailApp, Marketing sheets | retiring |

#### Category: migration

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| handleBulkSyncClientsToSupabase_ | Walks every active client in CB and upserts the client metadata into Supabase `clients`. One-off backfill for the Phase 2 migration. | CB Clients, Supabase clients | done |
| handleBulkSyncToSupabase_ | Walks every active client and bulk-mirrors a chosen entity table (inventory/tasks/repairs/billing/shipments/will_calls) into Supabase. Used by the Settings → Migration tab. | Per-client sheets, Supabase entity tables | done |
| handleReconcileSupabase_ | For a given client + entity type, compares the sheet's authoritative state against Supabase and reports mismatches (and optionally fixes them). | Per-client sheet, Supabase | done |

#### Category: qbo

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| qbo_escapeQueryString_ | Escapes a string for embedding in a QBO query parameter. | None | internal-helper |
| qbo_getAuthUrl_ | Returns the QBO OAuth authorization URL (for the operator to click through and approve). | Script Properties (state) | internal-helper |
| qbo_exchangeCode_ | Exchanges an OAuth authorization code for an access + refresh token. | QBO API, Script Properties | internal-helper |
| qbo_refreshToken_ | Refreshes the QBO access token using the stored refresh token. | QBO API, Script Properties | internal-helper |
| qbo_apiRequest_ | Generic QBO API client (GET/POST), handles 401 → refresh-and-retry, JSON parse, error decoding. | QBO API | internal-helper |
| qbo_getValidToken_ | Returns a fresh access token, refreshing if the stored one is expired or about to expire. | Script Properties, QBO API | internal-helper |
| qbo_getStatus_ | Returns whether QBO is connected, the realm ID, and expiry of the token (for the Settings → QBO page). | Script Properties | internal-helper |
| qbo_searchCustomer_ | Looks up a QBO customer by display name; returns the customer object or null. | QBO API | internal-helper |
| qbo_searchSubJob_ | Looks up a QBO sub-customer (job) of a parent by display name. | QBO API | internal-helper |
| qbo_createCustomer_ | Creates a new QBO customer (optionally as a sub-customer of a parent for sidemark separation). | QBO API | internal-helper |
| qbo_resolveQbParentSubName_ | Decides the parent + sub names for a QBO customer given the client name, sidemark, and separate_by_sidemark flag. | None | internal-helper |
| qbo_resolveCustomerAndSubJob_ | Top-level resolver: finds (or creates) the QBO customer + optional sub-job that an invoice should push to, given the client name and sidemark. Writes the resolved IDs back to a per-tenant mapping sheet. | QBO API, CB Customer_Map | internal-helper |
| qbo_getCustomerContactInfo_ | Fetches a QBO customer's billing email + address (cached during a single call). | QBO API | internal-helper |
| qbo_saveMappingRow_ | Persists the resolved (client, sidemark) → (QBO parent ID, QBO sub-job ID) mapping back to the CB Customer_Map sheet. | CB Customer_Map | internal-helper |
| qbo_loadItemMap_ | Loads the svc-code → QBO item name + ID map from the CB sheet (cached). | CB sheet | internal-helper |
| qbo_preloadItemCache_ | Pre-warms a session-scoped cache of QBO item IDs (so per-line lookup during invoice push doesn't N+1 the QBO API). | QBO API | internal-helper |
| qbo_resolveItemRef_ | Looks up the QBO ItemRef (id + name) for a service code, creating the QBO Item if missing. | QBO API, cache | internal-helper |
| qbo_checkDuplicatePush_ | Checks whether a given Stride invoice number has already been pushed to QBO (looks at CB Consolidated_Ledger's QBO ID column). | CB Consolidated_Ledger (read) | internal-helper |
| qbo_writeQboInvoiceId_ | Writes the QBO invoice ID + doc number back to every CB Consolidated_Ledger row for a Stride invoice, after a successful push. | CB Consolidated_Ledger | internal-helper |
| qbo_writeQboFailure_ | Writes the QBO push failure message into CB Consolidated_Ledger so operators can see why a push failed. | CB Consolidated_Ledger | internal-helper |
| qbo_buildInvoicePayload_ | Builds the JSON payload for the QBO `/invoice` POST from the invoice's lines, customer, and per-line item refs. | None | internal-helper |
| qbo_createInvoice_ | POSTs an invoice to QBO and returns the created invoice object (or throws on failure). | QBO API | internal-helper |
| api_patchQboPushJob_ | Updates a row on the qbo_push_jobs table (Supabase) — used by the React Invoice Review tab to track the in-flight state of a push. | Supabase qbo_push_jobs | internal-helper |
| handleQboCreateInvoice_ | Pushes one Stride invoice to QuickBooks Online. Validates side-mark, looks up/creates the QBO customer (and sub-job for separate-by-sidemark), resolves line items, calls `qbo_createInvoice_`, writes the QBO ID back to CB Consolidated_Ledger and Supabase invoice_tracking.qbo_pushed_at. | QBO API, CB Consolidated_Ledger, Supabase invoice_tracking | P6 |
| handleQboDisconnect_ | Clears stored QBO tokens (Script Properties) — operator-initiated disconnect. | Script Properties | retiring |
| handleQboSyncCatalogItem_ | Syncs a single service code to QBO — creates or updates the QBO Item so its name matches the CB QB_Service_Mapping. | QBO API, CB QB_Service_Mapping | retiring |
| handleQboSetupHeaders_ | Idempotent: writes the canonical column headers to the CB QB_Service_Mapping and Customer_Map sheets if they're missing. | CB QB_Service_Mapping, Customer_Map | retiring |
| handleUpdateQboStatus_ | Updates QBO-related metadata on Supabase from a backend trigger (e.g. after a push success/failure). | Supabase qbo_push_jobs | retiring |
| handleQboGetCustomers_ | Returns a paginated list of QBO customers (admin-only view used by the QBO mapping UI). | QBO API | retiring |

#### Category: stax

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| handleGetStaxInvoices_ | Returns the rows on the Stax Invoices sheet to the React Payments tab. | Stax Invoices sheet | retiring |
| handleGetStaxChargeLog_ | Returns the Stax Charge_Log rows. | Stax Charge_Log | retiring |
| handleGetStaxExceptions_ | Returns the Stax Exceptions rows. | Stax Exceptions | retiring |
| handleGetStaxCustomers_ | Returns the cached Stax customers list (for the customer-mapping UI). | Stax Customers sheet | retiring |
| handleGetStaxRunLog_ | Returns the recent rows of Stax Run_Log. | Stax Run_Log | retiring |
| handleGetStaxConfig_ | Returns the Stax-related config (past-due buffer days, auto-charge defaults). | CB Settings | retiring |
| handleImportIIF_ | Parses an uploaded IIF file (QB export) and either inserts each invoice as a PENDING Stax row, updates an existing PENDING row, or routes to Exceptions (NO_CUSTOMER, DUPLICATE). Also mirrors to Supabase. | Stax Invoices, Stax Exceptions, Supabase stax_invoices | retiring |
| handleResolveStaxException_ | Operator action: resolves a Stax Exception (NO_CUSTOMER → assign customer, DUPLICATE → ignore-or-link, etc.). | Stax Exceptions, Invoices | retiring |
| handleUpdateStaxConfig_ | Updates Stax-related config (past-due buffer, auto-charge default) on CB Settings. | CB Settings | retiring |
| handleSaveStaxCustomerMapping_ | Persists a (client name → Stax customer ID, Stax name) mapping back to CB Clients (multi-key form). | CB Clients | retiring |
| handleAutoMatchStaxCustomers_ | Walks unmatched Stax customers and tries to fuzzy-match them to CB Clients by name (handles whitespace, suffixes like "- Inactive"). | Stax Customers, CB Clients | retiring |
| handlePullStaxCustomers_ | Pulls the full Stax customers list down from the Stax API into the Stax Customers sheet. | Stax API, Stax Customers | retiring |
| handleSyncStaxCustomers_ | Reconciles Stax Customers against CB Clients — flags mismatches, updates IDs, etc. | Stax API, CB Clients | retiring |
| handleStaxRefreshCustomerIds_ | Looks up Stax customer IDs for invoice rows whose Stax Customer ID is blank, populating them via stax_buildClientStaxMap_. | Stax Invoices, CB Clients | retiring |
| handleStaxRefreshPaymentStatus_ | For a list of invoices, refreshes the `payment_method_status` column from the live Stax API (per-customer call, cached per run). | Stax Invoices, Stax API | retiring |
| handleListIIFFiles_ | Lists IIF files in the configured Drive import folder (for the React picker). | Drive | retiring |
| handleImportIIFFromDrive_ | Imports an IIF file directly from Drive (rather than upload) — runs the same parse/route logic as handleImportIIF_. | Stax Invoices, Drive | retiring |
| handleUpdateStaxInvoice_ | Inline-edits a Stax invoice row (e.g. customer name, scheduled date, auto-charge toggle). Mirrors to Supabase. | Stax Invoices, Supabase stax_invoices | retiring |
| handleDeleteStaxInvoice_ | Marks a Stax invoice as DELETED (only PENDING rows can be deleted). | Stax Invoices, Supabase | retiring |
| handleCreateTestInvoice_ | Admin tool: creates a fake $1 test invoice in Stax for verifying API integration. | Stax API, Stax Invoices | retiring |
| handleCreateStaxInvoices_ | Bulk-creates Stax invoices from a list of PENDING rows: builds line items, calls Stax `/invoice` for each, captures the Stax invoice ID, optionally auto-charges or emails. | Stax Invoices, Stax API, Stax Charge_Log, Supabase | P6 |
| handleRunStaxCharges_ | Runs the Charge Queue: for each due, eligible invoice, calls Stax `/charge` and writes results to Stax Charge_Log. Sends pay-link emails for non-auto-charge invoices. | Stax Invoices, Stax API, Stax Charge_Log | P6 |
| handleChargeSingleInvoice_ | Charges one Stax invoice immediately (manual one-off, e.g. when an operator clicks "Charge now"). | Stax Invoices, Stax API, Charge_Log | P6 |
| handleVoidStaxInvoice_ | Marks a Stax invoice as VOIDED (cannot void PAID ones — operator must refund in Stax first). | Stax Invoices | retiring |
| handleToggleAutoCharge_ | Flips the Auto Charge flag on a single Stax invoice row. | Stax Invoices, Supabase | retiring |
| handleResetStaxInvoiceStatus_ | Admin action: resets a Stax invoice's status back to PENDING (e.g. after a failed charge was manually cleared). | Stax Invoices, Supabase | retiring |
| handleLinkStaxInvoiceToExisting_ | Manually links a Stax-side invoice (existing in Stax but not in our sheet) into our Stax Invoices sheet by Stax invoice ID. | Stax Invoices, Stax API | retiring |
| handleSendStaxPayLinks_ | Bulk-sends pay-link emails for every eligible invoice not on auto-charge. | Stax Invoices, Stax API, GmailApp | retiring |
| handleSendStaxPayLink_ | Sends one pay-link email for a specific Stax invoice. | Stax Invoices, Stax API | retiring |
| handleBatchVoidStaxInvoices_ | Bulk-void: sets Status=VOIDED + a note on multiple Stax invoice rows. Skips PAID rows. | Stax Invoices, Supabase | retiring |
| handleBatchDeleteStaxInvoices_ | Bulk-delete: only PENDING rows can be deleted. | Stax Invoices, Supabase | retiring |

#### Category: repairs

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| handleCancelRepair_ | Sets a repair to Cancelled (refuses if already Complete). | Per-client Repairs | P3 |
| handleCorrectRepairResult_ | Lets an admin change Pass→Fail or Fail→Pass on a completed repair after the fact (label-only — no billing impact). | Per-client Repairs | P3 |
| handleReopenRepair_ | Reopens a Completed or In-Progress repair. If reopening from Completed, voids all the Unbilled billing rows linked to the repair (BILLING_LOCKED error if any have advanced past Unbilled). | Per-client Repairs, Billing_Ledger, CB Consolidated_Ledger | P3 |
| handleBatchCancelRepairs_ | Bulk-cancel: walks the repair IDs, marks each Cancelled when eligible, returns per-row outcomes. | Per-client Repairs, Supabase | P3 |
| handleBatchRequestRepairQuote_ | Creates a new Pending-Quote repair for each item ID in the payload (one repair per item). | Per-client Repairs, Supabase | P3 |

#### Category: supabase-sync

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| handleSyncAutocompleteDb_ | One-off: pushes a tenant's Autocomplete_DB sheet rows up to `public.autocomplete_db`. | Per-client Autocomplete_DB, Supabase autocomplete_db | done |

#### Category: tasks

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| handleBatchCreateTasks_ | Creates N × M tasks (N service codes × M items) on a client's Tasks sheet. Skips items with an open task for the same svc code. Returns the created Task IDs. | Per-client Tasks, Inventory (Task Notes propagation) | P3 |
| handleStartTask_ | Marks a task as In Progress, stamps Started At + Assigned To. Conflict-guard if already assigned to someone else (unless forceOverride). | Per-client Tasks | P3 |
| handleGenerateTaskWorkOrder_ | Manual PDF generation: rebuilds the task's Work Order PDF from the template and saves it to the task's Drive folder. (Task folder must already exist.) | Per-client Tasks, Drive | retiring |
| handleCancelTask_ | Sets a task to Cancelled (refuses if already Completed). | Per-client Tasks | P3 |
| handleCorrectTaskResult_ | Lets an admin change Pass→Fail or Fail→Pass on a completed task and re-sends the completion email. | Per-client Tasks, GmailApp | P3 |
| handleReopenTask_ | Reopens a Completed task (voids related Unbilled billing rows; BILLING_LOCKED if any have invoiced) or an In-Progress task (clears Started At, Assigned To). | Per-client Tasks, Billing_Ledger, CB Consolidated_Ledger | P3 |
| handleReopenWillCall_ | Reopens a Released/Partial WC (voids related WC billing rows) or a Scheduled WC (back to Pending). Cascades WC_Items Released → Scheduled. | Per-client Will_Calls, WC_Items, Billing_Ledger | P3 |
| handleBatchCancelTasks_ | Bulk-cancel: walks task IDs, marks each Cancelled when eligible, returns per-row outcomes. | Per-client Tasks, Supabase | P3 |
| handleBatchReassignTasks_ | Bulk-reassign: writes Assigned To on each eligible task row. | Per-client Tasks, Supabase | P3 |
| handleUpdateTaskNotes_ | Saves Task Notes and/or Location on a task (save-on-blur from React). | Per-client Tasks | P2 |
| handleUpdateTaskCustomPrice_ | Admin: sets a per-task price override (or clears it). | Per-client Tasks | P2 |
| handleUpdateTaskDueDate_ | Saves the Due Date on a task. | Per-client Tasks | P2 |
| handleUpdateTaskPriority_ | Sets Priority to High or Normal on a task. | Per-client Tasks | P2 |

#### Category: inventory

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| handleUpdateInventoryItem_ | Inline-edits an inventory item — accepts any subset of editable fields (vendor, description, sidemark, status, class, etc.). Auto-clears Release Date when reactivating ("Released"→"Active"). Propagates field changes to open Tasks/Repairs and (for customised-schema clients) to Unbilled Billing rows. Mirrors all touched rows to Supabase. | Per-client Inventory, Tasks, Repairs, Billing_Ledger; Supabase inventory/tasks/repairs/billing | P2 |
| handleGetItemMoveHistory_ | Returns the location-move history for an item (from the Move_History sheet). | Per-client Move_History | done |
| api_ensureMoveHistorySheet_ | Creates the Move_History tab on a client sheet if missing (sets headers). | Per-client sheet | internal-helper |
| api_logTransferMoveHistory_ | Logs a transfer in/out event onto Move_History (item IDs, user, from/to label, type). | Per-client Move_History | internal-helper |

#### Category: will-calls

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| handleBatchCancelWillCalls_ | Bulk-cancel: cancels eligible WC header rows + cascades linked WC_Items (Released stays Released, Cancelled stays, others → Cancelled). No emails sent (avoids quota blow-up). | Per-client Will_Calls, WC_Items, Supabase | P3 |
| handleBatchScheduleWillCalls_ | Bulk-set Estimated Pickup Date on multiple WCs; auto-promotes Pending → Scheduled. | Per-client Will_Calls, Supabase | P3 |

#### Category: maintenance

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| handleRefreshCaches_ | Walks every active client (or a filtered subset) and overwrites their Price_Cache, Class_Cache, Email_Template_Cache, Location_Cache tabs with the latest values from MPL and CB. | Per-client cache sheets | retiring |
| handleRunOnClients_ | Walks every active client and calls a whitelisted function on each client's bound script via the Apps Script Execution API (updateHeaders, installTriggers, sendWelcomeEmail). Used to push template/header updates from the central API. | Per-client bound scripts | retiring |
| runAutocompleteBackfill | Admin one-off: walks every active client, reads their Autocomplete_DB tab, upserts every row to Supabase autocomplete_db. | Per-client Autocomplete_DB, Supabase | done |

#### Category: id-management

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| handleGetAutoIdSetting_ | Returns whether auto-assignment of Item IDs is enabled for new items. | CB Settings | retiring |
| handleCheckItemIdsAvailable_ | Checks whether a given range/list of Item IDs are unused across all clients (so manual entry can be allowed). | Per-client Inventory | retiring |
| handleGetNextItemId_ | Returns the next available auto-assigned Item ID (scans all active clients, finds the max). | Per-client Inventory | retiring |
| handleUpdateAutoIdSetting_ | Updates whether auto-Item-ID is on. | CB Settings | retiring |

#### Category: drive

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| handleBackfillDocsFromDrive_ | API endpoint that triggers the Drive→public.documents backfill for one client (delegates to api_backfillDocsFromDriveOneClient_). | Drive, Supabase documents | retiring |

#### Category: trigger

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| (See admin section for: installDtSyncNightlyTrigger, setupResaleCertExpiryTrigger, removeResaleCertExpiryTrigger.) | | | |

#### Category: autocomplete

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| handleGetAutocomplete_ | Returns the autocomplete suggestion lists (Sidemark/Vendor/Description/Reference) for a tenant. Supabase first; falls back to per-client Autocomplete_DB sheet with lazy backfill to Supabase on miss. | Supabase autocomplete_db, per-client Autocomplete_DB | done |
</content>
</invoke>

---

## Project: Consolidated Billing

> Source: `AppScripts/Consolidated Billing Sheet/` (10 .js files, ~7000 lines)
> Deployment: bound to the CB master spreadsheet (Project ID `1o38NMWpP7FrdCyNLo5Yd-AwHlzcHr2PxZ_QyYwlF20_5ljx_bukOScJQ`).
> Migration role: P4a/P4b targets — invoice generation, IIF export, CB Consolidated_Ledger sheet, QBO push, client onboarding.
> Function count: **158**.

### File: `AppScripts/Consolidated Billing Sheet/Billing Logs.js`

#### Category: admin

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `installBillingLogSheets` | One-time menu setup tool. Creates a single "Billing_Log" tab to record every billing run, and deletes old leftover log tabs (Billing_Run_Success, Invoice_Review, etc.). Shows an alert with the cleanup result. | Creates Billing_Log tab; deletes legacy log tabs. UI alert. | internal-helper |

#### Category: email

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `safeEmailError_` | When a billing function crashes, emails the owner a plain-text error report (function name, invoice ID if any, error message, suggested fix, stack trace). Reads the owner's address from Settings; falls back to info@stridenw.com. Wrapped in try/catch so a broken emailer can't break the caller. | Reads CB Settings for OWNER_EMAIL. Sends email via MailApp to owner. | internal-helper |

#### Category: helper-misc

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `assertFnExists_` | Safety check used before running a base billing function — throws a clear "Required base function not found" error if the named function isn't loaded, instead of failing with a cryptic "undefined" error later. | None (pure check). | internal-helper |
| `errToString_` | Turns an error object (or string, or null) into a clean string suitable for logging or display. Tries `.message` first, then falls back to `String(err)`. | None (pure conversion). | internal-helper |
| `suggestFix_` | Looks at an error message and returns a human-readable hint about what to try (e.g. "function not found → check name in Code.gs", "timeout → process fewer clients", "no rows → check unbilled entries"). Used by the error logger and email reporter. | None (pure string analysis). | internal-helper |

#### Category: helper-sheet-io

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `logBilling_` | Central logger. Appends one row to the "Billing_Log" tab capturing timestamp, function name, type (Billing Run / Invoice), Success/Error, invoice number, run duration, details, and the suggested-fix hint. Used by every wrapped billing entry-point and by the invoice commit engine. | Writes to Billing_Log tab. | internal-helper |

#### Category: trigger

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `CB13_generateUnbilledReport_WithLogs` | Menu wrapper that runs the "Generate Unbilled Report" command and logs success or failure with a timestamp and duration to the Billing_Log tab. On error it also emails the owner and re-throws so the user still sees the failure. | Runs CB13_generateUnbilledReport. Writes Billing_Log row. May send error email. | retiring (P4b — wraps a CB function being retired) |
| `StrideGenerateStorageCharges_WithLogs` | Menu wrapper that runs the "Generate Storage Charges" command and logs success or failure to the Billing_Log tab. On error it also emails the owner and re-throws. | Runs StrideGenerateStorageCharges. Writes Billing_Log row. May send error email. | P4a (wraps `commitStorageCharges`) |

---

### File: `AppScripts/Consolidated Billing Sheet/CB13 Config.js`

#### Category: helper-sheet-io

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `CB13_seedSettingsKeys_` | Helper that adds any missing setting keys (e.g. OWNER_EMAIL, IIF_EXPORT_FOLDER_ID) to the Settings tab with a blank value, so the owner can fill them in. Leaves existing keys alone. | Writes new key rows to a Settings tab. | internal-helper |

---

### File: `AppScripts/Consolidated Billing Sheet/CB13 Schema Migration.js`

#### Category: admin

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `CB13_repairClientBillingColumns` | Major one-time repair tool. Old onboarding bugs caused some clients' Billing_Ledger rows to have data shifted by 1-3 columns. This walks every active client, finds shifted rows by scanning for where the Date column actually landed, deletes the empty cells to realign them, pads/trims everything to exactly 17 columns, and rewrites correct headers. Shows a per-client repair report. | Reads/rewrites every active client's Billing_Ledger tab. UI alert. | internal-helper |
| `CB13_runSchemaMigration` | Menu-callable tool. Prompts the operator for a client spreadsheet URL or ID, then runs `CB13_migrateClientSheet_` to make sure that client's Billing_Ledger has a "Ledger Entry ID" column at the far right. | Prompts UI; modifies one client sheet's Billing_Ledger header row. | internal-helper |

#### Category: helper-format

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `CB13_isDateValue_` | Looks at a cell value and decides whether it's a real date — handles Date objects, "M/D/YYYY", "YYYY-MM-DD", and anything `new Date()` can parse if the year is 2000-2099. Used by the column-repair tool to find where the Date column actually starts in a shifted row. | None (pure check). | internal-helper |

#### Category: helper-sheet-io

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `CB13_findHeaderIndex_` | Given a row of header names and a list of possible names (e.g. ["Service Date","Date"]), returns the column index of the first match using case/whitespace-tolerant comparison. Returns null if none found. | None (pure lookup). | internal-helper |
| `CB13_migrateClientSheet_` | Adds the "Ledger Entry ID" column at the far right of a client's Billing_Ledger tab if it's missing. Does NOT add a Sidemark column (an older version did, and corrupted data — now Sidemark is looked up from Inventory at report time). | Reads/modifies one client's Billing_Ledger header. | internal-helper |

---

### File: `AppScripts/Consolidated Billing Sheet/CB13 Unbilled Reports.js`

#### Category: admin

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `CB13_diagnoseUnbilledReport` | Diagnostic tool. For every active client, dumps the first 50 Billing_Ledger rows into an "Unbilled_Diagnostic" sheet with full info (raw status value, parsed status, raw date, parsed date, column indices, skip reason) so the operator can figure out why a row isn't appearing on the Unbilled Report. | Reads every active client's Billing_Ledger. Creates/clears Unbilled_Diagnostic sheet. UI alert. | internal-helper |

#### Category: entry-point

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `CB13_generateUnbilledReport` | Main "Generate Unbilled Report" command. Prompts the operator for an end date, then opens every active client's spreadsheet, scans their Billing_Ledger for rows where status is "Unbilled" (or blank) with a service date on/before the end date, looks up the Sidemark from each client's Inventory, falls back to Price_Cache for missing service names, and writes everything onto the central CB Unbilled_Report tab. Shows a summary alert with counts of rows scanned, matched, skipped, etc. Adds a Status dropdown (Unbilled/Invoiced/Void) at the end. | Reads every active client's Billing_Ledger, Inventory, and Price_Cache. Writes to CB Unbilled_Report tab. UI alert. | P4b (Unbilled_Report becomes a Supabase view) |

#### Category: helper-format

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `CB13_coerceDate_` | Turns a value into a Date — accepts real Date objects, "M/D/YYYY" strings, or anything else `new Date()` can parse. Returns null if nothing works. | None (pure conversion). | internal-helper |
| `CB13_fmtMMDDYYYY_` | Formats a Date as "MM-dd-yyyy" using the script timezone. Returns empty string for null/invalid dates. | None (pure formatting). | internal-helper |
| `CB13_parseMMDDYYYY_` | Parses a "MM-DD-YYYY" string into a Date object, validating month/day ranges. Returns null on failure. | None (pure parsing). | internal-helper |

#### Category: helper-sheet-io

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `CB13_buildSvcNameMapFromPriceCache_` | Reads a client's Price_Cache tab once and builds a lookup: service-code → service-name. Used so the Unbilled Report can fill in missing service names without re-reading the cache for every row. | Reads one client's Price_Cache tab. | internal-helper |
| `CB13_indexHeadersNormalized_` | Builds a header-name → column-index lookup from a header row, using lowercase trimmed keys for case-tolerant matching. | None (pure mapping). | internal-helper |
| `CB13_norm_` | Helper that lower-cases and trims a string for case-insensitive header matching. (Note: this name is duplicated in CB13_Preview_Core.js — both files declare it.) | None (pure string normalization). | internal-helper |
| `CB13_pickHeader_` | Given a normalized header-map and an array of candidate header names, returns the column index of the first one found. | None (pure lookup). | internal-helper |

---

### File: `AppScripts/Consolidated Billing Sheet/CB13_Preview_Core.js`

#### Category: entry-point

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `CB13_createAndSendInvoices` | The "Create & Send Invoices (PDF)" menu command. Reads the rows the operator highlighted on Unbilled_Report (including non-contiguous Ctrl-click selections), skips any already marked Invoiced, groups them into invoices by client (or by client+sidemark if that client has "Separate by Sidemark" enabled), then for each group calls `CB13_commitInvoice` which generates the PDF, writes the Consolidated_Ledger, updates the client's Billing_Ledger, and emails the client. Uses a lock so two operators can't run it at once. Shows a summary alert with counts and any errors. | Reads CB Unbilled_Report + Clients tab + per-client Settings. Calls `CB13_commitInvoice` (which writes Consolidated_Ledger, client Billing_Ledger, sends email, creates PDF). | P4a/P4b (`createInvoice`) |
| `CB13_resendInvoiceEmail` | Menu command to re-send the email for an already-created invoice. Operator clicks any cell on the row of an invoice in Consolidated_Ledger, the function extracts the invoice number, client sheet ID, and PDF URL from that row, downloads the PDF from Drive, re-sends it via `emailInvoiceToClient_`, and stamps "Re-sent" in the Email Status column. | Reads Consolidated_Ledger. Downloads PDF from Drive. Sends email to client + staff. Updates Email Status column. | P4a (reissueInvoice path) |

#### Category: helper-sheet-io

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `CB13_groupInvoicesFromSelected_` | Takes the headers + selected rows from Unbilled_Report and groups them into invoice buckets. Default: one invoice per client. If a client has "Separate by Sidemark" enabled (looked up via `CB13_readSeparateBySidemarkSetting_`), the function splits that client into one invoice per sidemark instead. Preserves the original row order. | Reads CB Clients tab and (fallback) client Settings tab. | internal-helper |
| `CB13_indexHeadersNorm_` | Builds a header-name → column-index lookup from a header row, using lowercase trimmed keys. (Same purpose as `CB13_indexHeadersNormalized_` in another file.) | None (pure mapping). | internal-helper |
| `CB13_norm_` | Lower-cases and trims a string for case-insensitive matching. (Duplicate of the helper in CB13 Unbilled Reports.js — both files declare it.) | None (pure string normalization). | internal-helper |
| `CB13_pickHeaderIdx_` | Given a normalized header-map and candidate header names, returns the column index of the first one found. (Same purpose as `CB13_pickHeader_` in another file.) | None (pure lookup). | internal-helper |
| `CB13_readSeparateBySidemarkSetting_` | Reads whether a particular client has "Separate by Sidemark" billing turned on. Checks the central CB Clients tab first (source of truth) and falls back to the client's own Settings tab if not found. Returns true/false. | Reads CB Clients tab and/or client Settings tab. | internal-helper |

---

### File: `AppScripts/Consolidated Billing Sheet/Claims.gs.js`

#### Category: claims

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `Claims_SetupSchema` | One-time menu setup for the Claims module. Creates five tabs: Claims (main), Claim_Items, Claim_History, Claim_Files, and Claims_Config. Renames old single-tab Claims column names to the new schema non-destructively (no data lost). Seeds default dropdown values (coverage types, outcomes, resolutions) into Claims_Config. Shows a setup-complete alert with next-step instructions. | Creates/updates Claims, Claim_Items, Claim_History, Claim_Files, Claims_Config tabs. UI alert. | internal-helper (claims schema is already in place; this is one-shot setup) |

---

### File: `AppScripts/Consolidated Billing Sheet/Client_Onboarding.js`

#### Category: admin

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `StrideAddWhseEmailToAllClients` | One-shot menu utility. Walks every active client, finds the NOTIFICATION_EMAILS setting on that client's Settings tab, and appends whse@stridenw.com if it's not already there (case-insensitive). Idempotent. Shows a per-client report. | Reads/writes every active client's Settings tab. UI alert. | internal-helper |
| `StrideMigrateClientsTab_v140` | One-time migration tool. Moves config values (Template ID, Parent Folder ID) from rows 1-3 of the Clients tab to the CB Settings tab, then deletes those rows so Clients has headers on row 1 and data on row 2+. | Moves config values to CB Settings tab. Deletes rows from CB Clients tab. | internal-helper |
| `StrideSyncSettingsToClient` | Menu command. For every client row the operator highlighted on the Clients tab (supports Ctrl-click multi-select), re-pushes the settings (folder IDs, billing flags, terms, discounts, etc.) from the CB Clients row to that client's own Settings tab via `writeSettingsToClientSheet_`. Shows a per-client report. | Reads CB Clients tab. Writes per-client Settings tab. UI alert. | P5 (part of `onboardClient`) |

#### Category: client-onboarding

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `autoCreateUserOnOnboard_` | After onboarding, automatically appends a row to the CB Users tab with the new client's email, role=client, Active=TRUE (ready to log in), and the new spreadsheet ID. Skips if a user with that email already exists. Triggers `sendUserActivationNotification_` to inform admins. | Writes to CB Users tab. Sends notification email. | P5 |
| `handleOnboardEditTrigger_` | The trigger that runs when someone checks the "Run Onboard" box on a CB Clients tab row. Validates the row has a Client Name and no existing spreadsheet ID, then calls `onboardNewClient_` to do all the work, then sends the onboard notification email, the welcome email to the client, and auto-creates their user account. On failure unchecks the box so they can retry. | Reads CB Clients tab. Calls onboarding chain (creates Drive folders, copies template, writes settings, imports inventory, sends emails, creates user). | P5 (`onboardClient`) |
| `obBuildRow_` | Helper used during inventory import. Given a header→column map and a key-value object, returns a row array with values placed in the right columns and blanks elsewhere. | None (pure array build). | internal-helper |
| `obGetHeaderMap_` | Helper used during inventory import. Reads row 1 of a sheet and returns a header-name → 1-based-column-index map. | Reads one sheet's header row. | internal-helper |
| `obImportSheetRows_` | The per-tab worker for inventory import. Reads rows from one source tab in the old spreadsheet, fuzzy-matches column names, converts cubic-feet sizes to class letters, picks out items receiving/release dates, builds the new Inventory rows, and for items marked as "needs assembly" also builds Tasks rows. Skips already-imported IDs and skips released items released before 2026. Batch-writes everything to the new client sheet. | Reads old client spreadsheet. Writes to new client's Inventory + Tasks tabs. | P5 |
| `obLoadClassMap_` | Helper used during inventory import. Tries to load class size definitions (XS=10 cuft, S=25, etc.) from the new client's Class_Cache tab, or fetches from the linked Master sheet, or falls back to hardcoded defaults. Returns a class → cubic-volume map. | Reads new client's Class_Cache or Master Class_Map. | internal-helper |
| `obSizeToClass_` | Helper. Given a cubic-feet number and a class→volume map, finds the class letter whose volume is nearest to the input. Used when a source spreadsheet has a numeric size but the new system wants XS/S/M/L/XL. | None (pure math). | internal-helper |
| `onboardImportInventory_` | Bulk inventory import during onboarding. Given the new client's spreadsheet ID and a URL to their old spreadsheet, opens the old spreadsheet, walks every sheet tab that looks like inventory ("Active Stock", "Released Items", etc., skipping templates/forms/billing), and imports each row into the new client's Inventory tab. For items needing assembly it also creates assembly Tasks. Creates a placeholder "SHP-MIGRATED-..." shipment row. Returns counts of imported / skipped / tasks created. | Reads old client spreadsheet. Writes to new client's Inventory, Tasks, Shipments tabs. | P5 |
| `onboardNewClient_` | Core onboarding logic. Reads the template ID and parent-folder ID from CB Settings; creates a client folder + Photos + Invoices subfolders in Drive; copies the inventory template; writes settings into the new client's Settings tab; stamps the IDs back onto the CB Clients row (spreadsheet ID, folder IDs, Active=true); and optionally imports inventory from a provided old-spreadsheet URL. Returns the import result. | Reads CB Settings + Clients row. Creates Drive folders. Copies template spreadsheet. Writes new client's Settings tab. Writes back to CB Clients row. Optionally imports inventory. | P5 (`onboardClient`) |
| `writeSettingsToClientSheet_` | Helper used by both onboarding and sync. Opens the new (or existing) client spreadsheet's Settings tab and writes folder IDs (DRIVE_PARENT_FOLDER_ID, MASTER_ACCOUNTING_FOLDER_ID, PHOTOS_FOLDER_ID), the back-reference to CB (CONSOLIDATED_BILLING_SPREADSHEET_ID), and every value from the CB Clients row (CLIENT_EMAIL, FREE_STORAGE_DAYS, discounts, payment terms, billing toggles, QB_CUSTOMER_NAME, etc.) using a column-name → settings-key map. Fills in defaults for blank fields. Adds keys if missing, updates if present. | Reads CB Clients row. Writes new client's Settings tab. | P5 |

#### Category: email

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `sendOnboardNotificationEmail_` | After onboarding succeeds, sends a branded HTML email to email@stridenw.com with the new client's name, a link to the new spreadsheet, and a numbered "next step" to open and authorize the spreadsheet. Used so warehouse staff know a new client is ready. | Sends Gmail from whse@stridenw.com to email@stridenw.com. | P5 (or stays as a notification side-effect of `onboardClient`) |
| `sendUserActivationNotification_` | Sends an internal admin notification email after `autoCreateUserOnOnboard_` creates a user. Pulls OWNER_EMAIL from CB Settings, addresses to whse@stridenw.com + owner, includes the client name, email, role, sheet link, and a "ready to log in at mystridehub.com" message. | Reads CB Settings. Sends Gmail from whse@stridenw.com. | P5 |
| `sendWelcomeEmailFromCB_` | Right after onboarding, sends the new client a branded welcome email using the WELCOME_EMAIL template from the Master Email_Templates tab if available (else a simple fallback). Resolves recipients from the template's Recipients column (supports `{{STAFF_EMAILS}}` and `{{CLIENT_EMAIL}}` tokens), de-duplicates, then sends from whse@stridenw.com. | Reads new client's Settings + Master Email_Templates. Sends Gmail to client and staff. | P5 |

#### Category: helper-misc

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `getCBSettingValue_` | Reads a value from the CB Settings tab by key name. Returns empty string if not found. Used by onboarding to fetch CLIENT_INVENTORY_TEMPLATE_ID and CLIENT_PARENT_FOLDER_ID. | Reads CB Settings tab. | internal-helper |
| `isTruthy_` | Helper that returns true if a value is boolean true, the string "TRUE" (any case), or the number 1. Inlined in this file because `truthy_()` lives in Code.gs but wasn't reliably loaded in trigger context (BUG-004). | None (pure check). | internal-helper |

#### Category: helper-sheet-io

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `getActiveClients_v2_` | Reads the CB Clients tab and returns an array of `{name, id}` for every row where Client Name and Client Spreadsheet ID are filled and Active is true. The "v2" version uses the v1.4.0 layout (headers on row 1, data on row 2+). Used by nearly every cross-client function. | Reads CB Clients tab. | internal-helper |

---

### File: `AppScripts/Consolidated Billing Sheet/Code.gs.js`

#### Category: admin

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `CB13_clearUnbilledReport` | Menu command. Asks for confirmation, then deletes every data row from the Unbilled_Report tab (preserves the header). Used to start fresh. | Clears CB Unbilled_Report data. UI prompt. | internal-helper |
| `StrideBillingPhase3_AddMenu` | Adds the "Stride Billing (Phase 3)" menu with two items (Batch Print Invoices, Rebuild PDFs) plus an "Install OnOpen Menu Trigger" item. One-shot menu installer. | Adds UI menu. | internal-helper |
| `StrideBillingPhase3_InstallOnOpenMenuTrigger` | Installs an onOpen trigger that re-adds the Phase 3 menu every time the spreadsheet is opened, so the menu doesn't disappear after a refresh. Deletes any existing trigger of the same name first. | Creates/replaces script trigger. | internal-helper |
| `StrideBillingPhase3_OnOpenAddMenu_` | The trigger function called by the Phase 3 onOpen trigger. Re-adds the Phase 3 menu. | Adds UI menu. | trigger |
| `StrideBillingSetup` | One-time menu setup. Creates all CB tabs (Settings, Clients, Unbilled_Report, Consolidated_Ledger, Invoice_Review, Locations, Users) with headers, seeds owner-email and IIF-folder keys in Settings, and shows an alert with next-step instructions. Safe to re-run. | Creates/updates Settings, Clients, Unbilled_Report, Consolidated_Ledger, Invoice_Review, Locations, Users tabs. UI alert. | internal-helper |
| `StrideSafeUpdateHeaders` | Menu command. Non-destructively updates headers on Consolidated_Ledger and Invoice_Review — renames "Ledger Entry ID" → "Ledger Row ID", appends any missing required headers. Skips Unbilled_Report because it's rebuilt each run. Shows a "what changed" alert. | Updates header row on Consolidated_Ledger and Invoice_Review. UI alert. | internal-helper |

#### Category: billing

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `StrideGenerateStorageCharges` | The main "Generate Storage Charges (STOR)" command. Asks for a start and end date, loads the per-class STOR rates from any client's linked Master Price List, then for every active client: reads their Inventory, finds items still in storage during the date range, applies the client's Free Storage Days, looks up class cubic-volume from Class_Cache, computes `qty × rate × cubic-volume × billable-days`, and writes one Billing_Ledger row per item with a unique STOR-{item}-{start}-{end} ID. Idempotent against already-finalized rows (Invoiced/Billed/Void). Clears existing Unbilled STOR rows in the date range first to allow regeneration. Holds a script lock so two operators can't double-charge. Shows a summary alert. | Reads every active client's Settings, Inventory, Billing_Ledger, Class_Cache. Loads STOR rates from Master Price_List. Writes Unbilled STOR rows to client Billing_Ledgers. UI alert. | P4a (`commitStorageCharges`) |
| `StrideGenerateUnbilledReport` | Phase-1 (legacy) unbilled-report command. Prompts the operator for an end date and an optional comma-separated list of service codes. For every active client, scans their Billing_Ledger for Unbilled rows with a date on/before the end date matching the service-code filter, stamps the rows with a `BATCH-{timestamp}` Batch ID, and appends matched rows to the CB Unbilled_Report tab in flushes of 5 clients at a time. Note: superseded by `CB13_generateUnbilledReport` which is the function the current menu wraps — this one is still in the file but not menu-invoked. | Reads every active client's Billing_Ledger. Stamps Batch IDs back to client Billing_Ledger. Writes to CB Unbilled_Report. UI alert. | retiring (Phase-1 path superseded by `CB13_generateUnbilledReport`) |

#### Category: client-onboarding

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `ensureLocationsSheet_` | Helper that creates the CB Locations tab if missing with a Location/Notes header. Used to hold the centralized warehouse-locations list that client sheets pull into Location_Cache. | Creates CB Locations tab. | internal-helper |
| `ensureUsersSheet_` | Helper that creates the CB Users tab if missing with 10 columns (Email, Role, Client Name, etc.), and installs dropdown validations for the Role (admin/staff/client) and Active (TRUE/FALSE) columns. | Creates CB Users tab. | internal-helper |

#### Category: entry-point

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `onEdit` | The CB spreadsheet's onEdit trigger. First delegates to `handleOnboardEditTrigger_` (handles "Run Onboard" checkbox). Then watches Consolidated_Ledger: if someone edits the Status, Invoice #, Rate, or Total cell on a row, it picks up the Client Sheet ID and Ledger Row ID from that row and calls `pushStatusToClientLedger_` to mirror the change down to that client's own Billing_Ledger — the two-way ledger sync. | Reads Consolidated_Ledger. Calls `pushStatusToClientLedger_` (writes to client Billing_Ledger). | P4b (Consolidated_Ledger retirement) / P7 (trigger decommission) |
| `onOpen` | Installs the "Stride Billing" menu in the spreadsheet UI when the file is opened. Menu items: Setup, Generate Storage Charges, Generate Unbilled Report, Clear Unbilled Report, Export to QuickBooks (IIF), Create & Send Invoices, Re-send Invoice Email, Sync Settings to Client, Add Whse Email to All Clients, Update Headers, Claims Setup. | Adds UI menu. | trigger |

#### Category: helper-format

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `addDays_` | Returns a new Date that is `days` after the input (positive or negative), normalized to midnight. | None (pure date math). | internal-helper |
| `dateDiffDaysInclusive_` | Returns the inclusive number of days between two dates (so May 1 to May 1 is 1 day, May 1 to May 2 is 2 days). Used for storage-day counting. | None (pure date math). | internal-helper |
| `escHtml_` | Escapes special HTML characters (&, <, >, ") so untrusted strings can be safely inserted into an HTML email/PDF body. | None (pure string escape). | internal-helper |
| `formatISO_` | Formats a Date as "YYYY-MM-DD". Returns empty for invalid input. | None (pure formatting). | internal-helper |
| `formatMMDDYY_` | Formats a Date as "MM/DD/YY" using 2-digit year. Returns empty for invalid input. Used in human-readable storage notes ("Storage 03/02/26 to 03/31/26"). | None (pure formatting). | internal-helper |
| `formatMoney_` | Returns a 2-decimal string for a numeric value, or "0.00" if not numeric. | None (pure formatting). | internal-helper |
| `formatYMD_` | Formats a Date as "YYYYMMDD" with no separators. Used inside the STOR task ID format. | None (pure formatting). | internal-helper |
| `maxDate_` | Returns the later of two dates. If one is null, returns the other. | None (pure date math). | internal-helper |
| `normalizeDateToMidnight_` | Coerces a value into a Date object set to midnight (00:00:00) so date comparisons work without time-of-day noise. Returns null on invalid input. | None (pure date math). | internal-helper |
| `parseDate_` | Parses a date string in "M/D/YY", "M/D/YYYY", "M-D-YY", "YYYY-M-D", or "YYYY/M/D" format and returns a Date object at midnight. Returns null if invalid. The main UI date prompts use this. | None (pure parsing). | internal-helper |
| `parseISODate_` | Deprecated alias for `parseDate_` — kept for backward compatibility. | None (pure parsing). | retiring |
| `sanitizeFileName_` | Strips characters that aren't allowed in filenames (`\ / : * ? " < > |`) and replaces them with spaces. | None (pure string clean). | internal-helper |

#### Category: helper-misc

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `clearAllProtections_` | Removes all sheet-level and range-level protections from a sheet. Used by setup if you need to drop existing locks before re-applying. | Removes protections from a sheet. | internal-helper |
| `safeUi_` | Returns the UI object (`SpreadsheetApp.getUi()`) if available; otherwise returns a stub with `alert` and `prompt` methods that log/toast instead. Lets functions work both from the menu and from background triggers without crashing on the "no UI" error. | Returns UI or stub. May toast. | internal-helper |
| `tryGetEmail_` | Tries to get the effective user's email, falling back to active user, falling back to empty string. Wrapped in try/catch because some trigger contexts can't read this. | None (pure read). | internal-helper |
| `truthy_` | Returns true if a value is boolean true, or string "true"/"yes"/"y"/"1"/"checked" (case-insensitive). | None (pure check). | internal-helper |

#### Category: helper-sheet-io

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `appendConsolidatedLedgerRow_` | Adds one row to the Consolidated_Ledger tab using a payload object (status, invoiceNo, client, dates, line-item fields). Maps payload fields to column positions via the current header row. After appending, if there's an invoiceUrl, sets the Invoice # and Invoice URL cells as clickable hyperlinks ("View Invoice"). | Reads/writes Consolidated_Ledger. | P4b |
| `batchWriteColumn_` | Writes a single value into multiple specific rows of one column, batching consecutive rows into one `setValues` call. Used to stamp Batch ID into all matched rows efficiently. | Writes to one sheet column. | internal-helper |
| `buildConsolLedgerIndex_` | Reads the full Consolidated_Ledger and returns a lookup: "clientSheetId||ledgerRowId" → physical row number. Used to find a row again when pushing status updates. | Reads Consolidated_Ledger. | internal-helper |
| `buildStorTaskId_` | Builds the canonical idempotency key for a storage charge: `STOR-{itemId}-{startYYYYMMDD}-{endYYYYMMDD}`. The same item charged for the same date range always gets the same ID, so re-running storage generation can't double-charge. | None (pure string build). | internal-helper |
| `ensureHeaderRowExact_` | Strictly enforces a sheet's header row to match a given list — overwrites if it doesn't, and clears extra trailing columns. Used for sheets where header positions are load-bearing (Consolidated_Ledger, Invoice_Review). | Writes to header row of a sheet. | internal-helper |
| `ensureHeaderRowSafe_` | Non-destructive header updater. Renames any legacy columns (e.g. "Ledger Entry ID" → "Ledger Row ID") and appends missing headers at the far right, but never reorders or deletes existing columns. Used so adding a column doesn't break existing data. | Writes to header row of a sheet. | internal-helper |
| `ensureReportHeader_` | Specific version for the Unbilled_Report tab — writes the standard report header if missing or wrong. | Writes to Unbilled_Report header row. | internal-helper |
| `ensureSheet_` | Returns a sheet by name, creating it (insertSheet) if it doesn't exist. The bread-and-butter helper. | Maybe creates a sheet. | internal-helper |
| `getActiveClients_` | Returns the list of active clients by delegating to `getActiveClients_v2_` (the v1.4.0 layout reader). Kept as a stable name; many functions still call this. | Reads CB Clients tab. | internal-helper |
| `getSetting_` | Reads a single value from a Key/Value sheet (Settings, Locations, etc.) by key name. Returns empty string if missing. | Reads one sheet. | internal-helper |
| `headerMapFromRow_` | Builds an uppercase-keyed header → column-index map from a header row, with "first occurrence wins" so duplicate column names don't break lookups. | None (pure mapping). | internal-helper |
| `readClientSettings_` | Reads a client's Settings tab (Key/Value rows 2+) into an uppercase-keyed lookup map. The standard way every CB function pulls client config (CLIENT_NAME, MASTER_RPC_URL, etc.). | Reads one client's Settings tab. | internal-helper |
| `readConsolidatedLedgerRow_` | Reads one specific row of Consolidated_Ledger by row number and returns it as a labelled object (status, invoiceNo, client, ledgerRowId, etc.). | Reads Consolidated_Ledger. | internal-helper |
| `setIfCol_` | Helper. If the column index is valid, writes a value into a row array at that position; extends the array if needed. Used by `appendConsolidatedLedgerRow_` to safely build a row regardless of header position. | None (pure array assignment). | internal-helper |
| `updateConsolidatedLedgerRow_` | Updates the Status and/or Invoice # fields on one Consolidated_Ledger row. Used by the approval flow. | Writes to Consolidated_Ledger. | P4b |

#### Category: invoicing

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `buildInvoiceHtml_` | Phase-2 invoice HTML builder. Wraps the line-item rows (Svc Code, Svc Name, Item ID, Description, Qty, Rate, Total) in an inline-styled table with a header "Stride Logistics — Invoice", the invoice number, client name, date, and a grand-total line. Returns the full HTML string. | None (pure string build). | retiring (P4a/P4b — superseded by Doc-template version in `CB13_commitInvoice`) |
| `buildInvoiceLineItemsHtml_Phase3_` | Phase-3 line-item HTML builder for the master-template approach — emits one `<tr>` per item plus an italic discount row if `discountAmt` is negative. | None (pure string build). | P4a |
| `buildInvoicePdfBlob_Phase3_` | Phase-3 PDF generator. If the master spreadsheet has an invoice HTML template, substitutes `{{INVOICE_NO}}`, `{{CLIENT_NAME}}`, `{{INVOICE_DATE}}`, `{{LINE_ITEMS_HTML}}`, `{{GRAND_TOTAL}}` tokens into it; otherwise falls back to `buildInvoiceHtml_`. Renders the HTML to a PDF blob via HtmlService. Used by the Batch Print menu. | Uses HtmlService → PDF conversion. | P4a (alongside `createInvoice`) |
| `buildSimplifiedInvoiceLineItemsHtml_Phase3_` | Phase-3 simplified line-item builder. Groups items by Svc Code and emits one summary row per group ("Warehouse Charges - Storage, 17 items, $1,234.56") instead of one row per line item. Used when client setting INVOICE_FORMAT = "SIMPLIFIED". | None (pure string build). | P4a |
| `emailInvoiceToClient_` | Helper. Reads the client's email, name, and notification emails from their Settings tab, then sends the invoice PDF via Gmail to both client and staff with HTML body "Hi {client}, your invoice {INV} is attached." Sender: whse@stridenw.com. | Reads client Settings. Sends Gmail. | P4a |
| `generateInvoicePdf_` | Phase-2 PDF generator. Builds HTML via `buildInvoiceHtml_`, creates a temporary Google Doc, overwrites its body with the HTML via Drive API, exports the Doc as PDF with 0.25" margins via the docs.google.com export URL, saves it to the CB Invoices folder, and trashes the temp Doc. | Creates temp Google Doc. Writes PDF to Drive. | retiring (P4a/P4b — superseded by `CB13_commitInvoice`'s Doc-template approach) |
| `getMasterIdFromAnyClientForTemplates_` | Helper for Batch Print. Walks the invoice groups and returns the first non-blank `MASTER_SPREADSHEET_ID` it finds in a client's Settings — used to locate the central invoice HTML template. | Reads client Settings. | internal-helper |
| `getNextInvoiceIdFromMasterRpc_` | Calls the Master Price List Web App (RPC) with `{action:"getNextInvoiceId", token}` and returns the next invoice number (e.g. "INV-000123"). The Master spreadsheet holds a global counter that's incremented atomically under a lock. Returns empty string on error. | HTTP POST to Master RPC URL. | retiring (superseded by `next_invoice_no()` Postgres SEQUENCE per v38.182) |
| `getOrCreateInvoicesFolder_` | Helper. Returns the "Invoices" subfolder of the CB spreadsheet's parent Drive folder; creates it if missing. Used as the default save location for invoice PDFs. | Reads/writes Drive folder. | internal-helper |
| `StrideApproveOrVoidInvoices` | Phase-2 menu command. For each row on Invoice_Review with Action filled in: Void → marks the matching Consolidated_Ledger row and the client's Billing_Ledger row as Void (clears Invoice #). Approve → groups by client, calls the Master RPC to get one invoice number per client, stamps that number on the IR rows + Consolidated_Ledger rows + client Billing_Ledger rows, generates the PDF, emails it. Holds a script lock. Shows a summary alert. | Reads Invoice_Review + Consolidated_Ledger. Calls Master RPC. Updates Consolidated_Ledger + client Billing_Ledgers. Generates PDF. Sends email. UI alert. | P4a (`createInvoice` + `voidInvoice`) |
| `StrideBatchPrintInvoices_Phase3` | Menu command. Prompts for invoice numbers (comma-separated, or "ALL") and rebuilds the PDFs for each matching invoiced group on Consolidated_Ledger using the master-template-or-fallback flow. Saves PDFs to the CB Invoices folder and to each client's own Invoices folder if their parent folder ID is set. Shows a summary alert. | Reads Consolidated_Ledger. Loads master template. Writes PDFs to Drive. UI alert. | P4a |
| `StrideGenerateInvoices` | Phase-2 menu command. Reads Consolidated_Ledger and copies all rows matching the operator's filter (ALL, by client, by svc code, by date range, or by client+date) into the Invoice_Review tab as a working queue, with an Action column the operator fills in with "Approve" or "Void". | Reads Consolidated_Ledger. Writes to Invoice_Review. UI prompts. | retiring (Phase 2 review-queue flow superseded by Unbilled_Report selection) |
| `tryGetClientInvoicesFolder_` | Helper. Opens a client's spreadsheet, reads their `DRIVE_PARENT_FOLDER_ID` setting, and returns/creates the "Invoices" subfolder inside it. Returns null if not set. | Reads client Settings. Reads/writes Drive folder. | internal-helper |
| `tryLoadInvoiceTemplateHtmlFromMaster_` | Helper for Batch Print. Reads the master spreadsheet's "Invoice_Templates" tab and returns the HTML body of the row keyed "INVOICE" or "DEFAULT", falling back to the first non-empty template. Empty string on error. | Reads Master Invoice_Templates. | internal-helper |

#### Category: pricing

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `loadClassVolumes_` | Reads a client's Class_Cache tab and returns a class → cubic-volume map (e.g. {XS:10, S:25, M:50}). Tolerates both "Cubic Volume" and "Storage Size" column names. Used by storage-charge calculation. | Reads client Class_Cache. | internal-helper |
| `loadStorRatesByClassFromAnyClient_` | Walks the active clients until it finds one whose Settings has `MASTER_SPREADSHEET_ID` filled, then opens that Master Price_List, finds the STOR row, and pulls out the per-class rates (XS Rate, S Rate, M Rate, etc.) into a map. Used so storage-charge generation can find rates without hard-coding the master ID in CB. | Reads client Settings → Master Price_List. | retiring (Supabase service_catalog table) |

#### Category: retiring

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `getConsolidatedTaskIdsForClient_` | Reads Consolidated_Ledger and returns the list of Task IDs that already belong to a given client. Previously used for dedup but the v1.3.1 architecture moved that responsibility — kept but effectively unused. | Reads Consolidated_Ledger. | retiring |
| `getMasterRpcFromAnyClient_` | Helper. Walks active clients and returns the first `{rpcUrl, rpcToken}` it finds in a client's Settings. Used by Phase 2 invoice approval to get a master RPC handle. | Reads client Settings. | retiring (RPC is being replaced by Postgres SEQUENCE) |
| `makeClientLedgerRowIdAllocator_` | Builds a thread-safe counter function for one client's Billing_Ledger. Each call returns the next ID ("BL-000123") and atomically increments the `BILLING_LEDGER_COUNTER` setting in the client's Settings tab under a script lock. Used by storage-charge generation to give every new row a unique Ledger Row ID. | Reads/writes client Settings (BILLING_LEDGER_COUNTER). | retiring (Supabase generates IDs server-side) |
| `pushStatusToClientLedger_` | Two-way sync. Opens a client's Billing_Ledger, finds the row whose Ledger Row ID matches, and updates that row's Status and/or Invoice # to match what's on CB Consolidated_Ledger. Used so editing the consolidated view propagates down to per-tenant sheets. | Reads/writes client Billing_Ledger. | retiring (P4b — direct Supabase writes replace the two-way sync) |

#### Category: trigger

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `CB13_addBillingStatusValidation` | Applies a dropdown validation (Unbilled / Invoiced / Void) to the Status column of the Unbilled_Report tab so operators can only set valid values. Skips if neither "Status" nor "Billing Status" header exists. Called at the end of unbilled-report generation. | Writes data-validation rule on Unbilled_Report. | internal-helper |

---

### File: `AppScripts/Consolidated Billing Sheet/Invoice Commit.js`

#### Category: helper-format

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `CB13_coerceDate_` | Turns a value into a Date — accepts real Date objects, "M/D/YYYY" strings, or anything `new Date()` can parse. Returns null if nothing works. (Same name as one in CB13 Unbilled Reports.js — both files declare it.) | None (pure conversion). | internal-helper |
| `CB13_escHtml_` | Escapes &, <, >, ", and ' for safe insertion into HTML/PDF. | None (pure string escape). | internal-helper |
| `CB13_fmtMMDDYYYY_` | Formats a Date as "MM-dd-yyyy" using the script timezone. Returns empty string for invalid; returns the raw string if input isn't a Date. | None (pure formatting). | internal-helper |
| `CB13_money_` | Returns a number as a 2-decimal string, defaulting to "0.00" for non-finite input. | None (pure formatting). | internal-helper |
| `CB13_num_` | Coerces a value to a number; returns NaN if not finite. | None (pure conversion). | internal-helper |

#### Category: helper-misc

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `CB13_extractColumn_` | Helper. Given an array of rows and a column index, returns the array of values from that column. | None (pure array op). | internal-helper |
| `CB13_firstNonEmpty_` | Helper. Given an array of rows and a column index, returns the first non-blank value found, or empty string. | None (pure array op). | internal-helper |
| `CB13_moveFileToFolder_` | Drive helper. Adds a file to a target folder and removes it from the Drive root. | Modifies Drive folder relationships. | internal-helper |
| `CB13_replaceToken_` | Replaces all instances of a `{{TOKEN}}` placeholder in an HTML string with a value. | None (pure string replace). | internal-helper |

#### Category: helper-sheet-io

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `CB13_findHeaderIdx_` | Same as CB13_pickHeader_ in another file — looks up a header column index by trying a list of candidate names case-insensitively. Returns null if none found. | None (pure lookup). | internal-helper |
| `CB13_findOrAddHeader_` | Like `CB13_findHeaderIdx_` but if no candidate exists, appends a new column to the right of the sheet using the supplied canonical name and returns its 0-based index. Used during commit to make sure Invoice #, Invoice Date, and Invoice URL columns exist on the client's Billing_Ledger. | Writes to sheet header row. May add columns. | internal-helper |
| `CB13_readClientSettingsMap_` | Reads a client's Settings tab Key/Value rows (starting row 2) into an uppercase-keyed map. Local copy to avoid cross-file dependencies. | Reads client Settings tab. | internal-helper |
| `CB13_readKeyValueSettings_` | Reads a named Settings sheet into a key → value map (using the original-case keys, unlike the uppercase version). Throws if the sheet is missing. | Reads one named sheet. | internal-helper |
| `CB13_writeKeyValueSetting_` | Helper. Writes a single key/value into a Settings sheet — updates the row if the key exists, otherwise appends. | Writes to one named sheet. | internal-helper |

#### Category: invoicing

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `CB13_buildLineItemsData_` | Builds the line items as structured row arrays (not HTML) for filling into the Google Doc template's table. Splits storage rows from non-storage rows: storage rows are grouped by sidemark (one summary row per sidemark with "Storage - {sidemark}", date range, total cubic feet, sum total); non-storage rows are emitted individually with date / service / item ID / notes / qty / rate / total. Returns `{rows, subtotal, storageSubtotal, servicesSubtotal}`. | None (pure data transformation). | P4a (used by `createInvoice`) |
| `CB13_buildLineItemsHtml_` | Older HTML-based line-items builder (kept for backward compat). Same storage-grouping logic as the Data version but emits styled `<tr>` rows directly. Returns `{htmlRows, subtotal, storageSubtotal, servicesSubtotal}`. | None (pure string build). | retiring (P4a — superseded by Doc-template + `CB13_buildLineItemsData_`) |
| `CB13_commitInvoice` | **The core invoice-creation engine** — counterpart to `handleCreateInvoice_` in StrideAPI. Takes one grouped invoice (one client, selected unbilled rows). Reads CB settings (MASTER_ACCOUNTING_FOLDER_ID, MASTER_RPC_URL/TOKEN, MASTER_SPREADSHEET_ID, INVOICE_TEMPLATE_NAME). Gets the next invoice number from the Master RPC. Reads the Google Doc invoice-template ID from Master Price List Settings (`DOC_INVOICE_TEMPLATE_ID`), copies the template, replaces tokens (`{{INV_NO}}`, `{{CLIENT_NAME}}`, `{{INV_DATE}}`, `{{PAYMENT_TERMS}}`, `{{DUE_DATE}}`, `{{SUBTOTAL}}`, `{{GRAND_TOTAL}}`), and fills the line-items table. Computes the due date from PAYMENT_TERMS (Net 15/30 etc.). Exports the Doc as PDF (0.25" margins), saves it to the client's invoice folder, copies it to the master accounting folder, and trashes the temp Doc. Then writes one Consolidated_Ledger row per item (with dedup), updates the client's Billing_Ledger rows to Invoiced (via `CB13_markClientLedgerRowsInvoiced_`), marks the Unbilled_Report rows Invoiced (via `CB13_markUnbilledRowsInvoiced_`), emails the PDF to the client (via `emailInvoiceToClient_`), and stamps the email-status back on Consolidated_Ledger. Validates that all rows belong to the same client (BUG B2 fix). Logs success/failure via `logBilling_`. Returns `{invoiceNumber, client, docUrl, pdfFile, emailStatus, duration}`. | Reads CB Settings, Master Price List Settings, client Settings, client Billing_Ledger. Calls Master RPC. Creates/trashes Google Doc. Writes PDF to client + master Drive folders. Writes Consolidated_Ledger. Writes client Billing_Ledger. Writes Unbilled_Report. Sends email. Writes Billing_Log. | P4a (`createInvoice`) |
| `CB13_createGoogleDocFromHtml_` | Legacy helper. Creates a Google Doc by uploading an HTML blob to Drive and asking the Advanced Drive Service to convert it. Used by the older HTML→PDF flow before the Doc-template approach. | Creates files in Drive via Drive.Files.copy. | retiring |
| `CB13_createInvoiceDocTemplate` | One-time menu command. Creates a brand-new Google Doc named "TEMPLATE - Invoice" laid out with header/billing/items/totals tables, sets 0.25" margins via the Docs API, leaves `{{TOKEN}}` placeholders in place, and writes the Doc ID to the Master Price List Settings tab as `DOC_INVOICE_TEMPLATE_ID`. Run once per environment to bootstrap the invoice-PDF template. | Creates Google Doc. Reads CB Settings. Writes to Master Price List Settings. UI alert. | internal-helper |
| `CB13_fetchInvoiceTemplate_` | Legacy helper. Reads the Master Price List "Invoice_Templates" tab and returns `{subject, html}` for the named template (falls back to the first row). Used only by the old HTML-based invoice flow. | Reads Master Invoice_Templates. | retiring |
| `CB13_getClientDiscounts_` | Reads a client's Settings tab for `DISCOUNT_STORAGE_PCT` and `DISCOUNT_SERVICES_PCT` (clamped to -10 to +10), returning `{storagePct, servicesPct}`. Negative means discount, positive means markup. (Note: in current architecture the discounts are applied at the client billing-ledger level, not at invoice time — this function is mostly informational now.) | Reads client Settings. | retiring |
| `CB13_getOrCreateClientInvoiceFolderId_` | Reads/writes a client's Settings to get their "Invoice Folder ID"; if missing, creates a Drive folder named "{Client} Invoices" and stores the ID. Returns the folder ID. | Reads/writes client Settings. May create Drive folder. | internal-helper |
| `CB13_getPreviewData` | Public alias for `CB13_getPreviewData_` — used by HTML/UI callers. | Reads ScriptProperties. | retiring |
| `CB13_getPreviewData_` | Reads the saved invoice-preview data from ScriptProperties under key `CB13_PREVIEW_DATA`. Returns an array. Used by the legacy "preview-first" invoice flow; the modern "Create & Send" flow bypasses ScriptProperties and passes the invoice object directly. | Reads ScriptProperties. | retiring |
| `CB13_markClientLedgerRowsInvoiced_` | For one client, opens their Billing_Ledger, finds every row whose Ledger Row ID is in the supplied list, and stamps Status=Invoiced, Invoice #, Invoice Date, Invoice URL on each. Adds the Invoice #, Invoice Date, Invoice URL columns if missing. Throws if no rows matched or required columns are missing. | Reads/writes one client's Billing_Ledger. | P4a |
| `CB13_markUnbilledRowsInvoiced_` | After an invoice is committed, walks the CB Unbilled_Report and stamps Status=Invoiced on every row whose (clientSheetId, ledgerRowId) matches one in the invoice. Skips rows already marked Invoiced. As of v1.5.0/v1.6.0 it **throws** if Unbilled_Report is missing required columns — previously a silent no-op that left the operator confused why the React Billing page still said "Unbilled". | Writes to Unbilled_Report. | P4b |
| `CB13_refreshUnbilledReport` | Walks the Unbilled_Report and physically deletes any row whose Status is "Invoiced" or "Void". Used to clean up after invoice commits. Tolerant of both "Status" and legacy "Billing Status" header. | Deletes rows from Unbilled_Report. | P4b |
| `CB13_rpcGetNextInvoiceId_` | HTTP POST to the Master Price List RPC URL with `{action:"getNextInvoiceId", token}`. Returns the next invoice number string (e.g. "INV-000123") from the response (tries `shipmentNo`, `id`, `invoiceId` fields). Throws on non-2xx or missing ID. | HTTP POST to Master RPC. | retiring (superseded by `next_invoice_no()` Postgres SEQUENCE per v38.182) |

---

### File: `AppScripts/Consolidated Billing Sheet/QB_Export.js`

#### Category: helper-format

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `CB13_qbExport_calcDueDate_` | Given an invoice date and a payment-terms string ("Net 30", "Net 15"), parses the Net number and returns invoice-date + N days formatted MM/DD/YYYY. Falls back to the invoice date if terms can't be parsed. | None (pure date math). | internal-helper |
| `CB13_qbExport_fmtDate_` | Formats a date value (Date object or parseable string) as "MM/DD/YYYY" for QuickBooks. Returns the raw value if it can't be parsed. | None (pure formatting). | internal-helper |
| `CB13_qbExport_iifEsc_` | Escapes a field value for IIF tab-delimited format. Replaces tabs and newlines with spaces, wraps in quotes and doubles internal quotes if a `"` is present. | None (pure string escape). | internal-helper |
| `CB13_qbExport_safeQty_` | Coerces a quantity value to a finite number, defaulting to 1 if blank/invalid. Avoids the trap where `0` is falsy but is a valid quantity in some cases. | None (pure conversion). | internal-helper |

#### Category: helper-sheet-io

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `CB13_qbExport_loadClientInfo_` | Reads the CB Clients tab and returns a lookup: `{clientName_upper: {terms, qbCustomerName}}`. Used so the export can fetch payment terms and the QB-side customer name (which may differ from the Stride client name) per row. | Reads CB Clients tab. | internal-helper |
| `CB13_qbExport_loadMapping_` | Reads the CB `QB_Service_Mapping` tab and returns a lookup: `{svcCode_upper: {qbAccount, defaultTerms, qbItemName}}`. Used so each Stride service code (STOR, INSP, etc.) maps to a QuickBooks income-account name and item name. | Reads CB QB_Service_Mapping tab. | internal-helper |

#### Category: iif-export

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `CB13_qbExport_buildStagingSheet` | Step 1 of the staging-sheet IIF flow. Reads Consolidated_Ledger for rows with Status=INVOICED and not already staged (dedup by Ledger Row ID), enriches each with QB Income Account, QB Customer Name (auto-appending sidemark for sub-customer matching: "Acme:Adler"), QB Item Name, payment terms, due date, and writes them to the `QB_Invoice_Export` tab with Status=Pending. Shows a confirmation alert. | Reads Consolidated_Ledger + QB_Service_Mapping + CB Clients. Writes to QB_Invoice_Export. UI alert. | P4b/P6 (replaced by `qboCreateInvoice` direct push) |
| `CB13_qbExport_generateIIF` | Step 2 of the staging-sheet IIF flow. Reads QB_Invoice_Export for rows with Status=Pending, groups them by invoice number, builds the IIF text (TRNS header line + SPL lines per item + ENDTRNS), saves the file to Drive (under the IIF_EXPORT_FOLDER_ID setting if set), and marks the rows Exported with a timestamp. Shows a result alert with instructions for importing into QB Desktop. | Reads QB_Invoice_Export + CB Settings. Creates IIF file in Drive. Updates QB_Invoice_Export. UI alert. | P4b/P6 |
| `CB13_qbExportCombined` | One-click "Export Highlighted to QuickBooks" — clears any existing Pending rows on QB_Invoice_Export, then runs `CB13_qbExport_buildStagingSheet` followed by `CB13_qbExport_generateIIF`. Holds a script lock. Auto-creates the staging sheets if missing. | Same effects as the two functions above combined. | P4b/P6 |
| `CB13_qbExportFromUnbilledSelection` | **The primary modern IIF export.** Reads the rows the operator highlighted on Unbilled_Report (supports Ctrl-click), skips Invoiced/Exported rows, groups by client (or client+sidemark when separate-billing is on), gets one invoice number per group via the Master RPC, builds the IIF file directly (no staging sheet), writes the deduplicated rows to Consolidated_Ledger as Invoiced, propagates the status down to each client's Billing_Ledger, marks the Unbilled_Report rows Invoiced, and saves the IIF to Drive (under IIF_EXPORT_FOLDER_ID if set). Backfills the Invoice # and Invoice URL columns on Consolidated_Ledger with hyperlinks to the IIF file. Holds a script lock. | Reads Unbilled_Report + QB_Service_Mapping + CB Clients + per-client Settings (for separate-by-sidemark). Calls Master RPC. Writes Consolidated_Ledger, client Billing_Ledger (via `pushStatusToClientLedger_`), Unbilled_Report. Creates IIF file in Drive. UI alert. | P4b/P6 (replaced by `qboCreateInvoice`) |

---

---

## Project: Master Price List

> Source: `AppScripts/Master Price list script.txt` (980 lines, single file)
> Deployment: bound to the Master Price List spreadsheet.
> Migration role: most functions `retiring` (the legacy invoice counter superseded by `next_invoice_no()` SEQUENCE) or `out-of-scope`.
> Function count: **18**.

### File: `AppScripts/Master Price list script.txt`

#### Category: admin

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `StrideMPL_ApplyOwnerProtections` | Menu command. Locks every sheet in the Master Price List spreadsheet so only the owner (OWNER_EMAIL from Settings) plus the running user can edit. Removes any pre-existing editor-modifiable protections first. Has an "orphan guard" that bails out if OWNER_EMAIL is blank or the active user can't be detected, so you can't lock yourself out. Shows a confirmation alert. | Reads Master Settings. Writes/removes sheet protections. UI alert. | internal-helper |
| `StrideMasterPriceSetup` | One-time menu setup. Ensures Settings, Price_List, Class_Map, Email_Templates, and Invoice_Templates tabs exist with proper headers, seeds default rows if any are empty, stores this spreadsheet's ID in ScriptProperties (for use by the Web App endpoints), and applies owner protections. Shows an alert with deploy-as-Web-App instructions. | Creates/updates 5 Master tabs. Writes ScriptProperties. Applies protections. UI alert. | internal-helper |

#### Category: client-onboarding

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `MPL_writeCache_` | Helper for `StrideMPL_SyncToAllClients`. Clears one destination cache tab in a client spreadsheet, writes the source data, and applies bold/dark header formatting. | Writes to one client cache tab. | internal-helper |
| `StrideMPL_SyncToAllClients` | Menu command. Reads Price_List, Class_Map, and Email_Templates from this Master spreadsheet, opens every active client (via the CB Clients tab — CB spreadsheet ID is in `CB_SPREADSHEET_ID` setting), and writes those three datasets into each client's `Price_Cache`, `Class_Cache`, and `Email_Template_Cache` tabs. Shows progress toasts and a final per-client report. | Reads Master Settings + CB Clients. Writes Price_Cache, Class_Cache, Email_Template_Cache on every active client. UI alert. | retiring (Supabase service_catalog and templates) |

#### Category: entry-point

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `doGet` | The Web App GET endpoint. Accepts `?token=...&action=...` query parameters and returns Master data as JSON. Validates the shared `MASTER_RPC_TOKEN` before opening any spreadsheet (quota protection on empty/bad tokens). Routes to `exportMasterData_` for actions: exportAll, exportPriceList, exportClassMap, exportEmailTemplates, exportInvoiceTemplates. Used by client scripts and other tools to refresh their local caches without using Apps Script openById reads. | Reads Master Settings + the requested sheet. HTTP response. | retiring (P6 / Supabase service_catalog API) |
| `doPost` | The Web App POST endpoint — the **racy sheet-backed counter** for generating IDs. Validates the shared token, takes a script lock, then either: `action="getNextShipmentId"` increments GLOBAL_SHIPMENT_COUNTER and returns `SHP-000123`; or `action="getNextInvoiceId"` increments GLOBAL_INVOICE_COUNTER and returns `INV-000123`. Defaults to `getNextShipmentId` if action is absent (v1.x compat). **Both counters are now retired** — invoice counter superseded by `next_invoice_no()` SEQUENCE (v38.182.0); shipment counter superseded by `next_shipment_no()` SEQUENCE (v38.206.0). StrideAPI no longer calls either, but the route stays in place for backward compat — the per-tenant client scripts' `nextGlobalShipmentNumber_` (Client Inventory/`Shipments.gs:522`) still hits this for direct-sheet receiving workflows. Full retirement is a P7 cleanup. | Reads/writes Master Settings counters. HTTP response. | retiring (both routes; full removal in P7) |
| `onOpen` | Installs the "Stride MPL" menu when the spreadsheet is opened: Setup / Refresh, Re-Apply Owner Protections, Sync to All Clients. | Adds UI menu. | trigger |

#### Category: helper-misc

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `createResponse_` | Helper. Wraps a JS object in a `ContentService` JSON response — used by every endpoint return. | None (pure response build). | internal-helper |
| `getMasterSpreadsheetForRpc_` | Web-App-safe spreadsheet opener. Tries the ID stored in ScriptProperties first (set by Setup), falls back to the active spreadsheet if running in container context. Throws if neither works. | Reads ScriptProperties. Opens spreadsheet. | internal-helper |
| `getSetting_` | Reads one value from the Master Settings tab by key name. Returns undefined if not found. | Reads Master Settings. | internal-helper |
| `lastNonEmptyIndex_` | Helper. Returns the last index in an array where the value is non-empty (uses `String(cell) !== ""`). Returns -1 if all empty. Used by `exportSheetAsRows_` to trim trailing empty columns. | None (pure array op). | internal-helper |
| `readSettingsMap_` | Reads the Settings tab into a key → value map. | Reads Master Settings. | internal-helper |
| `toNonNegativeInt_` | Helper. Parses a value as a non-negative integer; returns the fallback if blank, NaN, negative, or non-finite. | None (pure conversion). | internal-helper |
| `tryGetEmail_` | Tries to read the active user's email; returns empty on failure (common in Web App / trigger contexts). | None (pure read). | internal-helper |

#### Category: helper-sheet-io

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `ensureHeaderRow_` | Repairs row 1 of a sheet to match a given header array. Writes the headers if row 1 is empty; overwrites just row 1 (preserving data rows) if it doesn't match. Inserts extra columns first if the sheet is too narrow. | Writes to a sheet's header row. | internal-helper |
| `ensureSheet_` | Returns the named sheet, creating it if missing. | Maybe creates a sheet. | internal-helper |
| `hasNonHeaderData_` | Returns true if a sheet has any non-empty value below row 1. Used to avoid overwriting existing data when seeding defaults. | Reads a sheet. | internal-helper |
| `setupSettings_` | Writes the Master Settings tab's header row and seeds the 8 standard keys (OWNER_EMAIL, MASTER_LOGO_URL, GLOBAL_SHIPMENT_COUNTER, MASTER_RPC_URL, MASTER_RPC_TOKEN, MASTER_SPREADSHEET_ID, GLOBAL_INVOICE_COUNTER, CB_SPREADSHEET_ID) with their existing values (or sensible defaults) and notes describing each. Idempotent. | Writes Master Settings rows. | internal-helper |

#### Category: pricing

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `ensureEmailTemplatesSheet_` | Ensures the Email_Templates tab has the standard 4-column header (Template Key, Subject, HTML Body, Notes). **Effectively dead code** — email templates were moved to Supabase `email_templates` and no longer called from Master Price List (confirmed by Justin 2026-05-11). The "templates omitted from source" concern flagged in the previous inventory pass is moot. | Writes Email_Templates header (no longer read by anything). | retiring |
| `ensureInvoiceTemplatesSheet_` | Ensures the Invoice_Templates tab has the standard header and, if empty, seeds one default HTML invoice template keyed `INVOICE_HTML` with tokens `{{INVOICE_NO}}`, `{{CLIENT_NAME}}`, `{{INVOICE_DATE}}`, `{{DUE_DATE}}`, `{{LINE_ITEMS_HTML}}`, `{{TOTAL}}`, `{{LOGO_URL}}`. | Writes Invoice_Templates. | internal-helper |
| `exportMasterData_` | Router for the `doGet` Web App endpoint. Given an `action` string, returns the corresponding payload: exportAll (everything), exportPriceList, exportClassMap, exportEmailTemplates, exportInvoiceTemplates. Throws on unknown action. | Reads Master tabs. | retiring (P6) |
| `exportSheetAsRows_` | Helper. Reads a sheet and returns `{headers:[...], rows:[[...],...]}` trimmed to the last non-empty header column and trimmed at the bottom to the last non-empty row. Used to export Price_List and Class_Map cleanly as JSON. | Reads one Master sheet. | retiring (P6) |
| `exportTemplatesAsMap_` | Helper. Reads Email_Templates or Invoice_Templates and returns a map: `{TEMPLATE_KEY: {subject, body, notes}, ...}` keyed by the value in column A. | Reads one Master template sheet. | retiring (P6) |
| `seedPriceList_` | Helper. If Price_List is empty, writes 7 default rows (RCVG, INSP, REPR, STOR, DLVR, XFER, NOID) with class-time and class-rate columns filled in. Only called when the sheet is empty. | Writes default rows to Master Price_List. | internal-helper |

---

## Project: Client Inventory (per-tenant scripts)

> Source: `AppScripts/stride-client-inventory/src/` (13 .gs files, ~12000 lines)
> Deployment: identical code rolled out to **49 active client spreadsheets** via `npm run rollout`. Current versions: Code.gs v4.6.0, Import.gs v4.3.0, Triggers.gs v4.8.0, Emails.gs v4.8.2 (others vary — see file headers).
> Migration role: **P7 target** — when SB-primary handlers are fleet-wide, per-tenant scripts get frozen at a final v5.0.0 with write-handler stubs and the per-tenant sheet becomes a read-only mirror.
> Function count: **240**.

## File: `AppScripts/stride-client-inventory/src/AutocompleteDB.gs`

### Category: autocomplete

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| syncAutocompleteDB_ | Reads every row on the Inventory tab, collects every unique Sidemark / Vendor / Description value, and rebuilds the hidden Autocomplete_DB tab so warehouse staff get suggestions when typing those fields again. Merges with existing DB entries so manual additions are preserved. | Reads: Inventory. Reads/Writes: Autocomplete_DB. | P7 |
| logAutocompleteEntries_ | After a shipment is completed, scans the items just added and appends any new Sidemark / Vendor / Description values to the Autocomplete_DB tab. Skips silently if the DB tab is missing. | Reads/Writes: Autocomplete_DB. | P7 |
| getAutocompleteValues_ | Returns a sorted list of unique values for one autocomplete field (Sidemark / Vendor / Description), used to populate dropdown suggestions. | Reads: Autocomplete_DB. | P7 |
| StrideSyncAutocompleteDB | Menu entry point (Stride Admin → Sync Autocomplete DB). Shows a toast, ensures the DB tab exists, runs the full sync, then alerts the user with a count of new entries added. | Reads: Inventory. Reads/Writes: Autocomplete_DB. UI alerts. | P7 (entry-point) |
| ensureAutocompleteDBSheet_ | Creates the Autocomplete_DB tab if it doesn't exist, with frozen headers and styled formatting. Fixes the header row if it was corrupted. | Writes: Autocomplete_DB (creates/formats sheet). | P7 (helper-sheet-io) |
| readAutocompleteDB_ | Reads the existing Autocomplete_DB tab into a JS object keyed by field name (Sidemark / Vendor / Description), each pointing to a set of unique values. | Reads: Autocomplete_DB. | P7 (helper-sheet-io) |
| writeAutocompleteDB_ | Clears the Autocomplete_DB data rows and rewrites them sorted alphabetically by field, then re-applies the basic filter for browsing. | Writes: Autocomplete_DB. | P7 (helper-sheet-io) |

---

## File: `AppScripts/stride-client-inventory/src/Billing.gs`

### Category: billing

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| writeBillingRow_ | Adds one row to the Billing_Ledger tab for any billable event (receiving, task complete, repair, storage, will call). Applies the client's storage/services price adjustment (-100% to +100%) based on category, calculates the total, and adds rich-text hyperlinks on Shipment #, Task ID, and Repair ID cells when folder URLs are provided. | Reads: Settings. Writes: Billing_Ledger. | P5 |
| applyClientDiscount_ | Applies the client's price adjustment (discount or markup, -100% to +100%) to a base rate based on whether the service is Storage Charges or Whse Services. Reads DISCOUNT_STORAGE_PCT or DISCOUNT_SERVICES_PCT from Settings and rounds the result to two decimals. | Reads: Settings. | P5 (helper-misc) |
| lookupCategoryByCode_ | Looks up the Category (e.g. "Storage Charges" or "Whse Services") for a given service code from the Price_Cache tab. Used to decide which discount column to apply. | Reads: Price_Cache. | P5 (helper-misc) |
| lookupPriceFromMaster_ | Opens the master Price_List spreadsheet by ID and returns the rate, service name, category, and Bill-if-Pass/Bill-if-Fail flags for a service code and item class. Used by receiving billing as the authoritative lookup. | Reads: master Price_List spreadsheet (external). | P5 (helper-misc) |
| recalcUnbilledRates_ | Walks every Unbilled row in Billing_Ledger and recalculates the Rate, Total, and Svc Name using fresh Price_Cache data. Handles STOR rates (multiply by class cubic volume), applies client discount by category, and one-time-backfills missing Ledger Entry IDs. Also triggers `recalcPendingWillCallFees_` to update WC fees. Returns counts of total scanned and updated. | Reads: Price_Cache, Class_Cache, Settings. Writes: Billing_Ledger, Will_Calls, WC_Items. | P5 |
| recalcPendingWillCallFees_ | For every Will Call still Pending or Scheduled, recalculates each WC_Items WC Fee using the current WC rate for its class (with discount), then sums to update Total WC Fee on Will_Calls. Skips items already marked Released. | Reads: Settings, Price_Cache. Writes: WC_Items, Will_Calls. | P5 |
| loadStorRates_ | Loads STOR (Storage) rates per class (XS through XXL plus DEFAULT fallback) from the Price_Cache tab. Returns an object keyed by class letter. | Reads: Price_Cache. | P5 (helper-misc) |
| loadClassSizes_ | Loads cubic volume (cu ft) per class from Class_Cache. Returns object like `{ XS: 5, S: 15, M: 45, ... }`. Checks "Cubic Volume" first, falls back to "Storage Size". | Reads: Class_Cache. | P5 (helper-misc) |
| buildLastBilledMap_ | Scans Billing_Ledger for STOR (storage) entries and returns a map of Item ID → latest billing end date (parsed from the Notes field's "Storage: MM/DD/YY - MM/DD/YY" pattern). Used to know where storage billing should resume. | Reads: Billing_Ledger. | P5 (helper-misc) |
| parseDateInput_ | Parses a "MM/DD/YY" string into a Date object set to midnight. Returns null if invalid. | Pure function (no sheet access). | internal-helper |
| toDate_ | Converts a value (Date, string, or number) to a Date set to midnight. Returns null if invalid. | Pure function. | internal-helper |

---

## File: `AppScripts/stride-client-inventory/src/Code.gs`

### Category: entry-point

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| onOpen | Apps Script trigger that runs when the spreadsheet is opened. Builds three top-bar menus: "Stride Client" (visible to everyone), "Stride Warehouse" (admin only — daily ops), and "Stride Admin" (admin only — setup/management). Calls TR_addTransferMenuItem_ to inject the Transfer Items entry into the Warehouse menu. | Reads: Settings (admin emails). UI menus. | P7 |
| StrideClientSetup | Menu action: Initial Setup (Full Reset). One-time bootstrap that creates every tab from scratch (Settings, Dock Intake, Inventory, Shipments, Tasks, Repairs, Billing_Ledger, Will_Calls, WC_Items, Autocomplete_DB) with the correct headers, validations, dropdowns, and filters. Safety check: if data already exists on Inventory/Tasks/Repairs/Billing_Ledger, it routes to the non-destructive Update Headers instead so data isn't wiped. | Writes: every tab, Settings. UI alerts. | P7 |
| setupClientSettings_ | Builds the Settings tab from scratch with the standard rows (owner email, master spreadsheet ID, RPC URL, drive folder IDs, notification emails, client name/email, payment terms, timezone, AUTO_INSPECTION flag, discount percentages, sync status keys, etc.). Preserves any existing values, applies dropdown validations to PAYMENT_TERMS, ENABLE_SHIPMENT_EMAIL, ENABLE_NOTIFICATIONS, AUTO_INSPECTION, ENABLE_RECEIVING_BILLING. | Writes: Settings. | P7 (helper-sheet-io) |
| StrideClientUpdateHeadersAndValidations | Menu action: Update Headers & Validations. Safe (non-destructive) version of setup that renames legacy headers in-place, appends any missing columns, re-applies dropdowns and checkboxes, but never deletes data or reorders columns. The function clients run after a rollout. | Writes: every tab (headers + validations only), Settings. | P7 |
| hideAndWarnProtectInternalTabs_ | Hides the internal tabs (Settings, Billing_Ledger, Price_Cache, Class_Cache, Location_Cache, Setup_Instructions, Autocomplete_DB) and applies warning-only protection that prompts before manual edits but does NOT block script writes or onEdit triggers. | Writes: protections on internal tabs. | P7 (helper-sheet-io) |
| ensureMissingHeaders_ | Compares a sheet's header row against an expected list and appends any missing headers to the right (highlighted orange + white). Returns list of names added. | Writes: sheet header row. | P7 (helper-sheet-io) |
| renameHeaders_ | Renames column headers in-place without reordering them. Takes an array of [oldName, newName] pairs and only renames if old exists and new doesn't (avoids duplicates). | Writes: sheet header row. | P7 (helper-sheet-io) |
| ensureMissingSettings_ | Appends any missing key/value/notes rows to the Settings tab without clearing existing data. Used by the update headers flow to add new Settings keys to existing clients. | Writes: Settings. | P7 (helper-sheet-io) |
| clearSheetDataValidations_ | Clears all data validations on a sheet from a given start row downward. Used during setup before re-applying validations. | Writes: sheet data validations. | P7 (helper-sheet-io) |
| removeColumnsByName_ | Deletes columns whose header name exactly matches one of the names in the input list. Deletes right-to-left so column indexes don't shift. | Writes: sheet columns. | P7 (helper-sheet-io) |
| applyCheckboxToCol_ | Applies checkbox validation to a column from row 2 down. | Writes: sheet data validations. | P7 (helper-sheet-io) |
| applyPassFailFormatting_ | Applies conditional formatting to a column so "Pass" cells are green with white text and "Fail" cells are red with white text. Handles both upper and lower case. Removes any prior Pass/Fail conditional rules on the same column. | Writes: sheet conditional formatting. | P7 (helper-sheet-io) |
| applyCheckboxToColAtRow_ | Applies checkbox validation to a column starting at a specific row (used for Dock Intake items grid starting at row 11). | Writes: sheet data validations. | P7 (helper-sheet-io) |

### Category: helper-misc

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| CI_log_ | Structured logger wrapper around `Logger.log` that adds a level prefix (e.g. `[INFO] ...`). Detail string is appended after a pipe. | No sheet writes. | internal-helper |
| isAdminUser_ | Checks the current user's email against the comma-separated ADMIN_EMAILS setting. Returns true if user is an admin (or if no admin emails configured, or if the user email can't be determined). Used by onOpen to decide which menus to show. | Reads: Settings. | P7 (auth) |

---

## File: `AppScripts/stride-client-inventory/src/Emails.gs`

### Category: email

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| createItemFolder_ | Creates a named subfolder under the given parent Drive folder URL. Returns the new folder URL, or the existing folder's URL if one with the same name already exists. | Drive folder writes. | P7 (helper-misc) |
| createGoogleDocFromHtml_ | Converts an HTML string into a Google Doc using the Advanced Drive Service, returning the new doc's ID. Used as the first step in generating any PDF (Receiving, Work Order, Will Call Release). Throws if Advanced Drive Service isn't enabled. | Drive file creation. | P5 |
| exportDocAsPdfBlob_ | Exports a Google Doc as a PDF blob with custom margins (default 0.25 inches). First updates the doc's page margins via the Docs API, then hits the Docs export URL with margin query parameters. | Drive document modification + URL fetch. | P5 |
| findPdfInFolder_ | Looks inside a Drive folder for a PDF file whose name starts with the given prefix and returns it as a blob. Used to attach existing Receiving / Work Order PDFs to emails when re-sending. | Drive file read. | P5 (helper-misc) |
| sendTemplateEmail_ | The core email send function. Looks up the template (key, subject, HTML, recipients, optional doc attachment hint) from the local Email_Template_Cache tab, falling back to the master Email_Templates. Resolves all {{TOKEN}} placeholders, auto-generates entity deep-link tokens ({{TASK_DEEP_LINK}}, {{REPAIR_DEEP_LINK}}, etc.) from ID tokens, strips any hardcoded CTA button, self-heals broken deep-link URLs (route-style → query-param + &client= append), injects the single "Open in Stride Hub" button, attaches a PDF if specified, and sends via GmailApp from whse@stridenw.com. Falls back to `getFallbackTemplate_` if the template lookup fails. | Reads: Email_Template_Cache, Settings, master spreadsheet. Sends Gmail via GmailApp.sendEmail. | P5 |
| getDocTemplateHtml_ | Fetches a document template's HTML and title from Email_Template_Cache or the master Email_Templates tab. Returns `{ title, html, recipients }` or null if not found. Used as the source for Receiving, Task Work Order, Repair Work Order, and Will Call Release PDF generation. | Reads: Email_Template_Cache, master spreadsheet. | P5 (helper-misc) |
| resolveDocTokens_ | Replaces all `{{TOKEN}}` placeholders in an HTML string with the values from a tokens map. Used by every doc PDF generator. | Pure function. | P5 (helper-format) |
| getDefaultDocHtml_ | Returns hardcoded fallback HTML for one of DOC_RECEIVING, DOC_TASK_WORK_ORDER, DOC_REPAIR_WORK_ORDER, DOC_WILL_CALL_RELEASE. Used when the cached template is missing or has the wrong schema (e.g. pre-v4.3.0 Receiving template missing the Reference column). | Pure function. | P5 (helper-format) |
| buildSidemarkHeader_ | Builds a small "Project / Sidemark:" chip HTML block for client-facing emails when a sidemark is set. Returns empty string when no sidemark — so templates with `{{SIDEMARK_HEADER}}` don't show an empty label. Used by INSP_EMAIL, TASK_COMPLETE, REPAIR_QUOTE, REPAIR_COMPLETE, SHIPMENT_RECEIVED, WILL_CALL_* templates. | Pure function. | P5 (helper-format) |
| collectSidemarksFromRows_ | Scans a 2-D array of inventory rows and returns a comma-joined list of distinct Sidemarks. Used to emit `{{SIDEMARK}}` on multi-item emails like Shipment Received and Will Call Created. | Pure function. | P5 (helper-format) |
| buildItemsHtmlTable_ | Builds the HTML items table for the Shipment Received email — columns: Item ID, Qty, Vendor, Description, Sidemark, Reference. | Pure function. | P5 (helper-format) |
| buildSingleItemTableHtml_ | Builds a single-row HTML items table for emails that reference one item (Inspection, Repair Quote, etc.) — same column set as buildItemsHtmlTable_. | Pure function. | P5 (helper-format) |
| StrideResendEmail | Menu action: Re-send Email. Reads the selected Tasks/Repairs row, prompts the user to pick which email type to resend, rebuilds the tokens (including photos URL from the Task ID or Repair ID hyperlink), and calls sendTemplateEmail_. Supports INSP_EMAIL, REPAIR_QUOTE, REPAIR_APPROVED, REPAIR_DECLINED, REPAIR_COMPLETE, REPAIR_QUOTE_REQUEST. | Reads: Tasks, Repairs, Inventory, Settings. Sends email. UI alerts. | P5 (entry-point) |
| formatDateShort_ | Formats a Date or string as "MM/dd/yy". Used in Item History dialogs and email body dates. | Pure function. | internal-helper |
| StrideTestSendAll | Menu action: Test Send Emails & Docs. Opens an HTML modal letting the user pick which templates to send (12 emails + 4 document PDFs + welcome email). Each template is sent with synthetic sample tokens to verify rendering. | Reads: Settings. Sends test emails. UI dialog. | P5 (entry-point) |
| testSendAllTemplatesCallback | Server callback from the Test Send dialog. Builds sample token maps for each selected template, generates PDFs for DOC_* templates via getDocTemplateHtml_/getDefaultDocHtml_, and sends each email via either GmailApp.sendEmail (for docs/welcome) or sendTemplateEmail_ (for regular templates). Returns per-template success/failure for the dialog to display. | Sends test emails; creates temporary Drive docs that are then trashed. | P5 |
| getDefaultWelcomeHtml_ | Returns the hardcoded HTML for the WELCOME_EMAIL fallback. Branded onboarding email explaining how to access mystridehub.com, where the password reset link is, and what features the client portal supports. | Pure function. | P5 (helper-format) |
| StrideSendWelcomeEmail | Menu action: Send Welcome Email. Calls sendWelcomeEmail_ and shows a confirmation alert with the recipient email. | Sends email. UI alert. | P5 (entry-point) |
| sendWelcomeEmail_ | Fetches the WELCOME_EMAIL template from the master (or uses the embedded fallback), resolves recipients with {{STAFF_EMAILS}}/{{CLIENT_EMAIL}} substitution, replaces {{CLIENT_NAME}}/{{SPREADSHEET_URL}}/{{CLIENT_EMAIL}}/{{APP_URL}} tokens, and sends via GmailApp.sendEmail. | Reads: Settings, master spreadsheet. Sends email. | P5 |

---

## File: `AppScripts/stride-client-inventory/src/Import.gs`

### Category: import

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| StrideAddPhotosFolderSetting | One-time menu action for existing client sheets to add the PHOTOS_FOLDER_ID setting row (inserted after DRIVE_PARENT_FOLDER_ID). New clients get it automatically via setup. | Writes: Settings. UI alerts. | retiring |
| StrideImportInventory | Menu action: Import Inventory. Scans the spreadsheet for pasted-in ACTIVE STOCK / RELEASED ITEMS tabs from legacy client sheets, shows a confirmation summary of what was found, runs the import, then deletes the temp tabs. Also auto-syncs the Autocomplete DB after successful import. | Reads: Inventory, Settings, master spreadsheet. Writes: Inventory, Tasks, Shipments, Autocomplete_DB. Deletes temp source tabs. UI alerts. | P3 (entry-point) |
| getImportInventoryDialogHtml_ | Returns the HTML for the older modal-dialog version of the import workflow (Scan Local Tabs / Confirm Import buttons). Kept for reference; current path uses simple ui.alert confirms. | Pure function. | retiring |
| importInventoryScanLocal_ | Scans the local spreadsheet's tabs for ones matching ACTIVE STOCK / RELEASED ITEMS naming patterns. Builds a column-mapping preview comparing old headers to canonical Inventory headers and counts how many would be active/released/with-assembly. Returns the preview object. | Reads: every non-system tab in the spreadsheet. | P3 |
| importInventoryExecuteLocal_ | Executes the import. Loads the class map (Class_Cache or master Class_Map — no hardcoded fallback as of v4.5.0), generates an IMP-{timestamp} shipment number, loops every detected source tab via importSheetRows_, writes a Shipments row, hyperlinks Shipment # cells, deletes the temp tabs, and returns a summary message. | Reads: Class_Cache, master Price_List. Writes: Inventory, Tasks, Shipments. Deletes source tabs. | P3 |
| importSheetRows_ | Workhorse for importing a single pasted tab. Maps old headers to canonical names via fuzzy alias matching, extracts photo URLs from rich text / HYPERLINK formulas / plain text / notes, resolves class codes from numeric cuFt or word ("Small" → S), filters Released items to 2026+ only, creates ASM assembly tasks for items flagged "needs assembly", skips duplicates, batches Inventory writes, and applies rich-text hyperlinks pointing back to the legacy photo URLs. | Reads: source tab, Inventory, Tasks. Writes: Inventory rows, Tasks rows. | P3 |
| resolveImportClass_ | Resolves a legacy Class/Size cell value to a canonical class code (XS/S/M/L/XL/XXL). Handles numeric cuFt (e.g. 50 → M), direct codes, size words ("Small", "Extra Large"), strings with units ("50 cf"), and embedded class codes in mixed strings. Returns "" if no match. | Pure function. | P3 (helper-format) |
| sizeToClass_ | Finds the class code whose cubic volume is closest to the given cuFt number. Used as the final resolver for numeric size inputs. | Pure function. | P3 (helper-format) |
| loadClassMapForImport_ | Loads the class-name → cubic-volume map from the local Class_Cache, falling back to the master spreadsheet's Class_Map. Returns empty `{}` if neither is reachable so the import surfaces the misconfiguration rather than guessing. | Reads: Class_Cache, master spreadsheet. | P3 (helper-misc) |
| buildHeaderRow_ | Builds a row array sized to match the destination sheet's header map, with values placed at the correct column index based on header name. | Pure function. | internal-helper |
| backfillImpShipmentFolderUrls_ | Walks every IMP-* row on the Shipments tab and rewrites the Shipment # hyperlink to the real legacy photo URL pulled from a matching Inventory row's Shipment # rich-text link. Fixes a v4.2.3 regression where Import created an empty IMP folder under Shipments/ that the React app's folder button would open. Safe to re-run. | Reads/Writes: Shipments, Inventory. | retiring |
| backfillImpShipmentFolderUrls_Preview | Menu-friendly wrapper that calls backfillImpShipmentFolderUrls_(false) and shows the result in an alert. | UI alert. | retiring |
| backfillImpShipmentFolderUrls_Force | Menu-friendly wrapper that calls backfillImpShipmentFolderUrls_(true) and shows the result. | UI alert. | retiring |

---

## File: `AppScripts/stride-client-inventory/src/RemoteAdmin.gs`

### Category: entry-point

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| doPost | Web app endpoint hit by the `npm run remote` CLI tool. Validates a shared token, then dispatches to one of: health_check, update_headers, install_triggers, refresh_caches, sync_caches, sync_status, add_notification_email, get_script_id, or backfill_imp_folders. Returns JSON. | Reads: payload. Dispatches to other functions. | retiring |

### Category: admin

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| queueAsyncAction_ | Generic helper used by long-running remote actions. Deletes any stale trigger for the named handler, writes SYNC_STATUS=pending + queued timestamp + message to Settings, then creates a one-shot time-based trigger that fires in 30 seconds. Returns immediately so the HTTP caller doesn't time out. | Reads/Writes: Settings. Creates trigger. | retiring |
| runAsyncAction_ | Generic trigger runner. Self-deletes its own trigger, writes "running" status, executes the supplied work function, and stamps Settings with success/failed + completed timestamp + result message. | Reads/Writes: Settings. Deletes trigger. | retiring |
| StrideRemoteHealthCheck_ | Synchronous remote handler: returns whether required sheets (Inventory, Tasks, Repairs, Shipments, Will_Calls, WC_Items, Billing_Ledger, Settings) exist, whether optional cache sheets exist, current trigger count, and whether MASTER_SPREADSHEET_ID is set. | Reads: every sheet by name. | retiring |
| StrideRemoteInstallTriggers_ | Synchronous remote handler: runs StrideClientInstallTriggers and returns the resulting trigger list. | Creates triggers. | retiring |
| StrideRemoteUpdateHeaders_ | Synchronous remote handler that runs StrideClientUpdateHeadersAndValidations and post-verifies the Tasks header row to confirm the Custom Price column actually appeared. Reports which headers were added and stamps every response with REMOTE_ADMIN_VERSION + deployedKnowsCustomPrice debug flag. | Writes: every tab (headers + validations). | retiring |
| StrideRunUpdateHeaders_ | Legacy trigger handler kept for backwards compatibility with stale triggers created before v1.5.0 made update_headers synchronous. Self-deletes and runs StrideClientUpdateHeadersAndValidations. | Writes: every tab. | retiring |
| StrideRemoteRefreshCaches_ | Remote handler that queues the two-phase async refresh: Phase 1 sync caches + dropdowns, Phase 2 recalculate unbilled rates. | Creates trigger. | retiring |
| StrideRunRefreshCaches_ | Phase 1 trigger handler. Runs StrideClientSyncCachesOnly_, applies Class/Location dropdown validations, then queues Phase 2 (recalc) 30 seconds later. Self-deletes. | Reads/Writes: Settings, cache tabs. Creates trigger. | retiring |
| StrideRunRefreshCachesPhase2_ | Phase 2 trigger handler. Runs recalcUnbilledRates_ and stamps Settings with the final result. Self-deletes. | Writes: Billing_Ledger, WC_Items, Will_Calls, Settings. | retiring |
| StrideRemoteSyncCaches_ | Remote handler that queues a lightweight cache-only sync (no rate recalc, no dropdown rebuild). | Creates trigger. | retiring |
| StrideRunSyncCaches_ | Trigger handler that runs StrideClientSyncCachesOnly_ and stamps Settings with the result. Self-deletes. | Reads/Writes: caches, Settings. | retiring |
| StrideRemoteSyncStatus_ | Synchronous remote handler that reads the four SYNC_* Settings keys and returns them so the CLI can poll for completion. | Reads: Settings. | retiring |
| StrideRemoteAddNotificationEmail_ | One-shot remote handler: appends `whse@stridenw.com` to the NOTIFICATION_EMAILS setting if not already present (case-insensitive dedup). Used by `npm run` to backfill the internal warehouse email across all 49 clients. | Reads/Writes: Settings. | retiring |
| StrideRemoteGetScriptId_ | Returns the bound script's own ID via ScriptApp.getScriptId(), persists it to Settings._SCRIPT_ID, AND writes it to the Consolidated Billing Clients tab's SCRIPT ID column for this sheet's row. Authoritative self-report path. | Reads/Writes: Settings. Writes: CB Clients tab (external spreadsheet). | retiring |
| StrideRemoteBackfillImpFolders_ | Remote handler that calls backfillImpShipmentFolderUrls_ to fix the IMP-* Shipments hyperlinks. Returns scanned/updated/skipped counts. | Reads/Writes: Shipments, Inventory. | retiring |

---

## File: `AppScripts/stride-client-inventory/src/Repairs.gs`

### Category: repairs

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| createRepairRowFromTask_ | Called when an inspection task is completed with "Needs Repair" result. Creates a new Repairs row with status Pending Quote, copies item details from the source task, merges Result Notes + Task Notes into the Task Notes column, and records the Source Task ID for traceability. Idempotent — skips if a repair already exists for the same Source Task ID. | Writes: Repairs. | P4a |
| generateRepairWorkOrderPdf_ | Generates the "Repair Work Order" PDF after a repair is approved. Builds an HTML document from the DOC_REPAIR_WORK_ORDER template (or embedded fallback), looks up item details from Inventory, resolves tokens, converts to Google Doc, exports as PDF with 0.25" margins, and saves into the repair's Drive folder. Non-fatal on failure — toasts a warning. | Reads: Repairs, Inventory, Settings. Writes: Drive PDF in repair folder. | P5 |
| buildWorkOrderHtml_ | Composable HTML builder for Task/Repair Work Order PDFs. Builds header, client/date block, detail section, item table, and warehouse-use signature block. Takes a single `opts` object with type (TASK/REPAIR), client/date, item info, result options. (Note: this is a backup builder; the actual production path uses templates + getDefaultDocHtml_.) | Pure function. | P5 (helper-format) |
| createRepairRowFromInventory_ | Called when the user checks "Create Repair Quote" on an Inventory row. Creates a Repairs row with status Pending Quote, copies vendor / description / class / location / sidemark, looks up the most recent inspection task notes for the item, stamps Created By and Created Date, creates a Drive folder under Repairs/ named after the new Repair ID, and hyperlinks the Repair ID to the folder. | Reads: Tasks, Settings. Writes: Repairs. Drive folder creation. | P4a |
| cancelRepairFromInventory_ | Finds the most recent non-terminal (not Complete/Cancelled/Declined) repair for an Item ID and sets its status to Cancelled with a Completed Date stamp. Searches bottom-up so it cancels the latest. | Writes: Repairs. | P4a |

---

## File: `AppScripts/stride-client-inventory/src/Shipments.gs`

### Category: shipments

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| QE_StartNewShipment | Menu action: Start New Shipment. Clears the Dock Intake form fields (carrier/tracking/notes/date) and items grid, re-applies checkbox validations, re-applies the Class and Location dropdowns. If AUTO_INSPECTION is on, pre-checks the Needs Inspection box for the first 50 rows. | Writes: Dock Intake. UI alert (unless silent). | P2 (entry-point) |
| QE_CompleteShipment | Menu action: Complete Shipment. The big intake function — validates required fields, blocks duplicate Item IDs against Active inventory, calls Master RPC for next shipment number, creates a Shipments/<shipNo> Drive folder, writes Shipments + Inventory + Tasks rows, hyperlinks Shipment # cells, optionally writes RCVG (receiving) billing rows, generates a Receiving Document PDF (with self-healing schema guard for stale cached templates), sends the SHIPMENT_RECEIVED email with the PDF attached and Sidemark chip, logs new Sidemark/Vendor/Description values to Autocomplete_DB, and resets the dock form. | Reads: Settings, Inventory, Shipments, Dock Intake, Price_Cache. Writes: Inventory, Shipments, Tasks, Billing_Ledger, Dock Intake, Autocomplete_DB. Drive folder + PDF creation. RPC call to Master. Email send. | P2 |
| nextGlobalShipmentNumber_ | Calls the Master spreadsheet's RPC Web App with action `getNextShipmentId` to reserve a shipment number. **Lives in `Shipments.gs:522`. Still hits the racy Master-RPC counter as of 2026-05-11** — used by per-tenant direct-sheet dock-form receiving (rare/admin-only). The React-side path via StrideAPI `handleCompleteShipment_` has been migrated to the atomic Supabase SEQUENCE (v38.206.0); this client-side function is queued for the same migration in a future per-tenant rollout (likely P7 alongside the rest of the per-tenant freeze). | URL fetch to master RPC (racy). | P7 (still calls racy Master counter — migrate to Supabase `next_shipment_no()` in the same rollout that freezes per-tenant scripts at v5.0.0) |
| onShipmentReceived_ | Called from onShipmentEdit_ when a Shipments row's Status is set to "Received". Loads the shipment's items from Inventory, builds the items table HTML, and sends the SHIPMENT_RECEIVED email. (Note: this path is rarely used since intake sends the email directly via QE_CompleteShipment.) | Reads: Inventory, Settings, Shipments. Sends email. | P2 |
| getFallbackTemplate_ | Returns hardcoded subject + HTML body for an email template key (SHIPMENT_RECEIVED, INSP_EMAIL, TASK_COMPLETE, REPAIR_QUOTE, REPAIR_QUOTE_REQUEST, REPAIR_COMPLETE, WILL_CALL_CREATED, WILL_CALL_RELEASE, TRANSFER_RECEIVED, WILL_CALL_CANCELLED). Used as a safety net by sendTemplateEmail_ when the Email_Template_Cache lookup fails. Branded inline HTML matching production templates. | Pure function. | P5 (helper-format) |

---

## File: `AppScripts/stride-client-inventory/src/Tasks.gs`

### Category: tasks

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| nextTaskCounter_ | Scans existing Task IDs matching `TYPE-ItemID-*` (e.g. INSP-12345-) on the Tasks sheet and returns the next sequential counter (max+1). Also checks a pending-IDs array so a single batch creating multiple tasks for the same item doesn't collide. | Reads: Tasks. | P4a (helper-misc) |
| buildTaskRow_ | Builds a row array for inserting into the Tasks sheet — fills Task ID, Type, Status=Open, Item ID, Vendor, Description, Location, Sidemark, Shipment #, Created timestamp, Item Notes, Svc Code, Billed=false, Start Task=false. | Pure function. | P4a (helper-misc) |
| upsertTaskFromInventoryRow_ | Idempotent task creator: if a checkbox is checked, looks for an existing Open task of the given Svc Code + Item ID, and only inserts a new task if none exists. If the checkbox is unchecked and an open task exists, sets that task to Cancelled with a Cancelled At timestamp. Also refreshes the aggregated Task Notes on the Inventory row. | Writes: Tasks, Inventory. | P4a |
| ensureTasksDefaultFilter_ | Applies a filter on the Tasks sheet hiding Completed and Cancelled rows (so the default view only shows active tasks). Creates a new filter if none exists. | Writes: Tasks filter. | P4a (helper-sheet-io) |
| buildOpenTaskMap_ | Builds a lookup `{ "ItemID|SVCCODE": true }` of existing open (not Completed/Cancelled/Closed) tasks on the Tasks sheet. Used by batch task creation to skip items that already have an open task of that type. | Reads: Tasks. | P4a (helper-misc) |
| batchCreateTasks_ | Core engine for the menu-driven batch task creation. Validates the user has selected rows on the Inventory tab, builds the open-task lookup, loops the selection, skips rows where the item is blank / not Active / already has an open task of that type, and batch-writes all new task rows in one setValues call. Also updates aggregated Task Notes on Inventory for each affected item. Reports created vs skipped counts. | Reads: Inventory, Tasks. Writes: Tasks, Inventory. UI alerts. | P4a |
| StrideCreateInspectionTasks | Menu action: Create Inspections. Calls batchCreateTasks_("INSP", "Inspection") on the highlighted Inventory rows. | Calls batchCreateTasks_. | P4a (entry-point) |
| StrideCreateTasks | Menu action: Create Tasks. Validates a selection on Inventory, reads the Price_Cache for available service codes (excluding REPAIR/STOR/RCVG/WC/INSP), and shows an HTML modal with a checkbox per service type. On submit calls StrideCreateTasksCallback. | Reads: Inventory, Price_Cache. UI dialog. | P4a (entry-point) |
| StrideCreateTasksCallback | Server callback for the Create Tasks dialog. For each selected service code, loops the saved inventory selection, builds task rows with idempotency checks, and batch-writes them all in one go. Returns a per-type summary. | Reads: Inventory, Tasks. Writes: Tasks. | P4a |
| StrideSetReleaseDate | Menu action: Set Release Date. Validates the user has selected Inventory rows, then shows a small date picker HTML modal. Saves the selection in script properties for the callback. | Reads: Inventory. UI dialog. | P4a (entry-point) |
| StrideSetReleaseDateCallback | Server callback for the date dialog. Parses the date string, walks the saved selection, and for each row that isn't already Released/Transferred, sets Release Date and Status=Released. Returns a count summary. | Writes: Inventory. | P4a |
| startTask_ | Called from onTaskEdit_ when the "Start Task" checkbox is checked. Creates a per-task Drive folder under Tasks/{taskId}, hyperlinks the Task ID cell to the folder, stamps Started At, leaves the Start Task checkbox checked (signals task in-progress), and flips Status from Open to In Progress. Idempotent and retry-safe: re-uses existing folder if found. | Reads: Tasks, Settings. Writes: Tasks. Drive folder creation. | P4a |
| generateTaskWorkOrderPdf_ | Generates a Task Work Order PDF after a task starts. Looks up item details from Inventory, builds HTML from the DOC_TASK_WORK_ORDER template (with embedded fallback), converts to Google Doc, exports as PDF with 0.25" margins, and saves into the task folder. (Note: currently called only manually — production startTask_ does not generate task PDFs as of v4.3.0.) | Reads: Tasks, Inventory, Settings. Writes: Drive PDF. | P5 |

---

## File: `AppScripts/stride-client-inventory/src/Transfer.gs`

### Category: transfer

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| TR_addTransferMenuItem_ | Hook called from `onOpen` to add the "Transfer Items…" entry to the existing Stride Admin (now Stride Warehouse) menu without creating a second menu. | UI menu. | P5 (entry-point) |
| TR_sheetName_ | Looks up a sheet name from the global CI_SH constants, falling back to a string default if the constant is missing. Lets the transfer code work standalone. | Pure function. | internal-helper |
| StrideAdminTransferItems | Menu action wrapper. Just calls TR_openTransferDialog. | UI dialog. | P5 (entry-point) |
| TR_openTransferDialog | Validates the user has highlighted Inventory rows, builds the transfer context (selected items + destination clients from Consolidated Billing), and opens a modal HTML dialog. | Reads: Inventory. UI dialog. | P5 (entry-point) |
| TR_getTransferContext_ | Server-side context builder for the transfer dialog. Reads the active range list (supports Ctrl+click multi-select), pulls Item ID/Qty/Vendor/Description/Sidemark/Status for each unique item, filters out any rows already Status=Transferred, and fetches the list of active clients from the Consolidated Billing spreadsheet's Clients tab. Returns the context object for the dialog template. | Reads: Inventory, Settings, Consolidated Billing spreadsheet. | P5 |
| TR_executeTransfer | The big transfer function. Given a destination spreadsheet ID and list of Item IDs, copies Inventory rows to the destination (with conflict check for duplicate Active/On Hold items), transfers only Unbilled Billing_Ledger rows (reapplying the destination's client discount via reverse/forward math), transfers only Active Tasks and Repairs, recursively copies Drive photo folders into the destination's Drive parent, updates destination Tasks/Repairs/Inventory rows with the new photo URLs, voids source rows (Status=Transferred / Void / Cancelled / Complete) with notes explaining the transfer, and sends a TRANSFER_RECEIVED email to the destination client. Returns counts. | Reads/Writes: Inventory, Billing_Ledger, Tasks, Repairs in BOTH source and destination spreadsheets. Drive folder recursive copy. Sends email. | P5 |
| TR_getHeaders_ | Reads the first row of a sheet as the header array, trimmed. | Pure function. | internal-helper |
| TR_headerMap_ | Converts a headers array to a `{ HEADER_UPPER: 1-based-col }` map (uppercase keys so lookups are case-insensitive). | Pure function. | internal-helper |
| TR_cell_ | Reads a 1-based column from a row array, returning empty string if column is missing. | Pure function. | internal-helper |
| TR_getSettingValue_ | Reads a Settings value from a spreadsheet by key (used to read settings from either source or destination spreadsheets in the transfer flow). | Reads: Settings on supplied spreadsheet. | internal-helper |
| TR_listClientsFromConsolidated_ | Opens the Consolidated Billing spreadsheet, finds the Clients tab, scans for the header row containing both "Client Name" and "Active" columns (supports legacy layouts with config rows above headers), and returns a sorted list of `{name, spreadsheetId}` for all clients flagged Active=TRUE. | Reads: Consolidated Billing spreadsheet (external). | P5 (helper-misc) |
| TR_projectRowByHeaders_ | Projects a row from one sheet's column order to another sheet's column order by matching headers case-insensitively. Used to copy rows between source and destination whose columns may not be in the same order. | Pure function. | P5 (helper-misc) |
| TR_appendRows_ | Appends rows to a destination sheet, computing the next empty row by scanning columns A, B, and C (handles sheets where column A has dropdown validations that confuse getLastRow). | Writes: destination sheet. | P5 (helper-sheet-io) |
| TR_getByHeader_ | Reads a value from a row array by header name (case-insensitive). | Pure function. | internal-helper |
| TR_setByHeader_ | Writes a value into a row array by header name (case-insensitive). | Pure function. | internal-helper |
| TR_extractFolderId_ | Extracts a Google Drive folder ID from a URL using a regex that matches 25+ character IDs. Returns null if not found. | Pure function. | internal-helper |
| TR_copyFolderRecursive_ | Recursively copies a Drive folder and all its files and subfolders into a destination parent. Used during item transfer to bring photo folders along. | Drive folder + file copy. | P5 (helper-misc) |
| TR_buildTransferHtml_ | Builds the HTML for the transfer modal — a searchable destination client dropdown, an items preview table, a what-happens info box, Cancel + Confirm buttons, and embedded JS that calls TR_executeTransfer via google.script.run with a loading spinner overlay. | Pure function (HTML string). | P5 (helper-format) |

---

## File: `AppScripts/stride-client-inventory/src/Triggers.gs`

### Category: trigger

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| StrideClientInstallTriggers | Menu action: Install Triggers. Deletes any existing triggers for the 5 edit handlers and the timer, then installs onClientEdit, onTaskEdit_, onRepairEdit_, onShipmentEdit_, onWillCallEdit_ as onEdit triggers (no time-based timer anymore — task creation is menu-driven). | Creates onEdit triggers. UI alert. | P7 (entry-point) |
| reconcilePendingTasks_ | Decommissioned in v4.0.0 — was a time-based reconciler for the old checkbox-based task creation. Now self-removes its own trigger on next execution. | Deletes trigger. | retiring |
| onClientEdit | Big onEdit handler for the Inventory sheet. Reacts to: (1) Create Repair Quote checkbox check → creates a Repairs row + sends internal REPAIR_QUOTE_REQUEST email; (2) edits to sync fields (Item Notes, Task Notes, Repair Notes, Assigned To, Repair Vendor, Repair Result, Scheduled Date, Status, Location, Vendor, Description, Sidemark, Reference) → fans out to matching Tasks and Repairs rows by Item ID. v4.8.0 addition: Sidemark / Reference edits also propagate to the Unbilled Billing_Ledger rows for customized-schema clients (column-presence guarded; default-schema clients skip the billing write because they have no Sidemark/Reference column there per Decision #18). | Reads: Inventory, Settings. Writes: Tasks, Repairs, Billing_Ledger. May send email + create Repairs row. | P7 |
| syncFieldToInventory_ | Reverse-sync: when a field is edited on Tasks or Repairs, this writes the new value back to the Inventory row for that Item ID. Uses FIELD_NAME_TO_INVENTORY_ map for any field-name renames (e.g. Repair Notes → Item Notes). | Reads: Inventory. Writes: Inventory. | P7 |
| SH_headerMap_ | Shared helper (prefixed SH_ to share between Client Inventory and Task Board scripts). Builds a `{ Header: 1-based-col }` map from a sheet's first row. First occurrence wins on duplicates. | Pure function. | internal-helper |
| SH_getSetting_ | Shared helper: reads a Settings value by key. | Reads: Settings. | internal-helper |
| SH_findRowById_ | Shared helper: scans a column for a value and returns the row number it's in, or -1 if not found. | Pure function. | internal-helper |
| SH_truthy_ | Shared helper: returns true if value is "true", "yes", "1", "y", or "on" (case-insensitive). | Pure function. | internal-helper |
| SH_esc_ | Shared helper: HTML-escapes a string (&, <, >, "). | Pure function. | internal-helper |
| SH_formatCurrency_ | Shared helper: formats a number as fixed-2 currency string ("13.50"). | Pure function. | internal-helper |
| SH_mergeEmails_ | Shared helper: merges multiple comma-separated email lists, deduplicates, trims, returns comma-joined string. | Pure function. | internal-helper |
| SH_getLastDataRow_ | Shared helper: returns the last row of actual data on a sheet, scanning columns A/B/C (to ignore false/empty cells from dropdowns/checkboxes). | Pure function. | internal-helper |
| SH_findInventoryItem_ | Shared helper: looks up an item by Item ID on the Inventory sheet and returns its description/class/vendor/location/sidemark/shipNo/qty/room with the row number and raw row for further use. | Reads: Inventory. | internal-helper |
| SH_lookupRate_ | Shared helper: looks up a service code's rate / svcName / category / billIfPass / billIfFail flags from Price_Cache for a given item class. | Reads: Price_Cache. | internal-helper |
| SH_getItemFolderUrl_ | Shared helper: reads the item folder URL from the Item ID cell's rich-text hyperlink on the Inventory sheet. | Reads: Inventory. | internal-helper |
| SH_findPdfInFolder_ | Shared helper: scans a Drive folder for a PDF whose name starts with the given prefix, returns its blob. | Drive read. | internal-helper |
| SH_buildSidemarkHeader_ | Shared helper: same as buildSidemarkHeader_ in Emails.gs — builds the Project/Sidemark chip HTML for client-facing emails (INSP_EMAIL, TASK_COMPLETE, REPAIR_*, etc.). | Pure function. | internal-helper |
| SH_buildItemTableHtml_ | Shared helper: builds a 6-column HTML items table (Item ID, Qty, Vendor, Description, Sidemark, Room) for a single item by Item ID. Falls back to a minimal 2-column table if Inventory lookup fails. | Reads: Inventory. | internal-helper |
| SH_writeBillingRow_ | Shared helper: writes a row to Billing_Ledger with idempotency check (skips if a row with the same Ledger Entry ID already exists), increments BILLING_LEDGER_COUNTER for a sequential BL-NNNNNN ID, applies the client's storage/services price adjustment, and supports a totalOverride field for "Missing Rate" placeholders. Used by task completion and repair completion. | Reads/Writes: Settings, Billing_Ledger. | P5 |
| SH_sendTemplateEmail_ | Shared helper version of sendTemplateEmail_, lighter weight. Opens the master Email_Templates, resolves recipients with {{STAFF_EMAILS}}/{{CLIENT_EMAIL}} substitution, replaces tokens, and sends via GmailApp. Returns success/failure. | Reads: Settings, master spreadsheet. Sends email. | P5 |
| SH_getDocTemplateHtml_ | Shared helper: opens master Email_Templates and returns `{ title, html }` for a document template key. | Reads: master spreadsheet. | internal-helper |
| SH_getDefaultRepairWorkOrderHtml_ | Shared helper: hardcoded fallback HTML for the DOC_REPAIR_WORK_ORDER template (matches the production template). Used by SH_generateRepairWorkOrderPdf_ when the master lookup fails. | Pure function. | internal-helper |
| SH_createGoogleDocFromHtml_ | Shared helper version of createGoogleDocFromHtml_ — converts HTML to Google Doc via Advanced Drive Service, returns doc ID. | Drive file creation. | internal-helper |
| SH_exportDocAsPdfBlob_ | Shared helper version of exportDocAsPdfBlob_ — updates doc margins via Docs API then exports as PDF. | Drive document modification + URL fetch. | internal-helper |
| SH_generateRepairWorkOrderPdf_ | Shared helper that generates the Repair Work Order PDF using SH_ helpers only (so it's portable to the Task Board script). Looks up item details, builds tokens, resolves template, creates doc, exports PDF, saves to repair folder. | Reads: Repairs, Inventory, Settings. Drive PDF creation. | P5 |
| processTaskCompletionById_ | Shared handler for task completion. Acquires a script lock to prevent races, re-checks idempotency, sets Status=Completed and stamps Completed At, looks up the rate, decides whether to bill based on Result vs BillIfPASS/BillIfFAIL, writes a Billing_Ledger row (with "Missing Rate" handling if rate is 0), finds any Receiving Work Order PDF in the task folder, sends INSP_EMAIL or TASK_COMPLETE email to staff + client with Sidemark chip, updates aggregated Task Notes on Inventory, and (for Disposal-type tasks) also sets Release Date + Status=Released on the Inventory row. | Reads: Tasks, Inventory, Price_Cache, Settings. Writes: Tasks, Billing_Ledger, Inventory. Sends email. | P4a |
| processRepairCompletionById_ | Shared handler for repair completion. Sets Status=Complete + Completed Date, writes a REPAIR billing row using Final Amount (or Quote Amount if Final is blank/0), sends REPAIR_COMPLETE email to client with the work order PDF attached. | Reads: Repairs, Settings. Writes: Repairs, Billing_Ledger. Sends email. | P4a |
| processRepairQuoteById_ | Shared handler for quote-amount entry on a Repairs row. Sets Status from Pending Quote → Quote Sent, stamps Quote Sent Date, sends REPAIR_QUOTE email to the client. v4.7.1 update: photos URL falls back through 4 tiers (Repair ID hyperlink → Source Task ID hyperlink → Source Task row's Task ID hyperlink → Item folder) so the "View Inspection Photos" button always opens the inspection folder. | Reads: Repairs, Tasks, Inventory, Settings. Writes: Repairs. Sends email. | P4a |
| processRepairApprovalById_ | Shared handler for repair approval. Sets Status=Approved, creates a Drive folder under Repairs/{repairId}, hyperlinks the Repair ID cell to it, generates the work order PDF, stamps Approval Processed At, and sends REPAIR_APPROVED email to internal staff. | Reads: Repairs, Inventory, Settings. Writes: Repairs. Drive folder + PDF. Sends email. | P4a |
| processRepairDeclinedById_ | Shared handler for repair decline. Sets Status=Declined, sets the Approved column to "Declined", sends REPAIR_DECLINED email to internal staff. Does NOT create a task or billing row. | Reads: Repairs, Inventory, Settings. Writes: Repairs. Sends email. | P4a |
| SH_updateInventoryTaskNotes_ | Shared helper: rebuilds the aggregated Task Notes column on the Inventory row for one Item ID, listing every task for that item (newest first) as "TASKID (Result/Status): Notes" with the Task ID hyperlinked to its Drive folder. Called after task creation or completion. | Reads: Tasks. Writes: Inventory (Task Notes column with rich text). | P4a |
| onTaskEdit_ | onEdit handler for the Tasks sheet. Reacts to: (1) Start Task checkbox checked → calls startTask_ (creates folder, hyperlinks Task ID, stamps Started At, flips to In Progress); (2) Result column filled OR Status set to Completed → reverse-syncs item-level fields back to Inventory, then delegates to processTaskCompletionById_ for the full completion flow (billing + email + Inventory Task Notes update). | Reads: Tasks, Inventory, Price_Cache, Settings. Writes: Tasks, Billing_Ledger, Inventory. Drive folder + email. | P4a |
| onRepairEdit_ | onEdit handler for the Repairs sheet. Reacts to: (1) Quote Amount entered → processRepairQuoteById_; (2) Approved dropdown set to "Approved" → processRepairApprovalById_; (3) Approved set to "Declined" → processRepairDeclinedById_; (4) Repair Result set to Pass/Fail → processRepairCompletionById_; (5) Status set to Declined → processRepairDeclinedById_; (6) Status set to Complete (legacy) → stamps Completed Date. Also reverse-syncs item-level fields back to Inventory. | Reads: Repairs, Inventory, Settings. Writes: Repairs, Billing_Ledger, Inventory. Drive folder + email. | P4a |
| onShipmentEdit_ | onEdit handler for the Shipments sheet. When Status changes to "Received" (and wasn't previously), calls onShipmentReceived_ to send the SHIPMENT_RECEIVED email. | Reads: Shipments. Sends email. | P2 |
| onWillCallEdit_ | onEdit handler for the Will_Calls sheet. Reacts to: (1) Status changes → syncs the new status to all matching WC_Items rows; (2) Status set to Cancelled → sends WILL_CALL_CANCELLED email with items table + Sidemark chip; (3) Estimated Pickup Date entered while Pending → auto-flips status to Scheduled (and syncs to WC_Items). | Reads: Will_Calls, WC_Items, Inventory, Settings. Writes: Will_Calls, WC_Items. Sends email. UI toast. | P4b |
| verifyTriggers | Menu action: Verify Triggers. Reads the current list of project triggers, writes them as JSON into the `_TRIGGER_STATE` Settings row, also persists `_SCRIPT_ID` to Settings, and alerts the count. Used after rollout to record trigger health. | Reads: project triggers. Writes: Settings. UI alert. | P7 (entry-point) |
| resetTriggers | Menu action: Reset Triggers. Deletes ALL project triggers then re-runs StrideClientInstallTriggers. For when triggers are broken or duplicated. | Deletes + creates triggers. UI alert. | P7 (entry-point) |

---

## File: `AppScripts/stride-client-inventory/src/Utils.gs`

### Category: helper-sheet-io

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| findInventoryRowByItemId_ | Searches the Inventory sheet for a matching Item ID and returns the row's description, class, vendor, shipNo, location, status, qty, sidemark, room, the item folder URL (read from the Item ID rich-text hyperlink), the row number, and the raw row + invMap for further work. Returns null if not found. | Reads: Inventory. | P7 |
| getItemFolderUrl_ | Reads the item folder URL from the Item ID cell's rich-text hyperlink on the Inventory sheet for a given Item ID. Returns empty string if not found. | Reads: Inventory. | P7 |
| getEditableRanges_Settings_ | Returns the editable A1 ranges for the Settings sheet (just column B from row 2 down). Used by the (commented-out) protection helper. | Pure function. | retiring |
| getEditableRanges_DockIntake_ | Returns the editable ranges for the Dock Intake sheet — the form input cells B4-B7 plus the items grid below row 11, excluding the auto-filled Shipment # column. | Pure function. | retiring |
| getEditableRanges_Inventory_ | Returns editable ranges for the Inventory sheet — all cells except Shipment #, Shipment Photos URL, and Invoice URL columns. | Pure function. | retiring |
| getEditableRanges_Shipments_ | Returns editable ranges for the Shipments sheet — all cells except Shipment #, Shipment Photos URL, and Invoice URL. | Pure function. | retiring |
| getEditableRanges_Tasks_ | Returns editable ranges for the Tasks sheet — all cells except Task ID, Status, Completed At, Cancelled At, Billed, Svc Code (script-managed columns). | Pure function. | retiring |
| getEditableRanges_Repairs_ | Returns editable ranges for the Repairs sheet — all cells except Repair ID, Invoice ID, and Source Task ID. | Pure function. | retiring |
| getEditableRanges_BillingLedger_ | Returns editable ranges for Billing_Ledger — all cells except Invoice #, Total, Task ID, and Repair ID. | Pure function. | retiring |
| buildEditableRangesExcludingCols_ | Helper for the above editable-range builders. Given a start row, num rows, last column, and a list of locked column numbers, returns an array of Range objects covering all the non-locked columns in contiguous runs. | Pure function. | retiring |
| ensureSheet_ | Returns the sheet by name, creating it if it doesn't exist. | Writes: spreadsheet (may insert sheet). | P7 (helper-sheet-io) |
| writeHeaders_ | Writes a headers array to row 1 of a sheet with bold orange-background white-text formatting. | Writes: header row. | P7 (helper-sheet-io) |
| writeHeadersAtRow_ | Writes headers at a specific row (used for Dock Intake's row-10 headers since rows 1-9 are the form). | Writes: header row. | P7 (helper-sheet-io) |
| ensureHeaderRow_ | Non-destructive header update: renames legacy headers in-place via HEADER_RENAMES map, then appends any missing expected headers to the right. Never reorders or removes columns. | Writes: header row. | P7 (helper-sheet-io) |
| syncBillingHeadersFromConsolidated_ | Opens the Consolidated Billing spreadsheet, reads the Consolidated_Ledger header row, filters out CB-only columns (Client Sheet ID, Source Row, Email Status, Date Added, Invoice URL), and calls ensureHeaderRow_ on this client's Billing_Ledger to add any missing headers — keeps the client ledger in sync with the central ledger. | Reads: Consolidated Billing spreadsheet. Writes: Billing_Ledger headers. | P5 |
| hasNonHeaderData_ | Returns true if a sheet has any non-empty data below row 1. Used by Initial Setup to detect if the client already has data and route to Update Headers instead. | Reads: sheet data. | P7 (helper-sheet-io) |
| readSettingsMap_ | Reads the Settings sheet's Key/Value column pair into a JS object. | Reads: Settings. | P7 (helper-sheet-io) |
| applyCheckbox_ | Applies checkbox validation to one or more A1 ranges. | Writes: data validations. | P7 (helper-sheet-io) |
| getHeaderMap_ | Builds a `{ Header: 1-based-col }` map from a sheet's first row. First occurrence wins on duplicates. | Reads: sheet header row. | internal-helper |
| getHeaderMapAtRow_ | Same as getHeaderMap_ but reads headers from a specific row (used for Dock Intake's row-10 headers). | Reads: sheet header row. | internal-helper |
| maxColFromHeaderMap_ | Returns the highest column number in a header map (the rightmost named column). | Pure function. | internal-helper |
| getCellByHeader_ | Reads a cell from a row array by header name, returning a trimmed string. Returns "" if header is missing. | Pure function. | internal-helper |
| getCellByHeaderRaw_ | Reads a cell from a row array by header name, returning the raw value (Date, number, bool, etc. unchanged). Returns null if header is missing. | Pure function. | internal-helper |
| buildRowFromMap_ | Builds a row array sized to the header map, with values placed at the correct column index based on header name. Used for almost every write. | Pure function. | internal-helper |
| numOrBlank_ | Parses a value to a number, returns "" if NaN. | Pure function. | internal-helper |
| truthy_ | Returns true if value is true, "true", "yes", "y", "1", or "checked" (case-insensitive). | Pure function. | internal-helper |
| colA1Range_ | Builds an A1-notation range string for a single column between two rows on a sheet. | Pure function. | internal-helper |
| colA1RangeAtRow_ | Same as colA1Range_ but reads headers from a specific row. | Pure function. | internal-helper |
| toA1Col_ | Converts a 1-based column number to A1 letters (1→A, 27→AA). | Pure function. | internal-helper |
| getSetting_ | Reads a Settings value by key, trimmed. Returns "" if not found. | Reads: Settings. | P7 (helper-sheet-io) |
| setSetting_ | Writes a value to the Settings tab. If the key exists, updates column B; otherwise appends a new row. | Writes: Settings. | P7 (helper-sheet-io) |
| getOrCreateEntitySubfolder_ | Returns the entity subfolder ("Shipments" / "Tasks" / "Repairs" / "Will Calls") under DRIVE_PARENT_FOLDER_ID, creating it if missing. Used for the flat folder structure. | Drive folder. | P5 (helper-misc) |
| getLastDataRow_ | Returns the last row of actual content in column 1, scanning cols A/B/C to ignore false/empty cells from dropdowns or checkboxes. | Reads: sheet data. | internal-helper |
| tryGetEmail_ | Returns the active user's email if available, else empty string (safe — never throws). | Session call. | internal-helper |
| safeAlert_ | Wraps SpreadsheetApp.getUi().alert() with a try/catch fallback to Logger.log (useful when running from a trigger where UI isn't available). | UI alert or Logger. | internal-helper |
| clearAllProtections_ | Removes all sheet-level and range-level protections from a sheet. Used by the (commented-out) protection helper. | Writes: protections. | retiring |
| mergeEmails_ | Merges multiple comma-separated email lists into a deduplicated, trimmed, comma-joined string. | Pure function. | internal-helper |
| formatCurrency_ | Formats a number as a fixed-2 currency string ("13.50"). Returns the string version of the input if not a number. | Pure function. | internal-helper |
| esc_ | HTML-escapes a string (&, <, >, "). Aliased to escHtml_ so existing code can use either name. | Pure function. | internal-helper |
| isSafeHttpUrl_ | Returns true if a URL starts with http:// or https://. | Pure function. | internal-helper |

### Category: admin / setup

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| StrideClientSetup_Phase3 | Composite menu action: runs StrideClientSetup, builds Setup_Instructions, then refreshes Price/Class cache. | Runs setup + cache refresh. | P7 (entry-point) |
| StrideClientRefreshPriceClassCache | Menu action: Refresh Price/Class Cache. Opens the master Price_List spreadsheet, copies Price_List → Price_Cache, Class_Map → Class_Cache, Email_Templates → Email_Template_Cache, plus pulls the Consolidated Billing Locations tab → Location_Cache. Re-applies Class and Location dropdowns and recalculates rates on all Unbilled billing rows. Returns counts. | Reads: master spreadsheet, Consolidated Billing. Writes: every cache tab, dropdowns, Billing_Ledger. | P7 |
| StrideClientSyncCachesOnly_ | Lightweight remote-safe version of the cache refresh used by RemoteAdmin's async sync. Copies Price_Cache, Class_Cache, Email_Template_Cache, Location_Cache without running rate recalc or dropdown rebuild (so it doesn't hit the 6-minute timeout on large sheets). | Reads: master spreadsheet, Consolidated Billing. Writes: every cache tab. | P7 |
| StrideClientBuildSetupInstructions | Menu action: Update Setup Instructions. Just calls buildSetupInstructionsSheet_ and alerts the user. | Writes: Setup_Instructions. UI alert. | P7 (entry-point) |
| copySheetAsCache_ | Helper: clears a destination cache sheet and copies the entire src sheet contents into it, applying bold-dark-blue header styling and autoResizing the first 20 columns. | Reads: src sheet. Writes: dst sheet. | P7 (helper-sheet-io) |
| cleanStrayClassCacheRows_ | Helper: removes stray rows from Class_Cache where column A is blank or contains "url" — historical artifacts when Logo URL accidentally got copied into the class cache. | Writes: Class_Cache. | P7 (helper-sheet-io) |
| applyClassDropdownValidationFromCache_ | Applies a range-based data-validation rule on Inventory's Class column pointing at Class_Cache column A. Uses requireValueInRange (no 500-item limit) so it works on big sheets. | Reads: Class_Cache. Writes: Inventory validation. | P7 (helper-sheet-io) |
| applyServiceCodeDropdownFromCache_ | Applies a dropdown on Inventory's Task Type column listing service names from Price_Cache. Filters to services marked "Show In Task Type" = TRUE (or all if that column doesn't exist) and removes duplicates. | Reads: Price_Cache. Writes: Inventory validation. | P7 (helper-sheet-io) |
| lookupSvcCodeByName_ | Looks up a service code from a service name using Price_Cache. Returns the name unchanged if not found. | Reads: Price_Cache. | P7 (helper-misc) |
| lookupSvcNameByCode_ | Looks up a service name from a service code using Price_Cache. Returns the code unchanged if not found. | Reads: Price_Cache. | P7 (helper-misc) |
| buildSetupInstructionsSheet_ | Builds the Setup_Instructions tab — a pre-flight checklist (which Settings keys are filled), a quick-start sequence of menu actions, and a live snapshot of Inventory/Tasks/Repairs/Billing_Ledger headers. | Reads: Settings, every tab. Writes: Setup_Instructions. | P7 |
| joinHeaders_ | Helper: returns the headers of a sheet joined with " \| " for the setup instructions snapshot. | Reads: sheet header row. | P7 (helper-sheet-io) |

### Category: inventory / views

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| StrideViewActiveInventory | Menu action: View Active Inventory. Sets the Inventory filter to hide Released, On Hold, and Transferred rows. | Writes: Inventory filter. | P7 (entry-point) |
| StrideViewReleasedInventory | Menu action: View Released Inventory. Sets the filter to hide Active, On Hold, and Transferred rows. | Writes: Inventory filter. | P7 (entry-point) |
| StrideViewAllInventory | Menu action: View All Inventory. Removes the Status filter so every row is shown. | Writes: Inventory filter. | P7 (entry-point) |
| StrideRequestInspection | Client-facing menu action: Request Inspection. Validates the user has selected Inventory rows, then sets Task Type=INSP and checks Create Task on each row. Relies on the old onClientEdit trigger to actually create the tasks (removed in v4.0.0 — currently this function is partially orphaned since the Create Task column no longer exists). | Writes: Inventory. UI alert. | retiring |
| StrideViewItemHistory | Menu action: View Item History. Opens an HTML modal showing for the selected Inventory rows: the item header card (description, class, location, sidemark, status, shipment photos, inspection photos), Tasks (with results + photos links), Repairs (with status, result, amount, vendor, notes, photos), Billing (date, code, total, status, invoice #), and Will Calls (status, pickup party/date/notes, COD badge). Supports multiple selected items. | Reads: Inventory, Tasks, Repairs, Billing_Ledger, WC_Items, Will_Calls. UI dialog. | P4a (entry-point) |
| setInventoryStatusFilter_ | Helper: rebuilds the Inventory filter with a fresh full-sheet range and applies a "hidden values" criteria to the Status column. Recreating the filter each time ensures new rows always inherit the filter. | Writes: Inventory filter. | P7 (helper-sheet-io) |
| ensureInventoryDefaultFilter_ | Helper called from setup: applies the default filter (hides Released + On Hold) so the Inventory sheet opens to Active by default. | Writes: Inventory filter. | P7 (helper-sheet-io) |
| applyDockIntakeClassDropdown_ | Wires the Dock Intake Class column dropdown to Class_Cache column A using a range-based validation (no 500-item limit). | Reads: Class_Cache. Writes: Dock Intake validation. | P7 (helper-sheet-io) |
| applyLocationDropdownFromCache_ | Wires the Inventory Location column dropdown to Location_Cache column A using a range-based validation. Allows invalid entries so users can still type custom locations. | Reads: Location_Cache. Writes: Inventory validation. | P7 (helper-sheet-io) |
| applyDockIntakeLocationDropdown_ | Same as applyLocationDropdownFromCache_ but for the Dock Intake Location column. | Reads: Location_Cache. Writes: Dock Intake validation. | P7 (helper-sheet-io) |
| StrideFixMissingFolders | Menu action: Fix Missing Folders & Links. Confirms with the user, then scans Inventory/Tasks/Repairs/Shipments/Will_Calls for rows without rich-text hyperlinks on their ID columns and creates missing Drive folders + hyperlinks. (Note: per-item Drive folders are deprecated as of v3.5.0 — the function leaves Inventory Item ID hyperlinks unset.) | Reads/Writes: every operational tab. Drive folder creation. UI alerts. | P5 (entry-point) |
| applySmartFilterSort_ | Helper: rebuilds the filter on any sheet (so new rows are always included) and applies hidden-values or shown-values criteria for any number of columns, then optionally applies sort criteria. Used by the Default View menu actions. | Writes: sheet filter + sort. | P7 (helper-sheet-io) |
| StrideDefaultViewInventory | Menu action: Default View — Inventory. Filters out Released/On Hold/Transferred and sorts by Sidemark then Item ID. | Writes: Inventory filter + sort. | P7 (entry-point) |
| StrideDefaultViewTasks | Menu action: Default View — Tasks. Shows only Open status and sorts by Type then Created. | Writes: Tasks filter + sort. | P7 (entry-point) |
| StrideDefaultViewRepairs | Menu action: Default View — Repairs. Shows Pending Quote / Quote Sent / Approved / In Progress and sorts by Status then Scheduled Date. | Writes: Repairs filter + sort. | P7 (entry-point) |
| StrideClearFilters | Menu action: Clear Filters. Removes the filter on the currently active sheet. | Writes: active sheet (removes filter). | P7 (entry-point) |
| StrideCleanupItemPhotoFoldersDryRun | Menu action: Cleanup Item Photo Folders (dry run). Calls StrideCleanupItemPhotoFolders_(false). | Reports only. | P5 (entry-point) |
| StrideCleanupItemPhotoFoldersExecute | Menu action: Cleanup Item Photo Folders (execute). Calls StrideCleanupItemPhotoFolders_(true). | Trashes folders + strips hyperlinks. | P5 (entry-point) |
| StrideCleanupItemPhotoFolders_ | Walks the Photos parent folder for subfolders whose name exactly matches an Item ID from the Inventory tab. Empty matching folders are moved to Trash and the Item ID hyperlink on Inventory is stripped. Non-empty folders are skipped and reported. Writes a Cleanup_Report tab with action + counts per folder. Dry-run mode reports only. | Reads: Inventory. Writes: Inventory (strips hyperlinks), Cleanup_Report. Drive folder trashing. UI alerts. | retiring |

---

## File: `AppScripts/stride-client-inventory/src/WillCalls.gs`

### Category: will-calls

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| lookupRateByCodeAndClass_ | Looks up the numeric rate for a service code + item class from Price_Cache. Used to compute WC fees per item. Returns 0 if not found. | Reads: Price_Cache. | P4b (helper-misc) |
| generateWcNumber_ | Generates a will call number using the current timestamp: "WC-MMDDYYHHmmss". | Pure function (uses now). | P4b (helper-misc) |
| createWillCallFolder_ | Creates a per-WC Drive folder inside the Will Calls/ subfolder. Returns the folder URL or empty string on failure. | Drive folder creation. | P4b (helper-misc) |
| StrideCreateWillCall | Menu action: Create Will Call. Validates the user has selected one or more Inventory rows on the Inventory tab, supports Ctrl+click multi-select via getActiveRangeList, blocks if any selected item is already Released, blocks if any item is on an active (Pending/Scheduled) will call, calculates WC fees per item (with client discount), and opens an HTML modal collecting Pickup Party / Pickup Phone / Requested By / Created By / Estimated Pickup Date / Notes / COD flag and COD Amount. | Reads: Inventory, WC_Items, Will_Calls, Settings, Price_Cache. UI dialog. | P4b (entry-point) |
| StrideCreateWillCallCallback | Server callback from the Create Will Call dialog. Generates the WC number, creates the WC folder, decides initial status (Pending if no estDate, Scheduled if estDate), writes the Will_Calls row + every WC_Items row, hyperlinks WC Number on both tabs to the folder, and sends the WILL_CALL_CREATED email with Sidemark chip + items table + COD badge. | Reads: Inventory, Settings. Writes: Will_Calls, WC_Items. Drive folder + email + toast. | P4b |
| StrideProcessRelease | Menu action: Complete Will Call. Validates the user has selected a Will_Calls row, looks up the WC's unreleased items, and opens an HTML modal with a checkbox per item (Select All / Deselect All buttons) for partial-release support. | Reads: Will_Calls, WC_Items. UI dialog. | P4b (entry-point) |
| StrideProcessReleaseCallback | Server callback from the Release dialog. Splits items into releasing vs remaining, sets Release Date + Status=Released on each released Inventory row, writes a WC billing row per released item (unless COD), updates WC_Items statuses, updates the Will_Calls row to Released or Partial, on partial creates a new will call for the remaining items (moves WC_Items rows + generates a new release PDF for the new WC), generates the Will Call Release PDF for the original WC, and sends the WILL_CALL_RELEASE email with the PDF attached and partial note + Sidemark chip. | Reads: Will_Calls, WC_Items, Inventory, Settings. Writes: Inventory, Will_Calls, WC_Items, Billing_Ledger. Drive folders + 2 PDFs + email + toast. | P4b |
| buildWcItemsEmailTable_ | Builds the HTML items table for WC Created / Release / Cancelled emails — columns: Item ID, Vendor, Description, Sidemark, Reference. Backfills missing vendor/sidemark/reference from the Inventory tab when an ss is passed. | Reads: Inventory (optional). | P4b (helper-format) |
| StrideRegenerateWillCallDoc | Menu action: Regenerate Will Call Doc. Validates a row is selected on Will_Calls or WC_Items, reads the WC number, finds the folder URL from the Will_Calls row's hyperlink, and re-runs generateWillCallReleasePdf_. | Reads: Will_Calls. Drive PDF regeneration. UI alerts + toast. | P4b (entry-point) |
| generateWillCallReleasePdf_ | Generates the Will Call Release Document PDF. Reads the Will_Calls row + WC_Items rows, builds the COD banner if needed, an items table, the pickup party / phone / dates / notes blocks, resolves tokens against the DOC_WILL_CALL_RELEASE template (with embedded fallback), converts to Google Doc, exports as PDF with 0.25" margins, removes any old PDF in the folder with the same name, and saves the new one. Returns the PDF blob. | Reads: Will_Calls, WC_Items, Settings. Writes: Drive PDF in WC folder. | P4b |

---

## Project: Stax Auto Pay

> Source: `AppScripts/stax-auto-pay/StaxAutoPay.gs` (4,272 lines, single file)
> Deployment: standalone Apps Script project with time-driven trigger.
> Migration role: **P6 target** — daily auto-charge cron, becomes a scheduled Edge Function on `pg_cron`.
> Function count: **76**.

Stax Auto Pay is a standalone Apps Script project bound to its own Google Sheet. A time-driven trigger fires `runChargesAuto` once daily (around 9 AM Pacific). The script reads invoices imported from QuickBooks IIF files, pushes them to the Stax payment platform as Stax invoices, then charges the customer's saved card / ACH method on the due date. It also mirrors all sheet state into Supabase (`stax_invoices`, `stax_charges`, `stax_exceptions`, `stax_run_log`, `stax_customers`) so the Payments page in the React app shows the same data. `runStaxCharges` is the canonical P6 migration target per MIGRATION_STATUS.md.

### File: `AppScripts/stax-auto-pay/StaxAutoPay.gs`

#### Category: entry-point

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `onOpen` | Builds the "Stax Auto-Pay" menu on the spreadsheet so the operator can launch setup, imports, syncs, charge runs, exception review, pay-link sending, and trigger install/remove from the menu bar. Fires automatically when the spreadsheet is opened. | Spreadsheet UI menu. | P6 |
| `runCharges` | The "Run Charges Now" menu button. Locks the script, pushes any due-today PENDING invoices to Stax, then charges every CREATED invoice that's eligible, then pops up a results dialog and writes a run-log entry. Manual operator-driven equivalent of the daily cron. | Stax API, Invoices/Charge Log/Exceptions/Run Log sheets, Supabase mirrors. | P6 |
| `runChargesAuto` | The headless version of `runCharges` fired by the daily time-driven trigger. Same two-stage push + charge pipeline, but no UI alerts. Checks the AUTO_CHARGE_ENABLED config flag and bails if it's off. Logs everything to Run Log. | Stax API, Invoices/Charge Log/Exceptions/Run Log sheets, Supabase mirrors. | P6 |
| `setupSpreadsheetId` | One-time setup: stamps the active spreadsheet's ID into Script Properties under STAX_SPREADSHEET_ID. Required so the daily trigger can find the spreadsheet even when `getActiveSpreadsheet()` returns null (trigger-context fallback). Run manually once from the editor. | Script Properties. | P6 |
| `setupSheets` | The "Setup Sheets" menu button. Safe to re-run. Creates the Import, Invoices, Customers, Charge Log, Exceptions, Config, Run Log tabs if they don't already exist, and repairs broken header rows on existing tabs without deleting any data rows. Seeds Config defaults. | Spreadsheet tabs. | P6 |
| `resetOperationalSheets` | The "Reset Operational Sheets..." menu button. Destructive — wipes the Import, Invoices, Charge Log, Exceptions, and Run Log tabs after a confirmation dialog. Config and Customers are preserved. | Spreadsheet tabs (destructive). | P6 |
| `validateSheetsUI` | The "Validate Sheets" menu button. Runs the internal header validator and shows a popup listing any header/row mismatches found, or "All sheets are valid." | Spreadsheet UI dialog. | P6 |
| `deduplicateInvoices` | The "Deduplicate Invoices" menu button. Scans the Invoices tab for rows that share the same dedup key (invoice number + customer + amount + date), keeps the oldest one of each, deletes the rest after confirmation. Cleans up duplicates created by overlapping IIF and QB-export import paths. Resyncs to Supabase. | Invoices sheet (deletes rows), Supabase `stax_invoices` mirror. | P6 |

#### Category: stax

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `pullStaxCustomers` | The "Pull Customers (CB + Stax)" menu button. Reads all active clients from the Consolidated Billing Clients tab, clears the Customers tab, and rebuilds it by calling the Stax API for each client that has a Stax Customer ID. Flags clients missing a Stax ID with a "⚠ MISSING" marker. Mirrors results to Supabase. | Customers sheet, Stax API (GET /customer/{id}), Supabase `stax_customers`. | P6 |
| `autoPopulateCustomers` | Scans the Invoices tab and appends any QB Customer Name to the Customers tab that doesn't already exist there. The new rows have blank Stax IDs / emails / payment methods for the operator to fill in. Mirrors to Supabase. | Customers sheet (appends), Supabase `stax_customers`. | P6 |
| `syncCustomers` | The "Sync Customers with Stax" menu button. For each customer row, verifies the Stax Customer ID via API, looks up payment methods, updates the Payment Method column with a CC/Debit/ACH/None label, and (if email is set but Stax ID isn't) searches Stax by email and fills in the ID on a unique match. Pushes company names from the sheet up to Stax when Stax has none. Logs exceptions for not-found/ambiguous matches. | Customers sheet, Stax API (GET /customer/{id}, PUT /customer/{id}, GET /customer?email=, GET /customer/{id}/payment-method), Exceptions sheet, Supabase `stax_customers`. | P6 |
| `createStaxInvoices` | The "Create Stax Invoices" menu button. Locks the script, fills in missing Stax Customer IDs from the Customers tab, then delegates to `_createStaxInvoicesForRows_` to push every PENDING invoice to Stax. Pops up a result summary. | Stax API, Invoices/Exceptions/Run Log sheets, Supabase mirrors. | P6 |
| `_createStaxInvoicesForRows_` | The headless core of invoice creation. Takes options for row filter, due-date gate, auto-charge policy, and log label. Reads every PENDING invoice row, applies the configured gates (due-today-or-earlier for the auto-run, auto-charge eligibility, customer ID, valid amount), builds the Stax invoice payload (line items, reference key, memo), posts to Stax, flips Status to CREATED with the Stax Invoice ID on success, links to an existing Stax invoice on duplicate detection, applies a past-due safety buffer that defers same-day charging if the invoice is already late. Logs failures to Exceptions, summary to Run Log, mirrors to Supabase. | Stax API (POST /invoice, GET /invoice?memo= for dedup), Invoices/Exceptions/Run Log sheets, Supabase mirrors. | P6 |
| `_prepareEligiblePendingInvoicesForChargeRun` | Wrapper around `_createStaxInvoicesForRows_` that uses the prepare-stage gates (only push due-today-or-earlier rows that pass the auto-charge policy). Called by `runCharges` and `runChargesAuto` just before `_executeChargeRun` so PENDING rows whose due date arrived get pushed → CREATED before the charge loop sees them. | Same as `_createStaxInvoicesForRows_`. | P6 |
| `_executeChargeRun` | The actual charge loop. Re-reads the Invoices sheet, builds a candidate list of CREATED rows whose scheduled or due date is today-or-earlier and that pass the auto-charge policy (with two distinct skip buckets — CLIENT_AUTO_DISABLED vs UNKNOWN_CLIENT — for visibility), sorts by due date, applies a per-run cap (default 25), then attempts each charge sequentially with a configurable inter-charge delay, a circuit breaker that trips on 3 consecutive 5xx/network errors, and a wall-time watchdog that aborts at 5m30s before Apps Script kills the run. Pre-checks each invoice (Stax may already show it PAID), fetches the default payment method, writes a CHARGE_ATTEMPT marker before calling the pay API for double-charge protection, then writes the final status (PAID, CHARGE_FAILED, etc.) and the transaction ID to the row. Logs every attempt to Charge Log, every failure to Exceptions, the summary to Run Log, mirrors everything to Supabase. | Stax API (GET /invoice/{id}, GET /customer/{id}/payment-method, POST /invoice/{id}/pay), Invoices/Charge Log/Exceptions/Run Log sheets, Supabase mirrors. | P6 |
| `_chargeInvoice` | Posts the actual charge to Stax for one invoice + payment method, parses the response, classifies the result as success / partial payment / decline / API error, extracts the transaction ID and remaining balance. Distinguishes decline-keyword errors from generic failures. | Stax API (POST /invoice/{id}/pay). | P6 |
| `_getDefaultPaymentMethod` | Fetches the customer's payment methods from Stax, filters out deleted/purged ones, prefers `is_default=true`, otherwise falls back to the first active method. Returns `{found, methodId, methodType, error}`. | Stax API (GET /customer/{id}/payment-method). | P6 |
| `_sendInvoiceEmail` | Asks Stax to email the invoice + pay link to the customer's address on file (PUT /invoice/{id}/send/email). Returns `{success, error}`. | Stax API. | P6 |
| `sendPayLinks` | The "Send Pay Links (Failed Charges)" menu button. Locks the script, finds every invoice whose Status is CHARGE_FAILED and that has a Stax Invoice ID, confirms with the operator, then bulk-fires Stax pay-link emails for each, flipping Status to SENT on success. Logs failures to Exceptions, mirrors to Supabase. | Stax API, Invoices/Exceptions/Run Log sheets, Supabase mirror. | P6 |
| `sendSinglePayLink` | The "Send Pay Link (Single Invoice)" menu button. Prompts for a QB Invoice # (pre-filled with the active cell's value if on the Invoices or Exceptions tab), finds the matching row, confirms, then triggers the Stax pay-link email. Flips Status to SENT on success and mirrors to Supabase. | Stax API, Invoices/Run Log sheets, Supabase mirror. | P6 |
| `_staxApiRequest` | The single point where every Stax API call goes through. Handles auth header, throttling, JSON encoding, retry-with-backoff on 429/5xx, and a 3-attempt cap. Returns `{success, status, data, error}`. | Stax API (any endpoint), `_rateLimitState` module global. | P6 |
| `_throttle` | A simple in-script rate limiter for Stax calls — caps the script at 88 requests per rolling 60-second window and sleeps until the window resets when approaching the cap. Called inside `_staxApiRequest` before each fetch. | Internal `_rateLimitState` global. | internal-helper |
| `_checkForDuplicateInvoice` | Before creating a new Stax invoice, searches Stax for one whose `meta.reference` matches the script's reference key (QB#+name+amount+date), so re-running create after a partial failure doesn't double-bill. Returns `{found, invoiceId}`. | Stax API (GET /invoice?memo=). | P6 |
| `_buildStaxLineItems` | Converts the saved Line Items JSON string for one invoice into the Stax line-item array the API expects (item / details / quantity / price). Skips Accounts Receivable lines and zero-price lines, and falls back to a single line for the full total if parsing fails. | None — pure helper. | internal-helper |
| `_parseDateForStax` | Parses a date string into YYYY-MM-DD for Stax's API. Tries MM/DD/YYYY first (QB's format), then ISO yyyy-MM-dd, then generic Date. Returns null if none parse. Avoids timezone drift. | None — pure helper. | internal-helper |
| `_getStaxBaseUrl` | Looks at the ENVIRONMENT config value and returns the right Stax API base URL. The two URLs are identical here (sandbox vs production is keyed off the API key on Stax's side) but the indirection is preserved for future split. | Config sheet (read). | internal-helper |
| `_getPaymentMethodLabel` | Turns the raw Stax payment-methods response into a human-readable label like "CC", "Debit", "ACH", "None", or a comma-separated combo if multiple types are on file. Filters out deleted/purged methods. | None — pure helper. | internal-helper |
| `_extractArrayFromResponse` | Stax sometimes returns a flat array and sometimes a `{data: [...]}` envelope. This helper hands back the array either way. | None — pure helper. | internal-helper |
| `_lookupStaxCustomerIds` | Walks every invoice row that has a QB Customer Name but a blank Stax Customer ID, looks the name up against the local Customers tab and the Consolidated Billing Clients tab, and fills in the Stax Customer ID when a match is found. Local map takes precedence over CB. | Customers sheet (read), CB Clients sheet (read), Invoices sheet (write column C). | P6 |
| `autoFillCustomersFromInvoices` | Alternative "auto-fill" function (not wired into the menu, kept for backward compat with v1.3.0 workflow). Like `autoPopulateCustomers` but with a confirmation dialog showing the first 15 names that would be added. Adds new customer rows with blank Stax/email fields. | Customers sheet (appends). | retiring |
| `_buildClientAutoChargeLookup_` | Reads the Consolidated Billing Clients tab and builds three lookup maps (by Stax Customer ID, by QB customer name, by client name) so the auto-charge gate can resolve whether a client has Auto Charge ON regardless of which key the invoice carries. Returns null if CB is unreachable. | CB Clients sheet (read). | internal-helper |
| `_resolveClientAutoCharge_` | Given the lookup object from the above plus a Stax Customer ID and a customer name, walks the three tiers in order and returns true / false / undefined. Eliminates the UNKNOWN_CLIENT exception that fired when QB-tagged names ("K&M Interiors (ACH on File)") didn't match CB's CLIENT NAME column. | None — pure helper. | internal-helper |
| `_applyPastDueBuffer` | When the auto-run pushes a PENDING invoice → CREATED but its Due Date is already past, stamps Scheduled Date = today + N days (default 1, configurable via AUTO_CHARGE_PAST_DUE_BUFFER_DAYS) so the next cron run picks it up instead of charging it immediately without operator review. Doesn't overwrite operator-set Scheduled Date. | Invoices sheet (writes Scheduled Date column). | P6 |
| `_logException` | Standardized exception writer — appends one row to the Exceptions tab with timestamp, doc#, name, Stax ID, amount, due date, reason, link, blank Resolved column. Also mirrors the new row to Supabase so the Payments app shows it without a manual resync. | Exceptions sheet, Supabase `stax_exceptions`. | P6 |
| `_logChargeResult` | Standardized charge-log writer — appends one row to the Charge Log tab with timestamp, QB#, Stax invoice ID, Stax customer ID, customer name, amount, status (SUCCESS/DECLINED/etc.), transaction ID, notes. | Charge Log sheet. | P6 |

#### Category: stax (Phase 1 — IIF import)

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `showFilePicker` | The "Import IIF File" menu button. Opens a modal dialog showing IIF/TXT files in the configured Drive folder (or root) so the operator can pick one to import. The dialog calls back into `listIIFFiles`, `importIIFFromDrive`, and `promptForIIFFolder` via `google.script.run`. | Spreadsheet UI modal dialog. | P6 |
| `listIIFFiles` | Lists up to 100 IIF/TXT files in the configured Drive folder (`IIF_FOLDER_ID` in Config) or in My Drive root if no folder is set. Returns name/id/date for the dialog dropdown. | Drive (read), Config sheet (read). | P6 |
| `promptForIIFFolder` | Asks the operator to paste a Google Drive folder URL or ID, validates it, saves it as IIF_FOLDER_ID in the Config tab. Used to point the IIF picker at a specific folder. | Drive (read), Config sheet (write). | P6 |
| `importIIFFromDrive` | Reads the selected IIF file from Drive, parses it, writes the raw rows to the Import tab (under the !TRNS/!SPL header layout), routes parsed invoices to the Invoices tab, routes blank-invoice-# records to the Exceptions tab. Auto-fills Stax Customer IDs for the new rows by calling `_lookupStaxCustomerIds`. | Drive (read), Import/Invoices/Exceptions/Customers sheets. | P6 |
| `parseIIF` | The IIF text parser. Splits on TRNS/SPL/ENDTRNS rows, supports both header-mapped (!TRNS / !SPL header rows present) and positional fallbacks, builds a transaction structure with line items, accumulates display rows for the Import tab, separates valid invoices from blank-invoice-# exceptions. | None — pure parser. | internal-helper |
| `_routeParsedTransaction` | Routes one parsed TRNS object: if it's an INVOICE with a non-blank doc#, push to the invoices array; otherwise push a blank-doc# record to the exceptions array. Non-invoice transactions are silently dropped. | None — pure helper. | internal-helper |
| `_buildColumnMap` | Converts an IIF `!TRNS` or `!SPL` header row into a map of column name → column index, so positional parsing isn't required when the header line is present. | None — pure helper. | internal-helper |
| `_parseTrnsFromMap` | Reads a TRNS line by header-map lookup (preferred when `!TRNS` header was found). Pulls trnsType, date, account, name, amount, doc#, memo, terms, due date. | None — pure helper. | internal-helper |
| `_parseSplFromMap` | Reads a SPL line by header-map lookup. Pulls trnsType, date, account, name, amount, doc#, memo, qty, price, inventory item, clear flag. | None — pure helper. | internal-helper |
| `_parseTrnsPositional` | Positional fallback for TRNS lines when the `!TRNS` header isn't in the file. Maps fixed indexes 1-11 to known QB column meanings. | None — pure helper. | internal-helper |
| `_parseSplPositional` | Positional fallback for SPL lines when the `!SPL` header isn't in the file. | None — pure helper. | internal-helper |
| `_writeInvoicesToTab` | Appends parsed invoices to the Invoices sheet, skipping any that match the dedup key of an existing row. Stamps Status='PENDING', Created At = now, serializes line items to JSON. Calls `_lookupStaxCustomerIds` after to fill in any Stax Customer IDs that are known. Returns the count actually added. | Invoices sheet (appends). | P6 |
| `_writeExceptions` | Batch-appends parsed exception records (blank invoice # rows from the IIF) to the Exceptions tab in one setValues call. | Exceptions sheet (appends). | P6 |
| `_invoiceKey` | Normalizes a doc#/name/amount/date tuple into a single canonical dedup-key string (trim, lowercase name, fixed-decimal amount, normalized date). | None — pure helper. | internal-helper |
| `_normalizeDate` | Converts any date input (Date object, string, blank) into a canonical yyyy-MM-dd string for dedup-key building. Avoids timezone drift between sheet reads and string parses. | None — pure helper. | internal-helper |

#### Category: stax (Supabase mirroring)

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `_sbBatchUpsert` | The single Supabase-write helper used by every mirror. Takes a table name, an array of row objects, an on_conflict column list, dedups rows by that key BEFORE sending (PostgreSQL otherwise rejects the whole batch with code 21000), chunks at 50 rows, retries failed chunks row-by-row so one bad row doesn't kill the batch. Best-effort — never throws, logs all failures via `_sbLogSyncError` so silent Supabase outages still show up in Run Log. | Supabase REST API (POST /rest/v1/{table}), Script Properties (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY), Run Log. | P6 |
| `_sbLogSyncError` | Companion to `_sbBatchUpsert`. When an upsert fails, writes a row to `stax_run_log` (Supabase) and to the Run Log sheet (locally) describing the table, HTTP code, row count, and a sample row. Short-circuits if called for `stax_run_log` itself to avoid recursive failure loops. | Supabase `stax_run_log`, Run Log sheet. | P6 |
| `_sbResyncAllStaxInvoices` | Reads every row of the Invoices sheet, builds the canonical `stax_invoices` schema (qb_invoice_no, customer, stax_customer_id, dates, amount, line items JSON, status, notes, is_test, auto_charge, scheduled_date, payment_method_status, updated_at), and upserts to Supabase by qb_invoice_no. Called at the end of any handler that touches Invoice rows. | Invoices sheet (read), Supabase `stax_invoices`. | P6 |
| `_sbResyncAllStaxCharges` | Reads the tail 1000 rows of the Charge Log sheet and upserts to Supabase `stax_charges` keyed on (timestamp, qb_invoice_no, txn_id). Uses tolerant header lookup (`colAny`) so the canonical "Customer Name"/"Stax Transaction ID" headers are preferred but legacy short forms still work. | Charge Log sheet (read), Supabase `stax_charges`. | P6 |
| `_sbResyncStaxRunLog` | Reads the tail 500 rows of the Run Log sheet and upserts to Supabase `stax_run_log` keyed on (timestamp, fn, summary). | Run Log sheet (read), Supabase `stax_run_log`. | P6 |
| `_sbResyncStaxExceptions` | Reads the tail 500 rows of the Exceptions sheet and upserts to Supabase `stax_exceptions` keyed on (timestamp, qb_invoice_no). | Exceptions sheet (read), Supabase `stax_exceptions`. | P6 |
| `_sbResyncAllStaxCustomers` | Reads every row of the Customers sheet and upserts to Supabase `stax_customers` keyed on qb_name. Called by `pullStaxCustomers`, `autoPopulateCustomers`, and `syncCustomers` after any change. | Customers sheet (read), Supabase `stax_customers`. | P6 |
| `_formatDateLoose` | Tolerant date formatter for Supabase payloads — turns a Date object into `yyyy-MM-dd HH:mm:ss`, passes through any string unchanged, returns "" on empty. | None — pure helper. | internal-helper |

#### Category: trigger

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `setupDailyTrigger` | The "Enable Daily Auto-Charge" menu button. Deletes any existing `runChargesAuto` triggers, then installs a new time-driven trigger that fires once a day in the 9:00-9:59 AM script-timezone window. Re-running it cleanly resets the schedule. | Apps Script project triggers, Run Log. | P6 |
| `removeDailyTrigger` | The "Disable Daily Auto-Charge" menu button. Removes every `runChargesAuto` trigger from the project. | Apps Script project triggers, Run Log. | P6 |

#### Category: exception management

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `reviewExceptions` | The "Review Exceptions" menu button. Walks the Exceptions tab, counts unresolved rows by category (NO_PAYMENT_METHOD, DECLINED, API_ERROR, PARTIAL, BLANK QB INVOICE, other), plus counts how many CHARGE_FAILED invoices are eligible for a pay link. Shows a summary popup. Pure read — no writes. | Exceptions/Invoices sheets (read). | P6 |
| `markExceptionResolved` | The "Mark Exception Resolved" menu button. Reads the active cell in the Exceptions tab, confirms the doc#/name/reason with the operator, then stamps a timestamp into the Resolved column (column I). | Exceptions sheet (write). | P6 |

#### Category: helper-sheet-io / helper-format

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `_getSpreadsheet` | Trigger-safe spreadsheet accessor. Tries `getActiveSpreadsheet()` first; falls back to `openById` using STAX_SPREADSHEET_ID from Script Properties (which `setupSpreadsheetId` populates). Necessary because time-driven triggers see `getActiveSpreadsheet() === null`. | Script Properties. | internal-helper |
| `_ensureColumn` | Returns the 1-based column index of a header on the Stax Invoices sheet, case-insensitive last-match-wins. Auto-appends the header to the last column if missing. Replaces the older hardcoded col-1/col-3/col-8/etc. lookups that drifted when new columns were inserted. | Invoices sheet (writes header row when appending). | internal-helper |
| `_staxInvoiceCols` | Returns an object mapping every named Invoices-sheet field (qb, customer, staxCustId, invoiceDate, dueDate, amount, lineItems, staxId, status, createdAt, notes, isTest, autoCharge, scheduledDate) to its 1-based column index, using `_ensureColumn` for each. Single source of truth for invoice-row column resolution. | Invoices sheet (header read/write). | internal-helper |
| `_ensureSheet` | Internal helper used only by `resetOperationalSheets`. Creates the named sheet if missing, clears it if present, writes all the passed rows, bolds the last row (headers). Destructive on existing content. | Spreadsheet tabs. | internal-helper |
| `_ensureSheetSafe` | Like `_ensureSheet` but never wipes data rows. Creates the sheet if missing and writes headers; if the sheet exists but the header row doesn't match `EXPECTED_HEADERS`, rewrites just the header row. Used by `setupSheets`. | Spreadsheet tabs (header row only). | internal-helper |
| `_validateSheets` | Walks `EXPECTED_HEADERS` and verifies every required sheet exists, has the right header row, with each column at the expected index. Returns an array of error strings, empty if all valid. | All Stax sheets (read). | internal-helper |
| `_preflightCheck` | Cheap pre-import sanity check — verifies Import, Invoices, Customers, Exceptions tabs exist. Returns an error message string or null. | All Stax sheets (read). | internal-helper |
| `_preflightApiCheck` | Pre-API-call sanity check — runs `_preflightCheck`, then ensures Run Log exists, then verifies STAX_API_KEY and ENVIRONMENT are set in Config. Returns an error message string or null. | All Stax sheets, Config sheet. | internal-helper |
| `_getConfig` | Reads a single config value from the Config sheet by key. Returns the trimmed string or null. | Config sheet (read). | internal-helper |
| `_setConfig` | Writes a single config value to the Config sheet — updates in place if the key already exists, appends a new row otherwise. | Config sheet (write). | internal-helper |
| `_getIntConfig_` | Reads an integer config value, seeds the default if blank, clamps to [min, max], and returns the clamped int. Used for MAX_AUTO_CHARGES_PER_RUN, AUTO_CHARGE_DELAY_MS, AUTO_CHARGE_CIRCUIT_BREAKER_COUNT. Never overwrites a non-integer operator value — falls back to default for the run instead. | Config sheet (read + seed append). | internal-helper |
| `_formatTimestamp` | Returns the current date formatted as `yyyy-MM-dd HH:mm:ss` in the script's timezone. Used everywhere a timestamp is written to a sheet. | None — pure helper. | internal-helper |
| `_normalizeName` | Lowercases, trims, and collapses internal whitespace in a customer-name string so two slightly-different spellings hash the same. Used in dedup keys and customer lookups. | None — pure helper. | internal-helper |
| `_writeRunLog` | Appends one row (timestamp, function name, summary string, optional details/JSON) to the Run Log sheet. Called from every entry-point at the end of its execution. | Run Log sheet (append). | internal-helper |

---

---

## Project: QR Scanner

> Source: `AppScripts/QR Scanner/` (2 .gs files: `IndexBuilder.updated.gs` 279 lines, `ScannerBackend.updated.gs` 1,070 lines, plus HTML)
> Deployment: standalone Apps Script web app for warehouse barcode scanning + label printing.
> Migration role: **out-of-scope** — operator UI on the warehouse floor. Already mirrors `inventory.location` to Supabase best-effort via `qrSupabasePatchLocation_`, so React reflects scanner moves in seconds.
> Function count: **35**.

QR Scanner is a standalone Apps Script web app deployed from a Consolidated-Billing-side script project. It serves two HTML pages: `Scanner.html` (or `index.html`) for the warehouse staff barcode/QR scanning UI, and `LabelPrinter.html` for printing item / location labels. The web app exposes a JSON API over `doGet` (with `?action=...&payload=...`) and `doPost` for `google.script.run` calls from the embedded UI.

Operator-facing features: scan an item label to look it up, scan multiple items and assign a new location to all of them in one go, view per-item move history, print item or location labels via a Brother label printer, manage the location code list. Writes mirror to Supabase `inventory.location` so the React app reflects scanner moves in seconds.

This project is **standalone / out-of-scope for near-term migration** — it's an operator tool that touches the same inventory data the main app does, but the location-update path is already mirrored to Supabase and the migration table does not list any of its functions. P7 would be the eventual home if the scanner gets folded into the React app's mobile UI.

### File: `AppScripts/QR Scanner/IndexBuilder.updated.gs`

#### Category: qr-scanner

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `qrBuildIndex` | Walks every active client's Inventory tab (per the CB-side `getActiveClients_`) and builds a global Item ID → `{sheetId, clientName, row}` index in memory. Skips non-Active rows when the Status column is present. Detects cross-tenant duplicate Item IDs and keeps the first occurrence (logging the loss). Warns when the serialized index is over 500 KB and fails gracefully if it exceeds CacheService's 100 KB-per-key cap. Stores in CacheService chunked at 90 KB/key with 6h TTL. Returns `{success, stats}` or `{success:false, message, stats}`. | All client Inventory sheets (read), CacheService. | out-of-scope |
| `qrStoreIndex_` | Splits a pre-serialized index JSON string into 90 KB chunks, writes them to CacheService under `QR_IDX_0`, `QR_IDX_1`, ... plus a `QR_IDX_COUNT` key. Verifies by re-reading COUNT. Returns true/false. | CacheService. | internal-helper |
| `qrGetCachedIndex` | Reads `QR_IDX_COUNT` from CacheService, then reassembles the chunked JSON by reading every `QR_IDX_N` key. Returns the parsed index object, or null on miss / expired chunk / parse failure. | CacheService. | internal-helper |
| `qrGetOrBuildIndex` | Returns the cached index if present; otherwise calls `qrBuildIndex` to rebuild. Returns `{__buildFailed: true}` on any build failure or exception so callers can show a clear error rather than silently treating an empty result as "no matches". | CacheService, all client Inventory sheets indirectly. | internal-helper |
| `qrRefreshIndex` | Forcefully clears every cached chunk, then calls `qrBuildIndex` to rebuild from scratch. Wired to a manual button in the scanner UI. | CacheService, all client Inventory sheets. | out-of-scope |
| `qrScheduledIndexRebuild` | The time-driven trigger target — runs every 6 hours and rebuilds the index in the background. Logs the success/item count to Apps Script logs. | Same as `qrBuildIndex`. | out-of-scope |
| `qrInstallIndexTrigger` | Removes any existing index-rebuild triggers, then installs a fresh one that fires `qrScheduledIndexRebuild` every 6 hours. | Apps Script project triggers. | out-of-scope |
| `qrRemoveIndexTrigger` | Deletes every project trigger whose handler is `qrScheduledIndexRebuild`. | Apps Script project triggers. | out-of-scope |

### File: `AppScripts/QR Scanner/ScannerBackend.updated.gs`

#### Category: entry-point

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `doGet` | Web-app entry point for GET requests. If `?action=...` is present, treats the request as a JSON API call (parses `?payload=...` as the body, dispatches via `handleApiCall_`, returns JSON or JSONP if `?callback=` is present). Otherwise serves the requested HTML page — Scanner.html (or index.html fallback) for the default page, LabelPrinter.html for `?page=labels`. Injects the auto-resolved API URL into the template. | Web app response, HtmlService templates. | out-of-scope |
| `doPost` | Web-app entry point for POST requests. Parses the JSON body, dispatches via `handleApiCall_`. Kept for back-compat — most clients use the GET API now. | Web app response. | out-of-scope |
| `handleApiCall_` | The shared router for both `doGet` and `doPost`. Reads `body.action` and dispatches to one of the qr* handlers (getLocations, updateLocations, lookupItem, lookupItems, getItemsForLabels, getLabelConfig, saveLabelConfig, rebuildIndex, setupLocations, debugLookup, validateItems, getMoveHistory, upsertLocations). Wraps every call in try/catch and returns JSON. | All qr* handlers indirectly. | internal-helper |

#### Category: qr-scanner

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `qrGetLocations` | Returns the list of valid location codes from the Consolidated Billing "Locations" tab. Cached in CacheService for 10 minutes so repeat scanner opens are instant. | Locations sheet (read), CacheService. | out-of-scope |
| `qrSetupLocationsSheet` | Creates the "Locations" tab on the active spreadsheet (CB) if missing, with a header row and 10 seed location codes (WW1, Rec-Dock, A-01-01, etc.). Idempotent. | Spreadsheet tabs. | out-of-scope |
| `qrUpdateLocations` | The main scanner write path. Takes an array of scanned Item IDs and a target Location, normalizes/dedupes/strips ITEM:/LOC: prefixes, opens each affected client sheet under a script lock, reads the FROM location, writes the TO location into the Inventory.LOCATION column, logs every move to that client's Move History tab, then patches Supabase `inventory.location` for each item (best-effort mirror). Auto-rebuilds the index once if items are missing from the cached index. Returns `{success, results: {updated[], notFound[], errors[]}}`. | Multiple client Inventory sheets (write), client Move History sheets (append), Supabase `inventory` table (PATCH), CacheService, LockService. | out-of-scope |
| `qrLookupItem` | Single-item lookup by scanned ID. Returns the item's vendor/description/sidemark/room/currentLocation/itemClass + client name, or `{found:false}` if not in the index. Auto-rebuilds the index once on miss. | Client Inventory sheet (read), CacheService. | out-of-scope |
| `qrLookupItems` | Bulk version of `qrLookupItem` — takes an array of IDs, groups by sheet to minimize `openById` calls, returns an object keyed by item ID with the same per-item shape. Used by the multi-scan UI before assigning a location. | Multiple client Inventory sheets (read), CacheService. | out-of-scope |
| `qrValidateItems` | Pre-commit validator for the manual-mode UI. Normalizes and dedupes the ID list, then returns `qrLookupItems` results so the frontend can highlight bad IDs before letting the operator hit Save. | Same as `qrLookupItems`. | out-of-scope |
| `qrGetMoveHistory` | Reads the Move History tab on a specific client spreadsheet and returns every row whose Item ID matches the requested one (timestamp, user, fromLocation, toLocation, type). | Client Move History sheet (read). | out-of-scope |
| `qrUpsertLocations` | Adds new location codes to the Locations sheet, skipping any that already exist (case-insensitive). Returns `{success, added[], existed[], total}`. Auto-creates the Locations tab if missing. | Locations sheet (append), LockService. | out-of-scope |

#### Category: qr-scanner (helpers / internal)

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `qrNormalizeScannedCode_` | Trims a single scanned value, strips an `ITEM:` or `LOC:` prefix if present, returns a clean string. Always keeps the value as a string so leading zeros survive. | None — pure helper. | internal-helper |
| `qrNormalizeCodeList_` | Applies `qrNormalizeScannedCode_` to an array, drops empties, dedupes. Used by every batch endpoint. | None — pure helper. | internal-helper |
| `qrCreateScannerTemplate_` | Returns the `Scanner` HTML template; falls back to `index` if `Scanner` isn't present. Handles the dual-shell deployment. | HtmlService. | internal-helper |
| `qrEnsureFreshIndexForIds_` | If any of the requested IDs aren't in the current index, rebuilds the index once and returns the fresh one. Returns the existing index unchanged if no rebuild is needed. | CacheService, indirectly `qrBuildIndex`. | internal-helper |
| `qrResolveWebAppUrl_` | Picks the Web App URL to inject into the HTML template — prefers `SCANNER_WEB_APP_URL` from Script Properties (override for staging), falls back to `ScriptApp.getService().getUrl()`, falls back to empty string. Lets the served HTML auto-configure itself without a manual paste. | Script Properties. | internal-helper |
| `validateInventorySheet_` | Throws a clear-error if the given client spreadsheet is missing the Inventory tab, the LOCATION column, or is empty. Returns `{inv, hMap, colLoc}` on success. Used by the write path. | Client Inventory sheet (read). | internal-helper |
| `validateInventorySheetForLabels_` | Like `validateInventorySheet_` but does NOT require the LOCATION column (labels can be printed for items that don't have a location set). | Client Inventory sheet (read). | internal-helper |
| `qrInvalidateLocationsCache_` | Removes the cached Locations list from CacheService. Called from `qrUpdateLocations` after a write so the next autocomplete picks up any newly-registered code. | CacheService. | internal-helper |
| `groupItemsBySheet_` | Helper for `qrUpdateLocations`. Takes a list of IDs and the index, returns a `{sheetId: [{itemId,row,clientName},...]}` map plus pushes unknown IDs to `results.notFound`. Reduces `openById` churn. | None — pure helper. | internal-helper |
| `qrEnsureMoveHistorySheet_` | Returns the client spreadsheet's "Move History" tab; auto-creates it (with bold header row + frozen first row + grey background) if missing. | Client Move History sheet (create/read). | internal-helper |
| `qrLogMoveHistory_` | Appends one row per move to the client's Move History tab — Timestamp / User / Item ID / From Location / To Location / Type. Best-effort — exceptions are swallowed and logged by the caller. | Client Move History sheet (append). | internal-helper |
| `qrSupabasePatchLocation_` | Mirrors a single inventory move to Supabase by PATCHing `inventory.location` + `updated_at` keyed on (tenant_id, item_id). Best-effort — never throws, never blocks the sheet write. Warns once per execution if SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY aren't configured on this project. Implements architectural invariant #20 (sheet is authoritative, Supabase is the mirror). | Supabase `inventory` table (PATCH), Script Properties. | out-of-scope (already mirroring) |

#### Category: labels

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `qrGetItemsForLabels` | The data feed for the label printer page. Takes an array of Item IDs, looks each up, returns `{items: [...], notFound: [...], errors: [...]}` with itemId / clientName / vendor / description / sidemark / room / location / itemClass per item. Uses the labels validator (location not required). Surfaces index-build failures so the operator sees an actionable error. | Multiple client Inventory sheets (read), CacheService. | out-of-scope |
| `qrDebugLookup` | Diagnostic endpoint — given a list of IDs, returns `{indexSize, results: [{itemId, inIndex, clientName?, sheetId?, row?}]}` so support can verify the index sees what they expect. Not used in normal operator flow. | CacheService. | out-of-scope |
| `qrGetLabelConfig` | Reads the saved label layout config (which fields to include, font sizes, QR size, label size, etc.) from User Properties keyed on `QR_LABEL_CONFIG_ITEM` or `QR_LABEL_CONFIG_LOCATION`. Returns sensible defaults if nothing is saved. One-time migration from legacy `QR_LABEL_CONFIG` key for item labels. | User Properties. | out-of-scope |
| `qrSaveLabelConfig` | Persists the operator's label layout config back to User Properties, keyed by labelType (item or location). | User Properties. | out-of-scope |

---

---

## Project: Task Board (DECOMMISSIONED)

> **Status: DECOMMISSIONED** — replaced by the React app's task views when the React app was created. Operators no longer use the Task Board sheet; the time-driven `TB_RefreshNow` and `TB_OnBoardEdit` triggers should be considered dormant. (Confirmed by Justin 2026-05-11.)
> Source: `AppScripts/task board script.txt` (2,569 lines, single file). Kept in the repo as historical reference + because the 23-function `SH_*` shared-handler block is still byte-identical to the same block in Client Inventory `Triggers.gs`. The parity contract is now one-way: Client Inventory IS the canonical SH_* source; the copy here is frozen.
> Migration role: **decommissioned** — no migration work needed for this project specifically. Will be deleted from the repo as part of P7 cleanup. The `processRepairDeclinedById_` "missing function" concern flagged in the previous inventory pass is moot — no one uses Task Board.
> Function count: **56** (all `decommissioned`).

The Will Call cancellation path that was unique to Task Board has either been moved into the React app already (verify when picking up P3/P4a coverage) or is also decommissioned along with Task Board itself.

### File: `AppScripts/task board script.txt`

#### Category: entry-point

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `onOpen` | Builds the "Stride Task Board" menu when the spreadsheet is opened — Refresh Now, Default View Tasks, Default View Repairs, Clear Filters, Install Triggers, Initialize Sheets, View Sync Log. | Spreadsheet UI menu. | out-of-scope |
| `TB_RefreshNow` | The main pull loop. Locks the script, reads the Clients tab on Consolidated Billing, then for every active client opens their spreadsheet, reads Tasks / Repairs / Will_Calls, filters to only open rows (excludes Completed, Cancelled, etc.), enriches with sidemarks from Inventory when Tasks/Repairs don't have one, hyperlinks Task ID / Repair ID / WC Number / Shipment # to their Drive folder URLs, writes everything to the three mirror tabs via `TB_writeMirror_`. Builds a union header set so clients with custom columns still surface them on the board. Logs everything to Sync_Log. Wired to a 5-minute time-driven trigger. | All client Tasks / Repairs / Will_Calls / Inventory sheets (read), Open_Tasks / Open_Repairs / Open_Will_Calls / Sync_Log mirror sheets (write), LockService. | out-of-scope |
| `TB_OnBoardEdit` | The push handler. Fires on every edit to the Task Board spreadsheet. If the edit is on one of the three mirror tabs, in an editable column, finds the source client + sheet + ID from the row's hidden __ system columns, opens the source client spreadsheet, writes the edited value back to the matching row. For trigger fields, invokes the shared handler chain: Start Task checkbox → `startTask_` (folder + work order PDF); Task Result → `processTaskCompletionById_` (status flip, billing row, completion email); Repair Quote Amount → `processRepairQuoteById_` (status flip, quote email); Repair Approved → `processRepairApprovalById_` (folder + work order PDF) or `processRepairDeclinedById_` (decline email — referenced but not defined in this file; lives in the shared handler block on the client side); Repair Result → `processRepairCompletionById_` (status flip, billing row, completion email); WC Estimated Pickup Date → auto-flip Pending to Scheduled; WC Status → Cancelled → inline cancellation email. Updates `__Sync Status` to Processing / Synced / Exception / Error and surfaces toasts. | Source client Tasks / Repairs / Will_Calls / Inventory / Billing_Ledger / Settings sheets, Drive, GmailApp, board mirror sheets. | out-of-scope |
| `TB_Setup` | The "Initialize / Repair Sheets" menu button. Sets up the Settings tab (preserving any existing config), then ensures the three mirror tabs (Open_Tasks, Open_Repairs, Open_Will_Calls) and the Sync_Log tab exist with the right headers and the Start Task column has a checkbox validation. | Spreadsheet tabs. | out-of-scope |
| `TB_InstallTriggers` | The "Install / Reset Triggers" menu button. Deletes any existing TB_RefreshNow / TB_OnBoardEdit triggers, then installs fresh ones — a time-driven trigger for refresh (interval from Settings, default 5 min, clamped to 1-30) and the per-spreadsheet onEdit trigger. | Apps Script project triggers. | out-of-scope |
| `TB_OpenLog` | The "View Sync Log" menu button. Switches the active sheet to Sync_Log. | Spreadsheet UI. | out-of-scope |
| `TB_DefaultViewTasks` | The "Default View: Tasks" menu button. Applies a smart filter to Open_Tasks showing only Status=Open or In Progress, sorted by Type then Created date. | Open_Tasks sheet (filter + sort). | out-of-scope |
| `TB_DefaultViewRepairs` | The "Default View: Repairs" menu button. Applies a smart filter to Open_Repairs showing only Pending Quote / Quote Sent / Approved / In Progress statuses, sorted by Status then Scheduled Date. | Open_Repairs sheet (filter + sort). | out-of-scope |
| `TB_ClearFilters` | The "Clear Filters" menu button. Removes any active filter on the currently-active sheet. | Active sheet (filter remove). | out-of-scope |

#### Category: task-board

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `TB_readClients_` | Reads the Consolidated Billing Clients tab (by ID + tab name from Settings), finds the header row by scanning rows 1-10 for both "Client Name" and "Active" headers (handles legacy layouts), returns an array of `{name, spreadsheetId, active}` for every client row that has both name and ID. | CB Clients sheet (read). | out-of-scope |
| `TB_buildSidemarkIndex_` | Reads a single client's Inventory tab and returns a map of Item ID → Sidemark. Used by `TB_RefreshNow` to back-fill Sidemarks on Tasks/Repairs rows for clients whose Tasks/Repairs tabs don't carry a Sidemark column directly. | One client's Inventory sheet (read). | out-of-scope |
| `TB_writeMirror_` | The mirror-tab writer. Preserves the operator's existing column order if present (only re-using known-expected headers), appends any new headers at the end, places the hidden `__` system columns last, clears existing data rows, clears stale data validations across the whole sheet (so dropdowns from reordered columns don't silently drop new rows), writes all rows in one setValues call, re-hides system columns, re-applies data validations and Pass/Fail conditional formatting. | Open_Tasks / Open_Repairs / Open_Will_Calls sheets (full rewrite of data rows). | out-of-scope |
| `TB_applyColumnValidations_` | Applies the configured data validations to each header on a mirror sheet — Start Task / Billed / COD = checkboxes; Result / Repair Result = Pass/Fail dropdown; Approved = Approved/Declined dropdown. Walks `TB_COL_VALIDATIONS` once. Also fires the Pass/Fail conditional-formatting application for the right column. | Mirror sheet (data validations). | out-of-scope |
| `TB_applyPassFailFormatting_` | Applies green-background-white-text conditional formatting for cells equal to "Pass"/"PASS" and red-background-white-text for "Fail"/"FAIL" on a given column. Removes any prior rules on the same column first to keep the rule list clean. | Mirror sheet (conditional formatting rules). | out-of-scope |
| `TB_setupSettings_` | Sets up the Settings tab — preserves any existing keys, fills in the four defaults (CONSOLIDATED_BILLING_ID, CLIENTS_TAB_NAME, REFRESH_MINUTES, ERROR_EMAILS) for any missing key, autosizes columns. | Settings sheet. | out-of-scope |
| `TB_setupMirrorSheet_` | Sets up one of the three mirror sheets — clears just data rows (preserves header row formatting), removes "ghost" columns (sheet columns whose header doesn't appear in the expected set), appends any missing expected columns, freezes the header row, hides all `__` system columns except the last one (`__Sync Status`, kept visible for staff). | Mirror sheet (structure + visibility). | out-of-scope |
| `TB_applySmartFilterSort_` | The filter/sort engine used by the Default View buttons. Rebuilds the filter on the full sheet range (so new rows are always inside the filter), applies hidden-values criteria column-by-column based on the passed spec, then applies multi-column sort. | Mirror sheet (filter + sort). | out-of-scope |

#### Category: helper-sheet-io / helper-format / helper-misc (Task Board prefixed `TB_`)

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `setFromArray_` | Returns an object where every input array element is a key with value true. Used to build the `TB_TASK_EDITABLE`, `TB_REPAIR_EDITABLE`, `TB_WC_EDITABLE` lookup sets. | None — pure helper. | internal-helper |
| `TB_headerMap_` | Given a header row array, returns `{headerName: zeroBasedIndex}`. Used everywhere a sheet's column positions are resolved by name. | None — pure helper. | internal-helper |
| `TB_readTable_` | Reads a whole sheet's data range, returns `{headers, rows}`. Guards against Apps Script's `[[""]]` "empty" sheet quirk. | One sheet (read). | internal-helper |
| `TB_ensureSheet_` | Returns a sheet by name, inserting it if missing. | Spreadsheet (insert sheet). | internal-helper |
| `TB_toast_` | Shows a transient toast in the bottom-right of the spreadsheet with a "Stride Task Board" title. Swallows all errors so it's safe to call from headless contexts. | Spreadsheet UI. | internal-helper |
| `TB_getSetting_` | Reads one value from the Settings tab by key. Returns "" if missing. | Settings sheet (read). | internal-helper |
| `TB_setupLog_` | Initializes the Sync_Log tab — clears it, writes the header row (At / Level / Message / Client / Sheet / Details), bolds the header, freezes the first row. | Sync_Log sheet (full rewrite). | internal-helper |
| `TB_getLastDataRow_` | Returns the actual last row that has data in any of the first 3 columns, ignoring checkbox-false-only rows. Apps Script's `getLastRow()` mis-reports rows that only contain a checkbox set to false; this scans upward to find the real last row. | One sheet (read). | internal-helper |
| `TB_log_` | Appends one row (timestamp, level, message, client, sheet, details) to the Sync_Log tab. Auto-creates the tab and header row on first write. Swallows all errors. | Sync_Log sheet (append). | internal-helper |
| `TB_truthy_` | Returns true if the input string (case-insensitive) is "true", "yes", "1", "y", or "on". Used everywhere a sheet cell holds a boolean-as-string. | None — pure helper. | internal-helper |

#### Category: task-board (shared handlers — `SH_*` block, mirrored to client Inventory Code.gs)

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `SH_headerMap_` | Returns `{headerName: oneBasedIndex}` for the header row of a sheet. The SH_ version returns 1-based indexes (to feed directly into `getRange`), unlike `TB_headerMap_` which is 0-based. Skips duplicate headers. | One sheet (read). | internal-helper |
| `SH_getSetting_` | Reads one value from the Settings tab by key. Returns "" if missing. Same idea as `TB_getSetting_` but lives in the shared handler block. | Settings sheet (read). | internal-helper |
| `SH_findRowById_` | Linear-scans one column of a sheet looking for a given ID value. Returns the 1-based row number or -1. Used to locate a Task / Repair / Inventory row by its ID after the SHARED handler is dispatched (avoids reliance on the row number passed from the board because the source sheet may have been sorted/inserted into between dispatch and write). | One sheet (read). | internal-helper |
| `SH_truthy_` | Same as `TB_truthy_` — case-insensitive "yes / true / 1 / y / on" check. Duplicated in the shared block so the same parity-controlled block can compile both on the Task Board side and on the client Inventory side. | None — pure helper. | internal-helper |
| `SH_esc_` | HTML-escapes & < > " for safe insertion into email templates and PDF HTML. | None — pure helper. | internal-helper |
| `SH_formatCurrency_` | Formats a value as a 2-decimal string. Returns the value coerced to string if not a finite number. | None — pure helper. | internal-helper |
| `SH_mergeEmails_` | Takes any number of comma-separated email-list strings, splits and trims each, dedupes, returns a single comma-separated string. Used to combine staff + client emails for completion / quote emails. | None — pure helper. | internal-helper |
| `SH_getLastDataRow_` | Same logic as `TB_getLastDataRow_` — scans backward for the last row with non-blank, non-false content in the first 3 columns. Used when appending Billing_Ledger rows so an existing tail of checkbox-only rows doesn't push the append below the visible end. | One sheet (read). | internal-helper |
| `SH_findInventoryItem_` | Linear-scans the client's Inventory tab for an Item ID and returns a snapshot object (description, itemClass, vendor, location, sidemark, shipNo, qty, row, room, plus the raw row and the header map). Used by every completion / quote / approval handler to enrich the email body and Billing row. | Client Inventory sheet (read). | internal-helper |
| `SH_lookupRate_` | Looks up the per-item-class billing rate for a service code in the client's Price_Cache tab. Returns `{rate, svcName, category, billIfPass, billIfFail}`. Used by `processTaskCompletionById_` and `processRepairCompletionById_` to decide whether to bill the row at all and at what rate. | Client Price_Cache sheet (read). | internal-helper |
| `SH_getItemFolderUrl_` | Returns the Drive folder URL hyperlinked on the Item ID cell in the client's Inventory tab, if any. Used as a fallback when a task / repair doesn't have its own folder URL yet. | Client Inventory sheet (read rich text). | internal-helper |
| `SH_findPdfInFolder_` | Given a Drive folder URL and a name prefix (e.g. "Work_Order_"), returns the first PDF blob whose name starts with that prefix. Used by completion emails to attach the Work Order PDF generated at task start. | Drive (read). | internal-helper |
| `SH_buildItemTableHtml_` | Builds an inline-styled HTML table showing Item ID / Qty / Vendor / Description / Sidemark / Room for embedding in completion / quote emails. Falls back to a simpler two-cell layout if the Inventory lookup fails. | Client Inventory sheet (read). | internal-helper |
| `SH_writeBillingRow_` | Appends a single row to the client's Billing_Ledger tab with the right column positions (resolved by header). Idempotent — skips the write if a row with the same Ledger Entry ID already exists. Generates a new Ledger Row ID using the BILLING_LEDGER_COUNTER setting (increments and persists), applies the per-category discount/surcharge percentage from Settings (DISCOUNT_STORAGE_PCT or DISCOUNT_SERVICES_PCT, range -10 to +10), supports a totalOverride for "Missing Rate" sentinel values. | Client Billing_Ledger sheet (append), Client Settings sheet (read + write counter). | out-of-scope |
| `SH_sendTemplateEmail_` | The template-driven email sender used by every completion / quote / decline path. Reads the matching template from the master spreadsheet's Email_Templates tab (subject, HTML body, recipients), substitutes {{TOKEN}} placeholders, strips out broken {{PHOTOS_URL}} anchors, sends via GmailApp from `whse@stridenw.com`, optionally attaches a PDF blob. Returns `{success, error}`. If no template is found, refuses to send and returns an error — does NOT invent fallback emails. | Master Email_Templates sheet (read), GmailApp (send). | out-of-scope |
| `SH_getDocTemplateHtml_` | Looks up a document template (DOC_REPAIR_WORK_ORDER, DOC_TASK_WORK_ORDER, etc.) in the master Email_Templates tab and returns `{title, html}` or null. Used by the PDF-generation pipeline. | Master Email_Templates sheet (read). | internal-helper |
| `SH_getDefaultRepairWorkOrderHtml_` | Returns a long hardcoded HTML template for the repair Work Order PDF when the master template lookup fails — Stride branding, repair details table, item details table, "WAREHOUSE USE ONLY" section with checkbox result options and signature lines. | None — pure data. | internal-helper |
| `SH_createGoogleDocFromHtml_` | Creates a Google Doc from raw HTML by writing the HTML to a temp Drive file, calling the Advanced Drive Service to convert it to a Google Doc, trashing the temp file. Throws a clear error if the Advanced Drive Service isn't enabled. | Drive (create + trash file), Advanced Drive Service. | internal-helper |
| `SH_exportDocAsPdfBlob_` | Sets the doc's margins via the Google Docs API, then exports it as a PDF blob via the export URL (letter size, portrait, fit-to-width). Used to turn the converted Doc into a PDF blob suitable for emailing or for saving into a repair folder. | Drive (read doc), Google Docs API, UrlFetchApp. | internal-helper |
| `SH_generateRepairWorkOrderPdf_` | The orchestrator for the repair Work Order PDF. Reads the repair row, pulls the Inventory snapshot for the item, formats the tokens, picks the template (master template or hardcoded fallback), substitutes tokens, converts to Google Doc via `SH_createGoogleDocFromHtml_`, exports as PDF, saves the PDF blob into the repair's Drive folder, trashes the intermediate Doc. | Client Inventory + Settings sheets (read), master Email_Templates sheet (read), Drive (create + trash files). | out-of-scope |
| `SH_generateTaskWorkOrderPdf_` | Same flow as the repair version, but for tasks — assembles the Task Work Order PDF (task type, status, notes, item table, "WAREHOUSE USE ONLY" result-options box) and saves it into the task's Drive folder. | Same as `SH_generateRepairWorkOrderPdf_`. | out-of-scope |
| `SH_createItemFolder_` | Helper for `startTask_`. Given a parent Drive folder URL and a desired sub-folder name, returns the existing sub-folder's URL if one already exists with that name, otherwise creates a new sub-folder and returns its URL. Idempotent. | Drive (folder create / read). | internal-helper |
| `SH_getCellByHeader_` | Looks up a value in a row array using the (1-based) header-map index. Returns "" if the header isn't on the sheet. Used heavily inside the PDF-generation paths. | None — pure helper. | internal-helper |
| `startTask_` | The Start Task handler shared between the client-side onEdit handler and the Task Board push handler. Reads the task row, finds (or creates) the task's Drive folder under the parent Shipment folder (preferred) or the configured PHOTOS_FOLDER_ID, hyperlinks the Task ID cell to that folder URL, generates a Work Order PDF via `SH_generateTaskWorkOrderPdf_` if no PDF exists yet, hyperlinks the Shipment # cell to the shipment folder, stamps `Started At` to now, unchecks `Start Task`, flips Status to "In Progress" if it was "Open". Fully idempotent and retry-safe — re-running on an already-started task is a no-op. | Client Tasks / Shipments / Inventory / Settings sheets, Drive. | out-of-scope (P3 will graduate equivalent) |
| `processTaskCompletionById_` | The main task-complete handler. Locks via a `Completion Processed At` timestamp marker (skips if already processed). Sets Status='Completed', stamps `Completed At`, picks the service code (Svc Code or Type), looks up the rate via `SH_lookupRate_`, decides whether to bill based on Pass/Fail flags, writes a Billing_Ledger row via `SH_writeBillingRow_` (with "Missing Rate" sentinel if rate is zero), sets Billed=true only if rate found, finds any pre-generated Work Order PDF in the task folder, sends the appropriate completion email (INSP_EMAIL for inspections, TASK_COMPLETE otherwise) to staff + client with the PDF attached, updates the aggregated Task Notes on the Inventory row, marks `Completion Processed At`. Used by both the client-side and the Task Board edit handlers. | Client Tasks / Inventory / Billing_Ledger / Settings sheets, master Email_Templates sheet, Drive, GmailApp. | out-of-scope (P3 will graduate equivalent) |
| `processRepairCompletionById_` | The repair-complete handler. Same idempotency pattern. Sets Status='Complete', stamps `Completed Date`, computes the billing amount (Final Amount overrides Quote Amount, falls back to 0 with Missing Rate sentinel), writes a Billing_Ledger row, sends the REPAIR_COMPLETE template email to the client with the Work Order PDF attached. | Client Repairs / Inventory / Billing_Ledger / Settings sheets, master Email_Templates sheet, Drive, GmailApp. | out-of-scope (P4a will graduate equivalent) |
| `processRepairQuoteById_` | The repair-quote handler. Fires when the operator enters a Quote Amount. If already-sent-with-same-amount, skips. Flips Status from "Pending Quote" / "" to "Quote Sent", stamps Quote Sent Date, sends the REPAIR_QUOTE template email to the client with a "View Inspection Photos" button hyperlinking to the repair folder. | Client Repairs / Settings sheets, master Email_Templates sheet, GmailApp. | out-of-scope (P3 will graduate equivalent) |
| `processRepairApprovalById_` | The repair-approved handler. Idempotent via `Approval Processed At`. Sets Status='Approved'. Creates a REPAIR-{id} sub-folder under the item folder (or the configured PHOTOS_FOLDER_ID), hyperlinks the Repair ID cell to that folder, generates and saves the Repair Work Order PDF via `SH_generateRepairWorkOrderPdf_`, marks `Approval Processed At`. Non-fatal: folder/PDF errors are logged but don't fail the status flip. | Client Repairs / Inventory / Settings sheets, master Email_Templates sheet, Drive. | out-of-scope (P3/P4a will graduate equivalent) |
| `SH_updateInventoryTaskNotes_` | After a task completes, walks every Task row for that Item ID newest-first, builds a multi-line summary like "TASK-001 (Pass): notes" with the Task ID hyperlinked to its Drive folder, and writes it into the aggregated `Task Notes` column on the Inventory row via setRichTextValue. Empty if no tasks remain. | Client Tasks / Inventory sheets (read + rich-text write). | out-of-scope |

### Functions referenced in this file but defined elsewhere

| Function | Called from | Notes |
|---|---|---|
| `processRepairDeclinedById_` | `TB_OnBoardEdit` (line 2342) | Referenced when Approved="Declined" but NOT defined anywhere in `task board script.txt`. Expected to live in the parity-controlled shared handler block on the client-side `inventory code.gs`. If the client side is missing this function, "Declined" in the board will throw a ReferenceError. **Needs human review** to confirm the client-side definition exists. |
| `getActiveClients_` | `qrBuildIndex` (IndexBuilder, line 56) | Referenced as a sibling project-scope helper from a different .gs file in the QR Scanner project. Lives outside the two .gs files inventoried here (probably on the embedding Code.gs / CB-side project scope). Documented in IndexBuilder header comment but not in this inventory scope. |
| `SHARED_HANDLER_VERSION` | `TB_RefreshNow` (line 476) | Module-global string constant `"1.1.0"` — not a function. Marker for the parity-controlled shared handler block; must equal the value of the same constant in the client-side Inventory Code.gs. |

---

## Summary statistics

| Project | File | Top-level functions |
|---|---|---|
| Stax Auto Pay | StaxAutoPay.gs | 76 |
| QR Scanner | IndexBuilder.updated.gs | 8 |
| QR Scanner | ScannerBackend.updated.gs | 27 |
| Task Board | task board script.txt | 56 |
| **Total** | | **167** |

---

## Project: Stride Designer Campaign

> Source: `AppScripts/Email Campaign App/stridecampaignv2.5.gs` (3,221 lines, single file)
> Deployment: standalone Apps Script for marketing email campaigns to designers + architects.
> Migration role: **migrate last** per project owner. Most functions `P6` or `internal-helper`.
> Function count: **57**.

## Category: admin

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `setupCampaign` | One-click bootstrap. Creates (or finds) the "Stride Designer Campaign" spreadsheet, builds all 8 tabs with their headers and hover-notes, makes the Gmail labels, installs the time-based triggers, fills in default Settings rows, drops the token reference into the Templates tab, and imports the starting contact lists. Safe to re-run. | Drive (creates/finds spreadsheet), Script Properties (`CAMPAIGN_SHEET_ID`), all 8 sheet tabs, Gmail labels, Apps Script triggers | P6 |
| `refreshDashboard` | Rebuilds the Dashboard tab from scratch with global totals (contacts, suppressed, clients, pending, Gmail quota left) plus a per-campaign breakdown row (enrolled / sent / replied / bounced / unsub / converted / pending / exhausted) and a TOTALS footer. | Dashboard tab (clears and rewrites); reads Contacts, Campaigns, Campaign Contacts | P6 |

## Category: campaign-management

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `createNewCampaign` | Old-style menu command (pre-v2.5) that pops up a simple text-prompt asking for a campaign name, then drops a fully defaulted Draft row into the Campaigns tab (Sequence, priority 10, daily limit 50, test mode ON, 8am-5pm window). Operator then edits the row to configure templates and targeting before activating. | Campaigns tab (appends a Draft row) | P6 |
| `activateCampaign` | Validates the campaign row the user has selected (templates exist, follow-ups numbered right, dates valid, etc.) and if everything passes, flips Status to Active and enrolls all currently eligible contacts into the campaign. Writes validation results back to the campaign row. | Campaigns tab (validation status/notes, status), Campaign Contacts (enrolls); reads Templates | P6 |
| `pauseCampaign` | Sets the currently selected campaign's Status to Paused so the daily runner stops sending for it. | Campaigns tab (Status cell) | P6 |
| `completeCampaign` | Sets the currently selected campaign's Status to Complete and walks every Pending / Sent / Follow-Up Scheduled enrolment for that campaign and marks them Complete with reason "Campaign Completed." | Campaigns tab (Status), Campaign Contacts (status, completed date, completed reason) | P6 |
| `previewCampaignEmail` | Pops up a prompt asking for a Campaign ID, then renders the campaign's Initial template using a real (non-suppressed) contact's data and sends it to the campaign's test recipient (or the digest email if no test recipient set), with `[PREVIEW]` prefixed to the subject. Lets the operator visually proof an email before going live. | Reads Campaigns / Templates / Settings / Contacts; sends one Gmail message | P6 |

## Category: contact-management

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `importContacts` | Reads two external Stride spreadsheets (the master Architects & Interior Designers list and the Client Email Mailing List), filters out invalid / excluded / already-existing emails, derives names/companies, generates an unsubscribe token for each, and appends every brand-new contact to the Contacts tab. | Contacts tab (append-only); reads external spreadsheets via `openById` (sheet IDs `12cPe...` and `1jahM...`) | P6 |
| `processUnsubscribes` | One place that flips a contact from "active" to "unsubscribed everywhere": marks the row in Contacts as unsubscribed + globally suppressed, marks every active row in Campaign Contacts for that email as Unsubscribed, writes an entry to the Suppression Log, and applies the "Unsubscribed" Gmail label to any related threads. | Contacts, Campaign Contacts, Suppression Log; Gmail labels | P6 |
| `showAddContactForm` | Opens the modal HTML dialog used to add one contact by hand (first name / last name / email / company / existing-client toggle / optional campaign tag). | Spreadsheet UI (modal dialog) | P6 |
| `addContactFromForm` | Server-side handler triggered when the operator clicks "Add Contact" in the dialog. Validates required fields, refuses duplicates, then appends a new row to the Contacts tab with status Pending or Client based on the toggle. | Contacts tab (append) | P6 |

## Category: email-send

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `runAllCampaigns` | The main daily worker. Loops through every Active campaign in priority order, applies all hard rules (global suppression, 24-hour-between-emails, one-active-sequence-per-contact, daily campaign cap, Gmail quota, send window hours), builds the email, sends through Gmail (using the configured `from` alias / reply-to), captures the Gmail thread+message ID by searching for the embedded tracking marker, applies labels, updates Campaign Contacts and Contacts rows, logs each attempt, schedules follow-ups for sequence campaigns, and finishes by refreshing the dashboard and sending the daily digest. | Reads Campaigns / Settings / Templates / Contacts; writes Campaign Contacts, Campaign Log, Contacts (last-sent date), Campaigns (last error/last run); sends Gmail; applies Gmail labels | P6 |
| `buildEmail` | Takes a template (subject + HTML body), a contact, the campaign row, and the global settings, replaces every `{{Token}}` (First Name, Company, BookingURL, UNSUB_URL, EMAIL_HASH, sender info, dates, custom 1/2/3, etc.), and appends a 1-pixel invisible tracking marker to the body so the script can later find the sent thread in Gmail. Returns `{subject, body}` ready to send. | Pure-function-style, no sheet writes (but reads Settings/Campaign data passed in) | P6 |

## Category: entry-point

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `onOpen` | Runs every time the spreadsheet is opened. Builds the "Stride Campaign" custom menu (Add New Contact, Create New Campaign, Add New Template, Activate / Pause / Complete Campaign, Preview, Run All Campaigns, Check Inbox, Import Contacts, Refresh Dashboard, Send Daily Digest). | Spreadsheet UI (menu) | P6 |
| `doGet` | Public web-app endpoint hit when a recipient clicks "Unsubscribe" in an email. Validates the URL's `token` + `email` query parameters against the contact row, calls `processUnsubscribes` if they match, and returns a Stride-branded confirmation page that auto-redirects to stridenw.com after 3 seconds (or an error page if the token does not match). | Reads Contacts; calls `processUnsubscribes`; serves HTML | P6 |

## Category: helper-format

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `extractNameFromEmail_` | Best-guess first name / last name / company from just an email address — uses the dotted/underscored prefix for the name and the domain for the company. Falls back to empty fields if nothing useful can be parsed. | None (pure function) | internal-helper |
| `capitalize_` | Capitalises the first letter of a string and lowercases the rest. Used to clean up names pulled from imports. | None (pure function) | internal-helper |
| `toBool_` | Treats Sheets' inconsistent boolean values (real `true`, the string `"TRUE"`, lowercase `"true"`, non-zero numbers) as one boolean. | None (pure function) | internal-helper |
| `isValidEmail_` | Simple regex check that a string looks like an email address. Used during import and before sending. | None (pure function) | internal-helper |
| `generateEmailHash_` | Computes an MD5 hex hash of an email address, used to fill the `{{EMAIL_HASH}}` token in templates (an opaque tracking identifier). | None (pure function) | internal-helper |
| `generateTrackingMarker_` | Builds a unique per-send tag like `SID-ABC123...` from the campaign ID + email + step + current timestamp. The marker is hidden in every outgoing email so the script can find the resulting Gmail thread afterwards. | None (pure function) | internal-helper |
| `extractEmailFromHeader_` | Pulls the bare email address out of a "Name <email@example.com>" style Gmail "From" header. Used during reply detection. | None (pure function) | internal-helper |

## Category: helper-misc

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `ensureGmailLabel_` | Makes sure a single Gmail label (e.g. `Stride/Campaign/Sent`) exists; if not, creates it. Used during setup. | Gmail labels | internal-helper |
| `installTriggers_` | Idempotently installs the four Apps Script triggers needed: daily 7:30am Pacific `checkInbox`, daily 8:30am Pacific `runAllCampaigns`, spreadsheet onEdit (`onEditTrigger`), and spreadsheet onOpen (custom menu). Skips any that are already installed. | Apps Script triggers | internal-helper |
| `populateSettings_` | Fills the Settings tab with default values (digest email, booking URL, unsubscribe base URL placeholder, sender name/phone/email, send-from alias, website URL) but only for keys that are missing — won't overwrite anything the operator changed. | Settings tab | internal-helper |
| `addTokenReference_` | Drops the "TOKEN REFERENCE" section into the Templates tab (orange banner row 10 + list of tokens and their meaning starting row 11) so the operator has the merge-token cheat sheet right next to the templates. | Templates tab (rows 10+) | internal-helper |
| `generateUnsubToken` | Returns the unsubscribe token for an email address: looks up the contact's existing token first (never regenerates), otherwise computes a stable 32-char MD5 hex digest from the email + a salt and returns that. Used when adding new contacts. | Reads Contacts (token lookup); pure-computation otherwise | internal-helper |
| `scanDuplicates_` | Quick yes/no — is this email already in the existing contact data array? (Unused legacy-ish helper; the active code paths inline this check.) | None (pure function over data passed in) | internal-helper |

## Category: helper-sheet-io

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `ensureTab_` | Creates a tab if it doesn't exist, writes the header row with bold white-on-blue formatting, attaches the hover-note on each column heading, and freezes the header row. Used by `setupCampaign` for every tab. | Spreadsheet (creates sheet, header row formatting, frozen rows, notes) | internal-helper |
| `getSettings` | Reads the Settings tab into a plain `{key: value}` object so callers can do `settings['Booking URL']`. | Reads Settings tab | internal-helper |
| `getTemplates` | Reads the Templates tab into `{templateName: {name, subject, preview, body, version}}`. Stops at the "---" token-reference banner so reference rows aren't treated as templates. | Reads Templates tab | internal-helper |
| `getCampaigns` | Reads the Campaigns tab into an array of row arrays (skipping the header and any empty-ID rows). | Reads Campaigns tab | internal-helper |
| `getCampaignSheet_` | Opens the campaign spreadsheet using the ID stored in Script Properties (`CAMPAIGN_SHEET_ID`). Returns `null` if not set or if the open fails. Almost every other function calls this first. | Reads Script Properties; opens spreadsheet | internal-helper |
| `buildContactRow_` | Mechanical assembler — takes 21 individual contact fields and returns them as a single row-array in Contacts-tab column order. Keeps the column ordering in one place. | None (pure function) | internal-helper |
| `getNextCampaignId_` | Scans the Campaigns tab, finds the highest existing `CMP-####` ID, adds one, and returns the next zero-padded ID (e.g. `CMP-0003`). | Reads Campaigns tab | internal-helper |
| `enrollContacts_` | For one campaign, walks every contact in the Contacts tab, skips anyone already enrolled in this campaign, skips anyone who doesn't match the targeting rules, skips anyone already in another active sequence (for Sequence type), and appends Campaign Contacts rows for the new matches. | Reads Contacts, Campaign Contacts, Campaigns; writes Campaign Contacts (append) | internal-helper |
| `validateCampaign_` | Pre-flight check before a campaign can go Active — verifies the campaign has a name, valid type, real templates that exist in the Templates tab, follow-up count matches the templates filled in, daily limit > 0, send window correct, valid target type, target value present when required, valid dates, and a test recipient if test mode is on. Returns `{valid: bool, notes: string}`. | Reads passed-in templates map only | internal-helper |
| `isContactEligible_` | Yes/no — given one contact row and one campaign, should this contact be enrolled? Checks global suppression/bounce/unsub then applies the campaign's targeting filter (All Active Leads / Existing Clients / Non-Clients / Campaign Tag / Manual List). | None (pure function over row data) | internal-helper |
| `getActiveCampaignContactsForEmail_` | Yes/no — is this email already in an active Sequence campaign (other than the one we're about to enrol them in)? Enforces the hard rule "one active sequence per contact at a time." | Reads Campaigns, Campaign Contacts | internal-helper |
| `countCampaignSendsToday_` | Counts how many successful sends today's Campaign Log shows for one specific campaign. Used to enforce per-campaign daily limits. | Reads Campaign Log | internal-helper |
| `logCampaignSend_` | Appends one row to the Campaign Log capturing the send timestamp, campaign ID/name, recipient details, template name, step (Initial / Follow-Up N), subject, Success/Failed/Skipped result, any error message, and whether test mode was on. | Campaign Log (append) | internal-helper |
| `findCampaignRow_` | Returns the 1-based row number where a given Campaign ID lives in the Campaigns tab (or 0 if not found). | Reads Campaigns tab | internal-helper |
| `findContactRow_` | Returns the 1-based row number where a given email lives in the Contacts tab (or 0 if not found). | Reads Contacts tab | internal-helper |
| `updateCampaignStats_` | Recomputes the Total Sent / Replied / Bounced / Unsubscribed / Converted counts for one campaign by walking its Campaign Contacts rows, and writes the totals back onto the campaign row. | Reads Campaign Contacts; writes Campaigns tab | internal-helper |

## Category: template-management

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `showAddTemplateForm` | Opens the modal HTML dialog used to add a new email template (name, subject, preview text, version, full HTML body), with the available merge tokens listed for reference. | Spreadsheet UI (modal dialog) | P6 |
| `getAddTemplateFormHtml_` | Returns the HTML string for the Add Template dialog — styled Inter font, orange Stride accent, fields for template name / subject / preview / version / HTML body, and a token cheat-sheet panel. | None (returns HTML) | internal-helper |
| `addTemplateFromForm` | Server-side handler triggered by the Add Template dialog. Refuses duplicate template names, requires `{{UNSUB_URL}}` somewhere in the HTML body, inserts the template row above the token-reference section in the Templates tab. | Templates tab (insert row) | P6 |

## Category: tracking

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `checkInbox` | Daily 7:30 AM inbox sweep. Walks every Gmail thread we've sent to (via stored Thread IDs), spots replies from the contact, checks whether the reply contains unsubscribe keywords (and if so calls `processUnsubscribes`), otherwise marks the contact as Replied (which globally suppresses them in v1) and writes a Suppression Log entry. Then it searches Gmail for fresh mailer-daemon bounce messages, extracts the bounced email addresses, marks those contacts Bounced + globally suppressed, updates their Campaign Contacts rows, and applies the matching Gmail labels. Finishes by refreshing stats for all Active campaigns. | Reads Campaign Contacts, Contacts, Campaigns; reads/labels Gmail threads; writes Campaign Contacts, Contacts, Suppression Log, Campaigns | P6 |
| `sendDailyDigest` | Builds and sends the daily "Stride Campaign Daily Digest" email to the digest address (justin@stridenw.com by default) showing today's sends, per-campaign and global totals, errors, and remaining Gmail quota. Uses a Script Property `LAST_DIGEST_DATE` so it only sends once per calendar day even if called repeatedly. | Reads Campaigns, Campaign Log; sends one Gmail message; Script Properties (`LAST_DIGEST_DATE`) | P6 |

## Category: trigger

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `onEditTrigger` | Auto-fills the Date Added and Status columns when the operator types a new row directly into the Contacts tab (so they don't have to remember to set them). | Contacts tab | P6 |
| `onEdit` | Tiny wrapper that just calls `onEditTrigger`. Exists in case the simple (non-installable) onEdit hook is the one wired up. | Contacts tab | internal-helper |
| `scheduleFollowUps_` | For one sequence campaign, walks its Campaign Contacts rows, finds anyone whose last send was N days ago and still has follow-ups left, flips their status to "Follow-Up Scheduled" and bumps Current Step to the next follow-up. Anyone who's hit max follow-ups gets marked "Exhausted" and labeled accordingly in Gmail. Called from the end of each `runAllCampaigns` pass. | Campaign Contacts tab; Gmail labels | P6 |
| `scheduleFollowUps` | Manual / standalone wrapper — re-runs `scheduleFollowUps_` for every Active Sequence campaign. Useful if you want to force a re-check outside the normal daily run. | Reads Campaigns; writes Campaign Contacts | P6 |

## Category: ui-form

| Function | What it does (plain English) | What it affects | Migration |
|---|---|---|---|
| `getAddContactFormHtml_` | Returns the HTML string for the Add Contact dialog — styled with Inter font and the Stride orange accent. Inline JS calls back to `addContactFromForm` on submit. | None (returns HTML) | internal-helper |
| `showCreateCampaignForm` | Opens the modal HTML dialog used to create a campaign. Reads the Templates tab first so the dialog's template dropdowns show the actual available templates. | Reads Templates; opens UI dialog | P6 |
| `getCreateCampaignFormHtml_` | Returns the HTML string for the Create Campaign dialog — name, type, priority, targeting, enrollment mode, all four template dropdowns (initial + 3 follow-ups), follow-up count/interval/daily limit, send window, test mode + recipient. | None (returns HTML) | internal-helper |
| `createCampaignFromForm` | Server-side handler triggered by the Create Campaign dialog. Generates the next campaign ID and appends a new Draft row to the Campaigns tab with everything the operator entered. | Campaigns tab (append) | P6 |

---

## Cross-references

- `MIGRATION_STATUS.md` — authoritative project state, decisions MIG-001 through MIG-010, per-function migration table.
- `CODE_MAP.md` — React feature → file location map (frontend side).
- `BUILD_STATUS.md` — global change log.
- `_archive/Docs/Archive/Session_History.md` — one-liner per session.
