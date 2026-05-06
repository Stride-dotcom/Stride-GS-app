/**
 * QBOPushButton — Push selected invoices to QuickBooks Online from the Billing toolbar.
 *
 * v38.197.0 — Push lifecycle now lives in QboPushJobsContext. The button
 * validates selection + fires `startJob`; progress/success/failure renders in
 * the App-level toast which survives navigation and browser refresh.
 *
 * Pre-fix this component owned local state for `pushing`, the result, and the
 * skip dialog — which all disappeared the moment the operator left the
 * Billing page.
 */
import { useCallback } from 'react';
import { BookOpen } from 'lucide-react';
import { theme } from '../../styles/theme';
import { useQBO } from '../../hooks/useQBO';
import { useQboPushJobs } from '../../contexts/QboPushJobsContext';

interface QBOPushButtonProps {
  /** Get selected ledger row IDs from the billing table */
  getSelectedLedgerRowIds: () => { ledgerRowIds: string[]; hasSelection: boolean; hasInvoicedRows: boolean };
  /** Lightweight start-time feedback. Persistent result tracking is the
   *  toast's job; this callback only conveys click-time validation errors
   *  or a "queued" confirmation. */
  onResult: (msg: { success?: string; error?: string }) => void;
}

export function QBOPushButton({ getSelectedLedgerRowIds, onResult }: QBOPushButtonProps) {
  const { connected, loading: statusLoading } = useQBO();
  const { startJob, inFlightJobs } = useQboPushJobs();

  // Disable while ANY toolbar-initiated QBO push is in flight to avoid
  // accidental double-clicks queuing redundant jobs.
  const toolbarBusy = inFlightJobs.some(j => j.source === 'toolbar');

  const handlePush = useCallback(async () => {
    const selection = getSelectedLedgerRowIds();
    if (!selection.hasSelection) {
      onResult({ error: 'Select invoiced rows to push. Use the checkboxes to select rows first.' });
      return;
    }
    if (!selection.hasInvoicedRows) {
      onResult({ error: 'None of the selected rows are Invoiced. Create invoices first, then select the invoiced rows to push.' });
      return;
    }
    const jobId = await startJob({
      ledgerRowIds: selection.ledgerRowIds,
      source: 'toolbar',
      autoAssignDocNumber: true,
    });
    if (!jobId) {
      onResult({ error: 'Failed to queue QBO push — see browser console for details.' });
      return;
    }
    onResult({ success: 'QBO push started — progress will appear in the bottom-right toast and stays visible if you navigate away.' });
  }, [getSelectedLedgerRowIds, onResult, startJob]);

  if (statusLoading) return null;

  return (
    <button
      onClick={handlePush}
      disabled={!connected || toolbarBusy}
      title={
        !connected ? 'Connect QuickBooks first (Settings → Integrations)'
        : toolbarBusy ? 'A QBO push is already running — see the toast in the bottom-right'
        : 'Push selected invoices to QuickBooks Online'
      }
      style={{
        padding: '7px 12px',
        fontSize: 12,
        fontWeight: 600,
        border: `1px solid ${connected ? '#16A34A' : theme.colors.border}`,
        borderRadius: 8,
        background: '#fff',
        cursor: !connected || toolbarBusy ? 'default' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        fontFamily: 'inherit',
        color: connected ? '#16A34A' : theme.colors.textMuted,
        opacity: !connected ? 0.5 : (toolbarBusy ? 0.7 : 1),
      }}
    >
      <BookOpen size={14} />
      {toolbarBusy ? 'Pushing…' : 'QBO Push'}
    </button>
  );
}
