-- Harden shipment number prefix generation (R1 contract)
-- Ensures:
-- - generate_shipment_number supports prefixes (MAN/EXP/INT/OUT/SHP)
-- - set_shipment_number maps prefixes from shipment_type + inbound_kind
-- - trigger exists on public.shipments to apply numbering on insert
--
-- NOTE: Does NOT rewrite existing shipment_number values.

-- 1) Prefixed generator (single global sequence; do not change sequence name/start).
CREATE OR REPLACE FUNCTION public.generate_shipment_number(
  p_prefix TEXT DEFAULT 'SHP'
)
RETURNS text AS $$
DECLARE
  next_val INTEGER;
BEGIN
  next_val := nextval('shipment_number_seq');
  RETURN p_prefix || '-' || LPAD(next_val::TEXT, 5, '0');
END;
$$ LANGUAGE plpgsql;

-- 2) Keep legacy no-arg function compatible with the new signature.
--    This avoids callers accidentally using an older 6-digit SHP format if it existed.
CREATE OR REPLACE FUNCTION public.generate_shipment_number()
RETURNS text AS $$
BEGIN
  RETURN public.generate_shipment_number('SHP');
END;
$$ LANGUAGE plpgsql;

-- 3) Trigger function to set shipment_number based on shipment_type + inbound_kind.
CREATE OR REPLACE FUNCTION public.set_shipment_number()
RETURNS TRIGGER AS $$
DECLARE
  v_prefix TEXT;
BEGIN
  IF NEW.shipment_number IS NULL OR NEW.shipment_number = '' THEN
    v_prefix := CASE
      WHEN NEW.shipment_type = 'inbound' AND NEW.inbound_kind = 'manifest'    THEN 'MAN'
      WHEN NEW.shipment_type = 'inbound' AND NEW.inbound_kind = 'expected'    THEN 'EXP'
      WHEN NEW.shipment_type = 'inbound' AND NEW.inbound_kind = 'dock_intake' THEN 'INT'
      WHEN NEW.shipment_type = 'outbound'                                     THEN 'OUT'
      ELSE 'SHP'
    END;
    NEW.shipment_number := public.generate_shipment_number(v_prefix);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4) Ensure the BEFORE INSERT trigger exists.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trigger_set_shipment_number'
      AND tgrelid = 'public.shipments'::regclass
  ) THEN
    CREATE TRIGGER trigger_set_shipment_number
      BEFORE INSERT ON public.shipments
      FOR EACH ROW
      EXECUTE FUNCTION public.set_shipment_number();
  END IF;
END $$;

