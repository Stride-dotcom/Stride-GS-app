/**
 * replay-shadow — P1.7 replay harness.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md. Implements MIG-007 layer 2
 * ("historical replay") for the GAS→Supabase migration. Reads the
 * `gas_call_log` corpus, invokes the corresponding shadow Edge Function for
 * each captured doPost call, compares the shadow's output against the GAS
 * handler's `entity_audit_log` changes for the same `correlation_id`, and
 * writes per-call match/mismatch rows to `parity_results`.
 *
 * MVP scope:
 *
 * This first version handles ONE function: `updateInventoryItem`. Shadow lives
 * at `update-item-shadow`. The mapping is hardcoded in `SHADOW_REGISTRY` below;
 * future P2/P3/P4 PRs add their shadow handler to the registry as they ship.
 *
 * Why this matters:
 *
 * Until now, the Settings → Migration tab's "Mismatches (7d)" column stayed at
 * 0 for every function because no parity tests were running. This Edge Function
 * is what populates that column. When the rollup trigger
 * (parity_results_rollup_to_feature_flags, migration
 * 20260511220000_parity_results_rollup_trigger.sql) sees a parity_results
 * INSERT, it updates feature_flags.mismatch_count_7d for the matching
 * function_key — so the UI surfaces real data.
 *
 * Invocation:
 *
 *   POST /functions/v1/replay-shadow
 *   Body: { function_key?: "updateInventoryItem", since?: "ISO datetime", limit?: int }
 *
 * Defaults:
 *   - function_key: "updateInventoryItem" (the only handler in the registry today)
 *   - since: 90 days ago
 *   - limit: 500 (avoid runaway loops; a future cron version paginates)
 *
 * Authentication: service_role only (set via Edge Function role config in
 * Supabase). Not publicly callable.
 *
 * MIG-008 (stripped-credential shadow Edge Function deploys):
 * This function deploys with placeholder values for RESEND_API_KEY, STAX_API_KEY,
 * QBO_CLIENT_SECRET, etc. Even buggy shadow code can't produce external side
 * effects because the placeholder credentials would fail at any external API
 * call. (Today's shadow handler is pure — doesn't make external calls — but the
 * pattern stays consistent for future stateful shadows.)
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

// ─── Types ───────────────────────────────────────────────────────────────────

interface ReplayRequest {
  function_key?: string;
  since?: string;
  limit?: number;
}

interface ReplayCallResult {
  call_id: string;          // gas_call_log.correlation_id
  function_key: string;
  tenant_id: string | null;
  status: 'match' | 'mismatch' | 'skip_partial_input' | 'shadow_error' | 'no_audit_row';
  sb_state_hash?: string;
  gas_state_hash?: string;
  mismatch_details?: Record<string, unknown>;
  duration_ms: number;
}

// Mapping of function_key → shadow Edge Function name + gas_call_log action
// name. The feature_flags table uses the canonical "updateItem" form (per
// the P1.1 seed), while gas_call_log captures the actual doPost action name
// "updateInventoryItem". The harness reads the corpus by action_name and
// writes parity_results.function_key with the canonical form, so the rollup
// trigger lands on the right feature_flags row.
//
// As P2/P3/P4 ship shadow handlers, add an entry here. function_key MUST
// match a feature_flags.function_key value.
interface ShadowEntry {
  shadow: string;       // Edge Function name
  action: string;       // gas_call_log.action filter value
}
const SHADOW_REGISTRY: Record<string, ShadowEntry> = {
  updateItem: { shadow: 'update-item-shadow', action: 'updateInventoryItem' },
  // [MIGRATION-P3] cancelRepair — first of the repair P3 cluster. Shadow
  // is pure (no DB writes), mirrors the fixed-shape audit log GAS produces
  // ({status:{new:'Cancelled'}}). See cancel-repair-shadow/index.ts and
  // MIGRATION_STATUS.md "Per-function migration table".
  cancelRepair: { shadow: 'cancel-repair-shadow', action: 'cancelRepair' },
  // [MIGRATION-P3] startRepair — second of the repair P3 cluster. Same
  // pure-shadow shape; GAS logs {status:{new:'In Progress'}} on every
  // start (incl. re-runs after status is already In Progress / Complete
  // for PDF regen). See start-repair-shadow/index.ts.
  startRepair:  { shadow: 'start-repair-shadow',  action: 'startRepair'  },
  // [MIGRATION-P3] sendRepairQuote — third of the repair P3 cluster.
  // GAS logs {status:{old:'Pending Quote',new:'Quote Sent'}}. See
  // send-repair-quote-shadow/index.ts. (GAS action is 'sendRepairQuote'.)
  sendRepairQuote: { shadow: 'send-repair-quote-shadow', action: 'sendRepairQuote' },
  // [MIGRATION-P3] respondToRepairQuote — fourth of the cluster. Variable
  // audit-log shape based on the decision input:
  //   {decision:'Approve', status:{new:'Approved'}}  or
  //   {decision:'Decline', status:{new:'Declined'}}.
  // GAS action key is 'respondToRepairQuote' (camelCase from the React
  // payload). See respond-repair-quote-shadow/index.ts.
  respondToRepairQuote: { shadow: 'respond-repair-quote-shadow', action: 'respondToRepairQuote' },
  // [MIGRATION-P3] requestRepairQuote — fifth + final repair P3 entry
  // (multi-item was net-new and doesn't go through parity). Variable
  // shape — items array stringified into a `summary` string. Note:
  // entity_id=='' for this audit row because the legacy GAS path
  // created N repairs (one per item) so the audit doesn't bind to a
  // single repair_id. See request-repair-quote-shadow/index.ts.
  requestRepairQuote: { shadow: 'request-repair-quote-shadow', action: 'requestRepairQuote' },
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    '{' +
    keys.map(k => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k])).join(',') +
    '}'
  );
}

async function hash(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compare two change-sets for parity. Both are flat dicts of {field → value}.
 *
 * Match if same key-set + same value per key (loose equality on numbers,
 * since GAS may write strings for some payloads and the shadow coerces to
 * numbers for qty/declaredValue).
 */
function diffChanges(
  shadowChanges: Record<string, unknown>,
  gasChanges: Record<string, unknown>,
): { match: boolean; details: Record<string, unknown> } {
  const shadowKeys = Object.keys(shadowChanges).sort();
  const gasKeys = Object.keys(gasChanges).sort();
  const allKeys = new Set([...shadowKeys, ...gasKeys]);

  const onlyInShadow: string[] = [];
  const onlyInGas: string[] = [];
  const valueMismatches: Array<{ key: string; shadow: unknown; gas: unknown }> = [];

  for (const key of allKeys) {
    const inShadow = Object.prototype.hasOwnProperty.call(shadowChanges, key);
    const inGas = Object.prototype.hasOwnProperty.call(gasChanges, key);
    if (inShadow && !inGas) {
      onlyInShadow.push(key);
    } else if (!inShadow && inGas) {
      onlyInGas.push(key);
    } else if (inShadow && inGas) {
      // Loose-equal: stringify both for comparison; covers number vs string coercion.
      const sStr = String(shadowChanges[key] ?? '');
      const gStr = String(gasChanges[key] ?? '');
      if (sStr !== gStr) {
        valueMismatches.push({ key, shadow: shadowChanges[key], gas: gasChanges[key] });
      }
    }
  }

  const match = onlyInShadow.length === 0 && onlyInGas.length === 0 && valueMismatches.length === 0;
  return {
    match,
    details: { onlyInShadow, onlyInGas, valueMismatches },
  };
}

// ─── HTTP handler ───────────────────────────────────────────────────────────

serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'POST required' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: ReplayRequest = {};
  try {
    const raw = await req.text();
    if (raw.trim()) body = JSON.parse(raw);
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const functionKey = body.function_key ?? 'updateItem';

  // Validate body.since is parseable ISO (defends against
  // `?since=garbage` producing PostgREST errors at .gte() time).
  let since: string;
  if (body.since) {
    const parsed = Date.parse(body.since);
    if (Number.isNaN(parsed)) {
      return new Response(
        JSON.stringify({ ok: false, error: `Invalid 'since' — must be parseable ISO datetime` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    since = new Date(parsed).toISOString();
  } else {
    since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  }
  const limit = Math.min(Math.max(body.limit ?? 500, 1), 5000);

  const entry = SHADOW_REGISTRY[functionKey];
  if (!entry) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: `No shadow handler registered for function_key='${functionKey}'`,
        registered_keys: Object.keys(SHADOW_REGISTRY),
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const shadowName = entry.shadow;
  const actionFilter = entry.action;

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return new Response(
      JSON.stringify({ ok: false, error: 'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const sb = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

  // Note on drift-check: `parity_dryrun.check_drift()` lives in a
  // non-public schema and supabase-js's .rpc() targets `public.*` only.
  // Today's update-item-shadow doesn't read or write any tables, so a
  // schema drift wouldn't affect its output. When P2+ stateful shadows
  // ship, wrap check_drift() with a `public.parity_dryrun_check_drift()`
  // proxy so the harness can invoke it cleanly. Tracked as P1.7 follow-up.

  // Fetch the corpus subset to replay.
  const { data: corpus, error: corpusErr } = await sb
    .from('gas_call_log')
    .select('correlation_id, action, input_redacted, tenant_id, called_at')
    .eq('action', actionFilter)
    .gte('called_at', since)
    .order('called_at', { ascending: false })
    .limit(limit);

  if (corpusErr) {
    return new Response(
      JSON.stringify({ ok: false, error: `gas_call_log fetch failed: ${corpusErr.message}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const results: ReplayCallResult[] = [];
  let matchCount = 0;
  let mismatchCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (const row of corpus || []) {
    const startedAt = Date.now();
    const callId = row.correlation_id;
    const tenantId = (row.tenant_id ?? null) as string | null;
    const input = (row.input_redacted ?? {}) as Record<string, unknown>;

    // Fetch the corresponding entity_audit_log row(s). For updateInventoryItem
    // there's exactly one (inventory entity_type) — but we LEFT JOIN logically
    // so missing audit rows become "no_audit_row" rather than crashes.
    const { data: auditRows, error: auditErr } = await sb
      .from('entity_audit_log')
      .select('entity_id, action, changes')
      .eq('correlation_id', callId)
      .eq('entity_type', 'inventory');

    if (auditErr) {
      errorCount++;
      results.push({
        call_id: callId,
        function_key: functionKey,
        tenant_id: tenantId,
        status: 'shadow_error',
        mismatch_details: { fetch_audit_error: auditErr.message },
        duration_ms: Date.now() - startedAt,
      });
      continue;
    }
    if (!auditRows || auditRows.length === 0) {
      skipCount++;
      results.push({
        call_id: callId,
        function_key: functionKey,
        tenant_id: tenantId,
        status: 'no_audit_row',
        duration_ms: Date.now() - startedAt,
      });
      continue;
    }
    const gasChanges = (auditRows[0].changes ?? {}) as Record<string, unknown>;

    // SKIP if input is partially redacted — i.e., the GAS audit log records
    // a field change that doesn't appear in input_redacted. Pre-v38.207.0
    // captures will hit this commonly for location/vendor/description/etc.
    // Post-v38.207.0 captures should all pass through.
    const gasChangedKeys = Object.keys(gasChanges);
    const inputHasAllChangedFields = gasChangedKeys.every(
      k => k === 'itemId' || Object.prototype.hasOwnProperty.call(input, k),
    );
    if (!inputHasAllChangedFields) {
      skipCount++;
      results.push({
        call_id: callId,
        function_key: functionKey,
        tenant_id: tenantId,
        status: 'skip_partial_input',
        mismatch_details: {
          input_keys: Object.keys(input),
          gas_changed_keys: gasChangedKeys,
          missing_from_input: gasChangedKeys.filter(k => !Object.prototype.hasOwnProperty.call(input, k)),
        },
        duration_ms: Date.now() - startedAt,
      });
      continue;
    }

    // Invoke the shadow handler. Per MIG-008 the shadow function deploys with
    // placeholder external creds — for update-item-shadow specifically it's
    // a pure function so no external calls occur anyway.
    const shadowUrl = `${supabaseUrl}/functions/v1/${shadowName}`;
    let shadowResp: Response;
    try {
      shadowResp = await fetch(shadowUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${serviceKey}`,
        },
        body: JSON.stringify(input),
      });
    } catch (e) {
      errorCount++;
      results.push({
        call_id: callId,
        function_key: functionKey,
        tenant_id: tenantId,
        status: 'shadow_error',
        mismatch_details: { fetch_error: e instanceof Error ? e.message : String(e) },
        duration_ms: Date.now() - startedAt,
      });
      continue;
    }

    let shadowJson: { ok?: boolean; changes?: Record<string, unknown>; error?: string };
    try {
      shadowJson = await shadowResp.json();
    } catch (e) {
      errorCount++;
      results.push({
        call_id: callId,
        function_key: functionKey,
        tenant_id: tenantId,
        status: 'shadow_error',
        mismatch_details: { parse_error: e instanceof Error ? e.message : String(e) },
        duration_ms: Date.now() - startedAt,
      });
      continue;
    }
    if (!shadowJson.ok || !shadowJson.changes) {
      // Shadow rejected the input. Since gasChanges exists (we got here
      // past the no_audit_row check), GAS accepted + audit-logged the
      // same input. That's a REAL parity mismatch — shadow's validation
      // is stricter than GAS's. Classify as `mismatch` rather than
      // `shadow_error` so the rollup trigger counts it correctly.
      mismatchCount++;
      results.push({
        call_id: callId,
        function_key: functionKey,
        tenant_id: tenantId,
        status: 'mismatch',
        mismatch_details: {
          reason: 'shadow_rejected_but_gas_accepted',
          shadow_error: shadowJson.error,
          shadow_returned: shadowJson,
          gas_changes: gasChanges,
        },
        duration_ms: Date.now() - startedAt,
      });
      continue;
    }

    const shadowChanges = shadowJson.changes;
    const diff = diffChanges(shadowChanges, gasChanges);
    const sbHash = await hash(stableStringify(shadowChanges));
    const gasHash = await hash(stableStringify(gasChanges));

    if (diff.match) {
      matchCount++;
      results.push({
        call_id: callId,
        function_key: functionKey,
        tenant_id: tenantId,
        status: 'match',
        sb_state_hash: sbHash,
        gas_state_hash: gasHash,
        duration_ms: Date.now() - startedAt,
      });
    } else {
      mismatchCount++;
      results.push({
        call_id: callId,
        function_key: functionKey,
        tenant_id: tenantId,
        status: 'mismatch',
        sb_state_hash: sbHash,
        gas_state_hash: gasHash,
        mismatch_details: diff.details,
        duration_ms: Date.now() - startedAt,
      });
    }
  }

  // Bulk-insert parity_results rows. The rollup trigger fires per-row and
  // updates feature_flags.mismatch_count_7d.
  const parityRows = results.map(r => ({
    function_key: r.function_key,
    tenant_id: r.tenant_id,
    call_id: r.call_id,
    sb_state_hash: r.sb_state_hash ?? null,
    gas_state_hash: r.gas_state_hash ?? null,
    match: r.status === 'match',
    sb_duration_ms: r.duration_ms,
    mismatch_details: r.mismatch_details ?? null,
  }));

  // Upsert on (function_key, call_id) — the unique index from migration
  // 20260511220000_parity_results_rollup_trigger.sql makes re-runs idempotent.
  // A second replay of the same corpus refreshes the latest match result,
  // hash, and details instead of piling up duplicate rows.
  let insertError: string | null = null;
  if (parityRows.length > 0) {
    const { error: insErr } = await sb
      .from('parity_results')
      .upsert(parityRows, { onConflict: 'function_key,call_id' });
    if (insErr) insertError = insErr.message;
  }

  return new Response(
    JSON.stringify({
      ok: insertError === null,
      function_key: functionKey,
      since,
      corpus_size: corpus?.length ?? 0,
      match: matchCount,
      mismatch: mismatchCount,
      skip: skipCount,
      shadow_error: errorCount,
      insert_error: insertError,
      results_count: results.length,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});
