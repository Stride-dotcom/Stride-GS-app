/**
 * Scanner.tsx — Native React warehouse scanner (session 68).
 *
 * Replaced the old GAS iframe. Key wins:
 *   • Batch item ID entry: paste 500+ IDs or scan one-by-one (keyboard-wedge
 *     scanner or camera), submits on newline. No per-scan API call.
 *   • Live verification panel: each entered ID shows Client / Vendor /
 *     Description / current Location from Supabase inventory (~50ms) so
 *     the operator can confirm it's the right item BEFORE committing.
 *   • Location picker: searchable dropdown backed by Supabase locations
 *     mirror. Realtime — new locations added anywhere appear instantly.
 *   • + New Location button: inline modal, creates location in CB +
 *     Supabase (one call), available to the dropdown immediately.
 *   • Commit: single POST to batchUpdateItemLocations — backend uses
 *     item_id_ledger to resolve tenants (~50ms) instead of scanning 47
 *     sheets. 2-4s for 50 items vs 20-60s before.
 */
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { ScanLine, Trash2, CheckCircle2, AlertTriangle, Loader2, Plus, X, Camera } from 'lucide-react';
import { theme } from '../styles/theme';
import { useLocations } from '../hooks/useLocations';
import { useClients } from '../hooks/useClients';
import { fetchItemsByIdsFromSupabase, type ResolvedItem } from '../lib/supabaseQueries';
import { postCreateLocation, postBatchUpdateItemLocations, type BatchMoveResult } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import { entityEvents } from '../lib/entityEvents';
import { QRScanner } from '../components/scanner/QRScanner';
import { parseScanPayload } from '../lib/parseScanPayload';
import { playScanAudioFeedback } from '../lib/scanAudioFeedback';
import { useIsMobile } from '../hooks/useIsMobile';

function normalizeId(raw: string): string {
  return raw.trim().replace(/^ITEM:\s*/i, '').toUpperCase();
}

function splitMultiline(raw: string): string[] {
  return raw.split(/[\r\n,;\t]+/g).map(normalizeId).filter(Boolean);
}

interface QueueItem {
  itemId: string;
  addedAt: number;
  resolved?: ResolvedItem;
  status: 'pending' | 'found' | 'not-found';
  error?: string;
}

// Session 68.1 — Style factory, responsive on mobile (single-column, larger
// tap targets, stacked queue rows, full-width modals).
function makeStyles(isMobile: boolean) {
  return {
    page: { display: 'flex', flexDirection: 'column' as const, height: '100%', fontFamily: theme.typography.fontFamily, background: '#f8f9fa' },
    header: { display: 'flex', alignItems: 'center', gap: 10, padding: isMobile ? '10px 14px' : '14px 20px', borderBottom: `1px solid ${theme.colors.border}`, background: '#fff', flexShrink: 0 },
    body: {
      flex: 1, overflow: 'auto',
      padding: isMobile ? 10 : 16,
      display: isMobile ? 'flex' : 'grid',
      flexDirection: isMobile ? ('column' as const) : undefined,
      gridTemplateColumns: isMobile ? undefined : '1fr 380px',
      gap: isMobile ? 10 : 16,
      minHeight: 0,
    } as React.CSSProperties,
    card: { background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: isMobile ? 10 : 14, display: 'flex', flexDirection: 'column' as const },
    cardTitle: { fontSize: 13, fontWeight: 600, color: theme.colors.text, textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' as const },
    textarea: { width: '100%', minHeight: isMobile ? 80 : 100, padding: '10px 12px', border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontSize: 16 /* 16px avoids iOS zoom-on-focus */, fontFamily: 'monospace', outline: 'none', resize: 'vertical' as const, boxSizing: 'border-box' as const },
    btnPrimary: { padding: isMobile ? '11px 18px' : '9px 18px', fontSize: 14, fontWeight: 600, background: theme.colors.primary, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: isMobile ? 42 : undefined },
    btnSecondary: { padding: isMobile ? '9px 14px' : '7px 14px', fontSize: 12, fontWeight: 500, background: '#fff', color: theme.colors.text, border: `1px solid ${theme.colors.border}`, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: isMobile ? 38 : undefined },
    btnDanger: { padding: isMobile ? '9px 14px' : '7px 14px', fontSize: 12, fontWeight: 500, background: '#fff', color: '#DC2626', border: '1px solid #FCA5A5', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4, minHeight: isMobile ? 38 : undefined },
    // On mobile, queue rows stack into a card layout instead of a 6-column grid
    queueRow: (status: QueueItem['status']) => ({
      display: isMobile ? 'flex' : 'grid',
      flexDirection: isMobile ? ('column' as const) : undefined,
      gridTemplateColumns: isMobile ? undefined : '100px 1fr 1fr 1fr 80px 34px',
      gap: isMobile ? 2 : 8,
      alignItems: isMobile ? ('stretch' as const) : ('center' as const),
      padding: isMobile ? '10px 12px' : '8px 10px',
      borderBottom: `1px solid ${theme.colors.borderLight}`,
      fontSize: 12,
      background: status === 'not-found' ? '#FEF2F2' : status === 'pending' ? '#F9FAFB' : '#fff',
      position: 'relative' as const,
    }) as React.CSSProperties,
    queueHead: {
      display: isMobile ? 'none' : 'grid',
      gridTemplateColumns: '100px 1fr 1fr 1fr 80px 34px',
      gap: 8, padding: '8px 10px',
      borderBottom: `2px solid ${theme.colors.border}`,
      fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em', color: theme.colors.textMuted, background: '#F9FAFB',
    } as React.CSSProperties,
    locInput: { width: '100%', padding: isMobile ? '12px' : '10px 12px', border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontSize: 16, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' as const } as React.CSSProperties,
    dropdown: { position: 'absolute' as const, top: '100%', left: 0, right: 0, background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 8, marginTop: 4, maxHeight: isMobile ? 280 : 240, overflow: 'auto', boxShadow: '0 4px 20px rgba(0,0,0,0.08)', zIndex: 30 },
    dropdownRow: (active: boolean) => ({ padding: isMobile ? '12px 14px' : '8px 12px', fontSize: 13, cursor: 'pointer', background: active ? '#EFF6FF' : '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }) as React.CSSProperties,
    modal: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.35)', display: 'flex', alignItems: isMobile ? 'flex-end' : 'center', justifyContent: 'center', zIndex: 50 },
    modalCard: { background: '#fff', borderRadius: isMobile ? '14px 14px 0 0' : 10, padding: isMobile ? 16 : 20, width: isMobile ? '100%' : 400, maxWidth: '100%', boxShadow: '0 10px 40px rgba(0,0,0,0.2)', boxSizing: 'border-box' as const },
    resultBanner: (ok: boolean) => ({ padding: '10px 14px', borderRadius: 8, background: ok ? '#F0FDF4' : '#FEF2F2', border: `1px solid ${ok ? '#86EFAC' : '#FCA5A5'}`, color: ok ? '#15803D' : '#DC2626', fontSize: 13, fontWeight: 500, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }) as React.CSSProperties,
  };
}

// ── Location picker ────────────────────────────────────────────────────
interface LocationPickerProps {
  value: string;
  onChange: (code: string) => void;
  options: string[];
  notesMap: Record<string, string>;
  canCreate: boolean;
  onRequestCreate: (prefill: string) => void;
  disabled?: boolean;
}

function LocationPicker({ value, onChange, options, notesMap, canCreate, onRequestCreate, disabled }: LocationPickerProps) {
  const { isMobile } = useIsMobile();
  const s = useMemo(() => makeStyles(isMobile), [isMobile]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [focusIdx, setFocusIdx] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setQuery(value); }, [value]);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return options.slice(0, 100);
    return options.filter(o => o.toUpperCase().includes(q)).slice(0, 100);
  }, [query, options]);

  const exactMatch = useMemo(() => options.some(o => o.toUpperCase() === query.trim().toUpperCase()), [options, query]);
  const canShowCreate = canCreate && query.trim().length > 0 && !exactMatch;

  const commit = useCallback((code: string) => {
    onChange(code.trim().toUpperCase());
    setQuery(code.trim().toUpperCase());
    setOpen(false);
  }, [onChange]);

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={query}
        disabled={disabled}
        onChange={e => { setQuery(e.target.value); setOpen(true); setFocusIdx(0); }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setFocusIdx(i => Math.min(filtered.length - 1, i + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setFocusIdx(i => Math.max(0, i - 1)); }
          else if (e.key === 'Enter') {
            e.preventDefault();
            if (filtered[focusIdx]) commit(filtered[focusIdx]);
            else if (canShowCreate) onRequestCreate(query.trim().toUpperCase());
          }
          else if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="Type to search or scan a location…"
        style={s.locInput}
      />
      {open && (filtered.length > 0 || canShowCreate) && (
        <div style={s.dropdown}>
          {canShowCreate && (
            <div onClick={() => onRequestCreate(query.trim().toUpperCase())} style={{ ...s.dropdownRow(false), background: '#FFF7ED', color: '#B45309', fontWeight: 500 }}>
              <span><Plus size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />Create new location "{query.trim().toUpperCase()}"</span>
            </div>
          )}
          {filtered.map((code, i) => (
            <div key={code} onClick={() => commit(code)} onMouseEnter={() => setFocusIdx(i)} style={s.dropdownRow(i === focusIdx)}>
              <span style={{ fontFamily: 'monospace', fontWeight: 500 }}>{code}</span>
              {notesMap[code] && (<span style={{ color: theme.colors.textMuted, fontSize: 11, marginLeft: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{notesMap[code]}</span>)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── +New modal ─────────────────────────────────────────────────────────
function NewLocationModal({ initialCode, onClose, onCreated }: { initialCode: string; onClose: () => void; onCreated: (code: string) => void }) {
  const { isMobile } = useIsMobile();
  const s = useMemo(() => makeStyles(isMobile), [isMobile]);
  const [code, setCode] = useState(initialCode);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) { setErr('Location code is required'); return; }
    setBusy(true);
    setErr(null);
    try {
      const res = await postCreateLocation(trimmed, notes.trim());
      if (res.ok && res.data?.success) {
        onCreated(trimmed);
        onClose();
      } else {
        setErr(res.error || res.data?.error || 'Failed to create location');
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={s.modal} onClick={onClose}>
      <div style={s.modalCard} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Add new location</h3>
          <X size={18} style={{ cursor: 'pointer', color: theme.colors.textMuted }} onClick={onClose} />
        </div>
        <label style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', color: theme.colors.textMuted, display: 'block', marginBottom: 4 }}>Code *</label>
        <input autoFocus type="text" value={code} onChange={e => setCode(e.target.value.toUpperCase())} placeholder="e.g. A-01-01, WW3, Rec-Dock" style={{ ...s.locInput, marginBottom: 12, fontFamily: 'monospace' }} />
        <label style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.04em', color: theme.colors.textMuted, display: 'block', marginBottom: 4 }}>Notes (optional)</label>
        <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. West wall, aisle 3" style={{ ...s.locInput, marginBottom: 14 }} />
        {err && (<div style={{ padding: '8px 12px', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, color: '#DC2626', fontSize: 12, marginBottom: 12 }}>{err}</div>)}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button style={s.btnSecondary} onClick={onClose} disabled={busy}>Cancel</button>
          <button style={s.btnPrimary} onClick={submit} disabled={busy || !code.trim()}>
            {busy ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={14} />}
            {busy ? 'Creating…' : 'Create location'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Scanner component ──────────────────────────────────────────────
export function Scanner() {
  const { user } = useAuth();
  const { isMobile } = useIsMobile();
  const s = useMemo(() => makeStyles(isMobile), [isMobile]);
  const isStaff = user?.role === 'admin' || user?.role === 'staff';
  const { apiClients } = useClients();
  const { locations, locationNames, refetch: refetchLocations } = useLocations();
  const notesByCode = useMemo(() => {
    const m: Record<string, string> = {};
    for (const l of locations) m[l.location] = l.notes;
    return m;
  }, [locations]);
  const clientNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of apiClients) m[c.spreadsheetId] = c.name;
    return m;
  }, [apiClients]);

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [rawInput, setRawInput] = useState('');
  const [targetLocation, setTargetLocation] = useState('');
  const [moveNotes, setMoveNotes] = useState('');
  const [showNewLoc, setShowNewLoc] = useState(false);
  const [newLocPrefill, setNewLocPrefill] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<BatchMoveResult | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraHint, setCameraHint] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { textareaRef.current?.focus(); }, []);

  const resolveQueue = useCallback(async (items: QueueItem[]) => {
    const pending = items.filter(q => q.status === 'pending');
    if (!pending.length) return;
    const ids = pending.map(q => q.itemId);
    const resolved = await fetchItemsByIdsFromSupabase(ids, clientNameMap);
    if (!resolved) {
      setQueue(prev => prev.map(q => q.status === 'pending' ? { ...q, status: 'not-found', error: 'Lookup failed — try again' } : q));
      return;
    }
    const byId: Record<string, ResolvedItem> = {};
    for (const r of resolved) byId[r.itemId] = r;
    setQueue(prev => prev.map(q => {
      if (q.status !== 'pending') return q;
      const match = byId[q.itemId];
      if (match) return { ...q, status: 'found', resolved: match };
      return { ...q, status: 'not-found', error: 'Not found in any client' };
    }));
  }, [clientNameMap]);

  const addToQueue = useCallback((ids: string[]) => {
    if (!ids.length) return;
    setQueue(prev => {
      const seen = new Set(prev.map(q => q.itemId));
      const additions = ids.filter(id => !seen.has(id)).map(id => ({ itemId: id, addedAt: Date.now(), status: 'pending' as const }));
      if (!additions.length) return prev;
      const next = [...prev, ...additions];
      void resolveQueue(next);
      return next;
    });
  }, [resolveQueue]);

  // Camera scan dispatcher: LOC:<code> → set target location; ITEM:<id> or
  // raw code → add to queue. Beeps on both paths. Flashes a brief hint so
  // the operator knows what happened.
  const handleCameraScan = useCallback((raw: string) => {
    const parsed = parseScanPayload(raw);
    if (!parsed.code) return;
    if (parsed.type === 'location') {
      setTargetLocation(parsed.code.toUpperCase());
      setCameraHint(`📍 Location set → ${parsed.code.toUpperCase()}`);
      void playScanAudioFeedback('success');
    } else {
      // type === 'item' or 'unknown' → treat as item
      const id = parsed.code.toUpperCase();
      addToQueue([id]);
      setCameraHint(`📦 Added ${id}`);
      void playScanAudioFeedback('success');
    }
    // Clear the hint after a moment so it doesn't linger
    setTimeout(() => setCameraHint(null), 1400);
  }, [addToQueue]);

  const flushInput = useCallback(() => {
    const ids = splitMultiline(rawInput);
    if (ids.length) {
      addToQueue(ids);
      setRawInput('');
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [rawInput, addToQueue]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); flushInput(); }
  };

  const removeFromQueue = useCallback((itemId: string) => { setQueue(prev => prev.filter(q => q.itemId !== itemId)); }, []);
  const clearQueue = useCallback(() => { setQueue([]); }, []);

  const foundCount = queue.filter(q => q.status === 'found').length;
  const pendingCount = queue.filter(q => q.status === 'pending').length;
  const notFoundCount = queue.filter(q => q.status === 'not-found').length;
  const canSubmit = foundCount > 0 && !!targetLocation && !busy && pendingCount === 0;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setLastResult(null);
    const itemIds = queue.filter(q => q.status === 'found').map(q => q.itemId);
    const res = await postBatchUpdateItemLocations(itemIds, targetLocation, moveNotes.trim());
    setBusy(false);
    if (res.ok && res.data) {
      setLastResult(res.data);
      entityEvents.emit('inventory', '*');
      if ((res.data.errors?.length ?? 0) === 0 && (res.data.notFound?.length ?? 0) === 0) {
        setQueue([]);
        setTargetLocation('');
        setMoveNotes('');
      } else {
        const errIds = new Set([
          ...(res.data.errors || []).map(e => e.itemId),
          ...(res.data.notFound || []).map(n => n.itemId),
        ]);
        setQueue(prev => prev.map(q => errIds.has(q.itemId) ? { ...q, status: 'not-found' as const, error: 'Move failed — see banner' } : q));
      }
    } else {
      setLastResult({ success: false, updated: [], notFound: [], errors: [], counts: { requested: itemIds.length, updated: 0, notFound: 0, errors: itemIds.length }, error: res.error || 'Request failed' });
    }
  };

  if (!isStaff) {
    return (
      <div style={s.page}>
        <div style={s.header}>
          <ScanLine size={18} color={theme.colors.primary} />
          <span style={{ fontSize: 15, fontWeight: 600 }}>QR Scanner</span>
        </div>
        <div style={{ padding: 40, color: theme.colors.textMuted, textAlign: 'center' }}>
          Scanner is available to staff and admin users.
        </div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <ScanLine size={18} color={theme.colors.primary} />
        <span style={{ fontSize: 15, fontWeight: 600 }}>QR Scanner</span>
        <span style={{ fontSize: 11, color: theme.colors.textMuted, marginLeft: 8 }}>Batch move items to a new location</span>
      </div>

      <div style={s.body}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
          {/* Camera scanner card */}
          <div style={s.card}>
            <div style={s.cardTitle}>
              <Camera size={14} /> Camera scanner
              <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 400, color: theme.colors.textMuted, textTransform: 'none', letterSpacing: 0 }}>
                {cameraOn ? 'Scan QR or barcode — items auto-queued · LOC labels set target' : 'Use phone/tablet or webcam to scan item & location labels'}
              </span>
            </div>
            {cameraOn ? (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
                <QRScanner
                  onScan={handleCameraScan}
                  onStop={() => { setCameraOn(false); setCameraHint(null); }}
                />
                {cameraHint && (
                  <div style={{
                    padding: '6px 14px',
                    background: '#F0FDF4', border: '1px solid #86EFAC',
                    borderRadius: 99, fontSize: 12, fontWeight: 600, color: '#15803D',
                  }}>
                    {cameraHint}
                  </div>
                )}
              </div>
            ) : (
              <button
                style={{ ...s.btnPrimary, justifyContent: 'center', padding: '10px 18px' }}
                onClick={() => setCameraOn(true)}
              >
                <Camera size={14} /> Start camera scanner
              </button>
            )}
          </div>

          {/* Keyboard / paste input card */}
          <div style={s.card}>
            <div style={s.cardTitle}>
              <Camera size={14} /> Keyboard / paste entry
              <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 400, color: theme.colors.textMuted, textTransform: 'none', letterSpacing: 0 }}>
                Enter to add · Shift+Enter = new line · paste many at once
              </span>
            </div>
            <textarea ref={textareaRef} value={rawInput} onChange={e => setRawInput(e.target.value)} onKeyDown={onKeyDown} placeholder="Scan with handheld scanner, type, or paste item IDs (one per line)…" style={s.textarea} autoFocus />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8, gap: 8 }}>
              <button style={s.btnSecondary} onClick={() => setRawInput('')} disabled={!rawInput}>Clear</button>
              <button style={s.btnPrimary} onClick={flushInput} disabled={!rawInput.trim()}>Add to queue</button>
            </div>
          </div>

          <div style={{ ...s.card, flex: 1, minHeight: 0 }}>
            <div style={s.cardTitle}>
              Queue ({queue.length})
              {foundCount > 0 && <span style={{ fontSize: 11, fontWeight: 400, color: '#15803D' }}>{foundCount} ready</span>}
              {pendingCount > 0 && <span style={{ fontSize: 11, fontWeight: 400, color: '#6B7280', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />{pendingCount} checking</span>}
              {notFoundCount > 0 && <span style={{ fontSize: 11, fontWeight: 400, color: '#DC2626' }}>{notFoundCount} not found</span>}
              <button style={{ ...s.btnDanger, marginLeft: 'auto' }} onClick={clearQueue} disabled={!queue.length}>
                <Trash2 size={11} /> Clear all
              </button>
            </div>
            <div style={{ flex: 1, overflow: 'auto', border: `1px solid ${theme.colors.borderLight}`, borderRadius: 6 }}>
              <div style={s.queueHead}>
                <span>Item ID</span><span>Client</span><span>Vendor / Sidemark</span><span>Description</span><span>Current Loc</span><span></span>
              </div>
              {!queue.length && (
                <div style={{ padding: 40, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13 }}>
                  Scan or paste item IDs above to begin.
                </div>
              )}
              {queue.map(q => (
                isMobile ? (
                  // Mobile: stacked card layout
                  <div key={q.itemId} style={s.queueRow(q.status)}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14 }}>{q.itemId}</span>
                      <button
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 6, minWidth: 32, minHeight: 32 }}
                        onClick={() => removeFromQueue(q.itemId)}
                        aria-label="Remove"
                      >
                        <X size={16} />
                      </button>
                    </div>
                    {q.status === 'pending' && (
                      <div style={{ fontSize: 11, color: theme.colors.textMuted, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Looking up…
                      </div>
                    )}
                    {q.status === 'not-found' && (
                      <div style={{ fontSize: 12, color: '#DC2626', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <AlertTriangle size={12} /> {q.error}
                      </div>
                    )}
                    {q.status === 'found' && q.resolved && (
                      <>
                        <div style={{ fontSize: 12, fontWeight: 600, color: theme.colors.text }}>{q.resolved.clientName}</div>
                        {(q.resolved.vendor || q.resolved.sidemark) && (
                          <div style={{ fontSize: 11, color: theme.colors.textSecondary }}>
                            {q.resolved.vendor || '—'}{q.resolved.sidemark ? ` · ${q.resolved.sidemark}` : ''}
                          </div>
                        )}
                        {q.resolved.description && (
                          <div style={{ fontSize: 11, color: theme.colors.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>
                            {q.resolved.description}
                          </div>
                        )}
                        {q.resolved.location && (
                          <div style={{ fontSize: 11, fontFamily: 'monospace', color: theme.colors.textMuted }}>
                            Currently: {q.resolved.location}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  // Desktop: 6-column grid
                  <div key={q.itemId} style={s.queueRow(q.status)}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{q.itemId}</span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {q.status === 'pending' && <Loader2 size={11} style={{ animation: 'spin 1s linear infinite', color: theme.colors.textMuted }} />}
                      {q.status === 'found' && q.resolved?.clientName}
                      {q.status === 'not-found' && <span style={{ color: '#DC2626' }}><AlertTriangle size={11} style={{ verticalAlign: 'middle', marginRight: 3 }} />{q.error}</span>}
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {q.resolved && (q.resolved.vendor || q.resolved.sidemark ? `${q.resolved.vendor || '—'}${q.resolved.sidemark ? ' · ' + q.resolved.sidemark : ''}` : '—')}
                    </span>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: theme.colors.textSecondary }}>
                      {q.resolved?.description || ''}
                    </span>
                    <span style={{ fontFamily: 'monospace', fontSize: 11, color: theme.colors.textMuted }}>
                      {q.resolved?.location || ''}
                    </span>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 2 }} onClick={() => removeFromQueue(q.itemId)}>
                      <X size={14} />
                    </button>
                  </div>
                )
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={s.card}>
            <div style={s.cardTitle}>Destination location</div>
            <LocationPicker
              value={targetLocation}
              onChange={setTargetLocation}
              options={locationNames}
              notesMap={notesByCode}
              canCreate={isStaff}
              onRequestCreate={code => { setNewLocPrefill(code); setShowNewLoc(true); }}
            />
            {targetLocation && notesByCode[targetLocation] && (
              <div style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 6 }}>{notesByCode[targetLocation]}</div>
            )}
            <button style={{ ...s.btnSecondary, marginTop: 10, justifyContent: 'center' }} onClick={() => { setNewLocPrefill(''); setShowNewLoc(true); }}>
              <Plus size={12} /> Add a new location
            </button>
          </div>

          <div style={s.card}>
            <div style={s.cardTitle}>Move notes (optional)</div>
            <input type="text" value={moveNotes} onChange={e => setMoveNotes(e.target.value)} placeholder="e.g. reorganizing zone A" style={s.locInput} />
          </div>

          {lastResult && (
            <div style={s.resultBanner(lastResult.success && (lastResult.errors?.length ?? 0) === 0 && (lastResult.notFound?.length ?? 0) === 0)}>
              {lastResult.success && (lastResult.errors?.length ?? 0) === 0 && (lastResult.notFound?.length ?? 0) === 0
                ? <><CheckCircle2 size={14} /> Moved {lastResult.counts.updated} item{lastResult.counts.updated !== 1 ? 's' : ''} to {targetLocation || 'location'}.</>
                : <><AlertTriangle size={14} /> {lastResult.error || `Moved ${lastResult.counts.updated} · ${lastResult.counts.notFound} not found · ${lastResult.counts.errors} errors`}</>}
            </div>
          )}

          <button
            style={{ ...s.btnPrimary, justifyContent: 'center', padding: '12px 18px', fontSize: 15, opacity: canSubmit ? 1 : 0.4, cursor: canSubmit ? 'pointer' : 'not-allowed' }}
            onClick={submit}
            disabled={!canSubmit}
          >
            {busy ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle2 size={16} />}
            {busy ? 'Moving…' : `Move ${foundCount || 0} item${foundCount === 1 ? '' : 's'}`}
          </button>
          <div style={{ fontSize: 11, color: theme.colors.textMuted, textAlign: 'center' }}>
            Uses item_id_ledger for fast cross-tenant lookup.
          </div>
        </div>
      </div>

      {showNewLoc && (
        <NewLocationModal
          initialCode={newLocPrefill}
          onClose={() => setShowNewLoc(false)}
          onCreated={code => {
            void refetchLocations();
            setTargetLocation(code);
          }}
        />
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  );
}
