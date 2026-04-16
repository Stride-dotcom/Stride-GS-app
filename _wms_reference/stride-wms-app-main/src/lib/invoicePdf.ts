import jsPDF from 'jspdf';

export interface InvoicePdfData {
  // Invoice details
  invoiceNumber: string;
  invoiceDate: string;
  dueDate?: string;
  periodStart: string;
  periodEnd: string;
  invoiceType: string;

  // Company (tenant) info
  companyName: string;
  companyAddress?: string;
  companyPhone?: string;
  companyEmail?: string;
  companyWebsite?: string;
  companyLogo?: string;

  // Brand color (hex string, e.g. "#FD5A2A")
  brandColor?: string;

  // Account (customer) info
  accountName: string;
  accountCode: string;
  billingContactName?: string;
  billingContactEmail?: string;
  billingAddress?: string;
  billingCity?: string;
  billingState?: string;
  billingPostalCode?: string;
  billingCountry?: string;

  // Sidemark (if applicable)
  sidemarkName?: string;

  // Line items
  lines: InvoiceLineItem[];

  // Totals
  subtotal: number;
  taxRate?: number;
  taxAmount?: number;
  total: number;

  // Notes
  notes?: string;
  paymentTerms?: string;
}

export interface InvoiceLineItem {
  serviceCode?: string;
  description?: string;
  quantity: number;
  unitRate: number;
  lineTotal: number;
  // Legacy fields for backwards compatibility
  date?: string;
  sidemark?: string;
  rate?: number;
  total?: number;
}

/**
 * Parse a hex color string to RGB tuple
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
 * Generate a professional PDF invoice
 */
export async function generateInvoicePdf(data: InvoicePdfData): Promise<jsPDF> {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // Colors - use tenant brand color with fallback to orange
  const primaryColor = parseHexColor(data.brandColor);
  const darkGray: [number, number, number] = [51, 51, 51];
  const lightGray: [number, number, number] = [128, 128, 128];
  const veryLightGray: [number, number, number] = [245, 245, 245];

  // Helper functions
  const setFont = (size: number, style: 'normal' | 'bold' = 'normal') => {
    doc.setFontSize(size);
    doc.setFont('helvetica', style);
  };

  const addText = (text: string, x: number, currentY: number, options?: { align?: 'left' | 'center' | 'right'; maxWidth?: number }) => {
    if (options?.maxWidth) {
      const lines = doc.splitTextToSize(text, options.maxWidth);
      doc.text(lines, x, currentY, { align: options?.align || 'left' });
      return currentY + (lines.length * 5);
    }
    doc.text(text, x, currentY, { align: options?.align || 'left' });
    return currentY + 5;
  };

  // Column widths for table (used in header rendering on new pages too)
  const colWidths = {
    service: 35,
    description: 70,
    qty: 20,
    rate: 25,
    total: contentWidth - 35 - 70 - 20 - 25,
  };

  const renderTableHeaders = (startY: number): number => {
    doc.setFillColor(...veryLightGray);
    doc.rect(margin, startY - 5, contentWidth, 10, 'F');
    doc.setTextColor(...darkGray);
    setFont(9, 'bold');
    let tableX = margin;
    doc.text('Service', tableX + 2, startY);
    tableX += colWidths.service;
    doc.text('Description', tableX + 2, startY);
    tableX += colWidths.description;
    doc.text('Qty', tableX + colWidths.qty - 2, startY, { align: 'right' });
    tableX += colWidths.qty;
    doc.text('Rate', tableX + colWidths.rate - 2, startY, { align: 'right' });
    tableX += colWidths.rate;
    doc.text('Total', tableX + colWidths.total - 2, startY, { align: 'right' });
    return startY + 8;
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
    y = addText(data.companyAddress, margin, y);
  }
  const contactLine: string[] = [];
  if (data.companyPhone) contactLine.push(data.companyPhone);
  if (data.companyEmail) contactLine.push(data.companyEmail);
  if (contactLine.length > 0) {
    y = addText(contactLine.join(' | '), margin, y);
  }
  if (data.companyWebsite) {
    y = addText(data.companyWebsite, margin, y);
  }

  // INVOICE title on the right
  doc.setTextColor(...primaryColor);
  setFont(20, 'bold');
  doc.text('INVOICE', pageWidth - margin, margin + 3, { align: 'right' });

  // Invoice number below
  doc.setTextColor(...darkGray);
  setFont(9, 'normal');
  doc.text(`#${data.invoiceNumber}`, pageWidth - margin, margin + 10, { align: 'right' });

  y += 4;

  // ============ DIVIDER LINE ============
  doc.setDrawColor(...primaryColor);
  doc.setLineWidth(1);
  doc.line(margin, y, pageWidth - margin, y);
  y += 6;

  // ============ BILLING INFO SECTION ============

  // Bill To (left side)
  const leftColX = margin;
  const rightColX = pageWidth / 2 + 10;
  let leftY = y;
  let rightY = y;

  // Bill To header
  doc.setTextColor(...lightGray);
  setFont(9, 'bold');
  doc.text('BILL TO', leftColX, leftY);
  leftY += 6;

  // Customer name
  doc.setTextColor(...darkGray);
  setFont(11, 'bold');
  leftY = addText(data.accountName, leftColX, leftY);

  // Account code
  setFont(9, 'normal');
  doc.setTextColor(...lightGray);
  leftY = addText(`Account: ${data.accountCode}`, leftColX, leftY);

  // Billing contact
  doc.setTextColor(...darkGray);
  setFont(9, 'normal');
  if (data.billingContactName) {
    leftY = addText(`Attn: ${data.billingContactName}`, leftColX, leftY);
  }

  // Billing address
  if (data.billingAddress) {
    leftY = addText(data.billingAddress, leftColX, leftY);
  }
  const cityStateZip: string[] = [];
  if (data.billingCity) cityStateZip.push(data.billingCity);
  if (data.billingState) cityStateZip.push(data.billingState);
  if (data.billingPostalCode) cityStateZip.push(data.billingPostalCode);
  if (cityStateZip.length > 0) {
    leftY = addText(cityStateZip.join(', '), leftColX, leftY);
  }
  if (data.billingCountry && data.billingCountry !== 'USA' && data.billingCountry !== 'US') {
    leftY = addText(data.billingCountry, leftColX, leftY);
  }

  // Sidemark (if applicable)
  if (data.sidemarkName) {
    leftY += 3;
    doc.setTextColor(...primaryColor);
    setFont(9, 'bold');
    leftY = addText(`Sidemark: ${data.sidemarkName}`, leftColX, leftY);
  }

  // Invoice Details (right side)
  doc.setTextColor(...lightGray);
  setFont(9, 'bold');
  doc.text('INVOICE DETAILS', rightColX, rightY);
  rightY += 6;

  // Invoice info table
  const infoItems = [
    { label: 'Invoice Date:', value: formatDate(data.invoiceDate) },
    { label: 'Due Date:', value: data.dueDate ? formatDate(data.dueDate) : 'Upon Receipt' },
    { label: 'Period:', value: `${formatDate(data.periodStart)} - ${formatDate(data.periodEnd)}` },
    { label: 'Type:', value: formatInvoiceType(data.invoiceType) },
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

  // ============ LINE ITEMS TABLE ============

  y = renderTableHeaders(y);

  // Table rows
  setFont(9, 'normal');
  let rowCount = 0;
  for (const line of data.lines) {
    // Check if we need a new page
    if (y > pageHeight - 25) {
      doc.addPage();
      y = margin;
      y = renderTableHeaders(y);
    }

    // Alternating row background
    if (rowCount % 2 === 1) {
      doc.setFillColor(250, 250, 250);
      doc.rect(margin, y - 4, contentWidth, 8, 'F');
    }

    let tableX = margin;
    doc.setTextColor(...darkGray);
    doc.text(line.serviceCode || '-', tableX + 2, y);
    tableX += colWidths.service;

    // Description (may need to be truncated)
    const descText = line.description || '-';
    const truncatedDesc = descText.length > 45 ? descText.substring(0, 42) + '...' : descText;
    doc.text(truncatedDesc, tableX + 2, y);
    tableX += colWidths.description;

    doc.text(line.quantity.toString(), tableX + colWidths.qty - 2, y, { align: 'right' });
    tableX += colWidths.qty;

    doc.text(`$${line.unitRate.toFixed(2)}`, tableX + colWidths.rate - 2, y, { align: 'right' });
    tableX += colWidths.rate;

    doc.setFont('helvetica', 'bold');
    doc.text(`$${line.lineTotal.toFixed(2)}`, tableX + colWidths.total - 2, y, { align: 'right' });
    doc.setFont('helvetica', 'normal');

    y += 7;
    rowCount++;
  }

  // Table bottom border
  y += 2;
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 10;

  // ============ TOTALS SECTION ============

  const totalsX = pageWidth - margin - 60;
  const totalsValueX = pageWidth - margin;

  // Subtotal
  setFont(10, 'normal');
  doc.setTextColor(...lightGray);
  doc.text('Subtotal:', totalsX, y, { align: 'right' });
  doc.setTextColor(...darkGray);
  doc.text(`$${data.subtotal.toFixed(2)}`, totalsValueX, y, { align: 'right' });
  y += 6;

  // Tax (if applicable)
  if (data.taxAmount && data.taxAmount > 0) {
    doc.setTextColor(...lightGray);
    doc.text(`Tax (${(data.taxRate || 0) * 100}%):`, totalsX, y, { align: 'right' });
    doc.setTextColor(...darkGray);
    doc.text(`$${data.taxAmount.toFixed(2)}`, totalsValueX, y, { align: 'right' });
    y += 6;
  }

  // Total line
  y += 2;
  doc.setDrawColor(...primaryColor);
  doc.setLineWidth(1);
  doc.line(totalsX - 20, y, pageWidth - margin, y);
  y += 8;

  // Total amount (large, bold)
  setFont(14, 'bold');
  doc.setTextColor(...primaryColor);
  doc.text('Total Due:', totalsX, y, { align: 'right' });
  doc.setTextColor(...darkGray);
  doc.text(`$${data.total.toFixed(2)}`, totalsValueX, y, { align: 'right' });

  y += 20;

  // ============ NOTES & PAYMENT TERMS ============

  if (data.notes || data.paymentTerms) {
    // Check if we need a new page
    if (y > pageHeight - 40) {
      doc.addPage();
      y = margin;
    }

    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageWidth - margin, y);
    y += 10;

    if (data.paymentTerms) {
      doc.setTextColor(...lightGray);
      setFont(9, 'bold');
      doc.text('Payment Terms:', margin, y);
      doc.setTextColor(...darkGray);
      setFont(9, 'normal');
      doc.text(data.paymentTerms, margin + 40, y);
      y += 8;
    }

    if (data.notes) {
      doc.setTextColor(...lightGray);
      setFont(9, 'bold');
      doc.text('Notes:', margin, y);
      y += 5;
      doc.setTextColor(...darkGray);
      setFont(9, 'normal');
      const noteLines = doc.splitTextToSize(data.notes, contentWidth);
      doc.text(noteLines, margin, y);
    }
  }

  // ============ FOOTER ============

  const footerY = pageHeight - 12;
  doc.setTextColor(...lightGray);
  setFont(7, 'normal');
  doc.text('Thank you for your business!', pageWidth / 2, footerY, { align: 'center' });
  doc.text(`Generated by ${data.companyName}`, pageWidth / 2, footerY + 4, { align: 'center' });

  return doc;
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
 * Format invoice type for display
 */
function formatInvoiceType(type: string): string {
  switch (type) {
    case 'weekly_services':
      return 'Weekly Services';
    case 'monthly_storage':
      return 'Monthly Storage';
    case 'closeout':
      return 'Closeout';
    case 'manual':
      return 'Manual';
    default:
      return type;
  }
}

/**
 * Download the PDF
 */
export async function downloadInvoicePdf(data: InvoicePdfData): Promise<void> {
  const doc = await generateInvoicePdf(data);
  doc.save(`Invoice_${data.invoiceNumber}.pdf`);
}

/**
 * Open PDF in new tab for printing
 */
export async function printInvoicePdf(data: InvoicePdfData): Promise<void> {
  const doc = await generateInvoicePdf(data);
  const pdfUrl = doc.output('bloburl');
  window.open(pdfUrl.toString(), '_blank');
}
