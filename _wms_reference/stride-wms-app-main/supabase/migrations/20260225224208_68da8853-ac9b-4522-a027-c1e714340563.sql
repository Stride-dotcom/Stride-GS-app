-- ============================================================================
-- 1. Create shipment_notes table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.shipment_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.tenants(id),
  note text NOT NULL,
  note_type text NOT NULL DEFAULT 'internal',
  visibility text DEFAULT 'internal',
  parent_note_id uuid REFERENCES public.shipment_notes(id),
  exception_code text,
  is_chip_generated boolean DEFAULT false,
  version integer DEFAULT 1,
  is_current boolean DEFAULT true,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_shipment_notes_shipment_id ON public.shipment_notes(shipment_id);
CREATE INDEX IF NOT EXISTS idx_shipment_notes_tenant_id ON public.shipment_notes(tenant_id);

ALTER TABLE public.shipment_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read shipment notes for their tenant"
  ON public.shipment_notes FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can insert shipment notes for their tenant"
  ON public.shipment_notes FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

CREATE POLICY "Users can update shipment notes for their tenant"
  ON public.shipment_notes FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

-- ============================================================================
-- 2. Create rpc_admin_list_platform_alert_templates
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_admin_list_platform_alert_templates(
  p_search text DEFAULT NULL
)
RETURNS SETOF public.alert_templates
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  RETURN QUERY
    SELECT *
    FROM public.alert_templates
    WHERE deleted_at IS NULL
      AND (
        p_search IS NULL
        OR template_name ILIKE '%' || p_search || '%'
        OR template_description ILIKE '%' || p_search || '%'
      )
    ORDER BY created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_list_platform_alert_templates(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_platform_alert_templates(text) TO authenticated;

-- ============================================================================
-- 3. Create rpc_admin_list_platform_wrapper_versions (also referenced)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.rpc_admin_list_platform_wrapper_versions()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;
  RETURN '[]'::jsonb;
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_list_platform_wrapper_versions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_list_platform_wrapper_versions() TO authenticated;