import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { X, Truck, Package, Calendar, Phone, User, DollarSign, CheckCircle2, CreditCard, FileText, Loader2, AlertTriangle, FolderOpen, Info, Pencil, Save, Play } from 'lucide-react';
import { FolderButton } from './FolderButton';
import { DeepLink } from './DeepLink';
import { EntityHistory } from './EntityHistory';
import { EntityAttachments } from './EntityAttachments';
import { DetailHeader } from './DetailHeader';
import { ItemIdBadges } from './ItemIdBadges';
import { useItemIndicators } from '../../hooks/useItemIndicators';
import { theme } from '../../styles/theme';
import { fmtDate } from '../../lib/constants';
import { WriteButton } from './WriteButton';
import { ProcessingOverlay } from './ProcessingOverlay';
import { getPanelContainerStyle, panelBackdropStyle } from './panelStyles';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useResizablePanel } from '../../hooks/useResizablePanel';
import { postProcessWcRelease, postCancelWillCall, postRemoveItemsFromWillCall, postUpdateWillCall, postGenerateWcDoc, fetchWcDocUrl, fetchWillCallById, isApiConfigured } from '../../lib/api';
import { fetchWcItemsFromSupabase } from '../../lib/supabaseQueries';
import { useClients } from '../../hooks/useClients';
import { writeSyncFailed } from '../../lib/syncEvents';
import { entityEvents } from '../../lib/entityEvents';
import { useAuth } from '../../contexts/AuthContext';
import type { ProcessWcReleaseResponse, CancelWillCallResponse, RemoveItemsFromWillCallResponse } from '../../lib/api';

import type { WillCall, InventoryItem } from '../../lib/types';
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

export function WillCallDetailPanel({ wc: wcProp, onClose, onWcUpdated, onNavigateToWc, applyWcPatch, clearWcPatch, applyItemPatch }: Props) {
  const { user } = useAuth();
  // Clients are not allowed to release items or set release dates — that
  // decision belongs to warehouse staff. Gate every Release-related action.
  const canRelease = user?.role === 'admin' || user?.role === 'staff';
  const { isMobile } = useIsMobile();
  const { width: panelWidth, handleMouseDown: handleResizeMouseDown } = useResizablePanel(440, 'willcall', isMobile);
  const apiConfigured = isApiConfigured();
  const { apiClients } = useClients(apiConfigured);
  const clientSheetId = useMemo(() => wcProp.clientSheetId || apiClients.find(c => c.name === wcProp.clientName)?.spreadsheetId || '', [apiClients, wcProp.clientName, wcProp.clientSheetId]);

  // (I)(A)(R) indicators for every item in the WC items table below.
  const { inspItems, asmItems, repairItems } = useItemIndicators(clientSheetId);

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

  // Merge prop data with enriched data — enriched fills gaps, prop takes priority for non-empty
  const wc = useMemo(() => {
    if (!enrichedData) return wcProp;
    return {
      ...wcProp,
      items: (wcProp.items?.length ? wcProp.items : enrichedData.items) || [],
      itemCount: wcProp.itemCount || enrichedData.itemCount || 0,
      pickupPartyPhone: wcProp.pickupPartyPhone || enrichedData.pickupPartyPhone,
      scheduledDate: wcProp.scheduledDate || enrichedData.scheduledDate,
      notes: wcProp.notes || enrichedData.notes,
      cod: wcProp.cod ?? enrichedData.cod,
      codAmount: wcProp.codAmount ?? enrichedData.codAmount,
      wcFolderUrl: wcProp.wcFolderUrl || enrichedData.wcFolderUrl,
      shipmentFolderUrl: wcProp.shipmentFolderUrl || enrichedData.shipmentFolderUrl,
    };
  }, [wcProp, enrichedData]);

  const [effectiveStatus, setEffectiveStatus] = useState<string>(wc.status);
  // Sync with incoming wc prop — parent may update via optimistic patch or refetch.
  // Without this, the local state sticks on the initial mount value and the panel
  // appears to flip/flash between rendered values when wc changes.
  useEffect(() => { if (wc.status && wc.status !== effectiveStatus) setEffectiveStatus(wc.status); }, [wc.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const sc = STATUS_CFG[effectiveStatus] || STATUS_CFG.Pending;
  const isActive = ['Pending', 'Scheduled', 'Partial'].includes(effectiveStatus);

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

  const handleEditStart = useCallback(() => {
    setEditPickupParty(wc.pickupParty || '');
    setEditPhone(wc.pickupPartyPhone || '');
    setEditDate(wc.scheduledDate || '');
    setEditNotes(wc.notes || '');
    setEditCod(!!wc.cod);
    setEditCodAmount(wc.codAmount != null ? String(wc.codAmount) : '');
    setEditSaveError(null);
    setEditSaveSuccess(false);
    setIsEditing(true);
  }, [wc]);

  const handleEditCancel = useCallback(() => {
    setIsEditing(false);
    setEditSaveError(null);
  }, []);

  const handleEditSave = useCallback(async () => {
    if (!apiConfigured || !clientSheetId || !wc.wcNumber) return;
    setEditSaving(true);
    setEditSaveError(null);

    const payload: Record<string, unknown> = { wcNumber: wc.wcNumber };
    let changed = false;
    if (editPickupParty !== (wc.pickupParty || '')) { payload.pickupParty = editPickupParty; changed = true; }
    if (editPhone !== (wc.pickupPartyPhone || '')) { payload.pickupPhone = editPhone; changed = true; }
    if (editDate !== (wc.scheduledDate || '')) { payload.estimatedPickupDate = editDate; changed = true; }
    if (editNotes !== (wc.notes || '')) { payload.notes = editNotes; changed = true; }
    if (editCod !== !!wc.cod) { payload.cod = editCod; changed = true; }
    const origAmt = wc.codAmount != null ? String(wc.codAmount) : '';
    if (editCodAmount !== origAmt) {
      payload.codAmount = editCodAmount.trim() === '' ? 0 : parseFloat(editCodAmount);
      changed = true;
    }

    if (!changed) { setIsEditing(false); setEditSaving(false); return; }

    try {
      const resp = await postUpdateWillCall(payload as any, clientSheetId);
      if (!resp.ok || !resp.data?.success) {
        setEditSaveError(resp.error || resp.data?.error || 'Save failed');
      } else {
        setIsEditing(false);
        setEditSaveSuccess(true);
        setTimeout(() => setEditSaveSuccess(false), 3000);
        onWcUpdated?.();
      }
    } catch {
      setEditSaveError('Network error — please try again');
    }
    setEditSaving(false);
  }, [apiConfigured, clientSheetId, wc, editPickupParty, editPhone, editDate, editNotes, editCod, editCodAmount, onWcUpdated]);

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

  // Print Release Doc state
  const [printLoading, setPrintLoading] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [printPdfUrl, setPrintPdfUrl] = useState<string | null>(null);

  const handlePrintRelease = async () => {
    setPrintError(null);
    setPrintPdfUrl(null);
    if (!apiConfigured || !clientSheetId) {
      setPrintError('API not configured');
      return;
    }
    setPrintLoading(true);
    try {
      const resp = await fetchWcDocUrl(wc.wcNumber, clientSheetId);
      if (!resp.ok || !resp.data) {
        setPrintError(resp.error || 'Failed to fetch document URL');
        return;
      }
      if (resp.data.error && !resp.data.pdfUrl) {
        setPrintError(resp.data.error);
        return;
      }
      if (!resp.data.pdfUrl) {
        setPrintError('No PDF found in will call folder');
        return;
      }
      setPrintPdfUrl(resp.data.pdfUrl);
      const win = window.open(resp.data.pdfUrl, '_blank');
      if (!win) {
        setPrintError('Popup blocked — use the link below to open the PDF');
      } else {
        // Trigger print dialog once PDF loads in the new tab
        win.addEventListener('load', () => { try { win.print(); } catch (_) {} });
        // Fallback: some PDF viewers don't fire load — try after delay
        setTimeout(() => { try { win.print(); } catch (_) {} }, 2000);
      }
    } catch (err) {
      setPrintError(err instanceof Error ? err.message : 'Network error');
    } finally {
      setPrintLoading(false);
    }
  };

  // Generate WC Doc state
  const [genDocLoading, setGenDocLoading] = useState(false);
  const [genDocResult, setGenDocResult] = useState<string | null>(null);
  const [genDocError, setGenDocError] = useState<string | null>(null);

  // Session 74 optimistic-first: hide the Start button + show success
  // banner instantly. GAS runs in the background. If the PDF generation
  // fails, we surface an error banner without forcing the button to
  // reappear — the user can click Regenerate from the banner.
  const handleGenerateWcDoc = async () => {
    setGenDocError(null);
    if (!apiConfigured || !clientSheetId) { setGenDocError('API not configured'); return; }

    // 1. OPTIMISTIC: flip to success state immediately so the primary
    //    purple button is replaced by the green banner.
    setGenDocResult('Pickup document generated in Will Call folder');
    entityEvents.emit('will_call', wc.wcNumber);

    // 2. Background GAS — refresh the banner with the real folder URL on
    //    success; surface a non-blocking error banner on failure.
    void (async () => {
      setGenDocLoading(true);
      try {
        const resp = await postGenerateWcDoc(wc.wcNumber, clientSheetId);
        if (!resp.ok || !resp.data?.success) {
          setGenDocError(
            (resp.error || resp.data?.error || 'Pickup document generation failed')
            + ' — click Regenerate to retry.'
          );
        } else {
          const url = resp.data?.folderUrl || '';
          setGenDocResult(url
            ? `Pickup document generated — ${url}`
            : 'Pickup document generated in Will Call folder');
        }
      } catch (err) {
        setGenDocError(
          (err instanceof Error ? err.message : 'Network error')
          + ' — click Regenerate to retry.'
        );
      } finally {
        setGenDocLoading(false);
      }
    })();
  };

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
        }
      } catch (err) {
        setReleaseError(
          (err instanceof Error ? err.message : 'Network error')
          + ' while releasing. Refresh to reconcile.'
        );
      }
    })();
  };

  return (
    <>
      {!isMobile && <div onClick={() => { if (!releasing && !cancelling) onClose(); }} style={panelBackdropStyle} />}
      <div style={getPanelContainerStyle(panelWidth, isMobile)}>
        {!isMobile && <div onMouseDown={handleResizeMouseDown} style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, cursor: 'col-resize', zIndex: 101 }} />}

        <ProcessingOverlay visible={releasing || cancelling || removing} message={removing ? 'Removing items...' : cancelling ? 'Cancelling Will Call...' : 'Processing Release...'} />

        {/* Header — unified DetailHeader (session 70 follow-up).
            Edit / Save / Cancel moved to the sticky footer bottom-left. */}
        <DetailHeader
          entityId={wc.wcNumber}
          clientName={wc.clientName}
          actions={
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted }}>
              <X size={18} />
            </button>
          }
          belowId={
            <div style={{ display: 'flex', gap: 6 }}>
              <Badge t={wc.status} bg={sc.bg} color={sc.color} />
              {wc.cod && <span style={{ fontSize: 11, padding: '2px 10px', borderRadius: 10, fontWeight: 600, background: '#FEF3C7', color: '#B45309' }}>COD{wc.codAmount ? `: $${wc.codAmount}` : ''}</span>}
              {paid && <Badge t="Paid" bg="#F0FDF4" color="#15803D" />}
            </div>
          }
        />
        {editSaveError && (
          <div style={{ padding: '6px 20px', background: '#FEF2F2', color: '#DC2626', fontSize: 12, fontWeight: 500, borderBottom: `1px solid #FECACA` }}>{editSaveError}</div>
        )}
        {editSaveSuccess && (
          <div style={{ padding: '6px 20px', background: '#F0FDF4', color: '#15803D', fontSize: 12, fontWeight: 500, borderBottom: `1px solid #BBF7D0` }}>Changes saved successfully</div>
        )}
        {/* Top-of-panel confirmation for Regenerate Pickup Document — lives above scrollable content so
            it doesn't get pushed off-screen by panel re-renders. Stays visible until explicitly dismissed. */}
        {genDocResult && (
          <div style={{ padding: '10px 20px', background: '#F0FDF4', borderBottom: '1px solid #BBF7D0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle2 size={16} color="#15803D" />
              <span style={{ fontSize: 13, color: '#15803D', fontWeight: 600 }}>Pickup document generated in Will Call folder</span>
            </div>
            <button onClick={() => setGenDocResult(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#15803D', fontSize: 11, padding: 0, fontWeight: 600 }}>Dismiss</button>
          </div>
        )}
        {genDocError && (
          <div style={{ padding: '10px 20px', background: '#FEF2F2', borderBottom: '1px solid #FECACA', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={16} color="#DC2626" />
              <span style={{ fontSize: 13, color: '#DC2626', fontWeight: 600 }}>{genDocError}</span>
            </div>
            <button onClick={() => setGenDocError(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#DC2626', fontSize: 11, padding: 0, fontWeight: 600 }}>Dismiss</button>
          </div>
        )}

        {/* Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>

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
                  <label style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 3 }}>Estimated Pickup Date</label>
                  <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <Field label="Items" value={`${wc.itemCount} items`} icon={Package} />
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
                  <Field label="Estimated Pickup Date" value={fmtDate(wc.scheduledDate)} icon={Calendar} />
                  <Field label="Items" value={`${wc.itemCount} items`} icon={Package} />
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
                    <DollarSign size={14} color={theme.colors.textMuted} style={{ marginTop: 2 }} />
                    <div>
                      <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 3 }}>COD</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" checked={!!wc.cod} readOnly style={{ accentColor: theme.colors.orange, pointerEvents: 'none', width: 16, height: 16 }} />
                        {wc.cod && wc.codAmount ? <span style={{ fontSize: 13, fontWeight: 600 }}>${Number(wc.codAmount).toFixed(2)}</span> : null}
                      </div>
                    </div>
                  </div>
                </div>
                {wc.notes && <div style={{ marginTop: 4, fontSize: 12, color: theme.colors.textSecondary }}><strong>Notes:</strong> {wc.notes}</div>}
              </>
            )}
            {/* Drive Folder Buttons — only render when the URL exists. */}
            {(wc.wcFolderUrl || wc.shipmentFolderUrl) && (
              <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
                {wc.wcFolderUrl && (
                  <FolderButton label="Will Call Folder" url={wc.wcFolderUrl} icon={FolderOpen} />
                )}
                {wc.shipmentFolderUrl && (
                  <FolderButton label="Shipment Folder" url={wc.shipmentFolderUrl} icon={Truck} />
                )}
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
                        // Session 74: open the branded stax-payment.html
                        // instead of the raw Stax hosted page. Pass the
                        // WC number in BOTH ?order= (drives the badge +
                        // Order # input) and ?notes= (so the reference
                        // back to the Will Call is captured on the Stax
                        // payment record). The page also pre-fills the
                        // amount field if we pass one — wire codAmount
                        // in for a one-click collection flow.
                        const wcNum = wc.wcNumber || '';
                        const params = new URLSearchParams();
                        if (wcNum) {
                          params.set('order', wcNum);
                          params.set('notes', `Will Call ${wcNum}`);
                        }
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

          {/* Activity History */}
          {(() => {
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

          {/* Quick Actions */}
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
            {!removeMode && <WriteButton label={printLoading ? 'Loading...' : 'Print Release Doc'} variant="secondary" size="sm" icon={printLoading ? <Loader2 size={11} className="animate-spin" /> : <FileText size={11} />} disabled={printLoading} onClick={handlePrintRelease} />}
            {/* Always-available regenerate — needed after released WCs so a broken/old PDF can be rebuilt */}
            {!removeMode && <WriteButton label={genDocLoading ? 'Regenerating...' : 'Regenerate Pickup Document'} variant="secondary" size="sm" icon={genDocLoading ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={11} />} disabled={genDocLoading} onClick={handleGenerateWcDoc} />}
          </div>
          {genDocResult && (
            <div style={{ padding: '8px 12px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
                <CheckCircle2 size={14} color="#15803D" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: '#15803D', fontWeight: 500 }}>Pickup document generated</span>
              </div>
              <button onClick={() => setGenDocResult(null)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#15803D', fontSize: 11, padding: 0 }}>Dismiss</button>
            </div>
          )}
          {genDocError && (
            <div style={{ padding: '6px 10px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, marginTop: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={13} color="#DC2626" />
                <span style={{ fontSize: 12, color: '#DC2626' }}>{genDocError}</span>
              </div>
            </div>
          )}
          {printPdfUrl && !printError && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, marginTop: 6 }}>
              <FileText size={13} color="#15803D" />
              <a href={printPdfUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#15803D', fontWeight: 500 }}>Open Release Document</a>
            </div>
          )}
          {printError && (
            <div style={{ padding: '6px 10px', background: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 8, marginTop: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={13} color="#B45309" />
                <span style={{ fontSize: 12, color: '#92400E' }}>{printError}</span>
              </div>
              {printPdfUrl && (
                <a href={printPdfUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: '#B45309', fontWeight: 500, marginTop: 4, display: 'inline-block' }}>Open PDF directly</a>
              )}
            </div>
          )}

          {/* Items — pinned to the bottom of the content stack (session 70 follow-up)
              so long rosters don't push Pickup Details / Activity out of view. */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}><Package size={14} color={theme.colors.orange} /><span style={{ fontSize: 12, fontWeight: 600 }}>Items ({wc.items?.length || wc.itemCount || 0})</span></div>
            {wc.items && wc.items.length > 0 ? (
              <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 10, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead><tr style={{ background: theme.colors.bgSubtle }}>
                    {removeMode && <th style={{ padding: '6px 6px', width: 28 }} />}
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Item</th>
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Description</th>
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Vendor</th>
                    <th style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Location</th>
                    <th style={{ padding: '6px 10px', textAlign: 'center', fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase' }}>Qty</th>
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
                              inspItems={inspItems}
                              asmItems={asmItems}
                              repairItems={repairItems}
                            />
                          </span>
                        </td>
                        <td style={{ padding: '6px 10px', color: theme.colors.textSecondary, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.description}</td>
                        <td style={{ padding: '6px 10px', color: theme.colors.textSecondary, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.vendor || '\u2014'}</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 11, color: theme.colors.textSecondary }}>{item.location || '\u2014'}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'center' }}>{item.qty}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'center' }}>{isReleased ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 10, fontWeight: 600, color: '#15803D', background: '#F0FDF4', padding: '1px 7px', borderRadius: 8 }}><CheckCircle2 size={11} /> Released</span> : <span style={{ color: theme.colors.textMuted }}>{'\u2014'}</span>}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
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

          {/* Session 74 — Photos + Documents + Notes */}
          <EntityAttachments
            photos={{ entityType: 'will_call', entityId: wc.wcNumber, tenantId: clientSheetId }}
            documents={{ contextType: 'willcall', contextId: wc.wcNumber, tenantId: clientSheetId }}
            notes={{ entityType: 'will_call', entityId: wc.wcNumber }}
          />
        </div>

        {/* Cancel result card */}
        {cancelResult && cancelResult.success && (
          <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
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
            <EntityHistory entityType="will_call" entityId={wc.wcNumber} tenantId={clientSheetId} />
            <button onClick={onClose} style={{ width: '100%', padding: '10px', fontSize: 13, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>Close</button>
          </div>
        )}

        {/* Footer */}
        {!cancelResult && <div style={{ padding: '14px 20px', borderTop: `1px solid ${theme.colors.border}`, flexShrink: 0 }}>
          {/* Error banner */}
          {(releaseError || cancelError) && (
            <div style={{ marginBottom: 10, padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, fontSize: 12, color: '#DC2626', display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{releaseError || cancelError}</span>
            </div>
          )}
          {/* Start Will Call — generates the pickup document (same backend as Start Repair's PDF generation).
              Session 74: after a successful start, the primary purple
              "Start Will Call" button is hidden and replaced by a compact
              green success banner so the user sees the state transition.
              A small text-link "Regenerate" still lets them re-run the
              generation if items change. Previously the button stayed
              visible as "Regenerate Pickup Document" which made it look
              like the Start action hadn't completed. */}
          {isActive && !releaseResult && !genDocResult && (
            <div style={{ marginBottom: 10 }}>
              <WriteButton
                label={genDocLoading ? 'Starting...' : 'Start Will Call'}
                variant="primary"
                icon={genDocLoading ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Play size={16} />}
                disabled={genDocLoading}
                style={{ width: '100%', padding: '10px', fontSize: 13, background: '#7C3AED', opacity: genDocLoading ? 0.7 : 1 }}
                onClick={handleGenerateWcDoc}
              />
            </div>
          )}
          {isActive && !releaseResult && genDocResult && (
            <div style={{
              marginBottom: 10, padding: '8px 12px',
              background: '#ECFDF5', border: '1px solid #A7F3D0', borderRadius: 8,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
              fontSize: 12, color: '#065F46',
            }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                <CheckCircle2 size={14} style={{ flexShrink: 0 }} />
                <span style={{ fontWeight: 600 }}>Will Call started</span>
                <span style={{ color: '#047857', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  — pickup document generated
                </span>
              </span>
              <button
                onClick={handleGenerateWcDoc}
                disabled={genDocLoading}
                title="Regenerate pickup document"
                style={{
                  background: 'transparent', border: 'none', padding: '2px 6px',
                  color: '#047857', fontSize: 11, fontWeight: 600, cursor: 'pointer',
                  fontFamily: 'inherit', textDecoration: 'underline', flexShrink: 0,
                  opacity: genDocLoading ? 0.5 : 1,
                }}
              >
                {genDocLoading ? 'Regenerating…' : 'Regenerate'}
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
      </div>
      <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
    </>
  );
}
