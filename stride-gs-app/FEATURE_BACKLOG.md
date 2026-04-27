# Stride GS App — Feature Backlog

> Features requested but not yet built. Prioritize with Justin before starting.

---

## Delivery / DispatchTrack

- [ ] Delivery activity tracking on dispatch + complete (currently only fires on order creation)
- [ ] Non-app-created delivery releases — auto-release inventory when DT completes orders created outside the app
- [ ] POD photo ingestion — needs DT REST `X-AUTH-TOKEN` (Settings → Advanced Settings or DT support). Then call `GET /api/external/v1/dispatches/:identifier`, write `form.img_url[]` into `dt_order_photos`, optionally fetch each into the `dt-pod-photos` storage bucket
- [x] **Bi-directional DT sync — pulls full export.xml per active order into the cache (driver, truck, start/finish, COD, signature, items, history, notes). Shipped 2026-04-25 (session 82, PRs #61+#62).**
- [x] **Ad-hoc line items in delivery mode — free-text description/qty/weight/cuft alongside inventory items, with pricing counting both. Shipped 2026-04-27 (session 84, PR #106).**
- [x] **Public service-request form at `/#/public/service-request` — anon submission lands in Review Queue with `source='public_form'`, sends submitter confirmation + internal alert email, recipient list configurable in Settings → Notifications. Shipped 2026-04-27 (session 84, PR #106).**

## Billing / Payments

- [ ] Phase 5 billing cutover flip — switch from MPL sheet to Supabase-primary once parity confirmed
- [ ] Insurance auto-billing — cron-based insurance charge generation (schema exists, logic pending)
- [ ] Invoice-level `invoiceDate` field on `InvoiceGroup`
- [ ] Invoice number link in billing summary row

## Entity Pages

- [ ] DetailPanel internals v2 polish — deep interiors still have old styling in places
- [ ] Generate Work Order button from TaskDetailPanel (backend handler exists, needs React wiring)

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
