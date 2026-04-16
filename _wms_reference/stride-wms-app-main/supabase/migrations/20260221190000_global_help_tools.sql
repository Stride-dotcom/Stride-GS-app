-- =============================================================================
-- Global help tools (admin_dev managed, app-wide)
-- -----------------------------------------------------------------------------
-- Purpose:
--   - Replace tenant-scoped help content with a global help registry.
--   - Support both code-wired help tips and zero-code injected help tips.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.global_help_tools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_key text NOT NULL,
  field_key text NOT NULL,
  help_text text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  route_path text NULL,
  target_selector text NULL,
  source_type text NOT NULL DEFAULT 'native',
  icon_symbol text NOT NULL DEFAULT 'info',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  updated_by uuid NULL REFERENCES public.users(id) ON DELETE SET NULL,
  CONSTRAINT global_help_tools_unique_page_field UNIQUE (page_key, field_key),
  CONSTRAINT global_help_tools_source_type_chk CHECK (source_type IN ('native', 'label', 'injected')),
  CONSTRAINT global_help_tools_icon_symbol_chk CHECK (icon_symbol IN ('info'))
);

CREATE INDEX IF NOT EXISTS idx_global_help_tools_page
  ON public.global_help_tools (page_key);

CREATE INDEX IF NOT EXISTS idx_global_help_tools_active
  ON public.global_help_tools (is_active);

ALTER TABLE public.global_help_tools ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "global_help_tools_select_authenticated" ON public.global_help_tools;
CREATE POLICY "global_help_tools_select_authenticated"
  ON public.global_help_tools
  FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "global_help_tools_insert_admin_dev" ON public.global_help_tools;
CREATE POLICY "global_help_tools_insert_admin_dev"
  ON public.global_help_tools
  FOR INSERT
  WITH CHECK (public.current_user_is_admin_dev());

DROP POLICY IF EXISTS "global_help_tools_update_admin_dev" ON public.global_help_tools;
CREATE POLICY "global_help_tools_update_admin_dev"
  ON public.global_help_tools
  FOR UPDATE
  USING (public.current_user_is_admin_dev())
  WITH CHECK (public.current_user_is_admin_dev());

DROP POLICY IF EXISTS "global_help_tools_delete_admin_dev" ON public.global_help_tools;
CREATE POLICY "global_help_tools_delete_admin_dev"
  ON public.global_help_tools
  FOR DELETE
  USING (public.current_user_is_admin_dev());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.global_help_tools TO authenticated;

DROP TRIGGER IF EXISTS trg_global_help_tools_updated_at ON public.global_help_tools;
CREATE TRIGGER trg_global_help_tools_updated_at
  BEFORE UPDATE ON public.global_help_tools
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
