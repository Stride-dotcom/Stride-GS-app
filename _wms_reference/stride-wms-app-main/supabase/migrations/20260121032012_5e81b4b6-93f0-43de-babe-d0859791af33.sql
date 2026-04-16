-- Create app_issues table for error capture and diagnostics
CREATE TABLE public.app_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Environment & Version
  environment TEXT NOT NULL CHECK (environment IN ('dev', 'prod')),
  app_version TEXT,
  
  -- User Context
  user_id UUID,
  user_role TEXT CHECK (user_role IS NULL OR user_role IN ('admin', 'tenant_admin', 'manager', 'warehouse', 'client_user')),
  account_id UUID,
  tenant_id UUID REFERENCES public.tenants(id),
  
  -- Location Context
  route TEXT NOT NULL,
  component_name TEXT,
  action_context TEXT,
  
  -- Error Details
  level TEXT NOT NULL CHECK (level IN ('error', 'warning')),
  error_message TEXT NOT NULL,
  stack_trace TEXT,
  
  -- HTTP/API Context
  http_status INTEGER,
  supabase_error_code TEXT,
  request_summary JSONB,
  
  -- Classification
  severity TEXT NOT NULL CHECK (severity IN ('P0', 'P1', 'P2')) DEFAULT 'P2',
  fingerprint TEXT NOT NULL,
  
  -- Management
  status TEXT NOT NULL CHECK (status IN ('new', 'acknowledged', 'fixed', 'ignored')) DEFAULT 'new'
);

-- Indexes for performance
CREATE INDEX idx_app_issues_created_at ON public.app_issues(created_at DESC);
CREATE INDEX idx_app_issues_fingerprint ON public.app_issues(fingerprint);
CREATE INDEX idx_app_issues_route ON public.app_issues(route);
CREATE INDEX idx_app_issues_user_role ON public.app_issues(user_role);
CREATE INDEX idx_app_issues_status ON public.app_issues(status);
CREATE INDEX idx_app_issues_severity ON public.app_issues(severity);
CREATE INDEX idx_app_issues_level ON public.app_issues(level);
CREATE INDEX idx_app_issues_tenant ON public.app_issues(tenant_id);
CREATE INDEX idx_app_issues_environment ON public.app_issues(environment);

-- Enable RLS
ALTER TABLE public.app_issues ENABLE ROW LEVEL SECURITY;

-- Policy: Only admins can read app_issues
CREATE POLICY "Admins can read app_issues"
  ON public.app_issues FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
        AND r.name IN ('admin', 'tenant_admin')
        AND ur.deleted_at IS NULL
        AND r.deleted_at IS NULL
    )
  );

-- Policy: Only admins can update app_issues (for status changes)
CREATE POLICY "Admins can update app_issues"
  ON public.app_issues FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
        AND r.name IN ('admin', 'tenant_admin')
        AND ur.deleted_at IS NULL
        AND r.deleted_at IS NULL
    )
  );

-- Note: INSERT is handled by edge function with service role key (bypasses RLS)