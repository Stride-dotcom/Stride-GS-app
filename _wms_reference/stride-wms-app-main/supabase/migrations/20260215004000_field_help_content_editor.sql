-- =============================================================================
-- Phase closeout: centralized field-help content table + seed data
-- -----------------------------------------------------------------------------
-- Adds tenant-scoped, editable help content keyed by:
--   - page_key
--   - field_key
-- Used by HelpTip runtime overrides and Settings editor.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.field_help_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  page_key text NOT NULL,
  field_key text NOT NULL,
  help_text text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT field_help_content_unique UNIQUE (tenant_id, page_key, field_key)
);

CREATE INDEX IF NOT EXISTS idx_field_help_content_tenant_page
  ON public.field_help_content (tenant_id, page_key);

CREATE INDEX IF NOT EXISTS idx_field_help_content_tenant_active
  ON public.field_help_content (tenant_id, is_active);

CREATE INDEX IF NOT EXISTS idx_field_help_content_search
  ON public.field_help_content (tenant_id, page_key, field_key);

ALTER TABLE public.field_help_content ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "field_help_content_select_tenant" ON public.field_help_content;
CREATE POLICY "field_help_content_select_tenant"
  ON public.field_help_content FOR SELECT
  USING (tenant_id = public.user_tenant_id());

DROP POLICY IF EXISTS "field_help_content_insert_admin_manager" ON public.field_help_content;
CREATE POLICY "field_help_content_insert_admin_manager"
  ON public.field_help_content FOR INSERT
  WITH CHECK (
    tenant_id = public.user_tenant_id()
    AND public.get_user_role(auth.uid()) IN ('admin', 'tenant_admin', 'manager')
  );

DROP POLICY IF EXISTS "field_help_content_update_admin_manager" ON public.field_help_content;
CREATE POLICY "field_help_content_update_admin_manager"
  ON public.field_help_content FOR UPDATE
  USING (
    tenant_id = public.user_tenant_id()
    AND public.get_user_role(auth.uid()) IN ('admin', 'tenant_admin', 'manager')
  )
  WITH CHECK (
    tenant_id = public.user_tenant_id()
    AND public.get_user_role(auth.uid()) IN ('admin', 'tenant_admin', 'manager')
  );

DROP POLICY IF EXISTS "field_help_content_delete_admin_manager" ON public.field_help_content;
CREATE POLICY "field_help_content_delete_admin_manager"
  ON public.field_help_content FOR DELETE
  USING (
    tenant_id = public.user_tenant_id()
    AND public.get_user_role(auth.uid()) IN ('admin', 'tenant_admin', 'manager')
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.field_help_content TO authenticated;

DROP TRIGGER IF EXISTS trg_field_help_content_updated_at ON public.field_help_content;
CREATE TRIGGER trg_field_help_content_updated_at
  BEFORE UPDATE ON public.field_help_content
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed baseline help text for receiving/incoming pages.
WITH seed(page_key, field_key, help_text) AS (
  VALUES
    ('receiving.stage1', 'signed_pieces', 'The number of pieces counted and signed for at the dock. Tap the number to type a value directly, or use +/- buttons.'),
    ('receiving.stage1', 'unit_breakdown', 'Break down signed pieces by packaging type. Does not need to sum to signed pieces.'),
    ('receiving.stage1', 'exceptions', 'Select any exceptions observed at the dock. Selecting ''No Exceptions'' clears all others. At least one selection required.'),
    ('receiving.stage2', 'received_pieces', 'Total number of pieces received at dock intake stage 2.'),
    ('incoming.list', 'filters_toolbar', 'Filter and search inbound shipments. Click a row to view details, allocate items, or manage references.'),
    ('incoming.manifest_detail', 'external_refs', 'BOL, PRO, tracking numbers, POs. Used for matching dock intakes to manifests and expected shipments.'),
    ('incoming.manifest_detail', 'manifest_items', 'Items on this manifest. Select items and click Allocate to assign them to an expected shipment.'),
    ('incoming.expected_detail', 'carrier_name', 'The shipping carrier or trucking company delivering this shipment.'),
    ('incoming.expected_detail', 'external_refs', 'BOL, PRO, tracking numbers, POs. These references are used to match dock intakes to this expected shipment.'),
    ('incoming.expected_detail', 'expected_items', 'Items expected in this shipment. Items may be created manually or through allocation from a manifest.')
)
INSERT INTO public.field_help_content (
  tenant_id,
  page_key,
  field_key,
  help_text,
  is_active
)
SELECT
  t.id,
  s.page_key,
  s.field_key,
  s.help_text,
  true
FROM public.tenants t
CROSS JOIN seed s
ON CONFLICT (tenant_id, page_key, field_key) DO NOTHING;
