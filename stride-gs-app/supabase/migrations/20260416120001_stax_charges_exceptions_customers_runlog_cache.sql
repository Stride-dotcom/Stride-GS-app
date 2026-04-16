-- Stax supplemental read-cache tables: charges, exceptions, customers, run_log.
-- Admin-only internal tool. Service role writes from StrideAPI.gs / StaxAutoPay.gs.

-- ═══════════ stax_charges (append-only log) ═══════════
CREATE TABLE IF NOT EXISTS public.stax_charges (
  id bigserial PRIMARY KEY,
  timestamp text,
  qb_invoice_no text,
  stax_invoice_id text,
  stax_customer_id text,
  customer text,
  amount numeric,
  status text,
  txn_id text,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- Dedup key so batch re-runs don't duplicate rows. Some fields may be blank on
-- older rows — keep unique constraint loose (timestamp + qb_invoice_no + txn_id).
CREATE UNIQUE INDEX IF NOT EXISTS stax_charges_unique_row
  ON public.stax_charges (
    coalesce(timestamp, ''),
    coalesce(qb_invoice_no, ''),
    coalesce(txn_id, '')
  );

CREATE INDEX IF NOT EXISTS idx_stax_charges_qb_invoice_no ON public.stax_charges (qb_invoice_no);
CREATE INDEX IF NOT EXISTS idx_stax_charges_status ON public.stax_charges (status);
CREATE INDEX IF NOT EXISTS idx_stax_charges_timestamp ON public.stax_charges (timestamp);

ALTER TABLE public.stax_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stax_charges_select_admin_staff" ON public.stax_charges
  FOR SELECT USING (
    (auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff')
  );

CREATE POLICY "stax_charges_service_role_all" ON public.stax_charges
  FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.stax_charges REPLICA IDENTITY FULL;

-- ═══════════ stax_exceptions ═══════════
CREATE TABLE IF NOT EXISTS public.stax_exceptions (
  id bigserial PRIMARY KEY,
  timestamp text,
  qb_invoice_no text,
  customer text,
  stax_customer_id text,
  amount numeric,
  due_date text,
  reason text,
  pay_link text,
  resolved boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS stax_exceptions_unique_row
  ON public.stax_exceptions (
    coalesce(timestamp, ''),
    coalesce(qb_invoice_no, '')
  );

CREATE INDEX IF NOT EXISTS idx_stax_exceptions_resolved ON public.stax_exceptions (resolved);
CREATE INDEX IF NOT EXISTS idx_stax_exceptions_qb_invoice_no ON public.stax_exceptions (qb_invoice_no);

ALTER TABLE public.stax_exceptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stax_exceptions_select_admin_staff" ON public.stax_exceptions
  FOR SELECT USING (
    (auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff')
  );

CREATE POLICY "stax_exceptions_service_role_all" ON public.stax_exceptions
  FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.stax_exceptions REPLICA IDENTITY FULL;

-- ═══════════ stax_customers ═══════════
CREATE TABLE IF NOT EXISTS public.stax_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  qb_name text NOT NULL,
  stax_company text,
  stax_name text,
  stax_id text,
  email text,
  pay_method text,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.stax_customers ADD CONSTRAINT stax_customers_qb_name_unique UNIQUE (qb_name);

CREATE INDEX IF NOT EXISTS idx_stax_customers_stax_id ON public.stax_customers (stax_id);

ALTER TABLE public.stax_customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stax_customers_select_admin_staff" ON public.stax_customers
  FOR SELECT USING (
    (auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff')
  );

CREATE POLICY "stax_customers_service_role_all" ON public.stax_customers
  FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.stax_customers REPLICA IDENTITY FULL;

-- ═══════════ stax_run_log ═══════════
CREATE TABLE IF NOT EXISTS public.stax_run_log (
  id bigserial PRIMARY KEY,
  timestamp text,
  fn text,
  summary text,
  details text,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS stax_run_log_unique_row
  ON public.stax_run_log (
    coalesce(timestamp, ''),
    coalesce(fn, ''),
    coalesce(summary, '')
  );

CREATE INDEX IF NOT EXISTS idx_stax_run_log_timestamp ON public.stax_run_log (timestamp);
CREATE INDEX IF NOT EXISTS idx_stax_run_log_fn ON public.stax_run_log (fn);

ALTER TABLE public.stax_run_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stax_run_log_select_admin_staff" ON public.stax_run_log
  FOR SELECT USING (
    (auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff')
  );

CREATE POLICY "stax_run_log_service_role_all" ON public.stax_run_log
  FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE public.stax_run_log REPLICA IDENTITY FULL;
