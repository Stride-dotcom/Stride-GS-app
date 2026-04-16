import { createContext, useContext, useEffect, useState, useMemo, useCallback, ReactNode } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { __ImpersonationContext } from './ImpersonationContext';

interface UserProfile {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  tenant_id: string;
  status: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, firstName?: string, lastName?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  resetPassword: (email: string) => Promise<{ error: Error | null }>;
  signInWithGoogle: () => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const clearAuthStorage = () => {
    try {
      localStorage.removeItem('user_profile_cache');
      // Supabase stores auth tokens in keys like: sb-<project-ref>-auth-token
      const authKeys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && /^sb-.*-auth-token$/.test(key)) {
          authKeys.push(key);
        }
      }
      authKeys.forEach((key) => localStorage.removeItem(key));
    } catch {
      // Ignore localStorage cleanup errors.
    }
  };

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        console.log('Auth state changed:', event);

        // Handle token refresh errors
        if (event === 'TOKEN_REFRESHED' && !session) {
          // Token refresh failed - clear state and redirect to login
          console.warn('Token refresh failed, signing out');
          handleInvalidSession();
          return;
        }

        setSession(session);
        setUser(session?.user ?? null);

        // Defer profile fetch with setTimeout to avoid deadlock
        if (session?.user) {
          setTimeout(() => {
            fetchProfile(session.user.id);
          }, 0);
        } else {
          setProfile(null);
        }

        // IMPORTANT: always clear loading after an auth transition.
        // In some flows (e.g., quick-login), getSession() can lag behind the auth event,
        // leaving the app stuck on the ProtectedRoute spinner.
        setLoading(false);
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      // Handle invalid refresh token error
      if (error) {
        console.error('Session error:', error);
        if (error.message?.includes('Refresh Token') || error.message?.includes('refresh_token')) {
          handleInvalidSession();
          return;
        }
      }

      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      }
      setLoading(false);
    }).catch((error) => {
      console.error('Failed to get session:', error);
      handleInvalidSession();
    });

    return () => subscription.unsubscribe();
  }, []);

  // Handle invalid or expired sessions
  const handleInvalidSession = async () => {
    console.log('Clearing invalid session');
    setSession(null);
    setUser(null);
    setProfile(null);
    setLoading(false);

    // Clear any cached auth data
    try {
      clearAuthStorage();
      // Sign out to clear Supabase's stored tokens
      await supabase.auth.signOut({ scope: 'local' });
    } catch (e) {
      // Ignore errors during cleanup
      console.warn('Error during session cleanup:', e);
      clearAuthStorage();
    }
  };

  const fetchProfile = async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name, tenant_id, status')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('Error fetching profile:', error);
        return;
      }

      // User profile may not exist yet for new users
      if (!data) {
        setProfile(null);
        return;
      }

      setProfile(data);

      // Cache profile for error tracking (includes tenant_id and role)
      try {
        let userRole: string | undefined;
        const { data: roleData } = await supabase
          .from('user_roles')
          .select('roles:role_id(name)')
          .eq('user_id', userId)
          .is('deleted_at', null)
          .limit(1)
          .maybeSingle();
        if (roleData && (roleData as any).roles?.name) {
          userRole = (roleData as any).roles.name;
        }
        localStorage.setItem('user_profile_cache', JSON.stringify({
          tenant_id: data.tenant_id,
          role: userRole,
          account_id: (data as any).account_id,
        }));
      } catch {
        // Ignore localStorage errors
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    }
  };

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      return { error };
    } catch (error) {
      return { error: error as Error };
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string, firstName?: string, lastName?: string) => {
    try {
      const redirectUrl = `${window.location.origin}/`;
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: { first_name: firstName, last_name: lastName },
        },
      });
      return { error };
    } catch (error) {
      return { error: error as Error };
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      return { error };
    } catch (error) {
      return { error: error as Error };
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/` },
      });
      return { error };
    } catch (error) {
      return { error: error as Error };
    }
  }, []);

  const contextValue = useMemo(() => ({
    user,
    session,
    profile,
    loading,
    signIn,
    signUp,
    signOut,
    resetPassword,
    signInWithGoogle,
  }), [user, session, profile, loading, signIn, signUp, signOut, resetPassword, signInWithGoogle]);

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  // When impersonation is active, override profile.tenant_id so all data
  // queries transparently scope to the impersonated tenant.
  const impersonation = useContext(__ImpersonationContext);
  const effectiveProfile = useMemo(() => {
    if (!context.profile) return null;
    if (impersonation?.active && impersonation.tenantId) {
      return { ...context.profile, tenant_id: impersonation.tenantId };
    }
    return context.profile;
  }, [context.profile, impersonation?.active, impersonation?.tenantId]);

  return useMemo(() => ({
    ...context,
    profile: effectiveProfile,
  }), [context.user, context.session, context.loading, context.signIn, context.signUp, context.signOut, context.resetPassword, context.signInWithGoogle, effectiveProfile]);
}
