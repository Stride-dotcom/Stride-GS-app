-- 20260426020000_drop_delivery_accessorials.sql
--
-- Drops the legacy `delivery_accessorials` table. The order-creation
-- flow already reads from `service_catalog` (rows where
-- show_as_delivery_service = true) via fetchDeliveryServicesFromCatalog
-- — `delivery_accessorials` had no remaining consumers in either the
-- React app, Apps Script, or the Edge Functions (verified by grep on
-- 2026-04-26). Removing it keeps a single source of truth for billable
-- delivery services + add-ons.
--
-- CASCADE drops the RLS policies + the updated_at trigger created in
-- migration 20260417000000.

DROP TABLE IF EXISTS public.delivery_accessorials CASCADE;
