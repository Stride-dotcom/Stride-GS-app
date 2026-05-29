# DESIGN — Multi-pickup → single-delivery

**Status:** Draft v1, 2026-05-29
**Author:** Claude (Opus 4.7) with Justin

## 1. Problem

A single delivery order can today be linked to at most **one** pickup leg via the scalar FK `dt_orders.linked_order_id`. Real-world request that surfaced the gap (Sarah / JAS): one customer needs items picked up at **two separate locations** AND additional items pulled from inventory, all delivered to a single drop site. She may add a third pickup mid-flight.

Today's options force the operator into either two independent P+D pairs (loses the "all goes to one delivery" linkage and double-bills the delivery) or an ad-hoc workaround in the description field (loses pickup-completion stamping, item attribution, and DT manifests).

## 2. Locked decisions (from Justin, 2026-05-29)

| # | Question | Decision |
|---|----------|----------|
| 1 | Per-item attribution on delivery items | **Yes** — each delivery item knows which pickup it came from (or `null` = from inventory / delivery-only ad-hoc) |
| 2 | Partial-pickup display when 1 of N completes | **Partial** — UI shows "1 of 3 pickups complete"; `linked_pickup_finished_at` only stamps when ALL pickups finish |
| 3 | Add-pickup UX after order exists | **OrderPage "Add Pickup" button** opens a focused mini-modal. Main `CreateDeliveryOrderModal` stays single-pickup at create time; multi-pickup is achieved by adding more legs post-create |
| 4 | Migration strategy | **Transitional dual-write** — add `dt_pickup_links` join table; keep `linked_order_id` as a denormalized "primary pickup" pointer. Retire column in a later phase |

## 3. Current touch surface (what assumes singular linkage)

From the recon pass on 2026-05-29 (Explore agent + targeted reads):

### Schema
- [supabase/migrations/20260411120000_dt_phase1a_schema.sql:144](supabase/migrations/20260411120000_dt_phase1a_schema.sql:144) — `linked_order_id uuid REFERENCES dt_orders(id)` (scalar FK)
- [supabase/migrations/20260411120000_dt_phase1a_schema.sql:366](supabase/migrations/20260411120000_dt_phase1a_schema.sql:366) — partial index on `linked_order_id`
- [supabase/migrations/20260513120000_dt_pickup_linkage_propagation.sql](supabase/migrations/20260513120000_dt_pickup_linkage_propagation.sql) — `linked_pickup_finished_at`, `linked_pickup_driver_name`, `dt_order_items.picked_up_at` (designed for one pickup source per delivery)
- [supabase/migrations/20260513140000_dt_order_items_parent_pickup_fk.sql](supabase/migrations/20260513140000_dt_order_items_parent_pickup_fk.sql) — `parent_pickup_item_id` on `dt_order_items` (per-item pickup link, already supports N pickups today since it points at a specific row regardless of which order owns that row)

### Edge Functions
- [supabase/functions/dt-push-order/index.ts:1402](supabase/functions/dt-push-order/index.ts:1402) — `isPDDeliveryPrimary` / `isPDPickupPrimary` flags assume exactly two legs; Section 4 fetches **one** linked row and pushes it; primary loop pushes the other one
- [supabase/functions/_shared/stamp-pickup-on-linked-delivery.ts:97](supabase/functions/_shared/stamp-pickup-on-linked-delivery.ts:97) — `stampPickupOnLinkedDelivery({ pickupOrderId })` resolves `pickup.linked_order_id` to a single delivery; stamps order-level `linked_pickup_finished_at`/`linked_pickup_driver_name` unconditionally
- [supabase/functions/dt-sync-statuses/index.ts](supabase/functions/dt-sync-statuses/index.ts) — calls the helper on PU completion; P+D mirror block (v14/v15) keys on the pickup's `linked_order_id` for delivery-side INSERTs
- [supabase/functions/notify-pickup-completed/index.ts:243](supabase/functions/notify-pickup-completed/index.ts:243) — webhook entry; same helper

### React
- [src/components/shared/CreateDeliveryOrderModal.tsx:2078](src/components/shared/CreateDeliveryOrderModal.tsx:2078) — `generateLinkedOrderNumbers()` returns `{ pickup, delivery }` (scalar)
- [src/components/shared/CreateDeliveryOrderModal.tsx:1575](src/components/shared/CreateDeliveryOrderModal.tsx:1575) — `buildPDItemRows(pickupId, deliveryId)` takes one pickup id
- [src/components/shared/CreateDeliveryOrderModal.tsx:2771](src/components/shared/CreateDeliveryOrderModal.tsx:2771) — INSERT delivery with `linked_order_id: pickupId` + UPDATE pickup with `linked_order_id: deliveryId`
- [src/components/shared/CreateDeliveryOrderModal.tsx:3171](src/components/shared/CreateDeliveryOrderModal.tsx:3171) — Convert-delivery-to-P+D branch (PR #431); guards on `originalOrderTypeRef.current === 'delivery'` and bails if already P+D
- [src/pages/OrderPage.tsx:564](src/pages/OrderPage.tsx:564) — `LinkedPickupBanner` takes a single `pickupOrderId`
- [src/pages/OrderPage.tsx:1410](src/pages/OrderPage.tsx:1410) — `fetchDtOrderByIdFromSupabase(order.linkedOrderId)` (scalar)
- [src/lib/supabaseQueries.ts:2377](src/lib/supabaseQueries.ts:2377), [src/lib/supabaseQueries.ts:2539](src/lib/supabaseQueries.ts:2539) — `linkedOrderId: row.linked_order_id` deserialized as scalar

### GAS
- No `linked_order_id` references in `StrideAPI.gs` — GAS layer is unaffected by this change.

### Identifier scheme
- Today: `BASE-NNNNN-CLIENT-P` (pickup) and `BASE-NNNNN-CLIENT-D` (delivery), one sequence per pair via `buildOrderNumberBase()` at [CreateDeliveryOrderModal.tsx:2041](src/components/shared/CreateDeliveryOrderModal.tsx:2041)
- For N pickups: `BASE-NNNNN-CLIENT-P1`, `-P2`, `-P3` … and `-D` (single delivery). Sequence is still allocated once per pair, so all legs share the same `BASE-NNNNN` root.

## 4. Schema design

### 4.1 New table: `dt_pickup_links`

```sql
CREATE TABLE public.dt_pickup_links (
  id                      uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               text        NOT NULL,
  delivery_order_id       uuid        NOT NULL REFERENCES public.dt_orders(id) ON DELETE CASCADE,
  pickup_order_id         uuid        NOT NULL REFERENCES public.dt_orders(id) ON DELETE CASCADE,
  sequence_no             smallint    NOT NULL CHECK (sequence_no BETWEEN 1 AND 9),
  -- Cached completion fields, refreshed by the stamp helper.
  -- Per-pickup mirror of the existing dt_orders.linked_pickup_* columns.
  pickup_finished_at      timestamptz,
  pickup_driver_name      text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT dt_pickup_links_unique_pair      UNIQUE (delivery_order_id, pickup_order_id),
  CONSTRAINT dt_pickup_links_unique_sequence  UNIQUE (delivery_order_id, sequence_no),
  -- A pickup belongs to exactly one delivery — enforces the
  -- 1-pickup-to-N-delivery direction stays forbidden (we explicitly
  -- DON'T want multi-tenant pickup sharing; each pickup is a
  -- per-delivery routing decision).
  CONSTRAINT dt_pickup_links_unique_pickup    UNIQUE (pickup_order_id)
);

CREATE INDEX idx_dt_pickup_links_delivery ON public.dt_pickup_links (delivery_order_id);
CREATE INDEX idx_dt_pickup_links_pickup   ON public.dt_pickup_links (pickup_order_id);

-- RLS: mirror dt_orders (tenant-scoped read, staff/admin/service write)
ALTER TABLE public.dt_pickup_links ENABLE ROW LEVEL SECURITY;
-- (policies omitted from spec — match dt_orders pattern exactly)

CREATE TRIGGER set_updated_at_dt_pickup_links
  BEFORE UPDATE ON public.dt_pickup_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

**Why `sequence_no` is part of the schema:** drives DT identifier suffix (`-P1`, `-P2`, …) and OrderPage ordering. Capping at 9 keeps single-digit suffixes; if anyone hits the cap we can re-evaluate the format.

**Why `pickup_finished_at` is cached here too:** the existing `dt_orders.linked_pickup_finished_at` on the *delivery* row keeps its "all done" semantics (set only when every linked pickup finishes). The per-pickup completion timestamp lives here so the OrderPage can show "Pickup 2 done 5/29 14:32, Pickup 3 pending" without a second query.

### 4.2 Changes to existing tables

**`dt_orders`** — no schema change. `linked_order_id` stays. We will *write* it on the delivery row to point at the **primary (sequence_no=1)** pickup, so legacy single-pickup code paths keep returning a usable result. The pickup-side `linked_order_id` continues to point at its delivery.

**`dt_order_items`** — no schema change. `parent_pickup_item_id` already references `dt_order_items.id`, which is independent of which order the item belongs to. Existing FK works unchanged for N pickups (a delivery item can FK any item on any of the order's linked pickups).

**Backfill:** every existing P+D pair where `delivery.linked_order_id IS NOT NULL` gets one `dt_pickup_links` row with `sequence_no=1`. Standalone orders get nothing. Idempotent migration.

```sql
INSERT INTO public.dt_pickup_links
  (tenant_id, delivery_order_id, pickup_order_id, sequence_no,
   pickup_finished_at, pickup_driver_name)
SELECT
  d.tenant_id,
  d.id                                AS delivery_order_id,
  d.linked_order_id                   AS pickup_order_id,
  1                                   AS sequence_no,
  d.linked_pickup_finished_at,
  d.linked_pickup_driver_name
FROM public.dt_orders d
WHERE d.order_type = 'pickup_and_delivery'
  AND d.linked_order_id IS NOT NULL
ON CONFLICT (delivery_order_id, pickup_order_id) DO NOTHING;
```

## 5. Identifier scheme

| Scenario | Pickup ids | Delivery id |
|----------|-----------|-------------|
| Today (1 pickup) | `MRS-00046-FORTH-P` | `MRS-00046-FORTH-D` |
| Phase 1 (still 1 pickup, dual-write) | `MRS-00046-FORTH-P` (= `-P1`) | `MRS-00046-FORTH-D` |
| Phase 2 (N pickups, on create with 2 pickups) | `MRS-00046-FORTH-P1`, `MRS-00046-FORTH-P2` | `MRS-00046-FORTH-D` |
| Add-pickup later | New leg picks the next free `sequence_no` (`-P3`) | unchanged |

**Compatibility rule:** when there is exactly one pickup, the suffix is `-P` (no number). The `-P1` form is reserved for orders with 2+ pickups. This keeps every existing identifier stable through Phase 1 and only changes the format when multi-pickup is actually used.

**DT-side note:** DT treats each pickup as an independent service order with its own identifier. There is no DT-native "this pickup belongs to that delivery" link. The cross-reference is communicated via the description block ("PICK UP for Del MRS-00046-FORTH-D"). Multi-pickup just means more independent DT pushes that all reference the same delivery in their description.

## 6. Edge Function changes

### 6.1 `_shared/stamp-pickup-on-linked-delivery.ts`

Today the helper:
1. Looks up `pickup.linked_order_id` → `delivery`
2. Unconditionally stamps `linked_pickup_finished_at` + `linked_pickup_driver_name` on delivery
3. Stamps per-item `picked_up_at` via FK → code → blanket fallback (the 2026-05-29 fix)

Changes:
1. **Resolve via join table:** `SELECT delivery_order_id FROM dt_pickup_links WHERE pickup_order_id = $pickup.id` (fall back to `pickup.linked_order_id` for orders not yet backfilled — defensive, can be removed once backfill is verified).
2. **Per-pickup stamp:** UPDATE `dt_pickup_links` for THIS pickup with `pickup_finished_at = pickup.finished_at`, `pickup_driver_name = pickup.driver_name`.
3. **Delivery-level "all done" stamp:** only set `dt_orders.linked_pickup_finished_at` when EVERY row in `dt_pickup_links` for this delivery has a `pickup_finished_at`. Query:
   ```sql
   SELECT COUNT(*) FILTER (WHERE pickup_finished_at IS NULL) = 0
     AS all_done
   FROM public.dt_pickup_links
   WHERE delivery_order_id = $delivery.id;
   ```
   When true, stamp `linked_pickup_finished_at = MAX(pickup_finished_at)` and `linked_pickup_driver_name = NULL` (multiple drivers → ambiguous, leave NULL for the UI to render N drivers).
4. **Blanket pass:** the 2026-05-29 fix needs scoping. Today it stamps EVERY unstamped delivery item. With N pickups, we want it to stamp only the items attributable to THIS pickup. Plan:
   - If the delivery item has a `source_pickup_order_id` (new column, see §6.2) and it matches THIS pickup → blanket stamp it.
   - If the delivery item has `source_pickup_order_id = NULL` (from inventory / delivery ad-hoc) → leave alone; those items don't ride any pickup truck.
   - If the delivery item has `source_pickup_order_id` matching a DIFFERENT pickup → leave alone; not this leg's responsibility.
   - When `source_pickup_order_id` is NULL on a delivery item but the delivery only has ONE linked pickup → blanket stamp it (back-compat with single-pickup orders pre-Phase-2).

### 6.2 New column: `dt_order_items.source_pickup_order_id`

```sql
ALTER TABLE public.dt_order_items
  ADD COLUMN IF NOT EXISTS source_pickup_order_id uuid
  REFERENCES public.dt_orders(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.dt_order_items.source_pickup_order_id IS
  'When this row belongs to a multi-pickup delivery, points at the '
  'specific pickup dt_orders row this item rides on. NULL for: '
  'inventory items (already at warehouse), delivery-only ad-hoc, '
  'and single-pickup orders pre-Phase-2 (back-compat: helper falls '
  'back to the order''s sole linked pickup).';

CREATE INDEX IF NOT EXISTS idx_dt_order_items_source_pickup
  ON public.dt_order_items (source_pickup_order_id)
  WHERE source_pickup_order_id IS NOT NULL;
```

Set at item creation (`buildPDItemRows`) and on the add-pickup path. Never mutated afterwards.

### 6.3 `dt-push-order`

The `isPDDeliveryPrimary` / `isPDPickupPrimary` two-leg model needs to become **N-leg**:

1. **When primary is the delivery** (`order_type = 'pickup_and_delivery'`): SELECT all pickups via `dt_pickup_links WHERE delivery_order_id = $primary.id ORDER BY sequence_no`, push each in turn, then push the delivery.
2. **When primary is a pickup** (`order_type = 'pickup'`): SELECT the delivery via the join table (or fall back to `linked_order_id`), then SELECT all sibling pickups (`WHERE delivery_order_id = $delivery.id AND pickup_order_id != $primary.id`), push the delivery first, then sibling pickups, then the primary pickup.
3. **Cross-reference description block:** today each pickup's description carries "LINKED DELIVERY: MRS-…-D". This stays. For multi-pickup, the delivery's description carries "LINKED PICKUPS: MRS-…-P1 (Sarah's), MRS-…-P2 (Smith's)" — generated from `dt_pickup_links.sequence_no` + a short pickup-side label. Out of scope for Phase 1; address in Phase 3.
4. **Service-date / window fallback** (existing): currently `pickup.local_service_date = pickup.local_service_date || delivery.local_service_date`. Extend to per-pickup — each pickup row has its own service date in multi-pickup (different pickups could happen on different days en route).
5. **`changedFields` partial push** (used by `dt-sync-statuses` to push back items only after PU completion): when one pickup completes, only re-push that one pickup + the delivery, not the siblings. Today's code handles this naturally because the partial-push targets one EF invocation per leg — extend the "push back" caller to iterate.

### 6.4 `dt-sync-statuses`

The "pickup-leg completion → stamp linked delivery row" block (around line 924 of [supabase/functions/dt-sync-statuses/index.ts](supabase/functions/dt-sync-statuses/index.ts)) calls `stampPickupOnLinkedDelivery` with one `pickupOrderId`. No code change needed in this caller — the helper does the right thing internally now.

The **push-back** block (the `dt-push-order` invoke after a PU stamp): today it pushes ONLY the linked delivery so the manifest reflects the post-PU reality. With N pickups, we may also need to re-push sibling pickups whose item lists could have changed (Tier-B propagation). Keep current behavior in Phase 1 (delivery push-back only); revisit in Phase 3.

### 6.5 `notify-pickup-completed`

Webhook entry. Uses the same helper. No change needed.

### 6.6 `release-on-dt-finished.ts`

Reads `dt_order_items.delivered=true` to decide which items to release from inventory. Indifferent to pickup count. No change.

## 7. React changes

### 7.1 `CreateDeliveryOrderModal` (create-time)

**Phase 2 scope:** at create time, the modal stays single-pickup (existing UX). Multi-pickup is achieved post-create via the OrderPage button (§7.2).

**Phase 4 (later, deferred):** if create-time multi-pickup is wanted, add a repeating "Pickup #N" section. Not in this spec's first cut — Justin chose OrderPage button as the primary path.

### 7.2 New component: `AddPickupLegModal` (OrderPage)

Triggered by a new "Add Pickup" button on OrderPage when:
- `order.orderType === 'pickup_and_delivery'` OR `order.orderType === 'delivery'` (in which case clicking "Add Pickup" first converts to P+D, then adds the leg — re-uses the PR #431 convert branch)
- AND status is non-terminal (not delivered, not cancelled, not arrived)
- AND `dt_pickup_links` count for this delivery is < 9

Mini-modal contents:
- Pickup contact block (address, contact name, phone, email)
- Pickup time window (date, start time, end time)
- Pickup items (ad-hoc only — inventory always lives on the delivery leg)
- Pickup notes
- Pickup label (free-text, e.g. "Sarah's house" — shown in OrderPage badges + DT description)

On save:
1. Allocate next `sequence_no` (`SELECT MAX(sequence_no)+1`).
2. Build pickup `dt_identifier` = delivery's identifier with `-D` swapped to `-P${seq}` (or upgrade `-P` to `-P1` first when adding the 2nd pickup; needs UPDATE on the existing pickup's identifier — note: DT identifier rename is an unverified path, may need to re-create the DT row).
3. INSERT pickup `dt_orders` row.
4. INSERT `dt_pickup_links` row.
5. INSERT `dt_order_items` for the new pickup-only rows; mirror each onto the delivery as ad-hoc with `parent_pickup_item_id = new pickup item id` and `source_pickup_order_id = new pickup id`.
6. `dt-push-order` invoke with the delivery as primary → cascades to all pickups.

### 7.3 OrderPage changes

- **Linked-pickup banner** becomes **linked-pickups list** (one row per pickup, with per-pickup status badge: Pending / In Transit / Picked up @ HH:MM by Driver).
- **Items section:** group delivery items by `source_pickup_order_id` → render section headers ("From Sarah's house — pickup MRS-…-P1", "From Smith's — pickup MRS-…-P2", "From inventory"). Within a group, the existing per-item picked-up badges work unchanged.
- **Order-level "Pickups: 2 of 3 complete"** badge in the header.
- **`fetchDtOrderByIdFromSupabase(linkedOrderId)`** changes to `fetchLinkedPickupsForDelivery(deliveryId)` which returns `Array<{ pickup, sequenceNo, finishedAt }>`. Single-query JOIN against `dt_pickup_links`.

### 7.4 `supabaseQueries.ts` / types

- `DtOrder.linkedOrderId: string | null` stays (back-compat, points at primary pickup).
- New `DtOrder.linkedPickups?: Array<DtPickupLink>` populated only when caller asks for the full list (avoids paying for the JOIN on every list view).
- New `DtOrderItem.sourcePickupOrderId: string | null`.

### 7.5 Convert-delivery-to-P+D branch ([CreateDeliveryOrderModal.tsx:3171](src/components/shared/CreateDeliveryOrderModal.tsx:3171))

Keep as the **"add first pickup"** path. After Phase 2 ships, clicking "Add Pickup" on a standalone delivery routes through this branch (which already exists, well-tested) for the first pickup, and through `AddPickupLegModal` for subsequent ones.

## 8. Phased rollout

### Phase 0 — Foundation (this spec PR)
- This document committed to `source`.
- No code change.

### Phase 1 — Dual-write schema, helper-only consumer
- Migration: create `dt_pickup_links`, add `source_pickup_order_id` to `dt_order_items`, backfill from existing `linked_order_id` rows.
- Update `stampPickupOnLinkedDelivery` to:
  - Read pickup→delivery via join table with `linked_order_id` fallback.
  - Per-pickup `pickup_finished_at` stamp on join row.
  - "All done" check before stamping delivery's `linked_pickup_finished_at`.
- Update item create paths (`buildPDItemRows`, modal save) to ALSO write `source_pickup_order_id` and INSERT a `dt_pickup_links` row alongside the existing `linked_order_id` writes. Behaviour identical to today (still single-pickup) but the new join row is present.
- No UI change yet.
- **Ship + verify on existing P+D pairs:** every new P+D create produces a `dt_pickup_links` row; every pickup completion stamps the join row AND the delivery's `linked_pickup_finished_at` (since there's only one pickup, "all done" is trivially true on first stamp — no behaviour change visible to users).

### Phase 2 — OrderPage Add Pickup
- `AddPickupLegModal` component.
- "Add Pickup" button on OrderPage (gated as in §7.2).
- `dt-push-order` rewrite of Section 4 to iterate over `dt_pickup_links`.
- OrderPage linked-pickups list (replaces single banner).
- OrderPage items section grouped by `source_pickup_order_id`.
- Identifier upgrade: when adding the 2nd pickup, rename existing `-P` → `-P1` on the pickup `dt_orders` row. **OPEN: verify DT-side identifier-rename behavior — DT add_order is upsert-by-identifier, so a rename creates a new DT order and orphans the old one.** Likely path: leave existing pickup at `-P` and use `-P2`, `-P3` for additions (sacrifices identifier ordering aesthetic for DT cleanliness).
- Per-pickup partial completion in `stampPickupOnLinkedDelivery` blanket pass: only blanket-stamp items whose `source_pickup_order_id` matches.

### Phase 3 — Polish
- Delivery description block: "LINKED PICKUPS: P1 (label), P2 (label), …".
- Push-back on PU completion: also re-push sibling pickups if Tier-B affected them.
- OrderPage "Add Pickup" affordance also on standalone deliveries (routes through PR #431 convert branch for the first pickup).
- List views (Orders page, dashboard): partial-pickup badge.

### Phase 4 — Optional, deferred
- Create-time multi-pickup in `CreateDeliveryOrderModal` if operator demand exists.
- Retire `dt_orders.linked_order_id` once every caller migrated to `dt_pickup_links`.

## 9. Migration plan / backfill

One migration file in Phase 1: `supabase/migrations/<ts>_dt_multi_pickup_schema.sql`

```sql
-- 1. dt_pickup_links table (CREATE TABLE + indexes + RLS + trigger)
-- 2. dt_order_items.source_pickup_order_id (ADD COLUMN + index)
-- 3. Backfill dt_pickup_links from existing linked_order_id pairs
-- 4. Backfill dt_order_items.source_pickup_order_id for items on
--    existing P+D pairs:
--      • Pickup-leg items: source_pickup_order_id = self order id
--      • Delivery-leg items WITH parent_pickup_item_id: copy pickup's order id
--      • Delivery-leg items WITHOUT parent_pickup_item_id: NULL
--        (back-compat — helper falls back to sole linked pickup)
-- 5. Idempotent assertions: every dt_pickup_links row has a matching
--    dt_orders pair; no orphan source_pickup_order_id references.
```

Idempotent on re-apply (uses `ON CONFLICT DO NOTHING` for backfill rows; `CREATE TABLE IF NOT EXISTS`; `ADD COLUMN IF NOT EXISTS`).

## 10. Test plan

### Phase 1 (dual-write, single-pickup observable behaviour unchanged)
- [ ] Migration applies cleanly against a snapshot of prod schema.
- [ ] Backfill produces exactly one `dt_pickup_links` row per P+D pair.
- [ ] Backfill produces correct `source_pickup_order_id` (pickup-self / matched-delivery / NULL).
- [ ] Create new P+D pair via existing modal → new `dt_pickup_links` row appears with `sequence_no=1`.
- [ ] Pickup completion (existing flow): join-row `pickup_finished_at` stamped; delivery `linked_pickup_finished_at` stamped same as today; per-item `picked_up_at` stamped same as today.
- [ ] Idempotency: re-running `dt-sync-statuses` on a completed pickup does not double-stamp join row or delivery.
- [ ] `linked_order_id` reads continue to return the (only) linked pickup — no regression in OrderPage banner.

### Phase 2 (multi-pickup observable)
- [ ] Add 2nd pickup to existing P+D order → new pickup row + new `dt_pickup_links` row + new pickup items mirrored to delivery with `source_pickup_order_id` populated.
- [ ] DT push from delivery → both pickup legs pushed + delivery pushed (3 total DT add_order calls in order).
- [ ] Pickup 1 completes: join row stamped, delivery shows "1 of 2 complete", `linked_pickup_finished_at` STILL NULL, delivery items attributable to pickup 1 have `picked_up_at` stamped, pickup 2 items still NULL.
- [ ] Pickup 2 completes: join row stamped, delivery shows "2 of 2 complete", `linked_pickup_finished_at` populated.
- [ ] Add 3rd pickup → sequence_no=3, identifier `-P3`.
- [ ] OrderPage renders items grouped by `source_pickup_order_id` with the right section labels.
- [ ] Add Pickup gated off on terminal-status deliveries.
- [ ] `dt_pickup_links_unique_pickup` constraint rejects a pickup being attached to two deliveries (regression guard).

### Phase 3
- Delivery DT description rendered with "LINKED PICKUPS: P1 (…), P2 (…)".
- Sibling-pickup push-back when PU completion changes Tier-B fields.

## 11. Risks + open questions

| # | Risk | Mitigation |
|---|------|------------|
| R1 | DT add_order identifier-rename behaviour unknown (`-P` → `-P1`). Could orphan a DT row. | Phase 2 starts new pickups at `-P2`, `-P3` and leaves the existing `-P`. Address rename in a separate experiment. |
| R2 | `stampPickupOnLinkedDelivery` "blanket pass" scoping change could regress the JAS-00096 fix for single-pickup orders. | Back-compat clause: when delivery has exactly one linked pickup AND item's `source_pickup_order_id IS NULL`, blanket-stamp anyway. |
| R3 | DT-side push order matters (3 calls in sequence). One pickup's push failing should not abort the others. | Continue current behavior: each `pushSingleOrder` is independent; failures recorded per-leg in `gs_sync_events`. |
| R4 | Operator removes a pickup leg (cancellation). | Out of scope for Phase 2. ON DELETE CASCADE handles the join row; the pickup `dt_orders` row's `review_status='cancelled'` is the existing path. UI affordance: Phase 3. |
| R5 | Billing: multi-pickup may justify per-pickup fees. | Out of scope — current `dt_orders.base_delivery_fee` + `accessorials_json` is on the delivery row only. Justin to confirm if per-pickup billing is needed. |
| R6 | Conversion: standalone delivery → P+D → multi-P+D — three discrete UX states with overlapping affordances. | Phase 2 keeps the existing PR #431 convert branch as-is for first-pickup; only subsequent pickups use the new mini-modal. Tested separately. |

### Open questions for Justin

1. **R5 (billing):** does Sarah's "two pickups + inventory + one delivery" deserve two pickup fees or one? Today's billing model has one delivery row.
2. **R1 (identifier):** acceptable to have `MRS-00046-FORTH-P` (the original) + `MRS-00046-FORTH-P2` (the 2nd) in DT, instead of renaming the first to `-P1`?
3. **Pickup labels:** is a free-text label per pickup sufficient ("Sarah's house"), or do we want to surface the pickup contact name from the row as the label?
4. **Per-pickup fee tracking:** do we need `dt_pickup_links.notes` or any pricing fields on the link table itself?

## 12. Files touched (estimate)

### Phase 1
- 1 new migration file
- `supabase/functions/_shared/stamp-pickup-on-linked-delivery.ts` (logic update)
- `src/components/shared/CreateDeliveryOrderModal.tsx` (dual-write `dt_pickup_links` on create)
- `src/lib/types.ts` (add `sourcePickupOrderId` to item type, `linkedPickups` array to order type — optional)
- `src/lib/supabaseQueries.ts` (deserialize new column)

### Phase 2
- `src/components/shared/AddPickupLegModal.tsx` (new)
- `src/pages/OrderPage.tsx` (Add Pickup button, linked-pickups list, item grouping)
- `supabase/functions/dt-push-order/index.ts` (N-leg loop rewrite of Section 4)
- `src/hooks/useDtOrder.ts` (or wherever the order is loaded — fetch `linkedPickups` array)
