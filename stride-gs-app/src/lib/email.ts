/**
 * email.ts — thin wrapper around the `send-email` Supabase Edge Function.
 *
 * Use this for every transactional email the app fires. The edge function
 * handles template lookup, token replacement, Resend send, and audit
 * logging via `email_sends`.
 *
 * Replaces every previous `apiFetch('sendXEmail', ...)` GAS round-trip.
 *
 * Sender + reply behavior is fixed at the edge function:
 *   From:     Stride Logistics <notifications@mystridehub.com>
 *   Reply-To: whse@stridenw.com  (override per-call via `replyTo`)
 *
 * Idempotency:
 *   Pass an `idempotencyKey` (e.g. `complete-task:INSP-12345-1` or
 *   `intake-invite:<email>:<token>`) and the edge function will dedupe
 *   retries within the lifetime of the row. Critical for any email
 *   triggered from a click that the user might double-tap.
 */
import { supabase } from './supabase';

export interface SendEmailParams {
  /** Row in `email_templates` whose subject + body get used. */
  templateKey: string;
  /** Recipient address(es). String or array. When omitted, the edge
   *  function resolves the template's `recipients` column instead —
   *  with token expansion (`{{STAFF_EMAILS}}`, `NOTIFICATION_EMAILS`,
   *  `PUBLIC_FORM_SETTINGS`, etc.). Use this for admin/staff broadcast
   *  templates where the audience lives in the template config rather
   *  than per-call. */
  to?: string | string[];
  cc?: string[];
  bcc?: string[];
  /** Override the default reply-to (whse@stridenw.com). */
  replyTo?: string;
  /** {{KEY}} → value substitutions for subject + body. */
  tokens?: Record<string, string | number | null | undefined>;
  /** Override the template's subject (rare — usually the template owns it). */
  subjectOverride?: string;
  /** Override the template's body. Use when the caller has pre-rendered
   *  the HTML (e.g. a modal that lets staff edit the body before send).
   *  The template body lookup is bypassed and this HTML is sent as-is;
   *  token substitution still runs in case it contains {{…}} placeholders. */
  htmlOverride?: string;
  /** Caller-supplied dedupe key. A prior 'sent' row with the same key
   *  short-circuits and returns its id without re-sending. */
  idempotencyKey?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  tenantId?: string;
  /** Attachments. Each item must include `filename` and EITHER `content`
   *  (base64-encoded string) OR `path` (publicly fetchable URL — Resend
   *  fetches it server-side). 40 MB total per-send limit. */
  attachments?: Array<{
    filename: string;
    content?: string;
    path?: string;
    contentType?: string;
  }>;
}

export interface SendEmailResult {
  ok: boolean;
  /** `email_sends.id` for the row this call produced (or matched on dedupe). */
  id?: string;
  /** Resend's email id — useful for cross-referencing in the Resend dashboard. */
  resendEmailId?: string;
  /** True if the call was deduped against an existing 'sent' row. */
  deduped?: boolean;
  /** Human-readable error message when ok=false. */
  error?: string;
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const { data, error } = await supabase.functions.invoke('send-email', {
    body: params,
  });
  if (error) {
    console.error('[sendEmail] edge function invocation failed:', error);
    return { ok: false, error: error.message ?? 'Edge function invocation failed' };
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'Empty response from send-email' };
  }
  const r = data as SendEmailResult;
  if (!r.ok) {
    console.warn('[sendEmail] send failed:', r.error);
  }
  return r;
}
