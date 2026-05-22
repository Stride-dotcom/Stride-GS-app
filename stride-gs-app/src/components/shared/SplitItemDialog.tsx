import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Loader2, Split as SplitIcon, X } from 'lucide-react';
import { theme } from '../../styles/theme';
import { postCreateSplitTask, type CreateSplitTaskPayload } from '../../lib/api';
import { useAuth } from '../../contexts/AuthContext';

/**
 * SplitItemDialog — staff/client-facing dialog for splitting a grouped item.
 *
 * Opens from the ItemDetail page footer (Split pill) or from the client
 * portal partial-qty notice. Shows the current qty, lets the user pick how
 * many to keep on the parent label (everything else becomes new individual
 * items), and submits a Split task via `createSplitTask` (GAS). Warehouse
 * completes the task later via the SplitTaskPanel which calls the atomic
 * Postgres `rpc_complete_split_task`.
 *
 * Pure presentation — no calls to the SB write path. The mutation that
 * actually creates child items happens at task-completion time, not here.
 */

export interface SplitItemDialogProps {
  open: boolean;
  onClose: () => void;
  /** The grouped item being split. We read `itemId`, `qty`, and
   *  `clientSheetId` off this; everything else is for display. */
  item: {
    itemId: string;
    qty: number;
    description?: string;
    vendor?: string;
    itemClass?: string;
    sidemark?: string;
    location?: string;
  };
  clientSheetId: string;
  /** Optional context for client-portal partial-qty flows. When supplied,
   *  surfaces in the success email + task metadata so warehouse staff
   *  know which downstream request triggered the split. */
  origin?: CreateSplitTaskPayload['origin'];
  originEntityId?: string;
  originEntityNumber?: string;
  /** Fires after a task is created (or an existing pending task is
   *  detected). Receives the task id so the caller can navigate or
   *  refetch. */
  onCreated?: (taskId: string, alreadyExists: boolean) => void;
}

export function SplitItemDialog({
  open,
  onClose,
  item,
  clientSheetId,
  origin = 'item',
  originEntityId,
  originEntityNumber,
  onCreated,
}: SplitItemDialogProps) {
  const { user } = useAuth();

  const groupedQty = useMemo(() => {
    const n = Number(item?.qty);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }, [item?.qty]);
  const maxLeftover = Math.max(1, groupedQty - 1);

  // "Leftover" = how many become NEW individual labels (qty=1 each).
  // Default: leave 1 on the parent, split everything else off.
  const [leftoverQty, setLeftoverQty] = useState<number>(maxLeftover);
  const [notes, setNotes] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state every time the dialog opens (or the underlying item changes).
  // Without this a previous error sticks around and the qty input still shows
  // the last value the user typed for a different item.
  useEffect(() => {
    if (!open) return;
    setLeftoverQty(maxLeftover);
    setNotes('');
    setError(null);
  }, [open, item?.itemId, maxLeftover]);

  if (!open) return null;

  const keepQty = Math.max(1, groupedQty - leftoverQty);
  const canSubmit = !submitting
    && groupedQty > 1
    && leftoverQty >= 1
    && leftoverQty <= maxLeftover
    && keepQty >= 1;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await postCreateSplitTask(
        {
          itemId: item.itemId,
          groupedQty,
          keepQty,
          leftoverQty,
          notes: notes.trim() || undefined,
          origin,
          originEntityId,
          originEntityNumber,
          requestedByEmail: user?.email || null,
          requestedByName: (user as { name?: string } | null)?.name || null,
        },
        clientSheetId,
      );
      if (!res.ok) {
        setError(res.error || 'Could not create Split task.');
        return;
      }
      const data = res.data;
      if (!data?.success || !data.taskId) {
        setError(data?.error || 'Could not create Split task.');
        return;
      }
      onCreated?.(data.taskId, !!data.alreadyExists);
      onClose();
    } catch (e) {
      setError((e as Error)?.message || 'Could not create Split task.');
    } finally {
      setSubmitting(false);
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
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 20,
          width: '100%',
          maxWidth: 480,
          boxShadow: '0 24px 60px rgba(0,0,0,0.25)',
          overflow: 'hidden',
          fontFamily: 'inherit',
        }}
      >
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
            <SplitIcon size={18} color={theme.colors.orange} />
            <div style={{ fontWeight: 700, fontSize: 16, color: theme.colors.text }}>
              Split Item {item.itemId}
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              background: 'transparent', border: 'none', cursor: submitting ? 'not-allowed' : 'pointer',
              color: theme.colors.textMuted, padding: 4, borderRadius: 6,
            }}
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '16px 18px' }}>
          <div
            style={{
              background: '#FAFAFA',
              border: `1px solid ${theme.colors.border}`,
              borderRadius: 12,
              padding: '10px 12px',
              fontSize: 13,
              color: theme.colors.text,
              marginBottom: 14,
            }}
          >
            <div style={{ fontWeight: 600 }}>{item.itemId}</div>
            <div style={{ color: theme.colors.textMuted }}>
              {item.description || '—'}
            </div>
            <div style={{ marginTop: 6, color: theme.colors.textMuted }}>
              Grouped qty: <span style={{ color: theme.colors.text, fontWeight: 600 }}>{groupedQty}</span>
              {item.itemClass ? <> · Class: <span style={{ color: theme.colors.text, fontWeight: 600 }}>{item.itemClass}</span></> : null}
            </div>
          </div>

          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: theme.colors.text, marginBottom: 6 }}>
            Split off (new individual items)
          </label>
          <input
            type="number"
            min={1}
            max={maxLeftover}
            step={1}
            value={leftoverQty}
            onChange={(e) => {
              const raw = parseInt(e.target.value || '0', 10);
              const next = Number.isFinite(raw) ? raw : 1;
              setLeftoverQty(Math.max(1, Math.min(maxLeftover, next)));
            }}
            disabled={submitting || groupedQty <= 1}
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 10,
              border: `1px solid ${theme.colors.border}`,
              fontSize: 14,
              fontFamily: 'inherit',
              outline: 'none',
            }}
          />
          <div style={{ fontSize: 12, color: theme.colors.textMuted, marginTop: 6 }}>
            Keeps <span style={{ color: theme.colors.text, fontWeight: 600 }}>{keepQty}</span> on parent label {item.itemId} ·
            creates <span style={{ color: theme.colors.text, fontWeight: 600 }}>{leftoverQty}</span> new item{leftoverQty === 1 ? '' : 's'}.
          </div>

          <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: theme.colors.text, margin: '14px 0 6px' }}>
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={submitting}
            rows={3}
            placeholder="Add any handling notes for the warehouse team…"
            style={{
              width: '100%',
              padding: '10px 12px',
              borderRadius: 10,
              border: `1px solid ${theme.colors.border}`,
              fontSize: 14,
              fontFamily: 'inherit',
              outline: 'none',
              resize: 'vertical',
            }}
          />

          {error && (
            <div
              style={{
                marginTop: 12,
                padding: '8px 12px',
                borderRadius: 10,
                background: '#FEF2F2',
                border: '1px solid #FCA5A5',
                color: '#B91C1C',
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            padding: '12px 18px',
            borderTop: `1px solid ${theme.colors.border}`,
            background: '#FAFAFA',
          }}
        >
          <button
            onClick={onClose}
            disabled={submitting}
            style={{
              padding: '8px 14px',
              borderRadius: 10,
              border: `1px solid ${theme.colors.border}`,
              background: '#fff',
              color: theme.colors.text,
              fontWeight: 600,
              cursor: submitting ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSubmit()}
            disabled={!canSubmit}
            style={{
              padding: '8px 14px',
              borderRadius: 10,
              border: 'none',
              background: canSubmit ? theme.colors.orange : '#FBBF24',
              color: '#fff',
              fontWeight: 700,
              cursor: canSubmit ? 'pointer' : 'not-allowed',
              fontFamily: 'inherit',
              display: 'inline-flex', alignItems: 'center', gap: 6,
            }}
          >
            {submitting ? (
              <>
                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                Creating…
              </>
            ) : (
              <>
                <SplitIcon size={14} />
                Create Split Task
              </>
            )}
          </button>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    </div>,
    document.body,
  );
}
