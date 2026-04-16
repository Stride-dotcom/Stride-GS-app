-- R1 Receiving Repairs Migration
-- Adds: is_system_account column, ensure_unidentified_account function, prefix-based shipment number generation

-- STEP 1: UNIDENTIFIED ACCOUNT SUPPORT
ALTER TABLE public.accounts
ADD COLUMN IF NOT EXISTS is_system_account BOOLEAN DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_accounts_system
ON public.accounts (tenant_id, is_system_account)
WHERE is_system_account = true;

-- Helper function: ensure one UNIDENTIFIED SHIPMENT account per tenant
CREATE OR REPLACE FUNCTION public.ensure_unidentified_account(p_tenant_id uuid)
RETURNS uuid AS $$
DECLARE
  v_account_id uuid;
BEGIN
  SELECT id INTO v_account_id
  FROM public.accounts
  WHERE tenant_id = p_tenant_id
    AND is_system_account = true
    AND account_name = 'UNIDENTIFIED SHIPMENT'
  LIMIT 1;

  IF v_account_id IS NULL THEN
    INSERT INTO public.accounts (tenant_id, account_name, is_system_account, is_active)
    VALUES (p_tenant_id, 'UNIDENTIFIED SHIPMENT', true, true)
    RETURNING id INTO v_account_id;
  END IF;

  RETURN v_account_id;
END;
$$ LANGUAGE plpgsql;

-- STEP 2: PREFIX-BASED SHIPMENT NUMBER GENERATION
-- Uses existing sequence (DO NOT change name or start value)
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

-- Update the trigger to use prefix mapping based on shipment_type + inbound_kind
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
