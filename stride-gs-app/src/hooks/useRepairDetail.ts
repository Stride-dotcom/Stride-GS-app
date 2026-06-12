/**
 * useRepairDetail.ts — Single-repair fetch hook for standalone detail page.
 * Fetches one repair from Supabase (~50ms) with legacy GAS fallback.
 * Mirrors useTaskDetail pattern.
 *
 * Session 70 fix #9: thread clientNameMap through Supabase fetch; fall back to
 * inventory for sidemark/vendor/description when both Supabase and GAS are sparse.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchRepairByIdFromSupabase,
  fetchItemsByIdsFromSupabase,
  type ClientNameMap,
} from '../lib/supabaseQueries';
import { fetchRepairById } from '../lib/api';
import { useClients } from './useClients';
import { entityEvents } from '../lib/entityEvents';
import type { ApiRepair } from '../lib/api';

export type RepairDetailStatus = 'loading' | 'loaded' | 'not-found' | 'access-denied' | 'error';

export interface UseRepairDetailResult {
  repair: ApiRepair | null;
  status: RepairDetailStatus;
  error: string | null;
  source: 'supabase' | 'legacy' | null;
  refetch: (opts?: { silent?: boolean }) => void;
}

export function useRepairDetail(repairId: string | undefined): UseRepairDetailResult {
  const { user } = useAuth();
  const { clients } = useClients();
  const [repair, setRepair] = useState<ApiRepair | null>(null);
  const [status, setStatus] = useState<RepairDetailStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'supabase' | 'legacy' | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fetchCountRef = useRef(0);

  const clientNameMap = useMemo<ClientNameMap>(() => {
    const map: ClientNameMap = {};
    for (const c of clients) { map[c.id] = c.name; }
    return map;
  }, [clients]);
  const clientNameMapRef = useRef(clientNameMap);
  clientNameMapRef.current = clientNameMap;

  // `silent: true` skips flipping status back to 'loading' — used for
  // realtime-echo refetches so the page doesn't unmount the detail panel
  // (and lose scroll position / open sub-tab state) on every save.
  const fetchRepair = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    if (!repairId || !user) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const fetchId = ++fetchCountRef.current;

    if (!silent) setStatus('loading');
    setError(null);

    try {
      // Step 1: Try Supabase (fast path) — pass map for client-name fallback
      const sbRepair = await fetchRepairByIdFromSupabase(repairId, clientNameMapRef.current);

      if (controller.signal.aborted || fetchId !== fetchCountRef.current) return;

      if (sbRepair) {
        if (!hasAccess(user, sbRepair.clientSheetId)) {
          setStatus('access-denied');
          return;
        }

        // Render immediately from Supabase (~50ms). GAS enrichment runs
        // fire-and-forget below so the page is interactive right away.
        // Previously this was AWAITED, which forced every Repair page load
        // to wait 2-5s for the GAS roundtrip even when Supabase had the data.
        setRepair(sbRepair);
        setSource('supabase');
        setStatus('loaded');

        // v2026-05-13 — multi-item guard. Supabase is the source of truth
        // for multi-item repairs (it has repair_items + inventory overlay
        // that GAS doesn't know about). Skip both enrichment paths when
        // the repair has >1 item — otherwise GAS / inventory would clobber
        // the intentionally-blank top-level description / vendor / sidemark
        // / location with the primary item's values (the bug that surfaced:
        // multi-item repair Description field showed
        // "TOP W DRAWER 40 BIRCH BLACK RAW BIRCH" because GAS returned that
        // for the first item and the background merge overwrote our blank).
        const isMultiItem = (sbRepair.items?.length ?? 0) > 1;

        // Background GAS enrichment: Supabase repair rows are often sparse
        // (missing vendor, description, notes from the sheet), so we fetch
        // the full row from GAS and SPARSE-FILL a whitelist of sheet-only /
        // descriptive fields. If it fails or never arrives, the user still
        // sees Supabase data.
        //
        // ⚠️ NEVER spread the whole GAS row over the SB repair. Repairs are
        // fleet-wide SB-primary: status, approval, and every quote_* column
        // are written in Supabase first and mirrored to the sheet in the
        // BACKGROUND, so the sheet is allowed to be stale at any moment.
        // The old `{...prev, ...gasRepair}` merge meant the page loaded the
        // correct SB amount and then — a few seconds later — the enrichment
        // landed the sheet's stale numbers over it (RPR-63755: $228.20
        // visibly flipping to $251.93 on screen, 2026-06-12). Same incident
        // class as PR #739/#753/#772, client-side edition: the DB was right;
        // the UI clobbered itself. useTaskDetail has always done this
        // correctly (it picks ONLY taskFolderUrl). We now do the same:
        // sparse-fill descriptive fields, never lifecycle/quote/billing.
        if (sbRepair.clientSheetId && !isMultiItem) {
          fetchRepairById(repairId, sbRepair.clientSheetId, controller.signal)
            .then(gasResp => {
              if (fetchId !== fetchCountRef.current) return;
              if (gasResp.ok && gasResp.data?.success && gasResp.data.repair) {
                const gasRepair = gasResp.data.repair;
                setRepair(prev => {
                  if (!prev) return prev;
                  const next = { ...prev };
                  // Sheet-only fields: SB never has these — take GAS verbatim.
                  if (gasRepair.repairFolderUrl)   next.repairFolderUrl   = gasRepair.repairFolderUrl;
                  if (gasRepair.taskFolderUrl)     next.taskFolderUrl     = gasRepair.taskFolderUrl;
                  // shipmentFolderUrl IS populated by the SB inventory
                  // overlay (authoritative) — sparse-fill only.
                  if (!next.shipmentFolderUrl && gasRepair.shipmentFolderUrl) next.shipmentFolderUrl = gasRepair.shipmentFolderUrl;
                  // Descriptive fields: fill only where SB was blank. The
                  // itemClass preference is load-bearing — the SB value comes
                  // from the live inventory overlay (authoritative) while the
                  // sheet "Class" column is frequently blank, and the Quote
                  // Builder's class-based rate auto-fill dies without it.
                  if (!next.clientName)  next.clientName  = gasRepair.clientName  || '';
                  if (!next.vendor)      next.vendor      = gasRepair.vendor      || '';
                  if (!next.description) next.description = gasRepair.description || '';
                  if (!next.sidemark)    next.sidemark    = gasRepair.sidemark    || '';
                  if (!next.location)    next.location    = gasRepair.location    || '';
                  if (!next.itemClass)   next.itemClass   = gasRepair.itemClass   || '';
                  if (!next.taskNotes)   next.taskNotes   = gasRepair.taskNotes   || '';
                  if (!next.itemNotes)   next.itemNotes   = gasRepair.itemNotes   || '';
                  if (!next.repairNotes) next.repairNotes = gasRepair.repairNotes || '';
                  if (!next.createdBy)   next.createdBy   = gasRepair.createdBy   || '';
                  if (!next.createdDate) next.createdDate = gasRepair.createdDate || '';
                  if (!next.sourceTaskId) next.sourceTaskId = gasRepair.sourceTaskId || '';
                  if (!next.repairVendor) next.repairVendor = gasRepair.repairVendor || '';
                  if (!next.invoiceId)   next.invoiceId   = gasRepair.invoiceId   || '';
                  // EXCLUDED on purpose (SB-authoritative; sheet may be stale):
                  // status, approved, quoteAmount, quoteLines + every quote_*
                  // total, quoteSentDate, quoteRevised, scheduledDate,
                  // startDate, completedDate, repairResult, finalAmount,
                  // partsCost, laborHours, billed.
                  return next;
                });
              }
            })
            .catch(() => { /* best-effort */ });
        }
        // Also kick off inventory enrichment in parallel (independent of GAS).
        if (!isMultiItem) {
          maybeEnrichFromInventory(sbRepair, fetchId, fetchCountRef, setRepair, clientNameMapRef.current);
        }
        return;
      }

      // Step 2: Supabase miss — fallback to legacy API (scan accessible clients)
      const accessibleIds = user.role === 'admin' || user.role === 'staff'
        ? user.accessibleClientSheetIds
        : user.clientSheetId
          ? [user.clientSheetId, ...user.childClientSheetIds]
          : [];

      for (const clientSheetId of accessibleIds) {
        if (controller.signal.aborted) return;
        try {
          const result = await fetchRepairById(repairId, clientSheetId, controller.signal);
          if (result.ok && result.data?.success && result.data.repair) {
            if (fetchId !== fetchCountRef.current) return;
            if (!hasAccess(user, clientSheetId)) {
              setStatus('access-denied');
              return;
            }
            setRepair({ ...result.data.repair, clientSheetId });
            setSource('legacy');
            setStatus('loaded');
            return;
          }
        } catch {
          // Not found on this client, try next
        }
      }

      if (controller.signal.aborted || fetchId !== fetchCountRef.current) return;
      setStatus('not-found');
    } catch (err) {
      if (controller.signal.aborted || fetchId !== fetchCountRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load repair');
      setStatus('error');
    }
  }, [repairId, user]);

  useEffect(() => {
    fetchRepair();
    return () => { abortRef.current?.abort(); };
  }, [fetchRepair]);

  // Realtime: refetch when this repair is updated cross-tab/cross-user.
  // Silent so the panel stays mounted (no scroll/tab state loss) — see
  // useTaskDetail for full rationale.
  useEffect(() => {
    if (!repairId) return;
    return entityEvents.subscribe((type, id) => {
      if (type === 'repair' && id === repairId) void fetchRepair({ silent: true });
    });
  }, [repairId, fetchRepair]);

  return { repair, status, error, source, refetch: fetchRepair };
}

function hasAccess(user: NonNullable<ReturnType<typeof useAuth>['user']>, clientSheetId: string): boolean {
  if (user.role === 'admin' || user.role === 'staff') return true;
  return user.accessibleClientSheetIds.includes(clientSheetId);
}

/** Session 70 fix #9: fall back to inventory for sparse repair fields. */
function maybeEnrichFromInventory(
  repair: ApiRepair,
  fetchId: number,
  fetchCountRef: React.MutableRefObject<number>,
  setRepair: React.Dispatch<React.SetStateAction<ApiRepair | null>>,
  clientNameMap: ClientNameMap,
) {
  const needs = !repair.sidemark || !repair.clientName || !repair.vendor || !repair.description;
  if (!needs || !repair.itemId) return;
  fetchItemsByIdsFromSupabase([repair.itemId], clientNameMap)
    .then(items => {
      if (fetchId !== fetchCountRef.current) return;
      const inv = items?.find(x => x.tenantId === repair.clientSheetId) || items?.[0];
      if (!inv) return;
      setRepair(prev => prev ? {
        ...prev,
        sidemark: prev.sidemark || inv.sidemark || '',
        clientName: prev.clientName || inv.clientName || '',
        vendor: prev.vendor || inv.vendor || '',
        description: prev.description || inv.description || '',
        location: prev.location || inv.location || '',
        itemClass: prev.itemClass || inv.itemClass || '',
      } : prev);
    })
    .catch(() => {});
}
