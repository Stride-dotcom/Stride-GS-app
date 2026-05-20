-- ============================================================
-- 2026-05-20 — Supabase-authoritative client-settings write-back.
--
-- Problem: Justin pointed out that React + intake form updates to
-- `public.clients` (auto_inspection, auto_charge, notification_contacts,
-- email, contact_name, phone, billing_*, tax_exempt, tax_exempt_reason,
-- resale_cert_expires, separate_by_sidemark, free_storage_days,
-- discount_storage_pct, discount_services_pct, etc.) silently get
-- overwritten on the next GAS full-client-sync (`handleResyncClients_`,
-- which reads the CB Clients sheet and pushes every row back to
-- `public.clients`). The Brian Paquette `auto_inspection` flip is the
-- concrete failure mode: the React Settings modal flipped it true in
-- Supabase, but the per-tenant Settings tab (where dock-intake reads
-- AUTO_INSPECTION from) still said FALSE because nothing wrote it
-- back to the sheet — and on the next CB-Clients-driven resync, even
-- the Supabase value reverted to FALSE.
--
-- Solution: invert the invariant for client settings. On UPDATE to
-- relevant columns of `public.clients`, fire a Postgres trigger that
-- POSTs to the `push-client-settings-to-sheet` Edge Function. The
-- Edge Function calls the existing P1.4 reverse-writethrough
-- framework (`writeThroughReverse`) to push the row to:
--   (a) per-tenant Settings tab (key/value, keyed by clientSettingsKey)
--   (b) CB Clients tab (column-based, keyed by cbHeader)
-- Both writes are needed: (a) is what per-client GAS reads at runtime
-- (the Brian Paquette failure mode); (b) is what handleResyncClients_
-- reads back, closing the loop so the next CB-driven resync no-ops.
--
-- Pattern: net.http_post via pg_net (already enabled per
-- 20260513134114_dt_sync_statuses_cron_schedule.sql + 20260504250000_
-- intake_reminder_cron_schedule.sql). Async fire-and-forget — a slow
-- or failing GAS call NEVER blocks the SB UPDATE.
--
-- Recursion safety: when GAS itself updates Supabase via
-- handleResyncClients_ → sbClientRow_, the trigger WILL fire on those
-- writes too. That's intentional and harmless because the GAS-side
-- writer is idempotent — re-writing identical values to the sheet is
-- a no-op (matching values stay matching). The trigger uses
-- `IS DISTINCT FROM` so a true no-op UPDATE doesn't even fire net.http_post.
-- An update originating from GAS that lands an identical row → trigger
-- doesn't fire; an update from GAS that lands a DIFFERENT row (e.g.
-- GAS thinks the sheet's value is canonical and overwrites SB) →
-- trigger DOES fire and pushes the GAS-canonical value to the sheet,
-- but that's already correct since GAS just told us the sheet was the
-- source of truth on that pass. The recursion is bounded by
-- idempotency at the writer.
--
-- Configuration: the trigger reads Edge Function URL + service-role
-- JWT from database GUCs (Postgres parameters). The operator must
-- ALTER DATABASE postgres SET them once post-merge — see the bottom
-- of this file for the exact commands. The trigger fails open: if
-- the GUCs aren't set, it logs a NOTICE and returns NEW without
-- POSTing, so a fresh database without the GUCs configured still
-- accepts UPDATEs to public.clients (the writeback just doesn't fire
-- until the operator sets them).
-- ============================================================

-- Ensure pg_net is present. Idempotent (matches the cron migrations).
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ── Trigger function ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.propagate_clients_to_sheet()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_url        text;
  v_service_jwt text;
  v_endpoint   text;
  v_body       jsonb;
BEGIN
  -- Read configuration from GUCs. `true` = silent NULL on missing
  -- (don't ERROR-out a clients UPDATE just because the GUC wasn't
  -- set). The fail-open semantics let a freshly-created environment
  -- write to public.clients before the operator wires up the GUCs.
  v_url         := current_setting('app.settings.supabase_url', true);
  v_service_jwt := current_setting('app.settings.service_role_key', true);
  IF v_url IS NULL OR v_url = '' OR v_service_jwt IS NULL OR v_service_jwt = '' THEN
    RAISE NOTICE 'propagate_clients_to_sheet: app.settings.supabase_url / app.settings.service_role_key not set — skipping push-client-settings-to-sheet for spreadsheet_id=%', NEW.spreadsheet_id;
    RETURN NEW;
  END IF;

  -- Skip rows without a spreadsheet_id. Defensive: the trigger is
  -- UPDATE-only and existing client rows always carry spreadsheet_id,
  -- but a future migration that NULLs the field (deactivation, archive)
  -- would otherwise fire the writer on an unopenable spreadsheet.
  IF NEW.spreadsheet_id IS NULL OR NEW.spreadsheet_id = '' THEN
    RETURN NEW;
  END IF;

  v_endpoint := rtrim(v_url, '/') || '/functions/v1/push-client-settings-to-sheet';
  v_body := jsonb_build_object(
    'spreadsheet_id', NEW.spreadsheet_id,
    'requestedBy',    'pg_trigger:propagate_clients_to_sheet'
  );

  -- Fire-and-forget. pg_net queues the request and returns immediately;
  -- the response lands in net._http_response asynchronously. A failure
  -- here NEVER blocks the originating UPDATE — the SB write commits
  -- regardless. The Edge Function writes gs_sync_events on its end so
  -- the FailedOperationsDrawer surfaces failures for retry.
  PERFORM net.http_post(
    url     := v_endpoint,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_service_jwt,
      'Content-Type',  'application/json'
    ),
    body    := v_body
  );

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.propagate_clients_to_sheet() IS
  '2026-05-20: fires push-client-settings-to-sheet Edge Function on relevant clients UPDATE/INSERT. See migration 20260520140000_clients_writeback_trigger.sql.';

-- ── Trigger wiring ──────────────────────────────────────────────────
-- UPDATE-only. INSERTs are deliberately NOT covered:
-- `handleOnboardClient_` (GAS-authoritative) creates the per-tenant
-- spreadsheet, writes its Settings tab, AND inserts the public.clients
-- row in one flow. Firing the writer on that INSERT would race the
-- onboard's own write-to-Sheet path (idempotent, but noisy in
-- gs_sync_events when the writer races a still-being-provisioned
-- tab). Future SB-authoritative onboarding (P5) would explicitly
-- invoke push-client-settings-to-sheet after its provision step
-- rather than relying on the trigger.
--
-- Fires only when one of the mirrored columns actually changed. The
-- `IS DISTINCT FROM` chain prevents recursion via GAS resyncs that
-- land identical values (the most common "rewrite of the same state"
-- case). Adding a new mirrored column means adding a clause here AND
-- to MIRRORED_COLUMNS in push-client-settings-to-sheet/index.ts AND
-- to CLIENT_FIELDS_ / REVERSE_CLIENTS_SB_ONLY_SETTINGS_ on the GAS
-- side — see __writeThroughReverseClients_ in StrideAPI.gs for the
-- canonical schema. Three lists, deliberately — they answer three
-- different questions (what to watch / what to ship / how to map).

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
  )
  EXECUTE FUNCTION public.propagate_clients_to_sheet();

COMMENT ON TRIGGER trg_propagate_clients_to_sheet ON public.clients IS
  '2026-05-20: fires Edge Function push-client-settings-to-sheet on relevant clients UPDATE/INSERT. Mirrored-column list must stay in sync with MIRRORED_COLUMNS in supabase/functions/push-client-settings-to-sheet/index.ts and CLIENT_FIELDS_ / REVERSE_CLIENTS_SB_ONLY_SETTINGS_ in AppScripts/stride-api/StrideAPI.gs.';

-- ============================================================
-- Operator setup (run ONCE post-merge, NOT part of the migration
-- itself — the values are environment-specific):
--
--   ALTER DATABASE postgres SET app.settings.supabase_url        = 'https://uqplppugeickmamycpuz.supabase.co';
--   ALTER DATABASE postgres SET app.settings.service_role_key    = '<service-role-jwt>';
--   -- The change takes effect on NEW sessions; existing sessions
--   -- keep the old GUC values. Reload the trigger function's session
--   -- or wait for connection turnover.
--   SELECT pg_reload_conf();
--
-- Verify after setup:
--
--   -- 1. Trigger row exists and is enabled.
--   SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgrelid = 'public.clients'::regclass
--      AND tgname = 'trg_propagate_clients_to_sheet';
--   -- Expect: tgenabled = 'O' (enabled, fires by default).
--
--   -- 2. Forced no-op shouldn't fire (IS DISTINCT FROM guard).
--   UPDATE public.clients SET name = name WHERE spreadsheet_id = '<some_id>';
--   -- net._http_response should NOT show a new row for this.
--
--   -- 3. Real change fires the Edge Function.
--   UPDATE public.clients SET auto_inspection = NOT auto_inspection WHERE spreadsheet_id = '<some_id>';
--   UPDATE public.clients SET auto_inspection = NOT auto_inspection WHERE spreadsheet_id = '<some_id>';  -- restore
--   -- net._http_response should now show 2 rows with status_code 200
--   -- and the gas_sync_events table should NOT have a new sync_failed row.
--
--   -- 4. Inspect recent trigger HTTP calls.
--   SELECT id, status_code, content::text, created
--     FROM net._http_response
--    WHERE url_path = '/functions/v1/push-client-settings-to-sheet'
--    ORDER BY created DESC LIMIT 10;
--
-- ============================================================
