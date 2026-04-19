-- Entity audit log — tracks every mutation across all entity types.
-- Session 71. One row per action (create, update, status_change, etc.)

CREATE TABLE IF NOT EXISTS public.entity_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  tenant_id text,
  action text NOT NULL,
  changes jsonb DEFAULT '{}'::jsonb,
  performed_by text,
  performed_at timestamptz NOT NULL DEFAULT now(),
  source text DEFAULT 'gas'
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON public.entity_audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON public.entity_audit_log (tenant_id, performed_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_time ON public.entity_audit_log (performed_at DESC);

ALTER TABLE public.entity_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and staff read all audit logs"
  ON public.entity_audit_log FOR SELECT
  USING (
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') IN ('admin', 'staff')
    OR tenant_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'clientSheetId')
  );

ALTER PUBLICATION supabase_realtime ADD TABLE public.entity_audit_log;
