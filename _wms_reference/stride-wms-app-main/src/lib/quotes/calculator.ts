// Quote Calculation Engine
// Handles all pricing logic for quotes

import {
  QuoteClass,
  QuoteService,
  QuoteServiceRate,
  QuoteCalculation,
  QuoteBillingUnit,
  DiscountType,
} from './types';

interface ClassLineInput {
  class_id: string;
  qty: number;
  line_discount_type: DiscountType | null;
  line_discount_value: number | null;
}

interface SelectedServiceInput {
  service_id: string;
  is_selected: boolean;
  hours_input: number | null;
  qty_input: number | null;
}

interface ClassServiceSelectionInput {
  class_id: string;
  service_id: string;
  is_selected: boolean;
  qty_override: number | null;
}

interface RateOverrideInput {
  service_id: string;
  class_id: string | null;
  override_rate_amount: number;
}

interface CalculateQuoteParams {
  classes: QuoteClass[];
  services: QuoteService[];
  rates: QuoteServiceRate[];
  classLines: ClassLineInput[];
  selectedServices: SelectedServiceInput[];
  classServiceSelections: ClassServiceSelectionInput[];
  rateOverrides: RateOverrideInput[];
  storageDaysInput: number | null;
  storageMonthsInput: number | null;
  quoteDiscountType: DiscountType | null;
  quoteDiscountValue: number | null;
  taxEnabled: boolean;
  taxRatePercent: number | null;
  coverageType: string | null;
  totalDeclaredValue: number | null;
  coverageCostOverride?: number; // pre-calculated coverage cost from hook
}

/**
 * Compute total storage days from months and days input
 * Uses fixed 30-day month conversion
 */
export function computeStorageDays(monthsInput: number | null, daysInput: number | null): number {
  const months = monthsInput ?? 0;
  const days = daysInput ?? 0;
  return days + (months * 30);
}

/**
 * Get the applicable rate for a service/class combination
 * Priority: override > class-specific rate > service default rate
 */
function getApplicableRate(
  serviceId: string,
  classId: string | null,
  rates: QuoteServiceRate[],
  overrides: RateOverrideInput[]
): number {
  // Check for override first
  const override = overrides.find(
    (o) => o.service_id === serviceId && (o.class_id === classId || o.class_id === null)
  );
  if (override) {
    return override.override_rate_amount;
  }

  // Try class-specific rate
  if (classId) {
    const classRate = rates.find(
      (r) => r.service_id === serviceId && r.class_id === classId && r.is_current
    );
    if (classRate) {
      return classRate.rate_amount;
    }
  }

  // Fall back to service default rate (no class)
  const defaultRate = rates.find(
    (r) => r.service_id === serviceId && r.class_id === null && r.is_current
  );
  return defaultRate?.rate_amount ?? 0;
}

/**
 * Calculate billable quantity for a service based on billing unit
 */
function calculateBillableQty(
  service: QuoteService,
  classLines: ClassLineInput[],
  storageDays: number,
  hoursInput: number | null,
  qtyInput: number | null
): number {
  const totalPieces = classLines.reduce((sum, line) => sum + (line.qty || 0), 0);
  const lineItemCount = classLines.filter((line) => (line.qty || 0) > 0).length;

  switch (service.billing_unit) {
    case 'flat':
      return 1;
    case 'per_piece':
      return totalPieces;
    case 'per_line_item':
      return lineItemCount;
    case 'per_class':
      return totalPieces; // Calculated per class in class line totals
    case 'per_hour':
      // Use qty_input first (for assembly/task services), then hours_input
      return qtyInput ?? hoursInput ?? 0;
    case 'per_day':
      return service.is_storage_service ? storageDays : 1;
    default:
      return 1;
  }
}

/**
 * Apply discount/markup to an amount
 */
function applyDiscount(
  amount: number,
  discountType: DiscountType | null,
  discountValue: number | null
): { discountAmount: number; finalAmount: number } {
  if (!discountType || discountValue === null || discountValue === 0) {
    return { discountAmount: 0, finalAmount: amount };
  }

  let discountAmount: number;
  if (discountType === 'percentage') {
    discountAmount = amount * (discountValue / 100);
  } else {
    discountAmount = discountValue;
  }

  // Negative discount = markup
  const finalAmount = amount - discountAmount;
  return { discountAmount, finalAmount: Math.max(0, finalAmount) };
}

/**
 * Main quote calculation function
 * Returns fully calculated totals for display and saving
 */
export function calculateQuote(params: CalculateQuoteParams): QuoteCalculation {
  const {
    classes,
    services,
    rates,
    classLines,
    selectedServices,
    classServiceSelections,
    rateOverrides,
    storageDaysInput,
    storageMonthsInput,
    quoteDiscountType,
    quoteDiscountValue,
    taxEnabled,
    taxRatePercent,
    coverageType,
    totalDeclaredValue,
    coverageCostOverride,
  } = params;

  // Compute storage days
  const storageDays = computeStorageDays(storageMonthsInput, storageDaysInput);

  // Get selected services that are active
  const activeSelectedServices = selectedServices.filter((ss) => ss.is_selected);
  const selectedServiceIds = new Set(activeSelectedServices.map((ss) => ss.service_id));

  // Calculate service totals
  const serviceTotals: QuoteCalculation['service_totals'] = [];

  for (const selectedService of activeSelectedServices) {
    const service = services.find((s) => s.id === selectedService.service_id);
    if (!service) continue;

    const billableQty = calculateBillableQty(
      service,
      classLines,
      storageDays,
      selectedService.hours_input,
      selectedService.qty_input
    );

    // For per_class and per_piece services with class-specific rates,
    // we need to sum across classes
    let total = 0;

    if (
      (service.billing_unit === 'per_piece' || service.billing_unit === 'per_class') &&
      rates.some((r) => r.service_id === service.id && r.class_id !== null)
    ) {
      // Calculate per class
      for (const line of classLines) {
        if ((line.qty || 0) <= 0) continue;
        const rate = getApplicableRate(service.id, line.class_id, rates, rateOverrides);
        total += line.qty * rate;
      }
    } else if (service.billing_unit === 'per_day' && service.is_storage_service) {
      // Storage: calculate per class * days
      for (const line of classLines) {
        if ((line.qty || 0) <= 0) continue;
        const rate = getApplicableRate(service.id, line.class_id, rates, rateOverrides);
        total += line.qty * storageDays * rate;
      }
    } else {
      // Simple calculation: qty * rate
      const rate = getApplicableRate(service.id, null, rates, rateOverrides);
      total = billableQty * rate;
    }

    serviceTotals.push({
      service_id: service.id,
      service_name: service.name,
      category: service.category,
      billing_unit: service.billing_unit,
      billable_qty: billableQty,
      rate: getApplicableRate(service.id, null, rates, rateOverrides),
      total,
    });
  }

  // Calculate totals from class-based service selections
  // Group selections by service_id and sum up totals
  const classServiceSelectionsByService = new Map<string, ClassServiceSelectionInput[]>();
  for (const css of classServiceSelections) {
    if (!css.is_selected || (css.qty_override ?? 0) <= 0) continue;
    const existing = classServiceSelectionsByService.get(css.service_id);
    if (existing) {
      existing.push(css);
    } else {
      classServiceSelectionsByService.set(css.service_id, [css]);
    }
  }

  for (const [serviceId, selections] of classServiceSelectionsByService) {
    // Skip if already handled in selectedServices
    if (selectedServiceIds.has(serviceId)) continue;

    const service = services.find((s) => s.id === serviceId);
    if (!service) continue;

    let total = 0;
    let totalQty = 0;

    for (const selection of selections) {
      const qty = selection.qty_override ?? 0;
      if (qty <= 0) continue;

      const rate = getApplicableRate(serviceId, selection.class_id, rates, rateOverrides);

      if (service.is_storage_service && service.billing_unit === 'per_day') {
        // Storage service: qty * days * rate
        total += qty * storageDays * rate;
      } else {
        // Other services: qty * rate
        total += qty * rate;
      }
      totalQty += qty;
    }

    if (total > 0) {
      serviceTotals.push({
        service_id: service.id,
        service_name: service.name,
        category: service.category,
        billing_unit: service.billing_unit,
        billable_qty: totalQty,
        rate: getApplicableRate(serviceId, null, rates, rateOverrides),
        total,
      });
    }
  }

  // Calculate class line totals
  const classLineTotals: QuoteCalculation['class_line_totals'] = [];

  for (const line of classLines) {
    const classObj = classes.find((c) => c.id === line.class_id);
    if (!classObj || (line.qty || 0) <= 0) continue;

    let servicesTotal = 0;
    let storageTotal = 0;

    // Calculate services from selectedServices applicable to this class
    for (const selectedService of activeSelectedServices) {
      const service = services.find((s) => s.id === selectedService.service_id);
      if (!service) continue;

      const rate = getApplicableRate(service.id, line.class_id, rates, rateOverrides);

      if (service.is_storage_service && service.billing_unit === 'per_day') {
        // Storage service
        storageTotal += line.qty * storageDays * rate;
      } else if (service.billing_unit === 'per_piece' || service.billing_unit === 'per_class') {
        // Per-piece/class services
        servicesTotal += line.qty * rate;
      }
      // Note: flat, per_hour, per_line_item are not class-specific
    }

    // Calculate services from classServiceSelections for this specific class
    for (const css of classServiceSelections) {
      if (css.class_id !== line.class_id || !css.is_selected) continue;
      // Skip if already handled in selectedServices
      if (selectedServiceIds.has(css.service_id)) continue;

      const qty = css.qty_override ?? 0;
      if (qty <= 0) continue;

      const service = services.find((s) => s.id === css.service_id);
      if (!service) continue;

      const rate = getApplicableRate(css.service_id, css.class_id, rates, rateOverrides);

      if (service.is_storage_service && service.billing_unit === 'per_day') {
        // Storage service: qty * days * rate
        storageTotal += qty * storageDays * rate;
      } else {
        // Other services: qty * rate
        servicesTotal += qty * rate;
      }
    }

    const subtotalBeforeDiscount = servicesTotal + storageTotal;
    const { discountAmount, finalAmount } = applyDiscount(
      subtotalBeforeDiscount,
      line.line_discount_type,
      line.line_discount_value
    );

    classLineTotals.push({
      class_id: line.class_id,
      class_name: classObj.name,
      qty: line.qty,
      services_total: servicesTotal,
      storage_total: storageTotal,
      subtotal_before_discount: subtotalBeforeDiscount,
      discount_amount: discountAmount,
      subtotal_after_discount: finalAmount,
    });
  }

  // Calculate overall totals
  const subtotalBeforeDiscounts = serviceTotals.reduce((sum, st) => sum + st.total, 0);

  // Apply quote-level discount
  const { discountAmount: quoteDiscountAmount, finalAmount: subtotalAfterDiscounts } = applyDiscount(
    subtotalBeforeDiscounts,
    quoteDiscountType,
    quoteDiscountValue
  );

  // Calculate tax
  const taxRate = taxEnabled ? (taxRatePercent ?? 0) : 0;
  const taxAmount = subtotalAfterDiscounts * (taxRate / 100);

  // Coverage cost (not taxed — added after tax)
  const coverageCost = coverageCostOverride ?? 0;

  // Grand total
  const grandTotal = subtotalAfterDiscounts + taxAmount + coverageCost;

  return {
    class_line_totals: classLineTotals,
    service_totals: serviceTotals,
    storage_days: storageDays,
    subtotal_before_discounts: subtotalBeforeDiscounts,
    quote_discount_amount: quoteDiscountAmount,
    subtotal_after_discounts: subtotalAfterDiscounts,
    tax_rate: taxRate,
    tax_amount: taxAmount,
    coverage_type: coverageType,
    total_declared_value: totalDeclaredValue ?? 0,
    coverage_cost: coverageCost,
    grand_total: grandTotal,
  };
}

/**
 * Format currency for display
 */
export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount);
}

/**
 * Format number with commas
 */
export function formatNumber(num: number): string {
  return new Intl.NumberFormat('en-US').format(num);
}
