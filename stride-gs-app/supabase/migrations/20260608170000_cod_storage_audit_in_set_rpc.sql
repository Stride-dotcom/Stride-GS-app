-- ============================================================
-- COD Storage — write the audit row INSIDE set_cod_storage
--
-- Bug: the batch "COD Storage" action (SetCodStorageModal) and the Item
-- Detail toggle (ItemCodStorageSection) both wrote the entity_audit_log
-- row CLIENT-SIDE. But the entity_audit_log INSERT RLS policy
-- ("Admin and staff insert audit logs") checks the TOP-LEVEL jwt 'role'
-- claim (always 'authenticated' for browser sessions) instead of
-- user_metadata.role — so every browser-side audit insert is rejected
-- and silently swallowed (the call is fire-and-forget with only a
-- console.warn). Result: COD set/remove never appeared in the Activity
-- tab. (Verified live: 0 rows with source='app' on entity_type='inventory'.)
--
-- Fix: write the audit row here, inside the SECURITY DEFINER RPC, which
-- runs as the function owner and bypasses RLS. This covers BOTH call
-- paths (batch modal + detail toggle) in one place and can't be skipped.
-- The actor is read from the caller's JWT (request.jwt.claims survives
-- SECURITY DEFINER); service_role calls fall back to 'system'.
--
-- Signature unchanged — the React setCodStorage() caller is untouched.
-- Only actually-updated rows are logged (UPDATE ... RETURNING feeds the
-- audit INSERT via CTE).
--
-- 2026-06-08 PST
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_cod_storage(
  p_tenant_id  text,
  p_item_ids   text[],
  p_enabled    boolean,
  p_start_date date DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_role  text;
  v_actor text;
  v_count integer;
BEGIN
  -- Admin/staff gate (service_role bypasses).
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSE
    v_role := LOWER(COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', ''));
    IF v_role NOT IN ('admin', 'staff') THEN
      RAISE EXCEPTION 'set_cod_storage requires admin/staff role (got %)', v_role
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_tenant_id IS NULL
     OR p_item_ids IS NULL
     OR array_length(p_item_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  -- Actor for the audit row. request.jwt.claims is still the CALLER's
  -- JWT inside a SECURITY DEFINER function. service_role / cron → 'system'.
  v_actor := COALESCE(
    NULLIF(auth.jwt() ->> 'email', ''),
    auth.jwt() -> 'user_metadata' ->> 'email',
    'system'
  );

  -- Update the flag + log one entity_audit_log row per actually-updated
  -- item, atomically. The audit INSERT runs as the definer so it is NOT
  -- subject to the browser-blocking INSERT RLS policy. performed_at
  -- defaults to now(); 'summary' drives the Activity-tab detail line.
  WITH upd AS (
    UPDATE public.inventory
       SET cod_storage            = p_enabled,
           cod_storage_start_date = CASE WHEN p_enabled THEN p_start_date ELSE NULL END,
           updated_at             = now()
     WHERE tenant_id = p_tenant_id
       AND item_id   = ANY (p_item_ids)
    RETURNING item_id
  ),
  audit AS (
    INSERT INTO public.entity_audit_log
      (entity_type, entity_id, tenant_id, action, changes, performed_by, source)
    SELECT
      'inventory',
      u.item_id,
      p_tenant_id,
      CASE WHEN p_enabled THEN 'cod_storage_set' ELSE 'cod_storage_removed' END,
      jsonb_build_object(
        'summary',
        CASE
          WHEN p_enabled AND p_start_date IS NOT NULL
            THEN 'End customer pays storage from ' || to_char(p_start_date, 'MM/DD/YYYY')
          WHEN p_enabled
            THEN 'End customer pays storage'
          ELSE 'COD storage removed (designer-paid)'
        END,
        'cod_storage', p_enabled,
        'cod_storage_start_date', CASE WHEN p_enabled THEN p_start_date ELSE NULL END
      ),
      v_actor,
      'app'
    FROM upd u
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;

  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.set_cod_storage(text, text[], boolean, date) IS
  'Phase 2: set/clear cod_storage + cod_storage_start_date on inventory items. Admin/staff gated SECURITY DEFINER (browser writes bypass the missing inventory UPDATE policy). cod_storage is Supabase-only — no sheet writethrough. Writes an entity_audit_log row per updated item (2026-06-08) so set/remove shows in the Activity tab — done here because the browser-side INSERT is blocked by the entity_audit_log RLS policy.';

GRANT EXECUTE ON FUNCTION public.set_cod_storage(text, text[], boolean, date)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
