/**
 * impersonationSession — helpers for the true-session-swap impersonation flow.
 *
 * Piece #3 of the impersonation-fidelity series. The previous "fake"
 * impersonation kept the admin's JWT and just swapped `user.email` in
 * React state. This module supports the real version where AuthContext
 * actually swaps the live Supabase session to the target user, so RLS
 * / auth.email() / edge functions all see the client.
 *
 * Three storage slots live in **sessionStorage** (intentionally NOT
 * localStorage — closing the tab must end impersonation cleanly so the
 * admin's tokens never linger on disk):
 *
 *   - `STASH_KEY` — the admin's pre-swap Supabase session
 *     ({access_token, refresh_token}). On Exit we call
 *     supabase.auth.setSession() with this to restore the admin's JWT.
 *
 *   - `ADMIN_CACHE_KEY` — a copy of the admin's AUTH_CACHE_KEY entry
 *     from localStorage. handleSession's normal path would overwrite
 *     AUTH_CACHE_KEY with the impersonated user's profile on swap;
 *     keeping this snapshot lets us restore the admin's cached profile
 *     on Exit without a fresh GAS roundtrip.
 *
 *   - `FLAG_KEY` — `{ adminEmail, targetEmail, impersonationId }`. Set
 *     while impersonation is active. On page refresh, AuthContext reads
 *     this flag and the Supabase-auto-restored target session and
 *     stays impersonating (banner + Exit button still rendered). If the
 *     flag is gone but the stash is somehow present, we know we hit a
 *     corruption case and fail safely to login.
 *
 * The edge function `impersonate-mint-session` is the security
 * boundary. The admin role check happens there, not here — this client
 * code can be lied to but the edge function cannot.
 */
import { supabase } from './supabase';

const STASH_KEY       = 'stride_imp_admin_session';
const ADMIN_CACHE_KEY = 'stride_imp_admin_cache';
const FLAG_KEY        = 'stride_imp_active';

export interface AdminSessionStash {
  access_token: string;
  refresh_token: string;
}

export interface ImpersonationFlag {
  adminEmail: string;
  targetEmail: string;
  impersonationId: string;
  startedAt: string;
}

// ─── Stash helpers (sessionStorage; cleared on tab close) ────────────────

export function stashAdminSession(tokens: AdminSessionStash): void {
  try {
    sessionStorage.setItem(STASH_KEY, JSON.stringify(tokens));
  } catch (err) {
    console.warn('[impersonation] failed to stash admin session:', err);
  }
}

export function getStashedAdminSession(): AdminSessionStash | null {
  try {
    const raw = sessionStorage.getItem(STASH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.access_token !== 'string' || typeof parsed?.refresh_token !== 'string') {
      return null;
    }
    return parsed as AdminSessionStash;
  } catch {
    return null;
  }
}

export function clearAdminStash(): void {
  try {
    sessionStorage.removeItem(STASH_KEY);
    sessionStorage.removeItem(ADMIN_CACHE_KEY);
  } catch { /* ignored */ }
}

export function stashAdminCache(authCacheRaw: string | null): void {
  if (authCacheRaw === null) return;
  try {
    sessionStorage.setItem(ADMIN_CACHE_KEY, authCacheRaw);
  } catch (err) {
    console.warn('[impersonation] failed to stash admin auth cache:', err);
  }
}

export function getStashedAdminCache(): string | null {
  try {
    return sessionStorage.getItem(ADMIN_CACHE_KEY);
  } catch {
    return null;
  }
}

// ─── Active-impersonation flag ───────────────────────────────────────────

export function setImpersonationFlag(flag: ImpersonationFlag): void {
  try {
    sessionStorage.setItem(FLAG_KEY, JSON.stringify(flag));
  } catch (err) {
    console.warn('[impersonation] failed to set flag:', err);
  }
}

export function getImpersonationFlag(): ImpersonationFlag | null {
  try {
    const raw = sessionStorage.getItem(FLAG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      typeof parsed?.adminEmail !== 'string' ||
      typeof parsed?.targetEmail !== 'string' ||
      typeof parsed?.impersonationId !== 'string'
    ) {
      return null;
    }
    return parsed as ImpersonationFlag;
  } catch {
    return null;
  }
}

export function clearImpersonationFlag(): void {
  try { sessionStorage.removeItem(FLAG_KEY); } catch { /* ignored */ }
}

// ─── Edge-function calls ─────────────────────────────────────────────────

interface MintStartResponse {
  ok: true;
  token: string;
  email: string;
  impersonationId: string;
}
interface EdgeError { ok: false; error: string }

/**
 * Call the admin-only mint edge function. Caller must already hold the
 * admin's Supabase session (this fetches the bearer from the current
 * supabase client).
 */
export async function startImpersonationEdge(
  targetEmail: string,
  reason?: string,
): Promise<MintStartResponse | EdgeError> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return { ok: false, error: 'No active session' };
  }
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/impersonate-mint-session`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ action: 'start', targetEmail, reason }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.ok) {
      return { ok: false, error: (data?.error as string) || `HTTP ${resp.status}` };
    }
    return data as MintStartResponse;
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'Network error' };
  }
}

/**
 * Stamp ended_at on the active impersonation_log row. Fire-and-forget
 * from the caller's perspective — the audit close should not block the
 * session swap-back, and a failure is logged but not surfaced.
 *
 * Must be called AFTER setSession swaps back to the admin's JWT,
 * because the edge function's role check requires admin.
 */
export async function endImpersonationEdge(targetEmail: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) return;
  const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/impersonate-mint-session`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ action: 'end', targetEmail }),
    });
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      console.warn('[impersonation] end-edge failed:', resp.status, txt.slice(0, 200));
    }
  } catch (err) {
    console.warn('[impersonation] end-edge exception:', (err as Error).message);
  }
}
