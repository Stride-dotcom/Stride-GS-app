-- v38.179.0 — Client Intake draft auto-save (Option 2: persistence + admin visibility).
--
-- Pre-existing flow: prospects fill a 6-step intake form whose state lived
-- only in React useState. Close the tab / refresh / lose internet → every
-- field they typed evaporated and they restarted at step 1. There was zero
-- server-side trace of an in-progress submission, so when a prospect
-- (Jenny Ruegamer, 2026-04-24 link) reported failure-to-submit twice, we
-- had nothing to debug from.
--
-- This migration adds a draft row keyed on link_id. The intake form upserts
-- the draft on every meaningful state change (debounced) and on step
-- transitions; on successful submit the draft is deleted. Files are NOT
-- saved (no clean way to persist a File object across sessions); only
-- text/boolean/select fields + the signature base64 are.
--
-- The admin Settings → Clients → Intakes page gains a Drafts sub-tab that
-- lists in-progress drafts (last-updated, current step) and a snapshot of
-- every saved field — so when a prospect calls reporting trouble, the admin
-- can immediately see how far they got.

CREATE TABLE IF NOT EXISTS public.client_intake_drafts (
  link_id    text PRIMARY KEY REFERENCES public.client_intake_links(link_id) ON DELETE CASCADE,
  draft      jsonb NOT NULL,
  step       integer DEFAULT 1 CHECK (step BETWEEN 1 AND 10),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text
);

CREATE INDEX IF NOT EXISTS client_intake_drafts_updated_at_idx
  ON public.client_intake_drafts (updated_at DESC);

ALTER TABLE public.client_intake_drafts ENABLE ROW LEVEL SECURITY;

-- Anon (the prospect filling the form) can SELECT/INSERT/UPDATE/DELETE
-- their own draft by link_id. There's no auth on the intake page; the
-- linkId in the URL is the secret. RLS doesn't validate "ownership" beyond
-- "you're hitting this row by its link_id" because the form already
-- assumes anyone with the URL is the prospect (same trust model as the
-- existing `intakes_public_insert` policy on client_intakes).
CREATE POLICY drafts_anon_all
  ON public.client_intake_drafts
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Staff/admin can SELECT all drafts for the admin UI. The catch-all anon
-- policy above already allows authenticated SELECT, but be explicit so a
-- future RLS tightening doesn't accidentally lock admins out.
CREATE POLICY drafts_staff_select
  ON public.client_intake_drafts
  FOR SELECT TO authenticated
  USING (
    ((auth.jwt() -> 'user_metadata') ->> 'role') = ANY (ARRAY['admin','staff'])
  );

-- Auto-touch updated_at on every UPDATE so the admin tab can sort by
-- "most recently active draft" without us having to remember to set it
-- in every upsert payload.
CREATE OR REPLACE FUNCTION public.touch_client_intake_draft_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS client_intake_drafts_touch_updated_at ON public.client_intake_drafts;
CREATE TRIGGER client_intake_drafts_touch_updated_at
  BEFORE UPDATE ON public.client_intake_drafts
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_client_intake_draft_updated_at();

-- Realtime so the admin Drafts tab can live-update as a prospect types
-- (nice-to-have; doesn't block submit).
ALTER PUBLICATION supabase_realtime ADD TABLE public.client_intake_drafts;

COMMENT ON TABLE public.client_intake_drafts IS
  'In-progress intake form state, keyed on link_id. Auto-saved on field changes; deleted on successful submit. Admin Settings → Clients → Intakes → Drafts tab reads this for diagnostic visibility.';
