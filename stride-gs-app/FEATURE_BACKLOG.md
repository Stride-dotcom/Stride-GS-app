# Stride GS App — Feature Backlog

> Features requested but not yet built. Prioritize with Justin before starting.

---

## Delivery / DispatchTrack

- [ ] Delivery activity tracking on dispatch + complete (currently only fires on order creation)
- [ ] Non-app-created delivery releases — auto-release inventory when DT completes orders created outside the app
- [ ] POD photo ingestion from DT CDN to Supabase storage (Phase 2)
- [ ] Bi-directional DT sync — polling API for status updates (Phase 2-3)

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

## Infrastructure

- [ ] GitHub clone out of Dropbox — move local clone to non-synced path to prevent write-conflict bugs
- [ ] Sync delivery zones to MPL sheet tab (data in Supabase, no GAS consumer today)

## Known Bugs

- [ ] GitHub Pages CDN caching — hard-refresh needed after deploy to verify new bundle
- [ ] `populateUnbilledReport_()` in CB Code.gs.js uses old header names ("Billing Status", "Service Date")
- [ ] `CB13_addBillingStatusValidation()` looks for "Billing Status" instead of "Status"
- [ ] Transfer Items dialog needs processing animation + disable buttons after complete
- [ ] Repair discounts — should be disabled
