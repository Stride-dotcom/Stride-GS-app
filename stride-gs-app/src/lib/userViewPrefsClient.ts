/**
 * userViewPrefsClient — Supabase-backed table-view-preference store.
 *
 * Read/upsert for `public.user_view_prefs` rows keyed by
 * (user_email, page_key). Used by useTablePreferences to persist column
 * visibility / sort / order / status-chip selection across devices and
 * across impersonation sessions.
 *
 * RLS policy (see migration 20260520180000_user_view_prefs.sql):
 *   - Self: `user_email = auth.email()` for SELECT / INSERT / UPDATE / DELETE
 *   - Admin/staff: SELECT-only on any row (so impersonation can read the
 *     impersonated user's prefs while still carrying the admin's JWT).
 *
 * Writes are best-effort and fail silently — the localStorage cache in the
 * caller is the durability backstop and a transient Supabase outage just
 * means the change persists locally until the next successful flush.
 *
 * Reads return `null` when no row exists yet (the caller should then fall
 * back to localStorage / defaults), and an empty object `{}` when the row
 * exists with no prefs set (treated as "explicitly nothing", different from
 * "never saved").
 */
import { supabase } from './supabase';

export interface UserViewPrefsRow {
  user_email: string;
  page_key: string;
  prefs: Record<string, unknown>;
  updated_at: string;
}

/**
 * Read this user's prefs for a single page. Returns null when no row
 * exists (first time the user has opened this page) — the caller should
 * fall back to the local cache or to defaults.
 *
 * Errors are logged and swallowed; we return null so the caller treats
 * "unreachable Supabase" the same as "no row yet" (falls back to local).
 * Don't make table loading depend on Supabase availability.
 */
export async function fetchUserViewPrefs(
  userEmail: string,
  pageKey: string,
): Promise<Record<string, unknown> | null> {
  if (!userEmail) return null;
  try {
    const { data, error } = await supabase
      .from('user_view_prefs')
      .select('prefs')
      .eq('user_email', userEmail)
      .eq('page_key', pageKey)
      .maybeSingle();
    if (error) {
      console.warn('[userViewPrefs] fetch error:', error.message);
      return null;
    }
    if (!data) return null;
    const prefs = (data as { prefs?: unknown }).prefs;
    return prefs && typeof prefs === 'object' ? (prefs as Record<string, unknown>) : {};
  } catch (err) {
    console.warn('[userViewPrefs] fetch exception:', err);
    return null;
  }
}

/**
 * Upsert this user's prefs for one page. Fire-and-forget — the caller
 * keeps the canonical state in its own React state + localStorage; a
 * failed write is logged but never thrown, because UI responsiveness
 * must not depend on network availability.
 *
 * Caller is responsible for debouncing — see scheduleUpsertUserViewPrefs.
 */
export async function upsertUserViewPrefs(
  userEmail: string,
  pageKey: string,
  prefs: Record<string, unknown>,
): Promise<void> {
  if (!userEmail) return;
  try {
    const { error } = await supabase
      .from('user_view_prefs')
      .upsert(
        { user_email: userEmail, page_key: pageKey, prefs },
        { onConflict: 'user_email,page_key' },
      );
    if (error) {
      console.warn('[userViewPrefs] upsert error:', error.message);
    }
  } catch (err) {
    console.warn('[userViewPrefs] upsert exception:', err);
  }
}

/**
 * Debounced upsert helper. Each (userEmail, pageKey) pair gets its own
 * timer so two pages writing concurrently don't cancel each other; only
 * a second write to the SAME page within the debounce window collapses
 * into one flush.
 *
 * The 250ms default matches the cadence of typical column-drag /
 * resize / sort-toggle interactions — short enough that closing a tab
 * mid-drag still flushes before unload, long enough that a sustained
 * drag isn't a 60Hz write stream.
 */
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingPayloads = new Map<string, Record<string, unknown>>();

function timerKey(userEmail: string, pageKey: string): string {
  return `${userEmail}::${pageKey}`;
}

export function scheduleUpsertUserViewPrefs(
  userEmail: string,
  pageKey: string,
  prefs: Record<string, unknown>,
  delayMs = 250,
): void {
  if (!userEmail) return;
  const k = timerKey(userEmail, pageKey);
  // Latest payload wins — overwrites any payload waiting in the queue.
  pendingPayloads.set(k, prefs);
  const existing = pendingTimers.get(k);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    const payload = pendingPayloads.get(k);
    pendingTimers.delete(k);
    pendingPayloads.delete(k);
    if (!payload) return;
    void upsertUserViewPrefs(userEmail, pageKey, payload);
  }, delayMs);
  pendingTimers.set(k, timer);
}

/**
 * Force-flush any pending debounced writes. Call from `beforeunload` so
 * an in-flight drag-then-close doesn't lose the last move; also useful
 * in tests.
 */
export function flushPendingUserViewPrefs(): void {
  for (const [k, timer] of pendingTimers) {
    clearTimeout(timer);
    const [userEmail, pageKey] = k.split('::');
    const payload = pendingPayloads.get(k);
    pendingTimers.delete(k);
    pendingPayloads.delete(k);
    if (payload && userEmail && pageKey) {
      void upsertUserViewPrefs(userEmail, pageKey, payload);
    }
  }
}
