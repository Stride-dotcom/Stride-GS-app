/**
 * QboPushJobsToast — Persistent bottom-right toast for QBO push jobs.
 *
 * Mounted once at AppLayout level so it survives page navigation. Reads
 * QboPushJobsContext (which subscribes to public.qbo_push_jobs realtime)
 * and renders one card per active or recently-completed job.
 *
 * UX rules:
 *   - In-flight (status pending/running): persistent — operator must wait
 *     or click Hide. Spinner + "Pushing N of M, K failed" copy.
 *   - Just-finished (status succeeded): auto-hide after 8s unless the
 *     operator manually dismisses earlier. Green check + count.
 *   - Failed / partial: persistent until dismissed — operator decides
 *     when they've handled it. Includes a Show Details affordance for
 *     the per-invoice errors.
 *   - Stale (status=running and started_at older than 30 min): rendered
 *     with a "Mark cancelled" button to clear it from the toast.
 *
 * The toast filters to the current user's own jobs by default
 * (initiatedBy === user.email). A future iteration can expose other
 * operators' jobs in a separate ops dashboard if needed.
 */
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle, Loader2, AlertTriangle, X, ChevronDown, ChevronUp, Ban } from 'lucide-react';
import { theme } from '../../styles/theme';
import { useQboPushJobs, type QboPushJob, type QboPushJobStatus } from '../../contexts/QboPushJobsContext';
import { useAuth } from '../../contexts/AuthContext';

const TERMINAL_STATUSES: ReadonlySet<QboPushJobStatus> = new Set(['succeeded', 'partial', 'failed', 'cancelled']);
const AUTO_HIDE_SUCCESS_MS = 8000;
const STALE_THRESHOLD_MS = 30 * 60 * 1000;

export function QboPushJobsToast() {
  const { user } = useAuth();
  const { jobs, dismissedIds, dismissJob, markCancelled } = useQboPushJobs();
  const [now, setNow] = useState(() => Date.now());

  // Tick every 1s while there are active jobs so the elapsed time + auto-hide
  // logic re-evaluates. Cheap; only runs when something is actually showing.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const visibleJobs = useMemo(() => {
    const myEmail = (user?.email || '').toLowerCase();
    return jobs.filter(job => {
      if (dismissedIds.has(job.id)) return false;
      // Only show this user's own jobs in the toast
      if (myEmail && job.initiatedBy && job.initiatedBy.toLowerCase() !== myEmail) return false;
      // Auto-hide successful jobs after 8s
      if (job.status === 'succeeded' && job.finishedAt) {
        const finishedAt = new Date(job.finishedAt).getTime();
        if (now - finishedAt > AUTO_HIDE_SUCCESS_MS) return false;
      }
      // Cancelled jobs auto-hide immediately (the markCancelled action triggers their fade)
      if (job.status === 'cancelled') return false;
      return true;
    });
  }, [jobs, dismissedIds, user?.email, now]);

  if (visibleJobs.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 20,
        right: 20,
        zIndex: 9000,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        maxWidth: 420,
        pointerEvents: 'none',
      }}
    >
      {visibleJobs.map(job => (
        <JobCard key={job.id} job={job} onDismiss={dismissJob} onCancel={markCancelled} now={now} />
      ))}
    </div>
  );
}

interface JobCardProps {
  job: QboPushJob;
  onDismiss: (id: string) => void;
  onCancel: (id: string) => Promise<void>;
  now: number;
}

function JobCard({ job, onDismiss, onCancel, now }: JobCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isTerminal = TERMINAL_STATUSES.has(job.status);
  const startedAt = job.startedAt ? new Date(job.startedAt).getTime() : null;
  const isStale = !isTerminal && startedAt !== null && now - startedAt > STALE_THRESHOLD_MS;

  const palette = paletteForStatus(job.status, isStale);
  const headline = headlineFor(job, isStale);
  const detailLine = detailLineFor(job);

  const failedResults = job.results.filter(r => !r.success && !r.skipped);
  const hasErrors = failedResults.length > 0;

  return (
    <div
      style={{
        pointerEvents: 'auto',
        background: '#fff',
        border: `1px solid ${palette.border}`,
        borderLeft: `4px solid ${palette.accent}`,
        borderRadius: 10,
        boxShadow: '0 6px 20px rgba(0,0,0,0.12)',
        padding: '12px 14px',
        fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
        <div style={{ flexShrink: 0, marginTop: 1 }}>
          {palette.icon}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: theme.colors.text }}>{headline}</div>
          <div style={{ fontSize: 12, color: theme.colors.textSecondary, marginTop: 2 }}>{detailLine}</div>
          {hasErrors && (
            <button
              onClick={() => setExpanded(!expanded)}
              style={{
                marginTop: 6,
                padding: 0,
                fontSize: 11,
                fontWeight: 500,
                background: 'none',
                border: 'none',
                color: theme.colors.orange,
                cursor: 'pointer',
                fontFamily: 'inherit',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
              }}
            >
              {expanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {expanded ? 'Hide errors' : `Show ${failedResults.length} error${failedResults.length === 1 ? '' : 's'}`}
            </button>
          )}
          {expanded && hasErrors && (
            <div
              style={{
                marginTop: 6,
                maxHeight: 180,
                overflowY: 'auto',
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                borderRadius: 6,
                padding: '6px 8px',
                fontSize: 11,
              }}
            >
              {failedResults.map((r, i) => (
                <div key={i} style={{ marginBottom: i < failedResults.length - 1 ? 6 : 0, color: '#991B1B' }}>
                  <span style={{ fontWeight: 600 }}>{r.strideInvoiceNumber}:</span> {r.error || 'Unknown error'}
                </div>
              ))}
            </div>
          )}
          {isStale && (
            <button
              onClick={() => onCancel(job.id)}
              style={{
                marginTop: 6,
                padding: '3px 8px',
                fontSize: 10,
                fontWeight: 600,
                border: '1px solid #DC2626',
                borderRadius: 4,
                background: '#fff',
                color: '#DC2626',
                cursor: 'pointer',
                fontFamily: 'inherit',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <Ban size={11} /> Mark cancelled
            </button>
          )}
        </div>
        {isTerminal && (
          <button
            onClick={() => onDismiss(job.id)}
            title="Dismiss"
            style={{
              flexShrink: 0,
              width: 22,
              height: 22,
              padding: 0,
              border: 'none',
              borderRadius: 4,
              background: 'transparent',
              cursor: 'pointer',
              color: theme.colors.textMuted,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <X size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function paletteForStatus(status: QboPushJobStatus, isStale: boolean): { accent: string; border: string; icon: React.ReactNode } {
  if (isStale) {
    return {
      accent: '#DC2626',
      border: '#FECACA',
      icon: <AlertTriangle size={18} color="#DC2626" />,
    };
  }
  switch (status) {
    case 'succeeded':
      return { accent: '#15803D', border: '#BBF7D0', icon: <CheckCircle size={18} color="#15803D" /> };
    case 'partial':
      return { accent: '#B45309', border: '#FDE68A', icon: <AlertTriangle size={18} color="#B45309" /> };
    case 'failed':
      return { accent: '#DC2626', border: '#FECACA', icon: <AlertTriangle size={18} color="#DC2626" /> };
    case 'cancelled':
      return { accent: '#6B7280', border: '#E5E7EB', icon: <Ban size={18} color="#6B7280" /> };
    case 'pending':
    case 'running':
    default:
      return {
        accent: '#E85D2D',
        border: '#FED7AA',
        icon: <Loader2 size={18} color="#E85D2D" style={{ animation: 'spin 1s linear infinite' }} />,
      };
  }
}

function headlineFor(job: QboPushJob, isStale: boolean): string {
  if (isStale) return `QBO push stalled — no progress for >30 min`;
  switch (job.status) {
    case 'pending':   return 'Starting QBO push…';
    case 'running':   {
      const total = job.totalCount || job.ledgerRowIds.length;
      const done = job.succeededCount + job.failedCount + job.skippedCount;
      return `Pushing to QBO — ${done} of ${total}`;
    }
    case 'succeeded': return `Pushed ${job.succeededCount} invoice${job.succeededCount === 1 ? '' : 's'} to QBO`;
    case 'partial':   return `Partial QBO push — ${job.succeededCount} pushed, ${job.failedCount} failed`;
    case 'failed':    return job.errorMessage || `QBO push failed (${job.failedCount} of ${job.totalCount})`;
    case 'cancelled': return 'QBO push cancelled';
  }
}

function detailLineFor(job: QboPushJob): string {
  const parts: string[] = [];
  if (job.invoiceNos.length > 0 && job.invoiceNos.length <= 6) {
    parts.push(job.invoiceNos.join(', '));
  } else if (job.invoiceNos.length > 6) {
    parts.push(job.invoiceNos.slice(0, 5).join(', ') + ` +${job.invoiceNos.length - 5} more`);
  }
  if (job.skippedCount > 0) parts.push(`${job.skippedCount} already in QBO`);
  if (job.source === 'create_flow') parts.push('via Create Invoices');
  if (job.source === 'toolbar') parts.push('via QBO Push button');
  return parts.join(' · ') || `${job.ledgerRowIds.length} ledger row${job.ledgerRowIds.length === 1 ? '' : 's'}`;
}
