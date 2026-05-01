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

async function fetchTemplate(templateKey: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('email_templates')
    .select('body')
    .eq('template_key', templateKey)
    .maybeSingle();
  if (error) {
    console.error('[workOrderPdf] template fetch failed:', error);
    return null;
  }
  return (data?.body as string | undefined) ?? null;
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
