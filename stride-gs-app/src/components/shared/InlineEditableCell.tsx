/**
 * InlineEditableCell — click-to-edit cell for TanStack Table rows.
 *
 * Display mode shows the value. Click enters edit mode:
 *   - text variant              → plain input
 *   - autocomplete-db variant   → input + filtered-suggestions dropdown backed by
 *                                 per-client Autocomplete_DB (vendor/sidemark/description)
 *   - autocomplete-locations    → input + filtered-suggestions backed by Supabase
 *                                 public.locations (tenant-agnostic, warehouse-wide)
 *
 * Keys: Enter saves, Esc cancels, blur saves (clicking a suggestion saves that suggestion).
 * Optimistic patch via useInventory.applyItemPatch; rollback on failure.
 *
 * The row click that opens the detail panel is suppressed while the cell is
 * active (onClick e.stopPropagation()). Hover shows a subtle pencil-ish
 * affordance via background tint + text cursor.
 */
import { useState, useRef, useEffect, useMemo, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useAutocomplete } from '../../hooks/useAutocomplete';
import { useLocations } from '../../hooks/useLocations';
import { postUpdateInventoryItem } from '../../lib/api';
import { entityEvents } from '../../lib/entityEvents';

export type InlineEditableFieldKey =
  | 'vendor' | 'sidemark' | 'description'
  | 'reference' | 'room' | 'location';

interface Props {
  value: string;
  itemId: string;
  clientSheetId: string;
  fieldKey: InlineEditableFieldKey;
  variant: 'text' | 'autocomplete-db' | 'autocomplete-locations';
  /** Renders the displayed (non-editing) cell. Falls back to plain text. */
  renderValue?: (value: string) => ReactNode;
  /** Writes an optimistic patch to useInventory. Required. */
  applyItemPatch: (itemId: string, patch: Record<string, unknown>) => void;
  /** Reverts the optimistic patch (called on save error). */
  mergeItemPatch?: (itemId: string, patch: Record<string, unknown>) => void;
  /** When disabled, cell behaves as plain display (no hover, no click). */
  disabled?: boolean;
  placeholder?: string;
  /** Autocomplete-db variant needs to know which suggestion list to pull. */
  dbField?: 'vendors' | 'sidemarks' | 'descriptions';
}

export function InlineEditableCell({
  value,
  itemId,
  clientSheetId,
  fieldKey,
  variant,
  renderValue,
  applyItemPatch,
  mergeItemPatch,
  disabled,
  placeholder,
  dbField,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const savedRef = useRef(false);

  // Pull suggestions lazily — only when entering edit mode on the right variant.
  // useAutocomplete is per-client cached so repeated edits don't refetch.
  const ac = useAutocomplete(variant === 'autocomplete-db' ? clientSheetId : undefined);
  const locs = useLocations(variant === 'autocomplete-locations');

  const suggestions = useMemo<string[]>(() => {
    if (variant === 'autocomplete-db') {
      if (dbField === 'vendors') return ac.vendors;
      if (dbField === 'sidemarks') return ac.sidemarks;
      if (dbField === 'descriptions') return ac.descriptions;
      return [];
    }
    if (variant === 'autocomplete-locations') return locs.locationNames;
    return [];
  }, [variant, dbField, ac.vendors, ac.sidemarks, ac.descriptions, locs.locationNames]);

  const filtered = useMemo<string[]>(() => {
    if (variant === 'text') return [];
    const q = draft.toLowerCase().trim();
    const pool = suggestions;
    if (!q) return pool.slice(0, 10);
    const starts: string[] = [];
    const contains: string[] = [];
    for (const s of pool) {
      const sl = s.toLowerCase();
      if (sl === q) continue;
      if (sl.startsWith(q)) starts.push(s);
      else if (sl.includes(q)) contains.push(s);
      if (starts.length + contains.length >= 10) break;
    }
    return [...starts, ...contains].slice(0, 10);
  }, [variant, draft, suggestions]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // Sync external value changes into draft when not editing
  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  const startEdit = (e: React.MouseEvent) => {
    if (disabled) return;
    e.stopPropagation();
    setDraft(value ?? '');
    setError(false);
    savedRef.current = false;
    setEditing(true);
    setShowSuggestions(variant !== 'text');
  };

  const cancel = () => {
    setDraft(value ?? '');
    setError(false);
    setEditing(false);
    setShowSuggestions(false);
  };

  const commit = async (finalValue: string) => {
    const trimmed = finalValue.trim();
    if (savedRef.current) return; // prevent double-commit from blur-after-enter
    if (trimmed === (value ?? '').trim()) {
      setEditing(false);
      setShowSuggestions(false);
      return;
    }
    savedRef.current = true;

    // Optimistic — paint new value immediately
    applyItemPatch(itemId, { [fieldKey]: trimmed });
    setSaving(true);
    setError(false);

    try {
      const res = await postUpdateInventoryItem(
        { itemId, [fieldKey]: trimmed } as Record<string, unknown> & { itemId: string },
        clientSheetId,
      );
      if (res.ok && res.data?.success) {
        // Tell the data layer a write happened → next refetch should bypass
        // Supabase and read authoritative values from GAS. The Realtime
        // echo will refresh other tabs.
        entityEvents.emit('inventory', itemId);
      } else {
        // Rollback
        if (mergeItemPatch) mergeItemPatch(itemId, { [fieldKey]: value });
        else applyItemPatch(itemId, { [fieldKey]: value });
        setError(true);
      }
    } catch {
      if (mergeItemPatch) mergeItemPatch(itemId, { [fieldKey]: value });
      else applyItemPatch(itemId, { [fieldKey]: value });
      setError(true);
    } finally {
      setSaving(false);
      setEditing(false);
      setShowSuggestions(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(draft); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    else if (e.key === 'ArrowDown' && filtered.length > 0) { e.preventDefault(); setShowSuggestions(true); }
  };

  // ─── Display mode ────────────────────────────────────────────────────────
  if (!editing) {
    return (
      <div
        onClick={startEdit}
        title={disabled ? undefined : 'Click to edit'}
        style={{
          cursor: disabled ? 'default' : 'text',
          padding: '2px 4px', margin: '-2px -4px',
          borderRadius: 4, transition: 'background 0.1s',
          minHeight: 18,
          position: 'relative',
        }}
        onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = 'rgba(232,105,42,0.08)'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
      >
        {renderValue ? renderValue(value) : (
          <span>{value || (placeholder ? <span style={{ color: '#BBB' }}>{placeholder}</span> : '—')}</span>
        )}
        {saving && <Loader2 size={10} style={{ position: 'absolute', right: 2, top: 4, animation: 'spin 1s linear infinite', color: '#E8692A' }} />}
        {error && <span style={{ position: 'absolute', right: 2, top: 2, fontSize: 10, color: '#B45A5A' }} title="Save failed — click to retry">⚠</span>}
      </div>
    );
  }

  // ─── Edit mode ───────────────────────────────────────────────────────────
  return (
    <div onClick={e => e.stopPropagation()} style={{ position: 'relative' }}>
      <input
        ref={inputRef}
        value={draft}
        onChange={e => { setDraft(e.target.value); setShowSuggestions(variant !== 'text'); }}
        onKeyDown={onKey}
        onBlur={() => { setTimeout(() => commit(draft), 120); /* allow suggestion-click mousedown to fire first */ }}
        placeholder={placeholder}
        disabled={saving}
        style={{
          width: '100%', padding: '2px 6px', fontSize: 12,
          border: `1px solid ${error ? '#B45A5A' : '#E8692A'}`,
          borderRadius: 4, outline: 'none',
          background: saving ? '#F5F2EE' : '#fff',
          fontFamily: 'inherit', color: '#1C1C1C',
          boxSizing: 'border-box',
        }}
      />
      {variant !== 'text' && showSuggestions && filtered.length > 0 && (
        <div
          style={{
            position: 'absolute', top: '100%', left: 0, right: 0,
            marginTop: 2, zIndex: 100,
            background: '#fff',
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 6,
            boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
            maxHeight: 220, overflowY: 'auto',
          }}
        >
          {filtered.map(s => (
            <div
              key={s}
              onMouseDown={(e) => {
                // onMouseDown fires before input blur — safe to commit here.
                e.preventDefault();
                setDraft(s);
                commit(s);
              }}
              style={{
                padding: '6px 10px', fontSize: 12, cursor: 'pointer',
                color: '#1C1C1C',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#F5F2EE')}
              onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
            >
              {s}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
