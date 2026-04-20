/**
 * useDocuments — Supabase CRUD for the `documents` table. Adapted from the
 * WMS app's useDocuments hook; uses soft-delete (deleted_at) and signed URLs
 * for secure download.
 *
 * Storage path: documents/{tenantId}/{contextType}-{contextId}/{filename}
 *
 * Context types match the entity types that can own a document: inventory,
 * task, repair, will_call, shipment, claim, client.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

// Must match the CHECK constraint on public.documents.context_type exactly.
// Session-73 Phase A migration defines: shipment | item | task | repair | willcall | claim.
export type DocumentContextType =
  | 'shipment' | 'item' | 'task' | 'repair' | 'willcall' | 'claim';

export interface DocumentRow {
  id: string;
  tenant_id: string;
  context_type: DocumentContextType;
  context_id: string;
  storage_key: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  uploaded_by: string | null;
  uploaded_by_email: string | null;
  ocr_text: string | null;
  page_count: number | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UseDocumentsOptions {
  contextType: DocumentContextType;
  contextId: string | null | undefined;
  tenantId?: string | null;
  includeDeleted?: boolean;
  enabled?: boolean;
}

export interface UseDocumentsResult {
  documents: DocumentRow[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  uploadDocument: (file: File) => Promise<DocumentRow | null>;
  getSignedUrl: (storageKey: string, expiresInSeconds?: number) => Promise<string | null>;
  deleteDocument: (documentId: string) => Promise<boolean>;
}

const BUCKET = 'documents';
const DEFAULT_SIGNED_URL_TTL = 15 * 60; // 15 min

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120);
}

export function useDocuments({
  contextType, contextId, tenantId, includeDeleted = false, enabled = true,
}: UseDocumentsOptions): UseDocumentsResult {
  const { user } = useAuth();
  const effectiveTenantId = tenantId ?? user?.clientSheetId ?? null;
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const refetch = useCallback(async () => {
    if (!enabled || !contextId) { setDocuments([]); setLoading(false); return; }
    setLoading(true); setError(null);
    let query = supabase.from('documents').select('*')
      .eq('context_type', contextType)
      .eq('context_id', contextId)
      .order('created_at', { ascending: false });
    if (!includeDeleted) query = query.is('deleted_at', null);
    const { data, error: err } = await query;
    if (!mountedRef.current) return;
    if (err) setError(err.message);
    else setDocuments((data || []) as DocumentRow[]);
    setLoading(false);
  }, [enabled, contextType, contextId, includeDeleted]);

  useEffect(() => { void refetch(); }, [refetch]);

  const uploadDocument = useCallback(async (file: File): Promise<DocumentRow | null> => {
    if (!effectiveTenantId || !contextId) {
      setError('Missing tenant or context');
      return null;
    }
    setError(null);

    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const safeName = sanitizeName(file.name || `document-${ts}.pdf`);
    const storageKey = `${effectiveTenantId}/${contextType}-${contextId}/${ts}-${rand}-${safeName}`;

    const { error: upErr } = await supabase.storage.from(BUCKET).upload(storageKey, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
    if (upErr) { setError(upErr.message); return null; }

    const { data, error: insErr } = await supabase
      .from('documents')
      .insert({
        tenant_id: effectiveTenantId,
        context_type: contextType,
        context_id: contextId,
        storage_key: storageKey,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || 'application/octet-stream',
        uploaded_by: null,
        uploaded_by_email: user?.email || null,
      })
      .select('*')
      .single();
    if (insErr || !data) { setError(insErr?.message || 'Insert failed'); return null; }
    await refetch();
    return data as DocumentRow;
  }, [effectiveTenantId, contextType, contextId, user?.email, refetch]);

  const getSignedUrl = useCallback(async (storageKey: string, expiresInSeconds: number = DEFAULT_SIGNED_URL_TTL): Promise<string | null> => {
    const { data, error: err } = await supabase.storage.from(BUCKET).createSignedUrl(storageKey, expiresInSeconds);
    if (err || !data?.signedUrl) { setError(err?.message || 'Signed URL failed'); return null; }
    return data.signedUrl;
  }, []);

  const deleteDocument = useCallback(async (documentId: string): Promise<boolean> => {
    const { error: err } = await supabase.from('documents')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', documentId);
    if (err) { setError(err.message); return false; }
    setDocuments(prev => prev.filter(d => d.id !== documentId));
    return true;
  }, []);

  return { documents, loading, error, refetch, uploadDocument, getSignedUrl, deleteDocument };
}
