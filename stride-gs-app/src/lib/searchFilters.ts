import type { FilterFn, Row } from '@tanstack/react-table';

// Fields whose values are opaque identifiers, hex colors, ISO timestamps,
// short enum codes, or other strings that aren't useful to free-text search
// and would generate noisy matches (e.g. typing "del" matching every row
// with `orderType: 'delivery'`). Visible IDs the user types into search
// (itemId, taskId, repairId, wcNumber, shipmentId, dtIdentifier, claimId)
// are deliberately NOT here — they end in `Id`/`No`/`Identifier` but
// carry useful prefixes like `INSP-62391-1`.
const DENY_KEYS = new Set([
  'id',
  'tenantId',
  'clientId',
  'clientSheetId',
  'statusId',
  'dtStatusCode',
  'dtDispatchId',
  'linkedOrderId',
  'createdByUser',
  'reviewedBy',
  'timezone',
  'billingMethod',
  'orderType',
  'createdByRole',
  'source',
  'statusColor',
  'statusCategory',
  'statusCode',
  'isPickup',
  'paymentCollected',
  'pricingOverride',
  'requiresSignature',
  'billed',
  'cod',
]);

const DENY_SUFFIXES = ['Url', 'At', 'Color', 'Category'];

function isSkippableKey(key: string): boolean {
  if (DENY_KEYS.has(key)) return true;
  for (const s of DENY_SUFFIXES) if (key.endsWith(s)) return true;
  return false;
}

// Scan an entity row for a free-text query. Walks every top-level string
// or number field (skipping opaque IDs, timestamps, enums, etc.) and
// returns true on first substring hit. This is what makes per-page
// table search cover reference + notes (and any other useful text field)
// without each page having to enumerate them.
export function rowMatchesSearch(obj: unknown, query: string): boolean {
  if (!query) return true;
  if (obj == null || typeof obj !== 'object') return false;
  const needle = query.toLowerCase();
  for (const key in obj as Record<string, unknown>) {
    if (isSkippableKey(key)) continue;
    const v = (obj as Record<string, unknown>)[key];
    if (v == null) continue;
    if (typeof v === 'string') {
      if (v.toLowerCase().includes(needle)) return true;
    } else if (typeof v === 'number') {
      if (String(v).includes(needle)) return true;
    }
  }
  return false;
}

// TanStack-compatible global filter that matches against every text field
// on the row's original data — so toolbar search on every entity page
// covers reference, notes, internal notes, sidemarks, etc., even for
// columns that are hidden or not declared at all.
export const tanstackGlobalFilter: FilterFn<unknown> = (
  row: Row<unknown>,
  _columnId: string,
  filterValue: unknown,
): boolean => {
  const q = typeof filterValue === 'string' ? filterValue : '';
  if (!q) return true;
  return rowMatchesSearch(row.original, q);
};
tanstackGlobalFilter.autoRemove = (v: unknown) => !v;
