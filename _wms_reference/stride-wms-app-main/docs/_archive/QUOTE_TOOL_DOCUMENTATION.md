# Stride WMS Quote Tool Documentation

## Overview

The Quote Tool is a standalone pricing calculator that generates customer quotes by dynamically fetching services and rates from the **Price List** (`service_events` table). It uses pattern matching to identify services, making it resilient to service name/code changes.

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Data Flow Architecture](#data-flow-architecture)
3. [Dynamic Service Lookup](#dynamic-service-lookup)
4. [Rate Calculation Engine](#rate-calculation-engine)
5. [Service Categories](#service-categories)
6. [Hooks & Data Fetching](#hooks--data-fetching)
7. [Calculator Logic](#calculator-logic)
8. [File Locations](#file-locations)
9. [Key Differences from Billing Events](#key-differences-from-billing-events)

---

## Core Concepts

### Key Principle: No Hardcoded Service Codes

The Quote Tool **never uses hardcoded service codes**. Instead, it:

1. Fetches ALL services from `service_events` table
2. Uses **pattern matching** (regex) to categorize and identify services
3. Dynamically adapts when services are added, renamed, or removed

### Key Tables Used

| Table | Purpose |
|-------|---------|
| `service_events` | Price List - all billable services and rates |
| `classes` | Item size/pricing tiers (XS, S, M, L, XL, XXL) |
| `quotes` | Saved quote headers |
| `quote_class_lines` | Quantities per class for a quote |
| `quote_selected_services` | Non-class-based service selections |
| `quote_class_service_selections` | Per-class service selections |
| `quote_rate_overrides` | Manual rate overrides |

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           QUOTE TOOL DATA FLOW                              │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
  │  useQuoteClasses │     │ useQuoteServices │     │useQuoteServiceRates│
  │                  │     │                  │     │                  │
  │  Fetches from:   │     │  Fetches from:   │     │  Fetches from:   │
  │  classes table   │     │  service_events  │     │  service_events  │
  └────────┬─────────┘     └────────┬─────────┘     └────────┬─────────┘
           │                        │                        │
           │                        ▼                        │
           │              ┌──────────────────┐               │
           │              │ Pattern Matching │               │
           │              │ - Categorizes    │               │
           │              │ - Identifies     │               │
           │              │ - Groups services│               │
           │              └────────┬─────────┘               │
           │                       │                         │
           ▼                       ▼                         ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                        QUOTE BUILDER UI                                  │
  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐         │
  │  │ Class Lines     │  │ Class-Based     │  │ Non-Class       │         │
  │  │ (qty per class) │  │ Services        │  │ Services        │         │
  │  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘         │
  └───────────┼────────────────────┼────────────────────┼──────────────────┘
              │                    │                    │
              ▼                    ▼                    ▼
  ┌─────────────────────────────────────────────────────────────────────────┐
  │                      calculateQuote() FUNCTION                          │
  │                                                                          │
  │  Inputs:                                                                 │
  │  • classes[]           - All available classes                          │
  │  • services[]          - All available services                         │
  │  • rates[]             - All service rates                              │
  │  • classLines[]        - User's quantity per class                      │
  │  • selectedServices[]  - User's non-class service selections           │
  │  • classServiceSelections[] - User's per-class service selections      │
  │  • rateOverrides[]     - User's manual rate overrides                   │
  │  • storageDays         - Calculated storage duration                    │
  │  • discounts & tax     - Quote-level adjustments                        │
  │                                                                          │
  │  Output: QuoteCalculation                                                │
  │  • service_totals[]    - Breakdown by service                           │
  │  • class_line_totals[] - Breakdown by class                             │
  │  • subtotals, discounts, tax, grand_total                               │
  └─────────────────────────────────────────────────────────────────────────┘
```

---

## Dynamic Service Lookup

### Pattern Matching Approach

The Quote Tool uses regex patterns to identify services by name/code:

```typescript
// In QuoteBuilder.tsx - Service identification patterns
const MAIN_ROW_SERVICE_PATTERNS = [
  { pattern: /receiv/i, label: 'Receiving' },
  { pattern: /inspect/i, label: 'Inspection' },
  { pattern: /pull.?prep/i, label: 'Pull Prep' },
];

const EXPANDED_SERVICE_PATTERNS = [
  { pattern: /will.?call/i, label: 'Will Call' },
  { pattern: /disposal/i, label: 'Disposal' },
  { pattern: /return/i, label: 'Returns' },
  { pattern: /sit.?test/i, label: 'Sit Test' },
];
```

### How Pattern Matching Works

```typescript
// Find a service that matches any of the patterns
const service = classBasedServices.find(s =>
  pattern.test(s.name) || pattern.test(s.service_code || '')
);
```

This means:
- A service named "Receiving" matches `/receiv/i`
- A service with code "RCVG" also matches `/rcvg/i` if that pattern exists
- If service names change (e.g., "Receiving" → "Inbound Receiving"), it still matches

### Service Categorization in useQuoteServices

```typescript
// In useQuotes.ts - Automatic category detection
let category = 'General';
const code = se.service_code.toLowerCase();
const name = se.service_name.toLowerCase();

if (code.includes('strg') || code.includes('storage') || name.includes('storage')) {
  category = 'Storage';
} else if (code.includes('rcvg') || code.includes('recv') || name.includes('receiv')) {
  category = 'Receiving';
} else if (code.includes('insp') || name.includes('inspect')) {
  category = 'Inspection';
} else if (code.includes('assemb') || code.includes('disassemb') || name.includes('assemb')) {
  category = 'Assembly';
} else if (code.includes('repair') || name.includes('repair')) {
  category = 'Repair';
}
// ... more categories
```

### Class-Based vs Non-Class-Based Detection

```typescript
// A service is class-based if it has entries with class_code in service_events
const classBasedServiceCodes = new Set<string>();

// First pass: identify class-based services
(data || []).forEach((se: any) => {
  if (se.class_code) {
    classBasedServiceCodes.add(se.service_code);
  }
});

// Then mark each service
serviceMap.set(se.service_code, {
  // ...
  is_class_based: classBasedServiceCodes.has(se.service_code),
});
```

---

## Rate Calculation Engine

### Rate Lookup Priority

```
1. Rate Override (user manually set a different rate)
      ↓ (if not found)
2. Class-Specific Rate (rate for this service + this class)
      ↓ (if not found)
3. Service Default Rate (rate with class_code = NULL)
      ↓ (if not found)
4. Return 0
```

### Code: getApplicableRate()

```typescript
function getApplicableRate(
  serviceId: string,
  classId: string | null,
  rates: QuoteServiceRate[],
  overrides: RateOverrideInput[]
): number {
  // 1. Check for override first
  const override = overrides.find(
    (o) => o.service_id === serviceId && (o.class_id === classId || o.class_id === null)
  );
  if (override) {
    return override.override_rate_amount;
  }

  // 2. Try class-specific rate
  if (classId) {
    const classRate = rates.find(
      (r) => r.service_id === serviceId && r.class_id === classId && r.is_current
    );
    if (classRate) {
      return classRate.rate_amount;
    }
  }

  // 3. Fall back to service default rate (no class)
  const defaultRate = rates.find(
    (r) => r.service_id === serviceId && r.class_id === null && r.is_current
  );
  return defaultRate?.rate_amount ?? 0;
}
```

### Billable Quantity Calculation

```typescript
function calculateBillableQty(
  service: QuoteService,
  classLines: ClassLineInput[],
  storageDays: number,
  hoursInput: number | null
): number {
  const totalPieces = classLines.reduce((sum, line) => sum + (line.qty || 0), 0);
  const lineItemCount = classLines.filter((line) => (line.qty || 0) > 0).length;

  switch (service.billing_unit) {
    case 'flat':        return 1;
    case 'per_piece':   return totalPieces;
    case 'per_line_item': return lineItemCount;
    case 'per_class':   return totalPieces; // Calculated per class later
    case 'per_hour':    return hoursInput ?? 0;
    case 'per_day':     return service.is_storage_service ? storageDays : 1;
    default:            return 1;
  }
}
```

---

## Service Categories

### Billing Units

| Billing Unit | Description | Example Services |
|--------------|-------------|------------------|
| `flat` | Fixed charge regardless of quantity | One-time fees |
| `per_piece` | Charge per item | Receiving, Inspection |
| `per_line_item` | Charge per class used | Line item fees |
| `per_class` | Charge varies by class | Class-specific services |
| `per_hour` | Charge by hours worked | Repair, Assembly |
| `per_day` | Charge per day | Storage |

### Service Types in Quote Tool

| Type | Description | Rate Source |
|------|-------------|-------------|
| Class-Based | Rate varies by item class (XS-XXL) | `service_events` with `class_code` set |
| Non-Class-Based | Flat rate for all items | `service_events` with `class_code = NULL` |
| Storage | Per-day rate | `billing_unit = 'Day'` |

---

## Hooks & Data Fetching

### useQuoteClasses()

Fetches item classes from `classes` table:

```typescript
const { data } = await supabase
  .from('classes')
  .select('*')
  .eq('tenant_id', profile.tenant_id)
  .order('code');
```

Returns: `QuoteClass[]` with id, name, description

### useQuoteServices()

Fetches and processes services from `service_events`:

```typescript
const { data } = await supabase
  .from('service_events')
  .select('*')
  .eq('tenant_id', profile.tenant_id)
  .eq('is_active', true)
  .order('service_name');
```

Returns:
- `services[]` - All unique services
- `classBasedServices[]` - Services with class-specific rates
- `nonClassBasedServices[]` - Flat-rate services
- `storageServices[]` - Per-day storage services
- `servicesByCategory{}` - Grouped by category

### useQuoteServiceRates()

Fetches all rates for rate lookup:

```typescript
const { data: serviceEvents } = await supabase
  .from('service_events')
  .select('*')
  .eq('tenant_id', profile.tenant_id)
  .eq('is_active', true);
```

Returns: `QuoteServiceRate[]` with service_id, class_id, rate_amount

---

## Calculator Logic

### Main Calculation Flow

```typescript
export function calculateQuote(params: CalculateQuoteParams): QuoteCalculation {
  // 1. Compute storage days
  const storageDays = computeStorageDays(storageMonthsInput, storageDaysInput);

  // 2. Calculate totals for selected non-class services
  for (const selectedService of activeSelectedServices) {
    const service = services.find(s => s.id === selectedService.service_id);
    const billableQty = calculateBillableQty(service, classLines, storageDays, hoursInput);

    // For class-based services, sum across classes
    if (service.billing_unit === 'per_piece' && hasClassRates) {
      for (const line of classLines) {
        const rate = getApplicableRate(service.id, line.class_id, rates, overrides);
        total += line.qty * rate;
      }
    } else {
      // Simple: qty * rate
      const rate = getApplicableRate(service.id, null, rates, overrides);
      total = billableQty * rate;
    }
  }

  // 3. Calculate totals for class-based service selections
  for (const [serviceId, selections] of classServiceSelectionsByService) {
    for (const selection of selections) {
      const rate = getApplicableRate(serviceId, selection.class_id, rates, overrides);
      total += selection.qty_override * rate;
    }
  }

  // 4. Apply quote-level discount
  const { discountAmount, finalAmount } = applyDiscount(subtotal, discountType, discountValue);

  // 5. Calculate tax
  const taxAmount = subtotalAfterDiscounts * (taxRate / 100);

  // 6. Compute grand total
  const grandTotal = subtotalAfterDiscounts + taxAmount;

  return {
    service_totals,
    class_line_totals,
    subtotal_before_discounts,
    quote_discount_amount,
    subtotal_after_discounts,
    tax_amount,
    grand_total,
  };
}
```

### Discount Application

```typescript
function applyDiscount(
  amount: number,
  discountType: 'percent' | 'fixed' | null,
  discountValue: number | null
): { discountAmount: number; finalAmount: number } {
  if (!discountType || discountValue === null) {
    return { discountAmount: 0, finalAmount: amount };
  }

  let discountAmount: number;
  if (discountType === 'percent') {
    discountAmount = amount * (discountValue / 100);
  } else {
    discountAmount = discountValue; // Fixed amount
  }

  return { discountAmount, finalAmount: Math.max(0, amount - discountAmount) };
}
```

---

## File Locations

| Purpose | File Path |
|---------|-----------|
| Quote Builder UI | `src/pages/QuoteBuilder.tsx` |
| Quote Hooks | `src/hooks/useQuotes.ts` |
| Calculator Engine | `src/lib/quotes/calculator.ts` |
| Type Definitions | `src/lib/quotes/types.ts` |
| PDF/Excel Export | `src/lib/quotes/export.ts` |

---

## Key Differences from Billing Events

| Aspect | Quote Tool | Billing Events |
|--------|------------|----------------|
| **Purpose** | Estimate/preview pricing | Record actual charges |
| **Trigger** | Manual user creation | Automatic on service completion |
| **Data Source** | `service_events` (Price List) | `billing_events` table |
| **Service Lookup** | Pattern matching on name/code | Direct service_code reference |
| **Persistence** | Saved to `quotes` tables | Saved to `billing_events` |
| **Rate Overrides** | Stored per-quote | Not applicable |

---

## Summary: Why This Design Works

1. **Dynamic Service Fetching**: All services come from `service_events` - no hardcoded list
2. **Pattern Matching**: Services are identified by name/code patterns, not exact matches
3. **Automatic Categorization**: Services are categorized by pattern detection
4. **Class-Based Detection**: Automatically detects which services have class-specific rates
5. **Rate Fallback Chain**: Override → Class Rate → Default Rate → 0
6. **Real-Time Calculation**: `calculateQuote()` runs on every input change via `useMemo`

This architecture ensures the Quote Tool **continues working** when:
- New services are added to Price List
- Service names change
- Service codes change
- New classes are added
- Rates are updated

---

*Document generated: January 30, 2026*
*Stride WMS Version: Current*
