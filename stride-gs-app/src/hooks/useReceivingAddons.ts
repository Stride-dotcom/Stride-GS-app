/**
 * useReceivingAddons — filters the service catalog to services flagged as
 * `show_as_receiving_addon`, sorted by display_order. Used by the Receiving
 * page (expandable rows) and the Item detail panel (live add/remove).
 *
 * Each addon exposes a `rateForClass(itemClass)` helper that picks the right
 * rate: class_based uses `rates[CLASS]`, flat uses `flatRate`.
 */
import { useMemo } from 'react';
import { useServiceCatalog, type CatalogService } from './useServiceCatalog';

export interface ReceivingAddon extends CatalogService {
  /** Returns the rate for a given item class, falling back to flatRate. */
  rateForClass: (itemClass: string) => number;
}

function makeRateForClass(svc: CatalogService) {
  return (itemClass: string): number => {
    if (svc.billing === 'flat') return Number(svc.flatRate || 0);
    const k = (itemClass || '').toUpperCase() as keyof typeof svc.rates;
    return Number(svc.rates?.[k] ?? 0);
  };
}

export interface UseReceivingAddonsResult {
  addons: ReceivingAddon[];
  loading: boolean;
  byCode: Record<string, ReceivingAddon>;
}

export function useReceivingAddons(): UseReceivingAddonsResult {
  const { services, loading } = useServiceCatalog();
  const addons = useMemo(() => {
    return services
      .filter(s => s.active && s.showAsReceivingAddon)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map(s => ({ ...s, rateForClass: makeRateForClass(s) }));
  }, [services]);
  const byCode = useMemo(() => {
    const m: Record<string, ReceivingAddon> = {};
    for (const a of addons) m[a.code] = a;
    return m;
  }, [addons]);
  return { addons, loading, byCode };
}
