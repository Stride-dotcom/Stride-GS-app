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
import { createPortal } from 'react-dom';
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

  return (
    <EditMode
      inputRef={inputRef}
      draft={draft}
      setDraft={setDraft}
      setShowSuggestions={setShowSuggestions}
      showSuggestions={showSuggestions}
      variant={variant}
      commit={commit}
      onKey={onKey}
      placeholder={placeholder}
      saving={saving}
      error={error}
      filtered={filtered}
      loading={variant === 'autocomplete-db' ? ac.loading : locs.loading}
      poolSize={suggestions.length}
    />
  );
}

/**
 * Edit-mode renderer — the input lives in the table cell (so focus + layout
 * line up), but the suggestion dropdown is portaled to document.body so it
 * can't be clipped by td/tr/tbody overflow settings. Position is computed
 * from the input's getBoundingClientRect and refreshed on scroll/resize.
 */
interface EditModeProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  draft: string;
  setDraft: (v: string) => void;
  setShowSuggestions: (v: boolean) => void;
  showSuggestions: boolean;
  variant: 'text' | 'autocomplete-db' | 'autocomplete-locations';
  commit: (finalValue: string) => void;
  onKey: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  saving: boolean;
  error: boolean;
  filtered: string[];
  loading: boolean;
  poolSize: number;
}

function EditMode({
  inputRef, draft, setDraft, setShowSuggestions, showSuggestions, variant,
  commit, onKey, placeholder, saving, error, filtered, loading, poolSize,
}: EditModeProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [anchorRect, setAnchorRect] = useState<{ left: number; top: number; width: number } | null>(null);

  // Recompute portal position on mount and whenever the page scrolls/resizes.
  useEffect(() => {
    const update = () => {
      const el = inputRef.current;
      if (!el) { setAnchorRect(null); return; }
      const r = el.getBoundingClientRect();
      setAnchorRect({ left: r.left, top: r.bottom + 2, width: r.width });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [inputRef]);

  const showDropdown = variant !== 'text' && showSuggestions && anchorRect;

  return (
    <div ref={wrapperRef} onClick={e => e.stopPropagation()} style={{ position: 'relative' }}>
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
      {showDropdown && createPortal(
        <div
          onMouseDown={e => e.preventDefault() /* keep input focused while interacting */}
          style={{
            position: 'fixed',
            left: anchorRect!.left,
            top: anchorRect!.top,
            width: Math.max(anchorRect!.width, 180),
            zIndex: 10000,
            background: '#fff',
            border: '1px solid rgba(0,0,0,0.08)',
            borderRadius: 6,
            boxShadow: '0 8px 28px rgba(0,0,0,0.18)',
            maxHeight: 240, overflowY: 'auto',
          }}
        >
          {filtered.map(s => (
            <div
              key={s}
              onMouseDown={(e) => {
                e.preventDefault();
                setDraft(s);
                commit(s);
              }}
              style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer', color: '#1C1C1C' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#F5F2EE')}
              onMouseLeave={e => (e.currentTarget.style.background = '#fff')}
            >
              {s}
            </div>
          ))}
          {filtered.length === 0 && loading && (
            <div style={{ padding: '8px 10px', fontSize: 11, color: '#999', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
              Loading suggestions…
            </div>
          )}
          {filtered.length === 0 && !loading && poolSize === 0 && (
            <div style={{ padding: '8px 10px', fontSize: 11, color: '#999', fontStyle: 'italic' }}>
              {variant === 'autocomplete-locations'
                ? 'No locations configured yet — type a new one'
                : 'No suggestions in this client\u2019s Autocomplete DB yet — type a new value'}
            </div>
          )}
          {filtered.length === 0 && !loading && poolSize > 0 && draft && (
            <div style={{ padding: '8px 10px', fontSize: 11, color: '#999', fontStyle: 'italic' }}>
              No match — press Enter to save &ldquo;{draft}&rdquo;
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
