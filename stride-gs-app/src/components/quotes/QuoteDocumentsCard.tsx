/**
 * QuoteDocumentsCard — document/photo attachments for a quote.
 *
 * Clients send floor plans, packing lists, purchase orders, etc. that need to
 * ride along with the quote so anyone reviewing it has the full context. This
 * card reuses the existing documents module wholesale (same `documents` table,
 * same private `documents` Storage bucket, same RLS) — only the context_type
 * is new (`quote`, added in migration 20260609160000). Nothing quote-specific
 * is persisted here beyond (context_type='quote', context_id=quote.id).
 *
 *   - DocumentUploadButton (non-compact) gives the drag-and-drop / click zone
 *     and accepts images + PDFs (+ Office files / CSV) out of the box.
 *   - DocumentList renders image thumbnails, PDF first-page previews, file
 *     icons for everything else, plus download / open / delete per row.
 *
 * Works both during quote creation and when editing an existing quote: the
 * quote already has a stable id by the time the builder mounts (QuoteTool
 * calls createQuote() before opening the builder), so uploads always have a
 * valid contextId.
 */
import { useState } from 'react';
import { theme } from '../../styles/theme';
import { DocumentUploadButton } from '../media/DocumentUploadButton';
import { DocumentList } from '../media/DocumentList';
import { useDocuments } from '../../hooks/useDocuments';
import type { Quote } from '../../lib/quoteTypes';

const v = theme.v2;

interface Props {
  quote: Quote;
}

export function QuoteDocumentsCard({ quote }: Props) {
  // Tenant for the storage path + the client-tenant read carve-out. A quote
  // linked to a client (clientSheetId set) scopes its docs to that tenant so a
  // future client-facing quote view reads them via documents_select_own_tenant;
  // free-text quotes fall back to a `quotes` sentinel. Either way the Quote Tool
  // is admin/staff-only and documents_write_staff / documents_select_staff grant
  // full access regardless, so uploads + the list always work here.
  const tenantId = quote.clientSheetId || 'quotes';
  // ONE useDocuments instance owns the upload AND backs the list below (passed
  // to DocumentList via `source`). Two separate instances would each open a
  // Realtime channel with the same topic name, collide, and leave the list
  // stuck on "No documents attached yet" after an upload even though the
  // header count updated — the bug this card hit on first ship.
  const docs = useDocuments({
    contextType: 'quote',
    contextId: quote.id,
    tenantId,
  });
  const { documents, uploadDocument } = docs;
  const [uploading, setUploading] = useState(false);

  const handleUpload = async (files: File[]) => {
    setUploading(true);
    try {
      for (const f of files) { await uploadDocument(f); }
    } finally {
      setUploading(false);
    }
  };

  return (
    <div style={{ background: v.colors.bgCard, borderRadius: v.radius.card, padding: v.card.padding }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <div style={{ ...v.typography.cardTitle, color: v.colors.text }}>Documents</div>
        {documents.length > 0 && (
          <span style={{ fontSize: 12, color: v.colors.textMuted }}>
            {documents.length} attached
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: v.colors.textMuted, marginBottom: 16 }}>
        Floor plans, packing lists, purchase orders, photos — anything the client
        sends. Attached files stay with the quote for anyone reviewing it.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <DocumentUploadButton onUpload={handleUpload} uploading={uploading} />
        <DocumentList contextType="quote" contextId={quote.id} tenantId={tenantId} source={docs} />
      </div>
    </div>
  );
}
