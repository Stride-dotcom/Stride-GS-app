/**
 * impersonate-mint-session — admin-only "log in as another user" minter.
 *
 * Piece #3 of the impersonation-fidelity series. Previously, admin
 * "Impersonate" only swapped `user.email` in React state — the Supabase
 * session was still the admin's, so RLS / auth.email() / edge functions
 * all saw the admin and the codebase carried a `setSupabaseImpersonating`
 * cache-bypass workaround. This function lets the admin hold a REAL
 * Supabase session as the target user for the duration of impersonation,
 * so the app behaves exactly as the client would experience it.
 *
 * Security model:
 *   - JWT auth: caller's bearer token is verified via auth.getUser()
 *     against the anon client (NOT atob — that's how every other handler
 *     in this repo does it; see complete-task and the cancelRepair
 *     landmine).
 *   - Caller must have user_metadata.role === 'admin'. Staff cannot
 *     impersonate (and admins cannot impersonate themselves — guarded
 *     in the React client too, but redoubled here).
 *   - Target email must exist in the users mirror — admins can only
 *     impersonate real provisioned accounts.
 *   - The audit row is INSERTED before the magic link is minted. If the
 *     mint fails, the row is left in place (with ended_at=null) — that's
 *     by design, because an attempted-and-failed impersonation is itself
 *     auditable. The edge function returns 500 in that case and the
 *     React client never gets a usable token.
 *   - On 'end' action, we stamp ended_at on the most-recent open row for
 *     this admin → target pair. If no open row exists (e.g. page refresh
 *     during impersonation followed by a clean exit), this is a no-op
 *     success — the admin's session was already exited by the auth
 *     swap-back; we just couldn't find a row to close.
 *
 * Request:
 *   { action: 'start' | 'end',
 *     targetEmail: string,
 *     reason?: string                      // start only, free text
 *   }
 *
 * Response (start):
 *   { ok: true,
 *     token: string,                       // hashed_token from generateLink
 *     email: string,                       // echo, to call verifyOtp with
 *     impersonationId: string              // impersonation_log row id
 *   }
 *
 * Response (end):
 *   { ok: true, closedRowId: string | null }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const action: string = String(body.action ?? '').trim();
    const targetEmail: string = String(body.targetEmail ?? '').trim().toLowerCase();
    const reason: string | null = body.reason !== undefined && body.reason !== null
      ? String(body.reason).slice(0, 500)
      : null;

    if (action !== 'start' && action !== 'end') {
      return json({ ok: false, error: "action must be 'start' or 'end'" }, 400);
    }
    if (!targetEmail) {
      return json({ ok: false, error: 'targetEmail is required' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const anonKey     = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    if (!supabaseUrl || !serviceKey || !anonKey) {
      console.error('[impersonate-mint-session] missing env');
      return json({ ok: false, error: 'Server misconfigured' }, 500);
    }

    // ── Auth: verify the caller's JWT and require admin role ────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ ok: false, error: 'Authorization required' }, 401);
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const authClient = createClient(supabaseUrl, anonKey);
    const { data: userData, error: authErr } = await authClient.auth.getUser(token);
    if (authErr || !userData?.user?.email) {
      return json({ ok: false, error: 'Invalid token' }, 401);
    }
    const callerEmail = userData.user.email.toLowerCase();
    const callerRole = (userData.user.user_metadata as Record<string, unknown> | undefined)?.role;
    if (callerRole !== 'admin') {
      // Staff get 403 deliberately distinct from 401 (token is valid,
      // role is not). Useful for the React client to message the user.
      return json({ ok: false, error: 'Admin role required' }, 403);
    }
    if (callerEmail === targetEmail) {
      return json({ ok: false, error: 'You cannot impersonate yourself' }, 400);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    if (action === 'start') {
      // ── 1. Verify target user exists in our mirror ─────────────────
      // generateLink would silently succeed for ANY email (it creates
      // an auth user on demand otherwise), which is a footgun: admin
      // typos would mint sessions for brand-new orphan accounts. Gate
      // on the mirror so we can only impersonate provisioned users.
      const { data: mirrorRow, error: mirrorErr } = await supabase
        .from('cb_users')
        .select('email, role, active')
        .ilike('email', targetEmail)
        .maybeSingle();
      if (mirrorErr) {
        console.error('[impersonate-mint-session] mirror lookup failed:', mirrorErr);
        return json({ ok: false, error: 'User lookup failed' }, 500);
      }
      if (!mirrorRow) {
        return json({ ok: false, error: 'Target user not found' }, 404);
      }
      if (mirrorRow.active === false) {
        return json({ ok: false, error: 'Target user is inactive' }, 400);
      }

      // ── 2. Audit row FIRST (insert before mint) ────────────────────
      // If the mint fails, the row stays with ended_at=null. That is
      // a forensic feature — failed impersonation attempts must be
      // auditable too. A cleanup cron can close orphan rows by
      // matching against auth.sessions later.
      const userAgent = req.headers.get('user-agent') ?? null;
      const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || null;
      const { data: logRow, error: logErr } = await supabase
        .from('impersonation_log')
        .insert({
          admin_email:  callerEmail,
          target_email: targetEmail,
          user_agent:   userAgent,
          ip,
          reason,
        })
        .select('id')
        .single();
      if (logErr || !logRow) {
        console.error('[impersonate-mint-session] audit insert failed:', logErr);
        return json({ ok: false, error: 'Audit log write failed' }, 500);
      }

      // ── 3. Mint the magic link ─────────────────────────────────────
      // We don't need the redirect URL since the React client will
      // call verifyOtp() directly with the returned hashed_token —
      // but a placeholder is required by the API.
      const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
        type: 'magiclink',
        email: targetEmail,
        options: { redirectTo: 'https://www.mystridehub.com/' },
      });
      if (linkErr || !linkData?.properties?.hashed_token) {
        console.error('[impersonate-mint-session] generateLink failed:', linkErr);
        return json({ ok: false, error: 'Token mint failed' }, 500);
      }

      return json({
        ok: true,
        token: linkData.properties.hashed_token,
        email: targetEmail,
        impersonationId: logRow.id,
      });
    }

    // ── action === 'end' ──────────────────────────────────────────────
    // Stamp ended_at on the most-recent open row for this (admin, target)
    // pair. We accept the caller's claim of who they're closing by
    // requiring targetEmail in the body — RLS isn't doing the gating
    // here because we're using service_role; the JWT admin check above
    // is the security boundary.
    //
    // Subtle: by the time the React client calls 'end', it may have
    // ALREADY swapped its Supabase session back to the admin's tokens.
    // In that case the bearer above is the admin's token again, which
    // is fine — the auth check still passes. If the swap-back is what
    // failed and the client is calling 'end' while still holding the
    // target's JWT, the auth check fails on role !== admin. That's
    // intentional: a stuck-impersonating client can't auto-close its
    // own audit row from the impersonated identity.
    const { data: openRow, error: findErr } = await supabase
      .from('impersonation_log')
      .select('id')
      .eq('admin_email', callerEmail)
      .eq('target_email', targetEmail)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (findErr) {
      console.error('[impersonate-mint-session] open-row lookup failed:', findErr);
      return json({ ok: false, error: 'Audit lookup failed' }, 500);
    }
    if (!openRow) {
      // No open row — already closed elsewhere, or never started.
      // Treat as success; the client just wants confirmation that no
      // session is dangling.
      return json({ ok: true, closedRowId: null });
    }
    const { error: closeErr } = await supabase
      .from('impersonation_log')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', openRow.id);
    if (closeErr) {
      console.error('[impersonate-mint-session] close update failed:', closeErr);
      return json({ ok: false, error: 'Audit close failed' }, 500);
    }
    return json({ ok: true, closedRowId: openRow.id });
  } catch (err) {
    console.error('[impersonate-mint-session] uncaught:', err);
    return json({ ok: false, error: (err as Error).message || 'Internal error' }, 500);
  }
});
