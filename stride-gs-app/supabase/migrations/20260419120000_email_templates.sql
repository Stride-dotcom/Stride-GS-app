-- Session 73 Phase 6 — Email templates in Supabase.
--
-- Primary home for every email/doc template. Replaces the Master Price
-- List `Email_Templates` tab (which becomes the backup / seed source).
-- GAS reads templates from here when sending emails; React edits go
-- straight to Supabase.

CREATE TABLE IF NOT EXISTS public.email_templates (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key     text        UNIQUE NOT NULL,
  subject          text        NOT NULL DEFAULT '',
  body             text        NOT NULL DEFAULT '',
  notes            text        DEFAULT '',
  recipients       text        DEFAULT '',
  attach_doc       text        DEFAULT '',
  category         text        DEFAULT 'email',
  active           boolean     DEFAULT true,
  updated_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by_name  text,
  updated_at       timestamptz DEFAULT now(),
  created_at       timestamptz DEFAULT now()
);

COMMENT ON TABLE public.email_templates
  IS 'Session 73 Phase 6: primary store for every email/doc template. Replaces the MPL Email_Templates tab.';

CREATE INDEX IF NOT EXISTS idx_email_templates_template_key ON public.email_templates (template_key);
CREATE INDEX IF NOT EXISTS idx_email_templates_active       ON public.email_templates (active) WHERE active = true;

ALTER TABLE public.email_templates REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'email_templates'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.email_templates;
  END IF;
END $$;

-- Audit table (one row per field-level change).
CREATE TABLE IF NOT EXISTS public.email_templates_audit (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     uuid        REFERENCES public.email_templates(id) ON DELETE CASCADE,
  template_key    text,
  field_changed   text        NOT NULL,
  old_value       text,
  new_value       text,
  changed_by      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_name text,
  changed_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_templates_audit_template ON public.email_templates_audit (template_id);
CREATE INDEX IF NOT EXISTS idx_email_templates_audit_changed_at ON public.email_templates_audit (changed_at DESC);

-- RLS
ALTER TABLE public.email_templates       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_templates_audit ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read templates (needed for Settings preview +
-- any future client-facing template picker). Sensitive data (client info)
-- lives in the tokens, never in the template itself.
DROP POLICY IF EXISTS "email_templates_select_auth" ON public.email_templates;
CREATE POLICY "email_templates_select_auth" ON public.email_templates
  FOR SELECT TO authenticated USING (true);

-- Admin-only writes.
DROP POLICY IF EXISTS "email_templates_write_admin" ON public.email_templates;
CREATE POLICY "email_templates_write_admin" ON public.email_templates
  FOR ALL TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') = 'admin')
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') = 'admin');

-- Service role bypass (GAS sends + seed).
DROP POLICY IF EXISTS "email_templates_service_all" ON public.email_templates;
CREATE POLICY "email_templates_service_all" ON public.email_templates
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Audit: authenticated read, anyone authenticated can insert (fires from
-- React update path). Service role full.
DROP POLICY IF EXISTS "email_templates_audit_select_auth" ON public.email_templates_audit;
CREATE POLICY "email_templates_audit_select_auth" ON public.email_templates_audit
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "email_templates_audit_insert_auth" ON public.email_templates_audit;
CREATE POLICY "email_templates_audit_insert_auth" ON public.email_templates_audit
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "email_templates_audit_service_all" ON public.email_templates_audit;
CREATE POLICY "email_templates_audit_service_all" ON public.email_templates_audit
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Auto-bump updated_at on UPDATE
CREATE OR REPLACE FUNCTION public.email_templates_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS email_templates_updated_at ON public.email_templates;
CREATE TRIGGER email_templates_updated_at
  BEFORE UPDATE ON public.email_templates
  FOR EACH ROW EXECUTE FUNCTION public.email_templates_touch_updated_at();
