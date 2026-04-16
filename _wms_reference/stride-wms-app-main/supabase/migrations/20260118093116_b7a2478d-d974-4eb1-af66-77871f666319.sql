-- Create task_types table for configurable task types
CREATE TABLE IF NOT EXISTS public.task_types (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  name text NOT NULL,
  description text,
  is_system boolean DEFAULT false,
  is_active boolean DEFAULT true,
  color text DEFAULT '#6366f1',
  icon text DEFAULT 'clipboard',
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, name)
);

-- Create subtasks table
CREATE TABLE IF NOT EXISTS public.subtasks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  is_completed boolean DEFAULT false,
  completed_at timestamptz,
  completed_by uuid REFERENCES public.users(id),
  sort_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create due_date_rules table for configurable due date rules
CREATE TABLE IF NOT EXISTS public.due_date_rules (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  account_id uuid REFERENCES public.accounts(id),
  task_type text NOT NULL,
  days_from_creation integer NOT NULL DEFAULT 3,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(tenant_id, account_id, task_type)
);

-- Create billing_charge_templates table for reusable custom charge templates
CREATE TABLE IF NOT EXISTS public.billing_charge_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  name text NOT NULL,
  description text,
  amount numeric NOT NULL,
  charge_type text DEFAULT 'fixed',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  created_by uuid REFERENCES public.users(id)
);

-- Enable RLS on new tables
ALTER TABLE public.task_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subtasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.due_date_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_charge_templates ENABLE ROW LEVEL SECURITY;

-- RLS for task_types
CREATE POLICY "Users can view task types in their tenant"
  ON public.task_types FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can manage task types in their tenant"
  ON public.task_types FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- RLS for subtasks (access through parent task)
CREATE POLICY "Users can view subtasks for tasks in their tenant"
  ON public.subtasks FOR SELECT
  USING (task_id IN (
    SELECT id FROM tasks WHERE tenant_id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  ));

CREATE POLICY "Users can manage subtasks for tasks in their tenant"
  ON public.subtasks FOR ALL
  USING (task_id IN (
    SELECT id FROM tasks WHERE tenant_id IN (
      SELECT tenant_id FROM users WHERE id = auth.uid()
    )
  ));

-- RLS for due_date_rules
CREATE POLICY "Users can view due date rules in their tenant"
  ON public.due_date_rules FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can manage due date rules in their tenant"
  ON public.due_date_rules FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- RLS for billing_charge_templates
CREATE POLICY "Users can view billing templates in their tenant"
  ON public.billing_charge_templates FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can manage billing templates in their tenant"
  ON public.billing_charge_templates FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_task_types_tenant ON public.task_types(tenant_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_task ON public.subtasks(task_id);
CREATE INDEX IF NOT EXISTS idx_due_date_rules_tenant ON public.due_date_rules(tenant_id);
CREATE INDEX IF NOT EXISTS idx_due_date_rules_account ON public.due_date_rules(account_id);
CREATE INDEX IF NOT EXISTS idx_billing_charge_templates_tenant ON public.billing_charge_templates(tenant_id);

-- Add parent_task_id to tasks table for nested subtasks if needed
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES public.tasks(id);

-- Add task_type_id to tasks to link to task_types table (optional, keeps string for flexibility)
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS task_type_id uuid REFERENCES public.task_types(id);

-- Create index on tasks for parent_task_id
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON public.tasks(parent_task_id);