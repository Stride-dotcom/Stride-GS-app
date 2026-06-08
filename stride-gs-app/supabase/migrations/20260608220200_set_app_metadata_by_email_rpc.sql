-- ============================================================================
-- set_app_metadata_by_email — service-role stamp for the locked authZ claims.
--
-- Keeps app_metadata (read by public.custom_access_token_hook) in sync with the
-- AUTHORITATIVE source — the CB "Users" sheet, resolved by GAS lookupUser_ /
-- handleGetUserByEmail_ (which handles the staff special-cases the cb_users
-- mirror gets wrong). GAS calls this best-effort after resolving a user at
-- login / create / update, so role + tenant changes propagate into the locked
-- bag without the client (which can't be trusted) being involved.
--
-- service_role ONLY: a logged-in user cannot call this to self-stamp.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.set_app_metadata_by_email(
  p_email           text,
  p_role            text,
  p_client_sheet_id text,
  p_accessible      jsonb DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'set_app_metadata_by_email is service_role only' USING ERRCODE = '42501';
  END IF;
  IF NULLIF(TRIM(COALESCE(p_email,'')), '') IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE auth.users
     SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb)
       || jsonb_strip_nulls(jsonb_build_object(
            'role',                     NULLIF(TRIM(COALESCE(p_role,'')), ''),
            'clientSheetId',            NULLIF(TRIM(COALESCE(p_client_sheet_id,'')), ''),
            'accessibleClientSheetIds', p_accessible))
   WHERE lower(email) = lower(TRIM(p_email));

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.set_app_metadata_by_email(text,text,text,jsonb) FROM anon, authenticated, public;
GRANT  EXECUTE ON FUNCTION public.set_app_metadata_by_email(text,text,text,jsonb) TO service_role;
