-- Create storage bucket for attachments
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attachments', 
  'attachments', 
  false,
  52428800, -- 50MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/csv', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
);

-- RLS policy: Users can view attachments from their tenant
CREATE POLICY "Users can view tenant attachments"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'attachments' 
  AND (storage.foldername(name))[1] = (
    SELECT tenant_id::text FROM public.users WHERE id = auth.uid()
  )
);

-- RLS policy: Users can upload to their tenant folder
CREATE POLICY "Users can upload to tenant folder"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'attachments'
  AND (storage.foldername(name))[1] = (
    SELECT tenant_id::text FROM public.users WHERE id = auth.uid()
  )
);

-- Note: No DELETE or UPDATE policies - attachments are immutable per requirements