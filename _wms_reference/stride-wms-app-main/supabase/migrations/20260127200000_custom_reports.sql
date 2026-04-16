-- Custom Reports Builder Tables
-- Allows users to create, save, and run custom reports

-- Create custom_reports table
CREATE TABLE IF NOT EXISTS public.custom_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  -- Report metadata
  name TEXT NOT NULL,
  description TEXT,
  data_source TEXT NOT NULL, -- 'items', 'billing_events', 'tasks', 'shipments', 'claims', 'invoices'

  -- Report configuration stored as JSONB
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- config structure:
  -- {
  --   "columns": [{"id": "...", "label": "...", "visible": true, "format": "currency|date|number|text"}],
  --   "filters": [{"column": "...", "operator": "eq|ne|gt|lt|gte|lte|contains|in|between", "value": ...}],
  --   "groupBy": "column_name" | null,
  --   "orderBy": [{"column": "...", "direction": "asc|desc"}],
  --   "summaries": [{"column": "...", "aggregation": "sum|count|avg|min|max", "label": "..."}],
  --   "chartType": "bar|pie|line" | null,
  --   "chartConfig": {...}
  -- }

  -- Sharing options
  is_shared BOOLEAN DEFAULT false,
  is_template BOOLEAN DEFAULT false, -- System templates that can be cloned

  -- Audit
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  -- Soft delete
  deleted_at TIMESTAMPTZ
);

-- Create report_executions table for audit/history
CREATE TABLE IF NOT EXISTS public.report_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  report_id UUID REFERENCES public.custom_reports(id) ON DELETE SET NULL,

  -- Execution details
  report_name TEXT NOT NULL, -- Snapshot of name at execution time
  data_source TEXT NOT NULL,
  filters_applied JSONB,

  -- Results
  row_count INTEGER,
  execution_time_ms INTEGER,

  -- Who/when
  executed_by UUID REFERENCES auth.users(id),
  executed_at TIMESTAMPTZ DEFAULT now()
);

-- Create user_report_favorites for quick access
CREATE TABLE IF NOT EXISTS public.user_report_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  report_id UUID NOT NULL REFERENCES public.custom_reports(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(user_id, report_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_custom_reports_tenant ON public.custom_reports(tenant_id);
CREATE INDEX IF NOT EXISTS idx_custom_reports_created_by ON public.custom_reports(created_by);
CREATE INDEX IF NOT EXISTS idx_custom_reports_data_source ON public.custom_reports(data_source);
CREATE INDEX IF NOT EXISTS idx_custom_reports_shared ON public.custom_reports(is_shared) WHERE is_shared = true;
CREATE INDEX IF NOT EXISTS idx_custom_reports_template ON public.custom_reports(is_template) WHERE is_template = true;

CREATE INDEX IF NOT EXISTS idx_report_executions_tenant ON public.report_executions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_report_executions_report ON public.report_executions(report_id);
CREATE INDEX IF NOT EXISTS idx_report_executions_user ON public.report_executions(executed_by);
CREATE INDEX IF NOT EXISTS idx_report_executions_date ON public.report_executions(executed_at);

CREATE INDEX IF NOT EXISTS idx_user_report_favorites_user ON public.user_report_favorites(user_id);

-- Enable RLS
ALTER TABLE public.custom_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_report_favorites ENABLE ROW LEVEL SECURITY;

-- RLS Policies for custom_reports
DROP POLICY IF EXISTS "Users can view reports in their tenant" ON public.custom_reports;
CREATE POLICY "Users can view reports in their tenant"
  ON public.custom_reports FOR SELECT
  TO authenticated
  USING (
    tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
    OR is_template = true
  );

DROP POLICY IF EXISTS "Users can create reports in their tenant" ON public.custom_reports;
CREATE POLICY "Users can create reports in their tenant"
  ON public.custom_reports FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can update their own reports" ON public.custom_reports;
CREATE POLICY "Users can update their own reports"
  ON public.custom_reports FOR UPDATE
  TO authenticated
  USING (
    tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
    AND (created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('tenant_admin', 'super_admin')
    ))
  );

DROP POLICY IF EXISTS "Users can delete their own reports" ON public.custom_reports;
CREATE POLICY "Users can delete their own reports"
  ON public.custom_reports FOR DELETE
  TO authenticated
  USING (
    tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
    AND (created_by = auth.uid() OR EXISTS (
      SELECT 1 FROM public.users WHERE id = auth.uid() AND role IN ('tenant_admin', 'super_admin')
    ))
  );

-- RLS Policies for report_executions
DROP POLICY IF EXISTS "Users can view executions in their tenant" ON public.report_executions;
CREATE POLICY "Users can view executions in their tenant"
  ON public.report_executions FOR SELECT
  TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can create executions in their tenant" ON public.report_executions;
CREATE POLICY "Users can create executions in their tenant"
  ON public.report_executions FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

-- RLS Policies for user_report_favorites
DROP POLICY IF EXISTS "Users can manage their own favorites" ON public.user_report_favorites;
CREATE POLICY "Users can manage their own favorites"
  ON public.user_report_favorites FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Updated_at trigger
DROP TRIGGER IF EXISTS set_custom_reports_updated_at ON public.custom_reports;
CREATE TRIGGER set_custom_reports_updated_at
  BEFORE UPDATE ON public.custom_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Comments
COMMENT ON TABLE public.custom_reports IS 'User-created custom report definitions with configuration';
COMMENT ON TABLE public.report_executions IS 'Audit log of report executions for history and performance tracking';
COMMENT ON TABLE public.user_report_favorites IS 'User bookmarks for quick access to frequently used reports';
COMMENT ON COLUMN public.custom_reports.config IS 'JSONB configuration for columns, filters, sorting, grouping, and charts';
