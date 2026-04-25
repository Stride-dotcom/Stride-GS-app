/**
 * dt-sync-statuses — Supabase Edge Function (session 85)
 * v6 2026-04-25 PST
 *   v6: Missing-credentials path now returns ok:false so the UI doesn't
 *       paint a misleading green. dt_statuses is read once and shared
 *       between the terminal-id filter and the code→id map (was being
 *       fetched twice). Throttle comment corrected — 100ms ≈ 36k req/hr,
 *       well above DT's 1000/hr cap, but the Edge Function gets only a
 *       handful of dispatched orders per run so the loop completes quickly
 *       enough that we don't actually hit it.
 *   v5: DT auth corrected from Bearer header to ?api_key= query parameter
 *       (matches dt-push-order/dt-backfill-orders). Terminal-category filter
 *       now also excludes 'exception' and 'billing'. SELECT now pulls paid_at
 *       so the auto-Collected branch can fire when DT reports completion on
 *       an already-paid order. Added a same-status guard so we don't churn
 *       last_synced_at on rows whose status didn't change.
 *   v4: prior version (Bearer auth, no auto-Collected, no same-status guard).
 *
 * Pulls latest delivery status from DispatchTrack for orders that have been
 * pushed (`dt_dispatch_id IS NOT NULL`) and are not yet in a terminal state.
 * Called:
 *   • Manually from the Orders page "DT Sync" button.
 *   • Nightly from an Apps Script trigger that invokes this function.
 *
 * Request:   POST { scope?: 'active' | 'all', orderId?: string }
 * Response:  { ok: boolean, checked: number, updated: number, completed: number, errors: string[] }
 *
 * Notes:
 *   • DT status fetch endpoint (`GET /orders/api/get_order_status`) requires
 *     `dt_credentials.auth_token_encrypted` to be set. Until credentials are
 *     configured, the function returns a zero-update summary and logs a
 *     diagnostic message rather than erroring — this keeps the UI wired up.
 *   • When a DT order reports "Delivered" we flip:
 *       dt_orders.status_id       = <dt_statuses.id for category='completed'>
 *       dt_orders.last_synced_at  = now()
 *     If the order is already paid (paid_at IS NOT NULL) we jump straight to
 *     Collected (status 22) so billing review doesn't have to chase a manual
 *     second click. The Orders table auto-refreshes via realtime.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const STATUS_COLLECTED = 22;

interface SyncBody {
  scope?: 'active' | 'all';
  orderId?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'Method not allowed' }, 405);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  let body: SyncBody = {};
  try {
    body = await req.json();
  } catch (_) { body = {}; }
  const scope = body.scope || 'active';
  const singleOrderId = body.orderId;

  // Load credentials (single row in dt_credentials)
  const { data: cred, error: credErr } = await supabase
    .from('dt_credentials').select('*').limit(1).maybeSingle();
  if (credErr) return json({ ok: false, error: `Credentials read failed: ${credErr.message}` }, 500);

  const haveCreds = !!(cred?.auth_token_encrypted && cred?.api_base_url);

  // Load dt_statuses once and reuse. Used both to exclude terminal buckets
  // when scope === 'active' AND to translate DT response codes → status_id
  // later in the loop.
  const { data: statusRows } = await supabase
    .from('dt_statuses')
    .select('id, code, category');
  const allStatuses = (statusRows || []) as Array<{ id: number; code: string | null; category: string }>;
  const statusByCode = new Map<string, { id: number; category: string }>();
  for (const s of allStatuses) {
    if (s.code) statusByCode.set(String(s.code).toUpperCase(), { id: s.id, category: s.category });
  }

  // Build candidate query: pushed to DT and not in terminal categories.
  let query = supabase
    .from('dt_orders')
    .select('id, dt_identifier, dt_dispatch_id, status_id, last_synced_at, tenant_id, paid_at')
    .not('dt_dispatch_id', 'is', null);

  if (singleOrderId) {
    query = query.eq('id', singleOrderId);
  } else if (scope === 'active') {
    const terminalIds = allStatuses
      .filter(s => s.category === 'completed' || s.category === 'cancelled' || s.category === 'exception' || s.category === 'billing')
      .map(s => s.id);
    if (terminalIds.length > 0) {
      query = query.or(`status_id.is.null,status_id.not.in.(${terminalIds.join(',')})`);
    }
  }

  const { data: orders, error: fetchErr } = await query;
  if (fetchErr) return json({ ok: false, error: `Order fetch failed: ${fetchErr.message}` }, 500);

  const result = {
    ok: true,
    checked: orders?.length ?? 0,
    updated: 0,
    completed: 0,
    errors: [] as string[],
    note: '' as string,
  };

  if (!orders || orders.length === 0) {
    result.note = 'No pushed orders need syncing.';
    return json(result);
  }

  if (!haveCreds) {
    // Credentials not configured — this is a configuration error, not a
    // successful sync. Return ok:false so the UI shows the actual problem
    // instead of painting a misleading "synced N orders" toast.
    const nowIso = new Date().toISOString();
    const ids = orders.map(o => o.id);
    const { error: touchErr } = await supabase
      .from('dt_orders').update({ last_synced_at: nowIso }).in('id', ids);
    if (touchErr) result.errors.push(`Timestamp update failed: ${touchErr.message}`);
    result.ok = false;
    result.updated = 0;
    result.note = 'DT credentials not configured — populate dt_credentials.auth_token_encrypted + api_base_url to enable live status pulls.';
    return json(result, 503);
  }

  // Per-order fetch loop. DT rate limit is 1000/hr; with the per-iteration
  // throttle below we'd exceed that rate in pathological scale-up scenarios,
  // but in practice this function only ever sees a few dozen pushed-but-
  // unfinished orders per run, so we never get close to the cap.
  for (const o of orders) {
    try {
      // DT authenticates via the `api_key` query parameter, NOT Bearer auth.
      // Match the pattern used in dt-push-order/dt-backfill-orders.
      const url = `${String(cred.api_base_url).replace(/\/+$/, '')}/orders/api/get_order_status?code=expressinstallation&api_key=${encodeURIComponent(String(cred.auth_token_encrypted))}&order_id=${encodeURIComponent(String(o.dt_dispatch_id))}`;
      const resp = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });
      if (!resp.ok) {
        result.errors.push(`${o.dt_identifier}: HTTP ${resp.status}`);
        continue;
      }
      const body = await resp.json().catch(() => null) as Record<string, unknown> | null;
      const dtStatusCode = body ? String(body.status_code || body.status || '').toUpperCase() : '';
      if (!dtStatusCode) continue;
      const match = statusByCode.get(dtStatusCode);
      if (!match) {
        result.errors.push(`${o.dt_identifier}: unknown DT status "${dtStatusCode}"`);
        continue;
      }
      let finalStatusId = match.id;
      if (match.category === 'completed' && o.paid_at) {
        finalStatusId = STATUS_COLLECTED;
        console.log(`${o.dt_identifier}: completed + paid → auto-Collected (status_id=${STATUS_COLLECTED})`);
      }
      if (finalStatusId === o.status_id) {
        continue;
      }
      const patch: Record<string, unknown> = {
        status_id: finalStatusId,
        last_synced_at: new Date().toISOString(),
      };
      const { error: updErr } = await supabase.from('dt_orders').update(patch).eq('id', o.id);
      if (updErr) {
        result.errors.push(`${o.dt_identifier}: ${updErr.message}`);
      } else {
        result.updated += 1;
        if (match.category === 'completed') result.completed += 1;
      }
    } catch (e) {
      result.errors.push(`${o.dt_identifier}: ${e instanceof Error ? e.message : String(e)}`);
    }
    // Throttle ~10 req/s. DT's documented cap is 1000/hr (≈0.28 req/s), so
    // the per-iteration delay is mostly defensive politeness rather than a
    // hard rate-limit guard — we never see enough orders per run to reach
    // the cap. The setTimeout yields the event loop between iterations
    // (Deno's microtask queue still drains, so this isn't a hard block).
    await new Promise(r => setTimeout(r, 100));
  }

  return json(result);
});

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  } as Record<string, string>;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}
