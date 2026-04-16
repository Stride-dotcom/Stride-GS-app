-- =============================================================================
-- Migration: Create ui_ai_reviews table for AI-based screenshot UI review
-- =============================================================================

-- =============================================================================
-- 0. ENSURE HELPER FUNCTIONS EXIST (in case earlier migration not applied)
-- =============================================================================

-- Check if user has admin_dev system role
CREATE OR REPLACE FUNCTION public.user_is_admin_dev(p_user_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.roles r ON ur.role_id = r.id
    WHERE ur.user_id = p_user_id
      AND r.name = 'admin_dev'
      AND r.is_system = true
      AND ur.deleted_at IS NULL
      AND r.deleted_at IS NULL
  );
END;
$$;

-- Check if current user has admin_dev system role
CREATE OR REPLACE FUNCTION public.current_user_is_admin_dev()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.user_is_admin_dev(auth.uid());
END;
$$;

-- Grant execute permissions
GRANT EXECUTE ON FUNCTION public.user_is_admin_dev(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_is_admin_dev() TO authenticated;

-- =============================================================================
-- 1. CREATE THE UI_AI_REVIEWS TABLE
-- =============================================================================

-- Create the ui_ai_reviews table
CREATE TABLE IF NOT EXISTS ui_ai_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES qa_test_runs(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  summary TEXT,
  suggestions JSONB DEFAULT '[]'::jsonb,
  error TEXT,
  -- Metadata about the review request
  mode TEXT CHECK (mode IN ('all', 'failed')),
  screenshot_count INTEGER,
  model_used TEXT,
  tokens_used INTEGER
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_ui_ai_reviews_run_id ON ui_ai_reviews(run_id);
CREATE INDEX IF NOT EXISTS idx_ui_ai_reviews_tenant_id ON ui_ai_reviews(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ui_ai_reviews_created_at ON ui_ai_reviews(created_at DESC);

-- Enable RLS
ALTER TABLE ui_ai_reviews ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Only admin_dev users can access ui_ai_reviews
-- This is a gated feature, so we restrict access

-- Policy: Users with admin_dev role can select their tenant's reviews
CREATE POLICY "admin_dev_select_ui_ai_reviews"
ON ui_ai_reviews
FOR SELECT
TO authenticated
USING (
  tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  AND current_user_is_admin_dev()
);

-- Policy: Users with admin_dev role can insert reviews for their tenant
CREATE POLICY "admin_dev_insert_ui_ai_reviews"
ON ui_ai_reviews
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  AND current_user_is_admin_dev()
  AND created_by = auth.uid()
);

-- Policy: Users with admin_dev role can update their tenant's reviews
CREATE POLICY "admin_dev_update_ui_ai_reviews"
ON ui_ai_reviews
FOR UPDATE
TO authenticated
USING (
  tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  AND current_user_is_admin_dev()
)
WITH CHECK (
  tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid())
  AND current_user_is_admin_dev()
);

-- Policy: Service role can do anything (for Edge Functions)
CREATE POLICY "service_role_all_ui_ai_reviews"
ON ui_ai_reviews
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Add comment describing the table
COMMENT ON TABLE ui_ai_reviews IS 'Stores AI-generated UI review results from screenshot analysis. Gated feature requiring admin_dev role.';
COMMENT ON COLUMN ui_ai_reviews.suggestions IS 'JSONB array of suggestions: [{route, viewport, category, severity, description, recommendation}]';
COMMENT ON COLUMN ui_ai_reviews.mode IS 'Review mode: "all" for all pages, "failed" for failed pages only';
