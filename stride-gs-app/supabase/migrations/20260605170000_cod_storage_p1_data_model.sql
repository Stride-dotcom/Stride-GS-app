-- ============================================================
-- COD Storage — Phase 1 (data model) + Phase 2.1 (auto-flag on receive)
--
-- Feature: clients (designers) can opt their END CUSTOMERS into
-- paying for storage. Items flagged cod_storage=true stop billing
-- the designer from cod_storage_start_date onward (see the Phase 3
-- migration that caps the storage calc) and instead surface a
-- "COD Storage" collection line on the delivery order, collected
-- from the end customer at delivery.
--
-- Supabase-first: cod_storage / cod_storage_start_date live ONLY in
-- public.inventory (they have no Google-Sheet column and no GAS
-- handler). end_customer_pays_storage is a per-client toggle.
--
-- Gated to the Justin Demo Account tenant ONLY via the
-- 'codStorageBilling' feature flag (MIG-016 canary pattern). The
-- flag gates every COD UI element; non-scoped tenants resolve to
-- 'gas' (= feature off) and see nothing.
--
-- 2026-06-05 PST
-- ============================================================

-- ── inventory: the COD flag + start date ─────────────────────
ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS cod_storage            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cod_storage_start_date date;

COMMENT ON COLUMN public.inventory.cod_storage IS
  'COD Storage: when true the designer is billed storage only through cod_storage_start_date - 1; days from the start date onward are collected from the end customer at delivery.';
COMMENT ON COLUMN public.inventory.cod_storage_start_date IS
  'First day the end customer (not the designer) is responsible for storage. NULL when cod_storage is false.';

-- parity_dryrun mirror sync (schema-sync convention — inventory is a
-- mirror-set member; every public.inventory ALTER must be mirrored).
ALTER TABLE parity_dryrun.inventory
  ADD COLUMN IF NOT EXISTS cod_storage            boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cod_storage_start_date date;

-- ── clients: the per-client opt-in toggle ────────────────────
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS end_customer_pays_storage boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.clients.end_customer_pays_storage IS
  'When ON, every item received for this client is auto-flagged cod_storage=true with cod_storage_start_date=receive_date (see trg_apply_cod_storage_on_receive).';

-- parity_dryrun mirror sync (clients is a mirror-set member).
ALTER TABLE parity_dryrun.clients
  ADD COLUMN IF NOT EXISTS end_customer_pays_storage boolean NOT NULL DEFAULT false;

-- ── Phase 2.1: auto-flag received items via a BEFORE INSERT trigger
--
-- This single trigger covers BOTH receiveShipment paths with zero GAS
-- changes (Supabase-first):
--   • GAS handleCompleteShipment_ → api_writeThrough_ → INSERT public.inventory
--   • SB complete-shipment-sb     → INSERT public.inventory
-- Both land as a fresh inventory INSERT, so flagging here is path-agnostic.
--
-- An explicit cod_storage=true on the incoming row always wins (e.g. a
-- future caller that pre-sets it); we only auto-apply when the row is
-- not already flagged and the client has opted in.
CREATE OR REPLACE FUNCTION public.apply_cod_storage_on_receive()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pays boolean;
BEGIN
  -- Explicit flag on the incoming row wins; don't second-guess it.
  IF NEW.cod_storage IS TRUE THEN
    RETURN NEW;
  END IF;

  -- Only meaningful for rows that carry a receive date.
  IF NULLIF(TRIM(COALESCE(NEW.receive_date, '')), '') IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT c.end_customer_pays_storage
    INTO v_pays
    FROM public.clients c
   WHERE c.tenant_id = NEW.tenant_id;

  IF v_pays IS TRUE THEN
    NEW.cod_storage := true;
    IF NEW.cod_storage_start_date IS NULL THEN
      BEGIN
        NEW.cod_storage_start_date := NULLIF(TRIM(NEW.receive_date), '')::date;
      EXCEPTION WHEN others THEN
        -- Unparseable receive_date: flag stays true, start date null;
        -- operator can set it from the Inventory batch action / item detail.
        NEW.cod_storage_start_date := NULL;
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.apply_cod_storage_on_receive() IS
  'BEFORE INSERT trigger fn on public.inventory: when the owning client has end_customer_pays_storage=true, stamp cod_storage=true + cod_storage_start_date=receive_date. Path-agnostic (covers GAS writethrough + complete-shipment-sb).';

DROP TRIGGER IF EXISTS trg_apply_cod_storage_on_receive ON public.inventory;
CREATE TRIGGER trg_apply_cod_storage_on_receive
  BEFORE INSERT ON public.inventory
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_cod_storage_on_receive();

-- ── Feature flag (UI gate) — Justin Demo Account ONLY ────────
-- MIG-016 canary semantics: active_backend='supabase' + tenant_scope=[justinDemo]
-- ⇒ Justin Demo resolves to 'supabase' (feature ON); every other tenant
-- resolves to the opposite 'gas' (feature OFF). useFeatureFlag('codStorageBilling')
-- === 'supabase' is the single UI gate for ALL COD elements.
INSERT INTO public.feature_flags (function_key, active_backend, tenant_scope, parity_enabled, notes)
VALUES (
  'codStorageBilling',
  'supabase',
  ARRAY['1-nF3CgQBcfCncqW6u3d4jilsZzjqR1RO6y_f4OD-O2A']::text[],
  false,
  'COD Storage feature (end customers pay storage). UI gate only — no GAS handler, no routing. Justin Demo canary per MIG-016.'
)
ON CONFLICT (function_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
