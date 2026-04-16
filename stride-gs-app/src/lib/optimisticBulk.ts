/**
 * optimisticBulk — Shared helpers for optimistic bulk-action flows.
 *
 * Pattern (session 69 — optimistic bulk updates):
 *   1. User clicks a bulk action → immediately patch all affected rows in-memory
 *      (UI flips to the target state in <50ms).
 *   2. Fire the server batch endpoint in the background.
 *   3. On response: server patches for successful rows are eclipsed by real
 *      server data on the next refetch; only failed rows need their patch cleared
 *      so the UI snaps back to the previous value.
 *
 * Used by: Tasks.tsx, Repairs.tsx, WillCalls.tsx, Inventory.tsx, Payments.tsx,
 * Billing.tsx.
 */

/**
 * Apply the same patch to every id via the hook's patch function.
 */
export function applyBulkPatch<T>(
  ids: string[],
  patchFn: (id: string, patch: Partial<T>) => void,
  patch: Partial<T>
): void {
  for (const id of ids) {
    if (id) patchFn(id, patch);
  }
}

/**
 * For each server-reported failure, clear that id's optimistic patch so the UI
 * snaps back to the previous value.
 */
export function revertBulkPatchForFailures(
  errors: Array<{ id?: string }> | undefined | null,
  clearFn: (id: string) => void
): void {
  if (!errors || errors.length === 0) return;
  for (const e of errors) {
    if (e && e.id) clearFn(e.id);
  }
}
