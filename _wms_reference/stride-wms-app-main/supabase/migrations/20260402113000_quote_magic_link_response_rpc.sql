-- Secure public quote response endpoint for magic-link acceptance/decline.
-- This avoids relying on anon UPDATE rights against the quotes table.

CREATE OR REPLACE FUNCTION public.respond_to_quote_magic_link(
  p_magic_link_token UUID,
  p_response TEXT,
  p_decline_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote public.quotes%ROWTYPE;
  v_status public.quote_status;
BEGIN
  IF p_response NOT IN ('accepted', 'declined') THEN
    RAISE EXCEPTION 'Unsupported quote response';
  END IF;

  SELECT *
  INTO v_quote
  FROM public.quotes
  WHERE magic_link_token = p_magic_link_token
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote not found or link has expired';
  END IF;

  IF v_quote.expiration_date IS NOT NULL AND v_quote.expiration_date < CURRENT_DATE THEN
    RAISE EXCEPTION 'This quote has expired';
  END IF;

  IF v_quote.status = 'void' THEN
    RAISE EXCEPTION 'This quote has been voided';
  END IF;

  IF v_quote.status IN ('accepted', 'declined') THEN
    RETURN jsonb_build_object(
      'quote_id', v_quote.id,
      'status', v_quote.status,
      'already_processed', true
    );
  END IF;

  IF v_quote.status <> 'sent' THEN
    RAISE EXCEPTION 'Quote is not in a sent state';
  END IF;

  IF p_response = 'accepted' THEN
    v_status := 'accepted';

    UPDATE public.quotes
    SET
      status = 'accepted',
      accepted_at = now(),
      updated_at = now()
    WHERE id = v_quote.id;

    INSERT INTO public.quote_events (
      tenant_id,
      quote_id,
      event_type,
      payload_json
    ) VALUES (
      v_quote.tenant_id,
      v_quote.id,
      'accepted',
      '{}'::jsonb
    );
  ELSE
    IF COALESCE(trim(p_decline_reason), '') = '' THEN
      RAISE EXCEPTION 'Decline reason is required';
    END IF;

    v_status := 'declined';

    UPDATE public.quotes
    SET
      status = 'declined',
      decline_reason = p_decline_reason,
      declined_at = now(),
      updated_at = now()
    WHERE id = v_quote.id;

    INSERT INTO public.quote_events (
      tenant_id,
      quote_id,
      event_type,
      payload_json
    ) VALUES (
      v_quote.tenant_id,
      v_quote.id,
      'declined',
      jsonb_build_object('reason', p_decline_reason)
    );
  END IF;

  RETURN jsonb_build_object(
    'quote_id', v_quote.id,
    'status', v_status,
    'already_processed', false
  );
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_quote_magic_link(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.respond_to_quote_magic_link(UUID, TEXT, TEXT) TO anon, authenticated;
