-- Update repair quotes schema for multi-item support and new workflow
-- This migration updates the existing repair_quotes system

-- Create new status enum for repair quotes
DO $$ BEGIN
  CREATE TYPE repair_quote_workflow_status AS ENUM (
    'draft',                -- Initial creation, not yet sent
    'awaiting_assignment',  -- Waiting for tech assignment
    'sent_to_tech',         -- Sent to technician for quote
    'tech_declined',        -- Tech declined the job
    'tech_submitted',       -- Tech submitted their quote
    'under_review',         -- Office reviewing tech submission
    'sent_to_client',       -- Sent to client for approval
    'accepted',             -- Client accepted the quote
    'declined',             -- Client declined the quote
    'expired',              -- Quote expired (14 days)
    'closed'                -- Manually closed/cancelled
  );
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Add new columns to repair_quotes if they don't exist
ALTER TABLE public.repair_quotes
  ADD COLUMN IF NOT EXISTS status repair_quote_workflow_status DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS technician_id UUID REFERENCES public.technicians(id),
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id),
  ADD COLUMN IF NOT EXISTS sidemark_id UUID REFERENCES public.sidemarks(id),
  ADD COLUMN IF NOT EXISTS source_task_id UUID REFERENCES public.tasks(id),

  -- Tech submission fields
  ADD COLUMN IF NOT EXISTS tech_labor_hours NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS tech_labor_rate NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS tech_materials_cost NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS tech_total NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS tech_notes TEXT,
  ADD COLUMN IF NOT EXISTS tech_submitted_at TIMESTAMPTZ,

  -- Calculated totals (after markup)
  ADD COLUMN IF NOT EXISTS customer_total NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS markup_applied NUMERIC(5,2),

  -- Client response
  ADD COLUMN IF NOT EXISTS client_response TEXT CHECK (client_response IS NULL OR client_response IN ('accepted', 'declined')),
  ADD COLUMN IF NOT EXISTS client_responded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS client_responded_by UUID REFERENCES auth.users(id),

  -- Expiration
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ,

  -- Audit trail (JSONB array of actions)
  ADD COLUMN IF NOT EXISTS audit_log JSONB DEFAULT '[]'::jsonb;

-- Create repair_quote_items table for multi-item quotes
CREATE TABLE IF NOT EXISTS public.repair_quote_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  repair_quote_id UUID NOT NULL REFERENCES public.repair_quotes(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,

  -- Item snapshot at time of quote (in case item changes later)
  item_code TEXT,
  item_description TEXT,

  -- Tech allocation (how much of tech's quote applies to this item)
  allocated_tech_amount NUMERIC(10,2),

  -- Customer allocation (after markup, what customer pays for this item)
  allocated_customer_amount NUMERIC(10,2),

  -- Notes
  notes_public TEXT,   -- Visible to client
  notes_internal TEXT, -- Staff only

  -- Damage info from inspection
  damage_description TEXT,
  damage_photos JSONB DEFAULT '[]'::jsonb, -- Array of photo URLs

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Create indexes for repair_quote_items
CREATE INDEX IF NOT EXISTS idx_repair_quote_items_quote ON public.repair_quote_items(repair_quote_id);
CREATE INDEX IF NOT EXISTS idx_repair_quote_items_item ON public.repair_quote_items(item_id);
CREATE INDEX IF NOT EXISTS idx_repair_quote_items_tenant ON public.repair_quote_items(tenant_id);

-- Enable RLS on repair_quote_items
ALTER TABLE public.repair_quote_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies for repair_quote_items
DROP POLICY IF EXISTS "Users can view quote items in their tenant" ON public.repair_quote_items;
CREATE POLICY "Users can view quote items in their tenant"
  ON public.repair_quote_items FOR SELECT
  TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can insert quote items in their tenant" ON public.repair_quote_items;
CREATE POLICY "Users can insert quote items in their tenant"
  ON public.repair_quote_items FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can update quote items in their tenant" ON public.repair_quote_items;
CREATE POLICY "Users can update quote items in their tenant"
  ON public.repair_quote_items FOR UPDATE
  TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Users can delete quote items in their tenant" ON public.repair_quote_items;
CREATE POLICY "Users can delete quote items in their tenant"
  ON public.repair_quote_items FOR DELETE
  TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

-- Create repair_quote_tokens for magic link access (tech and client)
CREATE TABLE IF NOT EXISTS public.repair_quote_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  repair_quote_id UUID NOT NULL REFERENCES public.repair_quotes(id) ON DELETE CASCADE,

  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  token_type TEXT NOT NULL CHECK (token_type IN ('tech_quote', 'client_review', 'tech_repair')),

  -- Who this token is for
  recipient_email TEXT,
  recipient_name TEXT,

  -- Token lifecycle
  expires_at TIMESTAMPTZ NOT NULL,
  accessed_at TIMESTAMPTZ,
  used_at TIMESTAMPTZ, -- When they actually submitted/responded

  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id)
);

-- Index for token lookup
CREATE INDEX IF NOT EXISTS idx_repair_quote_tokens_token ON public.repair_quote_tokens(token);
CREATE INDEX IF NOT EXISTS idx_repair_quote_tokens_quote ON public.repair_quote_tokens(repair_quote_id);

-- RLS for tokens
ALTER TABLE public.repair_quote_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage tokens in their tenant" ON public.repair_quote_tokens;
CREATE POLICY "Users can manage tokens in their tenant"
  ON public.repair_quote_tokens FOR ALL
  TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

-- Allow anonymous access to read tokens (for magic link validation)
DROP POLICY IF EXISTS "Anyone can validate tokens" ON public.repair_quote_tokens;
CREATE POLICY "Anyone can validate tokens"
  ON public.repair_quote_tokens FOR SELECT
  TO anon
  USING (true);

-- Add updated_at trigger to repair_quote_items
DROP TRIGGER IF EXISTS set_repair_quote_items_updated_at ON public.repair_quote_items;
CREATE TRIGGER set_repair_quote_items_updated_at
  BEFORE UPDATE ON public.repair_quote_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- Add index on repair_quotes status
CREATE INDEX IF NOT EXISTS idx_repair_quotes_status ON public.repair_quotes(status);
CREATE INDEX IF NOT EXISTS idx_repair_quotes_technician ON public.repair_quotes(technician_id);
CREATE INDEX IF NOT EXISTS idx_repair_quotes_account ON public.repair_quotes(account_id);
CREATE INDEX IF NOT EXISTS idx_repair_quotes_expires ON public.repair_quotes(expires_at) WHERE status = 'sent_to_client';

-- Comments
COMMENT ON TABLE public.repair_quote_items IS 'Individual items included in a repair quote';
COMMENT ON TABLE public.repair_quote_tokens IS 'Magic link tokens for technician and client access to quotes';
COMMENT ON COLUMN public.repair_quotes.audit_log IS 'JSONB array tracking all actions: [{action, by, at, details}]';