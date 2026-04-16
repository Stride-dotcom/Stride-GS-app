-- =============================================================================
-- Patch existing Shipment Received communication templates to include Exceptions
-- =============================================================================
-- Adds [[exceptions_section_html]] after [[items_table_html]] for tenants that
-- still have templates missing the token. Safe, minimal append (no-op if already present).

DO $$
BEGIN
  UPDATE public.communication_templates ct
  SET body_template = regexp_replace(
    ct.body_template,
    E'\\[\\[items_table_html\\]\\]',
    E'[[items_table_html]]\n\n[[exceptions_section_html]]'
  )
  FROM public.communication_alerts ca
  WHERE ca.id = ct.alert_id
    AND ct.channel = 'email'
    AND ca.trigger_event IN ('shipment.received', 'shipment_received')
    AND ct.body_template LIKE '%[[items_table_html]]%'
    AND ct.body_template NOT LIKE '%[[exceptions_section_html]]%';
END $$;

