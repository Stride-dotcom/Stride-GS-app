-- dt_orders bill-to columns — public service-request form parity with the
-- authenticated CreateDeliveryOrderModal.
--
-- The public form now collects a Bill-To contact distinct from the on-site
-- pickup / delivery contact (which lives in contact_* columns). This is the
-- billable party — invoiced separately from whoever is physically at the
-- pickup or delivery address. Staff reviews on the queue and links to a
-- client_id when promoting from pending_review.
--
-- These columns are nullable (existing dt_orders rows pre-date the public
-- form's bill-to flow and won't have them). The anon INSERT policy from
-- 20260426220000_dt_orders_public_form_anon_insert.sql is unchanged — it
-- still locks down source / review_status / tenant_id / created_by_user but
-- permits any other column to be set, so bill_to_* writes are allowed.

ALTER TABLE public.dt_orders
  ADD COLUMN IF NOT EXISTS bill_to_name    text,
  ADD COLUMN IF NOT EXISTS bill_to_company text,
  ADD COLUMN IF NOT EXISTS bill_to_email   text,
  ADD COLUMN IF NOT EXISTS bill_to_phone   text,
  ADD COLUMN IF NOT EXISTS bill_to_address text,
  ADD COLUMN IF NOT EXISTS bill_to_city    text,
  ADD COLUMN IF NOT EXISTS bill_to_state   text,
  ADD COLUMN IF NOT EXISTS bill_to_zip     text;

COMMENT ON COLUMN public.dt_orders.bill_to_name    IS 'Billable party name. Distinct from contact_name (on-site contact) — captured on the public form and on the authenticated modal when bill-to differs from pickup/delivery.';
COMMENT ON COLUMN public.dt_orders.bill_to_email   IS 'Billable party email — where the invoice is sent.';
COMMENT ON COLUMN public.dt_orders.bill_to_phone   IS 'Billable party phone.';
