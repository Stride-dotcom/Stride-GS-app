import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  flexRender, createColumnHelper,
  type SortingState, type VisibilityState,
} from '@tanstack/react-table';
import { useTablePreferences } from '../hooks/useTablePreferences';
import { Plus, Copy, X, Check, Truck, Package, AlertTriangle, Printer, ClipboardPaste, ChevronDown, ChevronRight, ChevronUp, Zap, Settings2, Camera, FileText as DocIcon, Loader2, Save } from 'lucide-react';
import { theme } from '../styles/theme';
import { AutocompleteSelect } from '../components/shared/AutocompleteSelect';
import { PhotoUploadButton } from '../components/media/PhotoUploadButton';
import { DocumentScanButton } from '../components/media/DocumentScanButton';
import { supabase } from '../lib/supabase';
import { fetchShipmentByNoFromSupabase } from '../lib/supabaseQueries';
import { useAuth } from '../contexts/AuthContext';
import { usePhotos } from '../hooks/usePhotos';
import { useDocuments } from '../hooks/useDocuments';
import { useClients } from '../hooks/useClients';
import { useGoBack } from '../hooks/useGoBack';
import { entityEvents } from '../lib/entityEvents';

import { LocationPicker } from '../components/shared/LocationPicker';
import { AutocompleteInput } from '../components/shared/AutocompleteInput';
import { useLocations } from '../hooks/useLocations';

import { useAutocomplete } from '../hooks/useAutocomplete';
import { useReceivingAddons, type ReceivingAddon } from '../hooks/useReceivingAddons';
import { ReceivingRowMedia } from '../components/media/ReceivingRowMedia';
import { isApiConfigured, postCompleteShipment, postCheckItemIdsAvailable, fetchAutoIdSetting, fetchNextItemId } from '../lib/api';
import { renderDoc, buildReceivingTokens } from '../lib/docRenderer';
import type { ShipmentItemPayload } from '../lib/api';
import { ProcessingOverlay } from '../components/shared/ProcessingOverlay';
import { useIsMobile } from '../hooks/useIsMobile';

// ─── DOCK shipment_number generator ─────────────────────────────────────────
// Format: DOCK-YYYYMMDD-XXXX where XXXX is 4 random hex chars. The 16-bit
// random suffix gives a 1-in-65k collision rate per same-day intake; the
// underlying unique index on `shipment_number` is the backstop, and the
// save handler retries once on a unique-violation error.
function generateDockNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = Math.floor(Math.random() * 0xffff).toString(16).toUpperCase().padStart(4, '0');
  return `DOCK-${y}${m}${d}-${rand}`;
}

/** True if a Supabase error looks like a unique-constraint violation on
 *  shipment_number. Mirrors the matcher used by the legacy DockIntakeForm. */
function isDockNumberCollision(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === '23505') return true;
  return /duplicate key|unique constraint/i.test(err.message || '')
    && /shipment_number/i.test(err.message || '');
}

/** Pack the operator's free-form notes + the optional "Reference/PO" field
 *  into the single `notes` column on `public.shipments`. Mirror of the
 *  parser below — kept inline so the round-trip is obvious. */
function packNotes(reference: string, notes: string): string {
  const ref = reference.trim();
  const body = notes.trim();
  if (ref && body) return `PO/Ref: ${ref}\n${body}`;
  if (ref) return `PO/Ref: ${ref}`;
  return body;
}

/** Pull the leading "PO/Ref: <x>\n…" out of a packed notes string and return
 *  the reference + remaining notes body separately. Tolerates the absence
 *  of either part (pre-2-stage rows have no prefix; "PO/Ref:" alone has no
 *  body). Case-insensitive on the prefix in case operators hand-edited it. */
function unpackNotes(packed: string | null | undefined): { reference: string; notes: string } {
  const s = (packed || '').replace(/^\s+/, '');
  const m = /^PO\/Ref:\s*([^\n]*)\n?([\s\S]*)$/i.exec(s);
  if (!m) return { reference: '', notes: packed || '' };
  return { reference: (m[1] || '').trim(), notes: (m[2] || '').trim() };
}

interface DockItem {
  id: string; itemId: string; reference: string; vendor: string; description: string; itemClass: string;
  qty: number; location: string; sidemark: string; room: string;
  needsInspection: boolean; needsAssembly: boolean; itemNotes: string;
  weight?: number;           // lbs — used for overweight auto-apply
  addons: string[];          // add-on service codes selected for this item
  autoAppliedAddons: string[]; // add-on codes auto-applied (shows "Auto" badge, user can override)
  // Codes the user has MANUALLY unchecked after an auto-apply. The auto-apply
  // effect filters these out of `shouldBe` so the rule can't keep re-checking
  // them on every re-render. Cleared when the user manually re-checks the code.
  dismissedAddons: string[];
  expanded: boolean;         // UI state — expand row to show add-ons
}

const OVERWEIGHT_THRESHOLD = 300; // lbs

/** Compute which add-on codes should be auto-applied for this item.
 *  `no_id` rule fires per-shipment based on the CLIENT — the "Needs ID Holding
 *  Account" tenant (our catch-all for items that arrive without a real owner
 *  yet) gets NO_ID auto-checked on every row. Sidemark is no longer the
 *  trigger; it's a per-row label, not a signal that an ID hasn't been
 *  assigned yet. */
function computeAutoAppliedAddons(
  item: DockItem,
  addons: ReceivingAddon[],
  clientName: string,
): string[] {
  const out: string[] = [];
  const client = (clientName || '').trim().toLowerCase();
  const isHoldingAccount = client.includes('needs id') || client.includes('holding account');
  for (const a of addons) {
    if (!a.autoApplyRule) continue;
    if (a.autoApplyRule === 'no_id' && isHoldingAccount) out.push(a.code);
    else if (a.autoApplyRule === 'overweight' && (item.weight ?? 0) > OVERWEIGHT_THRESHOLD) out.push(a.code);
  }
  return out;
}

const CLASSES = ['XS', 'S', 'M', 'L', 'XL'];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function emptyItem(autoInspect = false): DockItem {
  return { id: `r-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, itemId: '', reference: '', vendor: '', description: '', itemClass: '', qty: 1, location: 'Rec-Dock', sidemark: '', room: '', needsInspection: autoInspect, needsAssembly: false, itemNotes: '', weight: undefined, addons: [], autoAppliedAddons: [], dismissedAddons: [], expanded: false };
}

// ─── Table column configuration ───────────────────────────────────────────────

const DEFAULT_RCV_COL_ORDER = [
  'expand', 'rowNum', 'itemId', 'vendor', 'description',
  'itemClass', 'qty', 'location', 'sidemark', 'reference', 'room',
  'needsInspection', 'needsAssembly', 'actions',
];

const TOGGLEABLE_RCV_COLS = [
  'itemId', 'vendor', 'description', 'itemClass', 'qty',
  'location', 'sidemark', 'reference', 'room', 'needsInspection', 'needsAssembly',
];

const RCV_COL_LABELS: Record<string, string> = {
  itemId: 'Item ID', vendor: 'Vendor', description: 'Description',
  itemClass: 'Class', qty: 'Qty', location: 'Location',
  sidemark: 'Sidemark', reference: 'Reference', room: 'Room',
  needsInspection: 'INSP', needsAssembly: 'ASM',
};

type TableRow = DockItem & { _originalIdx: number };
const columnHelper = createColumnHelper<TableRow>();

// ─── Styles ───────────────────────────────────────────────────────────────────

const cellInput: React.CSSProperties = { width: '100%', padding: '6px 8px', fontSize: 12, border: `1px solid ${theme.colors.borderLight}`, borderRadius: 6, outline: 'none', fontFamily: 'inherit', background: '#fff' };
const cellSelect: React.CSSProperties = { ...cellInput, cursor: 'pointer', appearance: 'auto' as any };
const th: React.CSSProperties = { padding: '8px 6px', textAlign: 'left', fontWeight: 500, fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `2px solid ${theme.colors.border}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fff', zIndex: 2 };
const td: React.CSSProperties = { padding: '4px 4px', borderBottom: `1px solid ${theme.colors.borderLight}`, verticalAlign: 'middle' };


/**
 * NewShipmentForm — unified receiving flow.
 *
 * Single screen: dock-intake fields on top (client, piece count, carrier,
 * tracking, reference, notes, photos, docs) + items grid below. Two save
 * paths share the same state:
 *
 *   - **Save for Later** — UPSERTs the `public.shipments` row with
 *     `inbound_status='in_progress'` + dock_* fields, replaces the
 *     `public.dock_draft_items` rows (DELETE + bulk INSERT) for this
 *     DOCK number, and goes back. Visible whenever a client is picked.
 *   - **Complete Receiving** — runs the existing GAS `completeShipment`
 *     flow (which creates inventory rows + tasks + billing), then
 *     reconciles: stamps the dock metadata onto the new SHP row, moves
 *     photos/docs from DOCK→SHP, deletes both the DOCK shipments row
 *     and any stranded `dock_draft_items`. Hidden until ≥1 item row
 *     has been entered.
 *
 * When `existingDockNo` is set (route is `/receiving?shipmentNo=DOCK-...`),
 * the form hydrates from `public.shipments` + `public.dock_draft_items`
 * on mount so the operator picks up exactly where they left off.
 */
function NewShipmentForm({ existingDockNo }: { existingDockNo?: string } = {}) {
  const { isMobile } = useIsMobile();
  const goBack = useGoBack('/shipments');
  const { user } = useAuth();

  // ─── Table preferences (column visibility + order, persisted per user) ────
  const {
    colVis: columnVisibility, setColVis: setColumnVisibility,
    columnOrder, setColumnOrder,
  } = useTablePreferences('receiving', [], {}, DEFAULT_RCV_COL_ORDER);
  const [sorting, setSorting] = useState<SortingState>([]);
  const [dragColId, setDragColId] = useState<string | null>(null);
  const [dragOverColId, setDragOverColId] = useState<string | null>(null);
  const [showColToggle, setShowColToggle] = useState(false);

  const [client, setClient] = useState('');
  const [clientSheetId, setClientSheetId] = useState('');
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [pieceCount, setPieceCount] = useState<string>('');
  const [receiveDate, setReceiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [chargeReceiving, setChargeReceiving] = useState(true);
  const [autoPrintLabels, setAutoPrintLabels] = useState(() => localStorage.getItem('stride_auto_print_labels') === 'true');
  const printRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<DockItem[]>(() => Array.from({ length: 5 }, () => emptyItem(false)));
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitResult, setSubmitResult] = useState<{ shipmentNo: string; itemCount: number; tasksCreated: number; billingRows: number; warnings?: string[] } | null>(null);
  const idempotencyKeyRef = useRef(crypto.randomUUID());

  // ─── Unified-flow state ─────────────────────────────────────────────────
  // `dockNo` is the canonical handle for the in-progress shipment row in
  // Supabase. On a fresh open we mint a new DOCK-YYYYMMDD-XXXX; on a reopen
  // from /receiving?shipmentNo=... we adopt the URL's number. Held in state
  // (not a ref) so re-renders see the latest value after a collision retry.
  const [dockNo, setDockNo] = useState<string>(() => existingDockNo || generateDockNumber());
  // First-save stamps these from the current user/clock; subsequent saves
  // preserve them so we never re-clock who first received the truck.
  const [savedDockCompletedAt, setSavedDockCompletedAt] = useState<string | null>(null);
  const [savedDockCompletedBy, setSavedDockCompletedBy] = useState<string | null>(null);
  // Becomes true once we've persisted to Supabase at least once — used by
  // the saved-state hydrator to know whether the dock_* stamps are real.
  const [hasSavedDraft, setHasSavedDraft] = useState<boolean>(false);
  // While the reopen hydrator is running, suppress the rest of the form so
  // the operator doesn't see flicker between empty + loaded states.
  const [hydrating, setHydrating] = useState<boolean>(!!existingDockNo);
  const [hydrateError, setHydrateError] = useState<string>('');
  const apiConfigured = isApiConfigured();
  const { locationNames, loading: locationsLoading } = useLocations(apiConfigured);
  const { clients: liveClients, apiClients } = useClients(apiConfigured);

  // ─── Photos + docs scoped to this DOCK shipment ─────────────────────────
  // entity_type='shipment' / context_type='shipment' / entity_id=dockNo.
  // Anything the operator captures BEFORE the first save still attaches to
  // the future shipment row because both writes share `dockNo`. On Complete
  // Receiving, the reconcile step re-points these to the GAS-issued SHP no.
  const photoTenant = clientSheetId || null;
  const { photos, uploadPhoto } = usePhotos({
    entityType: 'shipment', entityId: dockNo, tenantId: photoTenant,
  });
  const { documents } = useDocuments({
    contextType: 'shipment', contextId: dockNo, tenantId: photoTenant,
  });

  // ─── Save for Later gating ──────────────────────────────────────────────
  // Three preconditions for Save for Later — picked one by one against
  // operator feedback after the unified flow shipped:
  //   1. A client must be chosen (Supabase row has tenant_id NOT NULL).
  //   2. A positive piece count must be entered (mirrors the gate the
  //      original DockIntakeForm had — a dock intake without a piece count
  //      is a half-formed receiving record).
  //   3. At least one dock-floor photo must be attached. Photos document
  //      what physically arrived and protect both Stride and the client
  //      against later damage / shortage disputes — operators were
  //      occasionally saving rows with zero proof, leaving claims
  //      unauditable.
  const pieceCountValid = useMemo(() => {
    const n = parseInt(pieceCount, 10);
    return Number.isFinite(n) && n > 0;
  }, [pieceCount]);
  const hasAtLeastOnePhoto = photos.length > 0;

  // ─── Reopen hydrator ────────────────────────────────────────────────────
  // Pulls the shipments row + draft items for `existingDockNo` once liveClients
  // has loaded enough to resolve clientName. Guarded by a one-shot ref so a
  // late re-render of liveClients doesn't restomp operator edits.
  //
  // Timeout safety net: if the clients API never returns (network down,
  // GAS misconfig, the autoFetch=false code paths still apply, etc.), we'd
  // hang the operator on an infinite spinner. After 8 seconds without
  // liveClients we proceed anyway and leave the client-name display blank
  // (the underlying tenant_id is enough to make Save / Complete work).
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!existingDockNo || hydratedRef.current) return;
    hydratedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const row = await fetchShipmentByNoFromSupabase(existingDockNo);
        if (cancelled) return;
        if (!row) {
          setHydrateError(`Couldn't find dock intake ${existingDockNo}. It may have been completed or deleted.`);
          return;
        }
        // NOTE: this effect MUST NOT depend on liveClients. It used to ([existingDockNo,
        // liveClients]); a liveClients update while either await below was in flight
        // re-ran the effect, whose cleanup set cancelled=true, while the hydratedRef
        // guard blocked a restart — so the cancelled run's finally skipped
        // setHydrating(false) and the operator was stuck on an infinite "Loading saved
        // dock intake…" spinner (reproduced on DOCK-20260608-D435). The client display
        // NAME is now resolved by the separate backfill effect below once liveClients
        // loads; the tenant_id (clientSheetId) set here is enough for Save/Complete.
        setClientSheetId(row.clientSheetId);
        setCarrier(row.carrier || '');
        setTracking(row.trackingNumber || '');
        setPieceCount(row.dockPieceCount != null ? String(row.dockPieceCount) : '');
        const { reference: parsedRef, notes: parsedNotes } = unpackNotes(row.notes);
        setReference(parsedRef);
        setNotes(parsedNotes);
        setSavedDockCompletedAt(row.dockCompletedAt ?? null);
        setSavedDockCompletedBy(row.dockCompletedBy ?? null);
        setHasSavedDraft(true);

        // Pull draft items in display order.
        const { data: drafts, error: draftErr } = await supabase
          .from('dock_draft_items')
          .select('*')
          .eq('tenant_id', row.clientSheetId)
          .eq('dock_shipment_number', existingDockNo)
          .order('display_order', { ascending: true });
        if (cancelled) return;
        if (draftErr) {
          setHydrateError(`Loaded the dock intake but couldn't load saved items: ${draftErr.message}`);
        } else if (drafts && drafts.length > 0) {
          setItems(drafts.map((d): DockItem => ({
            id: d.id,
            itemId: d.item_id || '',
            reference: d.reference || '',
            vendor: d.vendor || '',
            description: d.description || '',
            itemClass: d.item_class || '',
            qty: d.qty ?? 1,
            location: d.location || '',
            sidemark: d.sidemark || '',
            room: d.room || '',
            needsInspection: !!d.needs_inspection,
            needsAssembly: !!d.needs_assembly,
            itemNotes: d.item_notes || '',
            weight: d.weight != null ? Number(d.weight) : undefined,
            addons: Array.isArray(d.addons) ? d.addons : [],
            autoAppliedAddons: Array.isArray(d.auto_applied_addons) ? d.auto_applied_addons : [],
            dismissedAddons: Array.isArray(d.dismissed_addons) ? d.dismissed_addons : [],
            expanded: false,
          })));
        }
        // Else leave the 5 empty rows seeded by the default state — first-time
        // operators reopening a row where they only filled dock fields.
      } catch (err) {
        if (!cancelled) {
          setHydrateError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        // ALWAYS clear the spinner — even if this run was cancelled (e.g. by an
        // existingDockNo change). The old `if (!cancelled)` gate was the
        // infinite-spinner bug when the run got cancelled mid-flight.
        setHydrating(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- liveClients intentionally excluded; see note above + the backfill effect.
  }, [existingDockNo]);

  // Backfill the client display name once liveClients resolves the reopened
  // intake's tenant_id → name. Kept SEPARATE from the one-shot hydrate above so
  // a liveClients update can never re-trigger (and cancel) it. Reopen-only;
  // idempotent (writes only when the resolved name actually differs).
  useEffect(() => {
    if (!existingDockNo || !clientSheetId) return;
    const match = liveClients.find(c => c.id === clientSheetId);
    if (match && match.name && match.name !== client) setClient(match.name);
  }, [existingDockNo, clientSheetId, liveClients, client]);

  const clientAutoInspect = useMemo(() => {
    if (!clientSheetId || !apiClients.length) return false;
    const liveMatch = liveClients.find(c => c.id === clientSheetId);
    if (!liveMatch) return false;
    return apiClients.find(a => a.name === liveMatch.name)?.autoInspection ?? false;
  }, [clientSheetId, liveClients, apiClients]);

  // Race fix: patch existing items when apiClients loads after client was already selected
  const prevAutoInspectRef = useRef(false);
  useEffect(() => {
    if (prevAutoInspectRef.current === clientAutoInspect) return;
    prevAutoInspectRef.current = clientAutoInspect;
    setItems(prev => prev.map(item => ({ ...item, needsInspection: clientAutoInspect })));
  }, [clientAutoInspect]);

  const { sidemarks, vendors, descriptions } = useAutocomplete(clientSheetId || undefined);
  const { addons: catalogAddons } = useReceivingAddons();

  // Auto-apply: recompute which add-ons should be pre-checked per row based on
  // metadata rules. User-added codes are preserved; only codes previously tracked
  // in `autoAppliedAddons` get removed when the rule no longer matches (manual
  // overrides stay). Codes in `dismissedAddons` are skipped entirely — that's
  // how "user manually unchecked NO_ID after auto-apply" stays unchecked even
  // while the underlying sidemark is still empty. The reconcile check avoids
  // re-rendering when nothing changed.
  const autoApplySignature = useMemo(
    () => items.map(i => `${i.id}:${i.weight ?? ''}|${i.itemClass}|${i.autoAppliedAddons.join(',')}|${i.dismissedAddons.join(',')}`).join('~'),
    [items]
  );
  useEffect(() => {
    if (catalogAddons.length === 0) return;
    setItems(prev => {
      let changed = false;
      const next = prev.map(row => {
        const rawShould = computeAutoAppliedAddons(row, catalogAddons, client);
        // Respect manual dismissals — user already told us "no" for this code.
        const shouldBe = rawShould.filter(c => !row.dismissedAddons.includes(c));
        const prevAuto = row.autoAppliedAddons;
        const sameTracker = prevAuto.length === shouldBe.length && prevAuto.every(c => shouldBe.includes(c));
        if (sameTracker) return row;
        changed = true;
        const toAdd = shouldBe.filter(c => !row.addons.includes(c));
        const toRemove = prevAuto.filter(c => !shouldBe.includes(c));
        const nextAddons = Array.from(new Set([...row.addons.filter(c => !toRemove.includes(c)), ...toAdd]));
        return { ...row, addons: nextAddons, autoAppliedAddons: shouldBe };
      });
      return changed ? next : prev;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogAddons.length, autoApplySignature, client]);

  // v38.37.0 — derive the selected client's shipment note for the amber banner.
  // Uses the same match chain as the client-change handler (liveClients by id → apiClients
  // by name) so it stays in sync on initial mount, client-clear, and async apiClients refresh.
  const clientShipmentNote = useMemo(() => {
    if (!clientSheetId) return '';
    const liveMatch = liveClients.find(c => c.id === clientSheetId);
    if (!liveMatch) return '';
    const apiMatch = apiClients.find(a => a.name === liveMatch.name);
    return (apiMatch?.shipmentNote ?? '').trim();
  }, [clientSheetId, liveClients, apiClients]);

  // (auto-inspect race fix removed — caused React #300 on Inventory/Clients pages.
  //  Will re-add with cleaner pattern tomorrow.)

  // Auto-generated Item ID state
  const [autoIdEnabled, setAutoIdEnabled] = useState(false);
  const [autoIdError, setAutoIdError] = useState('');
  const autoIdLoadingRef = useRef<Set<string>>(new Set()); // track which row IDs are loading
  const [, forceUpdate] = useState(0); // trigger re-render when loading state changes

  // Fetch auto-ID setting once on mount
  useEffect(() => {
    if (!apiConfigured) return;
    let cancelled = false;
    fetchAutoIdSetting().then(resp => {
      if (!cancelled && resp.ok && resp.data) {
        setAutoIdEnabled(resp.data.enabled);
      }
    });
    return () => { cancelled = true; };
  }, [apiConfigured]);

  // Auto-assign Item ID for a single row
  const assignAutoId = useCallback(async (rowId: string) => {
    if (autoIdLoadingRef.current.has(rowId)) return;
    autoIdLoadingRef.current.add(rowId);
    forceUpdate(n => n + 1);
    setAutoIdError('');
    try {
      const resp = await fetchNextItemId();
      if (resp.ok && resp.data) {
        setItems(prev => prev.map(item =>
          item.id === rowId ? { ...item, itemId: resp.data!.itemId } : item
        ));
      } else {
        setAutoIdError(resp.error || 'Failed to get Item ID');
      }
    } catch (err) {
      setAutoIdError(err instanceof Error ? err.message : String(err));
    } finally {
      autoIdLoadingRef.current.delete(rowId);
      forceUpdate(n => n + 1);
    }
  }, []);

  // When auto-ID gets enabled (on mount or toggle), assign IDs to any rows that don't have one yet
  const autoIdEnabledRef = useRef(false);
  useEffect(() => {
    if (autoIdEnabled && !autoIdEnabledRef.current) {
      autoIdEnabledRef.current = true;
      // Assign IDs to all existing rows that are blank
      items.forEach(item => {
        if (!item.itemId.trim()) assignAutoId(item.id);
      });
    }
    if (!autoIdEnabled) autoIdEnabledRef.current = false;
  }, [autoIdEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const filledItems = items.filter(i => i.itemId.trim() && i.description.trim());

  const update = useCallback((idx: number, field: keyof DockItem, value: string | number | boolean) => {
    // Item ID is digits-only. Scrub anything else here (paste, IME, browser
    // autofill, accidental ' / `) so a typo can never poison the row before
    // it's submitted. Justin caught a leading apostrophe on Nip Tuck that
    // broke task linking + RCVG billing — sanitizing at the write boundary
    // is the cheapest defense.
    if (field === 'itemId' && typeof value === 'string') {
      value = value.replace(/\D+/g, '');
    }
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, [field]: value } : item));
  }, []);

  const addRow = useCallback(() => {
    const newItem = emptyItem(clientAutoInspect);
    setItems(prev => [...prev, newItem]);
    if (autoIdEnabled) assignAutoId(newItem.id);
  }, [clientAutoInspect, autoIdEnabled, assignAutoId]);

  const addRows = useCallback((n: number) => {
    const newItems = Array.from({ length: n }, () => emptyItem(clientAutoInspect));
    setItems(prev => [...prev, ...newItems]);
    if (autoIdEnabled) {
      newItems.forEach(item => assignAutoId(item.id));
    }
  }, [clientAutoInspect, autoIdEnabled, assignAutoId]);
  const removeRow = useCallback((idx: number) => setItems(prev => prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev), []);
  const duplicateRow = useCallback((idx: number) => {
    const newId = `r-${Date.now()}-${Math.random().toString(36).slice(2,6)}`;
    setItems(prev => {
      const src = prev[idx];
      // Copy ALL settings including add-ons (user requirement). Arrays are cloned
      // to prevent the new row's toggles from mutating the original row's state.
      const copy: DockItem = {
        ...src,
        id: newId,
        itemId: autoIdEnabled ? '' : src.itemId,
        addons: [...src.addons],
        autoAppliedAddons: [...src.autoAppliedAddons],
        dismissedAddons: [...src.dismissedAddons],
      };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
    if (autoIdEnabled) assignAutoId(newId);
  }, [autoIdEnabled, assignAutoId]);

  const toggleRowExpanded = useCallback((idx: number) => {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, expanded: !item.expanded } : item));
  }, []);

  const toggleAddon = useCallback((idx: number, code: string) => {
    // Local state only — no API calls. Billing entries for every checked
    // add-on are written ONCE, in handleComplete, via the shipment payload.
    setItems(prev => prev.map((item, i) => {
      if (i !== idx) return item;
      const has = item.addons.includes(code);
      if (has) {
        // User unchecked this code — remove from active addons AND from the
        // auto-applied tracker, AND record the dismissal so the auto-apply
        // effect won't re-check the box on the next render while the rule
        // still matches (e.g. sidemark still empty for NO_ID).
        return {
          ...item,
          addons: item.addons.filter(c => c !== code),
          autoAppliedAddons: item.autoAppliedAddons.filter(c => c !== code),
          dismissedAddons: item.dismissedAddons.includes(code)
            ? item.dismissedAddons
            : [...item.dismissedAddons, code],
        };
      }
      // User checked this code — clear any prior dismissal so the auto-apply
      // effect can reconcile normally (and can re-promote the code to "auto"
      // on its next pass if the rule still matches).
      return {
        ...item,
        addons: [...item.addons, code],
        dismissedAddons: item.dismissedAddons.filter(c => c !== code),
      };
    }));
  }, []);

  const updateWeight = useCallback((idx: number, raw: string) => {
    const n = parseFloat(raw);
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, weight: Number.isFinite(n) && n > 0 ? n : undefined } : item));
  }, []);

  // Column order used for multi-column Excel paste. Matches the visible table
  // column order so users can copy an Excel range and it lines up exactly.
  const PASTE_FIELD_ORDER: (keyof DockItem)[] = [
    'itemId', 'vendor', 'description', 'itemClass', 'qty',
    'location', 'sidemark', 'reference', 'room'
  ];

  // Apply pasted text (TSV — tab-separated columns, newline-separated rows)
  // into the grid starting at a given row index + field.
  //   - Single cell (no tabs, no newlines): let the input's default paste handle it.
  //   - Multi-column paste: spreads rightward across PASTE_FIELD_ORDER.
  //   - Multi-row paste: creates new rows as needed.
  //   - qty coerced to int, itemClass coerced to known CLASS letter, others as text.
  const applyBulkPaste = useCallback((text: string, startIdx: number, startField: keyof DockItem) => {
    const normalized = text.replace(/\r\n?/g, '\n');
    if (!normalized.includes('\n') && !normalized.includes('\t')) return false; // single-cell paste, fallback to default
    const lines = normalized.split('\n').filter((l, i, arr) => l.length > 0 || i < arr.length - 1);
    if (lines.length === 0) return false;
    const startFieldIdx = PASTE_FIELD_ORDER.indexOf(startField);
    if (startFieldIdx < 0) return false;
    const newRowIds: string[] = [];
    setItems(prev => {
      const next = [...prev];
      lines.forEach((line, offset) => {
        const cols = line.split('\t');
        const targetIdx = startIdx + offset;
        if (targetIdx >= next.length) {
          const item = emptyItem(clientAutoInspect);
          next.push(item);
          newRowIds.push(item.id);
        }
        const row = { ...next[targetIdx] };
        cols.forEach((raw, colOffset) => {
          const fieldIdx = startFieldIdx + colOffset;
          if (fieldIdx >= PASTE_FIELD_ORDER.length) return;
          const fld = PASTE_FIELD_ORDER[fieldIdx];
          if (autoIdEnabled && fld === 'itemId') return;
          const val = raw.trim();
          if (fld === 'qty') {
            const n = parseInt(val, 10);
            row.qty = Number.isFinite(n) && n > 0 ? n : 1;
          } else if (fld === 'itemClass') {
            const up = val.toUpperCase();
            row.itemClass = CLASSES.includes(up) ? up : row.itemClass;
          } else if (fld === 'itemId') {
            // Same digits-only rule as the manual input path. Excel pastes
            // often carry stray quotes / spaces that would break linking.
            row.itemId = val.replace(/\D+/g, '');
          } else {
            (row as Record<string, unknown>)[fld as string] = val;
          }
        });
        next[targetIdx] = row;
      });
      return next;
    });
    if (autoIdEnabled && newRowIds.length > 0) {
      newRowIds.forEach(id => assignAutoId(id));
    }
    return true;
  }, [autoIdEnabled, assignAutoId, clientAutoInspect]);

  const handlePaste = useCallback((e: React.ClipboardEvent<HTMLInputElement>, startIdx: number, field: keyof DockItem) => {
    const text = e.clipboardData.getData('text');
    const consumed = applyBulkPaste(text, startIdx, field);
    if (consumed) e.preventDefault();
  }, [applyBulkPaste]);

  // Bulk-paste dialog state — exposed via the "Paste from Excel" button above the grid
  const [bulkPasteOpen, setBulkPasteOpen] = useState(false);
  const [bulkPasteText, setBulkPasteText] = useState('');
  const [bulkPasteStartField, setBulkPasteStartField] = useState<keyof DockItem>('itemId');
  const applyBulkPasteFromModal = useCallback(() => {
    if (!bulkPasteText.trim()) { setBulkPasteOpen(false); return; }
    // Paste into the first empty row (or row 0 if grid is empty/full of values)
    const firstEmptyIdx = items.findIndex(r => !r.itemId && !r.description && !r.vendor);
    const startIdx = firstEmptyIdx >= 0 ? firstEmptyIdx : items.length;
    // Normalize: if user pasted a single row into the modal without tabs, treat
    // as a single column paste by inserting a fake tab to trigger applyBulkPaste.
    const text = bulkPasteText.includes('\t') || bulkPasteText.includes('\n')
      ? bulkPasteText
      : bulkPasteText + '\t';
    applyBulkPaste(text, startIdx, bulkPasteStartField);
    setBulkPasteText('');
    setBulkPasteOpen(false);
  }, [bulkPasteText, bulkPasteStartField, items, applyBulkPaste]);

  const toggleAutoPrint = useCallback(() => {
    setAutoPrintLabels(prev => {
      const next = !prev;
      localStorage.setItem('stride_auto_print_labels', String(next));
      return next;
    });
  }, []);

  const printItemLabels = useCallback((labelItems: DockItem[], clientName: string) => {
    const el = printRef.current;
    if (!el) return;

    const labelsHtml = labelItems.map((item, idx) => {
      const itemId = item.itemId || '—';
      return `
        <div class="print-label" style="width:3.8in;height:5.8in;padding:0.14in;background:#fff;color:#000;
          font-family:Arial,Helvetica,sans-serif;display:flex;flex-direction:column;overflow:hidden;
          page-break-after:always;break-after:page;border:0.5pt solid #aaa;box-sizing:border-box;">
          <div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;min-height:0;overflow:hidden;">
            <div style="font-size:24pt;font-weight:900;text-align:center;letter-spacing:0.5px;color:#000;
              line-height:1.1;margin-bottom:3px;font-family:'Arial Black',Arial,sans-serif;word-break:break-all;width:100%;">
              ${esc(itemId)}
            </div>
            <div style="display:flex;flex-direction:column;align-items:center;width:100%;">
              <div style="font-size:6px;font-weight:700;text-transform:uppercase;letter-spacing:0.7px;color:#aaa;">ACCOUNT</div>
              <div style="font-size:18pt;font-weight:600;color:#111;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%;">${esc(clientName)}</div>
            </div>
            ${item.sidemark ? `
            <div style="display:flex;flex-direction:column;align-items:center;width:100%;">
              <div style="font-size:6px;font-weight:700;text-transform:uppercase;letter-spacing:0.7px;color:#aaa;">SIDEMARK</div>
              <div style="font-size:16pt;font-weight:600;color:#111;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%;">${esc(item.sidemark)}</div>
            </div>` : ''}
            ${item.vendor ? `
            <hr style="border:none;border-top:1px solid #ddd;margin:3px 0;width:100%;">
            <div style="display:flex;flex-direction:column;align-items:center;width:100%;">
              <div style="font-size:6px;font-weight:700;text-transform:uppercase;letter-spacing:0.7px;color:#aaa;">VENDOR</div>
              <div style="font-size:12pt;font-weight:600;color:#111;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%;">${esc(item.vendor)}</div>
            </div>` : ''}
            ${item.description ? `
            <div style="display:flex;flex-direction:column;align-items:center;width:100%;">
              <div style="font-size:6px;font-weight:700;text-transform:uppercase;letter-spacing:0.7px;color:#aaa;">DESCRIPTION</div>
              <div style="font-size:10pt;font-weight:600;color:#111;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;width:100%;">${esc(item.description)}</div>
            </div>` : ''}
            ${item.location ? `
            <div style="display:flex;flex-direction:column;align-items:center;width:100%;">
              <div style="font-size:6px;font-weight:700;text-transform:uppercase;letter-spacing:0.7px;color:#aaa;">LOCATION</div>
              <div style="font-size:10pt;font-weight:600;color:#111;text-align:center;">${esc(item.location)}</div>
            </div>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;align-items:center;padding-top:6px;border-top:1px solid #e5e5e5;margin-top:5px;flex-shrink:0;">
            <div id="qr-print-${idx}"></div>
            <p style="font-size:6px;color:#bbb;margin-top:3px;text-align:center;letter-spacing:0.3px;">Item QR</p>
            <p style="font-size:7px;font-weight:700;color:#666;font-family:monospace;letter-spacing:1px;margin-top:1px;text-align:center;">${esc(itemId)}</p>
          </div>
        </div>`;
    }).join('');

    el.innerHTML = labelsHtml;

    const generateQrs = () => {
      labelItems.forEach((item, idx) => {
        const qrEl = document.getElementById(`qr-print-${idx}`);
        if (!qrEl || !(window as any).QRCode) return;
        qrEl.innerHTML = '';
        new (window as any).QRCode(qrEl, {
          text: 'ITEM:' + (item.itemId || 'UNKNOWN'),
          width: 120, height: 120,
          colorDark: '#000000', colorLight: '#ffffff',
          correctLevel: (window as any).QRCode.CorrectLevel.M,
        });
      });
      setTimeout(() => window.print(), 300);
    };

    if ((window as any).QRCode) {
      generateQrs();
    } else {
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
      script.onload = generateQrs;
      document.head.appendChild(script);
    }
  }, []);

  const handleComplete = useCallback(async () => {
    if (!client || filledItems.length === 0) return;
    setSubmitError('');

    // If API not configured, use demo mode
    if (!apiConfigured || !clientSheetId) {
      setSubmitResult({ shipmentNo: 'SHP-DEMO', itemCount: filledItems.length, tasksCreated: 0, billingRows: 0 });
      setSubmitted(true);
      return;
    }

    // Build payload
    const apiItems: ShipmentItemPayload[] = filledItems.map(i => ({
      itemId: i.itemId.trim(),
      qty: i.qty || 1,
      vendor: i.vendor.trim(),
      description: i.description.trim(),
      class: i.itemClass,
      location: i.location.trim(),
      sidemark: i.sidemark.trim(),
      reference: i.reference.trim() || undefined,
      room: i.room.trim() || undefined,
      needsInspection: i.needsInspection,
      needsAssembly: i.needsAssembly,
      itemNotes: i.itemNotes.trim() || undefined,
      weight: i.weight,
      addons: i.addons.length > 0 ? i.addons : undefined,
    }));

    setSubmitting(true);
    try {
      // ─── Phase 3: item_id_ledger preflight ──────────────────────────────────
      // Query the ledger for every Item ID on this shipment. Block on cross-
      // tenant collisions (an ID already owned by a DIFFERENT client). Same-
      // tenant hits are tolerated — they happen on idempotent resubmits.
      // Degraded mode (Supabase unreachable): show a warning but let the save
      // proceed per the 2026-04-14 decision. Server-side completeShipment has
      // its own guard as the final line of defense.
      const ids = apiItems.map(i => i.itemId).filter(Boolean);
      if (ids.length > 0) {
        const check = await postCheckItemIdsAvailable(ids);
        if (check.ok && check.data) {
          const crossDups = check.data.duplicates.filter(d => d.tenantId !== clientSheetId);
          if (crossDups.length > 0) {
            const lines = crossDups.slice(0, 8).map(d => {
              const owner = d.tenantName || `tenant ${d.tenantId.slice(0, 10)}…`;
              return `• ${d.itemId} — already assigned to ${owner} (${d.status})`;
            });
            const more = crossDups.length > 8 ? `\n…and ${crossDups.length - 8} more` : '';
            setSubmitError(
              `Duplicate Item ID${crossDups.length > 1 ? 's' : ''} detected — cannot receive:\n${lines.join('\n')}${more}\n\nEdit the Item ID column and try again.`
            );
            setSubmitting(false);
            return;
          }
          if (check.data.degraded) {
            // Non-blocking warning. We still proceed; the server guard + nightly
            // reconciliation catches anything we missed here.
            console.warn('[Receiving] item_id_ledger check degraded — Supabase unreachable. Proceeding without preflight duplicate detection.');
          }
        }
        // If check itself errored (network, auth), fall through — server has its own guard.
      }

      const resp = await postCompleteShipment({
        idempotencyKey: idempotencyKeyRef.current,
        items: apiItems,
        carrier: carrier.trim(),
        trackingNumber: tracking.trim(),
        // Pack reference + notes into the single `notes` field GAS understands.
        // GAS gets the same combined string the operator sees; the React side
        // unpacks it again on reopen so reference and notes round-trip cleanly.
        notes: packNotes(reference, notes),
        receiveDate,
        ...(!chargeReceiving && { skipReceivingBilling: true }),
        // Signal that React resolved the auto-inspection setting before submit.
        // If apiClients hadn't loaded (race condition), checkboxes may be wrong →
        // server falls back to AUTO_INSPECTION from client Settings.
        autoInspectionLoaded: apiClients.length > 0,
      }, clientSheetId);

      if (!resp.ok || !resp.data) {
        setSubmitError(resp.error || 'Unknown error');
        setSubmitting(false);
        return;
      }

      if (!resp.data.success && !resp.data.alreadyProcessed) {
        setSubmitError(resp.data.message || resp.error || 'Shipment failed');
        setSubmitting(false);
        return;
      }

      const newShipmentNo = resp.data.shipmentNo || '';

      // ─── Stage 2 reconciliation ────────────────────────────────────────
      // When this submit came from a Stage 1 dock intake, we need to:
      //   1. Copy the dock_* metadata onto the GAS-created shipment row
      //      (which arrived in Supabase via GAS write-through with default
      //      inbound_status='expected') and mark it 'received'.
      //   2. Re-link photos + documents from the DOCK shipment_number to
      //      the new SHP number so the operator's dock-door photos show up
      //      on the formal shipment record.
      //   3. Delete the DOCK row so the shipments list shows a single row
      //      per physical shipment.
      //
      // Each step is best-effort + isolated — a failure on photo re-link
      // doesn't roll back the GAS write (which already succeeded and
      // produced inventory rows + billing). We surface warnings instead.
      // ─── DOCK → SHP reconciliation ────────────────────────────────────
      // Only fires when there's actually a DOCK row to reconcile against.
      // The unified flow ALWAYS holds a `dockNo`, but a row only exists in
      // Supabase after the operator has saved at least once (hasSavedDraft)
      // OR is mid-completion of a previously reopened intake (existingDockNo
      // was set on mount). Skip the reconcile entirely for a "fresh load,
      // never saved, hit Complete Receiving immediately" flow — there's no
      // DOCK row, no draft items, no photos to re-link against `dockNo`.
      const reconcileWarnings: string[] = [];
      const reconcileDock = !!newShipmentNo && (hasSavedDraft || !!existingDockNo);
      if (reconcileDock) {
        // Each step is best-effort + isolated. We DO gate the final DELETEs on
        // success of every preceding step, though — otherwise we'd leave the
        // operator looking at a DOCK row in the list whose photos already
        // moved to SHP, with no obvious recovery path. Errors surface as
        // warnings so the GAS write (already done) isn't rolled back.
        let metadataOk = false;
        let photosOk = false;
        let docsOk = false;

        // Compute the dock metadata snapshot we want to carry forward onto
        // the new SHP row. Prefer the saved stamps (set at first save);
        // fall back to the form's current values for a same-session
        // first-save-then-complete sequence.
        const pieceCountNum = parseInt(pieceCount, 10);
        const validPieceCount = Number.isFinite(pieceCountNum) && pieceCountNum > 0 ? pieceCountNum : null;
        const nowIso = new Date().toISOString();
        const carryDockCompletedAt = savedDockCompletedAt || nowIso;
        const carryDockCompletedBy = savedDockCompletedBy || user?.email || '';

        // Step 1: stamp dock metadata onto the new SHP row + mark received.
        try {
          const { error: e1 } = await supabase.from('shipments')
            .update({
              inbound_status: 'received',
              dock_piece_count: validPieceCount,
              dock_completed_at: carryDockCompletedAt,
              dock_completed_by: carryDockCompletedBy,
            })
            .eq('shipment_number', newShipmentNo);
          if (e1) throw new Error(e1.message);
          metadataOk = true;
        } catch (e) {
          reconcileWarnings.push(`Could not stamp dock metadata onto ${newShipmentNo}: ${e instanceof Error ? e.message : String(e)}`);
        }

        // Step 2: re-link photos. Tenant filter is required — RLS on
        // item_photos is staff-role-wide (no tenant scope), so without
        // .eq('tenant_id', ...) a DOCK number collision across tenants
        // would retag the wrong tenant's photos. The 16-bit suffix makes
        // collisions improbable, but defense-in-depth is cheap.
        try {
          const { error: e2 } = await supabase.from('item_photos')
            .update({ entity_id: newShipmentNo })
            .eq('tenant_id', clientSheetId)
            .eq('entity_type', 'shipment')
            .eq('entity_id', dockNo);
          if (e2) throw new Error(e2.message);
          photosOk = true;
        } catch (e) {
          reconcileWarnings.push(`Could not move dock photos from ${dockNo} → ${newShipmentNo}: ${e instanceof Error ? e.message : String(e)}`);
        }

        // Step 3: re-link documents. Same tenant-scoped defense.
        try {
          const { error: e3 } = await supabase.from('documents')
            .update({ context_id: newShipmentNo })
            .eq('tenant_id', clientSheetId)
            .eq('context_type', 'shipment')
            .eq('context_id', dockNo);
          if (e3) throw new Error(e3.message);
          docsOk = true;
        } catch (e) {
          reconcileWarnings.push(`Could not move dock documents from ${dockNo} → ${newShipmentNo}: ${e instanceof Error ? e.message : String(e)}`);
        }

        // Step 4: delete the DOCK placeholder + any draft items. Only if
        // every prior step succeeded — otherwise photos/docs/metadata are
        // stranded and the DOCK row is the only handle left for manual
        // cleanup. dock_draft_items are always safe to delete regardless
        // (they've already been replaced by real inventory rows from GAS).
        if (metadataOk && photosOk && docsOk) {
          try {
            const { error: e4 } = await supabase.from('shipments')
              .delete()
              .eq('shipment_number', dockNo);
            if (e4) throw new Error(e4.message);
          } catch (e) {
            reconcileWarnings.push(`Could not remove dock intake row ${dockNo}: ${e instanceof Error ? e.message : String(e)}`);
          }
        } else {
          reconcileWarnings.push(`Receiving completed as ${newShipmentNo}, but the dock intake row ${dockNo} was left in place because not every step of the metadata move succeeded. Review the warnings above and clean up manually before the next dock intake for this client.`);
        }
        // Best-effort cleanup of draft items regardless of the gated step
        // above — these aren't visible anywhere in the UI and only matter
        // for next-open hydration of THIS dock number, which is moot once
        // GAS has promoted them to real inventory.
        try {
          await supabase.from('dock_draft_items')
            .delete()
            .eq('tenant_id', clientSheetId)
            .eq('dock_shipment_number', dockNo);
        } catch (e) {
          reconcileWarnings.push(`Could not clear dock draft items for ${dockNo}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      setSubmitResult({
        shipmentNo: newShipmentNo,
        itemCount: resp.data.itemCount || filledItems.length,
        tasksCreated: resp.data.tasksCreated || 0,
        billingRows: resp.data.billingRows || 0,
        warnings: [...(resp.data.warnings ?? []), ...reconcileWarnings],
      });

      // Auto-archive a Receiving PDF into the documents bucket. Fires after
      // the GAS write succeeded — failures queue silently for retry (see
      // docUploadQueue) so we never block the operator on a render hiccup.
      if (newShipmentNo && clientSheetId) {
        const tokens = buildReceivingTokens({
          shipmentNo:   newShipmentNo,
          clientName:   client,
          carrier:      carrier.trim(),
          tracking:     tracking.trim(),
          receivedDate: receiveDate,
          notes,
          totalItems:   filledItems.length,
          items: filledItems.map(i => ({
            itemId:      i.itemId,
            qty:         i.qty,
            vendor:      i.vendor,
            description: i.description,
            itemClass:   i.itemClass,
            location:    i.location,
            sidemark:    i.sidemark,
            reference:   i.reference,
          })),
        });
        void renderDoc('DOC_RECEIVING', tokens, {
          action: 'upload',
          fileName: `Stride_Receiving_${newShipmentNo}`,
          tenantId: clientSheetId,
          entityType: 'shipment',
          entityId: newShipmentNo,
        });
      }

      // Auto-print labels if toggle is on
      if (autoPrintLabels && filledItems.length > 0) {
        printItemLabels(filledItems, client);
      }

      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [client, clientSheetId, filledItems, apiConfigured, carrier, tracking, notes, reference, receiveDate, chargeReceiving, autoPrintLabels, printItemLabels, dockNo, hasSavedDraft, existingDockNo, pieceCount, savedDockCompletedAt, savedDockCompletedBy, user?.email]);

  // ─── Save for Later ────────────────────────────────────────────────────
  // UPSERTs the shipments row (inbound_status='in_progress') and replaces the
  // dock_draft_items rows for this DOCK number. Returns to /shipments via the
  // history-aware goBack so the operator lands on the list with their prior
  // filters intact. Handles same-day suffix collision with a single retry,
  // dragging any already-uploaded photos/docs onto the new number.
  const handleSaveForLater = useCallback(async () => {
    if (!clientSheetId) {
      setSubmitError('Pick a client before saving.');
      return;
    }
    setSubmitError('');
    setSavingDraft(true);

    // Snapshot the dock-level state into payload-shaped form.
    const combinedNotes = packNotes(reference, notes);
    const pieceCountNum = parseInt(pieceCount, 10);
    const validPieceCount = Number.isFinite(pieceCountNum) && pieceCountNum > 0 ? pieceCountNum : null;
    const nowIso = new Date().toISOString();
    const today = nowIso.slice(0, 10);

    // First-save stamps; re-saves preserve so we don't re-clock the
    // operator who initially received the truck.
    const dockCompletedAt = savedDockCompletedAt || nowIso;
    const dockCompletedBy = savedDockCompletedBy || user?.email || '';

    // Only persist items that have *something* in them — exact same predicate
    // we use to gate Complete Receiving, modulo dropping the description+id
    // requirement so a partially-typed row still survives a "Save for Later"
    // tap (operator's mid-flight state shouldn't get silently dropped).
    const partialItems = items.filter(
      i => i.itemId.trim() || i.description.trim() || i.vendor.trim() || i.reference.trim()
    );

    // Build the shipment row + draft rows. Both writes share `targetDockNo`
    // so the collision-retry path can swap them in lockstep.
    const buildShipmentRow = (sn: string) => ({
      tenant_id: clientSheetId,
      shipment_number: sn,
      receive_date: today,
      item_count: partialItems.length,
      carrier: carrier.trim(),
      tracking_number: tracking.trim(),
      notes: combinedNotes,
      inbound_status: 'in_progress',
      dock_piece_count: validPieceCount,
      dock_completed_at: dockCompletedAt,
      dock_completed_by: dockCompletedBy,
    });
    const buildDraftRows = (sn: string) => partialItems.map((it, idx) => ({
      tenant_id: clientSheetId,
      dock_shipment_number: sn,
      display_order: idx,
      item_id: it.itemId.trim() || null,
      vendor: it.vendor.trim() || null,
      description: it.description.trim() || null,
      item_class: it.itemClass || null,
      qty: it.qty || 1,
      location: it.location.trim() || null,
      sidemark: it.sidemark.trim() || null,
      reference: it.reference.trim() || null,
      room: it.room.trim() || null,
      needs_inspection: !!it.needsInspection,
      needs_assembly: !!it.needsAssembly,
      item_notes: it.itemNotes.trim() || null,
      weight: it.weight ?? null,
      addons: it.addons,
      auto_applied_addons: it.autoAppliedAddons,
      dismissed_addons: it.dismissedAddons,
    }));

    try {
      let targetDockNo = dockNo;
      // UPSERT shipments. On a same-day suffix collision (only possible the
      // very first time we save — once `hasSavedDraft` is true we own the
      // suffix and conflict-resolve via the unique constraint), generate a
      // new suffix and retry once. Already-uploaded photos/docs get
      // re-pointed onto the retry number so the operator's pre-save captures
      // survive.
      const upsertResult = await supabase
        .from('shipments')
        .upsert(buildShipmentRow(targetDockNo), { onConflict: 'tenant_id,shipment_number' });
      let upsertError = upsertResult.error;
      if (upsertError && !hasSavedDraft && isDockNumberCollision(upsertError)) {
        const retryNo = generateDockNumber();
        const retry = await supabase
          .from('shipments')
          .upsert(buildShipmentRow(retryNo), { onConflict: 'tenant_id,shipment_number' });
        if (!retry.error) {
          // Re-tag any photos/docs already uploaded under the original
          // dockNo onto the retry number. Tenant-scoped to defend against
          // cross-tenant collisions.
          await supabase.from('item_photos')
            .update({ entity_id: retryNo })
            .eq('tenant_id', clientSheetId)
            .eq('entity_type', 'shipment')
            .eq('entity_id', targetDockNo);
          await supabase.from('documents')
            .update({ context_id: retryNo })
            .eq('tenant_id', clientSheetId)
            .eq('context_type', 'shipment')
            .eq('context_id', targetDockNo);
          targetDockNo = retryNo;
          setDockNo(retryNo);
          upsertError = null;
        } else {
          upsertError = retry.error;
        }
      }
      if (upsertError) throw new Error(upsertError.message || 'Failed to save dock intake');

      // Replace draft items: delete existing for this DOCK + bulk-insert
      // the current set. Cheaper to write than diff because the typical
      // draft set is < 50 rows.
      const { error: delErr } = await supabase.from('dock_draft_items')
        .delete()
        .eq('tenant_id', clientSheetId)
        .eq('dock_shipment_number', targetDockNo);
      if (delErr) throw new Error(`Failed to clear stale draft items: ${delErr.message}`);
      if (partialItems.length > 0) {
        const { error: insErr } = await supabase.from('dock_draft_items')
          .insert(buildDraftRows(targetDockNo));
        if (insErr) {
          // DELETE succeeded, INSERT failed → operator's items are wiped from
          // Supabase but still in their grid (React state untouched). Surface
          // that explicitly so they know the right next move is "tap Save
          // for Later again" rather than walking away thinking it saved.
          throw new Error(
            `Items NOT saved — your dock fields are stored, but the items grid couldn't be persisted: ${insErr.message}. Tap Save for Later again to retry; your entries are still on screen.`
          );
        }
      }

      // Mark as saved + remember the stamps for the next save.
      setHasSavedDraft(true);
      setSavedDockCompletedAt(dockCompletedAt);
      setSavedDockCompletedBy(dockCompletedBy);
      // Notify the shipments list so the In Progress row updates without a
      // manual refresh. Use `emitFromRealtime` (not `emit`) since the row
      // is already authoritative in Supabase from our direct write.
      try { entityEvents.emitFromRealtime('shipment', targetDockNo); } catch { /* noop */ }
      // goBack() pops to wherever they came from (typically /shipments with
      // filters intact). Falls back to /shipments when there's no in-app
      // history. We don't navigate(`/receiving?shipmentNo=...`) before this:
      // the user is leaving the page, so persisting the URL is dead work —
      // when they reopen via the In Progress list they'll get the canonical
      // shipmentNo back from the row anyway.
      goBack();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingDraft(false);
    }
  }, [clientSheetId, carrier, tracking, notes, reference, pieceCount, items, dockNo, hasSavedDraft, savedDockCompletedAt, savedDockCompletedBy, user?.email, goBack]);

  // ─── TanStack Table setup ─────────────────────────────────────────────────

  // Annotate each item with its original array index so cell renderers can
  // call update(idx, ...) correctly even when rows are sorted.
  const tableData = useMemo<TableRow[]>(
    () => items.map((item, i) => ({ ...item, _originalIdx: i })),
    [items],
  );

  // Column definitions memoized to prevent remounting inputs on every keystroke.
  // autoIdLoadingRef is a ref — closures always see the current .current value
  // regardless of when they were created, so memoization is safe.
  // items.length is included so the remove-button disabled state updates on row add/remove.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const columns = useMemo(() => [
    // ── expand / add-ons toggle ─────────────────────────────────────────────
    columnHelper.display({
      id: 'expand',
      size: 28,
      enableHiding: false,
      enableSorting: false,
      header: () => null,
      cell: ({ row }) => {
        const item = row.original;
        const idx = item._originalIdx;
        return (
          <button
            onClick={() => toggleRowExpanded(idx)}
            title={item.expanded ? 'Hide add-on services' : 'Show add-on services'}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: item.addons.length > 0 ? theme.colors.orange : theme.colors.textMuted, display: 'inline-flex', alignItems: 'center', gap: 2 }}
          >
            {item.expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            {item.addons.length > 0 && (
              <span style={{ fontSize: 9, fontWeight: 700, background: theme.colors.orange, color: '#fff', borderRadius: 8, padding: '1px 5px', lineHeight: 1 }}>{item.addons.length}</span>
            )}
          </button>
        );
      },
    }),
    // ── row number ───────────────────────────────────────────────────────────
    columnHelper.display({
      id: 'rowNum',
      size: 36,
      enableHiding: false,
      enableSorting: false,
      header: () => '#',
      cell: ({ row }) => (
        <span style={{ fontSize: 11, color: theme.colors.textMuted, fontWeight: 600 }}>
          {row.original._originalIdx + 1}
        </span>
      ),
    }),
    // ── Item ID ──────────────────────────────────────────────────────────────
    columnHelper.accessor('itemId', {
      id: 'itemId',
      size: 110,
      header: () => autoIdEnabled ? 'Item ID (Auto)' : 'Item ID *',
      cell: ({ row }) => {
        const item = row.original;
        const idx = item._originalIdx;
        if (autoIdEnabled) {
          return (
            <div style={{ ...cellInput, fontWeight: 600, fontFamily: 'monospace', fontSize: 11, background: '#F9FAFB', color: autoIdLoadingRef.current.has(item.id) ? theme.colors.textMuted : theme.colors.textPrimary, display: 'flex', alignItems: 'center', minHeight: 28 }}>
              {autoIdLoadingRef.current.has(item.id)
                ? <span style={{ fontFamily: 'inherit', fontWeight: 400, fontSize: 11 }}>Assigning...</span>
                : (item.itemId || <span style={{ color: '#DC2626', fontSize: 10 }}>Error</span>)
              }
            </div>
          );
        }
        return (
          <input
            value={item.itemId}
            onChange={e => update(idx, 'itemId', e.target.value)}
            onPaste={e => handlePaste(e, idx, 'itemId')}
            // Block non-digit keypresses up front so the user gets immediate
            // feedback (the character literally doesn't appear) instead of
            // typing something that gets silently scrubbed by the onChange
            // sanitizer. Whitelist navigation/edit keys so backspace etc.
            // still work.
            onKeyDown={e => {
              if (e.metaKey || e.ctrlKey || e.altKey) return;          // Cmd/Ctrl shortcuts
              if (e.key.length > 1) return;                            // Arrows, Tab, Enter, Backspace, etc.
              if (!/^[0-9]$/.test(e.key)) e.preventDefault();
            }}
            inputMode="numeric"
            pattern="[0-9]*"
            placeholder="Item ID"
            style={{ ...cellInput, fontWeight: 600, fontFamily: 'monospace', fontSize: 11 }}
          />
        );
      },
    }),
    // ── Vendor ───────────────────────────────────────────────────────────────
    columnHelper.accessor('vendor', {
      id: 'vendor',
      size: 130,
      header: () => 'Vendor',
      cell: ({ row }) => (
        <AutocompleteInput value={row.original.vendor} onChange={val => update(row.original._originalIdx, 'vendor', val)} placeholder="Vendor" suggestions={vendors} icon={false} style={{ fontSize: 12 }} />
      ),
    }),
    // ── Description ──────────────────────────────────────────────────────────
    columnHelper.accessor('description', {
      id: 'description',
      size: 260,
      header: () => 'Description *',
      cell: ({ row }) => (
        <AutocompleteInput value={row.original.description} onChange={val => update(row.original._originalIdx, 'description', val)} placeholder="Item description..." suggestions={descriptions} icon={false} multiline style={{ fontSize: 12, fontWeight: row.original.description ? 500 : 400 }} />
      ),
    }),
    // ── Class ────────────────────────────────────────────────────────────────
    columnHelper.accessor('itemClass', {
      id: 'itemClass',
      size: 60,
      header: () => 'Class',
      cell: ({ row }) => (
        <select value={row.original.itemClass} onChange={e => update(row.original._originalIdx, 'itemClass', e.target.value)} style={cellSelect}>
          <option value="">--</option>
          {CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      ),
    }),
    // ── Qty ──────────────────────────────────────────────────────────────────
    columnHelper.accessor('qty', {
      id: 'qty',
      size: 50,
      header: () => 'Qty',
      cell: ({ row }) => (
        <input type="number" min={1} value={row.original.qty} onChange={e => update(row.original._originalIdx, 'qty', parseInt(e.target.value) || 1)} style={{ ...cellInput, width: 46, textAlign: 'center' }} />
      ),
    }),
    // ── Location ─────────────────────────────────────────────────────────────
    columnHelper.accessor('location', {
      id: 'location',
      size: 100,
      header: () => 'Location',
      cell: ({ row }) => (
        <LocationPicker value={row.original.location} onChange={val => update(row.original._originalIdx, 'location', val)} placeholder="Location" locations={apiConfigured && locationNames.length > 0 ? locationNames : undefined} loading={locationsLoading} />
      ),
    }),
    // ── Sidemark ─────────────────────────────────────────────────────────────
    columnHelper.accessor('sidemark', {
      id: 'sidemark',
      size: 150,
      header: () => 'Sidemark',
      cell: ({ row }) => (
        <AutocompleteInput value={row.original.sidemark} onChange={val => update(row.original._originalIdx, 'sidemark', val)} placeholder="Project / client" suggestions={sidemarks} icon={false} style={{ fontSize: 12 }} />
      ),
    }),
    // ── Reference ────────────────────────────────────────────────────────────
    columnHelper.accessor('reference', {
      id: 'reference',
      size: 120,
      header: () => 'Reference',
      cell: ({ row }) => (
        <input value={row.original.reference} onChange={e => update(row.original._originalIdx, 'reference', e.target.value)} onPaste={e => handlePaste(e, row.original._originalIdx, 'reference')} placeholder="PO# / Ref" style={cellInput} />
      ),
    }),
    // ── Room ─────────────────────────────────────────────────────────────────
    columnHelper.accessor('room', {
      id: 'room',
      size: 100,
      header: () => 'Room',
      cell: ({ row }) => (
        <input value={row.original.room} onChange={e => update(row.original._originalIdx, 'room', e.target.value)} onPaste={e => handlePaste(e, row.original._originalIdx, 'room')} placeholder="Room" style={cellInput} />
      ),
    }),
    // ── Needs Inspection ─────────────────────────────────────────────────────
    columnHelper.accessor('needsInspection', {
      id: 'needsInspection',
      size: 50,
      header: () => 'INSP',
      cell: ({ row }) => (
        <input type="checkbox" checked={row.original.needsInspection} onChange={e => update(row.original._originalIdx, 'needsInspection', e.target.checked)} title="Needs Inspection" style={{ accentColor: theme.colors.orange, cursor: 'pointer' }} />
      ),
    }),
    // ── Needs Assembly ───────────────────────────────────────────────────────
    columnHelper.accessor('needsAssembly', {
      id: 'needsAssembly',
      size: 50,
      header: () => 'ASM',
      cell: ({ row }) => (
        <input type="checkbox" checked={row.original.needsAssembly} onChange={e => update(row.original._originalIdx, 'needsAssembly', e.target.checked)} title="Needs Assembly" style={{ accentColor: theme.colors.orange, cursor: 'pointer' }} />
      ),
    }),
    // ── Actions (duplicate / remove) ─────────────────────────────────────────
    columnHelper.display({
      id: 'actions',
      size: 60,
      enableHiding: false,
      enableSorting: false,
      header: () => null,
      cell: ({ row }) => {
        const idx = row.original._originalIdx;
        return (
          <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
            <button onClick={() => duplicateRow(idx)} title="Duplicate row (includes add-ons)" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: theme.colors.textMuted, borderRadius: 4 }}><Copy size={13} /></button>
            <button onClick={() => removeRow(idx)} title="Remove row" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: items.length > 1 ? theme.colors.textMuted : theme.colors.borderLight, borderRadius: 4 }}><X size={13} /></button>
          </div>
        );
      },
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [autoIdEnabled, update, handlePaste, toggleRowExpanded, duplicateRow, removeRow,
      toggleAddon, updateWeight, vendors, descriptions, sidemarks, locationNames,
      locationsLoading, apiConfigured, items.length]);

  const table = useReactTable({
    data: tableData,
    columns,
    state: { sorting, columnVisibility, columnOrder },
    onSortingChange: setSorting,
    onColumnVisibilityChange: (updater: VisibilityState | ((prev: VisibilityState) => VisibilityState)) => {
      setColumnVisibility(typeof updater === 'function' ? updater(columnVisibility) : updater);
    },
    onColumnOrderChange: setColumnOrder,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    enableMultiSort: true,
  });

  // ── Drag-to-reorder column headers ────────────────────────────────────────
  function onHeaderDragStart(e: React.DragEvent<HTMLTableCellElement>, colId: string) {
    setDragColId(colId);
    e.dataTransfer.effectAllowed = 'move';
  }
  function onHeaderDragOver(e: React.DragEvent<HTMLTableCellElement>, colId: string) {
    e.preventDefault();
    setDragOverColId(colId);
  }
  function onHeaderDrop(e: React.DragEvent<HTMLTableCellElement>, targetColId: string) {
    e.preventDefault();
    if (!dragColId || targetColId === dragColId) return;
    const order = [...columnOrder];
    const from = order.indexOf(dragColId);
    const to = order.indexOf(targetColId);
    if (from === -1 || to === -1) return;
    order.splice(from, 1);
    order.splice(to, 0, dragColId);
    setColumnOrder(order);
    setDragColId(null);
    setDragOverColId(null);
  }

  const reset = useCallback(() => {
    setClient(''); setClientSheetId(''); setCarrier(''); setTracking('');
    setReference(''); setNotes(''); setPieceCount('');
    setReceiveDate(new Date().toISOString().slice(0, 10));
    setChargeReceiving(true);
    setAutoIdError('');
    const freshItems = Array.from({ length: 5 }, () => emptyItem(false));
    setItems(freshItems);
    setSubmitted(false); setSubmitError(''); setSubmitResult(null);
    idempotencyKeyRef.current = crypto.randomUUID();
    // Mint a fresh DOCK number so the new intake doesn't collide with the
    // one we just promoted to SHP. Reset saved-stamp memory so the next
    // first-save stamps cleanly.
    setDockNo(generateDockNumber());
    setHasSavedDraft(false);
    setSavedDockCompletedAt(null);
    setSavedDockCompletedBy(null);
    if (autoIdEnabled) {
      freshItems.forEach(item => assignAutoId(item.id));
    }
  }, [autoIdEnabled, assignAutoId]);

  // ─── Hydrate loading state ──────────────────────────────────────────────
  // Suppresses the rest of the form while we pull the saved draft so the
  // operator doesn't see fields flicker between empty and populated.
  if (hydrating) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 360, gap: 12, color: theme.colors.textMuted }}>
        <Loader2 size={28} style={{ animation: 'spin 1s linear infinite' }} />
        <div style={{ fontSize: 13 }}>Loading saved dock intake {existingDockNo}…</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }
  if (hydrateError) {
    return (
      <div style={{ padding: 32, textAlign: 'center' }}>
        <AlertTriangle size={28} color={theme.colors.statusRed} style={{ marginBottom: 8 }} />
        <div style={{ fontSize: 14, fontWeight: 600, color: theme.colors.text }}>Couldn't open this dock intake</div>
        <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 4, maxWidth: 520, marginInline: 'auto' }}>{hydrateError}</div>
        <button
          onClick={goBack}
          style={{ marginTop: 16, padding: '8px 18px', fontSize: 13, fontWeight: 600, border: 'none', borderRadius: 8, background: theme.colors.orange, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}
        >Back to Shipments</button>
      </div>
    );
  }

  if (submitted && submitResult) {
    return (
      <div style={{ maxWidth: 600, margin: '60px auto', textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#F0FDF4', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
          <Check size={32} color="#15803D" />
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8 }}>Shipment Received</h2>
        <p style={{ color: theme.colors.textSecondary, fontSize: 14, marginBottom: 6 }}>
          <strong>{submitResult.itemCount}</strong> item{submitResult.itemCount !== 1 ? 's' : ''} received for <strong>{client}</strong>
        </p>
        <p style={{ fontSize: 18, fontWeight: 700, color: theme.colors.orange, marginBottom: 6, fontFamily: 'monospace' }}>
          {submitResult.shipmentNo}
        </p>
        {submitResult.tasksCreated > 0 && (
          <p style={{ fontSize: 12, color: '#15803D', marginBottom: 4 }}>
            {submitResult.tasksCreated} task{submitResult.tasksCreated !== 1 ? 's' : ''} created
          </p>
        )}
        {submitResult.billingRows > 0 && (
          <p style={{ fontSize: 12, color: '#1D4ED8', marginBottom: 4 }}>
            {submitResult.billingRows} billing row{submitResult.billingRows !== 1 ? 's' : ''} created
          </p>
        )}
        {submitResult.warnings && submitResult.warnings.length > 0 && (
          <div style={{ marginTop: 12, padding: 12, background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 8, textAlign: 'left' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#92400E', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
              <AlertTriangle size={13} /> Warnings
            </div>
            {submitResult.warnings.map((w, i) => (
              <div key={i} style={{ fontSize: 12, color: '#78350F', marginTop: 2 }}>{w}</div>
            ))}
          </div>
        )}
        <button onClick={reset} style={{ marginTop: 24, padding: '10px 24px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none', background: theme.colors.orange, color: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Receive Another Shipment</button>
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', background: '#F5F2EE', margin: '-28px -32px', padding: '28px 32px', minHeight: '100%' }}>
      <ProcessingOverlay
        visible={submitting}
        message="Hold tight — completing your shipment"
        subMessage="Adding items to inventory, generating the receiving doc, and emailing the client. This can take 10–20 seconds."
      />
      <div style={{ marginBottom: 16, fontSize: 20, fontWeight: 700, letterSpacing: '2px', color: '#1C1C1C' }}>
        STRIDE LOGISTICS · RECEIVING
        {/* In-progress chip: shown once the operator has saved at least
            once (or reopened a saved intake). Surfaces the DOCK handle so
            the operator can confirm they're editing the right draft. */}
        {(hasSavedDraft || existingDockNo) && (
          <span style={{ marginLeft: 12, display: 'inline-block', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: theme.colors.orange, background: theme.colors.orangeLight, padding: '3px 10px', borderRadius: 100 }}>
            IN PROGRESS · {dockNo}
          </span>
        )}
      </div>
      {/* Shipment Header */}
      <div style={{ background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: isMobile ? 8 : 12, padding: isMobile ? 12 : 20, marginBottom: isMobile ? 10 : 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <Truck size={18} color={theme.colors.orange} />
          <span style={{ fontSize: 14, fontWeight: 600 }}>Shipment Details</span>
        </div>
        {clientShipmentNote && (
          <div
            role="alert"
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              background: '#FFFBEB',
              border: '2px solid #F59E0B',
              borderRadius: 6,
              padding: 12,
              marginBottom: 14,
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            <AlertTriangle size={20} color="#B45309" style={{ flexShrink: 0, marginTop: 2 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: '0.5px',
                  color: '#B45309',
                  textTransform: 'uppercase',
                  marginBottom: 4,
                }}
              >
                Client Receiving Instructions
              </div>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: '#1F2937',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  lineHeight: 1.35,
                }}
              >
                {clientShipmentNote}
              </div>
            </div>
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: 12 }}>
          <div style={{ gridColumn: isMobile ? '1' : '1 / span 2' }}>
            <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Client *</label>
            <AutocompleteSelect
              value={clientSheetId || ''}
              onChange={val => {
                const liveMatch = liveClients.find(c => c.id === val);
                if (liveMatch) {
                  const apiMatch = apiClients.find(a => a.name === liveMatch.name);
                  const autoInspect = apiMatch?.autoInspection ?? false;
                  setClient(liveMatch.name);
                  setClientSheetId(liveMatch.id);
                  setItems(prev => prev.map(item => ({ ...item, needsInspection: autoInspect })));
                } else {
                  setClient('');
                  setClientSheetId('');
                  setItems(prev => prev.map(item => ({ ...item, needsInspection: false })));
                }
              }}
              placeholder="Select client..."
              options={liveClients.map(c => ({ value: c.id, label: c.name }))}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
              Piece Count <span style={{ color: theme.colors.orange }}>*</span>
              <span style={{ marginLeft: 6, fontSize: 9, fontWeight: 700, color: theme.colors.orange, letterSpacing: '0.05em' }}>REQUIRED</span>
            </label>
            <input
              type="number"
              min={1}
              value={pieceCount}
              onChange={e => setPieceCount(e.target.value)}
              placeholder="e.g. 12"
              aria-required="true"
              inputMode="numeric"
              style={{
                ...cellInput, padding: '8px 10px', fontSize: 13,
                // Amber outline while invalid — snaps to neutral once the
                // operator enters a positive integer. Matches the cue the
                // legacy DockIntakeForm used.
                borderColor: pieceCountValid ? theme.colors.borderLight : theme.colors.statusAmber,
              }}
            />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Carrier</label>
            <input value={carrier} onChange={e => setCarrier(e.target.value)} placeholder="UPS, FedEx, LTL..." style={{ ...cellInput, padding: '8px 10px', fontSize: 13 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Tracking #</label>
            <input value={tracking} onChange={e => setTracking(e.target.value)} placeholder="Tracking number..." style={{ ...cellInput, padding: '8px 10px', fontSize: 13 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Reference / PO</label>
            <input value={reference} onChange={e => setReference(e.target.value)} placeholder="PO# or reference..." style={{ ...cellInput, padding: '8px 10px', fontSize: 13 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Receive Date</label>
            <input type="date" value={receiveDate} onChange={e => setReceiveDate(e.target.value)} style={{ ...cellInput, padding: '8px 10px', fontSize: 13 }} />
          </div>
          <div style={{ gridColumn: isMobile ? '1' : '1 / -1' }}>
            <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Damage, missing labels, driver notes..." style={{ ...cellInput, padding: '8px 10px', fontSize: 13 }} />
          </div>
        </div>

        {/* ─── Dock-floor photos + documents ────────────────────────────────
            entity_type='shipment' / context_type='shipment' / entity_id=dockNo.
            Available immediately so the operator can snap photos at the
            dock door without waiting for any save step. The shipment row
            doesn't need to exist yet — these attach to `dockNo` and ride
            forward through Save for Later and Complete Receiving alike. */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12, marginTop: 14 }}>
          <div style={{
            background: '#FAFBFC',
            // Amber outline + tinted background while no photo is attached
            // — same visual language as the Piece Count REQUIRED state. Once
            // a photo is uploaded the panel reverts to the neutral border.
            border: `1px solid ${hasAtLeastOnePhoto ? theme.colors.borderLight : theme.colors.statusAmber}`,
            borderRadius: 10,
            padding: isMobile ? 12 : 14,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: 12, fontWeight: 600, color: theme.colors.text, flexWrap: 'wrap' }}>
              <Camera size={14} color={theme.colors.orange} />
              Dock Photos ({photos.length})
              <span style={{ color: theme.colors.orange }}>*</span>
              <span style={{ fontSize: 9, fontWeight: 700, color: theme.colors.orange, letterSpacing: '0.05em' }}>REQUIRED</span>
            </div>
            {/* Empty-state nag — only shows while a client is picked (otherwise
                the disabled "Select a client to enable…" copy below already
                tells the operator why they can't act). */}
            {clientSheetId && !hasAtLeastOnePhoto && (
              <div style={{
                fontSize: 11, fontWeight: 600,
                color: '#92400E', background: '#FEF3C7',
                border: '1px solid #F59E0B', borderRadius: 6,
                padding: '6px 10px', marginBottom: 10,
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <AlertTriangle size={12} />
                At least 1 photo required before you can save.
              </div>
            )}
            {!clientSheetId ? (
              <div style={{ fontSize: 12, color: theme.colors.textMuted, fontStyle: 'italic', padding: '10px 12px', border: `1px dashed ${theme.colors.borderLight}`, borderRadius: 8, textAlign: 'center' }}>
                Select a client to enable photo upload.
              </div>
            ) : (
              <>
                <PhotoUploadButton
                  onUpload={async (files: File[]) => {
                    for (const f of files) await uploadPhoto(f, 'receiving');
                  }}
                  onUploadOne={async (file: File) => {
                    const result = await uploadPhoto(file, 'receiving');
                    return !!result;
                  }}
                  label="Upload Photos"
                  compact
                />
                {photos.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                    {photos.slice(0, 8).map(p => (
                      <div
                        key={p.id}
                        title={p.file_name}
                        style={{
                          width: 56, height: 56, borderRadius: 6, flexShrink: 0,
                          background: `#E5E7EB url(${p.thumbnail_url || p.storage_url || ''}) center/cover`,
                          border: '1px solid rgba(0,0,0,0.08)',
                        }}
                      />
                    ))}
                    {photos.length > 8 && (
                      <span style={{ fontSize: 11, color: theme.colors.textMuted, fontWeight: 600, alignSelf: 'center' }}>
                        +{photos.length - 8}
                      </span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
          <div style={{ background: '#FAFBFC', border: `1px solid ${theme.colors.borderLight}`, borderRadius: 10, padding: isMobile ? 12 : 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: 12, fontWeight: 600, color: theme.colors.text }}>
              <DocIcon size={14} color={theme.colors.orange} />
              Dock Documents — BOL, packing slip ({documents.length})
            </div>
            {!clientSheetId ? (
              <div style={{ fontSize: 12, color: theme.colors.textMuted, fontStyle: 'italic', padding: '10px 12px', border: `1px dashed ${theme.colors.borderLight}`, borderRadius: 8, textAlign: 'center' }}>
                Select a client to enable document upload.
              </div>
            ) : (
              <>
                <DocumentScanButton
                  contextType="shipment"
                  contextId={dockNo}
                  tenantId={photoTenant}
                  label="Scan Document"
                />
                {documents.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                    {documents.slice(0, 6).map(d => (
                      <span
                        key={d.id}
                        title={d.file_name}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '4px 10px', fontSize: 11, fontWeight: 500,
                          background: '#F3F4F6', color: theme.colors.textSecondary,
                          borderRadius: 4, whiteSpace: 'nowrap',
                        }}
                      >
                        {d.file_name.length > 28 ? `${d.file_name.slice(0, 28)}…` : d.file_name}
                      </span>
                    ))}
                    {documents.length > 6 && (
                      <span style={{ fontSize: 11, color: theme.colors.textMuted, fontWeight: 600 }}>
                        +{documents.length - 6}
                      </span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${theme.colors.borderLight}` }}>
          <button
            type="button"
            onClick={() => setChargeReceiving(prev => !prev)}
            style={{
              width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
              background: chargeReceiving ? theme.colors.orange : '#ccc',
              position: 'relative', transition: 'background 0.2s',
            }}
          >
            <span style={{
              position: 'absolute', top: 2, left: chargeReceiving ? 20 : 2,
              width: 18, height: 18, borderRadius: '50%', background: '#fff',
              transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </button>
          <div>
            <span style={{ fontSize: 13, fontWeight: 600, color: theme.colors.text }}>Receiving Charge</span>
            <span style={{ fontSize: 11, color: theme.colors.textMuted, marginLeft: 8 }}>
              {chargeReceiving ? 'Receiving fees will be charged' : 'No receiving fees for this shipment'}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
          <button
            type="button"
            onClick={toggleAutoPrint}
            style={{
              width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer',
              background: autoPrintLabels ? '#3B82F6' : '#ccc',
              position: 'relative', transition: 'background 0.2s',
            }}
          >
            <span style={{
              position: 'absolute', top: 2, left: autoPrintLabels ? 20 : 2,
              width: 18, height: 18, borderRadius: '50%', background: '#fff',
              transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
            }} />
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Printer size={14} color={autoPrintLabels ? '#3B82F6' : theme.colors.textMuted} />
            <span style={{ fontSize: 13, fontWeight: 600, color: theme.colors.text }}>Auto-Print Labels</span>
            <span style={{ fontSize: 11, color: theme.colors.textMuted, marginLeft: 4 }}>
              {autoPrintLabels ? 'Labels will print after shipment completes' : 'Off — labels will not print'}
            </span>
          </div>
        </div>
      </div>

      {/* Items Table */}
      <div style={{ background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: isMobile ? 8 : 12, overflow: 'hidden' }}>
        <div style={{ padding: isMobile ? '10px 12px' : '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `1px solid ${theme.colors.borderLight}`, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Package size={16} color={theme.colors.orange} />
            <span style={{ fontSize: 14, fontWeight: 600 }}>Items</span>
            <span style={{ fontSize: 12, color: theme.colors.textMuted }}>({filledItems.length} entered)</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              onClick={() => { setBulkPasteStartField('itemId'); setBulkPasteOpen(true); }}
              title="Copy a range of cells from Excel/Sheets, paste here, apply to the grid"
              style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, border: `1px solid ${theme.colors.orange}`, borderRadius: 6, background: theme.colors.orange, cursor: 'pointer', fontFamily: 'inherit', color: '#fff', display: 'flex', alignItems: 'center', gap: 4 }}>
              <ClipboardPaste size={13} /> Paste from Excel
            </button>
            <button onClick={addRow} style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}><Plus size={13} /> Add Row</button>
            <button onClick={() => addRows(5)} style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>+5</button>
            <button onClick={() => addRows(10)} style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>+10</button>
            {/* Column visibility toggle */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setShowColToggle(p => !p)}
                style={{ padding: '5px 10px', fontSize: 11, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: showColToggle ? '#F3F4F6' : '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <Settings2 size={13} /> Columns
              </button>
              {showColToggle && (
                <div style={{ position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 300, background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 8, padding: '8px 12px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)', minWidth: 150 }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Show / Hide</div>
                  {TOGGLEABLE_RCV_COLS.map(colId => {
                    const col = table.getColumn(colId);
                    if (!col) return null;
                    return (
                      <label key={colId} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', cursor: 'pointer', fontSize: 12, color: theme.colors.textPrimary, userSelect: 'none' }}>
                        <input type="checkbox" checked={col.getIsVisible()} onChange={() => col.toggleVisibility()} style={{ accentColor: theme.colors.orange, cursor: 'pointer' }} />
                        {RCV_COL_LABELS[colId]}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Bulk paste modal */}
        {bulkPasteOpen && (
          <div onClick={() => setBulkPasteOpen(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 12, padding: 20, width: '100%', maxWidth: 720, maxHeight: '90vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 700 }}>Paste from Excel / Google Sheets</div>
                <button onClick={() => setBulkPasteOpen(false)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 4 }}><X size={18} /></button>
              </div>
              <div style={{ fontSize: 12, color: theme.colors.textSecondary, lineHeight: 1.5 }}>
                Copy cells from Excel or Google Sheets and paste them into the box below. Tabs separate columns, new lines start new rows. Columns fill left-to-right starting from the <strong>Start column</strong> you pick.
              </div>
              <div style={{ fontSize: 11, background: '#F9FAFB', border: `1px solid ${theme.colors.borderLight}`, borderRadius: 6, padding: '8px 10px', color: theme.colors.textSecondary }}>
                <strong>Expected column order:</strong> Item ID &middot; Vendor &middot; Description &middot; Class (XS/S/M/L/XL) &middot; Qty &middot; Location &middot; Sidemark &middot; Reference &middot; Room
                {autoIdEnabled && <div style={{ marginTop: 4, color: theme.colors.orange }}>Auto-ID is ON — leave the Item ID column out of your paste (or it will be ignored).</div>}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <label style={{ color: theme.colors.textMuted }}>Start column:</label>
                <select value={bulkPasteStartField} onChange={e => setBulkPasteStartField(e.target.value as keyof DockItem)} style={{ padding: '4px 8px', fontSize: 12, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff' }}>
                  {PASTE_FIELD_ORDER.map(f => (
                    <option key={f} value={f}>
                      {f === 'itemId' ? 'Item ID' : f === 'itemClass' ? 'Class' : f.charAt(0).toUpperCase() + f.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
              <textarea
                value={bulkPasteText}
                onChange={e => setBulkPasteText(e.target.value)}
                placeholder="Paste here (Ctrl+V / Cmd+V)..."
                autoFocus
                rows={10}
                style={{ width: '100%', fontFamily: 'monospace', fontSize: 12, padding: 10, border: `1px solid ${theme.colors.border}`, borderRadius: 8, resize: 'vertical', outline: 'none' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button onClick={() => setBulkPasteOpen(false)} style={{ padding: '8px 16px', fontSize: 12, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Cancel</button>
                <button onClick={applyBulkPasteFromModal} disabled={!bulkPasteText.trim()} style={{ padding: '8px 20px', fontSize: 12, fontWeight: 700, border: 'none', borderRadius: 8, background: bulkPasteText.trim() ? theme.colors.orange : theme.colors.border, cursor: bulkPasteText.trim() ? 'pointer' : 'not-allowed', fontFamily: 'inherit', color: '#fff' }}>Apply to Grid</button>
              </div>
            </div>
          </div>
        )}

        <div style={{ overflowX: 'auto', maxHeight: isMobile ? 'calc(100dvh - 320px)' : 'calc(100dvh - 440px)', minHeight: isMobile ? 200 : undefined, WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: isMobile ? 800 : 1000 }}>
            <thead>
              {table.getHeaderGroups().map(hg => (
                <tr key={hg.id}>
                  {hg.headers.map(header => {
                    const colId = header.column.id;
                    const canDrag = colId !== 'expand' && colId !== 'rowNum' && colId !== 'actions';
                    const canSort = header.column.getCanSort();
                    const sorted = header.column.getIsSorted();
                    const center = ['expand', 'rowNum', 'needsInspection', 'needsAssembly', 'actions'].includes(colId);
                    return (
                      <th
                        key={header.id}
                        style={{
                          ...th,
                          width: header.getSize(),
                          textAlign: center ? 'center' : 'left',
                          opacity: dragColId === colId ? 0.45 : 1,
                          background: dragOverColId === colId ? '#F3F4F6' : '#fff',
                          cursor: canDrag ? 'grab' : 'default',
                        }}
                        draggable={canDrag}
                        onDragStart={canDrag ? e => onHeaderDragStart(e, colId) : undefined}
                        onDragOver={canDrag ? e => onHeaderDragOver(e, colId) : undefined}
                        onDrop={canDrag ? e => onHeaderDrop(e, colId) : undefined}
                        onDragEnd={() => { setDragColId(null); setDragOverColId(null); }}
                      >
                        {canSort ? (
                          <div
                            onClick={header.column.getToggleSortingHandler()}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'pointer', userSelect: 'none' }}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {sorted === 'asc' ? <ChevronUp size={11} /> : sorted === 'desc' ? <ChevronDown size={11} /> : null}
                          </div>
                        ) : (
                          flexRender(header.column.columnDef.header, header.getContext())
                        )}
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map(row => {
                const item = row.original;
                const idx = item._originalIdx;
                return (
                <React.Fragment key={item.id}>
                <tr style={{ background: item.description.trim() ? 'transparent' : '#FAFAFA' }}>
                  {row.getVisibleCells().map(cell => {
                    const cid = cell.column.id;
                    const center = ['expand', 'rowNum', 'needsInspection', 'needsAssembly', 'actions'].includes(cid);
                    return (
                      <td key={cell.id} style={{ ...td, textAlign: center ? 'center' : undefined, padding: cid === 'expand' ? 0 : td.padding }}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    );
                  })}
                </tr>
                {item.expanded && (
                  <tr style={{ background: '#FAFBFD' }}>
                    <td colSpan={table.getVisibleLeafColumns().length} style={{ padding: '12px 16px 14px 40px', borderBottom: `1px solid ${theme.colors.borderLight}` }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-start' }}>
                        {/* Weight input — powers "overweight" auto-apply */}
                        <div style={{ minWidth: 140 }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Weight (lbs)</div>
                          <input
                            type="number"
                            min={0}
                            step={1}
                            value={item.weight ?? ''}
                            onChange={e => updateWeight(idx, e.target.value)}
                            placeholder="Optional"
                            style={{ ...cellInput, width: 120, fontSize: 12 }}
                          />
                          <div style={{ fontSize: 10, color: theme.colors.textMuted, marginTop: 4 }}>&gt; {OVERWEIGHT_THRESHOLD} lbs triggers overweight add-on</div>
                        </div>
                        {/* Add-on checkboxes */}
                        <div style={{ flex: 1, minWidth: 300 }}>
                          <div style={{ fontSize: 10, fontWeight: 600, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                            Add-on Services
                            {catalogAddons.length === 0 && <span style={{ textTransform: 'none', fontWeight: 400, marginLeft: 8 }}>(none configured)</span>}
                          </div>
                          {catalogAddons.length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                              {catalogAddons.map(a => {
                                const checked = item.addons.includes(a.code);
                                const auto = item.autoAppliedAddons.includes(a.code);
                                const rate = a.rateForClass(item.itemClass);
                                return (
                                  <label
                                    key={a.code}
                                    style={{
                                      display: 'inline-flex', alignItems: 'center', gap: 6,
                                      padding: '6px 10px', borderRadius: 8,
                                      border: `1px solid ${checked ? theme.colors.orange : theme.colors.borderLight}`,
                                      background: checked ? '#FFF7F0' : '#fff',
                                      cursor: 'pointer', fontSize: 12,
                                      userSelect: 'none',
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleAddon(idx, a.code)}
                                      style={{ accentColor: theme.colors.orange, cursor: 'pointer', margin: 0 }}
                                    />
                                    <span style={{ fontWeight: 600, color: theme.colors.text }}>{a.name}</span>
                                    <span style={{ color: theme.colors.textMuted, fontSize: 11 }}>
                                      {rate > 0 ? `$${rate.toFixed(2)}` : (item.itemClass ? 'no rate' : 'set class')}
                                    </span>
                                    {auto && checked && (
                                      <span title="Auto-applied based on item metadata" style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 9, fontWeight: 700, background: '#FEF3C7', color: '#92400E', padding: '1px 5px', borderRadius: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        <Zap size={9} /> Auto
                                      </span>
                                    )}
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                      {/* Inline media — photos (camera + upload), docs, quick notes.
                          Attaches to entity_type='inventory' with entity_id = item.itemId
                          so everything persists to the real inventory row once the
                          shipment completes. Hidden until an Item ID exists. */}
                      <div style={{ marginTop: 12 }}>
                        <ReceivingRowMedia itemId={item.itemId} tenantId={clientSheetId} />
                      </div>
                    </td>
                  </tr>
                )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div style={{ padding: isMobile ? '10px 12px' : '12px 16px', borderTop: `1px solid ${theme.colors.borderLight}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
          <div style={{ fontSize: 12, color: theme.colors.textMuted }}>
            <strong>{filledItems.length}</strong> item{filledItems.length !== 1 ? 's' : ''} entered &middot; {filledItems.filter(i => i.needsInspection).length} need inspection &middot; {filledItems.filter(i => i.needsAssembly).length} need assembly
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {autoIdError && (
              <div style={{ fontSize: 12, color: '#92400E', background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 8, padding: '8px 12px', maxWidth: 420 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <AlertTriangle size={13} />
                  <span style={{ fontWeight: 600 }}>Auto-ID Error</span>
                </div>
                <div style={{ fontSize: 11, marginTop: 2 }}>{autoIdError}</div>
              </div>
            )}
            {submitError && (
              <div style={{ fontSize: 12, color: '#DC2626', maxWidth: 420, textAlign: 'left', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '8px 12px', lineHeight: 1.5 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                  <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>Shipment failed</div>
                    <div style={{ fontSize: 11, whiteSpace: 'pre-wrap' }}>{submitError}</div>
                    {/permission|forbidden|403/i.test(submitError) && (
                      <div style={{ fontSize: 10, color: '#92400E', marginTop: 4 }}>Check that the client spreadsheet is shared with your Google account, and that MASTER_RPC_URL/TOKEN are configured in the client Settings tab.</div>
                    )}
                  </div>
                </div>
              </div>
            )}
            <span style={{ fontSize: 11, color: theme.colors.textMuted }}>Tip: use the orange <strong>Paste from Excel</strong> button (top right) for multi-column bulk paste, or paste directly into the Item ID / Reference / Room cell of a row to spread columns rightward.</span>
            {/* Save for Later — always visible whenever a client is picked.
                Persists dock fields + any items entered so far, sets
                inbound_status='in_progress', returns to /shipments. The
                operator picks back up by clicking the In Progress row.
                Gated on client + positive piece count + at least one photo
                (see `pieceCountValid` / `hasAtLeastOnePhoto` above for why). */}
            {(() => {
              const saveBlocked = !client || !pieceCountValid || !hasAtLeastOnePhoto || submitting || savingDraft;
              // Tooltip surfaces the most specific reason, in the same order
              // an operator scans the form top-to-bottom — pick the first
              // unmet precondition.
              const saveBlockedReason =
                !client ? 'Pick a client first.'
                : !pieceCountValid ? 'Enter a piece count (positive number).'
                : !hasAtLeastOnePhoto ? 'Take or upload at least one dock photo.'
                : null;
              return (
                <button
                  onClick={handleSaveForLater}
                  disabled={saveBlocked}
                  title={saveBlockedReason || 'Save dock intake + items entered so far. You can come back later from the In Progress tab.'}
                  style={{
                    padding: '9px 18px', fontSize: 13, fontWeight: 600, borderRadius: 8,
                    border: `1px solid ${saveBlocked ? theme.colors.border : theme.colors.orange}`,
                    background: '#fff',
                    color: saveBlocked ? theme.colors.textMuted : theme.colors.orange,
                    cursor: saveBlocked ? 'not-allowed' : 'pointer',
                    fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  {savingDraft
                    ? <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</>
                    : <><Save size={14} /> Save for Later</>
                  }
                </button>
              );
            })()}
            {/* Complete Receiving — runs the full GAS flow. Hidden until at
                least one item row has actual content. Operators who just
                want to capture dock metadata use Save for Later instead. */}
            {filledItems.length > 0 && (
              <button
                onClick={handleComplete}
                disabled={!client || submitting || savingDraft}
                style={{
                  padding: '9px 20px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none',
                  background: (!client || submitting || savingDraft) ? theme.colors.border : theme.colors.orange,
                  color: (!client || submitting || savingDraft) ? theme.colors.textMuted : '#fff',
                  cursor: (!client || submitting || savingDraft) ? 'not-allowed' : 'pointer',
                  fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {submitting ? (
                  <><span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} /> Processing...</>
                ) : (
                  <><Check size={15} /> Complete Receiving</>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Hidden print container for auto-print labels */}
      <div ref={printRef} id="print-labels-container" style={{ display: 'none' }} />
      <style>{`
        @media print {
          body > *:not(#print-labels-container),
          body > * > *:not(#print-labels-container) { display: none !important; }
          #print-labels-container {
            display: block !important;
            position: absolute; top: 0; left: 0;
          }
          #print-labels-container .print-label {
            page-break-after: always !important;
            break-after: page !important;
            margin: 0 !important;
          }
          @page { size: 4in 6in; margin: 0.1in; }
        }
      `}</style>
    </div>
  );
}

export function Receiving() {
  // `?shipmentNo=DOCK-...` reopens an in-progress dock intake; anything else
  // (no param, empty param) starts a fresh one. The `key` ensures the form
  // remounts cleanly when the operator navigates between intakes — the
  // hydrate ref + draft state both reset on a fresh mount.
  const location = useLocation();
  const shipmentNo = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return (params.get('shipmentNo') || '').trim();
  }, [location.search]);
  return <NewShipmentForm key={shipmentNo || 'new'} existingDockNo={shipmentNo || undefined} />;
}
