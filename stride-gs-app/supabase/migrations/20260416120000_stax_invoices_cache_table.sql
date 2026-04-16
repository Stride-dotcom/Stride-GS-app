-- Stax Invoices read-cache table (mirrors Stax Auto Pay spreadsheet Invoices tab)
-- No tenant_id — admin-only internal tool.
-- RLS: admin/staff only; service_role full.

CREATE TABLE IF NOT EXISTS public.stax_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qb_invoice_no text NOT NULL,
  row_index int,
  customer text,
  stax_customer_id text,
  invoice_date text,
  due_date text,
  amount numeric,
  line_items_json text,
  stax_id text,
  status text,
  created_at_sheet text,
  notes text,
  is_test boolean DEFAULT false,
  auto_charge boolean DEFAULT false,
  payment_method_status text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.stax_invoices ADD CONSTRAINT stax_invoices_qb_invoice_no_unique UNIQUE (qb_invoice_no);

CREATE INDEX IF NOT EXISTS idx_stax_invoices_status ON public.stax_invoices (status);
CREATE INDEX IF NOT EXISTS idx_stax_invoices_customer ON public.stax_invoices (customer);
CREATE INDEX IF NOT EXISTS idx_stax_invoices_due_date ON public.stax_invoices (due_date);

ALTER TABLE public.stax_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stax_invoices_select_admin_staff" ON public.stax_invoices
  FOR SELECT USING (
    (auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff')
  );

CREATE POLICY "stax_invoices_service_role_all" ON public.stax_invoices
  FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.stax_invoices REPLICA IDENTITY FULL;
