-- Drop existing INSERT policy if it exists
DROP POLICY IF EXISTS "Users can insert documents in their tenant" ON documents;

-- Create a more robust INSERT policy that ensures tenant_id and created_by are set correctly
CREATE POLICY "Users can insert documents for their tenant"
ON documents FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id = (
    SELECT tenant_id FROM public.users 
    WHERE id = auth.uid() 
    AND deleted_at IS NULL
    LIMIT 1
  )
  AND created_by = auth.uid()
);