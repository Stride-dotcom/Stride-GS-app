-- ============================================================
-- Allow admin and staff to insert entity_audit_log entries
-- from the app (e.g. delivery order activity tracking).
-- ============================================================

CREATE POLICY "Admin and staff insert audit logs"
  ON public.entity_audit_log FOR INSERT
  WITH CHECK (
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') IN ('admin', 'staff')
  );
