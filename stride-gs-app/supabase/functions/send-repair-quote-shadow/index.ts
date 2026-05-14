/**
 * send-repair-quote-shadow — [MIGRATION-P3] shadow for `sendRepairQuote`.
 *
 * Compare target: `entity_audit_log.changes` for action='status_change'.
 * GAS at StrideAPI.gs:7757 logs the fixed shape:
 *
 *   api_auditLog_("repair", repairId, tenantId, "status_change",
 *                 { status: { old: "Pending Quote", new: "Quote Sent" } },
 *                 callerEmail);
 *
 * Shadow returns the same dict regardless of payload contents. The
 * source-status check ('Pending Quote') happens inside the primary
 * handler — shadow doesn't replicate that gate (it doesn't have DB
 * access), but a payload that would have errored in GAS produces no
 * audit-log row at all, so there's no parity mismatch.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

interface SendRepairQuotePayload {
  repairId?: string;
  requestId?: string;
  [k: string]: unknown;
}

interface SendRepairQuoteShadowResult {
  ok: boolean;
  changes?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
}

export function runSendRepairQuoteShadow(payload: SendRepairQuotePayload): SendRepairQuoteShadowResult {
  const repairId = String(payload?.repairId ?? '').trim();
  if (!repairId) return { ok: false, error: 'repairId is required', errorCode: 'INVALID_PARAMS' };
  return {
    ok: true,
    changes: { status: { old: 'Pending Quote', new: 'Quote Sent' } },
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'POST required' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  let payload: SendRepairQuotePayload;
  try { payload = await req.json(); }
  catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const result = runSendRepairQuoteShadow(payload);
  return new Response(JSON.stringify(result), {
    status: result.ok ? 200 : 400,
    headers: { 'Content-Type': 'application/json' },
  });
});
