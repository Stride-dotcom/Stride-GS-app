/**
 * useClientTcStatus — resolves which clients have a signed T&C on file.
 *
 * Queries `client_intakes WHERE status = 'activated'` (admin RLS allows)
 * and builds a Map<email, { signedAt, pdfPath }> for O(1) lookup on
 * the Settings → Clients tab.
 *
 * We don't need a migration — the data is already in client_intakes.
 * For clients created before the intake system, the map returns nothing
 * and the "No T&C on file" badge prompts the admin to resend a T&C link.
 *
 * v2 — refetches on 'client' entityEvents. When staff applies a refresh
 * intake (which flips status pending → activated AND emits 'client'),
 * the badge flips from "No T&C on file" → "✓ T&C Signed" without
 * requiring a page reload. Pre-v2, the hook only ran on mount and the
 * badge stayed stale until the user hard-refreshed.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { entityEvents } from '../lib/entityEvents';

export interface ClientTcRecord {
  signedAt: string;
  pdfPath: string | null;
}

export function useClientTcStatus(): {
  tcMap: Map<string, ClientTcRecord>;
  loading: boolean;
} {
  const [tcMap, setTcMap] = useState<Map<string, ClientTcRecord>>(new Map());
  const [loading, setLoading] = useState(true);

  const fetchTcMap = useCallback(async () => {
    const { data } = await supabase
      .from('client_intakes')
      .select('email, signed_at, signed_tc_pdf_path')
      .eq('status', 'activated');
    const m = new Map<string, ClientTcRecord>();
    for (const row of (data ?? []) as Array<{
      email: string | null;
      signed_at: string | null;
      signed_tc_pdf_path: string | null;
    }>) {
      const email = row.email?.toLowerCase();
      if (email && row.signed_at) {
        m.set(email, {
          signedAt: row.signed_at,
          pdfPath: row.signed_tc_pdf_path ?? null,
        });
      }
    }
    setTcMap(m);
    setLoading(false);
  }, []);

  // Initial fetch on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await fetchTcMap();
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [fetchTcMap]);

  // Refetch when any client-related event fires. The IntakesPanel emits
  // 'client' after a successful refresh-mode activation; this picks that
  // up and flips the badge without a page reload.
  useEffect(() => {
    const unsub = entityEvents.subscribe((entityType) => {
      if (entityType === 'client') {
        void fetchTcMap();
      }
    });
    return unsub;
  }, [fetchTcMap]);

  return { tcMap, loading };
}
