-- Secure quote magic-link reads through a definer RPC and
-- remove the broad anon SELECT policy on the quotes table.

DROP POLICY IF EXISTS "Public can view quotes by magic link" ON public.quotes;

CREATE OR REPLACE FUNCTION public.get_quote_by_magic_link(
  p_magic_link_token UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_quote public.quotes%ROWTYPE;
BEGIN
  SELECT *
  INTO v_quote
  FROM public.quotes
  WHERE magic_link_token = p_magic_link_token
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote not found or link has expired';
  END IF;

  RETURN jsonb_build_object(
    'id', v_quote.id,
    'tenant_id', v_quote.tenant_id,
    'account_id', v_quote.account_id,
    'quote_number', v_quote.quote_number,
    'status', v_quote.status,
    'currency', v_quote.currency,
    'expiration_date', v_quote.expiration_date,
    'storage_days', v_quote.storage_days,
    'notes', v_quote.notes,
    'decline_reason', v_quote.decline_reason,
    'created_at', v_quote.created_at,
    'subtotal_before_discounts', v_quote.subtotal_before_discounts,
    'subtotal_after_discounts', v_quote.subtotal_after_discounts,
    'tax_amount', v_quote.tax_amount,
    'tax_rate_percent', v_quote.tax_rate_percent,
    'grand_total', v_quote.grand_total,
    'account', (
      SELECT jsonb_build_object(
        'account_name', a.account_name,
        'primary_contact_email', a.primary_contact_email
      )
      FROM public.accounts a
      WHERE a.id = v_quote.account_id
    ),
    'tenant', (
      SELECT jsonb_build_object(
        'name', t.name,
        'logo_url', t.logo_url
      )
      FROM public.tenants t
      WHERE t.id = v_quote.tenant_id
    ),
    'quote_class_lines', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', qcl.id,
          'quote_id', qcl.quote_id,
          'class_id', qcl.class_id,
          'qty', qcl.qty,
          'quote_class', jsonb_build_object(
            'name', c.name,
            'description', c.description
          )
        )
        ORDER BY qcl.created_at, qcl.id
      )
      FROM public.quote_class_lines qcl
      LEFT JOIN public.classes c ON c.id = qcl.class_id
      WHERE qcl.quote_id = v_quote.id
    ), '[]'::jsonb),
    'quote_selected_services', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', qss.id,
          'quote_id', qss.quote_id,
          'service_id', qss.service_id,
          'is_selected', qss.is_selected,
          'hours_input', qss.hours_input,
          'computed_billable_qty', qss.computed_billable_qty,
          'applied_rate_amount', qss.applied_rate_amount,
          'line_total', qss.line_total,
          'quote_service', jsonb_build_object(
            'charge_name', ct.charge_name,
            'category', ct.category,
            'input_mode', ct.input_mode
          )
        )
        ORDER BY qss.created_at, qss.id
      )
      FROM public.quote_selected_services qss
      LEFT JOIN public.charge_types ct ON ct.id = qss.service_id
      WHERE qss.quote_id = v_quote.id
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_quote_by_magic_link(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_quote_by_magic_link(UUID) TO anon, authenticated;
