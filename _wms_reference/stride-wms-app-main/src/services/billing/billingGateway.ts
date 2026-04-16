/**
 * Billing Gateway — Phase B0
 *
 * Thin wrapper over existing billing utilities. Delegates all logic to:
 *   - chargeTypeUtils.ts   (rate lookups)
 *   - createBillingEvent.ts (event creation, voiding, sidemark moves)
 *   - billingCalculation.ts (rate-from-price-list preview)
 *
 * NO new rate logic, promo logic, billing_events writes, or schema assumptions.
 * This file is UNUSED in Phase B0 — it is a safe foundation for later migration.
 */

import {
  getEffectiveRate,
  BILLING_DISABLED_ERROR,
} from '@/lib/billing/chargeTypeUtils';

import {
  createBillingEvent,
  voidBillingEvent,
  moveItemSidemarkWithEvents,
} from '@/lib/billing/createBillingEvent';
import type { CreateBillingEventParams } from '@/lib/billing/createBillingEvent';

import { getRateFromPriceList } from '@/lib/billing/billingCalculation';

import type {
  CreateChargeParams,
  PreviewChargeParams,
  ChargeResult,
  ChargePreview,
  MoveChargesParams,
  MoveChargesResult,
  RawBillingEventPayload,
  RawEventResult,
  RawEventsResult,
  DeleteBillingEventFilters,
  DeleteResult,
  UpdateResult,
  BatchUpdateResult,
} from './types';

import { supabase } from '@/integrations/supabase/client';

// =============================================================================
// createCharge
// =============================================================================

/**
 * Create a single billing charge.
 *
 * 1. Resolves rate via getEffectiveRate (unless rateOverride is provided).
 * 2. Delegates to createBillingEvent for persistence.
 */
export async function createCharge(params: CreateChargeParams): Promise<ChargeResult> {
  let unitRate: number;
  let hasRateError = params.hasRateError ?? false;
  let rateErrorMessage: string | null = params.rateErrorMessage ?? null;

  // --- Rate resolution ---
  if (params.rateOverride !== undefined && params.rateOverride !== null) {
    unitRate = params.rateOverride;
  } else {
    try {
      const rateResult = await getEffectiveRate({
        tenantId: params.tenantId,
        chargeCode: params.chargeCode,
        accountId: params.accountId,
        classCode: params.classCode,
      });

      if (rateResult.has_error) {
        if (rateResult.error_message === BILLING_DISABLED_ERROR) {
          return {
            success: false,
            hasRateError: true,
            errorMessage: BILLING_DISABLED_ERROR,
          };
        }
        unitRate = 0;
        hasRateError = true;
        rateErrorMessage = rateResult.error_message;
      } else {
        unitRate = rateResult.effective_rate;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown rate lookup error';
      if (message === BILLING_DISABLED_ERROR) {
        return {
          success: false,
          hasRateError: true,
          errorMessage: BILLING_DISABLED_ERROR,
        };
      }
      unitRate = 0;
      hasRateError = true;
      rateErrorMessage = message;
    }
  }

  // --- Build event params ---
  const quantity = params.quantity ?? 1;
  const totalAmount = unitRate * quantity;

  const eventParams: CreateBillingEventParams = {
    tenant_id: params.tenantId,
    account_id: params.accountId,
    sidemark_id: params.sidemarkId ?? null,
    class_id: params.classId ?? null,
    service_id: params.serviceId ?? null,
    item_id: params.context.itemId ?? null,
    task_id: params.context.taskId ?? null,
    shipment_id: params.context.shipmentId ?? null,
    event_type: params.eventType,
    charge_type: params.chargeCode,
    description: params.description,
    quantity,
    unit_rate: unitRate,
    total_amount: totalAmount,
    has_rate_error: hasRateError,
    rate_error_message: rateErrorMessage,
    skip_promo: params.skipPromo,
    metadata: {
      ...params.metadata,
      billing_context: params.context.type,
      ...(params.context.intakeId ? { intake_id: params.context.intakeId } : {}),
    },
    created_by: params.userId,
  };

  // --- Delegate to createBillingEvent ---
  const result = await createBillingEvent(eventParams);

  if (!result) {
    return {
      success: false,
      hasRateError,
      errorMessage: 'Failed to create billing event',
    };
  }

  return {
    success: true,
    billingEventId: result.id,
    amount: result.total_amount,
    hasRateError,
    errorMessage: rateErrorMessage ?? undefined,
  };
}

// =============================================================================
// createCharges
// =============================================================================

/**
 * Create multiple billing charges.
 *
 * Phase B0: simple order-preserving loop over createCharge().
 * Returns same-length array in same order, always.
 */
export async function createCharges(paramsList: CreateChargeParams[]): Promise<ChargeResult[]> {
  const results: ChargeResult[] = [];
  for (const params of paramsList) {
    results.push(await createCharge(params));
  }
  return results;
}

// =============================================================================
// previewCharge
// =============================================================================

/**
 * Preview a single charge (rate lookup only, no persistence).
 *
 * Delegates to getRateFromPriceList for the rate lookup.
 */
export async function previewCharge(params: PreviewChargeParams): Promise<ChargePreview> {
  const rateResult = await getRateFromPriceList(
    params.tenantId,
    params.chargeCode,
    params.classCode ?? null,
    params.accountId,
  );

  const quantity = params.quantity ?? 1;
  const subtotal = quantity * rateResult.rate;

  return {
    rate: rateResult.rate,
    quantity,
    subtotal,
    serviceName: rateResult.serviceName,
    billingUnit: rateResult.billingUnit,
    hasRateError: rateResult.hasError,
    errorMessage: rateResult.errorMessage,
  };
}

// =============================================================================
// previewCharges
// =============================================================================

/**
 * Preview multiple charges in parallel, preserving order.
 */
export async function previewCharges(paramsList: PreviewChargeParams[]): Promise<ChargePreview[]> {
  return Promise.all(paramsList.map((params) => previewCharge(params)));
}

// =============================================================================
// voidCharge
// =============================================================================

/**
 * Void a single billing event by ID.
 * Delegates to voidBillingEvent.
 */
export async function voidCharge(eventId: string): Promise<{ success: boolean }> {
  const success = await voidBillingEvent(eventId);
  return { success };
}

// =============================================================================
// moveCharges
// =============================================================================

/**
 * Move unbilled billing events when an item's sidemark changes.
 * Delegates to moveItemSidemarkWithEvents.
 *
 * @param params.itemId    — required, the item whose events move
 * @param params.newSidemarkId — the target sidemark (null to clear)
 */
export async function moveCharges(params: MoveChargesParams): Promise<MoveChargesResult> {
  const result = await moveItemSidemarkWithEvents(params.itemId, params.newSidemarkId);
  return {
    success: result.success,
    movedCount: result.movedCount,
    invoicedCount: result.invoicedCount,
  };
}

// =============================================================================
// createEventRaw — direct passthrough insert (no promos, no field mutation)
// =============================================================================

/**
 * Insert a single billing_events row exactly as provided.
 * No rate resolution, no promo processing, no field mutation.
 */
export async function createEventRaw(payload: RawBillingEventPayload): Promise<RawEventResult> {
  const SHADOW = import.meta.env.VITE_BILLING_SHADOW_MODE === 'true';
  if (SHADOW) {
    console.log('[BillingGateway Shadow]', {
      fn: 'createEventRaw',
      operation: 'insert',
      timestamp: new Date().toISOString(),
    });
  }

  try {
    const { data, error } = await (supabase
      .from('billing_events') as any)
      .insert(payload)
      .select('id')
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, billingEventId: data?.id };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// =============================================================================
// createEventsRaw — batch passthrough insert (no promos, no field mutation)
// =============================================================================

/**
 * Insert multiple billing_events rows exactly as provided.
 * Preserves order. No rate resolution, no promo processing, no field mutation.
 */
export async function createEventsRaw(payloads: RawBillingEventPayload[]): Promise<RawEventsResult> {
  const SHADOW = import.meta.env.VITE_BILLING_SHADOW_MODE === 'true';
  if (SHADOW) {
    console.log('[BillingGateway Shadow]', {
      fn: 'createEventsRaw',
      operation: 'batch_insert',
      timestamp: new Date().toISOString(),
    });
  }

  try {
    const { data, error } = await (supabase
      .from('billing_events') as any)
      .insert(payloads)
      .select('id');

    if (error) {
      return { success: false, error: error.message };
    }

    return {
      success: true,
      billingEventIds: data?.map((d: any) => d.id) || [],
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// =============================================================================
// deleteUnbilledEventsByFilter — hard delete (NOT void)
// =============================================================================

/**
 * Hard-delete unbilled billing_events matching the provided filters.
 * Always adds .eq('status', 'unbilled'). Only provided filters are applied.
 * This is a HARD DELETE — not a soft void.
 */
export async function deleteUnbilledEventsByFilter(
  filters: DeleteBillingEventFilters,
): Promise<DeleteResult> {
  const SHADOW = import.meta.env.VITE_BILLING_SHADOW_MODE === 'true';
  if (SHADOW) {
    console.log('[BillingGateway Shadow]', {
      fn: 'deleteUnbilledEventsByFilter',
      operation: 'delete',
      timestamp: new Date().toISOString(),
    });
  }

  try {
    // Step 1: Select ids matching filters
    let selectQuery = (supabase.from('billing_events') as any)
      .select('id')
      .eq('status', 'unbilled');

    if (filters.itemId) selectQuery = selectQuery.eq('item_id', filters.itemId);
    if (filters.shipmentId) selectQuery = selectQuery.eq('shipment_id', filters.shipmentId);
    if (filters.chargeType) selectQuery = selectQuery.eq('charge_type', filters.chargeType);
    if (filters.eventType) selectQuery = selectQuery.eq('event_type', filters.eventType);

    const { data: matchingEvents, error: selectError } = await selectQuery;

    if (selectError) {
      return { success: false, deletedCount: 0, error: selectError.message };
    }

    if (!matchingEvents || matchingEvents.length === 0) {
      return { success: true, deletedCount: 0 };
    }

    const ids = matchingEvents.map((e: any) => e.id);

    // Step 2: Hard delete by ids
    const { error: deleteError } = await (supabase.from('billing_events') as any)
      .delete()
      .in('id', ids);

    if (deleteError) {
      return { success: false, deletedCount: 0, error: deleteError.message };
    }

    return { success: true, deletedCount: ids.length };
  } catch (err) {
    return {
      success: false,
      deletedCount: 0,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// =============================================================================
// updateBillingEventFields — UNGUARDED PATCH BY ID (Phase B4)
// =============================================================================

/**
 * Update arbitrary fields on a single billing_events row by id.
 * No status guard — mirrors unguarded edit patterns in BillingChargesSection,
 * BillingReportTab, and TaskDetail.
 */
export async function updateBillingEventFields(args: {
  eventId: string;
  patch: Record<string, any>;
}): Promise<UpdateResult> {
  // No-op for empty patch
  if (!args.patch || Object.keys(args.patch).length === 0) {
    return { success: true };
  }

  try {
    const { error } = await (supabase
      .from('billing_events') as any)
      .update(args.patch)
      .eq('id', args.eventId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// =============================================================================
// updateBillingEventStatus — UNGUARDED STATUS UPDATE BY ID (Phase B4)
// =============================================================================

/**
 * Update only the status field on a single billing_events row by id.
 * No status guard — mirrors unguarded status update in BillingReports.tsx.
 */
export async function updateBillingEventStatus(args: {
  eventId: string;
  status: string;
}): Promise<UpdateResult> {
  try {
    const { error } = await (supabase
      .from('billing_events') as any)
      .update({ status: args.status })
      .eq('id', args.eventId);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// =============================================================================
// voidBillingEventWithMetadataMerge — GUARDED: ONLY UNBILLED (Phase B4)
// =============================================================================

/**
 * Void a single billing_events row, ONLY if status='unbilled'.
 * Merges provided metadata fields into the existing metadata object.
 * Mirrors the BillingCalculator waive-void pattern exactly.
 */
export async function voidBillingEventWithMetadataMerge(args: {
  eventId: string;
  metadataMerge: Record<string, any>;
}): Promise<UpdateResult> {
  try {
    // Step 1: Read existing metadata with unbilled guard
    const { data: existing, error: selectError } = await (supabase
      .from('billing_events') as any)
      .select('metadata')
      .eq('id', args.eventId)
      .eq('status', 'unbilled')
      .maybeSingle();

    if (selectError) {
      return { success: false, error: selectError.message };
    }

    if (!existing) {
      return { success: false, error: 'Event not found or not unbilled' };
    }

    // Step 2: Merge metadata
    const merged = {
      ...(existing.metadata ?? {}),
      ...(args.metadataMerge ?? {}),
    };

    // Step 3: Update with unbilled guard
    const { data: updateData, error: updateError } = await (supabase
      .from('billing_events') as any)
      .update({ status: 'void', metadata: merged })
      .eq('id', args.eventId)
      .eq('status', 'unbilled')
      .select('id');

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    if (!updateData || updateData.length === 0) {
      return { success: false, error: 'Event not unbilled' };
    }

    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// =============================================================================
// voidBillingEventsBatch — UNGUARDED BATCH VOID BY IDS (Phase B4)
// =============================================================================

/**
 * Soft-void multiple billing_events rows by ids (unguarded).
 * Mirrors the unguarded batch void in BillingReportTab.
 */
export async function voidBillingEventsBatch(args: {
  eventIds: string[];
}): Promise<BatchUpdateResult> {
  if (!args.eventIds || args.eventIds.length === 0) {
    return { success: true, updated: 0 };
  }

  try {
    const { error } = await (supabase
      .from('billing_events') as any)
      .update({ status: 'void' })
      .in('id', args.eventIds);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, updated: args.eventIds.length };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// =============================================================================
// markBillingEventsInvoiced — BATCH INVOICE MARK (Phase B4)
// =============================================================================

/**
 * Mark billing_events as invoiced in batch by ids.
 * Sets status='invoiced', invoice_id, and invoiced_at.
 * Mirrors the useInvoiceBuilder mark-invoiced pattern exactly.
 */
export async function markBillingEventsInvoiced(args: {
  eventIds: string[];
  invoiceId: string;
  invoicedAt: string;
}): Promise<BatchUpdateResult> {
  if (!args.eventIds || args.eventIds.length === 0) {
    return { success: true, updated: 0 };
  }

  try {
    const { error } = await (supabase
      .from('billing_events') as any)
      .update({
        status: 'invoiced',
        invoice_id: args.invoiceId,
        invoiced_at: args.invoicedAt,
      })
      .in('id', args.eventIds);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, updated: args.eventIds.length };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
