-- Users read-cache table (mirrors CB Users tab)
-- No tenant_id — users are global to the CB sheet, identified by email.
-- RLS: admin/staff only (Settings → Users is role-guarded to admin).

CREATE TABLE IF NOT EXISTS public.cb_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  role text,
  client_name text,
  client_sheet_id text,
  active boolean DEFAULT true,
  contact_name text,
  phone text,
  stax_customer_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Unique constraint for upsert conflict resolution
ALTER TABLE public.cb_users ADD CONSTRAINT cb_users_email_unique UNIQUE (email);

-- Indexes
CREATE INDEX idx_cb_users_role ON public.cb_users (role);
CREATE INDEX idx_cb_users_active ON public.cb_users (active);

-- RLS
ALTER TABLE public.cb_users ENABLE ROW LEVEL SECURITY;

-- Admin/staff: see all users
CREATE POLICY "cb_users_select_admin_staff" ON public.cb_users
  FOR SELECT USING (
    (auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff')
  );

-- Service role: full access (GAS write-through)
CREATE POLICY "cb_users_service_role_all" ON public.cb_users
  FOR ALL USING (true) WITH CHECK (true);

-- Realtime support
ALTER TABLE public.cb_users REPLICA IDENTITY FULL;
