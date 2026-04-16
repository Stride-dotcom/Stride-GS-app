-- Phase 1: Database Schema & Storage for Document Scanner

-- 1.1 Create private documents storage bucket
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents-private', 
  'documents-private', 
  false,
  52428800, -- 50MB limit
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- 1.2 Create documents table
CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  
  -- Context linking (polymorphic)
  context_type TEXT NOT NULL CHECK (context_type IN ('shipment', 'employee', 'delivery', 'invoice', 'item', 'general')),
  context_id UUID, -- nullable for 'general' type
  
  -- File metadata
  file_name TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  file_size INTEGER,
  page_count INTEGER DEFAULT 1,
  mime_type TEXT DEFAULT 'application/pdf',
  
  -- OCR results
  ocr_text TEXT, -- Full searchable text
  ocr_pages JSONB, -- Array of {pageIndex, text}
  ocr_status TEXT DEFAULT 'pending' CHECK (ocr_status IN ('pending', 'processing', 'completed', 'failed', 'skipped')),
  
  -- Additional metadata
  label TEXT, -- User-defined label for the document
  notes TEXT, -- Optional notes about the document
  
  -- Sensitivity flag for PII documents
  is_sensitive BOOLEAN DEFAULT false,
  
  -- Audit
  created_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- 1.3 Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_documents_tenant ON public.documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_context ON public.documents(context_type, context_id);
CREATE INDEX IF NOT EXISTS idx_documents_created_by ON public.documents(created_by);
CREATE INDEX IF NOT EXISTS idx_documents_deleted_at ON public.documents(deleted_at) WHERE deleted_at IS NULL;

-- Create full-text search index on OCR text
CREATE INDEX IF NOT EXISTS idx_documents_ocr_text ON public.documents USING gin(to_tsvector('english', COALESCE(ocr_text, '')));

-- 1.4 Create updated_at trigger
CREATE OR REPLACE FUNCTION public.update_documents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS update_documents_updated_at ON public.documents;
CREATE TRIGGER update_documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_documents_updated_at();

-- 1.5 Create security definer function to check document access with role-based restrictions
CREATE OR REPLACE FUNCTION public.can_access_document(doc_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  doc RECORD;
  user_role TEXT;
BEGIN
  -- Get document details
  SELECT context_type, is_sensitive, tenant_id INTO doc
  FROM public.documents WHERE id = doc_id AND deleted_at IS NULL;
  
  IF NOT FOUND THEN RETURN false; END IF;
  
  -- Check tenant match
  IF doc.tenant_id != public.user_tenant_id() THEN RETURN false; END IF;
  
  -- Get user's role
  user_role := public.get_user_role(auth.uid());
  
  -- Sensitive employee documents require admin/manager role
  IF doc.context_type = 'employee' AND doc.is_sensitive THEN
    RETURN user_role IN ('admin', 'manager', 'tenant_admin');
  END IF;
  
  -- All other documents accessible to all tenant users
  RETURN true;
END;
$$;

-- 1.6 Enable RLS on documents table
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Users can view accessible documents" ON public.documents;
DROP POLICY IF EXISTS "Users can insert documents in their tenant" ON public.documents;
DROP POLICY IF EXISTS "Users can update their own documents" ON public.documents;
DROP POLICY IF EXISTS "Admins can update any document" ON public.documents;
DROP POLICY IF EXISTS "Users can soft delete their own documents" ON public.documents;

-- Create RLS policies for documents
CREATE POLICY "Users can view accessible documents"
ON public.documents FOR SELECT
USING (public.can_access_document(id));

CREATE POLICY "Users can insert documents in their tenant"
ON public.documents FOR INSERT
WITH CHECK (tenant_id = public.user_tenant_id());

CREATE POLICY "Users can update their own documents"
ON public.documents FOR UPDATE
USING (created_by = auth.uid() AND tenant_id = public.user_tenant_id());

CREATE POLICY "Admins can update any document"
ON public.documents FOR UPDATE
USING (
  tenant_id = public.user_tenant_id() 
  AND public.get_user_role(auth.uid()) IN ('admin', 'manager', 'tenant_admin')
);

-- 1.7 Storage bucket RLS policies for documents-private
DROP POLICY IF EXISTS "Users can view tenant documents" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload to tenant documents folder" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own documents" ON storage.objects;

-- View documents in tenant folder
CREATE POLICY "Users can view tenant documents"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'documents-private' 
  AND (storage.foldername(name))[1] = public.user_tenant_id()::text
);

-- Upload to tenant folder
CREATE POLICY "Users can upload to tenant documents folder"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'documents-private'
  AND (storage.foldername(name))[1] = public.user_tenant_id()::text
);

-- Delete own documents (for cleanup)
CREATE POLICY "Users can delete own documents"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'documents-private'
  AND (storage.foldername(name))[1] = public.user_tenant_id()::text
);