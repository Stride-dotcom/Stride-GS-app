# Stride WMS Billing Calculator Documentation

## Overview

The **Billing Calculator** is a real-time, read-only view component that displays billing charges for shipments and tasks. It combines:

1. **Recorded Charges**: Actual `billing_events` from the database that have already been created
2. **Preview Charges**: What WILL be created when a shipment is received or task is completed (for pending items)

**Key Principle**: The Calculator is a **read-only view**. To add charges, use the page-level "Add Charge" button (which creates billing events via `AddAddonDialog`). The Calculator then displays those charges in real-time.

---

## Table of Contents

1. [Design Philosophy](#design-philosophy)
2. [Architecture Overview](#architecture-overview)
3. [Core Files and Their Purpose](#core-files-and-their-purpose)
4. [Service Code Mappings](#service-code-mappings)
5. [Rate Lookup Function](#rate-lookup-function)
6. [Preview Calculation Functions](#preview-calculation-functions)
7. [BillingCalculator Component](#billingcalculator-component)
8. [How Everything Connects](#how-everything-connects)
9. [Adding New Order Types](#adding-new-order-types)
10. [Usage Examples](#usage-examples)
11. [Troubleshooting](#troubleshooting)

---

## Design Philosophy

### The Problem We Solved

Previously, the billing calculator:
- Had its own "Add Charge" button that only saved to local state (not the database)
- Was separate from the actual billing events table, causing mismatches
- Created confusion about which charges were "real" and which were just previews

### The Solution

The Calculator now serves as a **real-time view** that:
1. **Fetches existing billing events** from the database for the shipment/task
2. **Shows a preview** of charges that WILL be created (for pending shipments/tasks)
3. **Does NOT create charges itself** - charges are created via:
   - Receiving session completion (automatic)
   - Task completion (automatic)
   - Page-level "Add Charge" button (manual add-ons)

### Display Logic

| Scenario | Calculator Shows |
|----------|-----------------|
| **Shipment NOT yet received** | Preview: "Pending Charges" + Any manual add-ons already created |
| **Shipment already received** | Recorded: Actual receiving charges + Any manual add-ons |
| **Task NOT yet completed** | Preview: What will be billed when task completes |
| **Task completed** | Recorded: Actual charges from task completion |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              ARCHITECTURE                                    │
└─────────────────────────────────────────────────────────────────────────────┘

                         PRICE LIST (service_events table)
                         ┌─────────────────────────────────┐
                         │ service_code │ class_code │ rate│
                         │ RCVG         │ M          │ $15 │
                         │ RCVG         │ L          │ $20 │
                         │ INSP         │ M          │ $35 │
                         │ Shipping     │ M          │ $15 │
                         │ 15MA         │ NULL       │ $35 │
                         │ 1HRO         │ NULL       │ $105│
                         └─────────────────────────────────┘
                                        │
                                        ▼
                    ┌──────────────────────────────────────┐
                    │  src/lib/billing/billingCalculation.ts│
                    │  ════════════════════════════════════ │
                    │                                       │
                    │  MAPPINGS:                            │
                    │  • TASK_TYPE_TO_SERVICE_CODE          │
                    │  • SHIPMENT_DIRECTION_TO_SERVICE_CODE │
                    │                                       │
                    │  FUNCTIONS:                           │
                    │  • getRateFromPriceList()             │
                    │  • calculateTaskBillingPreview()      │
                    │  • calculateShipmentBillingPreview()  │
                    │  • getAssemblyServices()              │
                    │  • getRepairServiceRate()             │
                    │                                       │
                    └──────────────────────────────────────┘
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              │                         │                         │
              ▼                         ▼                         ▼
┌─────────────────────────┐ ┌─────────────────────────┐ ┌─────────────────────────┐
│ BillingCalculator.tsx   │ │ useReceivingSession.ts  │ │ useTasks.ts             │
│ (Real-Time View)        │ │ (Receiving Completion)  │ │ (Task Completion)       │
│                         │ │                         │ │                         │
│ DISPLAYS:               │ │ CREATES billing events  │ │ CREATES billing events  │
│ • Existing events (DB)  │ │ when shipment received  │ │ when task completed     │
│ • Preview (pending)     │ │                         │ │                         │
│                         │ │ Uses:                   │ │ Uses:                   │
│ Uses:                   │ │ • getRateFromPriceList  │ │ • TASK_TYPE_TO_SERVICE  │
│ • Fetch billing_events  │ │ • class → rate lookup   │ │ • getRateFromPriceList  │
│ • calculatePreview()    │ │                         │ │                         │
└─────────────────────────┘ └─────────────────────────┘ └─────────────────────────┘
              │                         │                         │
              ▼                         ▼                         ▼
      [Display to User]         [billing_events table]    [billing_events table]
                                        │                         │
                                        └────────────┬────────────┘
                                                     │
                                                     ▼
                                        ┌─────────────────────────┐
                                        │ Calculator FETCHES and  │
                                        │ displays these records  │
                                        └─────────────────────────┘
```

### Adding Manual Charges

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        MANUAL CHARGE FLOW                                    │
└─────────────────────────────────────────────────────────────────────────────┘

User clicks "Add Charge"          AddAddonDialog             Calculator
(page-level button)               ┌─────────────────┐       ┌────────────────┐
       │                          │                 │       │                │
       └─────────────────────────→│ User enters:    │       │                │
                                  │ • Charge name   │       │                │
                                  │ • Amount        │       │                │
                                  │ • Notes         │       │                │
                                  │                 │       │                │
                                  │ INSERT INTO     │       │                │
                                  │ billing_events  │───────│ onSuccess:     │
                                  │ (event_type:    │       │ refreshKey++   │
                                  │  'addon')       │       │                │
                                  └─────────────────┘       │ fetchEvents()  │
                                                            │ → Displays new │
                                                            │   charge!      │
                                                            └────────────────┘
```

---

## Core Files and Their Purpose

### File: `src/lib/billing/billingCalculation.ts`

**This is the heart of the billing system.** All billing logic lives here.

| Export | Type | Purpose |
|--------|------|---------|
| `TASK_TYPE_TO_SERVICE_CODE` | Constant | Maps task types to service codes |
| `SHIPMENT_DIRECTION_TO_SERVICE_CODE` | Constant | Maps shipment directions to service codes |
| `getRateFromPriceList()` | Function | Looks up rate from Price List |
| `calculateTaskBillingPreview()` | Function | Calculates billing preview for a task |
| `calculateShipmentBillingPreview()` | Function | Calculates billing preview for a shipment |
| `getAssemblyServices()` | Function | Gets assembly service options for dropdown |
| `getRepairServiceRate()` | Function | Gets repair hourly rate |

### File: `src/components/billing/BillingCalculator.tsx`

**The UI component** that displays billing previews. It:
- Receives context (task ID, shipment ID, type)
- Calls the appropriate preview function
- Displays the calculated charges
- Allows rate overrides for Assembly/Repair

### File: `src/lib/billing/createBillingEvent.ts`

**Creates actual billing events** in the database. Used when tasks/shipments complete.

### File: `src/hooks/useTasks.ts`

**Handles task operations.** When a task completes, it uses `TASK_TYPE_TO_SERVICE_CODE` to determine what to bill.

### File: `src/hooks/useOutbound.ts`

**Handles shipment operations.** When a shipment completes, it uses `SHIPMENT_DIRECTION_TO_SERVICE_CODE` to determine what to bill.

---

## Service Code Mappings

### TASK_TYPE_TO_SERVICE_CODE

This mapping tells the system: "When this type of task completes, bill using this service code."

```typescript
export const TASK_TYPE_TO_SERVICE_CODE: Record<string, string> = {
  'Inspection': 'INSP',      // Inspection task → INSP service
  'Will Call': 'Will_Call',  // Will Call task → Will_Call service
  'Disposal': 'Disposal',    // Disposal task → Disposal service
  'Assembly': '15MA',        // Assembly task → 15MA (default, can be overridden)
  'Repair': '1HRO',          // Repair task → 1HRO (hourly repair)
  'Receiving': 'RCVG',       // Receiving task → RCVG service
  'Returns': 'Returns',      // Returns task → Returns service
};
```

**How to add a new task type:**
```typescript
// Example: Adding a "Reupholstery" task type
'Reupholstery': 'REUP',  // Maps to REUP service in Price List
```

### SHIPMENT_DIRECTION_TO_SERVICE_CODE

This mapping tells the system: "When this type of shipment completes, bill using this service code."

```typescript
export const SHIPMENT_DIRECTION_TO_SERVICE_CODE: Record<string, string> = {
  'inbound': 'RCVG',      // Inbound shipment → RCVG (Receiving)
  'outbound': 'Shipping', // Outbound shipment → Shipping service
  'return': 'Returns',    // Return shipment → Returns service
};
```

---

## Rate Lookup Function

### `getRateFromPriceList()`

This is the **core rate lookup function**. It finds the rate for a service code and class.

```typescript
async function getRateFromPriceList(
  tenantId: string,
  serviceCode: string,
  classCode: string | null
): Promise<RateLookupResult>
```

### Lookup Priority

```
1. Class-Specific Rate
   → Look for: service_code = 'RCVG' AND class_code = 'M'
   → If found: return $15
         ↓ (if not found)

2. General Rate (fallback)
   → Look for: service_code = 'RCVG' AND class_code = NULL
   → If found: return default rate
         ↓ (if not found)

3. Return $0 with error flag
   → hasError = true
   → errorMessage = "No rate found for service: RCVG"
```

### Return Type

```typescript
interface RateLookupResult {
  rate: number;           // The rate amount (e.g., 15.00)
  serviceName: string;    // Display name (e.g., "Receiving")
  serviceCode: string;    // Service code (e.g., "RCVG")
  billingUnit: string;    // 'Day' | 'Item' | 'Task'
  alertRule: string;      // Alert rule from Price List
  hasError: boolean;      // True if rate not found
  errorMessage?: string;  // Error description if hasError
}
```

---

## Preview Calculation Functions

### `calculateTaskBillingPreview()`

Calculates billing preview for a task.

```typescript
async function calculateTaskBillingPreview(
  tenantId: string,
  taskId: string,
  taskType: string,
  overrideServiceCode?: string | null,  // For Assembly - specific service
  overrideQuantity?: number | null,     // For Assembly/Repair - qty
  overrideRate?: number | null          // Manual rate override
): Promise<BillingPreview>
```

**How it works:**

```
1. Determine service code
   └─ Use overrideServiceCode if provided
   └─ Otherwise: TASK_TYPE_TO_SERVICE_CODE[taskType]

2. Fetch task items
   └─ SELECT * FROM task_items WHERE task_id = ?
   └─ JOIN items to get class_id
   └─ JOIN classes to get class code

3. For Assembly/Repair with quantity:
   └─ Single line item: quantity × rate

4. For per-item tasks (Inspection, etc.):
   └─ For each item:
      └─ Get class code
      └─ getRateFromPriceList(serviceCode, classCode)
      └─ Add: quantity × rate

5. Return BillingPreview
   └─ lineItems[], subtotal, hasErrors
```

### `calculateShipmentBillingPreview()`

Calculates billing preview for a shipment.

```typescript
async function calculateShipmentBillingPreview(
  tenantId: string,
  shipmentId: string,
  direction: 'inbound' | 'outbound' | 'return'
): Promise<BillingPreview>
```

**How it works:**

```
1. Determine service code
   └─ SHIPMENT_DIRECTION_TO_SERVICE_CODE[direction]
   └─ inbound → 'RCVG'
   └─ outbound → 'Shipping'

2. Fetch shipment items
   └─ SELECT * FROM shipment_items WHERE shipment_id = ?
   └─ JOIN items to get class_id
   └─ JOIN classes to get class code

3. For each item:
   └─ Get class code
   └─ getRateFromPriceList(serviceCode, classCode)
   └─ quantity = quantity_received || quantity_expected
   └─ Add: quantity × rate

4. Return BillingPreview
   └─ lineItems[], subtotal, hasErrors
```

### Return Type: `BillingPreview`

```typescript
interface BillingPreview {
  lineItems: BillingLineItem[];  // Individual charges
  subtotal: number;              // Total of all line items
  hasErrors: boolean;            // True if any rate lookup failed
  serviceCode: string;           // Primary service code used
  serviceName: string;           // Display name of service
}

interface BillingLineItem {
  itemId: string | null;
  itemCode: string | null;
  classCode: string | null;
  className: string | null;
  serviceCode: string;
  serviceName: string;
  quantity: number;
  unitRate: number;
  totalAmount: number;
  hasRateError: boolean;
  errorMessage?: string;
}
```

---

## BillingCalculator Component

### Location

`src/components/billing/BillingCalculator.tsx`

### Component Behavior Overview

The BillingCalculator is a **read-only display component**. It does NOT create charges itself.

| Display Section | Source | When Shown |
|-----------------|--------|------------|
| **"Pending Charges (Preview)"** | `calculateShipmentBillingPreview()` or `calculateTaskBillingPreview()` | Only when shipment not yet received, or task not yet completed |
| **"Recorded Charges"** | `billing_events` table (fetched from DB) | Always - shows all existing charges for this shipment/task |

### Props

```typescript
interface BillingCalculatorProps {
  // ══════════════════════════════════════════════════════════
  // CONTEXT - Provide ONE of these
  // ══════════════════════════════════════════════════════════
  taskId?: string;              // For task billing view
  shipmentId?: string;          // For shipment billing view

  // ══════════════════════════════════════════════════════════
  // CONTEXT DETAILS
  // ══════════════════════════════════════════════════════════
  taskType?: string;            // 'Inspection', 'Assembly', etc.
  shipmentDirection?: 'inbound' | 'outbound' | 'return';

  // ══════════════════════════════════════════════════════════
  // FOR ASSEMBLY/REPAIR - Manual inputs (for preview calculation)
  // ══════════════════════════════════════════════════════════
  selectedServiceCode?: string; // Selected assembly tier (5MA, 15MA, etc.)
  billingQuantity?: number;     // Quantity or hours
  billingRate?: number;         // Rate override

  // ══════════════════════════════════════════════════════════
  // CALLBACKS
  // ══════════════════════════════════════════════════════════
  onServiceChange?: (code: string) => void;
  onQuantityChange?: (qty: number) => void;
  onRateChange?: (rate: number | null) => void;
  onTotalChange?: (total: number) => void;

  // ══════════════════════════════════════════════════════════
  // DISPLAY OPTIONS
  // ══════════════════════════════════════════════════════════
  title?: string;               // Card title (default: "Billing Charges")
  compact?: boolean;            // Compact mode (default: true)
  readOnly?: boolean;           // Disable rate editing for Assembly/Repair
  refreshKey?: number;          // Increment to force refresh (after adding charges)
}
```

### Internal Data Fetching

The component internally fetches:

1. **Existing billing events** from `billing_events` table:
```typescript
supabase
  .from('billing_events')
  .select('id, charge_type, description, quantity, unit_rate, total_amount, event_type, status')
  .eq('tenant_id', tenantId)
  .eq('shipment_id', shipmentId)  // or task_id
  .in('status', ['unbilled', 'flagged', 'billed'])
```

2. **Preview calculation** via `calculateShipmentBillingPreview()` or `calculateTaskBillingPreview()`

### Preview vs Recorded Logic

For **Shipments**:
- If receiving charges already exist in DB (event_type = 'receiving' or 'returns_processing'), **hide preview**
- Only show preview for shipments that haven't been received yet

For **Tasks**:
- Always show preview (task charges are created on completion)

### Refreshing After Adding Charges

When the page-level "Add Charge" button creates a new billing event, the parent component should:
```typescript
<AddAddonDialog
  onSuccess={() => {
    fetchShipment();               // Refresh shipment data
    setBillingRefreshKey(prev => prev + 1);  // Trigger calculator refresh
  }}
/>

<BillingCalculator
  shipmentId={shipment.id}
  refreshKey={billingRefreshKey}  // Calculator re-fetches when this changes
/>
```
  // ══════════════════════════════════════════════════════════
  title?: string;               // Card title (default: "Billing Charges")
  compact?: boolean;            // Compact mode (default: true)
  readOnly?: boolean;           // Disable editing
  refreshKey?: number;          // Increment to force refresh
}
```

### Component Behavior

| Task Type | Behavior |
|-----------|----------|
| **Inspection, Will Call, Disposal** | Per-item billing based on item classes |
| **Assembly** | Dropdown to select service tier + quantity input |
| **Repair** | Hours input × hourly rate |
| **Shipment (inbound)** | Per-item billing using RCVG rates |
| **Shipment (outbound)** | Per-item billing using Shipping rates |

---

## How Everything Connects

### Complete Flow: Task Creation to Billing Report

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 1: User Creates Inspection Task                                        │
│ ─────────────────────────────────────                                       │
│                                                                             │
│ Task Form shows BillingCalculator:                                          │
│ ┌─────────────────────────────────────────┐                                │
│ │ Billing Charges                         │                                │
│ │                                         │                                │
│ │ Inspection (M) ×3    $35.00    $105.00 │                                │
│ │ Inspection (L) ×2    $55.00    $110.00 │                                │
│ │ ─────────────────────────────────────── │                                │
│ │ Total:                         $215.00 │                                │
│ └─────────────────────────────────────────┘                                │
│                                                                             │
│ Behind the scenes:                                                          │
│ 1. BillingCalculator receives taskId + taskType="Inspection"               │
│ 2. Calls calculateTaskBillingPreview(tenantId, taskId, "Inspection")       │
│ 3. Function looks up TASK_TYPE_TO_SERVICE_CODE["Inspection"] = "INSP"      │
│ 4. Fetches task items with classes                                          │
│ 5. For each item: getRateFromPriceList("INSP", classCode)                  │
│ 6. Returns preview with line items                                          │
│                                                                             │
│ NOTE: No billing event exists yet - this is just a PREVIEW                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 2: User Completes Task                                                  │
│ ───────────────────────────                                                 │
│                                                                             │
│ useTasks.ts → completeTask() is called                                      │
│                                                                             │
│ 1. Determines service code:                                                 │
│    serviceCode = TASK_TYPE_TO_SERVICE_CODE["Inspection"] = "INSP"          │
│                                                                             │
│ 2. For each task item:                                                      │
│    - Gets class code from item                                              │
│    - Calls getRateFromPriceList("INSP", classCode)                         │
│    - Creates billing event:                                                 │
│      createBillingEvent({                                                   │
│        charge_type: "INSP",                                                 │
│        unit_rate: 35.00,                                                    │
│        quantity: 3,                                                         │
│        total_amount: 105.00                                                 │
│      })                                                                     │
│                                                                             │
│ 3. billing_events table now has records                                    │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ STEP 3: Billing Reports Show the Charges                                    │
│ ─────────────────────────────────────────                                   │
│                                                                             │
│ Billing Reports page:                                                       │
│ - Queries billing_events table                                              │
│ - Shows same $215.00 that Calculator previewed                             │
│                                                                             │
│ ┌─────────────────────────────────────────────────────────────────────┐    │
│ │ Date       │ Service    │ Class │ Qty │ Rate   │ Amount  │ Status  │    │
│ │ Jan 30     │ Inspection │ M     │ 3   │ $35.00 │ $105.00 │ Unbilled│    │
│ │ Jan 30     │ Inspection │ L     │ 2   │ $55.00 │ $110.00 │ Unbilled│    │
│ └─────────────────────────────────────────────────────────────────────┘    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Adding New Order Types

### Example: Adding Delivery Orders

Let's say you want to add a new "Delivery" order type with billing.

#### Step 1: Add Service to Price List

In the Price List (service_events table), add delivery services:

```
service_code: 'DLVR_LOCAL'
service_name: 'Local Delivery'
class_code: NULL (or per-class rates)
rate: 75.00
billing_trigger: 'Delivery'
```

#### Step 2: Add Mapping to billingCalculation.ts

```typescript
// Add new mapping for delivery
export const DELIVERY_TYPE_TO_SERVICE_CODE: Record<string, string> = {
  'local': 'DLVR_LOCAL',
  'white_glove': 'DLVR_WHITE',
  'freight': 'DLVR_FREIGHT',
};
```

#### Step 3: Create Preview Function

```typescript
/**
 * Calculate billing preview for a DELIVERY
 */
export async function calculateDeliveryBillingPreview(
  tenantId: string,
  deliveryId: string,
  deliveryType: 'local' | 'white_glove' | 'freight'
): Promise<BillingPreview> {
  // Determine service code
  const serviceCode = DELIVERY_TYPE_TO_SERVICE_CODE[deliveryType] || 'DLVR_LOCAL';

  // Fetch delivery items
  const { data: deliveryItems } = await supabase
    .from('delivery_items')
    .select(`
      item_id,
      quantity,
      items:item_id (
        item_code,
        class_id,
        classes:class_id (code, name)
      )
    `)
    .eq('delivery_id', deliveryId);

  // Calculate for each item
  const lineItems: BillingLineItem[] = [];
  let subtotal = 0;
  let hasErrors = false;

  for (const di of deliveryItems || []) {
    const classCode = di.items?.classes?.code || null;
    const rateResult = await getRateFromPriceList(tenantId, serviceCode, classCode);

    const totalAmount = (di.quantity || 1) * rateResult.rate;
    lineItems.push({
      itemId: di.item_id,
      itemCode: di.items?.item_code,
      classCode,
      className: di.items?.classes?.name,
      serviceCode: rateResult.serviceCode,
      serviceName: rateResult.serviceName,
      quantity: di.quantity || 1,
      unitRate: rateResult.rate,
      totalAmount,
      hasRateError: rateResult.hasError,
      errorMessage: rateResult.errorMessage,
    });

    subtotal += totalAmount;
    if (rateResult.hasError) hasErrors = true;
  }

  return { lineItems, subtotal, hasErrors, serviceCode, serviceName: 'Delivery' };
}
```

#### Step 4: Update BillingCalculator Component

Add support for the new delivery context:

```typescript
// In BillingCalculator.tsx

interface BillingCalculatorProps {
  // ... existing props ...
  deliveryId?: string;
  deliveryType?: 'local' | 'white_glove' | 'freight';
}

// In the calculation logic:
if (isDelivery && deliveryId) {
  result = await calculateDeliveryBillingPreview(
    profile.tenant_id,
    deliveryId,
    deliveryType
  );
}
```

#### Step 5: Use in Delivery Form

```tsx
<BillingCalculator
  deliveryId={delivery.id}
  deliveryType="white_glove"
  onTotalChange={(total) => setDeliveryBilling(total)}
/>
```

#### Step 6: Create Billing Events on Delivery Completion

In your delivery hook (e.g., `useDelivery.ts`):

```typescript
import { DELIVERY_TYPE_TO_SERVICE_CODE, getRateFromPriceList } from '@/lib/billing/billingCalculation';

async function completeDelivery(deliveryId: string, deliveryType: string) {
  const serviceCode = DELIVERY_TYPE_TO_SERVICE_CODE[deliveryType];

  // Fetch delivery items
  const items = await getDeliveryItems(deliveryId);

  // Create billing events
  for (const item of items) {
    const rate = await getRateFromPriceList(tenantId, serviceCode, item.classCode);

    await createBillingEvent({
      tenant_id: tenantId,
      account_id: delivery.account_id,
      event_type: 'delivery',
      charge_type: serviceCode,
      quantity: item.quantity,
      unit_rate: rate.rate,
      // ... other fields
    });
  }
}
```

### Checklist for Adding New Order Types

- [ ] Add services to Price List (service_events table)
- [ ] Add mapping constant to `billingCalculation.ts`
- [ ] Create `calculate[Type]BillingPreview()` function
- [ ] Update BillingCalculator component props and logic
- [ ] Update your hook to create billing events on completion
- [ ] Test that Calculator preview matches actual billing

---

## Usage Examples

### Shipment Detail Page

```tsx
// State for refreshing the calculator when charges are added
const [billingRefreshKey, setBillingRefreshKey] = useState(0);

// ... in the component ...

{/* Page-level Add Charge Button */}
<Button onClick={() => setAddAddonDialogOpen(true)}>
  Add Charge
</Button>

{/* Billing Calculator - displays real-time charges */}
<BillingCalculator
  shipmentId={shipment.id}
  shipmentDirection="inbound"
  refreshKey={billingRefreshKey}
/>

{/* Add Charge Dialog - creates billing events */}
<AddAddonDialog
  open={addAddonDialogOpen}
  onOpenChange={setAddAddonDialogOpen}
  accountId={shipment.account_id}
  shipmentId={shipment.id}
  onSuccess={() => {
    fetchShipment();
    setBillingRefreshKey(prev => prev + 1);  // Refresh calculator
  }}
/>
```

### Task Detail Page

```tsx
<BillingCalculator
  taskId={task.id}
  taskType="Inspection"
  refreshKey={refreshKey}
/>
```

### Task (Assembly with Service Selection)

```tsx
const [selectedService, setSelectedService] = useState('60MA');
const [quantity, setQuantity] = useState(1);
const [rateOverride, setRateOverride] = useState<number | null>(null);

<BillingCalculator
  taskId={task.id}
  taskType="Assembly"
  selectedServiceCode={selectedService}
  billingQuantity={quantity}
  billingRate={rateOverride}
  onServiceChange={setSelectedService}
  onQuantityChange={setQuantity}
  onRateChange={setRateOverride}
  onTotalChange={(total) => setBillingTotal(total)}
/>
```

### Task (Repair with Hours)

```tsx
const [hours, setHours] = useState(0);
const [rateOverride, setRateOverride] = useState<number | null>(null);

<BillingCalculator
  taskId={task.id}
  taskType="Repair"
  billingQuantity={hours}
  billingRate={rateOverride}
  onQuantityChange={setHours}
  onRateChange={setRateOverride}
  onTotalChange={(total) => setBillingTotal(total)}
/>
```

---

## Troubleshooting

### Calculator Shows $0

**Possible causes:**
1. No items attached to task/shipment
2. Service code not found in Price List
3. No rate defined for the item's class

**How to debug:**
1. Check browser console for errors
2. Verify items exist in `task_items` or `shipment_items`
3. Verify service exists in `service_events` with correct `service_code`
4. Check if class-specific or default rate exists

### Calculator Shows Wrong Rate

**Possible causes:**
1. Wrong service code in mapping
2. Class code mismatch
3. Rate not updated in Price List

**How to fix:**
1. Check `TASK_TYPE_TO_SERVICE_CODE` mapping
2. Verify item has correct class assigned
3. Check Price List for correct rates

### Charges Added but Not Showing

**Possible causes:**
1. `refreshKey` not incremented after adding charge
2. Charge added to wrong shipment_id or task_id
3. Charge status not in ['unbilled', 'flagged', 'billed']

**How to fix:**
1. Ensure `onSuccess` callback increments `refreshKey`
2. Verify the charge was created with correct foreign keys
3. Check `billing_events` table directly

### Preview Still Showing After Receiving

**Expected behavior**: Once a shipment is received, the preview section hides and only "Recorded Charges" are shown.

**If preview still shows:**
1. Check that receiving events have `event_type` = 'receiving' or 'returns_processing'
2. Verify events exist in database with correct `shipment_id`

---

## File Reference

| File | Purpose |
|------|---------|
| `src/lib/billing/billingCalculation.ts` | **THE source of truth** - all mappings and rate lookup |
| `src/components/billing/BillingCalculator.tsx` | Real-time view component (read-only) |
| `src/components/billing/AddAddonDialog.tsx` | Creates manual add-on charges |
| `src/lib/billing/createBillingEvent.ts` | Creates actual billing events |
| `src/hooks/useReceivingSession.ts` | Receiving completion → billing events |
| `src/hooks/useTasks.ts` | Task completion → billing events |
| `src/hooks/useOutbound.ts` | Outbound shipment completion → billing events |
| `docs/BILLING_CALCULATOR_DOCUMENTATION.md` | This documentation |
| `docs/BILLING_SYSTEM_DOCUMENTATION.md` | Overall billing system docs |

---

## Summary

The Billing Calculator is a **real-time, read-only view** that:

1. **Fetches existing billing events** from the database for the shipment/task
2. **Shows preview of pending charges** for shipments not yet received or tasks not yet completed
3. **Does NOT create charges** - use the page-level "Add Charge" button or wait for task/receiving completion
4. **Refreshes automatically** when `refreshKey` prop changes (after adding charges)

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Calculator is read-only | Avoids confusion about which charges are "real" |
| Charges created via AddAddonDialog | Single source of truth for manual charges |
| Automatic charges on completion | Receiving/task completion creates events via hooks |
| Preview hides after receiving | Once events exist in DB, show those instead of preview |

### How Charges Get Into billing_events

| Trigger | Source | Event Type |
|---------|--------|------------|
| Finish Receiving | `useReceivingSession.ts` | `receiving` or `returns_processing` |
| Complete Task | `useTasks.ts` | `task_completion` |
| Complete Outbound | `useOutbound.ts` | `will_call` or `outbound_shipment` |
| Manual Add Charge | `AddAddonDialog.tsx` | `addon` |
| Storage Calculation | Billing Reports | `storage` |

---

*Document updated: January 30, 2026*
*Stride WMS Version: Current*
