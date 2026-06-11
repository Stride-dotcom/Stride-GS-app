-- Backfill: open RUSH tasks default qty to the inventory item's true piece
-- count.
--
-- complete_task_atomic now bills GREATEST(1, COALESCE(tasks.qty, 1)) × rate for
-- RUSH as well as INSP (migration 20260610120100). tasks.qty defaulted to 1 and
-- was never populated from inventory for RUSH tasks created before this change,
-- so a rush inspection of a carton holding N pieces (inventory.qty = N) would
-- still bill "Rush × 1 @ rate" on the SB completion path. The task-creation
-- paths now seed qty from inventory.qty for RUSH (batch-create-tasks-sb,
-- complete-shipment-sb buildTaskRow). This one-time backfill fixes
-- already-OPEN RUSH tasks so the NEXT completion bills the correct quantity,
-- matching the GAS fix in StrideAPI.gs v38.272.0 (which reads inventory qty
-- directly and is unaffected by this gap).
--
-- Scope guards (all required — this touches money-adjacent data):
--   * RUSH only (type IN 'RUSH'/'Rush') — every other task type stays
--     1-per-ID; only inspection/rush are per-piece.
--   * Open tasks only — never re-touch a task whose billing already landed
--     (a Completed/Cancelled task's ledger row is immutable here).
--   * Only rows still at qty=1 AND whose inventory qty > 1 — so any staff edit
--     to a value OTHER than 1 is never clobbered, and single-piece items (the
--     overwhelming majority) are a no-op. The one edge this does NOT preserve
--     is a DELIBERATE qty=1 on a multi-piece carton; that's indistinguishable
--     from the un-populated default, so it gets reset to the inventory count
--     and staff re-adjusts on the Billing Preview before completion.
--     Acceptable: open tasks only, and the "found fewer" case is rare vs. the
--     systemic under-bill being fixed.
--
-- No schema change (data-only UPDATE); no parity_dryrun mirror impact; no
-- change to the v38.182 atomic invoice counter or any billing handler.

UPDATE public.tasks t
   SET qty = GREATEST(1, round(i.qty)::int),
       updated_at = now()
  FROM public.inventory i
 WHERE t.tenant_id = i.tenant_id
   AND t.item_id   = i.item_id
   AND upper(t.type) = 'RUSH'
   AND t.status NOT IN ('Completed', 'Cancelled')
   AND t.qty = 1
   AND round(COALESCE(i.qty, 1))::int > 1;
