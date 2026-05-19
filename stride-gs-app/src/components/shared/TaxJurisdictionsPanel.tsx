/**
 * TaxJurisdictionsPanel — admin management for public.tax_jurisdictions.
 *
 * Renders inside Settings → Pricing (admin only). This is the single
 * place the system-wide default sales-tax rate is set; useDefaultTaxRate
 * (DO modal, public service-request form) reads the is_default row, and
 * per-client overrides on clients.tax_rate_pct take precedence over it.
 *
 * - Inline-edit a rate by clicking it.
 * - Star toggles which jurisdiction is the default (the partial unique
 *   index allows exactly one; setDefaultTaxJurisdiction clears the old
 *   one first).
 * - The default row cannot be deleted (the app needs a fallback).
 */
import { useEffect, useState } from 'react';
import { Star, Trash2, Plus, Loader2, AlertTriangle, Check, X } from 'lucide-react';
import { theme } from '../../styles/theme';
import {
  fetchTaxJurisdictions,
  createTaxJurisdiction,
  updateTaxJurisdiction,
  deleteTaxJurisdiction,
  setDefaultTaxJurisdiction,
  type TaxJurisdiction,
} from '../../lib/supabaseQueries';

const cell: React.CSSProperties = {
  padding: '10px 12px',
  fontSize: 12,
  color: theme.colors.text,
  borderBottom: `1px solid ${theme.colors.borderLight}`,
  textAlign: 'left',
};
const th: React.CSSProperties = {
  ...cell,
  fontSize: 10,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
  color: theme.colors.textMuted,
  borderBottom: `1px solid ${theme.colors.border}`,
};
const inp: React.CSSProperties = {
  padding: '6px 8px',
  fontSize: 12,
  border: `1px solid ${theme.colors.border}`,
  borderRadius: 6,
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};

export function TaxJurisdictionsPanel() {
  const [rows, setRows] = useState<TaxJurisdiction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Inline rate edit
  const [editId, setEditId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState('');

  // Add form
  const [adding, setAdding] = useState(false);
  const [nCity, setNCity] = useState('');
  const [nState, setNState] = useState('WA');
  const [nRate, setNRate] = useState('');
  const [nEff, setNEff] = useState('');
  const [addBusy, setAddBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const list = await fetchTaxJurisdictions();
    setRows(list);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const flash = (msg: string) => { setError(msg); setTimeout(() => setError(prev => prev === msg ? null : prev), 4000); };

  const startEdit = (j: TaxJurisdiction) => { setEditId(j.id); setEditRate(String(j.ratePct)); };
  const cancelEdit = () => { setEditId(null); setEditRate(''); };

  const saveRate = async (j: TaxJurisdiction) => {
    const val = Number(editRate);
    if (!Number.isFinite(val) || val < 0 || val > 100) { flash('Rate must be a number between 0 and 100.'); return; }
    setBusyId(j.id);
    const res = await updateTaxJurisdiction(j.id, { ratePct: val });
    setBusyId(null);
    if (!res.ok) { flash(res.error); return; }
    cancelEdit();
    load();
  };

  const makeDefault = async (j: TaxJurisdiction) => {
    if (j.isDefault) return;
    setBusyId(j.id);
    const res = await setDefaultTaxJurisdiction(j.id);
    setBusyId(null);
    if (!res.ok) { flash(res.error); return; }
    load();
  };

  const remove = async (j: TaxJurisdiction) => {
    if (j.isDefault) { flash('Cannot delete the default jurisdiction. Set another as default first.'); return; }
    if (!window.confirm(`Delete ${j.city}, ${j.state} (${j.ratePct}%)?`)) return;
    setBusyId(j.id);
    const res = await deleteTaxJurisdiction(j.id);
    setBusyId(null);
    if (!res.ok) { flash(res.error); return; }
    load();
  };

  const addRow = async () => {
    const val = Number(nRate);
    if (!nCity.trim()) { flash('City is required.'); return; }
    if (!nState.trim()) { flash('State is required.'); return; }
    if (!Number.isFinite(val) || val < 0 || val > 100) { flash('Rate must be a number between 0 and 100.'); return; }
    setAddBusy(true);
    const res = await createTaxJurisdiction({
      city: nCity.trim(),
      state: nState.trim().toUpperCase(),
      ratePct: val,
      effectiveDate: nEff || null,
    });
    setAddBusy(false);
    if (!res.ok) { flash(res.error); return; }
    setNCity(''); setNState('WA'); setNRate(''); setNEff(''); setAdding(false);
    load();
  };

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: theme.colors.text }}>Tax Rates</div>
          <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 2 }}>
            The starred jurisdiction is the system default. Delivery orders and the public
            service-request form use it unless a client has a custom rate.
          </div>
        </div>
        {!adding && (
          <button
            onClick={() => setAdding(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '7px 14px', fontSize: 12,
              fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer', borderRadius: 8,
              border: `1px solid ${theme.colors.orange}`, background: theme.colors.orangeLight,
              color: theme.colors.orange,
            }}
          >
            <Plus size={13} /> Add Jurisdiction
          </button>
        )}
      </div>

      {error && (
        <div style={{ margin: '10px 0', padding: 8, borderRadius: 6, background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C', fontSize: 11 }}>
          <AlertTriangle size={11} style={{ verticalAlign: '-1px', marginRight: 4 }} /> {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: theme.colors.textMuted, fontSize: 12 }}>
          <Loader2 size={14} style={{ animation: 'spin 1s linear infinite', verticalAlign: '-2px', marginRight: 6 }} /> Loading…
        </div>
      ) : (
        <div style={{ border: `1px solid ${theme.colors.border}`, borderRadius: 10, overflow: 'hidden', marginTop: 12 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: 44, textAlign: 'center' }}>Default</th>
                <th style={th}>City</th>
                <th style={{ ...th, width: 70 }}>State</th>
                <th style={{ ...th, width: 130 }}>Rate %</th>
                <th style={{ ...th, width: 140 }}>Effective</th>
                <th style={{ ...th, width: 60, textAlign: 'center' }}></th>
              </tr>
            </thead>
            <tbody>
              {adding && (
                <tr style={{ background: theme.colors.orangeLight }}>
                  <td style={{ ...cell, textAlign: 'center' }}>—</td>
                  <td style={cell}><input style={inp} placeholder="City" value={nCity} onChange={e => setNCity(e.target.value)} autoFocus /></td>
                  <td style={cell}><input style={inp} placeholder="WA" value={nState} onChange={e => setNState(e.target.value)} maxLength={2} /></td>
                  <td style={cell}><input style={inp} placeholder="10.4" value={nRate} onChange={e => setNRate(e.target.value)} inputMode="decimal" /></td>
                  <td style={cell}><input style={inp} type="date" value={nEff} onChange={e => setNEff(e.target.value)} /></td>
                  <td style={{ ...cell, textAlign: 'center', whiteSpace: 'nowrap' }}>
                    <button onClick={addRow} disabled={addBusy} title="Save" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#15803D', padding: 4 }}>
                      {addBusy ? <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={15} />}
                    </button>
                    <button onClick={() => { setAdding(false); setNCity(''); setNRate(''); setNEff(''); }} title="Cancel" style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 4 }}>
                      <X size={15} />
                    </button>
                  </td>
                </tr>
              )}
              {rows.map(j => {
                const isBusy = busyId === j.id;
                return (
                  <tr key={j.id} style={j.isDefault ? { background: '#FFFBEB' } : undefined}>
                    <td style={{ ...cell, textAlign: 'center' }}>
                      <button
                        onClick={() => makeDefault(j)}
                        disabled={isBusy || j.isDefault}
                        title={j.isDefault ? 'Current default' : 'Set as default'}
                        style={{
                          background: 'none', border: 'none', padding: 2,
                          cursor: j.isDefault ? 'default' : 'pointer',
                          color: j.isDefault ? '#F59E0B' : theme.colors.textMuted,
                        }}
                      >
                        <Star size={15} fill={j.isDefault ? '#F59E0B' : 'none'} />
                      </button>
                    </td>
                    <td style={cell}>{j.city}</td>
                    <td style={cell}>{j.state}</td>
                    <td style={cell}>
                      {editId === j.id ? (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <input
                            style={{ ...inp, width: 64 }}
                            value={editRate}
                            onChange={e => setEditRate(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') saveRate(j); if (e.key === 'Escape') cancelEdit(); }}
                            inputMode="decimal"
                            autoFocus
                          />
                          <button onClick={() => saveRate(j)} disabled={isBusy} title="Save" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#15803D', padding: 2 }}>
                            {isBusy ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={14} />}
                          </button>
                          <button onClick={cancelEdit} title="Cancel" style={{ background: 'none', border: 'none', cursor: 'pointer', color: theme.colors.textMuted, padding: 2 }}>
                            <X size={14} />
                          </button>
                        </span>
                      ) : (
                        <span
                          onClick={() => startEdit(j)}
                          title="Click to edit"
                          style={{ cursor: 'pointer', borderBottom: `1px dashed ${theme.colors.border}`, paddingBottom: 1 }}
                        >
                          {j.ratePct}%
                        </span>
                      )}
                    </td>
                    <td style={cell}>{j.effectiveDate || <span style={{ color: theme.colors.textMuted }}>—</span>}</td>
                    <td style={{ ...cell, textAlign: 'center' }}>
                      <button
                        onClick={() => remove(j)}
                        disabled={isBusy || j.isDefault}
                        title={j.isDefault ? 'Cannot delete the default jurisdiction' : 'Delete'}
                        style={{
                          background: 'none', border: 'none', padding: 4,
                          cursor: j.isDefault ? 'not-allowed' : 'pointer',
                          color: j.isDefault ? theme.colors.border : '#B91C1C',
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && !adding && (
                <tr><td colSpan={6} style={{ ...cell, textAlign: 'center', color: theme.colors.textMuted, padding: 20 }}>No tax jurisdictions yet. Add one to set the default rate.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
