import React, { useState, useMemo } from 'react';
import { X, Check, ClipboardList, Loader2, AlertTriangle } from 'lucide-react';
import { postBatchCreateTasks } from '../../lib/api';
import type { InventoryItem, Task } from '../../lib/types';
import { usePricing } from '../../hooks/usePricing';
import { theme } from '../../styles/theme';

interface Props {
  items: InventoryItem[];
  clientSheetId: string;
  onClose: () => void;
  onSuccess: (taskIds: string[]) => void;
  // Phase 2C — optimistic create functions (optional)
  addOptimisticTask?: (task: Task) => void;
  removeOptimisticTask?: (tempTaskId: string) => void;
  clientName?: string;
  /** Existing tasks — used to warn about duplicates before submit */
  existingTasks?: Task[];
}

interface ConflictInfo {
  itemId: string;
  taskId: string;
  svcCode: string;
  typeName: string;
}

// Always offer these core task types
const CORE_TYPES = [
  { code: 'INSP', name: 'Inspection' },
  { code: 'ASM',  name: 'Assembly' },
];

// Exclude billing-only and special-flow types from the generic batch picker
const EXCLUDE_CODES = new Set(['STOR', 'RCVG', 'REPAIR', 'RPR', 'WC', 'WCPU']);

export function CreateTaskModal({ items, clientSheetId, onClose, onSuccess, addOptimisticTask, removeOptimisticTask, clientName, existingTasks }: Props) {
  const { priceList } = usePricing(true);
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set(['INSP']));
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ created: number; skippedCount: number; taskIds: string[] } | null>(null);
  const [error, setError] = useState('');
  const [dismissedConflicts, setDismissedConflicts] = useState(false);

  // Build deduplicated task type list: core first, then pricing extras
  const taskTypes = useMemo(() => {
    const seen = new Set<string>(CORE_TYPES.map(t => t.code));
    const types = [...CORE_TYPES];
    priceList.forEach(p => {
      const code = String(p['Service Code'] || '').trim().toUpperCase();
      const name = String(p['Service Name'] || code).trim();
      if (code && !seen.has(code) && !EXCLUDE_CODES.has(code)) {
        types.push({ code, name });
        seen.add(code);
      }
    });
    return types;
  }, [priceList]);

  // Check for existing open tasks that conflict with selected items + task types
  const conflicts = useMemo<ConflictInfo[]>(() => {
    if (!existingTasks?.length || !selectedCodes.size) return [];
    const openStatuses = new Set(['Open', 'In Progress']);
    const itemIdSet = new Set(items.map(i => i.itemId));
    const results: ConflictInfo[] = [];
    for (const t of existingTasks) {
      if (!openStatuses.has(t.status)) continue;
      if (!itemIdSet.has(t.itemId)) continue;
      const code = (t.svcCode || t.type || '').toUpperCase();
      if (!selectedCodes.has(code)) continue;
      const typeName = taskTypes.find(tt => tt.code === code)?.name || code;
      results.push({ itemId: t.itemId, taskId: t.taskId, svcCode: code, typeName });
    }
    return results;
  }, [existingTasks, items, selectedCodes, taskTypes]);

  const toggleCode = (code: string) => {
    setDismissedConflicts(false);
    setSelectedCodes(prev => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!selectedCodes.size || loading) return;
    setLoading(true);
    setError('');

    // Phase 2C: insert temp task rows immediately
    const tempIds: string[] = [];
    const now = new Date().toISOString().slice(0, 10);
    if (addOptimisticTask) {
      items.forEach((item, ii) => {
        Array.from(selectedCodes).forEach((code, ci) => {
          const tempId = `TEMP-${Date.now()}-${ii}-${ci}`;
          tempIds.push(tempId);
          addOptimisticTask({
            taskId: tempId,
            type: code as Task['type'],
            svcCode: code as Task['svcCode'],
            status: 'Open',
            itemId: item.itemId,
            clientId: clientSheetId,
            clientName: clientName || '',
            vendor: item.vendor,
            description: item.description || '',
            location: item.location,
            sidemark: item.sidemark,
            created: now,
            billed: false,
          });
        });
      });
    }

    try {
      const res = await postBatchCreateTasks(
        {
          items: items.map(i => ({
            itemId:      i.itemId,
            vendor:      i.vendor,
            description: i.description,
            location:    i.location,
            sidemark:    i.sidemark,
            itemNotes:   i.notes,
            shipmentNo:  i.shipmentNumber,
          })),
          svcCodes: Array.from(selectedCodes),
        },
        clientSheetId
      );
      if (res.data?.success) {
        const r = res.data;
        // Remove temp rows — refetch will load real task IDs
        tempIds.forEach(id => removeOptimisticTask?.(id));
        setResult({ created: r.created, skippedCount: r.skipped?.length ?? 0, taskIds: r.taskIds ?? [] });
        onSuccess(r.taskIds ?? []);
      } else {
        // Rollback temp rows
        tempIds.forEach(id => removeOptimisticTask?.(id));
        setError(res.error || res.data?.error || 'Failed to create tasks');
      }
    } catch (err: unknown) {
      // Rollback temp rows
      tempIds.forEach(id => removeOptimisticTask?.(id));
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const toggleStyle = (on: boolean): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
    border: `1px solid ${on ? theme.colors.orange : theme.colors.border}`,
    background: on ? theme.colors.orangeLight : '#fff',
    transition: 'all 0.15s',
  });

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', zIndex: 200 }} />
      <div style={{
        position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
        width: 420, maxWidth: '95vw', maxHeight: '85vh',
        background: '#fff', borderRadius: 14, boxShadow: '0 8px 40px rgba(0,0,0,0.15)',
        zIndex: 201, fontFamily: theme.typography.fontFamily, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
      }}>

        {/* Header */}
        <div style={{ padding: '14px 18px', borderBottom: `1px solid ${theme.colors.border}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ClipboardList size={16} color={theme.colors.orange} />
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Create Tasks</div>
              <div style={{ fontSize: 11, color: theme.colors.textMuted }}>
                {items.length} item{items.length !== 1 ? 's' : ''} selected
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted }}>
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 18 }}>
          {result ? (
            /* Success state */
            <div style={{ textAlign: 'center', padding: '20px 0' }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>✓</div>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#15803D', marginBottom: 6 }}>
                {result.created} task{result.created !== 1 ? 's' : ''} created
              </div>
              {result.skippedCount > 0 && (
                <div style={{ fontSize: 12, color: theme.colors.textMuted, marginBottom: 6 }}>
                  {result.skippedCount} skipped (already had open task)
                </div>
              )}
              <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 4 }}>
                {result.taskIds.slice(0, 5).join(', ')}{result.taskIds.length > 5 ? ` +${result.taskIds.length - 5} more` : ''}
              </div>
            </div>
          ) : (
            <>
              {/* Task type selector */}
              <div style={{ fontSize: 12, color: theme.colors.textMuted, marginBottom: 12 }}>
                Select task type(s) to create for all selected items:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
                {taskTypes.map(t => {
                  const on = selectedCodes.has(t.code);
                  return (
                    <div key={t.code} onClick={() => toggleCode(t.code)} style={toggleStyle(on)}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: on ? theme.colors.orange : theme.colors.text }}>
                          {t.name}
                        </div>
                        <div style={{ fontSize: 10, color: theme.colors.textMuted }}>{t.code}</div>
                      </div>
                      {on && <Check size={14} color={theme.colors.orange} />}
                    </div>
                  );
                })}
              </div>

              {/* Items preview */}
              <div style={{ fontSize: 11, fontWeight: 500, color: theme.colors.textMuted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Items ({items.length})
              </div>
              <div style={{
                maxHeight: 90, overflowY: 'auto', fontSize: 11, color: theme.colors.textSecondary,
                lineHeight: 1.7, padding: '8px 10px', background: theme.colors.bgSubtle,
                borderRadius: 8, marginBottom: 16,
              }}>
                {items.map(i => (
                  <div key={i.itemId}>
                    <span style={{ fontWeight: 600 }}>{i.itemId}</span>
                    {(i.description || i.vendor) ? ` — ${i.description || i.vendor}` : ''}
                  </div>
                ))}
              </div>

              {conflicts.length > 0 && !dismissedConflicts && (
                <div style={{ padding: '10px 12px', borderRadius: 8, background: '#FEF3C7', border: '1px solid #FCD34D', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <AlertTriangle size={14} color="#B45309" />
                    <span style={{ fontSize: 12, fontWeight: 700, color: '#92400E' }}>
                      {conflicts.length === 1 ? 'Existing open task found' : `${conflicts.length} existing open tasks found`}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#92400E', lineHeight: 1.7 }}>
                    {conflicts.map((c, i) => (
                      <div key={i}>
                        Item <strong>{c.itemId}</strong> already has an open {c.typeName} task{' '}
                        <a
                          href={`#/tasks?open=${c.taskId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ color: '#B45309', fontWeight: 700, textDecoration: 'underline' }}
                          onClick={e => e.stopPropagation()}
                        >{c.taskId}</a>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: '#92400E', marginTop: 6 }}>
                    Duplicates will be skipped automatically if you proceed.
                  </div>
                  <button
                    onClick={() => setDismissedConflicts(true)}
                    style={{ marginTop: 6, fontSize: 11, padding: '3px 10px', border: '1px solid #D97706', borderRadius: 6, background: 'transparent', color: '#92400E', cursor: 'pointer', fontWeight: 600 }}
                  >Dismiss</button>
                </div>
              )}

              {error && (
                <div style={{ padding: '8px 12px', borderRadius: 8, background: '#FEF2F2', color: '#DC2626', fontSize: 12, marginBottom: 12 }}>
                  {error}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 18px', borderTop: `1px solid ${theme.colors.border}`, display: 'flex', justifyContent: result ? 'center' : 'space-between', flexShrink: 0 }}>
          {result ? (
            <button onClick={onClose} style={{ padding: '8px 28px', border: 'none', borderRadius: 8, background: theme.colors.orange, color: '#fff', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', fontSize: 13 }}>
              Done
            </button>
          ) : (
            <>
              <button onClick={onClose} style={{ padding: '8px 16px', border: `1px solid ${theme.colors.border}`, borderRadius: 8, background: '#fff', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, color: theme.colors.textSecondary }}>
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading || !selectedCodes.size}
                style={{
                  padding: '8px 20px', border: 'none', borderRadius: 8,
                  background: selectedCodes.size && !loading ? theme.colors.orange : theme.colors.border,
                  color: selectedCodes.size && !loading ? '#fff' : theme.colors.textMuted,
                  fontWeight: 600, cursor: selectedCodes.size && !loading ? 'pointer' : 'not-allowed',
                  fontFamily: 'inherit', fontSize: 13,
                  display: 'flex', alignItems: 'center', gap: 6,
                }}
              >
                {loading
                  ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Creating…</>
                  : <>Create {Array.from(selectedCodes).join(' + ')} Tasks</>
                }
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
