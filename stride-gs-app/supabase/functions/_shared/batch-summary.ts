/**
 * _shared/batch-summary.ts — D11 option-B batch summary email.
 *
 * When the LAST sub-task of a batch (tasks.batch_no) goes TERMINAL
 * (Completed or Cancelled), exactly ONE BATCH_COMPLETE summary email goes
 * out with the per-item Result + Notes table. Per-sub completion emails are
 * suppressed by the callers.
 *
 * Callers: complete-task (the normal path), cancel-task-sb +
 * batch-cancel-tasks-sb (so a batch whose last terminal event is a
 * CANCELLATION still gets its summary — review finding, PR D11).
 *
 * Duplicate-send safety: the all-terminal check only passes once per batch
 * in practice, and send-email dedupes on idempotencyKey
 * batch-complete:{tenant}:{batchNo} for the race where two subs go terminal
 * simultaneously (or a complete and a cancel race each other).
 *
 * Returns: 'pending' (subs still open), 'sent', 'all_cancelled' (every sub
 * cancelled — nothing was actually worked, summary suppressed),
 * 'notifications_disabled', or an error string.
 */

// Permissive client type — each caller passes its own createClient instance;
// the supabase-js builder generics don't matter here and esbuild strips
// types at deploy anyway.
// deno-lint-ignore no-explicit-any
type SbLike = any;

const APP_URL = 'https://www.mystridehub.com';

interface SubRow {
  task_id: string; item_id: string | null; type: string | null;
  status: string | null; result: string | null; task_notes: string | null;
  completed_at: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export async function maybeSendBatchSummary(
  sb: SbLike,
  supabaseUrl: string,
  serviceKey: string,
  tenantId: string,
  batchNo: string,
  clientName: string,
  enableNotifications: boolean,
): Promise<string> {
  const { data: subRows, error: subErr } = await sb
    .from('tasks')
    .select('task_id, item_id, type, status, result, task_notes, completed_at')
    .eq('tenant_id', tenantId)
    .eq('batch_no', batchNo)
    .order('created', { ascending: true });
  if (subErr) return `batch summary: sub lookup failed: ${subErr.message}`;
  const subs = (subRows ?? []) as SubRow[];
  if (subs.length === 0) return 'pending';

  const TERMINAL = new Set(['Completed', 'Cancelled']);
  if (!subs.every(s => TERMINAL.has(String(s.status ?? '').trim()))) return 'pending';

  // Every sub cancelled → no work happened; a "0 passed / 0 failed" email
  // would be noise (review nit #3).
  if (subs.every(s => String(s.status ?? '').trim() === 'Cancelled')) return 'all_cancelled';

  if (!enableNotifications) return 'notifications_disabled';

  // Inventory overlay for the table.
  const itemIds = subs.map(s => String(s.item_id ?? '').trim()).filter(Boolean);
  interface InvRow2 { item_id: string; description: string | null; vendor: string | null; sidemark: string | null; }
  const { data: invRows } = itemIds.length > 0
    ? await sb.from('inventory')
        .select('item_id, description, vendor, sidemark')
        .eq('tenant_id', tenantId).in('item_id', itemIds)
    : { data: null };
  const invMap = new Map<string, InvRow2>();
  for (const r of ((invRows ?? []) as InvRow2[])) invMap.set(r.item_id, r);

  const td = 'padding:6px 10px;border-bottom:1px solid #E5E7EB;font-size:13px;color:#1F2937;vertical-align:top;';
  const th = 'padding:8px 10px;background:#F9FAFB;border-bottom:2px solid #D1D5DB;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#374151;text-align:left;';
  let passCount = 0, failCount = 0;
  const resultCell = (s: SubRow): string => {
    const status = String(s.status ?? '').trim();
    const result = String(s.result ?? '').trim();
    if (status === 'Cancelled') return '<span style="color:#6B7280;font-weight:600;">Cancelled</span>';
    if (result === 'Pass') { passCount++; return '<span style="color:#15803D;font-weight:700;">&#10003; Pass</span>'; }
    if (result === 'Fail') { failCount++; return '<span style="color:#B91C1C;font-weight:700;">&#10007; Fail</span>'; }
    return '&mdash;';
  };
  const rows = subs.map(s => {
    const id = String(s.item_id ?? '').trim();
    const inv = invMap.get(id);
    return [
      '<tr>',
      `<td style="${td}font-family:monospace;font-size:12px;">${escapeHtml(id)}</td>`,
      `<td style="${td}">${escapeHtml(String(inv?.description ?? ''))}</td>`,
      `<td style="${td}">${escapeHtml(String(inv?.vendor ?? ''))}</td>`,
      `<td style="${td}">${escapeHtml(String(inv?.sidemark ?? ''))}</td>`,
      `<td style="${td}white-space:nowrap;">${resultCell(s)}</td>`,
      `<td style="${td}">${s.task_notes ? escapeHtml(String(s.task_notes)) : '&mdash;'}</td>`,
      '</tr>',
    ].join('');
  }).join('');
  const itemTableHtml = [
    '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;width:100%;margin:8px 0 16px;">',
    '<thead><tr>',
    `<th style="${th}">Item ID</th>`,
    `<th style="${th}">Description</th>`,
    `<th style="${th}">Vendor</th>`,
    `<th style="${th}">Sidemark</th>`,
    `<th style="${th}">Result</th>`,
    `<th style="${th}">Notes</th>`,
    '</tr></thead><tbody>',
    rows,
    '</tbody></table>',
  ].join('');

  // Service display name from the first sub's type (batches are one svc).
  const svcName = String(subs[0]?.type ?? 'Task').trim() || 'Task';
  const completedDates = subs.map(s => s.completed_at).filter(Boolean).sort();
  const completedDate = String(completedDates[completedDates.length - 1] ?? '').slice(0, 10);
  const appDeepLink = `${APP_URL}/#/batches/${encodeURIComponent(batchNo)}?client=${encodeURIComponent(tenantId)}`;

  try {
    const sendRes = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey':         serviceKey,
        'Content-Type':   'application/json',
      },
      body: JSON.stringify({
        templateKey: 'BATCH_COMPLETE',
        tokens: {
          CLIENT_NAME:     clientName,
          BATCH_NO:        batchNo,
          SVC_NAME:        svcName,
          COMPLETED_DATE:  completedDate,
          TASK_COUNT:      String(subs.length),
          PASS_COUNT:      String(passCount),
          FAIL_COUNT:      String(failCount),
          ITEM_TABLE_HTML: itemTableHtml,
          APP_URL,
          APP_DEEP_LINK:   appDeepLink,
        },
        // One summary per batch, ever — also covers two subs going terminal
        // in the same instant (both pass the all-terminal check).
        idempotencyKey:    `batch-complete:${tenantId}:${batchNo}`,
        relatedEntityType: 'task',
        relatedEntityId:   batchNo,
        tenantId,
      }),
    });
    const sendJson = await sendRes.json().catch(() => ({})) as Record<string, unknown>;
    if (sendJson.ok) return 'sent';
    return `batch summary send failed: ${String(sendJson.error ?? `HTTP ${sendRes.status}`)}`;
  } catch (e) {
    return `batch summary send threw: ${e instanceof Error ? e.message : String(e)}`;
  }
}
