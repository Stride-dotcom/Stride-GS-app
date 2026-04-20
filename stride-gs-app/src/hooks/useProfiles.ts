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
  /** For role='client' profiles, the bound CB spreadsheetId they can see.
   *  Sourced from cb_users.client_sheet_id (same id = auth.users.id).
   *  null for staff/admin (they don't need a tenant binding). Used by the
   *  compose modal to limit a client's recipient picker to their own
   *  coworkers + admin. */
  clientSheetId: string | null;
}

interface ProfileRow {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string | null;
  avatar_url: string | null;
  is_active: boolean | null;
}

interface CbUserIdRow {
  id: string;
  client_sheet_id: string | null;
}

function rowToProfile(r: ProfileRow, clientSheetId: string | null): Profile {
  return {
    id: r.id,
    email: r.email ?? '',
    displayName: r.display_name ?? r.email ?? 'Unknown',
    role: r.role ?? 'client',
    avatarUrl: r.avatar_url,
    isActive: r.is_active !== false,
    clientSheetId,
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
    let q = supabase
      .from('profiles')
      .select('id,email,display_name,role,avatar_url,is_active')
      .order('email', { ascending: true });
    if (activeOnly) q = q.eq('is_active', true);
    // Parallel: profiles + cb_users id→client_sheet_id map. cb_users.id is
    // keyed to auth.users.id so it aligns 1:1 with profiles.id.
    const [pRes, uRes] = await Promise.all([
      q,
      supabase.from('cb_users').select('id,client_sheet_id'),
    ]);
    if (pRes.error) { setError(pRes.error.message); setLoading(false); return; }
    // cb_users lookup is best-effort: if the read fails we just surface the
    // profiles with clientSheetId=null — the filter downgrade is strictly
    // more permissive (shows more entries), never less.
    const sheetMap = new Map<string, string | null>();
    if (!uRes.error && uRes.data) {
      for (const r of uRes.data as CbUserIdRow[]) {
        sheetMap.set(r.id, r.client_sheet_id);
      }
    }
    setProfiles(((pRes.data ?? []) as ProfileRow[])
      .map(r => rowToProfile(r, sheetMap.get(r.id) ?? null)));
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
