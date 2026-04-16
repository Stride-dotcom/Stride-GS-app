-- =============================================================================
-- Reports: users_report_v1
-- =============================================================================
-- Purpose:
-- - Provide a stable "report-friendly" users source with a computed `full_name`
--   column (first + last, falling back to email).
-- - Used by the Custom Report Builder join logic (single joinColumn per table).
--
-- Notes:
-- - INVOKER view; underlying RLS on public.users still applies.
-- - We GRANT SELECT for PostgREST access.
-- =============================================================================

CREATE OR REPLACE VIEW public.users_report_v1 AS
SELECT
  u.id,
  u.tenant_id,
  u.email,
  COALESCE(
    NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), ''),
    u.email
  ) AS full_name,
  u.first_name,
  u.last_name,
  u.status,
  u.deleted_at,
  u.created_at,
  u.updated_at
FROM public.users u;

GRANT SELECT ON public.users_report_v1 TO authenticated;

