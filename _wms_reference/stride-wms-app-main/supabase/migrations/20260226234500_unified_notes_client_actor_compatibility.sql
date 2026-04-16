-- =============================================================================
-- Unified Notes - Client actor compatibility for create_unified_note
-- =============================================================================
-- Some authenticated client-portal users do not have a corresponding row in
-- public.users. The canonical notes table stores created_by as a FK to
-- public.users(id), so forcing created_by = auth.uid() can fail with FK errors.
--
-- This patch keeps staff behavior unchanged while allowing client-portal note
-- creation by setting created_by to NULL when the auth actor is not a staff user.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.create_unified_note(
  p_entity_type text,
  p_entity_id uuid,
  p_note_text text,
  p_note_type text DEFAULT 'internal',
  p_parent_note_id uuid DEFAULT NULL,
  p_source_entity_number text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_note_id uuid;
  v_tenant_id uuid;
  v_actor_id uuid;
  v_created_by uuid;
  v_metadata jsonb;
BEGIN
  v_actor_id := auth.uid();
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_tenant_id := public.user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Missing tenant context';
  END IF;

  SELECT u.id
  INTO v_created_by
  FROM public.users u
  WHERE u.id = v_actor_id
    AND u.tenant_id = v_tenant_id
    AND u.deleted_at IS NULL
  LIMIT 1;

  v_metadata := coalesce(p_metadata, '{}'::jsonb);
  IF v_created_by IS NULL AND public.is_client_user() THEN
    v_metadata := v_metadata || jsonb_build_object(
      'client_portal_auth_user_id', v_actor_id,
      'client_portal_note', true
    );
  END IF;

  INSERT INTO public.notes (
    tenant_id,
    note,
    note_type,
    parent_note_id,
    source_entity_type,
    source_entity_id,
    source_entity_number,
    metadata,
    created_by
  ) VALUES (
    v_tenant_id,
    p_note_text,
    public.normalize_unified_note_type(p_note_type),
    p_parent_note_id,
    p_entity_type,
    p_entity_id,
    p_source_entity_number,
    v_metadata,
    v_created_by
  )
  RETURNING id INTO v_note_id;

  IF p_parent_note_id IS NOT NULL THEN
    UPDATE public.notes
    SET updated_at = now()
    WHERE id = p_parent_note_id;
  END IF;

  RETURN v_note_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_unified_note(text, uuid, text, text, uuid, text, jsonb) TO authenticated;
