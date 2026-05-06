/**
 * QboPushJobsContext — App-level state for in-flight + recently-finished QBO push jobs.
 *
 * Backs the persistent QBO push toast that survives navigation, page refresh,
 * and even browser close (the GAS push runs to completion regardless of caller
 * disconnect). Pre-fix, both the QBO Push toolbar button and the Create
 * Invoices "Push to QuickBooks Online" checkbox wrote results to component-local
 * React state; the moment the operator left Billing.tsx the success/failure
 * UI vanished even though the push had completed server-side.
 *
 * State source: public.qbo_push_jobs (Supabase). React INSERTs a row, GAS
 * PATCHes status + counts + per-invoice results throughout the loop, and the
 * postgres_changes realtime subscription mirrors every PATCH into this
 * context. On App mount we query for in-flight or recently-finished jobs
 * (`finished_at IS NULL OR finished_at >= NOW() - 30 minutes`) to rehydrate
 * the toast after a refresh.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { postQboCreateInvoice } from '../lib/api';
import { useAuth } from './AuthContext';

// ─── Types ───────────────────────────────────────────────────────────────────

export type QboPushJobStatus = 'pending' | 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled';

export interface QboPushJobResult {
  strideInvoiceNumber: string;
  success?: boolean;
  qboInvoiceId?: string | null;
  qboDocNumber?: string | null;
  error?: string | null;
  skipped?: boolean;
  warning?: string | null;
}

export interface QboPushJob {
  id: string;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  status: QboPushJobStatus;
  initiatedBy: string | null;
  source: string | null;
  ledgerRowIds: string[];
  invoiceNos: string[];
  totalCount: number;
  succeededCount: number;
  failedCount: number;
  skippedCount: number;
  results: QboPushJobResult[];
  errorMessage: string | null;
  forceRePush: boolean;
}

interface StartJobOptions {
  ledgerRowIds: string[];
  source: 'toolbar' | 'create_flow';
  forceRePush?: boolean;
  /** Optional override of autoAssignDocNumber — defaults to true to match
   *  postQboCreateInvoice's signature. */
  autoAssignDocNumber?: boolean;
}

interface QboPushJobsContextValue {
  /** All jobs known to the current session: in-flight + finished within
   *  the last 30 minutes. Sorted by createdAt desc. */
  jobs: QboPushJob[];
  /** Convenience filter — jobs that haven't reached a terminal status. */
  inFlightJobs: QboPushJob[];
  /** Locally dismissed (toast hidden) — survives until tab close. */
  dismissedIds: ReadonlySet<string>;
  /** Insert a new job row + fire the GAS push. Returns the job id, or null on failure.
   *  GAS owns the lifecycle from there; this function does NOT await completion. */
  startJob: (opts: StartJobOptions) => Promise<string | null>;
  /** Hide the toast for one job locally without affecting the DB row. */
  dismissJob: (id: string) => void;
  /** PATCH a stuck job to status='cancelled' so it stops occupying toast space. */
  markCancelled: (id: string) => Promise<void>;
}

// ─── Row mapping ─────────────────────────────────────────────────────────────

function rowToJob(r: Record<string, unknown>): QboPushJob {
  const results = Array.isArray(r.results) ? (r.results as QboPushJobResult[]) : [];
  return {
    id:             String(r.id || ''),
    createdAt:      String(r.created_at || ''),
    startedAt:      r.started_at ? String(r.started_at) : null,
    finishedAt:     r.finished_at ? String(r.finished_at) : null,
    status:         (String(r.status || 'pending') as QboPushJobStatus),
    initiatedBy:    r.initiated_by ? String(r.initiated_by) : null,
    source:         r.source ? String(r.source) : null,
    ledgerRowIds:   Array.isArray(r.ledger_row_ids) ? (r.ledger_row_ids as string[]) : [],
    invoiceNos:     Array.isArray(r.invoice_nos) ? (r.invoice_nos as string[]) : [],
    totalCount:     Number(r.total_count || 0),
    succeededCount: Number(r.succeeded_count || 0),
    failedCount:    Number(r.failed_count || 0),
    skippedCount:   Number(r.skipped_count || 0),
    results,
    errorMessage:   r.error_message ? String(r.error_message) : null,
    forceRePush:    Boolean(r.force_re_push),
  };
}

const TERMINAL_STATUSES: ReadonlySet<QboPushJobStatus> = new Set(['succeeded', 'partial', 'failed', 'cancelled']);

// ─── Context ─────────────────────────────────────────────────────────────────

const QboPushJobsContext = createContext<QboPushJobsContextValue | null>(null);

export function QboPushJobsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [jobs, setJobs] = useState<QboPushJob[]>([]);
  const [dismissedIds, setDismissedIds] = useState<ReadonlySet<string>>(() => new Set<string>());
  // Stable ref so realtime callback doesn't capture stale jobs state on re-mount cycles.
  const jobsRef = useRef<QboPushJob[]>([]);
  jobsRef.current = jobs;

  // Initial load: in-flight or recently finished. Single round-trip on App mount.
  // The 30-minute window covers a typical "operator stepped away then came back"
  // pattern; older finished jobs are intentionally not re-rendered (they live
  // in DB for audit; the toast surface is for NOW).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const cutoffIso = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('qbo_push_jobs')
        .select('*')
        .or(`finished_at.is.null,finished_at.gte.${cutoffIso}`)
        .order('created_at', { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (error) {
        // Silent: a Supabase outage shouldn't crash the App layout.
        // The toast just doesn't render until the next realtime event.
        return;
      }
      if (data) setJobs(data.map(rowToJob));
    })();
    return () => { cancelled = true; };
  }, []);

  // Realtime: every PATCH from GAS surfaces here. We track INSERT/UPDATE/DELETE
  // so multiple operators see each other's pushes (filtered later by initiatedBy
  // for the per-user toast view).
  useEffect(() => {
    const channel = supabase
      .channel('qbo_push_jobs_app')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qbo_push_jobs' }, payload => {
        const evt = payload.eventType;
        if (evt === 'INSERT' && payload.new) {
          const job = rowToJob(payload.new as Record<string, unknown>);
          setJobs(prev => {
            if (prev.find(j => j.id === job.id)) return prev;
            return [job, ...prev];
          });
        } else if (evt === 'UPDATE' && payload.new) {
          const job = rowToJob(payload.new as Record<string, unknown>);
          setJobs(prev => prev.map(j => (j.id === job.id ? job : j)));
        } else if (evt === 'DELETE' && payload.old) {
          const id = String((payload.old as Record<string, unknown>).id || '');
          if (id) setJobs(prev => prev.filter(j => j.id !== id));
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  // INSERT a new job + fire the GAS push. The GAS handler PATCHes the job
  // throughout its execution; we don't await the apiPost result for state
  // tracking (realtime does that). We DO catch errors so an immediate
  // network failure surfaces as a 'failed' job rather than a silent hang.
  const startJob = useCallback(async (opts: StartJobOptions): Promise<string | null> => {
    const initiatedBy = user?.email || null;
    const { data, error } = await supabase
      .from('qbo_push_jobs')
      .insert({
        status: 'pending',
        ledger_row_ids: opts.ledgerRowIds,
        initiated_by: initiatedBy,
        source: opts.source,
        force_re_push: !!opts.forceRePush,
      })
      .select('*')
      .single();
    if (error || !data) {
      // eslint-disable-next-line no-console
      console.error('Failed to create qbo_push_jobs row:', error);
      return null;
    }
    const jobId = String(data.id);
    // Optimistic insert into local state — realtime will reconcile.
    setJobs(prev => {
      const job = rowToJob(data as Record<string, unknown>);
      if (prev.find(j => j.id === jobId)) return prev;
      return [job, ...prev];
    });

    // Fire GAS push. We DO NOT await; realtime will keep the toast
    // accurate. We attach a catch handler so a network error during the
    // POST itself (before GAS even saw it) surfaces as 'failed' status.
    postQboCreateInvoice(opts.ledgerRowIds, !!opts.forceRePush, opts.autoAssignDocNumber !== false, undefined, jobId)
      .catch((e: unknown) => {
        // Only mark failed if GAS didn't already terminal-state it via realtime.
        const current = jobsRef.current.find(j => j.id === jobId);
        if (current && !TERMINAL_STATUSES.has(current.status)) {
          supabase
            .from('qbo_push_jobs')
            .update({
              status: 'failed',
              finished_at: new Date().toISOString(),
              error_message: e instanceof Error ? e.message : String(e),
            })
            .eq('id', jobId)
            .then(() => undefined);
        }
      });

    return jobId;
  }, [user?.email]);

  const dismissJob = useCallback((id: string) => {
    setDismissedIds(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const markCancelled = useCallback(async (id: string) => {
    await supabase
      .from('qbo_push_jobs')
      .update({ status: 'cancelled', finished_at: new Date().toISOString() })
      .eq('id', id);
  }, []);

  const inFlightJobs = useMemo(
    () => jobs.filter(j => !TERMINAL_STATUSES.has(j.status)),
    [jobs]
  );

  const value = useMemo<QboPushJobsContextValue>(() => ({
    jobs,
    inFlightJobs,
    dismissedIds,
    startJob,
    dismissJob,
    markCancelled,
  }), [jobs, inFlightJobs, dismissedIds, startJob, dismissJob, markCancelled]);

  return <QboPushJobsContext.Provider value={value}>{children}</QboPushJobsContext.Provider>;
}

export function useQboPushJobs(): QboPushJobsContextValue {
  const ctx = useContext(QboPushJobsContext);
  if (!ctx) throw new Error('useQboPushJobs must be used inside <QboPushJobsProvider>');
  return ctx;
}
