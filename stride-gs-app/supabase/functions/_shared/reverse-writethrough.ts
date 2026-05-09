/**
 * reverseWritethrough — SB Edge Function helper for the GAS→Supabase
 * migration's MIG-002 reverse writethrough path.
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md, decision MIG-002
 * (synchronous SB→Sheets reverse writethrough). Companion GAS endpoint:
 * AppScripts/stride-api/StrideAPI.gs handleWriteThroughReverse_
 * (v38.200.0).
 *
 * When a function flips to active_backend='supabase' in P2+, its SB
 * Edge Function:
 *   1. Writes public.<table> directly (the new authoritative write).
 *   2. Calls reverseWritethrough(...) to mirror that row to the
 *      per-tenant Google Sheet so the legacy sheet stays current as a
 *      read-only mirror — the rollback foundation.
 *
 * The GAS-side writer is IDEMPOTENT by row identifier (find row by ID,
 * update or append), so at-least-once delivery from this helper is
 * safe — no idempotency-key store needed.
 *
 * Required Edge Function secrets (set in Supabase dashboard before
 * any function flips to SB-primary in P2):
 *   GAS_API_URL    — e.g. https://script.google.com/macros/s/<deploymentId>/exec
 *   GAS_API_TOKEN  — same value as the API_TOKEN script property in StrideAPI
 *
 * Failure semantics: throws on network/HTTP/payload errors. The caller
 * (the SB-side handler) MUST decide whether to swallow the error
 * (best-effort, mirrors today's GAS→SB writethrough pattern) or surface
 * it to the user. For P2.x, recommended pattern is best-effort: log to
 * gs_sync_events and continue, so a sheet-write failure doesn't undo
 * the SB-side commit.
 */

export type ReverseWritethroughOp = 'insert' | 'update' | 'delete';

export interface ReverseWritethroughInput {
  /** Per-tenant spreadsheet ID (matches public.clients.spreadsheet_id). */
  tenantId: string;
  /** public.<table> name. Must match an entry in REVERSE_WRITETHROUGH_TABLES_
   *  on the GAS side (StrideAPI.gs). */
  table: string;
  /** What changed. */
  op: ReverseWritethroughOp;
  /** Full SB row contents. Required for 'insert' and 'update'; can be
   *  omitted for 'delete'. The GAS-side per-table writer maps SB column
   *  names → sheet column headers. */
  row?: Record<string, unknown>;
  /** Primary identifier on the per-tenant sheet (Ledger Row ID, Task ID,
   *  Item ID, etc.). REQUIRED for 'update' and 'delete'. */
  rowId?: string;
  /** Optional. Threads through gs_sync_events for cross-system tracing. */
  correlationId?: string;
  /** Optional. Surfaces in gs_sync_events.request_id. */
  requestId?: string;
}

export interface ReverseWritethroughResult {
  success: boolean;
  table: string;
  op: ReverseWritethroughOp;
  rowId?: string;
  requestId?: string;
  tenantId?: string;
  /** Per-table-writer-specific payload. Stub writers return nothing. */
  result?: unknown;
}

/**
 * Fire-and-await reverse writethrough. Throws on:
 *   - missing GAS_API_URL / GAS_API_TOKEN env vars (configuration error)
 *   - HTTP non-2xx
 *   - GAS-side error response (success: false)
 *   - JSON parse failure
 *
 * The throw is intentional — the caller decides best-effort vs strict.
 */
export async function reverseWritethrough(
  input: ReverseWritethroughInput
): Promise<ReverseWritethroughResult> {
  const gasUrl   = Deno.env.get('GAS_API_URL');
  const gasToken = Deno.env.get('GAS_API_TOKEN');
  if (!gasUrl)   throw new Error('reverseWritethrough: GAS_API_URL env var not set');
  if (!gasToken) throw new Error('reverseWritethrough: GAS_API_TOKEN env var not set');

  // Validate inputs early so a malformed call doesn't hit the network.
  if (!input.tenantId) throw new Error('reverseWritethrough: tenantId required');
  if (!input.table)    throw new Error('reverseWritethrough: table required');
  if (!input.op)       throw new Error('reverseWritethrough: op required');
  if (input.op !== 'insert' && input.op !== 'update' && input.op !== 'delete') {
    throw new Error(`reverseWritethrough: op must be insert|update|delete, got ${input.op}`);
  }
  if ((input.op === 'update' || input.op === 'delete') && !input.rowId) {
    throw new Error(`reverseWritethrough: rowId required for ${input.op}`);
  }

  // doPost expects the action + token on the query string and the rest as
  // a JSON body. Mirrors the existing apiFetch / postQboCreateInvoice
  // pattern from the React side.
  const url = `${gasUrl}?action=writeThroughReverse&token=${encodeURIComponent(gasToken)}`;
  const body = {
    tenantId:      input.tenantId,
    table:         input.table,
    op:            input.op,
    row:           input.row ?? null,
    rowId:         input.rowId ?? '',
    correlationId: input.correlationId ?? '',
    requestId:     input.requestId ?? crypto.randomUUID(),
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`reverseWritethrough: network error calling GAS: ${e instanceof Error ? e.message : String(e)}`);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`reverseWritethrough: HTTP ${res.status} from GAS — ${text.slice(0, 500)}`);
  }

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`reverseWritethrough: non-JSON response from GAS — ${text.slice(0, 500)}`);
  }
  const j = json as Record<string, unknown>;
  if (!j.success) {
    throw new Error(`reverseWritethrough: GAS error — ${(j.error as string) || JSON.stringify(j)}`);
  }
  return j as unknown as ReverseWritethroughResult;
}

/**
 * Best-effort wrapper: catches any error from reverseWritethrough and
 * returns success:false instead of throwing. Useful inside a handler
 * that wants to keep the SB-side commit even when the sheet mirror
 * fails — matching the existing GAS→SB writethrough's best-effort
 * semantics.
 *
 * The caller should still LOG the error somewhere observable (e.g.
 * console.error in the Edge Function logs); the return value is for
 * control-flow only.
 */
export async function reverseWritethroughBestEffort(
  input: ReverseWritethroughInput
): Promise<ReverseWritethroughResult | { success: false; error: string }> {
  try {
    return await reverseWritethrough(input);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // eslint-disable-next-line no-console
    console.error(`reverseWritethroughBestEffort failed for ${input.table} ${input.op} ${input.rowId || ''}: ${msg}`);
    return { success: false, error: msg };
  }
}
