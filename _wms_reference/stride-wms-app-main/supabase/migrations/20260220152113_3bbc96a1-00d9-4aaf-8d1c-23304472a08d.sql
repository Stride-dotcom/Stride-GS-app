-- Allow anonymous/authenticated inserts into app_issues for error tracking.
-- Idempotent guard: policy may already exist in environments where this was
-- created manually or by a prior out-of-band migration path.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'app_issues'
      AND policyname = 'Allow inserts for error tracking'
  ) THEN
    CREATE POLICY "Allow inserts for error tracking"
    ON public.app_issues
    FOR INSERT
    WITH CHECK (true);
  END IF;
END
$$;
