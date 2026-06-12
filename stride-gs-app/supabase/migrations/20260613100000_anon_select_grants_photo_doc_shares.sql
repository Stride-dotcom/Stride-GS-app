-- Anon SELECT grants for documents + item_photos.
--
-- Both tables ship deliberate anon SELECT policies for the public share
-- feature (documents_anon_read_via_share / item_photos_anon_read_via_share,
-- scoped to active, unexpired photo_shares rows) — but the table-level
-- GRANT SELECT TO anon was never issued, so the role couldn't even attempt
-- the statement and PostgREST returned 42501 "permission denied for table
-- documents/item_photos" instead of evaluating the policy:
--   • the anonymous share pages have been hard-erroring, and
--   • an anon-degraded in-app session (expired Supabase session rendering
--     from the localStorage auth cache — the 2026-06-12 item-211 Docs tab
--     report) surfaced the raw permission error in the Docs tab.
--
-- The grant decides "can the role attempt SELECT"; the existing share
-- policies still decide "which rows it sees" (share-linked, active,
-- unexpired only). No write grants — anon INSERT policies already have
-- their grants from the original media migration.

GRANT SELECT ON public.documents   TO anon;
GRANT SELECT ON public.item_photos TO anon;
