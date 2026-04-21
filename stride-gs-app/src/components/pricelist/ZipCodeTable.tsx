/**
 * ZipCodeTable — renders inside PriceList when the "Zip Codes" category
 * is selected in the sidebar. Shows all delivery zones, filters by the
 * parent's search box (zip / city / zone), supports inline edit, and
 * exposes an add + delete path for admins.
 *
 * Editing model: click a row to toggle its own edit mode. While editing,
 * the row cells become inputs. Save persists via useDeliveryZones.update;
 * Cancel discards. Delete asks for a two-step confirm.
 */
import { useMemo, useState } from 'react';
import { Plus, Save, X, Trash2, AlertTriangle } from 'lucide-react';
import { theme } from '../../styles/theme';
import { useDeliveryZones, type DeliveryZone } from '../../hooks/useDeliveryZones';

interface Props {
  search: string;
}

type Draft = {
  city: string;
  serviceDays: string;
  updatedRate: string;
  zone: string;
  active: boolean;
  callForQuote: boolean;
  outOfArea: boolean;
  notes: string;
};

function zoneToDraft(z: DeliveryZone): Draft {
  return {
    city: z.city,
    serviceDays: z.serviceDays ?? '',
    updatedRate: z.updatedRate ? String(z.updatedRate) : '',
    zone: z.zone ?? '',
    active: z.active,
    callForQuote: z.callForQuote,
    outOfArea: z.outOfArea,
    notes: z.notes ?? '',
  };
}

export function ZipCodeTable({ search }: Props) {
  const v2 = theme.v2;
  const { zones, loading, error, add, update, remove } = useDeliveryZones();
  const [editingZip, setEditingZip] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteZip, setConfirmDeleteZip] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return zones;
    return zones.filter(z =>
      z.zipCode.toLowerCase().includes(q) ||
      z.city.toLowerCase().includes(q) ||
      (z.zone ?? '').toLowerCase().includes(q)
    );
  }, [zones, search]);

  const startEdit = (z: DeliveryZone) => {
    setEditingZip(z.zipCode);
    setDraft(zoneToDraft(z));
  };
  const cancelEdit = () => { setEditingZip(null); setDraft(null); };

  const saveEdit = async () => {
    if (!editingZip || !draft) return;
    setSaving(true);
    const ok = await update(editingZip, {
      city: draft.city.trim(),
      serviceDays: draft.serviceDays.trim() || null,
      updatedRate: draft.updatedRate ? Number(draft.updatedRate) : 0,
      zone: draft.zone.trim() || null,
      active: draft.active,
      callForQuote: draft.callForQuote,
      outOfArea: draft.outOfArea,
      notes: draft.notes.trim() || null,
    });
    setSaving(false);
    if (ok) cancelEdit();
  };

  const handleDelete = async (zip: string) => {
    if (confirmDeleteZip !== zip) {
      setConfirmDeleteZip(zip);
      setTimeout(() => setConfirmDeleteZip(current => (current === zip ? null : current)), 3000);
      return;
    }
    await remove(zip);
    setConfirmDeleteZip(null);
    if (editingZip === zip) cancelEdit();
  };

  // ── Summary stats ─────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = zones.length;
    const active = zones.filter(z => z.active && !z.outOfArea).length;
    const callForQuote = zones.filter(z => z.callForQuote).length;
    const outOfArea = zones.filter(z => z.outOfArea).length;
    return { total, active, callForQuote, outOfArea };
  }, [zones]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Header strip with add button + stat chips */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 16, flexWrap: 'wrap',
        padding: '14px 18px',
        background: v2.colors.bgWhite,
        border: `1px solid ${v2.colors.border}`,
        borderRadius: v2.radius.card,
      }}>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center' }}>
          <StatChip label="Zones" value={stats.total} />
          <StatChip label="Active" value={stats.active} />
          <StatChip label="Call for Quote" value={stats.callForQuote} />
          <StatChip label="Out of Area" value={stats.outOfArea} />
        </div>
        <button
          onClick={() => setShowAdd(true)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '9px 18px', borderRadius: v2.radius.button,
            background: v2.colors.accent, border: 'none', color: '#fff',
            cursor: 'pointer', fontSize: 11, fontWeight: 600, letterSpacing: '1.5px',
            textTransform: 'uppercase', fontFamily: 'inherit',
          }}
        >
          <Plus size={13} /> Add Zip
        </button>
      </div>

      {error && (
        <div style={{
          padding: '12px 16px',
          background: 'rgba(180,90,90,0.1)', color: '#B45A5A',
          borderRadius: v2.radius.input, fontSize: 13,
        }}>{error}</div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: v2.colors.textMuted, fontSize: 13 }}>Loading zones…</div>
      ) : (
        <div style={{
          background: v2.colors.bgWhite,
          border: `1px solid ${v2.colors.border}`,
          borderRadius: v2.radius.card,
          overflow: 'hidden',
        }}>
          {/* Header row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '90px 1fr 1.6fr 100px 70px 140px 130px',
            gap: 12,
            padding: '12px 18px',
            background: v2.colors.bgCard,
            borderBottom: `1px solid ${v2.colors.border}`,
            fontSize: 10, fontWeight: 700, letterSpacing: '1.5px',
            color: v2.colors.textMuted, textTransform: 'uppercase',
          }}>
            <div>Zip</div>
            <div>City</div>
            <div>Service Days</div>
            <div style={{ textAlign: 'right' }}>Rate</div>
            <div style={{ textAlign: 'center' }}>Zone</div>
            <div style={{ textAlign: 'center' }}>Status</div>
            <div style={{ textAlign: 'right' }}>Actions</div>
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: v2.colors.textMuted, fontSize: 13 }}>
              {search ? `No zones match "${search}".` : 'No zones.'}
            </div>
          ) : (
            filtered.map(z => {
              const editing = editingZip === z.zipCode;
              return editing && draft ? (
                <EditableRow
                  key={z.zipCode}
                  zone={z}
                  draft={draft}
                  onDraftChange={setDraft}
                  onSave={saveEdit}
                  onCancel={cancelEdit}
                  saving={saving}
                />
              ) : (
                <ReadOnlyRow
                  key={z.zipCode}
                  zone={z}
                  onEdit={() => startEdit(z)}
                  onDelete={() => handleDelete(z.zipCode)}
                  confirmDelete={confirmDeleteZip === z.zipCode}
                />
              );
            })
          )}
        </div>
      )}

      {showAdd && (
        <AddZipModal
          existingZips={new Set(zones.map(z => z.zipCode))}
          onClose={() => setShowAdd(false)}
          onCreate={async payload => {
            const created = await add(payload);
            if (created) setShowAdd(false);
            return !!created;
          }}
        />
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function StatChip({ label, value }: { label: string; value: number }) {
  const v2 = theme.v2;
  return (
    <div>
      <div style={{
        fontSize: 9, fontWeight: 700, letterSpacing: '2px',
        color: v2.colors.textMuted, textTransform: 'uppercase',
      }}>{label}</div>
      <div style={{
        fontSize: 20, fontWeight: 300, marginTop: 2,
        color: v2.colors.text, fontVariantNumeric: 'tabular-nums',
      }}>{value}</div>
    </div>
  );
}

function ReadOnlyRow({ zone, onEdit, onDelete, confirmDelete }: {
  zone: DeliveryZone;
  onEdit: () => void;
  onDelete: () => void;
  confirmDelete: boolean;
}) {
  const v2 = theme.v2;
  const dimmed = !zone.active || zone.outOfArea;
  const rateDisplay = zone.callForQuote ? 'Quote' : (zone.updatedRate ? `$${zone.updatedRate}` : '—');
  return (
    <div
      onClick={onEdit}
      style={{
        display: 'grid',
        gridTemplateColumns: '90px 1fr 1.6fr 100px 70px 140px 130px',
        gap: 12,
        padding: '10px 18px',
        borderBottom: `1px solid ${v2.colors.border}`,
        fontSize: 13,
        color: dimmed ? v2.colors.textMuted : v2.colors.text,
        cursor: 'pointer',
        alignItems: 'center',
        transition: 'background 0.12s',
      }}
      onMouseEnter={e => e.currentTarget.style.background = v2.colors.bgCard}
      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
    >
      <div style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: v2.colors.accent }}>{zone.zipCode}</div>
      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{zone.city}</div>
      <div style={{
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        color: v2.colors.textSecondary, fontSize: 12,
      }}>{zone.serviceDays || '—'}</div>
      <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{rateDisplay}</div>
      <div style={{ textAlign: 'center' }}>
        <span style={{
          padding: '2px 8px', borderRadius: v2.radius.badge,
          background: v2.colors.bgCard, fontSize: 11, fontWeight: 600,
          color: v2.colors.textSecondary,
        }}>{zone.zone || '—'}</span>
      </div>
      <div style={{ textAlign: 'center' }}>
        <StatusPill zone={zone} />
      </div>
      <div style={{ textAlign: 'right', display: 'flex', justifyContent: 'flex-end', gap: 6 }} onClick={e => e.stopPropagation()}>
        <button
          onClick={onEdit}
          style={iconBtnStyle(v2, false)}
        >Edit</button>
        <button
          onClick={onDelete}
          style={{
            ...iconBtnStyle(v2, confirmDelete),
            color: confirmDelete ? '#fff' : '#B45A5A',
            background: confirmDelete ? '#B45A5A' : 'transparent',
            borderColor: confirmDelete ? '#B45A5A' : 'rgba(180,90,90,0.35)',
          }}
          title={confirmDelete ? 'Click again to confirm' : 'Delete'}
        >
          {confirmDelete ? <AlertTriangle size={11} /> : <Trash2 size={11} />}
        </button>
      </div>
    </div>
  );
}

function EditableRow({ zone, draft, onDraftChange, onSave, onCancel, saving }: {
  zone: DeliveryZone;
  draft: Draft;
  onDraftChange: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const v2 = theme.v2;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onDraftChange({ ...draft, [k]: v });

  return (
    <div style={{
      padding: '14px 18px',
      borderBottom: `1px solid ${v2.colors.border}`,
      background: 'rgba(232,105,42,0.04)',
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 1.6fr 100px 70px auto', gap: 12, alignItems: 'center' }}>
        <div style={{ fontWeight: 600, fontSize: 13, color: v2.colors.text, fontVariantNumeric: 'tabular-nums' }}>
          {zone.zipCode}
        </div>
        <input value={draft.city} onChange={e => set('city', e.target.value)} style={inputStyle(v2)} placeholder="City" />
        <input value={draft.serviceDays} onChange={e => set('serviceDays', e.target.value)} style={inputStyle(v2)} placeholder="Service days" />
        <input
          value={draft.updatedRate}
          onChange={e => set('updatedRate', e.target.value.replace(/[^\d.]/g, ''))}
          style={{ ...inputStyle(v2), textAlign: 'right' }}
          placeholder="Rate"
          inputMode="decimal"
        />
        <input value={draft.zone} onChange={e => set('zone', e.target.value)} style={{ ...inputStyle(v2), textAlign: 'center' }} placeholder="Zone" />
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button onClick={onSave} disabled={saving} style={{
            ...iconBtnStyle(v2, true),
            background: v2.colors.accent, color: '#fff', borderColor: v2.colors.accent,
            cursor: saving ? 'wait' : 'pointer',
          }}>
            <Save size={11} /> {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onCancel} disabled={saving} style={iconBtnStyle(v2, false)}>
            <X size={11} /> Cancel
          </button>
        </div>
      </div>
      {/* Flags row */}
      <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Toggle label="Active" checked={draft.active} onChange={v => set('active', v)} />
        <Toggle label="Call For Quote" checked={draft.callForQuote} onChange={v => set('callForQuote', v)} />
        <Toggle label="Out of Area" checked={draft.outOfArea} onChange={v => set('outOfArea', v)} />
        <input
          value={draft.notes}
          onChange={e => set('notes', e.target.value)}
          style={{ ...inputStyle(v2), flex: 1, minWidth: 240 }}
          placeholder="Notes (optional)"
        />
      </div>
    </div>
  );
}

function StatusPill({ zone }: { zone: DeliveryZone }) {
  const v2 = theme.v2;
  let text = 'Active';
  let bg = 'rgba(74,138,92,0.12)';
  let color = '#2F6B42';
  if (!zone.active || zone.outOfArea) { text = 'Out of Area'; bg = v2.colors.bgCard; color = v2.colors.textMuted; }
  else if (zone.callForQuote) { text = 'Call for Quote'; bg = 'rgba(232,105,42,0.14)'; color = '#B34710'; }
  return (
    <span style={{
      display: 'inline-block', padding: '3px 9px', borderRadius: v2.radius.badge,
      background: bg, color, fontSize: 10, fontWeight: 700, letterSpacing: '0.5px',
      textTransform: 'uppercase',
    }}>{text}</span>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const v2 = theme.v2;
  return (
    <button
      onClick={() => onChange(!checked)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 8,
        padding: '6px 12px', borderRadius: v2.radius.input,
        background: checked ? 'rgba(232,105,42,0.10)' : v2.colors.bgWhite,
        border: `1px solid ${checked ? v2.colors.accent : v2.colors.border}`,
        color: v2.colors.text, cursor: 'pointer', fontFamily: 'inherit',
        fontSize: 11, fontWeight: 600, letterSpacing: '1.2px', textTransform: 'uppercase',
      }}
    >
      <span>{label}</span>
      <div style={{
        position: 'relative', width: 26, height: 15,
        background: checked ? v2.colors.accent : '#D4D0CA',
        borderRadius: 100, transition: 'background 0.15s', flexShrink: 0,
      }}>
        <div style={{
          position: 'absolute', top: 2, left: checked ? 13 : 2,
          width: 11, height: 11, borderRadius: '50%', background: '#fff',
          transition: 'left 0.15s',
        }} />
      </div>
    </button>
  );
}

function iconBtnStyle(v2: typeof theme.v2, active: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '6px 11px', borderRadius: v2.radius.button,
    background: active ? v2.colors.accent : v2.colors.bgWhite,
    border: `1px solid ${active ? v2.colors.accent : v2.colors.border}`,
    color: active ? '#fff' : v2.colors.text, cursor: 'pointer',
    fontSize: 10, fontWeight: 700, letterSpacing: '1.2px',
    textTransform: 'uppercase', fontFamily: 'inherit',
  };
}

function inputStyle(v2: typeof theme.v2): React.CSSProperties {
  return {
    padding: '8px 10px', borderRadius: v2.radius.input,
    border: `1px solid ${v2.colors.border}`, fontSize: 13,
    background: v2.colors.bgWhite, outline: 'none',
    color: v2.colors.text, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
  };
}

// ─── Add Zip Modal ───────────────────────────────────────────────────────

function AddZipModal({ existingZips, onClose, onCreate }: {
  existingZips: Set<string>;
  onClose: () => void;
  onCreate: (payload: { zipCode: string; city: string; serviceDays: string | null; updatedRate: number; zone: string | null; active: boolean; callForQuote: boolean; outOfArea: boolean; notes: string | null }) => Promise<boolean>;
}) {
  const v2 = theme.v2;
  const [zip, setZip] = useState('');
  const [city, setCity] = useState('');
  const [serviceDays, setServiceDays] = useState('');
  const [updatedRate, setUpdatedRate] = useState('');
  const [zone, setZone] = useState('');
  const [active, setActive] = useState(true);
  const [callForQuote, setCallForQuote] = useState(false);
  const [outOfArea, setOutOfArea] = useState(false);
  const [notes, setNotes] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const canSave = /^\d{5}$/.test(zip.trim()) && city.trim().length > 0 && !existingZips.has(zip.trim());

  const handleCreate = async () => {
    if (!canSave) return;
    setSaving(true); setErr(null);
    const ok = await onCreate({
      zipCode: zip.trim(),
      city: city.trim(),
      serviceDays: serviceDays.trim() || null,
      updatedRate: updatedRate ? Number(updatedRate) : 0,
      zone: zone.trim() || null,
      active,
      callForQuote,
      outOfArea,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (!ok) setErr('Failed to create — check permissions and retry.');
  };

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}
    >
      <div style={{ background: v2.colors.bgWhite, borderRadius: v2.radius.card, padding: 32, width: '100%', maxWidth: 520, boxShadow: '0 24px 60px rgba(0,0,0,0.22)', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: v2.colors.text }}>Add Zip Code</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: v2.colors.textMuted }}><X size={18} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10 }}>
          <Field label="Zip *">
            <input value={zip} onChange={e => setZip(e.target.value.replace(/\D/g, '').slice(0, 5))} style={inputStyle(v2)} placeholder="98001" />
          </Field>
          <Field label="City *">
            <input value={city} onChange={e => setCity(e.target.value)} style={inputStyle(v2)} placeholder="Auburn" />
          </Field>
        </div>
        <Field label="Service Days">
          <input value={serviceDays} onChange={e => setServiceDays(e.target.value)} style={inputStyle(v2)} placeholder="TUE / THUR" />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Rate">
            <input value={updatedRate} onChange={e => setUpdatedRate(e.target.value.replace(/[^\d.]/g, ''))} style={inputStyle(v2)} inputMode="decimal" placeholder="185" />
          </Field>
          <Field label="Zone">
            <input value={zone} onChange={e => setZone(e.target.value)} style={inputStyle(v2)} placeholder="8" />
          </Field>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Toggle label="Active" checked={active} onChange={setActive} />
          <Toggle label="Call For Quote" checked={callForQuote} onChange={setCallForQuote} />
          <Toggle label="Out of Area" checked={outOfArea} onChange={setOutOfArea} />
        </div>
        <Field label="Notes">
          <input value={notes} onChange={e => setNotes(e.target.value)} style={inputStyle(v2)} placeholder="Optional" />
        </Field>
        {existingZips.has(zip.trim()) && zip.trim().length === 5 && (
          <div style={{ padding: '8px 12px', background: 'rgba(180,90,90,0.08)', border: '1px solid rgba(180,90,90,0.3)', color: '#B45A5A', borderRadius: v2.radius.input, fontSize: 12 }}>
            That zip is already in the list — edit it inline instead.
          </div>
        )}
        {err && (
          <div style={{ padding: '8px 12px', background: 'rgba(180,90,90,0.08)', border: '1px solid rgba(180,90,90,0.3)', color: '#B45A5A', borderRadius: v2.radius.input, fontSize: 12 }}>{err}</div>
        )}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 6 }}>
          <button onClick={onClose} style={{ padding: '10px 20px', borderRadius: v2.radius.button, border: `1px solid ${v2.colors.border}`, background: 'transparent', color: v2.colors.textSecondary, fontSize: 11, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
          <button onClick={handleCreate} disabled={!canSave || saving} style={{ padding: '10px 24px', borderRadius: v2.radius.button, border: 'none', background: !canSave || saving ? v2.colors.textMuted : v2.colors.accent, color: '#fff', fontSize: 11, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase', cursor: canSave && !saving ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
            {saving ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  const v2 = theme.v2;
  return (
    <div>
      <div style={{ ...v2.typography.label, marginBottom: 5 }}>{label}</div>
      {children}
    </div>
  );
}
