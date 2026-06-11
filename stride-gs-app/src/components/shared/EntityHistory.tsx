/**
 * EntityHistory — Collapsible timeline of audit log entries for an entity.
 * Reads from Supabase entity_audit_log table.
 * Used in all detail panels (Item, Task, Repair, WillCall, Shipment).
 *
 * For dt_order entities, ALSO reads dt_order_history (DT export.xml driver
 * events: started, delivered, signature captured, exception codes, etc.)
 * and merges them into the same timeline. App-side events are tagged
 * 'App' and DT-side events are tagged 'Driver' so the reader can tell
 * who originated each entry. Replaces the standalone "Driver Activity"
 * block on the OrderPage Details tab.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { ChevronDown, ChevronRight, Clock, User } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { theme } from '../../styles/theme';
import { fmtDateTime } from '../../lib/constants';

interface AuditEntry {
  id: string;
  action: string;
  changes: Record<string, unknown>;
  performed_by: string;
  performed_at: string;
  source: string;
  /** 'app' for entity_audit_log rows, 'dt' for dt_order_history rows.
   *  Drives the small "App / Driver" tag in the timeline UI. Distinct
   *  from the underlying `source` text column on entity_audit_log
   *  (which holds 'gas' / 'app' / 'edge' / 'backfill' values for
   *  app-originated rows). */
  origin: 'app' | 'dt';
}

interface Props {
  entityType: string;
  entityId: string;
  tenantId?: string;
  /** Auto-expand on mount (for EntityPage Activity tab where the timeline should be immediately visible). */
  defaultExpanded?: boolean;
  /** Limit displayed entries to these action types. Empty/undefined = show all. */
  actionFilter?: string[];
}

const ACTION_LABELS: Record<string, { label: string; color: string }> = {
  create: { label: 'Created', color: '#15803D' },
  update: { label: 'Updated', color: '#1D4ED8' },
  start: { label: 'Started', color: '#E85D2D' },
  complete: { label: 'Completed', color: '#15803D' },
  cancel: { label: 'Cancelled', color: '#DC2626' },
  release: { label: 'Released', color: '#7C3AED' },
  transfer: { label: 'Transferred', color: '#0891B2' },
  assign: { label: 'Assigned', color: '#B45309' },
  status_change: { label: 'Status Changed', color: '#6D28D9' },
  // BatchWorkItems per-item work (update_batch_work_item RPC) — changes.summary
  // carries the human line, e.g. "Item 63333: In Progress → Pass".
  item_work: { label: 'Item Work', color: '#0891B2' },
  cod_storage_set:       { label: 'COD Storage On',   color: '#CA8A04' },
  cod_storage_removed:   { label: 'COD Storage Off',  color: '#6B7280' },
  cod_storage_collected: { label: 'COD Storage Paid', color: '#15803D' },
  // dt_order app-side actions
  approve:            { label: 'Approved',           color: '#15803D' },
  reject:             { label: 'Rejected',           color: '#DC2626' },
  revision_requested: { label: 'Revision Requested', color: '#B45309' },
  push_to_dt:         { label: 'Pushed to DT',       color: '#0891B2' },
  // dt_order DT-side driver event (synthesized when reading dt_order_history)
  driver_event:       { label: 'Driver',             color: '#6D28D9' },
};

function formatTime(iso: string): string {
  try {
    return fmtDateTime(iso);
  } catch { return iso; }
}

function formatEmail(email: string): string {
  if (!email) return 'System';
  const at = email.indexOf('@');
  if (at < 0) return email;
  return email.slice(0, at);
}

function renderChanges(changes: Record<string, unknown>): string {
  if (!changes || typeof changes !== 'object') return '';

  // Simple summary
  if (changes.summary) return String(changes.summary);

  // Status change
  if (changes.status && typeof changes.status === 'object') {
    const s = changes.status as { old?: string; new?: string };
    if (s.old && s.new) return `${s.old} → ${s.new}`;
    if (s.new) return `→ ${s.new}`;
  }

  // Field changes
  const parts: string[] = [];
  for (const key of Object.keys(changes)) {
    if (key === 'status') continue; // already handled
    const val = changes[key];
    if (val && typeof val === 'object' && 'old' in (val as Record<string, unknown>) && 'new' in (val as Record<string, unknown>)) {
      const v = val as { old?: unknown; new?: unknown };
      parts.push(`${key}: ${v.old || '—'} → ${v.new || '—'}`);
    } else if (val !== undefined && val !== null && val !== '') {
      parts.push(`${key}: ${String(val)}`);
    }
  }
  return parts.join(' · ');
}

export function EntityHistory({ entityType, entityId, tenantId, defaultExpanded, actionFilter }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // Pull both sources in parallel for dt_order entities; everyone else just
  // reads entity_audit_log. Extracted into a callback so the realtime
  // subscription below can reuse it on every INSERT echo.
  const loadEntries = useCallback(async () => {
    if (!entityId) return;
    try {
      const auditPromise = (async () => {
        let q = supabase
          .from('entity_audit_log')
          .select('id, action, changes, performed_by, performed_at, source')
          .eq('entity_type', entityType)
          .eq('entity_id', entityId)
          .order('performed_at', { ascending: false })
          .limit(100);
        if (tenantId) q = q.eq('tenant_id', tenantId);
        const { data } = await q;
        return (data ?? []).map(r => ({ ...(r as Omit<AuditEntry, 'origin'>), origin: 'app' as const }));
      })();

      const dtHistoryPromise = entityType === 'dt_order'
        ? (async () => {
            const { data } = await supabase
              .from('dt_order_history')
              .select('id, code, description, owner_name, owner_type, happened_at, lat, lng')
              .eq('dt_order_id', entityId)
              .order('happened_at', { ascending: false })
              .limit(100);
            return (data ?? []).map((r: { id: string; code: number | null; description: string | null; owner_name: string | null; owner_type: string | null; happened_at: string; lat: number | null; lng: number | null }) => ({
              id: `dt:${r.id}`,
              action: 'driver_event',
              changes: {
                summary: r.description || 'Driver event',
                code: r.code ?? undefined,
                ownerType: r.owner_type ?? undefined,
              },
              performed_by: r.owner_name ?? '',
              performed_at: r.happened_at,
              source: 'dt_export',
              origin: 'dt' as const,
            }));
          })()
        : Promise.resolve([]);

      const [appEntries, dtEntries] = await Promise.all([auditPromise, dtHistoryPromise]);
      const merged: AuditEntry[] = [...appEntries, ...dtEntries].sort(
        (a, b) => (a.performed_at < b.performed_at ? 1 : a.performed_at > b.performed_at ? -1 : 0)
      );
      if (mountedRef.current) setEntries(merged);
    } catch { /* best-effort */ }
  }, [entityType, entityId, tenantId]);

  // Initial load when the section is expanded.
  useEffect(() => {
    if (!expanded || loaded || !entityId) return;
    setLoading(true);
    void loadEntries().finally(() => {
      if (mountedRef.current) {
        setLoading(false);
        setLoaded(true);
      }
    });
  }, [expanded, loaded, entityId, loadEntries]);

  // Realtime — refetch when a new audit log row matching this entity lands.
  // Without this, creating a will-call / task / repair / etc. doesn't surface
  // the "Created" event in the Activity tab until the user manually refreshes.
  // Subscription only attaches once the user has expanded the section (and
  // therefore loaded the initial list), so we don't burn channels on collapsed
  // panels. For dt_order entities we also listen on dt_order_history so
  // driver events stream in live.
  useEffect(() => {
    if (!loaded || !entityId) return;
    const channel = supabase.channel(`entity_audit_log_${entityType}_${entityId}`);
    channel.on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'entity_audit_log', filter: `entity_id=eq.${entityId}` },
      () => { void loadEntries(); },
    );
    if (entityType === 'dt_order') {
      channel.on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'dt_order_history', filter: `dt_order_id=eq.${entityId}` },
        () => { void loadEntries(); },
      );
    }
    channel.subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loaded, entityType, entityId, loadEntries]);

  return (
    <div style={{ marginBottom: 16 }}>
      <button
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          background: 'none', border: 'none', cursor: 'pointer', padding: '8px 0',
          fontSize: 12, fontWeight: 600, color: theme.colors.textSecondary,
          fontFamily: 'inherit',
        }}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Clock size={14} />
        Activity History
        {entries.length > 0 && <span style={{ fontSize: 10, color: theme.colors.textMuted, fontWeight: 400 }}>({entries.length})</span>}
      </button>

      {expanded && (
        <div style={{
          borderLeft: `2px solid ${theme.colors.borderLight}`,
          marginLeft: 7, paddingLeft: 16, marginTop: 4,
        }}>
          {loading && (
            <div style={{ fontSize: 12, color: theme.colors.textMuted, padding: '8px 0' }}>Loading...</div>
          )}

          {!loading && entries.length === 0 && (
            <div style={{ fontSize: 12, color: theme.colors.textMuted, padding: '8px 0' }}>No activity recorded yet</div>
          )}

          {(actionFilter && actionFilter.length > 0 ? entries.filter(e => actionFilter.includes(e.action)) : entries).map(entry => {
            // For DT driver events the meaningful label is the dispatch
            // description ("Delivered", "Started", etc.) — that beats
            // a generic "DRIVER" prefix. Promote the summary into the
            // label and skip rendering it again in detail.
            const dtSummary = entry.origin === 'dt' && entry.changes && typeof entry.changes === 'object'
              ? (entry.changes as { summary?: string }).summary
              : undefined;
            const cfg = dtSummary
              ? { label: dtSummary, color: ACTION_LABELS.driver_event.color }
              : (ACTION_LABELS[entry.action] || { label: entry.action, color: '#6B7280' });
            const detail = dtSummary ? '' : renderChanges(entry.changes);
            return (
              <div key={entry.id} style={{
                position: 'relative', paddingBottom: 12, marginBottom: 4,
              }}>
                {/* Timeline dot */}
                <div style={{
                  position: 'absolute', left: -21, top: 3,
                  width: 8, height: 8, borderRadius: '50%',
                  background: cfg.color, border: '2px solid #fff',
                }} />

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: cfg.color,
                    textTransform: 'uppercase', letterSpacing: '0.03em',
                  }}>
                    {cfg.label}
                  </span>
                  {detail && (
                    <span style={{ fontSize: 11, color: theme.colors.textSecondary }}>
                      {detail}
                    </span>
                  )}
                  {/* Origin tag — distinguishes app-driven actions
                      (created / approved / pushed / etc.) from DT-side
                      driver events (started / delivered / signature
                      captured) so the timeline still tells you who did
                      what when both sources are interleaved. Shown only
                      when the entity is dt_order — other entities don't
                      mix sources. */}
                  {entityType === 'dt_order' && (
                    <span style={{
                      fontSize: 9, fontWeight: 700,
                      padding: '1px 6px', borderRadius: 6,
                      letterSpacing: '0.5px', textTransform: 'uppercase',
                      background: entry.origin === 'dt' ? '#EDE9FE' : '#E0F2FE',
                      color: entry.origin === 'dt' ? '#6D28D9' : '#0369A1',
                      marginLeft: 'auto',
                    }}>
                      {entry.origin === 'dt' ? 'Driver' : 'App'}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                  <span style={{ fontSize: 10, color: theme.colors.textMuted, display: 'flex', alignItems: 'center', gap: 3 }}>
                    <User size={10} /> {formatEmail(entry.performed_by)}
                  </span>
                  <span style={{ fontSize: 10, color: theme.colors.textMuted }}>
                    {formatTime(entry.performed_at)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
