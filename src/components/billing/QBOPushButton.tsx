/**
 * QBOPushButton — Push selected invoices to QuickBooks Online from the Billing toolbar.
 *
 * Handles: selection validation, loading state, skipped invoice warnings,
 * force re-push dialog, and success/error feedback.
 */
import { useState, useCallback } from 'react';
import { BookOpen, Loader2 } from 'lucide-react';
import { theme } from '../../styles/theme';
import { useQBO } from '../../hooks/useQBO';
import type { QboInvoiceResult } from '../../lib/api';

interface QBOPushButtonProps {
  /** Get selected ledger row IDs from the billing table */
  getSelectedLedgerRowIds: () => { ledgerRowIds: string[]; hasSelection: boolean; hasInvoicedRows: boolean };
  /** Callback with push results */
  onResult: (msg: { success?: string; error?: string; details?: Array<{ strideInvoiceNumber: string; error?: string; success?: boolean; qboInvoiceId?: string }>; retryIds?: string[] }) => void;
}

export function QBOPushButton({ getSelectedLedgerRowIds, onResult }: QBOPushButtonProps) {
  const { connected, loading: statusLoading, pushInvoice } = useQBO();
  const [pushing, setPushing] = useState(false);
  const [showSkipDialog, setShowSkipDialog] = useState(false);
  const [skippedResults, setSkippedResults] = useState<QboInvoiceResult[]>([]);
  const [skippedLedgerRowIds, setSkippedLedgerRowIds] = useState<string[]>([]);

  const handlePush = useCallback(async (forceRePush: boolean = false, ledgerRowIds?: string[]) => {
    const selection = getSelectedLedgerRowIds();

    const ids = ledgerRowIds || selection.ledgerRowIds;

    if (!forceRePush) {
      // Validate selection (same pattern as QB Export / IIF buttons)
      if (!selection.hasSelection) {
        onResult({ error: 'Select invoiced rows to push. Use the checkboxes to select rows first.' });
        return;
      }
      if (!selection.hasInvoicedRows) {
        onResult({ error: 'None of the selected rows are Invoiced. Create invoices first, then select the invoiced rows to push.' });
        return;
      }
    }

    setPushing(true);
    try {
      const result = await pushInvoice(ids, forceRePush);
      if (!result) {
        onResult({ error: 'QBO push returned no result' });
        return;
      }

      if (result.error && !result.results?.length) {
        onResult({ error: result.error });
        return;
      }

      // Check for skipped invoices
      const skipped = (result.results || []).filter(r => r.skipped);
      if (skipped.length > 0 && !forceRePush) {
        setSkippedResults(skipped);
        // Collect the ledger row IDs for skipped invoices
        // We need to re-push only the skipped ones
        setSkippedLedgerRowIds(ids); // Will filter server-side by invoice number
        setShowSkipDialog(true);
      }

      // Build feedback with per-invoice details
      const details = (result.results || []).map(r => ({
        strideInvoiceNumber: r.strideInvoiceNumber || '',
        error: r.error || undefined,
        success: r.success || false,
        qboInvoiceId: r.qboInvoiceId || undefined,
      }));

      const parts: string[] = [];
      if (result.pushedCount > 0) {
        const pushed = (result.results || []).filter(r => r.success);
        const docNums = pushed.map(r => r.qboDocNumber || r.strideInvoiceNumber).join(', ');
        parts.push(`Pushed ${result.pushedCount}: ${docNums}`);
      }
      if (result.skippedCount > 0 && !forceRePush) {
        parts.push(`${result.skippedCount} already in QBO`);
      }
      if (result.failedCount > 0) {
        parts.push(`${result.failedCount} failed`);
      }

      if (result.pushedCount > 0 && result.failedCount === 0) {
        onResult({ success: parts.join(' | '), details });
      } else if (result.failedCount > 0) {
        onResult({ error: parts.join(' | '), details, retryIds: ids });
      } else if (result.pushedCount > 0) {
        // Partial success — some pushed, some failed
        onResult({ success: parts.join(' | '), details, retryIds: ids });
      }
      // If only skipped and dialog is showing, don't set a message yet
    } catch (e) {
      onResult({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      setPushing(false);
    }
  }, [getSelectedLedgerRowIds, onResult, pushInvoice]);

  const handleForceRePush = useCallback(async () => {
    setShowSkipDialog(false);
    // Re-push only the skipped invoice IDs
    await handlePush(true, skippedLedgerRowIds);
    setSkippedResults([]);
    setSkippedLedgerRowIds([]);
  }, [handlePush, skippedLedgerRowIds]);

  const handleSkip = useCallback(() => {
    setShowSkipDialog(false);
    setSkippedResults([]);
    setSkippedLedgerRowIds([]);
  }, []);

  if (statusLoading) return null;

  return (
    <>
      <button
        onClick={() => handlePush(false)}
        disabled={!connected || pushing}
        title={!connected ? 'Connect QuickBooks first (Settings → Integrations)' : pushing ? 'Pushing...' : 'Push selected invoices to QuickBooks Online'}
        style={{
          padding: '7px 12px',
          fontSize: 12,
          fontWeight: 600,
          border: `1px solid ${connected ? '#16A34A' : theme.colors.border}`,
          borderRadius: 8,
          background: '#fff',
          cursor: !connected || pushing ? 'default' : 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          fontFamily: 'inherit',
          color: connected ? '#16A34A' : theme.colors.textMuted,
          opacity: !connected ? 0.5 : 1,
        }}
      >
        {pushing ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <BookOpen size={14} />}
        {pushing ? 'Pushing...' : 'QBO Push'}
      </button>

      {/* Skipped invoices dialog */}
      {showSkipDialog && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.4)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{
            background: '#fff', borderRadius: 12, padding: 24,
            maxWidth: 480, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          }}>
            <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, color: theme.colors.text }}>
              Invoices Already in QBO
            </div>
            <div style={{ fontSize: 12, color: theme.colors.textMuted, marginBottom: 12 }}>
              These invoices were already pushed to QuickBooks Online:
            </div>
            <div style={{
              maxHeight: 200, overflowY: 'auto', marginBottom: 16,
              border: `1px solid ${theme.colors.border}`, borderRadius: 8,
            }}>
              {skippedResults.map((r, i) => (
                <div key={i} style={{
                  padding: '8px 12px', fontSize: 12,
                  borderBottom: i < skippedResults.length - 1 ? `1px solid ${theme.colors.borderLight}` : undefined,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                  <span style={{ fontWeight: 500 }}>{r.strideInvoiceNumber}</span>
                  <span style={{ color: theme.colors.textMuted, fontSize: 11 }}>
                    QBO ID: {r.existingQboInvoiceId}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 12, color: '#B45309', marginBottom: 16 }}>
              Force re-push will create new QBO invoices. The previous ones will still exist in QuickBooks.
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button
                onClick={handleSkip}
                style={{
                  padding: '8px 16px', fontSize: 12, fontWeight: 500,
                  border: `1px solid ${theme.colors.border}`, borderRadius: 8,
                  background: '#fff', cursor: 'pointer', fontFamily: 'inherit',
                  color: theme.colors.textSecondary,
                }}
              >
                Skip These
              </button>
              <button
                onClick={handleForceRePush}
                style={{
                  padding: '8px 16px', fontSize: 12, fontWeight: 600,
                  border: '1px solid #DC2626', borderRadius: 8,
                  background: '#FEF2F2', cursor: 'pointer', fontFamily: 'inherit',
                  color: '#DC2626',
                }}
              >
                Force Re-Push
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Spin animation for Loader2 */}
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </>
  );
}
