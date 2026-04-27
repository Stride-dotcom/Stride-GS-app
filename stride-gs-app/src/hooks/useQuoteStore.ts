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
import { DEFAULT_SETTINGS } from '../lib/quoteDefaults';
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

async function upsertQuoteToSupabase(ownerEmail: string, q: Quote): Promise<string | null> {
  const { error } = await supabase.from('quotes').upsert({
    id: q.id,
    owner_email: ownerEmail,
    quote_number: q.number || null,
    status: q.status || null,
    data: q,
  });
  if (error) {
    // Loud on purpose — "save but then disappear" bugs traced back
    // to this being a swallowed console.warn. If an RLS / auth / schema
    // error rejects the write, we want it staring the operator in the
    // face both in devtools and in the UI (via saveErrors in the store).
    console.error('[useQuoteStore] Supabase upsert FAILED for', q.number, '—', error.message, error);
    return error.message;
  }
  return null;
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
    // No fallback rate. If tax_areas is empty the quote starts at 0%
    // and the admin sees the obvious "$0 tax" line — that's a louder
    // signal than the legacy 10.4% Kent literal silently drifting
    // into a quote made before the catalog loaded.
    taxRate: defaultArea?.rate ?? 0,
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
  // Per-quote save error surfaced to the UI. Populated when an upsert
  // rejects (RLS, schema, auth). Cleared when a subsequent save of the
  // same id succeeds. Empty object means everything's in sync.
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

  // Hydrate from Supabase + rescue any unsynced local rows.
  //
  // Fix (session 77): the old implementation REPLACED in-memory state
  // and localStorage with whatever Supabase returned. That created a
  // data-loss race — save a quote, the upsert is fire-and-forget, then
  // remount the component (navigate away & back, auth state change,
  // etc.). The remount triggered a fresh hydrate that hadn't yet seen
  // the in-flight upsert, so the just-saved quote was overwritten out
  // of BOTH memory and localStorage. "The quotes save but then
  // disappear."
  //
  // New behaviour:
  //   1. Fetch server rows (scoped by role — admin gets everything).
  //   2. Union with whatever's in memory + localStorage.
  //   3. Any local-only row (missing from the server response) we
  //      PUSH UP to Supabase defensively. If Supabase genuinely has
  //      the row (our server query just missed it due to timing),
  //      the upsert is harmless idempotent. If Supabase was missing
  //      the row (failed earlier upsert, localStorage leftover from
  //      legacy pre-session-74 days, etc.), it now gets persisted.
  //   4. State = union of all rows. localStorage mirrors the union.
  //
  // Tradeoff: cross-device deletions on a stale device can re-appear
  // until that device explicitly deletes them. For a low-volume
  // quoting tool that's acceptable; data loss isn't.
  //
  // doHydrate is the fetch+merge+rescue routine. Extracted so we can
  // also expose it as a manual refresh from the UI.
  const doHydrate = useCallback(async (userEmail: string, asAdmin: boolean, cancelledRef?: { current: boolean }) => {
      const serverRows = await fetchQuotesFromSupabase(userEmail, asAdmin);
      if (cancelledRef?.current) return;

      const serverIds = new Set(serverRows.map(r => r.quote.id));

      // Use the functional updater so we see the FRESH prev — in a race
      // where a createQuote landed between our fetch and this callback,
      // `prev` will include that new quote and we'll push it up.
      setQuotesRaw(prev => {
        if (cancelledRef?.current) return prev;

        // Local rows that the server doesn't have. For admin users,
        // only preserve / push rows we know we own — we don't want to
        // resurrect someone else's locally-cached foreign quote.
        const localOnly: Quote[] = [];
        for (const local of prev) {
          if (serverIds.has(local.id)) continue;
          // In admin view, only rescue rows owned by the caller. In
          // owner view, every local row is owned by us by definition.
          const owner = quoteOwners[local.id];
          const isForeign = asAdmin && owner && owner !== userEmail;
          if (!isForeign) localOnly.push(local);
        }

        // Fire the defensive upserts. These are non-blocking; the
        // in-flight promise from `createQuote`/`updateQuote` may win,
        // ours may win — both are idempotent on the same id.
        if (localOnly.length > 0) {
          console.info('[useQuoteStore] rescuing', localOnly.length, 'unsynced local quote(s) → Supabase');
          for (const q of localOnly) {
            void upsertQuoteToSupabase(userEmail, q).then(err => {
              setSaveErrors(prev2 => {
                const nextErr = { ...prev2 };
                if (err) nextErr[q.id] = err;
                else delete nextErr[q.id];
                return nextErr;
              });
            });
          }
        }

        // Union. Local-only rows go first so the UI keeps them at the
        // top (they're the newest the user just worked on).
        const merged: Quote[] = [
          ...localOnly,
          ...serverRows.map(r => r.quote),
        ];
        saveJson(keysRef.current.quotes, merged);
        return merged;
      });

      // Owners map: server owners for server rows, preserve existing
      // entries for local-only rows (those are caller-owned by the
      // filter above, so stamp them with userEmail if missing).
      setQuoteOwners(prev => {
        const next: Record<string, string> = {};
        for (const r of serverRows) next[r.quote.id] = r.ownerEmail;
        for (const [id, owner] of Object.entries(prev)) {
          if (!next[id]) next[id] = owner;
        }
        return next;
      });
  }, [isAdmin, quoteOwners]);

  // Re-hydrate when either the email OR the admin flag changes, so a
  // demotion from admin → staff prunes foreign rows on next tick.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!user?.email) return;
    const key = `${user.email}::${isAdmin ? 'admin' : 'owner'}`;
    if (hydratedFor.current === key) return;
    hydratedFor.current = key;

    const cancelledRef = { current: false };
    void doHydrate(user.email, isAdmin, cancelledRef);
    return () => { cancelledRef.current = true; };
  }, [user?.email, isAdmin, doHydrate]);

  // Manual refetch — exposed to UI for a Refresh button. Also called
  // from the realtime listener when we want to resync rather than
  // patching state from a single row event.
  const refetch = useCallback(() => {
    if (!user?.email) return Promise.resolve();
    return doHydrate(user.email, isAdmin);
  }, [user?.email, isAdmin, doHydrate]);

  // Realtime subscription on the quotes table. Admin view gets every
  // row change; non-admin gets only their own rows (Postgres-side
  // filter on owner_email, in addition to RLS). On any INSERT / UPDATE
  // / DELETE we refetch — simpler than patching state per-event, and
  // cheap at this volume (a handful of quotes, once in a while).
  useEffect(() => {
    if (!user?.email) return;
    const channelName = `quotes_${user.email}_${isAdmin ? 'admin' : 'owner'}_${Math.random().toString(36).slice(2, 8)}`;
    const filter = isAdmin ? undefined : `owner_email=eq.${user.email}`;
    const ch = supabase
      .channel(channelName)
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'quotes', ...(filter ? { filter } : {}) },
        () => { void refetch(); })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [user?.email, isAdmin, refetch]);

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
        const userEmail = user.email;
        for (const q of next) {
          const was = prevById.get(q.id);
          if (!was || was.updatedAt !== q.updatedAt) {
            const rowOwner = quoteOwners[q.id];
            const isForeign = isAdmin && rowOwner && rowOwner !== userEmail;
            if (isForeign) {
              console.info('[useQuoteStore] skipping server write on foreign quote', q.number, '(owned by', rowOwner, ')');
              continue;
            }
            // Record the save result per-quote so the UI can show
            // "⚠ Not saved to server" on the row when RLS (or anything
            // else) rejects the write.
            void upsertQuoteToSupabase(userEmail, q).then(err => {
              setSaveErrors(prev => {
                const nextErr = { ...prev };
                if (err) nextErr[q.id] = err;
                else delete nextErr[q.id];
                return nextErr;
              });
            });
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
    // Service catalog is loaded from Supabase only. Empty array is
    // the explicit "not loaded yet" / "no services configured" state;
    // the Quote Tool surfaces this as a load-error UI rather than
    // billing against stale hardcoded literals.
    return sbCatalog.services
      .map(catalogToServiceDef)
      .sort((a, b) => a.matrixOrder - b.matrixOrder);
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

  // Soft delete — flip status to 'deleted' and let the normal upsert
  // path carry the change to Supabase. The row stays in local + server
  // state so that a hydrate from another device with stale localStorage
  // still sees the tombstone and won't resurrect the quote via the
  // rescue-local-only-rows path. Every UI surface filters status ===
  // 'deleted' out of the visible list, so this reads as a hard delete
  // to the user.
  const deleteQuote = useCallback((id: string) => {
    setQuotes(prev => prev.map(q => q.id === id
      ? { ...q, status: 'deleted' as const, updatedAt: new Date().toISOString() }
      : q));
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
    // Exclude soft-deleted rows from the user-facing export so it
    // matches what they see on-screen.
    const live = quotes.filter(q => q.status !== 'deleted');
    return JSON.stringify({ quotes: live, settings, version: 2 }, null, 2);
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

  // Hide soft-deleted rows from every external consumer. The internal
  // state still carries them so hydrate can compare IDs against server
  // truth and propagate the tombstone across devices.
  const visibleQuotes = useMemo(() => quotes.filter(q => q.status !== 'deleted'), [quotes]);

  return {
    quotes: visibleQuotes,
    catalog, settings,
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
    // Per-quote save error. Populated when an upsert hits RLS/auth/
    // schema errors. UI can render a per-row warning when
    // saveErrors[quote.id] is set.
    saveErrors,
    // Manual refresh — force a fresh fetch + merge + rescue. UI wires
    // this to a "Refresh" button next to "+ NEW QUOTE".
    refetch,
  };
}
