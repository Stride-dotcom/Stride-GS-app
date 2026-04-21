/**
 * CoverageTable — inline-edit table for `public.coverage_options`.
 * Renders inside PriceList when the "Coverage" category is selected.
 *
 * Every editable field (name, calc type, rate, note, active) writes
 * through useCoverageOptions.update — which hits the same Supabase
 * table the Quote Tool reads. A single edit here propagates to every
 * downstream page that consumes `coverage_options` (Quote Tool,
 * delivery pricing, public rates page) on the next render via
 * realtime.
 */
import { useMemo, useState } from 'react';
import { Save, X, AlertTriangle } from 'lucide-react';
import { theme } from '../../styles/theme';
import { useCoverageOptions, formatCoverageRate, type CoverageOption, type CoverageCalcType } from '../../hooks/useCoverageOptions';

interface Props {
  search: string;
}

type Draft = {
  name: string;
  calcType: CoverageCalcType;
  rate: string;
  note: string;
  active: boolean;
  taxable: boolean;
};

function optionToDraft(o: CoverageOption): Draft {
  return {
    name: o.name,
    calcType: o.calcType,
    rate: o.rate > 0 || o.calcType === 'included' ? String(o.rate) : '',
    note: o.note ?? '',
    active: o.active,
    taxable: o.taxable,
  };
}

const CALC_TYPE_LABEL: Record<CoverageCalcType, string> = {
  per_lb:           '$ / lb',
  percent_declared: '% of declared',
  flat:             '$ flat',
  included:         'Included',
};

export function CoverageTable({ search }: Props) {
  const v2 = theme.v2;
  const { options, loading, error, update } = useCoverageOptions();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter(o =>
      o.id.toLowerCase().includes(q) ||
      o.name.toLowerCase().includes(q) ||
      (o.note ?? '').toLowerCase().includes(q)
    );
  }, [options, search]);

  const startEdit = (o: CoverageOption) => {
    setEditingId(o.id);
    setDraft(optionToDraft(o));
  };
  const cancelEdit = () => { setEditingId(null); setDraft(null); };

  const saveEdit = async () => {
    if (!editingId || !draft) return;
    setSaving(true);
    const ok = await update(editingId, {
      name: draft.name.trim(),
      calcType: draft.calcType,
      rate: draft.rate ? Number(draft.rate) : 0,
      note: draft.note.trim() || null,
      active: draft.active,
      taxable: draft.taxable,
    });
    setSaving(false);
    if (ok) cancelEdit();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{
        background: v2.colors.bgWhite,
        border: `1px solid ${v2.colors.border}`,
        borderRadius: v2.radius.card,
        padding: '14px 18px',
        fontSize: 12, color: v2.colors.textSecondary, lineHeight: 1.6,
      }}>
        Coverage rates power the Quote Tool, delivery pricing, and the public rate sheet. Edit here and every downstream page picks up the new numbers automatically.
        <br />
        <strong>Handling valuation</strong> (rows 1–3) is elected per-shipment at receipt. <strong>Storage coverage</strong> (row 4) is monthly — see the note column.
      </div>

      {error && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '12px 16px',
          background: 'rgba(180,90,90,0.1)', color: '#B45A5A',
          borderRadius: v2.radius.input, fontSize: 13,
        }}>
          <AlertTriangle size={14} /> {error}
        </div>
      )}

      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: v2.colors.textMuted, fontSize: 13 }}>Loading coverage…</div>
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
            gridTemplateColumns: '120px 1.4fr 140px 110px 1.6fr 90px 130px',
            gap: 12,
            padding: '12px 18px',
            background: v2.colors.bgCard,
            borderBottom: `1px solid ${v2.colors.border}`,
            fontSize: 10, fontWeight: 700, letterSpacing: '1.5px',
            color: v2.colors.textMuted, textTransform: 'uppercase',
          }}>
            <div>Code</div>
            <div>Name</div>
            <div>Calc Type</div>
            <div style={{ textAlign: 'right' }}>Rate</div>
            <div>Note</div>
            <div style={{ textAlign: 'center' }}>Status</div>
            <div style={{ textAlign: 'right' }}>Actions</div>
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: v2.colors.textMuted, fontSize: 13 }}>
              {search ? `No coverage options match "${search}".` : 'No coverage options.'}
            </div>
          ) : (
            filtered.map(o => {
              const editing = editingId === o.id;
              return editing && draft ? (
                <EditableRow
                  key={o.id}
                  option={o}
                  draft={draft}
                  onDraftChange={setDraft}
                  onSave={saveEdit}
                  onCancel={cancelEdit}
                  saving={saving}
                />
              ) : (
                <ReadOnlyRow
                  key={o.id}
                  option={o}
                  onEdit={() => startEdit(o)}
                />
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────

function ReadOnlyRow({ option, onEdit }: { option: CoverageOption; onEdit: () => void }) {
  const v2 = theme.v2;
  const dimmed = !option.active;
  return (
    <div
      onClick={onEdit}
      style={{
        display: 'grid',
        gridTemplateColumns: '120px 1.4fr 140px 110px 1.6fr 90px 130px',
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
      <div style={{ fontFamily: 'monospace', fontSize: 12, color: v2.colors.textMuted }}>{option.id}</div>
      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
        {option.name}
      </div>
      <div style={{ fontSize: 11, color: v2.colors.textSecondary }}>{CALC_TYPE_LABEL[option.calcType]}</div>
      <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
        {formatCoverageRate(option)}
      </div>
      <div style={{
        fontSize: 11, color: v2.colors.textSecondary, lineHeight: 1.45,
        whiteSpace: 'normal', overflow: 'hidden', textOverflow: 'ellipsis',
        display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
      }}>{option.note || '—'}</div>
      <div style={{ textAlign: 'center' }}>
        <StatusPill active={option.active} />
      </div>
      <div style={{ textAlign: 'right', display: 'flex', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
        <button onClick={onEdit} style={iconBtn(v2, false)}>Edit</button>
      </div>
    </div>
  );
}

function EditableRow({ option, draft, onDraftChange, onSave, onCancel, saving }: {
  option: CoverageOption;
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
      <div style={{ display: 'grid', gridTemplateColumns: '120px 1.4fr 140px 110px auto', gap: 12, alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontFamily: 'monospace', fontSize: 12, color: v2.colors.textMuted }}>{option.id}</div>
        <input value={draft.name} onChange={e => set('name', e.target.value)} style={inputStyle(v2)} placeholder="Coverage name" />
        <select
          value={draft.calcType}
          onChange={e => set('calcType', e.target.value as CoverageCalcType)}
          style={{ ...inputStyle(v2), cursor: 'pointer' }}
        >
          <option value="per_lb">$ per lb</option>
          <option value="percent_declared">% of declared</option>
          <option value="flat">$ flat</option>
          <option value="included">Included</option>
        </select>
        <input
          value={draft.rate}
          onChange={e => set('rate', e.target.value.replace(/[^\d.]/g, ''))}
          style={{ ...inputStyle(v2), textAlign: 'right' }}
          placeholder="Rate"
          inputMode="decimal"
          disabled={draft.calcType === 'included'}
        />
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button onClick={onSave} disabled={saving} style={{
            ...iconBtn(v2, true),
            background: v2.colors.accent, color: '#fff', borderColor: v2.colors.accent,
            cursor: saving ? 'wait' : 'pointer',
          }}>
            <Save size={11} /> {saving ? 'Saving…' : 'Save'}
          </button>
          <button onClick={onCancel} disabled={saving} style={iconBtn(v2, false)}>
            <X size={11} /> Cancel
          </button>
        </div>
      </div>
      <textarea
        value={draft.note}
        onChange={e => set('note', e.target.value)}
        style={{ ...inputStyle(v2), resize: 'vertical', minHeight: 50, fontFamily: 'inherit' }}
        placeholder="Note (billing cadence, deductible details, etc.)"
        rows={2}
      />
      <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center' }}>
        <ToggleBtn label="Active" checked={draft.active} onChange={v => set('active', v)} />
        <ToggleBtn label="Taxable" checked={draft.taxable} onChange={v => set('taxable', v)} />
      </div>
    </div>
  );
}

function StatusPill({ active }: { active: boolean }) {
  const v2 = theme.v2;
  const bg = active ? 'rgba(74,138,92,0.12)' : v2.colors.bgCard;
  const color = active ? '#2F6B42' : v2.colors.textMuted;
  return (
    <span style={{
      display: 'inline-block', padding: '3px 9px', borderRadius: v2.radius.badge,
      background: bg, color, fontSize: 10, fontWeight: 700, letterSpacing: '0.5px',
      textTransform: 'uppercase',
    }}>{active ? 'Active' : 'Inactive'}</span>
  );
}

function ToggleBtn({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
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

function iconBtn(v2: typeof theme.v2, active: boolean): React.CSSProperties {
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
