/**
 * useQuoteCatalog — combined fetcher for the full Quote Tool catalog.
 *
 * Reads from four Supabase tables (session 73):
 *   - public.service_catalog   (via useServiceCatalog — already memoized there)
 *   - public.item_classes
 *   - public.tax_areas
 *   - public.coverage_options
 *
 * Falls back to the compiled-in quoteDefaults when a table is empty or the
 * Supabase query fails. Realtime channel refetches on any row change so edits
 * on /price-list propagate immediately to open Quote Tool sessions.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useServiceCatalog, type CatalogService } from './useServiceCatalog';
import type { ClassDef, TaxArea, CoverageOption, CoverageMethod } from '../lib/quoteTypes';
import {
  DEFAULT_CLASSES, DEFAULT_TAX_AREAS, DEFAULT_COVERAGE_OPTIONS,
} from '../lib/quoteDefaults';

interface ItemClassRow {
  id: string;
  name: string;
  display_order: number;
  active: boolean;
}

interface TaxAreaRow {
  id: string;
  name: string;
  rate: number | string;
  active: boolean;
  display_order: number;
}

interface CoverageOptionRow {
  id: string;
  name: string;
  calc_type: string;
  rate: number | string;
  taxable: boolean | null;
  note: string | null;
  active: boolean;
  display_order: number;
}

function rowToClass(r: ItemClassRow): ClassDef {
  return {
    id: r.id,
    name: r.name,
    order: r.display_order,
    active: r.active,
  };
}

function rowToTaxArea(r: TaxAreaRow): TaxArea {
  return {
    id: r.id,
    name: r.name,
    rate: Number(r.rate ?? 0),
  };
}

function calcTypeToCoverageMethod(t: string): CoverageMethod {
  if (t === 'per_lb' || t === 'percent_declared' || t === 'flat' || t === 'included') return t;
  return 'flat';
}

function rowToCoverage(r: CoverageOptionRow): CoverageOption {
  return {
    id: r.id,
    name: r.name,
    description: r.note ?? '',
    method: calcTypeToCoverageMethod(r.calc_type),
    rate: Number(r.rate ?? 0),
    included: r.id === 'standard',
  };
}

export interface UseQuoteCatalogResult {
  services: CatalogService[];
  classes: ClassDef[];
  taxAreas: TaxArea[];
  coverageOptions: CoverageOption[];
  loading: boolean;
  /** 'supabase' when at least the service list loaded; 'fallback' otherwise. */
  source: 'supabase' | 'fallback';
  refetch: () => Promise<void>;
}

export function useQuoteCatalog(): UseQuoteCatalogResult {
  const sbServices = useServiceCatalog();

  const [classes, setClasses]               = useState<ClassDef[]>([]);
  const [taxAreas, setTaxAreas]             = useState<TaxArea[]>([]);
  const [coverageOptions, setCoverageOptions] = useState<CoverageOption[]>([]);
  const [loading, setLoading]               = useState(true);

  const refetch = useCallback(async () => {
    const [classesRes, taxRes, coverageRes] = await Promise.all([
      supabase.from('item_classes').select('*').order('display_order', { ascending: true }),
      supabase.from('tax_areas').select('*').order('display_order', { ascending: true }),
      supabase.from('coverage_options').select('*').order('display_order', { ascending: true }),
    ]);

    if (!classesRes.error && Array.isArray(classesRes.data) && classesRes.data.length > 0) {
      setClasses((classesRes.data as ItemClassRow[]).map(rowToClass));
    } else {
      setClasses(DEFAULT_CLASSES);
    }

    if (!taxRes.error && Array.isArray(taxRes.data) && taxRes.data.length > 0) {
      setTaxAreas((taxRes.data as TaxAreaRow[]).map(rowToTaxArea));
    } else {
      setTaxAreas(DEFAULT_TAX_AREAS);
    }

    if (!coverageRes.error && Array.isArray(coverageRes.data) && coverageRes.data.length > 0) {
      setCoverageOptions((coverageRes.data as CoverageOptionRow[]).map(rowToCoverage));
    } else {
      setCoverageOptions(DEFAULT_COVERAGE_OPTIONS);
    }

    setLoading(false);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Realtime subscriptions — any admin edit on /price-list fans out.
  useEffect(() => {
    const channel = supabase
      .channel('quote_catalog_meta')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'item_classes' },     () => { void refetch(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tax_areas' },        () => { void refetch(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'coverage_options' }, () => { void refetch(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [refetch]);

  const source: 'supabase' | 'fallback' =
    sbServices.services.length > 0 ? 'supabase' : 'fallback';

  return useMemo(() => ({
    services: sbServices.services,
    classes,
    taxAreas,
    coverageOptions,
    loading: loading || sbServices.loading,
    source,
    refetch,
  }), [sbServices.services, sbServices.loading, classes, taxAreas, coverageOptions, loading, source, refetch]);
}
