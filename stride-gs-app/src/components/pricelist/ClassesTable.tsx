/**
 * ClassesTable — renders inside PriceList when the "Classes" category is
 * selected. Shows every row in public.item_classes with inline-edit for
 * name / storage size / active flag. Admin only.
 *
 * Storage size is the authoritative cubic-foot value used by storage
 * billing (`STOR` rate × class.storage_size × item qty). Editing it here
 * is live — rate lookups on the next storage-charge run will use the new
 * number. There's no separate "Sync to Sheet" step for classes today
 * because the Master Price List Class_Map is treated as the legacy
 * fallback; GAS's api_loadClassVolumes_ reads Supabase primary via the
 * Phase 5 shadow-mode path.
 */
import { useMemo, useState } from 'react';
import { Save, X, AlertTriangle } from 'lucide-react';
import { theme } from '../../styles/theme';
import { useItemClasses, type ItemClass } from '../../hooks/useItemClasses';

interface Props {
  search: string;
}

type Draft = {
  name: string;
  storageSize: string;
  active: boolean;
};

function classToDraft(c: ItemClass): Draft {
  return {
    name: c.name,
    storageSize: c.storageSize > 0 ? String(c.storageSize) : '',
    active: c.active,
  };
}

export function ClassesTable({ search }: Props) {
  const v2 = theme.v2;
  const { classes, loading, error, update } = useItemClasses();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return classes;
    return classes.filter(c =>
      c.id.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q)
    );
  }, [classes, search]);

  const startEdit = (c: ItemClass) => {
    setEditingId(c.id);
    setDraft(classToDraft(c));
  };
  const cancelEdit = () => { setEditingId(null); setDraft(null); };

  const saveEdit = async () => {
    if (!editingId || !draft) return;
    setSaving(true);
    const ok = await update(editingId, {
      name: draft.name.trim(),
      storageSize: draft.storageSize ? Number(draft.storageSize) : 0,
      active: draft.active,
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
        fontSize: 12, color: v2.colors.textSecondary,
      }}>
        Item classes feed storage billing: <strong>STOR × storage size × qty</strong>.
        Edit the storage size to change the cubic-foot multiplier used by every future
        storage run.
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
        <div style={{ padding: 40, textAlign: 'center', color: v2.colors.textMuted, fontSize: 13 }}>Loading classes…</div>
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
            gridTemplateColumns: '80px 1.4fr 120px 100px 150px',
            gap: 12,
            padding: '12px 18px',
            background: v2.colors.bgCard,
            borderBottom: `1px solid ${v2.colors.border}`,
            fontSize: 10, fontWeight: 700, letterSpacing: '1.5px',
            color: v2.colors.textMuted, textTransform: 'uppercase',
          }}>
            <div>Class</div>
            <div>Name</div>
            <div style={{ textAlign: 'right' }}>Storage Size</div>
            <div style={{ textAlign: 'center' }}>Status</div>
            <div style={{ textAlign: 'right' }}>Actions</div>
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: v2.colors.textMuted, fontSize: 13 }}>
              {search ? `No classes match "${search}".` : 'No classes.'}
            </div>
          ) : (
            filtered.map(c => {
              const editing = editingId === c.id;
              return editing && draft ? (
                <EditableRow
                  key={c.id}
                  cls={c}
                  draft={draft}
                  onDraftChange={setDraft}
                  onSave={saveEdit}
                  onCancel={cancelEdit}
                  saving={saving}
                />
              ) : (
                <ReadOnlyRow
                  key={c.id}
                  cls={c}
                  onEdit={() => startEdit(c)}
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

function ReadOnlyRow({ cls, onEdit }: { cls: ItemClass; onEdit: () => void }) {
  const v2 = theme.v2;
  const dimmed = !cls.active;
  return (
    <div
      onClick={onEdit}
      style={{
        display: 'grid',
        gridTemplateColumns: '80px 1.4fr 120px 100px 150px',
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
      <div style={{ fontWeight: 700, letterSpacing: '0.5px', color: v2.colors.accent }}>{cls.id}</div>
      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cls.name}</div>
      <div style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
        {cls.storageSize > 0 ? `${cls.storageSize} cu ft` : '—'}
      </div>
      <div style={{ textAlign: 'center' }}>
        <StatusPill active={cls.active} />
      </div>
      <div style={{ textAlign: 'right', display: 'flex', justifyContent: 'flex-end' }} onClick={e => e.stopPropagation()}>
        <button onClick={onEdit} style={iconBtn(v2, false)}>Edit</button>
      </div>
    </div>
  );
}

function EditableRow({ cls, draft, onDraftChange, onSave, onCancel, saving }: {
  cls: ItemClass;
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
      <div style={{ display: 'grid', gridTemplateColumns: '80px 1.4fr 120px auto', gap: 12, alignItems: 'center' }}>
        <div style={{ fontWeight: 700, letterSpacing: '0.5px', color: v2.colors.text }}>{cls.id}</div>
        <input value={draft.name} onChange={e => set('name', e.target.value)} style={inputStyle(v2)} placeholder="Class name" />
        <input
          value={draft.storageSize}
          onChange={e => set('storageSize', e.target.value.replace(/[^\d.]/g, ''))}
          style={{ ...inputStyle(v2), textAlign: 'right' }}
          placeholder="cu ft"
          inputMode="decimal"
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
      <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center' }}>
        <ToggleBtn label="Active" checked={draft.active} onChange={v => set('active', v)} />
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
