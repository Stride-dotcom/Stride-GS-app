/**
 * send-email — Supabase Edge Function for transactional email via Resend.
 *
 * Replaces the GAS `MailApp` send path. Every transactional email the
 * app fires (welcome, intake invitation, task completion, repair quote,
 * order confirmation, etc.) goes through here.
 *
 * Request:  POST { templateKey, to, tokens?, ... }  see SendEmailBody
 * Response: { ok, id, resendEmailId, deduped? } | { ok: false, error }
 *
 * Required Edge Function secrets (Supabase Dashboard → Functions → Secrets):
 *   RESEND_API_KEY  — Resend "Sending access" API key (stride-gs-app-prod)
 *
 * Pipeline:
 *   1. Authenticate the caller (so we can attribute triggered_by).
 *   2. Idempotency check — if `idempotency_key` already has status='sent',
 *      short-circuit and return the existing send id.
 *   3. Fetch the template body + subject from `email_templates`.
 *   4. Token-replace `{{KEY}}` placeholders with the caller-supplied
 *      tokens map. Subject + body both get the substitutions.
 *   5. INSERT a `pending` row in `email_sends`.
 *   6. POST to Resend `/emails` with From, Reply-To, To, Subject, Html.
 *   7. UPDATE the `email_sends` row → 'sent' (with resend_email_id +
 *      sent_at) or 'failed' (with error_message).
 *
 * Sender / reply rules (Session 89):
 *   From:     "Stride Logistics" <notifications@mystridehub.com>  — verified
 *   Reply-To: whse@stridenw.com (default; auto-forwards to email@stridenw.com)
 *   The caller may override `replyTo` per-template if a more specific
 *   inbox is appropriate (e.g. quote follow-ups → quotes@…).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FROM = 'Stride Logistics <notifications@mystridehub.com>';
const DEFAULT_REPLY_TO = 'whse@stridenw.com';
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

interface SendEmailBody {
  /** Row in `email_templates` whose subject + body get used. */
  templateKey: string;
  /** Recipient address(es). String or array — both accepted, normalized to array. */
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  /** Override the default reply-to. */
  replyTo?: string;
  /** {{KEY}} → value substitutions applied to subject + body. */
  tokens?: Record<string, string | number | null | undefined>;
  /** Override the template's subject (rare — usually the template owns it). */
  subjectOverride?: string;
  /** Caller-supplied dedupe key. If a prior send with this key is
   *  status='sent', the function returns that send id without re-sending. */
  idempotencyKey?: string;
  /** For audit-trail filtering. */
  relatedEntityType?: string;
  relatedEntityId?: string;
  tenantId?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return jsonError('Method not allowed', 405);
  }

  let body: SendEmailBody;
  try {
    body = await req.json();
  } catch {
    return jsonError('Invalid JSON body', 400);
  }

  if (!body.templateKey || !body.to || (Array.isArray(body.to) && body.to.length === 0)) {
    return jsonError('templateKey and to are required', 400);
  }

  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    console.error('[send-email] RESEND_API_KEY not set');
    return jsonError('Server misconfigured — missing RESEND_API_KEY', 500);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // ── Identify the caller for audit attribution ───────────────────────
  // The auth header carries a user JWT (passed through by the Supabase
  // client). We resolve it via a separate user-context client so RLS
  // doesn't apply to our service-role writes below.
  let triggeredBy: string | null = null;
  let triggeredByEmail: string | null = null;
  const authHeader = req.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const userClient = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } },
      );
      const { data: { user } } = await userClient.auth.getUser();
      triggeredBy = user?.id ?? null;
      triggeredByEmail = user?.email ?? null;
    } catch (err) {
      console.warn('[send-email] failed to resolve caller from JWT:', err);
    }
  }

  // ── Idempotency short-circuit ──────────────────────────────────────
  if (body.idempotencyKey) {
    const { data: existing } = await supabase
      .from('email_sends')
      .select('id, status, resend_email_id')
      .eq('idempotency_key', body.idempotencyKey)
      .maybeSingle();
    if (existing && existing.status === 'sent') {
      return jsonOk({
        id: existing.id,
        resendEmailId: existing.resend_email_id,
        deduped: true,
      });
    }
  }

  // ── Fetch template ──────────────────────────────────────────────────
  const { data: template, error: tplErr } = await supabase
    .from('email_templates')
    .select('subject, body')
    .eq('template_key', body.templateKey)
    .maybeSingle();
  if (tplErr) {
    return jsonError(`Template lookup failed: ${tplErr.message}`, 500);
  }
  if (!template) {
    return jsonError(`Template '${body.templateKey}' not found`, 404);
  }

  // ── Token replacement ──────────────────────────────────────────────
  // Simple {{KEY}} substitution. Whitespace inside the braces is allowed
  // ({{ KEY }}). Values coerce to string; null/undefined → empty.
  const tokens = body.tokens ?? {};
  let html = template.body ?? '';
  let subject = body.subjectOverride ?? (template.subject ?? '');
  for (const [key, val] of Object.entries(tokens)) {
    const safeVal = val == null ? '' : String(val);
    const pattern = new RegExp(`\\{\\{\\s*${escapeRegex(key)}\\s*\\}\\}`, 'g');
    html = html.replace(pattern, safeVal);
    subject = subject.replace(pattern, safeVal);
  }

  // ── Insert pending log row ──────────────────────────────────────────
  const toList = Array.isArray(body.to) ? body.to : [body.to];
  const replyTo = body.replyTo ?? DEFAULT_REPLY_TO;

  const { data: pending, error: insErr } = await supabase
    .from('email_sends')
    .insert({
      template_key: body.templateKey,
      to_emails: toList,
      cc_emails: body.cc ?? null,
      bcc_emails: body.bcc ?? null,
      reply_to: replyTo,
      subject,
      status: 'pending',
      tokens,
      idempotency_key: body.idempotencyKey ?? null,
      triggered_by: triggeredBy,
      triggered_by_email: triggeredByEmail,
      related_entity_type: body.relatedEntityType ?? null,
      related_entity_id: body.relatedEntityId ?? null,
      tenant_id: body.tenantId ?? null,
    })
    .select('id')
    .single();
  if (insErr || !pending) {
    return jsonError(`Failed to log email: ${insErr?.message ?? 'unknown'}`, 500);
  }

  // ── Send via Resend ────────────────────────────────────────────────
  let resendStatus: number;
  let resendBody: { id?: string; message?: string; name?: string };
  try {
    // Gmail and Outlook (Feb 2024+) require List-Unsubscribe headers on
    // bulk + automated mail or they'll bias toward spam. We always include:
    //   List-Unsubscribe: <mailto:unsubscribe@stridenw.com>
    //   List-Unsubscribe-Post: List-Unsubscribe=One-Click
    // The mailto target lands at a real Stride inbox; staff can manually
    // remove the recipient from any future automated sends. (If/when an
    // unsubscribe-management table lands, we'll switch to a URL form.)
    const resp = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: toList,
        cc: body.cc,
        bcc: body.bcc,
        reply_to: replyTo,
        subject,
        html,
        headers: {
          'List-Unsubscribe': '<mailto:unsubscribe@stridenw.com>',
          'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
        },
      }),
    });
    resendStatus = resp.status;
    resendBody = await resp.json();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase.from('email_sends')
      .update({ status: 'failed', error_message: `network: ${msg}` })
      .eq('id', pending.id);
    return jsonError(`Resend network error: ${msg}`, 502);
  }

  if (resendStatus < 200 || resendStatus >= 300 || !resendBody.id) {
    const errMsg = resendBody.message ?? `HTTP ${resendStatus}`;
    await supabase.from('email_sends')
      .update({ status: 'failed', error_message: JSON.stringify(resendBody).slice(0, 1000) })
      .eq('id', pending.id);
    return jsonError(`Resend error: ${errMsg}`, 502);
  }

  await supabase.from('email_sends')
    .update({
      status: 'sent',
      resend_email_id: resendBody.id,
      sent_at: new Date().toISOString(),
    })
    .eq('id', pending.id);

  return jsonOk({ id: pending.id, resendEmailId: resendBody.id });
});

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function jsonOk(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
function jsonError(message: string, status = 400): Response {
  return new Response(JSON.stringify({ ok: false, error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
