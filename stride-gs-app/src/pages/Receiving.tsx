import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Plus, Copy, X, Check, Truck, Package, AlertTriangle, Printer, ClipboardPaste } from 'lucide-react';
import { theme } from '../styles/theme';
import { AutocompleteSelect } from '../components/shared/AutocompleteSelect';

import { LocationPicker } from '../components/shared/LocationPicker';
import { AutocompleteInput } from '../components/shared/AutocompleteInput';
import { useLocations } from '../hooks/useLocations';

import { useClients } from '../hooks/useClients';
import { useAutocomplete } from '../hooks/useAutocomplete';
import { isApiConfigured, postCompleteShipment, postCheckItemIdsAvailable, fetchAutoIdSetting, fetchNextItemId } from '../lib/api';
import type { ShipmentItemPayload } from '../lib/api';
import { ProcessingOverlay } from '../components/shared/ProcessingOverlay';
import { useIsMobile } from '../hooks/useIsMobile';

interface DockItem {
  id: string; itemId: string; reference: string; vendor: string; description: string; itemClass: string;
  qty: number; location: string; sidemark: string; room: string;
  needsInspection: boolean; needsAssembly: boolean; itemNotes: string;
}

const CLASSES = ['XS', 'S', 'M', 'L', 'XL'];

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function emptyItem(autoInspect = false): DockItem {
  return { id: `r-${Date.now()}-${Math.random().toString(36).slice(2,6)}`, itemId: '', reference: '', vendor: '', description: '', itemClass: '', qty: 1, location: 'Rec-Dock', sidemark: '', room: '', needsInspection: autoInspect, needsAssembly: false, itemNotes: '' };
}

const cellInput: React.CSSProperties = { width: '100%', padding: '6px 8px', fontSize: 12, border: `1px solid ${theme.colors.borderLight}`, borderRadius: 6, outline: 'none', fontFamily: 'inherit', background: '#fff' };
const cellSelect: React.CSSProperties = { ...cellInput, cursor: 'pointer', appearance: 'auto' as any };
const th: React.CSSProperties = { padding: '8px 6px', textAlign: 'left', fontWeight: 500, fontSize: 10, color: theme.colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', borderBottom: `2px solid ${theme.colors.border}`, whiteSpace: 'nowrap', position: 'sticky', top: 0, background: '#fff', zIndex: 2 };
const td: React.CSSProperties = { padding: '4px 4px', borderBottom: `1px solid ${theme.colors.borderLight}`, verticalAlign: 'middle' };


function NewShipmentForm() {
  const { isMobile } = useIsMobile();
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
      const copy = { ...prev[idx], id: newId, itemId: autoIdEnabled ? '' : prev[idx].itemId };
      const next = [...prev];
      next.splice(idx + 1, 0, copy);
      return next;
    });
    if (autoIdEnabled) assignAutoId(newId);
  }, [autoIdEnabled, assignAutoId]);

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
    <div style={{ position: 'relative' }}>
      <ProcessingOverlay visible={submitting} message="Completing Shipment..." />
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
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button
              onClick={() => { setBulkPasteStartField('itemId'); setBulkPasteOpen(true); }}
              title="Copy a range of cells from Excel/Sheets, paste here, apply to the grid"
              style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, border: `1px solid ${theme.colors.orange}`, borderRadius: 6, background: theme.colors.orange, cursor: 'pointer', fontFamily: 'inherit', color: '#fff', display: 'flex', alignItems: 'center', gap: 4 }}>
              <ClipboardPaste size={13} /> Paste from Excel
            </button>
            <button onClick={addRow} style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary, display: 'flex', alignItems: 'center', gap: 4 }}><Plus size={13} /> Add Row</button>
            <button onClick={() => addRows(5)} style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>+5</button>
            <button onClick={() => addRows(10)} style={{ padding: '5px 12px', fontSize: 11, fontWeight: 600, border: `1px solid ${theme.colors.border}`, borderRadius: 6, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', color: theme.colors.textSecondary }}>+10</button>
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
              <tr>
                <th style={{ ...th, width: 36, textAlign: 'center' }}>#</th>
                <th style={{ ...th, width: 110 }}>{autoIdEnabled ? 'Item ID (Auto)' : 'Item ID *'}</th>
                <th style={{ ...th, width: 130 }}>Vendor</th>
                <th style={{ ...th, width: 260 }}>Description *</th>
                <th style={{ ...th, width: 60 }}>Class</th>
                <th style={{ ...th, width: 50 }}>Qty</th>
                <th style={{ ...th, width: 100 }}>Location</th>
                <th style={{ ...th, width: 150 }}>Sidemark</th>
                <th style={{ ...th, width: 120 }}>Reference</th>
                <th style={{ ...th, width: 100 }}>Room</th>
                <th style={{ ...th, width: 50, textAlign: 'center' }} title="Needs Inspection">INSP</th>
                <th style={{ ...th, width: 50, textAlign: 'center' }} title="Needs Assembly">ASM</th>
                <th style={{ ...th, width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, idx) => (
                <tr key={item.id} style={{ background: item.description.trim() ? 'transparent' : '#FAFAFA' }}>
                  <td style={{ ...td, textAlign: 'center', fontSize: 11, color: theme.colors.textMuted, fontWeight: 600 }}>{idx + 1}</td>
                  <td style={td}>
                    {autoIdEnabled ? (
                      <div style={{ ...cellInput, fontWeight: 600, fontFamily: 'monospace', fontSize: 11, background: '#F9FAFB', color: autoIdLoadingRef.current.has(item.id) ? theme.colors.textMuted : theme.colors.textPrimary, display: 'flex', alignItems: 'center', minHeight: 28 }}>
                        {autoIdLoadingRef.current.has(item.id) ? (
                          <span style={{ color: theme.colors.textMuted, fontFamily: 'inherit', fontWeight: 400, fontSize: 11 }}>Assigning...</span>
                        ) : (
                          item.itemId || <span style={{ color: '#DC2626', fontSize: 10 }}>Error</span>
                        )}
                      </div>
                    ) : (
                      <input value={item.itemId} onChange={e => update(idx, 'itemId', e.target.value)} onPaste={e => handlePaste(e, idx, 'itemId')} placeholder="Item ID" style={{ ...cellInput, fontWeight: 600, fontFamily: 'monospace', fontSize: 11 }} />
                    )}
                  </td>
                  <td style={td}><AutocompleteInput value={item.vendor} onChange={val => update(idx, 'vendor', val)} placeholder="Vendor" suggestions={vendors} icon={false} style={{ fontSize: 12 }} /></td>
                  <td style={td}><AutocompleteInput value={item.description} onChange={val => update(idx, 'description', val)} placeholder="Item description... (Enter for new line)" suggestions={descriptions} icon={false} multiline style={{ fontSize: 12, fontWeight: item.description ? 500 : 400 }} /></td>
                  <td style={td}><select value={item.itemClass} onChange={e => update(idx, 'itemClass', e.target.value)} style={cellSelect}><option value="">--</option>{CLASSES.map(c => <option key={c} value={c}>{c}</option>)}</select></td>
                  <td style={td}><input type="number" min={1} value={item.qty} onChange={e => update(idx, 'qty', parseInt(e.target.value) || 1)} style={{ ...cellInput, width: 46, textAlign: 'center' }} /></td>
                  <td style={td}><LocationPicker value={item.location} onChange={val => update(idx, 'location', val)} placeholder="Location" locations={apiConfigured && locationNames.length > 0 ? locationNames : undefined} loading={locationsLoading} /></td>
                  <td style={td}><AutocompleteInput value={item.sidemark} onChange={val => update(idx, 'sidemark', val)} placeholder="Project / client" suggestions={sidemarks} icon={false} style={{ fontSize: 12 }} /></td>
                  <td style={td}><input value={item.reference} onChange={e => update(idx, 'reference', e.target.value)} onPaste={e => handlePaste(e, idx, 'reference')} placeholder="PO# / Ref" style={cellInput} /></td>
                  <td style={td}><input value={item.room} onChange={e => update(idx, 'room', e.target.value)} onPaste={e => handlePaste(e, idx, 'room')} placeholder="Room" style={cellInput} /></td>
                  <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={item.needsInspection} onChange={e => update(idx, 'needsInspection', e.target.checked)} style={{ accentColor: theme.colors.orange, cursor: 'pointer' }} /></td>
                  <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={item.needsAssembly} onChange={e => update(idx, 'needsAssembly', e.target.checked)} style={{ accentColor: theme.colors.orange, cursor: 'pointer' }} /></td>
                  <td style={{ ...td, textAlign: 'center' }}>
                    <div style={{ display: 'flex', gap: 2, justifyContent: 'center' }}>
                      <button onClick={() => duplicateRow(idx)} title="Duplicate row" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: theme.colors.textMuted, borderRadius: 4 }}><Copy size={13} /></button>
                      <button onClick={() => removeRow(idx)} title="Remove row" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: items.length > 1 ? theme.colors.textMuted : theme.colors.borderLight, borderRadius: 4 }}><X size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
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
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px' }}>Receiving</h1>
          <p style={{ fontSize: 13, color: theme.colors.textMuted, marginTop: 2 }}>Dock intake and shipment processing</p>
        </div>
      </div>
      <NewShipmentForm />
    </div>
  );
}
