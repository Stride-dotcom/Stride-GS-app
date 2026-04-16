-- Create account_room_suggestions table for per-account room autocomplete
CREATE TABLE public.account_room_suggestions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  room TEXT NOT NULL,
  usage_count INTEGER NOT NULL DEFAULT 1,
  last_used_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(account_id, room)
);

-- Create index for faster lookups
CREATE INDEX idx_account_room_suggestions_account_id ON public.account_room_suggestions(account_id);

-- Enable RLS
ALTER TABLE public.account_room_suggestions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can view room suggestions for their tenant accounts"
ON public.account_room_suggestions
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.accounts a
    JOIN public.users u ON u.tenant_id = a.tenant_id
    WHERE a.id = account_room_suggestions.account_id
    AND u.id = auth.uid()
  )
);

CREATE POLICY "Users can insert room suggestions for their tenant accounts"
ON public.account_room_suggestions
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.accounts a
    JOIN public.users u ON u.tenant_id = a.tenant_id
    WHERE a.id = account_room_suggestions.account_id
    AND u.id = auth.uid()
  )
);

CREATE POLICY "Users can update room suggestions for their tenant accounts"
ON public.account_room_suggestions
FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.accounts a
    JOIN public.users u ON u.tenant_id = a.tenant_id
    WHERE a.id = account_room_suggestions.account_id
    AND u.id = auth.uid()
  )
);

CREATE POLICY "Users can delete room suggestions for their tenant accounts"
ON public.account_room_suggestions
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.accounts a
    JOIN public.users u ON u.tenant_id = a.tenant_id
    WHERE a.id = account_room_suggestions.account_id
    AND u.id = auth.uid()
  )
);