-- ============================================================================
-- Phase 2.6: Backfill task_types.category_id using heuristics
-- ============================================================================
-- This migration fills in category_id for existing task_types rows where NULL.
--
-- Priority 1: If task_types.default_service_code or billing_service_code is set,
--             look up the category from service_events.
-- Priority 2: Text-based heuristic on task_types.name
--
-- Does NOT overwrite existing non-null category_id values.
-- ============================================================================

-- Create a function to backfill task_types categories for a tenant
CREATE OR REPLACE FUNCTION backfill_task_types_categories(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_receiving_id UUID;
  v_inspection_id UUID;
  v_assembly_id UUID;
  v_repair_id UUID;
  v_delivery_id UUID;
  v_storage_id UUID;
  v_disposal_id UUID;
  v_admin_id UUID;
  v_task RECORD;
  v_service_category_id UUID;
  v_matched_category_id UUID;
  v_task_name_lower TEXT;
BEGIN
  -- Get category IDs for this tenant
  SELECT id INTO v_receiving_id FROM service_categories
    WHERE tenant_id = p_tenant_id AND name = 'Receiving' LIMIT 1;
  SELECT id INTO v_inspection_id FROM service_categories
    WHERE tenant_id = p_tenant_id AND name = 'Inspection' LIMIT 1;
  SELECT id INTO v_assembly_id FROM service_categories
    WHERE tenant_id = p_tenant_id AND name = 'Assembly' LIMIT 1;
  SELECT id INTO v_repair_id FROM service_categories
    WHERE tenant_id = p_tenant_id AND name = 'Repair' LIMIT 1;
  SELECT id INTO v_delivery_id FROM service_categories
    WHERE tenant_id = p_tenant_id AND name = 'Delivery' LIMIT 1;
  SELECT id INTO v_storage_id FROM service_categories
    WHERE tenant_id = p_tenant_id AND name = 'Storage' LIMIT 1;
  SELECT id INTO v_disposal_id FROM service_categories
    WHERE tenant_id = p_tenant_id AND name = 'Disposal / Haul-away' LIMIT 1;
  SELECT id INTO v_admin_id FROM service_categories
    WHERE tenant_id = p_tenant_id AND name = 'Admin / Misc' LIMIT 1;

  -- If Admin/Misc not found, try to get any category as fallback
  IF v_admin_id IS NULL THEN
    SELECT id INTO v_admin_id FROM service_categories
      WHERE tenant_id = p_tenant_id AND is_active = true
      ORDER BY sort_order LIMIT 1;
  END IF;

  -- Loop through task_types that need category assignment
  FOR v_task IN
    SELECT id, name, default_service_code, billing_service_code
    FROM task_types
    WHERE tenant_id = p_tenant_id
    AND category_id IS NULL
  LOOP
    v_matched_category_id := NULL;

    -- Priority 1: Look up from service_events via default_service_code or billing_service_code
    IF v_task.default_service_code IS NOT NULL THEN
      SELECT category_id INTO v_service_category_id
      FROM service_events
      WHERE tenant_id = p_tenant_id
      AND service_code = v_task.default_service_code
      LIMIT 1;

      IF v_service_category_id IS NOT NULL THEN
        v_matched_category_id := v_service_category_id;
      END IF;
    END IF;

    -- Try billing_service_code if default didn't work
    IF v_matched_category_id IS NULL AND v_task.billing_service_code IS NOT NULL THEN
      SELECT category_id INTO v_service_category_id
      FROM service_events
      WHERE tenant_id = p_tenant_id
      AND service_code = v_task.billing_service_code
      LIMIT 1;

      IF v_service_category_id IS NOT NULL THEN
        v_matched_category_id := v_service_category_id;
      END IF;
    END IF;

    -- Priority 2: Text-based heuristic on task name
    IF v_matched_category_id IS NULL THEN
      v_task_name_lower := lower(v_task.name);

      -- Inspection category
      IF v_task_name_lower ~ '(insp|inspection|sit test|stocktake|stock take|count|cycle)' THEN
        v_matched_category_id := v_inspection_id;
      -- Receiving category
      ELSIF v_task_name_lower ~ '(receive|receiving|return|put away|putaway|palletize|unload|check in|checkin)' THEN
        v_matched_category_id := v_receiving_id;
      -- Assembly category
      ELSIF v_task_name_lower ~ '(assembly|assemble|kitting|kit|build|install)' THEN
        v_matched_category_id := v_assembly_id;
      -- Repair category
      ELSIF v_task_name_lower ~ '(repair|touch up|touchup|refurbish|restore|fix)' THEN
        v_matched_category_id := v_repair_id;
      -- Delivery category
      ELSIF v_task_name_lower ~ '(will call|willcall|pull|prep|delivery|ship|outbound|release|pick up|pickup|dispatch)' THEN
        v_matched_category_id := v_delivery_id;
      -- Storage category
      ELSIF v_task_name_lower ~ '(storage|store|warehouse|hold)' THEN
        v_matched_category_id := v_storage_id;
      -- Disposal category
      ELSIF v_task_name_lower ~ '(disposal|dispose|haul|dump|trash|discard|donate|donation)' THEN
        v_matched_category_id := v_disposal_id;
      -- Default to Admin/Misc
      ELSE
        v_matched_category_id := v_admin_id;
      END IF;
    END IF;

    -- Update the task_type if we found a category
    IF v_matched_category_id IS NOT NULL THEN
      UPDATE task_types
      SET category_id = v_matched_category_id
      WHERE id = v_task.id;
    END IF;
  END LOOP;
END;
$$;

-- Run backfill for all tenants that have task_types
DO $$
DECLARE
  v_tenant RECORD;
BEGIN
  FOR v_tenant IN
    SELECT DISTINCT tenant_id
    FROM task_types
    WHERE tenant_id IS NOT NULL
  LOOP
    PERFORM backfill_task_types_categories(v_tenant.tenant_id);
    RAISE NOTICE 'Backfilled task_types categories for tenant %', v_tenant.tenant_id;
  END LOOP;
END;
$$;

-- Also backfill task_types.default_service_code from billing_service_code if not set
-- This ensures the new column has data for existing rows
UPDATE task_types
SET default_service_code = billing_service_code
WHERE default_service_code IS NULL
AND billing_service_code IS NOT NULL;

-- ============================================================================
-- Summary
-- ============================================================================
-- This migration:
-- 1. Created backfill_task_types_categories function for heuristic category assignment
-- 2. Ran backfill for all existing tenants
-- 3. Synced default_service_code from billing_service_code where needed
--
-- Priority order:
-- 1. Match via default_service_code/billing_service_code -> service_events.category_id
-- 2. Text heuristic on task_types.name
-- 3. Default to Admin/Misc
-- ============================================================================
