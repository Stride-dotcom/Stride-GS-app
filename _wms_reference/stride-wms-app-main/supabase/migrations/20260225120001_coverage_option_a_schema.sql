-- ============================================================================
-- Coverage System Reintegration — Option A Schema Migration
-- Version: v3.2
-- Scope: Per-item billing, RPC-only mutations, coverage_history audit
-- ============================================================================

-- ============================================================================
-- 2.1 Add declared_value to shipment_items (pre-receiving DV capture)
-- ============================================================================
ALTER TABLE public.shipment_items
ADD COLUMN IF NOT EXISTS declared_value NUMERIC(12,2);

COMMENT ON COLUMN public.shipment_items.declared_value
  IS 'Pre-receiving declared value entered on expected items. Carried to items.declared_value on receipt.';

-- ============================================================================
-- 2.2 Add auto_apply_coverage_on_receiving to accounts
-- ============================================================================
ALTER TABLE public.accounts
ADD COLUMN IF NOT EXISTS auto_apply_coverage_on_receiving BOOLEAN DEFAULT false;

COMMENT ON COLUMN public.accounts.auto_apply_coverage_on_receiving
  IS 'When true, auto-apply default_coverage_type when shipment status becomes received.';

-- ============================================================================
-- 2.3 Add tenant-level minimum declared value threshold
-- ============================================================================
ALTER TABLE public.organization_claim_settings
ADD COLUMN IF NOT EXISTS coverage_min_declared_value NUMERIC(12,2) DEFAULT 0;

COMMENT ON COLUMN public.organization_claim_settings.coverage_min_declared_value
  IS 'Minimum acceptable declared value for coverage (0 = no minimum).';

-- ============================================================================
-- 2.4 coverage_history audit table
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.coverage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  shipment_id UUID REFERENCES public.shipments(id) ON DELETE SET NULL,
  item_id UUID REFERENCES public.items(id) ON DELETE SET NULL,
  changed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  old_coverage_type TEXT,
  new_coverage_type TEXT,
  old_declared_value NUMERIC(12,2),
  new_declared_value NUMERIC(12,2),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.coverage_history
  IS 'Audit trail for coverage changes. Actions: coverage_applied, coverage_modified, coverage_removed, declared_value_set, declared_value_modified';

CREATE INDEX IF NOT EXISTS idx_coverage_history_tenant ON public.coverage_history(tenant_id);
CREATE INDEX IF NOT EXISTS idx_coverage_history_shipment ON public.coverage_history(shipment_id);
CREATE INDEX IF NOT EXISTS idx_coverage_history_item ON public.coverage_history(item_id);

ALTER TABLE public.coverage_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "coverage_history_select" ON public.coverage_history;
CREATE POLICY "coverage_history_select"
  ON public.coverage_history FOR SELECT
  USING (tenant_id = public.get_current_user_tenant_id());

-- INSERT is via SECURITY DEFINER RPCs; this policy is defense-in-depth
DROP POLICY IF EXISTS "coverage_history_insert_staff" ON public.coverage_history;
CREATE POLICY "coverage_history_insert_staff"
  ON public.coverage_history FOR INSERT
  WITH CHECK (
    tenant_id = public.get_current_user_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'tenant_admin')
      OR public.has_role(auth.uid(), 'manager')
      OR public.has_role(auth.uid(), 'warehouse')
    )
  );

-- ============================================================================
-- 2.5 Canonical coverage_type value migration
-- ============================================================================

-- Ensure shipments.coverage_type constraint allows canonical values + NULL
DO $$ BEGIN
  ALTER TABLE public.shipments DROP CONSTRAINT IF EXISTS shipments_coverage_type_check;
  ALTER TABLE public.shipments ADD CONSTRAINT shipments_coverage_type_check
    CHECK (coverage_type IS NULL OR coverage_type IN (
      'standard',
      'full_replacement_no_deductible',
      'full_replacement_deductible',
      'pending'
    ));
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Could not update shipments.coverage_type constraint: %', SQLERRM;
END $$;

-- Ensure items.coverage_type constraint allows canonical values
DO $$ BEGIN
  ALTER TABLE public.items DROP CONSTRAINT IF EXISTS items_coverage_type_check;
  ALTER TABLE public.items ADD CONSTRAINT items_coverage_type_check
    CHECK (coverage_type IN (
      'standard',
      'full_replacement_no_deductible',
      'full_replacement_deductible',
      'pending'
    ));
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Could not update items.coverage_type constraint: %', SQLERRM;
END $$;

-- Migrate legacy values on shipments
UPDATE public.shipments
SET coverage_type = 'full_replacement_no_deductible'
WHERE coverage_type IN ('full_no_deductible', 'full', 'enhanced');

UPDATE public.shipments
SET coverage_type = 'full_replacement_deductible'
WHERE coverage_type IN ('full_deductible');

-- Migrate legacy values on items
UPDATE public.items
SET coverage_type = 'full_replacement_no_deductible'
WHERE coverage_type IN ('full_no_deductible', 'full', 'enhanced');

UPDATE public.items
SET coverage_type = 'full_replacement_deductible'
WHERE coverage_type IN ('full_deductible');

-- Ensure accounts.default_coverage_type constraint allows canonical values + NULL
DO $$ BEGIN
  ALTER TABLE public.accounts DROP CONSTRAINT IF EXISTS accounts_default_coverage_type_check;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Could not drop accounts.default_coverage_type constraint: %', SQLERRM;
END $$;

-- Migrate legacy values on accounts
UPDATE public.accounts
SET default_coverage_type = 'full_replacement_no_deductible'
WHERE default_coverage_type IN ('full_no_deductible', 'full', 'enhanced');

UPDATE public.accounts
SET default_coverage_type = 'full_replacement_deductible'
WHERE default_coverage_type IN ('full_deductible');

DO $$ BEGIN
  ALTER TABLE public.accounts ADD CONSTRAINT accounts_default_coverage_type_check
    CHECK (default_coverage_type IS NULL OR default_coverage_type IN (
      'standard',
      'full_replacement_no_deductible',
      'full_replacement_deductible'
    ));
EXCEPTION WHEN others THEN
  RAISE NOTICE 'Could not update accounts.default_coverage_type constraint: %', SQLERRM;
END $$;

-- ============================================================================
-- 2.6 Deprecate shipment-level premium columns
-- ============================================================================
COMMENT ON COLUMN public.shipments.coverage_premium IS 'DEPRECATED (Option A). Do not write/read; billing is per-item only.';
COMMENT ON COLUMN public.shipments.coverage_rate IS 'DEPRECATED (Option A). Do not write/read.';
COMMENT ON COLUMN public.shipments.coverage_declared_value IS 'DEPRECATED (Option A). Do not write/read.';
COMMENT ON COLUMN public.shipments.coverage_deductible IS 'DEPRECATED (Option A). Do not write/read.';
COMMENT ON COLUMN public.shipments.coverage_scope IS 'DEPRECATED (Option A). Do not write/read.';

-- ============================================================================
-- 2.7 billing_events RLS hardening
-- Preflight confirmed: all billing_events inserts are staff-only (UI-gated).
-- Safe to tighten globally.
-- ============================================================================
DROP POLICY IF EXISTS "billing_events_all" ON public.billing_events;

-- Staff can INSERT billing_events
CREATE POLICY "billing_events_insert_staff"
  ON public.billing_events FOR INSERT
  WITH CHECK (
    tenant_id = public.get_current_user_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'tenant_admin')
      OR public.has_role(auth.uid(), 'manager')
      OR public.has_role(auth.uid(), 'warehouse')
    )
  );

-- Staff can UPDATE billing_events
CREATE POLICY "billing_events_update_staff"
  ON public.billing_events FOR UPDATE
  USING (
    tenant_id = public.get_current_user_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'tenant_admin')
      OR public.has_role(auth.uid(), 'manager')
      OR public.has_role(auth.uid(), 'warehouse')
    )
  );

-- Staff can DELETE billing_events
CREATE POLICY "billing_events_delete_staff"
  ON public.billing_events FOR DELETE
  USING (
    tenant_id = public.get_current_user_tenant_id()
    AND (
      public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'tenant_admin')
      OR public.has_role(auth.uid(), 'manager')
      OR public.has_role(auth.uid(), 'warehouse')
    )
  );

-- billing_events_select already exists (tenant isolation for reads)
