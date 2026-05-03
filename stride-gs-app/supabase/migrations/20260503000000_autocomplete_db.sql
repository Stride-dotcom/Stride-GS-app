-- Session 92 — `autocomplete_db` table replaces the per-client
-- Autocomplete_DB sheet tab as the source of truth for Sidemark / Vendor
-- / Description suggestion lists.
--
-- Why migrate: each useAutocomplete fetch was a SpreadsheetApp.openById()
-- + getRange() round-trip on the GAS side (~1.5–3s cold). With 84+
-- InlineEditableCell instances on the Inventory page, the React hook
-- already had to add an in-flight Map + result cache to avoid a
-- thundering-herd on cold load. Supabase reads collapse that to one
-- cheap query with realtime echoes, matching every other entity.
--
-- Schema:
--   - field is one of 'Sidemark' | 'Vendor' | 'Description' (CHECK)
--   - PK is (tenant_id, field, value) so an upsert is idempotent — the
--     GAS logAutocompleteEntries_ flush calls supabaseUpsert_ in batch
--     after every shipment intake / import.
--
-- RLS: client + staff + admin all read their own tenant. Service role
-- writes via StrideAPI's supabaseUpsert_ (same pattern as billing,
-- tasks, repairs).

CREATE TABLE IF NOT EXISTS public.autocomplete_db (
  tenant_id  text        NOT NULL,
  field      text        NOT NULL CHECK (field IN ('Sidemark', 'Vendor', 'Description')),
  value      text        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, field, value)
);

COMMENT ON TABLE public.autocomplete_db
  IS 'Session 92: per-tenant unique Sidemark / Vendor / Description values for input autocompletes. Backed by AutocompleteDB.gs syncs.';

CREATE INDEX IF NOT EXISTS idx_autocomplete_db_tenant_field
  ON public.autocomplete_db (tenant_id, field);

ALTER TABLE public.autocomplete_db REPLICA IDENTITY FULL;
ALTER TABLE public.autocomplete_db ENABLE ROW LEVEL SECURITY;

-- Staff + admin see every tenant's values.
DROP POLICY IF EXISTS autocomplete_db_select_staff ON public.autocomplete_db;
CREATE POLICY autocomplete_db_select_staff ON public.autocomplete_db
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'));

-- Clients see their own tenant only.
DROP POLICY IF EXISTS autocomplete_db_select_client ON public.autocomplete_db;
CREATE POLICY autocomplete_db_select_client ON public.autocomplete_db
  FOR SELECT TO authenticated
  USING (
    (auth.jwt()->'user_metadata'->>'role') = 'client'
    AND tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId')
  );

-- Service role (StrideAPI write-through) full access.
DROP POLICY IF EXISTS autocomplete_db_service ON public.autocomplete_db;
CREATE POLICY autocomplete_db_service ON public.autocomplete_db
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Realtime so a sidemark added in one tab appears in another within ~1–2s.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'autocomplete_db'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.autocomplete_db';
  END IF;
END $$;
