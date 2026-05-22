import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, ExternalLink, Loader2, Split as SplitIcon } from 'lucide-react';
import { theme } from '../../styles/theme';
import { postCompleteSplitTask, type CompleteSplitTaskResponse } from '../../lib/api';
import { supabase } from '../../lib/supabase';

/**
 * SplitTaskPanel — renders inline at the top of a Split task's Details
 * tab. Surfaces the workflow params (parent item, keep/leftover qty,
 * requester, origin entity) and an "Apply Split" button that calls the
 * GAS `completeSplitTask` action.
 *
 * The actual mutation is server-side and atomic: GAS → Postgres
 * rpc_complete_split_task → SB→Sheet write-back of new inventory rows
 * + SPLIT billing rows. This panel is read-only state + a single submit
 * button; once the task is Completed the panel hydrates the resulting
 * child item codes from public.inventory.parent_item_id for reprint.
 */

interface SplitWorkflowMeta {
  origin_entity_type?: 'shipment' | 'task' | 'will_call' | 'disposal' | 'item';
  origin_entity_id?: string;
  origin_entity_number?: string | null;
  parent_item_id?: string;
  parent_item_code?: string;
  grouped_qty?: number;
  keep_qty?: number;
  leftover_qty?: number;
  requested_by_email?: string | null;
  requested_by_name?: string | null;
  request_notes?: string | null;
  child_item_codes?: string[] | null;
}

interface SplitTaskPanelProps {
  task: {
    taskId: string;
    status?: string;
    type?: string;
    itemId?: string;
    metadata?: { split_workflow?: SplitWorkflowMeta | null } | null;
  };
  clientSheetId: string;
  onCompleted?: () => void;
}

export function SplitTaskPanel({ task, clientSheetId, onCompleted }: SplitTaskPanelProps) {
  const meta = (task.metadata?.split_workflow ?? null) as SplitWorkflowMeta | null;

  const groupedQty = meta?.grouped_qty ?? null;
  const keepQty    = meta?.keep_qty ?? null;
  const leftover   = meta?.leftover_qty ?? null;
  const parentId   = meta?.parent_item_id || task.itemId || '';

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [childCodes, setChildCodes] = useState<string[]>(
    Array.isArray(meta?.child_item_codes) ? meta!.child_item_codes!.map(String) : [],
  );

  const alreadyCompleted = task.status === 'Completed';

  // If the task is already completed but metadata hasn't propagated the
  // child codes (e.g. the user reopened the panel from a deep link before
  // the GAS write-back finished), fall back to a Supabase read against
  // inventory.parent_item_id.
  useEffect(() => {
    if (!alreadyCompleted || childCodes.length > 0 || !parentId || !clientSheetId) return;
    let cancelled = false;
    void (async () => {
      try {
        const { data, error: qErr } = await (supabase.from('inventory') as any)
          .select('item_id')
          .eq('tenant_id', clientSheetId)
          .eq('parent_item_id', parentId)
          .order('item_id')
          .limit(200);
        if (cancelled) return;
        if (qErr) {
          console.warn('[SplitTaskPanel] hydrate child codes failed:', qErr);
          return;
        }
        const codes = Array.isArray(data) ? data.map((r: any) => String(r.item_id)).filter(Boolean) : [];
        if (codes.length > 0) setChildCodes(codes);
      } catch (e) {
        console.warn('[SplitTaskPanel] hydrate child codes failed:', e);
      }
    })();
    return () => { cancelled = true; };
  }, [alreadyCompleted, childCodes.length, parentId, clientSheetId]);

  const originLink = useMemo(() => {
    if (!meta?.origin_entity_id || !meta?.origin_entity_type) return null;
    if (meta.origin_entity_type === 'will_call') {
      return { label: 'Will Call', to: `/will-calls/${encodeURIComponent(meta.origin_entity_id)}` };
    }
    if (meta.origin_entity_type === 'task') {
      return { label: 'Task', to: `/tasks/${encodeURIComponent(meta.origin_entity_id)}` };
    }
    if (meta.origin_entity_type === 'shipment') {
      return { label: 'Shipment', to: `/shipments/${encodeURIComponent(meta.origin_entity_id)}` };
    }
    if (meta.origin_entity_type === 'disposal') {
      return { label: 'Disposal', to: `/tasks/${encodeURIComponent(meta.origin_entity_id)}` };
    }
    return null;
  }, [meta?.origin_entity_id, meta?.origin_entity_type]);

  const handleComplete = async () => {
    if (alreadyCompleted || submitting) return;
    if (!parentId || !leftover || !keepQty) {
      setError('Split workflow is missing parent/keep/leftover parameters.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await postCompleteSplitTask({ taskId: task.taskId }, clientSheetId);
      if (!res.ok) {
        setError(res.error || 'Could not complete Split task.');
        return;
      }
      const data: CompleteSplitTaskResponse | undefined = res.data;
      if (!data?.success) {
        setError(data?.error || 'Could not complete Split task.');
        return;
      }
      if (Array.isArray(data.childItemCodes) && data.childItemCodes.length > 0) {
        setChildCodes(data.childItemCodes.map(String));
      }
      onCompleted?.();
    } catch (e) {
      setError((e as Error)?.message || 'Could not complete Split task.');
    } finally {
      setSubmitting(false);
    }
  };

  if (!meta) {
    return (
      <div
        style={{
          background: '#FEF3C7',
          border: '1px solid #FBBF24',
          borderRadius: 10,
          padding: 12,
          marginBottom: 16,
          fontSize: 13,
          color: '#92400E',
        }}
      >
        This Split task is missing its workflow metadata. The qty change can&apos;t be applied automatically — please contact support.
      </div>
    );
  }

  return (
    <div
      style={{
        background: '#fff',
        border: `1px solid ${theme.colors.border}`,
        borderRadius: 12,
        padding: 14,
        marginBottom: 16,
        boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <SplitIcon size={16} color={theme.colors.orange} />
        <div style={{ fontSize: 13, fontWeight: 700 }}>Split Workflow</div>
        <span
          style={{
            display: 'inline-block',
            marginLeft: 8,
            padding: '2px 8px',
            borderRadius: 10,
            background: theme.colors.bgSubtle,
            border: `1px solid ${theme.colors.border}`,
            fontSize: 11,
            color: theme.colors.textSecondary,
          }}
        >
          {leftover ?? 0} new label{(leftover ?? 0) === 1 ? '' : 's'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12 }}>
        <div>
          <div style={{ color: theme.colors.textMuted, marginBottom: 2 }}>Parent item</div>
          <div style={{ fontWeight: 600 }}>{parentId || '—'}</div>
        </div>
        <div>
          <div style={{ color: theme.colors.textMuted, marginBottom: 2 }}>Quantities</div>
          <div>
            Grouped <strong>{groupedQty ?? '—'}</strong> · Keep <strong>{keepQty ?? '—'}</strong> · Split <strong>{leftover ?? '—'}</strong>
          </div>
        </div>
        {(meta.requested_by_name || meta.requested_by_email) && (
          <div>
            <div style={{ color: theme.colors.textMuted, marginBottom: 2 }}>Requested by</div>
            <div>{meta.requested_by_name || meta.requested_by_email}</div>
          </div>
        )}
        {originLink && (
          <div>
            <div style={{ color: theme.colors.textMuted, marginBottom: 2 }}>Origin</div>
            <Link
              to={originLink.to}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                color: theme.colors.orange, fontWeight: 600, textDecoration: 'none',
              }}
            >
              {originLink.label} {meta.origin_entity_number || ''} <ExternalLink size={11} />
            </Link>
          </div>
        )}
      </div>

      {meta.request_notes && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 10px',
            background: theme.colors.bgSubtle,
            borderRadius: 8,
            fontSize: 12,
            color: theme.colors.textSecondary,
            whiteSpace: 'pre-wrap',
          }}
        >
          <div style={{ fontWeight: 600, color: theme.colors.text, marginBottom: 2 }}>Notes</div>
          {meta.request_notes}
        </div>
      )}

      {childCodes.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: theme.colors.textMuted, marginBottom: 4 }}>
            New item codes
          </div>
          <div
            style={{
              padding: '8px 10px',
              border: `1px solid ${theme.colors.border}`,
              borderRadius: 8,
              fontFamily: 'monospace',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {childCodes.join('\n')}
          </div>
        </div>
      )}

      {error && (
        <div
          style={{
            marginTop: 10,
            padding: '8px 10px',
            borderRadius: 8,
            background: '#FEF2F2',
            border: '1px solid #FCA5A5',
            color: '#B91C1C',
            fontSize: 12,
          }}
        >
          {error}
        </div>
      )}

      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {alreadyCompleted ? (
          <span
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '6px 10px', borderRadius: 8,
              background: '#F0FDF4', color: '#15803D',
              fontSize: 12, fontWeight: 700,
            }}
          >
            <CheckCircle2 size={13} /> Split applied
          </span>
        ) : (
          <button
            onClick={() => void handleComplete()}
            disabled={submitting}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 10,
              border: 'none', background: theme.colors.orange, color: '#fff',
              fontWeight: 700, fontSize: 13, cursor: submitting ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {submitting ? (
              <>
                <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                Splitting…
              </>
            ) : (
              <>
                <SplitIcon size={13} />
                Apply Split &amp; Complete
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
