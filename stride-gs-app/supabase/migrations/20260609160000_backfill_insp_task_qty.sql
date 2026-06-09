-- Backfill: open INSPECTION tasks default qty to the inventory item's true
-- piece count.
--
-- complete_task_atomic bills COALESCE(tasks.qty, 1) × rate (migration
-- 20260521210100). tasks.qty defaulted to 1 and was never populated from
-- inventory at task creation, so an inspection task for a carton holding N
-- pieces (inventory.qty = N) still billed "Inspection × 1 @ rate". The
-- task-creation paths now set qty from inventory.qty for INSP
-- (batch-create-tasks-sb, complete-shipment-sb buildTaskRow). This one-time
-- backfill fixes already-OPEN INSP tasks so the NEXT completion bills the
-- correct quantity, matching the GAS fix in StrideAPI.gs v38.271.0.
--
-- Scope guards (all required — this touches money-adjacent data):
--   * INSP only (type IN 'INSP'/'Inspection') — every other task type is
--     deliberately 1-per-ID; only inspection is per-piece.
--   * Open tasks only — never re-touch a task whose billing already landed
--     (a Completed/Cancelled task's ledger row is immutable here).
--   * Only rows still at qty=1 AND whose inventory qty > 1 — so any staff edit
--     to a value OTHER than 1 is never clobbered, and single-piece items (the
--     overwhelming majority) are a no-op. The one edge this does NOT preserve
--     is a DELIBERATE qty=1 on a multi-piece carton (inspector found 1 good
--     piece of N); that's indistinguishable from the un-populated default, so
--     it gets reset to the inventory count and the inspector re-adjusts on the
--     Billing Preview before completion. Acceptable: open tasks only, and the
--     "found fewer" case is rare vs. the systemic under-bill being fixed.
--
-- No schema change (data-only UPDATE); no parity_dryrun mirror impact; no
-- change to the v38.182 atomic invoice counter or any billing handler.

UPDATE public.tasks t
   SET qty = GREATEST(1, round(i.qty)::int),
       updated_at = now()
  FROM public.inventory i
 WHERE t.tenant_id = i.tenant_id
   AND t.item_id   = i.item_id
   AND upper(t.type) IN ('INSP', 'INSPECTION')
   AND t.status NOT IN ('Completed', 'Cancelled')
   AND t.qty = 1
   AND round(COALESCE(i.qty, 1))::int > 1;
