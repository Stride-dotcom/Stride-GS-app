-- Ensure Disposal task type exists for all tenants
-- This fixes the issue where Disposal might be missing from the task types dropdown

DO $$
DECLARE
  tenant_record RECORD;
BEGIN
  -- Loop through all tenants
  FOR tenant_record IN SELECT DISTINCT tenant_id FROM public.task_types LOOP
    -- Check if Disposal task type exists for this tenant
    IF NOT EXISTS (
      SELECT 1 FROM public.task_types
      WHERE tenant_id = tenant_record.tenant_id
      AND name = 'Disposal'
    ) THEN
      -- Insert Disposal task type
      INSERT INTO public.task_types (
        tenant_id,
        name,
        description,
        is_system,
        is_active,
        color,
        icon,
        sort_order
      ) VALUES (
        tenant_record.tenant_id,
        'Disposal',
        'Item disposal and removal',
        true,
        true,
        '#ef4444',
        'Trash2',
        5
      );
    ELSE
      -- Ensure it's active if it exists
      UPDATE public.task_types
      SET is_active = true
      WHERE tenant_id = tenant_record.tenant_id
      AND name = 'Disposal'
      AND is_active = false;
    END IF;
  END LOOP;
END $$;