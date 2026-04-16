-- =============================================================================
-- Enforce append-only behavior for platform rollout audit entries
-- =============================================================================

CREATE OR REPLACE FUNCTION public.prevent_platform_template_rollout_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'platform_template_rollout_audit is append-only; % is not allowed', TG_OP
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_platform_template_rollout_audit_update
  ON public.platform_template_rollout_audit;
CREATE TRIGGER trg_prevent_platform_template_rollout_audit_update
  BEFORE UPDATE ON public.platform_template_rollout_audit
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_platform_template_rollout_audit_mutation();

DROP TRIGGER IF EXISTS trg_prevent_platform_template_rollout_audit_delete
  ON public.platform_template_rollout_audit;
CREATE TRIGGER trg_prevent_platform_template_rollout_audit_delete
  BEFORE DELETE ON public.platform_template_rollout_audit
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_platform_template_rollout_audit_mutation();

COMMENT ON TABLE public.platform_template_rollout_audit IS
'Append-only audit log for platform template rollout actions by tenant/trigger/channel.';
