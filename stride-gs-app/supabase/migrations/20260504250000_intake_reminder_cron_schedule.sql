-- Migration: enable pg_cron + pg_net for the intake-resign-reminder-cron schedule.
--
-- The actual schedule is set up post-deploy via Supabase Dashboard →
-- Database → Cron Jobs (or via SQL editor with the project's service
-- role key). Doing it here would require encoding the project URL +
-- service key in the migration, which is environment-specific and
-- shouldn't live in source-controlled SQL.
--
-- After this migration runs, set up the schedule with this SQL in
-- the Supabase SQL editor (replace <project-ref> + <service-role-key>
-- with the actual values):
--
--     SELECT cron.schedule(
--       'intake-resign-reminder-daily',
--       '0 17 * * *',  -- 9:00 AM Pacific
--       $$
--       SELECT net.http_post(
--         url := 'https://<project-ref>.supabase.co/functions/v1/intake-resign-reminder-cron',
--         headers := jsonb_build_object(
--           'Authorization', 'Bearer <service-role-key>',
--           'Content-Type',  'application/json'
--         ),
--         body := '{}'::jsonb
--       );
--       $$
--     );
--
-- Verify with: SELECT * FROM cron.job WHERE jobname = 'intake-resign-reminder-daily';
-- Manually fire for testing: POST {} to /functions/v1/intake-resign-reminder-cron.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

COMMENT ON EXTENSION pg_cron IS 'Scheduled jobs (intake reminder + future scheduled work)';
