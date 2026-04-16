/**
 * Task Completion Validation
 *
 * Validates that a task can be completed by checking:
 * 1. If requires_items = true, task must have ≥1 item
 * 2. If default_service_code IS NOT NULL (billable), rates must exist
 *
 * This does NOT change billing calculations - only prevents completion
 * when required data is missing.
 */

import { supabase } from '@/integrations/supabase/client';
import { getEffectiveRate } from '@/lib/billing/chargeTypeUtils';

// ============================================================================
// TYPES
// ============================================================================

export interface TaskTypeConfig {
  id: string;
  name: string;
  default_service_code: string | null;
  requires_items: boolean;
}

export interface TaskItemWithClass {
  item_id: string;
  item_code: string;
  class_code: string | null;
}

export interface MissingRate {
  item_code: string | null;
  class_code: string | null;
  service_code: string;
}

export interface TaskCompletionValidationResult {
  canComplete: boolean;
  issues: string[];
  missingItems: boolean;
  missingRates: MissingRate[];
  taskTypeConfig: TaskTypeConfig | null;
}

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Get task type configuration from database
 */
export async function getTaskTypeConfig(
  tenantId: string,
  taskTypeName: string
): Promise<TaskTypeConfig | null> {
  try {
    const { data, error } = await (supabase
      .from('task_types') as any)
      .select('id, name, default_service_code, requires_items')
      .eq('tenant_id', tenantId)
      .eq('name', taskTypeName)
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      console.error('[getTaskTypeConfig] Error:', error);
      return null;
    }

    return data || null;
  } catch (error) {
    console.error('[getTaskTypeConfig] Error:', error);
    return null;
  }
}

/**
 * Get items associated with a task
 * Items store class_id (FK to classes table), not class_code directly.
 * We fetch items with class_id, then look up class codes from the classes table.
 */
export async function getTaskItemsWithClass(
  taskId: string,
  tenantId: string
): Promise<TaskItemWithClass[]> {
  try {
    const { data, error } = await (supabase
      .from('task_items') as any)
      .select(`
        item_id,
        items:item_id(item_code, class_id)
      `)
      .eq('task_id', taskId);

    if (error) {
      console.error('[getTaskItemsWithClass] Error:', error);
      return [];
    }

    // Collect unique class_ids to look up class codes
    const rawClassIds: string[] = (data || [])
      .map((ti: any) => ti.items?.class_id as string | undefined)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    const classIds = Array.from(new Set(rawClassIds));

    // Fetch class codes from classes table
    let classMap = new Map<string, string>();
    if (classIds.length > 0) {
      const { data: classes } = await supabase
        .from('classes')
        .select('id, code')
        .eq('tenant_id', tenantId)
        .in('id', classIds);

      classMap = new Map((classes || []).map((c: any) => [c.id, c.code]));
    }

    return (data || []).map((ti: any) => ({
      item_id: ti.item_id,
      item_code: ti.items?.item_code || 'Unknown',
      class_code: ti.items?.class_id ? (classMap.get(ti.items.class_id) || null) : null,
    }));
  } catch (error) {
    console.error('[getTaskItemsWithClass] Error:', error);
    return [];
  }
}

/**
 * Check if a rate exists for a service code + class code combination.
 * Uses unified pricing (new system first, legacy fallback).
 * Returns true if a non-zero rate can be resolved.
 */
export async function checkRateExists(
  tenantId: string,
  serviceCode: string,
  classCode: string | null
): Promise<boolean> {
  try {
    const result = await getEffectiveRate({
      tenantId,
      chargeCode: serviceCode,
      classCode: classCode || undefined,
    });

    return !result.has_error && result.effective_rate > 0;
  } catch (error) {
    console.error('[checkRateExists] Error:', error);
    return false;
  }
}

/**
 * Main validation function for task completion
 *
 * Returns validation result with:
 * - canComplete: boolean indicating if task can be completed
 * - issues: array of human-readable issue descriptions
 * - missingItems: true if requires_items but no items
 * - missingRates: array of missing rate details
 */
export async function validateTaskCompletion(
  tenantId: string,
  taskId: string,
  taskTypeName: string
): Promise<TaskCompletionValidationResult> {
  const result: TaskCompletionValidationResult = {
    canComplete: true,
    issues: [],
    missingItems: false,
    missingRates: [],
    taskTypeConfig: null,
  };

  // Get task type configuration
  const taskTypeConfig = await getTaskTypeConfig(tenantId, taskTypeName);
  result.taskTypeConfig = taskTypeConfig;

  // If no config found, allow completion (legacy/non-system task type)
  if (!taskTypeConfig) {
    return result;
  }

  // Check requires_items
  if (taskTypeConfig.requires_items) {
    const items = await getTaskItemsWithClass(taskId, tenantId);
    if (items.length === 0) {
      result.canComplete = false;
      result.missingItems = true;
      result.issues.push('This task requires items. Add at least one item before completing.');
    }
  }

  // Check billable pricing (only if default_service_code is set)
  if (taskTypeConfig.default_service_code) {
    const serviceCode = taskTypeConfig.default_service_code;

    if (taskTypeConfig.requires_items) {
      // Item-based task: check each item has a rate
      const items = await getTaskItemsWithClass(taskId, tenantId);

      for (const item of items) {
        const hasRate = await checkRateExists(tenantId, serviceCode, item.class_code);
        if (!hasRate) {
          result.canComplete = false;
          result.missingRates.push({
            item_code: item.item_code,
            class_code: item.class_code,
            service_code: serviceCode,
          });
        }
      }

      if (result.missingRates.length > 0) {
        const rateDetails = result.missingRates
          .map(r => `${r.service_code}${r.class_code ? ` (${r.class_code})` : ''}`)
          .filter((v, i, a) => a.indexOf(v) === i) // unique
          .join(', ');
        result.issues.push(`Missing rate for: ${rateDetails}. Set rates in Price List before completing.`);
      }
    } else {
      // Account-level task: check general rate exists
      const hasRate = await checkRateExists(tenantId, serviceCode, null);
      if (!hasRate) {
        result.canComplete = false;
        result.missingRates.push({
          item_code: null,
          class_code: null,
          service_code: serviceCode,
        });
        result.issues.push(`Missing rate for: ${serviceCode}. Set rate in Price List before completing.`);
      }
    }
  }

  return result;
}

/**
 * Check if a task is billable (has default_service_code)
 */
export function isBillableTask(taskTypeConfig: TaskTypeConfig | null): boolean {
  return !!(taskTypeConfig?.default_service_code);
}

/**
 * Format missing rate for display
 */
export function formatMissingRate(rate: MissingRate): string {
  if (rate.class_code) {
    return `${rate.service_code} for class ${rate.class_code}`;
  }
  return rate.service_code;
}
