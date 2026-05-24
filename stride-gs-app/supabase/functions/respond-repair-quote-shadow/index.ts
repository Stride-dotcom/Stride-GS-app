/**
 * respond-repair-quote-shadow — [MIGRATION-P3] shadow for
 * `respondToRepairQuote`.
 *
 * Compare target: `entity_audit_log.changes` for action='status_change'.
 * GAS at StrideAPI.gs:7767 logs:
 *
 *   api_auditLog_("repair", repairId, tenantId, "status_change",
 *     { decision: payload.decision || "",
 *       status: { new: payload.decision === "Approve" ? "Approved" : "Declined" } },
 *     callerEmail);
 *
 * Shape varies by decision input. The shadow mirrors that 1:1.
 */

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

interface RespondQuotePayload {
  repairId?: string;
  decision?: string;        // 'Approve' | 'Decline'
  requestId?: string;
  [k: string]: unknown;
}

interface RespondQuoteShadowResult {
  ok: boolean;
  changes?: Record<string, unknown>;
  error?: string;
  errorCode?: string;
}

export function runRespondQuoteShadow(payload: RespondQuotePayload): RespondQuoteShadowResult {
  const repairId = String(payload?.repairId ?? '').trim();
  if (!repairId) return { ok: false, error: 'repairId is required', errorCode: 'INVALID_PARAMS' };
  const decision = String(payload?.decision ?? '').trim();
  if (decision !== 'Approve' && decision !== 'Decline') {
    return { ok: false, error: "decision must be 'Approve' or 'Decline'", errorCode: 'INVALID_PARAMS' };
  }
  const newStatus = decision === 'Approve' ? 'Approved' : 'Declined';
  return {
    ok: true,
    changes: { decision, status: { new: newStatus } },
  };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'POST required' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  let payload: RespondQuotePayload;
  try { payload = await req.json(); }
  catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: `Invalid JSON body: ${e instanceof Error ? e.message : String(e)}` }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }
  const result = runRespondQuoteShadow(payload);
  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
