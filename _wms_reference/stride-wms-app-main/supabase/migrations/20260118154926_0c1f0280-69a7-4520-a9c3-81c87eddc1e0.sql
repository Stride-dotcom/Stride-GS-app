-- Labor Settings table (tenant-level configuration)
CREATE TABLE public.labor_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL UNIQUE REFERENCES public.tenants(id) ON DELETE CASCADE,
    currency_code TEXT NOT NULL DEFAULT 'USD',
    overtime_multiplier NUMERIC(4,2) NOT NULL DEFAULT 1.5,
    standard_workweek_hours INTEGER NOT NULL DEFAULT 40,
    rounding_rule_minutes INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.labor_settings ENABLE ROW LEVEL SECURITY;

-- Admin-only policies for labor_settings
CREATE POLICY "Admin can view labor settings"
ON public.labor_settings FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.roles r ON ur.role_id = r.id
        JOIN public.users u ON ur.user_id = u.id
        WHERE u.id = auth.uid()
        AND u.tenant_id = labor_settings.tenant_id
        AND r.name IN ('admin', 'tenant_admin')
        AND ur.deleted_at IS NULL
    )
);

CREATE POLICY "Admin can insert labor settings"
ON public.labor_settings FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.roles r ON ur.role_id = r.id
        JOIN public.users u ON ur.user_id = u.id
        WHERE u.id = auth.uid()
        AND u.tenant_id = labor_settings.tenant_id
        AND r.name IN ('admin', 'tenant_admin')
        AND ur.deleted_at IS NULL
    )
);

CREATE POLICY "Admin can update labor settings"
ON public.labor_settings FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.roles r ON ur.role_id = r.id
        JOIN public.users u ON ur.user_id = u.id
        WHERE u.id = auth.uid()
        AND u.tenant_id = labor_settings.tenant_id
        AND r.name IN ('admin', 'tenant_admin')
        AND ur.deleted_at IS NULL
    )
);

-- Employee Pay table (separate from users for security)
CREATE TABLE public.employee_pay (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
    pay_type TEXT NOT NULL DEFAULT 'hourly' CHECK (pay_type IN ('hourly', 'salary')),
    pay_rate NUMERIC(12,2) NOT NULL DEFAULT 0,
    salary_hourly_equivalent NUMERIC(12,2),
    overtime_eligible BOOLEAN NOT NULL DEFAULT true,
    primary_warehouse_id UUID REFERENCES public.warehouses(id),
    cost_center TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.employee_pay ENABLE ROW LEVEL SECURITY;

-- Admin-only policies for employee_pay
CREATE POLICY "Admin can view employee pay"
ON public.employee_pay FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.roles r ON ur.role_id = r.id
        JOIN public.users u ON ur.user_id = u.id
        WHERE u.id = auth.uid()
        AND u.tenant_id = employee_pay.tenant_id
        AND r.name IN ('admin', 'tenant_admin')
        AND ur.deleted_at IS NULL
    )
);

CREATE POLICY "Admin can insert employee pay"
ON public.employee_pay FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.roles r ON ur.role_id = r.id
        JOIN public.users u ON ur.user_id = u.id
        WHERE u.id = auth.uid()
        AND u.tenant_id = employee_pay.tenant_id
        AND r.name IN ('admin', 'tenant_admin')
        AND ur.deleted_at IS NULL
    )
);

CREATE POLICY "Admin can update employee pay"
ON public.employee_pay FOR UPDATE
USING (
    EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.roles r ON ur.role_id = r.id
        JOIN public.users u ON ur.user_id = u.id
        WHERE u.id = auth.uid()
        AND u.tenant_id = employee_pay.tenant_id
        AND r.name IN ('admin', 'tenant_admin')
        AND ur.deleted_at IS NULL
    )
);

CREATE POLICY "Admin can delete employee pay"
ON public.employee_pay FOR DELETE
USING (
    EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.roles r ON ur.role_id = r.id
        JOIN public.users u ON ur.user_id = u.id
        WHERE u.id = auth.uid()
        AND u.tenant_id = employee_pay.tenant_id
        AND r.name IN ('admin', 'tenant_admin')
        AND ur.deleted_at IS NULL
    )
);

-- Admin Audit Log table
CREATE TABLE public.admin_audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    actor_id UUID NOT NULL REFERENCES public.users(id),
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    action TEXT NOT NULL,
    changes_json JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- Admin-only policy for admin_audit_log
CREATE POLICY "Admin can view audit log"
ON public.admin_audit_log FOR SELECT
USING (
    EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.roles r ON ur.role_id = r.id
        JOIN public.users u ON ur.user_id = u.id
        WHERE u.id = auth.uid()
        AND u.tenant_id = admin_audit_log.tenant_id
        AND r.name IN ('admin', 'tenant_admin')
        AND ur.deleted_at IS NULL
    )
);

CREATE POLICY "Admin can insert audit log"
ON public.admin_audit_log FOR INSERT
WITH CHECK (
    EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.roles r ON ur.role_id = r.id
        JOIN public.users u ON ur.user_id = u.id
        WHERE u.id = auth.uid()
        AND u.tenant_id = admin_audit_log.tenant_id
        AND r.name IN ('admin', 'tenant_admin')
        AND ur.deleted_at IS NULL
    )
);

-- Add task timing fields
ALTER TABLE public.tasks
ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS duration_minutes INTEGER,
ADD COLUMN IF NOT EXISTS started_by UUID REFERENCES public.users(id),
ADD COLUMN IF NOT EXISTS ended_by UUID REFERENCES public.users(id);

-- Create indexes for performance
CREATE INDEX idx_employee_pay_tenant ON public.employee_pay(tenant_id);
CREATE INDEX idx_employee_pay_user ON public.employee_pay(user_id);
CREATE INDEX idx_labor_settings_tenant ON public.labor_settings(tenant_id);
CREATE INDEX idx_admin_audit_log_tenant ON public.admin_audit_log(tenant_id);
CREATE INDEX idx_admin_audit_log_entity ON public.admin_audit_log(entity_type, entity_id);
CREATE INDEX idx_tasks_started_at ON public.tasks(started_at);
CREATE INDEX idx_tasks_ended_at ON public.tasks(ended_at);

-- Trigger for updating updated_at
CREATE TRIGGER update_labor_settings_updated_at
BEFORE UPDATE ON public.labor_settings
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_employee_pay_updated_at
BEFORE UPDATE ON public.employee_pay
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();