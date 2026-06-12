import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { X, Truck, Package, Calendar, Phone, User, DollarSign, CheckCircle2, CreditCard, FileText, Loader2, AlertTriangle, FolderOpen, Info, Pencil, Save, Play, MoreHorizontal } from 'lucide-react';
import { useIsMobile } from '../../hooks/useIsMobile';
import { FloatingActionMenu, type FABAction } from './FloatingActionMenu';
import { FolderButton } from './FolderButton';
import { DeepLink } from './DeepLink';
import { TabbedDetailPanel, type TabbedDetailPanelTab } from './TabbedDetailPanel';
import { EntityPage } from './EntityPage';
import { DriveFoldersList, type DriveFolderLink } from './DriveFoldersList';
import { usePhotoGraphRollup, useNoteGraphRollup, type RollupContext } from '../../hooks/useGraphRollup';
import { useDocuments } from '../../hooks/useDocuments';
import { PhotosPanel as _PhotosPanel, DocumentsPanel as _DocumentsPanel, NotesPanel as _NotesPanel } from './EntityAttachments';
import { EntityNotesInline } from '../notes/EntityNotesInline';
import { ActivityTimeline } from './ActivityTimeline';
import { ItemIdBadges } from './ItemIdBadges';
import { useItemIndicators } from '../../hooks/useItemIndicators';
import { theme } from '../../styles/theme';
import { fmtDate, toDateInputValue } from '../../lib/constants';
import { WriteButton } from './WriteButton';
import { ProcessingOverlay } from './ProcessingOverlay';
import { BillingPreviewCard } from './BillingPreviewCard';
import { useEntityAddons } from '../../hooks/useEntityAddons';
import { postProcessWcRelease, postCancelWillCall, postRemoveItemsFromWillCall, postUpdateWillCall, postReopenWillCall, fetchWillCallById, isApiConfigured } from '../../lib/api';
import { renderDoc, buildWillCallTokens } from '../../lib/docRenderer';
import { fetchWcItemsFromSupabase } from '../../lib/supabaseQueries';
import { supabase } from '../../lib/supabase';
import { useClients } from '../../hooks/useClients';
import { writeSyncFailed } from '../../lib/syncEvents';
import { entityEvents } from '../../lib/entityEvents';
import { useAuth } from '../../contexts/AuthContext';
import type { ProcessWcReleaseResponse, CancelWillCallResponse, RemoveItemsFromWillCallResponse } from '../../lib/api';

import type { WillCall, InventoryItem } from '../../lib/types';
import { AddChargeButton } from '../billing/AddChargeButton';
interface Props {
  wc: any;
  onClose: () => void;
  onWcUpdated?: () => void;
  onNavigateToWc?: (wcNumber: string) => void;
  // Phase 2C — optimistic patch functions (optional)
  applyWcPatch?: (wcNumber: string, patch: Partial<WillCall>) => void;
  mergeWcPatch?: (wcNumber: string, patch: Partial<WillCall>) => void;
  clearWcPatch?: (wcNumber: string) => void;
  addOptimisticWc?: (wc: WillCall) => void;
  removeOptimisticWc?: (tempWcNumber: string) => void;
  // Cross-entity: WC release patches inventory item statuses
  applyItemPatch?: (itemId: string, patch: Partial<InventoryItem>) => void;
  /** Session 80+ — render as full EntityPage instead of slide-out TabbedDetailPanel.
   *  Only swaps the outer shell. All tabs, handlers, modals, and edit logic
   *  are preserved exactly as-is. */
  renderAsPage?: boolean;
}

const STATUS_CFG: Record<string, { bg: string; color: string }> = {
  Pending: { bg: '#FEF3C7', color: '#B45309' }, Scheduled: { bg: '#EFF6FF', color: '#1D4ED8' },
  Released: { bg: '#F0FDF4', color: '#15803D' }, Partial: { bg: '#EDE9FE', color: '#7C3AED' },
  Cancelled: { bg: '#F3F4F6', color: '#6B7280' },
};

function Badge({ t, bg, color }: { t: string; bg: string; color: string }) { return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: bg, color, whiteSpace: 'nowrap' }}>{t}</span>; }
function Field({ label, value, icon: Icon }: { label: string; value?: string | number | null; icon?: any }) {
  return <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
    {Icon && <Icon size={14} color={theme.colors.textMuted} style={{ marginTop: 2 }} />}
    <div><div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 1 }}>{label}</div><div style={{ fontSize: 13, color: value ? theme.colors.text : theme.colors.textMuted }}>{String(value ?? '\u2014')}</div></div>
  </div>;
}

export function WillCallDetailPanel({ wc: wcProp, onClose, onWcUpdated, onNavigateToWc, applyWcPatch, mergeWcPatch, clearWcPatch, applyItemPatch, renderAsPage }: Props) {
  const { user } = useAuth();
  // Clients are not allowed to release items or set release dates — that
  // decision belongs to warehouse staff. Gate every Release-related action.
  const canRelease = user?.role === 'admin' || user?.role === 'staff';
  // Stage B — reopen (undo Release or undo Start)
  const [reopenLoading, setReopenLoading] = useState(false);
  const [reopenError, setReopenError] = useState<string | null>(null);
  const { isMobile, isTablet } = useIsMobile();
  const isCompactViewport = isMobile || isTablet;
  const [overflowOpen, setOverflowOpen] = useState(false);
  // v2026-04-22 — panel frame (backdrop, resize, header) is provided by
  // TabbedDetailPanel. Adapter focuses on entity-specific state + tab content.
  const apiConfigured = isApiConfigured();
  const { apiClients } = useClients(apiConfigured);
  const clientSheetId = useMemo(() => wcProp.clientSheetId || apiClients.find(c => c.name === wcProp.clientName)?.spreadsheetId || '', [apiClients, wcProp.clientName, wcProp.clientSheetId]);

  // (I)(A)(R) indicators for every item in the WC items table below.
  const { inspOpenItems, inspDoneItems, inspFailedItems, asmOpenItems, asmDoneItems, repairOpenItems, repairDoneItems, wcOpenItems, wcDoneItems, dtOpenItems, dtDoneItems, codItems } = useItemIndicators(clientSheetId);

  // ── Self-fetch: if items missing, fetch full WC data via getWillCallById ──
  const [enrichedData, setEnrichedData] = useState<Partial<WillCall> | null>(null);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const enrichRef = useRef<string | null>(null);
  useEffect(() => {
    const hasItems = wcProp.items && wcProp.items.length > 0;
    if (hasItems || !apiConfigured) { setEnrichedData(null); setEnrichLoading(false); return; }
    if (!clientSheetId) return;
    if (enrichRef.current === wcProp.wcNumber + ':' + clientSheetId) return;
    enrichRef.current = wcProp.wcNumber + ':' + clientSheetId;
    setEnrichLoading(true);

    // Session 71: Try Supabase first if we have itemIds (~50ms vs 2-5s from GAS)
    const wcItemIds = (wcProp as any).itemIds as string[] | undefined;

    (async () => {
      try {
        // Fast path: itemIds available from Supabase will_calls row
        if (wcItemIds && wcItemIds.length > 0) {
          try {
            const invMap = await fetchWcItemsFromSupabase(clientSheetId!, wcItemIds);
            if (invMap && Object.keys(invMap).length > 0) {
              setEnrichedData({
                items: wcItemIds.map(id => {
                  const inv = invMap[id];
                  return {
                    itemId: id,
                    description: inv?.description || '',
                    qty: inv?.qty ?? 1,
                    released: false, // WC release status not in inventory — GAS enrichment fills this
                    vendor: inv?.vendor || undefined,
                    location: inv?.location || undefined,
                    status: inv?.status || undefined,
                    sidemark: inv?.sidemark || undefined,
                    room: inv?.room || undefined,
                    reference: inv?.reference || undefined,
                  };
                }),
                itemCount: wcItemIds.length,
              });
              enrichRef.current = null;
              return;
            }
          } catch { /* fall through to GAS */ }
        }

        // GAS fallback (full enrichment including released status, WC fees, etc.)
        try {
          const resp = await fetchWillCallById(wcProp.wcNumber, clientSheetId!);
          if (resp.ok && resp.data?.success && resp.data.willCall) {
            const match = resp.data.willCall;
            if (!match.items?.length) {
              setEnrichedData({ items: [] });
              enrichRef.current = null;
              return;
            }
            setEnrichedData({
              items: (match.items || []).map(it => ({
                itemId: it.itemId, description: it.description, qty: it.qty,
                released: it.released, vendor: it.vendor || undefined,
                location: it.location || undefined, status: it.status || undefined,
                // v38.72.0 — include item-level fields so the header sidemark
                // chip (and other item-field overlays) don't drop out on the
                // GAS-fallback enrichment path. Supabase fast path already
                // populates these; we just need to match shape here.
                sidemark: it.sidemark || undefined,
                room: it.room || undefined,
                itemClass: it.itemClass || undefined,
              })),
              itemCount: match.items?.length || match.itemsCount || wcProp.itemCount,
              pickupPartyPhone: match.pickupPhone || undefined,
              scheduledDate: match.estimatedPickupDate || undefined,
              notes: match.notes || undefined,
              cod: match.cod ?? undefined,
              codAmount: match.codAmount ?? undefined,
              wcFolderUrl: match.wcFolderUrl || undefined,
              shipmentFolderUrl: match.shipmentFolderUrl || undefined,
            });
          }
        } catch { /* best effort */ }
        enrichRef.current = null;
      } finally {
        setEnrichLoading(false);
      }
    })();
  }, [wcProp.wcNumber, wcProp.items, apiConfigured, clientSheetId]);

  // Merge prop data with enriched data — enriched fills gaps, prop takes priority for non-empty.
  // Note: useWillCallDetail returns ApiWillCall (which uses `itemsCount`), but the panel's
  // WillCall type expects `itemCount`. Read both — whichever side populated wins.
  const wc = useMemo(() => {
    if (!enrichedData) return wcProp;
    const propItemsCount = (wcProp as any).itemsCount;
    const propItemCount = (wcProp as any).itemCount;
    const enrichedItemsCount = (enrichedData as any).itemsCount;
    const enrichedItemCount = (enrichedData as any).itemCount;
    return {
      ...wcProp,
      items: (wcProp.items?.length ? wcProp.items : enrichedData.items) || [],
      itemCount: propItemCount || propItemsCount || enrichedItemCount || enrichedItemsCount || 0,
      pickupPartyPhone: wcProp.pickupPartyPhone || enrichedData.pickupPartyPhone,
      scheduledDate: wcProp.scheduledDate || enrichedData.scheduledDate,
      notes: wcProp.notes || enrichedData.notes,
      cod: wcProp.cod ?? enrichedData.cod,
      codAmount: wcProp.codAmount ?? enrichedData.codAmount,
      wcFolderUrl: wcProp.wcFolderUrl || enrichedData.wcFolderUrl,
      shipmentFolderUrl: wcProp.shipmentFolderUrl || enrichedData.shipmentFolderUrl,
    };
  }, [wcProp, enrichedData]);

  // Single source of truth for "how many items in this WC" — used by every render
  // site that displays a count. Falls back through itemCount → itemsCount → items.length.
  const resolvedItemCount = (wc as any).itemCount || (wc as any).itemsCount || wc.items?.length || 0;

  const [effectiveStatus, setEffectiveStatus] = useState<string>(wc.status);
  // Sync with incoming wc prop — parent may update via optimistic patch or refetch.
  // Without this, the local state sticks on the initial mount value and the panel
  // appears to flip/flash between rendered values when wc changes.
  useEffect(() => { if (wc.status && wc.status !== effectiveStatus) setEffectiveStatus(wc.status); }, [wc.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const sc = STATUS_CFG[effectiveStatus] || STATUS_CFG.Pending;
  const isActive = ['Pending', 'Scheduled', 'Partial'].includes(effectiveStatus);

  // ─── Add-on services (v38.177.0 unified addons) ─────────────────────────
  // Rows accumulate on public.addons until handleProcessWcRelease_ flushes
  // them via api_writeAddonsToLedger_. Editable while the WC is still
  // active (Pending / Scheduled / Partial); locked once Released / Cancelled.
  const { addons: wcAddons, addAddon: addWcAddon, updateAddon: updateWcAddon, deleteAddon: deleteWcAddon } = useEntityAddons(
    canRelease ? 'will_call' : null,
    canRelease ? wc.wcNumber : null,
    canRelease ? (clientSheetId || null) : null,
  );

  // Parse split WC number from notes (format: "[Split → WC-XXXXX]")
  const splitWcNumber = useMemo(() => {
    const notes = String(wc.notes || '');
    const m = notes.match(/\[Split → (WC-\S+)\]/);
    return m ? m[1] : null;
  }, [wc.notes]);

  const [releaseMode, setReleaseMode] = useState<'none' | 'partial'>('none');
  const [partialSelected, setPartialSelected] = useState<Set<string>>(new Set());
  // Session 74: releasing retained as an always-false read-only flag so
  // the legacy overlay/button branches still compile. Optimistic UI
  // flips releaseResult immediately — we never toggle this to true.
  const [releasing] = useState(false);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const [releaseResult, setReleaseResult] = useState<ProcessWcReleaseResponse | null>(null);

  const [paid, setPaid] = useState(() => String(wc.notes || '').includes('[COD Paid'));

  // Cancel WC state
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelResult, setCancelResult] = useState<CancelWillCallResponse | null>(null);

  // Remove items state
  const [removeMode, setRemoveMode] = useState(false);
  const [removeSelected, setRemoveSelected] = useState<Set<string>>(new Set());
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removeResult, setRemoveResult] = useState<RemoveItemsFromWillCallResponse | null>(null);

  // ── Inline edit state ──
  const [isEditing, setIsEditing] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editSaveSuccess, setEditSaveSuccess] = useState(false);
  const [editSaveError, setEditSaveError] = useState<string | null>(null);
  const [editPickupParty, setEditPickupParty] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editCod, setEditCod] = useState(false);
  const [editCodAmount, setEditCodAmount] = useState('');
  const [editRequestedBy, setEditRequestedBy] = useState('');

  // ── COD inline-edit state (view mode, separate from full-panel edit) ──
  // Lets staff/admin toggle COD + edit the amount directly from the
  // view-mode pickup-details cluster without entering the full Edit
  // mode. SB-authoritative path: writes public.will_calls directly,
  // then fire-and-forgets push-will-call-cod-to-sheet to mirror to
  // the per-tenant Will_Calls sheet (P2 reverse-writethrough).
  const [codSaving, setCodSaving] = useState(false);
  const [codSaveError, setCodSaveError] = useState<string | null>(null);
  const [codSaveJustSucceeded, setCodSaveJustSucceeded] = useState(false);
  const [codAmountDraft, setCodAmountDraft] = useState('');
  const [isCodAmountFocused, setIsCodAmountFocused] = useState(false);
  // Keep the amount draft in sync with prop changes (e.g. realtime
  // echo from another tab, or a parent refetch). Skip the resync
  // while the user has the input focused — otherwise an echo
  // arriving mid-keystroke (own optimistic patch, another tab's
  // edit, etc.) would clobber what they're typing.
  useEffect(() => {
    if (isCodAmountFocused) return;
    setCodAmountDraft(wc.codAmount != null ? String(wc.codAmount) : '');
  }, [wc.codAmount, isCodAmountFocused]);

  const handleEditStart = useCallback(() => {
    setEditPickupParty(wc.pickupParty || '');
    setEditPhone(wc.pickupPartyPhone || '');
    // Normalize for `<input type="date">` — strict YYYY-MM-DD only.
    setEditDate(toDateInputValue(wc.scheduledDate));
    setEditNotes(wc.notes || '');
    setEditCod(!!wc.cod);
    setEditCodAmount(wc.codAmount != null ? String(wc.codAmount) : '');
    // wc.requestedBy populates from the create modal's "Requested By"
    // field; some legacy rows fall back to createdBy / createdByUser.
    setEditRequestedBy((wc as any).requestedBy || (wc as any).createdBy || (wc as any).createdByUser || '');
    setEditSaveError(null);
    setEditSaveSuccess(false);
    setIsEditing(true);
  }, [wc]);

  const handleEditCancel = useCallback(() => {
    setIsEditing(false);
    setEditSaveError(null);
  }, []);

  const handleReopenWc = useCallback(async () => {
    if (!apiConfigured || !clientSheetId || !wc.wcNumber) return;
    const cur = effectiveStatus || wc.status || '';
    let confirmMsg = '';
    if (cur === 'Released' || cur === 'Partial') {
      confirmMsg = 'Reopen this Will Call?\n\nThis will:\n  • revert status to Scheduled\n  • flip released items back to Scheduled on WC_Items\n  • void any Unbilled WC billing row for this WC\n  • clear Actual Pickup Date\n\nBlocked if billing already invoiced.';
    } else if (cur === 'Scheduled') {
      confirmMsg = 'Reopen this Will Call?\n\nReverts status to Pending. No billing impact.';
    } else {
      return;
    }
    const reason = window.prompt(confirmMsg + '\n\nReason (optional):');
    if (reason === null) return;
    setReopenLoading(true);
    setReopenError(null);
    try {
      const resp = await postReopenWillCall({ wcNumber: wc.wcNumber, reason: reason || '' }, clientSheetId);
      if (resp.ok && resp.data?.success) {
        onWcUpdated?.();
      } else {
        setReopenError(resp.data?.error || resp.error || 'Failed to reopen');
      }
    } catch {
      setReopenError('Network error — please try again');
    }
    setReopenLoading(false);
  }, [apiConfigured, clientSheetId, wc.wcNumber, wc.status, effectiveStatus, onWcUpdated]);

  const handleEditSave = useCallback(async () => {
    if (!apiConfigured || !clientSheetId || !wc.wcNumber) return;
    setEditSaving(true);
    setEditSaveError(null);

    const payload: Record<string, unknown> = { wcNumber: wc.wcNumber };
    // Build a parallel patch matching WillCall field names so we can update
    // local state immediately. Server payload uses estimatedPickupDate /
    // pickupPhone keys; UI reads scheduledDate / pickupPartyPhone — translate.
    const patch: Partial<WillCall> = {};
    let changed = false;
    if (editPickupParty !== (wc.pickupParty || '')) { payload.pickupParty = editPickupParty; patch.pickupParty = editPickupParty; changed = true; }
    if (editPhone !== (wc.pickupPartyPhone || '')) { payload.pickupPhone = editPhone; patch.pickupPartyPhone = editPhone; changed = true; }
    const origRequestedBy = ((wc as any).requestedBy || (wc as any).createdBy || (wc as any).createdByUser || '') as string;
    if (editRequestedBy !== origRequestedBy) {
      payload.requestedBy = editRequestedBy;
      (patch as any).requestedBy = editRequestedBy;
      changed = true;
    }
    // Compare normalized forms — wc.scheduledDate may carry a "00:00:00"
    // suffix from older sheets while editDate is always YYYY-MM-DD.
    if (editDate !== toDateInputValue(wc.scheduledDate)) { payload.estimatedPickupDate = editDate; patch.scheduledDate = editDate; changed = true; }
    if (editNotes !== (wc.notes || '')) { payload.notes = editNotes; patch.notes = editNotes; changed = true; }
    if (editCod !== !!wc.cod) { payload.cod = editCod; (patch as any).cod = editCod; changed = true; }
    const origAmt = wc.codAmount != null ? String(wc.codAmount) : '';
    if (editCodAmount !== origAmt) {
      const codAmountNum = editCodAmount.trim() === '' ? 0 : parseFloat(editCodAmount);
      payload.codAmount = codAmountNum;
      (patch as any).codAmount = codAmountNum;
      changed = true;
    }

    if (!changed) { setIsEditing(false); setEditSaving(false); return; }

    // Optimistic — paint edits into local state before the API round-trip so
    // the panel doesn't briefly revert to old values when edit mode closes.
    mergeWcPatch?.(wc.wcNumber, patch);

    try {
      const resp = await postUpdateWillCall(payload as any, clientSheetId);
      if (!resp.ok || !resp.data?.success) {
        clearWcPatch?.(wc.wcNumber);
        setEditSaveError(resp.error || resp.data?.error || 'Save failed');
      } else {
        setIsEditing(false);
        setEditSaveSuccess(true);
        setTimeout(() => setEditSaveSuccess(false), 3000);
        entityEvents.emit('will_call', wc.wcNumber);
        onWcUpdated?.();
      }
    } catch {
      clearWcPatch?.(wc.wcNumber);
      setEditSaveError('Network error — please try again');
    }
    setEditSaving(false);
  }, [apiConfigured, clientSheetId, wc, editPickupParty, editPhone, editDate, editNotes, editCod, editCodAmount, editRequestedBy, onWcUpdated, mergeWcPatch, clearWcPatch]);

  // ── COD inline-edit handler ──
  // SB-authoritative path: writes public.will_calls directly with the
  // anon JWT (RLS allows admin/staff via existing tenant-access policy
  // since Justin's auth context puts user_metadata.role + clientSheetId
  // on the JWT). Then fire-and-forgets push-will-call-cod-to-sheet to
  // mirror to the per-tenant Will_Calls sheet via the P1.4
  // reverse-writethrough framework. Sheet-mirror failures don't unwind
  // the SB commit — they land in gs_sync_events for the
  // FailedOperationsDrawer retry, mirroring the
  // push-inventory-release-to-sheet pattern from PR #378.
  const handleCodInlineSave = useCallback(async (newCod: boolean, newAmount: number | null) => {
    if (!clientSheetId || !wc.wcNumber) return;
    setCodSaving(true);
    setCodSaveError(null);

    // Optimistic local patch so the UI reflects the change before the
    // round-trip. Reverted below on failure. mergeWcPatch is the
    // existing Phase 2C entry-point for this kind of overlay.
    mergeWcPatch?.(wc.wcNumber, { cod: newCod, codAmount: newAmount ?? undefined } as Partial<WillCall>);

    try {
      const { error: sbErr } = await supabase
        .from('will_calls')
        .update({ cod: newCod, cod_amount: newAmount })
        .eq('tenant_id', clientSheetId)
        .eq('wc_number', wc.wcNumber);
      if (sbErr) throw sbErr;

      // Fire-and-forget the sheet mirror. Failure surfaces in
      // gs_sync_events / FailedOperationsDrawer — the SB write already
      // committed so the user-visible change is durable regardless.
      void supabase.functions
        .invoke('push-will-call-cod-to-sheet', {
          body: {
            tenantId:    clientSheetId,
            wcNumber:    wc.wcNumber,
            cod:         newCod,
            codAmount:   newAmount,
            requestedBy: user?.email ?? '',
          },
        })
        .catch(err => console.warn('[wc-cod] sheet mirror invoke failed:', err));

      // NOTE: do NOT call entityEvents.emit('will_call') or onWcUpdated()
      // here. Both would trigger a parent refetch (which fetches the WC
      // + items + addons), and combined with the SB realtime echo that
      // fires automatically on .update(), the panel was re-rendering 3-4
      // times per click — Justin saw it as the page flashing / refreshing.
      // The optimistic mergeWcPatch above paints the change immediately,
      // and the realtime echo overwrites the patch with the canonical row
      // (matching values, no visible change). That's enough.
      setCodSaveJustSucceeded(true);
      setTimeout(() => setCodSaveJustSucceeded(false), 2000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error('[wc-cod] supabase write failed:', msg);
      setCodSaveError(msg);
      // Revert the optimistic patch so the UI snaps back to the
      // server-known state. Parent's next refetch (via realtime
      // echo) restores the canonical row anyway.
      clearWcPatch?.(wc.wcNumber);
    } finally {
      setCodSaving(false);
    }
  }, [clientSheetId, wc.wcNumber, user?.email, mergeWcPatch, clearWcPatch]);

  const inputStyle: React.CSSProperties = { width: '100%', padding: '6px 10px', fontSize: 13, border: `1px solid ${theme.colors.border}`, borderRadius: 6, outline: 'none', fontFamily: 'inherit' };

  const toggleRemoveItem = (id: string) => {
    setRemoveSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const handleRemoveItems = async () => {
    if (removeSelected.size === 0) return;
    setRemoveError(null);
    if (!apiConfigured || !clientSheetId) {
      setRemoveResult({ success: true, removedCount: removeSelected.size, remainingItems: allItemIds.length - removeSelected.size, cancelled: removeSelected.size >= allItemIds.length });
      if (removeSelected.size >= allItemIds.length) setEffectiveStatus('Cancelled');
      setRemoveMode(false);
      onWcUpdated?.();
      return;
    }

    // Phase 2C: optimistic patch
    // - If removing all items → WC becomes Cancelled
    // - Affected inventory items revert from On Hold → Active
    const removingAll = removeSelected.size >= allItemIds.length;
    const removedItemIds = [...removeSelected];
    if (removingAll) {
      applyWcPatch?.(wc.wcNumber, { status: 'Cancelled' });
    }
    removedItemIds.forEach(id => applyItemPatch?.(id, { status: 'Active' }));

    setRemoving(true);
    try {
      const resp = await postRemoveItemsFromWillCall({ wcNumber: wc.wcNumber, itemIds: removedItemIds }, clientSheetId);
      if (!resp.ok || !resp.data?.success) {
        // Rollback optimistic patches
        if (removingAll) clearWcPatch?.(wc.wcNumber);
        // Note: item patches will expire naturally via 120s TTL, or be corrected by next refetch
        setRemoveError(resp.error || resp.data?.error || 'Failed to remove items');
      } else {
        setRemoveResult(resp.data);
        if (resp.data.cancelled) setEffectiveStatus('Cancelled');
        setRemoveMode(false);
        // Don't clear patch on success — let 120s TTL handle it (prevents flicker during refetch)
        onWcUpdated?.();
      }
    } catch (err) {
      if (removingAll) clearWcPatch?.(wc.wcNumber); // rollback
      setRemoveError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setRemoving(false);
    }
  };

  // Single-button document flow. Fetches DOC_WILL_CALL_RELEASE from
  // public.email_templates, substitutes WC tokens client-side, opens a
  // popup with the rendered HTML, fires the print dialog. No GAS round
  // trip — completes in under a second on a warm connection.
  const [printDocLoading, setPrintDocLoading] = useState(false);
  const [printDocError, setPrintDocError] = useState<string | null>(null);

  const handlePrintDocument = useCallback(async () => {
    if (printDocLoading) return;
    setPrintDocError(null);
    setPrintDocLoading(true);
    try {
      const tokens = buildWillCallTokens({
        wcNumber: wc.wcNumber,
        clientName: wc.clientName,
        pickupParty: wc.pickupParty,
        pickupPartyPhone: wc.pickupPartyPhone,
        scheduledDate: wc.scheduledDate,
        requestedBy: (wc as any).requestedBy || (wc as any).createdBy || (wc as any).createdByUser,
        notes: wc.notes,
        cod: wc.cod,
        codAmount: wc.codAmount,
        items: (wc.items || []).map((it: any) => ({
          itemId: it.itemId,
          qty: it.qty,
          vendor: it.vendor,
          description: it.description,
          itemClass: it.itemClass || it.class,
          location: it.location,
          sidemark: it.sidemark,
        })),
      });
      await renderDoc('DOC_WILL_CALL_RELEASE', tokens, {
        action: 'print',
        fileName: `Will Call Release — ${wc.wcNumber}`,
      });
    } catch (err) {
      setPrintDocError(err instanceof Error ? err.message : 'Document generation failed');
    } finally {
      setPrintDocLoading(false);
    }
  }, [printDocLoading, wc]);

  const handleCancelWC = async () => {
    setCancelError(null);
    // Phase 2C: patch table row immediately
    applyWcPatch?.(wc.wcNumber, { status: 'Cancelled' });
    if (!apiConfigured || !clientSheetId) {
      setCancelResult({ success: true, wcNumber: wc.wcNumber, emailSent: false, warnings: ['Demo mode — no API configured'] });
      setEffectiveStatus('Cancelled');
      return;
    }
    setCancelling(true);
    try {
      const resp = await postCancelWillCall({ wcNumber: wc.wcNumber }, clientSheetId);
      if (!resp.ok || !resp.data?.success) {
        clearWcPatch?.(wc.wcNumber); // rollback
        const errMsg = resp.error || resp.data?.error || 'Failed to cancel will call';
        setCancelError(errMsg);
        void writeSyncFailed({ tenant_id: clientSheetId, entity_type: 'will_call', entity_id: wc.wcNumber, action_type: 'cancel_will_call', requested_by: user?.email ?? '', request_id: resp.requestId, payload: { wcNumber: wc.wcNumber, clientName: wc.clientName }, error_message: errMsg });
      } else {
        // Don't clear patch on success — let 120s TTL handle it (prevents flicker during refetch)
        setCancelResult(resp.data);
        setEffectiveStatus('Cancelled');
        onWcUpdated?.();
      }
    } catch (err) {
      clearWcPatch?.(wc.wcNumber); // rollback
      setCancelError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setCancelling(false);
    }
  };

  const allItemIds: string[] = useMemo(() =>
    (wc.items || []).map((i: any) => String(i.itemId || '')).filter(Boolean),
    [wc.items]
  );

  const togglePartialItem = (id: string) => {
    setPartialSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  // Session 74 optimistic-first: flip the WC to Released/Partial + show
  // the confirmation screen immediately. GAS runs in the background
  // (release PDF, billing rows, client email). Error banner surfaces
  // after the fact; status stays Released so the user can move on.
  const handleRelease = async (itemIds: string[]) => {
    setReleaseError(null);
    if (!itemIds.length) return;

    const isPartialRelease = itemIds.length < allItemIds.length;
    const newWcStatus = isPartialRelease ? 'Partial' : 'Released';
    const releaseDate = new Date().toISOString().slice(0, 10);

    // 1. OPTIMISTIC UI
    applyWcPatch?.(wc.wcNumber, { status: newWcStatus });
    itemIds.forEach(id => applyItemPatch?.(id, { status: 'Released', releaseDate }));
    setReleaseResult({
      success: true,
      releasedCount: itemIds.length,
      isPartial: isPartialRelease,
      emailSent: false,  // background will update this when GAS confirms
    });
    setEffectiveStatus(newWcStatus);
    setReleaseMode('none');
    entityEvents.emit('will_call', wc.wcNumber);

    if (!apiConfigured || !clientSheetId) return;  // Demo mode — UI already reflects release.

    // 2. Background GAS
    void (async () => {
      try {
        const resp = await postProcessWcRelease({ wcNumber: wc.wcNumber, releaseItemIds: itemIds }, clientSheetId);
        if (!resp.ok || !resp.data?.success) {
          const errMsg = resp.error || resp.data?.error || 'Release recorded locally but the server call failed.';
          setReleaseError(errMsg + ' Refresh to reconcile, or retry.');
          void writeSyncFailed({ tenant_id: clientSheetId, entity_type: 'will_call', entity_id: wc.wcNumber, action_type: 'process_wc_release', requested_by: user?.email ?? '', request_id: resp.requestId, payload: { wcNumber: wc.wcNumber, releaseItemIds: itemIds, clientName: wc.clientName }, error_message: errMsg });
        } else {
          // Refresh banner with server-confirmed data (email, warnings, etc.)
          setReleaseResult(resp.data);
          setEffectiveStatus(resp.data.isPartial ? 'Partial' : 'Released');
          onWcUpdated?.();
          // Auto-archive the Release doc — best-effort, queued on failure.
          // Pulls items from the current WC; for a partial release, the doc
          // still shows the full WC manifest with sidemark/qty so the
          // archive reflects everything that was pulled, not just the
          // currently-released subset.
          const tokens = buildWillCallTokens({
            wcNumber: wc.wcNumber,
            clientName: wc.clientName,
            pickupParty: wc.pickupParty,
            pickupPartyPhone: wc.pickupPartyPhone,
            scheduledDate: wc.scheduledDate,
            requestedBy: (wc as any).requestedBy || (wc as any).createdBy || (wc as any).createdByUser,
            notes: wc.notes,
            cod: wc.cod,
            codAmount: wc.codAmount,
            items: (wc.items || []).map((it: any) => ({
              itemId: it.itemId,
              qty: it.qty,
              vendor: it.vendor,
              description: it.description,
              itemClass: it.itemClass || it.class,
              location: it.location,
              sidemark: it.sidemark,
            })),
          });
          void renderDoc('DOC_WILL_CALL_RELEASE', tokens, {
            action: 'upload',
            fileName: `Stride_WillCallRelease_${wc.wcNumber}`,
            tenantId: clientSheetId,
            entityType: 'willcall',
            entityId: wc.wcNumber,
          });
        }
      } catch (err) {
        setReleaseError(
          (err instanceof Error ? err.message : 'Network error')
          + ' while releasing. Refresh to reconcile.'
        );
      }
    })();
  };

  // ─── Tab renderers (same modular pattern as TaskDetailPanel) ────────
  const renderDetailsTab = () => (
    <div style={{ padding: 20 }}>

          {/* Pickup Details */}
          <div style={{ background: theme.colors.bgSubtle, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}><Truck size={14} color={theme.colors.orange} /><span style={{ fontSize: 12, fontWeight: 600 }}>Pickup Details</span></div>
            {isEditing ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 3 }}>Pickup Party</label>
                  <input value={editPickupParty} onChange={e => setEditPickupParty(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 3 }}>Phone</label>
                  <input value={editPhone} onChange={e => setEditPhone(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 3 }}>Requested By</label>
                  <input value={editRequestedBy} onChange={e => setEditRequestedBy(e.target.value)} placeholder="Who requested this release" style={inputStyle} />
                </div>
                <div>
                  <label style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 3 }}>Estimated Pickup Date</label>
                  <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <Field label="Items" value={`${resolvedItemCount} items`} icon={Package} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 3 }}>Notes</label>
                  <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                    <input type="checkbox" checked={editCod} onChange={e => setEditCod(e.target.checked)} style={{ accentColor: theme.colors.orange }} />
                    COD
                  </label>
                </div>
                {editCod && (
                  <div>
                    <label style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 3 }}>COD Amount</label>
                    <input type="number" value={editCodAmount} onChange={e => setEditCodAmount(e.target.value)} placeholder="$0.00" style={inputStyle} />
                  </div>
                )}
              </div>
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 14px' }}>
                  <Field label="Pickup Party" value={wc.pickupParty} icon={User} />
                  <Field label="Phone" value={wc.pickupPartyPhone} icon={Phone} />
                  <Field label="Requested By" value={(wc as any).requestedBy || (wc as any).createdBy || (wc as any).createdByUser || undefined} icon={User} />
                  <Field label="Estimated Pickup Date" value={fmtDate(wc.scheduledDate)} icon={Calendar} />
                  <Field label="Items" value={`${resolvedItemCount} items`} icon={Package} />
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                    <DollarSign size={14} color={theme.colors.textMuted} style={{ marginTop: 2 }} />
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>COD</div>
                      {/* Inline-editable COD for staff/admin on ANY WC status. SB-authoritative
                          path: writes public.will_calls directly, then fire-and-forgets the
                          sheet mirror via push-will-call-cod-to-sheet. Justin's ask:
                          retroactively toggle COD on Released WCs (e.g. customer paid
                          later, mark COD collected after the fact). Non-staff users
                          still get the read-only fallback below. */}
                      {canRelease ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="checkbox"
                            checked={!!wc.cod}
                            disabled={codSaving}
                            onChange={e => {
                              const newCod = e.target.checked;
                              // Turning ON: keep existing amount or default to 0 so the
                              // user can edit immediately. Turning OFF: clear the amount
                              // (null) so the sheet cell empties and the COD Payment
                              // banner below disappears.
                              const newAmount = newCod
                                ? (wc.codAmount != null ? Number(wc.codAmount) : 0)
                                : null;
                              void handleCodInlineSave(newCod, newAmount);
                            }}
                            style={{ accentColor: theme.colors.orange, cursor: codSaving ? 'wait' : 'pointer', width: 16, height: 16 }}
                            title="Click to toggle COD"
                          />
                          {wc.cod && (
                            <input
                              type="number"
                              step="0.01"
                              min="0"
                              value={codAmountDraft}
                              disabled={codSaving}
                              onChange={e => setCodAmountDraft(e.target.value)}
                              onFocus={() => setIsCodAmountFocused(true)}
                              onBlur={() => {
                                setIsCodAmountFocused(false);
                                const parsed = codAmountDraft.trim() === '' ? 0 : parseFloat(codAmountDraft);
                                if (!Number.isFinite(parsed) || parsed < 0) {
                                  // Bad input — snap back to the saved value.
                                  setCodAmountDraft(wc.codAmount != null ? String(wc.codAmount) : '');
                                  return;
                                }
                                if (parsed === Number(wc.codAmount || 0)) return;  // no change
                                void handleCodInlineSave(true, parsed);
                              }}
                              onKeyDown={e => {
                                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                                if (e.key === 'Escape') {
                                  setCodAmountDraft(wc.codAmount != null ? String(wc.codAmount) : '');
                                  (e.target as HTMLInputElement).blur();
                                }
                              }}
                              placeholder="0.00"
                              style={{
                                width: 80, fontSize: 13, fontWeight: 600,
                                padding: '2px 6px',
                                border: `1px solid ${theme.colors.border}`,
                                borderRadius: 4,
                                fontFamily: 'inherit',
                                outline: 'none',
                              }}
                              title="Edit COD amount (Enter to save, Esc to cancel)"
                            />
                          )}
                          {codSaving && <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', color: theme.colors.textMuted }} />}
                          {codSaveJustSucceeded && !codSaving && <CheckCircle2 size={12} color="#10B981" />}
                        </div>
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="checkbox" checked={!!wc.cod} readOnly style={{ accentColor: theme.colors.orange, pointerEvents: 'none', width: 16, height: 16 }} />
                          {wc.cod && wc.codAmount ? <span style={{ fontSize: 13, fontWeight: 600 }}>${Number(wc.codAmount).toFixed(2)}</span> : null}
                        </div>
                      )}
                      {codSaveError && (
                        <div style={{ fontSize: 11, color: '#DC2626', marginTop: 4 }}>{codSaveError}</div>
                      )}
                    </div>
                  </div>
                </div>
                {wc.notes && <div style={{ marginTop: 4, fontSize: 12, color: theme.colors.textSecondary }}><strong>Notes:</strong> {wc.notes}</div>}
              </>
            )}
            {/* Drive Folder Buttons — suppressed in page mode (moved to
                Photos tab). Shipment Folder also dropped from the Details
                tab; it's still reachable from Photos/Docs → Legacy Folders. */}
            {!renderAsPage && wc.wcFolderUrl && (
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                <FolderButton label="Will Call Folder" url={wc.wcFolderUrl} icon={FolderOpen} />
              </div>
            )}
          </div>

          {/* Partial Release Banner */}
          {(effectiveStatus === 'Partial' || splitWcNumber) && (
            <div style={{ padding: '10px 12px', background: '#EDE9FE', border: '1px solid #C4B5FD', borderRadius: 10, marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <Info size={14} color="#7C3AED" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 12, color: '#5B21B6' }}>
                This will call was partially released. {splitWcNumber ? (
                  <>Remaining items were moved to{' '}
                    <span
                      onClick={() => onNavigateToWc?.(splitWcNumber)}
                      style={{ fontWeight: 700, textDecoration: 'underline', cursor: onNavigateToWc ? 'pointer' : 'default', color: '#7C3AED' }}
                    >{splitWcNumber}</span>.
                  </>
                ) : 'Remaining items were moved to a new will call.'}
              </div>
            </div>
          )}

          {/* COD Payment */}
          {wc.cod && (
            <div style={{ background: paid ? '#F0FDF4' : '#FFFBF5', border: `1px solid ${paid ? '#A7F3D0' : '#FED7AA'}`, borderRadius: 10, padding: 14, marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}><DollarSign size={14} color={paid ? '#15803D' : '#B45309'} /><span style={{ fontSize: 12, fontWeight: 600, color: paid ? '#15803D' : '#92400E' }}>{paid ? 'Payment Collected' : 'COD Payment Required'}</span></div>
              {!paid ? (
                <>
                  <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 10 }}>${wc.codAmount || '0.00'}</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => {
                        // Pass everything we already know to the static
                        // payment page so the operator doesn't re-enter it:
                        //   ?order   → badge + Stax customerCode + Order # input
                        //   ?notes   → pre-fills Notes field + rides to Stax
                        //   ?amount  → COD amount, pre-fills + lets us skip the form
                        //   ?name    → pickup party (or client name) for Stax billing name
                        //   ?auto=1  → tells the page to auto-launch the Stax modal
                        //              when amount is valid; user sees the form for
                        //              ~300ms before the Stax credit card modal opens
                        const wcNum = wc.wcNumber || '';
                        const params = new URLSearchParams();
                        if (wcNum) {
                          params.set('order', wcNum);
                          params.set('notes', `Will Call ${wcNum}`);
                        }
                        if (wc.codAmount != null && Number(wc.codAmount) > 0) {
                          params.set('amount', Number(wc.codAmount).toFixed(2));
                        }
                        const billingName = (wc.pickupParty || wc.clientName || '').trim();
                        if (billingName) params.set('name', billingName);
                        params.set('auto', '1');
                        window.open(`/stax-payment.html?${params.toString()}`, '_blank');
                      }}
                      style={{ flex: 1, padding: '9px', fontSize: 12, fontWeight: 600, border: 'none', borderRadius: 8, background: theme.colors.orange, color: '#fff', cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}
                    >
                      <CreditCard size={14} /> Collect via Stax
                    </button>
                    <WriteButton label="Mark Paid" variant="secondary" onClick={async () => {
                      if (apiConfigured && clientSheetId && wc.wcNumber) {
                        const existingNotes = wc.notes || '';
                        const paidNote = '[COD Paid ' + new Date().toLocaleDateString('en-US') + ']';
                        const newNotes = existingNotes ? existingNotes + ' ' + paidNote : paidNote;
                        const resp = await postUpdateWillCall({ wcNumber: wc.wcNumber, notes: newNotes } as any, clientSheetId);
                        if (resp.ok && resp.data?.success) {
                          setPaid(true);
                          onWcUpdated?.();
                        }
                      } else {
                        setPaid(true);
                      }
                    }} />
                  </div>
                  <div style={{ fontSize: 10, color: theme.colors.textMuted, marginTop: 8 }}>Opens Stax payment page in new tab. After collecting payment, tap "Mark Paid" to record it.</div>
                </>
              ) : (
                <div style={{ fontSize: 13, color: '#15803D' }}>Payment of ${wc.codAmount || '0.00'} collected and recorded.</div>
              )}
            </div>
          )}

          {/* Items section moved to the bottom of the content stack (session 70 follow-up).
              See the end of this content div for the rendered Items block. */}

          {/* Partial Release Selector */}
          {releaseMode === 'partial' && allItemIds.length > 0 && (
            <div style={{ border: `1px solid ${theme.colors.orange}`, borderRadius: 10, padding: 14, marginBottom: 14, background: '#FFFBF5' }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Select items to release:</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                {allItemIds.map(id => {
                  const item = (wc.items || []).find((i: any) => i.itemId === id);
                  const checked = partialSelected.has(id);
                  return (
                    <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer', padding: '4px 6px', borderRadius: 6, background: checked ? '#F0FDF4' : 'transparent' }}>
                      <input type="checkbox" checked={checked} onChange={() => togglePartialItem(id)} style={{ accentColor: '#15803D' }} />
                      <span style={{ fontWeight: 600 }}>{id}</span>
                      {item?.description && <span style={{ color: theme.colors.textMuted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</span>}
                    </label>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { setReleaseMode('none'); setPartialSelected(new Set()); }} style={{ flex: 1, padding: '8px', fontSize: 12, fontWeight: 500, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                <WriteButton
                  label={releasing ? 'Releasing...' : `Release ${partialSelected.size} Item${partialSelected.size !== 1 ? 's' : ''}`}
                  variant="primary"
                  icon={releasing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={13} />}
                  disabled={partialSelected.size === 0 || releasing}
                  style={{ flex: 2, background: '#15803D', opacity: (partialSelected.size === 0 || releasing) ? 0.6 : 1 }}
                  onClick={() => handleRelease([...partialSelected])}
                />
              </div>
            </div>
          )}

          {/* Release Result Card */}
          {releaseResult && releaseResult.success && (
            <div style={{ padding: '10px 12px', background: '#F0FDF4', border: '1px solid #86EFAC', borderRadius: 10, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <CheckCircle2 size={14} color="#15803D" />
                <span style={{ fontSize: 12, fontWeight: 600, color: '#15803D' }}>
                  {releaseResult.releasedCount} item{releaseResult.releasedCount !== 1 ? 's' : ''} released
                  {releaseResult.isPartial && releaseResult.newWcNumber ? (
                    <> · Remaining →{' '}
                      <span
                        onClick={() => onNavigateToWc?.(releaseResult.newWcNumber!)}
                        style={{ textDecoration: 'underline', cursor: onNavigateToWc ? 'pointer' : 'default', color: theme.colors.orange, fontWeight: 700 }}
                      >{releaseResult.newWcNumber}</span>
                    </>
                  ) : ''}
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#166534' }}>Email: {releaseResult.emailSent ? '✓ Sent' : '✗ Not sent'}</div>
              {releaseResult.warnings && releaseResult.warnings.length > 0 && (
                <div style={{ marginTop: 6 }}>{releaseResult.warnings.map((w, i) => <div key={i} style={{ fontSize: 11, color: '#92400E' }}>⚠ {w}</div>)}</div>
              )}
            </div>
          )}

          {/* Remove Result Card */}
          {removeResult && removeResult.success && (
            <div style={{ padding: '10px 12px', background: removeResult.cancelled ? '#FEF2F2' : '#FEF3C7', border: `1px solid ${removeResult.cancelled ? '#FECACA' : '#FDE68A'}`, borderRadius: 10, marginBottom: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                {removeResult.cancelled ? <X size={14} color="#DC2626" /> : <CheckCircle2 size={14} color="#B45309" />}
                <span style={{ fontSize: 12, fontWeight: 600, color: removeResult.cancelled ? '#DC2626' : '#92400E' }}>
                  {removeResult.removedCount} item{removeResult.removedCount !== 1 ? 's' : ''} removed
                  {removeResult.cancelled ? ' — Will call cancelled (no items remaining)' : ` — ${removeResult.remainingItems} remaining`}
                </span>
              </div>
              {removeResult.skippedReleased && removeResult.skippedReleased.length > 0 && (
                <div style={{ fontSize: 11, color: '#92400E', marginTop: 4 }}>Skipped (already released): {removeResult.skippedReleased.join(', ')}</div>
              )}
            </div>
          )}

          {/* Remove error */}
          {removeError && (
            <div style={{ padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={13} color="#DC2626" />
              <span style={{ fontSize: 12, color: '#991B1B' }}>{removeError}</span>
            </div>
          )}

          {/* Inline Activity History — suppressed in page mode (moved to Activity tab). */}
          {!renderAsPage && (() => {
            const history: { time: string; text: string; color: string }[] = [];
            // Created
            if (wc.createdDate) {
              const by = (wc as any).createdBy || '';
              history.push({ time: wc.createdDate, text: `Will Call created${by ? ` by ${by}` : ''}`, color: theme.colors.textSecondary });
            }
            // Parse notes for activity markers: [Split → WC-xxx], [COD Paid MM/DD/YYYY]
            const notes = String(wc.notes || '');
            const splitMatch = notes.match(/\[Split → (WC-\S+)\]/);
            if (splitMatch) history.push({ time: '', text: `Partial release — remaining items moved to ${splitMatch[1]}`, color: '#7C3AED' });
            const paidMatch = notes.match(/\[COD Paid ([^\]]+)\]/);
            if (paidMatch) history.push({ time: paidMatch[1], text: 'COD payment collected', color: '#15803D' });
            // Status-based entries
            if (effectiveStatus === 'Released') history.push({ time: (wc as any).actualPickupDate || '', text: 'All items released', color: '#15803D' });
            if (effectiveStatus === 'Cancelled') history.push({ time: '', text: 'Will Call cancelled', color: '#6B7280' });
            if (effectiveStatus === 'Scheduled' && wc.scheduledDate) history.push({ time: '', text: `Pickup scheduled for ${fmtDate(wc.scheduledDate)}`, color: '#1D4ED8' });

            return history.length > 0 ? (
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                  <Calendar size={14} color={theme.colors.orange} />
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Activity</span>
                </div>
                <div style={{ borderLeft: `2px solid ${theme.colors.border}`, marginLeft: 6, paddingLeft: 14 }}>
                  {history.map((h, i) => (
                    <div key={i} style={{ marginBottom: 10, fontSize: 12 }}>
                      <div style={{ color: h.color, fontWeight: 500 }}>{h.text}</div>
                      {h.time && <div style={{ fontSize: 10, color: theme.colors.textMuted, marginTop: 1 }}>{h.time}</div>}
                    </div>
                  ))}
                </div>
              </div>
            ) : null;
          })()}

          {/* Inline Quick Actions — suppressed in page mode (moved to sticky footer). */}
          {!renderAsPage && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {canRelease && isActive && !releaseResult && !removeResult && releaseMode === 'none' && allItemIds.length > 1 && (
              <WriteButton label="Release Some..." variant="secondary" size="sm" onClick={() => { setPartialSelected(new Set(allItemIds)); setReleaseMode('partial'); }} />
            )}
            {isActive && !releaseResult && !removeResult && !removeMode && (
              <WriteButton label="Remove Items..." variant="secondary" size="sm" onClick={() => { setRemoveMode(true); setRemoveSelected(new Set()); setRemoveError(null); }} />
            )}
            {removeMode && (
              <>
                <WriteButton label="Cancel" variant="secondary" size="sm" onClick={() => { setRemoveMode(false); setRemoveSelected(new Set()); }} />
                {removeSelected.size > 0 && (
                  <WriteButton
                    label={removing ? 'Removing...' : `Remove ${removeSelected.size} Item${removeSelected.size !== 1 ? 's' : ''}`}
                    variant="danger" size="sm" disabled={removing}
                    onClick={handleRemoveItems}
                  />
                )}
              </>
            )}
            {isActive && !cancelResult && !removeMode && <WriteButton label={cancelling ? 'Cancelling...' : 'Cancel WC'} variant="danger" size="sm" disabled={cancelling} onClick={handleCancelWC} />}
            {/* Single document button — replaces the legacy two-button flow
                ("Pickup Doc" + "Release Doc") that round-tripped GAS for 30-60s
                each. Renders DOC_WILL_CALL_RELEASE client-side from the
                Supabase email_templates row and prints in <1s. */}
            {!removeMode && <WriteButton label={printDocLoading ? 'Generating…' : 'Print Document'} variant="secondary" size="sm" icon={printDocLoading ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <FileText size={11} />} disabled={printDocLoading} onClick={handlePrintDocument} />}
          </div>
          )}
          {printDocError && (
            <div style={{ padding: '6px 10px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, marginTop: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={13} color="#DC2626" />
                <span style={{ fontSize: 12, color: '#DC2626' }}>{printDocError}</span>
              </div>
            </div>
          )}

          {/* Items — pinned to the bottom of the content stack (session 70 follow-up)
              so long rosters don't push Pickup Details / Activity out of view. */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}><Package size={14} color={theme.colors.orange} /><span style={{ fontSize: 12, fontWeight: 600 }}>Items ({resolvedItemCount})</span></div>
            {wc.items && wc.items.length > 0 ? (
              <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ background: theme.colors.bgSubtle }}>
                    {removeMode && <th style={{ padding: '6px 6px', width: 28 }} />}
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Item</th>
                    <th style={{ padding: '6px 10px', textAlign: 'center', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Qty</th>
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Vendor</th>
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Description</th>
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Location</th>
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Sidemark</th>
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Reference</th>
                    <th style={{ padding: '6px 10px', textAlign: 'center', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Released</th>
                  </tr></thead>
                  <tbody>{wc.items.map((item: any, i: number) => {
                    const isRemoveChecked = removeSelected.has(item.itemId);
                    const isReleased = !!item.released;
                    return (
                      <tr key={i} onClick={removeMode && !isReleased ? () => toggleRemoveItem(item.itemId) : undefined} style={{ borderBottom: `1px solid ${theme.colors.borderLight}`, cursor: removeMode && !isReleased ? 'pointer' : 'default', background: isRemoveChecked ? '#FEF2F2' : isReleased ? '#F9FAFB' : 'transparent', opacity: isReleased ? 0.55 : 1 }}>
                        {removeMode && (
                          <td style={{ padding: '6px 6px', textAlign: 'center' }}>
                            {isReleased ? <span style={{ color: theme.colors.textMuted, fontSize: 10 }}>{'\u2014'}</span> : (
                              <input type="checkbox" checked={isRemoveChecked} readOnly style={{ accentColor: '#DC2626', pointerEvents: 'none' }} />
                            )}
                          </td>
                        )}
                        <td style={{ padding: '6px 10px', fontWeight: 600 }}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap' }}>
                            <DeepLink kind="inventory" id={item.itemId} clientSheetId={clientSheetId} showIcon={false} />
                            <ItemIdBadges
                              itemId={item.itemId}
                              inspOpenItems={inspOpenItems}
                              inspDoneItems={inspDoneItems}
                              inspFailedItems={inspFailedItems}
                              asmOpenItems={asmOpenItems}
                              asmDoneItems={asmDoneItems}
                              repairOpenItems={repairOpenItems}
                              repairDoneItems={repairDoneItems}
                              wcOpenItems={wcOpenItems}
                              wcDoneItems={wcDoneItems}
                              dtOpenItems={dtOpenItems}
                              dtDoneItems={dtDoneItems}
                              codItems={codItems}
                            />
                          </span>
                        </td>
                        <td style={{ padding: '6px 10px', textAlign: 'center' }}>{item.qty}</td>
                        <td style={{ padding: '6px 10px', color: theme.colors.textSecondary, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.vendor || '\u2014'}</td>
                        <td style={{ padding: '6px 10px', color: theme.colors.textSecondary, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 11, color: theme.colors.textSecondary }}>{item.location || '\u2014'}</td>
                        <td style={{ padding: '6px 10px', color: theme.colors.textSecondary, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.sidemark || '\u2014'}</td>
                        <td style={{ padding: '6px 10px', color: theme.colors.textSecondary, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.reference || '\u2014'}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'center' }}>{isReleased ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, color: '#15803D', background: '#F0FDF4', padding: '1px 7px', borderRadius: 8 }}><CheckCircle2 size={11} /> Released</span> : <span style={{ color: theme.colors.textMuted }}>{'\u2014'}</span>}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
                </div>
              </div>
            ) : (
              enrichLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 0', color: theme.colors.textMuted, fontSize: 12 }}>
                  <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', color: theme.colors.orange }} />
                  Loading items&hellip;
                </div>
              ) : (
                <div style={{ fontSize: 12, color: theme.colors.textMuted }}>No item details available</div>
              )
            )}
          </div>

          {/* Billing Preview — staff/admin only. Will Call billing today
              is one WC line per release; the preview shows projected WC
              charges (catalog rate × line) plus any addons attached to
              this WC plus recorded ledger rows. itemClass is intentionally
              null because a Will Call can span multiple item classes —
              class-based addons fall back to the rate the operator types
              in the modal. v38.177.0: addons are now polymorphic and flush
              on release via handleProcessWcRelease_. */}
          <BillingPreviewCard
            entityType="will_call"
            entityId={wc.wcNumber}
            tenantId={clientSheetId || ''}
            svcCode="WC"
            itemClass={null}
            // Pass items so the projection sums per-item × class rate.
            // Released items already paid → exclude (matches handleProcessWcRelease_
            // which only writes ledger rows for items being released this run).
            wcItems={(wc.items || [])
              .filter((it: any) => !it.released)
              .map((it: any) => ({ itemId: it.itemId, itemClass: it.itemClass || null }))}
            addons={wcAddons}
            visible={canRelease}
            editable={canRelease && isActive}
            onAddAddon={async (input) => { await addWcAddon(input); }}
            onUpdateAddon={async (id, patch) => { await updateWcAddon(id, patch); }}
            onDeleteAddon={async (id) => { await deleteWcAddon(id); }}
          />

          {/* Threaded Notes preview — entity_notes for this will call.
              Composer + full thread live in the Notes tab. */}
          <EntityNotesInline
            entityType="will_call"
            entityId={wc.wcNumber}
            itemId={null}
            tenantId={clientSheetId ?? null}
          />
    </div>
  );

  // Header actions — edit/save/close
  const headerActions = isMobile ? null : (
    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'rgba(255,255,255,0.7)' }}>
      <X size={18} />
    </button>
  );

  // Below-ID status row
  const belowIdContent = (
    <div style={{ display: 'flex', gap: 6 }}>
      <Badge t={wc.status} bg={sc.bg} color={sc.color} />
      {wc.cod && <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 10, fontWeight: 600, background: '#FEF3C7', color: '#B45309' }}>COD{wc.codAmount ? `: $${wc.codAmount}` : ''}</span>}
      {paid && <Badge t="Paid" bg="#F0FDF4" color="#15803D" />}
    </div>
  );

  // Status strip — inline save success/error banners + document-gen results
  const statusStrip = (
    <>
      {editSaveError && (
        <div style={{ padding: '6px 20px', background: '#FEF2F2', color: '#DC2626', fontSize: 12, fontWeight: 500, borderBottom: `1px solid #FECACA` }}>{editSaveError}</div>
      )}
      {editSaveSuccess && (
        <div style={{ padding: '6px 20px', background: '#F0FDF4', color: '#15803D', fontSize: 12, fontWeight: 500, borderBottom: `1px solid #BBF7D0` }}>Changes saved successfully</div>
      )}
    </>
  );

  // Footer — Start WC / Release / Close + Edit/Save utility row.
  // EntityHistory moved to Activity tab (via builtInTabs below).
  const footer = (
    <>
      {cancelResult && cancelResult.success && (
        <div>
          <div style={{ padding: '12px 14px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10, marginBottom: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <X size={16} color="#DC2626" />
              <span style={{ fontSize: 13, fontWeight: 600, color: '#DC2626' }}>{cancelResult.skipped ? 'Already cancelled' : 'Will call cancelled'}</span>
            </div>
            <div style={{ fontSize: 12, color: '#991B1B' }}>
              {cancelResult.itemsCancelled != null && <div>{cancelResult.itemsCancelled} item(s) cancelled</div>}
              <div>Email: {cancelResult.emailSent ? '✓ Sent' : '✗ Not sent'}</div>
            </div>
            {cancelResult.warnings && cancelResult.warnings.length > 0 && (
              <div style={{ marginTop: 6, padding: '4px 8px', background: '#FEF3C7', borderRadius: 6 }}>
                {cancelResult.warnings.map((w, i) => <div key={i} style={{ fontSize: 11, color: '#92400E' }}>⚠ {w}</div>)}
              </div>
            )}
          </div>
          <button onClick={onClose} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Close</button>
        </div>
      )}

      {!cancelResult && <div>
          {/* Error banner */}
          {(releaseError || cancelError) && (
            <div style={{ marginBottom: 10, padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12, color: '#DC2626', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{releaseError || cancelError}</span>
            </div>
          )}
          {/* "Start Will Call" + "Regenerate" banner removed 2026-05-12 alongside
              the single-Print-Document migration. With the document now rendered
              client-side from email_templates in <1s on demand, there's no
              persistent doc-on-Drive to mark as "started" — every print is fresh.
              Status transition (Pending → Scheduled) is no longer tied to a
              doc-generation event. Reopen link below is unchanged. */}
          {/* Stage B: Reopen link (admin/staff only, visible on Scheduled/Partial/Released) */}
          {canRelease && (effectiveStatus === 'Released' || effectiveStatus === 'Partial' || effectiveStatus === 'Scheduled') && (
            <div style={{ marginBottom: 10, textAlign: 'center' }}>
              {reopenError && (
                <div style={{ fontSize: 11, color: '#DC2626', marginBottom: 6, padding: '4px 8px', background: '#FEF2F2', borderRadius: 6 }}>{reopenError}</div>
              )}
              <button
                onClick={handleReopenWc}
                disabled={reopenLoading}
                style={{ fontSize: 11, color: '#DC2626', background: 'none', border: 'none', cursor: reopenLoading ? 'wait' : 'pointer', textDecoration: 'underline', padding: '2px 0', fontFamily: 'inherit' }}
              >
                {reopenLoading ? 'Reopening…' : (effectiveStatus === 'Scheduled' ? 'Reopen will call (undo Start)...' : 'Reopen will call (undo Release)...')}
              </button>
            </div>
          )}
          {canRelease && isActive && !releaseResult ? (
            <WriteButton
              label={releasing ? 'Releasing...' : 'Release All Items'}
              variant="primary"
              icon={releasing ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={16} />}
              disabled={releasing}
              style={{ width: '100%', padding: '10px', fontSize: 13, background: '#15803D', opacity: releasing ? 0.7 : 1 }}
              onClick={() => handleRelease(allItemIds)}
            />
          ) : (
            <button onClick={onClose} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>
              {releaseResult ? 'Done' : 'Close'}
            </button>
          )}
          {/* Edit / Save / Cancel — moved out of the Start/Release CTA stack to
              a right-aligned utility row so the two primary full-width buttons
              sit adjacent. */}
          {isActive && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
              {isEditing ? (
                <>
                  <button onClick={handleEditCancel} disabled={editSaving}
                    style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: `1px solid ${theme.colors.border}`, background: '#fff', color: theme.colors.textSecondary, cursor: 'pointer', fontFamily: 'inherit' }}>
                    Cancel
                  </button>
                  <button onClick={handleEditSave} disabled={editSaving}
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', background: theme.colors.orange, color: '#fff', cursor: editSaving ? 'wait' : 'pointer', fontFamily: 'inherit' }}>
                    {editSaving ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={12} />}
                    {editSaving ? 'Saving...' : 'Save'}
                  </button>
                </>
              ) : (
                <button onClick={handleEditStart}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: `1px solid ${theme.colors.border}`, background: '#fff', color: theme.colors.textSecondary, cursor: 'pointer', fontFamily: 'inherit' }}>
                  <Pencil size={12} /> Edit
                </button>
              )}
            </div>
          )}
        </div>}
    </>
  );

  // ─── Mobile overflow menu (Cancel WC + Edit) ──────────────────────────
  const wcOverflowMenu = overflowOpen ? (
    <>
      <div onClick={() => setOverflowOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 999 }} />
      <div style={{
        position: 'fixed', bottom: `calc(env(safe-area-inset-bottom, 0px) + 82px)`, right: 16,
        background: '#fff', borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
        zIndex: 1000, minWidth: 200, overflow: 'hidden',
      }}>
        {isActive && !isEditing && canRelease && (
          <button onClick={() => { setOverflowOpen(false); setIsEditing(true); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '14px 18px', fontSize: 14, fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: '#1E293B' }}>
            <Pencil size={16} color="#475569" /> Edit Details
          </button>
        )}
        {isEditing && (
          <button onClick={() => { setOverflowOpen(false); handleEditCancel(); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '14px 18px', fontSize: 14, fontWeight: 500, background: 'none', border: 'none', cursor: 'pointer', fontFamily: 'inherit', color: '#B45309' }}>
            <X size={16} color="#B45309" /> Cancel Edit
          </button>
        )}
        {isActive && !cancelResult && (
          <button onClick={() => { setOverflowOpen(false); void handleCancelWC(); }} style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '14px 18px', fontSize: 14, fontWeight: 500, background: 'none', border: `none`, cursor: 'pointer', fontFamily: 'inherit', color: '#DC2626', borderTop: '1px solid #F1F5F9' }}>
            <X size={16} color="#DC2626" /> Cancel WC
          </button>
        )}
      </div>
    </>
  ) : null;

  // ─── Mobile footer ────────────────────────────────────────────────────
  const mobileFooter = (() => {
    const btnBase: React.CSSProperties = {
      flex: 1, padding: '14px 0', fontSize: 15, fontWeight: 600,
      borderRadius: 10, border: 'none', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    };
    if (cancelResult?.success) {
      return (
        <div style={{ padding: '12px 16px', paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + 12px)` }}>
          <button onClick={onClose} style={{ ...btnBase, width: '100%', background: '#F1F5F9', color: '#475569' }}>Done</button>
        </div>
      );
    }
    if (isEditing) {
      return (
        <div style={{ padding: '12px 16px', display: 'flex', gap: 10, paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + 12px)` }}>
          <button onClick={() => void handleEditSave()} disabled={editSaving} style={{ ...btnBase, background: theme.colors.orange, color: '#fff', cursor: editSaving ? 'wait' : 'pointer' }}>
            {editSaving ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={16} />}
            {editSaving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={handleEditCancel} disabled={editSaving} style={{ ...btnBase, flex: '0 0 auto', padding: '14px 20px', background: '#F1F5F9', color: '#475569' }}>
            Cancel
          </button>
        </div>
      );
    }
    if (!isActive || releaseResult) {
      return (
        <div style={{ padding: '12px 16px', paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + 12px)` }}>
          <button onClick={onClose} style={{ ...btnBase, width: '100%', background: '#F1F5F9', color: '#475569' }}>Done</button>
        </div>
      );
    }
    return (
      <div style={{ padding: '12px 16px', display: 'flex', gap: 10, paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + 12px)` }}>
        {canRelease && !releaseResult ? (
          <button onClick={() => void handleRelease(allItemIds)} disabled={releasing} style={{ ...btnBase, background: '#16A34A', color: '#fff', cursor: releasing ? 'wait' : 'pointer' }}>
            {releasing ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={16} />}
            {releasing ? 'Releasing...' : 'Release All'}
          </button>
        ) : (
          // No releasable items (Released / Partial / Cancelled / etc.) — the
          // mobile footer's secondary primary action collapses to Print Document.
          // Replaces the legacy "Start Will Call" path which was removed when
          // doc generation moved to client-side render-on-demand.
          <button onClick={() => void handlePrintDocument()} disabled={printDocLoading} style={{ ...btnBase, background: '#1C1C1C', color: '#fff', cursor: printDocLoading ? 'wait' : 'pointer' }}>
            {printDocLoading ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <FileText size={16} />}
            {printDocLoading ? 'Generating…' : 'Print Document'}
          </button>
        )}
        <button onClick={() => setOverflowOpen(v => !v)} style={{ ...btnBase, flex: '0 0 auto', width: 48, padding: 0, background: '#F1F5F9', color: '#475569' }}>
          <MoreHorizontal size={20} />
        </button>
        {wcOverflowMenu}
      </div>
    );
  })();

  // ─── Shell ────────────────────────────────────────────────────────────
  const tabs: TabbedDetailPanelTab[] = [
    { id: 'details', label: 'Details', keepMounted: true, render: renderDetailsTab },
  ];

  // v2026-05-04 — graph rollup. Container entity: WC scope + photos/notes
  // for every item assigned to the WC (catches inspection / repair photos
  // for those items so the WC page surfaces them).
  const wcRollupCtx = useMemo<RollupContext>(() => ({
    tenantId: clientSheetId ?? null,
    itemIds: allItemIds,
    scopes: [{ entityType: 'will_call', entityId: wc.wcNumber }],
  }), [clientSheetId, wc.wcNumber, allItemIds]);

  const builtInTabsCfg = {
    // v2026-05-04: rollup folds in line items so the slide-out matches
    // the page-mode tab content.
    photos: {
      entityType: 'will_call' as const,
      entityId: wc.wcNumber,
      tenantId: clientSheetId,
      enableSourceFilter: true,
      rollupCtx: wcRollupCtx,
    },
    docs:   { contextType: 'willcall' as const, contextId: wc.wcNumber, tenantId: clientSheetId },
    notes:  {
      entityType: 'will_call',
      entityId: wc.wcNumber,
      enableSourceFilter: true,
      tenantId: clientSheetId ?? null,
      rollupCtx: wcRollupCtx,
    },
    activity: { entityType: 'will_call', entityId: wc.wcNumber, tenantId: clientSheetId },
  };

  // ── Page-mode enhancements ──
  const { photos: wcPhotos } = usePhotoGraphRollup(
    renderAsPage ? wcRollupCtx : { tenantId: null, itemIds: [], scopes: [], enabled: false }
  );
  const { documents: wcDocsList } = useDocuments({
    contextType: 'willcall',
    contextId: renderAsPage ? wc.wcNumber : '',
    tenantId: clientSheetId ?? null,
    enabled: !!renderAsPage,
  });
  const { notes: wcNotesList } = useNoteGraphRollup(
    renderAsPage ? wcRollupCtx : { tenantId: null, itemIds: [], scopes: [], enabled: false }
  );
  const wcPhotoCount = renderAsPage ? wcPhotos.length : 0;
  const wcDocCount   = renderAsPage ? wcDocsList.length : 0;
  const wcNoteCount  = renderAsPage ? wcNotesList.length : 0;

  const wcDriveFolders: DriveFolderLink[] = [
    ...(wc.wcFolderUrl ? [{ label: `Will Call ${wc.wcNumber}`, url: wc.wcFolderUrl }] : []),
    ...(wc.shipmentFolderUrl ? [{ label: `Shipment ${wc.shipmentNumber || 'Folder'}`, url: wc.shipmentFolderUrl }] : []),
  ];

  const renderWcPhotosTab = () => (
    <div>
      <_PhotosPanel
        entityType="will_call"
        entityId={wc.wcNumber}
        tenantId={clientSheetId}
        enableSourceFilter
        rollupCtx={wcRollupCtx}
      />
      <DriveFoldersList folders={wcDriveFolders} />
    </div>
  );
  const renderWcDocsTab = () => (
    <div>
      <_DocumentsPanel contextType="willcall" contextId={wc.wcNumber} tenantId={clientSheetId} />
      <DriveFoldersList folders={wcDriveFolders} />
    </div>
  );
  const renderWcNotesTab = () => (
    <_NotesPanel
      entityType="will_call"
      entityId={wc.wcNumber}
      enableSourceFilter
      tenantId={clientSheetId ?? null}
      rollupCtx={wcRollupCtx}
      pinnedNote={{ label: 'Will Call Notes', text: wc.notes }}
    />
  );
  const renderWcActivityTab = () => (
    <ActivityTimeline entityType="will_call" entityId={wc.wcNumber} tenantId={clientSheetId ?? undefined} />
  );

  const pageTabs = [
    { id: 'details',  label: 'Details',  keepMounted: true, render: renderDetailsTab },
    { id: 'photos',   label: 'Photos',   badgeCount: wcPhotoCount, render: renderWcPhotosTab },
    { id: 'docs',     label: 'Docs',     badgeCount: wcDocCount,   render: renderWcDocsTab },
    { id: 'notes',    label: 'Notes',    badgeCount: wcNoteCount,  render: renderWcNotesTab },
    { id: 'activity', label: 'Activity', render: renderWcActivityTab },
  ];

  // Page-mode footer — state-aware pill-styled buttons (reuses existing handlers).
  const pagePillBase: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: 5, flex: '1 1 0',
    minWidth: isMobile ? 92 : 110,
    maxWidth: isMobile ? 140 : 170,
    padding: isMobile ? '8px 10px' : '10px 14px',
    borderRadius: 10, border: 'none',
    fontFamily: 'inherit',
    fontSize: isMobile ? 11 : 12,
    fontWeight: 700,
    letterSpacing: '0.3px', cursor: 'pointer', whiteSpace: 'nowrap',
  };
  const wcDark: React.CSSProperties = { ...pagePillBase, background: '#1C1C1C', color: '#fff' };
  const wcOrange: React.CSSProperties = { ...pagePillBase, background: theme.colors.orange, color: '#fff' };
  const wcLight: React.CSSProperties = { ...pagePillBase, background: '#fff', color: theme.colors.text, border: `1px solid ${theme.colors.border}` };
  const wcRed: React.CSSProperties = { ...pagePillBase, background: '#B91C1C', color: '#fff' };

  // FAB actions mirror the inline pill row. removeMode is a temporary
  // UI state with its own Cancel/Confirm pills; we keep those inline so
  // the operator doesn't have to re-open the FAB to confirm.
  const fabActions: FABAction[] = removeMode ? [] : [
    { label: printDocLoading ? 'Generating…' : 'Print Document', icon: <FileText size={16} />, onClick: handlePrintDocument },
    ...(isActive && !cancelResult ? [{ label: cancelling ? 'Cancelling…' : 'Cancel WC', icon: <AlertTriangle size={16} />, onClick: handleCancelWC, color: '#B91C1C' }] : []),
    ...(isActive && !releaseResult && !removeResult ? [{ label: 'Remove Items…', icon: <Package size={16} />, onClick: () => { setRemoveMode(true); setRemoveSelected(new Set()); setRemoveError(null); } }] : []),
    ...(!isActive && (user?.role === 'admin' || user?.role === 'staff') ? [{ label: 'Reopen WC', icon: <Play size={16} />, onClick: handleReopenWc }] : []),
    ...(canRelease && isActive && !releaseResult && !removeResult && releaseMode === 'none' && allItemIds.length > 1 ? [{ label: 'Release Some…', icon: <Truck size={16} />, onClick: () => { setPartialSelected(new Set(allItemIds)); setReleaseMode('partial'); }, color: theme.colors.orange }] : []),
  ];

  const pageFooter = isCompactViewport && !removeMode ? null : (
    <>
      {!removeMode && !isEditing && (
        <button onClick={handlePrintDocument} disabled={printDocLoading} style={wcDark}>
          {printDocLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <FileText size={13} />}
          {printDocLoading ? 'Generating…' : 'Print Document'}
        </button>
      )}
      {/* Edit / Save / Cancel — admin/staff on active WCs. Mirrors the
          slide-out drawer's Edit row (the `footer` var below) which has
          existed since session 91 but was never wired into pageFooter,
          so anyone viewing the WC at /will-calls/<id> couldn't get into
          edit mode to change pickup date / contacts / notes. Reuses the
          same handleEditStart / handleEditSave / handleEditCancel +
          isEditing state — toggling Edit reveals input fields for every
          editable Pickup Details field at once. The other utility
          buttons (Cancel WC, Remove Items, Print Document, Release Some)
          hide while isEditing so the footer stays focused on Save/Cancel
          during the edit. */}
      {canRelease && isActive && !cancelResult && !removeMode && !releaseResult && releaseMode === 'none' && (
        isEditing ? (
          <>
            <button onClick={handleEditCancel} disabled={editSaving} style={wcLight}>
              <X size={13} /> Cancel Edit
            </button>
            <button onClick={handleEditSave} disabled={editSaving} style={wcOrange}>
              {editSaving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />}
              {editSaving ? 'Saving…' : 'Save'}
            </button>
          </>
        ) : (
          <button onClick={handleEditStart} style={wcLight}>
            <Pencil size={13} /> Edit
          </button>
        )
      )}
      {isActive && !cancelResult && !removeMode && !isEditing && (
        <button onClick={handleCancelWC} disabled={cancelling} style={wcRed}>
          {cancelling ? 'Cancelling…' : 'Cancel WC'}
        </button>
      )}
      {isActive && !releaseResult && !removeResult && !removeMode && !isEditing && (
        <button onClick={() => { setRemoveMode(true); setRemoveSelected(new Set()); setRemoveError(null); }} style={wcLight}>
          Remove Items…
        </button>
      )}
      {removeMode && (
        <>
          <button onClick={() => { setRemoveMode(false); setRemoveSelected(new Set()); }} style={wcLight}>Cancel</button>
          {removeSelected.size > 0 && (
            <button onClick={handleRemoveItems} disabled={removing} style={wcRed}>
              {removing ? 'Removing…' : `Remove ${removeSelected.size}`}
            </button>
          )}
        </>
      )}
      {/* Reopen Will Call — admin/staff only; shown when WC is released or cancelled */}
      {!isActive && !removeMode && (user?.role === 'admin' || user?.role === 'staff') && (
        <button onClick={handleReopenWc} style={wcLight}>Reopen WC</button>
      )}
      {/* Primary release button — orange */}
      {canRelease && isActive && !releaseResult && !removeResult && releaseMode === 'none' && allItemIds.length > 1 && !isEditing && (
        <button onClick={() => { setPartialSelected(new Set(allItemIds)); setReleaseMode('partial'); }} style={wcOrange}>
          Release Some…
        </button>
      )}
      {/* Add Charge — admin/staff; works on released/cancelled WCs too. */}
      {clientSheetId && !removeMode && (
        <AddChargeButton
          entity={{
            tenantId: clientSheetId,
            entityType: 'will_call',
            entityId: String(wc.wcNumber),
            items: (wc.items ?? []).map(it => ({
              itemId: it.itemId,
              itemClass: it.itemClass ?? null,
              label: it.description ? `${it.itemId} · ${it.description}` : it.itemId,
            })),
            itemId: (wc.items ?? []).length === 1 ? wc.items[0].itemId : null,
            itemClass: (wc.items ?? []).length === 1 ? (wc.items[0].itemClass ?? null) : null,
          }}
          buttonStyle={wcDark}
        />
      )}
    </>
  );

  if (renderAsPage) {
    return (
      <>
        <EntityPage
          entityLabel="Will Call"
          entityId={wc.wcNumber}
          clientName={wc.clientName}
          statusBadge={belowIdContent}
          headerActions={headerActions}
          statusStrip={statusStrip}
          tabs={pageTabs as unknown as Parameters<typeof EntityPage>[0]['tabs']}
          initialTabId="details"
          footer={pageFooter}
        />
        <FloatingActionMenu show={isCompactViewport && !removeMode} actions={fabActions} />
      </>
    );
  }

  return (
    <TabbedDetailPanel
      title={wc.wcNumber}
      clientName={wc.clientName}
      belowId={belowIdContent}
      headerActions={headerActions}
      statusStrip={statusStrip}
      overlay={<ProcessingOverlay
        visible={releasing || cancelling || removing}
        message={
          removing ? 'Removing items'
          : cancelling ? 'Cancelling will call'
          : 'Hold tight — processing your release'
        }
        subMessage={
          removing ? 'Updating inventory and billing.'
          : cancelling ? 'Putting items back on hold.'
          : 'Releasing items, generating the doc, and notifying the client. You can leave this open.'
        }
      />}
      tabs={tabs}
      builtInTabs={builtInTabsCfg}
      footer={isMobile ? mobileFooter : footer}
      onClose={onClose}
      resizeKey="willcall"
      defaultWidth={440}
    />
  );
}
