/**
 * useDefaultTaxRate — the system-wide default sales-tax rate.
 *
 * Reads the is_default row from public.tax_jurisdictions (managed in
 * Settings → Pricing → Tax Rates). Replaces the Kent 10.4% literals
 * that were hardcoded in CreateDeliveryOrderModal and
 * PublicServiceRequest. Per-client overrides (clients.tax_rate_pct)
 * still take precedence over this — this is only the fallback.
 *
 * Fails soft: if the fetch errors (e.g. anon RLS on the public form,
 * or Supabase unreachable) the hook returns FALLBACK_TAX_RATE so a
 * tax line is never silently dropped. The public form already treated
 * 10.4 as the safe assumption; this keeps that behavior.
 */
import { useEffect, useState } from 'react';
import { fetchDefaultTaxJurisdiction } from '../lib/supabaseQueries';

/** Last-resort rate when no default jurisdiction can be read. Kent, WA combined. */
export const FALLBACK_TAX_RATE = 10.4;
export const FALLBACK_TAX_CITY = 'Kent';
export const FALLBACK_TAX_STATE = 'WA';

export interface DefaultTaxRate {
  rate: number;
  city: string;
  state: string;
  /** "Kent, WA 10.4%" — ready for inline display. */
  label: string;
  loading: boolean;
  /** true when the value is the hardcoded fallback, not a fetched row. */
  isFallback: boolean;
}

export function useDefaultTaxRate(): DefaultTaxRate {
  const [state, setState] = useState<Omit<DefaultTaxRate, 'label'>>({
    rate: FALLBACK_TAX_RATE,
    city: FALLBACK_TAX_CITY,
    state: FALLBACK_TAX_STATE,
    loading: true,
    isFallback: true,
  });

  useEffect(() => {
    let alive = true;
    fetchDefaultTaxJurisdiction()
      .then(j => {
        if (!alive) return;
        // >= 0: a configured 0% default (e.g. an out-of-state, no-sales-
        // tax jurisdiction) is a deliberate setting, not a fetch failure —
        // honor it instead of snapping back to the 10.4 fallback.
        if (j && Number.isFinite(j.ratePct) && j.ratePct >= 0) {
          setState({
            rate: j.ratePct,
            city: j.city,
            state: j.state,
            loading: false,
            isFallback: false,
          });
        } else {
          setState(s => ({ ...s, loading: false }));
        }
      })
      .catch(() => {
        if (alive) setState(s => ({ ...s, loading: false }));
      });
    return () => { alive = false; };
  }, []);

  return {
    ...state,
    label: `${state.city}, ${state.state} ${state.rate}%`,
  };
}
