-- Session: billing code-review fix.
-- Replace the silent EXCEPTION WHEN OTHERS in log_billing_parity() with
-- RAISE WARNING so failures land in the Postgres log and can be
-- diagnosed. Trigger still returns NEW so a parity-logging failure
-- never blocks the underlying billing INSERT/UPDATE.

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
  -- Log to Postgres server log (visible in Supabase dashboard logs) so
  -- silent parity-logging failures can be diagnosed. We still return NEW
  -- to keep the underlying billing write unblocked.
  RAISE WARNING 'log_billing_parity failed for ledger_row_id=% svc_code=%: % (%) ',
    NEW.ledger_row_id, NEW.svc_code, SQLERRM, SQLSTATE;
  RETURN NEW;
END;
$$;
