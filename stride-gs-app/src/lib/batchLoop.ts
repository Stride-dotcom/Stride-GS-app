/**
 * batchLoop — client-side sequential loop helper for bulk actions that can't
 * use a batch server endpoint (because each entity has heavy per-row side
 * effects like billing row writes, email sends, Drive folder creation, or
 * PDF generation — looping server-side would blow Apps Script's 6-min
 * execution limit).
 *
 * Produces the same BatchMutationResult shape as the new batch endpoints so
 * the frontend has exactly one result-handling code path for every bulk op.
 *
 * v38.9.0 / Bulk Action Toolbar work.
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
  /** Optional progress callback — fires before each call with done/total counts. */
  onProgress?: (done: number, total: number) => void;
  /** Optional preflight skips from the page-level filter, merged into the final result. */
  preflightSkipped?: Array<{ id: string; reason: string }>;
  /** Optional short-circuit: if true, stop the loop immediately and return partial results. */
  shouldAbort?: () => boolean;
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

  const result: BatchMutationResult = {
    success: true,
    processed: items.length + preflightSkipped.length,
    succeeded: 0,
    failed: 0,
    skipped: [...preflightSkipped],
    errors: [],
    message: '',
  };

  let aborted = false;
  for (let i = 0; i < items.length; i++) {
    if (shouldAbort && shouldAbort()) {
      aborted = true;
      break;
    }
    const { id, item } = items[i];
    onProgress?.(i, items.length);

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
  }

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
