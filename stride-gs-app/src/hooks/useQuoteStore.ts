/**
 * useQuoteStore — Quote Tool data layer.
 *
 * Session 73 Phase 2 — ALL catalog data (services, classes, tax areas,
 * coverage options) now comes from Supabase via useQuoteCatalog.
 * quoteDefaults.ts is the fallback only when Supabase returns empty.
 *
 * Still in localStorage (per-user, not per-workspace):
 *   - Quotes themselves (createQuote, updateQuote, duplicateQuote, ...)
 *   - Quote Tool Settings (prefix, expiration days, storage months, company info)
 *
 * Catalog-mutation methods (addService/updateService/deleteService/
 * addTaxArea/updateTaxArea/deleteTaxArea/resetCatalog) are now no-op
 * warning stubs — edits happen on /price-list.
 */
import { useState, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type {
  Quote, QuoteStatus, QuoteCatalog, QuoteStoreSettings, ClassLine, ServiceDef,
} from '../lib/quoteTypes';
import { DEFAULT_SERVICES, DEFAULT_SETTINGS } from '../lib/quoteDefaults';
import { useQuoteCatalog } from './useQuoteCatalog';
import type { CatalogService } from './useServiceCatalog';

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
    taxAreaId: defaultArea?.id ?? '',
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
  const allowed: ServiceDef['category'][] = ['Warehouse','Storage','Shipping','Assembly','Repair','Labor','Admin','Delivery'];
  const cat = allowed.includes(c.category as ServiceDef['category']) ? (c.category as ServiceDef['category']) : 'Admin';
  return {
    id: c.code,              // use code as stable ID for matrix cell keys
    code: c.code,
    name: c.name,
    category: cat,
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
    settings: storageKey(email, 'settings'),
  });
  keysRef.current = {
    quotes: storageKey(email, 'list'),
    settings: storageKey(email, 'settings'),
  };

  // ── Supabase-backed catalog (services + classes + tax + coverage) ──
  const sbCatalog = useQuoteCatalog();

  const [quotes, setQuotesRaw] = useState<Quote[]>(() => loadJson(keysRef.current.quotes, []));
  const [settings, setSettingsRaw] = useState<QuoteStoreSettings>(() => loadJson(keysRef.current.settings, DEFAULT_SETTINGS));

  const setQuotes = useCallback((updater: Quote[] | ((prev: Quote[]) => Quote[])) => {
    setQuotesRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveJson(keysRef.current.quotes, next);
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

  // ── Derived catalog — Supabase-first, DEFAULT_* fallback ────────────
  const services: ServiceDef[] = useMemo(() => {
    if (sbCatalog.services.length > 0) {
      return sbCatalog.services
        .map(catalogToServiceDef)
        .sort((a, b) => a.matrixOrder - b.matrixOrder);
    }
    return DEFAULT_SERVICES;
  }, [sbCatalog.services]);

  const catalog: QuoteCatalog = useMemo(() => ({
    services,
    classes: sbCatalog.classes,
    taxAreas: sbCatalog.taxAreas,
    coverageOptions: sbCatalog.coverageOptions,
  }), [services, sbCatalog.classes, sbCatalog.taxAreas, sbCatalog.coverageOptions]);

  const catalogSource: 'supabase' | 'fallback' = sbCatalog.source;

  // ── Quote CRUD (still localStorage) ─────────────────────────────────
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

  // ── Quote import/export (quotes only — catalog not exported anymore) ──
  const exportQuotes = useCallback((): string => {
    return JSON.stringify({ quotes, settings, version: 2 }, null, 2);
  }, [quotes, settings]);

  const importQuotes = useCallback((json: string): { imported: number; error?: string } => {
    try {
      const data = JSON.parse(json);
      if (Array.isArray(data.quotes)) {
        setQuotes(data.quotes as Quote[]);
      }
      if (data.settings) {
        setSettings({ ...DEFAULT_SETTINGS, ...data.settings });
      }
      return { imported: Array.isArray(data.quotes) ? data.quotes.length : 0 };
    } catch (err) {
      return { imported: 0, error: err instanceof Error ? err.message : 'Invalid JSON' };
    }
  }, [setQuotes, setSettings]);

  // ── Deprecated catalog-mutation stubs (edits happen on /price-list) ──
  const notSupported = (what: string) => () => {
    console.warn(`[useQuoteStore] ${what} is no longer supported from the Quote Tool. Edit on /price-list.`);
  };
  const addService    = notSupported('addService');
  const updateService = notSupported('updateService');
  const deleteService = notSupported('deleteService');
  const addTaxArea    = notSupported('addTaxArea');
  const updateTaxArea = notSupported('updateTaxArea');
  const deleteTaxArea = notSupported('deleteTaxArea');
  const resetCatalog  = notSupported('resetCatalog');
  const setCatalog    = notSupported('setCatalog');

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, [setSettings]);

  return {
    quotes, catalog, settings,
    setQuotes, setCatalog, setSettings,
    createQuote, updateQuote, deleteQuote, duplicateQuote, setQuoteStatus,
    exportQuotes, importQuotes,
    addService, updateService, deleteService,
    addTaxArea, updateTaxArea, deleteTaxArea,
    resetCatalog, resetSettings,
    catalogSource,
    catalogLoading: sbCatalog.loading,
    catalogError: null as string | null,
  };
}
