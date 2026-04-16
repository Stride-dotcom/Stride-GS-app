-- Phase 2: Database Schema Updates

-- 2.1 Add new columns to tenant_preferences
ALTER TABLE public.tenant_preferences 
  ADD COLUMN IF NOT EXISTS receiving_charge_minimum DECIMAL(10,2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS auto_assembly_on_receiving BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS auto_repair_on_damage BOOLEAN DEFAULT false;

-- 2.2 Create task_custom_charges table for custom charges on tasks
CREATE TABLE IF NOT EXISTS public.task_custom_charges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  template_id UUID REFERENCES public.billing_charge_templates(id),
  description TEXT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  charge_type VARCHAR(50),
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Add RLS policies for task_custom_charges
ALTER TABLE public.task_custom_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their tenant's custom charges"
  ON public.task_custom_charges FOR SELECT
  USING (tenant_id = user_tenant_id());

CREATE POLICY "Users can create custom charges"
  ON public.task_custom_charges FOR INSERT
  WITH CHECK (tenant_id = user_tenant_id());

CREATE POLICY "Users can update their tenant's custom charges"
  ON public.task_custom_charges FOR UPDATE
  USING (tenant_id = user_tenant_id());

CREATE POLICY "Users can delete their tenant's custom charges"
  ON public.task_custom_charges FOR DELETE
  USING (tenant_id = user_tenant_id());

-- Add trigger for updated_at
CREATE TRIGGER update_task_custom_charges_updated_at
  BEFORE UPDATE ON public.task_custom_charges
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 2.3 Create user_preferences table for card order persistence
CREATE TABLE IF NOT EXISTS public.user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  preference_key VARCHAR(100) NOT NULL,
  preference_value JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, preference_key)
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own preferences"
  ON public.user_preferences FOR ALL
  USING (user_id = auth.uid());

-- Add trigger for updated_at
CREATE TRIGGER update_user_preferences_updated_at
  BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();