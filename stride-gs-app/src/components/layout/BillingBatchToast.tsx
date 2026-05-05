/**
 * BillingBatchToast — bottom-right floating toast that surfaces in-flight
 * + just-completed invoice batch progress.
 *
 * v38.184.0. Lives in AppLayout (rendered alongside <Outlet />) so it
 * displays from any page — operator can kick off invoices on Billing,
 * navigate to Inventory, and still see "3/5 invoices created" until the
 * batch completes. Reads from BillingBatchContext (App-level state).
 *
 * States:
 *   - active=false, lastResults=null → hidden
 *   - active=true → "Creating N invoices… X/N done" with spinner
 *   - active=false, lastResults set → completion message:
 *       all succeeded → "✓ N invoices created" (green, auto-dismiss 6s)
 *       any failed → "⚠ X of N created. Y failed [View]" (amber, no auto-dismiss)
 */
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, AlertTriangle, X, Loader2 } from 'lucide-react';
import { theme } from '../../styles/theme';
import { useBillingBatch } from '../../contexts/BillingBatchContext';

const AUTO_DISMISS_MS = 6000;

export function BillingBatchToast() {
  const batch = useBillingBatch();
  const [showDetails, setShowDetails] = useState(false);

  // Auto-dismiss successful completions after a short delay so the toast
  // doesn't linger forever. Errors stick around until the operator
  // explicitly clicks View / X.
  useEffect(() => {
    if (batch.active || !batch.lastResults) return;
    const anyFailed = batch.failed > 0;
    if (anyFailed) return;
    const t = setTimeout(() => batch.dismissResults(), AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [batch.active, batch.lastResults, batch.failed, batch.dismissResults]);

  const visible = batch.active || batch.lastResults !== null;
  const tone: 'progress' | 'success' | 'mixed' = batch.active
    ? 'progress'
    : (batch.failed > 0 ? 'mixed' : 'success');

  const palette = useMemo(() => {
    if (tone === 'progress') return { bg: '#FFFBEB', border: '#FDE68A', text: '#92400E', icon: '#F59E0B' };
    if (tone === 'success')  return { bg: '#F0FDF4', border: '#BBF7D0', text: '#166534', icon: '#16A34A' };
    return                  { bg: '#FEF3C7', border: '#FDE68A', text: '#92400E', icon: '#D97706' };
  }, [tone]);

  if (!visible) return null;

  return (
    <>
      <div
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed',
          bottom: 18,
          right: 18,
          zIndex: 1100,
          minWidth: 280,
          maxWidth: 360,
          padding: '12px 14px',
          background: palette.bg,
          border: `1px solid ${palette.border}`,
          borderRadius: 12,
          boxShadow: '0 8px 28px rgba(0,0,0,0.12)',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 10,
          fontFamily: 'inherit',
        }}
      >
        <div style={{ flexShrink: 0, marginTop: 1 }}>
          {tone === 'progress' ? (
            <Loader2 size={18} color={palette.icon} style={{ animation: 'spin 1s linear infinite' }} />
          ) : tone === 'success' ? (
            <CheckCircle size={18} color={palette.icon} />
          ) : (
            <AlertTriangle size={18} color={palette.icon} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: palette.text }}>
            {tone === 'progress'
              ? `Creating ${batch.total} invoice${batch.total === 1 ? '' : 's'}…`
              : tone === 'success'
                ? `${batch.succeeded} invoice${batch.succeeded === 1 ? '' : 's'} created`
                : `${batch.succeeded} of ${batch.total} created`}
          </div>
          <div style={{ fontSize: 11, color: palette.text, opacity: 0.85, marginTop: 2 }}>
            {tone === 'progress' && (
              <>
                {batch.processed} / {batch.total} done
                {batch.invoicingLedgerIds.size > 0 && ` · ${batch.invoicingLedgerIds.size} in flight`}
                <br />
                <span style={{ fontStyle: 'italic' }}>You can leave this page — the batch will keep running.</span>
              </>
            )}
            {tone === 'success' && 'All invoices committed to the ledger.'}
            {tone === 'mixed' && (
              <>
                {batch.failed} failed
                {batch.skipped > 0 && ` · ${batch.skipped} skipped`}
              </>
            )}
          </div>
          {tone === 'mixed' && (
            <button
              onClick={() => setShowDetails(true)}
              style={{
                marginTop: 8,
                padding: '4px 10px',
                fontSize: 11,
                fontWeight: 600,
                border: `1px solid ${palette.border}`,
                borderRadius: 6,
                background: '#fff',
                color: palette.text,
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              View failures
            </button>
          )}
        </div>
        {!batch.active && (
          <button
            onClick={() => batch.dismissResults()}
            aria-label="Dismiss"
            style={{
              flexShrink: 0,
              background: 'none',
              border: 'none',
              padding: 2,
              cursor: 'pointer',
              color: palette.text,
              opacity: 0.65,
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Failure details modal — same shape as the legacy modal's failure list,
          rendered separately so the toast stays compact until the operator
          opts in to the details. Only rendered for mixed-tone (any failures). */}
      {showDetails && tone === 'mixed' && batch.lastResults && (
        <div
          onClick={() => setShowDetails(false)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            zIndex: 1200, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 520, maxWidth: '92vw', maxHeight: '80vh',
              background: '#fff', borderRadius: 14, padding: 18,
              overflow: 'auto', boxShadow: '0 12px 40px rgba(0,0,0,0.2)',
              fontFamily: 'inherit',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 15, fontWeight: 700 }}>Invoice batch results</div>
              <button onClick={() => setShowDetails(false)} aria-label="Close" style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: theme.colors.textMuted }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginBottom: 12 }}>
              {batch.succeeded} of {batch.total} invoices created · {batch.failed} failed
              {batch.skipped > 0 && ` · ${batch.skipped} skipped`}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {batch.lastResults.map((r, i) => (
                <div
                  key={i}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    background: r.success ? '#F0FDF4' : '#FEF2F2',
                    border: `1px solid ${r.success ? '#BBF7D0' : '#FCA5A5'}`,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  {r.success
                    ? <CheckCircle size={14} color="#16A34A" />
                    : <AlertTriangle size={14} color="#DC2626" />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{r.client}</div>
                    {r.success && r.invoiceNo && (
                      <div style={{ fontSize: 11, color: '#15803D', marginTop: 1 }}>{r.invoiceNo}</div>
                    )}
                    {!r.success && r.error && (
                      <div style={{ fontSize: 11, color: '#991B1B', marginTop: 1, wordBreak: 'break-word' }}>{r.error}</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
