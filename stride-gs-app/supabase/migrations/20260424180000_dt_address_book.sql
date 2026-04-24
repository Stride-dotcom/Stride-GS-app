-- ============================================================
-- Address Book for delivery order contacts
-- Auto-saved on order submit, searchable for auto-fill
-- RLS: clients see own tenant_id only; staff/admin see all
-- ============================================================

CREATE TABLE IF NOT EXISTS public.dt_address_book (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     text NOT NULL,                          -- clientSheetId
  contact_name  text NOT NULL,
  address       text,
  city          text,
  state         text,
  zip           text,
  phone         text,                                   -- cell phone
  phone2        text,                                   -- secondary phone
  email         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Upsert key: same tenant + name + address = same contact
  UNIQUE (tenant_id, contact_name, address)
);

-- Index for fast autocomplete lookups
CREATE INDEX idx_address_book_tenant_name
  ON public.dt_address_book (tenant_id, contact_name);

-- Auto-update updated_at on changes
CREATE OR REPLACE FUNCTION update_address_book_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_address_book_updated
  BEFORE UPDATE ON public.dt_address_book
  FOR EACH ROW EXECUTE FUNCTION update_address_book_timestamp();

-- ── RLS ──────────────────────────────────────────────────────

ALTER TABLE public.dt_address_book ENABLE ROW LEVEL SECURITY;

-- Staff/admin: full read access
DROP POLICY IF EXISTS "address_book_select_staff" ON public.dt_address_book;
CREATE POLICY "address_book_select_staff" ON public.dt_address_book
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

-- Clients: read own contacts only
DROP POLICY IF EXISTS "address_book_select_client" ON public.dt_address_book;
CREATE POLICY "address_book_select_client" ON public.dt_address_book
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId'));

-- Staff/admin: can insert/update any contact
DROP POLICY IF EXISTS "address_book_write_staff" ON public.dt_address_book;
CREATE POLICY "address_book_write_staff" ON public.dt_address_book
  FOR ALL TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'))
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

-- Clients: can insert/update own contacts only
DROP POLICY IF EXISTS "address_book_write_client" ON public.dt_address_book;
CREATE POLICY "address_book_write_client" ON public.dt_address_book
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId'));

DROP POLICY IF EXISTS "address_book_update_client" ON public.dt_address_book;
CREATE POLICY "address_book_update_client" ON public.dt_address_book
  FOR UPDATE TO authenticated
  USING (tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId'))
  WITH CHECK (tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId'));

-- Service role: unrestricted
DROP POLICY IF EXISTS "address_book_service_all" ON public.dt_address_book;
CREATE POLICY "address_book_service_all" ON public.dt_address_book
  FOR ALL TO service_role USING (true) WITH CHECK (true);
