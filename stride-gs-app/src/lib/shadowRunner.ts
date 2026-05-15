/**
 * shadowRunner — fire-and-forget GAS↔Supabase parity checks.
 *
 * Phase 1 of the migration shadow plan (MIGRATION_STATUS.md). When a
 * feature_flag has `parity_enabled=true` AND a `shadow_backend` set,
 * every primary call hands off to runShadow() which:
 *
 *   1. Invokes the shadow function in the background (non-blocking —
 *      the caller has already returned its primary result by the time
 *      we kick off the SB call).
 *   2. Hashes the JSON-serialized result of each side (SHA-256, hex).
 *   3. Inserts a parity_results row with both hashes + the durations +
 *      a mismatch_details blob when the hashes diverge.
 *   4. Patches feature_flags.total_checks + mismatch_count (lifetime
 *      counters that feed the GENERATED match_rate column).
 *
 * Best-effort: any failure logs to console and returns. The primary
 * call has already succeeded; a missing parity row is annoying but
 * not load-bearing. The Settings → Migration tab will simply show a
 * lower total_checks number than the dashboard expected.
 *
 * Auth: runs as the operator's JWT. RLS policy
 * `parity_results_authenticated_insert` (added in 20260514170000)
 * allows admin/staff to write. For non-staff callers (clients), the
 * shadow row never gets written — that's intentional, clients
 * shouldn't be triggering parity-write traffic.
 *
 * Project context: MIG-007 (three-layer verification) — this file is
 * the React-side equivalent of GAS's `api_logCallInput_` + the future
 * replay harness's same-side parity check.
 */
import { supabase } from './supabase';
import {
  getFeatureFlagSnapshot,
  type Backend,
} from '../contexts/FeatureFlagContext';

/** Result hash + duration captured from one backend call. */
interface BackendOutcome {
  hash: string;
  durationMs: number;
  /** Stringified JSON of the result, kept only when the two hashes
   *  diverge so the parity_results.mismatch_details column has the
   *  full payload for triage. Bounded at 8KB per side to keep the
   *  row size reasonable. */
  serialized?: string;
}

export interface ShadowRunOptions {
  /** function_key on feature_flags. */
  key: string;
  /** Already-resolved result + duration from the primary call. The
   *  caller has just finished awaiting it. */
  gasResult: unknown;
  gasDurationMs: number;
  /** Async invoker for the shadow backend. May throw — handled
   *  internally, the throw is recorded as a mismatch reason. */
  sbInvoke: () => Promise<unknown>;
  /** One-liner for parity_results.input_summary so the operator can
   *  scan the recent-runs list without decoding hashes. Bounded at
   *  240 chars. */
  inputSummary?: string;
  /** Hash of the input payload (content-addressed). Optional —
   *  callers that already compute one should pass it through;
   *  shadowRunner doesn't try to re-derive from arbitrary fn args. */
  inputHash?: string;
  /** Tenant the primary call was scoped to. Lets the Migration UI
   *  filter by tenant when a canary cohort is live. */
  tenantId?: string | null;
  /** Optional correlation id (e.g. the dt_order id or task id the
   *  call touched). Provides a natural join key for cross-table
   *  triage. UNIQUE (function_key, call_id) is enforced at the DB so
   *  a duplicate call_id silently no-ops. */
  callId?: string;
}

const MAX_SERIALIZED_BYTES = 8 * 1024; // 8KB per side in mismatch_details

/** SHA-256 hex hash of a stable JSON serialization. crypto.subtle is
 *  available in every browser the app targets. */
async function hashJson(value: unknown): Promise<{ hash: string; serialized: string }> {
  const serialized = stableStringify(value);
  const buf = new TextEncoder().encode(serialized);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const hash = Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return { hash, serialized };
}

/** JSON.stringify with sorted object keys so {a:1,b:2} and {b:2,a:1}
 *  produce the same hash. Without this, two equivalent JSON results
 *  with different key order would show up as mismatches. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return '{' + keys.map(k =>
    JSON.stringify(k) + ':' + stableStringify((v as Record<string, unknown>)[k])
  ).join(',') + '}';
}

/** Truncate a string to fit MAX_SERIALIZED_BYTES (rough — UTF-8
 *  bytes vs. JS chars). Appends a marker so the consumer knows the
 *  value was clipped. */
function clipSerialized(s: string): string {
  if (s.length <= MAX_SERIALIZED_BYTES) return s;
  return s.slice(0, MAX_SERIALIZED_BYTES - 20) + '…<truncated>';
}

/** Best-effort PATCH on feature_flags' lifetime counters. The
 *  generated match_rate column updates automatically. Optimistic-
 *  concurrency-safe in the trivial sense that two concurrent +1s
 *  will both PATCH the same value (last write wins); we accept that
 *  loss given the alternative is a transactional RPC for every
 *  shadow run. The 7-day rolling counter (mismatch_count_7d) is left
 *  to the future replay/reaper job — it's a separate aggregation
 *  problem and shadowRunner is purely additive. */
async function bumpFlagCounters(key: string, mismatched: boolean): Promise<void> {
  // Read-then-PATCH. The window between read and write is small
  // (single ms) and a missed bump under contention shows up as
  // slightly lower total_checks — not load-bearing. A future RPC
  // (`bump_parity_counters(key, mismatched)`) would close this gap.
  const { data: row } = await supabase
    .from('feature_flags')
    .select('total_checks, mismatch_count')
    .eq('function_key', key)
    .maybeSingle();
  if (!row) return; // unknown key — caller bug, don't insert a counter for it
  const total = Number(row.total_checks || 0) + 1;
  const miss = Number(row.mismatch_count || 0) + (mismatched ? 1 : 0);
  await supabase
    .from('feature_flags')
    .update({
      total_checks: total,
      mismatch_count: miss,
      last_parity_check: new Date().toISOString(),
    })
    .eq('function_key', key);
}

/**
 * runShadow — fire the shadow backend, hash both sides, write a row.
 * Non-blocking from the caller's perspective: callers should NOT
 * await this if they want to return their primary result promptly.
 * That said, awaiting is safe — runShadow never throws to the caller.
 *
 * No-ops when:
 *   • The flag isn't loaded yet (provider still initializing).
 *   • parity_enabled is false on the flag.
 *   • shadow_backend is null.
 */
export async function runShadow(opts: ShadowRunOptions): Promise<void> {
  try {
    const snapshot = getFeatureFlagSnapshot();
    const flag = snapshot ? snapshot[opts.key] : undefined;
    if (!flag) return;
    if (!flag.parity_enabled) return;
    if (!flag.shadow_backend) return;

    // Capture the shadow result + its duration. A throw from the
    // shadow backend is recorded as a mismatch with the error
    // message in the details blob — exactly the signal the
    // Migration UI wants to surface.
    let sb: BackendOutcome;
    const sbStart = performance.now();
    try {
      const sbResult = await opts.sbInvoke();
      const sbDuration = Math.round(performance.now() - sbStart);
      const { hash, serialized } = await hashJson(sbResult);
      sb = { hash, durationMs: sbDuration, serialized: clipSerialized(serialized) };
    } catch (err) {
      const sbDuration = Math.round(performance.now() - sbStart);
      sb = {
        hash: 'ERROR',
        durationMs: sbDuration,
        serialized: clipSerialized(`Shadow invoke threw: ${(err as Error)?.message ?? String(err)}`),
      };
    }

    const { hash: gasHash, serialized: gasSerialized } = await hashJson(opts.gasResult);
    const gas: BackendOutcome = {
      hash: gasHash,
      durationMs: opts.gasDurationMs,
      serialized: clipSerialized(gasSerialized),
    };

    const matched = sb.hash === gas.hash && sb.hash !== 'ERROR';

    // input_summary cap mirrors what the Migration UI will render.
    const summary = (opts.inputSummary ?? `${opts.key}: shadow run`).slice(0, 240);

    const insertPayload: Record<string, unknown> = {
      function_key:     opts.key,
      tenant_id:        opts.tenantId ?? null,
      call_id:          opts.callId ?? null,
      input_hash:       opts.inputHash ?? null,
      input_summary:    summary,
      // Existing schema columns: gas_state_hash / sb_state_hash.
      // The build-spec called them gas_result_hash / sb_result_hash;
      // we're preserving the canonical column names (already
      // referenced by GAS-side replay tooling) and using them for
      // both senses.
      gas_state_hash:   gas.hash,
      sb_state_hash:    sb.hash,
      match:            matched,
      gas_duration_ms:  gas.durationMs,
      sb_duration_ms:   sb.durationMs,
      mismatch_details: matched ? null : {
        gas: gas.serialized,
        sb:  sb.serialized,
        reason: sb.hash === 'ERROR' ? 'shadow_threw' : 'hash_diff',
      },
    };

    // Insert + bump counters in parallel. If the insert fails (e.g.
    // duplicate call_id), we still bump counters so the rolling
    // success rate stays accurate. If the bump fails, the row is
    // still on file and a backfill query can re-derive the counter
    // off parity_results directly.
    await Promise.all([
      supabase.from('parity_results').insert(insertPayload),
      bumpFlagCounters(opts.key, !matched),
    ]);
  } catch (err) {
    // Last-resort: shadowRunner must never raise into the primary
    // call's success path. A console warning is enough; the
    // Migration UI will show stale counters and the operator can
    // investigate at their leisure.
    console.warn('[shadowRunner] non-fatal error', err);
  }
}

/** Re-export the Backend type so callers can keep a single import. */
export type { Backend };
