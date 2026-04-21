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
 */
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

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

  useEffect(() => {
    let cancelled = false;

    void supabase
      .from('client_intakes')
      .select('email, signed_at, signed_tc_pdf_path')
      .eq('status', 'activated')
      .then(({ data }) => {
        if (cancelled) return;
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
      });

    return () => { cancelled = true; };
  }, []);

  return { tcMap, loading };
}
