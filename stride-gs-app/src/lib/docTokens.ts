/**
 * docTokens — input shapes + token builders for every Stride document
 * generated client-side. Each `buildXTokens` returns a flat
 * `Record<string,string>` keyed by `{{TOKEN}}` strings that the matching
 * `email_templates` row (DOC_RECEIVING / DOC_TASK_WORK_ORDER /
 * DOC_REPAIR_WORK_ORDER / DOC_WILL_CALL_RELEASE) expects. The renderer
 * (`docRenderer.ts`) is template-agnostic — it just substitutes tokens —
 * so all the doc-specific shape logic lives here.
 *
 * Mirrors the token vocabulary previously produced by
 * `api_generateTaskWorkOrderPdf_` etc. in StrideAPI.gs. Conditional rows
 * (SIDEMARK_ROW, NOTES_ROW, PHOTOS_ROW, APPROVED_ROW, …) are full <tr>
 * fragments built only when the underlying field has a value — empty
 * string otherwise, exactly like the Apps Script side. Same fixtures keep
 * the two pipelines visually aligned during the GAS → SB cutover.
 */

// ─── Input shapes ────────────────────────────────────────────────────────────

export interface TaskWorkOrderInput {
  taskId: string;
  itemId?: string;
  type?: string;
  status?: string;
  clientName?: string;
  vendor?: string;
  description?: string;
  sidemark?: string;
  room?: string;
  reference?: string;
  qty?: number | string;
  taskNotes?: string;
  notes?: string;
  taskFolderUrl?: string;
  folderUrl?: string;
  created?: string;
  createdAt?: string;
}

/**
 * One row in a multi-item repair's ITEM DETAILS table. Structurally a
 * subset of `ApiRepairItem` (api.ts) so `buildRepairTokens(repair)` can
 * pass the full `repair.items` array straight through. Legacy single-item
 * repairs carry exactly one of these; bulk-created repairs carry N.
 */
export interface RepairWorkOrderItemInput {
  itemId?: string;
  qty?: number | string;
  vendor?: string;
  description?: string;
  sidemark?: string;
  room?: string;
  location?: string;
}

export interface RepairWorkOrderInput {
  repairId: string;
  itemId?: string;
  status?: string;
  clientName?: string;
  vendor?: string;
  description?: string;
  sidemark?: string;
  room?: string;
  location?: string;
  qty?: number | string;
  notes?: string;
  repairNotes?: string;
  repairFolderUrl?: string;
  folderUrl?: string;
  createdDate?: string;
  approvedDate?: string;
  approved?: boolean;
  // Multi-item repairs (2026-05-13). Populated from public.repair_items
  // overlaid with inventory fields. When present (>=1 row), the work
  // order's ITEM DETAILS table renders one row per item; otherwise it
  // falls back to the single-item fields above. See buildRepairTokens.
  items?: RepairWorkOrderItemInput[];
}

export interface WillCallItemInput {
  itemId?: string;
  qty?: number | string;
  vendor?: string;
  description?: string;
  itemClass?: string;
  location?: string;
  sidemark?: string;
}

export interface WillCallReleaseInput {
  wcNumber: string;
  clientName?: string;
  pickupParty?: string;
  pickupPartyPhone?: string;
  scheduledDate?: string;
  requestedBy?: string;
  createdBy?: string;
  notes?: string;
  cod?: boolean;
  codAmount?: number | string | null;
  items?: WillCallItemInput[];
}

export interface ReceivingItemInput {
  itemId?: string;
  qty?: number | string;
  vendor?: string;
  description?: string;
  itemClass?: string;
  location?: string;
  sidemark?: string;
  reference?: string;
}

export interface ReceivingDocInput {
  shipmentNo: string;
  clientName?: string;
  clientEmail?: string;
  carrier?: string;
  tracking?: string;
  receivedDate?: string;
  notes?: string;
  totalItems?: number | string;
  items?: ReceivingItemInput[];
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

// Same Wix-hosted logo used by the Apps Script generator's default branch.
// Keeps the printed PDF visually identical regardless of which path produced it.
const DEFAULT_LOGO_URL =
  'https://static.wixstatic.com/media/a38fbc_a8c7a368447f4723b782c4dbd765ca0e~mv2.png';

const TASK_RESULT_OPTIONS_HTML =
  '<span style="display:inline-block;margin-right:16px;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Pass</span>' +
  '<span style="display:inline-block;margin-right:16px;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Fail</span>' +
  '<span style="display:inline-block;margin-right:16px;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Needs Repair</span>' +
  '<span style="display:inline-block;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Other</span>';

const REPAIR_RESULT_OPTIONS_HTML =
  '<span style="display:inline-block;margin-right:16px;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Complete</span>' +
  '<span style="display:inline-block;margin-right:16px;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Partial</span>' +
  '<span style="display:inline-block;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Failed</span>';

export function esc(s: string | number | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtDateMMDDYYYY(iso: string | null | undefined): string {
  if (!iso) return new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
  try {
    const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
    if (isNaN(d.getTime())) return String(iso);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${d.getFullYear()}`;
  } catch { return String(iso); }
}

function notesToHtml(notes: string): string {
  return esc(notes).replace(/\r\n|\n|\r/g, '<br>');
}

function rowHtml(label: string, valueHtml: string): string {
  return (
    '<tr><td style="font-size:10px;color:#64748B;padding:2px 0;font-weight:700;">' +
    esc(label) +
    '</td><td style="font-size:12px;">' +
    valueHtml +
    '</td></tr>'
  );
}

function detailRowHtml(label: string, value: string): string {
  return (
    '<tr>' +
    `<td style="font-size:10px;color:#64748B;padding:2px 0;width:90px;">${esc(label)}</td>` +
    `<td style="font-size:12px;font-weight:bold;">${esc(value)}</td>` +
    '</tr>'
  );
}

function wcItemRowHtml(it: WillCallItemInput, idx: number): string {
  const cell =
    'padding:4px 6px;font-size:10px;color:#1E293B;border-bottom:1px solid #E2E8F0;';
  const cellCenter = cell + 'text-align:center;';
  const qty = it.qty == null || it.qty === '' ? 1 : it.qty;
  return (
    '<tr>' +
    `<td style="${cellCenter}width:24px;">${idx + 1}</td>` +
    `<td style="${cell}font-weight:600;font-family:monospace;">${esc(it.itemId || '')}</td>` +
    `<td style="${cellCenter}width:30px;">${esc(String(qty))}</td>` +
    `<td style="${cell}">${esc(it.vendor || '')}</td>` +
    `<td style="${cell}">${esc(it.description || '')}</td>` +
    `<td style="${cellCenter}width:38px;">${esc(it.itemClass || '')}</td>` +
    `<td style="${cell}font-family:monospace;">${esc(it.location || '')}</td>` +
    `<td style="${cell}">${esc(it.sidemark || '')}</td>` +
    '</tr>'
  );
}

/**
 * One <tr> for the DOC_REPAIR_WORK_ORDER ITEM DETAILS table. Cell styling
 * mirrors the single-item row that used to be hardcoded in the template
 * (Item ID / Qty / Vendor / Description / Sidemark / Room / Location), so
 * a multi-item table prints identically to the legacy single-item one.
 * `sidemarkFallback` is the repair-level sidemark, used when an item's own
 * inventory-overlay sidemark is blank (legacy single-item parity).
 */
function repairItemRowHtml(it: RepairWorkOrderItemInput, sidemarkFallback: string): string {
  const cell = 'padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;';
  const qty = it.qty == null || it.qty === '' ? 1 : it.qty;
  const itemSidemark = (it.sidemark || '').trim() || sidemarkFallback;
  return (
    '<tr>' +
    `<td style="${cell}font-weight:bold;">${esc(it.itemId || '')}</td>` +
    `<td style="${cell}text-align:center;">${esc(String(qty))}</td>` +
    `<td style="${cell}">${esc(it.vendor || '')}</td>` +
    `<td style="${cell}">${esc(it.description || '')}</td>` +
    `<td style="${cell}">${esc(itemSidemark)}</td>` +
    `<td style="${cell}">${esc(it.room || '')}</td>` +
    `<td style="${cell}font-family:monospace;">${esc(it.location || '')}</td>` +
    '</tr>'
  );
}

function codBannerHtml(cod: boolean, amount: number | string | null | undefined): string {
  if (!cod) return '';
  let amt = '';
  if (amount != null && amount !== '') {
    const n = typeof amount === 'number' ? amount : parseFloat(String(amount));
    if (Number.isFinite(n) && n > 0) {
      amt = ` — $${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
  }
  return (
    '<div style="background:#FEF2F2;border:2px solid #DC2626;padding:10px 14px;' +
    'margin-bottom:8px;text-align:center;">' +
    '<span style="font-size:13px;font-weight:bold;color:#991B1B;letter-spacing:0.04em;">' +
    'COLLECT ON DELIVERY' + amt + '</span></div>'
  );
}

// ─── Token builders ──────────────────────────────────────────────────────────

export function buildTaskTokens(task: TaskWorkOrderInput): Record<string, string> {
  const sidemark = (task.sidemark || '').trim();
  const taskNotes = (task.taskNotes || task.notes || '').trim();
  const photosUrl = (task.taskFolderUrl || task.folderUrl || '').trim();
  const createdRaw = task.created || task.createdAt || '';

  return {
    '{{LOGO_URL}}': esc(DEFAULT_LOGO_URL),
    '{{TASK_ID}}': esc(task.taskId),
    '{{CLIENT_NAME}}': esc(task.clientName || ''),
    '{{DATE}}': esc(fmtDateMMDDYYYY(createdRaw)),
    '{{SIDEMARK}}': esc(sidemark),
    '{{SIDEMARK_ROW}}': sidemark ? rowHtml('SIDEMARK', esc(sidemark)) : '',
    '{{STATUS}}': esc(task.status || ''),
    '{{TASK_TYPE}}': esc(task.type || ''),
    '{{NOTES_ROW}}': taskNotes ? rowHtml('Notes', notesToHtml(taskNotes)) : '',
    '{{PHOTOS_ROW}}': photosUrl
      ? rowHtml(
          'Photos',
          `<a href="${esc(photosUrl)}" style="color:#E85D2D;text-decoration:underline;">View Photos</a>`,
        )
      : '',
    '{{ITEM_ID}}': esc(task.itemId || ''),
    '{{ITEM_QTY}}': esc(task.qty != null ? String(task.qty) : '1'),
    '{{ITEM_VENDOR}}': esc(task.vendor || ''),
    '{{ITEM_DESC}}': esc(task.description || ''),
    '{{ITEM_SIDEMARK}}': esc(sidemark),
    '{{ITEM_ROOM}}': esc(task.room || ''),
    '{{RESULT_OPTIONS_HTML}}': TASK_RESULT_OPTIONS_HTML,
  };
}

export function buildRepairTokens(repair: RepairWorkOrderInput): Record<string, string> {
  const sidemark = (repair.sidemark || '').trim();
  const repairNotes = (repair.repairNotes || repair.notes || '').trim();
  const photosUrl = (repair.repairFolderUrl || repair.folderUrl || '').trim();
  const approved = !!repair.approvedDate || repair.approved === true ||
                   repair.status === 'Approved' ||
                   repair.status === 'In Progress' ||
                   repair.status === 'Complete';
  // Repair body lacks a 'type' column — use the description as the
  // "repair type" mnemonic, matching the GAS generator at StrideAPI.gs
  // (`{{REPAIR_TYPE}}: e(itemDesc)`).
  const repairType = repair.description || '';

  // ITEM DETAILS table rows. Multi-item repairs carry every item in
  // `repair.items` (from public.repair_items + inventory overlay); legacy
  // single-item repairs have either a one-row items[] or none, in which
  // case we synthesize a single row from the repair's own fields. The
  // bug this fixes: the template hardcoded ONE data row, so multi-item
  // work orders only ever printed the primary item.
  const itemList: RepairWorkOrderItemInput[] =
    repair.items && repair.items.length > 0
      ? repair.items
      : [{
          itemId: repair.itemId,
          qty: repair.qty,
          vendor: repair.vendor,
          description: repair.description,
          sidemark,
          room: repair.room,
          location: repair.location,
        }];
  const itemRows = itemList.map((it) => repairItemRowHtml(it, sidemark)).join('');

  // The first item also fills the legacy single-row `{{ITEM_*}}` tokens.
  // These stay in case the live template hasn't been migrated to
  // `{{ITEM_ROWS}}` yet — both token sets are emitted so neither template
  // version renders a literal placeholder (deploy-order independent).
  const primary = itemList[0] || {};

  return {
    '{{LOGO_URL}}': esc(DEFAULT_LOGO_URL),
    '{{REPAIR_ID}}': esc(repair.repairId),
    '{{CLIENT_NAME}}': esc(repair.clientName || ''),
    '{{DATE}}': esc(fmtDateMMDDYYYY(repair.createdDate)),
    '{{SIDEMARK}}': esc(sidemark),
    '{{SIDEMARK_ROW}}': sidemark ? rowHtml('SIDEMARK', esc(sidemark)) : '',
    '{{STATUS}}': esc(repair.status || ''),
    '{{REPAIR_TYPE}}': esc(repairType),
    '{{APPROVED_ROW}}': approved ? rowHtml('Approved', 'Yes') : '',
    '{{NOTES_ROW}}': repairNotes ? rowHtml('Notes', notesToHtml(repairNotes)) : '',
    '{{PHOTOS_ROW}}': photosUrl
      ? rowHtml(
          'Photos',
          `<a href="${esc(photosUrl)}" style="color:#E85D2D;text-decoration:underline;">View Photos</a>`,
        )
      : '',
    // Multi-item table body — one <tr> per repair item.
    '{{ITEM_ROWS}}': itemRows,
    // Legacy single-row tokens (primary item) — see note above.
    '{{ITEM_ID}}': esc(primary.itemId || ''),
    '{{ITEM_QTY}}': esc(primary.qty != null ? String(primary.qty) : '1'),
    '{{ITEM_VENDOR}}': esc(primary.vendor || ''),
    '{{ITEM_DESC}}': esc(primary.description || ''),
    '{{ITEM_SIDEMARK}}': esc((primary.sidemark || '').trim() || sidemark),
    '{{ITEM_ROOM}}': esc(primary.room || ''),
    '{{ITEM_LOCATION}}': esc(primary.location || ''),
    '{{RESULT_OPTIONS_HTML}}': REPAIR_RESULT_OPTIONS_HTML,
  };
}

export function buildWillCallTokens(wc: WillCallReleaseInput): Record<string, string> {
  const items = wc.items || [];
  const itemCount = items.length;
  const pickupParty = (wc.pickupParty || '').trim();
  const pickupPhone = (wc.pickupPartyPhone || '').trim();
  const notes = (wc.notes || '').trim();
  const requestedBy = (wc.requestedBy || wc.createdBy || '').trim();

  const itemsHtml = items.map((it, idx) => wcItemRowHtml(it, idx)).join('');

  const estPickupRow = wc.scheduledDate
    ? detailRowHtml('Est. Pickup', fmtDateMMDDYYYY(wc.scheduledDate))
    : '';
  const requestedByRow = requestedBy
    ? detailRowHtml('Requested By', requestedBy)
    : '';
  const pickupPhoneHtml = pickupPhone
    ? `<div style="font-size:11px;color:#64748B;margin-top:2px;">${esc(pickupPhone)}</div>`
    : '';
  const notesHtml = notes
    ? '<div style="background:#FFFBEB;border:1px solid #FDE68A;padding:10px 12px;' +
      'margin-bottom:10px;"><div style="font-size:9px;color:#92400E;font-weight:bold;' +
      'margin-bottom:4px;">NOTES</div><div style="font-size:11px;color:#78350F;' +
      'line-height:1.5;">' + notesToHtml(notes) + '</div></div>'
    : '';

  return {
    '{{LOGO_URL}}': esc(DEFAULT_LOGO_URL),
    '{{WC_NUMBER}}': esc(wc.wcNumber),
    '{{CLIENT_NAME}}': esc(wc.clientName || ''),
    '{{DATE}}': esc(fmtDateMMDDYYYY(new Date().toISOString())),
    '{{ITEM_COUNT}}': esc(String(itemCount)),
    '{{TOTAL_ITEMS}}': esc(String(itemCount)),
    '{{PICKUP_PARTY}}': esc(pickupParty || '—'),
    '{{PICKUP_PHONE_HTML}}': pickupPhoneHtml,
    '{{EST_PICKUP_ROW}}': estPickupRow,
    '{{REQUESTED_BY_ROW}}': requestedByRow,
    '{{NOTES_HTML}}': notesHtml,
    '{{COD_BANNER_HTML}}': codBannerHtml(!!wc.cod, wc.codAmount),
    '{{ITEMS_TABLE_ROWS}}': itemsHtml,
  };
}

export function buildReceivingTokens(shipment: ReceivingDocInput): Record<string, string> {
  const items = shipment.items ?? [];
  const totalItems = shipment.totalItems != null
    ? String(shipment.totalItems)
    : String(items.reduce((s, it) => s + (Number(it.qty) || 0), 0));

  const itemsTableRows = items.map((it) => (
    '<tr>' +
    `<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:11px;font-family:monospace;">${esc(it.itemId || '')}</td>` +
    `<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:11px;text-align:center;">${esc(it.qty != null ? String(it.qty) : '')}</td>` +
    `<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:11px;">${esc(it.vendor || '')}</td>` +
    `<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:11px;">${esc(it.description || '')}</td>` +
    `<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:11px;">${esc(it.itemClass || '')}</td>` +
    `<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:11px;font-family:monospace;">${esc(it.location || '')}</td>` +
    `<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:11px;">${esc(it.sidemark || '')}</td>` +
    `<td style="padding:6px 8px;border-bottom:1px solid #E2E8F0;font-size:11px;">${esc(it.reference || '')}</td>` +
    '</tr>'
  )).join('');

  const notes = (shipment.notes || '').trim();
  const notesHtml = notes
    ? `<div style="margin-top:12px;font-size:11px;"><span style="font-weight:700;color:#64748B;">NOTES:</span> ${notesToHtml(notes)}</div>`
    : '';

  const clientEmail = (shipment.clientEmail || '').trim();
  const clientEmailHtml = clientEmail
    ? rowHtml('Email', esc(clientEmail))
    : '';

  return {
    '{{LOGO_URL}}':             esc(DEFAULT_LOGO_URL),
    '{{SHIPMENT_NO}}':          esc(shipment.shipmentNo),
    '{{CLIENT_NAME}}':          esc(shipment.clientName || ''),
    '{{CLIENT_EMAIL_HTML}}':    clientEmailHtml,
    '{{CARRIER}}':              esc(shipment.carrier || ''),
    '{{TRACKING}}':             esc(shipment.tracking || ''),
    '{{RECEIVED_DATE}}':        esc(fmtDateMMDDYYYY(shipment.receivedDate)),
    '{{ITEM_COUNT}}':           esc(String(items.length)),
    '{{TOTAL_ITEMS}}':          esc(totalItems),
    '{{SHIPMENT_NOTES_HTML}}':  notesHtml,
    '{{ITEMS_TABLE_ROWS}}':     itemsTableRows,
  };
}
