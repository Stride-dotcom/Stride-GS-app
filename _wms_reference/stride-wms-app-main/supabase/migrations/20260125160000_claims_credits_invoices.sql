-- Enhanced Claims Credits and Invoice Payments Migration
-- ================================================================================

-- 0. Add repair determination field to claim_items
ALTER TABLE public.claim_items
  ADD COLUMN IF NOT EXISTS use_repair_cost boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS determination_notes text,
  ADD COLUMN IF NOT EXISTS determined_by uuid,
  ADD COLUMN IF NOT EXISTS determined_at timestamptz;

COMMENT ON COLUMN public.claim_items.use_repair_cost IS
'When true, indicates admin determined repair is cheaper than replacement and payout should use repair_cost instead of declared_value';

-- 1. Enhance account_credits table with additional fields for better tracking
ALTER TABLE public.account_credits
  ADD COLUMN IF NOT EXISTS credit_type text DEFAULT 'claim_payout',
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS balance_remaining numeric,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS voided_at timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by uuid,
  ADD COLUMN IF NOT EXISTS voided_reason text;

-- Add check constraint for credit_type
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_credits_credit_type_check'
  ) THEN
    ALTER TABLE public.account_credits
      ADD CONSTRAINT account_credits_credit_type_check
      CHECK (credit_type = ANY (ARRAY['claim_payout', 'manual_adjustment', 'promotional', 'refund', 'other']));
  END IF;
END $$;

-- Add check constraint for status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_credits_status_check'
  ) THEN
    ALTER TABLE public.account_credits
      ADD CONSTRAINT account_credits_status_check
      CHECK (status = ANY (ARRAY['active', 'applied', 'partially_applied', 'voided', 'expired']));
  END IF;
END $$;

-- Initialize balance_remaining for existing records
UPDATE public.account_credits
SET balance_remaining = amount
WHERE balance_remaining IS NULL;

-- 2. Create credit applications table to track how credits are applied
CREATE TABLE IF NOT EXISTS public.credit_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  credit_id uuid NOT NULL REFERENCES public.account_credits(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL,
  amount_applied numeric NOT NULL,
  applied_by uuid,
  applied_at timestamptz NOT NULL DEFAULT now(),
  notes text
);

CREATE INDEX IF NOT EXISTS credit_applications_credit_idx ON public.credit_applications(credit_id);
CREATE INDEX IF NOT EXISTS credit_applications_invoice_idx ON public.credit_applications(invoice_id);

-- RLS for credit_applications
ALTER TABLE public.credit_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view credit applications for their tenant" ON public.credit_applications;
CREATE POLICY "Users can view credit applications for their tenant"
  ON public.credit_applications FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert credit applications for their tenant" ON public.credit_applications;
CREATE POLICY "Users can insert credit applications for their tenant"
  ON public.credit_applications FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

-- 3. Enhance invoices table with payment tracking fields
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS paid_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS credits_applied numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS payment_date timestamptz,
  ADD COLUMN IF NOT EXISTS payment_method text,
  ADD COLUMN IF NOT EXISTS payment_reference text,
  ADD COLUMN IF NOT EXISTS payment_notes text,
  ADD COLUMN IF NOT EXISTS marked_paid_by uuid,
  ADD COLUMN IF NOT EXISTS marked_paid_at timestamptz;

-- Add check constraint for payment_status
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_payment_status_check'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_payment_status_check
      CHECK (payment_status = ANY (ARRAY['pending', 'partial', 'paid', 'overpaid', 'written_off']));
  END IF;
END $$;

-- Add check constraint for payment_method
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'invoices_payment_method_check'
  ) THEN
    ALTER TABLE public.invoices
      ADD CONSTRAINT invoices_payment_method_check
      CHECK (payment_method IS NULL OR payment_method = ANY (ARRAY['check', 'wire', 'ach', 'credit_card', 'cash', 'credit_applied', 'quickbooks', 'other']));
  END IF;
END $$;

-- 4. Create invoice payment history table
CREATE TABLE IF NOT EXISTS public.invoice_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  invoice_id uuid NOT NULL,
  amount numeric NOT NULL,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text NOT NULL,
  payment_reference text,
  notes text,
  credit_application_id uuid REFERENCES public.credit_applications(id),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid,
  voided_reason text
);

CREATE INDEX IF NOT EXISTS invoice_payments_invoice_idx ON public.invoice_payments(invoice_id);
CREATE INDEX IF NOT EXISTS invoice_payments_tenant_idx ON public.invoice_payments(tenant_id);

-- RLS for invoice_payments
ALTER TABLE public.invoice_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view invoice payments for their tenant" ON public.invoice_payments;
CREATE POLICY "Users can view invoice payments for their tenant"
  ON public.invoice_payments FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can insert invoice payments for their tenant" ON public.invoice_payments;
CREATE POLICY "Users can insert invoice payments for their tenant"
  ON public.invoice_payments FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Users can update invoice payments for their tenant" ON public.invoice_payments;
CREATE POLICY "Users can update invoice payments for their tenant"
  ON public.invoice_payments FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

-- 5. Create view for account credit balance
CREATE OR REPLACE VIEW public.v_account_credit_balance AS
SELECT
  ac.tenant_id,
  ac.account_id,
  a.account_name,
  SUM(CASE WHEN ac.status = 'active' THEN COALESCE(ac.balance_remaining, ac.amount) ELSE 0 END) as available_credit,
  SUM(ac.amount) as total_credits_issued,
  SUM(COALESCE(ca.total_applied, 0)) as total_credits_applied,
  COUNT(CASE WHEN ac.status = 'active' THEN 1 END) as active_credits_count
FROM public.account_credits ac
JOIN public.accounts a ON a.id = ac.account_id
LEFT JOIN (
  SELECT credit_id, SUM(amount_applied) as total_applied
  FROM public.credit_applications
  GROUP BY credit_id
) ca ON ca.credit_id = ac.id
WHERE ac.voided_at IS NULL
GROUP BY ac.tenant_id, ac.account_id, a.account_name;

-- 6. Function to apply credit to invoice
CREATE OR REPLACE FUNCTION public.apply_credit_to_invoice(
  p_credit_id uuid,
  p_invoice_id uuid,
  p_amount numeric,
  p_applied_by uuid,
  p_notes text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_credit record;
  v_invoice record;
  v_tenant_id uuid;
  v_application_id uuid;
  v_remaining_balance numeric;
BEGIN
  -- Get credit info
  SELECT * INTO v_credit FROM public.account_credits WHERE id = p_credit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit not found';
  END IF;

  IF v_credit.status NOT IN ('active', 'partially_applied') THEN
    RAISE EXCEPTION 'Credit is not available for application';
  END IF;

  v_remaining_balance := COALESCE(v_credit.balance_remaining, v_credit.amount);
  IF p_amount > v_remaining_balance THEN
    RAISE EXCEPTION 'Amount exceeds available credit balance';
  END IF;

  -- Get invoice info
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  v_tenant_id := v_credit.tenant_id;

  -- Create credit application record
  INSERT INTO public.credit_applications (tenant_id, credit_id, invoice_id, amount_applied, applied_by, notes)
  VALUES (v_tenant_id, p_credit_id, p_invoice_id, p_amount, p_applied_by, p_notes)
  RETURNING id INTO v_application_id;

  -- Update credit balance
  UPDATE public.account_credits
  SET
    balance_remaining = v_remaining_balance - p_amount,
    status = CASE
      WHEN (v_remaining_balance - p_amount) <= 0 THEN 'applied'
      ELSE 'partially_applied'
    END
  WHERE id = p_credit_id;

  -- Update invoice
  UPDATE public.invoices
  SET
    credits_applied = COALESCE(credits_applied, 0) + p_amount,
    payment_status = CASE
      WHEN (COALESCE(paid_amount, 0) + COALESCE(credits_applied, 0) + p_amount) >= total_amount THEN 'paid'
      WHEN (COALESCE(paid_amount, 0) + COALESCE(credits_applied, 0) + p_amount) > 0 THEN 'partial'
      ELSE 'pending'
    END
  WHERE id = p_invoice_id;

  -- Create payment record
  INSERT INTO public.invoice_payments (tenant_id, invoice_id, amount, payment_method, credit_application_id, created_by, notes)
  VALUES (v_tenant_id, p_invoice_id, p_amount, 'credit_applied', v_application_id, p_applied_by, p_notes);

  RETURN v_application_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7. Function to manually mark invoice as paid
CREATE OR REPLACE FUNCTION public.mark_invoice_paid(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_method text,
  p_payment_reference text DEFAULT NULL,
  p_payment_date date DEFAULT CURRENT_DATE,
  p_marked_by uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_invoice record;
  v_tenant_id uuid;
  v_payment_id uuid;
  v_new_paid_amount numeric;
BEGIN
  -- Get invoice info
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  v_tenant_id := v_invoice.tenant_id;
  v_new_paid_amount := COALESCE(v_invoice.paid_amount, 0) + p_amount;

  -- Create payment record
  INSERT INTO public.invoice_payments (
    tenant_id, invoice_id, amount, payment_date, payment_method,
    payment_reference, notes, created_by
  )
  VALUES (
    v_tenant_id, p_invoice_id, p_amount, p_payment_date, p_payment_method,
    p_payment_reference, p_notes, p_marked_by
  )
  RETURNING id INTO v_payment_id;

  -- Update invoice
  UPDATE public.invoices
  SET
    paid_amount = v_new_paid_amount,
    payment_status = CASE
      WHEN (v_new_paid_amount + COALESCE(credits_applied, 0)) >= total_amount THEN 'paid'
      WHEN (v_new_paid_amount + COALESCE(credits_applied, 0)) > 0 THEN 'partial'
      ELSE 'pending'
    END,
    payment_date = CASE
      WHEN (v_new_paid_amount + COALESCE(credits_applied, 0)) >= total_amount THEN p_payment_date
      ELSE payment_date
    END,
    payment_method = CASE
      WHEN (v_new_paid_amount + COALESCE(credits_applied, 0)) >= total_amount THEN p_payment_method
      ELSE payment_method
    END,
    payment_reference = CASE
      WHEN (v_new_paid_amount + COALESCE(credits_applied, 0)) >= total_amount THEN p_payment_reference
      ELSE payment_reference
    END,
    marked_paid_by = CASE
      WHEN (v_new_paid_amount + COALESCE(credits_applied, 0)) >= total_amount THEN p_marked_by
      ELSE marked_paid_by
    END,
    marked_paid_at = CASE
      WHEN (v_new_paid_amount + COALESCE(credits_applied, 0)) >= total_amount THEN now()
      ELSE marked_paid_at
    END
  WHERE id = p_invoice_id;

  RETURN v_payment_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. Add index for better performance on credit lookups
CREATE INDEX IF NOT EXISTS account_credits_status_idx ON public.account_credits(status) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS account_credits_account_status_idx ON public.account_credits(account_id, status);

-- 9. Add claims storage bucket photo subcategories support
-- The bucket structure: claims/{tenant_id}/{claim_id}/{category}/{filename}
-- Categories: damage_photos, receipts, repair_quotes, correspondence, other

COMMENT ON TABLE public.claim_attachments IS
'Attachments for claims. Storage path format: {tenant_id}/{claim_id}/{category}/{filename}
Categories: damage_photos, receipts, repair_quotes, correspondence, other';

-- Add category column to claim_attachments if not exists
ALTER TABLE public.claim_attachments
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'other';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'claim_attachments_category_check'
  ) THEN
    ALTER TABLE public.claim_attachments
      ADD CONSTRAINT claim_attachments_category_check
      CHECK (category = ANY (ARRAY['damage_photos', 'receipts', 'repair_quotes', 'correspondence', 'other']));
  END IF;
END $$;
