import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { X, Package, Calendar, FileText, ClipboardList, Wrench, Truck, ExternalLink, AlertCircle, CheckCircle2, Pencil, Save, Loader2, FolderOpen, Plus, ChevronDown, Shield, Image as ImageIcon, StickyNote, Activity, BadgePercent, Split as SplitIcon } from 'lucide-react';
import { StorageCreditsSection } from './StorageCreditsSection';
import { ActivityTimeline } from './ActivityTimeline';
import { DollarSign } from 'lucide-react';
import { useAddCharge } from '../billing/useAddCharge';
import { FolderButton } from './FolderButton';
import { ItemIdBadges } from './ItemIdBadges';
import { useItemIndicators } from '../../hooks/useItemIndicators';
import { LinkifiedText } from './LinkifiedText';
import { AutocompleteInput } from './AutocompleteInput';
import { theme } from '../../styles/theme';
import { fmtDate } from '../../lib/constants';
import { useReceivingAddons } from '../../hooks/useReceivingAddons';
import { postUpdateInventoryItem, postRequestRepairQuote, postRequestRepairQuoteSb, postAddItemAddon, postRemoveItemAddon, isApiConfigured } from '../../lib/api';
import { useFeatureFlag, useFeatureFlagRow, resolveFlagBackend } from '../../contexts/FeatureFlagContext';
import { entityEvents } from '../../lib/entityEvents';
import type { InventoryItem, InventoryStatus } from '../../lib/types';
import { TabbedDetailPanel } from './TabbedDetailPanel';
import type { TabbedDetailPanelTab } from './TabbedDetailPanel';
import { EntityPage } from './EntityPage';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useAutocomplete } from '../../hooks/useAutocomplete';
import { FloatingActionMenu, type FABAction } from './FloatingActionMenu';
import { usePhotoGraphRollup, useNoteGraphRollup, type RollupContext } from '../../hooks/useGraphRollup';
import { EntityNotesInline } from '../notes/EntityNotesInline';
import { ItemCodStorageSection } from './ItemCodStorageSection';
import { useDocuments } from '../../hooks/useDocuments';

export interface LinkedRecord {
  id: string;
  type: 'task' | 'repair' | 'willcall';
  status?: string;
}

interface Props {
  item: any;
  onClose: () => void;
  photosFolderId?: string;
  shipmentFolderUrl?: string;
  linkedTasks?: LinkedRecord[];
  linkedRepairs?: LinkedRecord[];
  linkedWillCalls?: LinkedRecord[];
  onNavigateToRecord?: (type: 'task' | 'repair' | 'willcall' | 'shipment', id: string) => void;
  // Action callbacks
  onCreateTask?: () => void;
  onCreateWillCall?: () => void;
  onTransfer?: () => void;
  /** Optional Split action — shown only when qty > 1. Wired by the
   *  ItemPage which owns the dialog state + the SplitItemDialog modal. */
  onSplit?: () => void;
  // History data — uses any[] to accept both frontend and API types
  itemTasks?: any[];
  itemRepairs?: any[];
  itemWillCalls?: any[];
  itemBilling?: any[];
  // Optional enriched shipment data (carrier, tracking — beyond what's on item itself)
  itemShipment?: { carrier?: string; trackingNo?: string; [key: string]: any };
  // Inline editing props
  userRole?: 'admin' | 'staff' | 'client';
  classNames?: string[];
  locationNames?: string[];
  clientSheetId?: string;
  onItemUpdated?: () => void;
  // Phase 2C — optimistic patch functions (optional)
  applyItemPatch?: (itemId: string, patch: Partial<InventoryItem>) => void;
  mergeItemPatch?: (itemId: string, patch: Partial<InventoryItem>) => void;
  clearItemPatch?: (itemId: string) => void;
  // Session 80+ — render as full EntityPage instead of slide-out TabbedDetailPanel.
  // When true, sidemark + idBadges are hidden from the header (per redesign spec)
  // and the outer shell is swapped. All tabs, handlers, modals, and edit logic
  // are preserved exactly as-is.
  renderAsPage?: boolean;
}

function Badge({ t, bg, color }: { t: string; bg: string; color: string }) {
  return <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: bg, color, whiteSpace: 'nowrap' }}>{t}</span>;
}

function Section({ icon: Icon, title, count, children }: { icon: any; title: string; count?: number; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, flexShrink: 0 }}>
          <Icon size={15} color={theme.colors.orange} />
        </span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        {count !== undefined && <span style={{ fontSize: 11, color: theme.colors.textMuted, background: theme.colors.bgSubtle, padding: '1px 8px', borderRadius: 10 }}>{count}</span>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value?: string | number | null; mono?: boolean }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, color: value ? theme.colors.text : theme.colors.textMuted, fontFamily: mono ? 'monospace' : 'inherit' }}>{value || '\u2014'}</div>
    </div>
  );
}

// ─── Edit-mode input style ──────────────────────────────────────────────────

const editInputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  fontSize: 13, fontFamily: 'inherit',
  padding: '4px 6px', border: `1px solid ${theme.colors.border}`,
  borderRadius: 4, outline: 'none', background: theme.colors.bgSubtle,
  color: theme.colors.text,
};

function EditInput({ label, value, onChange, mono }: { label: string; value: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
      <input value={value} onChange={e => onChange(e.target.value)} style={{ ...editInputStyle, fontFamily: mono ? 'monospace' : 'inherit' }} />
    </div>
  );
}

/**
 * Inline-edit field with a per-client suggestion dropdown. Wraps the
 * AutocompleteInput primitive in the same label-on-top layout as
 * EditInput so the rendered detail page stays visually consistent.
 *
 * Used for Vendor / Sidemark / Description on the item detail page —
 * the three free-text fields that benefit most from autocomplete to
 * prevent the duplicate-misspelling problem Justin hit on mobile
 * (typing a new sidemark with no dropdown → spaces, capitalization,
 * and typos all create separate "values" that filter as different
 * groups). Suggestions come from useAutocomplete(clientSheetId)
 * which is the same per-client Autocomplete_DB the inventory grid's
 * inline-edit cells already use.
 */
function EditAutocomplete({
  label, value, onChange, suggestions, placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suggestions: string[];
  placeholder?: string;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
      <AutocompleteInput
        value={value}
        onChange={onChange}
        suggestions={suggestions}
        placeholder={placeholder}
        allowCustom
        icon={false}
        style={{ fontSize: 13 }}
      />
    </div>
  );
}

function EditSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ ...editInputStyle, cursor: 'pointer' }}>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function EditNumber({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>{label}</div>
      <input type="number" min={0} value={value} onChange={e => onChange(e.target.value)} style={editInputStyle} />
    </div>
  );
}

const ICON_MAP = {
  task: ClipboardList,
  repair: Wrench,
  willcall: Truck,
};

const LABEL_MAP = {
  task: 'Tasks',
  repair: 'Repairs',
  willcall: 'Will Calls',
};

function LinkedRecordButton({ records, type, onNavigate }: {
  records: LinkedRecord[];
  type: 'task' | 'repair' | 'willcall';
  onNavigate?: (type: 'task' | 'repair' | 'willcall', id: string) => void;
}) {
  if (!records.length) return null;
  const Icon = ICON_MAP[type];

  // Single record → standalone detail page in a new tab
  if (records.length === 1) {
    const href = `#${type === 'willcall' ? '/will-calls' : type === 'task' ? '/tasks' : '/repairs'}/${encodeURIComponent(records[0].id)}`;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', fontSize: 12, fontWeight: 500,
          border: `1px solid ${theme.colors.border}`, borderRadius: 8,
          background: '#fff', textDecoration: 'none', fontFamily: 'inherit',
          color: theme.colors.textSecondary, transition: 'all 0.15s',
        }}
        onMouseEnter={e => { e.currentTarget.style.borderColor = theme.colors.orange; e.currentTarget.style.color = theme.colors.orange; }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = theme.colors.border; e.currentTarget.style.color = theme.colors.textSecondary; }}
      >
        <Icon size={14} />
        <span>{records[0].id}</span>
        <ExternalLink size={11} style={{ opacity: 0.5 }} />
      </a>
    );
  }

  // Multiple records → in-app navigation to the filtered list page (no specific open id)
  const label = `${records.length} ${LABEL_MAP[type]}`;
  return (
    <button
      onClick={() => onNavigate?.(type, '')}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '6px 12px', fontSize: 12, fontWeight: 500,
        border: `1px solid ${theme.colors.border}`, borderRadius: 8,
        background: '#fff', cursor: 'pointer', fontFamily: 'inherit',
        color: theme.colors.textSecondary, transition: 'all 0.15s',
      }}
      onMouseEnter={e => { e.currentTarget.style.borderColor = theme.colors.orange; e.currentTarget.style.color = theme.colors.orange; }}
      onMouseLeave={e => { e.currentTarget.style.borderColor = theme.colors.border; e.currentTarget.style.color = theme.colors.textSecondary; }}
    >
      <Icon size={14} />
      <span>{label}</span>
      <ExternalLink size={11} style={{ opacity: 0.5 }} />
    </button>
  );
}

// ─── Status color helper ───────────────────────────────────────────────────────

// ─── Status options ────────────────────────────────────────────────────────────

const STATUS_OPTIONS: InventoryStatus[] = ['Active', 'On Hold', 'Released', 'Transferred'];

export function ItemDetailPanel({
  item, onClose, photosFolderId, shipmentFolderUrl,
  linkedTasks = [], linkedRepairs = [], linkedWillCalls = [],
  onNavigateToRecord,
  onCreateTask, onCreateWillCall, onTransfer, onSplit,
  itemTasks = [], itemRepairs = [], itemWillCalls = [], itemBilling = [],
  userRole, classNames = [], locationNames = [], clientSheetId, onItemUpdated,
  applyItemPatch, mergeItemPatch, clearItemPatch,
  renderAsPage,
}: Props) {
  // Panel frame + resize + backdrop are handled by TabbedDetailPanel now.
  const { isMobile, isTablet } = useIsMobile();
  // Compact viewports (phone + tablet) collapse the inline action footer
  // into a small floating action button so the entity body isn't pinned
  // behind a row of pills that ate ~half the visible screen on iPhone.
  const isCompactViewport = isMobile || isTablet;

  // Per-client autocomplete suggestions for Vendor / Sidemark / Description.
  // Same source the inventory grid's inline-edit cells use; back-fills the
  // gap on the detail page where Justin reported (mobile, editing sidemark)
  // typing produced no dropdown so duplicates and misspellings slipped in.
  const {
    vendors: vendorSuggestions,
    sidemarks: sidemarkSuggestions,
    descriptions: descriptionSuggestions,
    references: referenceSuggestions,
  } = useAutocomplete(clientSheetId);
  const statusCfg: Record<string, { bg: string; color: string }> = {
    Active: { bg: '#F0FDF4', color: '#15803D' },
    Released: { bg: '#EFF6FF', color: '#1D4ED8' },
    'On Hold': { bg: '#FEF3C7', color: '#B45309' },
    Transferred: { bg: '#F3F4F6', color: '#6B7280' },
  };
  const sc = statusCfg[item.status] || statusCfg.Active;

  const hasLinkedRecords = linkedTasks.length > 0 || linkedRepairs.length > 0 || linkedWillCalls.length > 0;

  // (I)(A)(R) item indicators — list pages already compute these from
  // already-loaded tasks/repairs; the detail panel has to fetch on its own
  // because it may open from a deep link or a page that doesn't keep the
  // full task/repair list in scope. Tenant-scoped Supabase read, ~50ms.
  const { inspOpenItems, inspDoneItems, inspFailedItems, asmOpenItems, asmDoneItems, repairOpenItems, repairDoneItems, wcOpenItems, wcDoneItems, dtOpenItems, dtDoneItems, codItems } = useItemIndicators(clientSheetId);

  // Tab badge counts — Photos / Docs / Notes. Drive folder URLs are external
  // links, not uploaded assets, and are intentionally NOT counted here.
  // v2026-05-04 — graph rollup. Counts include photos/notes from every
  // linked entity (tasks, repairs, the item's shipment, and any will calls
  // that contain the item) so the badges match what the user sees inside.
  const itemRollupCtx = useMemo<RollupContext | null>(() => {
    if (!item.itemId) return null;
    const scopes: Array<{ entityType: string; entityId: string }> = [];
    if (item.shipmentNumber) scopes.push({ entityType: 'shipment', entityId: String(item.shipmentNumber) });
    for (const wc of (linkedWillCalls ?? [])) {
      const id = String((wc as { id?: string }).id ?? '');
      if (id) scopes.push({ entityType: 'will_call', entityId: id });
    }
    return {
      tenantId: clientSheetId ?? null,
      itemIds: [item.itemId],
      scopes,
    };
  }, [item.itemId, item.shipmentNumber, linkedWillCalls, clientSheetId]);

  const { photos: itemPhotos } = usePhotoGraphRollup(
    renderAsPage && itemRollupCtx
      ? itemRollupCtx
      : { tenantId: null, itemIds: [], scopes: [], enabled: false }
  );
  const { documents: itemDocs } = useDocuments({
    contextType: 'item',
    contextId: item.itemId ?? '',
    tenantId: clientSheetId ?? null,
    enabled: renderAsPage && !!item.itemId,
  });
  const { notes: itemNotesList } = useNoteGraphRollup(
    renderAsPage && itemRollupCtx
      ? itemRollupCtx
      : { tenantId: null, itemIds: [], scopes: [], enabled: false }
  );
  const photoCount = renderAsPage ? itemPhotos.length : 0;
  const docCount   = renderAsPage ? itemDocs.length   : 0;
  const noteCount  = renderAsPage ? itemNotesList.length : 0;

  // Linked entity ids for the Activity tab — ActivityTimeline interleaves
  // their audit rows so the item's full story (tasks, repairs, will calls,
  // shipment) reads in one feed. Moves/photos/credits/billing/emails come
  // from the timeline's own Supabase enrichment queries.
  const activityRelatedIds = useMemo<string[]>(() => {
    const ids: string[] = [];
    if (item.shipmentNumber) ids.push(item.shipmentNumber);
    for (const t of itemTasks) if (t.taskId) ids.push(t.taskId);
    for (const r of itemRepairs) if (r.repairId) ids.push(r.repairId);
    for (const w of itemWillCalls) if (w.wcNumber) ids.push(w.wcNumber);
    return ids;
  }, [item.shipmentNumber, itemTasks, itemRepairs, itemWillCalls]);

  // Can this user edit?
  const canEditBasic = !!clientSheetId; // all roles can edit basic fields
  const canEditStaff = canEditBasic && (userRole === 'admin' || userRole === 'staff');

  // Repair quote state
  const [repairRequested, setRepairRequested] = useState(false);
  const [repairRequesting, setRepairRequesting] = useState(false);

  // Find active (non-completed/cancelled) repair for this item
  const activeRepair = useMemo(() => {
    return itemRepairs.find((r: any) => {
      const s = String(r.status || '').trim();
      return s === 'Pending Quote' || s === 'Quote Sent' || s === 'Approved';
    });
  }, [itemRepairs]);

  const repairStatus = activeRepair ? String(activeRepair.status || '').trim()
    : repairRequested ? 'Pending Quote'
    : null;

  const requestRepairQuoteBackend = useFeatureFlag('requestRepairQuote');
  // COD Storage gate — resolved against this item's tenant (clientSheetId).
  const codFlagRow = useFeatureFlagRow('codStorageBilling');
  const codStorageEnabled = !!codFlagRow && resolveFlagBackend(codFlagRow, clientSheetId || null) === 'supabase';
  const handleRequestRepair = useCallback(async () => {
    if (!isApiConfigured() || !clientSheetId || !item.itemId) return;
    setRepairRequesting(true);
    try {
      // [MIGRATION-P3] Route via requestRepairQuote flag. SB path creates
      // ONE repair with this single item; legacy GAS path also creates
      // one repair. Same end-state.
      if (requestRepairQuoteBackend === 'supabase') {
        const resp = await postRequestRepairQuoteSb({
          tenantId: clientSheetId,
          itemIds:  [item.itemId],
        });
        if (resp.ok) { setRepairRequested(true); onItemUpdated?.(); }
      } else {
        const resp = await postRequestRepairQuote({ itemId: item.itemId }, clientSheetId);
        if (resp.ok && resp.data?.success) { setRepairRequested(true); onItemUpdated?.(); }
      }
    } catch (_) {}
    setRepairRequesting(false);
  }, [clientSheetId, item.itemId, onItemUpdated, requestRepairQuoteBackend]);

  // ─── Add-on services (OVER300, NO_ID, etc.) — live toggles ───────────────
  // Checked state derives from itemBilling: an unbilled row with svcCode matching
  // an addon code = checked. Already-billed rows show the addon as checked + locked.
  // Optimistic local overrides bridge the gap between click and data refetch.
  const { addons: catalogAddons } = useReceivingAddons();
  const canEditAddons = userRole === 'admin' || userRole === 'staff';
  const [addonPending, setAddonPending] = useState<Record<string, 'adding' | 'removing'>>({});
  const [addonOverrides, setAddonOverrides] = useState<Record<string, boolean>>({}); // optimistic overrides; cleared on refetch
  const [addonError, setAddonError] = useState<string | null>(null);

  // Checked state + lock state per addon, derived from itemBilling
  const addonStatus = useMemo(() => {
    const out: Record<string, { checked: boolean; locked: boolean; lockedStatus?: string; ledgerRowId?: string }> = {};
    for (const a of catalogAddons) {
      let row: any = null;
      for (const b of itemBilling) {
        if (String(b.svcCode || '').trim() === a.code) { row = b; break; }
      }
      const status = row ? String(row.status || '').trim() : '';
      const baseChecked = !!row;
      const override = addonOverrides[a.code];
      out[a.code] = {
        checked: override !== undefined ? override : baseChecked,
        locked: !!row && status !== 'Unbilled',
        lockedStatus: status || undefined,
        ledgerRowId: row?.ledgerRowId,
      };
    }
    return out;
  }, [catalogAddons, itemBilling, addonOverrides]);

  // Clear optimistic overrides when the underlying billing data refreshes
  useEffect(() => { setAddonOverrides({}); }, [itemBilling]);

  const toggleAddonLive = useCallback(async (code: string) => {
    if (!canEditAddons) return;
    if (!isApiConfigured() || !clientSheetId || !item.itemId) return;
    const s = addonStatus[code];
    if (!s || s.locked) {
      setAddonError(`Cannot change — already ${s?.lockedStatus || 'invoiced'}`);
      setTimeout(() => setAddonError(null), 3000);
      return;
    }
    setAddonError(null);
    const nextChecked = !s.checked;
    setAddonOverrides(prev => ({ ...prev, [code]: nextChecked }));
    setAddonPending(prev => ({ ...prev, [code]: nextChecked ? 'adding' : 'removing' }));
    try {
      const resp = nextChecked
        ? await postAddItemAddon({ itemId: item.itemId, serviceCode: code }, clientSheetId)
        : await postRemoveItemAddon({ itemId: item.itemId, serviceCode: code }, clientSheetId);
      if (!resp.ok || !resp.data?.success) {
        // rollback
        setAddonOverrides(prev => { const n = { ...prev }; delete n[code]; return n; });
        const msg = resp.data?.error || resp.error || 'Failed to update add-on';
        setAddonError(msg);
        setTimeout(() => setAddonError(null), 3500);
      } else {
        onItemUpdated?.();
      }
    } catch (err) {
      setAddonOverrides(prev => { const n = { ...prev }; delete n[code]; return n; });
      setAddonError(err instanceof Error ? err.message : String(err));
      setTimeout(() => setAddonError(null), 3500);
    } finally {
      setAddonPending(prev => { const n = { ...prev }; delete n[code]; return n; });
    }
  }, [canEditAddons, clientSheetId, item.itemId, addonStatus, onItemUpdated]);

  // ─── Edit/Save mode ───────────────────────────────────────────────────────
  interface DraftFields {
    vendor: string; description: string; reference: string; sidemark: string; room: string;
    location: string; itemClass: string; qty: string; status: string; itemNotes: string;
  }
  const makeDraft = useCallback((): DraftFields => ({
    vendor: item.vendor || '',
    description: item.description || '',
    reference: item.reference || item.poNumber || '',
    sidemark: item.sidemark || '',
    room: item.room || '',
    location: item.location || '',
    itemClass: item.itemClass || '',
    qty: String(item.qty ?? 1),
    status: item.status || 'Active',
    itemNotes: item.itemNotes || item.notes || '',
  }), [item]);

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<DraftFields>(makeDraft);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  // Optimistic overrides — shown after save until next refetch brings fresh data
  const [optimistic, setOptimistic] = useState<Partial<DraftFields> | null>(null);

  const setDraftField = useCallback((field: keyof DraftFields, value: string) => {
    setDraft(prev => ({ ...prev, [field]: value }));
  }, []);

  const handleEditStart = useCallback(() => {
    setDraft(makeDraft());
    setSaveError(null);
    setSaveSuccess(false);
    setIsEditing(true);
  }, [makeDraft]);

  const handleEditCancel = useCallback(() => {
    setIsEditing(false);
    setSaveError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!clientSheetId) return;
    const original = makeDraft();
    // Build payload of only changed fields
    const payload: Record<string, unknown> = { itemId: item.itemId };
    let hasChanges = false;
    // Basic fields (all roles)
    for (const key of ['vendor', 'description', 'reference', 'sidemark', 'room'] as const) {
      if (draft[key].trim() !== original[key]) { payload[key] = draft[key].trim(); hasChanges = true; }
    }
    // Staff/admin fields
    if (canEditStaff) {
      if (draft.location !== original.location) { payload.location = draft.location; hasChanges = true; }
      if (draft.itemClass !== original.itemClass) { payload.itemClass = draft.itemClass; hasChanges = true; }
      const qtyNum = Number(draft.qty);
      if (!isNaN(qtyNum) && qtyNum >= 0 && String(qtyNum) !== original.qty) { payload.qty = qtyNum; hasChanges = true; }
      if (draft.status !== original.status) { payload.status = draft.status; hasChanges = true; }
      if (draft.itemNotes.trim() !== original.itemNotes) { payload.itemNotes = draft.itemNotes.trim(); hasChanges = true; }
    }
    if (!hasChanges) { setIsEditing(false); return; }

    // Phase 2C: patch table row immediately (merge — accumulates fields across saves)
    const patchData: Partial<InventoryItem> = {};
    for (const [k, v] of Object.entries(payload)) {
      if (k !== 'itemId') (patchData as any)[k] = v;
    }
    mergeItemPatch?.(item.itemId, patchData);

    setSaving(true);
    setSaveError(null);
    try {
      const res = await postUpdateInventoryItem(payload as any, clientSheetId);
      if (res.ok) {
        // Store optimistic overrides so UI shows saved values despite cache
        const overrides: Partial<DraftFields> = {};
        for (const key of Object.keys(payload)) {
          if (key !== 'itemId') (overrides as any)[key] = String(payload[key]);
        }
        setOptimistic(overrides);
        setSaveSuccess(true);
        setIsEditing(false);
        onItemUpdated?.();
        setTimeout(() => setSaveSuccess(false), 3000);
        // Tell every other consumer of inventory data that this row just
        // changed. Without this, the Inventory list page shows stale values
        // until either the next manual refresh or the realtime echo (which
        // can lag a few seconds behind the GAS write — easy to navigate
        // back before it lands). Mirrors the InlineEditableCell save path.
        entityEvents.emit('inventory', item.itemId);
        // Note: do NOT clearItemPatch on success — patch stays until 120s TTL expires
        // (patch value == server value, so no visual difference when it expires)
      } else {
        clearItemPatch?.(item.itemId); // rollback table row patch
        setSaveError(res.data?.error || 'Save failed');
      }
    } catch {
      clearItemPatch?.(item.itemId); // rollback table row patch
      setSaveError('Network error — please try again');
    }
    setSaving(false);
  }, [clientSheetId, item.itemId, draft, makeDraft, canEditStaff, onItemUpdated, mergeItemPatch, clearItemPatch]);

  // Clear optimistic overrides when item prop changes (fresh data arrived)
  const itemIdRef = useRef(item.itemId);
  useEffect(() => {
    if (item.itemId !== itemIdRef.current) {
      itemIdRef.current = item.itemId;
      setOptimistic(null);
      setIsEditing(false);
    }
  }, [item.itemId]);

  // Display value helper: optimistic override > item prop
  const dv = useCallback((field: keyof DraftFields, fallback?: string) => {
    if (optimistic && optimistic[field] !== undefined) return optimistic[field]!;
    if (field === 'itemNotes') return item.itemNotes || item.notes || fallback || '';
    if (field === 'reference') return item.reference || item.poNumber || fallback || '';
    return (item as any)[field] || fallback || '';
  }, [item, optimistic]);

  // Folder URLs from linked entity records
  const taskFolderUrls: { label: string; url: string }[] = itemTasks
    .filter(t => t.taskFolderUrl)
    .map(t => ({ label: t.taskId || 'Task Folder', url: t.taskFolderUrl }));
  const repairFolderUrls: { label: string; url: string }[] = itemRepairs
    .filter(r => r.repairFolderUrl)
    .map(r => ({ label: r.repairId || 'Repair Folder', url: r.repairFolderUrl }));
  const wcFolderUrls: { label: string; url: string }[] = itemWillCalls
    .filter(w => w.wcFolderUrl)
    .map(w => ({ label: w.wcNumber || 'WC Folder', url: w.wcFolderUrl }));
  const entityFolderButtons = [...taskFolderUrls, ...repairFolderUrls, ...wcFolderUrls];

  // Page mode: all drive folders (shipment + photos + entity folders) rendered
  // in the Photos / Docs tab as Google-Drive-style rows. State-aware — each
  // entry only included when its URL actually exists.
  const pageDriveFolders: DriveFolderLink[] = [
    ...(shipmentFolderUrl ? [{ label: `Shipment ${item.shipmentNumber || 'Folder'}`, url: shipmentFolderUrl }] : []),
    ...entityFolderButtons,
  ];

  // ── Tab render functions ────────────────────────────────────────────────
  // Each render function is a plain fragment — ALL existing state,
  // handlers, and computed values from above are captured in-closure so
  // behavior is identical to the pre-refactor panel. Only the OUTER frame
  // + section grouping changes.

  const renderDetailsTab = () => (
    <>
      {/* Item Info */}
      <Section icon={Package} title="Item Details">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 16px' }}>
          {isEditing ? (
            <>
              <EditAutocomplete label="Vendor" value={draft.vendor} onChange={v => setDraftField('vendor', v)} suggestions={vendorSuggestions} placeholder="Type vendor..." />
              {canEditStaff ? (
                <EditSelect label="Class" value={draft.itemClass} options={classNames.length > 0 ? classNames : [draft.itemClass || '']} onChange={v => setDraftField('itemClass', v)} />
              ) : (
                <Field label="Class" value={dv('itemClass')} />
              )}
              {canEditStaff ? (
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 2 }}>Location</div>
                  <AutocompleteInput value={draft.location} onChange={v => setDraftField('location', v)} suggestions={locationNames} placeholder="Type location..." allowCustom icon={false} style={{ fontSize: 13 }} />
                </div>
              ) : (
                <Field label="Location" value={dv('location')} mono />
              )}
              {canEditStaff ? (
                <EditNumber label="Qty" value={draft.qty} onChange={v => setDraftField('qty', v)} />
              ) : (
                <Field label="Qty" value={dv('qty')} />
              )}
              <EditAutocomplete label="Sidemark" value={draft.sidemark} onChange={v => setDraftField('sidemark', v)} suggestions={sidemarkSuggestions} placeholder="Type sidemark..." />
              <EditInput label="Room" value={draft.room} onChange={v => setDraftField('room', v)} />
            </>
          ) : (
            <>
              <Field label="Vendor" value={dv('vendor')} />
              <Field label="Class" value={dv('itemClass')} />
              <Field label="Location" value={dv('location')} mono />
              <Field label="Qty" value={dv('qty')} />
              <Field label="Sidemark" value={dv('sidemark')} />
              <Field label="Room" value={dv('room')} />
            </>
          )}
          <Field label="Receive Date" value={fmtDate(item.receiveDate)} />
          <Field label="Release Date" value={fmtDate(item.releaseDate)} />
        </div>

        <div style={{ marginTop: 4 }}>
          {isEditing ? (
            <>
              <EditAutocomplete label="Description" value={draft.description} onChange={v => setDraftField('description', v)} suggestions={descriptionSuggestions} placeholder="Type description..." />
              <EditAutocomplete label="Reference" value={draft.reference} onChange={v => setDraftField('reference', v)} suggestions={referenceSuggestions} placeholder="Type reference..." />
            </>
          ) : (
            <>
              <Field label="Description" value={dv('description')} />
              <Field label="Reference" value={dv('reference')} />
            </>
          )}
        </div>
      </Section>

      {/* Item Notes — single-text field (distinct from threaded Notes tab) */}
      <Section icon={AlertCircle} title="Item Notes">
        {isEditing && canEditStaff ? (
          <textarea value={draft.itemNotes} onChange={e => setDraftField('itemNotes', e.target.value)} rows={3}
            style={{ ...editInputStyle, resize: 'vertical' }} />
        ) : (
          <LinkifiedText
            text={dv('itemNotes') || ''}
            fontSize={13}
            color={dv('itemNotes') ? theme.colors.text : theme.colors.textMuted}
          />
        )}
      </Section>

      {/* Threaded Notes preview — entity_notes for this item, surfaced
          inline so clients see new notes without tab-switching. Composer
          + full thread live in the Notes tab. */}
      <EntityNotesInline
        entityType="inventory"
        entityId={item.itemId}
        itemId={item.itemId}
        tenantId={clientSheetId ?? null}
      />

      {/* Add-on Services */}
      {catalogAddons.length > 0 && (
        <Section icon={Plus} title="Add-on Services" count={catalogAddons.filter(a => addonStatus[a.code]?.checked).length || undefined}>
          {addonError && (
            <div role="alert" style={{ fontSize: 11, color: '#92400E', background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 6, padding: '6px 10px', marginBottom: 8 }}>
              {addonError}
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {catalogAddons.map(a => {
              const s = addonStatus[a.code] || { checked: false, locked: false };
              const rate = a.rateForClass(item.itemClass || '');
              const pending = addonPending[a.code];
              const disabled = !canEditAddons || !!pending || s.locked;
              return (
                <label
                  key={a.code}
                  onClick={e => { if (disabled) return; e.preventDefault(); toggleAddonLive(a.code); }}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '6px 10px', borderRadius: 8,
                    border: `1px solid ${s.checked ? theme.colors.orange : theme.colors.borderLight}`,
                    background: s.locked ? '#F3F4F6' : s.checked ? '#FFF7F0' : '#fff',
                    cursor: disabled ? 'default' : 'pointer',
                    fontSize: 12, userSelect: 'none',
                    opacity: pending ? 0.6 : 1,
                  }}
                  title={s.locked ? `Locked — already ${s.lockedStatus}` : !canEditAddons ? 'View only' : 'Click to toggle'}
                >
                  <input type="checkbox" checked={s.checked} readOnly disabled={disabled} style={{ accentColor: theme.colors.orange, cursor: disabled ? 'default' : 'pointer', margin: 0 }} />
                  <span style={{ fontWeight: 600, color: theme.colors.text }}>{a.name}</span>
                  <span style={{ color: theme.colors.textMuted, fontSize: 11 }}>
                    {rate > 0 ? `$${rate.toFixed(2)}` : (item.itemClass ? 'no rate' : 'set class')}
                  </span>
                  {pending && <Loader2 size={11} style={{ animation: 'spin 1s linear infinite', color: theme.colors.orange }} />}
                  {s.locked && (
                    <span style={{ fontSize: 9, fontWeight: 700, background: '#E5E7EB', color: '#4B5563', padding: '1px 5px', borderRadius: 6, textTransform: 'uppercase' }}>
                      {s.lockedStatus}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </Section>
      )}

      {/* COD Storage (feature-gated: end customers pay storage) */}
      {codStorageEnabled && (
        <ItemCodStorageSection
          item={item}
          clientSheetId={clientSheetId}
          canEdit={!!canEditStaff}
          applyItemPatch={applyItemPatch}
          clearItemPatch={clearItemPatch}
        />
      )}

      {/* Related — panel mode only. In page mode the Activity tab already
          shows linked tasks/repairs/WCs with richer context (status, dates,
          audit trail), and drive folders have moved to the Photos/Docs tabs.
          Rendering this section in page mode would duplicate both, so it's
          suppressed there. */}
      {!renderAsPage && (
        <Section icon={FileText} title="Related" count={linkedTasks.length + linkedRepairs.length + linkedWillCalls.length || undefined}>
          {/* Shipment Folder removed from the Details/Related body — it
              already appears under Photos/Docs → Legacy Folders. The
              item-photos folder link stays here because it's the only way
              to reach the legacy Drive photos for this specific item from
              outside the Photos tab. */}
          {photosFolderId && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              <FolderButton label="Photos" url={`https://drive.google.com/drive/folders/${photosFolderId}`} icon={FolderOpen} />
            </div>
          )}

          {entityFolderButtons.length > 0 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
              {entityFolderButtons.map(({ label, url }) => (
                <FolderButton key={label} label={label} url={url} icon={ExternalLink} />
              ))}
            </div>
          )}

          {hasLinkedRecords ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <LinkedRecordButton records={linkedTasks} type="task" onNavigate={onNavigateToRecord} />
              <LinkedRecordButton records={linkedRepairs} type="repair" onNavigate={onNavigateToRecord} />
              <LinkedRecordButton records={linkedWillCalls} type="willcall" onNavigate={onNavigateToRecord} />
            </div>
          ) : !item.shipmentNumber && !shipmentFolderUrl && entityFolderButtons.length === 0 ? (
            <div style={{ fontSize: 12, color: theme.colors.textMuted, padding: '4px 0', fontStyle: 'italic' }}>
              No linked tasks, repairs, or will calls found for this item.
            </div>
          ) : null}
        </Section>
      )}
    </>
  );

  const renderCoverageTab = () => (
    <ItemCoverageTab
      item={item}
      canEdit={!!canEditStaff}
      optimistic={optimistic as any}
      applyItemPatch={applyItemPatch}
      clearItemPatch={clearItemPatch}
    />
  );

  const renderActivityTab = () => (
    <>
      <Section icon={Calendar} title="Item History">
        <ActivityTimeline
          entityType="inventory"
          entityId={item.itemId}
          tenantId={clientSheetId}
          relatedEntityIds={activityRelatedIds}
        />
      </Section>
      {/* admin/staff only — mirrors the storage_credits RLS read policy.
          Clients would otherwise get an RLS-empty list rendered as a
          misleading "no credits" message. */}
      {clientSheetId && item.itemId && (userRole === 'admin' || userRole === 'staff') && (
        <Section icon={BadgePercent} title="Storage Credits">
          <StorageCreditsSection
            tenantId={clientSheetId}
            itemId={item.itemId}
            isAdmin={userRole === 'admin'}
          />
        </Section>
      )}
    </>
  );

  // ── Header components: status pill + Actions dropdown ──────────────────

  const headerStatusBadge = isEditing && canEditStaff ? (
    <select value={draft.status} onChange={e => setDraftField('status', e.target.value)}
      style={{ fontSize: 11, padding: '2px 8px', borderRadius: 12, border: `1px solid ${theme.colors.border}`, fontWeight: 600, background: theme.colors.bgSubtle, cursor: 'pointer' }}>
      {STATUS_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  ) : (
    <Badge t={isEditing ? draft.status : (dv('status') || item.status)} bg={sc.bg} color={sc.color} />
  );

  const headerActions = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <ItemActionsMenu
        onCreateTask={onCreateTask}
        onCreateWillCall={onCreateWillCall}
        onTransfer={onTransfer}
        onSplit={(Number(item?.qty) || 0) > 1 && onSplit ? onSplit : undefined}
        onRequestRepair={handleRequestRepair}
        repairStatus={repairStatus ?? undefined}
        repairRequesting={repairRequesting}
        variant={renderAsPage ? 'light' : 'dark'}
      />
      {!isMobile && !renderAsPage && (
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, borderRadius: 6, color: 'rgba(255,255,255,0.7)' }}>
          <X size={18} />
        </button>
      )}
    </div>
  );

  const statusStrip = (saveError || saveSuccess) ? (
    <>
      {saveError && (
        <div style={{ padding: '6px 20px', background: '#FEF2F2', color: '#DC2626', fontSize: 12, fontWeight: 500, borderBottom: `1px solid #FECACA` }}>
          {saveError}
        </div>
      )}
      {saveSuccess && (
        <div style={{ padding: '6px 20px', background: '#F0FDF4', color: '#15803D', fontSize: 12, fontWeight: 500, borderBottom: `1px solid #BBF7D0` }}>
          Changes saved successfully
        </div>
      )}
    </>
  ) : null;

  const footer = (canEditBasic || isEditing) ? (
    <div style={{
      padding: '10px 20px',
      background: '#FAFAFA',
      display: 'flex', gap: 8, alignItems: 'center',
    }}>
      {isEditing ? (
        <>
          <button onClick={handleSave} disabled={saving}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 14px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', background: theme.colors.orange, color: '#fff', cursor: saving ? 'wait' : 'pointer' }}>
            {saving ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={12} />}
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={handleEditCancel} disabled={saving}
            style={{ padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: `1px solid ${theme.colors.border}`, background: '#fff', color: theme.colors.textSecondary, cursor: 'pointer' }}>
            Cancel
          </button>
        </>
      ) : canEditBasic ? (
        <button onClick={handleEditStart}
          style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '6px 12px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: `1px solid ${theme.colors.border}`, background: '#fff', color: theme.colors.textSecondary, cursor: 'pointer' }}>
          <Pencil size={12} /> Edit
        </button>
      ) : null}
    </div>
  ) : null;

  const mobileFooter = (() => {
    const btnBase: React.CSSProperties = {
      flex: 1, padding: '14px 0', fontSize: 15, fontWeight: 600,
      borderRadius: 10, border: 'none', cursor: saving ? 'wait' : 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    };
    if (isEditing) {
      return (
        <div style={{ padding: '12px 16px', display: 'flex', gap: 10, paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + 12px)` }}>
          <button onClick={handleSave} disabled={saving} style={{ ...btnBase, background: theme.colors.orange, color: '#fff' }}>
            {saving ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={16} />}
            {saving ? 'Saving...' : 'Save'}
          </button>
          <button onClick={handleEditCancel} disabled={saving} style={{ ...btnBase, flex: '0 0 auto', padding: '14px 20px', background: '#F1F5F9', color: '#475569' }}>
            Cancel
          </button>
        </div>
      );
    }
    if (canEditBasic) {
      return (
        <div style={{ padding: '12px 16px', paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + 12px)` }}>
          <button onClick={handleEditStart} style={{ ...btnBase, flex: 1, width: '100%', background: '#F1F5F9', color: '#1E293B' }}>
            <Pencil size={16} /> Edit
          </button>
        </div>
      );
    }
    return null;
  })();

  // Custom tabs listed in the order we want them to appear. Built-in tabs
  // (Photos/Docs/Notes/Activity) are appended by the shell after any custom
  // tab NOT matching their id. We interleave by listing the custom tabs with
  // the ids the built-ins register, so the final order is:
  //   Details, Photos, Docs, Notes, Coverage, Activity
  // (Details → custom; Photos/Docs/Notes → built-in; Coverage → custom;
  //  Activity → built-in with render escape hatch.)
  const customTabs: TabbedDetailPanelTab[] = [
    {
      id: 'details',
      label: 'Details',
      icon: <ClipboardList size={13} />,
      keepMounted: true, // preserve edit-input focus across tab switches
      render: () => renderDetailsTab(),
    },
    // Built-ins (photos/docs/notes) will be inserted by the shell here since
    // they aren't in `customTabs` — they append after the customs that match
    // NO built-in id. To force Coverage to sit AFTER the built-ins, we
    // declare it AFTER registering built-ins. The shell's order logic keeps
    // customs in array order and appends un-referenced built-ins; so to
    // achieve the desired final order we instead list ALL tabs manually
    // here and disable `builtInTabs`.
    {
      id: 'photos',
      label: 'Photos',
      icon: <ImageIcon size={13} />,
      badgeCount: photoCount,
      render: () => (
        <PhotosPanelProxy
          item={item}
          clientSheetId={clientSheetId}
          driveFolders={renderAsPage ? pageDriveFolders : undefined}
          itemTasks={linkedTasks}
          itemRepairs={linkedRepairs}
          itemWillCalls={linkedWillCalls}
          shipmentNumber={item.shipmentNumber}
          rollupCtx={itemRollupCtx}
        />
      ),
    },
    {
      id: 'docs',
      label: 'Docs',
      icon: <FileText size={13} />,
      badgeCount: docCount,
      render: () => (
        <DocsPanelProxy
          itemId={item.itemId}
          clientSheetId={clientSheetId}
          driveFolders={renderAsPage ? pageDriveFolders : undefined}
        />
      ),
    },
    {
      id: 'notes',
      label: 'Notes',
      icon: <StickyNote size={13} />,
      badgeCount: noteCount,
      render: () => <NotesPanelProxy
        itemId={item.itemId}
        itemTasks={itemTasks}
        itemRepairs={itemRepairs}
        itemWillCalls={itemWillCalls}
        shipmentNumber={item.shipmentNumber}
        itemNotesText={item.itemNotes || item.notes}
        tenantId={clientSheetId ?? null}
        rollupCtx={itemRollupCtx}
      />,
    },
    {
      id: 'coverage',
      label: 'Coverage',
      icon: <Shield size={13} />,
      render: () => renderCoverageTab(),
    },
    {
      id: 'activity',
      label: 'Activity',
      icon: <Activity size={13} />,
      badgeCount: undefined,
      render: () => renderActivityTab(),
    },
  ];

  // Page-mode footer: state-aware quick-action pills.
  // Dark secondary pills (Create Task / Repair Quote / Add to WC / Transfer),
  // orange primary pill on right (Edit or Save+Cancel when editing).
  // On mobile, pills shrink (smaller padding, font, min-width) so fewer rows
  // of the fixed footer wrap and the item body has less scroll obstruction.
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
  const darkPill: React.CSSProperties = { ...pagePillBase, background: '#1C1C1C', color: '#fff' };
  const orangePill: React.CSSProperties = { ...pagePillBase, background: theme.colors.orange, color: '#fff' };
  const lightPill: React.CSSProperties = { ...pagePillBase, background: '#fff', color: theme.colors.text, border: `1px solid ${theme.colors.border}` };

  // FAB action set mirrors the desktop pill row. Used on compact
  // viewports where the inline footer is suppressed below.
  // Split shows only when the item is currently grouped (qty > 1). Once
  // a split is applied the parent qty drops to keep_qty and the button
  // disappears (or stays if keep_qty > 1, which is intentional — staff
  // may want to split off more later).
  const canSplit = !!onSplit && (Number(item?.qty) || 0) > 1;

  // Add Charge — one modal backs both the desktop footer pill and the mobile
  // FAB action below (admin+staff only; clients get canAdd=false).
  const addCharge = useAddCharge({
    tenantId: clientSheetId ?? '',
    entityType: 'item',
    entityId: String(item.itemId),
    itemId: String(item.itemId),
    itemClass: item.itemClass ?? null,
    sidemark: item.sidemark ?? null,
  });

  const fabActions: FABAction[] = isEditing ? [] : [
    ...(onCreateTask ? [{ label: 'Create Task', icon: <ClipboardList size={16} />, onClick: onCreateTask }] : []),
    ...(!repairStatus ? [{ label: repairRequesting ? 'Requesting…' : 'Repair Quote', icon: <Wrench size={16} />, onClick: () => void handleRequestRepair() }] : []),
    ...(onCreateWillCall ? [{ label: 'Add to WC', icon: <Truck size={16} />, onClick: onCreateWillCall }] : []),
    ...(addCharge.canAdd ? [{ label: 'Add Charge', icon: <DollarSign size={16} />, onClick: addCharge.open }] : []),
    ...(canSplit && onSplit ? [{ label: 'Split', icon: <SplitIcon size={16} />, onClick: onSplit }] : []),
    ...(onTransfer ? [{ label: 'Transfer', icon: <ExternalLink size={16} />, onClick: onTransfer }] : []),
    ...(canEditBasic ? [{ label: 'Edit', icon: <Pencil size={16} />, onClick: handleEditStart, color: theme.colors.orange }] : []),
  ];

  const pageFooter = isEditing ? (
    // Editing mode keeps the inline Cancel + Save row even on compact
    // viewports — only two buttons, easy to reach, and a FAB for "save"
    // is awkward UX while the form is dirty.
    <>
      <button onClick={handleEditCancel} disabled={saving} style={lightPill}>Cancel</button>
      <button onClick={handleSave} disabled={saving} style={orangePill}>
        {saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />}
        {saving ? 'Saving…' : 'Save'}
      </button>
    </>
  ) : isCompactViewport ? null : (
    <>
      {onCreateTask && (
        <button onClick={onCreateTask} style={darkPill}>
          <ClipboardList size={13} /> Create Task
        </button>
      )}
      {!repairStatus ? (
        <button onClick={() => void handleRequestRepair()} disabled={repairRequesting} style={darkPill}>
          <Wrench size={13} /> {repairRequesting ? 'Requesting…' : 'Repair Quote'}
        </button>
      ) : null}
      {onCreateWillCall && (
        <button onClick={onCreateWillCall} style={darkPill}>
          <Truck size={13} /> Add to WC
        </button>
      )}
      {addCharge.canAdd && (
        <button onClick={addCharge.open} style={darkPill}>
          <DollarSign size={13} /> Add Charge
        </button>
      )}
      {canSplit && onSplit && (
        <button onClick={onSplit} style={darkPill}>
          <SplitIcon size={13} /> Split
        </button>
      )}
      {onTransfer && (
        <button onClick={onTransfer} style={darkPill}>
          <ExternalLink size={13} /> Transfer
        </button>
      )}
      {canEditBasic && (
        <button onClick={handleEditStart} style={orangePill}>
          <Pencil size={13} /> Edit
        </button>
      )}
    </>
  );

  if (renderAsPage) {
    // Redesign spec: dark tab cards, no sidemark/idBadges chips in header,
    // white sticky footer with quick-action pills. All tabs + state + handlers
    // shared with panel mode.
    return (
      <>
        <EntityPage
          entityLabel="Inventory"
          entityId={item.itemId}
          clientName={item.clientName}
          statusBadge={headerStatusBadge}
          headerActions={headerActions}
          // Direct-link fallback when there's no SPA history to pop — without
          // this, useGoBack falls back to '/' and dumps the user on the
          // dashboard. `useGoBack` still prefers navigate(-1) when history
          // exists, so this only changes the cold-open behavior.
          backTo="/inventory"
          statusStrip={statusStrip}
          tabs={customTabs as unknown as Parameters<typeof EntityPage>[0]['tabs']}
          initialTabId="details"
          footer={pageFooter}
        />
        <FloatingActionMenu show={isCompactViewport && !isEditing} actions={fabActions} />
        {addCharge.modal}
        <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
      </>
    );
  }

  return (
    <>
      <TabbedDetailPanel
        title={item.itemId}
        clientName={item.clientName}
        sidemark={item.sidemark}
        idBadges={
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
        }
        belowId={headerStatusBadge}
        headerActions={headerActions}
        tabs={customTabs}
        initialTabId="details"
        statusStrip={statusStrip}
        footer={isMobile ? mobileFooter : footer}
        onClose={onClose}
        resizeKey="item"
        defaultWidth={420}
      />
      <style>{`@keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }`}</style>
    </>
  );
}

// ── Local proxy components for built-in tab content ────────────────────────
// These thin wrappers let us compose the shared PhotosPanel / DocumentsPanel
// / NotesPanel (from EntityAttachments.tsx) with item-specific props (e.g.
// cross-entity itemId rollup for Photos, related-entity pills for Notes).
// Imported lazily to keep the main component file from growing wider.

import { PhotosPanel as _PhotosPanel, DocumentsPanel as _DocumentsPanel, NotesPanel as _NotesPanel } from './EntityAttachments';
import { useCoverageOptions, formatCoverageRate, type CoverageOption } from '../../hooks/useCoverageOptions';
import { AutocompleteSelect } from './AutocompleteSelect';
import type { InventoryItem as CoverageItemType } from '../../lib/types';
import { DriveFoldersList, type DriveFolderLink } from './DriveFoldersList';

function PhotosPanelProxy({
  item, clientSheetId, driveFolders, itemTasks, itemRepairs, itemWillCalls, shipmentNumber, rollupCtx,
}: {
  item: any;
  clientSheetId: string | undefined;
  driveFolders?: DriveFolderLink[];
  itemTasks?: LinkedRecord[];
  itemRepairs?: LinkedRecord[];
  itemWillCalls?: LinkedRecord[];
  shipmentNumber?: string;
  rollupCtx?: RollupContext | null;
}) {
  const related = [
    ...(itemTasks ?? []).map(t => ({ type: 'task', id: String(t.id || '') })).filter(r => r.id),
    ...(itemRepairs ?? []).map(r => ({ type: 'repair', id: String(r.id || '') })).filter(r => r.id),
    ...(itemWillCalls ?? []).map(w => ({ type: 'will_call', id: String(w.id || '') })).filter(r => r.id),
    ...(shipmentNumber ? [{ type: 'shipment', id: String(shipmentNumber) }] : []),
  ];
  return (
    <div>
      <_PhotosPanel
        entityType="inventory"
        entityId={item.itemId}
        itemId={item.itemId}
        tenantId={clientSheetId}
        enableSourceFilter
        relatedEntities={related}
        rollupCtx={rollupCtx}
      />
      {driveFolders && <DriveFoldersList folders={driveFolders} />}
    </div>
  );
}

function DocsPanelProxy({ itemId, clientSheetId, driveFolders }: { itemId: string; clientSheetId: string | undefined; driveFolders?: DriveFolderLink[] }) {
  return (
    <div>
      <_DocumentsPanel
        contextType="item"
        contextId={itemId}
        tenantId={clientSheetId}
      />
      {driveFolders && <DriveFoldersList folders={driveFolders} />}
    </div>
  );
}

function NotesPanelProxy({
  itemId, itemTasks, itemRepairs, itemWillCalls, shipmentNumber, itemNotesText, tenantId, rollupCtx,
}: {
  itemId: string;
  itemTasks: any[];
  itemRepairs: any[];
  itemWillCalls: any[];
  shipmentNumber?: string;
  itemNotesText?: string | null;
  tenantId?: string | null;
  rollupCtx?: RollupContext | null;
}) {
  const related = [
    ...itemTasks.map((t: any) => ({ type: 'task', id: String(t.taskId || ''), label: `Task ${t.taskId}` })).filter(r => r.id),
    ...itemRepairs.map((r: any) => ({ type: 'repair', id: String(r.repairId || ''), label: `Repair ${r.repairId}` })).filter(r => r.id),
    ...itemWillCalls.map((w: any) => ({ type: 'will_call', id: String(w.wcNumber || ''), label: `WC ${w.wcNumber}` })).filter(r => r.id),
    ...(shipmentNumber ? [{ type: 'shipment', id: String(shipmentNumber), label: `Shipment ${shipmentNumber}` }] : []),
  ];
  return (
    <_NotesPanel
      entityType="inventory"
      entityId={itemId}
      relatedEntities={related}
      enableSourceFilter
      itemId={itemId}
      tenantId={tenantId}
      rollupCtx={rollupCtx}
      pinnedNote={{ label: 'Item Notes', text: itemNotesText }}
    />
  );
}

// ── Actions dropdown (Quick Actions moved into header per mockup) ──────────

function ItemActionsMenu({
  onCreateTask, onCreateWillCall, onTransfer, onSplit, onRequestRepair,
  repairStatus, repairRequesting, variant = 'dark',
}: {
  onCreateTask?: () => void;
  onCreateWillCall?: () => void;
  onTransfer?: () => void;
  /** Optional split action — only rendered when supplied (caller hides it
   *  when item.qty <= 1 so we don't get a "Split" entry that fails). */
  onSplit?: () => void;
  onRequestRepair: () => Promise<void>;
  repairStatus?: string;
  repairRequesting: boolean;
  /** 'dark' for slide-out panel (dark header); 'light' for full-page mode (light header). */
  variant?: 'dark' | 'light';
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const itemStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    width: '100%', padding: '8px 12px', fontSize: 12,
    fontWeight: 500, color: theme.colors.text,
    background: 'none', border: 'none', cursor: 'pointer',
    textAlign: 'left', fontFamily: 'inherit',
  };

  const handle = (fn?: () => void) => () => { setOpen(false); fn?.(); };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '6px 12px', fontSize: 12, fontWeight: 600,
          borderRadius: 8,
          border: variant === 'light'
            ? `1px solid ${theme.colors.border}`
            : '1px solid rgba(255,255,255,0.25)',
          background: variant === 'light'
            ? theme.colors.bgCard
            : 'rgba(255,255,255,0.12)',
          color: variant === 'light' ? theme.colors.text : '#fff',
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        <Plus size={13} /> Actions <ChevronDown size={12} />
      </button>
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 6px)',
          background: '#fff', border: `1px solid ${theme.colors.border}`,
          borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          minWidth: 180, zIndex: 150, padding: '4px 0',
        }}>
          {onCreateTask && (
            <button style={itemStyle} onClick={handle(onCreateTask)}>
              <ClipboardList size={13} color={theme.colors.orange} /> Create Task
            </button>
          )}
          {!repairStatus ? (
            <button style={itemStyle} onClick={() => { setOpen(false); void onRequestRepair(); }}>
              <Wrench size={13} color={theme.colors.orange} />
              {repairRequesting ? 'Requesting…' : 'Request Repair Quote'}
            </button>
          ) : (
            <div style={{ ...itemStyle, cursor: 'default', color: theme.colors.textMuted, fontSize: 11 }}>
              <CheckCircle2 size={13} color="#15803D" />
              Repair: {repairStatus === 'Pending Quote' ? 'Quote Requested' : repairStatus === 'Quote Sent' ? 'Awaiting Response' : repairStatus}
            </div>
          )}
          {onCreateWillCall && (
            <button style={itemStyle} onClick={handle(onCreateWillCall)}>
              <Truck size={13} color={theme.colors.orange} /> Add to Will Call
            </button>
          )}
          {onSplit && (
            <button style={itemStyle} onClick={handle(onSplit)}>
              <SplitIcon size={13} color={theme.colors.orange} /> Split Item
            </button>
          )}
          {onTransfer && (
            <button style={itemStyle} onClick={handle(onTransfer)}>
              <ExternalLink size={13} color={theme.colors.orange} /> Transfer
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Coverage tab (Phase B — data only, no billing write) ───────────────────
//
// Declared value + coverage option picker + computed premium preview. Save
// persists to the Inventory sheet via postUpdateInventoryItem. Phase C will
// add the "Apply Coverage Charge" button + idempotency guard + ledger-based
// lock display on top of this. Until then this tab is a save-and-preview
// surface only — no billing rows are created.
//
// Per-calc_type math:
//   per_lb            → rate × weight (weight not on inventory today; shows
//                       "Weight required" chip and disables Save)
//   percent_declared  → rate% × declaredValue
//   flat              → rate
//   included          → 0

function ItemCoverageTab({
  item, canEdit, optimistic, applyItemPatch, clearItemPatch,
}: {
  item: any;
  canEdit: boolean;
  optimistic: { declaredValue?: number | string; coverageOptionId?: string } | null;
  applyItemPatch?: (itemId: string, patch: Partial<CoverageItemType>) => void;
  clearItemPatch?: (itemId: string) => void;
}) {
  const { options, loading: optionsLoading, error: optionsError } = useCoverageOptions();

  // Prefer optimistic override > item prop > defaults
  const currentDeclared = (optimistic?.declaredValue != null)
    ? Number(optimistic.declaredValue)
    : (item.declaredValue != null ? Number(item.declaredValue) : 0);
  const currentOptionId = (optimistic?.coverageOptionId != null)
    ? String(optimistic.coverageOptionId)
    : String(item.coverageOptionId || '');

  const [declaredInput, setDeclaredInput] = useState<string>(
    currentDeclared > 0 ? String(currentDeclared) : ''
  );
  const [optionId, setOptionId] = useState<string>(currentOptionId);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Keep local state in sync if the item prop changes externally
  useEffect(() => {
    setDeclaredInput(currentDeclared > 0 ? String(currentDeclared) : '');
    setOptionId(currentOptionId);
  }, [item.itemId]);  // eslint-disable-line react-hooks/exhaustive-deps

  const activeOptions = useMemo(
    () => options.filter(o => o.active).sort((a, b) => a.displayOrder - b.displayOrder),
    [options]
  );

  const selectedOption: CoverageOption | null = useMemo(
    () => activeOptions.find(o => o.id === optionId) || null,
    [activeOptions, optionId]
  );

  const declaredValueNum = Number(declaredInput) || 0;

  // Compute premium preview
  const premiumInfo = useMemo(() => {
    if (!selectedOption) return { amount: 0, display: '—', disabledReason: 'Pick a coverage option' };
    switch (selectedOption.calcType) {
      case 'percent_declared': {
        const amt = (declaredValueNum * selectedOption.rate) / 100;
        return {
          amount: amt,
          display: `$${amt.toFixed(2)}`,
          disabledReason: declaredValueNum <= 0 ? 'Enter a declared value' : null,
        };
      }
      case 'flat':
        return { amount: selectedOption.rate, display: `$${selectedOption.rate.toFixed(2)}`, disabledReason: null };
      case 'included':
        return { amount: 0, display: 'Included ($0.00)', disabledReason: null };
      case 'per_lb':
        // Per-weight premium requires item weight which isn't on the
        // inventory schema today. Show a clear disabled reason so the user
        // knows this is expected rather than a bug.
        return { amount: 0, display: '—', disabledReason: 'Per-pound coverage requires item weight (not yet tracked)' };
      default:
        return { amount: 0, display: '—', disabledReason: 'Unknown calc type' };
    }
  }, [selectedOption, declaredValueNum]);

  const isDirty = declaredValueNum !== currentDeclared || optionId !== currentOptionId;
  const canSave = canEdit && isDirty && !saving;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    setSaveError(null);
    setSaveSuccess(false);
    setSaving(true);

    // Optimistic patch so the UI reflects instantly
    applyItemPatch?.(item.itemId, {
      declaredValue: declaredValueNum,
      coverageOptionId: optionId,
    } as any);

    try {
      const resp = await postUpdateInventoryItem({
        itemId: item.itemId,
        declaredValue: declaredValueNum,
        coverageOptionId: optionId,
      }, item.clientSheetId || item.clientId);
      if (resp.ok && resp.data?.success) {
        setSaveSuccess(true);
        // Tell every other inventory consumer this row changed (matches
        // the main field-edit save path above). Without this, the list
        // page shows stale coverage/declared-value until manual refresh.
        entityEvents.emit('inventory', item.itemId);
        // Patch stays — 120s TTL will align with next refetch
        setTimeout(() => setSaveSuccess(false), 2500);
      } else {
        clearItemPatch?.(item.itemId);
        setSaveError(resp.error || resp.data?.error || 'Save failed.');
      }
    } catch (err: any) {
      clearItemPatch?.(item.itemId);
      setSaveError(err?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }, [canSave, item.itemId, item.clientSheetId, item.clientId, declaredValueNum, optionId, applyItemPatch, clearItemPatch]);

  // ── Render ──────────────────────────────────────────────────────────

  if (optionsLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 40, color: theme.colors.textMuted, fontSize: 13 }}>
        Loading coverage options…
      </div>
    );
  }
  if (optionsError) {
    return (
      <div style={{ padding: 20, fontSize: 13, color: '#991B1B', background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 10 }}>
        Could not load coverage options: {optionsError}
      </div>
    );
  }

  const inputBaseStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    fontSize: 13,
    border: `1px solid ${theme.colors.border}`,
    borderRadius: 8,
    outline: 'none',
    fontFamily: 'inherit',
    boxSizing: 'border-box',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Intro */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: theme.colors.bgSubtle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Shield size={18} color={theme.colors.orange} />
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: theme.colors.text }}>Item Coverage</div>
          <div style={{ fontSize: 11, color: theme.colors.textMuted }}>
            Declared value + coverage option. Billing action ships in a follow-up.
          </div>
        </div>
      </div>

      {/* Declared value */}
      <div>
        <label style={{ display: 'block', fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
          Declared Value
        </label>
        <div style={{ position: 'relative' }}>
          <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: theme.colors.textMuted, fontSize: 13 }}>$</span>
          <input
            type="number"
            min={0}
            step="0.01"
            value={declaredInput}
            onChange={e => setDeclaredInput(e.target.value)}
            disabled={!canEdit || saving}
            placeholder="0.00"
            style={{ ...inputBaseStyle, paddingLeft: 22 }}
          />
        </div>
      </div>

      {/* Coverage option picker */}
      <div>
        <label style={{ display: 'block', fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
          Coverage Option
        </label>
        <AutocompleteSelect
          options={activeOptions.map(o => ({ value: o.id, label: `${o.name} — ${formatCoverageRate(o)}` }))}
          value={optionId}
          onChange={setOptionId}
          placeholder="Pick a coverage option…"
          disabled={!canEdit || saving}
        />
        {selectedOption?.note && (
          <div style={{ marginTop: 6, fontSize: 11, color: theme.colors.textMuted, fontStyle: 'italic' }}>
            {selectedOption.note}
          </div>
        )}
      </div>

      {/* Premium preview */}
      <div style={{
        padding: '14px 16px',
        background: theme.colors.bgSubtle,
        borderRadius: 12,
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 500, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Computed Premium
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: premiumInfo.disabledReason ? theme.colors.textMuted : theme.colors.text, marginTop: 2 }}>
            {premiumInfo.display}
          </div>
          {premiumInfo.disabledReason && (
            <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 4 }}>
              {premiumInfo.disabledReason}
            </div>
          )}
        </div>
      </div>

      {/* Save row */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          onClick={handleSave}
          disabled={!canSave}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 16px',
            fontSize: 12, fontWeight: 600,
            borderRadius: 8,
            border: 'none',
            background: canSave ? theme.colors.orange : theme.colors.bgSubtle,
            color: canSave ? '#fff' : theme.colors.textMuted,
            cursor: canSave ? 'pointer' : 'not-allowed',
            fontFamily: 'inherit',
          }}
        >
          {saving ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={13} />}
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saveSuccess && (
          <span style={{ fontSize: 12, color: '#15803D', fontWeight: 500 }}>
            ✓ Saved
          </span>
        )}
        {saveError && (
          <span style={{ fontSize: 12, color: '#DC2626', fontWeight: 500 }}>
            {saveError}
          </span>
        )}
      </div>

      {/* Phase C pointer */}
      <div style={{
        marginTop: 4, padding: '10px 12px',
        background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8,
        fontSize: 11, color: '#92400E',
      }}>
        Phase B: save-and-preview only. Billing isn't created yet — the
        "Apply Coverage Charge" action lands in a follow-up release.
      </div>
    </div>
  );
}
