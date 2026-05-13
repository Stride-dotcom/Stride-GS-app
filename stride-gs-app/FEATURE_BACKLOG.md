# Stride GS App — Feature Backlog

> Features requested but not yet built. Prioritize with Justin before starting.

---

## Delivery / DispatchTrack

- [ ] Delivery activity tracking on dispatch + complete (currently only fires on order creation)
- [ ] Non-app-created delivery releases — auto-release inventory when DT completes orders created outside the app
- [ ] POD photo ingestion — needs DT REST `X-AUTH-TOKEN` (Settings → Advanced Settings or DT support). Then call `GET /api/external/v1/dispatches/:identifier`, write `form.img_url[]` into `dt_order_photos`, optionally fetch each into the `dt-pod-photos` storage bucket
- [ ] **PU→Delivery item-sync Phase 2.5** — extend `dt-push-order` to merge `pickup_item_note` into the per-item DT push so the DT delivery card shows the PU driver's note inline alongside the item. Today the note appears in our app (audit column rendered as "From pickup" sub-row) but stops at our DB — the DT delivery driver only sees it if they look up the linked pickup order. Small change to the per-item description/note builder in `dt-push-order/index.ts`.
- [ ] **PU→Delivery item-sync historical-pair link cleanup** — 2 historical P+D pairs (`MRS-00047`, `MRS-00049`) didn't auto-backfill `parent_pickup_item_id` (count mismatch / prefix variants). New pairs use the forward-path FK from CreateDeliveryOrderModal, so this is cleanup-only. Manual SQL link or hand-pick a description-fuzzier backfill.
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

## Entity Pages

- [ ] DetailPanel internals v2 polish — deep interiors still have old styling in places
- [ ] Generate Work Order button from TaskDetailPanel (backend handler exists, needs React wiring)

## Repairs

- [ ] **Per-item pass/fail toggle UI on RepairDetailPanel** — `repair_items.item_result` column + read-only display shipped in PR #397. Need staff-edit affordance (checkbox or two-state pill per row) that writes the result back. Informational only — doesn't affect billing or parent status.
- [ ] **Re-quote / edit-items flow for existing repairs** — current SB path is create-only. Adding/removing items would invalidate the quote, so the right pattern is either (a) "Re-quote" action that nulls quote_amount + lets staff add/remove items + sends a new REPAIR_QUOTE email, or (b) keep cancel-and-rebuild as the only path. Punted from PR #397.
- [ ] **Legacy single-item repair-quote path → SB cutover** — TaskDetailPanel / ItemDetailPanel "Request Repair Quote" buttons still route through the GAS `handleRequestRepairQuote_` endpoint (folder creation + email). Cutover them to `request-repair-quote-sb` (which already handles single-item correctly — just pass `itemIds: [oneItem]`) once the multi-item path has soaked.
- [ ] **REPAIR_QUOTE / REPAIR_APPROVED / REPAIR_DECLINED / REPAIR_COMPLETE templates for multi-item** — currently use single-item tokens (ITEM_ID, SIDEMARK, LOCATION) populated from the primary item. Multi-item versions can lean on the same `{{ITEM_TABLE_HTML}}` pattern the REPAIR_QUOTE_REQUEST already uses.
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
