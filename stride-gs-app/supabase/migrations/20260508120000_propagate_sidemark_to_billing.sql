-- Propagate inventory.sidemark edits to every Unbilled billing row.
--
-- Sidemarks are an inventory attribute; billing rows duplicate the
-- value at write-time so invoices and exports print without a join.
-- When a sidemark on an inventory item is corrected, every Unbilled
-- billing row for that item must follow. Without this trigger, an
-- updated sidemark would only reach billing rows GENERATED after the
-- edit; existing Unbilled charges stayed on the old value until
-- manually fixed.
--
-- Scope: status = 'Unbilled' ONLY. Invoiced / Billed / Void rows are
-- immutable history and must never be rewritten — invoices have
-- already shipped with whatever sidemark was current at invoice time.
--
-- Cascade behaviour:
--   billing_parity_trigger      AFTER INSERT OR UPDATE — fires; logs a
--                               match=true row (rate unchanged). Noise
--                               but harmless.
--   billing_autocomplete_sync   AFTER UPDATE OF sidemark, reference —
--                               fires; correctly records the new
--                               sidemark in autocomplete_db.
--   billing_updated_at          BEFORE UPDATE — sets updated_at; we
--                               also set updated_at in the UPDATE so
--                               the trigger is a no-op overwrite.
--
-- GAS write-through: StrideAPI.gs sbBillingRow_ includes sidemark in
-- the full payload it writes to Supabase. A future full client billing
-- sync would clobber Supabase's corrected sidemark back to the sheet's
-- value. Accepted: full syncs are rare and the next sheet-side write
-- of the same row will carry the corrected sidemark forward.
--
-- Index: trigger predicate is (item_id, tenant_id, status). Existing
-- billing indexes covered tenant_id and status individually, not the
-- combination + item_id. Added a composite to keep the UPDATE off a
-- full scan.

CREATE INDEX IF NOT EXISTS idx_billing_item_tenant_status
  ON public.billing (item_id, tenant_id, status);

CREATE OR REPLACE FUNCTION public.propagate_sidemark_to_billing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.sidemark IS DISTINCT FROM OLD.sidemark THEN
    UPDATE public.billing
       SET sidemark   = NEW.sidemark,
           updated_at = now()
     WHERE item_id   = NEW.item_id
       AND tenant_id = NEW.tenant_id
       AND status    = 'Unbilled';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_sidemark_to_billing ON public.inventory;

CREATE TRIGGER inventory_sidemark_to_billing
  AFTER UPDATE OF sidemark ON public.inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.propagate_sidemark_to_billing();
