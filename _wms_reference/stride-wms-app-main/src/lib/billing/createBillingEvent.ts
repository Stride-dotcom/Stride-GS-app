import { supabase } from '@/integrations/supabase/client';
import { findBestPromoCode, calculateDiscount, incrementPromoCodeUsage, incrementPromoCodeUsageBatch } from './promoCodeUtils';

export interface CreateBillingEventParams {
  tenant_id: string;
  account_id: string;
  sidemark_id?: string | null;
  class_id?: string | null;
  service_id?: string | null;
  item_id?: string | null;
  task_id?: string | null;
  shipment_id?: string | null;
  event_type: 'receiving' | 'returns_processing' | 'task_completion' | 'flag_change' | 'storage' | 'will_call' | 'disposal' | 'addon' | 'outbound_shipment';
  charge_type: string;
  description?: string;
  quantity?: number;
  unit_rate: number;
  total_amount?: number;
  status?: 'unbilled' | 'invoiced' | 'void';
  occurred_at?: string;
  metadata?: Record<string, any>;
  created_by?: string;
  skip_promo?: boolean;
  has_rate_error?: boolean;
  rate_error_message?: string | null;
}

export interface BillingEventResult {
  id: string;
  total_amount: number;
  status: string;
}

/**
 * Create a billing event with proper defaults and validation
 * Automatically applies best available promo code discount
 */
export async function createBillingEvent(params: CreateBillingEventParams): Promise<BillingEventResult | null> {
  const quantity = params.quantity || 1;
  let totalAmount = params.total_amount ?? (quantity * params.unit_rate);
  let metadata: Record<string, any> = params.metadata || {};
  let appliedPromoCodeId: string | null = null;

  // Apply promo code discount if applicable
  if (!params.skip_promo && totalAmount > 0) {
    const promoCode = await findBestPromoCode(
      params.tenant_id,
      params.charge_type,
      totalAmount,
      params.account_id
    );

    if (promoCode) {
      const discount = calculateDiscount(promoCode, totalAmount);
      totalAmount = discount.final_amount;
      appliedPromoCodeId = promoCode.id;

      // Store discount info in metadata
      metadata = {
        ...metadata,
        promo_discount: {
          promo_code_id: discount.promo_code_id,
          promo_code: discount.promo_code,
          discount_type: discount.discount_type,
          discount_value: discount.discount_value,
          original_amount: discount.original_amount,
          discount_amount: discount.discount_amount,
        },
      };
    }
  }

  const eventData = {
    tenant_id: params.tenant_id,
    account_id: params.account_id,
    sidemark_id: params.sidemark_id || null,
    class_id: params.class_id || null,
    service_id: params.service_id || null,
    item_id: params.item_id || null,
    task_id: params.task_id || null,
    shipment_id: params.shipment_id || null,
    event_type: params.event_type,
    charge_type: params.charge_type,
    description: params.description || null,
    quantity,
    unit_rate: params.unit_rate,
    total_amount: totalAmount,
    status: params.status || 'unbilled',
    occurred_at: params.occurred_at || new Date().toISOString(),
    metadata,
    created_by: params.created_by || null,
    has_rate_error: params.has_rate_error ?? params.unit_rate === 0,
    rate_error_message: params.rate_error_message || null,
    needs_review: params.unit_rate === 0,
  };

  const { data, error } = await supabase
    .from('billing_events')
    .insert(eventData)
    .select('id, total_amount, status')
    .single();

  if (error) {
    console.error('Error creating billing event:', error);
    return null;
  }

  // Record promo usage after billing event is created (so we have the billing_event_id)
  if (appliedPromoCodeId && data) {
    await incrementPromoCodeUsage(appliedPromoCodeId, params.account_id, data.id);
  }

  return data;
}

/**
 * Create multiple billing events in a batch
 * Automatically applies best available promo code discounts
 */
export async function createBillingEventsBatch(events: CreateBillingEventParams[]): Promise<BillingEventResult[]> {
  // Track promo code usage across the batch (promoId -> { accountId, indices of events with this promo })
  const promoCodeUsages = new Map<string, { accountId: string; eventIndices: number[] }>();

  const eventDataArray = await Promise.all(events.map(async (params, index) => {
    const quantity = params.quantity || 1;
    let totalAmount = params.total_amount ?? (quantity * params.unit_rate);
    let metadata: Record<string, any> = params.metadata || {};

    // Apply promo code discount if applicable
    if (!params.skip_promo && totalAmount > 0) {
      const promoCode = await findBestPromoCode(
        params.tenant_id,
        params.charge_type,
        totalAmount,
        params.account_id
      );

      if (promoCode) {
        const discount = calculateDiscount(promoCode, totalAmount);
        totalAmount = discount.final_amount;

        // Store discount info in metadata
        metadata = {
          ...metadata,
          promo_discount: {
            promo_code_id: discount.promo_code_id,
            promo_code: discount.promo_code,
            discount_type: discount.discount_type,
            discount_value: discount.discount_value,
            original_amount: discount.original_amount,
            discount_amount: discount.discount_amount,
          },
        };

        // Track usage for batch increment
        const existing = promoCodeUsages.get(promoCode.id);
        if (existing) {
          existing.eventIndices.push(index);
        } else {
          promoCodeUsages.set(promoCode.id, { accountId: params.account_id, eventIndices: [index] });
        }
      }
    }

    return {
      tenant_id: params.tenant_id,
      account_id: params.account_id,
      sidemark_id: params.sidemark_id || null,
      class_id: params.class_id || null,
      service_id: params.service_id || null,
      item_id: params.item_id || null,
      task_id: params.task_id || null,
      shipment_id: params.shipment_id || null,
      event_type: params.event_type,
      charge_type: params.charge_type,
      description: params.description || null,
      quantity,
      unit_rate: params.unit_rate,
      total_amount: totalAmount,
      status: params.status || 'unbilled',
      occurred_at: params.occurred_at || new Date().toISOString(),
      metadata,
      created_by: params.created_by || null,
      has_rate_error: params.has_rate_error ?? params.unit_rate === 0,
      rate_error_message: params.rate_error_message || null,
      needs_review: params.unit_rate === 0,
    };
  }));

  const { data, error } = await supabase
    .from('billing_events')
    .insert(eventDataArray)
    .select('id, total_amount, status');

  if (error) {
    console.error('Error creating billing events batch:', error);
    return [];
  }

  // Record promo usage with billing event IDs
  if (promoCodeUsages.size > 0 && data) {
    for (const [promoCodeId, usage] of promoCodeUsages) {
      for (const eventIndex of usage.eventIndices) {
        const billingEventId = data[eventIndex]?.id;
        if (billingEventId) {
          await incrementPromoCodeUsage(promoCodeId, usage.accountId, billingEventId);
        }
      }
    }
  }

  return data || [];
}

/**
 * Void a billing event (only if unbilled)
 */
export async function voidBillingEvent(eventId: string): Promise<boolean> {
  const { error } = await supabase
    .from('billing_events')
    .update({ status: 'void' })
    .eq('id', eventId)
    .eq('status', 'unbilled');

  if (error) {
    console.error('Error voiding billing event:', error);
    return false;
  }

  return true;
}

/**
 * Move unbilled events to new sidemark using RPC
 */
export async function moveItemSidemarkWithEvents(
  itemId: string,
  newSidemarkId: string | null
): Promise<{ success: boolean; movedCount: number; invoicedCount: number }> {
  const { data, error } = await supabase.rpc('move_item_sidemark_and_unbilled_events', {
    p_item_id: itemId,
    p_new_sidemark_id: newSidemarkId,
  });

  if (error) {
    console.error('Error moving item sidemark:', error);
    return { success: false, movedCount: 0, invoicedCount: 0 };
  }

  const result = data as Record<string, any> | null;
  return {
    success: result?.success ?? false,
    movedCount: result?.moved_events_count ?? 0,
    invoicedCount: result?.invoiced_events_count ?? 0,
  };
}
