-- Add missing columns to task_custom_charges
ALTER TABLE public.task_custom_charges 
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.billing_charge_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS charge_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- Update column names to match interface (use charge_name as description, charge_amount as amount)
-- No rename needed, just ensure we use correct columns

-- Create trigger for updated_at on task_custom_charges
CREATE OR REPLACE FUNCTION public.update_task_custom_charges_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_task_custom_charges_updated_at ON public.task_custom_charges;
CREATE TRIGGER update_task_custom_charges_updated_at
  BEFORE UPDATE ON public.task_custom_charges
  FOR EACH ROW
  EXECUTE FUNCTION public.update_task_custom_charges_updated_at();