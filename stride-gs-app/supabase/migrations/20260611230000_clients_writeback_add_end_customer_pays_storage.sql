-- 2026-06-11 — Extend trg_propagate_clients_to_sheet WHEN clause
-- to include `end_customer_pays_storage` (COD Storage flag).
--
-- Without this, a standalone flip of just the COD Storage toggle never
-- fired push-client-settings-to-sheet, so the per-tenant Settings tab
-- (END_CUSTOMER_PAYS_STORAGE key) stayed stale. Paired with:
--   • 'end_customer_pays_storage' added to MIRRORED_COLUMNS in
--     supabase/functions/push-client-settings-to-sheet/index.ts
--   • 'end_customer_pays_storage' → 'END_CUSTOMER_PAYS_STORAGE' entry in
--     REVERSE_CLIENTS_SB_ONLY_SETTINGS_ (StrideAPI.gs v38.278.0)
--
-- Same recreate pattern as 20260528150000 (payment_method_required).

DROP TRIGGER IF EXISTS trg_propagate_clients_to_sheet ON public.clients;
CREATE TRIGGER trg_propagate_clients_to_sheet
  AFTER UPDATE ON public.clients
  FOR EACH ROW
  WHEN (
            OLD.name                     IS DISTINCT FROM NEW.name
         OR OLD.email                    IS DISTINCT FROM NEW.email
         OR OLD.contact_name             IS DISTINCT FROM NEW.contact_name
         OR OLD.phone                    IS DISTINCT FROM NEW.phone
         OR OLD.qb_customer_name         IS DISTINCT FROM NEW.qb_customer_name
         OR OLD.stax_customer_name       IS DISTINCT FROM NEW.stax_customer_name
         OR OLD.stax_customer_id         IS DISTINCT FROM NEW.stax_customer_id
         OR OLD.payment_terms            IS DISTINCT FROM NEW.payment_terms
         OR OLD.free_storage_days        IS DISTINCT FROM NEW.free_storage_days
         OR OLD.discount_storage_pct     IS DISTINCT FROM NEW.discount_storage_pct
         OR OLD.discount_services_pct    IS DISTINCT FROM NEW.discount_services_pct
         OR OLD.enable_receiving_billing IS DISTINCT FROM NEW.enable_receiving_billing
         OR OLD.enable_shipment_email    IS DISTINCT FROM NEW.enable_shipment_email
         OR OLD.enable_notifications     IS DISTINCT FROM NEW.enable_notifications
         OR OLD.auto_inspection          IS DISTINCT FROM NEW.auto_inspection
         OR OLD.separate_by_sidemark     IS DISTINCT FROM NEW.separate_by_sidemark
         OR OLD.auto_charge              IS DISTINCT FROM NEW.auto_charge
         OR OLD.parent_client            IS DISTINCT FROM NEW.parent_client
         OR OLD.notes                    IS DISTINCT FROM NEW.notes
         OR OLD.shipment_note            IS DISTINCT FROM NEW.shipment_note
         OR OLD.active                   IS DISTINCT FROM NEW.active
         OR OLD.notification_contacts    IS DISTINCT FROM NEW.notification_contacts
         OR OLD.billing_contact_name     IS DISTINCT FROM NEW.billing_contact_name
         OR OLD.billing_email            IS DISTINCT FROM NEW.billing_email
         OR OLD.billing_address          IS DISTINCT FROM NEW.billing_address
         OR OLD.tax_exempt               IS DISTINCT FROM NEW.tax_exempt
         OR OLD.tax_exempt_reason        IS DISTINCT FROM NEW.tax_exempt_reason
         OR OLD.resale_cert_expires      IS DISTINCT FROM NEW.resale_cert_expires
         OR OLD.resale_cert_url          IS DISTINCT FROM NEW.resale_cert_url
         OR OLD.payment_method_required  IS DISTINCT FROM NEW.payment_method_required
         OR OLD.end_customer_pays_storage IS DISTINCT FROM NEW.end_customer_pays_storage
  )
  EXECUTE FUNCTION public.propagate_clients_to_sheet();

COMMENT ON TRIGGER trg_propagate_clients_to_sheet ON public.clients IS
  '2026-06-11: extends 2026-05-28 trigger WHEN clause with end_customer_pays_storage. Mirrored-column list must stay in sync with MIRRORED_COLUMNS in supabase/functions/push-client-settings-to-sheet/index.ts and REVERSE_CLIENTS_SB_ONLY_SETTINGS_ in AppScripts/stride-api/StrideAPI.gs.';
