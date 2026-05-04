/**
 * intake-resign-reminder-cron — weekly re-sign nudge.
 *
 * Per Decision #35: every client whose last_intake_body_sha256 doesn't
 * match the current T&C body's hash receives an INTAKE_RESIGN_REMINDER
 * email once per week until they re-sign. No max attempts. The cron
 * just keeps going until they do it.
 *
 * Eligibility filter:
 *   • clients.active = true
 *   • last_intake_body_sha256 IS DISTINCT FROM <current_hash>
 *     (NULL counts as a mismatch — they've never signed at all)
 *   • last_intake_reminder_at IS NULL OR < now() - interval '7 days'
 *   • intake_reminder_snooze_until IS NULL OR < CURRENT_DATE
 *
 * For each eligible client, we look up their most recent active link
 * in client_intake_links and use its link_id. If they don't have one
 * yet, we skip with a warning (staff hasn't sent them an initial
 * invitation; they'll get a link via "Resend Intake" first).
 *
 * Stamps last_intake_reminder_at on every successful send so the same
 * client doesn't get pinged again for 7 days.
 *
 * This function is invoked by pg_cron daily; the per-client 7-day
 * filter does the actual rate-limiting. Daily fire = max 1 reminder
 * per client per week.
 *
 * Request:  POST {} (no body required — cron-triggered)
 * Response: { success: true, eligible: N, sent: N, skipped: N, errors: [] }
 *
 * Manual run from staff side: same endpoint, useful for ad-hoc
 * "send now" without waiting for the next cron tick.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const APP_BASE_URL = 'https://www.mystridehub.com/#/intake/';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceKey) {
      return json({ success: false, error: 'Server misconfigured' }, 500);
    }
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── 1. Compute current T&C body hash ──────────────────────────────────
    const { data: tcRow, error: tcErr } = await supabase
      .from('email_templates')
      .select('body')
      .eq('template_key', 'DOC_CLIENT_TC')
      .eq('active', true)
      .maybeSingle();
    if (tcErr || !tcRow) {
      return json({ success: false, error: `T&C template fetch failed: ${tcErr?.message || 'not found'}` }, 500);
    }
    const currentBody = String(tcRow.body || '');
    const currentHash = await sha256Hex(currentBody);

    // ── 2. Find eligible clients ──────────────────────────────────────────
    // PostgREST filters: we need OR-conditions for the reminder-recency
    // and snooze checks. PostgREST supports `or=()` query strings, but
    // the JS client is friendlier with separate calls + client-side filter.
    // 53 clients total — not worth the SQL complexity.
    const { data: candidates, error: candidatesErr } = await supabase
      .from('clients')
      .select('tenant_id, spreadsheet_id, name, email, contact_name, active, last_intake_body_sha256, last_intake_reminder_at, intake_reminder_snooze_until')
      .eq('active', true);
    if (candidatesErr) {
      return json({ success: false, error: `clients query failed: ${candidatesErr.message}` }, 500);
    }

    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;
    const todayDate = new Date().toISOString().slice(0, 10);  // YYYY-MM-DD

    const eligible = (candidates || []).filter(c => {
      // Hash mismatch (NULL counts as mismatch — never signed)
      if (c.last_intake_body_sha256 === currentHash) return false;
      // 7-day rate limit
      if (c.last_intake_reminder_at) {
        const lastMs = new Date(c.last_intake_reminder_at).getTime();
        if (lastMs > sevenDaysAgo) return false;
      }
      // Snooze
      if (c.intake_reminder_snooze_until && c.intake_reminder_snooze_until >= todayDate) return false;
      // Need an email to send to
      if (!c.email || !c.email.trim()) return false;
      return true;
    });

    // ── 3. Resolve intake links per eligible client ───────────────────────
    // One query batched for all of them to avoid N round-trips.
    const sheetIds = eligible.map(c => c.spreadsheet_id).filter(Boolean);
    let linkBySheetId: Record<string, string> = {};
    if (sheetIds.length > 0) {
      const { data: links } = await supabase
        .from('client_intake_links')
        .select('link_id, client_spreadsheet_id, created_at, active')
        .in('client_spreadsheet_id', sheetIds)
        .eq('active', true)
        .order('created_at', { ascending: false });
      // Most recent active link wins per sheet id
      for (const row of links || []) {
        const sid = String(row.client_spreadsheet_id || '');
        if (sid && !linkBySheetId[sid]) linkBySheetId[sid] = String(row.link_id);
      }
    }

    // ── 4. Send the reminder for each eligible client with a link ─────────
    let sent = 0;
    let skipped = 0;
    const errors: Array<{ client: string; reason: string }> = [];

    for (const c of eligible) {
      const linkId = linkBySheetId[c.spreadsheet_id || ''];
      if (!linkId) {
        skipped++;
        errors.push({ client: c.name || c.spreadsheet_id || '?', reason: 'no active intake link — staff needs to Resend Intake first' });
        continue;
      }

      const intakeUrl = `${APP_BASE_URL}${linkId}`;

      // Fire via send-email edge function (existing infrastructure).
      try {
        const sendResp = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            templateKey: 'INTAKE_RESIGN_REMINDER',
            to: c.email,
            tokens: {
              CONTACT_NAME: c.contact_name || c.name || 'there',
              BUSINESS_NAME: c.name || '',
              INTAKE_URL: intakeUrl,
            },
            idempotencyKey: `intake-resign-reminder:${c.spreadsheet_id}:${todayDate}`,
          }),
        });
        if (!sendResp.ok) {
          errors.push({ client: c.name || c.spreadsheet_id || '?', reason: `send-email HTTP ${sendResp.status}` });
          continue;
        }
        // Stamp last_intake_reminder_at so we don't ping again for 7 days.
        await supabase
          .from('clients')
          .update({ last_intake_reminder_at: new Date().toISOString() })
          .eq('spreadsheet_id', c.spreadsheet_id);
        sent++;
      } catch (e) {
        errors.push({ client: c.name || c.spreadsheet_id || '?', reason: e instanceof Error ? e.message : String(e) });
      }
    }

    return json({
      success: true,
      currentHash,
      total: candidates?.length || 0,
      eligible: eligible.length,
      sent,
      skipped,
      errors,
    });
  } catch (e) {
    console.error('[intake-resign-reminder-cron] unhandled error:', e);
    return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function json(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}
