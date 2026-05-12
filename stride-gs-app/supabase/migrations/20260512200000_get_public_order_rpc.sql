-- v2026-05-12 — Public order view (no login required).
--
-- Anonymous public-form submitters get an order-confirmation email with a
-- "View your order" button. Pre-this migration that link went to the
-- normal /orders/:id route which sits behind the React auth wall — the
-- recipient had no account, so the button bounced them to login with no
-- way through. This RPC powers a new /p/order/:id public route that
-- renders a read-only summary keyed on (order_id, contact_email).
--
-- Security:
--   * SECURITY DEFINER — bypasses dt_orders RLS so anon role can read.
--   * Two-factor: caller must supply BOTH the order's UUID (in the email
--     link) AND the contact_email it was sent to. UUID alone isn't enough
--     to enumerate (122 bits of entropy + email check). Email-only isn't
--     enough either (no listing).
--   * Returns ONLY public-safe fields. Internal_notes, driver_notes,
--     pricing_notes, push_error, etc. are excluded — operator-only.
--   * Function is callable by anon + authenticated; no other privileges.

CREATE OR REPLACE FUNCTION public.get_public_order(
  p_order_id   uuid,
  p_email      text
)
RETURNS TABLE (
  id                      uuid,
  dt_identifier           text,
  source                  text,
  review_status           text,
  review_notes            text,
  order_type              text,
  is_pickup               boolean,
  local_service_date      date,
  window_start_local      text,
  window_end_local        text,
  timezone                text,
  contact_name            text,
  contact_company         text,
  contact_address         text,
  contact_city            text,
  contact_state           text,
  contact_zip             text,
  contact_phone           text,
  contact_email           text,
  pickup_address_json     jsonb,
  details                 text,
  base_delivery_fee       numeric,
  extra_items_count       integer,
  extra_items_fee         numeric,
  accessorials_total      numeric,
  fabric_protection_total numeric,
  tax_amount              numeric,
  tax_rate_pct            numeric,
  coverage_charge         numeric,
  order_total             numeric,
  payment_collected       boolean,
  paid_at                 timestamptz,
  paid_amount             numeric,
  created_at              timestamptz,
  scheduled_at            timestamptz,
  started_at              timestamptz,
  finished_at             timestamptz,
  dt_status_code          text,
  driver_name             text,
  truck_name              text
)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT
    o.id, o.dt_identifier, o.source, o.review_status, o.review_notes,
    o.order_type, o.is_pickup,
    o.local_service_date, o.window_start_local, o.window_end_local, o.timezone,
    o.contact_name, o.contact_company,
    o.contact_address, o.contact_city, o.contact_state, o.contact_zip,
    o.contact_phone, o.contact_email,
    o.pickup_address_json, o.details,
    o.base_delivery_fee, o.extra_items_count, o.extra_items_fee,
    o.accessorials_total, o.fabric_protection_total,
    o.tax_amount, o.tax_rate_pct, o.coverage_charge, o.order_total,
    o.payment_collected, o.paid_at, o.paid_amount,
    o.created_at, o.scheduled_at, o.started_at, o.finished_at,
    o.dt_status_code, o.driver_name, o.truck_name
  FROM public.dt_orders o
  WHERE o.id = p_order_id
    AND lower(trim(o.contact_email)) = lower(trim(p_email))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_public_order(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_order(uuid, text) TO anon, authenticated;

COMMENT ON FUNCTION public.get_public_order(uuid, text) IS
'Public order lookup for /p/order/:id route. Two-factor: requires the order UUID AND the matching contact_email. Returns only public-safe fields.';
