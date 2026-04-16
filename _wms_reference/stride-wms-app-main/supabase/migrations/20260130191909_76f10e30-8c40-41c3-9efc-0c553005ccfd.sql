-- Safe migration for account_promo_codes and promo_code_usages tables
-- Uses IF NOT EXISTS to avoid conflicts with earlier migrations

-- Create account_promo_codes table (junction table linking promo codes to accounts)
CREATE TABLE IF NOT EXISTS public.account_promo_codes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  promo_code_id UUID NOT NULL REFERENCES public.promo_codes(id) ON DELETE CASCADE,
  assigned_by UUID REFERENCES auth.users(id),
  assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  notes TEXT
);

-- Add unique constraint if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_promo_codes_unique'
  ) THEN
    ALTER TABLE public.account_promo_codes
      ADD CONSTRAINT account_promo_codes_unique UNIQUE (account_id, promo_code_id);
  END IF;
END $$;

-- Create promo_code_usages table (tracks per-account-group usage for enforcing limits)
CREATE TABLE IF NOT EXISTS public.promo_code_usages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  promo_code_id UUID NOT NULL REFERENCES public.promo_codes(id) ON DELETE CASCADE,
  root_account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  used_by_account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  billing_event_id UUID REFERENCES public.billing_events(id) ON DELETE SET NULL,
  used_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  used_by UUID REFERENCES auth.users(id)
);

-- Add unique constraint if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'promo_code_usages_billing_event_unique'
  ) THEN
    ALTER TABLE public.promo_code_usages
      ADD CONSTRAINT promo_code_usages_billing_event_unique UNIQUE (billing_event_id);
  END IF;
END $$;

-- Create indexes for performance (IF NOT EXISTS)
CREATE INDEX IF NOT EXISTS idx_account_promo_codes_account ON public.account_promo_codes(account_id);
CREATE INDEX IF NOT EXISTS idx_account_promo_codes_promo ON public.account_promo_codes(promo_code_id);
CREATE INDEX IF NOT EXISTS idx_promo_code_usages_promo ON public.promo_code_usages(promo_code_id);
CREATE INDEX IF NOT EXISTS idx_promo_code_usages_root_account ON public.promo_code_usages(root_account_id);
CREATE INDEX IF NOT EXISTS idx_promo_code_usages_used_by_account ON public.promo_code_usages(used_by_account_id);

-- Enable RLS (safe to run multiple times)
ALTER TABLE public.account_promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promo_code_usages ENABLE ROW LEVEL SECURITY;

-- RLS policies for account_promo_codes (drop and recreate to avoid duplicates)
DROP POLICY IF EXISTS "Users can view account promo codes for their tenant" ON public.account_promo_codes;
DROP POLICY IF EXISTS "Users can manage account promo codes for their tenant" ON public.account_promo_codes;
DROP POLICY IF EXISTS "account_promo_codes_tenant_access" ON public.account_promo_codes;

CREATE POLICY "account_promo_codes_tenant_access" ON public.account_promo_codes
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.accounts a
      WHERE a.id = account_promo_codes.account_id
      AND a.tenant_id::text = auth.jwt() ->> 'tenant_id'
    )
  );

-- RLS policies for promo_code_usages (drop and recreate to avoid duplicates)
DROP POLICY IF EXISTS "Users can view promo usages for their tenant" ON public.promo_code_usages;
DROP POLICY IF EXISTS "Users can manage promo usages for their tenant" ON public.promo_code_usages;
DROP POLICY IF EXISTS "promo_code_usages_tenant_access" ON public.promo_code_usages;

CREATE POLICY "promo_code_usages_tenant_access" ON public.promo_code_usages
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.accounts a
      WHERE a.id = promo_code_usages.root_account_id
      AND a.tenant_id::text = auth.jwt() ->> 'tenant_id'
    )
  );
