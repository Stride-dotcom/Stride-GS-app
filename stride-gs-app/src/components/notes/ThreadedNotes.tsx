/**
 * ThreadedNotes — iMessage-style threaded notes viewer.
 *
 * Each (entity_type, entity_id) pair is a thread. When a detail panel
 * mounts this component, it passes the PRIMARY entity plus any RELATED
 * entities (e.g. the item's tasks/repairs, or the task's parent item)
 * so the user can switch between contexts without leaving the panel.
 *
 * Session 74 v1 scope:
 *   - Thread list is a horizontal pill row at the top (mobile-friendly,
 *     no split-pane complexity yet).
 *   - The selected thread renders the existing NotesSection component
 *     (flat conversation with composer, visibility toggle, public/internal
 *     badge). Reusing NotesSection avoids reinventing the composer wheel.
 *   - The primary entity is pre-selected; clicking another pill swaps
 *     the thread. Each thread mounts its own useEntityNotes under the
 *     hood (via NotesSection), so the Realtime channel follows the
 *     selection — at most ONE notes channel open at a time regardless
 *     of how many related pills are visible.
 *
 * Future v2 ideas (tracked, not built):
 *   - Unread count per thread (would require a seen-at pointer per
 *     user per thread).
 *   - Last-message preview on each pill (would need a cheap batch
 *     query for the latest note per thread).
 *   - Full split-pane desktop layout with conversation search.
 */
import { useState, useMemo } from 'react';
import { Package, ClipboardList, Wrench, Truck, ShoppingCart, ChevronRight } from 'lucide-react';
import { theme } from '../../styles/theme';
import { NotesSection } from './NotesSection';

// Shared entity-type → icon + label vocabulary so every pill looks
// consistent with the rest of the app's iconography.
const ENTITY_META: Record<string, { Icon: React.ComponentType<{ size?: number; color?: string }>; label: string; color: string }> = {
  inventory:  { Icon: Package,       label: 'Item',      color: '#1D4ED8' },
  task:       { Icon: ClipboardList, label: 'Task',      color: '#E85D2D' },
  repair:     { Icon: Wrench,        label: 'Repair',    color: '#B45309' },
  shipment:   { Icon: Truck,         label: 'Shipment',  color: '#0F766E' },
  will_call:  { Icon: ShoppingCart,  label: 'Will Call', color: '#BE185D' },
};

export interface ThreadedNotesRelated {
  type: string;
  id: string;
  /** Display label — e.g. "Task INSP-00123" or "Item 60421". */
  label?: string;
}

export interface ThreadedNotesProps {
  /** The primary entity — always pre-selected on mount. */
  entityType: string;
  entityId: string;
  tenantId?: string | null;
  /** Related entities the user may want to jump to from this panel. */
  relatedEntities?: ThreadedNotesRelated[];
}

interface Thread {
  key: string;
  type: string;
  id: string;
  label: string;
  isPrimary: boolean;
}

function threadKey(type: string, id: string): string {
  return `${type}:${id}`;
}

function buildLabel(type: string, id: string, override?: string): string {
  if (override) return override;
  const meta = ENTITY_META[type];
  const prefix = meta?.label ?? type;
  // Short IDs (8 char or less) show inline; longer ones get truncated
  // so the pill row stays scannable.
  const short = id.length > 18 ? id.slice(0, 10) + '…' + id.slice(-4) : id;
  return `${prefix} ${short}`;
}

export function ThreadedNotes({
  entityType, entityId, relatedEntities,
  // tenantId is declared on the props for future server-filtered queries,
  // but unused today — NotesSection reads tenant from the auth context.
}: ThreadedNotesProps) {
  // Deduplicate threads: primary first, then related that aren't
  // the same entity. Same type+id appearing in relatedEntities is
  // silently collapsed with the primary.
  const threads: Thread[] = useMemo(() => {
    const primary: Thread = {
      key: threadKey(entityType, entityId),
      type: entityType,
      id: entityId,
      label: buildLabel(entityType, entityId),
      isPrimary: true,
    };
    const seen = new Set<string>([primary.key]);
    const rest: Thread[] = [];
    for (const r of relatedEntities ?? []) {
      if (!r.type || !r.id) continue;
      const k = threadKey(r.type, r.id);
      if (seen.has(k)) continue;
      seen.add(k);
      rest.push({
        key: k,
        type: r.type,
        id: r.id,
        label: buildLabel(r.type, r.id, r.label),
        isPrimary: false,
      });
    }
    return [primary, ...rest];
  }, [entityType, entityId, relatedEntities]);

  const [activeKey, setActiveKey] = useState<string>(threads[0].key);
  const active = threads.find(t => t.key === activeKey) ?? threads[0];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
      {/* Thread pills. Always render even when there's just the primary
          so the UI feels consistent across panels. Horizontal scroll on
          narrow viewports; wraps to multiple lines otherwise. */}
      <div
        style={{
          display: 'flex', flexWrap: 'wrap', gap: 6,
          paddingBottom: 4,
        }}
      >
        {threads.map(t => {
          const meta = ENTITY_META[t.type];
          const Icon = meta?.Icon ?? ChevronRight;
          const isActive = t.key === active.key;
          return (
            <button
              key={t.key}
              onClick={() => setActiveKey(t.key)}
              title={`${meta?.label ?? t.type} ${t.id}${t.isPrimary ? ' (current)' : ''}`}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '5px 11px', borderRadius: 999,
                border: `1px solid ${isActive ? theme.colors.orange : theme.colors.borderLight}`,
                background: isActive ? '#FFF7ED' : '#FFFFFF',
                color: isActive ? '#9A3412' : theme.colors.textSecondary,
                fontSize: 11, fontWeight: isActive ? 700 : 600,
                fontFamily: 'inherit', cursor: 'pointer',
                whiteSpace: 'nowrap',
                transition: 'background 120ms ease, border-color 120ms ease',
              }}
            >
              <Icon size={12} color={isActive ? '#9A3412' : (meta?.color ?? theme.colors.textSecondary)} />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>
                {t.label}
              </span>
              {t.isPrimary && (
                <span style={{
                  fontSize: 9, fontWeight: 800, letterSpacing: 0.5,
                  padding: '1px 5px', borderRadius: 4,
                  background: isActive ? '#9A3412' : theme.colors.borderLight,
                  color: isActive ? '#fff' : theme.colors.textMuted,
                }}>
                  CURRENT
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected thread — the existing flat NotesSection is already a
          well-behaved conversation viewer with composer, visibility
          toggle, mentions, delete, Realtime, optimistic add, etc.
          Remounting with a new `key` forces a fresh useEntityNotes
          subscription when the thread switches, so channels don't
          leak and the view resets to the new thread's messages. */}
      <div key={active.key} style={{ minWidth: 0 }}>
        {/* NotesSection reads tenant_id from the authed user's context,
            so we don't thread it here. `key` resets the component when
            the active thread changes — clean Realtime channel swap. */}
        <NotesSection entityType={active.type} entityId={active.id} />
      </div>
    </div>
  );
}
