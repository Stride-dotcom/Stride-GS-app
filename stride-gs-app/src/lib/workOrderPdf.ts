/**
 * workOrderPdf — client-side Work Order document generation.
 *
 * Replaces the round-trip to Apps Script (which materialized a Google Doc
 * → exported PDF → uploaded to Drive). The new flow fetches the HTML
 * template from `email_templates` (key DOC_TASK_WORK_ORDER /
 * DOC_REPAIR_WORK_ORDER), substitutes tokens against the in-memory
 * Task/Repair object, opens a popup window, writes the rendered HTML, and
 * fires the print dialog. Same pattern as `orderPdf.ts` (delivery order)
 * and the T&C preview.
 *
 * Tokens mirror what `api_generateTaskWorkOrderPdf_` / the Repair
 * equivalent in StrideAPI.gs produce. Conditional rows
 * (SIDEMARK_ROW, NOTES_ROW, PHOTOS_ROW, APPROVED_ROW) are full <tr>
 * fragments built only when the underlying field has a value — empty
 * string otherwise, exactly like the Apps Script side. That keeps both
 * generators visually aligned.
 */
import { supabase } from './supabase';

// ─── Input shapes ────────────────────────────────────────────────────────────
//
// Both detail panels feed slightly different Task/Repair shapes (the React
// `Task`/`Repair` types vs. the looser `ApiTask`/`ApiRepair` from the
// network layer). Rather than over-specify, we declare structural inputs
// covering only the fields the templates actually substitute. Every
// nullable field is optional — missing values render as empty strings,
// which matches the Apps Script generator's null-safety. */

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

export interface RepairWorkOrderInput {
  repairId: string;
  itemId?: string;
  status?: string;
  clientName?: string;
  vendor?: string;
  description?: string;
  sidemark?: string;
  room?: string;
  qty?: number | string;
  notes?: string;
  repairNotes?: string;
  repairFolderUrl?: string;
  folderUrl?: string;
  createdDate?: string;
  approvedDate?: string;
  approved?: boolean;
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

// Same Wix-hosted logo used by the Apps Script generator's default
// branch. Keeps the printed PDF visually identical regardless of which
// path produced it.
const DEFAULT_LOGO_URL =
  'https://static.wixstatic.com/media/a38fbc_a8c7a368447f4723b782c4dbd765ca0e~mv2.png';

// Result-checkbox row HTML — identical to the Apps Script generator so
// printed forms look the same regardless of the source.
const TASK_RESULT_OPTIONS_HTML =
  '<span style="display:inline-block;margin-right:16px;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Pass</span>' +
  '<span style="display:inline-block;margin-right:16px;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Fail</span>' +
  '<span style="display:inline-block;margin-right:16px;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Needs Repair</span>' +
  '<span style="display:inline-block;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Other</span>';

const REPAIR_RESULT_OPTIONS_HTML =
  '<span style="display:inline-block;margin-right:16px;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Complete</span>' +
  '<span style="display:inline-block;margin-right:16px;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Partial</span>' +
  '<span style="display:inline-block;font-size:11px;"><span style="display:inline-block;width:14px;height:14px;border:1.5px solid #94A3B8;border-radius:3px;vertical-align:middle;margin-right:4px;"></span> Failed</span>';

// HTML escape — same surface the Apps Script `api_esc_` covers.
function esc(s: string | number | null | undefined): string {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDateMMDDYYYY(iso: string | null | undefined): string {
  if (!iso) return new Date().toLocaleDateString('en-US');
  try {
    const d = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso);
    if (isNaN(d.getTime())) return String(iso);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${d.getFullYear()}`;
  } catch { return String(iso); }
}

// Convert plain-text notes (with newlines) into HTML — preserves line
// breaks the way the Apps Script `api_notesPlainToHtml_` does.
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

function applyTokens(html: string, tokens: Record<string, string>): string {
  // Replace EVERY occurrence of each token. Apps Script does the same via
  // `api_resolveDocTokens_` — global string replace, no regex, so token
  // names that look regex-y still match literally.
  let out = html;
  for (const key of Object.keys(tokens)) {
    out = out.split(key).join(tokens[key]);
  }
  return out;
}

// v2026-05-04: Per-tab template cache. Templates change rarely (admin
// edits via Settings → Templates); caching avoids the Supabase round-trip
// on every doc generation, so the second-and-later clicks fire the print
// dialog instantly.
const templateCache = new Map<string, string>();

async function fetchTemplate(templateKey: string): Promise<string | null> {
  const cached = templateCache.get(templateKey);
  if (cached !== undefined) return cached;
  const { data, error } = await supabase
    .from('email_templates')
    .select('body')
    .eq('template_key', templateKey)
    .maybeSingle();
  if (error) {
    console.error('[workOrderPdf] template fetch failed:', error);
    return null;
  }
  const body = (data?.body as string | undefined) ?? null;
  if (body) templateCache.set(templateKey, body);
  return body;
}

function openPrintWindow(html: string, title: string): void {
  const win = window.open('', '_blank');
  if (!win) {
    alert('Please allow pop-ups for this site, then try again.');
    return;
  }
  win.document.open();
  // Wrap the template body (which begins at <html>) so the popup gets
  // a proper title we can show in the tab + print preview header.
  const wrapped = html.replace(
    /<head>/i,
    `<head><title>${esc(title)}</title>`,
  );
  win.document.write(wrapped);
  win.document.close();
  // Same delay orderPdf uses — gives the browser time to paint before
  // popping the print dialog. Without this Chrome sometimes prints a
  // blank page.
  setTimeout(() => {
    try { win.focus(); win.print(); } catch { /* user may have closed it */ }
  }, 450);
}

// ─── Task ────────────────────────────────────────────────────────────────────

export async function generateTaskWorkOrderPdf(task: TaskWorkOrderInput): Promise<void> {
  const template = await fetchTemplate('DOC_TASK_WORK_ORDER');
  if (!template) {
    alert('Work Order template (DOC_TASK_WORK_ORDER) not found in Supabase.');
    return;
  }

  const sidemark = (task.sidemark || '').trim();
  const taskNotes = (task.taskNotes || task.notes || '').trim();
  const photosUrl = (task.taskFolderUrl || task.folderUrl || '').trim();
  const createdRaw = task.created || task.createdAt || '';

  const tokens: Record<string, string> = {
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

  const html = applyTokens(template, tokens);
  openPrintWindow(html, `Work Order — ${task.taskId}`);
}

// ─── Repair ──────────────────────────────────────────────────────────────────

export async function generateRepairWorkOrderPdf(repair: RepairWorkOrderInput): Promise<void> {
  const template = await fetchTemplate('DOC_REPAIR_WORK_ORDER');
  if (!template) {
    alert('Repair Work Order template (DOC_REPAIR_WORK_ORDER) not found in Supabase.');
    return;
  }

  const sidemark = (repair.sidemark || '').trim();
  const repairNotes = (repair.repairNotes || repair.notes || '').trim();
  const photosUrl = (repair.repairFolderUrl || repair.folderUrl || '').trim();
  const approved = !!repair.approvedDate || repair.approved === true ||
                   repair.status === 'Approved' ||
                   repair.status === 'In Progress' ||
                   repair.status === 'Complete';

  // Repair body lacks a 'type' column — use the description as the
  // "repair type" mnemonic, matching the GAS generator's behavior at
  // StrideAPI.gs:15996 / 16593 (`{{REPAIR_TYPE}}: e(itemDesc)`).
  const repairType = repair.description || '';

  const tokens: Record<string, string> = {
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
    '{{ITEM_ID}}': esc(repair.itemId || ''),
    '{{ITEM_QTY}}': esc(repair.qty != null ? String(repair.qty) : '1'),
    '{{ITEM_VENDOR}}': esc(repair.vendor || ''),
    '{{ITEM_DESC}}': esc(repair.description || ''),
    '{{ITEM_SIDEMARK}}': esc(sidemark),
    '{{ITEM_ROOM}}': esc(repair.room || ''),
    '{{RESULT_OPTIONS_HTML}}': REPAIR_RESULT_OPTIONS_HTML,
  };

  const html = applyTokens(template, tokens);
  openPrintWindow(html, `Repair Work Order — ${repair.repairId}`);
}

// ─── Will Call Release ───────────────────────────────────────────────────────
//
// Replaces the two-button GAS flow ("Pickup Doc" + "Release Doc") with a
// single client-side render: fetch DOC_WILL_CALL_RELEASE from email_templates,
// substitute every token from the WillCall object, open a popup, print.
// Token vocabulary matches the seeded template (see migration history under
// AppScripts/.../email_templates and the live row in `email_templates`).

/** Build one <tr> for the items table at the bottom of the release doc.
 *  Columns: #, Item ID, Qty, Vendor, Description, Class, Location, Sidemark —
 *  in the same order the orange table header in the template declares. */
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

/** Bold red callout that prints above the order/release blocks. Only rendered
 *  when the WC carries a COD flag — the rest of the template assumes the
 *  token is an empty string. */
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

/** Single-row helper for the ORDER DETAILS card. Builds a label/value `<tr>`
 *  that matches the surrounding column widths/styles set by the template. */
function detailRowHtml(label: string, value: string): string {
  return (
    '<tr>' +
    `<td style="font-size:10px;color:#64748B;padding:2px 0;width:90px;">${esc(label)}</td>` +
    `<td style="font-size:12px;font-weight:bold;">${esc(value)}</td>` +
    '</tr>'
  );
}

export async function generateWillCallReleasePdf(wc: WillCallReleaseInput): Promise<void> {
  const template = await fetchTemplate('DOC_WILL_CALL_RELEASE');
  if (!template) {
    alert('Will Call Release template (DOC_WILL_CALL_RELEASE) not found in Supabase.');
    return;
  }

  const items = wc.items || [];
  const itemCount = items.length;
  const pickupParty = (wc.pickupParty || '').trim();
  const pickupPhone = (wc.pickupPartyPhone || '').trim();
  const notes = (wc.notes || '').trim();
  const requestedBy = (wc.requestedBy || wc.createdBy || '').trim();

  const itemsHtml = items.map((it, idx) => wcItemRowHtml(it, idx)).join('');

  // Conditional pieces — the template renders each as an empty token when
  // its source field is blank, mirroring how the GAS generator handled them.
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

  const tokens: Record<string, string> = {
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

  const html = applyTokens(template, tokens);
  openPrintWindow(html, `Will Call Release — ${wc.wcNumber}`);
}

// ─── Receiving (shipment) ────────────────────────────────────────────────────

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

/**
 * Generate a Receiving document for a shipment — header + items table.
 * Pure client-side: fetches the DOC_RECEIVING template from Supabase
 * (one query, cached per-tab), substitutes tokens, opens a print window.
 * No GAS round-trip; subsequent calls in the same session are instant.
 */
export async function generateReceivingDocPdf(shipment: ReceivingDocInput): Promise<void> {
  const template = await fetchTemplate('DOC_RECEIVING');
  if (!template) {
    alert('Receiving template (DOC_RECEIVING) not found in Supabase.');
    return;
  }

  const items = shipment.items ?? [];
  const totalItems = shipment.totalItems != null
    ? String(shipment.totalItems)
    : String(items.reduce((s, it) => s + (Number(it.qty) || 0), 0));

  // Items table rows — same shape the Apps Script generator produced so
  // the template renders identically whether the source is GAS-built or
  // client-built.
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

  const tokens: Record<string, string> = {
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

  const html = applyTokens(template, tokens);
  openPrintWindow(html, `Receiving — ${shipment.shipmentNo}`);
}
