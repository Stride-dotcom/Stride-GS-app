import { useState, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import type {
  Quote, QuoteStatus, QuoteCatalog, QuoteStoreSettings, ClassLine,
} from '../lib/quoteTypes';
import {
  DEFAULT_SERVICES, DEFAULT_CLASSES, DEFAULT_TAX_AREAS,
  DEFAULT_COVERAGE_OPTIONS, DEFAULT_SETTINGS,
} from '../lib/quoteDefaults';

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

export function useQuoteStore() {
  const { user } = useAuth();
  const email = user?.email || '_anon';
  const keysRef = useRef({
    quotes: storageKey(email, 'list'),
    catalog: storageKey(email, 'catalog'),
    settings: storageKey(email, 'settings'),
  });
  keysRef.current = {
    quotes: storageKey(email, 'list'),
    catalog: storageKey(email, 'catalog'),
    settings: storageKey(email, 'settings'),
  };

  const [quotes, setQuotesRaw] = useState<Quote[]>(() => loadJson(keysRef.current.quotes, []));
  const [catalog, setCatalogRaw] = useState<QuoteCatalog>(() => loadJson(keysRef.current.catalog, {
    services: DEFAULT_SERVICES, classes: DEFAULT_CLASSES,
    taxAreas: DEFAULT_TAX_AREAS, coverageOptions: DEFAULT_COVERAGE_OPTIONS,
  }));
  const [settings, setSettingsRaw] = useState<QuoteStoreSettings>(() => loadJson(keysRef.current.settings, DEFAULT_SETTINGS));

  const setQuotes = useCallback((updater: Quote[] | ((prev: Quote[]) => Quote[])) => {
    setQuotesRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveJson(keysRef.current.quotes, next);
      return next;
    });
  }, []);

  const setCatalog = useCallback((updater: QuoteCatalog | ((prev: QuoteCatalog) => QuoteCatalog)) => {
    setCatalogRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveJson(keysRef.current.catalog, next);
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

  // Quote CRUD
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

  // Catalog CRUD
  const addService = useCallback((svc: QuoteCatalog['services'][0]) => {
    setCatalog(prev => ({ ...prev, services: [...prev.services, svc] }));
  }, [setCatalog]);

  const updateService = useCallback((id: string, patch: Partial<QuoteCatalog['services'][0]>) => {
    setCatalog(prev => ({
      ...prev,
      services: prev.services.map(s => s.id === id ? { ...s, ...patch } : s),
    }));
  }, [setCatalog]);

  const deleteService = useCallback((id: string) => {
    setCatalog(prev => ({ ...prev, services: prev.services.filter(s => s.id !== id) }));
  }, [setCatalog]);

  // Tax area CRUD
  const addTaxArea = useCallback((ta: QuoteCatalog['taxAreas'][0]) => {
    setCatalog(prev => ({ ...prev, taxAreas: [...prev.taxAreas, ta] }));
  }, [setCatalog]);

  const updateTaxArea = useCallback((id: string, patch: Partial<QuoteCatalog['taxAreas'][0]>) => {
    setCatalog(prev => ({
      ...prev,
      taxAreas: prev.taxAreas.map(t => t.id === id ? { ...t, ...patch } : t),
    }));
  }, [setCatalog]);

  const deleteTaxArea = useCallback((id: string) => {
    setCatalog(prev => ({ ...prev, taxAreas: prev.taxAreas.filter(t => t.id !== id) }));
  }, [setCatalog]);

  // Reset catalog to defaults
  const resetCatalog = useCallback(() => {
    setCatalog({
      services: DEFAULT_SERVICES, classes: DEFAULT_CLASSES,
      taxAreas: DEFAULT_TAX_AREAS, coverageOptions: DEFAULT_COVERAGE_OPTIONS,
    });
  }, [setCatalog]);

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, [setSettings]);

  return {
    quotes, catalog, settings,
    setQuotes, setCatalog, setSettings,
    createQuote, updateQuote, deleteQuote, duplicateQuote, setQuoteStatus,
    addService, updateService, deleteService,
    addTaxArea, updateTaxArea, deleteTaxArea,
    resetCatalog, resetSettings,
  };
}
