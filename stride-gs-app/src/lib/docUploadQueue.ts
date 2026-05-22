/**
 * docUploadQueue — localStorage-backed retry queue for client-side PDF
 * auto-archival. When `renderDoc({ action: 'upload' })` fails for any
 * reason (network drop, tab closed mid-render, storage quota), the
 * intended upload is queued here. `flushQueue()` runs on app load and
 * on every `online` event, retrying each job idempotently.
 *
 * Idempotency: each job is keyed by `${entityType}:${entityId}:${templateKey}`.
 * Before re-uploading, the worker checks `public.documents` for an
 * existing non-deleted row with the same context + a `Stride_*.pdf` file
 * name prefix and skips if found. This lets the user re-trigger
 * completion (or a subsequent builder add a manual button) without
 * piling up duplicate auto-archived PDFs.
 *
 * NOTE: payloads on the queue are token maps (already substituted —
 * cheap to JSON.stringify, no live entity refs that may have changed).
 * If the template body changes between queue-time and flush-time, the
 * retried PDF reflects the new template — which is fine, the document
 * is a snapshot of what *would* have been generated at the entity's
 * latest state; small visual drift is acceptable for an archive doc.
 */
import { supabase } from './supabase';

const STORAGE_KEY = 'stride.docUploadQueue.v1';
const MAX_ATTEMPTS = 5;
const RETRY_DELAY_MS = 4000;

export interface QueuedUpload {
  /** Unique ID — `${entityType}:${entityId}:${templateKey}` */
  jobId: string;
  templateKey: string;
  tokens: Record<string, string>;
  fileName: string;
  tenantId: string;
  // Must match the `documents.context_type` CHECK constraint
  // (migration 20260420130000). `dt_order` is intentionally NOT in this
  // union — even though useDocuments.ts exposes it as a TS type, the
  // CHECK constraint rejects it on insert. Add it here only after the
  // CHECK is widened in a future migration.
  entityType: 'shipment' | 'item' | 'task' | 'repair' | 'willcall' | 'claim' | 'client';
  entityId: string;
  /** ISO timestamp first enqueued — used to age out stale jobs */
  enqueuedAt: string;
  attempts: number;
}

function readQueue(): QueuedUpload[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QueuedUpload[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
  } catch (err) {
    // Storage quota or private mode — log and drop. Auto-archive is
    // best-effort; manual re-generation via the print/download button
    // remains the user's escape hatch.
    console.warn('[docUploadQueue] writeQueue failed:', err);
  }
}

export function enqueueUpload(job: Omit<QueuedUpload, 'enqueuedAt' | 'attempts' | 'jobId'>): void {
  const jobId = `${job.entityType}:${job.entityId}:${job.templateKey}`;
  const queue = readQueue();
  // Replace any existing job for the same target — latest tokens win.
  const filtered = queue.filter(q => q.jobId !== jobId);
  filtered.push({
    ...job,
    jobId,
    enqueuedAt: new Date().toISOString(),
    attempts: 0,
  });
  writeQueue(filtered);
}

/**
 * Check whether an auto-archived document for this context already
 * exists in `public.documents`. Used both during flush and at upload
 * time to short-circuit duplicate uploads.
 *
 * "Stride auto-archived" docs are identified by the `Stride_` filename
 * prefix the renderer applies (e.g. `Stride_Receiving_SHP-1234.pdf`).
 * Manual user uploads use the original filename and aren't matched.
 */
export async function findExistingAutoDoc(
  tenantId: string,
  entityType: QueuedUpload['entityType'],
  entityId: string,
  fileNamePrefix: string,
): Promise<{ id: string; storage_key: string } | null> {
  const { data, error } = await supabase
    .from('documents')
    .select('id,storage_key')
    .eq('tenant_id', tenantId)
    .eq('context_type', entityType)
    .eq('context_id', entityId)
    .ilike('file_name', `${fileNamePrefix}%.pdf`)
    .is('deleted_at', null)
    .limit(1)
    .maybeSingle();
  if (error) {
    // Indistinguishable from "no row found" if we just return null — but a
    // transient RLS/network failure on the de-dupe lookup would let the
    // queue re-upload and create a duplicate row. Log loudly so we notice
    // a pattern; still return null so the caller proceeds (re-upload is
    // recoverable via soft-delete; silently never archiving is not).
    console.warn('[docUploadQueue] findExistingAutoDoc lookup failed:', error);
    return null;
  }
  return data ?? null;
}

/**
 * Flush every queued upload. Called once on app boot + on every
 * `online` event. Per-job: re-render PDF from stored tokens, upload to
 * Storage, insert documents row. Idempotent — skips jobs whose target
 * row already exists. Bounded retries (MAX_ATTEMPTS) before dropping.
 *
 * Imports `renderDoc` lazily to avoid the docRenderer ↔ queue circular
 * import (renderDoc calls enqueueUpload on failure; the queue calls
 * renderDoc to retry).
 */
export async function flushQueue(): Promise<{ processed: number; succeeded: number; dropped: number }> {
  const queue = readQueue();
  if (queue.length === 0) return { processed: 0, succeeded: 0, dropped: 0 };

  const { renderDocUpload } = await import('./docRenderer');
  let succeeded = 0;
  let dropped = 0;
  const remaining: QueuedUpload[] = [];

  for (const job of queue) {
    // Skip if a matching doc already exists — idempotency at the data layer.
    const existing = await findExistingAutoDoc(
      job.tenantId, job.entityType, job.entityId, job.fileName,
    );
    if (existing) {
      succeeded++;
      continue;
    }

    if (job.attempts >= MAX_ATTEMPTS) {
      console.warn(
        `[docUploadQueue] dropping job ${job.jobId} after ${MAX_ATTEMPTS} attempts (enqueued ${job.enqueuedAt})`,
      );
      dropped++;
      continue;
    }

    try {
      await renderDocUpload({
        templateKey: job.templateKey,
        tokens: job.tokens,
        fileName: job.fileName,
        tenantId: job.tenantId,
        entityType: job.entityType,
        entityId: job.entityId,
      });
      succeeded++;
    } catch (err) {
      console.warn(`[docUploadQueue] retry failed for ${job.jobId}:`, err);
      remaining.push({ ...job, attempts: job.attempts + 1 });
      // Small inter-job delay so a network blip doesn't burn all attempts
      // in a tight loop.
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
    }
  }

  writeQueue(remaining);
  return { processed: queue.length, succeeded, dropped };
}

let booted = false;

/**
 * Wire up the queue worker. Idempotent — calling twice does nothing.
 * Hook from the app shell (App.tsx) once on mount.
 */
export function startDocUploadQueueWorker(): void {
  if (booted) return;
  booted = true;
  // Fire-and-forget on boot. Failures are logged inside flushQueue.
  void flushQueue();
  window.addEventListener('online', () => { void flushQueue(); });
}
