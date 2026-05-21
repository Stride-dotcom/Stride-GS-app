import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Truck, Loader2, X, AlertTriangle } from 'lucide-react';
import { theme } from '../../styles/theme';
import {
  DT_GROUP_LABEL,
  type DtChangeSummary,
  type DtFieldGroup,
} from '../../lib/dtSelectivePush';

/**
 * DtPushConfirmDialog — pre-push preview for an edit that's about to
 * touch DispatchTrack.
 *
 * Shows the operator EXACTLY which field-groups will be sent to DT
 * and what changed inside each group, so they can:
 *   - Confirm the partial push (DT keeps every other field as-is), or
 *   - Cancel — the Stride-side save still happened, but no XML hits DT.
 *
 * Why a dedicated dialog instead of the generic ConfirmDialog: the
 * change list needs grouped table-style rendering (label / from /
 * to) which doesn't fit cleanly into a plain message string. Also
 * sets the right operator mental model — "I'm sending these specific
 * groups, DT keeps everything else" — which is the entire point of
 * the selective-push flow.
 *
 * The caller is responsible for the Stride-side save BEFORE opening
 * this dialog. The confirm handler only fires the DT push.
 */

export interface DtPushConfirmDialogProps {
  open: boolean;
  /** Output of summarizeDtChanges(). Must have at least one group;
   *  the caller should skip the dialog (and the push) when
   *  summary.groups.length === 0. */
  summary: DtChangeSummary;
  /** Order identifier shown in the header for context (e.g. "ROC-00087-D"). */
  orderIdentifier: string;
  /** Fires when the operator confirms. The dialog stays open in a
   *  "Working…" state until the caller unmounts it (or sets open=false). */
  onConfirm: () => void | Promise<void>;
  /** Fires when the operator cancels. The Stride-side save is already
   *  done at this point; only the DT push is being skipped. */
  onCancel: () => void;
}

const GROUP_ICON_COLOR: Record<DtFieldGroup, string> = {
  items: '#0EA5E9',
  date: '#10B981',
  contact: '#8B5CF6',
  notes: '#F59E0B',
  custom: '#64748B',
};

export function DtPushConfirmDialog({
  open,
  summary,
  orderIdentifier,
  onConfirm,
  onCancel,
}: DtPushConfirmDialogProps) {
  const [processing, setProcessing] = useState(false);
  if (!open) return null;

  // Group the changes by their DT group for readable rendering.
  // We don't store the group on each change in the summary itself,
  // so we recompute the grouping here from the raw `groups` array
  // (which preserves entry order) — every change in the list maps
  // to exactly one group, but the summary structure doesn't carry
  // that linkage, so just show the changes flat and the groups as a
  // header tag-list. Good enough for the operator and keeps the
  // component decoupled from COLUMN_GROUP.
  const groupTags = summary.groups;
  const changes = summary.changes;

  const handleConfirm = async () => {
    if (processing) return;
    setProcessing(true);
    try {
      await onConfirm();
    } finally {
      setProcessing(false);
    }
  };

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
        padding: 16,
      }}
      onClick={e => {
        if (e.target === e.currentTarget && !processing) onCancel();
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 20,
          width: '100%',
          maxWidth: 560,
          maxHeight: '90vh',
          boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: 'inherit',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 18px',
            borderBottom: `1px solid ${theme.colors.border}`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Truck size={18} color={theme.colors.orange} />
            <span style={{ fontWeight: 700, fontSize: 15, color: theme.colors.text }}>
              Push changes to DispatchTrack
            </span>
            <span style={{
              fontWeight: 600, fontSize: 11, color: theme.colors.textMuted,
              fontFamily: 'monospace', marginLeft: 4,
            }}>
              {orderIdentifier}
            </span>
          </div>
          <button
            onClick={onCancel}
            disabled={processing}
            style={{
              background: 'none', border: 'none',
              cursor: processing ? 'not-allowed' : 'pointer',
              color: theme.colors.textMuted, padding: 4,
              opacity: processing ? 0.4 : 1,
            }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            padding: '16px 18px',
            overflow: 'auto',
            flex: 1,
            fontSize: 13,
            color: theme.colors.textSecondary,
            lineHeight: 1.55,
          }}
        >
          <div style={{ marginBottom: 12 }}>
            Only the field-groups below will be sent to DispatchTrack.
            Everything else on the DT order (dispatcher notes, driver
            assignment, schedule, etc.) stays as-is.
          </div>

          {/* Group chips */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
            {groupTags.map(g => (
              <span
                key={g}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', fontSize: 11, fontWeight: 600,
                  borderRadius: 100,
                  background: `${GROUP_ICON_COLOR[g]}1A`,
                  color: GROUP_ICON_COLOR[g],
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                }}
              >
                {DT_GROUP_LABEL[g]}
              </span>
            ))}
          </div>

          {/* Change list */}
          <div
            style={{
              border: `1px solid ${theme.colors.border}`,
              borderRadius: 10,
              overflow: 'hidden',
              fontSize: 12,
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: 0,
                padding: '8px 12px',
                background: theme.colors.bgSubtle,
                fontWeight: 700,
                fontSize: 10,
                color: theme.colors.textMuted,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                borderBottom: `1px solid ${theme.colors.border}`,
              }}
            >
              <span>Field</span>
              <span>From</span>
              <span>To</span>
            </div>
            {changes.map((c, idx) => (
              <div
                key={`${c.label}-${idx}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr',
                  gap: 0,
                  padding: '8px 12px',
                  borderBottom: idx === changes.length - 1
                    ? 'none'
                    : `1px solid ${theme.colors.borderLight || '#f0f0f0'}`,
                  background: idx % 2 === 0 ? '#fff' : '#fafafa',
                }}
              >
                <span style={{ fontWeight: 600, color: theme.colors.text }}>{c.label}</span>
                <span style={{
                  color: theme.colors.textMuted,
                  fontFamily: 'monospace', fontSize: 11,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }} title={c.from}>{c.from}</span>
                <span style={{
                  color: theme.colors.text,
                  fontFamily: 'monospace', fontSize: 11,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                }} title={c.to}>{c.to}</span>
              </div>
            ))}
          </div>

          <div
            style={{
              marginTop: 14,
              padding: '10px 12px',
              background: '#FFFBEB',
              border: '1px solid #FDE68A',
              borderRadius: 8,
              fontSize: 11,
              color: '#92400E',
              display: 'flex',
              gap: 8,
              alignItems: 'flex-start',
            }}
          >
            <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>
              Your Stride-side changes have already been saved. Cancel
              here only skips the DispatchTrack push — useful if you
              meant to edit Stride-only fields and don't want the
              dispatcher to see a "modified" flag on their end.
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '12px 18px',
            borderTop: `1px solid ${theme.colors.border}`,
            background: theme.colors.bgSubtle,
          }}
        >
          <button
            onClick={onCancel}
            disabled={processing}
            style={{
              padding: '12px 24px',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '1.5px',
              textTransform: 'uppercase',
              border: '1px solid rgba(0,0,0,0.08)',
              borderRadius: 100,
              background: '#fff',
              color: '#666',
              cursor: processing ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              opacity: processing ? 0.5 : 1,
            }}
          >
            Skip DT push
          </button>
          <button
            onClick={handleConfirm}
            disabled={processing}
            style={{
              padding: '12px 24px',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '1.5px',
              textTransform: 'uppercase',
              border: 'none',
              borderRadius: 100,
              background: theme.colors.orange,
              color: '#fff',
              cursor: processing ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              minWidth: 140,
              justifyContent: 'center',
              opacity: processing ? 0.8 : 1,
            }}
          >
            {processing && <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />}
            {processing ? 'Pushing…' : 'Push to DT'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
