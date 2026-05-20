/**
 * fireShadow — fire a live audit-shape parity check from inside `apiPost`.
 *
 * Called fire-and-forget after every successful GAS write that has a
 * registered shadow Edge Function (see `shadowRegistry.ts`). The wrapper:
 *
 *   1. Looks up the shadow spec for the GAS action name.
 *   2. Derives the audit-log shape the GAS router logged (synthetic, from
 *      the same payload GAS just processed).
 *   3. Invokes the shadow Edge Function with the raw payload; the shadow
 *      returns its own `.changes` dict.
 *   4. Hands both shapes to `runShadow` which hashes them, compares, and
 *      writes a `parity_results` row + bumps feature_flags counters.
 *
 * Why an audit-shape compare instead of full-response compare:
 *
 *   The previous startTask wiring (TaskDetailPanel.tsx, pre-PR) used
 *   `apiCall` to fire the SB-primary `start-task` Edge Function as the
 *   shadow. Result: 41/41 mismatches in the dashboard — GAS ran first,
 *   started the task; the shadow ran second and got back an "already
 *   started" no-op response with a different shape. A timing artifact,
 *   not a logic divergence.
 *
 *   The audit-shape compare sidesteps this entirely. It compares
 *   shadow.changes against the deterministic synthetic shape derived
 *   from the payload (e.g. `{ status: { new: 'In Progress' } }` for
 *   startTask) — independent of GAS-side timing or state.
 *
 * No-ops when:
 *   • The GAS action has no shadow registered (most actions).
 *   • The feature flag isn't loaded yet, or parity_enabled=false on it.
 *   • The shadow Edge Function call rejects (recorded as mismatch via
 *     runShadow's `sb.hash = 'ERROR'` path — never throws to the caller).
 *
 * Project context: MIGRATION_STATUS.md — live-traffic side of MIG-007
 * layer 1 ("per-call state diff"). Pairs with the operator-run
 * `replay-shadow` harness for layer 2 (90-day historical replay).
 */

import { supabase } from './supabase';
import { runShadow } from './shadowRunner';
import { getShadowSpec, resolveAuditShape } from './shadowRegistry';

/**
 * Fire a shadow parity check for a just-completed GAS write.
 *
 * @param gasAction  the apiPost action name (e.g. 'updateInventoryItem')
 * @param payload    the payload that was POSTed to GAS (the same one)
 * @param tenantId   the tenant the call was scoped to; null for fleet-wide
 *
 * Returns immediately. Shadow invocation + parity_results write happen on
 * the next microtask via runShadow's promise chain.
 */
export function fireShadow(
  gasAction: string,
  payload: Record<string, unknown>,
  tenantId?: string | null,
): void {
  const spec = getShadowSpec(gasAction);
  if (!spec) return;

  const auditShape = resolveAuditShape(spec, payload);
  const callId     = spec.toCallId  ? spec.toCallId(payload)  : undefined;
  const summary    = spec.toSummary ? spec.toSummary(payload) : `${gasAction}: shadow run`;

  void runShadow({
    key:           spec.flagKey,
    // The synthetic GAS audit shape stands in for the primary result.
    // gasDurationMs=0 because no real GAS timing is being captured here
    // — the shape is derived deterministically from the payload, not
    // observed from a network round-trip. The actual GAS call's timing
    // isn't material to the audit-shape parity comparison.
    gasResult:     auditShape,
    gasDurationMs: 0,
    // The shadow EF takes the raw payload and returns `{ ok, changes }`.
    // Resolve to the `.changes` field so the hashes compare apples to
    // apples. Throw on shadow rejection — runShadow records it as a
    // mismatch with the error message in mismatch_details.
    sbInvoke: async () => {
      const { data, error } = await supabase.functions.invoke<{
        ok?: boolean;
        changes?: Record<string, unknown>;
        error?: string;
      }>(spec.ef, { body: payload });
      if (error) throw new Error(error.message);
      const body = data ?? {};
      if (!body.ok) throw new Error(body.error ?? 'shadow returned ok=false');
      return body.changes ?? {};
    },
    tenantId,
    callId,
    inputSummary: summary,
  });
}
