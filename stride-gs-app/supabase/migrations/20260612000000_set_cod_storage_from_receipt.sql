-- ============================================================
-- set_cod_storage_from_receipt() — batch-flag items COD with a per-item
-- start date of (receive_date + N days), so a client's free-storage period
-- is honored individually when items were received on different dates.
--
-- Companion to set_cod_storage() (which sets ONE date for all items). Same
-- admin/staff gate, same per-item entity_audit_log write (SECURITY DEFINER
-- bypasses the browser-blocking INSERT policy), same return = rows updated.
--
-- Per item: cod_storage_start_date = receive_date::date + p_days. inventory
-- .receive_date is TEXT (ISO 'YYYY-MM-DD' or blank); blank → CURRENT_DATE so
-- a receipt-less item still gets a sane anchor (matches the React preview's
-- (receiveDate || today) + N). All non-blank values are ISO (verified), so
-- the ::date cast is safe.
--
-- 2026-06-12 PST
-- ============================================================

CREATE OR REPLACE FUNCTION public.set_cod_storage_from_receipt(
  p_tenant_id text,
  p_item_ids  text[],
  p_days      integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role  text;
  v_actor text;
  v_count integer;
  v_days  integer := GREATEST(COALESCE(p_days, 0), 0);
BEGIN
  -- Admin/staff gate (service_role bypasses).
  IF auth.role() = 'service_role' THEN
    NULL;
  ELSE
    v_role := LOWER(COALESCE(auth.jwt() -> 'user_metadata' ->> 'role', ''));
    IF v_role NOT IN ('admin', 'staff') THEN
      RAISE EXCEPTION 'set_cod_storage_from_receipt requires admin/staff role (got %)', v_role
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF p_tenant_id IS NULL
     OR p_item_ids IS NULL
     OR array_length(p_item_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  v_actor := COALESCE(
    NULLIF(auth.jwt() ->> 'email', ''),
    auth.jwt() -> 'user_metadata' ->> 'email',
    'system'
  );

  WITH upd AS (
    UPDATE public.inventory
       SET cod_storage            = true,
           cod_storage_start_date =
             (COALESCE(NULLIF(receive_date, ''), to_char(CURRENT_DATE, 'YYYY-MM-DD'))::date
              + make_interval(days => v_days))::date,
           updated_at             = now()
     WHERE tenant_id = p_tenant_id
       AND item_id   = ANY (p_item_ids)
    RETURNING item_id, cod_storage_start_date
  ),
  audit AS (
    INSERT INTO public.entity_audit_log
      (entity_type, entity_id, tenant_id, action, changes, performed_by, source)
    SELECT
      'inventory',
      u.item_id,
      p_tenant_id,
      'cod_storage_set',
      jsonb_build_object(
        'summary',
        'End customer pays storage from ' || to_char(u.cod_storage_start_date, 'MM/DD/YYYY')
          || ' (' || v_days || ' days after receipt)',
        'cod_storage', true,
        'cod_storage_start_date', u.cod_storage_start_date
      ),
      v_actor,
      'app'
    FROM upd u
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;

  RETURN v_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.set_cod_storage_from_receipt(text, text[], integer) TO authenticated, service_role;
