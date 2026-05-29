-- ============================================================
-- 2026-05-28 — Extend trg_propagate_clients_to_sheet WHEN clause
-- to include `payment_method_required`.
--
-- Closes writethrough audit gap #5 (AUDIT-writethrough-field-gaps.md
-- §5, §10). Today the React Settings panel writes
-- `payment_method_required` in the same UPDATE as `billing_*` fields,
-- so the existing trigger fires (via the sibling `billing_*` clauses)
-- and the new column propagates incidentally. But a future code path
-- that flips ONLY `payment_method_required` (e.g. a per-client toggle
-- for Stax payment enforcement) wouldn't fire the trigger and the
-- sheet would silently diverge.
--
-- Pattern: DROP TRIGGER IF EXISTS + CREATE TRIGGER matches the
-- original 20260520140000_clients_writeback_trigger.sql migration.
-- The trigger function itself doesn't change.
--
-- Companion changes in this PR:
--   - StrideAPI.gs REVERSE_CLIENTS_SB_ONLY_SETTINGS_ gains a
--     'payment_method_required' → 'PAYMENT_METHOD_REQUIRED' entry
--     (so the GAS writer mirrors it to the per-tenant Settings tab).
--   - push-client-settings-to-sheet MIRRORED_COLUMNS gains
--     'payment_method_required' (so the Edge Function fetches it
--     from public.clients and forwards it in the row payload).
-- ============================================================

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
  )
  EXECUTE FUNCTION public.propagate_clients_to_sheet();

COMMENT ON TRIGGER trg_propagate_clients_to_sheet ON public.clients IS
  '2026-05-28: extends 2026-05-20 trigger WHEN clause with payment_method_required. Mirrored-column list must stay in sync with MIRRORED_COLUMNS in supabase/functions/push-client-settings-to-sheet/index.ts and REVERSE_CLIENTS_SB_ONLY_SETTINGS_ in AppScripts/stride-api/StrideAPI.gs.';
