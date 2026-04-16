/**
 * Shared Billing Calculation Logic
 *
 * This module contains the core billing calculation logic used by:
 * 1. BillingCalculator component (preview before triggering)
 * 2. Actual billing event creation (when task/shipment completes)
 *
 * BILLING MODEL (Simplified):
 * - Task Types define a category_id (no longer a service_code)
 * - Each item has a class_id (linked to classes table)
 * - Service lookup: category_id + class_code → unique service rate
 * - One service per (category, class) combination
 *
 * SERVICE TYPES:
 * 1. Class-based (uses_class_pricing=true): 6 rows per service (XS/S/M/L/XL/XXL)
 *    - Lookup by category_id + class_code
 *    - Rate varies by item class
 *    - Example: INSP (Inspection) - different rates per item size
 *
 * 2. Flat-rate (uses_class_pricing=false): Single row with class_code=NULL
 *    - Applies same rate regardless of item class
 *    - Example: 1HRO (1-hour repair), 60MA (60-minute assembly)
 *
 * By sharing this logic, we guarantee the Calculator shows EXACTLY
 * what will appear in Billing Reports once the event is triggered.
 *
 * =============================================================================
 * TEST CASES
 * =============================================================================
 *
 * TEST CASE 1: INSP (Inspection) - Class-based per-item billing
 * -----------------------------------------------------------------------------
 * Setup:
 * - Service: INSP, uses_class_pricing=true
 * - 6 rows in service_events: INSP/XS=$5, INSP/S=$7, INSP/M=$10, INSP/L=$15, INSP/XL=$20, INSP/XXL=$25
 * - Task Type "Inspection" has category_id pointing to "Inspection" category
 *
 * Scenario:
 * - Task with 3 items: 1x class=S, 2x class=L
 *
 * Expected billing:
 * - Line 1: Item (S) @ $7.00 = $7.00
 * - Line 2: Item (L) @ $15.00 = $15.00
 * - Line 3: Item (L) @ $15.00 = $15.00
 * - Total: $37.00
 *
 * TEST CASE 2: 1HRO (1-Hour Repair) - Flat-rate per-task billing
 * -----------------------------------------------------------------------------
 * Setup:
 * - Service: 1HRO, uses_class_pricing=false
 * - 1 row in service_events: 1HRO, class_code=NULL, rate=$95, billing_unit="Hour"
 * - Task Type "Repair" has category_id pointing to "Repair" category
 *
 * Scenario:
 * - Task with any number of items, billing_quantity=2 (hours worked)
 *
 * Expected billing:
 * - Line 1: 1-Hour Repair @ $95.00 x 2 = $190.00
 * - Total: $190.00
 * - Note: Rate is flat regardless of item classes
 *
 * TEST CASE 3: RCVG (Receiving) - Flat-rate per-item billing
 * -----------------------------------------------------------------------------
 * Setup:
 * - Service: RCVG, uses_class_pricing=false
 * - 1 row in service_events: RCVG, class_code=NULL, rate=$3.50, billing_unit="Item"
 * - Shipment receiving uses service_code "RCVG"
 *
 * Scenario:
 * - Inbound shipment with 5 items (any class)
 *
 * Expected billing:
 * - Line 1: Receiving @ $3.50 x 5 = $17.50
 * - Total: $17.50
 * - Note: Same rate applied to all items regardless of class
 *
 * =============================================================================
 */

import { supabase } from '@/integrations/supabase/client';
import {
  BILLING_DISABLED_ERROR,
  getEffectiveRate,
  toRateLookupResult,
  logPricingFallbackExternal,
  mapLegacyToUnit,
} from '@/lib/billing/chargeTypeUtils';
import { estimateServiceMinutes } from '@/lib/time/serviceTimeEstimate';

/**
 * Map shipment direction to service codes
 * Outbound uses Will_Call for class-based pickup/release fees
 */
export const SHIPMENT_DIRECTION_TO_SERVICE_CODE: Record<string, string> = {
  'inbound': 'RCVG',
  'outbound': 'Will_Call',
  'return': 'Returns',
};

// ============================================================================
// RATE LOOKUP
// ============================================================================

export interface RateLookupResult {
  rate: number;
  serviceName: string;
  serviceCode: string;
  billingUnit: string;  // Flexible to handle all database values
  // New: used for estimated service time calculations
  unit?: string;
  serviceTimeMinutes?: number;
  alertRule: string;
  hasError: boolean;
  errorMessage?: string;
}

/**
 * NEW: Get rate from Price List using category_id + class_code
 * This is the primary method for the simplified billing model
 *
 * BILLING MODEL supports two service types:
 * 1. Class-based (uses_class_pricing=true): 6 rows per service (XS/S/M/L/XL/XXL)
 *    - Lookup by category_id + class_code
 * 2. Flat-rate (uses_class_pricing=false): Single row with class_code=NULL
 *    - Applies same rate regardless of item class
 *
 * @param tenantId - The tenant ID
 * @param categoryId - The category ID from the task type
 * @param classCode - The class code from the item (XS, S, M, L, XL, XXL) - can be null for flat-rate
 * @returns RateLookupResult with rate and service details
 */
export async function getRateByCategoryAndClass(
  tenantId: string,
  categoryId: string,
  classCode: string | null
): Promise<RateLookupResult> {
  try {
    // Strategy:
    // 1. If classCode is provided, try to find a class-specific service first
    // 2. If not found (or classCode is null), try to find a flat-rate service for this category
    // 3. A flat-rate service has uses_class_pricing=false and class_code IS NULL

    // Step 1: Try class-specific lookup if classCode is provided
    if (classCode) {
      const { data: classService, error: classError } = await supabase
        .from('service_events')
        .select('rate, service_name, service_code, billing_unit, alert_rule, uses_class_pricing, service_time_minutes')
        .eq('tenant_id', tenantId)
        .eq('category_id', categoryId)
        .eq('class_code', classCode)
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (classError) {
        console.error('[getRateByCategoryAndClass] Error looking up class-specific rate:', classError);
      }

      if (classService) {
        logPricingFallbackExternal(tenantId, classService.service_code || 'UNKNOWN', 'category_rate_lookup');
        return {
          rate: classService.rate ?? 0,
          serviceName: classService.service_name || 'Unknown',
          serviceCode: classService.service_code || 'UNKNOWN',
          billingUnit: classService.billing_unit || 'Item',
          unit: mapLegacyToUnit(classService.billing_unit || 'Item'),
          serviceTimeMinutes: classService.service_time_minutes ?? 0,
          alertRule: classService.alert_rule || 'none',
          hasError: classService.rate === null,
          errorMessage: classService.rate === null ? 'Rate not configured for this service' : undefined,
        };
      }
    }

    // Step 2: Try flat-rate service (class_code IS NULL, uses_class_pricing=false)
    const { data: flatRateService, error: flatError } = await supabase
      .from('service_events')
      .select('rate, service_name, service_code, billing_unit, alert_rule, uses_class_pricing, service_time_minutes')
      .eq('tenant_id', tenantId)
      .eq('category_id', categoryId)
      .is('class_code', null)
      .eq('uses_class_pricing', false)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (flatError) {
      console.error('[getRateByCategoryAndClass] Error looking up flat-rate service:', flatError);
      return {
        rate: 0,
        serviceName: 'Unknown',
        serviceCode: 'UNKNOWN',
        billingUnit: 'Item',
        alertRule: 'none',
        hasError: true,
        errorMessage: 'Error looking up rate',
      };
    }

    if (flatRateService) {
      logPricingFallbackExternal(tenantId, flatRateService.service_code || 'UNKNOWN', 'category_rate_lookup');
      return {
        rate: flatRateService.rate ?? 0,
        serviceName: flatRateService.service_name || 'Unknown',
        serviceCode: flatRateService.service_code || 'UNKNOWN',
        billingUnit: flatRateService.billing_unit || 'Item',
        unit: mapLegacyToUnit(flatRateService.billing_unit || 'Item'),
        serviceTimeMinutes: flatRateService.service_time_minutes ?? 0,
        alertRule: flatRateService.alert_rule || 'none',
        hasError: flatRateService.rate === null,
        errorMessage: flatRateService.rate === null ? 'Rate not configured for this service' : undefined,
      };
    }

    // No service found for this category
    const errorMsg = classCode
      ? `No service exists for this category and item class (${classCode}). Configure pricing in the Price List.`
      : 'No flat-rate service exists for this category. Configure pricing in the Price List.';

    return {
      rate: 0,
      serviceName: 'Unknown',
      serviceCode: 'UNKNOWN',
      billingUnit: 'Item',
      unit: 'per_item',
      serviceTimeMinutes: 0,
      alertRule: 'none',
      hasError: true,
      errorMessage: errorMsg,
    };
  } catch (error) {
    console.error('[getRateByCategoryAndClass] Unexpected error:', error);
    return {
      rate: 0,
      serviceName: 'Unknown',
      serviceCode: 'UNKNOWN',
      billingUnit: 'Item',
      unit: 'per_item',
      serviceTimeMinutes: 0,
      alertRule: 'none',
      hasError: true,
      errorMessage: 'Error looking up rate',
    };
  }
}

/**
 * Get rate from the unified pricing system.
 * Delegates to getEffectiveRate() which tries new system (charge_types + pricing_rules)
 * first, then falls back to legacy service_events.
 */
export async function getRateFromPriceList(
  tenantId: string,
  serviceCode: string,
  classCode: string | null,
  accountId?: string | null
): Promise<RateLookupResult> {
  try {
    const result = await getEffectiveRate({
      tenantId,
      chargeCode: serviceCode,
      accountId: accountId || undefined,
      classCode: classCode || undefined,
    });

    return toRateLookupResult(result);
  } catch (error) {
    console.error('[getRateFromPriceList] Error:', error);
    return {
      rate: 0,
      serviceName: serviceCode,
      serviceCode,
      billingUnit: 'Item',
      unit: 'per_item',
      serviceTimeMinutes: 0,
      alertRule: 'none',
      hasError: true,
      errorMessage: 'Error looking up rate',
    };
  }
}

// ============================================================================
// BILLING PREVIEW CALCULATION
// ============================================================================

export interface BillingLineItem {
  itemId: string | null;
  itemCode: string | null;
  classCode: string | null;
  className: string | null;
  serviceCode: string;
  serviceName: string;
  quantity: number;
  unitRate: number;
  totalAmount: number;
  estimatedMinutes: number;
  hasRateError: boolean;
  errorMessage?: string;
}

export interface BillingPreview {
  lineItems: BillingLineItem[];
  subtotal: number;
  hasErrors: boolean;
  serviceCode: string;
  serviceName: string;
  errorMessage?: string; // For Safety Billing - shows when manual rate is required
}

/**
 * Calculate billing preview for a TASK
 * Returns what billing events WOULD be created when task completes
 *
 * BILLING MODEL:
 * - If task type has category_id: Uses category + item class lookup (NEW)
 * - If task type has no category_id: Falls back to legacy service code lookup
 * - Each item is billed individually based on its class
 */
export async function calculateTaskBillingPreview(
  tenantId: string,
  taskId: string,
  taskType: string,
  overrideServiceCode?: string | null,
  overrideQuantity?: number | null,
  overrideRate?: number | null,
  categoryId?: string | null
): Promise<BillingPreview> {
  // Get task items - avoid nested PostgREST joins (no FK defined for classes)
  const { data: taskItemsRaw, error: taskItemsError } = await supabase
    .from('task_items')
    .select('item_id, quantity')
    .eq('task_id', taskId);

  if (taskItemsError) {
    console.error('[calculateTaskBillingPreview] Error fetching task items:', taskItemsError);
    return {
      lineItems: [],
      subtotal: 0,
      hasErrors: true,
      serviceCode: overrideServiceCode || 'UNKNOWN',
      serviceName: 'Unknown',
    };
  }

  // Fetch items separately 
  const itemIds = [...new Set((taskItemsRaw || []).map(ti => ti.item_id).filter(Boolean))];
  const { data: items } = itemIds.length > 0
    ? await supabase.from('items').select('id, item_code, class_id').in('id', itemIds)
    : { data: [] };
  const itemMap = new Map((items || []).map((i: any) => [i.id, i]));

  // Fetch classes separately
  const classIds = [...new Set((items || []).map((i: any) => i.class_id).filter(Boolean))];
  const { data: classes } = classIds.length > 0
    ? await supabase.from('classes').select('id, code, name').in('id', classIds)
    : { data: [] };
  const classMap = new Map((classes || []).map((c: any) => [c.id, c]));

  // Merge data
  const taskItems = (taskItemsRaw || []).map(ti => ({
    ...ti,
    items: itemMap.get(ti.item_id) || null,
  }));

  const lineItems: BillingLineItem[] = [];
  let subtotal = 0;
  let hasErrors = false;
  let serviceName = 'Unknown';
  let serviceCode = overrideServiceCode || 'UNKNOWN';

  // Note: Assembly/Repair are no longer hardcoded special cases.
  // Per-task billing is handled via service lines with explicit quantities.
  // This function now always uses per-item billing for the legacy path.
  {
    // Per-item billing - calculate for each item based on class
    // Use category-based lookup if category_id is provided (new model)
    // Otherwise fall back to legacy service code lookup
    for (const ti of taskItems || []) {
      const item = ti.items as any;
      const itemCode = item?.item_code || null;
      // Lookup class from classMap using item's class_id
      const itemClass = item?.class_id ? classMap.get(item.class_id) : null;
      const classCode = itemClass?.code || null;
      const className = itemClass?.name || null;
      const quantity = ti.quantity || 1;

      let rateResult: RateLookupResult;

      if (categoryId) {
        // NEW: Category-based billing
        rateResult = await getRateByCategoryAndClass(tenantId, categoryId, classCode);
      } else {
        // LEGACY: Service code-based billing
        const legacyServiceCode = overrideServiceCode || 'UNKNOWN';
        rateResult = await getRateFromPriceList(tenantId, legacyServiceCode, classCode);
      }

      serviceName = rateResult.serviceName;
      serviceCode = rateResult.serviceCode;

      const totalAmount = quantity * rateResult.rate;
      const estimatedMinutes = estimateServiceMinutes({
        serviceTimeMinutes: rateResult.serviceTimeMinutes ?? 0,
        unit: rateResult.unit,
        quantity,
      });

      lineItems.push({
        itemId: ti.item_id,
        itemCode,
        classCode,
        className,
        serviceCode: rateResult.serviceCode,
        serviceName: rateResult.serviceName,
        quantity,
        unitRate: rateResult.rate,
        totalAmount,
        estimatedMinutes,
        hasRateError: rateResult.hasError,
        errorMessage: rateResult.errorMessage,
      });

      subtotal += totalAmount;
      if (rateResult.hasError) hasErrors = true;
    }
  }

  return {
    lineItems,
    subtotal,
    hasErrors,
    serviceCode,
    serviceName,
  };
}

/**
 * Calculate billing preview for a SHIPMENT
 * Returns what billing events WOULD be created when shipment completes
 *
 * Items are now created with class_id during shipment creation,
 * so we can directly use item.class_id for rate lookups.
 */
export async function calculateShipmentBillingPreview(
  tenantId: string,
  shipmentId: string,
  direction: 'inbound' | 'outbound' | 'return'
): Promise<BillingPreview> {
  console.log('[calculateShipmentBillingPreview] Starting calculation', { tenantId, shipmentId, direction });

  // Determine service code based on direction
  const serviceCode = SHIPMENT_DIRECTION_TO_SERVICE_CODE[direction] || 'RCVG';
  console.log('[calculateShipmentBillingPreview] Service code:', serviceCode);

  // Get shipment items - no nested PostgREST joins (no FK constraints defined)
  const { data: shipmentItems, error: shipmentItemsError } = await supabase
    .from('shipment_items')
    .select(`
      item_id,
      expected_quantity,
      actual_quantity,
      expected_class_id
    `)
    .eq('shipment_id', shipmentId);

  console.log('[calculateShipmentBillingPreview] Shipment items query result:', {
    error: shipmentItemsError,
    itemCount: shipmentItems?.length || 0,
    items: shipmentItems?.map(si => ({
      item_id: si.item_id,
      expected_quantity: si.expected_quantity,
      actual_quantity: si.actual_quantity,
      expected_class_id: si.expected_class_id
    }))
  });

  if (shipmentItemsError) {
    console.error('[calculateShipmentBillingPreview] Error fetching shipment items:', shipmentItemsError);
    return {
      lineItems: [],
      subtotal: 0,
      hasErrors: true,
      serviceCode,
      serviceName: serviceCode,
    };
  }

  // Fetch classes separately (no FK defined for PostgREST)
  const classIds = [...new Set((shipmentItems || []).map(si => si.expected_class_id).filter(Boolean))];
  const { data: classes } = classIds.length > 0
    ? await supabase.from('classes').select('id, code, name').in('id', classIds)
    : { data: [] };
  const classMap = new Map((classes || []).map(c => [c.id, c]));

  // Fetch items separately
  const itemIds = [...new Set((shipmentItems || []).map(si => si.item_id).filter(Boolean))];
  const { data: items } = itemIds.length > 0
    ? await supabase.from('items').select('id, item_code, class_id').in('id', itemIds)
    : { data: [] };
  const itemMap = new Map((items || []).map(i => [i.id, i]));

  // Also fetch classes for items that have class_id set
  const itemClassIds = [...new Set((items || []).map(i => i.class_id).filter(Boolean))];
  const additionalClassIds = itemClassIds.filter(id => !classMap.has(id));
  if (additionalClassIds.length > 0) {
    const { data: additionalClasses } = await supabase.from('classes').select('id, code, name').in('id', additionalClassIds);
    (additionalClasses || []).forEach(c => classMap.set(c.id, c));
  }

  console.log('[calculateShipmentBillingPreview] Separate lookups:', {
    classIds,
    itemIds,
    classMapSize: classMap.size,
    itemMapSize: itemMap.size
  });

  const lineItems: BillingLineItem[] = [];
  let subtotal = 0;
  let hasErrors = false;
  let serviceName = serviceCode;

  // Calculate for each item based on class
  for (const si of shipmentItems || []) {
    const item = itemMap.get(si.item_id);
    const expectedClass = classMap.get(si.expected_class_id);
    const itemClass = item?.class_id ? classMap.get(item.class_id) : null;

    // Get class info from linked item, or fall back to expected_class for old shipments
    const itemCode = item?.item_code || null;
    const classCode = itemClass?.code || expectedClass?.code || null;
    const className = itemClass?.name || expectedClass?.name || null;

    console.log('[calculateShipmentBillingPreview] Processing item:', {
      item_id: si.item_id,
      itemCode,
      classCode,
      className,
      hasItemData: !!item,
      hasExpectedClass: !!expectedClass,
      expectedClassCode: expectedClass?.code
    });

    // Use actual quantity if available, otherwise expected
    const quantity = si.actual_quantity || si.expected_quantity || 1;

    const rateResult = await getRateFromPriceList(tenantId, serviceCode, classCode);
    console.log('[calculateShipmentBillingPreview] Rate lookup result:', {
      serviceCode,
      classCode,
      rate: rateResult.rate,
      hasError: rateResult.hasError,
      errorMessage: rateResult.errorMessage
    });

    serviceName = rateResult.serviceName;

    const totalAmount = quantity * rateResult.rate;
    const estimatedMinutes = estimateServiceMinutes({
      serviceTimeMinutes: rateResult.serviceTimeMinutes ?? 0,
      unit: rateResult.unit,
      quantity,
    });

    lineItems.push({
      itemId: si.item_id,
      itemCode,
      classCode,
      className,
      serviceCode: rateResult.serviceCode,
      serviceName: rateResult.serviceName,
      quantity,
      unitRate: rateResult.rate,
      totalAmount,
      estimatedMinutes,
      hasRateError: rateResult.hasError,
      errorMessage: rateResult.errorMessage,
    });

    subtotal += totalAmount;
    if (rateResult.hasError) hasErrors = true;
  }

  console.log('[calculateShipmentBillingPreview] Final result:', {
    lineItemCount: lineItems.length,
    subtotal,
    hasErrors
  });

  return {
    lineItems,
    subtotal,
    hasErrors,
    serviceCode,
    serviceName,
  };
}

/**
 * Get assembly services from Price List for dropdown
 * @deprecated Assembly services are now managed through charge_types and service lines.
 * This function is kept for backward compatibility but will be removed in a future release.
 */
export async function getAssemblyServices(tenantId: string): Promise<Array<{
  serviceCode: string;
  serviceName: string;
  rate: number;
  serviceTimeMinutes: number | null;
}>> {
  const { data, error } = await supabase
    .from('service_events')
    .select('service_code, service_name, rate, service_time_minutes')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .is('class_code', null)
    .ilike('billing_trigger', '%Task - Assign Rate%')
    .or('service_code.ilike.%MA,service_name.ilike.%assembl%')
    .order('service_time_minutes', { ascending: true, nullsFirst: false });

  if (error) {
    console.error('[getAssemblyServices] Error:', error);
    return [];
  }

  // Dedupe by service_code and sort by numeric prefix
  const seen = new Set<string>();
  return (data || [])
    .filter(s => {
      if (seen.has(s.service_code)) return false;
      seen.add(s.service_code);
      return true;
    })
    .sort((a, b) => {
      const aNum = parseInt(a.service_code) || 999;
      const bNum = parseInt(b.service_code) || 999;
      return aNum - bNum;
    })
    .map(s => ({
      serviceCode: s.service_code,
      serviceName: s.service_name,
      rate: s.rate,
      serviceTimeMinutes: s.service_time_minutes,
    }));
}

/**
 * Get repair service rate from Price List
 * @deprecated Repair services are now managed through charge_types and service lines.
 * This function is kept for backward compatibility but will be removed in a future release.
 */
export async function getRepairServiceRate(tenantId: string): Promise<{
  serviceCode: string;
  serviceName: string;
  rate: number;
} | null> {
  const { data, error } = await supabase
    .from('service_events')
    .select('service_code, service_name, rate')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .is('class_code', null)
    .or('service_code.ilike.%HRO%,service_name.ilike.%repair%')
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    console.error('[getRepairServiceRate] Error:', error);
    return null;
  }

  return {
    serviceCode: data.service_code,
    serviceName: data.service_name,
    rate: data.rate,
  };
}
