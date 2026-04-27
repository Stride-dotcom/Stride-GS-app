/**
 * useClientInsurance — CRUD + realtime for a single client's
 * `client_insurance` row, plus a read of that client's billing-mirror
 * history for svc_code='INSURANCE'.
 *
 * Scoped to one tenant_id (the client's spreadsheet id). Returns the
 * row (or null if not yet seeded), a billing-history array, and
 * mutators for updating declared value / toggling active / cancelling.
 *
 * Realtime: subscribes to client_insurance UPDATE events for this
 * tenant so two admins editing concurrently converge without a manual
 * refresh. Billing history doesn't subscribe — it's low-frequency
 * (one row per month added by the daily cron).
 *
 * The daily Postgres cron (see 20260420160001_insurance_auto_billing_cron.sql)
 * is the only writer to billing rows with svc_code='INSURANCE'. This
 * hook never inserts into billing — it only reads the mirror rows.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface ClientInsuranceRow {
  id: string;
  tenantId: string;
  clientName: string;
  coverageType: 'own_policy' | 'stride_coverage';
  declaredValue: number;
  monthlyRatePer100k: number;
  inceptionDate: string;        // YYYY-MM-DD
  nextBillingDate: string;      // YYYY-MM-DD
  lastBilledAt: string | null;  // ISO timestamp
  active: boolean;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InsuranceBillingHistoryRow {
  ledgerRowId: string | null;
  date: string;                 // YYYY-MM-DD (billing.date is text)
  status: string;               // Unbilled / Invoiced / Billed / Void
  qty: number;                  // declared / 100000 snapshot at bill time
  rate: number;                 // monthly charge
  total: number;                // same as rate for a 1-line INSURANCE row
  invoiceNumber: string | null;
  invoiceUrl: string | null;
}

interface InsuranceDbRow {
  id: string;
  tenant_id: string;
  client_name: string;
  coverage_type: string;
  declared_value: number | string;
  monthly_rate_per_100k: number | string;
  inception_date: string;
  next_billing_date: string;
  last_billed_at: string | null;
  active: boolean | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToInsurance(r: InsuranceDbRow): ClientInsuranceRow {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    clientName: r.client_name,
    coverageType: (r.coverage_type as ClientInsuranceRow['coverageType']) ?? 'stride_coverage',
    declaredValue: Number(r.declared_value ?? 0) || 0,
    monthlyRatePer100k: Number(r.monthly_rate_per_100k ?? 300) || 300,
    inceptionDate: r.inception_date,
    nextBillingDate: r.next_billing_date,
    lastBilledAt: r.last_billed_at,
    active: r.active !== false,
    cancelledAt: r.cancelled_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface UseClientInsuranceResult {
  row: ClientInsuranceRow | null;
  history: InsuranceBillingHistoryRow[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /** Create a fresh row. Only needed when intake activation skipped the
   *  seed (own-policy intakes, or pre-session-77 intakes with no
   *  declared value). No-op if a row already exists. */
  seed: (opts: { declaredValue: number; coverageType?: 'stride_coverage' | 'own_policy' }) => Promise<boolean>;
  /** Update declared_value. Takes effect on the next scheduled billing. */
  updateDeclaredValue: (newValue: number) => Promise<boolean>;
  /** Pause/resume auto-billing without deleting history. */
  setActive: (active: boolean) => Promise<boolean>;
  /** Hard-cancel — sets active=false and stamps cancelled_at=now. */
  cancel: () => Promise<boolean>;
}

export function useClientInsurance(tenantId: string | undefined | null): UseClientInsuranceResult {
  const [row, setRow] = useState<ClientInsuranceRow | null>(null);
  const [history, setHistory] = useState<InsuranceBillingHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refetch = useCallback(async () => {
    if (!tenantId) {
      setRow(null); setHistory([]); setLoading(false); setError(null);
      return;
    }
    setLoading(true); setError(null);
    const [iRes, bRes] = await Promise.all([
      supabase.from('client_insurance')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle(),
      supabase.from('billing')
        .select('ledger_row_id,date,status,qty,rate,total,invoice_number,invoice_url')
        .eq('tenant_id', tenantId)
        .eq('svc_code', 'INSURANCE')
        .order('date', { ascending: false })
        .limit(50),
    ]);
    if (!mountedRef.current) return;
    if (iRes.error) { setError(iRes.error.message); setRow(null); }
    else setRow(iRes.data ? rowToInsurance(iRes.data as InsuranceDbRow) : null);
    if (!bRes.error && Array.isArray(bRes.data)) {
      setHistory(bRes.data.map(b => ({
        ledgerRowId:   (b.ledger_row_id as string | null) ?? null,
        date:          String(b.date ?? ''),
        status:        String(b.status ?? ''),
        qty:           Number(b.qty ?? 0) || 0,
        rate:          Number(b.rate ?? 0) || 0,
        total:         Number(b.total ?? 0) || 0,
        invoiceNumber: (b.invoice_number as string | null) ?? null,
        invoiceUrl:    (b.invoice_url as string | null) ?? null,
      })));
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { void refetch(); }, [refetch]);

  useEffect(() => {
    if (!tenantId) return;
    const ch = supabase
      .channel(`client_insurance_${tenantId}_${Math.random().toString(36).slice(2, 8)}`)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'client_insurance', filter: `tenant_id=eq.${tenantId}` },
        () => { void refetch(); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [tenantId, refetch]);

  const seed = useCallback(async (opts: { declaredValue: number; coverageType?: 'stride_coverage' | 'own_policy' }): Promise<boolean> => {
    if (!tenantId) return false;
    if (row) return false; // already seeded

    // Insurance rate must come from service_catalog.INSURANCE — no
    // fallback. If the row is missing or has a null flat_rate, refuse
    // to seed; the admin needs to set the rate in Settings → Pricing
    // first. Silently writing $300 (the legacy hardcoded default)
    // would lock historical clients onto a stale rate the admin
    // never approved.
    const { data: svc } = await supabase.from('service_catalog')
      .select('flat_rate').eq('code', 'INSURANCE').maybeSingle();
    const rate = svc && typeof svc.flat_rate === 'number' ? svc.flat_rate : null;
    if (rate == null) {
      console.error('[useClientInsurance.seed] No INSURANCE rate in service_catalog — refusing to seed');
      return false;
    }

    const today = new Date();
    const next = new Date(today);
    next.setDate(next.getDate() + 30);
    const toDateStr = (d: Date) => d.toISOString().slice(0, 10);

    // Caller should update client_name via a follow-up supabase call if
    // they have a better value; this path is only hit when row is null
    // (the early-return above guarantees it).
    const { error: err } = await supabase.from('client_insurance').upsert({
      tenant_id:             tenantId,
      client_name:           '',
      coverage_type:         opts.coverageType ?? 'stride_coverage',
      declared_value:        opts.declaredValue,
      monthly_rate_per_100k: rate,
      inception_date:        toDateStr(today),
      next_billing_date:     toDateStr(next),
      active:                true,
    }, { onConflict: 'tenant_id' });
    if (err) { setError(err.message); return false; }
    await refetch();
    return true;
  }, [tenantId, row, refetch]);

  const updateDeclaredValue = useCallback(async (newValue: number): Promise<boolean> => {
    if (!tenantId || !row) return false;
    const { error: err } = await supabase.from('client_insurance')
      .update({ declared_value: newValue })
      .eq('tenant_id', tenantId);
    if (err) { setError(err.message); return false; }
    await refetch();
    return true;
  }, [tenantId, row, refetch]);

  const setActive = useCallback(async (active: boolean): Promise<boolean> => {
    if (!tenantId || !row) return false;
    const { error: err } = await supabase.from('client_insurance')
      .update({ active })
      .eq('tenant_id', tenantId);
    if (err) { setError(err.message); return false; }
    await refetch();
    return true;
  }, [tenantId, row, refetch]);

  const cancel = useCallback(async (): Promise<boolean> => {
    if (!tenantId || !row) return false;
    const { error: err } = await supabase.from('client_insurance')
      .update({ active: false, cancelled_at: new Date().toISOString() })
      .eq('tenant_id', tenantId);
    if (err) { setError(err.message); return false; }
    await refetch();
    return true;
  }, [tenantId, row, refetch]);

  return useMemo(() => ({
    row, history, loading, error, refetch, seed, updateDeclaredValue, setActive, cancel,
  }), [row, history, loading, error, refetch, seed, updateDeclaredValue, setActive, cancel]);
}
