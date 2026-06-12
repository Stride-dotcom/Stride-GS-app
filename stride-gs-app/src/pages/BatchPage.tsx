/**
 * BatchPage — D11 batch parent order detail (BATCH_WORK_ITEMS_QA.md).
 *
 * A batch is a parent ORDER NUMBER (JUS-INSP-3G — service code + 'G' group
 * suffix) housing real single-item sub-tasks (tasks.batch_no = the parent
 * number; task_id = {batchNo}-{itemId} → JUS-INSP-3G-1). There is no parent
 * row — this page derives everything
 * from the subs: overall progress, pass/fail counts, and the sub-task list.
 * Work happens in the sub-tasks themselves (click a row → the task page),
 * exactly like standalone tasks; completing the last sub triggers the ONE
 * batch summary email (option B, complete-task EF).
 *
 * Route: /batches/:batchNo?client={tenantId}. The tenant comes from the
 * query param (batch numbers are tenant-scoped; the demo prefix makes them
 * look global but grouping always reads tenant + batch_no).
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Layers, MapPin, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { theme } from '../styles/theme';
import { fmtDate } from '../lib/constants';
import { entityEvents } from '../lib/entityEvents';

interface SubTaskRow {
  task_id: string;
  item_id: string | null;
  type: string | null;
  status: string | null;
  result: string | null;
  task_notes: string | null;
  assigned_to: string | null;
  due_date: string | null;
  created: string | null;
  completed_at: string | null;
  location: string | null;
  vendor: string | null;
  description: string | null;
  sidemark: string | null;
}

const STATUS_CFG: Record<string, { bg: string; text: string }> = {
  'Open':        { bg: '#EFF6FF', text: '#1D4ED8' },
  'In Progress': { bg: '#EDE9FE', text: '#7C3AED' },
  'Completed':   { bg: '#F0FDF4', text: '#15803D' },
  'Cancelled':   { bg: '#F3F4F6', text: '#6B7280' },
};

export function BatchPage() {
  const { batchNo } = useParams<{ batchNo: string }>();
  const [searchParams] = useSearchParams();
  const tenantId = searchParams.get('client') || '';
  const navigate = useNavigate();

  const [subs, setSubs] = useState<SubTaskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!batchNo || !tenantId) { setLoading(false); setError('Missing batch number or client.'); return; }
    const { data, error: err } = await supabase
      .from('tasks')
      .select('task_id, item_id, type, status, result, task_notes, assigned_to, due_date, created, completed_at, location, vendor, description, sidemark')
      .eq('tenant_id', tenantId)
      .eq('batch_no', batchNo)
      .order('created', { ascending: true });
    if (err) { setError(err.message); setLoading(false); return; }
    setSubs((data ?? []) as SubTaskRow[]);
    setError(null);
    setLoading(false);
  }, [batchNo, tenantId]);

  useEffect(() => { void load(); }, [load]);

  // Live refresh — sub-task writes elsewhere (start/complete on the task
  // page, another staff member) land here within the realtime fan-out.
  useEffect(() => {
    return entityEvents.subscribe((type) => {
      if (type === 'task') void load();
    });
  }, [load]);

  const total = subs.length;
  const terminal = subs.filter(s => s.status === 'Completed' || s.status === 'Cancelled').length;
  const passed = subs.filter(s => s.result === 'Pass').length;
  const failed = subs.filter(s => s.result === 'Fail').length;
  const pct = total > 0 ? Math.round((terminal / total) * 100) : 0;
  const svcName = subs[0]?.type || 'Tasks';

  const openSub = (taskId: string) => {
    navigate(`/tasks/${encodeURIComponent(taskId)}?client=${encodeURIComponent(tenantId)}`);
  };

  return (
    <div style={{ padding: 24, fontFamily: theme.typography.fontFamily, maxWidth: 1100, margin: '0 auto' }}>
      <button
        onClick={() => navigate(-1)}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'none', border: 'none', cursor: 'pointer', color: theme.colors.textSecondary, fontSize: 12, fontWeight: 600, padding: 0, marginBottom: 14, fontFamily: 'inherit' }}
      >
        <ArrowLeft size={14} /> Back
      </button>

      <div style={{ background: theme.colors.bgCard, border: `1px solid ${theme.colors.border}`, borderRadius: 14, padding: 20, marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Layers size={20} color={theme.colors.orange} />
            <div>
              <div style={{ fontSize: 18, fontWeight: 700, fontFamily: 'monospace' }}>{batchNo}</div>
              <div style={{ fontSize: 12, color: theme.colors.textMuted }}>
                {svcName} batch — {total} item{total !== 1 ? 's' : ''}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 12 }}>
            <span style={{ fontWeight: 600 }}>{terminal} of {total} complete</span>
            {passed > 0 && <span style={{ color: '#15803D', fontWeight: 600 }}><CheckCircle2 size={12} style={{ verticalAlign: -2 }} /> {passed} passed</span>}
            {failed > 0 && <span style={{ color: '#B91C1C', fontWeight: 600 }}><XCircle size={12} style={{ verticalAlign: -2 }} /> {failed} failed</span>}
          </div>
        </div>
        {total > 0 && (
          <div style={{ height: 5, borderRadius: 3, background: theme.colors.border, marginTop: 14, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: failed > 0 ? '#B91C1C' : '#15803D', transition: 'width 0.25s ease' }} />
          </div>
        )}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 8, background: '#FEF2F2', border: '1px solid #FECACA', color: '#B91C1C', fontSize: 13, marginBottom: 16 }}>{error}</div>
      )}

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: theme.colors.textMuted, fontSize: 13, padding: 20 }}>
          <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Loading batch…
        </div>
      ) : subs.length === 0 && !error ? (
        <div style={{ color: theme.colors.textMuted, fontSize: 13, padding: 20 }}>
          No tasks found for this batch.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {subs.map(s => {
            const sc = STATUS_CFG[String(s.status ?? '')] || { bg: '#F3F4F6', text: '#6B7280' };
            return (
              <div
                key={s.task_id}
                onClick={() => openSub(s.task_id)}
                style={{ background: theme.colors.bgCard, border: `1px solid ${theme.colors.border}`, borderRadius: 10, padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = theme.colors.orange)}
                onMouseLeave={e => (e.currentTarget.style.borderColor = theme.colors.border)}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 700, fontSize: 13, fontFamily: 'monospace', color: theme.colors.orange }}>{s.task_id}</span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{s.item_id}</span>
                    {s.location && (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '1px 8px', borderRadius: 10, background: '#EFF6FF', color: '#1D4ED8', fontSize: 10, fontWeight: 600 }}>
                        <MapPin size={10} /> {s.location}
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[s.vendor, s.description, s.sidemark].filter(Boolean).join(' · ') || '—'}
                  </div>
                  {s.task_notes && (
                    <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.task_notes}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  {s.result === 'Pass' && <span style={{ fontSize: 11, fontWeight: 700, color: '#15803D' }}>✓ Pass</span>}
                  {s.result === 'Fail' && <span style={{ fontSize: 11, fontWeight: 700, color: '#B91C1C' }}>✗ Fail</span>}
                  {s.due_date && s.status !== 'Completed' && s.status !== 'Cancelled' && (
                    <span style={{ fontSize: 11, color: theme.colors.textMuted }}>Due {fmtDate(s.due_date)}</span>
                  )}
                  <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, background: sc.bg, color: sc.text, whiteSpace: 'nowrap' }}>
                    {s.status}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ fontSize: 11, color: theme.colors.textMuted, marginTop: 14 }}>
        Each line is a real task — open it to start, add notes/photos, and pass or fail the item.
        When the last one is completed, the client gets one summary email with every item's result.
      </div>
    </div>
  );
}
