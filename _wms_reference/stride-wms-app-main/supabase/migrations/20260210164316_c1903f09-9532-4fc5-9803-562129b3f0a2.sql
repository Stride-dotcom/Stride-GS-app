-- Add missing columns referenced by client portal pages

-- items.condition - used in ClientItems.tsx for condition display/filtering
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS condition text;

-- shipments.scheduled_date - used in ClientShipmentDetail.tsx 
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS scheduled_date timestamptz;

-- shipments.origin_name - used in ClientShipmentDetail.tsx
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS origin_name text;

-- shipments.destination_name - used in ClientShipmentDetail.tsx
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS destination_name text;

-- shipments.total_items - used in ClientShipmentDetail.tsx
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS total_items integer;

-- items.current_location - used in ClientItems.tsx for location display
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS current_location text;

-- items.photos - used in ClientItems.tsx
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS photos jsonb;