# Stride WMS Billing System Documentation

## Overview

The Stride WMS billing system tracks charges for all warehouse services through the `billing_events` table. Charges are calculated based on the **Price List** (`service_events` table) which defines rates per service, optionally tiered by item class (size).

---

## Table of Contents

1. [Core Concepts](#core-concepts)
2. [Price List Structure](#price-list-structure)
3. [Item Classes (Pricing Tiers)](#item-classes-pricing-tiers)
4. [Billing Event Types](#billing-event-types)
5. [Service-Specific Billing](#service-specific-billing)
6. [Billing Triggers](#billing-triggers)
7. [Alert Rules](#alert-rules)
8. [Database Schema](#database-schema)
9. [Rate Lookup Logic](#rate-lookup-logic)
10. [Reporting & Export](#reporting--export)

---

## Core Concepts

### Key Tables

| Table | Purpose |
|-------|---------|
| `service_events` | Price List - defines all billable services and their rates |
| `classes` | Item size/pricing tiers (XS, S, M, L, XL, XXL) |
| `billing_events` | Generated billing charges for invoicing |
| `billable_services` | Legacy service definitions (deprecated) |

### Billing Flow

```
Service Performed → Rate Lookup (service_events) → Billing Event Created → Invoice Generated
       ↓                    ↓
  Uses item's class    class_code + service_code = rate
```

---

## Price List Structure

The Price List is stored in the `service_events` table with the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `service_code` | string | Unique identifier for the service (e.g., "RCVG", "INSP", "15MA") |
| `service_name` | string | Display name (e.g., "Receiving", "Inspection", "15 Min Assembly") |
| `class_code` | string | Size tier: XS, S, M, L, XL, XXL, or NULL for flat-rate |
| `rate` | decimal | Dollar amount per billing unit |
| `billing_unit` | enum | "Item", "Day", or "Task" |
| `billing_trigger` | string | When the charge is created (see Billing Triggers) |
| `taxable` | boolean | Whether tax applies |
| `uses_class_pricing` | boolean | If true, rate varies by item class |
| `add_flag` | boolean | Creates a flag on the item when charged |
| `add_to_service_event_scan` | boolean | Shows in Scan Hub service selection |
| `alert_rule` | string | Notification rule: "none", "email_office", "email_customer" |
| `service_time_minutes` | integer | Estimated time for labor tracking |
| `is_active` | boolean | Whether this rate is currently in use |

### Example Price List Entries

```
Service Code | Service Name      | Class | Rate   | Billing Unit | Trigger
-------------|-------------------|-------|--------|--------------|------------------
RCVG         | Receiving         | XS    | $5.00  | Item         | Per Item Auto
RCVG         | Receiving         | S     | $7.50  | Item         | Per Item Auto
RCVG         | Receiving         | M     | $10.00 | Item         | Per Item Auto
RCVG         | Receiving         | L     | $15.00 | Item         | Per Item Auto
RCVG         | Receiving         | XL    | $25.00 | Item         | Per Item Auto
INSP         | Inspection        | NULL  | $15.00 | Item         | Through Task
15MA         | 15 Min Assembly   | NULL  | $25.00 | Task         | Through Task
1HRO         | 1 Hour On-Site    | NULL  | $85.00 | Task         | Through Task
STORAGE      | Daily Storage     | XS    | $0.03  | Day          | Autocalculate
STORAGE      | Daily Storage     | M     | $0.05  | Day          | Autocalculate
Will_Call    | Will Call/Pickup  | NULL  | $15.00 | Item         | Shipment
```

---

## Item Classes (Pricing Tiers)

Items are assigned a **class** that determines their pricing tier:

| Class | Code | Description | Typical Cubic Feet |
|-------|------|-------------|-------------------|
| Extra Small | XS | Small boxes, accessories | 0 - 2 cu ft |
| Small | S | Chairs, side tables | 2 - 6 cu ft |
| Medium | M | Sofas (2-seat), dressers | 6 - 15 cu ft |
| Large | L | Sofas (3-seat), beds | 15 - 30 cu ft |
| Extra Large | XL | Sectionals, armoires | 30 - 50 cu ft |
| XX Large | XXL | Oversized items | 50+ cu ft |

### Class Table Fields (`classes`)

| Field | Description |
|-------|-------------|
| `code` | Short code (XS, S, M, L, XL, XXL) |
| `name` | Display name |
| `min_cubic_feet` | Class cubic-feet size (single value; stored here for compatibility) |
| `max_cubic_feet` | Same as `min_cubic_feet` (should match; legacy range configs may exist) |
| `storage_rate_per_day` | Default daily storage rate |
| `inspection_fee_per_item` | Default inspection rate |
| `default_inspection_minutes` | Labor time estimate |
| `sort_order` | Display ordering |

---

## Billing Event Types

Each billing event has an `event_type` that categorizes the charge:

| Event Type | Description | Triggered By |
|------------|-------------|--------------|
| `receiving` | Item received into warehouse | Receiving session completion (`useReceivingSession.ts`) |
| `returns_processing` | Return shipment received | Return shipment completion (`useReceivingSession.ts`) |
| `task_completion` | Task service performed | Task marked complete (`useTasks.ts`) |
| `storage` | Daily/monthly storage | Storage calculator in Billing Reports |
| `will_call` | Customer pickup/delivery | Outbound shipment completion (`useOutbound.ts`) |
| `disposal` | Item disposed | Disposal task completion |
| `flag` | Flag-based charge | Flag set on item (e.g., "Received Without ID") |
| `addon` | Manual add-on charge | `AddAddonDialog` via page-level "Add Charge" button |
| `outbound_shipment` | Outbound shipping | Shipment release |

### How Billing Events Are Created

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     BILLING EVENT CREATION SOURCES                          │
└─────────────────────────────────────────────────────────────────────────────┘

1. RECEIVING SESSION COMPLETION (useReceivingSession.ts)
   └─ When: User clicks "Finish Receiving"
   └─ Creates: One billing event per item received
   └─ Event Type: 'receiving' or 'returns_processing'
   └─ Rate: Looked up from Price List based on item class

2. TASK COMPLETION (useTasks.ts)
   └─ When: Task status set to 'completed'
   └─ Creates: Billing events based on task type and items
   └─ Event Type: 'task_completion'
   └─ Rate: From TASK_TYPE_TO_SERVICE_CODE mapping

3. OUTBOUND COMPLETION (useOutbound.ts)
   └─ When: Outbound shipment marked as shipped
   └─ Creates: Billing events for shipping/delivery
   └─ Event Type: 'will_call' or 'outbound_shipment'

4. MANUAL ADD-ON (AddAddonDialog.tsx)
   └─ When: User clicks "Add Charge" button on shipment/task page
   └─ Creates: Single billing event with user-specified amount
   └─ Event Type: 'addon'
   └─ Rate: User enters manually

5. STORAGE CALCULATION (Billing Reports)
   └─ When: Storage calculator run for date range
   └─ Creates: Storage charges based on item days in warehouse
   └─ Event Type: 'storage'
```

---

## Service-Specific Billing

### 1. Receiving (Inbound Shipments)

**When:** Items are received and verified in a receiving session
**Service Code:** `RCVG` (or `Returns` for return shipments)
**Rate Lookup:** Uses item's assigned class code

```typescript
// Rate lookup: service_code = 'RCVG', class_code = item.class.code
// Creates billing_event with:
//   - event_type: 'receiving'
//   - charge_type: 'RCVG'
//   - quantity: number of items received
//   - class_id: references classes table
```

**Special Flag:** If "Received Without ID" is checked, creates additional billing event:
- Service Code: `RECEIVED_WITHOUT_ID`
- Event Type: `flag`

---

### 2. Tasks (Inspection, Assembly, Repair, etc.)

**When:** Task is marked as complete
**Service Codes:**

| Task Type | Service Code | Description |
|-----------|--------------|-------------|
| Inspection | `INSP` | Item condition inspection |
| Assembly | `15MA`, `30MA`, `1HA` | Assembly by time tier |
| Repair | `1HRO`, `2HRO` | Repair by time tier |
| Will Call | `Will_Call` | Pickup/delivery |
| Disposal | `Disposal` | Item disposal |
| Returns | `Returns` | Returns processing |

**Rate Lookup:**
```typescript
// 1. Get service_code from TASK_TYPE_TO_SERVICE_CODE mapping
// 2. Get item's class code
// 3. Lookup rate from service_events where:
//    - service_code matches
//    - class_code matches (or is NULL for flat-rate)
```

**Task Custom Charges:**
- Tasks can have manual custom charges added
- Converted to `addon` billing events on task completion
- Stored in `task_custom_charges` table during task

---

### 3. Storage

**When:** Calculated via Billing Reports storage calculator
**Service Code:** `STORAGE`
**Billing Unit:** Day (per cubic foot per day)

**Calculation Logic:**
```
1. Get all items in storage during date range
2. For each item:
   - Calculate cubic feet from dimensions
   - Get storage rate from item's class
   - Calculate billable days (excluding free days)
   - Total = billable_days × daily_rate × cubic_feet
```

**Free Storage Days:**
- Accounts can have `free_storage_days` setting
- Days from receiving until free period ends are not billed

---

### 4. Outbound/Will Call

**When:** Outbound shipment is completed (shipped)
**Service Code:** `Will_Call`
**Rate Lookup:** Uses item's class code

```typescript
// Creates billing_event with:
//   - event_type: 'will_call'
//   - charge_type: 'Will_Call'
//   - shipment_id: outbound shipment reference
```

---

### 5. Scan Events (Scan Hub)

**When:** Technician scans item and selects service in Scan Hub
**Trigger:** `SCAN EVENT` billing trigger

Services with `add_to_service_event_scan = true` appear in Scan Hub service dropdown.

---

## Billing Triggers

The `billing_trigger` field determines WHEN a charge is created:

| Trigger | Description | Example Services |
|---------|-------------|------------------|
| `SCAN EVENT` | Created when item scanned for service | Ad-hoc services |
| `AUTOCALCULATE` | System calculates automatically | Storage |
| `Per Item Auto Calculated` | Rate × quantity on action | Receiving |
| `Flag` | Creates flag for review | Damage noted |
| `Task - Assign Rate` | Rate locked when task assigned | Time-based repairs |
| `Through Task` | Billed on task completion | Inspection, Assembly |
| `Shipment` | Billed per shipment | Delivery fees |
| `Stocktake` | Billed during inventory count | Audit fees |

---

## Alert Rules

The `alert_rule` field controls notifications when charges are created:

| Rule | Description |
|------|-------------|
| `none` | No notification |
| `email_office` | Email notification to office/admin |
| `email_customer` | Email notification to customer |

Alerts are queued via `queueBillingEventAlert()` and processed asynchronously.

---

## Database Schema

### billing_events Table

```sql
CREATE TABLE billing_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  account_id UUID REFERENCES accounts(id),
  sidemark_id UUID REFERENCES sidemarks(id),
  class_id UUID REFERENCES classes(id),      -- Links to pricing tier
  service_id UUID REFERENCES billable_services(id),
  item_id UUID REFERENCES items(id),
  task_id UUID REFERENCES tasks(id),
  shipment_id UUID REFERENCES shipments(id),

  event_type VARCHAR NOT NULL,               -- receiving, task_completion, etc.
  charge_type VARCHAR NOT NULL,              -- service_code from price list
  description TEXT,

  quantity DECIMAL DEFAULT 1,
  unit_rate DECIMAL NOT NULL,
  total_amount DECIMAL NOT NULL,

  status VARCHAR DEFAULT 'unbilled',         -- unbilled, invoiced, void
  occurred_at TIMESTAMP NOT NULL,
  invoice_id UUID,
  invoiced_at TIMESTAMP,

  has_rate_error BOOLEAN DEFAULT FALSE,
  rate_error_message TEXT,
  needs_review BOOLEAN DEFAULT FALSE,

  metadata JSONB DEFAULT '{}',
  created_by UUID,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### service_events Table (Price List)

```sql
CREATE TABLE service_events (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,

  service_code VARCHAR NOT NULL,
  service_name VARCHAR NOT NULL,
  class_code VARCHAR,                        -- XS, S, M, L, XL, XXL, or NULL

  billing_unit VARCHAR NOT NULL,             -- Day, Item, Task
  billing_trigger VARCHAR NOT NULL,
  rate DECIMAL NOT NULL,
  service_time_minutes INTEGER,

  taxable BOOLEAN DEFAULT FALSE,
  uses_class_pricing BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,

  add_flag BOOLEAN DEFAULT FALSE,
  add_to_service_event_scan BOOLEAN DEFAULT FALSE,
  alert_rule VARCHAR DEFAULT 'none',

  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

---

## Rate Lookup Logic

The system looks up rates using this priority:

```typescript
async function getRateFromPriceList(tenantId, serviceCode, classCode) {
  // 1. Try class-specific rate first
  if (classCode) {
    const classRate = await supabase
      .from('service_events')
      .select('rate, service_name, alert_rule')
      .eq('tenant_id', tenantId)
      .eq('service_code', serviceCode)
      .eq('class_code', classCode)
      .eq('is_active', true)
      .maybeSingle();

    if (classRate) return classRate;
  }

  // 2. Fall back to base rate (no class_code)
  const baseRate = await supabase
    .from('service_events')
    .select('rate, service_name, alert_rule')
    .eq('tenant_id', tenantId)
    .eq('service_code', serviceCode)
    .is('class_code', null)
    .eq('is_active', true)
    .maybeSingle();

  if (baseRate) return baseRate;

  // 3. Return 0 with error flag if no rate found
  return { rate: 0, hasError: true, errorMessage: 'No rate found' };
}
```

---

## Reporting & Export

### Billing Reports Page

Located at `/billing/reports`, provides:

- **Date Range Filter:** View charges for specific period
- **Account Filter:** Filter by customer account
- **Sidemark Filter:** Filter by project/sidemark
- **Class Filter:** Filter by pricing tier
- **Service Filter:** Filter by service type
- **Status Filter:** Unbilled, Invoiced, Void

### Export Options

1. **Excel Export:** Full billing data with all fields
2. **QuickBooks Sync:** Push invoiceable charges to QuickBooks
3. **Storage Calculator:** Generate storage charges for date range

### Key Metrics

- Total unbilled amount
- Total invoiced amount
- Charges by service type
- Charges by account
- Rate errors requiring review

---

## File Locations

| Purpose | File Path |
|---------|-----------|
| **Shared Billing Logic** | `src/lib/billing/billingCalculation.ts` |
| Billing Calculator | `src/components/billing/BillingCalculator.tsx` |
| Add Charge Dialog | `src/components/billing/AddAddonDialog.tsx` |
| Price List Settings | `src/components/settings/ServiceEventsPricingTab.tsx` |
| Classes Settings | `src/components/settings/ClassesSettingsTab.tsx` |
| Billing Reports | `src/pages/BillingReports.tsx` |
| Task Billing | `src/hooks/useTasks.ts` |
| Receiving Billing | `src/hooks/useReceivingSession.ts` |
| Outbound Billing | `src/hooks/useOutbound.ts` |
| Billing Event Creator | `src/lib/billing/createBillingEvent.ts` |
| Promo Code Utils | `src/lib/billing/promoCodeUtils.ts` |

---

## Billing Calculator

The Billing Calculator (`src/components/billing/BillingCalculator.tsx`) is a **read-only, real-time view** that displays:

1. **Recorded Charges**: Actual `billing_events` from the database
2. **Pending Charges (Preview)**: What WILL be created when receiving/task completes

### Key Points

- **Does NOT create charges** - it only displays them
- **Fetches existing billing events** from the database for the shipment/task
- **Shows preview** only for pending shipments/tasks (hides after completion)
- **Refreshes** when `refreshKey` prop is incremented

### Adding Charges

To add manual charges, use the page-level "Add Charge" button which opens `AddAddonDialog`:

```tsx
// In ShipmentDetail.tsx or TaskDetail.tsx
<Button onClick={() => setAddAddonDialogOpen(true)}>
  Add Charge
</Button>

<AddAddonDialog
  accountId={shipment.account_id}
  shipmentId={shipment.id}
  onSuccess={() => {
    fetchShipment();
    setBillingRefreshKey(prev => prev + 1);  // Refresh calculator
  }}
/>
```

See `docs/BILLING_CALCULATOR_DOCUMENTATION.md` for detailed calculator documentation.

---

## Summary

The Stride WMS billing system:

1. **Uses a unified Price List** (`service_events`) for all service rates
2. **Supports class-based pricing** (XS-XXL tiers) for size-dependent rates
3. **Automatically generates billing events** when services are performed
4. **Tracks all charges** with full audit trail
5. **Integrates with invoicing** via QuickBooks or Excel export
6. **Provides real-time visibility** via the Billing Calculator

All billing events reference:
- The **item's class** for rate calculation
- The **account** for invoicing
- The **service** for categorization
- The **source** (task, shipment, item) for traceability

---

*Document updated: January 30, 2026*
*Stride WMS Version: Current*
