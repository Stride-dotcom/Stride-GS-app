/**
 * docRenderer — single entry point for every Stride document.
 *
 * Workflow:
 *   1. Fetch the HTML template from `public.email_templates` (per-tab cache).
 *   2. Substitute every `{{TOKEN}}` against the provided map.
 *   3. Dispatch on `options.action`:
 *      - `print`    → open in popup window, fire window.print()
 *      - `download` → render to a hidden host node, html2pdf.js → blob,
 *                     trigger a saveAs download
 *      - `upload`   → render to blob (same as download), upload to the
 *                     `documents` bucket + insert a `public.documents`
 *                     row. On failure, enqueue for retry via
 *                     docUploadQueue.
 *
 * Token builders live in `docTokens.ts`. The four print buttons + four
 * completion handlers route through this one function — adding a new
 * document type means: add a row to `email_templates`, add a
 * `buildXTokens` helper, call `renderDoc('DOC_X', tokens, opts)`.
 *
 * html2pdf.js fidelity caveat: html2canvas does NOT honor `@media print`
 * rules and can render web fonts inconsistently on first paint. Visual
 * parity with the print-button output is *close*, not pixel-identical.
 * For doc-quality output prefer `print`; `download`/`upload` are for
 * archive/sharing where small font-fallback differences are acceptable.
 */
import { supabase } from './supabase';
import html2pdf from 'html2pdf.js';
import { esc } from './docTokens';
import { enqueueUpload, findExistingAutoDoc, type QueuedUpload } from './docUploadQueue';

// ─── Template fetch + token substitution ─────────────────────────────────────

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
    console.error('[docRenderer] template fetch failed:', error);
    return null;
  }
  const body = (data?.body as string | undefined) ?? null;
  if (body) templateCache.set(templateKey, body);
  return body;
}

function applyTokens(html: string, tokens: Record<string, string>): string {
  // Replace EVERY occurrence of each token. Apps Script does the same via
  // `api_resolveDocTokens_` — global string split/join, no regex, so token
  // names that look regex-y still match literally.
  let out = html;
  for (const key of Object.keys(tokens)) {
    out = out.split(key).join(tokens[key]);
  }
  return out;
}

// ─── Print action ────────────────────────────────────────────────────────────

function openPrintWindow(html: string, title: string): void {
  const win = window.open('', '_blank');
  if (!win) {
    alert('Please allow pop-ups for this site, then try again.');
    return;
  }
  win.document.open();
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

// ─── Blob render (download + upload share this) ──────────────────────────────

/**
 * Render HTML to a PDF Blob via html2pdf.js. Builds a detached host
 * div, runs html2canvas → jsPDF, returns the Blob. Host node is removed
 * before resolve so we don't leak DOM.
 *
 * Letter format with 0.4" margins matches what the GAS-generated docs
 * historically produced for receiving/work-order/release prints.
 */
async function renderHtmlToPdfBlob(html: string, fileName: string): Promise<Blob> {
  // Mount detached, off-screen. html2pdf.js needs the node attached to
  // the DOM so layout computes correctly; positioning it absolute at
  // -10000 keeps it invisible and out of the live layout.
  const host = document.createElement('div');
  host.style.cssText = 'position:absolute;left:-10000px;top:0;width:8.5in;background:#fff;';
  host.innerHTML = html;
  document.body.appendChild(host);

  try {
    const worker = html2pdf()
      .set({
        margin: 0.4,
        filename: fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
      })
      .from(host);

    const blob: Blob = await worker.outputPdf('blob');
    return blob;
  } finally {
    host.remove();
  }
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const safe = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`;
  const a = document.createElement('a');
  a.href = url;
  a.download = safe;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser a tick to start the download before revoking — Chrome
  // sometimes cancels the download if the URL is revoked synchronously.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Upload action (Supabase Storage + documents row) ────────────────────────

const BUCKET = 'documents';

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
}

function sanitizeTenantForPath(tenantId: string): string {
  return tenantId.replace(/[^a-zA-Z0-9-]/g, '-');
}

function sanitizeContextForPath(contextId: string): string {
  return contextId.replace(/[^a-zA-Z0-9._-]/g, '-');
}

interface RenderDocUploadArgs {
  templateKey: string;
  tokens: Record<string, string>;
  fileName: string;
  tenantId: string;
  entityType: QueuedUpload['entityType'];
  entityId: string;
}

/**
 * The full upload path — exposed so the retry queue can re-fire a job
 * without going back through the public `renderDoc` dispatcher (which
 * would re-enqueue on failure and double-stack).
 *
 * Idempotent: if a Stride-auto-archived doc for this context already
 * exists in `public.documents`, returns early without re-uploading.
 */
export async function renderDocUpload(args: RenderDocUploadArgs): Promise<void> {
  const { templateKey, tokens, fileName, tenantId, entityType, entityId } = args;

  // De-dupe at the data layer before doing render/upload work.
  const existing = await findExistingAutoDoc(tenantId, entityType, entityId, fileName);
  if (existing) return;

  const template = await fetchTemplate(templateKey);
  if (!template) throw new Error(`Template ${templateKey} not found`);
  const html = applyTokens(template, tokens);

  const blob = await renderHtmlToPdfBlob(html, fileName);

  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const safeName = sanitizeName(`${fileName}.pdf`);
  const safeTenant = sanitizeTenantForPath(tenantId);
  const safeContext = sanitizeContextForPath(entityId);
  const storageKey = `${safeTenant}/${entityType}-${safeContext}/${ts}-${rand}-${safeName}`;

  const { error: upErr } = await supabase.storage.from(BUCKET).upload(storageKey, blob, {
    contentType: 'application/pdf',
    upsert: false,
  });
  if (upErr) throw new Error(`storage upload failed: ${upErr.message}`);

  const { error: insErr } = await supabase
    .from('documents')
    .insert({
      tenant_id: tenantId,
      context_type: entityType,
      context_id: entityId,
      storage_key: storageKey,
      file_name: safeName,
      file_size: blob.size,
      mime_type: 'application/pdf',
      uploaded_by: null,
      uploaded_by_name: 'Stride (auto-archive)',
    });

  if (insErr) {
    // Storage upload succeeded but row insert didn't — the blob is
    // orphaned. Best-effort cleanup; if THIS fails too, the storage row
    // sits there until the next auto-archive de-dupes it out (same
    // storage_key path will fail upsert:false, but the documents row
    // check guards us before we ever get here on the next run).
    try { await supabase.storage.from(BUCKET).remove([storageKey]); } catch { /* swallow */ }
    throw new Error(`documents insert failed: ${insErr.message}`);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export type DocAction = 'print' | 'download' | 'upload';

export interface RenderDocOptions {
  action: DocAction;
  /** Display name (no extension) used for the print window title and PDF filename. */
  fileName?: string;
  /** Required for `upload` — tenant (client spreadsheet) ID. */
  tenantId?: string;
  /** Required for `upload` — `documents.context_type`. */
  entityType?: QueuedUpload['entityType'];
  /** Required for `upload` — `documents.context_id`. */
  entityId?: string;
}

/**
 * Render a Stride document.
 *
 * @param templateKey  `email_templates.template_key` (e.g. `DOC_RECEIVING`)
 * @param tokens       `{{TOKEN}}` → value map; build via `buildXTokens` helpers
 * @param options      `action` (required) + per-action params
 *
 * For `upload`, failures get queued in localStorage and retried on next
 * app load / online event via `docUploadQueue` — `renderDoc` does NOT
 * throw on upload failure (auto-archive is best-effort; the user's
 * primary action — completion — already succeeded).
 */
export async function renderDoc(
  templateKey: string,
  tokens: Record<string, string>,
  options: RenderDocOptions,
): Promise<void> {
  const action = options.action;

  if (action === 'print') {
    const template = await fetchTemplate(templateKey);
    if (!template) {
      alert(`Template ${templateKey} not found in Supabase.`);
      return;
    }
    const html = applyTokens(template, tokens);
    openPrintWindow(html, options.fileName || templateKey);
    return;
  }

  if (action === 'download') {
    const template = await fetchTemplate(templateKey);
    if (!template) {
      alert(`Template ${templateKey} not found in Supabase.`);
      return;
    }
    const html = applyTokens(template, tokens);
    const fileName = options.fileName || templateKey;
    const blob = await renderHtmlToPdfBlob(html, fileName);
    triggerDownload(blob, fileName);
    return;
  }

  // action === 'upload'
  if (!options.tenantId || !options.entityType || !options.entityId || !options.fileName) {
    console.warn('[docRenderer] upload requires fileName + tenantId + entityType + entityId; skipping');
    return;
  }
  try {
    await renderDocUpload({
      templateKey,
      tokens,
      fileName: options.fileName,
      tenantId: options.tenantId,
      entityType: options.entityType,
      entityId: options.entityId,
    });
  } catch (err) {
    // Soft-fail: queue for retry. The completion call already succeeded
    // server-side, so surfacing an error to the user here would be more
    // confusing than helpful. The queue worker (booted from App shell)
    // will pick this up on the next app load or `online` event.
    console.warn('[docRenderer] upload failed, queuing for retry:', err);
    enqueueUpload({
      templateKey,
      tokens,
      fileName: options.fileName,
      tenantId: options.tenantId,
      entityType: options.entityType,
      entityId: options.entityId,
    });
  }
}

// Re-export token builders so callers can `import { renderDoc, buildXTokens } from '../../lib/docRenderer'`
// without juggling two import lines.
export {
  buildReceivingTokens,
  buildTaskTokens,
  buildRepairTokens,
  buildWillCallTokens,
} from './docTokens';

export type {
  TaskWorkOrderInput,
  RepairWorkOrderInput,
  WillCallReleaseInput,
  WillCallItemInput,
  ReceivingDocInput,
  ReceivingItemInput,
} from './docTokens';
