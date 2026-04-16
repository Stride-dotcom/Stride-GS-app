import jsPDF from 'jspdf';
import ExcelJS from 'exceljs';
import { addAoaSheet, setColumnWidths, downloadWorkbook } from '@/lib/excelUtils';
import { Quote, QuoteClassLine, QuoteSelectedService } from './types';
import { formatCurrency } from './calculator';

export interface QuotePdfData {
  // Quote details
  quoteNumber: string;
  quoteDate: string;
  expirationDate?: string;
  estimatedStorageDays: number;
  status: string;

  // Company (tenant) info
  companyName: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyLogo?: string;
  companyWebsite?: string;

  // Brand color (hex string, e.g. "#FD5A2A")
  brandColor?: string;

  // Account (customer) info
  accountName: string;
  accountCode?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;

  // Class lines
  classLines: {
    className: string;
    description?: string;
    quantity: number;
  }[];

  // Service lines
  serviceLines: {
    serviceName: string;
    category: string;
    className?: string;
    billingUnit: string;
    rate: number;
    quantity: number;
    lineTotal: number;
    isTaxable: boolean;
  }[];

  // Totals
  subtotal: number;
  discountType?: string;
  discountValue?: number;
  discountAmount?: number;
  taxRate?: number;
  taxAmount?: number;
  coverageType?: string;
  coverageCost?: number;
  grandTotal: number;
  currency: string;

  // Notes
  notes?: string;
}

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Parse a hex color string to RGB tuple
 * Supports #RGB, #RRGGBB formats. Falls back to default orange.
 */
function parseHexColor(hex: string | undefined, fallback: [number, number, number] = [220, 88, 42]): [number, number, number] {
  if (!hex) return fallback;
  const clean = hex.replace('#', '');
  let r: number, g: number, b: number;

  if (clean.length === 3) {
    r = parseInt(clean[0] + clean[0], 16);
    g = parseInt(clean[1] + clean[1], 16);
    b = parseInt(clean[2] + clean[2], 16);
  } else if (clean.length === 6) {
    r = parseInt(clean.substring(0, 2), 16);
    g = parseInt(clean.substring(2, 4), 16);
    b = parseInt(clean.substring(4, 6), 16);
  } else {
    return fallback;
  }

  if (isNaN(r) || isNaN(g) || isNaN(b)) return fallback;
  return [r, g, b];
}

/**
 * Generate a professional PDF quote
 */
export async function generateQuotePdf(data: QuotePdfData): Promise<jsPDF> {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // Colors - use tenant brand color with fallback to Solar Flare orange
  const primaryColor = parseHexColor(data.brandColor);
  const darkGray: [number, number, number] = [51, 51, 51];
  const lightGray: [number, number, number] = [128, 128, 128];
  const veryLightGray: [number, number, number] = [245, 245, 245];

  // Helper functions
  const setFont = (size: number, style: 'normal' | 'bold' = 'normal') => {
    doc.setFontSize(size);
    doc.setFont('helvetica', style);
  };

  // ============ HEADER SECTION ============

  // Logo (if provided) - smart aspect-ratio-aware sizing
  let companyNameX = margin;
  if (data.companyLogo) {
    try {
      const logoDims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const maxW = 20;
          const maxH = 16;
          const ratio = img.naturalWidth / img.naturalHeight;
          let w: number, h: number;
          if (ratio > maxW / maxH) {
            w = maxW; h = maxW / ratio;
          } else {
            h = maxH; w = maxH * ratio;
          }
          resolve({ w, h });
        };
        img.onerror = () => reject(new Error('Logo failed to load'));
        img.src = data.companyLogo!;
      });
      doc.addImage(data.companyLogo, 'JPEG', margin, y - 2, logoDims.w, logoDims.h);
      companyNameX = margin + logoDims.w + 4;
    } catch {
      // Logo failed to load, skip it
    }
  }

  // Company name (16pt bold) side-by-side with logo
  doc.setTextColor(...darkGray);
  setFont(16, 'bold');
  doc.text(data.companyName, companyNameX, y + 4);
  // "WMS" badge in brand color
  const companyNameWidth = doc.getTextWidth(data.companyName);
  doc.setTextColor(...primaryColor);
  setFont(16, 'bold');
  doc.text('WMS', companyNameX + companyNameWidth + 3, y + 4);
  y += 10;

  // Company contact info (smaller, gray)
  doc.setTextColor(...lightGray);
  setFont(9, 'normal');
  if (data.companyAddress) {
    doc.text(data.companyAddress, margin, y);
    y += 5;
  }
  const contactLine: string[] = [];
  if (data.companyPhone) contactLine.push(data.companyPhone);
  if (data.companyEmail) contactLine.push(data.companyEmail);
  if (contactLine.length > 0) {
    doc.text(contactLine.join(' | '), margin, y);
    y += 5;
  }

  // QUOTE title on the right
  doc.setTextColor(...primaryColor);
  setFont(20, 'bold');
  doc.text('QUOTE', pageWidth - margin, margin + 3, { align: 'right' });

  // Quote number below
  doc.setTextColor(...darkGray);
  setFont(9, 'normal');
  doc.text(`#${data.quoteNumber}`, pageWidth - margin, margin + 10, { align: 'right' });

  y += 8;

  // ============ DIVIDER LINE ============
  doc.setDrawColor(...primaryColor);
  doc.setLineWidth(1);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  // ============ PREPARED FOR & QUOTE DETAILS ============

  const leftColX = margin;
  const rightColX = pageWidth / 2 + 10;
  let leftY = y;
  let rightY = y;

  // Prepared For header
  doc.setTextColor(...lightGray);
  setFont(9, 'bold');
  doc.text('PREPARED FOR', leftColX, leftY);
  leftY += 6;

  // Customer name
  doc.setTextColor(...darkGray);
  setFont(11, 'bold');
  doc.text(data.accountName, leftColX, leftY);
  leftY += 6;

  // Account code
  if (data.accountCode) {
    setFont(9, 'normal');
    doc.setTextColor(...lightGray);
    doc.text(`Account: ${data.accountCode}`, leftColX, leftY);
    leftY += 5;
  }

  // Contact info
  doc.setTextColor(...darkGray);
  setFont(9, 'normal');
  if (data.contactName) {
    doc.text(`Contact: ${data.contactName}`, leftColX, leftY);
    leftY += 5;
  }
  if (data.contactEmail) {
    doc.text(data.contactEmail, leftColX, leftY);
    leftY += 5;
  }
  if (data.contactPhone) {
    doc.text(data.contactPhone, leftColX, leftY);
    leftY += 5;
  }

  // Quote Details (right side)
  doc.setTextColor(...lightGray);
  setFont(9, 'bold');
  doc.text('QUOTE DETAILS', rightColX, rightY);
  rightY += 6;

  // Quote info
  const infoItems = [
    { label: 'Quote Date:', value: formatDate(data.quoteDate) },
    { label: 'Valid Until:', value: data.expirationDate ? formatDate(data.expirationDate) : 'N/A' },
    { label: 'Storage Days:', value: data.estimatedStorageDays.toString() },
    { label: 'Status:', value: data.status.charAt(0).toUpperCase() + data.status.slice(1) },
  ];

  doc.setTextColor(...darkGray);
  setFont(9, 'normal');
  for (const item of infoItems) {
    doc.setFont('helvetica', 'bold');
    doc.text(item.label, rightColX, rightY);
    doc.setFont('helvetica', 'normal');
    doc.text(item.value, rightColX + 35, rightY);
    rightY += 5;
  }

  y = Math.max(leftY, rightY) + 15;

  // ============ CLASS QUANTITIES ============

  if (data.classLines.length > 0) {
    doc.setTextColor(...darkGray);
    setFont(11, 'bold');
    doc.text('Item Quantities by Size Class', margin, y);
    y += 8;

    // Table header background
    doc.setFillColor(...veryLightGray);
    doc.rect(margin, y - 5, contentWidth, 10, 'F');

    // Table headers
    doc.setTextColor(...darkGray);
    setFont(9, 'bold');
    doc.text('Size Class', margin + 2, y);
    doc.text('Description', margin + 50, y);
    doc.text('Quantity', pageWidth - margin - 2, y, { align: 'right' });
    y += 8;

    // Table rows
    setFont(9, 'normal');
    let totalItems = 0;
    for (const line of data.classLines) {
      doc.text(line.className, margin + 2, y);
      doc.text(line.description || '-', margin + 50, y);
      doc.text(line.quantity.toString(), pageWidth - margin - 2, y, { align: 'right' });
      totalItems += line.quantity;
      y += 6;
    }

    // Total row
    doc.setDrawColor(220, 220, 220);
    doc.line(margin, y, pageWidth - margin, y);
    y += 5;
    setFont(9, 'bold');
    doc.text('Total Items:', margin + 2, y);
    doc.text(totalItems.toString(), pageWidth - margin - 2, y, { align: 'right' });
    y += 15;
  }

  // ============ SERVICES TABLE ============

  doc.setTextColor(...darkGray);
  setFont(11, 'bold');
  doc.text('Services', margin, y);
  y += 8;

  // Table header background
  doc.setFillColor(...veryLightGray);
  doc.rect(margin, y - 5, contentWidth, 10, 'F');

  // Table headers
  doc.setTextColor(...darkGray);
  setFont(9, 'bold');

  const colWidths = {
    service: 45,
    class: 30,
    rate: 35,
    qty: 20,
    total: contentWidth - 45 - 30 - 35 - 20,
  };

  let tableX = margin;
  doc.text('Service', tableX + 2, y);
  tableX += colWidths.service;
  doc.text('Class', tableX + 2, y);
  tableX += colWidths.class;
  doc.text('Rate', tableX + colWidths.rate - 2, y, { align: 'right' });
  tableX += colWidths.rate;
  doc.text('Qty', tableX + colWidths.qty - 2, y, { align: 'right' });
  tableX += colWidths.qty;
  doc.text('Total', tableX + colWidths.total - 2, y, { align: 'right' });
  y += 8;

  // Table rows
  setFont(9, 'normal');
  let rowCount = 0;
  for (const line of data.serviceLines) {
    // Check if we need a new page
    if (y > pageHeight - 25) {
      doc.addPage();
      y = margin;

      // Re-render table column headers on new page
      doc.setFillColor(...veryLightGray);
      doc.rect(margin, y - 5, contentWidth, 10, 'F');
      doc.setTextColor(...darkGray);
      setFont(9, 'bold');
      let hdrX = margin;
      doc.text('Service', hdrX + 2, y);
      hdrX += colWidths.service;
      doc.text('Class', hdrX + 2, y);
      hdrX += colWidths.class;
      doc.text('Rate', hdrX + colWidths.rate - 2, y, { align: 'right' });
      hdrX += colWidths.rate;
      doc.text('Qty', hdrX + colWidths.qty - 2, y, { align: 'right' });
      hdrX += colWidths.qty;
      doc.text('Total', hdrX + colWidths.total - 2, y, { align: 'right' });
      y += 8;
      setFont(9, 'normal');
    }

    // Alternating row background
    if (rowCount % 2 === 1) {
      doc.setFillColor(250, 250, 250);
      doc.rect(margin, y - 4, contentWidth, 8, 'F');
    }

    tableX = margin;
    doc.setTextColor(...darkGray);

    // Service name (truncate if needed)
    const serviceName =
      line.serviceName.length > 25 ? line.serviceName.substring(0, 22) + '...' : line.serviceName;
    doc.text(serviceName, tableX + 2, y);
    tableX += colWidths.service;

    // Class
    doc.text(line.className || '-', tableX + 2, y);
    tableX += colWidths.class;

    // Rate (just the dollar amount, no billing unit)
    const rateText = formatCurrency(line.rate);
    doc.text(rateText, tableX + colWidths.rate - 2, y, { align: 'right' });
    tableX += colWidths.rate;

    // Quantity
    doc.text(line.quantity.toString(), tableX + colWidths.qty - 2, y, { align: 'right' });
    tableX += colWidths.qty;

    // Line total
    doc.setFont('helvetica', 'bold');
    doc.text(formatCurrency(line.lineTotal), tableX + colWidths.total - 2, y, { align: 'right' });
    doc.setFont('helvetica', 'normal');

    y += 7;
    rowCount++;
  }

  // Table bottom border
  y += 2;
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 15;

  // ============ TOTALS SECTION ============

  const totalsX = pageWidth - margin - 60;
  const totalsValueX = pageWidth - margin;

  // Subtotal
  setFont(10, 'normal');
  doc.setTextColor(...lightGray);
  doc.text('Subtotal:', totalsX, y, { align: 'right' });
  doc.setTextColor(...darkGray);
  doc.text(formatCurrency(data.subtotal, data.currency), totalsValueX, y, { align: 'right' });
  y += 6;

  // Discount (if applicable)
  if (data.discountAmount && data.discountAmount > 0) {
    doc.setTextColor(...lightGray);
    const discountLabel =
      data.discountType === 'percentage'
        ? `Discount (${data.discountValue}%):`
        : 'Discount:';
    doc.text(discountLabel, totalsX, y, { align: 'right' });
    doc.setTextColor(34, 197, 94); // Green
    doc.text(`-${formatCurrency(data.discountAmount, data.currency)}`, totalsValueX, y, {
      align: 'right',
    });
    y += 6;
  }

  // Tax (if applicable)
  if (data.taxAmount && data.taxAmount > 0) {
    doc.setTextColor(...lightGray);
    doc.text(`Tax (${((data.taxRate || 0) * 100).toFixed(1)}%):`, totalsX, y, { align: 'right' });
    doc.setTextColor(...darkGray);
    doc.text(formatCurrency(data.taxAmount, data.currency), totalsValueX, y, { align: 'right' });
    y += 6;
  }

  // Valuation Coverage (if applicable)
  if (data.coverageCost && data.coverageCost > 0) {
    doc.setTextColor(...lightGray);
    const coverageLabel = data.coverageType
      ? `Valuation Coverage (${data.coverageType}):`
      : 'Valuation Coverage:';
    doc.text(coverageLabel, totalsX, y, { align: 'right' });
    doc.setTextColor(...darkGray);
    doc.text(formatCurrency(data.coverageCost, data.currency), totalsValueX, y, { align: 'right' });
    y += 6;
  }

  // Total line
  y += 2;
  doc.setDrawColor(...primaryColor);
  doc.setLineWidth(1);
  doc.line(totalsX - 20, y, pageWidth - margin, y);
  y += 8;

  // Grand total (large, bold)
  setFont(14, 'bold');
  doc.setTextColor(...primaryColor);
  doc.text('Grand Total:', totalsX, y, { align: 'right' });
  doc.setTextColor(...darkGray);
  doc.text(formatCurrency(data.grandTotal, data.currency), totalsValueX, y, { align: 'right' });

  y += 20;

  // ============ NOTES ============

  if (data.notes) {
    // Check if we need a new page
    if (y > doc.internal.pageSize.height - 40) {
      doc.addPage();
      y = margin;
    }

    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageWidth - margin, y);
    y += 10;

    doc.setTextColor(...lightGray);
    setFont(9, 'bold');
    doc.text('Notes:', margin, y);
    y += 5;
    doc.setTextColor(...darkGray);
    setFont(9, 'normal');
    const noteLines = doc.splitTextToSize(data.notes, contentWidth);
    doc.text(noteLines, margin, y);
  }

  // ============ FOOTER ============

  const footerY = pageHeight - 12;
  doc.setTextColor(...lightGray);
  setFont(7, 'normal');
  doc.text(
    'This quote is valid for 30 days unless otherwise specified.',
    pageWidth / 2,
    footerY,
    { align: 'center' }
  );
  doc.text('Thank you for your business!', pageWidth / 2, footerY + 4, { align: 'center' });

  return doc;
}

/**
 * Download the PDF quote
 */
export async function downloadQuotePdf(data: QuotePdfData): Promise<void> {
  const doc = await generateQuotePdf(data);
  doc.save(`Quote_${data.quoteNumber}.pdf`);
}

/**
 * Open PDF in new tab for printing
 */
export async function printQuotePdf(data: QuotePdfData): Promise<void> {
  const doc = await generateQuotePdf(data);
  const pdfUrl = doc.output('bloburl');
  window.open(pdfUrl.toString(), '_blank');
}

/**
 * Export quote to Excel (single sheet mirroring PDF layout)
 */
export async function exportQuoteToExcel(data: QuotePdfData): Promise<void> {
  const wb = new ExcelJS.Workbook();
  const rows: (string | number)[][] = [];

  // ============ HEADER ============
  rows.push([`Quote #${data.quoteNumber}`]);
  rows.push([`Quote Date: ${formatDate(data.quoteDate)}`, '', `Valid Until: ${data.expirationDate ? formatDate(data.expirationDate) : 'N/A'}`]);
  rows.push([`Status: ${data.status.charAt(0).toUpperCase() + data.status.slice(1)}`, '', `Storage Days: ${data.estimatedStorageDays}`]);
  rows.push([]);

  // Prepared For / From
  rows.push([`Prepared For: ${data.accountName}`, '', `From: ${data.companyName}`]);
  if (data.accountCode) {
    rows.push([`Account: ${data.accountCode}`, '', data.companyAddress || '']);
  }
  if (data.contactName) {
    rows.push([`Contact: ${data.contactName}`, '', data.companyPhone || '']);
  }
  if (data.contactEmail) {
    rows.push([data.contactEmail, '', data.companyEmail || '']);
  }
  rows.push([]);

  // ============ CLASS QUANTITIES ============
  if (data.classLines.length > 0) {
    rows.push(['ITEM QUANTITIES BY SIZE CLASS']);
    rows.push(['Size Class', 'Description', 'Quantity']);
    let totalItems = 0;
    for (const line of data.classLines) {
      rows.push([line.className, line.description || '', line.quantity]);
      totalItems += line.quantity;
    }
    rows.push(['', 'Total Items:', totalItems]);
    rows.push([]);
  }

  // ============ SERVICES ============
  rows.push(['SERVICES']);
  rows.push(['Service', 'Category', 'Class', 'Rate', 'Qty', 'Total']);
  for (const line of data.serviceLines) {
    rows.push([
      line.serviceName,
      line.category,
      line.className || '-',
      line.rate,
      line.quantity,
      line.lineTotal,
    ]);
  }
  rows.push([]);

  // ============ TOTALS ============
  rows.push(['', '', '', '', 'Subtotal:', data.subtotal]);
  if (data.discountAmount && data.discountAmount > 0) {
    const discountLabel = data.discountType === 'percentage'
      ? `Discount (${data.discountValue}%):`
      : 'Discount:';
    rows.push(['', '', '', '', discountLabel, -data.discountAmount]);
  }
  if (data.taxAmount && data.taxAmount > 0) {
    rows.push(['', '', '', '', `Tax (${((data.taxRate || 0) * 100).toFixed(1)}%):`, data.taxAmount]);
  }
  if (data.coverageCost && data.coverageCost > 0) {
    const coverageLabel = data.coverageType
      ? `Valuation Coverage (${data.coverageType}):`
      : 'Valuation Coverage:';
    rows.push(['', '', '', '', coverageLabel, data.coverageCost]);
  }
  rows.push(['', '', '', '', 'Grand Total:', data.grandTotal]);
  rows.push([]);

  // ============ NOTES ============
  if (data.notes) {
    rows.push([`Notes: ${data.notes}`]);
  }

  const sheet = addAoaSheet(wb, rows, 'Quote');

  // Set column widths
  setColumnWidths(sheet, [20, 18, 15, 12, 8, 14]);

  await downloadWorkbook(wb, `Quote_${data.quoteNumber}.xlsx`);
}

/**
 * Transform Quote data to QuotePdfData format
 */
export function transformQuoteToPdfData(
  quote: Quote & {
    account?: { account_name: string; account_code?: string; primary_contact_name?: string; primary_contact_email?: string; primary_contact_phone?: string };
    tenant?: { name: string; address?: string; phone?: string; email?: string };
    quote_class_lines?: (QuoteClassLine & { quote_class?: { name: string; description?: string } })[];
    quote_selected_services?: (QuoteSelectedService & {
      quote_service?: { name: string; category: string; billing_unit: string };
      quote_class?: { name: string };
    })[];
  },
  overrides?: {
    serviceLines?: QuotePdfData['serviceLines'];
    brandColor?: string;
    companyLogo?: string;
    companyWebsite?: string;
    companyName?: string;
  }
): QuotePdfData {
  return {
    quoteNumber: quote.quote_number,
    quoteDate: quote.created_at,
    expirationDate: quote.expiration_date || undefined,
    estimatedStorageDays: quote.storage_days || 0,
    status: quote.status,

    companyName: overrides?.companyName || quote.tenant?.name || 'Your Company',
    companyAddress: quote.tenant?.address,
    companyPhone: quote.tenant?.phone,
    companyEmail: quote.tenant?.email,
    companyLogo: overrides?.companyLogo,
    companyWebsite: overrides?.companyWebsite,
    brandColor: overrides?.brandColor,

    accountName: quote.account?.account_name || 'Unknown Account',
    accountCode: quote.account?.account_code,
    contactName: quote.account?.primary_contact_name,
    contactEmail: quote.account?.primary_contact_email,
    contactPhone: quote.account?.primary_contact_phone,

    classLines: (quote.quote_class_lines || []).map((line) => ({
      className: line.quote_class?.name || 'Unknown',
      description: line.quote_class?.description,
      quantity: line.qty,
    })),

    // Use overrides.serviceLines if provided (built from calculation engine),
    // otherwise fall back to quote_selected_services mapping
    serviceLines: overrides?.serviceLines || (quote.quote_selected_services || []).map((service) => ({
      serviceName: service.quote_service?.name || 'Unknown',
      category: service.quote_service?.category || '',
      className: service.quote_class?.name,
      billingUnit: service.quote_service?.billing_unit || 'flat',
      rate: service.applied_rate_amount || 0,
      quantity: service.computed_billable_qty || 1,
      lineTotal: service.line_total,
      isTaxable: true,
    })),

    subtotal: quote.subtotal_before_discounts || 0,
    discountType: quote.quote_discount_type || undefined,
    discountValue: quote.quote_discount_value || undefined,
    discountAmount: (quote.subtotal_before_discounts || 0) - (quote.subtotal_after_discounts || 0),
    taxRate: quote.tax_rate_percent || undefined,
    taxAmount: quote.tax_amount || undefined,
    coverageType: quote.coverage_type || undefined,
    coverageCost: quote.coverage_cost || undefined,
    grandTotal: quote.grand_total || 0,
    currency: quote.currency || 'USD',

    notes: quote.notes || undefined,
  };
}
