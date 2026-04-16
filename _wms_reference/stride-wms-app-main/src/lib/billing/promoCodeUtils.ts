/**
 * Promo Code Utilities - Find and apply promo codes to billing events
 *
 * Usage tracking is per-account group:
 * - Parent accounts and their sub-accounts share usage limits
 * - A "1 time use" promo can be used once by the account group, not once per sub-account
 */

import { supabase } from '@/integrations/supabase/client';

export interface ApplicablePromoCode {
  id: string;
  code: string;
  discount_type: 'percentage' | 'flat_rate';
  discount_value: number;
  service_scope: 'all' | 'selected';
  selected_services: string[] | null;
  usage_limit_type: 'unlimited' | 'limited';
  usage_limit: number | null;
}

export interface PromoDiscount {
  promo_code_id: string;
  promo_code: string;
  discount_type: 'percentage' | 'flat_rate';
  discount_value: number;
  original_amount: number;
  discount_amount: number;
  final_amount: number;
}

/**
 * Get the root account ID (parent account if this is a sub-account, otherwise self)
 */
async function getRootAccountId(accountId: string): Promise<string> {
  const { data, error } = await supabase
    .from('accounts')
    .select('parent_account_id')
    .eq('id', accountId)
    .single();

  if (error || !data) {
    return accountId;
  }

  return data.parent_account_id || accountId;
}

/**
 * Get the usage count for a promo code for a specific account group
 * (parent account + all sub-accounts count together)
 */
async function getAccountUsageCount(promoCodeId: string, accountId: string): Promise<number> {
  const rootAccountId = await getRootAccountId(accountId);

  const { count, error } = await (supabase as any)
    .from('promo_code_usages')
    .select('*', { count: 'exact', head: true })
    .eq('promo_code_id', promoCodeId)
    .eq('root_account_id', rootAccountId);

  if (error) {
    console.error('[promoCodeUtils] Error getting usage count:', error);
    return 0;
  }

  return count || 0;
}

/**
 * Record that a promo code was used by an account
 */
export async function recordPromoUsage(
  promoCodeId: string,
  accountId: string,
  billingEventId?: string,
  usedBy?: string
): Promise<boolean> {
  try {
    const rootAccountId = await getRootAccountId(accountId);

    const { error } = await (supabase as any)
      .from('promo_code_usages')
      .insert({
        promo_code_id: promoCodeId,
        root_account_id: rootAccountId,
        used_by_account_id: accountId,
        billing_event_id: billingEventId || null,
        used_by: usedBy || null,
      });

    if (error) {
      // Ignore duplicate constraint errors (same promo on same billing event)
      if (error.code !== '23505') {
        console.error('[promoCodeUtils] Error recording usage:', error);
        return false;
      }
    }

    return true;
  } catch (error) {
    console.error('[promoCodeUtils] Error recording usage:', error);
    return false;
  }
}

/**
 * Check if a promo code is valid and can be used by an account
 * Does NOT require the promo to be assigned to the account (for manual application)
 */
export async function validatePromoCode(
  tenantId: string,
  promoCodeId: string,
  accountId: string,
  chargeType?: string
): Promise<{ valid: boolean; error?: string; promoCode?: ApplicablePromoCode }> {
  try {
    // Fetch the promo code
    const { data: pc, error } = await (supabase.from('promo_codes') as any)
      .select('*')
      .eq('id', promoCodeId)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .single();

    if (error || !pc) {
      return { valid: false, error: 'Promo code not found or inactive' };
    }

    // Check expiration
    if (pc.expiration_type === 'date' && pc.expiration_date) {
      if (new Date(pc.expiration_date) < new Date()) {
        return { valid: false, error: 'Promo code has expired' };
      }
    }

    // Check service scope
    if (chargeType && pc.service_scope === 'selected' && pc.selected_services) {
      if (!pc.selected_services.includes(chargeType)) {
        return { valid: false, error: 'Promo code does not apply to this service' };
      }
    }

    // Check per-account usage limit
    if (pc.usage_limit_type === 'limited' && pc.usage_limit) {
      const accountUsage = await getAccountUsageCount(pc.id, accountId);
      if (accountUsage >= pc.usage_limit) {
        return { valid: false, error: `This account has already used this promo code ${pc.usage_limit} time(s)` };
      }
    }

    return {
      valid: true,
      promoCode: {
        id: pc.id,
        code: pc.code,
        discount_type: pc.discount_type,
        discount_value: pc.discount_value,
        service_scope: pc.service_scope,
        selected_services: pc.selected_services,
        usage_limit_type: pc.usage_limit_type,
        usage_limit: pc.usage_limit,
      },
    };
  } catch (error) {
    console.error('[promoCodeUtils] Error validating promo code:', error);
    return { valid: false, error: 'Error validating promo code' };
  }
}

/**
 * Find the best applicable promo code for a billing event
 * Only returns promo codes that have been assigned to the account
 * Returns the promo code that gives the highest discount
 */
export async function findBestPromoCode(
  tenantId: string,
  chargeType: string,
  amount: number,
  accountId?: string | null
): Promise<ApplicablePromoCode | null> {
  try {
    // Must have an account to apply promo codes
    if (!accountId) {
      return null;
    }

    // Fetch promo codes that are assigned to this account
    const { data: accountPromos, error: accountError } = await (supabase as any)
      .from('account_promo_codes')
      .select('promo_code_id')
      .eq('account_id', accountId);

    if (accountError) {
      console.error('[promoCodeUtils] Error fetching account promo codes:', accountError);
      return null;
    }

    if (!accountPromos || accountPromos.length === 0) {
      return null;
    }

    const assignedPromoIds = accountPromos.map((ap: any) => ap.promo_code_id);

    // Fetch active promo codes that are assigned to this account
    const { data: promoCodes, error } = await (supabase.from('promo_codes') as any)
      .select('id, code, discount_type, discount_value, service_scope, selected_services, usage_limit_type, usage_limit, expiration_type, expiration_date')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .is('deleted_at', null)
      .in('id', assignedPromoIds);

    if (error) {
      console.error('[promoCodeUtils] Error fetching promo codes:', error);
      return null;
    }

    if (!promoCodes || promoCodes.length === 0) {
      return null;
    }

    // Filter to applicable promo codes (checking per-account usage)
    const applicableCodes: ApplicablePromoCode[] = [];

    for (const pc of promoCodes) {
      // Check expiration
      if (pc.expiration_type === 'date' && pc.expiration_date) {
        if (new Date(pc.expiration_date) < new Date()) {
          continue;
        }
      }

      // Check per-account usage limit
      if (pc.usage_limit_type === 'limited' && pc.usage_limit) {
        const accountUsage = await getAccountUsageCount(pc.id, accountId);
        if (accountUsage >= pc.usage_limit) {
          continue;
        }
      }

      // Check service scope
      if (pc.service_scope === 'selected' && pc.selected_services) {
        if (!pc.selected_services.includes(chargeType)) {
          continue;
        }
      }

      applicableCodes.push({
        id: pc.id,
        code: pc.code,
        discount_type: pc.discount_type,
        discount_value: pc.discount_value,
        service_scope: pc.service_scope,
        selected_services: pc.selected_services,
        usage_limit_type: pc.usage_limit_type,
        usage_limit: pc.usage_limit,
      });
    }

    if (applicableCodes.length === 0) {
      return null;
    }

    // Find the best discount (highest savings)
    let bestCode: ApplicablePromoCode | null = null;
    let bestDiscount = 0;

    for (const pc of applicableCodes) {
      let discountAmount = 0;

      if (pc.discount_type === 'percentage') {
        discountAmount = amount * (pc.discount_value / 100);
      } else {
        // Flat rate - discount is the full value (capped at amount)
        discountAmount = Math.min(pc.discount_value, amount);
      }

      if (discountAmount > bestDiscount) {
        bestDiscount = discountAmount;
        bestCode = pc;
      }
    }

    return bestCode;
  } catch (error) {
    console.error('[promoCodeUtils] Error finding promo code:', error);
    return null;
  }
}

/**
 * Calculate the discount for a given promo code and amount
 */
export function calculateDiscount(
  promoCode: ApplicablePromoCode,
  originalAmount: number
): PromoDiscount {
  let discountAmount = 0;

  if (promoCode.discount_type === 'percentage') {
    discountAmount = originalAmount * (promoCode.discount_value / 100);
  } else {
    // Flat rate - cap at original amount
    discountAmount = Math.min(promoCode.discount_value, originalAmount);
  }

  // Round to 2 decimal places
  discountAmount = Math.round(discountAmount * 100) / 100;
  const finalAmount = Math.round((originalAmount - discountAmount) * 100) / 100;

  return {
    promo_code_id: promoCode.id,
    promo_code: promoCode.code,
    discount_type: promoCode.discount_type,
    discount_value: promoCode.discount_value,
    original_amount: originalAmount,
    discount_amount: discountAmount,
    final_amount: finalAmount,
  };
}

/**
 * Record promo usage (called after billing event is created)
 * This replaces the old incrementPromoCodeUsage function
 */
export async function incrementPromoCodeUsage(
  promoCodeId: string,
  accountId?: string,
  billingEventId?: string
): Promise<boolean> {
  if (!accountId) {
    return true; // No account to track
  }
  return recordPromoUsage(promoCodeId, accountId, billingEventId);
}

/**
 * Batch record usage for multiple promo code applications
 */
export async function incrementPromoCodeUsageBatch(
  promoCodeUsages: Map<string, { count: number; accountId: string; billingEventIds?: string[] }>
): Promise<boolean> {
  try {
    for (const [promoCodeId, usage] of promoCodeUsages) {
      // Record each usage separately for proper tracking
      for (let i = 0; i < usage.count; i++) {
        const billingEventId = usage.billingEventIds?.[i];
        await recordPromoUsage(promoCodeId, usage.accountId, billingEventId);
      }
    }
    return true;
  } catch (error) {
    console.error('[promoCodeUtils] Error incrementing batch usage:', error);
    return false;
  }
}

/**
 * Apply a promo code manually to an existing billing event
 * This is for one-time application without assigning to the account permanently
 */
export async function applyPromoToEvent(
  tenantId: string,
  billingEventId: string,
  promoCodeId: string,
  userId?: string
): Promise<{ success: boolean; error?: string; discount?: PromoDiscount }> {
  try {
    // Get the billing event
    const { data: event, error: eventError } = await supabase
      .from('billing_events')
      .select('id, account_id, charge_type, unit_rate, quantity, total_amount, metadata, status')
      .eq('id', billingEventId)
      .single();

    if (eventError || !event) {
      return { success: false, error: 'Billing event not found' };
    }

    if (event.status !== 'unbilled') {
      return { success: false, error: 'Can only apply promo codes to unbilled events' };
    }

    // Check if already has a promo
    const existingMetadata = (event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)) 
      ? event.metadata as Record<string, unknown>
      : {};
    if (existingMetadata.promo_discount) {
      return { success: false, error: 'This billing event already has a promo code applied' };
    }

    // Validate the promo code
    const validation = await validatePromoCode(
      tenantId,
      promoCodeId,
      event.account_id,
      event.charge_type
    );

    if (!validation.valid || !validation.promoCode) {
      return { success: false, error: validation.error };
    }

    // Calculate the discount
    const originalAmount = event.total_amount || (event.unit_rate * (event.quantity || 1));
    const discount = calculateDiscount(validation.promoCode, originalAmount);

    // Update the billing event
    const newMetadata = {
      ...existingMetadata,
      promo_discount: {
        promo_code_id: discount.promo_code_id,
        promo_code: discount.promo_code,
        discount_type: discount.discount_type,
        discount_value: discount.discount_value,
        original_amount: discount.original_amount,
        discount_amount: discount.discount_amount,
        manual_application: true, // Flag to indicate this was manually applied
      },
    };

    const { error: updateError } = await supabase
      .from('billing_events')
      .update({
        total_amount: discount.final_amount,
        metadata: newMetadata,
      })
      .eq('id', billingEventId);

    if (updateError) {
      return { success: false, error: 'Failed to update billing event' };
    }

    // Record the usage
    await recordPromoUsage(promoCodeId, event.account_id, billingEventId, userId);

    return { success: true, discount };
  } catch (error) {
    console.error('[promoCodeUtils] Error applying promo to event:', error);
    return { success: false, error: 'Error applying promo code' };
  }
}

/**
 * Remove a promo code from an existing billing event
 */
export async function removePromoFromEvent(
  billingEventId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Get the billing event
    const { data: event, error: eventError } = await supabase
      .from('billing_events')
      .select('id, metadata, status')
      .eq('id', billingEventId)
      .single();

    if (eventError || !event) {
      return { success: false, error: 'Billing event not found' };
    }

    if (event.status !== 'unbilled') {
      return { success: false, error: 'Can only remove promo codes from unbilled events' };
    }

    const existingMetadata = (event.metadata && typeof event.metadata === 'object' && !Array.isArray(event.metadata)) 
      ? event.metadata as Record<string, unknown>
      : {};
    const promoDiscount = existingMetadata.promo_discount as { original_amount: number } | undefined;
    if (!promoDiscount) {
      return { success: false, error: 'No promo code applied to this event' };
    }

    // Restore original amount
    const originalAmount = promoDiscount.original_amount;
    const newMetadata = { ...existingMetadata };
    delete newMetadata.promo_discount;

    const { error: updateError } = await (supabase as any)
      .from('billing_events')
      .update({
        total_amount: originalAmount,
        metadata: newMetadata as Record<string, unknown>,
      })
      .eq('id', billingEventId);

    if (updateError) {
      return { success: false, error: 'Failed to update billing event' };
    }

    // Remove the usage record
    await (supabase as any).from('promo_code_usages')
      .delete()
      .eq('billing_event_id', billingEventId);

    return { success: true };
  } catch (error) {
    console.error('[promoCodeUtils] Error removing promo from event:', error);
    return { success: false, error: 'Error removing promo code' };
  }
}
