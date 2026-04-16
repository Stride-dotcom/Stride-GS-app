-- ============================================================
-- QA Artifacts Table
-- Stores references to UI Visual QA screenshots and other artifacts
-- ============================================================

-- Create qa_artifacts table
CREATE TABLE IF NOT EXISTS public.qa_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.qa_test_runs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  suite text NOT NULL DEFAULT 'ui_visual_qa',
  route text NOT NULL,
  viewport text NOT NULL,
  step_name text,
  storage_path text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_qa_artifacts_run_id ON public.qa_artifacts(run_id);
CREATE INDEX IF NOT EXISTS idx_qa_artifacts_tenant_id ON public.qa_artifacts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_qa_artifacts_route ON public.qa_artifacts(route);
CREATE INDEX IF NOT EXISTS idx_qa_artifacts_viewport ON public.qa_artifacts(viewport);

-- Enable RLS
ALTER TABLE public.qa_artifacts ENABLE ROW LEVEL SECURITY;

-- RLS policies (same tenant access)
CREATE POLICY "qa_artifacts_select_own_tenant" ON public.qa_artifacts
  FOR SELECT
  USING (tenant_id IN (
    SELECT tenant_id FROM public.users WHERE id = auth.uid()
  ));

CREATE POLICY "qa_artifacts_insert_own_tenant" ON public.qa_artifacts
  FOR INSERT
  WITH CHECK (tenant_id IN (
    SELECT tenant_id FROM public.users WHERE id = auth.uid()
  ));

-- Allow service role full access
CREATE POLICY "qa_artifacts_service_role" ON public.qa_artifacts
  FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');

-- ============================================================
-- Create qa-artifacts storage bucket
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'qa-artifacts',
  'qa-artifacts',
  false,
  52428800, -- 50MB
  ARRAY['image/png', 'image/jpeg', 'application/json']::text[]
)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for qa-artifacts bucket
CREATE POLICY "qa_artifacts_storage_select" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'qa-artifacts'
    AND (
      auth.jwt() ->> 'role' = 'service_role'
      OR EXISTS (
        SELECT 1 FROM public.qa_test_runs r
        JOIN public.users u ON u.tenant_id = r.tenant_id
        WHERE u.id = auth.uid()
        AND storage.objects.name LIKE 'ui/' || r.id::text || '/%'
      )
    )
  );

CREATE POLICY "qa_artifacts_storage_insert" ON storage.objects
  FOR INSERT
  WITH CHECK (
    bucket_id = 'qa-artifacts'
    AND auth.jwt() ->> 'role' = 'service_role'
  );

-- ============================================================
-- Helper function to get signed URL for artifact
-- ============================================================
CREATE OR REPLACE FUNCTION public.get_qa_artifact_signed_url(p_storage_path text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text;
BEGIN
  -- Generate a signed URL valid for 1 hour
  SELECT url INTO v_url
  FROM storage.create_signed_url('qa-artifacts', p_storage_path, 3600);

  RETURN v_url;
END;
$$;

-- Grant execute to authenticated users
GRANT EXECUTE ON FUNCTION public.get_qa_artifact_signed_url(text) TO authenticated;
