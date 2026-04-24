-- Enable realtime for the quotes table so the admin Quote Tool view
-- auto-updates when another user saves. Also set replica identity to
-- FULL so UPDATE/DELETE events carry the pre-row (Supabase realtime
-- needs this to distinguish row-level changes for subscribers).
--
-- Without this: admin must reload the page to see a staff user's new
-- quote, and soft-delete tombstones don't propagate across devices
-- until each device does a full hydrate.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='quotes'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.quotes';
  END IF;
END $$;

ALTER TABLE public.quotes REPLICA IDENTITY FULL;
