/**
 * invoiceBackfill.ts — one-time/admin backfill of invoice PDFs to Supabase
 * Storage for historical invoices.
 *
 * PDF rendering lives in the browser (jsPDF, see invoicePdf.ts), so the
 * backfill runs from an admin's authenticated React session rather than a
 * server cron: it finds invoice_tracking rows with no pdf_path, regenerates
 * each PDF from the `billing` rows, uploads it to `invoices/{tenant}/{no}.pdf`,
 * then patches invoice_tracking.pdf_path + billing.invoice_url.
 *
 * RLS: requires admin/staff (storage write + invoice_tracking read-all are
 * staff-gated). A client session would only see its own rows and couldn't
 * write — the Invoices page only surfaces the backfill button to admins.
 *
 * Idempotent: skips invoices that already have a pdf_path; uploads use
 * upsert:true so a re-run after a partial failure overwrites cleanly.
 */
import { supabase } from './supabase';
import {
  generateInvoicePdfBlob,
  uploadInvoicePdf,
  patchInvoiceUrl,
  patchInvoiceTrackingPdf,
  invoiceStoragePath,
  type InvoicePdfClient,
  type InvoicePdfRow,
} from './invoicePdf';

export interface BackfillProgress {
  total: number;
  done: number;
  succeeded: number;
  failed: number;
  current?: string;
}

export interface BackfillResult {
  total: number;
  succeeded: number;
  failed: number;
  failures: Array<{ invoiceNo: string; reason: string }>;
}

interface TrackingRow {
  invoice_no: string;
  tenant_id: string;
  client_name: string | null;
  invoice_date: string | null;
}

// Cache client info per tenant so a batch of one client's invoices makes one
// clients lookup, not N.
async function makeClientFetcher() {
  const cache: Record<string, InvoicePdfClient> = {};
  return async (tenantId: string): Promise<InvoicePdfClient> => {
    if (cache[tenantId]) return cache[tenantId];
    let info: InvoicePdfClient = { name: '', paymentTerms: 'Net 30', email: '' };
    try {
      const { data } = await supabase
        .from('clients')
        .select('name, payment_terms, email')
        .eq('spreadsheet_id', tenantId)
        .maybeSingle();
      if (data) {
        const d = data as Record<string, unknown>;
        info = {
          name: String(d.name || ''),
          paymentTerms: String(d.payment_terms || 'Net 30'),
          email: String(d.email || ''),
        };
      }
    } catch { /* fall through with defaults */ }
    cache[tenantId] = info;
    return info;
  };
}

async function fetchInvoiceRows(invoiceNo: string, tenantId: string): Promise<InvoicePdfRow[]> {
  const { data, error } = await supabase
    .from('billing')
    .select('date, svc_code, svc_name, item_id, description, qty, rate, total, sidemark')
    .eq('invoice_no', invoiceNo)
    .eq('tenant_id', tenantId);
  if (error) throw new Error(error.message);
  return (data as Record<string, unknown>[] | null ?? []).map((r) => ({
    date: String(r.date || ''),
    svcCode: String(r.svc_code || ''),
    svcName: String(r.svc_name || ''),
    itemId: String(r.item_id || ''),
    description: String(r.description || ''),
    qty: Number(r.qty) || 0,
    rate: Number(r.rate) || 0,
    total: Number(r.total) || 0,
    sidemark: String(r.sidemark || '') || undefined,
  }));
}

/**
 * Count invoice_tracking rows still missing a PDF — drives the admin button's
 * "Backfill N missing PDFs" label and lets us hide it when there's nothing to do.
 */
export async function countInvoicesMissingPdf(): Promise<number> {
  const { count, error } = await supabase
    .from('invoice_tracking')
    .select('invoice_no', { count: 'exact', head: true })
    .is('pdf_path', null);
  if (error) {
    console.warn('[invoiceBackfill] count failed', error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * Generate + upload PDFs for every invoice_tracking row missing a pdf_path.
 * Concurrency 3 mirrors the create-invoice batch. onProgress fires after each
 * invoice so the caller can render a progress bar.
 */
export async function backfillInvoicePdfs(
  onProgress?: (p: BackfillProgress) => void,
): Promise<BackfillResult> {
  const { data, error } = await supabase
    .from('invoice_tracking')
    .select('invoice_no, tenant_id, client_name, invoice_date')
    .is('pdf_path', null)
    .order('invoice_date', { ascending: false });
  if (error) throw new Error(`Failed to list invoices: ${error.message}`);

  const pending = (data as TrackingRow[] | null ?? []).filter(r => r.invoice_no && r.tenant_id);
  const result: BackfillResult = {
    total: pending.length,
    succeeded: 0,
    failed: 0,
    failures: [],
  };
  if (pending.length === 0) {
    onProgress?.({ total: 0, done: 0, succeeded: 0, failed: 0 });
    return result;
  }

  const fetchClient = await makeClientFetcher();
  const queue = [...pending];
  let done = 0;

  const worker = async () => {
    while (queue.length > 0) {
      const row = queue.shift();
      if (!row) break;
      try {
        const rows = await fetchInvoiceRows(row.invoice_no, row.tenant_id);
        if (rows.length === 0) {
          throw new Error('no billing rows found for invoice (voided or reissued?)');
        }
        const client = await fetchClient(row.tenant_id);
        const blob = generateInvoicePdfBlob({
          invoiceNo: row.invoice_no,
          tenantId: row.tenant_id,
          invoiceDate: row.invoice_date || '',
          client: { name: client.name || row.client_name || '', email: client.email, paymentTerms: client.paymentTerms },
          rows,
        });
        const url = await uploadInvoicePdf(row.tenant_id, row.invoice_no, blob);
        if (!url) throw new Error('storage upload failed');
        await patchInvoiceUrl(row.tenant_id, row.invoice_no, url);
        const patched = await patchInvoiceTrackingPdf(
          row.invoice_no,
          invoiceStoragePath(row.tenant_id, row.invoice_no),
        );
        if (!patched) throw new Error('invoice_tracking.pdf_path update failed');
        result.succeeded++;
      } catch (e) {
        result.failed++;
        result.failures.push({
          invoiceNo: row.invoice_no,
          reason: e instanceof Error ? e.message : String(e),
        });
      } finally {
        done++;
        onProgress?.({
          total: result.total,
          done,
          succeeded: result.succeeded,
          failed: result.failed,
          current: row.invoice_no,
        });
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(3, queue.length) }).map(() => worker()),
  );
  return result;
}
