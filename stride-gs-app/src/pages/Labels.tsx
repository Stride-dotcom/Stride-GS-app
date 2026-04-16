/**
 * Labels.tsx — Native React label printer (session 68 → rewrite).
 *
 * Full customization parity with the retired GAS labels UI:
 *   • Label type: Item | Location
 *   • Label size: 4×6 / 4×2 / 3×2 / 2×1
 *   • Show QR toggle + size slider (60–220 px)
 *   • Show border toggle
 *   • Per-field toggles + font size dropdown (item + location fields differ)
 *   • Drag-to-reorder fields
 *   • Save / Reset template (localStorage)
 *   • Textarea input for batch item IDs or location codes
 *   • Print preview with actual-size label rendering
 *
 * QR codes rendered client-side via `qrcode` npm package (no external API).
 * Item lookup via fetchItemsByIdsFromSupabase (~50ms). Locations via
 * useLocations hook (Supabase-first with Realtime).
 */
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  Tag, Printer, Trash2, AlertTriangle, Loader2, MapPin, Package,
  Save, RotateCcw, ChevronDown, ChevronUp, GripVertical, Eye, EyeOff,
} from 'lucide-react';
import QRCode from 'qrcode';
import { theme } from '../styles/theme';
import { useLocations } from '../hooks/useLocations';
import { useClients } from '../hooks/useClients';
import { fetchItemsByIdsFromSupabase, type ResolvedItem } from '../lib/supabaseQueries';
import { useAuth } from '../contexts/AuthContext';

// ── Config types ───────────────────────────────────────────────────────
type LabelKind = 'item' | 'location';
type LabelSizeKey = '4x6' | '4x2' | '3x2' | '2x1';

interface LabelSizeDef {
  key: LabelSizeKey;
  label: string;
  widthIn: number;
  heightIn: number;
}
const LABEL_SIZES: Record<LabelSizeKey, LabelSizeDef> = {
  '4x6': { key: '4x6', label: '4" × 6"',  widthIn: 4, heightIn: 6 },
  '4x2': { key: '4x2', label: '4" × 2"',  widthIn: 4, heightIn: 2 },
  '3x2': { key: '3x2', label: '3" × 2"',  widthIn: 3, heightIn: 2 },
  '2x1': { key: '2x1', label: '2" × 1"',  widthIn: 2, heightIn: 1 },
};

interface LabelField {
  id: string;
  name: string;
  size: number;
  enabled: boolean;
}

// Item fields — default order + defaults from the GAS UI
const ITEM_FIELDS_DEFAULT: LabelField[] = [
  { id: 'itemId',      name: 'Item Code',   size: 24, enabled: true  },
  { id: 'clientName',  name: 'Account',     size: 18, enabled: true  },
  { id: 'sidemark',    name: 'Sidemark',    size: 16, enabled: true  },
  { id: 'vendor',      name: 'Vendor',      size: 12, enabled: true  },
  { id: 'description', name: 'Description', size: 10, enabled: true  },
  { id: 'room',        name: 'Room',        size: 10, enabled: true  },
  { id: 'location',    name: 'Warehouse',   size: 10, enabled: false },
  { id: 'reference',   name: 'SKU / Ref',   size: 10, enabled: false },
];

// Location fields
const LOC_FIELDS_DEFAULT: LabelField[] = [
  { id: 'code',      name: 'Location Code', size: 28, enabled: true  },
  { id: 'warehouse', name: 'Warehouse',     size: 14, enabled: false },
  { id: 'zone',      name: 'Zone',          size: 12, enabled: false },
  { id: 'row',       name: 'Row',           size: 12, enabled: false },
  { id: 'bay',       name: 'Bay',           size: 12, enabled: false },
  { id: 'level',     name: 'Level',         size: 12, enabled: false },
  { id: 'notes',     name: 'Notes',         size: 10, enabled: true  },
];

const FONT_SIZES = [7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32];

interface LabelsConfig {
  kind: LabelKind;
  size: LabelSizeKey;
  showQr: boolean;
  qrSize: number;       // px, 60-220
  showBorder: boolean;
  itemFields: LabelField[];
  locFields: LabelField[];
}

const DEFAULT_CONFIG: LabelsConfig = {
  kind: 'item',
  size: '4x6',
  showQr: true,
  qrSize: 120,
  showBorder: true,
  itemFields: ITEM_FIELDS_DEFAULT,
  locFields: LOC_FIELDS_DEFAULT,
};

const CONFIG_STORAGE_KEY = 'stride_labels_config_v1';

function loadConfig(): LabelsConfig {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw);
    // Merge safely in case field definitions change between versions
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      itemFields: mergeFields(ITEM_FIELDS_DEFAULT, parsed.itemFields),
      locFields:  mergeFields(LOC_FIELDS_DEFAULT,  parsed.locFields),
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function mergeFields(defaults: LabelField[], saved: LabelField[] | undefined): LabelField[] {
  if (!Array.isArray(saved)) return defaults;
  const defMap = Object.fromEntries(defaults.map(f => [f.id, f]));
  const savedIds = saved.map(f => f.id);
  // Keep saved order, then append any new default fields not yet in saved
  const merged = saved
    .filter(f => defMap[f.id])
    .map(f => ({ ...defMap[f.id], size: f.size, enabled: f.enabled }));
  for (const d of defaults) {
    if (!savedIds.includes(d.id)) merged.push(d);
  }
  return merged;
}

function saveConfig(cfg: LabelsConfig) {
  try { localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(cfg)); } catch { /* ignore */ }
}

// ── Input helpers ──────────────────────────────────────────────────────
function normalizeId(raw: string): string {
  return raw.trim().replace(/^ITEM:\s*/i, '').toUpperCase();
}
function splitMultiline(raw: string): string[] {
  return raw.split(/[\r\n,;\t]+/g).map(normalizeId).filter(Boolean);
}

// ── QR code hook (renders to a data URL per payload) ──────────────────
function useQrDataUrls(payloads: string[], size: number, enabled: boolean) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!enabled || !payloads.length) { setUrls({}); return; }
    let cancelled = false;
    (async () => {
      const out: Record<string, string> = {};
      for (const p of payloads) {
        if (!p) continue;
        try {
          out[p] = await QRCode.toDataURL(p, {
            errorCorrectionLevel: 'M',
            margin: 0,
            width: size,
            color: { dark: '#000000', light: '#FFFFFF' },
          });
        } catch { /* skip bad payloads */ }
      }
      if (!cancelled) setUrls(out);
    })();
    return () => { cancelled = true; };
  }, [payloads, size, enabled]);
  return urls;
}

// ── Styles ─────────────────────────────────────────────────────────────
const s = {
  page: { display: 'flex', flexDirection: 'column' as const, height: '100%', fontFamily: theme.typography.fontFamily, background: '#f8f9fa' },
  header: { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderBottom: `1px solid ${theme.colors.border}`, background: '#fff', flexShrink: 0 },
  body: { flex: 1, overflow: 'auto', padding: 16, display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16, minHeight: 0 } as React.CSSProperties,
  card: { background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column' as const },
  cardTitle: { fontSize: 12, fontWeight: 600, color: theme.colors.text, textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 },
  textarea: { width: '100%', minHeight: 80, padding: '8px 10px', border: `1px solid ${theme.colors.border}`, borderRadius: 6, fontSize: 13, fontFamily: 'monospace', outline: 'none', resize: 'vertical' as const },
  btnPrimary: { padding: '8px 14px', fontSize: 13, fontWeight: 600, background: theme.colors.primary, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 5, justifyContent: 'center' as const },
  btnSecondary: { padding: '6px 12px', fontSize: 12, fontWeight: 500, background: '#fff', color: theme.colors.text, border: `1px solid ${theme.colors.border}`, borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 },
  btnDanger: { padding: '6px 12px', fontSize: 12, fontWeight: 500, background: '#fff', color: '#DC2626', border: '1px solid #FCA5A5', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 },
  row: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } as React.CSSProperties,
  label: { fontSize: 11, fontWeight: 500, textTransform: 'uppercase' as const, letterSpacing: '0.04em', color: theme.colors.textMuted, flex: '0 0 auto', minWidth: 72 },
  select: { flex: 1, padding: '6px 8px', border: `1px solid ${theme.colors.border}`, borderRadius: 6, fontSize: 13, background: '#fff', fontFamily: 'inherit', cursor: 'pointer' } as React.CSSProperties,
  toggleLabel: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', userSelect: 'none' as const },
  fieldRow: (enabled: boolean, dragging: boolean) => ({
    display: 'grid', gridTemplateColumns: '18px 20px 1fr 80px',
    alignItems: 'center', gap: 8, padding: '5px 6px',
    borderRadius: 4, cursor: 'grab',
    background: dragging ? '#EFF6FF' : '#fff',
    opacity: enabled ? 1 : 0.5,
  }) as React.CSSProperties,
  sectionHeading: { fontSize: 11, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.04em', color: theme.colors.textMuted, marginTop: 8, marginBottom: 4 } as React.CSSProperties,
};

// ── Field editor (sortable list with toggle + size) ────────────────────
interface FieldEditorProps {
  fields: LabelField[];
  onChange: (fields: LabelField[]) => void;
}

function FieldEditor({ fields, onChange }: FieldEditorProps) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const move = (from: number, to: number) => {
    if (from === to) return;
    const next = [...fields];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    onChange(next);
  };

  return (
    <div>
      {fields.map((f, i) => (
        <div
          key={f.id}
          draggable
          onDragStart={() => setDragIdx(i)}
          onDragOver={e => { e.preventDefault(); setDragOverIdx(i); }}
          onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
          onDrop={e => {
            e.preventDefault();
            if (dragIdx != null && dragIdx !== i) move(dragIdx, i);
            setDragIdx(null);
            setDragOverIdx(null);
          }}
          style={s.fieldRow(f.enabled, dragOverIdx === i && dragIdx !== i)}
        >
          <GripVertical size={12} color={theme.colors.textMuted} style={{ cursor: 'grab' }} />
          <input
            type="checkbox"
            checked={f.enabled}
            onChange={e => {
              const next = [...fields];
              next[i] = { ...f, enabled: e.target.checked };
              onChange(next);
            }}
            style={{ accentColor: theme.colors.primary, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 13 }}>{f.name}</span>
          <select
            value={f.size}
            onChange={e => {
              const next = [...fields];
              next[i] = { ...f, size: Number(e.target.value) };
              onChange(next);
            }}
            style={{ ...s.select, fontSize: 12, padding: '4px 6px' }}
          >
            {FONT_SIZES.map(sz => <option key={sz} value={sz}>{sz}pt</option>)}
          </select>
        </div>
      ))}
    </div>
  );
}

// ── Renderable label data ──────────────────────────────────────────────
interface ItemLabelData {
  itemId: string;
  clientName: string;
  sidemark: string;
  vendor: string;
  description: string;
  room: string;
  location: string;
  reference: string;
}

interface LocLabelData {
  code: string;
  warehouse: string;
  zone: string;
  row: string;
  bay: string;
  level: string;
  notes: string;
}

function itemFieldValue(item: ItemLabelData, fieldId: string): string {
  switch (fieldId) {
    case 'itemId':      return item.itemId;
    case 'clientName':  return item.clientName;
    case 'sidemark':    return item.sidemark;
    case 'vendor':      return item.vendor;
    case 'description': return item.description;
    case 'room':        return item.room;
    case 'location':    return item.location;
    case 'reference':   return item.reference;
    default: return '';
  }
}

function locFieldValue(loc: LocLabelData, fieldId: string): string {
  switch (fieldId) {
    case 'code':      return loc.code;
    case 'warehouse': return loc.warehouse;
    case 'zone':      return loc.zone;
    case 'row':       return loc.row;
    case 'bay':       return loc.bay;
    case 'level':     return loc.level;
    case 'notes':     return loc.notes;
    default: return '';
  }
}

// ── Single label rendered with config ──────────────────────────────────
function Label({
  fields, getValue, cfg, qrPayload, qrUrl,
}: {
  fields: LabelField[];
  getValue: (id: string) => string;
  cfg: LabelsConfig;
  qrPayload: string;
  qrUrl?: string;
}) {
  const sizeDef = LABEL_SIZES[cfg.size];
  const isFlat = sizeDef.heightIn <= 2; // use horizontal layout for short labels

  const enabledFields = fields.filter(f => f.enabled);

  return (
    <div
      className="stride-label"
      style={{
        width: `${sizeDef.widthIn}in`,
        height: `${sizeDef.heightIn}in`,
        display: 'flex',
        flexDirection: isFlat ? 'row' : 'column',
        padding: '0.12in',
        background: '#fff',
        color: '#000',
        border: cfg.showBorder ? '1px solid #000' : 'none',
        boxSizing: 'border-box',
        overflow: 'hidden',
        gap: '0.08in',
        alignItems: isFlat ? 'center' : 'stretch',
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '0.02in' }}>
        {enabledFields.map(f => {
          const v = getValue(f.id);
          if (!v) return null;
          return (
            <div
              key={f.id}
              style={{
                fontSize: `${f.size}pt`,
                fontWeight: f.size >= 20 ? 800 : f.size >= 14 ? 600 : 400,
                fontFamily: f.id === 'itemId' || f.id === 'code' ? "'Courier New', monospace" : 'Inter, Arial, sans-serif',
                lineHeight: 1.1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: f.id === 'description' ? 'normal' : 'nowrap',
                maxHeight: f.id === 'description' ? '2.2em' : undefined,
              }}
            >
              {v}
            </div>
          );
        })}
      </div>
      {cfg.showQr && qrPayload && (
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {qrUrl ? (
            <img
              src={qrUrl}
              alt={qrPayload}
              style={{ width: `${cfg.qrSize}px`, height: `${cfg.qrSize}px`, imageRendering: 'pixelated' }}
            />
          ) : (
            <div style={{ width: `${cfg.qrSize}px`, height: `${cfg.qrSize}px`, background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: theme.colors.textMuted }}>
              …
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────────
export function Labels() {
  const { user } = useAuth();
  const isStaff = user?.role === 'admin' || user?.role === 'staff';
  const { apiClients } = useClients();
  const { locations, locationNames } = useLocations();

  const clientNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of apiClients) m[c.spreadsheetId] = c.name;
    return m;
  }, [apiClients]);

  const [cfg, setCfg] = useState<LabelsConfig>(() => loadConfig());
  const [showSettings, setShowSettings] = useState(true);

  // Data state
  const [rawItems, setRawItems] = useState('');
  const [itemResults, setItemResults] = useState<ResolvedItem[]>([]);
  const [itemNotFound, setItemNotFound] = useState<string[]>([]);
  const [itemLoading, setItemLoading] = useState(false);

  const [rawLocs, setRawLocs] = useState('');
  const [selectedLocs, setSelectedLocs] = useState<string[]>([]);
  const [locSearch, setLocSearch] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { textareaRef.current?.focus(); }, [cfg.kind]);

  const loadItems = useCallback(async () => {
    const ids = splitMultiline(rawItems);
    if (!ids.length) return;
    setItemLoading(true);
    const resolved = await fetchItemsByIdsFromSupabase(ids, clientNameMap);
    setItemLoading(false);
    if (!resolved) {
      setItemNotFound(ids);
      setItemResults([]);
      return;
    }
    const foundSet = new Set(resolved.map(r => r.itemId));
    const notFound = ids.filter(id => !foundSet.has(id));
    const orderMap: Record<string, number> = {};
    ids.forEach((id, i) => { orderMap[id] = i; });
    resolved.sort((a, b) => (orderMap[a.itemId] ?? 0) - (orderMap[b.itemId] ?? 0));
    setItemResults(resolved);
    setItemNotFound(notFound);
  }, [rawItems, clientNameMap]);

  const filteredLocs = useMemo(() => {
    const q = locSearch.trim().toUpperCase();
    if (!q) return locationNames;
    return locationNames.filter(l => l.toUpperCase().includes(q));
  }, [locationNames, locSearch]);

  const notesByCode = useMemo(() => {
    const m: Record<string, string> = {};
    for (const l of locations) m[l.location] = l.notes;
    return m;
  }, [locations]);

  const addLocFromInput = () => {
    const codes = splitMultiline(rawLocs);
    if (!codes.length) return;
    setSelectedLocs(prev => {
      const seen = new Set(prev);
      return [...prev, ...codes.filter(c => !seen.has(c))];
    });
    setRawLocs('');
  };
  const toggleLoc = (code: string) => {
    setSelectedLocs(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  };

  const clearItems = () => { setItemResults([]); setItemNotFound([]); setRawItems(''); };
  const clearLocs = () => { setSelectedLocs([]); setRawLocs(''); };

  // Auto-save config on any change
  useEffect(() => { saveConfig(cfg); }, [cfg]);

  // Build data + QR payloads based on kind
  const itemData: ItemLabelData[] = useMemo(() =>
    itemResults.map(r => ({
      itemId: r.itemId,
      clientName: r.clientName,
      sidemark: r.sidemark,
      vendor: r.vendor,
      description: r.description,
      room: r.room,
      location: r.location,
      reference: r.reference,
    })), [itemResults]);

  const locData: LocLabelData[] = useMemo(() =>
    selectedLocs.map(code => ({
      code,
      warehouse: '', zone: '', row: '', bay: '', level: '',
      notes: notesByCode[code] || '',
    })), [selectedLocs, notesByCode]);

  const qrPayloads = useMemo(() => {
    if (cfg.kind === 'item') return itemData.map(d => d.itemId ? `ITEM:${d.itemId}` : '');
    return locData.map(d => d.code ? `LOC:${d.code}` : '');
  }, [cfg.kind, itemData, locData]);

  const qrUrls = useQrDataUrls(qrPayloads, cfg.qrSize, cfg.showQr);

  const printCount = cfg.kind === 'item' ? itemData.length : locData.length;

  const print = () => { window.print(); };

  const resetTemplate = () => {
    setCfg(c => ({
      ...c,
      itemFields: ITEM_FIELDS_DEFAULT,
      locFields: LOC_FIELDS_DEFAULT,
      showQr: true,
      qrSize: 120,
      showBorder: true,
    }));
  };

  if (!isStaff) {
    return (
      <div style={s.page}>
        <div style={s.header}><Tag size={18} color={theme.colors.primary} /><span style={{ fontSize: 15, fontWeight: 600 }}>Label Printer</span></div>
        <div style={{ padding: 40, color: theme.colors.textMuted, textAlign: 'center' }}>Labels are available to staff and admin users.</div>
      </div>
    );
  }

  const currentFields = cfg.kind === 'item' ? cfg.itemFields : cfg.locFields;
  const setCurrentFields = (next: LabelField[]) => {
    if (cfg.kind === 'item') setCfg(c => ({ ...c, itemFields: next }));
    else setCfg(c => ({ ...c, locFields: next }));
  };

  const sizeDef = LABEL_SIZES[cfg.size];

  return (
    <div style={s.page}>
      <div style={s.header} className="no-print">
        <Tag size={18} color={theme.colors.primary} />
        <span style={{ fontSize: 15, fontWeight: 600 }}>Label Printer</span>
        <span style={{ fontSize: 11, color: theme.colors.textMuted, marginLeft: 8 }}>
          {sizeDef.label} · {printCount} label{printCount !== 1 ? 's' : ''}
        </span>
        <button style={{ ...s.btnPrimary, marginLeft: 'auto' }} onClick={print} disabled={printCount === 0}>
          <Printer size={13} /> Print
        </button>
      </div>

      <div style={s.body} className="labels-body">
        {/* LEFT column — controls */}
        <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
          {/* Settings toggle */}
          <div style={s.card}>
            <div style={{ ...s.cardTitle, marginBottom: showSettings ? 10 : 0, cursor: 'pointer' }} onClick={() => setShowSettings(v => !v)}>
              Label settings
              {showSettings ? <ChevronUp size={13} style={{ marginLeft: 'auto' }} /> : <ChevronDown size={13} style={{ marginLeft: 'auto' }} />}
            </div>
            {showSettings && (
              <>
                <div style={s.row}>
                  <span style={s.label}>Type</span>
                  <select value={cfg.kind} onChange={e => setCfg(c => ({ ...c, kind: e.target.value as LabelKind }))} style={s.select}>
                    <option value="item">Item</option>
                    <option value="location">Location</option>
                  </select>
                </div>
                <div style={s.row}>
                  <span style={s.label}>Size</span>
                  <select value={cfg.size} onChange={e => setCfg(c => ({ ...c, size: e.target.value as LabelSizeKey }))} style={s.select}>
                    {Object.values(LABEL_SIZES).map(sz => <option key={sz.key} value={sz.key}>{sz.label}</option>)}
                  </select>
                </div>

                <label style={{ ...s.toggleLabel, marginTop: 4 }}>
                  <input type="checkbox" checked={cfg.showQr} onChange={e => setCfg(c => ({ ...c, showQr: e.target.checked }))} style={{ accentColor: theme.colors.primary, cursor: 'pointer' }} />
                  Show QR code
                </label>

                {cfg.showQr && (
                  <div style={{ ...s.row, marginTop: 4 }}>
                    <span style={s.label}>QR size</span>
                    <input type="range" min={60} max={220} step={10} value={cfg.qrSize} onChange={e => setCfg(c => ({ ...c, qrSize: Number(e.target.value) }))} style={{ flex: 1, accentColor: theme.colors.primary }} />
                    <span style={{ fontSize: 11, fontFamily: 'monospace', minWidth: 34, textAlign: 'right' }}>{cfg.qrSize}px</span>
                  </div>
                )}

                <label style={s.toggleLabel}>
                  <input type="checkbox" checked={cfg.showBorder} onChange={e => setCfg(c => ({ ...c, showBorder: e.target.checked }))} style={{ accentColor: theme.colors.primary, cursor: 'pointer' }} />
                  Show border
                </label>

                <div style={s.sectionHeading}>Fields (drag to reorder)</div>
                <FieldEditor fields={currentFields} onChange={setCurrentFields} />

                <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                  <button style={s.btnSecondary} onClick={resetTemplate}>
                    <RotateCcw size={11} /> Reset
                  </button>
                  <button style={{ ...s.btnSecondary, marginLeft: 'auto' }} onClick={() => saveConfig(cfg)}>
                    <Save size={11} /> Save template
                  </button>
                </div>
              </>
            )}
          </div>

          {/* Input panel */}
          {cfg.kind === 'item' ? (
            <div style={s.card}>
              <div style={s.cardTitle}><Package size={13} /> Item IDs</div>
              <textarea
                ref={textareaRef}
                value={rawItems}
                onChange={e => setRawItems(e.target.value)}
                placeholder="Paste item IDs, one per line…"
                style={s.textarea}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, gap: 6 }}>
                <button style={s.btnDanger} onClick={clearItems} disabled={!itemResults.length && !rawItems}>
                  <Trash2 size={11} /> Clear
                </button>
                <button style={s.btnPrimary} onClick={loadItems} disabled={!rawItems.trim() || itemLoading}>
                  {itemLoading ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                  {itemLoading ? 'Loading…' : 'Generate labels'}
                </button>
              </div>
              {itemResults.length > 0 && (
                <div style={{ marginTop: 10, fontSize: 12, color: '#15803D', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Eye size={11} /> {itemResults.length} found
                </div>
              )}
              {itemNotFound.length > 0 && (
                <div style={{ marginTop: 6, padding: '7px 10px', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, fontSize: 11, color: '#DC2626' }}>
                  <AlertTriangle size={11} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  Not found: {itemNotFound.join(', ')}
                </div>
              )}
            </div>
          ) : (
            <>
              <div style={s.card}>
                <div style={s.cardTitle}><MapPin size={13} /> Add location codes</div>
                <textarea value={rawLocs} onChange={e => setRawLocs(e.target.value)} placeholder="Paste codes, one per line…" style={{ ...s.textarea, minHeight: 60 }} />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                  <button style={s.btnPrimary} onClick={addLocFromInput} disabled={!rawLocs.trim()}>Add</button>
                </div>
              </div>

              <div style={{ ...s.card, flex: 1, minHeight: 0 }}>
                <div style={s.cardTitle}>
                  Pick from existing ({locationNames.length})
                  <button style={{ ...s.btnDanger, marginLeft: 'auto' }} onClick={clearLocs} disabled={!selectedLocs.length}>
                    <Trash2 size={11} /> Clear
                  </button>
                </div>
                <input
                  type="text"
                  value={locSearch}
                  onChange={e => setLocSearch(e.target.value)}
                  placeholder="Search…"
                  style={{ width: '100%', padding: '7px 10px', border: `1px solid ${theme.colors.border}`, borderRadius: 6, fontSize: 12, marginBottom: 6, outline: 'none' }}
                />
                <div style={{ flex: 1, overflow: 'auto', border: `1px solid ${theme.colors.borderLight}`, borderRadius: 6 }}>
                  {filteredLocs.map(code => {
                    const on = selectedLocs.includes(code);
                    return (
                      <div key={code} onClick={() => toggleLoc(code)} style={{
                        padding: '5px 8px', borderBottom: `1px solid ${theme.colors.borderLight}`,
                        fontSize: 12, cursor: 'pointer',
                        background: on ? '#EFF6FF' : '#fff',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      }}>
                        <span style={{ fontFamily: 'monospace', fontWeight: on ? 600 : 400 }}>{code}</span>
                        {notesByCode[code] && <span style={{ color: theme.colors.textMuted, fontSize: 10 }}>{notesByCode[code]}</span>}
                      </div>
                    );
                  })}
                </div>
                {selectedLocs.length > 0 && (
                  <div style={{ marginTop: 6, fontSize: 12, color: '#15803D', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <Eye size={11} /> {selectedLocs.length} selected
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* RIGHT column — preview */}
        <div className="labels-preview-container" style={{ background: '#ECECEC', padding: 12, borderRadius: 10, minHeight: '100%', overflow: 'auto' }}>
          {printCount === 0 && (
            <div style={{ padding: 60, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13, background: '#fff', borderRadius: 10 }}>
              <EyeOff size={20} style={{ opacity: 0.4, marginBottom: 8 }} />
              <div>{cfg.kind === 'item' ? 'Paste item IDs and click Generate labels.' : 'Add or pick location codes on the left.'}</div>
            </div>
          )}
          <div className="labels-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'flex-start' }}>
            {cfg.kind === 'item' && itemData.map((d, i) => (
              <Label
                key={d.itemId}
                fields={cfg.itemFields}
                getValue={id => itemFieldValue(d, id)}
                cfg={cfg}
                qrPayload={qrPayloads[i]}
                qrUrl={qrUrls[qrPayloads[i]]}
              />
            ))}
            {cfg.kind === 'location' && locData.map((d, i) => (
              <Label
                key={d.code}
                fields={cfg.locFields}
                getValue={id => locFieldValue(d, id)}
                cfg={cfg}
                qrPayload={qrPayloads[i]}
                qrUrl={qrUrls[qrPayloads[i]]}
              />
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .labels-body { grid-template-columns: 1fr !important; padding: 0 !important; }
          .labels-preview-container { background: #fff !important; padding: 0 !important; border-radius: 0 !important; }
          .labels-grid { gap: 0 !important; }
          .stride-label {
            break-inside: avoid; page-break-inside: avoid;
            border: none !important; margin: 0;
            page-break-after: always;
          }
          @page { margin: 0; }
        }
      `}</style>
    </div>
  );
}
