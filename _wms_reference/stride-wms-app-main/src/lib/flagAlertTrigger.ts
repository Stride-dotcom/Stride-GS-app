/**
 * Flag Alert Trigger — Per-flag trigger auto-creation / management
 *
 * When a flag (charge_type with add_flag=true) is created or edited
 * with alert_rule !== 'none', a corresponding communication_alerts record
 * is created so that the send-alerts edge function can process it.
 *
 * Trigger key convention:
 *   key:           "flag_alert_{CHARGE_CODE}"
 *   trigger_event: "item.flag_added.{CHARGE_CODE}"
 *
 * TENANT SAFETY: All writes go through the server-side RPC
 * `rpc_ensure_flag_alert_trigger` which derives tenant_id from
 * `auth.uid()` via `user_tenant_id()`.  No tenantId is accepted
 * from the client.
 */

import { supabase } from '@/integrations/supabase/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface EnsureFlagAlertTriggerResult {
  ok: boolean;
  error_code?: string;
  message?: string;
  alert_id?: string;
  key?: string;
  trigger_event?: string;
  is_enabled?: boolean;
  created?: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensure a communication_alerts trigger exists (or is disabled) for a flag.
 *
 * Delegates entirely to the SECURITY DEFINER RPC which:
 * - Derives tenant_id from auth session (no spoofing possible)
 * - Validates charge_type ownership against that tenant
 * - Upserts the trigger row idempotently (UNIQUE constraint + ON CONFLICT)
 * - Creates default templates on first creation
 *
 * @param chargeTypeId  UUID of the charge_type (flag) to ensure trigger for
 * @returns The result from the RPC, or null on network/unexpected error
 */
export async function ensureFlagAlertTrigger(
  chargeTypeId: string,
): Promise<EnsureFlagAlertTriggerResult | null> {
  try {
    const { data, error } = await supabase.rpc(
      'rpc_ensure_flag_alert_trigger',
      { p_charge_type_id: chargeTypeId },
    );

    if (error) {
      console.error('[ensureFlagAlertTrigger] RPC error:', error);
      return null;
    }

    const result = data as unknown as EnsureFlagAlertTriggerResult;

    if (!result?.ok) {
      console.error(
        '[ensureFlagAlertTrigger] RPC returned error:',
        result?.error_code,
        result?.message,
      );
    }

    return result;
  } catch (err) {
    console.error('[ensureFlagAlertTrigger] Unexpected error:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers (still used by alertQueue.ts for guard checks)
// ---------------------------------------------------------------------------

/** Deterministic key used for unique constraint on communication_alerts */
export function buildTriggerKey(chargeCode: string): string {
  return `flag_alert_${chargeCode}`;
}

/** Deterministic trigger_event used to match in send-alerts edge function */
export function buildTriggerEvent(chargeCode: string): string {
  return `item.flag_added.${chargeCode}`;
}
