/**
 * ItemCodStorageSection — Item Detail card for the COD Storage flag
 * ("end customers pay storage"). Toggle + start-date picker, persisted via
 * the set_cod_storage RPC (admin/staff gated; inventory has no browser
 * UPDATE policy). Feature-gated by the caller.
 */
import { useEffect, useState } from 'react';
import { CalendarDays, CheckCircle2, AlertTriangle, Coins } from 'lucide-react';
import { theme } from '../../styles/theme';
import { WriteButton } from './WriteButton';
import { setCodStorage, todayIso } from '../../lib/codStorage';
import { entityEvents } from '../../lib/entityEvents';
import type { InventoryItem } from '../../lib/types';

interface Props {
  item: InventoryItem;
  clientSheetId?: string;
  canEdit: boolean;
  applyItemPatch?: (itemId: string, patch: Partial<InventoryItem>) => void;
  clearItemPatch?: (itemId: string) => void;
}

export function ItemCodStorageSection({ item, clientSheetId, canEdit, applyItemPatch, clearItemPatch }: Props) {
  const [enabled, setEnabled] = useState(!!item.codStorage);
  const [startDate, setStartDate] = useState(item.codStorageStartDate || todayIso());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Re-sync when the underlying item changes (e.g. realtime refresh).
  useEffect(() => {
    setEnabled(!!item.codStorage);
    setStartDate(item.codStorageStartDate || todayIso());
  }, [item.itemId, item.codStorage, item.codStorageStartDate]);

  const dirty =
    enabled !== !!item.codStorage ||
    (enabled && startDate !== (item.codStorageStartDate || ''));

  const handleSave = async () => {
    if (!clientSheetId || !canEdit || saving) return;
    setSaving(true);
    setError(null);
    setSuccess(false);
    const newStart = enabled ? startDate : '';
    applyItemPatch?.(item.itemId, { codStorage: enabled, codStorageStartDate: newStart });
    try {
      await setCodStorage(clientSheetId, [item.itemId], enabled, enabled ? startDate : null);
      setSuccess(true);
      entityEvents.emit('inventory', item.itemId);
      setTimeout(() => setSuccess(false), 2500);
    } catch (err) {
      clearItemPatch?.(item.itemId);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ border: `1px solid ${theme.colors.borderLight}`, borderRadius: 12, padding: '12px 14px', marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Coins size={15} color={theme.colors.orange} />
        <span style={{ fontSize: 13, fontWeight: 600, color: theme.colors.text }}>COD Storage</span>
        {item.codStorage && (
          <span style={{ fontSize: 9, fontWeight: 700, background: '#FFF7F0', color: theme.colors.orange, border: `1px solid ${theme.colors.orange}`, padding: '1px 6px', borderRadius: 6, textTransform: 'uppercase' }}>
            On{item.codStorageStartDate ? ` · ${item.codStorageStartDate}` : ''}
          </span>
        )}
      </div>

      <div style={{ fontSize: 11, color: theme.colors.textMuted, marginBottom: 10 }}>
        When on, the designer is billed storage only through the day before the start date.
        Remaining days are collected from the end customer at delivery.
      </div>

      {/* Toggle */}
      <div
        onClick={() => { if (canEdit) setEnabled(v => !v); }}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '8px 12px', borderRadius: 8, marginBottom: enabled ? 10 : 0,
          border: `1px solid ${enabled ? theme.colors.orange : theme.colors.borderDefault}`,
          background: enabled ? '#FFF7F0' : '#fff',
          cursor: canEdit ? 'pointer' : 'default', userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 500, color: enabled ? theme.colors.orange : theme.colors.textSecondary }}>
          End customer pays storage
        </span>
        <div style={{ width: 32, height: 18, borderRadius: 9, background: enabled ? theme.colors.orange : theme.colors.border, position: 'relative', flexShrink: 0, transition: 'background 0.15s' }}>
          <div style={{ position: 'absolute', top: 2, left: enabled ? 16 : 2, width: 14, height: 14, borderRadius: '50%', background: '#fff', transition: 'left 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
        </div>
      </div>

      {enabled && (
        <div style={{ marginBottom: 10 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: theme.colors.textSecondary, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
            <CalendarDays size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            COD start date
          </label>
          <input
            type="date"
            value={startDate}
            disabled={!canEdit}
            onChange={e => setStartDate(e.target.value)}
            style={{ width: '100%', padding: '8px 12px', fontSize: 13, border: `1px solid ${theme.colors.borderDefault}`, borderRadius: 8, fontFamily: 'inherit', outline: 'none' }}
          />
        </div>
      )}

      {error && (
        <div style={{ padding: 8, background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertTriangle size={14} color="#DC2626" />
          <span style={{ fontSize: 12, color: '#991B1B' }}>{error}</span>
        </div>
      )}

      {canEdit && (dirty || success) && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
          {success && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: '#15803D' }}>
              <CheckCircle2 size={14} /> Saved
            </span>
          )}
          {dirty && (
            <WriteButton
              label={saving ? 'Saving...' : 'Save'}
              variant="primary"
              size="sm"
              disabled={saving || !clientSheetId || (enabled && !startDate)}
              onClick={handleSave}
            />
          )}
        </div>
      )}
    </div>
  );
}
