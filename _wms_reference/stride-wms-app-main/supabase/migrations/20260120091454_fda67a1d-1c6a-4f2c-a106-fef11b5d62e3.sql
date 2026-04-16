-- Create tenant_custom_fields table for Advanced tab
CREATE TABLE IF NOT EXISTS public.tenant_custom_fields (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text' CHECK (field_type IN ('text', 'number', 'date', 'boolean')),
  field_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Create partial unique index if not exists
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_custom_fields_unique_name 
ON public.tenant_custom_fields(tenant_id, field_name) 
WHERE deleted_at IS NULL;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_tenant_custom_fields_tenant_id ON public.tenant_custom_fields(tenant_id);

-- Enable RLS
ALTER TABLE public.tenant_custom_fields ENABLE ROW LEVEL SECURITY;

-- Drop and recreate RLS policies
DROP POLICY IF EXISTS "Users can view custom fields for their tenant" ON public.tenant_custom_fields;
DROP POLICY IF EXISTS "Users can insert custom fields for their tenant" ON public.tenant_custom_fields;
DROP POLICY IF EXISTS "Users can update custom fields for their tenant" ON public.tenant_custom_fields;
DROP POLICY IF EXISTS "Users can delete custom fields for their tenant" ON public.tenant_custom_fields;

CREATE POLICY "Users can view custom fields for their tenant"
ON public.tenant_custom_fields
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.tenant_id = tenant_custom_fields.tenant_id
    AND u.id = auth.uid()
  )
);

CREATE POLICY "Users can insert custom fields for their tenant"
ON public.tenant_custom_fields
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.tenant_id = tenant_custom_fields.tenant_id
    AND u.id = auth.uid()
  )
);

CREATE POLICY "Users can update custom fields for their tenant"
ON public.tenant_custom_fields
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.tenant_id = tenant_custom_fields.tenant_id
    AND u.id = auth.uid()
  )
);

CREATE POLICY "Users can delete custom fields for their tenant"
ON public.tenant_custom_fields
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.tenant_id = tenant_custom_fields.tenant_id
    AND u.id = auth.uid()
  )
);

-- Create updated_at trigger for tenant_custom_fields
DROP TRIGGER IF EXISTS update_tenant_custom_fields_updated_at ON public.tenant_custom_fields;
CREATE TRIGGER update_tenant_custom_fields_updated_at
BEFORE UPDATE ON public.tenant_custom_fields
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Update item_custom_field_values to add custom_field_id column (keeping field_key for backward compatibility)
ALTER TABLE public.item_custom_field_values 
ADD COLUMN IF NOT EXISTS custom_field_id UUID REFERENCES public.tenant_custom_fields(id) ON DELETE CASCADE;

-- Create index on custom_field_id
CREATE INDEX IF NOT EXISTS idx_item_custom_field_values_custom_field_id ON public.item_custom_field_values(custom_field_id);

-- Ensure RLS is enabled
ALTER TABLE public.item_custom_field_values ENABLE ROW LEVEL SECURITY;

-- Drop and recreate RLS policies for item_custom_field_values
DROP POLICY IF EXISTS "Users can view custom field values for their tenant items" ON public.item_custom_field_values;
DROP POLICY IF EXISTS "Users can insert custom field values for their tenant items" ON public.item_custom_field_values;
DROP POLICY IF EXISTS "Users can update custom field values for their tenant items" ON public.item_custom_field_values;
DROP POLICY IF EXISTS "Users can delete custom field values for their tenant items" ON public.item_custom_field_values;

CREATE POLICY "Users can view custom field values for their tenant items"
ON public.item_custom_field_values
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.items i
    JOIN public.users u ON u.tenant_id = i.tenant_id
    WHERE i.id = item_custom_field_values.item_id
    AND u.id = auth.uid()
  )
);

CREATE POLICY "Users can insert custom field values for their tenant items"
ON public.item_custom_field_values
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.items i
    JOIN public.users u ON u.tenant_id = i.tenant_id
    WHERE i.id = item_custom_field_values.item_id
    AND u.id = auth.uid()
  )
);

CREATE POLICY "Users can update custom field values for their tenant items"
ON public.item_custom_field_values
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.items i
    JOIN public.users u ON u.tenant_id = i.tenant_id
    WHERE i.id = item_custom_field_values.item_id
    AND u.id = auth.uid()
  )
);

CREATE POLICY "Users can delete custom field values for their tenant items"
ON public.item_custom_field_values
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.items i
    JOIN public.users u ON u.tenant_id = i.tenant_id
    WHERE i.id = item_custom_field_values.item_id
    AND u.id = auth.uid()
  )
);

-- Create updated_at trigger for item_custom_field_values
DROP TRIGGER IF EXISTS update_item_custom_field_values_updated_at ON public.item_custom_field_values;
CREATE TRIGGER update_item_custom_field_values_updated_at
BEFORE UPDATE ON public.item_custom_field_values
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();