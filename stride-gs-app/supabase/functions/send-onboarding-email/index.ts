/**
 * send-onboarding-email — Supabase Edge Function
 *
 * Per-user resend of the ONBOARDING_EMAIL template (the
 * "Getting Started" email shown to a user after activation). Replaces
 * the GAS `sendOnboardingToUsers` handler — looks up each user's
 * client mapping in `cb_users`, resolves the client name +
 * spreadsheet from `clients`, then hands off to `send-email` for the
 * actual Resend POST.
 *
 * No tempPassword path: the React caller (Settings → Users → Resend
 * Onboarding) is a credential-free resend. Activation flows that DO
 * issue a fresh password still call the GAS handler directly (it
 * generates the temp password + applies the styled credentials block
 * fallback) and aren't migrated by this function.
 *
 * Request:  POST { userEmails: string[] }
 * Response: { success: true, sent: number, failed: number, total: number,
 *             results: Array<{ email, ok, sentTo?, role?, reason?, error? }> }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const APP_URL = 'https://www.mystridehub.com/#';
const LOGIN_URL = 'https://www.mystridehub.com';

interface ResultRow {
  email: string;
  ok: boolean;
  sentTo?: string;
  role?: string;
  reason?: string;
  error?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const userEmails: string[] = Array.isArray(body.userEmails) ? body.userEmails : [];
    if (userEmails.length === 0) {
      return json({ success: false, error: 'userEmails array is required and must not be empty' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !serviceKey) {
      console.error('[send-onboarding-email] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
      return json({ success: false, error: 'Server misconfigured' }, 500);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const results: ResultRow[] = [];
    let sent = 0;
    let failed = 0;

    for (const rawEmail of userEmails) {
      const targetEmail = String(rawEmail || '').trim().toLowerCase();
      if (!targetEmail) {
        results.push({ email: String(rawEmail), ok: false, reason: 'blank_email' });
        failed++;
        continue;
      }

      // ── Resolve user → first client_sheet_id (CSV-joined for multi-client) ──
      const { data: userRow } = await supabase
        .from('cb_users')
        .select('email, role, client_sheet_id')
        .ilike('email', targetEmail)
        .maybeSingle();

      if (!userRow) {
        results.push({ email: targetEmail, ok: false, reason: 'user_not_found' });
        failed++;
        continue;
      }

      const userRole = String((userRow as { role: string | null }).role || '').trim().toLowerCase();
      const sheetIdsRaw = String((userRow as { client_sheet_id: string | null }).client_sheet_id || '').trim();
      const firstSheetId = sheetIdsRaw.split(',').map(s => s.trim()).filter(Boolean)[0];
      if (!firstSheetId) {
        results.push({ email: targetEmail, ok: false, reason: 'no_client_sheet_id' });
        failed++;
        continue;
      }

      // ── Resolve client by spreadsheet_id ────────────────────────────────────
      const { data: clientRow } = await supabase
        .from('clients')
        .select('name, email, spreadsheet_id, tenant_id')
        .eq('spreadsheet_id', firstSheetId)
        .maybeSingle();

      const clientName = (clientRow as { name?: string } | null)?.name?.trim() || 'Valued Client';
      const clientEmail = (clientRow as { email?: string } | null)?.email?.trim() || '';
      const tenantId = (clientRow as { tenant_id?: string } | null)?.tenant_id || undefined;
      const spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${firstSheetId}/edit`;

      // ── Hand off to send-email ──────────────────────────────────────────────
      const sendRes = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'apikey': serviceKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          templateKey: 'ONBOARDING_EMAIL',
          to: [targetEmail],
          tokens: {
            CLIENT_NAME: clientName,
            CLIENT_EMAIL: clientEmail,
            SPREADSHEET_URL: spreadsheetUrl,
            LOGIN_URL,
            LOGIN_EMAIL: targetEmail,
            TEMP_PASSWORD: '',
            APP_URL,
          },
          relatedEntityType: 'cb_user',
          relatedEntityId: targetEmail,
          tenantId,
        }),
      });
      const sendJson = await sendRes.json().catch(() => ({})) as Record<string, unknown>;

      if (sendJson.ok) {
        results.push({ email: targetEmail, ok: true, sentTo: targetEmail, role: userRole });
        sent++;
      } else {
        results.push({
          email: targetEmail,
          ok: false,
          reason: 'send_failed',
          error: String(sendJson.error ?? 'unknown'),
        });
        failed++;
      }
    }

    return json({ success: true, sent, failed, total: userEmails.length, results });

  } catch (err) {
    console.error('[send-onboarding-email] Unexpected error:', err);
    return json({ success: false, error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
