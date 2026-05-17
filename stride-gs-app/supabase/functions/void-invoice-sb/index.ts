/**
 * void-invoice-sb — [MIGRATION-P4a] SHADOW/parity handler for `voidInvoice`.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md. Ports the COMPUTE half
 * of GAS `handleVoidInvoice_` (StrideAPI.gs:13675) so the parity harness can
 * diff "which rows WOULD flip to Void" against the GAS-produced void.
 *
 * ┌─────────────────────────────────────────────────────────────────────┐
 * │ SHADOW MODE — ZERO mutations / external side effects. Does NOT:      │
 * │   • flip any client Billing_Ledger / public.billing row to Void     │
 * │   • mirror the void onto CB Consolidated_Ledger                     │
 * │   • delete the invoice_tracking row                                 │
 * │ The service-role client is used for READS ONLY.                     │
 * │ active_backend stays 'gas'; no production handler is cut over.       │
 * └─────────────────────────────────────────────────────────────────────┘
 *
 * Parity contract (MIG-007 layer 1 — per-call live shadow): the caller
 * diffs the returned `parity` object against the GAS `handleVoidInvoice_`
 * JSON response for the same input. GAS keys the void off the per-tenant
 * Billing_Ledger sheet; the shadow keys off the public.billing mirror
 * (tenant_id + invoice_no). `cbRowsDeleted` is a GAS-sheet-only side
 * effect (CB Consolidated_Ledger) and is EXCLUDED from the
 * parity-meaningful surface — the SB world has a single billing table
 * (MIG-005), so there is no second ledger to count.
 *
 * GAS landmine carried through (CLAUDE.md): a void must never silently
 * leave an Invoiced row stranded. The parity surface enumerates every
 * ledger_row_id that would flip so a comparator can prove the SB void
 * touches the exact same row-set GAS did.
 *
 * Auth: verified caller email via supabase.auth.getUser.
 *
 * Request:  POST { tenantId | clientSheetId | sourceSheetId, invoiceNo, reason? }
 * Response: { ok, shadow:true, parity:{...}, error?, errorCode? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BillingRow {
  ledger_row_id: string | null;
  status: string | null;
  invoice_no: string | null;
  item_notes: string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const tenantId: string = String(
      body.tenantId ?? body.clientSheetId ?? body.sourceSheetId ?? '',
    ).trim();
    const invoiceNo: string = String(body.invoiceNo ?? '').trim();
    const reason: string = String(body.reason ?? '').trim();

    // Mirror handleVoidInvoice_ validation order.
    if (!tenantId) return err('clientSheetId is required', 'MISSING_PARAM');
    if (!invoiceNo) return err('invoiceNo is required', 'INVALID_PARAMS');

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (!supabaseUrl || !serviceKey || !anonKey) {
      return err('Server misconfigured', 'CONFIG_ERROR', 500);
    }

    const authHeader = req.headers.get('Authorization');
    let callerEmail = 'system';
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const authClient = createClient(supabaseUrl, anonKey);
      const { data: { user }, error: authErr } = await authClient.auth.getUser(token);
      if (!authErr && user?.email) callerEmail = user.email;
    }
    // READ-ONLY client. SHADOW MODE — no writes anywhere.
    const supabase = createClient(supabaseUrl, serviceKey);

    // GAS computes the note suffix from the *sheet* timezone (defaulting
    // to America/Los_Angeles). public.billing has no per-row tz, so use
    // PST — the default GAS itself falls back to.
    const noteSuffix = reason
      ? `Voided: ${reason}`
      : `Voided ${formatDatePST(new Date())}`;

    // All Billing_Ledger rows for this invoice (the SB mirror of the
    // per-tenant sheet GAS scans).
    const { data: rowsData, error: selErr } = await supabase
      .from('billing')
      .select('ledger_row_id, status, invoice_no, item_notes')
      .eq('tenant_id', tenantId)
      .eq('invoice_no', invoiceNo);

    if (selErr) {
      return err(`Failed to read billing rows: ${selErr.message}`, 'SERVER_ERROR', 500);
    }
    const rows = (rowsData ?? []) as BillingRow[];

    const wouldVoid: Array<{ ledgerRowId: string; currentStatus: string; wouldBeNote: string }> = [];
    let skippedAlreadyVoid = 0;

    for (const row of rows) {
      const rowStatus = String(row.status ?? '').trim();
      if (rowStatus === 'Void') { skippedAlreadyVoid++; continue; }
      const existing = String(row.item_notes ?? '').trim();
      wouldVoid.push({
        ledgerRowId: String(row.ledger_row_id ?? '').trim(),
        currentStatus: rowStatus,
        wouldBeNote: (existing ? existing + ' | ' : '') + noteSuffix,
      });
    }

    // Mirror handleVoidInvoice_'s NOT_FOUND when nothing matched at all.
    if (wouldVoid.length === 0 && skippedAlreadyVoid === 0) {
      return err(`No rows found for invoice ${invoiceNo}`, 'NOT_FOUND');
    }

    return ok({
      response: {
        success: true,
        invoiceNo,
        rowsVoided: wouldVoid.length,
        alreadyVoid: skippedAlreadyVoid,
        // cbRowsDeleted / cbCleanupError are GAS-sheet-only — excluded.
      },
      parity: {
        tenantId,
        invoiceNo,
        reason: reason || null,
        noteSuffix,
        rowsVoided: wouldVoid.length,
        alreadyVoid: skippedAlreadyVoid,
        matchedRowCount: rows.length,
        wouldVoidLedgerRowIds: wouldVoid.map(w => w.ledgerRowId).sort(),
        wouldVoid,
        callerEmail,
      },
      excludedFromParity: ['cbRowsDeleted', 'cbCleanupError'],
    });
  } catch (e) {
    console.error('[void-invoice-sb] Unexpected error:', e);
    return err(String(e), 'SERVER_ERROR', 500);
  }
});

// GAS: Utilities.formatDate(new Date(), tz, "yyyy-MM-dd"), tz defaults
// to America/Los_Angeles when the sheet tz is unset.
function formatDatePST(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function ok(parity: unknown): Response {
  return new Response(JSON.stringify({ ok: true, shadow: true, ...(parity as object) }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function err(error: string, errorCode: string, status = 400): Response {
  return new Response(JSON.stringify({ ok: false, shadow: true, error, errorCode }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
