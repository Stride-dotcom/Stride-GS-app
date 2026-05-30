-- 20260530000000_dt_pickup_links_leg_fee.sql
--
-- Multi-pickup Phase 1.5 — per-leg fee snapshot on dt_pickup_links.
--
-- Phase 1 (PR #577) shipped multi-pickup links but left billing flat:
-- a 3-pickup delivery cost the same as a 1-pickup because adding a
-- pickup leg via AddPickupLegModal did NOT increment the parent
-- delivery's base_delivery_fee or order_total. This migration adds
-- the column needed to record each leg's fee snapshot so the modal
-- can display a per-leg breakdown and adds an integrity check.
--
-- The new pickup_leg_fee column captures the pickup zone's baseRate
-- at the time the leg was added so historical rates don't drift if
-- delivery_zones is re-priced later. Display + parent-delivery total
-- update happens in the React layer (AddPickupLegModal + OrderPage).
--
-- Behavior-neutral on existing rows: the column is NULL for legs
-- created before this migration. The primary pickup (sort_order=0)
-- never had its fee broken out — that portion is already baked into
-- the delivery row's base_delivery_fee from the original P+D save
-- in CreateDeliveryOrderModal. UI falls back accordingly.

ALTER TABLE public.dt_pickup_links
  ADD COLUMN IF NOT EXISTS pickup_leg_fee numeric(10,2);

COMMENT ON COLUMN public.dt_pickup_links.pickup_leg_fee IS
  'Per-leg pickup fee snapshot in USD captured from the pickup zone''s '
  'baseRate at the time the leg was added via AddPickupLegModal. NULL '
  'for legs created before 2026-05-30 — the primary pickup (sort_order=0) '
  'leg''s fee was historically rolled into the delivery row''s '
  'base_delivery_fee column instead. The display layer falls back to '
  'computing from dt_orders.contact_zip → delivery_zones when this is NULL.';
