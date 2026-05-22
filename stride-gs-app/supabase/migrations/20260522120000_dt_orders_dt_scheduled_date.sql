-- dt_orders.dt_scheduled_date
--
-- Capture DT's *scheduled* date (the date on which DT has routed the order)
-- separately from local_service_date (the date Stride/the customer requested).
--
-- Background: re-pushing an order to DT via add_order with our requested
-- local_service_date would overwrite the dispatcher's scheduled date and
-- kick the stop off its route. dt-sync-statuses now mirrors DT's
-- scheduled_at back into dt_orders.dt_scheduled_date so dt-push-order can
-- prefer that value over local_service_date on re-pushes, and so the UI
-- can show "Scheduled: M/D" alongside "Requested: M/D".
--
-- Idempotent — operator already applied this column to production via the
-- Supabase SQL editor on 2026-05-22 ahead of code merge. Repeated apply
-- via `supabase db push` should be a no-op.

ALTER TABLE public.dt_orders
  ADD COLUMN IF NOT EXISTS dt_scheduled_date date;

COMMENT ON COLUMN public.dt_orders.dt_scheduled_date IS
  'DT-side scheduled date pulled from export.xml scheduled_at by dt-sync-statuses. '
  'Distinct from local_service_date (the Stride-requested date). When non-null, '
  'dt-push-order uses this value for the <delivery_date> field on re-pushes so '
  'we never kick the stop off its DT-assigned route.';
