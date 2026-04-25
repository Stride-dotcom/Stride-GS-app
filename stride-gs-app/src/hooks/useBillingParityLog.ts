/**
 * useBillingParityLog — live feed of per-event shadow-mode rate
 * comparisons from `public.billing_parity_log`. Written by GAS
 * (api_lookupRate_ via api_writeParityLog_) every time a billing event
 * fires; read here to power the Billing → Rate Parity tab's "Live
 * Billing Events" section.
 *
 * Refresh strategy: initial fetch + Realtime subscription so new rows
 * land within ~1-2s of the GAS write.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface BillingParityEvent {
  id: string;
  tenantId: string | null;
  clientName: string | null;
  itemId: string | null;
  svcCode: string | null;
  svcName: string | null;
  itemClass: string | null;
  sheetRate: number | null;
  supabaseRate: number | null;
  sheetTotal: number | null;
  supabaseTotal: number | null;
  qty: number;
  match: boolean | null;
  delta: number | null;
  eventSource: string | null;
  billingLedgerId: string | null;
  createdAt: string;
}

interface DbRow {
  id: string;
  tenant_id: string | null;
  client_name: string | null;
  item_id: string | null;
  svc_code: string | null;
  svc_name: string | null;
  item_class: string | null;
  sheet_rate: string | number | null;
  supabase_rate: string | number | null;
  sheet_total: string | number | null;
  supabase_total: string | number | null;
  qty: string | number | null;
  match: boolean | null;
  delta: string | number | null;
  event_source: string | null;
  billing_ledger_id: string | null;
  created_at: string;
}

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function rowToEvent(r: DbRow): BillingParityEvent {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    clientName: r.client_name,
    itemId: r.item_id,
    svcCode: r.svc_code,
    svcName: r.svc_name,
    itemClass: r.item_class,
    sheetRate: num(r.sheet_rate),
    supabaseRate: num(r.supabase_rate),
    sheetTotal: num(r.sheet_total),
    supabaseTotal: num(r.supabase_total),
    qty: num(r.qty) ?? 1,
    match: r.match,
    delta: num(r.delta),
    eventSource: r.event_source,
    billingLedgerId: r.billing_ledger_id,
    createdAt: r.created_at,
  };
}

export interface UseBillingParityLogResult {
  events: BillingParityEvent[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const DEFAULT_LIMIT = 200;

export function useBillingParityLog(limit = DEFAULT_LIMIT): UseBillingParityLogResult {
  const [events, setEvents] = useState<BillingParityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const refetch = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error: err } = await supabase
      .from('billing_parity_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (!mountedRef.current) return;
    if (err) { setError(err.message); setEvents([]); setLoading(false); return; }
    setEvents(((data ?? []) as DbRow[]).map(rowToEvent));
    setLoading(false);
  }, [limit]);

  useEffect(() => { void refetch(); }, [refetch]);

  // Realtime: prepend new rows as they land so the feed animates without
  // a manual refresh. crypto.randomUUID() guarantees a strictly unique
  // channel name per mount so concurrent admin sessions can't collide on
  // the registry (Math.random had a non-zero collision rate that
  // occasionally caused subscription leaks when two tabs opened at once).
  useEffect(() => {
    const channelName = `billing_parity_log_rt_${crypto.randomUUID()}`;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'billing_parity_log' },
        (payload) => {
          const next = payload.new as unknown as DbRow;
          if (!next) return;
          setEvents(prev => [rowToEvent(next), ...prev].slice(0, limit));
        })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [limit]);

  return useMemo(() => ({ events, loading, error, refetch }),
    [events, loading, error, refetch]);
}
