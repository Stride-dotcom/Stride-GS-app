-- Custom Reports tables for the Report Builder feature

-- Create custom_reports table
CREATE TABLE IF NOT EXISTS public.custom_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  data_source TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  is_shared BOOLEAN NOT NULL DEFAULT false,
  is_template BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Create report_executions table for logging
CREATE TABLE IF NOT EXISTS public.report_executions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  report_id UUID REFERENCES public.custom_reports(id) ON DELETE SET NULL,
  report_name TEXT NOT NULL,
  data_source TEXT NOT NULL,
  filters_applied JSONB,
  row_count INTEGER,
  execution_time_ms INTEGER,
  executed_by UUID REFERENCES public.users(id),
  executed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.custom_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.report_executions ENABLE ROW LEVEL SECURITY;

-- RLS Policies for custom_reports
CREATE POLICY "Users can view reports in their tenant"
  ON public.custom_reports FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can create reports in their tenant"
  ON public.custom_reports FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can update reports in their tenant"
  ON public.custom_reports FOR UPDATE
  USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can delete reports in their tenant"
  ON public.custom_reports FOR DELETE
  USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

-- RLS Policies for report_executions
CREATE POLICY "Users can view executions in their tenant"
  ON public.report_executions FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Users can log executions in their tenant"
  ON public.report_executions FOR INSERT
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_custom_reports_tenant ON public.custom_reports(tenant_id);
CREATE INDEX IF NOT EXISTS idx_custom_reports_created_by ON public.custom_reports(created_by);
CREATE INDEX IF NOT EXISTS idx_report_executions_tenant ON public.report_executions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_report_executions_report ON public.report_executions(report_id);

-- Add updated_at trigger
CREATE TRIGGER update_custom_reports_updated_at
  BEFORE UPDATE ON public.custom_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();