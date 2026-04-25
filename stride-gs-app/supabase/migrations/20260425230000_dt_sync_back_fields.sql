-- 20260425230000_dt_sync_back_fields.sql
--
-- Add columns needed to mirror the DispatchTrack export.xml response back into
-- our cache. The dt-sync-statuses Edge Function (rewritten in this session)
-- now calls /orders/api/export.xml per active order and lands the rich
-- per-stop payload here instead of the previous get_order_status code-only
-- pull.
--
-- Schema notes:
--   • dt_order_history, dt_order_photos, dt_order_notes already exist (see
--     20260411120000_dt_phase1a_schema.sql) so the timeline / signature /
--     driver-posted notes targets are already in place.
--   • dt_order_items.delivered_quantity already exists; we add the rest of
--     the per-item delivery state DT returns (delivered flag, item_note,
--     checked_quantity, location, return_codes).
--   • dt_orders gets a small set of new top-level columns for completion
--     metadata (driver, truck, start/finish, COD, service time actual).

------------------------------------------------------------------------------
-- dt_orders : completion metadata
------------------------------------------------------------------------------
ALTER TABLE public.dt_orders
  ADD COLUMN IF NOT EXISTS started_at                   timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at                  timestamptz,
  ADD COLUMN IF NOT EXISTS scheduled_at                 timestamptz,
  ADD COLUMN IF NOT EXISTS driver_id                    int,
  ADD COLUMN IF NOT EXISTS driver_name                  text,
  ADD COLUMN IF NOT EXISTS truck_id                     int,
  ADD COLUMN IF NOT EXISTS truck_name                   text,
  ADD COLUMN IF NOT EXISTS service_unit                 text,
  ADD COLUMN IF NOT EXISTS stop_number                  int,
  ADD COLUMN IF NOT EXISTS actual_service_time_minutes  int,
  ADD COLUMN IF NOT EXISTS payment_collected            boolean,
  ADD COLUMN IF NOT EXISTS payment_notes                text,
  ADD COLUMN IF NOT EXISTS cod_amount                   numeric,
  ADD COLUMN IF NOT EXISTS signature_captured_at        timestamptz,
  ADD COLUMN IF NOT EXISTS dt_status_code               text,             -- raw DT code (e.g. "DELIVERED"); useful when status_id can't resolve
  ADD COLUMN IF NOT EXISTS dt_export_payload            jsonb;            -- last raw export.xml parse, for debugging / future fields

-- Indexes that make the OrderPage filters useful
CREATE INDEX IF NOT EXISTS dt_orders_finished_at_idx ON public.dt_orders (finished_at) WHERE finished_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS dt_orders_driver_idx      ON public.dt_orders (driver_id)   WHERE driver_id   IS NOT NULL;

------------------------------------------------------------------------------
-- dt_order_items : per-item delivery state
------------------------------------------------------------------------------
ALTER TABLE public.dt_order_items
  ADD COLUMN IF NOT EXISTS delivered          boolean,
  ADD COLUMN IF NOT EXISTS item_note          text,
  ADD COLUMN IF NOT EXISTS checked_quantity   numeric,
  ADD COLUMN IF NOT EXISTS location           text,
  ADD COLUMN IF NOT EXISTS return_codes       jsonb,
  ADD COLUMN IF NOT EXISTS last_synced_at     timestamptz;

------------------------------------------------------------------------------
-- dt_order_history : add lat/lng captured per event
------------------------------------------------------------------------------
-- Idempotency for history+notes is handled in dt-sync-statuses by
-- replace-on-sync (delete rows tagged source='dt_export' for the order, then
-- re-insert) rather than via a unique index. That keeps the schema simple
-- when DT mutates a past event's text.
ALTER TABLE public.dt_order_history
  ADD COLUMN IF NOT EXISTS lat    numeric,
  ADD COLUMN IF NOT EXISTS lng    numeric,
  ADD COLUMN IF NOT EXISTS source text;

------------------------------------------------------------------------------
-- dt_order_notes : allow source='dt_export' for notes pulled from export.xml
------------------------------------------------------------------------------
-- The original CHECK only allowed 'dt_webhook','app','manual_import'. The
-- new sync function pulls existing DT-side notes via export.xml on each
-- run, which warrants its own source label so we can replace-on-sync
-- without touching webhook/app/manual rows.
ALTER TABLE public.dt_order_notes
  DROP CONSTRAINT IF EXISTS dt_order_notes_source_check;
ALTER TABLE public.dt_order_notes
  ADD  CONSTRAINT dt_order_notes_source_check
       CHECK (source IN ('dt_webhook','app','manual_import','dt_export'));
