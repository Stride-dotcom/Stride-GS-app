import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  flexRender, createColumnHelper,
  type SortingState, type VisibilityState,
} from '@tanstack/react-table';
import { useTablePreferences } from '../hooks/useTablePreferences';
import { Plus, Copy, X, Check, Truck, Package, AlertTriangle, Printer, ClipboardPaste, ChevronDown, ChevronRight, ChevronUp, Zap, Settings2 } from 'lucide-react';
import { theme } from '../styles/theme';
import { AutocompleteSelect } from '../components/shared/AutocompleteSelect';

import { LocationPicker } from '../components/shared/LocationPicker';
import { AutocompleteInput } from '../components/shared/AutocompleteInput';
import { useLocations } from '../hooks/useLocations';

import { useClients } from '../hooks/useClients';
import { useAutocomplete } from '../hooks/useAutocomplete';
import { useReceivingAddons, type ReceivingAddon } from '../hooks/useReceivingAddons';
import { ReceivingRowMedia } from '../components/media/ReceivingRowMedia';
import { isApiConfigured, postCompleteShipment, postCheckItemIdsAvailable, fetchAutoIdSetting, fetchNextItemId } from '../lib/api';
import type { ShipmentItemPayload } from '../lib/api';
import { ProcessingOverlay } from '../components/shared/ProcessingOverlay';
import { useIsMobile } from '../hooks/useIsMobile';

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


function NewShipmentForm() {
  const { isMobile } = useIsMobile();

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
  const [notes, setNotes] = useState('');
  const [receiveDate, setReceiveDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [chargeReceiving, setChargeReceiving] = useState(true);
  const [autoPrintLabels, setAutoPrintLabels] = useState(() => localStorage.getItem('stride_auto_print_labels') === 'true');
  const printRef = useRef<HTMLDivElement>(null);
  const [items, setItems] = useState<DockItem[]>(() => Array.from({ length: 5 }, () => emptyItem(false)));
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [submitResult, setSubmitResult] = useState<{ shipmentNo: string; itemCount: number; tasksCreated: number; billingRows: number; warnings?: string[] } | null>(null);
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  const apiConfigured = isApiConfigured();
  const { locationNames, loading: locationsLoading } = useLocations(apiConfigured);
  const { clients: liveClients, apiClients } = useClients(apiConfigured);

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
        notes: notes.trim(),
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

      setSubmitResult({
        shipmentNo: resp.data.shipmentNo || '',
        itemCount: resp.data.itemCount || filledItems.length,
        tasksCreated: resp.data.tasksCreated || 0,
        billingRows: resp.data.billingRows || 0,
        warnings: resp.data.warnings,
      });

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
  }, [client, clientSheetId, filledItems, apiConfigured, carrier, tracking, notes, receiveDate, chargeReceiving, autoPrintLabels, printItemLabels]);

  // ─── TanStack Table setup ─────────────────────────────────────────────────

  // Annotate each item with its original array index so cell renderers can
  // call update(idx, ...) correctly even when rows are sorted.
  const tableData = useMemo<TableRow[]>(
    () => items.map((item, i) => ({ ...item, _originalIdx: i })),
    [items],
  );

  // Column definitions — not memoized so cell renderers always see fresh closures
  // (important for autoIdLoadingRef which changes via forceUpdate, not state).
  const columns = [
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
          <input value={item.itemId} onChange={e => update(idx, 'itemId', e.target.value)} onPaste={e => handlePaste(e, idx, 'itemId')} placeholder="Item ID" style={{ ...cellInput, fontWeight: 600, fontFamily: 'monospace', fontSize: 11 }} />
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
  ];

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
    setClient(''); setClientSheetId(''); setCarrier(''); setTracking(''); setNotes('');
    setReceiveDate(new Date().toISOString().slice(0, 10));
    setChargeReceiving(true);
    setAutoIdError('');
    const freshItems = Array.from({ length: 5 }, () => emptyItem(false));
    setItems(freshItems);
    setSubmitted(false); setSubmitError(''); setSubmitResult(null);
    idempotencyKeyRef.current = crypto.randomUUID();
    if (autoIdEnabled) {
      freshItems.forEach(item => assignAutoId(item.id));
    }
  }, [autoIdEnabled, assignAutoId]);

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
      <ProcessingOverlay visible={submitting} message="Completing Shipment..." />
      <div style={{ marginBottom: 16, fontSize: 20, fontWeight: 700, letterSpacing: '2px', color: '#1C1C1C' }}>STRIDE LOGISTICS · RECEIVING</div>
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
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr 1fr 1fr 1fr', gap: 12 }}>
          <div>
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
            <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Carrier</label>
            <input value={carrier} onChange={e => setCarrier(e.target.value)} placeholder="UPS, FedEx, LTL..." style={{ ...cellInput, padding: '8px 10px', fontSize: 13 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Tracking #</label>
            <input value={tracking} onChange={e => setTracking(e.target.value)} placeholder="Tracking number..." style={{ ...cellInput, padding: '8px 10px', fontSize: 13 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Notes</label>
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="Shipment notes..." style={{ ...cellInput, padding: '8px 10px', fontSize: 13 }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, display: 'block', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>Receive Date</label>
            <input type="date" value={receiveDate} onChange={e => setReceiveDate(e.target.value)} style={{ ...cellInput, padding: '8px 10px', fontSize: 13 }} />
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
            <button
              onClick={handleComplete}
              disabled={!client || filledItems.length === 0 || submitting}
              style={{
                padding: '9px 20px', fontSize: 13, fontWeight: 600, borderRadius: 8, border: 'none',
                background: (!client || filledItems.length === 0 || submitting) ? theme.colors.border : theme.colors.orange,
                color: (!client || filledItems.length === 0 || submitting) ? theme.colors.textMuted : '#fff',
                cursor: (!client || filledItems.length === 0 || submitting) ? 'not-allowed' : 'pointer',
                fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 6,
              }}
            >
              {submitting ? (
                <><span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} /> Processing...</>
              ) : (
                <><Check size={15} /> Complete Shipment</>
              )}
            </button>
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
  return <NewShipmentForm />;
}
