/**
 * useQuoteStore — Quote Tool data layer.
 *
 * Session 73 — service catalog is now sourced from Supabase
 * (public.service_catalog via useServiceCatalog) instead of per-user
 * localStorage. Quotes themselves, plus tax areas / classes / coverage
 * options / settings, remain in localStorage (per-user).
 *
 * Fallback: if Supabase returns no services (empty table, auth issue,
 * offline), we fall back to DEFAULT_SERVICES from quoteDefaults.ts so
 * the Quote Tool still loads. Edits to services happen on /price-list,
 * NOT inside the Quote Tool — the Quote Tool's catalog tab is read-only.
 */
import { useState, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type {
  Quote, QuoteStatus, QuoteCatalog, QuoteStoreSettings, ClassLine, ServiceDef,
} from '../lib/quoteTypes';
import {
  DEFAULT_SERVICES, DEFAULT_CLASSES, DEFAULT_TAX_AREAS,
  DEFAULT_COVERAGE_OPTIONS, DEFAULT_SETTINGS,
} from '../lib/quoteDefaults';
import { useServiceCatalog, type CatalogService } from './useServiceCatalog';

function storageKey(email: string, suffix: string) {
  return `stride_quotes_${email}_${suffix}`;
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

function saveJson(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

function newQuoteId(): string {
  return crypto.randomUUID();
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function createBlankQuote(settings: QuoteStoreSettings, classes: QuoteCatalog['classes'], taxAreas: QuoteCatalog['taxAreas']): Quote {
  const today = todayISO();
  const num = settings.nextQuoteNumber;
  const classLines: ClassLine[] = classes.filter(c => c.active).map(c => ({ classId: c.id, qty: 0 }));
  const defaultArea = taxAreas.find(a => a.id === settings.defaultTaxAreaId) ?? taxAreas[0];
  return {
    id: newQuoteId(),
    number: `${settings.quotePrefix}-${String(num).padStart(4, '0')}`,
    status: 'draft',
    client: '', clientSheetId: '', project: '', address: '',
    date: today, expiration: addDays(today, settings.defaultExpirationDays),
    ratesLocked: false,
    classLines,
    matrixCells: {}, storageCells: {},
    storage: { months: settings.defaultStorageMonths, days: 0 },
    otherServices: {},
    discount: { type: 'percent', value: 0, reason: '' },
    taxEnabled: true,
    taxRate: defaultArea?.rate ?? 10.4,
    taxAreaId: defaultArea?.id ?? 'kent',
    coverage: { typeId: 'standard', declaredValue: 0, weightLbs: 0, costOverride: null },
    customerNotes: '', internalNotes: '',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

/**
 * Map a Supabase CatalogService to the Quote Tool's ServiceDef shape.
 * The Quote Tool derives `isStorage` from category (rather than a flag)
 * and matrix-ordering from display_order.
 */
function catalogToServiceDef(c: CatalogService): ServiceDef {
  return {
    id: c.code,              // use code as stable ID (matches legacy behavior where id===code for most defaults)
    code: c.code,
    name: c.name,
    // ServiceCategory in quoteTypes is narrower — Fabric Protection is accepted via union widening in the types update.
    category: (['Warehouse','Storage','Shipping','Assembly','Repair','Labor','Admin','Delivery'].includes(c.category)
      ? c.category
      : 'Admin') as ServiceDef['category'],
    unit: c.unit,
    billing: c.billing,
    isStorage: c.category === 'Storage',
    taxable: c.taxable,
    active: c.active,
    flatRate: c.flatRate,
    rates: {
      XS:  c.rates.XS  ?? 0,
      S:   c.rates.S   ?? 0,
      M:   c.rates.M   ?? 0,
      L:   c.rates.L   ?? 0,
      XL:  c.rates.XL  ?? 0,
      XXL: c.rates.XXL ?? 0,
    },
    showInMatrix: c.showInMatrix,
    matrixOrder: c.displayOrder,
  };
}

export function useQuoteStore() {
  const { user } = useAuth();
  const email = user?.email || '_anon';
  const keysRef = useRef({
    quotes: storageKey(email, 'list'),
    nonSvcCatalog: storageKey(email, 'catalog_v2'),
    settings: storageKey(email, 'settings'),
  });
  keysRef.current = {
    quotes: storageKey(email, 'list'),
    nonSvcCatalog: storageKey(email, 'catalog_v2'),
    settings: storageKey(email, 'settings'),
  };

  // ── Supabase-backed service catalog ──────────────────────────────────
  const sbCatalog = useServiceCatalog();

  // ── Local (classes, tax areas, coverage) — not yet in Supabase ───────
  type NonServiceCatalog = Omit<QuoteCatalog, 'services'>;
  const [nonSvcCatalog, setNonSvcCatalogRaw] = useState<NonServiceCatalog>(() => loadJson(keysRef.current.nonSvcCatalog, {
    classes: DEFAULT_CLASSES,
    taxAreas: DEFAULT_TAX_AREAS,
    coverageOptions: DEFAULT_COVERAGE_OPTIONS,
  }));

  const [quotes, setQuotesRaw] = useState<Quote[]>(() => loadJson(keysRef.current.quotes, []));
  const [settings, setSettingsRaw] = useState<QuoteStoreSettings>(() => loadJson(keysRef.current.settings, DEFAULT_SETTINGS));

  const setQuotes = useCallback((updater: Quote[] | ((prev: Quote[]) => Quote[])) => {
    setQuotesRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveJson(keysRef.current.quotes, next);
      return next;
    });
  }, []);

  const setNonSvcCatalog = useCallback((updater: NonServiceCatalog | ((prev: NonServiceCatalog) => NonServiceCatalog)) => {
    setNonSvcCatalogRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveJson(keysRef.current.nonSvcCatalog, next);
      return next;
    });
  }, []);

  const setSettings = useCallback((updater: QuoteStoreSettings | ((prev: QuoteStoreSettings) => QuoteStoreSettings)) => {
    setSettingsRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveJson(keysRef.current.settings, next);
      return next;
    });
  }, []);

  // ── Derived catalog — merge Supabase services with local classes/tax/coverage ──
  const services: ServiceDef[] = useMemo(() => {
    if (sbCatalog.services.length > 0) {
      return sbCatalog.services
        .map(catalogToServiceDef)
        .sort((a, b) => a.matrixOrder - b.matrixOrder);
    }
    // Fallback: Supabase unreachable OR still loading AND no services returned
    return DEFAULT_SERVICES;
  }, [sbCatalog.services]);

  const catalog: QuoteCatalog = useMemo(() => ({
    services,
    classes: nonSvcCatalog.classes,
    taxAreas: nonSvcCatalog.taxAreas,
    coverageOptions: nonSvcCatalog.coverageOptions,
  }), [services, nonSvcCatalog]);

  const catalogSource: 'supabase' | 'fallback' =
    sbCatalog.services.length > 0 ? 'supabase' : 'fallback';

  // ── Quote CRUD ─────────────────────────────────────────────────────────
  const createQuote = useCallback((): Quote => {
    const q = createBlankQuote(settings, catalog.classes, catalog.taxAreas);
    setQuotes(prev => [q, ...prev]);
    setSettings(prev => ({ ...prev, nextQuoteNumber: prev.nextQuoteNumber + 1 }));
    return q;
  }, [settings, catalog.classes, catalog.taxAreas, setQuotes, setSettings]);

  const updateQuote = useCallback((id: string, patch: Partial<Quote>) => {
    setQuotes(prev => prev.map(q => q.id === id ? { ...q, ...patch, updatedAt: new Date().toISOString() } : q));
  }, [setQuotes]);

  const deleteQuote = useCallback((id: string) => {
    setQuotes(prev => prev.filter(q => q.id !== id));
  }, [setQuotes]);

  const duplicateQuote = useCallback((id: string): Quote | null => {
    const src = quotes.find(q => q.id === id);
    if (!src) return null;
    const dup = createBlankQuote(settings, catalog.classes, catalog.taxAreas);
    const copy: Quote = {
      ...src,
      id: dup.id,
      number: dup.number,
      status: 'draft',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setQuotes(prev => [copy, ...prev]);
    setSettings(prev => ({ ...prev, nextQuoteNumber: prev.nextQuoteNumber + 1 }));
    return copy;
  }, [quotes, settings, catalog.classes, catalog.taxAreas, setQuotes, setSettings]);

  const setQuoteStatus = useCallback((id: string, status: QuoteStatus) => {
    updateQuote(id, { status });
  }, [updateQuote]);

  // ── Service CRUD — deprecated in Quote Tool UI; edits happen on /price-list.
  // Stubs kept so existing consumers compile. They no-op with a warning so
  // we can catch any stray call sites in dev.
  const notSupported = (what: string) => () => {
    console.warn(`[useQuoteStore] ${what} is no longer supported from the Quote Tool. Edit services on /price-list.`);
  };
  const addService    = notSupported('addService');
  const updateService = notSupported('updateService');
  const deleteService = notSupported('deleteService');

  // ── Tax area CRUD (still local) ─────────────────────────────────────────
  const addTaxArea = useCallback((ta: QuoteCatalog['taxAreas'][0]) => {
    setNonSvcCatalog(prev => ({ ...prev, taxAreas: [...prev.taxAreas, ta] }));
  }, [setNonSvcCatalog]);

  const updateTaxArea = useCallback((id: string, patch: Partial<QuoteCatalog['taxAreas'][0]>) => {
    setNonSvcCatalog(prev => ({
      ...prev,
      taxAreas: prev.taxAreas.map(t => t.id === id ? { ...t, ...patch } : t),
    }));
  }, [setNonSvcCatalog]);

  const deleteTaxArea = useCallback((id: string) => {
    setNonSvcCatalog(prev => ({ ...prev, taxAreas: prev.taxAreas.filter(t => t.id !== id) }));
  }, [setNonSvcCatalog]);

  // ── Reset helpers ───────────────────────────────────────────────────────
  const resetCatalog = useCallback(() => {
    // Only resets the local (non-service) parts now. Services live in Supabase.
    setNonSvcCatalog({
      classes: DEFAULT_CLASSES,
      taxAreas: DEFAULT_TAX_AREAS,
      coverageOptions: DEFAULT_COVERAGE_OPTIONS,
    });
  }, [setNonSvcCatalog]);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, [setSettings]);

  // setCatalog kept for call-site compat: merges into local catalog bits,
  // silently drops `services` since those are server-owned.
  const setCatalog = useCallback((updater: QuoteCatalog | ((prev: QuoteCatalog) => QuoteCatalog)) => {
    setNonSvcCatalog(prev => {
      const prevFull: QuoteCatalog = { services, ...prev };
      const next = typeof updater === 'function' ? updater(prevFull) : updater;
      return {
        classes: next.classes,
        taxAreas: next.taxAreas,
        coverageOptions: next.coverageOptions,
      };
    });
  }, [services, setNonSvcCatalog]);

  return {
    quotes, catalog, settings,
    setQuotes, setCatalog, setSettings,
    createQuote, updateQuote, deleteQuote, duplicateQuote, setQuoteStatus,
    addService, updateService, deleteService,
    addTaxArea, updateTaxArea, deleteTaxArea,
    resetCatalog, resetSettings,
    // New: expose source + loading so the Catalog tab can display status
    catalogSource,
    catalogLoading: sbCatalog.loading,
    catalogError: sbCatalog.error,
  };
}
