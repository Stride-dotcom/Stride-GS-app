/**
 * AuthContext — Phase 6 Authentication (Email/Password)
 *
 * Double-gate auth:
 *   Gate 1: Supabase (identity — email/password)
 *   Gate 2: CB Users tab (authorization — role, active status)
 *
 * Flow:
 *   1. Supabase session detected (getSession or onAuthStateChange)
 *   2. Call getUserByEmail API → get role + client info from CB Users tab
 *   3. If user not found or active=FALSE → accessDenied state
 *   4. If valid → set AuthUser, cache to localStorage, store callerEmail
 *
 * Password Reset:
 *   1. forgotPassword(email) → Supabase sends reset email
 *   2. User clicks link → app gets PASSWORD_RECOVERY event
 *   3. App shows SetNewPassword component
 *   4. resetPassword(newPassword) → Supabase updates, fires USER_UPDATED
 *   5. handleSession() resolves → user logged in normally
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import type { Session, AuthError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { fetchUserByEmail, setCallerEmail } from '../lib/api';
import { cacheClearAll } from '../lib/apiCache';
import {
  clearAdminStash,
  clearImpersonationFlag,
  endImpersonationEdge,
  getImpersonationFlag,
  getStashedAdminCache,
  getStashedAdminSession,
  setImpersonationFlag,
  stashAdminCache,
  stashAdminSession,
  startImpersonationEdge,
} from '../lib/impersonationSession';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AuthUser {
  email: string;
  role: 'admin' | 'staff' | 'client';
  clientName: string | null;
  clientSheetId: string | null;
  isParent: boolean;
  childClientSheetIds: string[];
  accessibleClientSheetIds: string[];    // v33: all accessible client IDs
  accessibleClientNames: string[];       // v33: matching display names
  displayName: string;
  avatarInitials: string;
}

type AuthState =
  | { status: 'loading' }
  | { status: 'unauthenticated' }
  | { status: 'denied'; reason: string }
  | { status: 'authenticated'; user: AuthUser }
  | { status: 'recovery' }
  | { status: 'recovery_expired' };

export type LoginPhase = 'idle' | 'verifying' | 'success';

interface AuthContextValue {
  user: AuthUser | null;
  realUser: AuthUser | null;
  isImpersonating: boolean;
  loading: boolean;
  accessDenied: boolean;
  deniedReason: string | null;
  passwordRecoveryMode: boolean;
  recoveryExpired: boolean;
  clearRecoveryExpired: () => void;
  loginPhase: LoginPhase;
  loginPhaseError: string | null;
  signInWithPassword: (email: string, password: string) => Promise<{ error: string | null }>;
  forgotPassword: (email: string) => Promise<{ error: string | null }>;
  resetPassword: (newPassword: string) => Promise<{ error: string | null }>;
  changePassword: (newPassword: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  impersonateUser: (email: string) => Promise<{ error: string | null }>;
  exitImpersonation: () => Promise<void>;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const AUTH_CACHE_KEY = 'stride_auth_user';

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Set-style equality for two string[] (order-independent). Used by the
 * user_metadata in-sync check so the AuthContext doesn't refire updateUser
 * on every page load just because GAS returned the accessibleClientSheetIds
 * array in a different order. Tiny inputs (≤ a handful of elements per user),
 * so the O(N²) form is fine and avoids a dependency.
 */
function arraysEqualOrderless(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (const v of a) {
    if (!b.includes(v)) return false;
  }
  return true;
}

function getDisplayName(email: string, fullName?: string): string {
  if (fullName && fullName.trim()) return fullName.trim();
  const local = email.split('@')[0];
  return local
    .split(/[._-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function getAvatarInitials(displayName: string): string {
  const parts = displayName.trim().split(' ').filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return displayName.slice(0, 2).toUpperCase();
}

function mapSignInError(message: string): string {
  if (message.includes('Invalid login credentials')) return 'Incorrect email or password.';
  if (message.includes('Email not confirmed')) return 'Please confirm your email before signing in.';
  if (message.includes('Too many requests')) return 'Too many attempts. Please wait a moment and try again.';
  return message;
}

/**
 * After Supabase auth succeeds, look up the user in the CB Users tab.
 * Returns the AuthUser or an error string.
 */
async function resolveUserFromApi(
  email: string,
  loginSource: 'password' | 'recovery',
  fullName?: string
): Promise<{ user: AuthUser | null; error: string | null }> {
  const result = await fetchUserByEmail(email, loginSource);

  if (!result.ok || !result.data) {
    return { user: null, error: 'Unable to reach authorization service. Please try again.' };
  }

  const apiUser = result.data.user;

  if (!apiUser) {
    return {
      user: null,
      error: 'No account found for this email. Contact your Stride administrator.',
    };
  }

  if (!apiUser.active) {
    return {
      user: null,
      error: 'Your account is pending activation. Contact your Stride administrator.',
    };
  }

  const displayName = getDisplayName(email, fullName);

  const authUser: AuthUser = {
    email: apiUser.email,
    role: apiUser.role,
    clientName: apiUser.clientName || null,
    clientSheetId: apiUser.clientSheetId || null,
    isParent: apiUser.isParent === true,
    childClientSheetIds: Array.isArray(apiUser.childClientSheetIds) ? apiUser.childClientSheetIds : [],
    accessibleClientSheetIds: Array.isArray(apiUser.accessibleClientSheetIds) ? apiUser.accessibleClientSheetIds : [],
    accessibleClientNames: Array.isArray(apiUser.accessibleClientNames) ? apiUser.accessibleClientNames : [],
    displayName,
    avatarInitials: getAvatarInitials(displayName),
  };

  return { user: authUser, error: null };
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authState, setAuthState] = useState<AuthState>({ status: 'loading' });
  const [loginPhase, setLoginPhase] = useState<LoginPhase>('idle');
  const [loginPhaseError, setLoginPhaseError] = useState<string | null>(null);
  // `realUser` is the ADMIN identity during impersonation, otherwise it
  // mirrors `authState.user`. Decoupled from authState because piece #3
  // of the impersonation series swaps the live Supabase session to the
  // target user — without separate state, authState.user becomes the
  // target and we'd lose the admin reference Settings.tsx + IntakesPanel
  // need for admin-only gates.
  const [realUser, setRealUser] = useState<AuthUser | null>(() => {
    // Bootstrap: if the tab is reloading mid-impersonation, the admin's
    // AuthUser snapshot lives in sessionStorage. Pre-hydrate so the UI
    // never sees a "no admin" frame while the Supabase session
    // auto-restores as the target user.
    if (getImpersonationFlag()) {
      const stash = getStashedAdminCache();
      if (stash) {
        try { return JSON.parse(stash) as AuthUser; } catch { /* corrupt */ }
      }
    }
    return null;
  });
  const recoveryRef = useRef(false);
  // Ref the onAuthStateChange listener consults so it can skip
  // handleSession during a deliberate impersonation swap (verifyOtp or
  // setSession). Without this, the handler would re-run with the wrong
  // identity context and either overwrite the admin's localStorage
  // cache with the target's, or clobber the carefully-managed
  // realUser/authState state we're about to set ourselves.
  const impersonationSwapRef = useRef(false);
  // Distinct from recoveryRef: only set when resetPassword() is explicitly called.
  // The impersonation path also calls supabase.auth.updateUser({ data }), which
  // fires USER_UPDATED — passwordChangeRef lets us tell the two apart.
  const passwordChangeRef = useRef(false);

  const clearCache = useCallback(() => {
    localStorage.removeItem(AUTH_CACHE_KEY);
  }, []);

  // Handle Supabase session → resolve user from CB Users tab
  const handleSession = useCallback(
    async (session: Session | null, loginSource: 'password' | 'recovery' = 'password') => {
      // During an impersonation swap (verifyOtp or setSession), we manage
      // state transitions ourselves — skip the default handler so the
      // admin's AUTH_CACHE_KEY isn't overwritten with the target's
      // profile and authState isn't snapped back to whoever Supabase
      // thinks is logged in mid-swap.
      if (impersonationSwapRef.current) return;
      if (!session?.user?.email) {
        clearCache();
        setCallerEmail('');
        setLoginPhase('idle');
        setAuthState({ status: 'unauthenticated' });
        return;
      }

      const email = session.user.email;
      const fullName = session.user.user_metadata?.full_name as string | undefined;

      // Session 71 fix: If we already have a cached auth user for the SAME email,
      // skip the GAS re-verification. This prevents "Access Denied" when opening
      // a second tab and GAS is slow/down. Only call GAS on first login, user
      // change, or recovery flow.
      try {
        const cachedRaw = localStorage.getItem(AUTH_CACHE_KEY);
        if (cachedRaw && loginSource !== 'recovery') {
          const cached = JSON.parse(cachedRaw) as AuthUser;
          if (cached?.email?.toLowerCase() === email.toLowerCase() && cached?.role) {
            // Same user, valid cache — use it directly, no GAS roundtrip.
            //
            // SECURITY (2026-06-08): role/clientSheetId/accessibleClientSheetIds
            // are served into the JWT user_metadata claim by the
            // custom_access_token_hook from the SERVICE-ROLE-ONLY app_metadata
            // (GAS stamps it — StrideAPI stampAppMetadata_). The previous
            // client-side supabase.auth.updateUser({ data }) that wrote those
            // claims here was the privilege-escalation vector (user_metadata is
            // user-writable) — removed. The hook re-derives the claims from the
            // seeded/stamped app_metadata on every token mint, so the cached
            // user can be trusted directly; a role/tenant change propagates on
            // the next token refresh (≤1h) without the client touching its own
            // claims.
            setCallerEmail(cached.email);
            setLoginPhase('success');
            setAuthState({ status: 'authenticated', user: cached });
            return;
          }
        }
      } catch { /* corrupt cache — fall through to full verification */ }

      // Phase 2: verifying account via API (first login or user change)
      setLoginPhase('verifying');
      setLoginPhaseError(null);

      const { user, error } = await resolveUserFromApi(email, loginSource, fullName);

      if (error || !user) {
        // Clear stride_cache_* too so any previous user's cached data can't leak.
        cacheClearAll();
        clearCache();
        setCallerEmail('');
        setLoginPhase('idle');
        setLoginPhaseError(error || 'Access denied.');
        setAuthState({ status: 'denied', reason: error || 'Access denied.' });
        return;
      }

      // CRITICAL: clear the API response cache ONLY when the user actually
      // changes — not on every successful sign-in (which includes every
      // page refresh for an already-logged-in user). Session-60 fix wiped
      // the cache on every handleSession call to prevent cross-user data
      // leakage on shared browsers (admin logs out → client logs in →
      // client must not see admin's cached inventory). That's still a real
      // concern, but it made refresh-while-signed-in trigger a full cache
      // wipe + ~15 refetches every time, compounding any GAS cold-start.
      //
      // Fix (session 68): compare session email vs. cached AUTH_CACHE_KEY
      // email. Wipe ONLY if the user changed (or cache was empty). Same
      // user reopening their own tab → cache is preserved → instant nav.
      try {
        const prevRaw = localStorage.getItem(AUTH_CACHE_KEY);
        const prevEmail = prevRaw
          ? (JSON.parse(prevRaw) as { email?: string })?.email?.toLowerCase() ?? ''
          : '';
        const nextEmail = String(user.email || '').toLowerCase();
        const userChanged = !prevEmail || prevEmail !== nextEmail;
        if (userChanged) cacheClearAll();
      } catch {
        // Corrupt / parse error — be safe and wipe
        cacheClearAll();
      }

      // Cache resolved user for fast subsequent loads (display-only bootstrap).
      // Suppressed while impersonating (refresh-during-impersonation path):
      // AUTH_CACHE_KEY must stay seeded with the ADMIN's profile so a
      // subsequent exit doesn't have to re-verify them against GAS, and so
      // realUser stays accurate. The admin's snapshot lives in
      // sessionStorage `stride_imp_admin_cache`; we restore it via the
      // bootstrap effect / impersonate flow.
      if (!getImpersonationFlag()) {
        localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(user));
      }

      // SECURITY (2026-06-08): role/clientSheetId/accessibleClientSheetIds are
      // served into the JWT user_metadata claim by the custom_access_token_hook
      // from the SERVICE-ROLE-ONLY app_metadata, which GAS just (re)stamped
      // inside resolveUserFromApi → fetchUserByEmail (handleGetUserByEmail_ →
      // stampAppMetadata_). The previous client-side
      // supabase.auth.updateUser({ data }) that wrote those claims here was the
      // privilege-escalation vector (user_metadata is user-writable) — removed.
      // The hook re-derives the claims from app_metadata on every token mint,
      // so a role/tenant change propagates on the next token refresh (≤1h)
      // without the client ever writing its own claims.

      setCallerEmail(user.email);
      setLoginPhase('success');
      setAuthState({ status: 'authenticated', user });

      // Session 65 — Prefetch the clients list right after login so the
      // dropdown on every page (Inventory, Tasks, Repairs, etc.) is already
      // populated by the time the user navigates. Supabase-first (~50ms);
      // GAS fallback only if the mirror is empty. Fire-and-forget.
      void (async () => {
        try {
          const { fetchClientsFromSupabase } = await import('../lib/supabaseQueries');
          const { cacheSet } = await import('../lib/apiCache');
          const sb = await fetchClientsFromSupabase(false);
          if (sb && sb.clients.length > 0) cacheSet('clients', sb);
        } catch { /* best-effort */ }
      })();
    },
    [clearCache]
  );

  // On mount: check existing session + listen for auth changes
  useEffect(() => {
    let mounted = true;

    // ─── DEV-ONLY auth bypass ──────────────────────────────────────────────
    // When running `npm run dev` (import.meta.env.DEV === true) AND the
    // VITE_DEV_BYPASS_AUTH env var is truthy, skip Supabase auth entirely
    // and mount as a mock admin user. This lets Claude Code (and any other
    // dev workflow) preview authenticated pages without real credentials.
    //
    // Production safety:
    //   - `import.meta.env.DEV` is a compile-time constant. Vite tree-shakes
    //     this entire `if` block out of the production bundle.
    //   - Even if the compile-time check somehow failed, the Supabase
    //     service-role key isn't on the client — the mock user would only
    //     be believed by React state, not by the backend. Any real API
    //     call would still require a valid Supabase session token.
    if (import.meta.env.DEV && import.meta.env.VITE_DEV_BYPASS_AUTH === 'true') {
      const mockUser: AuthUser = {
        email: 'dev-bypass@stride.local',
        role: 'admin',
        clientName: null,
        clientSheetId: null,
        isParent: false,
        childClientSheetIds: [],
        accessibleClientSheetIds: [],
        accessibleClientNames: [],
        displayName: 'Dev Bypass',
        avatarInitials: 'DB',
      };
      setCallerEmail(mockUser.email);
      setAuthState({ status: 'authenticated', user: mockUser });
      // eslint-disable-next-line no-console
      console.warn('[AuthContext] DEV auth bypass active — mounted as mock admin. Set VITE_DEV_BYPASS_AUTH=false to disable.');
      return () => { mounted = false; };
    }

    // ─── Instant bootstrap from localStorage cache ─────────────────────────
    // When opening a new tab, skip the "Signing you in..." screen by showing
    // the cached user immediately. The API re-validation still runs in the
    // background so role changes propagate within seconds.
    //
    // Suppressed during a mid-impersonation refresh: AUTH_CACHE_KEY holds
    // the ADMIN's profile (we preserved it), but Supabase's auto-restored
    // session is the TARGET's. Hydrating from cache here would briefly
    // render the admin's nav/role before handleSession swaps to target.
    // Skip and let the normal getSession() → handleSession path resolve
    // the target user properly. The realUser useState initializer above
    // already pre-hydrated the admin info from the sessionStorage stash
    // so the Exit banner / admin gates remain visible during the brief
    // loading state.
    const cachedJson = getImpersonationFlag() ? null : localStorage.getItem(AUTH_CACHE_KEY);
    if (cachedJson) {
      try {
        const cached = JSON.parse(cachedJson) as AuthUser;
        if (cached?.email && cached?.role) {
          setCallerEmail(cached.email);
          setAuthState({ status: 'authenticated', user: cached });
        }
      } catch { /* corrupt cache — fall through to normal flow */ }
    }

    // Check for existing session first.
    // Also check sessionStorage bridge flag set by main.tsx pre-bootstrap listener —
    // if PASSWORD_RECOVERY fired before React mounted, the flag tells us this session
    // is a recovery session rather than a normal login.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return;
      const isRecovery = sessionStorage.getItem('stride_recovery') === '1';
      if (isRecovery && session) {
        sessionStorage.removeItem('stride_recovery');
        recoveryRef.current = true;
        setAuthState({ status: 'recovery' });
        return;
      }
      if (isRecovery && !session) {
        // Recovery token in URL but Supabase couldn't establish a session —
        // the link is expired or already used. Set recoveryRef so the concurrent
        // SIGNED_OUT event (which fires through onAuthStateChange) also routes
        // to recovery_expired rather than unauthenticated.
        sessionStorage.removeItem('stride_recovery');
        recoveryRef.current = true;
        setAuthState({ status: 'recovery_expired' });
        return;
      }
      if (session) {
        handleSession(session, 'password');
      } else {
        clearCache();
        setAuthState({ status: 'unauthenticated' });
      }
    });

    // Listen for future auth changes (login, logout, token refresh, password recovery)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (!mounted) return;

        // While impersonation is mid-swap (verifyOtp / setSession), the
        // impersonateUser / exitImpersonation callbacks manage state
        // transitions directly. Drop every event so we don't double-run
        // handleSession or wipe AUTH_CACHE_KEY underneath ourselves.
        if (impersonationSwapRef.current) return;

        if (event === 'SIGNED_OUT') {
          // Session 71 hardened: Supabase fires spurious SIGNED_OUT on cross-tab
          // sync, deploys, and refreshes. DO NOT process if we have a cached user —
          // the explicit signOut() function handles real logouts and clears everything.
          // Only process SIGNED_OUT for the no-cache case (user was never logged in
          // on this tab, or signOut() already cleared the cache before this fires).
          const cachedAuth = localStorage.getItem('stride_auth_user');
          if (cachedAuth) {
            // Cached user exists — this is spurious noise, ignore completely.
            // The user's explicit signOut() clears the cache BEFORE calling
            // supabase.auth.signOut(), so by the time SIGNED_OUT fires from a
            // real logout, the cache will already be gone.
            return;
          }
          // No cache — this is either a real sign-out or first load with no session.
          const isRecoveryFlow = recoveryRef.current || sessionStorage.getItem('stride_recovery') === '1';
          if (isRecoveryFlow) {
            sessionStorage.removeItem('stride_recovery');
            setAuthState({ status: 'recovery_expired' });
          } else {
            setCallerEmail('');
            setAuthState({ status: 'unauthenticated' });
          }
          return;
        }

        if (event === 'PASSWORD_RECOVERY') {
          // User clicked password reset link — show change-password form
          recoveryRef.current = true;
          setAuthState({ status: 'recovery' });
          return;
        }

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
          if (session) {
            // If we're in recovery mode, ignore SIGNED_IN/TOKEN_REFRESHED — don't auto-login.
            // Only USER_UPDATED (after password change succeeds) should proceed.
            if (recoveryRef.current && event !== 'USER_UPDATED') {
              return;
            }
            if (event === 'USER_UPDATED') {
              // Only proceed if resetPassword() explicitly set passwordChangeRef.
              // The impersonation path also calls supabase.auth.updateUser({ data })
              // and that fires USER_UPDATED too — passwordChangeRef lets us tell the
              // two apart, avoiding a race that logged users in prematurely.
              if (!passwordChangeRef.current) return;
              passwordChangeRef.current = false;
              recoveryRef.current = false;
            }
            // Skip handleSession on TOKEN_REFRESHED *or* SIGNED_IN if we're already
            // authenticated as the same user. Supabase fires both kinds of events
            // when a tab regains focus / when its internal _recoverAndRefresh()
            // re-validates the session (often TOKEN_REFRESHED on token rotation,
            // sometimes SIGNED_IN on session recovery). Without this guard, every
            // refocus calls handleSession → setAuthState({status:'authenticated',
            // user:JSON.parse(cachedRaw)}) which produces a NEW user object
            // reference. Every useAuth() consumer re-renders, every hook with
            // `user` in its deps refires its fetch, and the WC/Shipment/etc.
            // detail pages reload their entire data layer (~100 network requests).
            //
            // First-time login still flows through: handleSession ran from the
            // initial getSession() bootstrap below (line ~350), so by the time
            // SIGNED_IN fires for a fresh login, AUTH_CACHE_KEY is already populated.
            // The auth-state change for the very first login is delivered via the
            // signInWithPassword() path which sets state synchronously.
            if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
              try {
                const cachedRaw = localStorage.getItem(AUTH_CACHE_KEY);
                if (cachedRaw && session.user?.email) {
                  const cached = JSON.parse(cachedRaw) as { email?: string };
                  if (cached?.email?.toLowerCase() === session.user.email.toLowerCase()) {
                    return; // same user — UI state unchanged
                  }
                }
              } catch { /* corrupt cache — fall through to full handleSession */ }
            }
            const source = event === 'USER_UPDATED' ? 'recovery' : 'password';
            handleSession(session, source);
          }
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [handleSession, clearCache]);

  // ─── Auth Actions ───────────────────────────────────────────────────────────

  const signInWithPassword = useCallback(
    async (email: string, password: string): Promise<{ error: string | null }> => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: mapSignInError(error.message) };
      // Success: onAuthStateChange will fire SIGNED_IN → handleSession
      return { error: null };
    },
    []
  );

  const forgotPassword = useCallback(
    async (email: string): Promise<{ error: string | null }> => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      });
      return { error: (error as AuthError | null)?.message ?? null };
    },
    []
  );

  const resetPassword = useCallback(
    async (newPassword: string): Promise<{ error: string | null }> => {
      // Mark BEFORE calling updateUser so the USER_UPDATED event that follows
      // can be distinguished from the impersonation-path updateUser({ data }).
      passwordChangeRef.current = true;
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) passwordChangeRef.current = false; // reset on failure — no USER_UPDATED will fire
      return { error: (error as AuthError | null)?.message ?? null };
    },
    []
  );

  // Change password while already authenticated — does NOT trigger recovery flow.
  const changePassword = useCallback(
    async (newPassword: string): Promise<{ error: string | null }> => {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      return { error: (error as AuthError | null)?.message ?? null };
    },
    []
  );

  const signOut = useCallback(async () => {
    // Clear API response cache FIRST so the next user can't inherit data from
    // this session via localStorage. Session 60 isolation fix.
    cacheClearAll();
    clearCache();
    setCallerEmail('');
    // Clear any impersonation state too — signing out from inside an
    // impersonation session must blow away the admin stash AND the
    // target session. Service worker tabs / Cmd+Shift+L sign-outs were
    // the path that previously hit setSupabaseImpersonating(false); now
    // we clean up the full piece-#3 surface.
    clearImpersonationFlag();
    clearAdminStash();
    setRealUser(null);
    await supabase.auth.signOut();
    setAuthState({ status: 'unauthenticated' });
    // Session 62 follow-up — reset loginPhase so the Login screen doesn't
    // re-mount stuck on the "Welcome back / Redirecting..." success UI from
    // the previous session.
    setLoginPhase('idle');
    setLoginPhaseError(null);
    // Session 60 follow-up — reset the HashRouter URL to root so the Login
    // screen isn't rendered under a stale #/inventory (or whatever the user
    // was on) deep link. Without this, logging back in would deep-link the
    // user into the previous route, which looks to the user like logout
    // didn't actually take them to the login page. Using replace() so the
    // back button doesn't restore the logged-in route.
    try {
      window.history.replaceState(null, '', '#/');
    } catch { /* non-browser env (tests) — ignore */ }
  }, [clearCache]);

  const clearRecoveryExpired = useCallback(() => {
    recoveryRef.current = false;
    sessionStorage.removeItem('stride_recovery');
    clearCache();
    setCallerEmail('');
    setAuthState({ status: 'unauthenticated' });
  }, [clearCache]);

  // ─── Impersonation (real Supabase-session swap) ────────────────────────
  //
  // Piece #3 of the impersonation-fidelity series. Previously this swapped
  // only React state and the Supabase JWT stayed on the admin's identity —
  // forcing the codebase to carry a `setSupabaseImpersonating` cache-bypass
  // workaround in supabaseQueries because RLS reads would have returned
  // admin-scoped rows. Now the live Supabase session is the target user's
  // for the duration of impersonation, so RLS / auth.email() / edge
  // functions all evaluate as the client.
  //
  // Flow:
  //   1. Verify admin role locally (re-verified server-side too).
  //   2. Stash admin's session tokens + admin's localStorage AUTH_CACHE
  //      entry into sessionStorage. sessionStorage so closing the tab
  //      ends impersonation cleanly and admin tokens never linger on disk.
  //   3. Call the impersonate-mint-session edge function — admin role is
  //      enforced there too, and it writes the impersonation_log audit
  //      row before minting the magic-link token.
  //   4. supabase.auth.verifyOtp() swaps the live session to the target.
  //      We set impersonationSwapRef so handleSession (which would fire
  //      via onAuthStateChange SIGNED_IN) doesn't overwrite the admin's
  //      AUTH_CACHE_KEY with the target's profile.
  //   5. Resolve the target's AuthUser via fetchUserByEmail and push it
  //      into authState. realUser stays as the admin (NOT mirrored from
  //      authState while impersonating).

  const impersonateUser = useCallback(
    async (email: string): Promise<{ error: string | null }> => {
      const currentRealUser = realUser ?? (authState.status === 'authenticated' ? authState.user : null);
      if (!currentRealUser || currentRealUser.role !== 'admin') {
        return { error: 'Only admins can impersonate users.' };
      }
      const targetEmail = email.trim().toLowerCase();
      if (targetEmail === currentRealUser.email.toLowerCase()) {
        return { error: 'You cannot impersonate yourself.' };
      }

      // Snapshot current admin session BEFORE the swap. If anything fails
      // mid-flow we restore from this stash.
      const { data: { session: adminSession } } = await supabase.auth.getSession();
      if (!adminSession?.access_token || !adminSession?.refresh_token) {
        return { error: 'Admin session unavailable — please sign in again.' };
      }

      // Call the edge function (admin role re-verified, audit row written,
      // OTP minted). On failure: nothing was changed locally, safe to bail.
      const mintResult = await startImpersonationEdge(targetEmail);
      if (!mintResult.ok) {
        return { error: mintResult.error || 'Impersonation request failed.' };
      }

      // Persist the admin's identity ahead of the swap so a refresh
      // during impersonation can restore realUser.
      stashAdminSession({
        access_token: adminSession.access_token,
        refresh_token: adminSession.refresh_token,
      });
      stashAdminCache(localStorage.getItem(AUTH_CACHE_KEY));
      setRealUser(currentRealUser);

      // Block handleSession from running on the SIGNED_IN that verifyOtp
      // will fire — we manage the state transition manually below.
      impersonationSwapRef.current = true;
      // The edge function returns linkData.properties.hashed_token from
      // supabase.auth.admin.generateLink. That's a hashed token (long
      // hex string), NOT a 6-digit email OTP code — so it must be
      // passed via `token_hash`, not `token`. The `token` field expects
      // the short numeric OTP and rejects long hashed tokens with
      // "token has expired or is invalid" (403 /verify). Caught
      // 2026-05-26 in the Supabase auth logs after every impersonation
      // attempt was silently bouncing back. No email field belongs in
      // the token_hash variant — the hash already encodes the user.
      const { error: otpErr } = await supabase.auth.verifyOtp({
        token_hash: mintResult.token,
        type: 'magiclink',
      });
      if (otpErr) {
        impersonationSwapRef.current = false;
        clearAdminStash();
        setRealUser(null);
        return { error: `Token verification failed: ${otpErr.message}` };
      }

      // Now the live Supabase session is the target's. Resolve their
      // AuthUser (CB Users tab) and push into authState.
      const { user: targetUser, error: resolveErr } = await resolveUserFromApi(targetEmail, 'password');
      if (resolveErr || !targetUser) {
        // Swap back immediately — partial impersonation is worse than
        // a hard failure here.
        await supabase.auth.setSession(adminSession);
        // Close the audit row before bailing. The mint+verify succeeded
        // so the row exists with ended_at=null; if we don't close it,
        // a future exit on a re-attempted impersonation of the same
        // target would stamp-close THIS orphan instead of the active
        // session row (the edge function matches "most-recent open"
        // by admin+target). Admin's JWT is back live so the edge
        // function's role check passes.
        void endImpersonationEdge(targetEmail);
        impersonationSwapRef.current = false;
        clearAdminStash();
        setRealUser(null);
        return { error: resolveErr || 'Target user lookup failed.' };
      }

      // Sync the target's user_metadata into the live JWT before any RLS-
      // gated query runs. handleSession does this on normal login (lines
      // ~290-301 / ~384-394) but is suppressed here by impersonationSwapRef,
      // so without an explicit sync the target's JWT carries whatever
      // user_metadata is stored on auth.users.raw_user_meta_data — which
      // is empty or stale for any client who hasn't logged in via password
      // since the metadata-sync code shipped (and stale whenever their
      // tenant assignments change). The RLS helper user_has_tenant_access
      // (migration 20260504210000_multi_tenant_rls_access.sql) reads
      // clientSheetId + accessibleClientSheetIds straight from the JWT, so
      // missing/stale values silently filter every row out and the
      // impersonated session sees empty inventory, tasks, repairs, will
      // calls, etc. Best-effort: a failure here is logged but doesn't
      // block impersonation — partial access is still better than a hard
      // bounce, and the admin can exit/retry.
      try {
        const { data: { session: targetSession } } = await supabase.auth.getSession();
        const jwtMeta = (targetSession?.user?.user_metadata ?? {}) as {
          role?: string;
          clientSheetId?: string;
          accessibleClientSheetIds?: string[];
          childClientSheetIds?: string[];
        };
        const targetClientSheetId = targetUser.clientSheetId ?? '';
        const targetAccessible = targetUser.accessibleClientSheetIds ?? [];
        const targetChildren = targetUser.childClientSheetIds ?? [];
        const inSync = jwtMeta.role === targetUser.role
          && (jwtMeta.clientSheetId ?? '') === targetClientSheetId
          && arraysEqualOrderless(jwtMeta.accessibleClientSheetIds ?? [], targetAccessible)
          && arraysEqualOrderless(jwtMeta.childClientSheetIds ?? [], targetChildren);
        if (!inSync) {
          await supabase.auth.updateUser({
            data: {
              role: targetUser.role,
              clientSheetId: targetClientSheetId,
              accessibleClientSheetIds: targetAccessible,
              childClientSheetIds: targetChildren,
            },
          });
        }
      } catch (err) {
        console.warn('[AuthContext] impersonation user_metadata sync failed:', (err as Error).message);
      }

      // Clear the API response cache so admin's cached data doesn't leak
      // into the impersonated view, and seed the active-impersonation
      // flag in sessionStorage so a page refresh stays in this mode.
      cacheClearAll();
      setImpersonationFlag({
        adminEmail:       currentRealUser.email,
        targetEmail:      targetUser.email,
        impersonationId:  mintResult.impersonationId,
        startedAt:        new Date().toISOString(),
      });
      setCallerEmail(targetUser.email);
      setAuthState({ status: 'authenticated', user: targetUser });
      // Restore admin's localStorage cache — handleSession was suppressed
      // but Supabase's internal SIGNED_IN path may have nudged it.
      const stashedCache = getStashedAdminCache();
      if (stashedCache) localStorage.setItem(AUTH_CACHE_KEY, stashedCache);
      impersonationSwapRef.current = false;
      return { error: null };
    },
    [authState, realUser]
  );

  const exitImpersonation = useCallback(async () => {
    const flag = getImpersonationFlag();
    const adminTokens = getStashedAdminSession();
    const stashedAdminCache = getStashedAdminCache();

    if (!adminTokens) {
      // Stash is gone — corrupt state. Force a full sign-out and let the
      // user re-authenticate. Better to be safe than leave a dangling
      // session.
      console.warn('[AuthContext] exitImpersonation: no admin stash, signing out');
      clearImpersonationFlag();
      clearAdminStash();
      setRealUser(null);
      await supabase.auth.signOut();
      return;
    }

    impersonationSwapRef.current = true;
    const { error: swapErr } = await supabase.auth.setSession(adminTokens);
    if (swapErr) {
      // Admin refresh token probably expired. Fall back to clean
      // sign-out. ORPHAN-ROW CAVEAT: the impersonation_log row stays
      // open here (ended_at = null). We can't close it from this
      // branch because:
      //   - We're still holding the target's JWT (swap failed), and
      //     the edge function's 'end' action requires admin role.
      //   - The admin's refresh token is dead, so we can't get a
      //     fresh admin JWT to call 'end' with.
      // This branch is rare in practice (requires the admin's refresh
      // token to expire DURING an active impersonation session, i.e.
      // typically within an hour). Operator cleanup query:
      //   UPDATE impersonation_log
      //   SET ended_at = now(), reason = COALESCE(reason, '') || ' [auto-closed: orphan]'
      //   WHERE ended_at IS NULL AND started_at < now() - INTERVAL '24 hours';
      console.warn('[AuthContext] exitImpersonation: admin session restore failed, signing out:', swapErr.message);
      impersonationSwapRef.current = false;
      clearImpersonationFlag();
      clearAdminStash();
      setRealUser(null);
      await supabase.auth.signOut();
      return;
    }

    // Restore admin's localStorage cache so the next handleSession path
    // finds the admin's cached profile (no GAS roundtrip on exit).
    if (stashedAdminCache) localStorage.setItem(AUTH_CACHE_KEY, stashedAdminCache);

    // Push admin back into authState. The mirror effect below will then
    // sync realUser from authState since the impersonation flag is gone.
    if (realUser) {
      setAuthState({ status: 'authenticated', user: realUser });
      setCallerEmail(realUser.email);
    }
    setRealUser(null);
    clearImpersonationFlag();
    clearAdminStash();
    cacheClearAll();
    impersonationSwapRef.current = false;

    // Stamp ended_at on the audit row. Fire-and-forget — the swap-back
    // already succeeded; an audit-close failure is a logged warning, not
    // a user-visible error. Admin's JWT is back at this point so the
    // edge function's admin check will pass.
    if (flag) {
      void endImpersonationEdge(flag.targetEmail);
    }
  }, [realUser]);

  // ─── Derived values ─────────────────────────────────────────────────────────

  // user = the currently-effective Supabase identity (target during
  // impersonation, admin otherwise). authState.user IS this directly
  // now that we hold a real session as whichever identity is active.
  const user = authState.status === 'authenticated' ? authState.user : null;
  const isImpersonating = realUser !== null
    && user !== null
    && realUser.email.toLowerCase() !== user.email.toLowerCase();

  // Mirror authState.user → realUser when NOT impersonating, so normal
  // login flow populates realUser via the same code path it always has.
  // During impersonation, authState.user is the target — we explicitly
  // do NOT mirror so realUser stays as the admin we snapshotted at
  // impersonate-start (or restored from stash on refresh).
  useEffect(() => {
    if (getImpersonationFlag()) return;
    if (authState.status === 'authenticated') setRealUser(authState.user);
    else setRealUser(null);
  }, [authState]);
  const loading = authState.status === 'loading';
  const accessDenied = authState.status === 'denied';
  const deniedReason = authState.status === 'denied' ? authState.reason : null;
  const passwordRecoveryMode = authState.status === 'recovery';
  const recoveryExpired = authState.status === 'recovery_expired';

  return (
    <AuthContext.Provider
      value={{
        user,
        realUser,
        isImpersonating,
        loading,
        accessDenied,
        deniedReason,
        passwordRecoveryMode,
        recoveryExpired,
        clearRecoveryExpired,
        loginPhase,
        loginPhaseError,
        signInWithPassword,
        forgotPassword,
        resetPassword,
        changePassword,
        signOut,
        impersonateUser,
        exitImpersonation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
