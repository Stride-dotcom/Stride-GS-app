/**
 * usePricing — Fetches price list and class map from the Stride API.
 *
 * Provides both raw API data and convenience lookups for rates by
 * service code + class size.
 */
import { useMemo } from 'react';
import { fetchPricing } from '../lib/api';
import type { ApiPriceRow, ApiClassRow, PricingResponse } from '../lib/api';
import { useApiData } from './useApiData';

export type ClassSize = 'XS' | 'S' | 'M' | 'L' | 'XL';

export interface UsePricingResult {
  /** Raw price list rows */
  priceList: ApiPriceRow[];
  /** Raw class map rows */
  classMap: ApiClassRow[];
  /** Look up rate by service code and class size */
  getRate: (serviceCode: string, classSize: ClassSize) => number | null;
  /** Look up time estimate by service code and class size */
  getTime: (serviceCode: string, classSize: ClassSize) => number | null;
  /** Look up cubic volume by class name */
  getCubicVolume: (className: string) => number | null;
  /** All service codes available */
  serviceCodes: string[];
  /** All class names available */
  classNames: string[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
  lastFetched: Date | null;
}

export function usePricing(autoFetch = true): UsePricingResult {
  const { data, loading, error, refetch, lastFetched } = useApiData<PricingResponse>(
    fetchPricing,
    autoFetch,
    'pricing'
  );

  const priceList = data?.priceList ?? [];
  const classMap = data?.classMap ?? [];

  // Build lookup maps
  const priceMap = useMemo(() => {
    const map = new Map<string, ApiPriceRow>();
    for (const row of priceList) {
      const code = String(row['Service Code'] || '').trim();
      if (code) map.set(code, row);
    }
    return map;
  }, [priceList]);

  const classVolumeMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of classMap) {
      const cls = String(row.Class || '').trim();
      if (cls) map.set(cls, Number(row['Cubic Volume']) || 0);
    }
    return map;
  }, [classMap]);

  const getRate = useMemo(
    () => (serviceCode: string, classSize: ClassSize): number | null => {
      const row = priceMap.get(serviceCode);
      if (!row) return null;
      const key = `${classSize} Rate` as keyof ApiPriceRow;
      const val = row[key];
      return typeof val === 'number' ? val : null;
    },
    [priceMap]
  );

  const getTime = useMemo(
    () => (serviceCode: string, classSize: ClassSize): number | null => {
      const row = priceMap.get(serviceCode);
      if (!row) return null;
      const key = `${classSize} Time` as keyof ApiPriceRow;
      const val = row[key];
      return typeof val === 'number' ? val : null;
    },
    [priceMap]
  );

  const getCubicVolume = useMemo(
    () => (className: string): number | null => {
      return classVolumeMap.get(className) ?? null;
    },
    [classVolumeMap]
  );

  const serviceCodes = useMemo(
    () => priceList.map(r => String(r['Service Code'] || '').trim()).filter(Boolean),
    [priceList]
  );

  const classNames = useMemo(
    () => classMap.map(r => String(r.Class || '').trim()).filter(Boolean),
    [classMap]
  );

  return {
    priceList,
    classMap,
    getRate,
    getTime,
    getCubicVolume,
    serviceCodes,
    classNames,
    loading,
    error,
    refetch,
    lastFetched,
  };
}
