# Architectural Decisions Log (Full)

> The main `CLAUDE.md` carries only the ~20 most load-bearing invariants that affect day-to-day code generation. This archive preserves the complete numbered list from the original CLAUDE.md, including feature-description entries and historical one-off decisions. Look here when you need context on why something was built a specific way.

---

1. **Consolidated_Ledger is the authoritative billing schema**; clients sync from it.
2. **"Ledger Row ID"** (not "Ledger Entry ID") is the canonical ID column.
3. **Header-based column mapping** everywhere — never positional.
4. **Non-destructive header updates** — rename legacy + append missing, never reorder/remove.
5. **Settings sync is one-way:** CB Clients tab → client Settings tab.
6. **Invoice PDFs use Google Doc templates**; other 4 doc types still use HTML import.
7. **Import Inventory uses local tab copy** (user pastes old tabs into new sheet).
8. **Storage charge dedup:** only skip Invoiced/Billed/Void; unbilled STOR rows deleted + recreated.
9. **Inventory filters use `getMaxRows()` range** so new rows auto-included.
10. **Task Board uses parity-controlled shared handler functions** duplicated from client script (`SHARED_HANDLER_VERSION = "1.0.0"`, `SH_` prefix). Both files must be updated together. See `Docs/Task_Board_Refactor_Plan_FINAL.md`.
11. **Storage rate = Base rate per cuFt × Class cubic volume × (1 - discount%)**. Classes: XS=10, S=25, M=50, L=75, XL=110 cuFt.
12. **Discount convention:** negative pct = discount, positive pct = surcharge. Range **-100 to +100** (widened from ±10 in StrideAPI.gs v38.7.0 / Billing.gs v3.2.0 / Transfer.gs v3.1.0 / Triggers.gs v4.4.0 — values outside the range are silently ignored as a typo safety rail, not clamped). Formula: `rate * (1 + pct / 100)`. Transfer behavior: source discount is reversed to recover base rate, then destination discount applied → transferred ledger rows **adopt the destination client's rates** (REPAIR/RPR rows skip re-application — manually priced).
13. **Warehouse locations are centralized on CB** (same for all clients). Sidemarks/vendors/descriptions are per-client.
14. **Location dropdowns use `setAllowInvalid(true)`** — users can type values not in the list.
15. **Task creation is menu-driven (batch)** — NOT checkbox-driven. Heavy work (Drive folders, PDFs) deferred to "Start Task" checkbox.
16. **Drive folder structure: flat entity subfolders** under `DRIVE_PARENT_FOLDER_ID`. Each entity type has its own top-level category folder: `Shipments/`, `Tasks/`, `Repairs/`, `Will Calls/`. No nesting between entity types. `getOrCreateEntitySubfolder_()` self-heals on first use. Claims stay on CB level (separate `CLAIMS_PARENT_FOLDER_ID`).
17. **Email/doc templates cached locally on each client sheet** (`Email_Template_Cache` tab). Check local first, fall back to Master if no cache.
18. **Import shipment format:** `IMP-MMDDYYHHMMSS`. Photo URLs from old system hyperlinked on Shipment # field.
19. **Duplicate Item ID protection:** QE_CompleteShipment blocks if any dock Item IDs match existing Active/On Hold inventory.
20. **Remote admin uses Web App `doPost()` endpoints** (not `scripts.run` — Execution API blocked by 403 in this Workspace). Each client script deployed as Web App with shared auth token. `run-remote.mjs` handles Google's 302 redirect. Web App deployments are frozen snapshots — use `npm run deploy-clients` / `deploy-api` / `deploy-all` to update programmatically.
21. **Shipments API returns lightweight headers only** (no inventory items); items lazy-loaded via separate `getShipmentItems` endpoint.
22. **Remote admin operations are async** — fire-and-forget via time-based triggers. `sync-status` polls completion. `refresh-caches` uses two-phase triggers for large clients (Phase 1: cache copy + dropdowns, Phase 2: rate recalc) to stay under 6-min execution limit.
23. **`StrideClientUpdateHeadersAndValidations()` is non-destructive** (v4.3.0) — no `clearSheetDataValidations_()`, no `removeColumnsByName_()`. Only adds missing headers and applies validations to specific target columns.
24. **Folder URL reads (RichTextValues) are always-on** for all GET endpoints (v26.7.0). Performance tradeoff accepted (~200ms per client) so folder buttons work for all users.
25. **`api_readIdFolderUrls_` checks both whole-cell `getLinkUrl()` and individual text runs** via `getRuns()` (v26.7.0) — partial rich-text hyperlinks only accessible through run-level inspection.
26. **Shared `FolderButton` component** standardizes all folder buttons across detail panels. Disabled state tooltips direct users to "Fix Missing Folders" tool.
27. **`fixMissingFolders` endpoint** scans all 6 sheet tabs for rows without hyperlinked IDs and creates Drive folders. React button on Settings → Maintenance loops through all clients.
28. **Auto-generated Item IDs:** counter in CB Settings as `NEXT_ITEM_ID` (starts 80000). Plain sequential integers. `getNextItemId` uses LockService. Feature OFF by default.
29. **Inline item editing (v27.0.0):** `updateInventoryItem` POST endpoint. Role-gated: clients edit Vendor/Description/Reference/Sidemark/Room; staff/admin additionally edit Location/Class/Qty/Status/Item Notes. All validation server-side.
30. **onEdit parity for React app (v28.6.0):** Since Apps Script programmatic writes do NOT fire onEdit triggers, all onEdit side-effects are replicated in StrideAPI.gs POST endpoints. `updateInventoryItem` propagates 5 fields to open Tasks/Repairs. `completeTask` aggregates task summaries on Inventory row. `updateWillCall` auto-promotes Pending→Scheduled when date is set.
31. **Custom Task Pricing (v28.3.0):** "Custom Price" column on Tasks sheet. `updateTaskCustomPrice` endpoint. `completeTask` checks Custom Price before normal rate lookup (overrides billing amount).
32. **Request Repair Quote (v28.3.0):** `requestRepairQuote` creates Repair row with "Pending Quote" status + sends REPAIR_QUOTE_REQUEST email. Sticky button state shows repair status across 4 UI surfaces.
33. **Task Board decommissioning:** React app handles all task/repair/WC operations. Task Board's `TB_RefreshNow` timer trigger is no longer needed.
34. **Move History tab:** auto-created on first write, one row per item move. "Type" column distinguishes "Location" moves (same-client) from "Transfer" moves (cross-client). Transfers logged on both source AND destination client sheets (v32.1.0).
35. **Persistent status filters:** all 7 table pages save/restore active status filter chip selection to localStorage via `useTablePreferences` (keyed by page + user email).
36. **Sidemark color highlighting:** 14 fixed pastel colors assigned per unique sidemark per client (deterministic hash). Visual grouping only — no data changes.
37. **Storage billing preview mode:** `previewStorageCharges` endpoint calculates STOR charges without writing. "Commit to Ledger" separates preview from commit to prevent accidental double-billing.
38. **Free Receiving toggle:** "Receiving Charge" checkbox in Dock Intake (ON by default). `skipReceivingBilling: true` skips RCVG billing row.
39. **Will Call item management (v29.2.0):** Items can be added/removed from existing open WCs (Pending/Scheduled only — Partial excluded since v29.4.0). `addItemsToWillCall` validates against duplicates, computes fees. `removeItemsFromWillCall` auto-cancels WC if all items removed.
40. **Will Call PDF deferred to release (v29.6.0):** PDF generated at release time only (for accuracy after add/remove). Drive folder still created at WC creation. Task Work Order PDFs also removed — only repairs generate work order documents.
41. **Partial WC split tracking (v29.4.0):** `[Split → WC-XXXXX]` appended to original WC's Notes field. React parses this to show persistent purple banner with clickable link.
42. **Bulk Release Items (v29.7.0):** `releaseItems` endpoint sets Release Date + Status=Released. Staff/admin only, no billing rows. Records release event in Item Notes.
43. **Server cache bypass (v29.5.0):** `noCache=1` query parameter on GET endpoints skips CacheService read (10-min TTL). Per-page refresh buttons use this for truly fresh data.
44. **Email template `{{APP_URL}}` token (v30.0.0):** `api_sendTemplateEmail_` auto-injects `{{APP_URL}}` = `https://www.mystridehub.com/#`. All 9 operational templates use `{{APP_URL}}/page` CTAs. SHIPMENT_RECEIVED includes onboarding box.
45. **Parent/Child Account System (v32.0.0):** One-level hierarchy only. `PARENT_CLIENT` column on CB Clients tab. `getAccessibleClientScope_()` resolves scope server-side with 60s cache. `withClientIsolation_()` accepts scope arrays. Email routing unchanged — parent is NOT auto-CC'd on child-account emails.
46. **Transfer history logging (v32.1.0):** `transferItems` writes Move History row to both source and destination client sheets. "Type" column = "Transfer".
47. **Sidemark filter on billing (v32.2.0):** Multi-select sidemark filter in Unbilled Report + Storage Preview modals. Server-side `sidemarkFilter` array param.
48. **Settings Maintenance admin actions:** Fix Missing Folders moved here. Sync Autocomplete DB button rebuilds per-client Autocomplete_DB from existing Inventory data. Send Welcome Email per-client button.
49. **Resizable detail panels:** `useResizablePanel(defaultWidth, panelKey, isMobile)` hook. 360-800px range. Persists to localStorage per panel type. Desktop only — mobile always full-screen.
50. **Edit/Save mode for detail panels:** Replaces save-on-blur. `isEditing` toggles view/edit. `draft` holds pending changes. Save batches all changes in one API call. `optimistic` state shows saved values until cache refreshes.
51. **QR Scanner + Label Printer hardening (v2.2.0):** Dual label config (item/location independent). 7 location field defs. Bulk paste with dedup. Preview capped at 50 labels (batched print). Scanner decode throttled to ~20 FPS. `SCAN_GAP` 800ms. Progressive camera 640→1280. Deferred location loading. Hardware wedge support (120ms keystroke buffer).
52. **Billing ledger sidemark display (v38.6.0):** `handleGetBilling_` and `handleGetBatch_` resolve Item ID → Sidemark from Inventory (Billing_Ledger has no Sidemark column). Supabase `billing` table got `sidemark` column added via migration. `api_buildInvFieldsByItemMap_` extended with sidemark map.
53. **PDF generation retry-with-backoff (v38.8.0):** `api_fetchWithRetry_` helper wraps `api_createGoogleDocFromHtml_` + PDF export in `api_exportDocAsPdfBlob_`. 1s/2s/4s/8s exponential backoff on 403 rate-limit / 429 / 5xx. Fixes transient Drive `files.copy` throttling. Paired with GCP project link (number `1011527166052`) which raises Drive copy ceiling ~10x vs Apps Script default shared pool.
