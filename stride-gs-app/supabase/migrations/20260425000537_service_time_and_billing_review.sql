-- Migration: service_time_and_billing_review
-- Adds delivery_minutes to item_classes, service_minutes + quote_required +
-- available_for_delivery to delivery_accessorials, and billing review columns
-- to dt_orders for the service time feature and delivery billing workflow.

-- 1. item_classes: delivery service time defaults
ALTER TABLE item_classes
  ADD COLUMN IF NOT EXISTS delivery_minutes integer NOT NULL DEFAULT 0;

UPDATE item_classes SET delivery_minutes = 3  WHERE id = 'XS';
UPDATE item_classes SET delivery_minutes = 5  WHERE id = 'S';
UPDATE item_classes SET delivery_minutes = 10 WHERE id = 'M';
UPDATE item_classes SET delivery_minutes = 20 WHERE id = 'L';
UPDATE item_classes SET delivery_minutes = 30 WHERE id = 'XL';
UPDATE item_classes SET delivery_minutes = 45 WHERE id = 'XXL';

-- 2. delivery_accessorials: service time, quote required, available for delivery
ALTER TABLE delivery_accessorials
  ADD COLUMN IF NOT EXISTS service_minutes integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS quote_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS available_for_delivery boolean NOT NULL DEFAULT true;

-- 3. dt_orders: billing review workflow + payment tracking
ALTER TABLE dt_orders
  ADD COLUMN IF NOT EXISTS billing_review_status text NOT NULL DEFAULT 'pending_review',
  ADD COLUMN IF NOT EXISTS paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS paid_amount numeric,
  ADD COLUMN IF NOT EXISTS paid_method text;

-- Index for billing review queries (filter by status, sort by date)
CREATE INDEX IF NOT EXISTS idx_dt_orders_billing_review
  ON dt_orders (billing_review_status, local_service_date DESC);
