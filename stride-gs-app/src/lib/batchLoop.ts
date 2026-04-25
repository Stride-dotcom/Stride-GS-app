/**
 * batchLoop — client-side loop helper for bulk actions that can't use a batch
 * server endpoint (because each entity has heavy per-row side effects like
 * billing row writes, email sends, Drive folder creation, or PDF generation —
 * looping server-side would blow Apps Script's 6-min execution limit).
 *
 * Produces the same BatchMutationResult shape as the new batch endpoints so
 * the frontend has exactly one result-handling code path for every bulk op.
 *
 * v38.9.0 / Bulk Action Toolbar work.
 * v38.122.0 — added optional `concurrency` (default 1). N>1 runs N worker
 * loops sharing a shared cursor; onProgress fires per-completion so the UI
 * count climbs smoothly even with parallel dispatch.
 */

import type { BatchMutationResult } from './api';

export interface BatchLoopItem<T> {
  id: string;
  item: T;
}

export interface RunBatchLoopOptions<T, R> {
  /** Items to process. Each gets an id (used in skipped/errors arrays) and the full entity. */
  items: BatchLoopItem<T>[];
  /** The async call for one item. Must return a `{ ok, data?, error? }` shape. */
  call: (item: T) => Promise<{ ok: boolean; data?: R; error?: string }>;
  /** Optional progress callback — fires AFTER each completion with done/total counts. */
  onProgress?: (done: number, total: number) => void;
  /** Optional preflight skips from the page-level filter, merged into the final result. */
  preflightSkipped?: Array<{ id: string; reason: string }>;
  /** Optional short-circuit: if true, stop the loop immediately and return partial results. */
  shouldAbort?: () => boolean;
  /**
   * How many `call`s to run in parallel. Default 1 = strictly sequential
   * (backward compatible). Set to N>1 when the per-item server work is mostly
   * I/O-bound and the backend can absorb concurrent requests (e.g. Apps Script
   * routes that fan out to Drive/QBO/Stax in parallel).
   *
   * Workers share a cursor; each pulls the next item when it finishes its
   * current one, so progress is balanced even when call durations vary.
   */
  concurrency?: number;
}

/**
 * Runs a sequential loop over `items`, invoking `call(item.item)` for each.
 * Accumulates results into a standardized BatchMutationResult.
 *
 * - Per-item errors (call returned ok=false OR threw) go into `errors[]`, `failed++`.
 * - Successful calls → `succeeded++`.
 * - Preflight skips are merged into `skipped[]` so counts reflect the full original selection.
 * - Loop aborts only if `shouldAbort()` returns true between iterations — individual
 *   item failures do NOT stop the loop. This ensures partial success is visible.
 * - Top-level `success` is true if the loop ran to completion (even with failures).
 *   It becomes false only if the loop itself aborts via `shouldAbort`.
 */
export async function runBatchLoop<T, R>(
  options: RunBatchLoopOptions<T, R>
): Promise<BatchMutationResult> {
  const { items, call, onProgress, preflightSkipped = [], shouldAbort } = options;
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));

  const result: BatchMutationResult = {
    success: true,
    processed: items.length + preflightSkipped.length,
    succeeded: 0,
    failed: 0,
    skipped: [...preflightSkipped],
    errors: [],
    message: '',
  };

  let cursor = 0;
  let done = 0;
  let aborted = false;

  // Each worker pulls the next un-claimed index off the shared cursor and
  // processes it. With concurrency=1 this collapses back to a strictly
  // sequential loop; with N>1 up to N calls are in flight at any moment.
  const worker = async () => {
    while (true) {
      if (shouldAbort && shouldAbort()) {
        aborted = true;
        return;
      }
      const i = cursor++;
      if (i >= items.length) return;
      const { id, item } = items[i];

      try {
        const resp = await call(item);
        if (resp.ok && resp.data) {
          result.succeeded++;
        } else {
          result.failed++;
          result.errors.push({
            id,
            reason: resp.error || 'Request failed',
          });
        }
      } catch (e: any) {
        result.failed++;
        result.errors.push({
          id,
          reason: e?.message || String(e) || 'Unexpected error',
        });
      }

      done++;
      onProgress?.(done, items.length);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length || 1) }, () => worker())
  );

  // Final tick so the UI lands cleanly on N/N even if items.length === 0.
  onProgress?.(items.length, items.length);

  if (aborted) {
    result.success = false;
    result.message = 'Aborted before completion';
  } else {
    const parts: string[] = [];
    if (result.succeeded) parts.push(`${result.succeeded} succeeded`);
    if (result.failed) parts.push(`${result.failed} failed`);
    if (result.skipped.length) parts.push(`${result.skipped.length} skipped`);
    result.message = parts.join(' · ') || 'No changes';
  }

  return result;
}

/**
 * Merge client-side preflight skips into a server-returned BatchMutationResult
 * so the final summary accounts for the full original selection, not just the
 * submitted subset.
 */
export function mergePreflightSkips(
  result: BatchMutationResult,
  preflightSkipped: Array<{ id: string; reason: string }>
): BatchMutationResult {
  if (!preflightSkipped.length) return result;
  return {
    ...result,
    processed: result.processed + preflightSkipped.length,
    skipped: [...preflightSkipped, ...result.skipped],
  };
}
