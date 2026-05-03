-- Auto-populate public.autocomplete_db on every inventory/billing
-- INSERT or UPDATE. Until now, autocomplete drift was fixed by
-- one-shot backfills (the 5/3 sidemark/vendor/description/reference
-- runs); this trigger removes the need for periodic re-runs.
--
-- One trigger function per table because they own different field
-- subsets:
--   inventory  → Sidemark, Vendor, Description, Reference
--   billing    → Sidemark, Reference  (only fields the table carries)
--
-- All upserts use ON CONFLICT DO NOTHING so the trigger can never
-- fail an inventory/billing write.

CREATE OR REPLACE FUNCTION public.touch_autocomplete_db_from_inventory() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF;

  IF NULLIF(TRIM(NEW.sidemark), '') IS NOT NULL THEN
    INSERT INTO public.autocomplete_db (tenant_id, field, value)
    VALUES (NEW.tenant_id, 'Sidemark', TRIM(NEW.sidemark))
    ON CONFLICT (tenant_id, field, value) DO NOTHING;
  END IF;
  IF NULLIF(TRIM(NEW.vendor), '') IS NOT NULL THEN
    INSERT INTO public.autocomplete_db (tenant_id, field, value)
    VALUES (NEW.tenant_id, 'Vendor', TRIM(NEW.vendor))
    ON CONFLICT (tenant_id, field, value) DO NOTHING;
  END IF;
  IF NULLIF(TRIM(NEW.description), '') IS NOT NULL THEN
    INSERT INTO public.autocomplete_db (tenant_id, field, value)
    VALUES (NEW.tenant_id, 'Description', TRIM(NEW.description))
    ON CONFLICT (tenant_id, field, value) DO NOTHING;
  END IF;
  IF NULLIF(TRIM(NEW.reference), '') IS NOT NULL THEN
    INSERT INTO public.autocomplete_db (tenant_id, field, value)
    VALUES (NEW.tenant_id, 'Reference', TRIM(NEW.reference))
    ON CONFLICT (tenant_id, field, value) DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let an autocomplete-mirror failure block the underlying write.
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_autocomplete_db_from_billing() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.tenant_id IS NULL THEN RETURN NEW; END IF;

  IF NULLIF(TRIM(NEW.sidemark), '') IS NOT NULL THEN
    INSERT INTO public.autocomplete_db (tenant_id, field, value)
    VALUES (NEW.tenant_id, 'Sidemark', TRIM(NEW.sidemark))
    ON CONFLICT (tenant_id, field, value) DO NOTHING;
  END IF;
  IF NULLIF(TRIM(NEW.reference), '') IS NOT NULL THEN
    INSERT INTO public.autocomplete_db (tenant_id, field, value)
    VALUES (NEW.tenant_id, 'Reference', TRIM(NEW.reference))
    ON CONFLICT (tenant_id, field, value) DO NOTHING;
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inventory_autocomplete_sync ON public.inventory;
CREATE TRIGGER inventory_autocomplete_sync
  AFTER INSERT OR UPDATE OF sidemark, vendor, description, reference
  ON public.inventory
  FOR EACH ROW EXECUTE FUNCTION public.touch_autocomplete_db_from_inventory();

DROP TRIGGER IF EXISTS billing_autocomplete_sync ON public.billing;
CREATE TRIGGER billing_autocomplete_sync
  AFTER INSERT OR UPDATE OF sidemark, reference
  ON public.billing
  FOR EACH ROW EXECUTE FUNCTION public.touch_autocomplete_db_from_billing();
