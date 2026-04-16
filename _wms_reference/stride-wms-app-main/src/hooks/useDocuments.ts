/**
 * useDocuments Hook
 * React hook for document management with Supabase
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Document, DocumentContextType } from '@/lib/scanner/types';
import { getDocumentSignedUrl, deleteDocument as deleteDocumentService } from '@/lib/scanner/uploadService';

interface UseDocumentsOptions {
  contextType?: DocumentContextType;
  contextId?: string;
  includeDeleted?: boolean;
  /** If false, do not fetch (returns empty list, loading=false). */
  enabled?: boolean;
}

interface UseDocumentsReturn {
  documents: Document[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  getSignedUrl: (storageKey: string) => Promise<string>;
  deleteDocument: (documentId: string) => Promise<void>;
  searchDocuments: (query: string) => Promise<Document[]>;
}

export function useDocuments(options: UseDocumentsOptions = {}): UseDocumentsReturn {
  const { contextType, contextId, includeDeleted = false, enabled = true } = options;
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDocuments = useCallback(async () => {
    if (!enabled) {
      setDocuments([]);
      setError(null);
      setLoading(false);
      return;
    }

    // Guard: do not fetch the entire documents table when a caller hasn't
    // provided a contextId yet (common during "draft" creation flows).
    if (contextType && !contextId) {
      setDocuments([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let query = supabase.from('documents').select('*');

      if (contextType) {
        query = query.eq('context_type', contextType);
      }
      if (contextId) {
        query = query.eq('context_id', contextId);
      }
      if (!includeDeleted) {
        query = query.is('deleted_at', null);
      }

      query = query.order('created_at', { ascending: false });

      const { data, error: fetchError } = await query;

      if (fetchError) throw fetchError;
      setDocuments((data as unknown as Document[]) || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch documents');
    } finally {
      setLoading(false);
    }
  }, [contextType, contextId, includeDeleted, enabled]);

  useEffect(() => {
    if (!enabled) {
      setDocuments([]);
      setError(null);
      setLoading(false);
      return;
    }
    fetchDocuments();
  }, [fetchDocuments, enabled]);

  const getSignedUrl = useCallback(async (storageKey: string): Promise<string> => {
    return getDocumentSignedUrl(storageKey);
  }, []);

  const deleteDocument = useCallback(async (documentId: string): Promise<void> => {
    await deleteDocumentService(documentId);
    setDocuments(prev => prev.filter(d => d.id !== documentId));
  }, []);

  const searchDocuments = useCallback(async (query: string): Promise<Document[]> => {
    const { data, error } = await supabase
      .from('documents')
      .select('*')
      .textSearch('ocr_text', query)
      .is('deleted_at', null)
      .limit(50);

    if (error) throw error;
    return (data as unknown as Document[]) || [];
  }, []);

  return {
    documents,
    loading,
    error,
    refetch: fetchDocuments,
    getSignedUrl,
    deleteDocument,
    searchDocuments,
  };
}
