/**
 * invoicePdf.ts — generate an invoice PDF on the React side and upload
 * it to Supabase Storage. Replaces the optional Drive PDF flow.
 *
 * Session 93. Called from Billing.tsx after `postCreateInvoice` resolves
 * for each newly-committed invoice. Mirrors the InvoicePage.tsx layout
 * (letterhead, bill-to/terms/sidemarks, line items, totals, footer)
 * using jsPDF + jspdf-autotable for predictable multi-page output that
 * doesn't depend on browser rendering quirks.
 *
 * Storage path: `invoices/{tenant_id}/{invoice_no}.pdf`
 *
 * After upload we mint a 10-year signed URL (matches the resale-cert
 * convention) and return it; the caller PATCHes `billing.invoice_url`
 * for every row in the invoice so deeplinks resolve directly to the
 * archived PDF.
 */
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { supabase } from './supabase';

export interface InvoicePdfRow {
  date: string;
  svcCode: string;
  svcName: string;
  itemId: string;
  description: string;
  qty: number;
  rate: number;
  total: number;
  sidemark?: string;
}

export interface InvoicePdfClient {
  name: string;
  email?: string;
  paymentTerms?: string;
}

export interface InvoicePdfInput {
  invoiceNo: string;
  tenantId: string;
  invoiceDate: string;       // ISO or MM/DD/YYYY — formatter accepts both
  rows: InvoicePdfRow[];
  client: InvoicePdfClient;
}

const STRIDE_ORANGE: [number, number, number] = [232, 105, 42]; // #E8692A
const TEXT_DARK:     [number, number, number] = [31, 41, 55];   // #1F2937
const TEXT_MUTED:    [number, number, number] = [107, 114, 128]; // #6B7280
const BORDER_LIGHT:  [number, number, number] = [229, 231, 235]; // #E5E7EB

function fmtDate(s: string | undefined | null): string {
  if (!s) return '';
  // Accept ISO `YYYY-MM-DD` or already-formatted strings; pass through
  // anything we can't parse as a date.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${mm}/${dd}/${d.getFullYear()}`;
  }
  return s;
}

function fmtMoney(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  if (isNaN(v)) return '0.00';
  return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Build a single-invoice PDF as a Blob. Multi-page when line items overflow.
 *
 * Layout (mirrors InvoicePage.tsx):
 *   - Letterhead: "Stride Logistics" + Kent address + email · "INVOICE" + #/date right
 *   - Bill To / Payment Terms / Sidemarks row
 *   - Line item table (Date · Service · Item · Description · Qty · Rate · Total)
 *   - Totals (Subtotal · Total Due) right-aligned
 *   - Footer: "Thank you for your business" + tenant ref tag
 */
export function generateInvoicePdfBlob(input: InvoicePdfInput): Blob {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' }); // 612 × 792 pt
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 36;
  let y = 40;

  // ── Letterhead ──────────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(...TEXT_DARK);
  doc.text('Stride Logistics', marginX, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_MUTED);
  doc.text('Kent, WA', marginX, y + 14);
  doc.text('whse@stridenw.com', marginX, y + 26);

  // INVOICE block, right-aligned
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(24);
  doc.setTextColor(...STRIDE_ORANGE);
  doc.text('INVOICE', pageWidth - marginX, y, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...TEXT_DARK);
  doc.text(`#${input.invoiceNo}`, pageWidth - marginX, y + 16, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_MUTED);
  doc.text(`Date: ${fmtDate(input.invoiceDate)}`, pageWidth - marginX, y + 28, { align: 'right' });

  y += 56;

  // ── Bill To / Terms / Sidemarks ──────────────────────────────────────
  const sidemarks = Array.from(new Set(
    input.rows.map(r => r.sidemark).filter((s): s is string => !!s)
  )).sort();

  const colWidth = (pageWidth - marginX * 2) / 3;
  const drawLabelValue = (label: string, value: string, colIdx: number) => {
    const x = marginX + colIdx * colWidth;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(156, 163, 175); // #9CA3AF
    doc.text(label.toUpperCase(), x, y);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(11);
    doc.setTextColor(...TEXT_DARK);
    const lines = doc.splitTextToSize(value || '—', colWidth - 8);
    doc.text(lines, x, y + 14);
  };

  drawLabelValue('Bill To', input.client.name || 'Client', 0);
  if (input.client.email) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...TEXT_MUTED);
    doc.text(input.client.email, marginX, y + 28);
  }
  drawLabelValue('Payment Terms', input.client.paymentTerms || 'Net 30', 1);
  if (sidemarks.length > 0) {
    drawLabelValue(
      sidemarks.length === 1 ? 'Sidemark' : 'Sidemarks',
      sidemarks.join(', '),
      2,
    );
  }

  y += 56;

  // ── Line items table ─────────────────────────────────────────────────
  const sortedRows = [...input.rows].sort((a, b) => {
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    return 0;
  });

  const tableBody = sortedRows.map(r => [
    fmtDate(r.date),
    r.svcName || r.svcCode,
    r.itemId || '',
    r.description || '',
    String(r.qty ?? ''),
    `$${fmtMoney(r.rate)}`,
    `$${fmtMoney(r.total)}`,
  ]);

  autoTable(doc, {
    startY: y,
    head: [['Date', 'Service', 'Item', 'Description', 'Qty', 'Rate', 'Total']],
    body: tableBody,
    margin: { left: marginX, right: marginX },
    headStyles: {
      fillColor: [249, 250, 251], // #F9FAFB
      textColor: TEXT_DARK,
      fontStyle: 'bold',
      fontSize: 9,
      lineWidth: { bottom: 1.5 },
      lineColor: STRIDE_ORANGE,
    },
    bodyStyles: {
      fontSize: 9,
      textColor: TEXT_DARK,
      lineColor: BORDER_LIGHT,
      lineWidth: { bottom: 0.5 },
      cellPadding: { top: 5, right: 5, bottom: 5, left: 5 },
    },
    columnStyles: {
      0: { cellWidth: 60 },                              // Date
      1: { cellWidth: 80 },                              // Service
      2: { cellWidth: 70, textColor: TEXT_MUTED },       // Item
      3: { cellWidth: 'auto' },                          // Description (flex)
      4: { cellWidth: 30, halign: 'right' },             // Qty
      5: { cellWidth: 50, halign: 'right' },             // Rate
      6: { cellWidth: 60, halign: 'right', fontStyle: 'bold' }, // Total
    },
    didDrawPage: (data) => {
      // Track the cursor for the totals block below the final page's table.
      y = (data.cursor?.y ?? y) + 14;
    },
  });

  // ── Totals ───────────────────────────────────────────────────────────
  const subtotal = input.rows.reduce((sum, r) => sum + (Number(r.total) || 0), 0);
  const totalsX = pageWidth - marginX - 200;
  const totalsValueX = pageWidth - marginX;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...TEXT_MUTED);
  doc.text('Subtotal', totalsX, y);
  doc.setTextColor(...TEXT_DARK);
  doc.text(`$${fmtMoney(subtotal)}`, totalsValueX, y, { align: 'right' });

  // Orange divider
  y += 6;
  doc.setDrawColor(...STRIDE_ORANGE);
  doc.setLineWidth(1.5);
  doc.line(totalsX, y, totalsValueX, y);
  y += 14;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...TEXT_DARK);
  doc.text('Total Due', totalsX, y);
  doc.text(`$${fmtMoney(subtotal)}`, totalsValueX, y, { align: 'right' });

  // ── Footer ───────────────────────────────────────────────────────────
  const pageHeight = doc.internal.pageSize.getHeight();
  const footerY = pageHeight - 40;
  doc.setDrawColor(...BORDER_LIGHT);
  doc.setLineWidth(0.5);
  doc.line(marginX, footerY - 12, pageWidth - marginX, footerY - 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(156, 163, 175);
  doc.text(
    'Thank you for your business — Stride Logistics',
    pageWidth / 2,
    footerY,
    { align: 'center' },
  );
  if (input.tenantId) {
    doc.setFontSize(7);
    doc.text(
      `Ref: ${input.tenantId.slice(0, 12)}…`,
      pageWidth / 2,
      footerY + 10,
      { align: 'center' },
    );
  }

  return doc.output('blob');
}

/**
 * Upload an invoice PDF to the `invoices` storage bucket and return a
 * long-lived signed URL. Returns null on any failure (caller logs +
 * leaves the existing invoice_url alone).
 *
 * Path: `{tenantId}/{invoiceNo}.pdf` — `upsert: true` so retrying a
 * failed invoice doesn't duplicate or 409.
 */
export async function uploadInvoicePdf(
  tenantId: string,
  invoiceNo: string,
  blob: Blob,
): Promise<string | null> {
  if (!tenantId || !invoiceNo) return null;
  const path = `${tenantId}/${invoiceNo}.pdf`;

  const { error: upErr } = await supabase
    .storage
    .from('invoices')
    .upload(path, blob, {
      contentType: 'application/pdf',
      upsert: true,
      cacheControl: '3600',
    });
  if (upErr) {
    console.warn('[invoicePdf] upload failed', invoiceNo, upErr.message);
    return null;
  }

  // 10-year signed URL — same convention as resale-certs. Long-lived
  // because invoices are referenced from email links / printouts.
  const tenYearsSeconds = 60 * 60 * 24 * 365 * 10;
  const { data: signed, error: sigErr } = await supabase
    .storage
    .from('invoices')
    .createSignedUrl(path, tenYearsSeconds);
  if (sigErr || !signed) {
    console.warn('[invoicePdf] sign failed', invoiceNo, sigErr?.message);
    return null;
  }
  return signed.signedUrl;
}

/**
 * Patch every billing row of a given invoice with the new invoice_url.
 * Direct Supabase update — RLS scoped to staff/admin (the operator who
 * just created the invoice). The sheet's Invoice URL column is updated
 * by the GAS handler; this overrides the Supabase mirror so deep links
 * from the React app land on the archived PDF instead of the live
 * React route.
 */
export async function patchInvoiceUrl(
  tenantId: string,
  invoiceNo: string,
  invoiceUrl: string,
): Promise<boolean> {
  if (!tenantId || !invoiceNo || !invoiceUrl) return false;
  const { error } = await supabase
    .from('billing')
    .update({ invoice_url: invoiceUrl })
    .eq('tenant_id', tenantId)
    .eq('invoice_no', invoiceNo);
  if (error) {
    console.warn('[invoicePdf] patch invoice_url failed', invoiceNo, error.message);
    return false;
  }
  return true;
}
