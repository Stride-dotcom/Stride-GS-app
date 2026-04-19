/**
 * EntityHistory — Collapsible timeline of audit log entries for an entity.
 * Reads from Supabase entity_audit_log table.
 * Used in all detail panels (Item, Task, Repair, WillCall, Shipment).
 */
import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Clock, User } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { theme } from '../../styles/theme';

interface AuditEntry {
  id: string;
  action: string;
  changes: Record<string, unknown>;
  performed_by: string;
  performed_at: string;
  source: string;
}

interface Props {
  entityType: string;
  entityId: string;
  tenantId?: string;
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
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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

export function EntityHistory({ entityType, entityId, tenantId }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!expanded || loaded || !entityId) return;
    setLoading(true);
    (async () => {
      try {
        let query = supabase
          .from('entity_audit_log')
          .select('id, action, changes, performed_by, performed_at, source')
          .eq('entity_type', entityType)
          .eq('entity_id', entityId)
          .order('performed_at', { ascending: false })
          .limit(50);
        if (tenantId) query = query.eq('tenant_id', tenantId);
        const { data } = await query;
        if (data) setEntries(data as AuditEntry[]);
      } catch { /* best-effort */ }
      setLoading(false);
      setLoaded(true);
    })();
  }, [expanded, loaded, entityType, entityId, tenantId]);

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

          {entries.map(entry => {
            const cfg = ACTION_LABELS[entry.action] || { label: entry.action, color: '#6B7280' };
            const detail = renderChanges(entry.changes);
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
