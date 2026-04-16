-- Drop and recreate the view to add the room column
DROP VIEW IF EXISTS v_items_with_location;

CREATE VIEW v_items_with_location
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
    i.inspection_status,
    i.repair_status,
    i.assembly_status,
    i.status,
    i.size,
    i.size_unit,
    i.current_location_id,
    i.received_at,
    i.metadata,
    i.created_at,
    i.updated_at,
    i.deleted_at,
    i.primary_photo_url,
    i.room,
    l.code AS location_code,
    l.name AS location_name,
    l.type AS location_type,
    w.name AS warehouse_name,
    w.code AS warehouse_code
FROM items i
LEFT JOIN locations l ON i.current_location_id = l.id
LEFT JOIN warehouses w ON i.warehouse_id = w.id
WHERE i.deleted_at IS NULL;