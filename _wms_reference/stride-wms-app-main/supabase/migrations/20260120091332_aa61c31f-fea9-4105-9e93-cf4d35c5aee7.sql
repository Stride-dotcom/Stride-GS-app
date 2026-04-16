-- Create account_sidemarks table for account-specific sidemarks
CREATE TABLE public.account_sidemarks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  sidemark TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),
  UNIQUE(account_id, sidemark)
);

-- Create index for faster lookups
CREATE INDEX idx_account_sidemarks_account_id ON public.account_sidemarks(account_id);

-- Enable RLS
ALTER TABLE public.account_sidemarks ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view sidemarks for their tenant accounts"
ON public.account_sidemarks
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.accounts a
    JOIN public.users u ON u.tenant_id = a.tenant_id
    WHERE a.id = account_sidemarks.account_id
    AND u.id = auth.uid()
  )
);

CREATE POLICY "Users can insert sidemarks for their tenant accounts"
ON public.account_sidemarks
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.accounts a
    JOIN public.users u ON u.tenant_id = a.tenant_id
    WHERE a.id = account_sidemarks.account_id
    AND u.id = auth.uid()
  )
);

CREATE POLICY "Users can update sidemarks for their tenant accounts"
ON public.account_sidemarks
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.accounts a
    JOIN public.users u ON u.tenant_id = a.tenant_id
    WHERE a.id = account_sidemarks.account_id
    AND u.id = auth.uid()
  )
);

CREATE POLICY "Users can delete sidemarks for their tenant accounts"
ON public.account_sidemarks
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.accounts a
    JOIN public.users u ON u.tenant_id = a.tenant_id
    WHERE a.id = account_sidemarks.account_id
    AND u.id = auth.uid()
  )
);