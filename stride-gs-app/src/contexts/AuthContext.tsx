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
import { setSupabaseImpersonating } from '../lib/supabaseQueries';
import { cacheClearAll } from '../lib/apiCache';

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
  signOut: () => Promise<void>;
  impersonateUser: (email: string) => Promise<{ error: string | null }>;
  exitImpersonation: () => void;
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
  const [impersonatedUser, setImpersonatedUser] = useState<AuthUser | null>(null);
  const recoveryRef = useRef(false);
  // Distinct from recoveryRef: only set when resetPassword() is explicitly called.
  // handleSession() also calls supabase.auth.updateUser() for role-sync metadata,
  // which fires USER_UPDATED — passwordChangeRef lets us tell the two apart.
  const passwordChangeRef = useRef(false);

  const clearCache = useCallback(() => {
    localStorage.removeItem(AUTH_CACHE_KEY);
  }, []);

  // Handle Supabase session → resolve user from CB Users tab
  const handleSession = useCallback(
    async (session: Session | null, loginSource: 'password' | 'recovery' = 'password') => {
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
            // Same user, valid cache — use it directly, no GAS roundtrip
            setCallerEmail(cached.email);
            setLoginPhase('success');
            setAuthState({ status: 'authenticated', user: cached });
            // Fire-and-forget: sync role metadata (non-blocking)
            supabase.auth.updateUser({
              data: { role: cached.role, clientSheetId: cached.clientSheetId ?? '' },
            }).catch(() => {});
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

      // Cache resolved user for fast subsequent loads (display-only bootstrap)
      localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify(user));

      // Phase 1: Sync role + clientSheetId into Supabase user_metadata so RLS policies
      // on gs_sync_events can grant admin/staff read-all access.
      // Fire-and-forget — never block login on this.
      supabase.auth.updateUser({
        data: { role: user.role, clientSheetId: user.clientSheetId ?? '' },
      }).catch(() => { /* best-effort */ });

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
    const cachedJson = localStorage.getItem(AUTH_CACHE_KEY);
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
              // handleSession() also calls supabase.auth.updateUser() for role-sync
              // metadata and that fires USER_UPDATED too — passwordChangeRef lets us
              // tell the two apart, avoiding a race that logged users in prematurely.
              if (!passwordChangeRef.current) return;
              passwordChangeRef.current = false;
              recoveryRef.current = false;
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
      // can be distinguished from the role-sync updateUser in handleSession().
      passwordChangeRef.current = true;
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) passwordChangeRef.current = false; // reset on failure — no USER_UPDATED will fire
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
    setImpersonatedUser(null);
    setSupabaseImpersonating(false);
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

  // ─── Impersonation ─────────────────────────────────────────────────────────

  const impersonateUser = useCallback(
    async (email: string): Promise<{ error: string | null }> => {
      const realUser = authState.status === 'authenticated' ? authState.user : null;
      if (!realUser || realUser.role !== 'admin') {
        return { error: 'Only admins can impersonate users.' };
      }
      if (email === realUser.email) {
        return { error: 'You cannot impersonate yourself.' };
      }

      const { user: targetUser, error } = await resolveUserFromApi(email, 'password');
      if (error || !targetUser) {
        return { error: error || 'User not found.' };
      }

      // Clear API response cache so the impersonation starts with a clean
      // slate — the admin's cached data must not leak into the impersonated
      // client's view. Session 60 isolation fix.
      cacheClearAll();
      setImpersonatedUser(targetUser);
      setCallerEmail(targetUser.email);
      setSupabaseImpersonating(true);
      return { error: null };
    },
    [authState]
  );

  const exitImpersonation = useCallback(() => {
    const realUser = authState.status === 'authenticated' ? authState.user : null;
    // Clear API response cache so the impersonated user's data can't leak
    // back to the real admin's view. Session 60 isolation fix.
    cacheClearAll();
    setImpersonatedUser(null);
    setSupabaseImpersonating(false);
    if (realUser) {
      setCallerEmail(realUser.email);
    }
  }, [authState]);

  // ─── Derived values ─────────────────────────────────────────────────────────

  const realUser = authState.status === 'authenticated' ? authState.user : null;
  const user = impersonatedUser ?? realUser;
  const isImpersonating = impersonatedUser !== null;
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
        signOut,
        impersonateUser,
        exitImpersonation,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
