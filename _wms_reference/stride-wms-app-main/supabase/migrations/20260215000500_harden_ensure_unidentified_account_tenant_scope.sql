-- =============================================================================
-- Security hardening: ensure_unidentified_account tenant authorization
-- -----------------------------------------------------------------------------
-- Prevent cross-tenant access when called by authenticated users by deriving
-- tenant scope from session context and rejecting mismatched tenant overrides.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ensure_unidentified_account(
  p_tenant_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_tenant_id uuid;
  v_tenant_id uuid;
  v_account_id uuid;
  v_account_code text;
  v_attempt integer := 0;
BEGIN
  v_caller_tenant_id := public.user_tenant_id();

  -- Authenticated callers are always scoped to their session tenant.
  IF v_caller_tenant_id IS NOT NULL THEN
    IF p_tenant_id IS NOT NULL AND p_tenant_id IS DISTINCT FROM v_caller_tenant_id THEN
      RAISE EXCEPTION 'TENANT_MISMATCH: Caller tenant does not match p_tenant_id'
        USING ERRCODE = '42501';
    END IF;
    v_tenant_id := v_caller_tenant_id;
  ELSE
    -- Non-session contexts (e.g. privileged migration execution) must pass tenant.
    v_tenant_id := p_tenant_id;
  END IF;

  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Could not resolve tenant_id for ensure_unidentified_account';
  END IF;

  -- Preferred lookup: explicit system account marker.
  SELECT a.id
  INTO v_account_id
  FROM public.accounts a
  WHERE a.tenant_id = v_tenant_id
    AND a.is_system_account = true
    AND upper(a.account_name) = 'UNIDENTIFIED SHIPMENT'
    AND a.deleted_at IS NULL
  ORDER BY a.created_at
  LIMIT 1;

  IF v_account_id IS NOT NULL THEN
    RETURN v_account_id;
  END IF;

  -- Backward-safe lookup: an existing row by name.
  SELECT a.id
  INTO v_account_id
  FROM public.accounts a
  WHERE a.tenant_id = v_tenant_id
    AND upper(a.account_name) = 'UNIDENTIFIED SHIPMENT'
    AND a.deleted_at IS NULL
  ORDER BY a.created_at
  LIMIT 1;

  IF v_account_id IS NOT NULL THEN
    UPDATE public.accounts
    SET is_system_account = true,
        updated_at = now()
    WHERE id = v_account_id;
    RETURN v_account_id;
  END IF;

  -- Create a deterministic-but-unique account code.
  v_account_code := 'UNID-' || upper(substr(replace(v_tenant_id::text, '-', ''), 1, 8));
  LOOP
    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.accounts a
      WHERE a.account_code = v_account_code
    );

    v_attempt := v_attempt + 1;
    v_account_code := 'UNID-' || upper(substr(replace(v_tenant_id::text, '-', ''), 1, 8))
      || '-' || lpad(v_attempt::text, 2, '0');

    IF v_attempt > 50 THEN
      RAISE EXCEPTION 'Unable to generate unique account_code for UNIDENTIFIED SHIPMENT';
    END IF;
  END LOOP;

  INSERT INTO public.accounts (
    tenant_id,
    account_code,
    account_name,
    status,
    is_active,
    is_system_account,
    notes
  )
  VALUES (
    v_tenant_id,
    v_account_code,
    'UNIDENTIFIED SHIPMENT',
    'active',
    true,
    true,
    'System fallback account for unidentified inbound shipments.'
  )
  RETURNING id INTO v_account_id;

  RETURN v_account_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_unidentified_account(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_unidentified_account(uuid) TO authenticated;
