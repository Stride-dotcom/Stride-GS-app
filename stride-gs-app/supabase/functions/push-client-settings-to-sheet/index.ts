/**
 * push-client-settings-to-sheet — Edge Function that mirrors a Supabase
 * `public.clients` row OUT to the per-tenant Google Sheet's Settings tab
 * AND the CB Clients tab via the existing P1.4 reverse-writethrough
 * framework.
 *
 * The flow this closes:
 *
 *   App (React / intake form) → Supabase `public.clients` UPDATE
 *                             ↓ Postgres trigger (propagate_clients_to_sheet)
 *                             ↓ POST { spreadsheet_id }
 *                             this function
 *                             ↓ reverseWritethrough { tenantId, table:'clients', op:'update', row }
 *                             StrideAPI.gs handleWriteThroughReverse_
 *                             ↓ __writeThroughReverseClients_
 *                             per-tenant Settings tab + CB Clients tab
 *
 * Without this loop closure, the GAS full-client-sync
 * (`handleResyncClients_`, which reads the CB Clients sheet and PATCHes
 * every row into `public.clients`) silently overwrites
 * Supabase-authoritative client-settings changes — the exact failure
 * mode Justin called out for Brian Paquette's `auto_inspection` flip.
 *
 * Architecture: Supabase is the source of truth for `public.clients`
 * settings on the React-write path; the per-tenant Settings tab + CB
 * Clients tab are read-only mirrors. A sheet-mirror failure does NOT
 * unwind the Supabase commit (matches the rest of MIG-002).
 *
 * Request body (one of):
 *   { spreadsheet_id: string, requestedBy?: string }
 *     → loads `public.clients` row by spreadsheet_id, mirrors all
 *       relevant columns
 *   { spreadsheet_id: string, row: object, requestedBy?: string }
 *     → trusts the caller's `row` payload (skipping the SB load) —
 *       useful for tests + future call sites that already have a
 *       fresh row in hand
 *
 * Response: { ok, spreadsheet_id, fields_mirrored, error? }
 *
 * Authentication: deploy with the default `verify_jwt=true`. Every
 * caller passes a JWT — the Postgres trigger passes the service-role
 * JWT (via `app.settings.service_role_key` in the trigger function),
 * `apply-intake-on-submit` passes the service-role JWT, future React
 * save paths will pass the user JWT. The function uses GAS_API_TOKEN
 * for the actual sheet mutation — anon callers can't escalate even
 * if verify_jwt were ever disabled. The Settings-tab write is also
 * gated GAS-side by `api_isKnownTenantId_` against `public.clients`,
 * so a request for an unrecognized spreadsheet_id is rejected by GAS
 * regardless of who called this function.
 *
 * Companion: AppScripts/stride-api/StrideAPI.gs
 *   - handleWriteThroughReverse_
 *   - __writeThroughReverseClients_ (v38.224.0)
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { reverseWritethrough } from '../_shared/reverse-writethrough.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface RequestBody {
  spreadsheet_id: string;
  row?: Record<string, unknown>;
  requestedBy?: string;
}

// Columns we want to mirror to the sheet. Mirrors the union of
// CLIENT_FIELDS_[*].supabaseColumn (GAS-side schema) and the
// Supabase-only fields surfaced for ops visibility — see
// __writeThroughReverseClients_ in StrideAPI.gs for the writer-side
// contract. Extra columns are silently ignored by the GAS writer.
//
// editOnly CLIENT_FIELDS_ entries (folder_id, photos_folder_id,
// invoice_folder_id, web_app_url) are INTENTIONALLY EXCLUDED. They
// are owned by the onboarding flow (handleOnboardClient_ — provisions
// the Drive folders + the Web App URL at first creation) and should
// not churn via reverse-writethrough. If a future SB-side process
// changes one (it shouldn't), we don't want it overwriting the sheet
// with a value that might be a partial provision.
const MIRRORED_COLUMNS: string[] = [
  // CLIENT_FIELDS_ schema (column-mirrored to CB Clients + key/value to Settings)
  'name',
  'email',
  'contact_name',
  'phone',
  'qb_customer_name',
  'stax_customer_name',
  'stax_customer_id',
  'payment_terms',
  'free_storage_days',
  'discount_storage_pct',
  'discount_services_pct',
  'enable_receiving_billing',
  'enable_shipment_email',
  'enable_notifications',
  'auto_inspection',
  'separate_by_sidemark',
  'auto_charge',
  'parent_client',
  'notes',
  'shipment_note',
  'active',
  // Supabase-only fields (ops-visible in Settings tab; no CB column)
  'notification_contacts',
  'billing_contact_name',
  'billing_email',
  'billing_address',
  'tax_exempt',
  'tax_exempt_reason',
  'resale_cert_expires',
  'resale_cert_url',
  'payment_method_required', // 2026-05-28 audit gap #5 — Stax payment-method enforcement
];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const spreadsheetId = String(body.spreadsheet_id || '').trim();
  const requestedBy   = String(body.requestedBy || '').trim();
  if (!spreadsheetId) return json({ ok: false, error: 'spreadsheet_id required' }, 400);

  // ── 1. Load the SB row (unless the caller pre-supplied it) ─────────
  let row: Record<string, unknown>;
  if (body.row && typeof body.row === 'object') {
    row = body.row as Record<string, unknown>;
  } else {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceKey) {
      console.error('[push-client-settings-to-sheet] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      return json({ ok: false, error: 'Server misconfigured' }, 500);
    }
    const supabase = createClient(supabaseUrl, serviceKey);
    const { data, error } = await supabase
      .from('clients')
      .select(MIRRORED_COLUMNS.join(','))
      .eq('spreadsheet_id', spreadsheetId)
      .maybeSingle();
    if (error) {
      return json({ ok: false, error: `clients select failed: ${error.message}` }, 500);
    }
    if (!data) {
      return json({ ok: false, error: `clients row not found for spreadsheet_id ${spreadsheetId}` }, 404);
    }
    row = data as Record<string, unknown>;
  }

  // Defensive narrowing: only forward columns we know the GAS writer
  // understands. Unknown columns are silently dropped by the writer
  // already, but trimming here keeps the payload tight + logs readable.
  const mirroredRow: Record<string, unknown> = {};
  for (const col of MIRRORED_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(row, col)) {
      mirroredRow[col] = row[col];
    }
  }
  const fieldsMirrored = Object.keys(mirroredRow).length;
  if (fieldsMirrored === 0) {
    return json({
      ok: false,
      error: 'No mirrorable fields in row payload',
      spreadsheet_id: spreadsheetId,
    }, 400);
  }

  // ── 2. Fire the reverse-writethrough ─────────────────────────────
  try {
    const result = await reverseWritethrough({
      tenantId: spreadsheetId,
      table:    'clients',
      op:       'update',
      rowId:    spreadsheetId,
      row:      mirroredRow,
    });
    return json({
      ok:              true,
      spreadsheet_id:  spreadsheetId,
      fields_mirrored: fieldsMirrored,
      result:          result.result ?? null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[push-client-settings-to-sheet] ${spreadsheetId} failed:`, msg);

    // Mirror the inventory function's gs_sync_events failure surface
    // so pre-GAS failures (network / missing env / HTTP non-2xx) also
    // land in the FailedOperationsDrawer.
    await writeGsSyncFailed({
      tenantId:     spreadsheetId,
      row:          mirroredRow,
      requestedBy,
      errorMessage: msg,
    });

    return json({
      ok:    false,
      error: msg,
      spreadsheet_id: spreadsheetId,
    }, 502);
  }
});

async function writeGsSyncFailed(args: {
  tenantId: string;
  row: Record<string, unknown>;
  requestedBy: string;
  errorMessage: string;
}): Promise<void> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    console.error('[push-client-settings-to-sheet] cannot write gs_sync_events — missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    return;
  }
  try {
    const supabase = createClient(supabaseUrl, serviceKey);
    const payload = {
      tenantId: args.tenantId,
      table:    'clients',
      op:       'update',
      rowId:    args.tenantId,
      row:      args.row,
    };
    const { error } = await supabase.from('gs_sync_events').insert({
      tenant_id:     args.tenantId,
      entity_type:   'clients',
      entity_id:     args.tenantId,
      action_type:   'writethrough_reverse',
      sync_status:   'sync_failed',
      requested_by:  args.requestedBy || 'edge-function',
      request_id:    crypto.randomUUID(),
      payload,
      error_message: args.errorMessage.slice(0, 1000),
    });
    if (error) {
      console.error('[push-client-settings-to-sheet] gs_sync_events insert failed:', error.message);
    }
  } catch (err) {
    console.error('[push-client-settings-to-sheet] writeGsSyncFailed exception:', err);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
