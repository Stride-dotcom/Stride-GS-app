/**
 * useCoverageOptions — CRUD for `public.coverage_options` + realtime.
 *
 * This is the same table useQuoteCatalog reads (it powers the Quote
 * Tool's coverage picker). We expose it with write capability so the
 * Price List "Coverage" section can edit the authoritative rates in
 * one place — and every downstream page (Quote Tool, delivery flows,
 * public rate sheet) picks up the new numbers on its next render
 * because they all read the same table.
 *
 * Schema (see 20260419_quote_catalog_classes_tax_coverage.sql):
 *   id, name, calc_type, rate, taxable, note, active, display_order
 *
 * calc_type values:
 *   'per_lb'              — $X per pound of net weight (Standard Valuation)
 *   'percent_declared'    — X% of declared value (Replacement tiers + Storage)
 *   'flat'                — fixed $X per event
 *   'included'            — no-charge inclusion marker
 * Rate semantics depend on calc_type. We surface both rate and note so
 * operators can clarify billing cadence (monthly vs per-shipment) in
 * the note where calc_type alone doesn't carry it.
 *
 * RLS: authenticated read; admin write. Realtime via the central
 * quote_catalog entityEvents key (same bus useQuoteCatalog listens on)
 * so an edit here fans out to open Quote Tool sessions instantly.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { entityEvents } from '../lib/entityEvents';

export type CoverageCalcType = 'per_lb' | 'percent_declared' | 'flat' | 'included';

export interface CoverageOption {
  id: string;
  name: string;
  calcType: CoverageCalcType;
  rate: number;
  taxable: boolean;
  note: string | null;
  active: boolean;
  displayOrder: number;
}

interface DbRow {
  id: string;
  name: string | null;
  calc_type: string | null;
  rate: string | number | null;
  taxable: boolean | null;
  note: string | null;
  active: boolean | null;
  display_order: number | null;
}

function num(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function normalizeCalcType(t: string | null): CoverageCalcType {
  if (t === 'per_lb' || t === 'percent_declared' || t === 'flat' || t === 'included') return t;
  return 'flat';
}

function rowToOption(r: DbRow): CoverageOption {
  return {
    id: r.id,
    name: r.name ?? '',
    calcType: normalizeCalcType(r.calc_type),
    rate: num(r.rate),
    taxable: r.taxable === true,
    note: r.note,
    active: r.active !== false,
    displayOrder: r.display_order ?? 0,
  };
}

export interface UseCoverageOptionsResult {
  options: CoverageOption[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  update: (id: string, patch: Partial<Pick<CoverageOption, 'name' | 'calcType' | 'rate' | 'taxable' | 'note' | 'active' | 'displayOrder'>>) => Promise<boolean>;
}

export function useCoverageOptions(): UseCoverageOptionsResult {
  const [options, setOptions] = useState<CoverageOption[]>([]);
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
      .from('coverage_options')
      .select('*')
      .order('display_order', { ascending: true });
    if (!mountedRef.current) return;
    if (err) { setError(err.message); setOptions([]); setLoading(false); return; }
    setOptions(((data ?? []) as DbRow[]).map(rowToOption));
    setLoading(false);
  }, []);

  useEffect(() => { void refetch(); }, [refetch]);

  // Share the quote_catalog realtime key with useQuoteCatalog — a single
  // admin edit here fans out to every Quote Tool session without each
  // hook needing its own channel subscription.
  useEffect(() => {
    return entityEvents.subscribe((type) => {
      if (type === 'quote_catalog') void refetch();
    });
  }, [refetch]);

  const update = useCallback(async (id: string, patch: Partial<Pick<CoverageOption, 'name' | 'calcType' | 'rate' | 'taxable' | 'note' | 'active' | 'displayOrder'>>): Promise<boolean> => {
    const row: Record<string, unknown> = {};
    if (patch.name !== undefined)         row.name          = patch.name;
    if (patch.calcType !== undefined)     row.calc_type     = patch.calcType;
    if (patch.rate !== undefined)         row.rate          = patch.rate;
    if (patch.taxable !== undefined)      row.taxable       = patch.taxable;
    if (patch.note !== undefined)         row.note          = patch.note;
    if (patch.active !== undefined)       row.active        = patch.active;
    if (patch.displayOrder !== undefined) row.display_order = patch.displayOrder;
    if (Object.keys(row).length === 0) return true;

    const { data, error: err } = await supabase
      .from('coverage_options')
      .update(row)
      .eq('id', id)
      .select('*')
      .single();
    if (err) { setError(err.message); return false; }
    if (data) {
      const updated = rowToOption(data as DbRow);
      setOptions(prev => prev.map(o => o.id === id ? updated : o));
    }
    return true;
  }, []);

  return useMemo(() => ({ options, loading, error, refetch, update }),
    [options, loading, error, refetch, update]);
}

/**
 * Small helper — formats a coverage option's rate for read-only display.
 * Used by Price List, PublicRates, and Excel export so the format is
 * consistent everywhere.
 */
export function formatCoverageRate(o: CoverageOption): string {
  if (o.calcType === 'per_lb')           return `$${o.rate.toFixed(2)} / lb`;
  if (o.calcType === 'percent_declared') return `${o.rate.toFixed(2)}% of declared value`;
  if (o.calcType === 'flat')             return `$${o.rate.toFixed(2)} flat`;
  if (o.calcType === 'included')         return 'Included';
  return String(o.rate);
}
