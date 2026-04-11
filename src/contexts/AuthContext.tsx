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
  | { status: 'recovery' };

export type LoginPhase = 'idle' | 'verifying' | 'success';

interface AuthContextValue {
  user: AuthUser | null;
  realUser: AuthUser | null;
  isImpersonating: boolean;
  loading: boolean;
  accessDenied: boolean;
  deniedReason: string | null;
  passwordRecoveryMode: boolean;
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

      // Phase 2: verifying account via API
      setLoginPhase('verifying');
      setLoginPhaseError(null);

      const { user, error } = await resolveUserFromApi(email, loginSource, fullName);

      if (error || !user) {
        clearCache();
        setCallerEmail('');
        setLoginPhase('idle');
        setLoginPhaseError(error || 'Access denied.');
        setAuthState({ status: 'denied', reason: error || 'Access denied.' });
        return;
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
    },
    [clearCache]
  );

  // On mount: check existing session + listen for auth changes
  useEffect(() => {
    let mounted = true;

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
          // Defensive: Supabase cross-tab sync can fire a spurious SIGNED_OUT
          // when opening a new tab while already logged in. Only logout if the
          // Supabase session is truly gone — otherwise ignore the noise.
          supabase.auth.getSession().then(({ data }) => {
            if (!data.session) {
              clearCache();
              setCallerEmail('');
              setAuthState({ status: 'unauthenticated' });
            }
          });
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
              // Only handle USER_UPDATED when we're in password recovery flow.
              // USER_UPDATED also fires when we write user_metadata (role sync) — ignore those.
              if (!recoveryRef.current) return;
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
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      return { error: (error as AuthError | null)?.message ?? null };
    },
    []
  );

  const signOut = useCallback(async () => {
    clearCache();
    setCallerEmail('');
    setImpersonatedUser(null);
    setSupabaseImpersonating(false);
    await supabase.auth.signOut();
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

      setImpersonatedUser(targetUser);
      setCallerEmail(targetUser.email);
      setSupabaseImpersonating(true);
      return { error: null };
    },
    [authState]
  );

  const exitImpersonation = useCallback(() => {
    const realUser = authState.status === 'authenticated' ? authState.user : null;
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
