/**
 * push-shipment-edit-to-sheet — Edge Function for the shipment edit-panel
 * direct-SB path.
 *
 * Fires from the React ShipmentDetailPanel's Edit mode after the
 * Supabase-authoritative `shipments` UPDATE commits. Mirrors the
 * changed fields into the per-tenant Google Sheet by calling
 * StrideAPI.gs `handleWriteThroughReverse_` via the shared
 * `reverseWritethrough` helper, so legacy readers (Receiving Doc,
 * Shipment list aggregations, anything reading the sheet directly)
 * stay in sync.
 *
 * Architecture: Supabase is the source of truth for shipments.carrier /
 * tracking_number / receive_date / notes on this path. The sheet is a
 * legacy read-only mirror. Sheet-mirror failures don't unwind the
 * Supabase commit. Closes gap #2 from the 2026-05-28 writethrough
 * field-gap audit (AUDIT-writethrough-field-gaps.md §6, §10).
 *
 * Request body:
 *   {
 *     tenantId:        string;          // client spreadsheet_id
 *     shipmentNumber:  string;          // sheet primary key
 *     patch:           {                 // any subset; only changed cols
 *       carrier?:         string | null;
 *       tracking_number?: string | null;
 *       receive_date?:    string | null; // 'YYYY-MM-DD'
 *       notes?:           string | null;
 *     };
 *     requestedBy?:    string;          // user email for gs_sync_events
 *   }
 *
 * Response: { ok, succeeded?: true, error?: string }
 *
 * Failure handling: GAS-side handleWriteThroughReverse_ writes
 * gs_sync_events on its own writer failures. Pre-GAS failures
 * (network, missing env vars) write gs_sync_events here so the
 * FailedOperationsDrawer + retry loop still picks them up. The retry
 * uses the same writeThroughReverse action so retries converge.
 *
 * Authentication: verify_jwt=false at deploy time so the React app can
 * invoke it directly. The function reuses GAS_API_TOKEN server-side —
 * the React caller can't escalate.
 *
 * Companion: AppScripts/stride-api/StrideAPI.gs
 *   - handleWriteThroughReverse_ + __writeThroughReverseShipments_
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { reverseWritethrough } from '../_shared/reverse-writethrough.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface ShipmentPatch {
  carrier?:         string | null;
  tracking_number?: string | null;
  receive_date?:    string | null;
  notes?:           string | null;
}

interface RequestBody {
  tenantId:       string;
  shipmentNumber: string;
  patch:          ShipmentPatch;
  requestedBy?:   string;
}

const ALLOWED_KEYS: Array<keyof ShipmentPatch> = [
  'carrier', 'tracking_number', 'receive_date', 'notes',
];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST')   return json({ ok: false, error: 'Method not allowed' }, 405);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const tenantId       = String(body.tenantId       || '').trim();
  const shipmentNumber = String(body.shipmentNumber || '').trim();
  const requestedBy    = String(body.requestedBy    || '').trim();
  const patchInput     = (body.patch || {}) as Record<string, unknown>;

  if (!tenantId)       return json({ ok: false, error: 'tenantId required' }, 400);
  if (!shipmentNumber) return json({ ok: false, error: 'shipmentNumber required' }, 400);

  // Filter the patch to allowed keys only. Drops bookkeeping fields the
  // caller might pass through. Skips undefined values; null is preserved
  // (clears a sheet cell).
  const row: Record<string, unknown> = {};
  for (const k of ALLOWED_KEYS) {
    if (Object.prototype.hasOwnProperty.call(patchInput, k) && patchInput[k] !== undefined) {
      row[k] = patchInput[k];
    }
  }
  if (Object.keys(row).length === 0) {
    return json({ ok: false, error: 'patch must include at least one of carrier|tracking_number|receive_date|notes' }, 400);
  }

  try {
    await reverseWritethrough({
      tenantId,
      table: 'shipments',
      op:    'update',
      rowId: shipmentNumber,
      row,
    });
    return json({ ok: true, succeeded: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[push-shipment-edit-to-sheet] ${shipmentNumber} failed:`, msg);

    await writeGsSyncFailed({
      tenantId,
      shipmentNumber,
      row,
      requestedBy,
      errorMessage: msg,
    });

    return json({ ok: false, error: msg }, 502);
  }
});

async function writeGsSyncFailed(args: {
  tenantId:       string;
  shipmentNumber: string;
  row:            Record<string, unknown>;
  requestedBy:    string;
  errorMessage:   string;
}): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    console.error('[push-shipment-edit-to-sheet] cannot write gs_sync_events — missing env');
    return;
  }
  try {
    const supabase = createClient(supabaseUrl, serviceKey);
    const payload = {
      tenantId:      args.tenantId,
      table:         'shipments',
      op:            'update',
      rowId:         args.shipmentNumber,
      row:           args.row,
    };
    const { error } = await supabase.from('gs_sync_events').insert({
      tenant_id:     args.tenantId,
      entity_type:   'shipments',
      entity_id:     args.shipmentNumber,
      action_type:   'writethrough_reverse',
      sync_status:   'sync_failed',
      requested_by:  args.requestedBy || 'edge-function',
      request_id:    crypto.randomUUID(),
      payload,
      error_message: args.errorMessage.slice(0, 1000),
    });
    if (error) {
      console.error('[push-shipment-edit-to-sheet] gs_sync_events insert failed:', error.message);
    }
  } catch (err) {
    console.error('[push-shipment-edit-to-sheet] writeGsSyncFailed exception:', err);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
