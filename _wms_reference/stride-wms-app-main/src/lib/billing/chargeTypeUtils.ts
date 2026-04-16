/**
 * chargeTypeUtils.ts
 *
 * Single source of truth for rate lookups using the new charge_types + pricing_rules system.
 * This replaces the legacy service_events lookup while maintaining backward compatibility.
 */

import { supabase } from '@/integrations/supabase/client';

// =============================================================================
// TYPES
// =============================================================================

export interface ChargeType {
  id: string;
  tenant_id: string;
  charge_code: string;
  charge_name: string;
  category: string;
  is_active: boolean;
  is_taxable: boolean;
  default_trigger: 'manual' | 'task' | 'shipment' | 'storage' | 'auto';
  input_mode: 'qty' | 'time' | 'both';
  qty_step: number;
  min_qty: number;
  time_unit_default: string;
  min_minutes: number;
  add_to_scan: boolean;
  add_flag: boolean;
  alert_rule: string;
  notes: string | null;
  legacy_service_code: string | null;
}

export interface PricingRule {
  id: string;
  tenant_id: string;
  charge_type_id: string;
  pricing_method: 'flat' | 'class_based' | 'tiered';
  class_code: string | null;
  unit: string;
  rate: number;
  minimum_charge: number;
  is_default: boolean;
  service_time_minutes: number;
}

export interface EffectiveRateResult {
  // Charge type info
  charge_type_id: string | null;
  charge_code: string;
  charge_name: string | null;
  category: string | null;
  is_taxable: boolean;
  default_trigger: string;
  input_mode: string;
  service_time_minutes: number;
  add_to_scan: boolean;
  add_flag: boolean;

  // Alert rule
  alert_rule: string;

  // Rate info
  unit: string;
  base_rate: number;
  effective_rate: number;

  // Adjustment info
  adjustment_type: string | null;
  adjustment_applied: boolean;

  // Error handling
  has_error: boolean;
  error_message: string | null;
}

export interface GetEffectiveRateParams {
  tenantId: string;
  chargeCode: string;
  accountId?: string | null;
  classCode?: string | null;
}

// Legacy billing_unit values for compatibility mapping
export type LegacyBillingUnit = 'Day' | 'Item' | 'Task' | 'Hour' | 'Minute' | 'Month' | 'Qty';

// Legacy billing_trigger display values
export type LegacyBillingTrigger = 'SCAN EVENT' | 'AUTOCALCULATE' | 'Flag' | 'Manual' | 'Task Completion' | 'Shipment';

/**
 * Error message thrown when billing is disabled for a service on an account.
 * Callers that create billing events MUST catch this and prevent event creation.
 */
export const BILLING_DISABLED_ERROR =
  'Billing for this service is disabled for this account. Please update account pricing settings to continue.';


// =============================================================================
// UNIT MAPPING
// =============================================================================

/**
 * Map new pricing_rules.unit to legacy billing_unit format
 */
export function mapUnitToLegacy(unit: string): LegacyBillingUnit {
  const mapping: Record<string, LegacyBillingUnit> = {
    'per_day': 'Day',
    'per_item': 'Item',
    'per_task': 'Task',
    'per_hour': 'Hour',
    'per_minute': 'Minute',
    'per_month': 'Month',
    'each': 'Qty',
    'qty': 'Qty',
  };
  return mapping[unit?.toLowerCase()] || 'Qty';
}

/**
 * Map legacy billing_unit to new unit format
 */
export function mapLegacyToUnit(billingUnit: string): string {
  const mapping: Record<string, string> = {
    'day': 'per_day',
    'item': 'per_item',
    'task': 'per_task',
    'hour': 'per_hour',
    'minute': 'per_minute',
    'month': 'per_month',
    'qty': 'each',
  };
  return mapping[billingUnit?.toLowerCase()] || 'each';
}

/**
 * Map new default_trigger to legacy billing_trigger display format
 */
export function mapTriggerToLegacy(trigger: string): LegacyBillingTrigger {
  const mapping: Record<string, LegacyBillingTrigger> = {
    'manual': 'Manual',
    'task': 'Task Completion',
    'shipment': 'Shipment',
    'storage': 'AUTOCALCULATE',
    'auto': 'AUTOCALCULATE',
  };
  return mapping[trigger?.toLowerCase()] || 'Manual';
}

/**
 * Map legacy billing_trigger to new trigger format
 */
export function mapLegacyToTrigger(billingTrigger: string): string {
  if (!billingTrigger) return 'manual';
  const lower = billingTrigger.toLowerCase();

  if (lower.includes('auto') || lower.includes('calculate')) return 'auto';
  if (lower.includes('task') || lower.includes('completion')) return 'task';
  if (lower.includes('ship') || lower.includes('receive') || lower.includes('inbound') || lower.includes('outbound')) return 'shipment';
  if (lower.includes('storage') || lower.includes('day') || lower.includes('month')) return 'storage';
  if (lower.includes('scan')) return 'manual'; // scan events are triggered manually via Service Event Scan
  if (lower.includes('flag')) return 'manual'; // flags are triggered manually

  return 'manual';
}


// =============================================================================
// CORE RATE LOOKUP
// =============================================================================

/**
 * Get the effective rate for a charge code.
 *
 * This is the single source of truth for rate lookups in the new system.
 *
 * Lookup steps:
 * 1) Find charge_types by tenant_id + charge_code
 * 2) Choose pricing_rules:
 *    - if classCode and a class_based rule exists -> use it
 *    - else use is_default=true rule
 *    - else use first rule
 * 3) Apply account adjustments from account_service_settings
 * 4) Return effective rate and metadata
 */
export async function getEffectiveRate(params: GetEffectiveRateParams): Promise<EffectiveRateResult> {
  const { tenantId, chargeCode, accountId, classCode } = params;

  // Default error result
  const errorResult: EffectiveRateResult = {
    charge_type_id: null,
    charge_code: chargeCode,
    charge_name: null,
    category: null,
    is_taxable: false,
    default_trigger: 'manual',
    input_mode: 'qty',
    service_time_minutes: 0,
    add_to_scan: false,
    add_flag: false,
    alert_rule: 'none',
    unit: 'each',
    base_rate: 0,
    effective_rate: 0,
    adjustment_type: null,
    adjustment_applied: false,
    has_error: true,
    error_message: null,
  };

  try {
    // Try new system first (charge_types + pricing_rules)
    const newSystemResult = await getEffectiveRateFromNewSystem(params);

    if (!newSystemResult.has_error) {
      return newSystemResult;
    }

    // Fall back to legacy service_events if new system fails
    const legacyResult = await getEffectiveRateFromLegacy(params);

    if (!legacyResult.has_error) {
      // Log fallback occurrence
      console.warn(`[pricing-fallback] tenant=${tenantId} service=${chargeCode} — new system failed, used legacy service_events`);
      logPricingFallback(tenantId, chargeCode, 'rate_lookup');
      return legacyResult;
    }

    // Both systems failed - return error from new system
    return newSystemResult;

  } catch (error) {
    console.error('[chargeTypeUtils] Error in getEffectiveRate:', error);
    return {
      ...errorResult,
      error_message: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Get rate from the new charge_types + pricing_rules system
 */
async function getEffectiveRateFromNewSystem(params: GetEffectiveRateParams): Promise<EffectiveRateResult> {
  const { tenantId, chargeCode, accountId, classCode } = params;

  const errorResult: EffectiveRateResult = {
    charge_type_id: null,
    charge_code: chargeCode,
    charge_name: null,
    category: null,
    is_taxable: false,
    default_trigger: 'manual',
    input_mode: 'qty',
    service_time_minutes: 0,
    add_to_scan: false,
    add_flag: false,
    alert_rule: 'none',
    unit: 'each',
    base_rate: 0,
    effective_rate: 0,
    adjustment_type: null,
    adjustment_applied: false,
    has_error: true,
    error_message: null,
  };

  // Step 1: Find charge_type
  const { data: chargeType, error: ctError } = await supabase
    .from('charge_types')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('charge_code', chargeCode)
    .maybeSingle();

  if (ctError) {
    // Table might not exist yet (before migration)
    if (ctError.code === '42P01') {
      return { ...errorResult, error_message: 'charge_types table not found - migration pending' };
    }
    return { ...errorResult, error_message: ctError.message };
  }

  if (!chargeType) {
    return { ...errorResult, error_message: `Charge type not found: ${chargeCode}` };
  }

  // Step 2: Find pricing rule
  let pricingRule: PricingRule | null = null;

  // Try class-specific rule first
  if (classCode) {
    const { data: classRule } = await supabase
      .from('pricing_rules')
      .select('*')
      .eq('charge_type_id', chargeType.id)
      .eq('class_code', classCode)
      .maybeSingle();

    if (classRule) {
      pricingRule = classRule as PricingRule;
    }
  }

  // Fall back to default rule
  if (!pricingRule) {
    const { data: defaultRule } = await supabase
      .from('pricing_rules')
      .select('*')
      .eq('charge_type_id', chargeType.id)
      .eq('is_default', true)
      .maybeSingle();

    if (defaultRule) {
      pricingRule = defaultRule as PricingRule;
    }
  }

  // Fall back to any rule
  if (!pricingRule) {
    const { data: anyRule } = await supabase
      .from('pricing_rules')
      .select('*')
      .eq('charge_type_id', chargeType.id)
      .order('class_code', { ascending: true, nullsFirst: true })
      .limit(1)
      .maybeSingle();

    if (anyRule) {
      pricingRule = anyRule as PricingRule;
    }
  }

  if (!pricingRule) {
    return { ...errorResult, error_message: `No pricing rule found for: ${chargeCode}` };
  }

  const baseRate = pricingRule.rate || 0;
  let effectiveRate = baseRate;
  let adjustmentType: string | null = null;
  let adjustmentApplied = false;

  // Step 3: Apply account adjustments from account_service_settings
  if (accountId) {
    const accountSetting = await lookupAccountServiceSetting(accountId, chargeCode, classCode);

    if (accountSetting) {
      // Check if billing is disabled for this account + service
      if (accountSetting.is_enabled === false) {
        throw new Error(BILLING_DISABLED_ERROR);
      }

      adjustmentApplied = true;

      if (accountSetting.custom_rate !== null && accountSetting.custom_rate !== undefined) {
        effectiveRate = accountSetting.custom_rate;
        adjustmentType = 'override';
      } else if (accountSetting.custom_percent_adjust !== null && accountSetting.custom_percent_adjust !== undefined) {
        effectiveRate = baseRate * (1 + accountSetting.custom_percent_adjust / 100);
        adjustmentType = 'percentage';
      }
    }
  }

  return {
    charge_type_id: chargeType.id,
    charge_code: chargeType.charge_code,
    charge_name: chargeType.charge_name,
    category: chargeType.category,
    is_taxable: chargeType.is_taxable || false,
    default_trigger: chargeType.default_trigger || 'manual',
    input_mode: chargeType.input_mode || 'qty',
    service_time_minutes: pricingRule.service_time_minutes || 0,
    add_to_scan: chargeType.add_to_scan || false,
    add_flag: chargeType.add_flag || false,
    alert_rule: chargeType.alert_rule || 'none',
    unit: pricingRule.unit || 'each',
    base_rate: baseRate,
    effective_rate: effectiveRate,
    adjustment_type: adjustmentType,
    adjustment_applied: adjustmentApplied,
    has_error: false,
    error_message: null,
  };
}

/**
 * Fallback: Get rate from legacy service_events system
 */
async function getEffectiveRateFromLegacy(params: GetEffectiveRateParams): Promise<EffectiveRateResult> {
  const { tenantId, chargeCode, accountId, classCode } = params;

  const errorResult: EffectiveRateResult = {
    charge_type_id: null,
    charge_code: chargeCode,
    charge_name: null,
    category: null,
    is_taxable: false,
    default_trigger: 'manual',
    input_mode: 'qty',
    service_time_minutes: 0,
    add_to_scan: false,
    add_flag: false,
    alert_rule: 'none',
    unit: 'each',
    base_rate: 0,
    effective_rate: 0,
    adjustment_type: null,
    adjustment_applied: false,
    has_error: true,
    error_message: null,
  };

  // Try class-specific rate first
  let serviceEvent = null;

  if (classCode) {
    const { data } = await supabase
      .from('service_events')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('service_code', chargeCode)
      .eq('class_code', classCode)
      .eq('is_active', true)
      .maybeSingle();

    if (data) {
      serviceEvent = data;
    }
  }

  // Fall back to flat rate (no class)
  if (!serviceEvent) {
    const { data } = await supabase
      .from('service_events')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('service_code', chargeCode)
      .is('class_code', null)
      .eq('is_active', true)
      .maybeSingle();

    if (data) {
      serviceEvent = data;
    }
  }

  // Fall back to any matching service_code
  if (!serviceEvent) {
    const { data } = await supabase
      .from('service_events')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('service_code', chargeCode)
      .eq('is_active', true)
      .order('class_code', { ascending: true, nullsFirst: true })
      .limit(1)
      .maybeSingle();

    if (data) {
      serviceEvent = data;
    }
  }

  if (!serviceEvent) {
    return { ...errorResult, error_message: `Service not found: ${chargeCode}` };
  }

  const baseRate = serviceEvent.rate || 0;
  let effectiveRate = baseRate;
  let adjustmentType: string | null = null;
  let adjustmentApplied = false;

  // Check account_service_settings for adjustments
  if (accountId) {
    const accountSetting = await lookupAccountServiceSetting(accountId, chargeCode, classCode);

    if (accountSetting) {
      // Check if billing is disabled for this account + service
      if (accountSetting.is_enabled === false) {
        throw new Error(BILLING_DISABLED_ERROR);
      }

      adjustmentApplied = true;

      if (accountSetting.custom_rate !== null && accountSetting.custom_rate !== undefined) {
        // Override rate
        effectiveRate = accountSetting.custom_rate;
        adjustmentType = 'override';
      } else if (accountSetting.custom_percent_adjust !== null && accountSetting.custom_percent_adjust !== undefined) {
        // Percentage adjustment
        effectiveRate = baseRate * (1 + accountSetting.custom_percent_adjust / 100);
        adjustmentType = 'percentage';
      }
    }
  }

  return {
    charge_type_id: null, // Legacy system doesn't have this
    charge_code: serviceEvent.service_code,
    charge_name: serviceEvent.service_name,
    category: 'service', // Legacy doesn't have category
    is_taxable: serviceEvent.taxable || false,
    default_trigger: mapLegacyToTrigger(serviceEvent.billing_trigger),
    input_mode: serviceEvent.billing_unit?.toLowerCase().includes('hour') ||
                serviceEvent.billing_unit?.toLowerCase().includes('minute') ? 'time' : 'qty',
    service_time_minutes: serviceEvent.service_time_minutes || 0,
    add_to_scan: serviceEvent.add_to_service_event_scan || false,
    add_flag: serviceEvent.add_flag || false,
    alert_rule: serviceEvent.alert_rule || 'none',
    unit: mapLegacyToUnit(serviceEvent.billing_unit || 'Item'),
    base_rate: baseRate,
    effective_rate: effectiveRate,
    adjustment_type: adjustmentType,
    adjustment_applied: adjustmentApplied,
    has_error: false,
    error_message: null,
  };
}


// =============================================================================
// PRICING FALLBACK LOG
// =============================================================================

/**
 * Log a pricing fallback event. Best-effort: failure to log must NOT break the user flow.
 * Note: Logs to console only since pricing_fallback_log table may not exist
 */
function logPricingFallback(tenantId: string, serviceCode: string, context: string): void {
  console.warn(`[pricing-fallback] tenant=${tenantId} service=${serviceCode} context=${context}`);
}

/**
 * Explicitly log a pricing fallback from an external caller.
 * Use this when a caller bypasses getEffectiveRate() (e.g. category_id lookup).
 */
export function logPricingFallbackExternal(tenantId: string, serviceCode: string, context: string): void {
  console.warn(`[pricing-fallback] tenant=${tenantId} service=${serviceCode} context=${context} — used legacy service_events`);
  logPricingFallback(tenantId, serviceCode, context);
}


// =============================================================================
// RATE RESULT ADAPTER
// =============================================================================

/**
 * Convert EffectiveRateResult to the legacy RateLookupResult shape
 * used by billingCalculation.ts and other callers.
 */
export function toRateLookupResult(r: EffectiveRateResult): {
  rate: number;
  serviceName: string;
  serviceCode: string;
  billingUnit: string;
  // New: return raw unit + service time for estimates
  unit?: string;
  serviceTimeMinutes?: number;
  alertRule: string;
  hasError: boolean;
  errorMessage?: string;
} {
  return {
    rate: r.effective_rate,
    serviceName: r.charge_name || r.charge_code,
    serviceCode: r.charge_code,
    billingUnit: mapUnitToLegacy(r.unit),
    unit: r.unit,
    serviceTimeMinutes: r.service_time_minutes ?? 0,
    alertRule: r.alert_rule,
    hasError: r.has_error,
    errorMessage: r.error_message || undefined,
  };
}


// =============================================================================
// ACCOUNT SERVICE SETTINGS LOOKUP
// =============================================================================

/**
 * Lookup account_service_settings for a given account + service_code.
 *
 * Logic:
 * 1) Query by account_id + service_code (charge_code)
 * 2) If classCode is provided:
 *    - First try exact match where class_code = classCode
 *    - If not found, fallback to row where class_code IS NULL
 * 3) If no classCode, use row where class_code IS NULL (or first row)
 */
async function lookupAccountServiceSetting(
  accountId: string,
  serviceCode: string,
  classCode?: string | null,
): Promise<any | null> {
  const { data: rows, error } = await supabase
    .from('account_service_settings')
    .select('*')
    .eq('account_id', accountId)
    .eq('service_code', serviceCode);

  if (error || !rows || rows.length === 0) {
    return null;
  }

  // Single row — return it directly
  if (rows.length === 1) {
    return rows[0];
  }

  // Multiple rows — pick best match based on class_code
  if (classCode) {
    // Try exact class_code match first
    const exactMatch = rows.find((r: any) => r.class_code === classCode);
    if (exactMatch) return exactMatch;

    // Fallback to row with class_code IS NULL
    const nullMatch = rows.find((r: any) => !r.class_code);
    if (nullMatch) return nullMatch;
  } else {
    // No classCode — prefer row with class_code IS NULL
    const nullMatch = rows.find((r: any) => !r.class_code);
    if (nullMatch) return nullMatch;
  }

  // Last resort: return first row
  return rows[0];
}


// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get all active charge types for a tenant (for UI lists)
 */
export async function getChargeTypes(tenantId: string): Promise<ChargeType[]> {
  const { data, error } = await supabase
    .from('charge_types')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('charge_name');

  if (error) {
    console.error('[chargeTypeUtils] Error fetching charge types:', error);
    return [];
  }

  return (data || []) as ChargeType[];
}

/**
 * Get charge types for Service Event Scan (add_to_scan = true)
 */
export async function getScanChargeTypes(tenantId: string): Promise<ChargeType[]> {
  const { data, error } = await supabase
    .from('charge_types')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('add_to_scan', true)
    .order('charge_name');

  if (error) {
    console.error('[chargeTypeUtils] Error fetching scan charge types:', error);
    return [];
  }

  return (data || []) as ChargeType[];
}

/**
 * Get charge types that add flags (add_flag = true)
 */
export async function getFlagChargeTypes(tenantId: string): Promise<ChargeType[]> {
  const { data, error } = await supabase
    .from('charge_types')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('add_flag', true)
    .order('charge_name');

  if (error) {
    console.error('[chargeTypeUtils] Error fetching flag charge types:', error);
    return [];
  }

  return (data || []) as ChargeType[];
}

/**
 * Get pricing rules for a charge type
 */
export async function getPricingRules(chargeTypeId: string): Promise<PricingRule[]> {
  const { data, error } = await supabase
    .from('pricing_rules')
    .select('*')
    .eq('charge_type_id', chargeTypeId)
    .order('class_code', { ascending: true, nullsFirst: true });

  if (error) {
    console.error('[chargeTypeUtils] Error fetching pricing rules:', error);
    return [];
  }

  return (data || []) as PricingRule[];
}

/**
 * Get charge types linked to a task type
 * 
 * Note: If task_type_charge_links table or relationship doesn't exist,
 * this returns an empty array gracefully.
 */
export async function getTaskTypeCharges(taskTypeId: string): Promise<ChargeType[]> {
  try {
    // First get the charge_type_ids from the linking table
    const { data: links, error: linksError } = await (supabase as any)
      .from('task_type_charge_links')
      .select('charge_type_id')
      .eq('task_type_id', taskTypeId);

    if (linksError) {
      // Table might not exist or relationship error - silently return empty
      if (linksError.code === 'PGRST200' || linksError.code === '42P01') {
        return [];
      }
      console.error('[chargeTypeUtils] Error fetching task type charge links:', linksError);
      return [];
    }

    if (!links || links.length === 0) {
      return [];
    }

    // Extract unique charge_type_ids
    const chargeTypeIds = [...new Set(links.map((l: any) => l.charge_type_id).filter(Boolean))] as string[];
    
    if (chargeTypeIds.length === 0) {
      return [];
    }

    // Fetch the actual charge types
    const { data: chargeTypes, error: ctError } = await supabase
      .from('charge_types')
      .select('*')
      .in('id', chargeTypeIds);

    if (ctError) {
      console.error('[chargeTypeUtils] Error fetching charge types:', ctError);
      return [];
    }

    return (chargeTypes || []) as ChargeType[];
  } catch (error) {
    console.error('[chargeTypeUtils] Error in getTaskTypeCharges:', error);
    return [];
  }
}


// =============================================================================
// METADATA HELPERS FOR BILLING_EVENTS
// =============================================================================

export type BillingSourceType = 'manual' | 'task' | 'scan' | 'shipment' | 'storage' | 'flag';

export interface BillingMetadata {
  source_type: BillingSourceType;
  source_id?: string;
  source_label?: string;
  charge_type_id?: string;
  base_rate?: number;
  adjustment_applied?: boolean;
  adjustment_type?: string;
  [key: string]: any; // Allow additional metadata
}

/**
 * Create metadata object for billing_events
 */
export function createBillingMetadata(
  sourceType: BillingSourceType,
  sourceId?: string,
  rateResult?: EffectiveRateResult,
  additionalData?: Record<string, any>
): BillingMetadata {
  const metadata: BillingMetadata = {
    source_type: sourceType,
  };

  if (sourceId) {
    metadata.source_id = sourceId;
  }

  if (rateResult) {
    metadata.charge_type_id = rateResult.charge_type_id || undefined;
    metadata.base_rate = rateResult.base_rate;

    if (rateResult.adjustment_applied) {
      metadata.adjustment_applied = true;
      metadata.adjustment_type = rateResult.adjustment_type || undefined;
    }
  }

  if (additionalData) {
    Object.assign(metadata, additionalData);
  }

  return metadata;
}
