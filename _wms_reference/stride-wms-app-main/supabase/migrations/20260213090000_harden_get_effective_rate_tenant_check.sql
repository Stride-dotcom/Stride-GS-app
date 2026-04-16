/* =============================================================================
   Stride WMS — Billing Security Patch
   Purpose: Prevent tenant spoofing in SECURITY DEFINER function get_effective_rate
   Safety: No data changes. Idempotent. Safe to run multiple times.
   Usage:
     - Add this as a repo migration file:
         supabase/migrations/20260213090000_harden_get_effective_rate_tenant_check.sql
     - AND/OR paste into Supabase SQL Editor for any env missing the patch.
   ============================================================================= */

CREATE OR REPLACE FUNCTION public.get_effective_rate(
  p_tenant_id UUID,
  p_charge_code TEXT,
  p_account_id UUID DEFAULT NULL,
  p_class_code TEXT DEFAULT NULL
)
RETURNS TABLE (
  charge_type_id UUID,
  charge_code TEXT,
  charge_name TEXT,
  category TEXT,
  is_taxable BOOLEAN,
  default_trigger TEXT,
  input_mode TEXT,
  service_time_minutes INTEGER,
  add_to_scan BOOLEAN,
  add_flag BOOLEAN,
  unit TEXT,
  base_rate NUMERIC,
  effective_rate NUMERIC,
  adjustment_type TEXT,
  adjustment_applied BOOLEAN,
  error_message TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_charge_type RECORD;
  v_pricing_rule RECORD;
  v_adjustment RECORD;
  v_base_rate NUMERIC;
  v_effective_rate NUMERIC;
  v_adjustment_type TEXT := NULL;
  v_adjustment_applied BOOLEAN := false;
  v_error_message TEXT := NULL;
  v_caller_tenant_id UUID;
BEGIN
  /* ---------------------------------------------------------------------------
     SECURITY: Prevent tenant spoofing
     - Function is SECURITY DEFINER; must validate caller's tenant.
     - Uses public.users (your confirmed tenant source).
     --------------------------------------------------------------------------- */
  SELECT u.tenant_id INTO v_caller_tenant_id
  FROM public.users u
  WHERE u.id = auth.uid();

  IF v_caller_tenant_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  IF v_caller_tenant_id IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'TENANT_MISMATCH';
  END IF;

  /* ---------------------------------------------------------------------------
     EXISTING BILLING LOGIC (UNCHANGED): Charge type lookup
     --------------------------------------------------------------------------- */
  SELECT * INTO v_charge_type
  FROM public.charge_types ct
  WHERE ct.tenant_id = p_tenant_id
    AND ct.charge_code = p_charge_code
    AND ct.is_active = true
    AND ct.deleted_at IS NULL;

  IF v_charge_type.id IS NULL THEN
    v_error_message := 'Charge type not found: ' || p_charge_code;
    RETURN QUERY SELECT
      NULL::UUID, p_charge_code, NULL::TEXT, NULL::TEXT, false, 'manual', 'qty',
      0, false, false, 'each', 0::NUMERIC, 0::NUMERIC, NULL::TEXT, false, v_error_message;
    RETURN;
  END IF;

  /* ---------------------------------------------------------------------------
     EXISTING BILLING LOGIC (UNCHANGED): Pricing rule selection
     - class-specific -> default -> first available
     --------------------------------------------------------------------------- */
  IF p_class_code IS NOT NULL THEN
    SELECT * INTO v_pricing_rule
    FROM public.pricing_rules pr
    WHERE pr.charge_type_id = v_charge_type.id
      AND pr.class_code = p_class_code
      AND pr.deleted_at IS NULL;
  END IF;

  IF v_pricing_rule.id IS NULL THEN
    SELECT * INTO v_pricing_rule
    FROM public.pricing_rules pr
    WHERE pr.charge_type_id = v_charge_type.id
      AND pr.is_default = true
      AND pr.deleted_at IS NULL;
  END IF;

  IF v_pricing_rule.id IS NULL THEN
    SELECT * INTO v_pricing_rule
    FROM public.pricing_rules pr
    WHERE pr.charge_type_id = v_charge_type.id
      AND pr.deleted_at IS NULL
    ORDER BY pr.class_code NULLS FIRST
    LIMIT 1;
  END IF;

  IF v_pricing_rule.id IS NULL THEN
    v_error_message := 'No pricing rule found for: ' || p_charge_code;
    v_base_rate := 0;
  ELSE
    v_base_rate := COALESCE(v_pricing_rule.rate, 0);
  END IF;

  v_effective_rate := v_base_rate;

  /* ---------------------------------------------------------------------------
     EXISTING BILLING LOGIC (UNCHANGED): Account adjustments (legacy mapping)
     NOTE: This intentionally uses public.account_service_settings for parity.
     --------------------------------------------------------------------------- */
  IF p_account_id IS NOT NULL AND v_pricing_rule.id IS NOT NULL THEN
    SELECT * INTO v_adjustment
    FROM public.account_service_settings ass
    WHERE ass.account_id = p_account_id
      AND ass.service_code = p_charge_code;

    IF v_adjustment.id IS NOT NULL THEN
      IF v_adjustment.is_enabled = false THEN
        v_error_message := 'Billing for this service is disabled for this account. Please update account pricing settings to continue.';
        RETURN QUERY SELECT
          v_charge_type.id, v_charge_type.charge_code, v_charge_type.charge_name,
          v_charge_type.category, v_charge_type.is_taxable, v_charge_type.default_trigger,
          v_charge_type.input_mode, COALESCE(v_pricing_rule.service_time_minutes, 0),
          v_charge_type.add_to_scan, v_charge_type.add_flag,
          COALESCE(v_pricing_rule.unit, 'each'), v_base_rate, 0::NUMERIC,
          NULL::TEXT, false, v_error_message;
        RETURN;
      END IF;

      IF v_adjustment.custom_rate IS NOT NULL THEN
        v_adjustment_applied := true;
        v_adjustment_type := 'override';
        v_effective_rate := v_adjustment.custom_rate;
      ELSIF v_adjustment.custom_percent_adjust IS NOT NULL THEN
        v_adjustment_applied := true;
        v_adjustment_type := 'percentage';
        v_effective_rate := v_base_rate * (1 + v_adjustment.custom_percent_adjust / 100);
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT
    v_charge_type.id, v_charge_type.charge_code, v_charge_type.charge_name,
    v_charge_type.category, v_charge_type.is_taxable, v_charge_type.default_trigger,
    v_charge_type.input_mode, COALESCE(v_pricing_rule.service_time_minutes, 0),
    v_charge_type.add_to_scan, v_charge_type.add_flag,
    COALESCE(v_pricing_rule.unit, 'each'), v_base_rate, v_effective_rate,
    v_adjustment_type, v_adjustment_applied, v_error_message;
END;
$function$;

/* =============================================================================
   Manual SQL Editor Runbook (Stride — Manual DB Ops Mode)
   =============================================================================
   1) Repo: Create migration file:
        supabase/migrations/20260213090000_harden_get_effective_rate_tenant_check.sql
      Paste this entire SQL in that file. Commit & push.

   2) Prod: DO NOT re-run if already verified (you already verified via pg_get_functiondef).

   3) New env (dev/stage/new Supabase project):
      - Paste this SQL into Supabase SQL Editor and run once.
      - Verify:
          SELECT pg_get_functiondef('public.get_effective_rate(uuid,text,uuid,text)'::regprocedure);

   4) Safety notes:
      - Idempotent: safe to run multiple times (CREATE OR REPLACE FUNCTION).
      - No data changes; no backfills; billing parity preserved.

   ============================================================================= */
