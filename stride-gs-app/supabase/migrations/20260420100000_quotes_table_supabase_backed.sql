-- Session 74: persist quotes in Supabase so they survive browser state.
-- Previously the Quote Tool's only persistence was localStorage
-- (`stride_quotes_{email}_list`), which lost everything on:
--   - Browser cache clear / private window
--   - localStorage quota exceed (silently swallowed by saveJson)
--   - Email key mismatch (impersonation, re-login)
--   - Different device / browser
-- User hit this on EST-1001 — saved + downloaded PDF, came back to
-- My Quotes, empty. This table + the hook rewrite that follows make
-- the Supabase row the source of truth; localStorage becomes a
-- disposable offline cache.

CREATE TABLE IF NOT EXISTS public.quotes (
  id              text PRIMARY KEY,
  owner_email     text NOT NULL,
  quote_number    text,
  status          text,
  data            jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quotes_owner_email_idx
  ON public.quotes (owner_email);
CREATE INDEX IF NOT EXISTS quotes_updated_at_idx
  ON public.quotes (updated_at DESC);

ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quotes_owner_read ON public.quotes;
CREATE POLICY quotes_owner_read ON public.quotes
  FOR SELECT USING (owner_email = auth.email());

DROP POLICY IF EXISTS quotes_owner_insert ON public.quotes;
CREATE POLICY quotes_owner_insert ON public.quotes
  FOR INSERT WITH CHECK (owner_email = auth.email());

DROP POLICY IF EXISTS quotes_owner_update ON public.quotes;
CREATE POLICY quotes_owner_update ON public.quotes
  FOR UPDATE USING (owner_email = auth.email())
  WITH CHECK (owner_email = auth.email());

DROP POLICY IF EXISTS quotes_owner_delete ON public.quotes;
CREATE POLICY quotes_owner_delete ON public.quotes
  FOR DELETE USING (owner_email = auth.email());

CREATE OR REPLACE FUNCTION public.quotes_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotes_touch_updated_at_trg ON public.quotes;
CREATE TRIGGER quotes_touch_updated_at_trg
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.quotes_touch_updated_at();
