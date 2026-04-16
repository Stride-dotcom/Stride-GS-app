/**
 * Resolve which repair task type to use for a given purpose.
 *
 * Precedence (highest to lowest):
 * 1. Account override (if set and valid)
 * 2. Organization default (if set and valid)
 * 3. Fallback: first active repair task type by created_at
 *
 * Returns null if no valid repair type found (caller handles gracefully).
 * Does NOT throw. Logs warnings to console.
 */

import { supabase } from '@/integrations/supabase/client';

export interface ResolvedRepairTaskType {
  id: string;
  name: string;
  primary_service_code: string | null;
  default_service_code: string | null;
}

export async function resolveRepairTaskTypeId(params: {
  tenantId: string;
  accountId: string | null;
  purpose: 'damage' | 'quote';
}): Promise<string | null> {
  const { tenantId, accountId, purpose } = params;

  const columnName = purpose === 'damage'
    ? 'repair_task_type_id_for_damage'
    : 'repair_task_type_id_for_quote';

  console.debug(`[resolveRepairTaskTypeId] Starting resolution for purpose="${purpose}"`);

  // LEVEL 1: Account Override (if accountId provided)
  if (accountId) {
    try {
      const { data: account, error } = await (supabase
        .from('accounts') as any)
        .select(columnName)
        .eq('id', accountId)
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (error) {
        console.warn(`[resolveRepairTaskTypeId] Account query failed: ${error.message}`);
      } else if (account?.[columnName]) {
        const overrideId = account[columnName];
        console.debug(`[resolveRepairTaskTypeId] Found account override: ${overrideId}`);

        // Verify the override is still valid (exists, is repair kind, is active)
        const { data: verifyType, error: verifyError } = await (supabase
          .from('task_types') as any)
          .select('id')
          .eq('id', overrideId)
          .eq('tenant_id', tenantId)
          .eq('task_kind', 'repair')
          .eq('is_active', true)
          .maybeSingle();

        if (verifyError) {
          console.warn(`[resolveRepairTaskTypeId] Override verification failed: ${verifyError.message}`);
        } else if (verifyType?.id) {
          console.debug(`[resolveRepairTaskTypeId] Using account override: ${overrideId}`);
          return overrideId;
        } else {
          console.warn(`[resolveRepairTaskTypeId] Account override ${overrideId} is no longer valid (deleted, inactive, or wrong kind)`);
        }
      }
    } catch (err) {
      console.error(`[resolveRepairTaskTypeId] Unexpected error in account override:`, err);
    }
  }

  // LEVEL 2: Organization Default
  const orgColumnName = `default_${columnName}`;
  try {
    const { data: settings, error } = await (supabase
      .from('tenant_company_settings') as any)
      .select(orgColumnName)
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (error) {
      console.warn(`[resolveRepairTaskTypeId] Org settings query failed: ${error.message}`);
    } else if (settings?.[orgColumnName]) {
      const orgDefaultId = settings[orgColumnName];
      console.debug(`[resolveRepairTaskTypeId] Found org default: ${orgDefaultId}`);

      // Verify the org default is still valid
      const { data: verifyType, error: verifyError } = await (supabase
        .from('task_types') as any)
        .select('id')
        .eq('id', orgDefaultId)
        .eq('tenant_id', tenantId)
        .eq('task_kind', 'repair')
        .eq('is_active', true)
        .maybeSingle();

      if (verifyError) {
        console.warn(`[resolveRepairTaskTypeId] Org default verification failed: ${verifyError.message}`);
      } else if (verifyType?.id) {
        console.debug(`[resolveRepairTaskTypeId] Using org default: ${orgDefaultId}`);
        return orgDefaultId;
      } else {
        console.warn(`[resolveRepairTaskTypeId] Org default ${orgDefaultId} is no longer valid`);
      }
    }
  } catch (err) {
    console.error(`[resolveRepairTaskTypeId] Unexpected error in org default:`, err);
  }

  // LEVEL 3: Fallback to First Active Repair Task Type (by created_at)
  try {
    const { data: repairType, error } = await (supabase
      .from('task_types') as any)
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('task_kind', 'repair')
      .eq('is_active', true)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn(`[resolveRepairTaskTypeId] Fallback query failed: ${error.message}`);
    } else if (repairType?.id) {
      console.debug(`[resolveRepairTaskTypeId] Using fallback repair type: ${repairType.id}`);
      return repairType.id;
    }
  } catch (err) {
    console.error(`[resolveRepairTaskTypeId] Unexpected error in fallback:`, err);
  }

  // FINAL: No repair task type found at any level
  console.warn(`[resolveRepairTaskTypeId] No repair task type found for tenant ${tenantId}, purpose="${purpose}"`);
  return null;
}

/**
 * Fetch full repair task type details by ID.
 * Returns null if not found. Does NOT throw.
 */
export async function fetchRepairTaskTypeDetails(
  taskTypeId: string
): Promise<ResolvedRepairTaskType | null> {
  try {
    const { data, error } = await (supabase
      .from('task_types') as any)
      .select('id, name, primary_service_code, default_service_code')
      .eq('id', taskTypeId)
      .maybeSingle();

    if (error) {
      console.error(`[fetchRepairTaskTypeDetails] Query failed: ${error.message}`);
      return null;
    }

    return data || null;
  } catch (err) {
    console.error(`[fetchRepairTaskTypeDetails] Unexpected error:`, err);
    return null;
  }
}
