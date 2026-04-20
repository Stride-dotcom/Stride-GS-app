/**
 * ComposeMessageModal — start a brand-new message thread. Opens from the
 * "+ New Message" pill in MessagesPage's left column.
 *
 * Recipients are picked from `cb_users` (the Supabase mirror of the CB
 * Users tab). The picker is a searchable multi-select with quick filters
 * for "All Staff" / "All Clients" so broadcasts are one tap.
 *
 * Body + optional entity link round it out. On send we call the same
 * `useMessages.sendMessage` that the inline input uses, then open the
 * thread so the caller sees their sent message immediately.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Send, Loader2, Users, Shield, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { theme } from '../../styles/theme';
import { supabase } from '../../lib/supabase';
import type { SendMessageParams } from '../../hooks/useMessages';

export interface ComposeRecipient {
  id: string;            // auth.users.id uuid (mirrored to cb_users.id)
  email: string;
  name: string;
  role: 'admin' | 'staff' | 'client';
}

interface Props {
  onClose: () => void;
  onSend: (params: SendMessageParams) => Promise<unknown>;
  /** Current user's auth uid — excluded from the picker so you don't message yourself. */
  currentUserId: string | null;
}

export function ComposeMessageModal({ onClose, onSend, currentUserId }: Props) {
  const v2 = theme.v2;
  const [users, setUsers] = useState<ComposeRecipient[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ComposeRecipient[]>([]);
  const [body, setBody] = useState('');
  const [entityType, setEntityType] = useState('');
  const [entityId, setEntityId] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch user list — Supabase cb_users is the tenant-aware mirror of CB Users.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('cb_users')
        .select('id,email,role,client_name,contact_name,active')
        .eq('active', true)
        .order('email', { ascending: true });
      if (cancelled) return;
      if (err) {
        setError(`Failed to load users: ${err.message}`);
        setLoading(false);
        return;
      }
      const mapped: ComposeRecipient[] = (data ?? [])
        .filter(r => r.id && r.email && r.id !== currentUserId)
        .map(r => ({
          id: r.id as string,
          email: r.email as string,
          name: (r.contact_name as string | null) || (r.client_name as string | null) || (r.email as string),
          role: ((r.role as string) === 'admin' ? 'admin' : (r.role as string) === 'staff' ? 'staff' : 'client') as ComposeRecipient['role'],
        }));
      setUsers(mapped);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [currentUserId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter(u =>
      u.email.toLowerCase().includes(q) ||
      u.name.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
    );
  }, [users, query]);

  const isSelected = useCallback((id: string) => selected.some(s => s.id === id), [selected]);
  const toggle = useCallback((u: ComposeRecipient) => {
    setSelected(prev => prev.some(s => s.id === u.id) ? prev.filter(s => s.id !== u.id) : [...prev, u]);
  }, []);

  const selectAllStaff = useCallback(() => {
    setSelected(prev => {
      const staff = users.filter(u => u.role === 'admin' || u.role === 'staff');
      const map = new Map(prev.map(s => [s.id, s]));
      for (const u of staff) map.set(u.id, u);
      return Array.from(map.values());
    });
  }, [users]);

  const selectAllClients = useCallback(() => {
    setSelected(prev => {
      const clients = users.filter(u => u.role === 'client');
      const map = new Map(prev.map(s => [s.id, s]));
      for (const u of clients) map.set(u.id, u);
      return Array.from(map.values());
    });
  }, [users]);

  const clearSelected = useCallback(() => setSelected([]), []);

  const canSend = selected.length > 0 && body.trim().length > 0 && !sending;

  const handleSend = useCallback(async () => {
    if (!canSend) return;
    setSending(true); setError(null);
    try {
      await onSend({
        body: body.trim(),
        recipientIds: selected.map(s => s.id),
        recipientNames: selected.map(s => s.name),
        entityType: entityType.trim() || undefined,
        entityId: entityId.trim() || undefined,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSending(false);
    }
  }, [canSend, body, selected, entityType, entityId, onSend, onClose]);

  return createPortal(
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)',
        zIndex: 2500, display: 'flex', justifyContent: 'center', alignItems: 'center',
        padding: 12,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff',
          borderRadius: v2.radius.card,
          width: '100%', maxWidth: 620,
          maxHeight: '92dvh',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          fontFamily: theme.typography.fontFamily,
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: `1px solid ${v2.colors.border}`,
        }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: v2.colors.text }}>New Message</div>
          <button onClick={onClose} style={iconBtn} aria-label="Close"><X size={18} /></button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* To + quick buttons */}
          <div>
            <label style={labelStyle}>To</label>
            {selected.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                {selected.map(s => (
                  <span key={s.id} style={recipientChip}>
                    {s.name}
                    <button
                      onClick={() => toggle(s)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, marginLeft: 4, display: 'flex' }}
                      aria-label={`Remove ${s.name}`}
                    ><X size={11} /></button>
                  </span>
                ))}
                {selected.length > 1 && (
                  <button onClick={clearSelected} style={clearBtn}>Clear all</button>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
              <button onClick={selectAllStaff} style={quickBtn}>
                <Shield size={11} /> All Staff
              </button>
              <button onClick={selectAllClients} style={quickBtn}>
                <Users size={11} /> All Clients
              </button>
            </div>
            <div style={{ position: 'relative' }}>
              <Search size={14} color={v2.colors.textMuted} style={{ position: 'absolute', top: 11, left: 10 }} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search users by name, email, or role…"
                style={{
                  width: '100%', padding: '9px 10px 9px 32px', fontSize: 13,
                  border: `1px solid ${v2.colors.border}`, borderRadius: v2.radius.input,
                  outline: 'none', fontFamily: 'inherit',
                }}
              />
            </div>
            {/* User list */}
            <div style={{
              marginTop: 8,
              border: `1px solid ${v2.colors.border}`,
              borderRadius: v2.radius.input,
              maxHeight: 200, overflowY: 'auto',
              background: v2.colors.bgCard,
            }}>
              {loading ? (
                <div style={{ padding: 14, textAlign: 'center', color: v2.colors.textMuted, fontSize: 12 }}>
                  <Loader2 size={13} style={{ animation: 'spin 1s linear infinite', marginRight: 6 }} />
                  Loading users…
                </div>
              ) : filtered.length === 0 ? (
                <div style={{ padding: 14, textAlign: 'center', color: v2.colors.textMuted, fontSize: 12 }}>
                  {query ? 'No users match.' : 'No other active users found.'}
                </div>
              ) : (
                filtered.map(u => {
                  const checked = isSelected(u.id);
                  return (
                    <div
                      key={u.id}
                      onClick={() => toggle(u)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '8px 12px', cursor: 'pointer',
                        background: checked ? '#FFF7F0' : 'transparent',
                        borderBottom: `1px solid ${v2.colors.border}`,
                      }}
                    >
                      <div style={{
                        width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                        background: checked ? v2.colors.accent : '#fff',
                        border: `1.5px solid ${checked ? v2.colors.accent : v2.colors.border}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {checked && <CheckCircle2 size={10} color="#fff" />}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, color: v2.colors.text, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {u.name}
                        </div>
                        <div style={{ fontSize: 11, color: v2.colors.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {u.email}
                        </div>
                      </div>
                      <span style={rolePill(u.role)}>{u.role}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Entity link */}
          <div>
            <label style={labelStyle}>Link to entity <span style={{ fontWeight: 400, color: v2.colors.textMuted, textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
            <div style={{ display: 'flex', gap: 6 }}>
              <select
                value={entityType}
                onChange={e => setEntityType(e.target.value)}
                style={{
                  padding: '9px 10px', fontSize: 13, fontFamily: 'inherit',
                  border: `1px solid ${v2.colors.border}`, borderRadius: v2.radius.input,
                  background: '#fff', minWidth: 130,
                }}
              >
                <option value="">— none —</option>
                <option value="inventory">Inventory</option>
                <option value="task">Task</option>
                <option value="repair">Repair</option>
                <option value="will_call">Will Call</option>
                <option value="shipment">Shipment</option>
                <option value="claim">Claim</option>
              </select>
              <input
                value={entityId}
                onChange={e => setEntityId(e.target.value)}
                placeholder="ID (e.g. 62426, INSP-62426-1)"
                disabled={!entityType}
                style={{
                  flex: 1, padding: '9px 10px', fontSize: 13,
                  border: `1px solid ${v2.colors.border}`, borderRadius: v2.radius.input,
                  outline: 'none', fontFamily: 'inherit',
                  background: entityType ? '#fff' : v2.colors.bgCard,
                }}
              />
            </div>
          </div>

          {/* Body */}
          <div>
            <label style={labelStyle}>Message</label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Type your message…"
              rows={5}
              style={{
                width: '100%', padding: 10, fontSize: 13, fontFamily: 'inherit',
                border: `1px solid ${v2.colors.border}`, borderRadius: v2.radius.input,
                outline: 'none', resize: 'vertical', minHeight: 100,
                boxSizing: 'border-box',
              }}
            />
          </div>

          {error && (
            <div role="alert" style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 12px', fontSize: 12,
              background: '#FEF2F2', border: '1px solid #FCA5A5', color: '#B91C1C',
              borderRadius: v2.radius.input,
            }}>
              <AlertTriangle size={12} /> {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '12px 16px', borderTop: `1px solid ${v2.colors.border}`,
          background: v2.colors.bgCard, gap: 10,
        }}>
          <div style={{ fontSize: 11, color: v2.colors.textMuted }}>
            {selected.length} recipient{selected.length === 1 ? '' : 's'} · {body.length} chars
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={onClose} style={cancelBtn}>Cancel</button>
            <button onClick={handleSend} disabled={!canSend} style={sendBtn(canSend)}>
              {sending ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={13} />}
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 10, fontWeight: 600, color: theme.v2.colors.textMuted,
  textTransform: 'uppercase', letterSpacing: '1.5px',
  marginBottom: 6,
};
const iconBtn: React.CSSProperties = {
  background: 'none', border: 'none', cursor: 'pointer',
  color: theme.v2.colors.textSecondary, padding: 4, display: 'flex',
};
const recipientChip: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center',
  padding: '4px 8px 4px 10px', fontSize: 11, fontWeight: 600,
  background: theme.v2.colors.accent, color: '#fff',
  borderRadius: 100,
};
const clearBtn: React.CSSProperties = {
  padding: '3px 10px', fontSize: 10, fontWeight: 600,
  background: 'transparent', border: `1px solid ${theme.v2.colors.border}`, borderRadius: 100,
  color: theme.v2.colors.textSecondary, cursor: 'pointer', fontFamily: 'inherit',
};
const quickBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '6px 12px', fontSize: 11, fontWeight: 600,
  border: `1px solid ${theme.v2.colors.border}`, borderRadius: 100,
  background: '#fff', color: theme.v2.colors.textSecondary,
  cursor: 'pointer', fontFamily: 'inherit',
};
function rolePill(role: ComposeRecipient['role']): React.CSSProperties {
  const colors = {
    admin:  { bg: '#FEF3EE', color: '#C2410C' },
    staff:  { bg: '#EFF6FF', color: '#1D4ED8' },
    client: { bg: '#F0FDF4', color: '#15803D' },
  }[role];
  return {
    padding: '2px 7px', fontSize: 9, fontWeight: 700, letterSpacing: '0.05em',
    borderRadius: 4, textTransform: 'uppercase',
    background: colors.bg, color: colors.color,
    flexShrink: 0,
  };
}
const cancelBtn: React.CSSProperties = {
  padding: '8px 14px', fontSize: 11, fontWeight: 600, letterSpacing: '1.5px', textTransform: 'uppercase',
  border: `1px solid ${theme.v2.colors.border}`, borderRadius: 100,
  background: '#fff', color: theme.v2.colors.textSecondary,
  cursor: 'pointer', fontFamily: 'inherit',
};
function sendBtn(enabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '8px 16px', fontSize: 11, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase',
    border: 'none', borderRadius: 100,
    background: enabled ? theme.v2.colors.accent : theme.colors.border,
    color: '#fff', cursor: enabled ? 'pointer' : 'default',
    fontFamily: 'inherit',
    opacity: enabled ? 1 : 0.6,
  };
}
