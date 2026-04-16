-- Recreate v_items_with_location with backward-compatible aliases expected by the UI
DROP VIEW IF EXISTS public.v_items_with_location;

CREATE VIEW public.v_items_with_location
WITH (security_invoker = true)
AS
SELECT 
    i.id,
    i.tenant_id,
    i.warehouse_id,
    i.item_code,
    i.client_account,
    i.vendor,
    i.description,
    i.quantity,
    i.sidemark,
    i.status,
    i.size,
    i.size_unit,

    -- Locations
    i.current_location_id,
    i.current_location_id AS location_id,

    -- Some UI code expects account_id; items currently stores client_account instead
    NULL::uuid AS account_id,

    i.received_at,
    i.metadata,
    i.room,
    i.primary_photo_url,
    i.created_at,
    i.updated_at,
    i.deleted_at,

    l.code AS location_code,
    l.name AS location_name,
    l.type AS location_type,

    w.name AS warehouse_name,
    w.code AS warehouse_code
FROM public.items i
LEFT JOIN public.locations l ON i.current_location_id = l.id
LEFT JOIN public.warehouses w ON i.warehouse_id = w.id
WHERE i.deleted_at IS NULL;