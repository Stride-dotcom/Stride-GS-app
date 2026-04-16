/**
 * Labels.tsx — Native React label printer (session 68).
 *
 * Replaces the old GAS iframe. Supports two label types:
 *   • Item labels (4" × 6" — thermal or laser): item ID + QR + vendor +
 *     sidemark + client + receive date. One label per item.
 *   • Location labels (3" × 2"): location code + optional notes + QR.
 *     One label per location code (bulk create a zone's worth at once).
 *
 * Item lookup uses fetchItemsByIdsFromSupabase (same path as Scanner) so
 * batch search + client enrichment runs in ~50ms. Locations use the same
 * useLocations hook with Realtime updates.
 *
 * Print layout: CSS @media print with exact page sizing, QR codes rendered
 * via Google Chart API (no JS dep). Click "Print" → browser print dialog.
 */
import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Tag, Printer, Trash2, AlertTriangle, Loader2, MapPin, Package } from 'lucide-react';
import { theme } from '../styles/theme';
import { useLocations } from '../hooks/useLocations';
import { useClients } from '../hooks/useClients';
import { fetchItemsByIdsFromSupabase, type ResolvedItem } from '../lib/supabaseQueries';
import { useAuth } from '../contexts/AuthContext';

type Mode = 'item' | 'location';

function normalizeId(raw: string): string {
  return raw.trim().replace(/^ITEM:\s*/i, '').toUpperCase();
}
function splitMultiline(raw: string): string[] {
  return raw.split(/[\r\n,;\t]+/g).map(normalizeId).filter(Boolean);
}

// Google Chart QR API — zero-dependency, scannable, cached by the browser.
function qrUrl(payload: string, size = 200) {
  return `https://chart.googleapis.com/chart?chs=${size}x${size}&cht=qr&chl=${encodeURIComponent(payload)}&chld=M|0`;
}

const s = {
  page: { display: 'flex', flexDirection: 'column' as const, height: '100%', fontFamily: theme.typography.fontFamily, background: '#f8f9fa' },
  header: { display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderBottom: `1px solid ${theme.colors.border}`, background: '#fff', flexShrink: 0 },
  body: { flex: 1, overflow: 'auto', padding: 16, display: 'grid', gridTemplateColumns: '360px 1fr', gap: 16, minHeight: 0 } as React.CSSProperties,
  card: { background: '#fff', border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column' as const },
  cardTitle: { fontSize: 13, fontWeight: 600, color: theme.colors.text, textTransform: 'uppercase' as const, letterSpacing: '0.04em', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 },
  textarea: { width: '100%', minHeight: 110, padding: '10px 12px', border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontSize: 14, fontFamily: 'monospace', outline: 'none', resize: 'vertical' as const },
  btnPrimary: { padding: '9px 18px', fontSize: 14, fontWeight: 600, background: theme.colors.primary, color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 6, justifyContent: 'center' as const },
  btnSecondary: { padding: '7px 14px', fontSize: 12, fontWeight: 500, background: '#fff', color: theme.colors.text, border: `1px solid ${theme.colors.border}`, borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 },
  btnDanger: { padding: '7px 14px', fontSize: 12, fontWeight: 500, background: '#fff', color: '#DC2626', border: '1px solid #FCA5A5', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 4 },
  modeTab: (active: boolean) => ({
    flex: 1, padding: '10px 14px', fontSize: 13, fontWeight: 500, background: active ? theme.colors.primary : '#fff',
    color: active ? '#fff' : theme.colors.text, border: `1px solid ${active ? theme.colors.primary : theme.colors.border}`,
    cursor: 'pointer', fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
  }) as React.CSSProperties,
};

// ── Item label 4x6 (laid out landscape by default for 4" wide × 6" tall) ─
function ItemLabel({ item }: { item: ResolvedItem }) {
  return (
    <div className="stride-label item-label">
      <div className="item-head">
        <div className="item-client">{item.clientName || '—'}</div>
        <div className="item-id">{item.itemId}</div>
      </div>
      <div className="item-qr">
        <img src={qrUrl(item.itemId, 300)} alt={item.itemId} />
      </div>
      <div className="item-meta">
        {item.description && <div className="item-desc">{item.description}</div>}
        <div className="item-row">
          <span><strong>Vendor:</strong> {item.vendor || '—'}</span>
          <span><strong>Sidemark:</strong> {item.sidemark || '—'}</span>
        </div>
        <div className="item-row">
          <span><strong>Class:</strong> {item.itemClass || '—'}</span>
          <span><strong>Qty:</strong> {item.qty}</span>
          <span><strong>Loc:</strong> {item.location || '—'}</span>
        </div>
        {item.reference && <div className="item-row"><span><strong>Ref:</strong> {item.reference}</span></div>}
      </div>
    </div>
  );
}

// ── Location label 3x2 ──────────────────────────────────────────────────
function LocationLabel({ code, notes }: { code: string; notes?: string }) {
  return (
    <div className="stride-label loc-label">
      <div className="loc-left">
        <div className="loc-code">{code}</div>
        {notes && <div className="loc-notes">{notes}</div>}
        <div className="loc-brand">Stride Logistics</div>
      </div>
      <div className="loc-qr">
        <img src={qrUrl(code, 180)} alt={code} />
      </div>
    </div>
  );
}

// ── Main Labels component ──────────────────────────────────────────────
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

  const [mode, setMode] = useState<Mode>('item');

  // Item label state
  const [rawItems, setRawItems] = useState('');
  const [itemResults, setItemResults] = useState<ResolvedItem[]>([]);
  const [itemNotFound, setItemNotFound] = useState<string[]>([]);
  const [itemLoading, setItemLoading] = useState(false);

  // Location label state
  const [rawLocs, setRawLocs] = useState('');
  const [selectedLocs, setSelectedLocs] = useState<string[]>([]);
  const [locSearch, setLocSearch] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { textareaRef.current?.focus(); }, [mode]);

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
    // Keep original input order
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
      const toAdd = codes.filter(c => !seen.has(c));
      return [...prev, ...toAdd];
    });
    setRawLocs('');
  };

  const toggleLoc = (code: string) => {
    setSelectedLocs(prev => prev.includes(code) ? prev.filter(c => c !== code) : [...prev, code]);
  };

  const clearItems = () => { setItemResults([]); setItemNotFound([]); setRawItems(''); };
  const clearLocs = () => { setSelectedLocs([]); setRawLocs(''); };

  const print = () => { window.print(); };

  const itemPrintCount = itemResults.length;
  const locPrintCount = selectedLocs.length;

  if (!isStaff) {
    return (
      <div style={s.page}>
        <div style={s.header}><Tag size={18} color={theme.colors.primary} /><span style={{ fontSize: 15, fontWeight: 600 }}>Label Printer</span></div>
        <div style={{ padding: 40, color: theme.colors.textMuted, textAlign: 'center' }}>Labels are available to staff and admin users.</div>
      </div>
    );
  }

  return (
    <div style={s.page}>
      <div style={s.header}>
        <Tag size={18} color={theme.colors.primary} />
        <span style={{ fontSize: 15, fontWeight: 600 }}>Label Printer</span>
        <span style={{ fontSize: 11, color: theme.colors.textMuted, marginLeft: 8 }}>
          Batch print item (4×6) or location (3×2) labels
        </span>
        <button
          style={{ ...s.btnPrimary, marginLeft: 'auto' }}
          onClick={print}
          disabled={(mode === 'item' ? itemPrintCount : locPrintCount) === 0}
        >
          <Printer size={14} /> Print {mode === 'item' ? itemPrintCount : locPrintCount} label{(mode === 'item' ? itemPrintCount : locPrintCount) !== 1 ? 's' : ''}
        </button>
      </div>

      {/* Mode tabs */}
      <div className="no-print" style={{ display: 'flex', padding: '12px 16px 0', gap: 0 }}>
        <button style={{ ...s.modeTab(mode === 'item'), borderRadius: '8px 0 0 8px' }} onClick={() => setMode('item')}>
          <Package size={14} /> Item labels (4"×6")
        </button>
        <button style={{ ...s.modeTab(mode === 'location'), borderRadius: '0 8px 8px 0', borderLeft: 'none' }} onClick={() => setMode('location')}>
          <MapPin size={14} /> Location labels (3"×2")
        </button>
      </div>

      <div style={s.body} className="labels-body">
        {/* Left column — input */}
        <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {mode === 'item' ? (
            <div style={s.card}>
              <div style={s.cardTitle}>Item IDs</div>
              <textarea
                ref={textareaRef}
                value={rawItems}
                onChange={e => setRawItems(e.target.value)}
                placeholder="Paste item IDs, one per line…"
                style={s.textarea}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, gap: 8 }}>
                <button style={s.btnDanger} onClick={clearItems} disabled={!itemResults.length && !rawItems}>
                  <Trash2 size={11} /> Clear
                </button>
                <button style={s.btnPrimary} onClick={loadItems} disabled={!rawItems.trim() || itemLoading}>
                  {itemLoading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : null}
                  {itemLoading ? 'Loading…' : 'Load labels'}
                </button>
              </div>
              {itemResults.length > 0 && (
                <div style={{ marginTop: 12, fontSize: 12, color: theme.colors.textMuted }}>
                  <CheckIcon /> {itemResults.length} item{itemResults.length !== 1 ? 's' : ''} loaded
                </div>
              )}
              {itemNotFound.length > 0 && (
                <div style={{ marginTop: 8, padding: '8px 10px', background: '#FEF2F2', border: '1px solid #FCA5A5', borderRadius: 6, fontSize: 12, color: '#DC2626' }}>
                  <AlertTriangle size={12} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                  Not found: {itemNotFound.join(', ')}
                </div>
              )}
            </div>
          ) : (
            <>
              <div style={s.card}>
                <div style={s.cardTitle}>Add location codes</div>
                <textarea
                  value={rawLocs}
                  onChange={e => setRawLocs(e.target.value)}
                  placeholder="Paste codes (one per line) or pick from the list below…"
                  style={{ ...s.textarea, minHeight: 60 }}
                />
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                  <button style={s.btnPrimary} onClick={addLocFromInput} disabled={!rawLocs.trim()}>
                    Add
                  </button>
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
                  style={{ width: '100%', padding: '8px 12px', border: `1px solid ${theme.colors.border}`, borderRadius: 8, fontSize: 13, marginBottom: 8, outline: 'none' }}
                />
                <div style={{ flex: 1, overflow: 'auto', border: `1px solid ${theme.colors.borderLight}`, borderRadius: 6 }}>
                  {filteredLocs.map(code => {
                    const on = selectedLocs.includes(code);
                    return (
                      <div key={code} onClick={() => toggleLoc(code)} style={{
                        padding: '6px 10px', borderBottom: `1px solid ${theme.colors.borderLight}`,
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
                  <div style={{ marginTop: 8, fontSize: 12, color: theme.colors.textMuted }}>
                    <CheckIcon /> {selectedLocs.length} selected
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right column — preview */}
        <div style={{ minWidth: 0 }}>
          <div className="labels-preview-container">
            {mode === 'item' && itemResults.length === 0 && (
              <div style={{ padding: 60, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13, background: '#fff', borderRadius: 10, border: `1px solid ${theme.colors.border}` }}>
                Paste item IDs on the left → Load labels to preview.
              </div>
            )}
            {mode === 'location' && selectedLocs.length === 0 && (
              <div style={{ padding: 60, textAlign: 'center', color: theme.colors.textMuted, fontSize: 13, background: '#fff', borderRadius: 10, border: `1px solid ${theme.colors.border}` }}>
                Add or pick location codes on the left.
              </div>
            )}
            <div className="labels-grid">
              {mode === 'item' && itemResults.map(item => <ItemLabel key={item.itemId} item={item} />)}
              {mode === 'location' && selectedLocs.map(code => <LocationLabel key={code} code={code} notes={notesByCode[code]} />)}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }

        .labels-preview-container {
          background: #ECECEC; padding: 12px; border-radius: 10px; min-height: 100%;
        }
        .labels-grid {
          display: flex; flex-wrap: wrap; gap: 12px; justify-content: flex-start;
        }

        /* ── Item label (4" × 6") ───────────────────────────────────────── */
        .item-label {
          width: 4in; height: 6in;
          display: flex; flex-direction: column;
          padding: 0.2in; background: #fff; color: #000;
          font-family: 'Inter', Arial, sans-serif;
          box-sizing: border-box;
          border: 1px solid ${theme.colors.border};
        }
        .item-head {
          display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 2px solid #000; padding-bottom: 0.1in; margin-bottom: 0.1in;
        }
        .item-client {
          font-size: 16px; font-weight: 700; text-transform: uppercase;
          max-width: 2.2in; line-height: 1.1;
        }
        .item-id {
          font-size: 22px; font-weight: 800; font-family: 'Courier New', monospace;
        }
        .item-qr { display: flex; justify-content: center; padding: 0.15in 0; }
        .item-qr img { width: 2.6in; height: 2.6in; }
        .item-meta {
          font-size: 11px; line-height: 1.35; flex: 1;
          display: flex; flex-direction: column; gap: 0.06in;
        }
        .item-desc {
          font-size: 13px; font-weight: 600; margin-bottom: 0.08in;
          line-height: 1.2;
          display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
        }
        .item-row {
          display: flex; gap: 0.2in; flex-wrap: wrap;
        }
        .item-row strong { font-weight: 600; }

        /* ── Location label (3" × 2") ──────────────────────────────────── */
        .loc-label {
          width: 3in; height: 2in;
          display: flex; align-items: center; padding: 0.15in;
          background: #fff; color: #000;
          font-family: 'Inter', Arial, sans-serif;
          box-sizing: border-box;
          border: 1px solid ${theme.colors.border};
          gap: 0.15in;
        }
        .loc-left { flex: 1; display: flex; flex-direction: column; justify-content: center; overflow: hidden; }
        .loc-code {
          font-size: 36px; font-weight: 800; font-family: 'Courier New', monospace;
          letter-spacing: -0.02em; line-height: 1;
        }
        .loc-notes {
          font-size: 11px; color: #444; margin-top: 0.05in;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .loc-brand {
          font-size: 8px; color: #777; margin-top: auto; text-transform: uppercase; letter-spacing: 0.1em;
        }
        .loc-qr img { width: 1.55in; height: 1.55in; }

        /* ── Print rules ───────────────────────────────────────────────── */
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .labels-preview-container { background: #fff !important; padding: 0 !important; }
          .labels-grid { gap: 0 !important; }
          .stride-label {
            break-inside: avoid; page-break-inside: avoid;
            border: none !important; margin: 0;
          }
          .item-label { page-break-after: always; }
          .loc-label { page-break-after: always; }
          /* Make each label its own page at its native size */
          @page { margin: 0; }
        }
      `}</style>
    </div>
  );
}

function CheckIcon() {
  return <span style={{ display: 'inline-block', width: 12, height: 12, borderRadius: '50%', background: '#22C55E', verticalAlign: 'middle', marginRight: 4 }} />;
}
