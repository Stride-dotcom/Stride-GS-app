/**
 * StorageCreditsSection — lists active (deleted_at IS NULL) storage credits
 * for one inventory item on the item detail panel. Admins get a Remove
 * button that soft-deletes the credit (sets deleted_at) and writes an
 * entity_audit_log row. Credited day-ranges are subtracted from storage
 * billing by the _compute_storage_charges() Postgres function.
 */
import { useCallback, useEffect, useState } from 'react';
import { Trash2, Loader2 } from 'lucide-react';
import { theme } from '../../styles/theme';
import { supabase } from '../../lib/supabase';
import { fmtDate } from '../../lib/constants';
import { useAuth } from '../../contexts/AuthContext';

interface StorageCreditRow {
  id: string;
  free_from: string;
  free_to: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

interface Props {
  tenantId: string;
  itemId: string;
  isAdmin: boolean;
}

export function StorageCreditsSection({ tenantId, itemId, isAdmin }: Props) {
  const { user } = useAuth();
  const actorEmail = user?.email;
  const [rows, setRows] = useState<StorageCreditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId || !itemId) { setRows([]); return; }
    const { data, error: err } = await supabase
      .from('storage_credits')
      .select('id, free_from, free_to, reason, created_by, created_at')
      .eq('tenant_id', tenantId)
      .eq('item_id', itemId)
      .is('deleted_at', null)
      .order('free_from', { ascending: false });
    if (err) { setError(err.message); setRows([]); return; }
    setError(null);
    setRows((data ?? []) as StorageCreditRow[]);
  }, [tenantId, itemId]);

  useEffect(() => { void load(); }, [load]);

  const handleRemove = async (id: string) => {
    if (removingId) return;
    setRemovingId(id);
    const { error: err } = await supabase
      .from('storage_credits')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id)
      .is('deleted_at', null);
    if (err) {
      setError(err.message);
      setRemovingId(null);
      return;
    }
    supabase.from('entity_audit_log').insert({
      entity_type: 'storage_credit',
      entity_id: id,
      tenant_id: tenantId,
      action: 'soft_delete',
      changes: { item_id: itemId },
      performed_by: actorEmail || 'unknown',
      source: 'app',
    }).then(({ error: aErr }) => {
      if (aErr) console.warn('[storage_credit] audit insert failed (non-fatal):', aErr.message);
    });
    setRemovingId(null);
    void load();
  };

  if (rows === null) {
    return (
      <div style={{ fontSize: 12, color: theme.colors.textMuted, padding: '4px 0' }}>
        <Loader2 size={12} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle', marginRight: 6 }} />
        Loading storage credits…
      </div>
    );
  }

  if (error) {
    return <div style={{ fontSize: 12, color: '#B91C1C', padding: '4px 0' }}>Could not load storage credits: {error}</div>;
  }

  if (rows.length === 0) {
    return (
      <div style={{ fontSize: 12, color: theme.colors.textMuted, padding: '4px 0', fontStyle: 'italic' }}>
        No active storage credits for this item.
      </div>
    );
  }

  return (
    <div style={{ border: `1px solid ${theme.colors.borderDefault}`, borderRadius: 8, overflow: 'hidden' }}>
      {rows.map((c, idx) => (
        <div
          key={c.id}
          style={{
            display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px',
            borderBottom: idx < rows.length - 1 ? `1px solid ${theme.colors.borderDefault}` : 'none',
            background: '#F0FDF4',
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#15803D' }}>
              {fmtDate(c.free_from)} – {fmtDate(c.free_to)}
            </div>
            {c.reason && (
              <div style={{ fontSize: 12, color: theme.colors.text, marginTop: 2 }}>{c.reason}</div>
            )}
            <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 2 }}>
              Added by {c.created_by || 'unknown'} · {fmtDate(c.created_at)}
            </div>
          </div>
          {isAdmin && (
            <button
              onClick={() => handleRemove(c.id)}
              disabled={removingId === c.id}
              title="Remove credit"
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '5px 10px', fontSize: 11, fontWeight: 600,
                border: `1px solid #FCA5A5`, background: '#fff', color: '#B91C1C',
                borderRadius: 6, cursor: removingId === c.id ? 'wait' : 'pointer',
                fontFamily: 'inherit', flexShrink: 0,
              }}
            >
              {removingId === c.id
                ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />
                : <Trash2 size={12} />}
              Remove
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
