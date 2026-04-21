-- Session 77: catch every billing row going into Supabase, compare
-- its rate against service_catalog, and log the delta. Fires AFTER
-- INSERT or UPDATE on public.billing regardless of which GAS code
-- path produced the row (api_lookupRate_, full client sync, bulk
-- resync, write-through, manual charge) — previously only the
-- api_lookupRate_ path logged parity, which missed 168 of 171
-- events in a day's traffic.
--
-- SECURITY DEFINER so the trigger can write to billing_parity_log
-- even from sessions without direct write grants. EXCEPTION WHEN
-- OTHERS swallows any comparison error so a broken lookup never
-- blocks a billing write.

CREATE OR REPLACE FUNCTION public.log_billing_parity() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  sb_rate  numeric;
  svc_row  record;
BEGIN
  SELECT rates, flat_rate, billing INTO svc_row
  FROM public.service_catalog
  WHERE code = NEW.svc_code AND active = true
  ORDER BY updated_at DESC NULLS LAST
  LIMIT 1;

  IF FOUND THEN
    IF svc_row.billing = 'class_based' AND NEW.item_class IS NOT NULL AND NEW.item_class <> '' THEN
      sb_rate := COALESCE((svc_row.rates ->> NEW.item_class)::numeric, 0);
    ELSE
      sb_rate := COALESCE(svc_row.flat_rate, 0);
    END IF;

    INSERT INTO public.billing_parity_log (
      tenant_id, client_name, item_id, svc_code, svc_name, item_class,
      sheet_rate, supabase_rate, sheet_total, supabase_total, qty,
      match, delta, event_source, billing_ledger_id
    ) VALUES (
      NEW.tenant_id, NEW.client_name, NEW.item_id, NEW.svc_code, NEW.svc_name, NEW.item_class,
      COALESCE(NEW.rate, 0),
      sb_rate,
      COALESCE(NEW.total, 0),
      sb_rate * COALESCE(NEW.qty, 1),
      COALESCE(NEW.qty, 1),
      ABS(COALESCE(NEW.rate, 0) - sb_rate) < 0.01,
      (sb_rate - COALESCE(NEW.rate, 0)) * COALESCE(NEW.qty, 1),
      CASE TG_OP
        WHEN 'INSERT' THEN 'billing_trigger_insert'
        WHEN 'UPDATE' THEN 'billing_trigger_update'
        ELSE 'billing_trigger'
      END,
      NEW.ledger_row_id
    );
  END IF;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS billing_parity_trigger ON public.billing;

CREATE TRIGGER billing_parity_trigger
  AFTER INSERT OR UPDATE ON public.billing
  FOR EACH ROW EXECUTE FUNCTION public.log_billing_parity();
