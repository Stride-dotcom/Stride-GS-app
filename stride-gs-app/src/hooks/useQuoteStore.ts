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
import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
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
  // Session 74: log quota failures instead of swallowing them silently.
  // The old `catch { /* quota */ }` was hiding the exact class of bug
  // the user hit on EST-1001.
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (err) { console.warn('[useQuoteStore] localStorage write failed:', err); }
}

// ─── Supabase quote sync ─────────────────────────────────────────────────
// The real persistence layer. localStorage is now just a fast optimistic
// cache — the Supabase `quotes` table is the source of truth, so losing
// browser storage doesn't lose a quote.

interface QuoteRow {
  id: string;
  owner_email: string;
  quote_number: string | null;
  status: string | null;
  data: Quote;            // full quote doc serialized as jsonb
  created_at: string;
  updated_at: string;
}

/**
 * fetchQuotesFromSupabase — read rows from the `quotes` table.
 *
 * Non-admin users get their own rows only (scoped server-side via the
 * `quotes_owner_read` RLS policy + an explicit owner_email filter for
 * clarity + query-plan efficiency).
 *
 * Admins (`asAdmin=true`) get EVERY row — the admin Quote Tool view
 * shows all users' quotes. Access is gated server-side by the
 * `quotes_admin_read_all` RLS policy (migration 20260421180000); a
 * non-admin passing asAdmin=true would just get back their own rows
 * because RLS still intersects.
 *
 * Returns both the Quote doc AND the owner_email so the admin list can
 * render a "Created by" column. The owner_email defaults to the caller
 * in the non-admin path (every row we got back is ours by definition).
 */
async function fetchQuotesFromSupabase(
  ownerEmail: string,
  asAdmin: boolean,
): Promise<Array<{ quote: Quote; ownerEmail: string }>> {
  let query = supabase
    .from('quotes')
    .select('data, owner_email, updated_at')
    .order('updated_at', { ascending: false });
  if (!asAdmin) query = query.eq('owner_email', ownerEmail);
  const { data, error } = await query;
  if (error) {
    console.warn('[useQuoteStore] Supabase fetch failed:', error.message);
    return [];
  }
  return (data as Array<Pick<QuoteRow, 'data' | 'owner_email' | 'updated_at'>> | null)
    ?.map(r => ({ quote: r.data, ownerEmail: r.owner_email })) ?? [];
}

async function upsertQuoteToSupabase(ownerEmail: string, q: Quote): Promise<void> {
  const { error } = await supabase.from('quotes').upsert({
    id: q.id,
    owner_email: ownerEmail,
    quote_number: q.number || null,
    status: q.status || null,
    data: q,
  });
  if (error) console.warn('[useQuoteStore] Supabase upsert failed for', q.number, error.message);
}

async function deleteQuoteFromSupabase(id: string): Promise<void> {
  const { error } = await supabase.from('quotes').delete().eq('id', id);
  if (error) console.warn('[useQuoteStore] Supabase delete failed for', id, error.message);
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
  const isAdmin = user?.role === 'admin';
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
  // id → owner_email map. Populated when admin hydrates the full set so
  // the UI can display "Created by" and the write-through layer can tell
  // the admin they're viewing someone else's quote. For non-admins every
  // row is owned by `user.email`; the map is still populated for symmetry
  // but reads aren't exercised.
  const [quoteOwners, setQuoteOwners] = useState<Record<string, string>>({});

  // Session 74: hydrate from Supabase once per signed-in user. On the
  // first load after login, this REPLACES any stale localStorage list
  // with the authoritative server set. If Supabase is empty but
  // localStorage has quotes (legacy state from before this migration),
  // we push the local ones UP to Supabase so nothing is lost.
  // Re-hydrate when either the email OR the admin flag changes, so a
  // demotion from admin → staff prunes foreign rows on next tick.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!user?.email) return;
    const key = `${user.email}::${isAdmin ? 'admin' : 'owner'}`;
    if (hydratedFor.current === key) return;
    hydratedFor.current = key;

    let cancelled = false;
    (async () => {
      const serverRows = await fetchQuotesFromSupabase(user.email, isAdmin);
      if (cancelled) return;

      if (serverRows.length === 0 && !isAdmin) {
        // One-time migration: if a NON-ADMIN user has localStorage quotes
        // but no Supabase rows, push them all up so we never lose the
        // quotes they created before this session. Admins skip this path
        // (their cross-user view should never promote random localStorage
        // content into someone else's server state).
        const local = loadJson<Quote[]>(keysRef.current.quotes, []);
        if (local.length > 0) {
          console.info('[useQuoteStore] migrating', local.length, 'localStorage quotes → Supabase');
          for (const q of local) {
            // eslint-disable-next-line no-await-in-loop
            await upsertQuoteToSupabase(user.email, q);
          }
          setQuotesRaw(local);
          setQuoteOwners(Object.fromEntries(local.map(q => [q.id, user.email])));
          saveJson(keysRef.current.quotes, local);
          return;
        }
      }

      // Supabase has rows (or nothing anywhere) — it's truth.
      const quotesOnly = serverRows.map(r => r.quote);
      const ownerMap = Object.fromEntries(serverRows.map(r => [r.quote.id, r.ownerEmail]));
      setQuotesRaw(quotesOnly);
      setQuoteOwners(ownerMap);
      saveJson(keysRef.current.quotes, quotesOnly);
    })();

    return () => { cancelled = true; };
  }, [user?.email, isAdmin]);

  // `setQuotes` writes localStorage AND fires a best-effort Supabase
  // sync for any quote whose identity or content changed. We don't
  // await here so the UI stays snappy — errors are logged to console.
  // Deletes (a quote present before, absent now) trigger a row delete.
  const setQuotes = useCallback((updater: Quote[] | ((prev: Quote[]) => Quote[])) => {
    setQuotesRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      saveJson(keysRef.current.quotes, next);

      if (user?.email) {
        const prevById = new Map(prev.map(q => [q.id, q]));
        const nextById = new Map(next.map(q => [q.id, q]));

        // Upsert anything that's new or changed (by updatedAt).
        // For admins, an in-memory edit of another user's quote is a
        // read-only-ish view; we keep the local edit for responsiveness
        // but skip the server write so we never clobber someone else's
        // row (RLS would reject it anyway — this just avoids the
        // console warning and the misleading success feedback).
        for (const q of next) {
          const was = prevById.get(q.id);
          if (!was || was.updatedAt !== q.updatedAt) {
            const rowOwner = quoteOwners[q.id];
            const isForeign = isAdmin && rowOwner && rowOwner !== user.email;
            if (isForeign) {
              console.info('[useQuoteStore] skipping server write on foreign quote', q.number, '(owned by', rowOwner, ')');
              continue;
            }
            void upsertQuoteToSupabase(user.email, q);
          }
        }
        // Delete anything that was there before and isn't now — but only
        // if we actually own the row. Admin-side deletes of foreign rows
        // are also rejected by RLS; bail out locally so the list stays
        // consistent with server state after the next hydrate.
        for (const q of prev) {
          if (!nextById.has(q.id)) {
            const rowOwner = quoteOwners[q.id];
            const isForeign = isAdmin && rowOwner && rowOwner !== user.email;
            if (isForeign) {
              console.info('[useQuoteStore] skipping server delete on foreign quote', q.number, '(owned by', rowOwner, ')');
              continue;
            }
            void deleteQuoteFromSupabase(q.id);
          }
        }
      }

      return next;
    });
  }, [user?.email, isAdmin, quoteOwners]);

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
    setQuoteOwners(prev => ({ ...prev, [q.id]: user?.email || '_anon' }));
    setSettings(prev => ({ ...prev, nextQuoteNumber: prev.nextQuoteNumber + 1 }));
    return q;
  }, [settings, catalog.classes, catalog.taxAreas, setQuotes, setSettings, user?.email]);

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
    // Duplicates are always owned by the caller — admin duplicating
    // another user's quote creates a fresh copy under their own email.
    setQuoteOwners(prev => ({ ...prev, [copy.id]: user?.email || '_anon' }));
    setSettings(prev => ({ ...prev, nextQuoteNumber: prev.nextQuoteNumber + 1 }));
    return copy;
  }, [quotes, settings, catalog.classes, catalog.taxAreas, setQuotes, setSettings, user?.email]);

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
    // Admin-only helpers — empty map + false for non-admins, so
    // consumers can unconditionally read the fields without branching.
    quoteOwners,
    isAdminView: isAdmin,
    currentUserEmail: user?.email ?? '',
  };
}
