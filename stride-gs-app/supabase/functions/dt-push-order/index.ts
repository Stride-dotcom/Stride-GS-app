/**
 * dt-push-order — Supabase Edge Function (Phase 2c) — v43 2026-05-30 PST
 *
 * v43: Multi-pickup Phase 1.5 — N-leg fan-out via dt_pickup_links.
 *      v42 still pushed only ONE linked pickup (the one denormalized
 *      into dt_orders.linked_order_id), so an N-pickup delivery
 *      required N separate manual pushes from each pickup's page to
 *      get every leg to DT. v43 adds a Section 4.5 fan-out: after
 *      Section 4 handles the linked_order_id pickup, the function
 *      fetches all OTHER pickups for the same delivery from
 *      dt_pickup_links (excluding ids already handled) and pushes
 *      each in turn with the same date/window fallback, item dedup,
 *      and cross-ref payload Section 4 already uses.
 *
 *      Fan-out failures are collected, not fatal — the response
 *      carries `additional_pickup_failures` so the caller can warn
 *      the operator about partial-success state. This avoids
 *      stranding N legs in an inconsistent "some pushed, some not"
 *      world when one DT API call hiccups.
 *
 *      The response gains `additional_pickup_identifiers` listing
 *      the extra pickups pushed in this round (empty for orders with
 *      0 or 1 pickup legs).
 *
 * v42: Multi-pickup Phase 1 — per-leg notes split + completion warning relay.
 *      Previously a single `driver_notes` column pushed to BOTH legs of a
 *      P+D pair, so dispatch couldn't give the pickup driver different
 *      instructions than the delivery crew. v42 reads:
 *        • dt_orders.pickup_notes   on the pickup leg
 *        • dt_orders.delivery_notes on the delivery leg
 *      Each falls back to legacy driver_notes/order_notes/details when
 *      the per-leg column is NULL so rows created pre-split keep
 *      producing identical DT payloads.
 *
 *      Delivery-leg push also fetches dt_pickup_links rows for this
 *      delivery and prepends any pickup_completion_notes (driver-
 *      authored notes captured by dt-sync-statuses after the pickup
 *      finished) as a "⚠ PICKUP NOTES FROM DRIVER:" warning so the
 *      delivery crew sees pickup-side surprises ("rug arrived wet",
 *      "missing hardware") in their DT card. Empty/missing
 *      pickup_completion_notes → no prefix, unchanged behavior.
 *
 * v41: DT account verification fallback. Symptom: NIP-00127 (2026-05-26)
 *      was the first push to a brand-new tenant. The Stride map had the
 *      tenant correctly mapped to "NIP TUCK REMODELING" but DT's actual
 *      account was misspelled "NIP TUCK REMODLING" (missing the second
 *      E). DT's add_order silently dropped the unrecognized account
 *      name and the order landed orphaned.
 *
 *      Fix: resolveAccountName now consults a per-tenant verification
 *      allowlist (`dt_credentials.verified_account_tenants` jsonb array).
 *      Tenants NOT in the list get pushed under STRIDE LOGISTICS as a
 *      safety fallback — the order at least lands somewhere visible.
 *      The push update stamps `dt_orders.pushed_account_was_fallback`
 *      to TRUE so the OrderPage UI can warn the operator: "we pushed
 *      under STRIDE LOGISTICS because [tenant]'s DT account hasn't
 *      been verified."
 *
 *      Backfill in migration 20260526200000 auto-verified every tenant
 *      with ≥2 prior successful pushes (proxy for "this account is
 *      working") so existing relationships didn't regress. New tenants
 *      need an explicit verification SQL after the operator confirms
 *      the DT-side account exists EXACTLY as mapped:
 *        UPDATE dt_credentials SET verified_account_tenants =
 *          COALESCE(verified_account_tenants, '[]'::jsonb)
 *          || to_jsonb('<TENANT_ID>'::text);
 *      (A UI button to do this lives in the DT Account Mapping page —
 *      to be added in a follow-up PR; for now operators run the SQL.)
 *
 *      pushed_account_was_fallback is stamped on BOTH legs of a P+D
 *      pair because both share the tenant + verification state.
 *
 * v40 2026-05-26 PST:
 * v40: Items are now sorted by `dt_item_code` natural-numeric order
 *      before being emitted to DT (natural = "9" < "10" < "100", not
 *      lexicographic which would order them "10","100","11","9"). Fixes
 *      the historical "91-row order shows up on DT in random order"
 *      complaint — DT was receiving items in whatever order Postgres
 *      returned them (effectively insertion order, but not guaranteed).
 *      Ad-hoc rows (no dt_item_code) sort to the end by description so
 *      they cluster but don't interleave with inventory rows. Sort is
 *      applied client-side in TS because Supabase-JS `.order()` can't
 *      express `LENGTH(col), col` natural sort directly. Applied to BOTH
 *      legs of a P+D pair so pickup + delivery items are consistently
 *      ordered. Companion v40 in dt-sync-statuses NOT needed — this is
 *      push-only; DT's display order is what changes.
 *
 * v39 2026-05-22 PST:
 * v39: <delivery_date> prefers dt_orders.dt_scheduled_date over
 *      local_service_date when the former is set. Pairs with the
 *      dt-sync-statuses v19 change that mirrors DT's scheduled date
 *      back into dt_scheduled_date every poll. The historical bug
 *      this fixes: after the dispatcher reschedules an order in DT
 *      (route move from Tuesday → Thursday), a re-push of the order
 *      from Stride for an unrelated edit (item add, contact change)
 *      would send <delivery_date>=local_service_date (still Tuesday,
 *      our originally-requested date) and DT would treat that as a
 *      reschedule, kicking the stop off its Thursday route. With
 *      v39, the re-push sends Thursday back — DT's value, idempotent
 *      — so the route assignment survives. dt_scheduled_date is
 *      preserved as the source of truth; local_service_date stays
 *      pinned to the originally-requested date for billing/audit.
 *      Initial pushes (no pushed_to_dt_at) still use local_service_date
 *      because DT hasn't scheduled anything yet — dt_scheduled_date is
 *      null on those rows by definition.
 *
 *      Companion v19 behaviour in dt-sync-statuses re-aligns
 *      local_service_date to dt_scheduled_date while the order is
 *      still in "open" category statuses so the two stay coherent for
 *      the UI; v39 here works whether or not that realign has run yet.
 *
 *      Pickup-completion re-push (fired by dt-sync-statuses after a
 *      PU leg finishes — Tier-B item propagation back into DT) now
 *      passes changedFields: ['items'] so the date group is omitted
 *      entirely. Belt-and-suspenders alongside v39's dt_scheduled_date
 *      preference: even on a legacy row where dt_scheduled_date hasn't
 *      yet been mirrored, the pickup-completion re-push won't touch
 *      DT's delivery date.
 *
 * v38.1: Pickup-stamp marker moved from leading prefix to trailing
 *      suffix per operator request. Item identity (vendor / description
 *      / sidemark) leads; "[✓ Picked up M/D DRIVER]" appears at the
 *      end. PU_MARKER_RE strips BOTH positions so v38-prefix-stamped
 *      items get cleaned on re-push.
 *
 * v38: Per-item pickup-stamp prefix on delivery-leg items. When a P+D
 *      pickup completes, stamp-pickup-on-linked-delivery sets
 *      dt_order_items.picked_up_at on each delivery item + writes
 *      dt_orders.linked_pickup_driver_name. v38 buildItemDesc then
 *      prefixes the per-item DT description with "[✓ Picked up M/D
 *      DRIVER] " so the DT dispatcher view + driver app both show
 *      pickup confirmation inline on the delivery items. Strips any
 *      pre-existing prefix from the input description so it can't
 *      accumulate when DT echoes it back through dt-sync-statuses.
 *      Pair with dt-sync-statuses change that fires the push-back
 *      when itemsStamped > 0 (not only when Tier-B propagation
 *      changed qty/notes) so the first sync after pickup actually
 *      gets the stamp into DT.
 *
 * v37: <description> emission now gated on `pushed_to_dt_at IS NULL`
 *      (initial push only). Pre-v37 the description was regenerated
 *      from Stride state on every re-push that included the `notes`
 *      group, which clobbered DT dispatcher edits to the order's
 *      "Order Details" block (COD-paid notes, payment receipts,
 *      special handling, etc.). v37 makes DT's description block
 *      dispatcher-owned after create. Stride still seeds it on the
 *      initial push so the dispatcher has full billing + delivery
 *      context, but never overwrites it again. Trade-off: billing
 *      changes in Stride after create do not propagate to the DT
 *      description — billing reconciliation happens via the invoice
 *      / Consolidated Billing flow, not via DT's description.
 *
 * v36: Emit order.po_number into <additional_field_1>. Pre-v36 the
 *      po_number was baked into dt_identifier at create-time only;
 *      later PO edits had nowhere to land on the DT side because no
 *      XML element carried the value. v36 puts it in custom field
 *      slot 1 so dispatchers can search/see it after initial create.
 *      Belongs to the `custom` field group alongside the existing
 *      additional_field_3 (Attachments) emission. The
 *      <additional_fields> block is now built from a per-slot list so
 *      we can grow into _2 / _4 / _5 later without touching the
 *      assembly logic. Empty values on a slot skip that slot
 *      individually; the whole block is omitted when no slot has a
 *      value. DT-side configuration: label additional_field_1 as
 *      "PO / Reference" in the DT account's custom-field settings.
 *
 * v35: Capture DT dispatch id from the add_order response and write it
 *      to dt_orders.dt_dispatch_id when present. DT's add_order response
 *      can include the newly-imported order's dispatch id alongside the
 *      <success> marker. parseDispatchId() tries the three shapes we've
 *      seen documented (a <dispatch_id> tag, a `dispatch_id` attribute
 *      on the wrapping <service_order>, or an `id` attribute on that
 *      same element) and returns the first numeric match, or null when
 *      the response carries no dispatch id (older DT installs still
 *      respond with the bare <success>Imported given orders!</success>).
 *      We deliberately do NOT match a generic <order_id> tag — DT uses
 *      that for the human Order_Number on some endpoints.
 *
 *      When present, dt_dispatch_id is stamped on both the primary and
 *      the linked-leg update so dt-sync-statuses' dispatch-id-keyed
 *      lookups (and the secondary backfill sweep added in v18 of that
 *      function) match without a round-trip through DT export.xml.
 *      A null dispatch id from DT is a no-op — never overwrites a
 *      previously-captured value.
 *
 * v34 2026-05-19 PST:
 * v34: Selective field push. Request body now accepts an optional
 *      `changedFields: string[]` naming which logical field GROUPS the
 *      caller actually edited. When present + non-empty, buildOrderXml
 *      emits ONLY those groups plus the always-required fields (order
 *      number, account, customer name + address) — so a re-push from an
 *      edit-save no longer blanks DT-side fields the operator never
 *      touched (the route/schedule-wipe footgun the React confirm
 *      dialog pairs with). Omitted when absent/empty → full payload,
 *      identical to every prior version (initial push, Review-Queue
 *      Approve&Push, and any legacy caller are unaffected).
 *
 *      Groups (see GROUP set below): items | date | contact | notes |
 *      custom. The same changedFields set is threaded to BOTH legs of a
 *      pickup_and_delivery pair (the diff is computed order-level on the
 *      React side). Attachments share-row build is skipped entirely when
 *      `custom` is out of scope — no pointless photo_shares writes and
 *      no <additional_fields> emitted on a partial push.
 *
 * v23 2026-05-14 PST:
 * v23: Unified attachment share — DT's "Attachments" custom field now
 *      carries ONE short URL per order covering BOTH photos AND docs
 *      (was: photo-share URL + comma-separated signed doc URLs, capped
 *      at 255 chars). Driver-app text renderers auto-linkify a single
 *      URL cleanly; comma-joined URLs were unreliable. Pair migration
 *      20260514120000_attachment_shares.sql adds doc_ids to
 *      photo_shares + anon read on documents/storage so the public
 *      viewer at /#/shared/attachments/<id> resolves the docs the same
 *      way it resolves photos.
 *
 *      Behaviour changes:
 *        • Share is created/refreshed only when at least one photo OR
 *          doc is attached. Both empty → no field emitted.
 *        • entity_context now snapshots {label, title, subtitle}
 *          (dt_identifier, contact name, service date) so the public
 *          page header reads cleanly without an entity-lookup round
 *          trip.
 *        • tenant_id may be NULL (migration loosened the NOT NULL).
 *          Public-form orders with no tenant still get a working
 *          share link.
 *        • The 255-char cap is now effectively a no-op (one short
 *          URL ≈ 60 chars) but kept as a safety net.
 *
 * v22 2026-05-13 PST:
 * v22: DT custom field #3 ("Attachments") now carries the public photo
 *      share URL + signed document URLs for any files attached to the
 *      order (entity_type='dt_order'). One photo share covers all photos
 *      attached to the order; documents get individual 90-day signed
 *      Storage URLs. Comma-joined, truncated to 255 chars (DT's per-field
 *      limit) with an "…" marker when overflowing. Best-effort: a failure
 *      to build the field never blocks the push — order goes through with
 *      empty Attachments. Currently zero dt_order entity rows in either
 *      item_photos or documents — this wires the pipeline for future use
 *      via the Photos & Docs tab on OrderPage.
 *
 * v21 2026-05-11 PST:
 * v21: Ad-hoc items get a short-UUID-prefix item_id (was empty since
 *      v18). DT's add_order importer treats <item_id> as the per-order
 *      primary key for items: multiple <item> elements sharing the same
 *      item_id collapse to one on receipt. v18 emitted empty <item_id/>
 *      for rows with no inventory_id AND no dt_item_code — which made
 *      every ad-hoc row look identical to DT, so an order with 8 unique
 *      ad-hoc lines (MRS-00047-D) imported as 1 item.
 *
 *      Fix: emit the first 8 hex chars of dt_order_items.id as the
 *      item_id for ad-hoc rows. The row UUID never changes so the
 *      identifier is stable across re-pushes, DT sees 8 distinct keys
 *      and keeps the items separate, and the driver app shows a short
 *      hex string (e.g. "12017456") in the SKU column instead of a
 *      full 36-char UUID. Compromise between v17 (full UUID on driver
 *      app, ugly but works) and v18 (clean empty, but DT collapses).
 *
 * v20 2026-05-11 PST
 * v20: Pushing from EITHER leg of a pickup_and_delivery pair now flushes
 *      BOTH legs to DT. Pre-v20, Section 4 only fired when the primary
 *      had order_type='pickup_and_delivery' (the delivery leg). If the
 *      operator clicked Push on the pickup leg's OrderPage, only the
 *      pickup leg was pushed and the linked delivery stayed stale in
 *      DT (and vice versa when items were edited on the other leg).
 *      Now Section 4 also fires when the primary has order_type='pickup'
 *      AND linked_order_id is set — pushes the linked delivery first,
 *      then the primary pickup. Identification of which fetched row
 *      is the pickup vs. delivery is done via isPDDeliveryPrimary /
 *      isPDPickupPrimary flags, so linkedDeliveryInfo (which drives
 *      the "PICK UP for Del <id>" item prefix + LINKED DELIVERY block
 *      in the description) is correctly threaded to whichever leg is
 *      the pickup. DT's add_order is upsert-by-identifier so re-pushing
 *      both legs is idempotent — no duplicates created.
 *
 * v19 2026-05-08 PST
 * v19: Pickup-leg item descriptions get a contextual prefix instead of
 *      the flat "PICK UP: " label so dispatch/staff can tell at a
 *      glance what each piece is for. Two cases:
 *        • P+D linked pickup → "PICK UP for Del <delivery DT id>: …"
 *          (the delivery identifier is already threaded into the
 *          buildOrderXml call site as `linkedDeliveryInfo`; we now
 *          pass it through to buildItemDesc too).
 *        • Standalone pickup → "PU for return to whse: …" since
 *          there's no linked delivery and the destination is the
 *          warehouse.
 *
 * v18 2026-05-03 PST:
 * v18: Two DT-side display bugs fixed.
 *      1. Ad-hoc / free-text items were rendering with the
 *         dt_order_items UUID PK as their SKU on the driver app
 *         (e.g. "12017456-c353-48b8-9c0c-417c0dd60fcf") because the
 *         buildOrderXml fallback was `it.dt_item_code || it.id`.
 *         New rule: rows where BOTH inventory_id and dt_item_code are
 *         null (the only signature for genuinely ad-hoc lines) emit
 *         empty <item_id/>; inventory-sourced rows still fall back
 *         to it.id so DT keeps a stable identifier on re-push.
 *      2. Pickup legs of pickup_and_delivery pairs were rendering
 *         "-" in DT for delivery_date / time window because the
 *         linked pickup row's local_service_date was sometimes left
 *         null by the create path. The push function now copies
 *         local_service_date / window_start_local / window_end_local
 *         from the delivery leg → pickup leg when the pickup is
 *         missing them. Belt-and-suspenders so DT always shows a
 *         date on both halves of a P+D pair.
 *      Both SELECTs against dt_order_items grew an `inventory_id`
 *      column to support fix #1.
 *
 * v17 2026-04-27 PST:
 * v17: Items now include a <location> tag pulled from extras.location
 *      (warehouse bin/shelf the inventory item is stored at). Lets
 *      drivers/dispatchers see where the piece came from on the DT
 *      side without having to cross-reference Stride.
 *
 * v16 2026-04-26 PST:
 * v16: Restored the STRIDE LOGISTICS account fallback for unmapped
 *      tenant_ids. The v15 rewrite accidentally dropped the
 *      session-80 fix and reverted resolveAccountName() to the
 *      strict pre-session-80 behaviour, which surfaced as 400 errors
 *      ("No DT account mapped for tenant_id …") on every order
 *      submitted by a client that hadn't been added to
 *      account_name_map yet. Pushes now land on the house account
 *      (STRIDE LOGISTICS) and ops can reassign in DT's UI; the early
 *      `if (!accountName)` 400 path is now unreachable but kept as
 *      defense-in-depth.
 * v15: Driver-facing <notes> block now falls back to dt_orders.details
 *      when order_notes is empty. Previously the modal's "Notes /
 *      Special Instructions" field wrote only to details, which
 *      surfaced in DT's dispatcher description but never reached
 *      the driver app's notes pane. With this fallback the same
 *      text appears in both views.
 * v14: Coverage now itemized in the <description> billing summary so the
 *      DT dispatcher sees what valuation the customer paid for. Reads
 *      coverage_option_id, coverage_charge, declared_value from
 *      dt_orders + joins coverage_options.name. Always shown when an
 *      option is selected (free Standard renders as "Included").
 * v13: Fee label in description now reads from order_type (not the legacy
 *      is_pickup boolean) so pickup-leg fees label correctly when the row
 *      was created via the new order_type pipeline. CDATA escaping is
 *      centralized in cdataEscape() instead of being repeated inline.
 *      Top-level error path no longer leaks stack traces to the response
 *      body — stack is logged only.
 * v12: Added <service_time> XML tag + paid status in description
 *
 * Pushes an approved order (and its linked pickup, if any) from dt_orders
 * to DispatchTrack via `POST /orders/api/add_order`. Called by the Review
 * Queue when staff clicks "Approve & Push".
 *
 * Request:   POST { orderId: uuid }
 * Response:  { ok: boolean, dt_identifier?: string, linked_identifier?: string, error?: string }
 *
 * Phase 2c changes:
 *   • Reads `order_type` column (delivery/pickup/pickup_and_delivery/service_only).
 *   • For pickup_and_delivery: pushes BOTH the delivery and the linked pickup
 *     to DT as two separate orders, with a cross-reference note in each.
 *   • Service-only orders push with zero items (a <description>-only order).
 *
 * DT API details (confirmed by Ashok, 2026-04-17):
 *   • POST /orders/api/add_order, XML, rate limit 1000/hr per key.
 *   • Response: <success>Imported given orders!</success> on success.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface DtOrderRow {
  id: string;
  tenant_id: string | null;
  dt_identifier: string;
  is_pickup: boolean | null;
  order_type: string | null;
  linked_order_id: string | null;
  contact_name: string | null;
  contact_address: string | null;
  contact_city: string | null;
  contact_state: string | null;
  contact_zip: string | null;
  contact_phone: string | null;
  contact_phone2: string | null;
  contact_email: string | null;
  local_service_date: string | null;
  /** v39 — DT-side scheduled date pulled by dt-sync-statuses from
   *  export.xml. When non-null, buildOrderXml uses this value for
   *  <delivery_date> in preference to local_service_date so re-pushes
   *  don't kick the stop off its DT-assigned route. Null until the
   *  first sync after initial push. */
  dt_scheduled_date: string | null;
  window_start_local: string | null;
  window_end_local: string | null;
  po_number: string | null;
  sidemark: string | null;
  client_reference: string | null;
  details: string | null;
  order_notes: string | null;
  driver_notes: string | null;
  internal_notes: string | null;
  /** v42 — per-leg notes split. Pushed as the Public DT note when
   *  this row is the pickup leg of a P+D pair (or a standalone pickup).
   *  Falls back to driver_notes / order_notes / details on push if
   *  NULL so pre-v42 rows keep producing identical DT payloads. */
  pickup_notes: string | null;
  /** v42 — per-leg notes split for the delivery side. Pushed as the
   *  Public DT note when this row is the delivery leg of a P+D pair
   *  (or a standalone delivery). Same back-compat fallback chain. */
  delivery_notes: string | null;
  service_time_minutes: number | null;
  review_status: string | null;
  pushed_to_dt_at: string | null;
  billing_method: string | null;
  order_total: number | null;
  base_delivery_fee: number | null;
  extra_items_count: number | null;
  extra_items_fee: number | null;
  accessorials_json: { code: string; quantity: number; rate: number; subtotal: number }[] | null;
  accessorials_total: number | null;
  // Valuation coverage — itemized in the description so the dispatcher
  // sees what the customer paid for. coverage_name comes from a join
  // server-side OR is left undefined here (description falls back to
  // "Coverage" label).
  coverage_option_id: string | null;
  coverage_charge: number | null;
  declared_value: number | null;
  coverage_name?: string;
  billing_review_status: string | null;
  paid_at: string | null;
  paid_amount: number | null;
  paid_method: string | null;
  /** v38 — driver name from the linked PU leg, stamped on the delivery
   *  by stamp-pickup-on-linked-delivery once the pickup completes.
   *  buildItemDesc passes this into the per-item "[✓ Picked up M/D
   *  DRIVER] " prefix on delivery-leg items. Null until PU completes
   *  or on standalone (non-P+D) orders. */
  linked_pickup_driver_name: string | null;
}

interface DtOrderItemRow {
  id: string;
  /** FK to public.inventory.id when the line came from an inventory pick;
   *  null for ad-hoc / free-text items typed straight into the modal. */
  inventory_id: string | null;
  dt_item_code: string | null;
  description: string | null;
  quantity: number | null;
  vendor: string | null;
  class_name: string | null;
  cubic_feet: number | null;
  room: string | null;
  extras: Record<string, unknown> | null;
  /** v38 — set by stamp-pickup-on-linked-delivery on a delivery-leg item
   *  when its linked PU item completed. buildItemDesc prefixes the DT
   *  item description with "[✓ Picked up M/D DRIVER] " so the DT driver
   *  app + dispatcher view shows pickup confirmation inline on each
   *  delivery item. Null on pickup-leg items + on delivery items
   *  whose linked PU hasn't finished yet. */
  picked_up_at: string | null;
}

// Logical field groups the caller can scope a re-push to. Required
// fields (order number, account, customer name + address) are ALWAYS
// emitted regardless — DT's add_order upsert rejects an order without
// them. Anything not in the active set is omitted from the XML so DT
// keeps its current value (route assignments, dispatcher-edited
// schedule/notes, etc. survive the re-push).
type DtFieldGroup = 'items' | 'date' | 'contact' | 'notes' | 'custom';
const DT_FIELD_GROUPS: ReadonlySet<DtFieldGroup> = new Set<DtFieldGroup>([
  'items', 'date', 'contact', 'notes', 'custom',
]);

// Normalize the request's `changedFields` into a Set, or null for a
// full push. null is the legacy/initial-push contract: every block
// emitted (behaviour identical to pre-v34). An empty or all-invalid
// array also falls back to null — a caller that means "push nothing"
// simply shouldn't invoke this function.
function parseChangedFields(raw: unknown): Set<DtFieldGroup> | null {
  if (!Array.isArray(raw)) return null;
  const set = new Set<DtFieldGroup>();
  for (const v of raw) {
    if (typeof v === 'string' && DT_FIELD_GROUPS.has(v as DtFieldGroup)) {
      set.add(v as DtFieldGroup);
    }
  }
  return set.size > 0 ? set : null;
}

// include(group) — true when the group should be emitted: either a
// full push (groups === null) or the group is in the scoped set.
function makeIncluder(groups: Set<DtFieldGroup> | null) {
  return (g: DtFieldGroup) => groups === null || groups.has(g);
}

function xmlEscape(val: unknown): string {
  if (val == null) return '';
  const s = String(val);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Escape any "]]>" sequences inside text that will sit between <![CDATA[ ... ]]>.
// "]]>" is the only sequence that prematurely terminates a CDATA section, so we
// split it across two CDATA sections to keep the payload literal-safe.
function cdataEscape(val: string): string {
  return val.replace(/]]>/g, ']]]]><![CDATA[>');
}

// Build a rich item description: "Vendor | Description | SM: Sidemark | Ref: Reference - Room"
// Room is read from the item row's `room` column with `extras.room` as
// a fallback (older rows persisted there before the column existed).
// Appended at the tail with a hyphen separator so the operator can
// scan the room without parsing pipes — matches the manual format
// "Vendor description - Room" the dispatcher uses on paper sheets.
//
// Pickup legs get a contextual prefix so dispatch/staff can tell at a
// glance what each piece is for (Justin: "this will help the staff
// better understand what the pu items belong to"):
//   • Linked to a delivery (P+D pair): "PICK UP for Del <DT identifier>: …"
//   • Standalone pickup back to the warehouse: "PU for return to whse: …"
/**
 * Sentinel-matching regex for the v38/v38.1 pickup marker. Strips
 * "[✓ Picked up <M/D> <DRIVER>]" from a stored description so a
 * re-push that runs after DT has echoed the marker back to us doesn't
 * accumulate it. Tolerant of any wording inside the brackets (varied
 * date formats, driver names with spaces).
 *
 * Matches BOTH the historical leading-prefix shape (v38, deployed
 * 2026-05-21) and the new trailing-suffix shape (v38.1, this commit).
 * Stripping both ensures an item that was pushed with the v38 prefix
 * and is re-pushed today gets the prefix cleaned off the front before
 * the new suffix is appended at the end.
 *
 * The leading variant has trailing whitespace; the trailing variant has
 * leading whitespace. The `g` flag + two anchored alternatives handle
 * either position.
 */
const PU_MARKER_RE = /(?:^\[✓ Picked up [^\]]+\]\s+|\s+\[✓ Picked up [^\]]+\]$)/g;

function buildItemDesc(
  it: DtOrderItemRow,
  isPickupLeg: boolean,
  sidemark?: string,
  reference?: string,
  linkedDeliveryIdentifier?: string,
  pickupDriverName?: string | null,
): string {
  // Strip any pre-existing pickup marker (either historical v38 leading
  // prefix or v38.1 trailing suffix) from the stored description before
  // reassembly. dt-sync-statuses pulls DT's exported items back into
  // dt_order_items.description, so without this strip the marker would
  // compound every cycle ("[✓ ...] [✓ ...] VENDOR | DESC").
  const cleanDescription = String(it.description ?? '').replace(PU_MARKER_RE, '').trim();
  const parts: string[] = [];
  if (it.vendor) parts.push(it.vendor);
  if (cleanDescription) parts.push(cleanDescription);
  if (sidemark) parts.push(`SM: ${sidemark}`);
  if (reference) parts.push(`Ref: ${reference}`);
  const base = parts.join(' | ') || cleanDescription;
  const extrasRoom = (it.extras && typeof it.extras === 'object' ? (it.extras as Record<string, unknown>).room : null);
  const room = (it.room || extrasRoom || '').toString().trim();
  const withRoom = room ? `${base} - ${room}` : base;
  if (isPickupLeg) {
    const prefix = linkedDeliveryIdentifier
      ? `PICK UP for Del ${linkedDeliveryIdentifier}: `
      : 'PU for return to whse: ';
    return `${prefix}${withRoom}`;
  }
  // v38 — delivery-leg pickup-stamp marker. When the linked PU leg has
  // completed and this item's PU twin was picked up, append a visible
  // confirmation so the DT dispatcher view + driver app both show
  // "DOLPHIN CHAIR - LIVING ROOM [✓ Picked up M/D DRIVER]" inline.
  // The data already lives on Stride's side (dt_order_items.picked_up_at
  // + dt_orders.linked_pickup_driver_name); v38 just propagates it into
  // DT's per-item description on the next push-back from dt-sync-statuses.
  //
  // v38.1 (2026-05-21) — moved from leading prefix to trailing suffix
  // per operator request. The item identity (vendor / description /
  // sidemark) is what dispatchers scan for first; the pickup-confirmation
  // is metadata that reads more naturally at the end. PU_MARKER_RE
  // matches BOTH positions so v38-prefix-stamped items still get
  // cleaned up properly on the next re-push.
  if (it.picked_up_at) {
    const d = new Date(it.picked_up_at);
    if (!Number.isNaN(d.getTime())) {
      const mdy = `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
      const drv = (pickupDriverName || '').trim();
      const tag = drv ? ` [✓ Picked up ${mdy} ${drv}]` : ` [✓ Picked up ${mdy}]`;
      return `${withRoom}${tag}`;
    }
  }
  return withRoom;
}

// Build the DT order description with billing info
function buildOrderDescription(
  order: DtOrderRow,
  accountName: string,
  crossRefIdent?: string,
  linkedDeliveryInfo?: { identifier: string; contactName?: string; address?: string; city?: string; state?: string; zip?: string },
): string {
  const orderType = order.order_type || (order.is_pickup ? 'pickup' : 'delivery');
  const descParts: string[] = [];

  // For pickup legs of a pickup_and_delivery pair: show linked delivery info
  if (orderType === 'pickup' && linkedDeliveryInfo) {
    descParts.push(`LINKED DELIVERY: ${linkedDeliveryInfo.identifier}`);
    const addrParts = [linkedDeliveryInfo.contactName, linkedDeliveryInfo.address,
      [linkedDeliveryInfo.city, linkedDeliveryInfo.state, linkedDeliveryInfo.zip].filter(Boolean).join(' ')
    ].filter(Boolean).join(', ');
    if (addrParts) descParts.push(`Deliver to: ${addrParts}`);
    descParts.push('');
    descParts.push(`Bill To: ${accountName}`);
    descParts.push('Charges Summary:');
    descParts.push('(no charges — billed on delivery leg)');
  } else {
    // Cross-reference for linked orders
    if (crossRefIdent) {
      descParts.push(`[LINKED ORDER: ${crossRefIdent}]`);
    }
    if (orderType === 'service_only') {
      descParts.push('[SERVICE-ONLY VISIT — NO ITEMS]');
    }

    // Billing info
    const billTo = order.billing_method === 'customer_collect'
      ? 'Collect from Customer'
      : `${accountName}`;
    descParts.push(`Bill To: ${billTo}`);
    descParts.push('Charges Summary:');

    // Itemized charges
    if (order.base_delivery_fee != null && order.base_delivery_fee > 0) {
      // Drive the label from order_type so rows created via the new pipeline
      // (which leaves is_pickup unset) still label pickup fees correctly.
      const feeLabel = orderType === 'pickup' ? 'Pickup' : 'Delivery';
      descParts.push(`${feeLabel} = $${Number(order.base_delivery_fee).toFixed(2)}`);
    }
    if (order.extra_items_fee != null && order.extra_items_fee > 0) {
      descParts.push(`Extra Items (${order.extra_items_count || 0}) = $${Number(order.extra_items_fee).toFixed(2)}`);
    }
    if (order.accessorials_json && Array.isArray(order.accessorials_json)) {
      for (const acc of order.accessorials_json) {
        descParts.push(`${acc.code}${acc.quantity > 1 ? ` x${acc.quantity}` : ''} = $${Number(acc.subtotal).toFixed(2)}`);
      }
    }
    // Valuation coverage — itemize alongside the other charges so the DT
    // dispatcher sees what the customer is paying for. Always shown when
    // the order has a coverage selection on file (even free Standard at
    // $0 — explicit confirmation that valuation is accounted for).
    if (order.coverage_option_id || order.coverage_charge != null) {
      const cvName = (order as DtOrderRow & { coverage_name?: string }).coverage_name || 'Coverage';
      const cvCharge = order.coverage_charge != null ? Number(order.coverage_charge) : 0;
      const dv = (order as DtOrderRow & { declared_value?: number | null }).declared_value;
      const dvSuffix = dv != null && Number(dv) > 0 ? ` (declared $${Number(dv).toLocaleString()})` : '';
      descParts.push(`Coverage: ${cvName}${dvSuffix} = ${cvCharge > 0 ? `$${cvCharge.toFixed(2)}` : 'Included'}`);
    }
    if (order.order_total != null) {
      descParts.push(`Total = $${Number(order.order_total).toFixed(2)}`);
    }
  }

  // Append paid status if collected during order entry
  if (order.paid_at && order.paid_amount != null) {
    const paidDate = new Date(order.paid_at);
    const mm = String(paidDate.getMonth() + 1).padStart(2, '0');
    const dd = String(paidDate.getDate()).padStart(2, '0');
    const yyyy = paidDate.getFullYear();
    const method = order.paid_method || 'Stax';
    descParts.push(`[PAID via ${method} — $${Number(order.paid_amount).toFixed(2)} collected ${mm}/${dd}/${yyyy}]`);
  }

  // Append any user-entered details
  if (order.details) {
    descParts.push('');
    descParts.push(order.details);
  }

  return cdataEscape(descParts.join('\n'));
}

// Build the DT "Attachments" custom field value (<additional_field_3>).
// Returns a single public URL that resolves to a unified gallery page
// showing every photo + every doc attached to the order, or '' when the
// order has no attachments at all.
//
// One URL — no comma parsing in DT's text renderer, no per-doc click-
// ability concern, no 255-char cap pressure. Photos and docs are both
// curated into a single photo_shares row (the table grew a doc_ids
// column in migration 20260514120000_attachment_shares.sql) and read
// back through anon RLS at /#/shared/attachments/<share_id>.
//
// Idempotency: a re-push reuses the order's existing active share. If
// the set of photo_ids OR doc_ids changed since last push (an op edit
// added or removed an attachment), the existing row is updated in
// place so the gallery always reflects current state. Stale lists
// would silently hide new files from the driver because the anon read
// RLS gates on `id = ANY(share.<col>)`.
//
// Best-effort: any error returns '' so the order push always proceeds
// — Attachments is a nice-to-have, never a blocker.
async function buildAttachmentsField(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  order: DtOrderRow,
): Promise<string> {
  const FIELD_MAX = 255;
  const APP_ORIGIN = 'https://www.mystridehub.com';

  try {
    // ── Collect photo and doc ids in one parallel fetch ────────────────
    const [photosRes, docsRes] = await Promise.all([
      supabase
        .from('item_photos')
        .select('id')
        .eq('entity_type', 'dt_order')
        .eq('entity_id', order.id)
        .order('created_at', { ascending: true }),
      supabase
        .from('documents')
        .select('id')
        .eq('context_type', 'dt_order')
        .eq('context_id', order.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: true }),
    ]);

    const photoIds: string[] = Array.isArray(photosRes?.data)
      ? (photosRes.data as Array<{ id: string }>).map((p) => p.id)
      : [];
    const docIds: string[] = Array.isArray(docsRes?.data)
      ? (docsRes.data as Array<{ id: string }>).map((d) => d.id)
      : [];

    // Both empty → no attachments. Also revoke any pre-existing active
    // share so a previously-published URL stops resolving to stale
    // content if the op deleted every attachment and re-pushed.
    if (photoIds.length === 0 && docIds.length === 0) {
      await supabase
        .from('photo_shares')
        .update({ active: false })
        .eq('entity_type', 'dt_order')
        .eq('entity_id', order.id)
        .eq('active', true);
      return '';
    }

    // ── Reuse-or-create the unified share row ──────────────────────────
    // entity_context is snapshotted at write time so the public viewer
    // never reads dt_orders directly. Keep it minimal: identifier as
    // the heading + contact name and service date as subhead lines.
    const entityContext = {
      label: order.dt_identifier || 'Order',
      title: order.contact_name || undefined,
      subtitle: order.local_service_date || undefined,
    };

    const { data: existingShare } = await supabase
      .from('photo_shares')
      .select('share_id, photo_ids, doc_ids')
      .eq('entity_type', 'dt_order')
      .eq('entity_id', order.id)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let shareId: string | undefined = existingShare?.share_id;

    if (shareId && existingShare) {
      // Idempotency refresh: bring photo_ids + doc_ids into sync with
      // the current attachment set on each push so an op who added or
      // removed a file after the first push still gets a fresh gallery.
      // Also keeps entity_context current in case the order's contact /
      // service date changed.
      const existingPhotoIds = Array.isArray(existingShare.photo_ids) ? existingShare.photo_ids : [];
      const existingDocIds   = Array.isArray(existingShare.doc_ids)   ? existingShare.doc_ids   : [];
      const samePhotos = existingPhotoIds.length === photoIds.length
        && photoIds.every((id: string) => existingPhotoIds.includes(id));
      const sameDocs   = existingDocIds.length === docIds.length
        && docIds.every((id: string) => existingDocIds.includes(id));
      if (!samePhotos || !sameDocs) {
        await supabase
          .from('photo_shares')
          .update({ photo_ids: photoIds, doc_ids: docIds, entity_context: entityContext })
          .eq('share_id', shareId);
      }
    } else {
      const newShareId = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      const { data: created, error: shareErr } = await supabase
        .from('photo_shares')
        .insert({
          share_id:        newShareId,
          entity_type:     'dt_order',
          entity_id:       order.id,
          tenant_id:       order.tenant_id, // nullable since 20260514120000
          photo_ids:       photoIds,
          doc_ids:         docIds,
          entity_context:  entityContext,
          title:           `Order ${order.dt_identifier} attachments`,
          active:          true,
          created_by_name: 'dt-push-order',
        })
        .select('share_id')
        .single();
      if (!shareErr && created?.share_id) shareId = created.share_id;
    }

    if (!shareId) return '';

    // Single URL — well under FIELD_MAX (~62 chars). The cap stays as
    // belt-and-suspenders in case APP_ORIGIN ever grows or DT lowers
    // the field length on their end.
    const url = `${APP_ORIGIN}/#/shared/attachments/${shareId}`;
    return url.length > FIELD_MAX ? url.slice(0, FIELD_MAX) : url;
  } catch (err) {
    console.warn('[dt-push-order] attachments build failed (non-fatal):', (err as Error).message);
    return '';
  }
}

function buildOrderXml(
  order: DtOrderRow,
  items: DtOrderItemRow[],
  accountName: string,
  crossRefIdent?: string,
  linkedDeliveryInfo?: { identifier: string; contactName?: string; address?: string; city?: string; state?: string; zip?: string },
  attachmentsField?: string,
  groups: Set<DtFieldGroup> | null = null,
  // v42 — pickup-completion-notes warning prefix prepended onto the
  // delivery-leg Public note. Caller (pushSingleOrder) fetches
  // dt_pickup_links and concatenates pickup_completion_notes from all
  // linked pickups; we just splice the resulting string in here. Empty
  // string (or undefined) → no prefix, behaviour identical to pre-v42.
  completionWarningPrefix: string = '',
): string {
  const include = makeIncluder(groups);
  const nameParts = (order.contact_name || '').trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';
  const winStart = order.window_start_local ? order.window_start_local.slice(0, 5) : '';
  const winEnd = order.window_end_local ? order.window_end_local.slice(0, 5) : '';
  const orderType = order.order_type || (order.is_pickup ? 'pickup' : 'delivery');
  const serviceType = orderType === 'pickup' ? 'Pickup'
    : orderType === 'pickup_and_delivery' ? 'Delivery'
    : orderType === 'service_only' ? 'Service'
    : 'Delivery';

  const isPickupLeg = orderType === 'pickup';

  const itemsXml = items.map((it) => {
    const qty = Math.abs(Number(it.quantity) || 1);
    // Linked-delivery identifier on pickup legs makes the per-item
    // prefix render "PICK UP for Del <id>: …" instead of the generic
    // "PU for return to whse: " fallback used for standalone pickups.
    const desc = buildItemDesc(
      it,
      isPickupLeg,
      order.sidemark || undefined,
      order.client_reference || undefined,
      isPickupLeg ? linkedDeliveryInfo?.identifier : undefined,
      // v38 — pass the linked pickup driver name from the order row so
      // buildItemDesc can render "[✓ Picked up M/D DRIVER] " on
      // delivery-leg items whose linked PU has completed. Null/undefined
      // on pickup-leg items + on delivery items where the PU hasn't
      // finished yet (picked_up_at IS NULL on the item gates the
      // emission anyway).
      isPickupLeg ? null : order.linked_pickup_driver_name,
    );
    const cubeVal = it.cubic_feet != null ? `\n      <cube>${it.cubic_feet}</cube>` : '';
    // Warehouse location for the piece — drives where dispatch/
    // drivers find it before loading. Stored on extras.location by
    // the React modal when an inventory item is added to the order;
    // we omit the tag entirely when no location is on file rather
    // than emit an empty <location/> that DT might reject.
    const extras = (it.extras || {}) as Record<string, unknown>;
    const locationRaw = (extras.location ?? '') as string;
    const locationVal = locationRaw ? `\n      <location>${xmlEscape(locationRaw)}</location>` : '';
    // SKU resolution (v21 2026-05-11):
    //   • Use dt_item_code when set (inventory pick AND ad-hoc rows can both
    //     carry one once the inventory-link sync has run).
    //   • Inventory-sourced rows that haven't been backfilled fall back to
    //     it.id so DT still sees something stable across re-pushes.
    //   • Ad-hoc rows (no inventory_id AND no dt_item_code) get the FIRST
    //     8 hex chars of it.id. v18 emitted EMPTY here because v17's full
    //     UUID rendered as an ugly 36-char SKU on the driver app — but DT
    //     uses item_id as the per-order primary key for items, and empty
    //     == empty == collapsed-to-one-item on DT's importer. That was
    //     hidden by single-ad-hoc orders for weeks, then surfaced as
    //     MRS-00047-D-shows-1-item-of-9 on 2026-05-11. 8 hex chars is
    //     unique-enough within an order (~4.3B values; collision odds
    //     N²/2^33 — vanishing for any realistic order), stable across
    //     re-pushes since dt_order_items.id never changes, and short
    //     enough that the driver app's SKU column doesn't look insane.
    const isAdHoc = !it.inventory_id && !it.dt_item_code;
    const sku = isAdHoc
      ? it.id.replace(/-/g, '').slice(0, 8)
      : (it.dt_item_code || it.id);
    return `    <item>\n      <item_id>${xmlEscape(sku)}</item_id>\n      <description>${xmlEscape(desc)}</description>\n      <quantity>${qty}</quantity>${cubeVal}${locationVal}\n    </item>`;
  }).join('\n');

  // <description> carries the dispatcher-facing billing/coverage summary
  // + the operator's free-text details. It belongs to the `notes` group:
  // skip building it on a scoped push that didn't touch notes so DT
  // keeps whatever the dispatcher may have annotated on their side.
  const desc = include('notes')
    ? buildOrderDescription(order, accountName, crossRefIdent, linkedDeliveryInfo)
    : '';

  // Build notes XML. Per-leg split (v42):
  //   • pickup_notes   → Public <note> for the pickup leg only.
  //   • delivery_notes → Public <note> for the delivery leg (or
  //                      standalone delivery). Prefixed with the
  //                      pickup-completion warning when one is set.
  //   • driver_notes   → legacy back-compat fallback for rows
  //                      created pre-v42. order_notes / details
  //                      fall back further.
  //   • internal_notes → staff-only. Pushed as a Private <note> so
  //                      DT-side staff can see the context but it does
  //                      NOT render on the driver-app side. Same on
  //                      both legs (audit-only, not a routing decision).
  //
  // The chain stays "use per-leg → fall back to legacy" rather than
  // "use legacy → overlay per-leg" so once the per-leg column is set
  // (even to empty string after an operator save) it wins authoritatively.
  // Empty-string is normalized to null upstream (OrderPage save handler
  // trims and converts) so a deliberate "clear notes" lands as null and
  // the chain falls to the next non-null. Good enough back-compat shim
  // until Phase 2 drops the legacy column.
  const perLegNotes = isPickupLeg
    ? (order.pickup_notes ?? null)
    : (order.delivery_notes ?? null);
  const legNotesBody = perLegNotes ?? order.driver_notes ?? order.order_notes ?? order.details ?? '';
  // Prepend the completion-warning prefix only for the delivery leg
  // (it's the delivery crew that needs the warning). Pickup leg always
  // gets clean per-leg notes.
  const warningPrefix = !isPickupLeg && completionWarningPrefix
    ? completionWarningPrefix + '\n\n'
    : '';
  const driverFacingNotes = include('notes') ? (warningPrefix + legNotesBody) : '';
  const internalFacingNotes = include('notes') ? (order.internal_notes || '') : '';
  const noteEntries: string[] = [];
  if (driverFacingNotes) {
    noteEntries.push(`      <note created_at="${new Date().toISOString()}" author="StrideApp" note_type="Public">\n        <![CDATA[${cdataEscape(driverFacingNotes)}]]>\n      </note>`);
  }
  if (internalFacingNotes) {
    noteEntries.push(`      <note created_at="${new Date().toISOString()}" author="StrideApp" note_type="Private">\n        <![CDATA[${cdataEscape(internalFacingNotes)}]]>\n      </note>`);
  }
  const notesXml = noteEntries.length > 0
    ? `\n    <notes count="${noteEntries.length}">\n${noteEntries.join('\n')}\n    </notes>`
    : '';

  // DT additional fields (custom group). Two slots emitted today:
  //   • additional_field_1 = "PO / Reference" — order.po_number. Visible
  //     on the DT order page so dispatchers can search by customer PO
  //     after the initial create. Was previously baked into the
  //     dt_identifier (order number) at create time only; later edits
  //     to po_number had no effect on DT until this v36 change.
  //   • additional_field_3 = "Attachments" — the public share URL.
  //
  // Both belong to the `custom` field group: a partial push that
  // didn't touch custom fields skips the entire <additional_fields>
  // block so DT keeps whatever the dispatcher may have annotated.
  // Empty values on individual fields are skipped (some DT accounts
  // reject empty <additional_field_N/>); the block is omitted entirely
  // when no field has a value.
  const customFieldEntries: string[] = [];
  if (include('custom')) {
    const poVal = (order.po_number || '').trim();
    if (poVal) {
      customFieldEntries.push(`      <additional_field_1>${xmlEscape(poVal)}</additional_field_1>`);
    }
    if (attachmentsField) {
      customFieldEntries.push(`      <additional_field_3>${xmlEscape(attachmentsField)}</additional_field_3>`);
    }
  }
  const attachmentsXml = customFieldEntries.length > 0
    ? `\n    <additional_fields>\n${customFieldEntries.join('\n')}\n    </additional_fields>`
    : '';

  // ── Conditional block assembly ────────────────────────────────────────
  // Always emitted (DT add_order upsert rejects an order without them):
  //   <number> <account> <service_type> <customer name + full address>
  //   <amount>
  // The street address (address1/city/state/zip) is part of the required
  // identity DT geocodes/routes on; re-sending the unchanged value is a
  // no-op for routing, whereas OMITTING it risks DT blanking the stop.
  // phone/email are the editable `contact` extras → scoped to that group.
  //
  // <delivery_date> + time window → `date` group. Omitting them on a
  // scoped push is the whole point: DT keeps the dispatcher's schedule.
  // <items> → `items` group. <description>/<notes> → `notes` group.
  // <service_time>/<additional_fields> → `custom` group.
  const contactExtrasXml = include('contact')
    ? `\n      <phone1>${xmlEscape(order.contact_phone || '')}</phone1>\n      <phone2>${xmlEscape(order.contact_phone2 || '')}</phone2>\n      <email>${xmlEscape(order.contact_email || '')}</email>`
    : '';

  // v39 — prefer dt_scheduled_date (mirrored from DT's export.xml by
  // dt-sync-statuses v19) over local_service_date when set. This keeps
  // re-pushes idempotent against the dispatcher's route assignment: if
  // DT moved the stop from Tuesday → Thursday, dt_scheduled_date holds
  // Thursday, local_service_date still holds Tuesday (the originally-
  // requested date kept for billing/audit), and the re-push echoes
  // Thursday back to DT so the route survives. Falls back to
  // local_service_date when dt_scheduled_date is null (initial push,
  // or any row that hasn't been synced yet).
  const deliveryDateForDt = order.dt_scheduled_date ?? order.local_service_date ?? '';
  const dateXml = include('date')
    ? `\n    <delivery_date>${xmlEscape(deliveryDateForDt)}</delivery_date>\n    <request_time_window_start>${xmlEscape(winStart)}</request_time_window_start>\n    <request_time_window_end>${xmlEscape(winEnd)}</request_time_window_end>`
    : '';

  // <description> = the dispatcher-facing "Order Details" block on the
  // DT order page. Stride's buildOrderDescription() synthesizes this
  // from billing summary + order.details on every call, so historically
  // every re-push that included the `notes` group would REGENERATE the
  // description from current Stride state and overwrite any edits the
  // DT dispatcher had made to it (e.g. "PAID CASH ON DELIVERY $200",
  // "Customer not home, called and rescheduled", etc.). v37 (2026-05-21)
  // makes the description Stride-authored on the INITIAL push only;
  // after the order has been pushed once (pushed_to_dt_at IS NOT NULL),
  // the dispatcher owns the description and Stride no longer touches it.
  // The pre-v37 footgun is documented in the file header.
  //
  // Trade-off: billing-summary changes in Stride after create won't
  // propagate to DT's description. If the operator needs to push a new
  // billing summary into DT later, a future "Re-push order details"
  // button can be added that explicitly opts in (would override the
  // initial-push gate). Today, billing reconciliation happens via the
  // invoice / Consolidated Billing flow, not via DT's description.
  const isInitialPush = !order.pushed_to_dt_at;
  const descriptionXml = include('notes') && isInitialPush
    ? `\n    <description><![CDATA[${desc}]]></description>`
    : '';

  const serviceTimeXml = include('custom') && order.service_time_minutes != null && order.service_time_minutes > 0
    ? `\n    <service_time>${order.service_time_minutes}</service_time>`
    : '';

  // service_only orders legitimately have zero items, so on a FULL push
  // we still emit an empty <items> block (unchanged legacy behaviour).
  // On a scoped push the block is emitted only when `items` is in scope.
  const itemsBlockXml = include('items')
    ? `\n    <items>\n${itemsXml}\n    </items>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8"?>
<service_orders>
  <service_order>
    <number>${xmlEscape(order.dt_identifier)}</number>
    <account>${xmlEscape(accountName)}</account>
    <service_type>${xmlEscape(serviceType)}</service_type>
    <customer>
      <first_name>${xmlEscape(firstName)}</first_name>
      <last_name>${xmlEscape(lastName)}</last_name>
      <address1>${xmlEscape(order.contact_address || '')}</address1>
      <city>${xmlEscape(order.contact_city || '')}</city>
      <state>${xmlEscape(order.contact_state || '')}</state>
      <zip>${xmlEscape(order.contact_zip || '')}</zip>${contactExtrasXml}
    </customer>${dateXml}${descriptionXml}
    <amount>${order.order_total != null ? Number(order.order_total).toFixed(2) : '0.00'}</amount>${serviceTimeXml}${itemsBlockXml}${notesXml}${attachmentsXml}
  </service_order>
</service_orders>`;
}

// Resolve DT account name from tenant_id (direct lookup in
// account_name_map: {sheetId → accountName}).
//
// Returns { name, wasFallback }:
//   • name        — the account name to emit in <account>
//   • wasFallback — true when STRIDE LOGISTICS was substituted because
//                   either (a) the tenant isn't mapped at all, OR
//                   (b) v41 — the tenant IS mapped but not yet listed
//                   in `verified_account_tenants`. Stamped onto the
//                   dt_orders row so the OrderPage banner can warn
//                   the operator: "we pushed under STRIDE LOGISTICS
//                   because the DT account hasn't been verified."
//
// Why (b) exists: NIP-00127 (2026-05-26) was the first push to a
// tenant whose mapped account name was correct on our side
// ("NIP TUCK REMODELING") but misspelled on DT's side
// ("NIP TUCK REMODLING" — missing the second E). DT silently dropped
// the unrecognized account and the order landed orphaned. The
// original v16 fallback only covered "tenant unmapped" — it had no
// way to detect "tenant mapped but name doesn't match DT". v41 adds
// the verification list as a Stride-side allowlist: tenants only
// get pushed under their real DT account once the operator has
// confirmed (via SQL — UI later) that the name matches DT exactly.
// Existing tenants with ≥2 prior successful pushes were auto-verified
// by the migration backfill so nothing regresses.
function resolveAccountName(
  tenantId: string | null,
  acctMap: Record<string, string>,
  verifiedTenants: ReadonlySet<string>,
): { name: string; wasFallback: boolean } {
  if (!tenantId) return { name: 'STRIDE LOGISTICS', wasFallback: true };
  const mapped = acctMap[tenantId];
  if (!mapped) return { name: 'STRIDE LOGISTICS', wasFallback: true };
  if (!verifiedTenants.has(tenantId)) {
    console.warn(`[dt-push-order] tenant ${tenantId} mapped to "${mapped}" but NOT in verified_account_tenants — falling back to STRIDE LOGISTICS. Run UPDATE dt_credentials SET verified_account_tenants = COALESCE(verified_account_tenants, '[]'::jsonb) || to_jsonb('${tenantId}'::text); after confirming the DT account exists.`);
    return { name: 'STRIDE LOGISTICS', wasFallback: true };
  }
  return { name: mapped, wasFallback: false };
}

/**
 * Prune duplicate dt_order_items rows for one order. Same logical line
 * collapses to the most-recently-updated row; older rows are deleted.
 *
 * Dedup key:
 *   • dt_item_code when present (inventory-sourced rows). Same SKU on
 *     the same order is the same physical item — even if descriptions
 *     diverge between create-time (vendor-prefixed) and post-DT-sync
 *     (the dispatch export shape).
 *   • description (lowercased + whitespace-collapsed) when dt_item_code
 *     is null (ad-hoc free-text rows). Same wording = same line.
 *
 * dt_order_items has no UNIQUE constraint on (dt_order_id, dt_item_code),
 * and several historical write paths have produced duplicates for the
 * same line:
 *   • Modal edit-promote: delete-then-insert leaves duplicates if the
 *     ref pointing at the old order id is null/stale and the delete
 *     becomes a no-op against `dt_order_id IS NULL`.
 *   • dt-backfill-orders: matches existing items by dt_item_code OR
 *     description; if DT's export reformatted the description (vendor
 *     prefix dropped, etc.) the match misses and a new row is inserted.
 *
 * Running this at the start of every push makes the operation idempotent
 * — re-pushes never accumulate duplicates and DT never sees doubled items.
 *
 * Best-effort: any error logs and returns; the caller still proceeds with
 * whatever the items table currently contains.
 */
// deno-lint-ignore no-explicit-any
async function pruneDuplicateOrderItems(supabase: any, dtOrderId: string): Promise<void> {
  try {
    // v2026-05-04: Skip removed rows. Including them risked the
    // newest-wins sort below preferring a soft-deleted row (whose
    // updated_at got bumped at removal time) over its active duplicate.
    const { data, error } = await supabase
      .from('dt_order_items')
      .select('id, dt_item_code, description, updated_at, created_at')
      .eq('dt_order_id', dtOrderId)
      .is('removed_at', null);
    if (error || !data) return;

    const normDesc = (s: string | null) => (s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
    const groups = new Map<string, Array<{ id: string; updated_at: string | null; created_at: string | null }>>();
    for (const row of data as Array<{ id: string; dt_item_code: string | null; description: string | null; updated_at: string | null; created_at: string | null }>) {
      const sku = (row.dt_item_code ?? '').trim();
      // SKU rows group by SKU (different descriptions of the same item
      // collapse). Ad-hoc rows group by normalized description.
      const key = sku ? `sku:${sku}` : `desc:${normDesc(row.description)}`;
      // Skip rows with no usable key — both columns null would otherwise
      // collapse every such row into a single bucket and we'd delete
      // legitimate-but-blank lines.
      if (key === 'desc:') {
        groups.set(`__id:${row.id}`, [row]);
        continue;
      }
      const arr = groups.get(key);
      if (arr) arr.push(row);
      else groups.set(key, [row]);
    }
    const toDelete: string[] = [];
    for (const arr of groups.values()) {
      if (arr.length < 2) continue;
      arr.sort((a, b) => {
        const au = a.updated_at ?? a.created_at ?? '';
        const bu = b.updated_at ?? b.created_at ?? '';
        if (au !== bu) return au < bu ? 1 : -1; // newest first
        return 0;
      });
      // Keep arr[0] (newest); delete the rest.
      for (let i = 1; i < arr.length; i++) toDelete.push(arr[i].id);
    }
    if (toDelete.length === 0) return;
    const { error: delErr } = await supabase
      .from('dt_order_items')
      .delete()
      .in('id', toDelete);
    if (delErr) {
      console.warn(`[dt-push-order] dedup delete partial failure for ${dtOrderId}:`, delErr.message);
    } else {
      console.log(`[dt-push-order] pruned ${toDelete.length} duplicate item(s) on ${dtOrderId}`);
    }
  } catch (err) {
    console.warn(`[dt-push-order] dedup threw for ${dtOrderId}:`, (err as Error).message);
  }
}

/**
 * Sort items into the canonical order DT should receive them in (v40 2026-05-26).
 *
 * Natural-numeric sort by `dt_item_code` so numeric inventory IDs land in the
 * order an operator expects on the manifest:
 *
 *   "9" < "10" < "100" < "1000"   (NOT lexicographic "10","100","1000","9")
 *
 * The trick is sorting by code length first, then lexicographic — equivalent
 * to numeric sort for pure-digit strings, and degrades gracefully for codes
 * with letters (still groups by length, then alphabetic within a length).
 *
 * Ad-hoc rows (no dt_item_code AND no inventory_id) sort to the end, grouped
 * by description so identical free-text lines cluster together. They follow
 * the inventory rows so a multi-vendor 91-row order doesn't interleave a
 * stray "RESCHEDULED — see notes" placeholder between vendor pieces.
 *
 * Sort is stable for ties (same code OR same ad-hoc description) by falling
 * through to the row UUID — the order will be deterministic across re-pushes
 * even if two rows somehow share a code.
 *
 * Called immediately after fetching items, in both the primary and the
 * linked-leg push paths, so DT's display order matches Stride's intent on
 * every push.
 */
function sortItemsForPush(items: DtOrderItemRow[]): DtOrderItemRow[] {
  return [...items].sort((a, b) => {
    const aCode = (a.dt_item_code ?? '').trim();
    const bCode = (b.dt_item_code ?? '').trim();
    // Coded rows (inventory-sourced) come before ad-hoc rows.
    if (aCode && !bCode) return -1;
    if (!aCode && bCode) return 1;
    if (aCode && bCode) {
      // Natural sort: short codes before long; within a length, lex.
      if (aCode.length !== bCode.length) return aCode.length - bCode.length;
      if (aCode !== bCode) return aCode < bCode ? -1 : 1;
      // Same code → fall through to UUID tiebreaker (deterministic).
    } else {
      // Both ad-hoc: order by lowercased description, then UUID.
      const aDesc = (a.description ?? '').toLowerCase();
      const bDesc = (b.description ?? '').toLowerCase();
      if (aDesc !== bDesc) return aDesc < bDesc ? -1 : 1;
    }
    // Final tiebreaker: row UUID. Lex order is stable across re-pushes
    // because dt_order_items.id never changes.
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// Parse the DT dispatch id from an add_order response body. DT
// historically returned only <success>Imported given orders!</success>
// (see v8 docstring in dt-sync-statuses), but newer responses can
// carry the newly-imported order's dispatch id alongside the success
// marker. The exact shape isn't stable across DT installs, so we try
// the patterns we've observed in the wild + the obvious fallbacks and
// return the first numeric match. Returns null when no dispatch id is
// present — callers must treat null as "leave the column alone", never
// as "clear it".
function parseDispatchId(body: string): number | null {
  if (!body) return null;
  // Only dispatch-id-shaped patterns. We deliberately do NOT match a
  // generic <order_id>NNN</order_id> tag because DT installs use that
  // field for the human Order_Number (e.g. "MRS-00047") on some
  // endpoints, and a future install that emits a numeric order
  // number there would be silently captured as a dispatch id.
  // `dt_dispatch_id` is INT in the schema, so we require \d+ here and
  // discard anything non-numeric.
  const patterns: RegExp[] = [
    /<dispatch_id>\s*(\d+)\s*<\/dispatch_id>/i,
    /<service_order\b[^>]*\bdispatch_id\s*=\s*"(\d+)"/i,
    /<service_order\b[^>]*\bid\s*=\s*"(\d+)"/i,
  ];
  for (const re of patterns) {
    const m = re.exec(body);
    if (m) {
      const n = parseInt(m[1], 10);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return null;
}

// Push a single order to DT. Returns {ok, body, dispatchId?}.
// dispatchId is non-null when DT's response carried a parseable dispatch
// id; it's an opportunistic capture so callers can stamp dt_dispatch_id
// on the dt_orders row without waiting for a dt-sync-statuses poll.
async function pushSingleOrder(
  order: DtOrderRow,
  items: DtOrderItemRow[],
  accountName: string,
  postUrl: string,
  // deno-lint-ignore no-explicit-any
  supabase: any,
  crossRefIdent?: string,
  linkedDeliveryInfo?: { identifier: string; contactName?: string; address?: string; city?: string; state?: string; zip?: string },
  groups: Set<DtFieldGroup> | null = null,
): Promise<{ ok: boolean; body: string; errMsg?: string; dispatchId?: number | null }> {
  // Build the DT Attachments custom-field BEFORE the XML — best-effort
  // and never blocks the push (returns '' on any failure). Skip the
  // photo_shares read/write entirely on a scoped push that didn't touch
  // custom fields: no <additional_fields> will be emitted anyway, so the
  // share-row side effect would be pointless churn.
  const buildAttachments = groups === null || groups.has('custom');
  const attachmentsField = buildAttachments ? await buildAttachmentsField(supabase, order) : '';

  // v42 — pickup-completion warnings for the delivery leg. dt-sync-statuses
  // writes pickup_completion_notes onto dt_pickup_links when a linked
  // pickup completes; we surface them inline on the delivery's DT card
  // so the delivery driver sees pickup-side surprises in their notes
  // pane. Only fetched for delivery legs (orderType pickup_and_delivery
  // or delivery) AND only when the notes group is in scope (a scoped
  // re-push that didn't touch notes skips this entirely to avoid
  // overwriting dispatcher annotations). Empty result → no prefix.
  let completionWarningPrefix = '';
  const orderTypeForLegCheck = order.order_type || (order.is_pickup ? 'pickup' : 'delivery');
  const isDeliveryLeg = orderTypeForLegCheck !== 'pickup' && orderTypeForLegCheck !== 'service_only';
  if (isDeliveryLeg && (groups === null || groups.has('notes'))) {
    const { data: linkRows } = await supabase
      .from('dt_pickup_links')
      .select('pickup_label, pickup_completion_notes, sort_order')
      .eq('delivery_order_id', order.id)
      .order('sort_order', { ascending: true });
    const warnings = ((linkRows ?? []) as Array<{ pickup_label: string | null; pickup_completion_notes: string | null; sort_order: number | null }>)
      .filter(r => (r.pickup_completion_notes ?? '').trim().length > 0)
      .map((r, _i, arr) => {
        const labelPart = r.pickup_label
          ? r.pickup_label
          : (arr.length > 1 ? `Pickup ${(r.sort_order ?? 0) + 1}` : 'Pickup');
        return `${labelPart}: ${(r.pickup_completion_notes ?? '').trim()}`;
      });
    if (warnings.length > 0) {
      completionWarningPrefix = '⚠ PICKUP NOTES FROM DRIVER:\n' + warnings.join('\n');
    }
  }

  const xml = buildOrderXml(order, items, accountName, crossRefIdent, linkedDeliveryInfo, attachmentsField, groups, completionWarningPrefix);
  console.log(`[dt-push-order] POST order=${order.dt_identifier} type=${order.order_type || 'delivery'} items=${items.length} account=${accountName}${crossRefIdent ? ` crossRef=${crossRefIdent}` : ''} scope=${groups === null ? 'FULL' : [...groups].join(',')}`);
  console.log(`[dt-push-order] XML payload:\n${xml.slice(0, 800)}`);
  try {
    // DT API expects XML as a form-encoded "data" parameter (per API docs v8.1)
    const formBody = `data=${encodeURIComponent(xml)}`;
    const resp = await fetch(postUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody,
    });
    const body = await resp.text();
    console.log(`[dt-push-order] DT response status=${resp.status} body=${body.slice(0, 500)}`);
    const isSuccess = /<success>/i.test(body) && resp.ok;
    if (!isSuccess) {
      const errMatch = body.match(/<error[^>]*>([\s\S]*?)<\/error>/i) || body.match(/<message[^>]*>([\s\S]*?)<\/message>/i);
      const errMsg = errMatch ? errMatch[1].trim() : `HTTP ${resp.status}: ${body.slice(0, 300)}`;
      return { ok: false, body, errMsg };
    }
    // Opportunistic dispatch-id capture. Older DT installs respond with
    // only <success>...</success> so dispatchId stays null on those —
    // the next dt-sync-statuses run backfills it via the secondary
    // sweep added in v18 of that function. Logged so we can audit
    // capture rate after deploy.
    const dispatchId = parseDispatchId(body);
    if (dispatchId != null) {
      console.log(`[dt-push-order] captured dispatch_id=${dispatchId} for order=${order.dt_identifier}`);
    }
    return { ok: true, body, dispatchId };
  } catch (err) {
    return { ok: false, body: '', errMsg: `Network error: ${(err as Error).message}` };
  }
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  let orderId: string;
  // null = full push (legacy/initial-push contract). A scoped set comes
  // from React edit-save callers that diffed the form against the loaded
  // order. Threaded to BOTH legs of a P+D pair (the diff is order-level).
  let changedFields: Set<DtFieldGroup> | null = null;
  try {
    const body = await req.json();
    orderId = body.orderId;
    if (!orderId) throw new Error('orderId required');
    changedFields = parseChangedFields(body.changedFields);
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 400);
  }

  try { // Top-level catch — any unhandled error returns 500 with details

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, serviceKey);

  // ── 1. Fetch primary order ────────────────────────────────────────────
  const { data: order, error: orderErr } = await supabase
    .from('dt_orders')
    .select('id, tenant_id, dt_identifier, is_pickup, order_type, linked_order_id, contact_name, contact_address, contact_city, contact_state, contact_zip, contact_phone, contact_phone2, contact_email, local_service_date, dt_scheduled_date, window_start_local, window_end_local, po_number, sidemark, client_reference, details, order_notes, driver_notes, internal_notes, pickup_notes, delivery_notes, service_time_minutes, review_status, pushed_to_dt_at, billing_method, order_total, base_delivery_fee, extra_items_count, extra_items_fee, accessorials_json, accessorials_total, coverage_option_id, coverage_charge, declared_value, billing_review_status, paid_at, paid_amount, paid_method, linked_pickup_driver_name')
    .eq('id', orderId)
    .maybeSingle();

  if (orderErr || !order) {
    return new Response(JSON.stringify({ ok: false, error: `Order not found: ${orderErr?.message || 'unknown'}` }), { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const orderTyped = order as DtOrderRow;

  // Resolve coverage option name for the description (separate fetch
  // because the FK isn't a PostgREST embedded relation in the cached
  // schema). Best-effort — if it fails, the description falls back to
  // the literal "Coverage" label.
  if (orderTyped.coverage_option_id) {
    try {
      const { data: cv } = await supabase
        .from('coverage_options')
        .select('name')
        .eq('id', orderTyped.coverage_option_id)
        .maybeSingle();
      if (cv && (cv as { name?: string }).name) orderTyped.coverage_name = (cv as { name?: string }).name;
    } catch (_) { /* leave coverage_name undefined → "Coverage" fallback */ }
  }
  const orderType = orderTyped.order_type || (orderTyped.is_pickup ? 'pickup' : 'delivery');

  // ── 1.5. Idempotent dedup: prune dt_order_items duplicates ────────────
  // dt_order_items has no UNIQUE constraint on (dt_order_id, dt_item_code,
  // description), and several historical write paths (modal edit-promote,
  // dt-backfill description-merge) have produced duplicate rows for the
  // same logical line. Doubled rows make push send each item twice to
  // DispatchTrack. Before reading items, collapse any duplicate (dt_item_code,
  // description) pairs for this order, keeping the most-recently-updated row.
  // ad-hoc rows (dt_item_code = null) are deduped by description only.
  await pruneDuplicateOrderItems(supabase, orderId);

  // ── 2. Fetch items for primary order ──────────────────────────────────
  // v2026-05-04: Filter removed_at IS NULL so soft-removed items (either
  // by app-side edit or DT→App sync) don't get re-pushed back to DT on
  // a republish. A republish should reflect Stride's current state.
  const { data: items, error: itemsErr } = await supabase
    .from('dt_order_items')
    .select('id, inventory_id, dt_item_code, description, quantity, vendor, class_name, cubic_feet, room, extras, picked_up_at')
    .eq('dt_order_id', orderId)
    .is('removed_at', null);

  if (itemsErr) {
    return new Response(JSON.stringify({ ok: false, error: `Items fetch failed: ${itemsErr.message}` }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // v40 — natural-numeric sort by dt_item_code so DT receives items in the
  // order operators expect on the manifest (9, 10, 11 — not 10, 11, 9).
  // Ad-hoc rows (no code) cluster at the end. See sortItemsForPush header.
  const itemsTyped = sortItemsForPush((items || []) as DtOrderItemRow[]);
  // service_only is allowed to have no items. All other types require at least one.
  if (itemsTyped.length === 0 && orderType !== 'service_only') {
    return new Response(JSON.stringify({ ok: false, error: 'Order has no items — cannot push to DT' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // ── 3. Fetch DT credentials + resolve account name ────────────────────
  // v41 — read verified_account_tenants alongside the map so the resolver
  // can fall back to STRIDE LOGISTICS when the tenant is mapped but not
  // yet verified (the NIP-00127 case — see resolveAccountName docstring).
  const { data: creds, error: credsErr } = await supabase
    .from('dt_credentials')
    .select('api_base_url, auth_token_encrypted, account_name_map, verified_account_tenants')
    .maybeSingle();

  if (credsErr || !creds) {
    return new Response(JSON.stringify({ ok: false, error: 'DT credentials not configured' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const apiKey = creds.auth_token_encrypted as string;
  const baseUrl = (creds.api_base_url as string || 'https://expressinstallation.dispatchtrack.com').replace(/\/$/, '');
  const acctMap = (creds.account_name_map || {}) as Record<string, string>;
  // v41 — verified_account_tenants is a JSONB array of tenant_id strings.
  // Parse defensively: null / non-array / empty all collapse to an empty
  // Set so resolveAccountName falls back to STRIDE LOGISTICS for every
  // mapped tenant until at least one is explicitly verified.
  const verifiedRaw = creds.verified_account_tenants;
  const verifiedTenants = new Set<string>(
    Array.isArray(verifiedRaw) ? verifiedRaw.filter((t): t is string => typeof t === 'string') : []
  );
  const { name: accountName, wasFallback: accountWasFallback } =
    resolveAccountName(orderTyped.tenant_id, acctMap, verifiedTenants);

  if (!accountName) {
    return new Response(JSON.stringify({ ok: false, error: `No DT account mapped for tenant_id "${orderTyped.tenant_id}". Add an entry to dt_credentials.account_name_map.` }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const postUrl = `${baseUrl}/orders/api/add_order?code=expressinstallation&api_key=${encodeURIComponent(apiKey)}`;

  // ── 4. Handle linked leg (for pickup_and_delivery pairs) ──────────────
  // When the primary is the DELIVERY leg of a P+D pair (order_type=
  // 'pickup_and_delivery' + linked_order_id set), push the linked pickup
  // first, then the delivery. When the primary is the PICKUP leg of a
  // P+D pair (order_type='pickup' + linked_order_id set), push the
  // linked delivery first, then the pickup. Either way, pushing from
  // either leg flushes both legs to DT — so the operator can re-push
  // from either page after editing items on either side.
  //
  // v20 (2026-05-11): pickup-primary case added. Pre-fix only the
  // delivery-primary branch ran Section 4, so a user pushing from the
  // pickup OrderPage left the delivery stale in DT (and vice versa
  // when the pickup leg got an item added after the initial push but
  // the user only re-pushed the delivery). Both branches now also
  // re-mirror via the upsert-by-identifier behavior of DT add_order,
  // so re-clicking is safe and idempotent.
  let linkedPushedIdentifier: string | undefined;
  // Stash the fetched linked row so Section 5 below (which needs the
  // linked delivery's contact info when pushing a pickup-primary) can
  // reuse the same row instead of a second round-trip.
  let stashedLinkedRow: DtOrderRow | null = null;
  const isPDDeliveryPrimary = orderType === 'pickup_and_delivery' && !!orderTyped.linked_order_id;
  const isPDPickupPrimary   = orderType === 'pickup'                && !!orderTyped.linked_order_id;

  if (isPDDeliveryPrimary || isPDPickupPrimary) {
    // Fetch the linked leg (delivery if primary is pickup; pickup if
    // primary is delivery). The v18 cross-ref + service-date fallback
    // works the same either direction.
    const { data: linkedOrder, error: linkedErr } = await supabase
      .from('dt_orders')
      .select('id, tenant_id, dt_identifier, is_pickup, order_type, linked_order_id, contact_name, contact_address, contact_city, contact_state, contact_zip, contact_phone, contact_phone2, contact_email, local_service_date, dt_scheduled_date, window_start_local, window_end_local, po_number, sidemark, client_reference, details, order_notes, driver_notes, internal_notes, pickup_notes, delivery_notes, service_time_minutes, review_status, pushed_to_dt_at, billing_method, order_total, base_delivery_fee, extra_items_count, extra_items_fee, accessorials_json, accessorials_total, billing_review_status, paid_at, paid_amount, paid_method, linked_pickup_driver_name')
      .eq('id', orderTyped.linked_order_id)
      .maybeSingle();

    if (!linkedErr && linkedOrder) {
      const linkedTyped = linkedOrder as DtOrderRow;
      stashedLinkedRow = linkedTyped;
      // Identify which row is the pickup leg vs. delivery leg of the
      // pair. For a P+D pair: one row has order_type='pickup', the
      // other 'pickup_and_delivery'.
      const pickupRow   = isPDDeliveryPrimary ? linkedTyped : orderTyped;
      const deliveryRow = isPDDeliveryPrimary ? orderTyped : linkedTyped;
      // v18 fix: pickup leg shows "-" for service date in DT when the
      // linked pickup row's `local_service_date` is null (the React
      // create-order path didn't always stamp it on the pickup leg).
      // For a pickup_and_delivery pair the two legs share the same
      // calendar day, so fall back to the delivery leg's date here
      // before building the pickup XML. Same fallback for the time
      // window since DT's pickup card renders both side-by-side.
      if (!pickupRow.local_service_date && deliveryRow.local_service_date) {
        pickupRow.local_service_date = deliveryRow.local_service_date;
      }
      // v39 — same fallback for dt_scheduled_date (DT-side mirrored date).
      // A P+D pair shares the calendar day on both legs in DT, so when only
      // the delivery has been synced (e.g. the pickup row was never pushed
      // before) we want the pickup re-push to carry the delivery's DT date
      // so DT keeps the pair coherent on its side.
      if (!pickupRow.dt_scheduled_date && deliveryRow.dt_scheduled_date) {
        pickupRow.dt_scheduled_date = deliveryRow.dt_scheduled_date;
      }
      if (!pickupRow.window_start_local && deliveryRow.window_start_local) {
        pickupRow.window_start_local = deliveryRow.window_start_local;
      }
      if (!pickupRow.window_end_local && deliveryRow.window_end_local) {
        pickupRow.window_end_local = deliveryRow.window_end_local;
      }
      // v2026-05-04: Lifted the "skip if already pushed" guard. DT's
      // add_order is upsert-by-identifier (Ashok confirmed): re-posting
      // the same order_number with an updated payload replaces the
      // existing order in DT. Without this, the pickup leg's edits
      // (item add/remove, time-window change, address fix) never
      // propagated after the first push.
      // Same dedup the primary order gets — see pruneDuplicateOrderItems.
      await pruneDuplicateOrderItems(supabase, linkedTyped.id);
      const { data: linkedItems } = await supabase
        .from('dt_order_items')
        .select('id, inventory_id, dt_item_code, description, quantity, vendor, class_name, cubic_feet, room, extras, picked_up_at')
        .eq('dt_order_id', linkedTyped.id)
        .is('removed_at', null);
      // v40 — same natural-numeric sort as the primary leg so a P+D pair
      // shows pickup and delivery items in matching order on DT.
      const linkedItemsTyped = sortItemsForPush((linkedItems || []) as DtOrderItemRow[]);

      // The linked push needs the OTHER leg's info as cross-ref. For
      // pickup-as-linked the description points "to delivery" (the
      // primary). For delivery-as-linked the cross-ref points "to
      // pickup" (the primary). linkedDeliveryInfo is only used when
      // pushing the pickup leg (drives "PICK UP for Del <id>" prefix
      // + the description's LINKED DELIVERY block), so we only pass
      // it when linkedTyped IS the pickup.
      const linkedIsPickup = String(linkedTyped.order_type || '') === 'pickup'
        || linkedTyped.is_pickup === true;
      const linkedPush = await pushSingleOrder(
        linkedTyped, linkedItemsTyped, accountName, postUrl, supabase,
        orderTyped.dt_identifier, // cross-ref always points to the primary
        linkedIsPickup ? {
          identifier: deliveryRow.dt_identifier,
          contactName: deliveryRow.contact_name || undefined,
          address: deliveryRow.contact_address || undefined,
          city: deliveryRow.contact_city || undefined,
          state: deliveryRow.contact_state || undefined,
          zip: deliveryRow.contact_zip || undefined,
        } : undefined,
        changedFields, // same scope on both legs — diff is order-level
      );

      if (!linkedPush.ok) {
        return new Response(JSON.stringify({
          ok: false,
          error: `Linked leg push failed: ${linkedPush.errMsg}`,
          responseBody: linkedPush.body.slice(0, 500),
        }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // v35: stamp dt_dispatch_id when DT returned one in the add_order
      // response. Skipped when null (older DT installs) so we never
      // overwrite a previously-captured value with NULL.
      const linkedUpdate: Record<string, unknown> = {
        pushed_to_dt_at: new Date().toISOString(),
        source: 'app',
        last_synced_at: new Date().toISOString(),
        // v41 — stamp the fallback flag so the OrderPage banner can warn
        // the operator that this leg was pushed under STRIDE LOGISTICS
        // instead of the tenant's real DT account. Same flag value as
        // the primary leg; both legs of a P+D pair share the tenant +
        // verification state.
        pushed_account_was_fallback: accountWasFallback,
      };
      if (linkedPush.dispatchId != null) {
        linkedUpdate.dt_dispatch_id = linkedPush.dispatchId;
      }
      await supabase
        .from('dt_orders')
        .update(linkedUpdate)
        .eq('id', linkedTyped.id);

      linkedPushedIdentifier = linkedTyped.dt_identifier;
    }
  }

  // ── 4.5. Fan-out to additional pickups via dt_pickup_links (v43) ──────
  // Multi-pickup Phase 1.5: a delivery can have N pickups, not just the
  // one denormalized into `linked_order_id`. PR #577 backfilled the join
  // table for legacy single-pickup pairs so the row is always present.
  // For multi-pickup orders we still want a single Push from the
  // delivery page (or from any one pickup) to flush ALL legs to DT.
  //
  // Strategy: figure out which delivery this primary belongs to (either
  // primary IS the delivery, or primary is a pickup whose join row points
  // at one) and fetch all OTHER pickups for that delivery — skipping
  // both the primary AND any pickup already pushed in Section 4. Each
  // additional pickup gets the same prep (date/window fallback, item
  // dedup, sort) and same cross-ref payload as the Section 4 pickup
  // push so DT receives a coherent set of cards.
  //
  // Failure mode: one fan-out failure does NOT abort the rest. We
  // collect failures and return them in `extra_failures` so the caller
  // can surface a partial-success state. Aborting on first failure
  // would leave the operator with N partially-pushed legs and no clear
  // way to retry just the failed ones.
  const additionalPushed: string[] = [];
  const additionalFailures: Array<{ identifier: string; error: string }> = [];
  // Identify the delivery row of this multi-leg order, if any.
  const deliveryRowForFanout: DtOrderRow | null = (() => {
    if (isPDDeliveryPrimary) return orderTyped;
    if (isPDPickupPrimary && stashedLinkedRow) {
      const stashedIsDelivery = String(stashedLinkedRow.order_type || '') === 'pickup_and_delivery'
        || stashedLinkedRow.is_pickup === false;
      return stashedIsDelivery ? stashedLinkedRow : null;
    }
    return null;
  })();

  if (deliveryRowForFanout) {
    // Pickup ids we've already pushed (or will push as the primary)
    // — exclude them from the fan-out so we never double-push the
    // same leg.
    const alreadyHandled = new Set<string>();
    alreadyHandled.add(orderTyped.id);
    if (stashedLinkedRow) alreadyHandled.add(stashedLinkedRow.id);

    const { data: linkRows, error: linkRowsErr } = await supabase
      .from('dt_pickup_links')
      .select('pickup_order_id, sort_order')
      .eq('delivery_order_id', deliveryRowForFanout.id)
      .order('sort_order', { ascending: true });

    if (linkRowsErr) {
      console.warn(`[dt-push-order] dt_pickup_links fetch failed for delivery=${deliveryRowForFanout.dt_identifier}: ${linkRowsErr.message}`);
    } else {
      const extraPickupIds = ((linkRows ?? []) as Array<{ pickup_order_id: string }>)
        .map(r => r.pickup_order_id)
        .filter(pid => pid && !alreadyHandled.has(pid));

      for (const pickupId of extraPickupIds) {
        const { data: extraRow, error: extraRowErr } = await supabase
          .from('dt_orders')
          .select('id, tenant_id, dt_identifier, is_pickup, order_type, linked_order_id, contact_name, contact_address, contact_city, contact_state, contact_zip, contact_phone, contact_phone2, contact_email, local_service_date, dt_scheduled_date, window_start_local, window_end_local, po_number, sidemark, client_reference, details, order_notes, driver_notes, internal_notes, pickup_notes, delivery_notes, service_time_minutes, review_status, pushed_to_dt_at, billing_method, order_total, base_delivery_fee, extra_items_count, extra_items_fee, accessorials_json, accessorials_total, coverage_option_id, coverage_charge, declared_value, billing_review_status, paid_at, paid_amount, paid_method, linked_pickup_driver_name')
          .eq('id', pickupId)
          .maybeSingle();
        if (extraRowErr || !extraRow) {
          const msg = extraRowErr?.message || 'pickup row not found';
          console.warn(`[dt-push-order] fan-out: extra pickup fetch failed id=${pickupId}: ${msg}`);
          additionalFailures.push({ identifier: pickupId, error: msg });
          continue;
        }
        const extraTyped = extraRow as DtOrderRow;
        // Same date/window fallback the Section 4 push applies — a
        // multi-leg pair shares the calendar day on the DT side.
        if (!extraTyped.local_service_date && deliveryRowForFanout.local_service_date) {
          extraTyped.local_service_date = deliveryRowForFanout.local_service_date;
        }
        if (!extraTyped.dt_scheduled_date && deliveryRowForFanout.dt_scheduled_date) {
          extraTyped.dt_scheduled_date = deliveryRowForFanout.dt_scheduled_date;
        }
        if (!extraTyped.window_start_local && deliveryRowForFanout.window_start_local) {
          extraTyped.window_start_local = deliveryRowForFanout.window_start_local;
        }
        if (!extraTyped.window_end_local && deliveryRowForFanout.window_end_local) {
          extraTyped.window_end_local = deliveryRowForFanout.window_end_local;
        }
        await pruneDuplicateOrderItems(supabase, extraTyped.id);
        const { data: extraItems } = await supabase
          .from('dt_order_items')
          .select('id, inventory_id, dt_item_code, description, quantity, vendor, class_name, cubic_feet, room, extras, picked_up_at')
          .eq('dt_order_id', extraTyped.id)
          .is('removed_at', null);
        const extraItemsTyped = sortItemsForPush((extraItems || []) as DtOrderItemRow[]);

        // Cross-ref always points at the delivery for a pickup leg —
        // matches the single-pickup Section 4 behaviour where the
        // pickup's description carries "for Del <id>".
        const extraPush = await pushSingleOrder(
          extraTyped, extraItemsTyped, accountName, postUrl, supabase,
          deliveryRowForFanout.dt_identifier,
          {
            identifier: deliveryRowForFanout.dt_identifier,
            contactName: deliveryRowForFanout.contact_name || undefined,
            address: deliveryRowForFanout.contact_address || undefined,
            city: deliveryRowForFanout.contact_city || undefined,
            state: deliveryRowForFanout.contact_state || undefined,
            zip: deliveryRowForFanout.contact_zip || undefined,
          },
          changedFields,
        );

        if (!extraPush.ok) {
          const msg = extraPush.errMsg || 'unknown DT error';
          console.error(`[dt-push-order] fan-out: extra pickup push failed id=${extraTyped.dt_identifier}: ${msg}`);
          additionalFailures.push({ identifier: extraTyped.dt_identifier, error: msg });
          continue;
        }

        const extraUpdate: Record<string, unknown> = {
          pushed_to_dt_at: new Date().toISOString(),
          source: 'app',
          last_synced_at: new Date().toISOString(),
          pushed_account_was_fallback: accountWasFallback,
        };
        if (extraPush.dispatchId != null) extraUpdate.dt_dispatch_id = extraPush.dispatchId;
        await supabase.from('dt_orders').update(extraUpdate).eq('id', extraTyped.id);
        additionalPushed.push(extraTyped.dt_identifier);
      }
    }
  }

  // ── 5. Push the primary (delivery/pickup/service) order ───────────────
  // When the primary IS the pickup leg of a P+D pair, the description
  // needs the linkedDeliveryInfo block so dispatch sees the delivery
  // address. Reuse the linked row Section 4 already fetched into
  // stashedLinkedRow — no extra round-trip.
  // Index 6 = linkedDeliveryInfo (5 was bumped to supabase in the
  // attachments wiring). Type query keeps the shape automatically in
  // sync with the function signature.
  let primaryLinkedDeliveryInfo: Parameters<typeof pushSingleOrder>[6] | undefined;
  if (isPDPickupPrimary && stashedLinkedRow) {
    primaryLinkedDeliveryInfo = {
      identifier: stashedLinkedRow.dt_identifier as string,
      contactName: stashedLinkedRow.contact_name || undefined,
      address: stashedLinkedRow.contact_address || undefined,
      city: stashedLinkedRow.contact_city || undefined,
      state: stashedLinkedRow.contact_state || undefined,
      zip: stashedLinkedRow.contact_zip || undefined,
    };
  }
  const primaryPush = await pushSingleOrder(
    orderTyped, itemsTyped, accountName, postUrl, supabase,
    linkedPushedIdentifier, // include cross-ref if we pushed a linked leg
    primaryLinkedDeliveryInfo,
    changedFields,
  );

  if (!primaryPush.ok) {
    console.error(`[dt-push-order] DT rejected primary order=${orderTyped.dt_identifier}: ${primaryPush.errMsg}`);
    return new Response(JSON.stringify({
      ok: false,
      error: `DT API error: ${primaryPush.errMsg}`,
      responseBody: primaryPush.body.slice(0, 500),
      linked_identifier: linkedPushedIdentifier,  // caller knows pickup may have already pushed
    }), { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // ── 6. Update pushed_to_dt_at for primary ─────────────────────────────
  // v35: stamp dt_dispatch_id when DT returned one. Skipped when null
  // (older DT installs) so we never overwrite a previously-captured
  // value — the dt-sync-statuses secondary sweep will backfill it via
  // export.xml on the next poll.
  const primaryUpdate: Record<string, unknown> = {
    pushed_to_dt_at: new Date().toISOString(),
    source: 'app',
    last_synced_at: new Date().toISOString(),
    // v41 — see linkedUpdate above. Stamps TRUE when this push used
    // STRIDE LOGISTICS instead of the tenant's mapped DT account
    // (either because the tenant is unmapped OR not yet verified).
    pushed_account_was_fallback: accountWasFallback,
  };
  if (primaryPush.dispatchId != null) {
    primaryUpdate.dt_dispatch_id = primaryPush.dispatchId;
  }
  const { error: updateErr } = await supabase
    .from('dt_orders')
    .update(primaryUpdate)
    .eq('id', orderId);

  if (updateErr) console.warn(`[dt-push-order] DT push ok but local update failed: ${updateErr.message}`);

  // Audit row for the push event lives on the React side (OrderPage Push
  // to DT handler) so it can attribute `performed_by` to the actual
  // authenticated user. The edge function runs under service role and
  // doesn't see the caller's email — pushing the audit insert client-side
  // keeps every dt_order audit row consistently identified.

  const fanoutLog = additionalPushed.length > 0
    ? ` + additional=[${additionalPushed.join(',')}]`
    : '';
  const fanoutErrLog = additionalFailures.length > 0
    ? ` (fan-out failures=${additionalFailures.length})`
    : '';
  console.log(`[dt-push-order] Success order=${orderTyped.dt_identifier}${linkedPushedIdentifier ? ` + linked=${linkedPushedIdentifier}` : ''}${fanoutLog}${fanoutErrLog}`);
  return json({
    ok: true,
    dt_identifier: orderTyped.dt_identifier,
    linked_identifier: linkedPushedIdentifier,
    // Multi-pickup Phase 1.5 (v43): identifiers of the additional
    // pickups pushed via dt_pickup_links fan-out (excludes the
    // primary AND the linked_order_id pickup which are already in
    // the fields above). Empty array when the order has 0 or 1
    // pickup legs.
    additional_pickup_identifiers: additionalPushed,
    additional_pickup_failures: additionalFailures,
  });

  } catch (unhandled) {
    // Top-level catch — ensures we always return a JSON body, never a raw 500.
    // Stack trace is logged for ops debugging but never returned to the
    // caller, since the response can be surfaced directly to client UIs.
    const err = unhandled as Error;
    console.error(`[dt-push-order] Unhandled error for orderId=${orderId}:`, err);
    if (err?.stack) console.error(`[dt-push-order] Stack:`, err.stack);
    return json({
      ok: false,
      error: 'Internal error pushing order to DispatchTrack. Check function logs for details.',
    }, 500);
  }
});
