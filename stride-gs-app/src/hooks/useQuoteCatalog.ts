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
import { entityEvents } from '../lib/entityEvents';
import { useServiceCatalog, type CatalogService } from './useServiceCatalog';
import type { ClassDef, TaxArea, CoverageOption, CoverageMethod } from '../lib/quoteTypes';
import {
} from '../lib/quoteDefaults';

interface ItemClassRow {
  id: string;
  name: string;
  display_order: number;
  active: boolean;
  // Session 74: cubic-foot size from the Price List → Classes page.
  // Storage math needs this; other services ignore it.
  storage_size: number | string | null;
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
  // storage_size arrives as numeric text from Supabase's NUMERIC type;
  // coerce via Number() then clamp NaN to 0 so downstream math never
  // produces NaN dollars. A class with size=0 renders storage as $0,
  // which is accurate — charging for an unconfigured class would be
  // worse than showing zero.
  const sizeRaw = r.storage_size;
  const size = sizeRaw == null ? 0 : Number(sizeRaw);
  return {
    id: r.id,
    name: r.name,
    order: r.display_order,
    active: r.active,
    storageSize: Number.isFinite(size) ? size : 0,
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

    // Single source of truth = the price list. If the table is empty
    // we render an empty array and let the consumer surface a
    // "pricing data unavailable" state — silently using a hardcoded
    // fallback is what got us out of sync in the past.
    setClasses(
      !classesRes.error && Array.isArray(classesRes.data)
        ? (classesRes.data as ItemClassRow[]).map(rowToClass)
        : []
    );
    setTaxAreas(
      !taxRes.error && Array.isArray(taxRes.data)
        ? (taxRes.data as TaxAreaRow[]).map(rowToTaxArea)
        : []
    );
    setCoverageOptions(
      !coverageRes.error && Array.isArray(coverageRes.data)
        ? (coverageRes.data as CoverageOptionRow[]).map(rowToCoverage)
        : []
    );

    setLoading(false);
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Realtime subscriptions — any admin edit on /price-list fans out.
  useEffect(() => {
    // Session 74: Realtime via central channel (see useSupabaseRealtime).
    // All three sub-tables (item_classes, tax_areas, coverage_options)
    // emit the shared 'quote_catalog' entity event.
    return entityEvents.subscribe((type) => {
      if (type === 'quote_catalog') void refetch();
    });
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
