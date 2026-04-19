/**
 * usePriceListShares — CRUD for admin-managed shareable price list links.
 *
 * createShare / listShares / deactivateShare require authentication.
 * fetchPublicShare is a standalone async function that works with the
 * anon key (no auth required) for the public /rates/:shareId page.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export interface PriceListShare {
  id: string;
  shareId: string;
  tabs: string[];
  title: string;
  createdAt: string;
  expiresAt: string | null;
  active: boolean;
}

interface ShareRow {
  id: string;
  share_id: string;
  tabs: string[];
  title: string;
  created_by: string | null;
  created_at: string;
  expires_at: string | null;
  active: boolean;
}

function rowToShare(row: ShareRow): PriceListShare {
  return {
    id: row.id,
    shareId: row.share_id,
    tabs: row.tabs,
    title: row.title,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    active: row.active,
  };
}

export function usePriceListShares() {
  const { user } = useAuth();
  const [shares, setShares] = useState<PriceListShare[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchShares = useCallback(async () => {
    if (!user) { setLoading(false); return; }
    setError(null);
    const { data, error: err } = await supabase
      .from('price_list_shares')
      .select('*')
      .order('created_at', { ascending: false });
    if (err) { setError(err.message); }
    else { setShares(((data ?? []) as ShareRow[]).map(rowToShare)); }
    setLoading(false);
  }, [user]);

  useEffect(() => { void fetchShares(); }, [fetchShares]);

  const createShare = useCallback(async (
    tabs: string[],
    title?: string,
    expiresAt?: string | null,
  ): Promise<PriceListShare | null> => {
    const { data: sessionData } = await supabase.auth.getSession();
    const userId = sessionData.session?.user.id ?? null;
    const { data, error: err } = await supabase
      .from('price_list_shares')
      .insert({
        tabs,
        title: title?.trim() || 'Stride Logistics — Price List',
        expires_at: expiresAt ?? null,
        created_by: userId,
      })
      .select('*')
      .single();
    if (err || !data) {
      setError(err?.message ?? 'Failed to create share link');
      return null;
    }
    const share = rowToShare(data as ShareRow);
    setShares(prev => [share, ...prev]);
    return share;
  }, []);

  const deactivateShare = useCallback(async (id: string): Promise<boolean> => {
    const { error: err } = await supabase
      .from('price_list_shares')
      .update({ active: false })
      .eq('id', id);
    if (err) { setError(err.message); return false; }
    setShares(prev => prev.map(s => s.id === id ? { ...s, active: false } : s));
    return true;
  }, []);

  return useMemo(() => ({
    shares,
    loading,
    error,
    createShare,
    deactivateShare,
    refetch: fetchShares,
  }), [shares, loading, error, createShare, deactivateShare, fetchShares]);
}

/** Standalone fetch — no auth required. Used by PublicRates.tsx. */
export async function fetchPublicShare(shareId: string): Promise<PriceListShare | null> {
  const { data, error } = await supabase
    .from('price_list_shares')
    .select('*')
    .eq('share_id', shareId)
    .single();
  if (error || !data) return null;
  return rowToShare(data as ShareRow);
}
