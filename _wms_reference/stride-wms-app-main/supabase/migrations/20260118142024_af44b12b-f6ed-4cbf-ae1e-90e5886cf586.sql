-- Create storage bucket for tenant logos
INSERT INTO storage.buckets (id, name, public)
VALUES ('logos', 'logos', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policy: Anyone can view logos (public bucket)
CREATE POLICY "Public logo access"
ON storage.objects FOR SELECT
USING (bucket_id = 'logos');

-- RLS policy: Users can upload logos to their tenant folder
CREATE POLICY "Users can upload tenant logos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'logos'
  AND (storage.foldername(name))[1] = (
    SELECT tenant_id::text FROM public.users WHERE id = auth.uid()
  )
);

-- RLS policy: Users can update logos in their tenant folder
CREATE POLICY "Users can update tenant logos"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'logos'
  AND (storage.foldername(name))[1] = (
    SELECT tenant_id::text FROM public.users WHERE id = auth.uid()
  )
);

-- RLS policy: Users can delete logos in their tenant folder
CREATE POLICY "Users can delete tenant logos"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'logos'
  AND (storage.foldername(name))[1] = (
    SELECT tenant_id::text FROM public.users WHERE id = auth.uid()
  )
);