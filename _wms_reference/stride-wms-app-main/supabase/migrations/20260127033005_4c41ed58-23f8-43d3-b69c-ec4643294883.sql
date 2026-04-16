-- Add 'items.read' permission to warehouse role if not already present
-- This allows warehouse users to view inventory items

-- Update warehouse role with basic read permissions using jsonb
UPDATE public.roles
SET permissions = 
  COALESCE(permissions, '[]'::jsonb) || 
  CASE WHEN NOT (COALESCE(permissions, '[]'::jsonb) ? 'items.read') THEN '["items.read"]'::jsonb ELSE '[]'::jsonb END
WHERE name ILIKE 'warehouse';

UPDATE public.roles
SET permissions = 
  COALESCE(permissions, '[]'::jsonb) || 
  CASE WHEN NOT (COALESCE(permissions, '[]'::jsonb) ? 'shipments.read') THEN '["shipments.read"]'::jsonb ELSE '[]'::jsonb END
WHERE name ILIKE 'warehouse';

UPDATE public.roles
SET permissions = 
  COALESCE(permissions, '[]'::jsonb) || 
  CASE WHEN NOT (COALESCE(permissions, '[]'::jsonb) ? 'tasks.read') THEN '["tasks.read"]'::jsonb ELSE '[]'::jsonb END
WHERE name ILIKE 'warehouse';

UPDATE public.roles
SET permissions = 
  COALESCE(permissions, '[]'::jsonb) || 
  CASE WHEN NOT (COALESCE(permissions, '[]'::jsonb) ? 'movements.read') THEN '["movements.read"]'::jsonb ELSE '[]'::jsonb END
WHERE name ILIKE 'warehouse';

UPDATE public.roles
SET permissions = 
  COALESCE(permissions, '[]'::jsonb) || 
  CASE WHEN NOT (COALESCE(permissions, '[]'::jsonb) ? 'items.move') THEN '["items.move"]'::jsonb ELSE '[]'::jsonb END
WHERE name ILIKE 'warehouse';