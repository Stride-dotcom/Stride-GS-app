-- ============================================================================
-- Phase 5D: Audit Log + Pricing Change History
-- ============================================================================
-- Enterprise compliance feature: Log all meaningful pricing/config changes.
-- Does NOT change billing calculations - logging only.
--
-- Tracked entities:
-- - service_events (Price List)
-- - task_types
-- - service_categories
-- ============================================================================

-- ============================================================================
-- 1. CREATE AUDIT_LOG TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entity_table TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  changed_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  changes JSONB NULL,
  snapshot JSONB NULL,

  -- Searchable fields extracted from snapshot for easier filtering
  entity_name TEXT NULL,
  entity_code TEXT NULL
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_changed_at
  ON public.audit_log(tenant_id, changed_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_entity_table
  ON public.audit_log(tenant_id, entity_table);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_entity_id
  ON public.audit_log(tenant_id, entity_id);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity_code
  ON public.audit_log(tenant_id, entity_code)
  WHERE entity_code IS NOT NULL;

COMMENT ON TABLE public.audit_log IS 'Audit trail for pricing and configuration changes';
COMMENT ON COLUMN public.audit_log.changes IS 'JSON diff of changed fields: { field: { from: old, to: new } }';
COMMENT ON COLUMN public.audit_log.snapshot IS 'Full row snapshot after change (for INSERT/UPDATE)';

-- ============================================================================
-- 2. GENERIC AUDIT TRIGGER FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.audit_if_changed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_entity_id UUID;
  v_changes JSONB := '{}';
  v_snapshot JSONB;
  v_entity_name TEXT;
  v_entity_code TEXT;
  v_changed_by UUID;
  v_tracked_columns TEXT[];
  v_col TEXT;
  v_old_val JSONB;
  v_new_val JSONB;
  v_has_changes BOOLEAN := FALSE;
BEGIN
  -- Get current user if available
  BEGIN
    v_changed_by := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_changed_by := NULL;
  END;

  -- Define tracked columns per table
  CASE TG_TABLE_NAME
    WHEN 'service_events' THEN
      v_tracked_columns := ARRAY['rate', 'billing_unit', 'billing_trigger', 'taxable', 'is_active',
                                  'service_time_minutes', 'category_id', 'notes', 'uses_class_pricing'];
    WHEN 'task_types' THEN
      v_tracked_columns := ARRAY['category_id', 'default_service_code', 'requires_items',
                                  'allow_rate_override', 'is_active', 'name', 'description', 'sort_order'];
    WHEN 'service_categories' THEN
      v_tracked_columns := ARRAY['is_active', 'description', 'sort_order'];
    ELSE
      v_tracked_columns := ARRAY[]::TEXT[];
  END CASE;

  -- Handle based on operation type
  IF TG_OP = 'DELETE' THEN
    v_tenant_id := OLD.tenant_id;
    v_entity_id := OLD.id;
    v_snapshot := to_jsonb(OLD);

    -- Extract searchable fields
    IF TG_TABLE_NAME = 'service_events' THEN
      v_entity_name := OLD.service_name;
      v_entity_code := OLD.service_code;
    ELSIF TG_TABLE_NAME = 'task_types' THEN
      v_entity_name := OLD.name;
      v_entity_code := OLD.default_service_code;
    ELSIF TG_TABLE_NAME = 'service_categories' THEN
      v_entity_name := OLD.name;
    END IF;

    v_has_changes := TRUE;

  ELSIF TG_OP = 'INSERT' THEN
    v_tenant_id := NEW.tenant_id;
    v_entity_id := NEW.id;
    v_snapshot := to_jsonb(NEW);

    -- Extract searchable fields
    IF TG_TABLE_NAME = 'service_events' THEN
      v_entity_name := NEW.service_name;
      v_entity_code := NEW.service_code;
    ELSIF TG_TABLE_NAME = 'task_types' THEN
      v_entity_name := NEW.name;
      v_entity_code := NEW.default_service_code;
    ELSIF TG_TABLE_NAME = 'service_categories' THEN
      v_entity_name := NEW.name;
    END IF;

    v_has_changes := TRUE;

  ELSIF TG_OP = 'UPDATE' THEN
    v_tenant_id := NEW.tenant_id;
    v_entity_id := NEW.id;
    v_snapshot := to_jsonb(NEW);

    -- Extract searchable fields
    IF TG_TABLE_NAME = 'service_events' THEN
      v_entity_name := NEW.service_name;
      v_entity_code := NEW.service_code;
    ELSIF TG_TABLE_NAME = 'task_types' THEN
      v_entity_name := NEW.name;
      v_entity_code := NEW.default_service_code;
    ELSIF TG_TABLE_NAME = 'service_categories' THEN
      v_entity_name := NEW.name;
    END IF;

    -- Build changes diff for tracked columns only
    FOREACH v_col IN ARRAY v_tracked_columns
    LOOP
      -- Special case: ignore name changes for system task_types
      IF TG_TABLE_NAME = 'task_types' AND v_col = 'name' AND OLD.is_system = TRUE THEN
        CONTINUE;
      END IF;

      -- Get old and new values as JSONB
      EXECUTE format('SELECT to_jsonb($1.%I)', v_col) INTO v_old_val USING OLD;
      EXECUTE format('SELECT to_jsonb($1.%I)', v_col) INTO v_new_val USING NEW;

      -- Compare values (handles nulls correctly)
      IF v_old_val IS DISTINCT FROM v_new_val THEN
        v_changes := v_changes || jsonb_build_object(
          v_col, jsonb_build_object('from', v_old_val, 'to', v_new_val)
        );
        v_has_changes := TRUE;
      END IF;
    END LOOP;
  END IF;

  -- Only insert if there are actual changes to tracked columns
  IF v_has_changes THEN
    INSERT INTO public.audit_log (
      tenant_id,
      entity_table,
      entity_id,
      action,
      changed_by,
      changes,
      snapshot,
      entity_name,
      entity_code
    ) VALUES (
      v_tenant_id,
      TG_TABLE_NAME,
      v_entity_id,
      TG_OP,
      v_changed_by,
      CASE WHEN TG_OP = 'UPDATE' THEN v_changes ELSE NULL END,
      v_snapshot,
      v_entity_name,
      v_entity_code
    );
  END IF;

  -- Return appropriate value
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  ELSE
    RETURN NEW;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.audit_if_changed IS 'Generic audit trigger function that logs changes to tracked columns';

-- ============================================================================
-- 3. ATTACH TRIGGERS
-- ============================================================================

-- service_events triggers
DROP TRIGGER IF EXISTS audit_service_events ON public.service_events;
CREATE TRIGGER audit_service_events
  AFTER INSERT OR UPDATE OR DELETE ON public.service_events
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_if_changed();

-- task_types triggers
DROP TRIGGER IF EXISTS audit_task_types ON public.task_types;
CREATE TRIGGER audit_task_types
  AFTER INSERT OR UPDATE OR DELETE ON public.task_types
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_if_changed();

-- service_categories triggers
DROP TRIGGER IF EXISTS audit_service_categories ON public.service_categories;
CREATE TRIGGER audit_service_categories
  AFTER INSERT OR UPDATE OR DELETE ON public.service_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_if_changed();

-- ============================================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- SELECT policy: Tenant users can read their tenant's audit log
CREATE POLICY "Tenant users can view their audit log"
  ON public.audit_log
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policies for clients - only triggers can write
-- The trigger function uses SECURITY DEFINER to bypass RLS

-- ============================================================================
-- 5. HELPER FUNCTION FOR HUMAN-READABLE SUMMARIES
-- ============================================================================

CREATE OR REPLACE FUNCTION public.format_audit_summary(
  p_entity_table TEXT,
  p_action TEXT,
  p_changes JSONB,
  p_entity_name TEXT,
  p_entity_code TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_summary TEXT;
  v_field TEXT;
  v_change JSONB;
  v_parts TEXT[] := ARRAY[]::TEXT[];
BEGIN
  -- Build entity identifier
  v_summary := CASE p_entity_table
    WHEN 'service_events' THEN
      CASE WHEN p_entity_code IS NOT NULL
        THEN format('Service "%s"', p_entity_code)
        ELSE 'Service'
      END
    WHEN 'task_types' THEN format('Task Type "%s"', COALESCE(p_entity_name, 'Unknown'))
    WHEN 'service_categories' THEN format('Category "%s"', COALESCE(p_entity_name, 'Unknown'))
    ELSE p_entity_table
  END;

  -- Build action summary
  IF p_action = 'INSERT' THEN
    RETURN v_summary || ' created';
  ELSIF p_action = 'DELETE' THEN
    RETURN v_summary || ' deleted';
  ELSIF p_action = 'UPDATE' AND p_changes IS NOT NULL THEN
    -- Build list of changed fields
    FOR v_field, v_change IN SELECT * FROM jsonb_each(p_changes)
    LOOP
      -- Format specific fields nicely
      IF v_field = 'rate' THEN
        v_parts := array_append(v_parts,
          format('rate: %s → %s',
            COALESCE((v_change->>'from')::TEXT, 'null'),
            COALESCE((v_change->>'to')::TEXT, 'null')
          )
        );
      ELSIF v_field = 'is_active' THEN
        IF (v_change->>'to')::BOOLEAN = FALSE THEN
          v_parts := array_append(v_parts, 'deactivated');
        ELSE
          v_parts := array_append(v_parts, 'activated');
        END IF;
      ELSIF v_field = 'default_service_code' THEN
        v_parts := array_append(v_parts,
          format('default service: %s → %s',
            COALESCE(v_change->>'from', 'none'),
            COALESCE(v_change->>'to', 'none')
          )
        );
      ELSE
        v_parts := array_append(v_parts,
          format('%s changed', v_field)
        );
      END IF;
    END LOOP;

    IF array_length(v_parts, 1) > 0 THEN
      RETURN v_summary || ': ' || array_to_string(v_parts, ', ');
    ELSE
      RETURN v_summary || ' updated';
    END IF;
  ELSE
    RETURN v_summary || ' ' || lower(p_action);
  END IF;
END;
$$;

COMMENT ON FUNCTION public.format_audit_summary IS 'Generate human-readable summary for audit log entries';

-- ============================================================================
-- 6. SUMMARY
-- ============================================================================
-- This migration creates:
-- 1. audit_log table with indexes
-- 2. Generic audit_if_changed() trigger function
-- 3. Triggers on service_events, task_types, service_categories
-- 4. RLS policies for tenant-scoped read access
-- 5. Helper function for human-readable summaries
--
-- Tracked changes:
-- - service_events: rate, billing_unit, billing_trigger, taxable, is_active,
--                   service_time_minutes, category_id, notes, uses_class_pricing
-- - task_types: category_id, default_service_code, requires_items, allow_rate_override,
--               is_active, name (custom only), description, sort_order
-- - service_categories: is_active, description, sort_order
--
-- NO BILLING LOGIC CHANGED - this is logging only.
-- ============================================================================
