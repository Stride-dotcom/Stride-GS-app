-- ============================================================================
-- inventory_live — expose cod_storage + cod_storage_start_date
--
-- Bug: the Item Detail page showed "End customer pays storage" OFF even when
-- inventory.cod_storage = true. fetchItemByIdFromSupabase reads the
-- `inventory_live` view (not the base table), and the view's column list did
-- NOT include cod_storage / cod_storage_start_date — so the detail mapping had
-- no column to read (the Inventory LIST works because fetchRawInventoryRows
-- reads the `inventory` base table directly).
--
-- Fix: recreate the view with the two COD columns appended. PRESERVES:
--   • security_invoker = true (RLS passthrough — tenant restrictions still apply)
--   • the status IS DISTINCT FROM 'Transferred' filter (hides the source row of
--     a transferred item so the "two rows per item_id" case can't trip lookups)
--   • the exact existing column list + order (so CREATE OR REPLACE is a pure
--     append of the two new trailing columns).
-- ============================================================================

CREATE OR REPLACE VIEW public.inventory_live
WITH (security_invoker = true) AS
SELECT id,
       tenant_id,
       item_id,
       description,
       vendor,
       sidemark,
       room,
       item_class,
       qty,
       location,
       status,
       receive_date,
       release_date,
       shipment_number,
       carrier,
       tracking_number,
       item_notes,
       reference,
       task_notes,
       item_folder_url,
       created_at,
       updated_at,
       shipment_photos_url,
       inspection_photos_url,
       repair_photos_url,
       invoice_url,
       transfer_date,
       declared_value,
       coverage_option_id,
       shipment_folder_url,
       needs_inspection,
       needs_assembly,
       cod_storage,
       cod_storage_start_date
  FROM inventory
 WHERE status IS DISTINCT FROM 'Transferred'::text;
