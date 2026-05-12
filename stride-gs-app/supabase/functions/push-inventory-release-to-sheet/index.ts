/**
 * push-inventory-release-to-sheet — Edge Function for the MIG-P2
 * inventory release path.
 *
 * Fires from the React OrderPage's DtOrderReleasePanel after the
 * Supabase-authoritative `inventory.status='Released' +
 * release_date` write commits. This function mirrors that change
 * into the per-tenant Google Sheet by calling
 * StrideAPI.gs handleWriteThroughReverse_ once per item (via the
 * `reverseWritethrough` shared helper).
 *
 * Architecture: Supabase is now the source of truth for
 * inventory.status / release_date on this path. The sheet is a
 * legacy read-only mirror until invoice generation flips to
 * Supabase-primary in P4a. Sheet-mirror failures don't unwind the
 * Supabase commit — that's the whole point of decoupling.
 *
 * Request body:
 *   {
 *     tenantId:     string;            // client spreadsheet_id
 *     inventoryIds: string[];          // public.inventory.id values (informational)
 *     itemIds:      string[];          // human-readable Item IDs (the sheet primary key)
 *     releaseDate:  string;            // YYYY-MM-DD
 *     requestedBy?: string;            // user email for gs_sync_events attribution
 *   }
 *
 * Response: { ok, succeeded, failed: [{itemId, error}] }
 *
 * Failure handling: the GAS side writes gs_sync_events with
 * action_type='writethrough_reverse' when its per-table writer
 * throws, so those failures surface in the React FailedOperations
 * drawer automatically (no additional gs_sync_events write from
 * this function for those cases). For failures BEFORE the GAS
 * call (network error, missing env vars) — where the GAS side
 * never sees the request — we write gs_sync_events ourselves so
 * the drawer + retry still works.
 *
 * Authentication: verify_jwt=false at deploy time so anon callers
 * (and other edge functions in P2 inserts) can invoke it. The
 * function reuses GAS_API_TOKEN for the actual sheet mutation —
 * the React caller can't escalate.
 *
 * Companion: AppScripts/stride-api/StrideAPI.gs
 *   - handleWriteThroughReverse_ + __writeThroughReverseInventory_ (v38.208.0)
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
  inventoryIds: string[];
  itemIds: string[];
  releaseDate: string;
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
  const itemIds     = Array.isArray(body.itemIds) ? body.itemIds.map(String) : [];
  const releaseDate = String(body.releaseDate || '').trim();
  const requestedBy = String(body.requestedBy || '').trim();

  if (!tenantId)              return json({ ok: false, error: 'tenantId required' },    400);
  if (itemIds.length === 0)   return json({ ok: false, error: 'itemIds required' },     400);
  if (!releaseDate)           return json({ ok: false, error: 'releaseDate required' }, 400);

  // Per-item reverse writethrough. The framework's per-table writer
  // is itself idempotent (no-ops when the row already matches), so
  // at-least-once delivery is safe; we run sequentially to keep the
  // GAS-side concurrency profile predictable (Apps Script
  // LockService friendliness > raw throughput for a 1–20-item
  // release that finishes in seconds anyway).
  const succeeded: string[] = [];
  const failed: Array<{ itemId: string; error: string }> = [];

  for (const itemId of itemIds) {
    try {
      await reverseWritethrough({
        tenantId,
        table: 'inventory',
        op:    'update',
        rowId: itemId,
        row:   {
          status:       'Released',
          release_date: releaseDate,
        },
      });
      succeeded.push(itemId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[push-inventory-release-to-sheet] ${itemId} failed:`, msg);
      failed.push({ itemId, error: msg });

      // The GAS-side handleWriteThroughReverse_ writes gs_sync_events
      // on its own writer failures. But errors BEFORE the GAS request
      // lands (missing env vars, HTTP transport errors, GAS returns
      // non-2xx) bypass that path — write gs_sync_events ourselves so
      // the FailedOperationsDrawer still picks the failure up. The
      // GAS-side writes use the same action_type, so retries
      // converge on the same handleWriteThroughReverse_ endpoint.
      await writeGsSyncFailed({
        tenantId,
        itemId,
        releaseDate,
        requestedBy,
        errorMessage: msg,
      });
    }
  }

  return json({
    ok:        failed.length === 0,
    succeeded: succeeded.length,
    failed,
  });
});

async function writeGsSyncFailed(args: {
  tenantId: string;
  itemId: string;
  releaseDate: string;
  requestedBy: string;
  errorMessage: string;
}): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    console.error('[push-inventory-release-to-sheet] cannot write gs_sync_events — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return;
  }
  try {
    const supabase = createClient(supabaseUrl, serviceKey);
    // Match the GAS-side payload shape so the FailedOperationsDrawer
    // retry (apiPost('writeThroughReverse', payload, {clientSheetId}))
    // hits the same endpoint with the same fields and converges with
    // the GAS-originated failure path.
    const payload = {
      tenantId: args.tenantId,
      table:    'inventory',
      op:       'update',
      rowId:    args.itemId,
      row:      { status: 'Released', release_date: args.releaseDate },
    };
    const { error } = await supabase.from('gs_sync_events').insert({
      tenant_id:     args.tenantId,
      entity_type:   'inventory',
      entity_id:     args.itemId,
      action_type:   'writethrough_reverse',
      sync_status:   'sync_failed',
      requested_by:  args.requestedBy || 'edge-function',
      request_id:    crypto.randomUUID(),
      payload,
      error_message: args.errorMessage.slice(0, 1000),
    });
    if (error) {
      console.error('[push-inventory-release-to-sheet] gs_sync_events insert failed:', error.message);
    }
  } catch (err) {
    // Best-effort logging — never throw out of here. The release
    // already committed in Supabase, so this is purely about
    // surfacing the sheet-mirror failure for retry.
    console.error('[push-inventory-release-to-sheet] writeGsSyncFailed exception:', err);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
