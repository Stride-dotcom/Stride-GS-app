-- Allow unauthenticated repair-quote token flows (tech/client portals)
-- to append unified notes by validating the magic token server-side.
CREATE OR REPLACE FUNCTION public.create_unified_note_from_repair_quote_token(
  p_token text,
  p_note_text text,
  p_source text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_note_id uuid;
  v_note_text text;
  v_note_type text;
  v_token record;
BEGIN
  v_note_text := btrim(coalesce(p_note_text, ''));
  IF v_note_text = '' THEN
    RAISE EXCEPTION 'Note text is required';
  END IF;

  SELECT
    id,
    tenant_id,
    repair_quote_id,
    token_type,
    expires_at,
    used_at
  INTO v_token
  FROM public.repair_quote_tokens
  WHERE token = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid token';
  END IF;

  IF v_token.expires_at < now() THEN
    RAISE EXCEPTION 'Token expired';
  END IF;

  IF v_token.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'Token already used';
  END IF;

  IF v_token.token_type NOT IN ('tech_quote', 'client_review') THEN
    RAISE EXCEPTION 'Token type not permitted for notes';
  END IF;

  v_note_type :=
    CASE
      WHEN v_token.token_type = 'client_review' THEN 'public'
      ELSE 'internal'
    END;

  INSERT INTO public.notes (
    tenant_id,
    note,
    note_type,
    source_entity_type,
    source_entity_id,
    source_entity_number,
    metadata,
    created_by
  ) VALUES (
    v_token.tenant_id,
    v_note_text,
    v_note_type,
    'repair_quote',
    v_token.repair_quote_id,
    NULL,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'source', coalesce(nullif(p_source, ''), 'repair_quote_token'),
      'repair_quote_token_id', v_token.id,
      'repair_quote_token_type', v_token.token_type
    ),
    NULL
  )
  RETURNING id INTO v_note_id;

  RETURN v_note_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_unified_note_from_repair_quote_token(text, text, text, jsonb) TO anon, authenticated;
