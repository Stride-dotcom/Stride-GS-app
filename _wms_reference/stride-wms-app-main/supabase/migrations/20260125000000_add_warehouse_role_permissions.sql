-- Add 'items.read' permission to warehouse role if not already present
-- This allows warehouse users to view inventory items

UPDATE public.roles
SET permissions =
  CASE
    WHEN permissions IS NULL THEN ARRAY['items.read']::text[]
    WHEN NOT (permissions @> ARRAY['items.read']::text[]) THEN permissions || ARRAY['items.read']::text[]
    ELSE permissions
  END
WHERE name ILIKE 'warehouse';

-- Also ensure warehouse role has other basic read permissions
UPDATE public.roles
SET permissions =
  CASE
    WHEN permissions IS NULL THEN ARRAY['items.read', 'shipments.read', 'tasks.read', 'movements.read']::text[]
    WHEN NOT (permissions @> ARRAY['shipments.read']::text[]) THEN permissions || ARRAY['shipments.read']::text[]
    ELSE permissions
  END
WHERE name ILIKE 'warehouse';

UPDATE public.roles
SET permissions =
  CASE
    WHEN NOT (permissions @> ARRAY['tasks.read']::text[]) THEN permissions || ARRAY['tasks.read']::text[]
    ELSE permissions
  END
WHERE name ILIKE 'warehouse';

UPDATE public.roles
SET permissions =
  CASE
    WHEN NOT (permissions @> ARRAY['movements.read']::text[]) THEN permissions || ARRAY['movements.read']::text[]
    ELSE permissions
  END
WHERE name ILIKE 'warehouse';

-- Add items.move permission for warehouse role (they often need to move items)
UPDATE public.roles
SET permissions =
  CASE
    WHEN NOT (permissions @> ARRAY['items.move']::text[]) THEN permissions || ARRAY['items.move']::text[]
    ELSE permissions
  END
WHERE name ILIKE 'warehouse';
