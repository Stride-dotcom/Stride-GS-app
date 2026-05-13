/**
 * push-will-call-cod-to-sheet — Edge Function for the MIG-P2
 * will-calls COD inline-edit path.
 *
 * Fires from the React WillCallDetailPanel's view-mode COD inline
 * editor after the Supabase-authoritative
 * `will_calls.cod / cod_amount` write commits. This function mirrors
 * that change into the per-tenant Google Sheet by calling
 * StrideAPI.gs handleWriteThroughReverse_ via the `reverseWritethrough`
 * shared helper.
 *
 * Architecture: Supabase is the source of truth for
 * will_calls.cod / cod_amount on this path. The sheet is a legacy
 * read-only mirror so the PDF release doc generator, full client
 * sync, and COD payment page launcher (all sheet-side today) see
 * the same state. Sheet-mirror failures don't unwind the Supabase
 * commit — that's the whole point of decoupling.
 *
 * Request body:
 *   {
 *     tenantId:    string;          // client spreadsheet_id
 *     wcNumber:    string;          // Will Call number (sheet primary key)
 *     cod:         boolean;         // new COD flag
 *     codAmount:   number | null;   // new COD amount; null clears the cell
 *     requestedBy?: string;         // user email for gs_sync_events attribution
 *   }
 *
 * Response: { ok, succeeded?: true, error?: string }
 *
 * Failure handling: the GAS side writes gs_sync_events with
 * action_type='writethrough_reverse' when its per-table writer
 * throws. For failures BEFORE the GAS call lands (network error,
 * missing env vars), this function writes gs_sync_events itself so
 * the FailedOperationsDrawer + retry loop still works.
 *
 * Authentication: verify_jwt=false at deploy time so the React app
 * can invoke it directly. The function reuses GAS_API_TOKEN for the
 * actual sheet mutation — the React caller can't escalate.
 *
 * Companion: AppScripts/stride-api/StrideAPI.gs
 *   - handleWriteThroughReverse_ + __writeThroughReverseWillCalls_ (v38.213.0)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { reverseWritethrough } from '../_shared/reverse-writethrough.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  tenantId: string;
  wcNumber: string;
  cod: boolean;
  codAmount: number | null;
  requestedBy?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const tenantId    = String(body.tenantId    || '').trim();
  const wcNumber    = String(body.wcNumber    || '').trim();
  const cod         = !!body.cod;
  const codAmount   = body.codAmount == null ? null : Number(body.codAmount);
  const requestedBy = String(body.requestedBy || '').trim();

  if (!tenantId)            return json({ ok: false, error: 'tenantId required' }, 400);
  if (!wcNumber)            return json({ ok: false, error: 'wcNumber required' }, 400);
  if (codAmount != null && !Number.isFinite(codAmount)) {
    return json({ ok: false, error: 'codAmount must be a finite number or null' }, 400);
  }

  // Single-row reverse writethrough. The framework's per-table writer
  // is itself idempotent (no-ops when the row already matches), so
  // at-least-once delivery is safe.
  try {
    await reverseWritethrough({
      tenantId,
      table: 'will_calls',
      op:    'update',
      rowId: wcNumber,
      row:   {
        cod,
        cod_amount: codAmount,
      },
    });
    return json({ ok: true, succeeded: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[push-will-call-cod-to-sheet] ${wcNumber} failed:`, msg);

    // The GAS-side handleWriteThroughReverse_ writes gs_sync_events
    // on its own writer failures. Errors BEFORE the GAS request lands
    // (missing env vars, HTTP transport errors, GAS returns non-2xx)
    // bypass that path — write gs_sync_events ourselves so the
    // FailedOperationsDrawer still picks the failure up. The GAS-side
    // retries use the same action_type, so retries converge on the
    // same handleWriteThroughReverse_ endpoint.
    await writeGsSyncFailed({
      tenantId,
      wcNumber,
      cod,
      codAmount,
      requestedBy,
      errorMessage: msg,
    });

    return json({ ok: false, error: msg }, 502);
  }
});

async function writeGsSyncFailed(args: {
  tenantId: string;
  wcNumber: string;
  cod: boolean;
  codAmount: number | null;
  requestedBy: string;
  errorMessage: string;
}): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    console.error('[push-will-call-cod-to-sheet] cannot write gs_sync_events — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return;
  }
  try {
    const supabase = createClient(supabaseUrl, serviceKey);
    // Match the GAS-side payload shape so the FailedOperationsDrawer
    // retry (apiPost('writeThroughReverse', payload, {clientSheetId}))
    // hits the same endpoint with the same fields and converges with
    // the GAS-originated failure path.
    const payload = {
      tenantId,
      table:    'will_calls',
      op:       'update',
      rowId:    args.wcNumber,
      row:      { cod: args.cod, cod_amount: args.codAmount },
    };
    const { error } = await supabase.from('gs_sync_events').insert({
      tenant_id:     args.tenantId,
      entity_type:   'will_calls',
      entity_id:     args.wcNumber,
      action_type:   'writethrough_reverse',
      sync_status:   'sync_failed',
      requested_by:  args.requestedBy || 'edge-function',
      request_id:    crypto.randomUUID(),
      payload,
      error_message: args.errorMessage.slice(0, 1000),
    });
    if (error) {
      console.error('[push-will-call-cod-to-sheet] gs_sync_events insert failed:', error.message);
    }
  } catch (err) {
    // Best-effort logging — never throw out of here. The Supabase
    // commit already happened, so this is purely about surfacing the
    // sheet-mirror failure for retry.
    console.error('[push-will-call-cod-to-sheet] writeGsSyncFailed exception:', err);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
