/**
 * Billing Gateway Types — Phase B0
 *
 * All billing event types are DERIVED from existing library types.
 * Gateway-only types (BillingContextType, BillingContext) are defined here.
 */

import type { CreateBillingEventParams } from '@/lib/billing/createBillingEvent';

// =============================================================================
// DERIVED TYPES (from existing billing library)
// =============================================================================

/**
 * Derived from CreateBillingEventParams — NOT a manual union.
 * NOTE: This does not include event_type values used only by direct-insert
 * call sites (e.g. 'coverage', 'credit', 'claim_assistance'). Those will be
 * addressed in later phases when migrating those call sites.
 */
export type BillingEventType = CreateBillingEventParams['event_type'];

// =============================================================================
// GATEWAY-ONLY TYPES
// =============================================================================

/** Context type for billing operations (gateway metadata). */
export type BillingContextType = 'shipment' | 'task' | 'item' | 'intake' | 'manual';

/** Contextual identifiers attached to a billing charge. */
export interface BillingContext {
  type: BillingContextType;
  shipmentId?: string;
  taskId?: string;
  itemId?: string;
  intakeId?: string;
}

// =============================================================================
// CHARGE CREATION
// =============================================================================

export interface CreateChargeParams {
  // Required
  tenantId: string;
  accountId: string;
  chargeCode: string;
  eventType: BillingEventType;
  context: BillingContext;

  // Optional
  description?: string;
  quantity?: number;
  classCode?: string | null;
  rateOverride?: number;
  sidemarkId?: string | null;
  classId?: string | null;
  serviceId?: string | null;
  userId?: string;
  metadata?: Record<string, any>;

  // Promo control
  skipPromo?: boolean;

  // Error passthrough (from upstream callers that already know the rate status)
  hasRateError?: boolean;
  rateErrorMessage?: string | null;
}

// =============================================================================
// CHARGE PREVIEW
// =============================================================================

/** Subset of CreateChargeParams needed for rate preview. */
export type PreviewChargeParams = Pick<
  CreateChargeParams,
  'tenantId' | 'accountId' | 'chargeCode' | 'classCode' | 'quantity'
>;

// =============================================================================
// RESULTS
// =============================================================================

export interface ChargeResult {
  success: boolean;
  billingEventId?: string;
  amount?: number;
  hasRateError: boolean;
  errorMessage?: string;
}

export interface ChargePreview {
  rate: number;
  quantity: number;
  subtotal: number;
  serviceName: string;
  billingUnit: string;
  hasRateError: boolean;
  errorMessage?: string;
}

// =============================================================================
// RAW EVENT (no rate resolution, no promos — direct passthrough)
// =============================================================================

/** Payload for createEventRaw / createEventsRaw — inserted as-is. */
export interface RawBillingEventPayload {
  tenant_id: string;
  account_id: string | null;
  item_id?: string | null;
  task_id?: string | null;
  shipment_id?: string | null;
  claim_id?: string | null;
  sidemark_id?: string | null;
  class_id?: string | null;
  event_type: string;
  charge_type: string;
  description?: string | null;
  quantity: number;
  unit_rate: number;
  total_amount: number;
  status?: string;
  occurred_at?: string;
  metadata?: Record<string, any>;
  created_by?: string;
  has_rate_error?: boolean;
  rate_error_message?: string | null;
}

export interface RawEventResult {
  success: boolean;
  billingEventId?: string;
  error?: string;
}

export interface RawEventsResult {
  success: boolean;
  billingEventIds?: string[];
  error?: string;
}

// =============================================================================
// DELETE UNBILLED EVENTS
// =============================================================================

/** Filters for deleteUnbilledEventsByFilter. Only provided filters are applied. */
export interface DeleteBillingEventFilters {
  itemId?: string;
  shipmentId?: string;
  chargeType?: string;
  eventType?: string;
}

export interface DeleteResult {
  success: boolean;
  deletedCount: number;
  error?: string;
}

// =============================================================================
// MOVE CHARGES
// =============================================================================

export interface MoveChargesParams {
  /** Required — the item whose unbilled events will be moved. */
  itemId: string;
  newSidemarkId: string | null;
}

export interface MoveChargesResult {
  success: boolean;
  movedCount: number;
  invoicedCount: number;
}

// =============================================================================
// UPDATE / VOID / MARK INVOICED — Phase B4
// =============================================================================

/** Result for single-row update operations. */
export interface UpdateResult {
  success: boolean;
  error?: string;
}

/** Result for batch update operations. */
export interface BatchUpdateResult {
  success: boolean;
  updated?: number;
  error?: string;
}
