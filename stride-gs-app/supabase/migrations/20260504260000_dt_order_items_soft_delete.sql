-- v2026-05-04: Soft-delete columns on dt_order_items so the DT→App
-- reconcile path in dt-sync-statuses can mark items removed in DT
-- without nuking the row + losing billing/audit history.
--
-- removed_at: when the row was marked removed (NULL for active rows).
-- removed_source: where the removal came from — 'dt_sync' for items
--                 the polling sync detected DT no longer has, plus
--                 future sources ('app_edit', etc.) as we extend.
--
-- Reads filter `removed_at IS NULL` to keep the active items list
-- clean. The columns stay around for audit + a future "show removed"
-- toggle.

ALTER TABLE public.dt_order_items
  ADD COLUMN IF NOT EXISTS removed_at     timestamptz,
  ADD COLUMN IF NOT EXISTS removed_source text;

-- Index supports the read-time filter cheaply on tables that grow
-- meaningfully past a few thousand rows. Partial because removed
-- rows are the minority and we only ever filter for NULL.
CREATE INDEX IF NOT EXISTS idx_dt_order_items_active
  ON public.dt_order_items (dt_order_id)
  WHERE removed_at IS NULL;
