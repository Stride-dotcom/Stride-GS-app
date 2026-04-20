/**
 * useProfiles — user directory backed by the public.profiles table. Mirrors
 * auth.users via the on_auth_user_created trigger so every authenticated
 * user has a row available for the messaging recipient picker and
 * @-mention autocomplete.
 *
 * Cheap in-component state (no realtime) — the user list rarely changes
 * during a session. Callers that need fresh data can call `refetch`.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface Profile {
  id: string;                 // auth.users.id
  email: string;
  displayName: string;
  role: 'admin' | 'staff' | 'client' | string;
  avatarUrl: string | null;
  isActive: boolean;
}

interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string | null;
  avatar_url: string | null;
  is_active: boolean | null;
}

function rowToProfile(r: ProfileRow): Profile {
  return {
    id: r.id,
    email: r.email ?? '',
    displayName: r.display_name ?? r.email ?? 'Unknown',
    role: r.role ?? 'client',
    avatarUrl: r.avatar_url,
    isActive: r.is_active !== false,
  };
}

export interface UseProfilesResult {
  profiles: Profile[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /** Case-insensitive filter by email OR display_name. Client-side so it
   *  stays snappy across the cached list. */
  searchProfiles: (query: string) => Profile[];
}

export function useProfiles(activeOnly = true): UseProfilesResult {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true); setError(null);
    let query = supabase
      .from('profiles')
      .select('id,email,display_name,role,avatar_url,is_active')
      .order('email', { ascending: true });
    if (activeOnly) query = query.eq('is_active', true);
    const { data, error: err } = await query;
    if (err) { setError(err.message); setLoading(false); return; }
    setProfiles(((data ?? []) as ProfileRow[]).map(rowToProfile));
    setLoading(false);
  }, [activeOnly]);

  useEffect(() => { void refetch(); }, [refetch]);

  const searchProfiles = useCallback((query: string): Profile[] => {
    const q = query.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(p =>
      p.email.toLowerCase().includes(q) ||
      p.displayName.toLowerCase().includes(q) ||
      p.role.toLowerCase().includes(q)
    );
  }, [profiles]);

  return useMemo(() => ({ profiles, loading, error, refetch, searchProfiles }),
    [profiles, loading, error, refetch, searchProfiles]);
}
