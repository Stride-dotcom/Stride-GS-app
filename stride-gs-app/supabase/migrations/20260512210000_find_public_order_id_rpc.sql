-- v2026-05-12 — Companion RPC to get_public_order for the public lookup
-- page (/p/orders/lookup). Customers who lost their email link can paste
-- the order reference from their confirmation screen (which displays the
-- human-readable dt_identifier like "REQ-mp2wxo4g-x4mu", NOT the row's
-- UUID) along with the email they submitted with. This function resolves
-- either form to the underlying UUID so the lookup page can then
-- redirect into the existing /p/order/<uuid>?email=… viewer.
--
-- Two-factor remains intact: caller must supply BOTH the reference AND
-- the matching contact_email. Returns NULL when the pair doesn't match
-- so the page can show a generic "not found" — never reveal whether the
-- reference exists in isolation.
--
-- SECURITY DEFINER bypasses dt_orders RLS the same way get_public_order
-- does. The function returns ONLY the UUID — no row payload — so an
-- enumeration attack would learn the UUID only on a successful (ref +
-- email) hit, and UUID-only access still goes through get_public_order's
-- own email check before any payload leaks.

CREATE OR REPLACE FUNCTION public.find_public_order_id(
  p_ref    text,
  p_email  text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_ref   text := trim(p_ref);
  v_email text := lower(trim(p_email));
  v_uuid  uuid;
  v_id    uuid;
BEGIN
  IF v_ref IS NULL OR v_ref = '' OR v_email IS NULL OR v_email = '' THEN
    RETURN NULL;
  END IF;

  -- 1. Try UUID interpretation. If the reference parses as a UUID,
  --    look it up directly. Catches users who paste the URL UUID.
  BEGIN
    v_uuid := v_ref::uuid;
    SELECT id INTO v_id
    FROM public.dt_orders
    WHERE id = v_uuid
      AND lower(trim(contact_email)) = v_email
    LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  EXCEPTION WHEN invalid_text_representation THEN
    -- Not a UUID — fall through to dt_identifier lookup.
    NULL;
  END;

  -- 2. dt_identifier lookup, case-insensitive — matches the reference
  --    shown on the email confirmation screen (REQ-…/ALL-…/HYR-… etc.).
  SELECT id INTO v_id
  FROM public.dt_orders
  WHERE upper(trim(dt_identifier)) = upper(v_ref)
    AND lower(trim(contact_email)) = v_email
  LIMIT 1;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.find_public_order_id(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_public_order_id(text, text) TO anon, authenticated;

COMMENT ON FUNCTION public.find_public_order_id(text, text) IS
'Public lookup helper. Resolves (reference, email) → order UUID for the /p/orders/lookup page. Reference accepts UUID or dt_identifier. Two-factor: requires both inputs to match. Returns NULL otherwise.';
