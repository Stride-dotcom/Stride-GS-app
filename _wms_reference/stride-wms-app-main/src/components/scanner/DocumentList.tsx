/**
 * DocumentList Component
 * Displays a list of documents for a given context
 */

import React, { useState, useEffect } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useDocuments } from '@/hooks/useDocuments';
import { useToast } from '@/hooks/use-toast';
import type { DocumentContextType, Document } from '@/lib/scanner/types';
import { format } from 'date-fns';
import { DocumentThumbnail } from './DocumentThumbnail';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';
import { logActivity } from '@/lib/activity/logActivity';

interface DocumentListProps {
  contextType: DocumentContextType;
  contextId?: string;
  showSearch?: boolean;
  compact?: boolean;
  maxItems?: number;
  onViewDocument?: (document: Document) => void;
  /** Change this value to trigger a refetch of documents */
  refetchKey?: number;
  /** If false, hide delete actions (e.g., client users). */
  canDelete?: boolean;
}

export function DocumentList({
  contextType,
  contextId,
  showSearch = false,
  compact = false,
  maxItems,
  onViewDocument,
  refetchKey,
  canDelete = true,
}: DocumentListProps) {
  const { documents, loading, error, deleteDocument, refetch } = useDocuments({
    contextType,
    contextId,
  });
  const { toast } = useToast();
  const { profile } = useAuth();

  // Refetch when refetchKey changes
  useEffect(() => {
    if (refetchKey !== undefined && refetchKey > 0) {
      refetch();
    }
  }, [refetchKey, refetch]);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingDoc, setDeletingDoc] = useState<Document | null>(null);

  const filteredDocs = documents.filter(doc => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      doc.file_name.toLowerCase().includes(query) ||
      doc.label?.toLowerCase().includes(query) ||
      doc.ocr_text?.toLowerCase().includes(query)
    );
  });

  const displayDocs = maxItems ? filteredDocs.slice(0, maxItems) : filteredDocs;

  const handleDelete = async () => {
    if (!deletingDoc) return;
    
    try {
      await deleteDocument(deletingDoc.id);

      // Activity log (best-effort) for supported entity types
      if (profile?.tenant_id && profile?.id && contextId) {
        const entityType =
          contextType === 'item' ? 'item'
          : contextType === 'shipment' ? 'shipment'
          : contextType === 'task' ? 'task'
          : null;

        if (entityType) {
          void logActivity({
            entityType,
            tenantId: profile.tenant_id,
            entityId: contextId,
            actorUserId: profile.id,
            eventType: entityType === 'item' ? 'item_document_removed' : 'document_removed',
            eventLabel: `Document removed: ${deletingDoc.label || deletingDoc.file_name}`,
            details: {
              document_id: deletingDoc.id,
              mime_type: deletingDoc.mime_type,
              document: {
                storage_key: deletingDoc.storage_key,
                file_name: deletingDoc.file_name,
                label: deletingDoc.label || null,
              },
            },
          });
        }
      }

      toast({
        title: 'Document deleted',
        description: 'The document has been removed.',
      });
      setDeletingDoc(null);
    } catch (err) {
      toast({
        title: 'Error',
        description: 'Failed to delete document',
        variant: 'destructive',
      });
    }
  };

  const getOcrStatusBadge = (status: Document['ocr_status']) => {
    switch (status) {
      case 'completed':
        return <Badge variant="outline" className="text-green-600">OCR Complete</Badge>;
      case 'processing':
        return <Badge variant="secondary">Processing OCR...</Badge>;
      case 'failed':
        return <Badge variant="destructive">OCR Failed</Badge>;
      case 'skipped':
        return null;
      default:
        return null;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <MaterialIcon name="warning" className="mb-2" style={{ fontSize: '32px' }} />
        <p className="text-sm">Failed to load documents</p>
        <Button variant="ghost" size="sm" onClick={() => refetch()} className="mt-2">
          Try again
        </Button>
      </div>
    );
  }

  if (documents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <MaterialIcon name="description" className="mb-2" style={{ fontSize: '32px' }} />
        <p className="text-sm">No documents yet</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showSearch && documents.length > 3 && (
        <div className="relative">
          <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search documents..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      )}

      <div className={cn(
        'grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-2',
        compact ? 'opacity-95' : undefined
      )}>
        {displayDocs.map((doc) => (
          <DocumentThumbnail
            key={doc.id}
            documentId={doc.id}
            storageKey={doc.storage_key}
            fileName={doc.file_name}
            label={doc.label}
            mimeType={doc.mime_type}
            onRemove={canDelete ? () => setDeletingDoc(doc) : undefined}
          />
        ))}
      </div>

      {maxItems && filteredDocs.length > maxItems && (
        <p className="text-sm text-muted-foreground text-center">
          + {filteredDocs.length - maxItems} more documents
        </p>
      )}

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deletingDoc} onOpenChange={() => setDeletingDoc(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete "{deletingDoc?.label || deletingDoc?.file_name}". 
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
