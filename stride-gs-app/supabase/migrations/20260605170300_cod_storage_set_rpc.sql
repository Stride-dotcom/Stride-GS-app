-- ============================================================
-- COD Storage — Phase 2.2 / 2.3 write path: set_cod_storage RPC
--
-- public.inventory grants UPDATE to authenticated but has NO UPDATE
-- RLS policy (only service_role can write — browser writes go through
-- handlers). The COD flag is Supabase-only with no GAS handler, so we
-- expose a SECURITY DEFINER RPC (role-gated to admin/staff) that the
-- Inventory batch action + Item Detail toggle call via supabase.rpc.
-- Same shape as generate_storage_charges / mark_cod_storage_collected.
--
-- 2026-06-05 PST
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

  UPDATE public.inventory
     SET cod_storage            = p_enabled,
         cod_storage_start_date = CASE WHEN p_enabled THEN p_start_date ELSE NULL END,
         updated_at             = now()
   WHERE tenant_id = p_tenant_id
     AND item_id   = ANY (p_item_ids);

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION public.set_cod_storage(text, text[], boolean, date) IS
  'Phase 2: set/clear cod_storage + cod_storage_start_date on inventory items. Admin/staff gated SECURITY DEFINER (browser writes bypass the missing inventory UPDATE policy). cod_storage is Supabase-only — no sheet writethrough.';

GRANT EXECUTE ON FUNCTION public.set_cod_storage(text, text[], boolean, date)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
