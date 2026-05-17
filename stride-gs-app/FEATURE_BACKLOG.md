# Stride GS App — Feature Backlog

> Features requested but not yet built. Prioritize with Justin before starting.

---

## Delivery / DispatchTrack

- [ ] Delivery activity tracking on dispatch + complete (currently only fires on order creation)
- [ ] Non-app-created delivery releases — auto-release inventory when DT completes orders created outside the app
- [ ] POD photo ingestion — needs DT REST `X-AUTH-TOKEN` (Settings → Advanced Settings or DT support). Then call `GET /api/external/v1/dispatches/:identifier`, write `form.img_url[]` into `dt_order_photos`, optionally fetch each into the `dt-pod-photos` storage bucket
- [ ] **PU→Delivery item-sync Phase 2.5** — extend `dt-push-order` to merge `pickup_item_note` into the per-item DT push so the DT delivery card shows the PU driver's note inline alongside the item. Today the note appears in our app (audit column rendered as "From pickup" sub-row) but stops at our DB — the DT delivery driver only sees it if they look up the linked pickup order. Small change to the per-item description/note builder in `dt-push-order/index.ts`.
- [ ] **PU→Delivery item-sync historical-pair link cleanup** — 2 historical P+D pairs (`MRS-00047`, `MRS-00049`) didn't auto-backfill `parent_pickup_item_id` (count mismatch / prefix variants). New pairs use the forward-path FK from CreateDeliveryOrderModal, so this is cleanup-only. Manual SQL link or hand-pick a description-fuzzier backfill.
- [ ] **DT add_order partial-update semantics — investigation blocking field-level merge.** Every edit-save in `CreateDeliveryOrderModal` calls `repushOrdersAfterEdit`, which posts the full XML to DT's `POST /orders/api/add_order`. `add_order` is upsert-by-identifier, so a re-push overwrites whatever a dispatcher edited directly in DT (customer address, window, notes, items, etc.) between our pushes. We don't yet know whether `add_order` preserves or clears fields we omit from the XML payload. **Ask Ashok at `support@dispatchtrack.com`** for each field group — customer block, delivery window, description/notes, items list, service_time, custom fields — does omitting the element on a re-push (a) preserve existing DT value, (b) clear it, or (c) reject? Once known, implement field-level merge in `supabase/functions/dt-push-order/index.ts`: pull DT state via `export.xml` immediately before push, send only fields where our value differs (or where DT clears-on-omission, re-send DT's current value). Until then, the auto-fire republish on every save remains a footgun — an opt-in "Republish to DT" checkbox (~1 hr) is the smallest tide-over fix if it bites before Ashok responds. Email draft + answer-conditional implementation matrix captured in the 2026-05-14 session transcript.
- [ ] **Pickup-only → P+D conversion** — symmetric to PR #431's delivery→P+D, but adds a delivery leg to an existing standalone pickup. Different pickup-contact field semantics on edit-open (the existing pickup's contact_* fields ARE the pickup-leg contact, not the delivery-leg contact), so a separate save branch + edit-load path. Scope was deliberately deferred from PR #431.
- [ ] **Reverse conversion (P+D → delivery-only)** — drop the pickup leg from an in-flight P+D when the client decides they'll deliver to us themselves. Mirror of PR #431's path. Needs DT-side handling for the orphaned pickup record.
- [ ] **Edit-time item reload-on-open across all three edit branches** — `selectedInvItems` derivation silently drops items that have been released/transferred since the order was created (they fall out of `liveItems`). Affects existing P+D edit, single-leg edit, AND the new convert-to-P+D path. Worst impact is on convert-to-P+D where item preservation is the user's stated priority. Hardening: on edit-load, hydrate state from the on-row dt_order_items snapshot directly rather than filtering through the live inventory catalog.
- [x] **Orders service-date range filter** — URL-persisted `?from=&to=` range over the effective service date (operator `localServiceDate` → DT `scheduledAt` Pacific), Today quick-set + Clear, back-button-safe, client-side. Shipped 2026-05-17 (PR #452).
- [x] **PU→Delivery item-sync engine** — order-level "Picked up [when] by [driver]" banner + per-item picked_up_at indicator + Tier-B field propagation (qty / pickup_item_note / pickup_return_codes) + auto-push-back of updated delivery manifest to DT. Shipped 2026-05-13 (PRs #388 + #389).
- [x] **Bi-directional DT sync — pulls full export.xml per active order into the cache (driver, truck, start/finish, COD, signature, items, history, notes). Shipped 2026-04-25 (session 82, PRs #61+#62).**
- [x] **Customizable add-on charges — Qty + Rate editable per add-on on order entry / Full Edit. Catalog rate is the default; staff/admin can override; clients edit qty only. Shipped 2026-04-30 (session 84).**
- [x] **Unified addons module — polymorphic `addons` table replaces task-only `task_addons`. Tasks, repairs, and will calls all flush addons via one GAS helper (`api_writeAddonsToLedger_`). Shipped 2026-05-04 (StrideAPI.gs v38.177.0).**

## Billing / Payments

- [ ] Step 2 of unified addons — Supabase-native billing pipeline (`handleCreateInvoice_` reads from `public.billing` directly so the client sheet becomes a read-cache mirror). Advances Decision #33. Separate strategic call.

- [ ] Phase 5 billing cutover flip — switch from MPL sheet to Supabase-primary once parity confirmed
- [ ] Insurance auto-billing — cron-based insurance charge generation (schema exists, logic pending)
- [ ] Invoice-level `invoiceDate` field on `InvoiceGroup`
- [ ] Invoice number link in billing summary row
- [x] **CB Consolidated_Ledger auto-reconcile from public.billing on every QBO push — bridge for the silent-drop class (INV-001152 + 6 stuck siblings). Reads `public.billing` as source of truth, brings CB into agreement before grouping. Transitional until P4b retires CB. Shipped 2026-05-14 (PR #438, StrideAPI.gs v38.222.0).**

## Entity Pages

- [ ] DetailPanel internals v2 polish — deep interiors still have old styling in places
- [ ] Generate Work Order button from TaskDetailPanel (backend handler exists, needs React wiring)

## Repairs

- [ ] **Per-item pass/fail toggle UI on RepairDetailPanel** — `repair_items.item_result` column + read-only display shipped in PR #397. Need staff-edit affordance (checkbox or two-state pill per row) that writes the result back. Informational only — doesn't affect billing or parent status.
- [ ] **REPAIR_QUOTE / REPAIR_APPROVED / REPAIR_DECLINED / REPAIR_COMPLETE templates for multi-item** — currently use single-item tokens (ITEM_ID, SIDEMARK, LOCATION) populated from the primary item. Multi-item versions can lean on the same `{{ITEM_TABLE_HTML}}` pattern the REPAIR_QUOTE_REQUEST already uses.
- [ ] **Backfill the edge-function role gate to the other repair SB handlers** — re-quote-repair (PR #420) now explicitly checks `user_metadata.role ∈ {admin,staff}` before invoking its service-role RPC, because the SECURITY DEFINER role check inside the RPC is bypassed when PostgREST sees `service_role`. The same auth gap exists in cancel-repair-sb, start-repair-sb, send-repair-quote-sb, respond-repair-quote-sb, complete-repair-sb, and request-repair-quote-sb — a logged-in `client` JWT can call any of them and mutate repairs in any tenant. Fix is a 6-line edit per function copying the pattern from re-quote-repair `index.ts:71-105`. Low priority because the React UI doesn't expose these buttons to clients today, but it's a defense-in-depth gap.
- [x] **CASCADE FK on repair_items → repairs — prevents orphan child rows if a parent repairs row is deleted. Added defensively after 2026-05-14 incident where 15 orphan repair_items survived a manual parent cleanup during PR #397 testing. Migration also adds a UNIQUE (tenant_id, repair_id) on repairs as the FK target. Shipped 2026-05-14 (PR #430).**
- [x] **Re-quote / edit-items flow for existing repairs — staff can now add/remove items on a Pending Quote / Quote Sent repair without cancel-and-rebuild. RPC `re_quote_repair` is atomic (delete+insert+update+audit); edge function `re-quote-repair` mirrors the parent row back to the per-tenant Repairs sheet. UI: "Edit Items" button in RepairDetailPanel → ReQuoteRepairModal with inventory picker. Shipped 2026-05-14 (PR #420).**
- [x] **[MIGRATION-P3] `requestRepairQuote` single-item SB cutover — TaskDetailPanel + ItemDetailPanel routed through request-repair-quote-sb. Shipped 2026-05-14 (PR #418).**
- [x] **[MIGRATION-P4a] `completeRepair` SB cutover — atomic `complete_repair_atomic` RPC writes public.repairs UPDATE + public.billing INSERTs + addons UPDATE + audit log in one transaction; edge function mirrors to per-tenant Billing_Ledger + Repairs sheet; REPAIR_COMPLETE email via Resend. Shipped 2026-05-14 (PR #419).**
- [x] **[MIGRATION-P3] cancelRepair / startRepair / sendRepairQuote / respondToRepairQuote — SB-primary via Path-C hybrid. 4-of-6 in the repair P3 cluster. Shipped 2026-05-13 (PRs #405, #406, #407, #408). Flags: `cancelRepair`, `startRepair`, `sendRepairEmails`.**
- [x] **Multi-item repair jobs — select N items → ONE repair with N items underneath. Mirrors will_calls/will_call_items pattern. SB-authoritative create via SECURITY DEFINER RPC + edge function. Shipped 2026-05-13 (PR #397).**

## Inventory

- [ ] Auto-Print Labels from Receiving (toggle for inline label printing)
- [ ] Parent Transfer Access — parent users transfer items between their own child accounts

## Search / Navigation

- [ ] Global search expansion — add shipments, billing, claims entities + missing fields
- [ ] Phase 2 of useUrlState — convert search input, status pill filters, and table sort state to URL params (right now they live in component state / localStorage — back-button doesn't restore them mid-session). Pattern: `useUrlState('q', '', { replace: true })` for search (push-suppressed so typing doesn't bloat history), `useUrlState('status', '')` for filter pills (push), `useUrlState<SortingState>('sort', [], { encoder: jsonEncoder })` for sort. Per-page, mostly mechanical.
- [ ] Phase 3 of useUrlState — scroll restoration on back-nav. AppLayout-level hook that saves `scrollY` in `history.state` on scroll (replace) and restores on `popstate`. Tricky bit: TanStack-virtualized tables need restoration to wait until rows have measured.

## Infrastructure

- [ ] Sync delivery zones to MPL sheet tab (data in Supabase, no GAS consumer today)

## Known Bugs

- [ ] GitHub Pages CDN caching — hard-refresh needed after deploy to verify new bundle
- [ ] `populateUnbilledReport_()` in CB Code.gs.js uses old header names ("Billing Status", "Service Date")
- [ ] `CB13_addBillingStatusValidation()` looks for "Billing Status" instead of "Status"
- [ ] Transfer Items dialog needs processing animation + disable buttons after complete
- [ ] Repair discounts — should be disabled
