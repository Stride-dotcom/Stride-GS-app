-- ============================================================================
-- Public SMS consent: phone-first global consent + tenant sync
-- ============================================================================

-- Normalize phone text into a comparable E.164-ish format.
CREATE OR REPLACE FUNCTION public.normalize_sms_phone_e164ish(p_phone text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_trimmed text;
  v_digits text;
BEGIN
  v_trimmed := NULLIF(BTRIM(COALESCE(p_phone, '')), '');
  IF v_trimmed IS NULL THEN
    RETURN NULL;
  END IF;

  v_digits := regexp_replace(v_trimmed, '[^0-9]', '', 'g');
  IF COALESCE(v_digits, '') = '' THEN
    RETURN NULL;
  END IF;

  IF LEFT(v_trimmed, 1) = '+' THEN
    RETURN '+' || regexp_replace(SUBSTRING(v_trimmed FROM 2), '[^0-9]', '', 'g');
  END IF;

  IF LENGTH(v_digits) = 10 THEN
    RETURN '+1' || v_digits;
  END IF;

  IF LENGTH(v_digits) = 11 AND LEFT(v_digits, 1) = '1' THEN
    RETURN '+' || v_digits;
  END IF;

  RETURN '+' || v_digits;
END;
$$;

COMMENT ON FUNCTION public.normalize_sms_phone_e164ish(text) IS
'Normalizes a phone string into E.164-like format for consent matching.';

-- Global (phone-first) consent registry used by public /sms pages.
CREATE TABLE IF NOT EXISTS public.global_sms_consent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('opted_in', 'opted_out', 'pending')),
  consent_method text
    CHECK (consent_method IS NULL OR consent_method IN (
      'text_keyword', 'web_form', 'verbal', 'admin_manual', 'imported'
    )),
  opted_in_at timestamptz,
  opted_out_at timestamptz,
  last_keyword text,
  last_source text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_global_sms_consent_status
  ON public.global_sms_consent(status);

CREATE INDEX IF NOT EXISTS idx_global_sms_consent_updated_at
  ON public.global_sms_consent(updated_at DESC);

CREATE OR REPLACE FUNCTION public.update_global_sms_consent_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_global_sms_consent_updated_at ON public.global_sms_consent;
CREATE TRIGGER trg_global_sms_consent_updated_at
  BEFORE UPDATE ON public.global_sms_consent
  FOR EACH ROW
  EXECUTE FUNCTION public.update_global_sms_consent_updated_at();

ALTER TABLE public.global_sms_consent ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.global_sms_consent FROM anon;
REVOKE ALL ON TABLE public.global_sms_consent FROM authenticated;

-- Audit log for global consent changes.
CREATE TABLE IF NOT EXISTS public.global_sms_consent_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_id uuid NOT NULL REFERENCES public.global_sms_consent(id) ON DELETE CASCADE,
  phone_number text NOT NULL,
  action text NOT NULL CHECK (action IN ('opt_in', 'opt_out', 'status_change', 'created')),
  method text,
  keyword text,
  previous_status text,
  new_status text,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  source text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_global_sms_consent_log_phone_created_at
  ON public.global_sms_consent_log(phone_number, created_at DESC);

ALTER TABLE public.global_sms_consent_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.global_sms_consent_log FROM anon;
REVOKE ALL ON TABLE public.global_sms_consent_log FROM authenticated;

-- Sync a global consent status into tenant sms_consent rows for matching contact phones.
CREATE OR REPLACE FUNCTION public.sync_tenant_sms_consent_from_global_phone(
  p_phone_number text,
  p_contact_name text DEFAULT NULL,
  p_source text DEFAULT 'global_sms_consent_sync'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone text;
  v_global public.global_sms_consent%ROWTYPE;
  v_existing_id uuid;
  v_existing_status text;
  v_consent_id uuid;
  v_synced_count integer := 0;
  v_action text;
  r record;
BEGIN
  v_phone := public.normalize_sms_phone_e164ish(p_phone_number);
  IF v_phone IS NULL THEN
    RETURN jsonb_build_object('success', false, 'reason', 'invalid_phone');
  END IF;

  SELECT *
    INTO v_global
    FROM public.global_sms_consent
   WHERE phone_number = v_phone;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'reason', 'global_consent_not_found',
      'phone_number', v_phone
    );
  END IF;

  FOR r IN
    SELECT DISTINCT
      m.tenant_id,
      m.account_id,
      m.contact_name
    FROM (
      SELECT
        a.tenant_id,
        a.id AS account_id,
        COALESCE(
          NULLIF(BTRIM(a.primary_contact_name), ''),
          NULLIF(BTRIM(a.billing_contact_name), ''),
          NULLIF(BTRIM(p_contact_name), '')
        ) AS contact_name
      FROM public.accounts a
      WHERE a.deleted_at IS NULL
        AND (
          public.normalize_sms_phone_e164ish(a.primary_contact_phone) = v_phone
          OR public.normalize_sms_phone_e164ish(a.billing_contact_phone) = v_phone
        )

      UNION ALL

      SELECT
        cpu.tenant_id,
        cpu.account_id,
        COALESCE(
          NULLIF(BTRIM(CONCAT_WS(' ', cpu.first_name, cpu.last_name)), ''),
          NULLIF(BTRIM(p_contact_name), '')
        ) AS contact_name
      FROM public.client_portal_users cpu
      WHERE COALESCE(cpu.is_active, true) = true
        AND public.normalize_sms_phone_e164ish(cpu.phone) = v_phone
    ) m
  LOOP
    SELECT sc.id, sc.status
      INTO v_existing_id, v_existing_status
      FROM public.sms_consent sc
     WHERE sc.tenant_id = r.tenant_id
       AND sc.phone_number = v_phone
     LIMIT 1;

    INSERT INTO public.sms_consent (
      tenant_id,
      phone_number,
      account_id,
      contact_name,
      status,
      consent_method,
      opted_in_at,
      opted_out_at,
      last_keyword,
      created_by
    )
    VALUES (
      r.tenant_id,
      v_phone,
      r.account_id,
      r.contact_name,
      v_global.status,
      COALESCE(v_global.consent_method, 'web_form'),
      v_global.opted_in_at,
      v_global.opted_out_at,
      CASE WHEN v_global.status = 'opted_out' THEN COALESCE(v_global.last_keyword, 'STOP') ELSE NULL END,
      NULL
    )
    ON CONFLICT (tenant_id, phone_number) DO UPDATE
      SET account_id = COALESCE(EXCLUDED.account_id, sms_consent.account_id),
          contact_name = COALESCE(EXCLUDED.contact_name, sms_consent.contact_name),
          status = EXCLUDED.status,
          consent_method = EXCLUDED.consent_method,
          opted_in_at = EXCLUDED.opted_in_at,
          opted_out_at = EXCLUDED.opted_out_at,
          last_keyword = EXCLUDED.last_keyword
    RETURNING id INTO v_consent_id;

    IF v_existing_id IS NULL OR v_existing_status IS DISTINCT FROM v_global.status THEN
      v_action := CASE
        WHEN v_existing_id IS NULL THEN 'created'
        WHEN v_global.status = 'opted_in' THEN 'opt_in'
        WHEN v_global.status = 'opted_out' THEN 'opt_out'
        ELSE 'status_change'
      END;

      INSERT INTO public.sms_consent_log (
        tenant_id,
        consent_id,
        phone_number,
        action,
        method,
        keyword,
        previous_status,
        new_status,
        actor_user_id,
        actor_name
      )
      VALUES (
        r.tenant_id,
        v_consent_id,
        v_phone,
        v_action,
        COALESCE(v_global.consent_method, 'web_form'),
        CASE WHEN v_global.status = 'opted_out' THEN COALESCE(v_global.last_keyword, 'STOP') ELSE NULL END,
        v_existing_status,
        v_global.status,
        NULL,
        p_source
      );
    END IF;

    v_synced_count := v_synced_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'phone_number', v_phone,
    'status', v_global.status,
    'synced_tenant_count', v_synced_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_tenant_sms_consent_from_global_phone(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_tenant_sms_consent_from_global_phone(text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sync_tenant_sms_consent_from_global_phone(text, text, text) TO service_role;

-- Keep tenant sms_consent in sync when account/contact phone assignments change.
CREATE OR REPLACE FUNCTION public.trg_sync_sms_consent_from_account_phone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR COALESCE(NEW.primary_contact_phone, '') IS DISTINCT FROM COALESCE(OLD.primary_contact_phone, '')
     OR COALESCE(NEW.billing_contact_phone, '') IS DISTINCT FROM COALESCE(OLD.billing_contact_phone, '')
  THEN
    PERFORM public.sync_tenant_sms_consent_from_global_phone(
      NEW.primary_contact_phone,
      COALESCE(NEW.primary_contact_name, NEW.billing_contact_name),
      'accounts_phone_trigger'
    );

    PERFORM public.sync_tenant_sms_consent_from_global_phone(
      NEW.billing_contact_phone,
      COALESCE(NEW.billing_contact_name, NEW.primary_contact_name),
      'accounts_phone_trigger'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_sms_consent_from_account_phone ON public.accounts;
CREATE TRIGGER trg_sync_sms_consent_from_account_phone
  AFTER INSERT OR UPDATE OF primary_contact_phone, billing_contact_phone
  ON public.accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_sms_consent_from_account_phone();

CREATE OR REPLACE FUNCTION public.trg_sync_sms_consent_from_portal_phone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT'
     OR COALESCE(NEW.phone, '') IS DISTINCT FROM COALESCE(OLD.phone, '')
  THEN
    PERFORM public.sync_tenant_sms_consent_from_global_phone(
      NEW.phone,
      NULLIF(BTRIM(CONCAT_WS(' ', NEW.first_name, NEW.last_name)), ''),
      'client_portal_users_phone_trigger'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_sms_consent_from_portal_phone ON public.client_portal_users;
CREATE TRIGGER trg_sync_sms_consent_from_portal_phone
  AFTER INSERT OR UPDATE OF phone
  ON public.client_portal_users
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_sync_sms_consent_from_portal_phone();

-- Backfill tenant sms_consent rows from any pre-existing global consent records.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT phone_number FROM public.global_sms_consent LOOP
    PERFORM public.sync_tenant_sms_consent_from_global_phone(
      r.phone_number,
      NULL,
      'migration_backfill'
    );
  END LOOP;
END;
$$;

