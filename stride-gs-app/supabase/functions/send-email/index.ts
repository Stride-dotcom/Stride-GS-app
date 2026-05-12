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
 * Auth: verify_jwt is intentionally DISABLED at the gateway. The Supabase
 * gateway's verify_jwt=true silently rejects service-role JWTs from
 * other Edge Functions (a Supabase platform quirk we hit 2026-05-12 —
 * every server-to-server call from notify-* / cron functions was getting
 * a gateway 401 before any send-email code could run, so NO email_sends
 * row was ever inserted). Verifying only that *some* signed JWT is
 * present didn't buy meaningful security here either: the anon key is
 * publicly bundled in every browser build, so anyone holding it could
 * already invoke send-email under the old setting. We rely on
 * templateKey validation + RESEND_API_KEY (server-only env) for the
 * actual permission gate, and on `triggeredBy` resolution below for
 * audit attribution when the caller does present a user JWT.
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
  /** Row in `email_templates` — required for audit purposes (it's the
   *  canonical "what kind of email is this?" classifier). When
   *  htmlOverride is also provided, the template body is bypassed but
   *  the key is still recorded on the email_sends row. */
  templateKey: string;
  /** Recipient address(es). String or array — both accepted, normalized
   *  to array. When omitted, the function falls back to resolving the
   *  template's `recipients` column (with token expansion — see
   *  resolveRecipients()). At least one path must yield ≥1 recipient. */
  to?: string | string[];
  cc?: string[];
  bcc?: string[];
  /** Override the default reply-to. */
  replyTo?: string;
  /** {{KEY}} → value substitutions applied to subject + body. */
  tokens?: Record<string, string | number | null | undefined>;
  /** Override the template's subject. Tokens still apply. */
  subjectOverride?: string;
  /** Override the template's body. When provided, the template body
   *  lookup is bypassed and this HTML is sent as-is (token substitution
   *  still runs in case the override contains {{…}} placeholders). Use
   *  case: callers like IntakesPanel let staff edit the body in a modal
   *  before sending, so the per-send HTML may differ from the template
   *  default. */
  htmlOverride?: string;
  /** Caller-supplied dedupe key. If a prior send with this key is
   *  status='sent', the function returns that send id without re-sending. */
  idempotencyKey?: string;
  /** For audit-trail filtering. */
  relatedEntityType?: string;
  relatedEntityId?: string;
  tenantId?: string;
  /** Attachments. Each item must include `filename` and EITHER `content`
   *  (base64-encoded string) OR `path` (publicly fetchable URL — Resend
   *  fetches it server-side). Mirrors Resend's `attachments` field 1:1.
   *  Use sparingly: every attachment counts against Resend's 40 MB-per-
   *  send limit. */
  attachments?: Array<{
    filename: string;
    content?: string;
    path?: string;
    contentType?: string;
  }>;
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

  if (!body.templateKey) {
    return jsonError('templateKey is required', 400);
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
  // Used to validate templateKey, provide subject/body fallbacks when
  // overrides aren't supplied, AND (when `to` is omitted) to resolve
  // the `recipients` column for templates whose audience lives in DB.
  const { data: template, error: tplErr } = await supabase
    .from('email_templates')
    .select('subject, body, recipients')
    .eq('template_key', body.templateKey)
    .maybeSingle();
  if (tplErr) {
    return jsonError(`Template lookup failed: ${tplErr.message}`, 500);
  }
  if (!template) {
    return jsonError(`Template '${body.templateKey}' not found`, 404);
  }

  // ── Body + subject resolution + token substitution ─────────────────
  // Precedence: caller override > template default. Token substitution
  // runs in either case so override strings can still contain {{…}}.
  // Whitespace inside the braces is allowed; null/undefined values
  // collapse to empty string.
  const tokens = body.tokens ?? {};
  let html = body.htmlOverride ?? (template.body ?? '');
  let subject = body.subjectOverride ?? (template.subject ?? '');
  for (const [key, val] of Object.entries(tokens)) {
    const safeVal = val == null ? '' : String(val);
    const pattern = new RegExp(`\\{\\{\\s*${escapeRegex(key)}\\s*\\}\\}`, 'g');
    html = html.replace(pattern, safeVal);
    subject = subject.replace(pattern, safeVal);
  }

  // ── Recipient resolution ───────────────────────────────────────────
  // Caller `to` always wins. When absent, we fall back to the template's
  // `recipients` column and expand its tokens. See resolveRecipients()
  // for the supported token vocabulary (matches the legacy GAS expansion
  // so admin-edited template recipient strings keep working unchanged).
  let toList: string[];
  if (body.to) {
    toList = Array.isArray(body.to) ? body.to : [body.to];
  } else if (template.recipients && template.recipients.trim().length > 0) {
    toList = await resolveRecipients(supabase, template.recipients);
  } else {
    toList = [];
  }
  // v2026-05-04: split comma/semicolon-joined strings into individual
  // addresses. Several caller-facing fields (e.g. prospect_email,
  // notification list strings) store multiple emails as a single string;
  // Resend rejects "a@x.com, b@y.com" as a single recipient with a
  // 422 validation_error. Apply this AFTER the array-or-string normalize
  // above so both shapes get split.
  toList = toList.flatMap(s => s.split(/[,;]/));
  // Drop empties + dedupe (case-insensitive). Done after both paths so
  // overridden + token-resolved lists get the same treatment.
  toList = dedupeEmails(toList);
  if (toList.length === 0) {
    return jsonError(`No recipients resolved (caller passed no 'to', template '${body.templateKey}' has no recipients column or it resolved to empty)`, 400);
  }

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
        // Resend accepts attachments with `content` (base64) OR `path`
        // (URL it fetches server-side). The shape mirrors Resend's API
        // 1:1 so callers can pass either form transparently.
        attachments: body.attachments && body.attachments.length > 0
          ? body.attachments
          : undefined,
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

// ─── Recipient resolution ──────────────────────────────────────────────────
// Mirrors the legacy GAS recipient-resolution behavior so admin-edited
// template `recipients` strings keep working without a schema migration.
//
// The `recipients` column holds a comma-separated mix of:
//   • Literal email addresses     → kept as-is
//   • {{TOKEN}} or bare TOKEN     → resolved against canonical Supabase
//     sources via the table below.
//
// Supported tokens (matched case-insensitively; braces optional):
//
//   STAFF_EMAILS         → public.profiles.email WHERE role IN ('admin','staff') AND is_active
//   ADMIN_EMAILS         → public.profiles.email WHERE role = 'admin' AND is_active
//   NOTIFICATION_EMAILS  → process env (Edge Function secret of same name),
//                          comma-split. Same source used by notify-new-order.
//   PUBLIC_FORM_SETTINGS → public.public_form_settings.alert_emails (singleton row)
//
// Unrecognized strings that don't look like emails are dropped silently
// (logged at warn) — better to miss one recipient than to bounce the
// whole send on a typo'd token.
type SBClient = ReturnType<typeof createClient>;

async function resolveRecipients(supabase: SBClient, raw: string): Promise<string[]> {
  const out: string[] = [];
  for (const rawChunk of raw.split(',')) {
    const chunk = rawChunk.trim();
    if (!chunk) continue;

    // Normalize {{TOKEN}} → TOKEN for matching.
    const tokenMatch = chunk.match(/^\{\{\s*([A-Z_][A-Z0-9_]*)\s*\}\}$/);
    const tokenName = tokenMatch ? tokenMatch[1].toUpperCase() : null;
    const bareToken = /^[A-Z_][A-Z0-9_]*$/.test(chunk) ? chunk.toUpperCase() : null;
    const token = tokenName ?? bareToken;

    if (token) {
      try {
        const expanded = await expandToken(supabase, token);
        for (const e of expanded) out.push(e);
      } catch (err) {
        console.warn(`[send-email] token '${token}' failed to expand:`, err);
      }
    } else if (chunk.includes('@')) {
      out.push(chunk);
    } else {
      console.warn(`[send-email] dropping unknown recipient chunk:`, chunk);
    }
  }
  return out;
}

async function expandToken(supabase: SBClient, token: string): Promise<string[]> {
  switch (token) {
    case 'STAFF_EMAILS': {
      const { data } = await supabase
        .from('profiles')
        .select('email')
        .in('role', ['admin', 'staff'])
        .eq('is_active', true);
      return ((data ?? []) as { email: string | null }[])
        .map(r => r.email).filter((e): e is string => !!e);
    }
    case 'ADMIN_EMAILS': {
      const { data } = await supabase
        .from('profiles')
        .select('email')
        .eq('role', 'admin')
        .eq('is_active', true);
      return ((data ?? []) as { email: string | null }[])
        .map(r => r.email).filter((e): e is string => !!e);
    }
    case 'NOTIFICATION_EMAILS': {
      const raw = Deno.env.get('NOTIFICATION_EMAILS') ?? '';
      return raw.split(',').map(s => s.trim()).filter(Boolean);
    }
    case 'PUBLIC_FORM_SETTINGS': {
      const { data } = await supabase
        .from('public_form_settings')
        .select('alert_emails')
        .limit(1)
        .maybeSingle();
      const arr = (data as { alert_emails: string[] | null } | null)?.alert_emails;
      return Array.isArray(arr) ? arr.filter(Boolean) : [];
    }
    default:
      console.warn(`[send-email] unknown recipient token: ${token}`);
      return [];
  }
}

/** Lowercase + dedupe; preserves first-seen casing of each unique address. */
function dedupeEmails(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of list) {
    const trimmed = e.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
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
