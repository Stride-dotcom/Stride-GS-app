/**
 * useUsers — Fetches and manages users from the CB Users tab via the Stride API.
 * Staff/admin only. Requires callerEmail to be set (handled by AuthContext).
 */
import { useCallback, useMemo } from 'react';
import { fetchUsers, createApiUser, updateApiUser, deleteApiUser } from '../lib/api';
import { fetchUsersFromSupabase } from '../lib/supabaseQueries';
import type { ApiUser, UsersResponse } from '../lib/api';
import { useApiData } from './useApiData';
import { useAuth } from '../contexts/AuthContext';

export interface UseUsersResult {
  users: ApiUser[];
  count: number;
  loading: boolean;
  error: string | null;
  refetch: () => void;
  lastFetched: Date | null;
  addUser: (
    email: string,
    role: string,
    clientName?: string,
    clientSheetId?: string
  ) => Promise<{ success: boolean; error: string | null }>;
  toggleActive: (
    email: string,
    active: boolean
  ) => Promise<{ success: boolean; error: string | null }>;
  changeRole: (
    email: string,
    role: string
  ) => Promise<{ success: boolean; error: string | null }>;
  updateUser: (
    email: string,
    updates: { active?: boolean; role?: string; clientName?: string; clientSheetId?: string; newEmail?: string }
  ) => Promise<{ success: boolean; error: string | null }>;
  deleteUser: (email: string) => Promise<{ success: boolean; error: string | null }>;
}

export function useUsers(): UseUsersResult {
  const { user } = useAuth();
  const callerEmail = user?.email ?? '';

  // Supabase-first (~50ms), GAS fallback on cache miss or empty table
  const fetchFn = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const sb = await fetchUsersFromSupabase();
        if (sb && sb.users.length > 0) {
          return { data: sb, ok: true as const, error: null };
        }
      } catch { /* fall through to GAS */ }
      return fetchUsers(callerEmail, signal);
    },
    [callerEmail]
  );

  const { data, loading, error, refetch, lastFetched } =
    useApiData<UsersResponse>(fetchFn, !!callerEmail, 'users');

  const addUser = useCallback(
    async (
      email: string,
      role: string,
      clientName?: string,
      clientSheetId?: string
    ): Promise<{ success: boolean; error: string | null }> => {
      const result = await createApiUser(callerEmail, email, role, clientName, clientSheetId);
      if (result.ok) {
        refetch();
        return { success: true, error: null };
      }
      return { success: false, error: result.error };
    },
    [callerEmail, refetch]
  );

  const toggleActive = useCallback(
    async (
      email: string,
      active: boolean
    ): Promise<{ success: boolean; error: string | null }> => {
      const result = await updateApiUser(callerEmail, email, { active });
      if (result.ok) {
        refetch();
        return { success: true, error: null };
      }
      return { success: false, error: result.error };
    },
    [callerEmail, refetch]
  );

  const changeRole = useCallback(
    async (
      email: string,
      role: string
    ): Promise<{ success: boolean; error: string | null }> => {
      const result = await updateApiUser(callerEmail, email, { role });
      if (result.ok) {
        refetch();
        return { success: true, error: null };
      }
      return { success: false, error: result.error };
    },
    [callerEmail, refetch]
  );

  const updateUser = useCallback(
    async (
      email: string,
      updates: { active?: boolean; role?: string; clientName?: string; clientSheetId?: string; newEmail?: string }
    ): Promise<{ success: boolean; error: string | null }> => {
      const result = await updateApiUser(callerEmail, email, updates);
      if (result.ok) {
        refetch();
        return { success: true, error: null };
      }
      return { success: false, error: result.error };
    },
    [callerEmail, refetch]
  );

  const deleteUser = useCallback(
    async (email: string): Promise<{ success: boolean; error: string | null }> => {
      const result = await deleteApiUser(callerEmail, email);
      if (result.ok) {
        refetch();
        return { success: true, error: null };
      }
      return { success: false, error: result.error };
    },
    [callerEmail, refetch]
  );

  // Stabilize empty array reference
  const users = useMemo(() => data?.users ?? [], [data]);

  return {
    users,
    count: data?.count ?? 0,
    loading,
    error,
    refetch,
    lastFetched,
    addUser,
    toggleActive,
    changeRole,
    updateUser,
    deleteUser,
  };
}
