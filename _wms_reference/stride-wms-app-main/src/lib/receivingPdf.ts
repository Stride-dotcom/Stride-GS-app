import jsPDF from 'jspdf';
import { supabase } from '@/integrations/supabase/client';
import { logActivity } from '@/lib/activity/logActivity';

export interface ReceivingPdfData {
  // Shipment info
  shipmentNumber: string;
  vendorName: string | null;
  accountName: string | null;
  signedPieces: number | null;
  receivedPieces: number | null;
  driverName: string | null;

  // Company (tenant) info
  companyName: string;
  companyAddress: string | null;
  companyPhone: string | null;
  companyEmail: string | null;

  // Warehouse
  warehouseName: string | null;

  // Items
  items: ReceivingPdfItem[];

  // Signature
  signatureData: string | null;
  signatureName: string | null;

  // Received
  receivedAt: string;
}

export interface ReceivingPdfItem {
  description: string;
  quantity: number;
  vendor: string | null;
  sidemark: string | null;
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(dateStr: string): string {
  if (!dateStr) return '-';
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

export function generateReceivingPdf(data: ReceivingPdfData): jsPDF {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;
  const margin = 20;
  const contentWidth = pageWidth - margin * 2;
  let y = margin;

  // Colors (matching Stride WMS branding)
  const primaryColor: [number, number, number] = [220, 88, 42];
  const darkGray: [number, number, number] = [51, 51, 51];
  const lightGray: [number, number, number] = [128, 128, 128];
  const veryLightGray: [number, number, number] = [245, 245, 245];

  const setFont = (size: number, style: 'normal' | 'bold' = 'normal') => {
    doc.setFontSize(size);
    doc.setFont('helvetica', style);
  };

  const addText = (
    text: string,
    x: number,
    currentY: number,
    options?: { align?: 'left' | 'center' | 'right'; maxWidth?: number }
  ) => {
    if (options?.maxWidth) {
      const lines = doc.splitTextToSize(text, options.maxWidth);
      doc.text(lines, x, currentY, { align: options?.align || 'left' });
      return currentY + lines.length * 5;
    }
    doc.text(text, x, currentY, { align: options?.align || 'left' });
    return currentY + 5;
  };

  const checkNewPage = (needed: number) => {
    if (y + needed > pageHeight - 30) {
      doc.addPage();
      y = margin;
    }
  };

  // ============ HEADER ============
  doc.setTextColor(...darkGray);
  setFont(24, 'bold');
  y = addText(data.companyName, margin, y);
  y += 2;

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

  // Title on the right
  doc.setTextColor(...primaryColor);
  setFont(24, 'bold');
  doc.text('RECEIVING DOCUMENT', pageWidth - margin, margin + 5, { align: 'right' });

  doc.setTextColor(...darkGray);
  setFont(10, 'normal');
  doc.text(`#${data.shipmentNumber}`, pageWidth - margin, margin + 14, { align: 'right' });

  y += 10;

  // ============ DIVIDER ============
  doc.setDrawColor(...primaryColor);
  doc.setLineWidth(1);
  doc.line(margin, y, pageWidth - margin, y);
  y += 10;

  // ============ RECEIVING INFO (two columns) ============
  const leftColX = margin;
  const rightColX = pageWidth / 2 + 10;
  let leftY = y;
  let rightY = y;

  // Left column: Vendor info
  doc.setTextColor(...lightGray);
  setFont(9, 'bold');
  doc.text('VENDOR', leftColX, leftY);
  leftY += 6;

  doc.setTextColor(...darkGray);
  setFont(11, 'bold');
  leftY = addText(data.vendorName || '-', leftColX, leftY);

  if (data.accountName) {
    leftY += 3;
    doc.setTextColor(...lightGray);
    setFont(9, 'bold');
    doc.text('ACCOUNT', leftColX, leftY);
    leftY += 6;
    doc.setTextColor(...darkGray);
    setFont(10, 'bold');
    leftY = addText(data.accountName, leftColX, leftY);
  }

  // Right column: Receiving Details
  doc.setTextColor(...lightGray);
  setFont(9, 'bold');
  doc.text('RECEIVING DETAILS', rightColX, rightY);
  rightY += 6;

  const infoItems: { label: string; value: string }[] = [
    { label: 'Received:', value: formatDateTime(data.receivedAt) },
    { label: 'Signed Pieces:', value: String(data.signedPieces ?? '-') },
    { label: 'Received Pieces:', value: String(data.receivedPieces ?? '-') },
    { label: 'Driver:', value: data.driverName || '-' },
    { label: 'Warehouse:', value: data.warehouseName || '-' },
  ];

  doc.setTextColor(...darkGray);
  setFont(9, 'normal');
  for (const item of infoItems) {
    doc.setFont('helvetica', 'bold');
    doc.text(item.label, rightColX, rightY);
    doc.setFont('helvetica', 'normal');
    doc.text(item.value, rightColX + 40, rightY);
    rightY += 5;
  }

  y = Math.max(leftY, rightY) + 15;

  // ============ ITEMS TABLE ============
  checkNewPage(40);

  doc.setTextColor(...darkGray);
  setFont(12, 'bold');
  y = addText(`Items Received (${data.items.length})`, margin, y);
  y += 3;

  // Table header background
  doc.setFillColor(...veryLightGray);
  doc.rect(margin, y - 5, contentWidth, 10, 'F');

  doc.setTextColor(...darkGray);
  setFont(9, 'bold');
  const colWidths = {
    qty: 15,
    vendor: 40,
    description: contentWidth - 15 - 40 - 35,
    sidemark: 35,
  };

  let tableX = margin;
  doc.text('Qty', tableX + 2, y);
  tableX += colWidths.qty;
  doc.text('Vendor', tableX + 2, y);
  tableX += colWidths.vendor;
  doc.text('Description', tableX + 2, y);
  tableX += colWidths.description;
  doc.text('Sidemark', tableX + 2, y);

  y += 8;

  // Table rows
  setFont(9, 'normal');
  const truncate = (text: string, maxLen: number) =>
    text.length > maxLen ? text.substring(0, maxLen - 2) + '..' : text;

  for (let i = 0; i < data.items.length; i++) {
    checkNewPage(10);

    const item = data.items[i];
    if (i % 2 === 1) {
      doc.setFillColor(250, 250, 250);
      doc.rect(margin, y - 4, contentWidth, 7, 'F');
    }

    tableX = margin;
    doc.setTextColor(...darkGray);
    doc.text(String(item.quantity), tableX + 2, y);
    tableX += colWidths.qty;
    doc.text(truncate(item.vendor || '-', 22), tableX + 2, y);
    tableX += colWidths.vendor;
    doc.text(truncate(item.description || '-', 40), tableX + 2, y);
    tableX += colWidths.description;
    doc.text(truncate(item.sidemark || '-', 18), tableX + 2, y);

    y += 7;
  }

  // Table bottom border
  y += 2;
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageWidth - margin, y);
  y += 5;

  // Totals
  setFont(10, 'bold');
  doc.setTextColor(...darkGray);
  doc.text(`Total Items Received: ${data.items.length}`, pageWidth - margin, y, { align: 'right' });
  y += 15;

  // ============ SIGNATURE SECTION ============
  if (data.signatureData || data.signatureName) {
    checkNewPage(80);

    doc.setDrawColor(220, 220, 220);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageWidth - margin, y);
    y += 10;

    doc.setTextColor(...darkGray);
    setFont(10, 'bold');
    doc.text('Delivery Signature', margin, y);
    y += 8;

    const sigBoxWidth = contentWidth * 0.55;
    const sigBoxHeight = 50;
    const sigBoxTop = y;

    doc.setDrawColor(200, 200, 200);
    doc.setLineWidth(0.5);
    doc.rect(margin, sigBoxTop, sigBoxWidth, sigBoxHeight);

    if (data.signatureData) {
      try {
        doc.addImage(data.signatureData, 'PNG', margin + 2, sigBoxTop + 2, sigBoxWidth - 4, sigBoxHeight - 4);
      } catch {
        doc.setTextColor(...lightGray);
        setFont(14, 'bold');
        doc.text(data.signatureName || '(signature)', margin + 8, sigBoxTop + sigBoxHeight / 2 + 4);
      }
    } else if (data.signatureName) {
      doc.setTextColor(...darkGray);
      setFont(18, 'bold');
      doc.text(data.signatureName, margin + 8, sigBoxTop + sigBoxHeight / 2 + 4);
    }

    y = sigBoxTop + sigBoxHeight + 10;
  }

  // ============ FOOTER ============
  const footerY = pageHeight - 15;
  doc.setTextColor(...lightGray);
  setFont(8, 'normal');
  doc.text(
    `Receiving Document | ${data.shipmentNumber} | Generated ${formatDateTime(new Date().toISOString())}`,
    pageWidth / 2,
    footerY,
    { align: 'center' }
  );
  doc.text(`${data.companyName}`, pageWidth / 2, footerY + 5, { align: 'center' });

  return doc;
}

export function downloadReceivingPdf(data: ReceivingPdfData): void {
  const doc = generateReceivingPdf(data);
  doc.save(`Receiving_${data.shipmentNumber}.pdf`);
}

export async function storeReceivingPdf(
  data: ReceivingPdfData,
  shipmentId: string,
  tenantId: string,
  userId: string
): Promise<{ success: boolean; storageKey?: string }> {
  try {
    // Fetch current shipment metadata so we can:
    // 1) "overwrite" by archiving the prior auto-generated receiving PDF (if any)
    // 2) keep an audit trail of prior versions (activity entries)
    const { data: shipmentRow, error: shipmentFetchError } = await supabase
      .from('shipments')
      .select('metadata')
      .eq('id', shipmentId)
      .single();

    if (shipmentFetchError) {
      console.warn('[storeReceivingPdf] failed to fetch shipment metadata:', shipmentFetchError);
    }

    const currentMetadata = (shipmentRow?.metadata as Record<string, unknown>) || {};
    const previousStorageKey =
      typeof currentMetadata.receiving_pdf_key === 'string' && currentMetadata.receiving_pdf_key.trim()
        ? currentMetadata.receiving_pdf_key.trim()
        : null;

    const previousFileName = previousStorageKey ? previousStorageKey.split('/').pop() || null : null;

    const doc = generateReceivingPdf(data);
    const blob = doc.output('blob');
    const fileName = `Receiving_${data.shipmentNumber}_${Date.now()}.pdf`;
    const storageKey = `${tenantId}/shipment/${shipmentId}/${fileName}`;

    // Upload to documents-private bucket
    const { error: uploadError } = await supabase.storage
      .from('documents-private')
      .upload(storageKey, blob, { contentType: 'application/pdf' });

    if (uploadError) throw uploadError;

    // Create document record via edge function. We also ask it to archive the previous
    // auto-generated receiving PDF (soft delete) so only the latest is visible.
    try {
      const { data: createData, error: createError } = await supabase.functions.invoke('create-document', {
        body: {
          context_type: 'shipment',
          context_id: shipmentId,
          storage_key: storageKey,
          file_name: fileName,
          file_size: blob.size,
          mime_type: 'application/pdf',
          label: `Receiving Document - ${data.shipmentNumber}`,
          notes: `Receiving completed for ${data.shipmentNumber}`,
          is_sensitive: false,
          // Overwrite behavior: hide the prior version but keep it archived for audit.
          replace_storage_key: previousStorageKey,
        },
      });

      if (createError || !createData?.ok || !createData?.document?.id) {
        throw new Error(createError?.message || createData?.error || 'Failed to create document record');
      }
      const createdDocumentId = String(createData.document.id);

      // Store reference in shipment metadata (used for "Download PDF" and overwrite authorization)
      const nowIso = new Date().toISOString();
      // Re-fetch metadata right before the update to avoid overwriting concurrent metadata changes
      // made while we were generating/uploading the PDF and calling the edge function.
      const { data: latestShipmentRow, error: latestShipmentFetchError } = await supabase
        .from('shipments')
        .select('metadata')
        .eq('id', shipmentId)
        .single();

      if (latestShipmentFetchError) {
        console.warn('[storeReceivingPdf] failed to re-fetch shipment metadata:', latestShipmentFetchError);
      }

      const latestMetadata =
        (latestShipmentRow?.metadata as Record<string, unknown>) || currentMetadata || {};
      await supabase
        .from('shipments')
        .update({
          metadata: {
            ...latestMetadata,
            receiving_pdf_key: storageKey,
            receiving_pdf_generated_at: nowIso,
            receiving_pdf_document_id: createdDocumentId,
          },
        } as any)
        .eq('id', shipmentId);

      // Activity log entry for audit + interactive access to prior versions
      try {
        const eventType = previousStorageKey ? 'receiving_pdf_regenerated' : 'receiving_pdf_generated';
        const eventLabel = previousStorageKey
          ? `Receiving Document regenerated (previous version archived)`
          : `Receiving Document generated`;

        await logActivity({
          entityType: 'shipment',
          tenantId,
          entityId: shipmentId,
          actorUserId: userId,
          eventType,
          eventLabel,
          details: {
            receiving_document: {
              storage_key: storageKey,
              file_name: fileName,
              document_id: createdDocumentId,
              label: `Receiving Document - ${data.shipmentNumber}`,
            },
            ...(previousStorageKey
              ? {
                  previous_receiving_document: {
                    storage_key: previousStorageKey,
                    file_name: previousFileName,
                  },
                }
              : {}),
          },
        });
      } catch {
        // Non-blocking
      }

      return { success: true, storageKey };
    } catch (err) {
      // If document record creation fails, clean up the uploaded file to avoid orphaned storage.
      console.warn('[storeReceivingPdf] document record creation failed:', err);
      try {
        await supabase.storage.from('documents-private').remove([storageKey]);
      } catch {
        // Ignore cleanup errors
      }
      return { success: false };
    }
  } catch (err) {
    console.error('[storeReceivingPdf] error:', err);
    return { success: false };
  }
}
