-- =============================================================================
-- SMS usage metering pipeline + system callback lifecycle updates
-- Migration: 20260225101000_sms_usage_metering_and_callbacks.sql
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) Raw SMS usage events (Twilio inbound/outbound)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sms_usage_events (
  id                                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                         uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  direction                         text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  provider                          text NOT NULL DEFAULT 'twilio' CHECK (provider IN ('twilio')),
  twilio_account_sid                text,
  twilio_message_sid                text,
  from_phone                        text,
  to_phone                          text,
  message_status                    text,
  segment_count                     integer NOT NULL DEFAULT 1 CHECK (segment_count >= 0),
  segment_count_source              text NOT NULL DEFAULT 'estimated'
                                      CHECK (segment_count_source IN ('estimated', 'twilio_api', 'twilio_callback')),
  billable                          boolean NOT NULL DEFAULT true,
  occurred_at                       timestamptz NOT NULL DEFAULT now(),
  aggregated_at                     timestamptz,
  aggregated_message_count          integer NOT NULL DEFAULT 0 CHECK (aggregated_message_count >= 0),
  aggregated_segment_count          integer NOT NULL DEFAULT 0 CHECK (aggregated_segment_count >= 0),
  aggregated_twilio_segment_count   integer NOT NULL DEFAULT 0 CHECK (aggregated_twilio_segment_count >= 0),
  aggregated_estimated_segment_count integer NOT NULL DEFAULT 0 CHECK (aggregated_estimated_segment_count >= 0),
  needs_reconciliation              boolean NOT NULL DEFAULT false,
  metadata                          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                        timestamptz NOT NULL DEFAULT now(),
  updated_at                        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sms_usage_events_twilio_message_sid
  ON public.sms_usage_events (twilio_message_sid)
  WHERE twilio_message_sid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sms_usage_events_tenant_occurred_at
  ON public.sms_usage_events (tenant_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_usage_events_needs_rollup
  ON public.sms_usage_events (tenant_id, occurred_at ASC)
  WHERE aggregated_at IS NULL OR needs_reconciliation = true;

DROP TRIGGER IF EXISTS set_sms_usage_events_updated_at ON public.sms_usage_events;
CREATE TRIGGER set_sms_usage_events_updated_at
  BEFORE UPDATE ON public.sms_usage_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.sms_usage_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sms_usage_events_select_own_or_admin_dev" ON public.sms_usage_events;
CREATE POLICY "sms_usage_events_select_own_or_admin_dev"
  ON public.sms_usage_events FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.user_tenant_id()
    OR public.current_user_is_admin_dev()
  );

-- ---------------------------------------------------------------------------
-- 2) Daily SMS usage rollups (for billing/meter export)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sms_usage_daily_rollups (
  id                           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  usage_date                   date NOT NULL,
  direction                    text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_count                integer NOT NULL DEFAULT 0,
  segment_count                integer NOT NULL DEFAULT 0,
  twilio_exact_segment_count   integer NOT NULL DEFAULT 0,
  estimated_segment_count      integer NOT NULL DEFAULT 0,
  first_event_at               timestamptz,
  last_event_at                timestamptz,
  last_aggregated_at           timestamptz NOT NULL DEFAULT now(),
  metadata                     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  updated_at                   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, usage_date, direction)
);

CREATE INDEX IF NOT EXISTS idx_sms_usage_daily_rollups_tenant_date
  ON public.sms_usage_daily_rollups (tenant_id, usage_date DESC, direction);

DROP TRIGGER IF EXISTS set_sms_usage_daily_rollups_updated_at ON public.sms_usage_daily_rollups;
CREATE TRIGGER set_sms_usage_daily_rollups_updated_at
  BEFORE UPDATE ON public.sms_usage_daily_rollups
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.sms_usage_daily_rollups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sms_usage_daily_rollups_select_own_or_admin_dev" ON public.sms_usage_daily_rollups;
CREATE POLICY "sms_usage_daily_rollups_select_own_or_admin_dev"
  ON public.sms_usage_daily_rollups FOR SELECT
  TO authenticated
  USING (
    tenant_id = public.user_tenant_id()
    OR public.current_user_is_admin_dev()
  );

-- ---------------------------------------------------------------------------
-- 3) Service-role sender lifecycle updates (for Twilio callbacks/workers)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_system_set_sms_sender_status(
  p_tenant_id uuid,
  p_status text,
  p_twilio_phone_number_sid text DEFAULT NULL,
  p_twilio_phone_number_e164 text DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_source text DEFAULT 'system_callback',
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing_status text;
  v_event_type text;
  v_sms_addon_active boolean := false;
  v_enable_sms boolean := false;
  v_row public.tenant_sms_sender_profiles%ROWTYPE;
  v_source text := COALESCE(NULLIF(BTRIM(p_source), ''), 'system_callback');
  v_payload jsonb := COALESCE(p_metadata, '{}'::jsonb);
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id is required';
  END IF;

  IF COALESCE(BTRIM(p_status), '') NOT IN ('requested', 'provisioning', 'pending_verification', 'approved', 'rejected', 'disabled') THEN
    RAISE EXCEPTION 'Invalid sender status';
  END IF;

  SELECT provisioning_status
    INTO v_existing_status
    FROM public.tenant_sms_sender_profiles
   WHERE tenant_id = p_tenant_id;

  INSERT INTO public.tenant_sms_sender_profiles (
    tenant_id,
    sender_type,
    provisioning_status,
    requested_at,
    requested_by,
    twilio_phone_number_sid,
    twilio_phone_number_e164,
    verification_submitted_at,
    verification_approved_at,
    verification_rejected_at,
    billing_start_at,
    last_error
  ) VALUES (
    p_tenant_id,
    'toll_free',
    BTRIM(p_status),
    CASE WHEN BTRIM(p_status) = 'requested' THEN now() ELSE NULL END,
    NULL,
    NULLIF(BTRIM(p_twilio_phone_number_sid), ''),
    NULLIF(BTRIM(p_twilio_phone_number_e164), ''),
    CASE WHEN BTRIM(p_status) = 'pending_verification' THEN now() ELSE NULL END,
    CASE WHEN BTRIM(p_status) = 'approved' THEN now() ELSE NULL END,
    CASE WHEN BTRIM(p_status) = 'rejected' THEN now() ELSE NULL END,
    CASE WHEN BTRIM(p_status) = 'approved' THEN now() ELSE NULL END,
    CASE WHEN BTRIM(p_status) = 'rejected' THEN NULLIF(BTRIM(p_error), '') ELSE NULL END
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    provisioning_status = BTRIM(p_status),
    twilio_phone_number_sid = COALESCE(
      NULLIF(BTRIM(p_twilio_phone_number_sid), ''),
      public.tenant_sms_sender_profiles.twilio_phone_number_sid
    ),
    twilio_phone_number_e164 = COALESCE(
      NULLIF(BTRIM(p_twilio_phone_number_e164), ''),
      public.tenant_sms_sender_profiles.twilio_phone_number_e164
    ),
    verification_submitted_at = CASE
      WHEN BTRIM(p_status) = 'pending_verification'
        THEN COALESCE(public.tenant_sms_sender_profiles.verification_submitted_at, now())
      ELSE public.tenant_sms_sender_profiles.verification_submitted_at
    END,
    verification_approved_at = CASE
      WHEN BTRIM(p_status) = 'approved'
        THEN COALESCE(public.tenant_sms_sender_profiles.verification_approved_at, now())
      ELSE public.tenant_sms_sender_profiles.verification_approved_at
    END,
    verification_rejected_at = CASE
      WHEN BTRIM(p_status) = 'rejected'
        THEN now()
      ELSE public.tenant_sms_sender_profiles.verification_rejected_at
    END,
    billing_start_at = CASE
      WHEN BTRIM(p_status) = 'approved'
        THEN COALESCE(public.tenant_sms_sender_profiles.billing_start_at, now())
      ELSE public.tenant_sms_sender_profiles.billing_start_at
    END,
    last_error = CASE
      WHEN BTRIM(p_status) = 'rejected'
        THEN COALESCE(NULLIF(BTRIM(p_error), ''), public.tenant_sms_sender_profiles.last_error)
      WHEN BTRIM(p_status) = 'approved'
        THEN NULL
      ELSE public.tenant_sms_sender_profiles.last_error
    END
  RETURNING *
    INTO v_row;

  SELECT COALESCE(is_active, false)
    INTO v_sms_addon_active
    FROM public.tenant_sms_addon_activation
   WHERE tenant_id = p_tenant_id;

  v_enable_sms := (BTRIM(p_status) = 'approved' AND COALESCE(v_sms_addon_active, false));

  UPDATE public.tenant_company_settings
     SET sms_enabled = v_enable_sms
   WHERE tenant_id = p_tenant_id;

  v_event_type := CASE
    WHEN BTRIM(p_status) = 'approved' THEN 'verification_approved'
    WHEN BTRIM(p_status) = 'rejected' THEN 'verification_rejected'
    WHEN COALESCE(
      NULLIF(BTRIM(p_twilio_phone_number_e164), ''),
      NULLIF(BTRIM(p_twilio_phone_number_sid), '')
    ) IS NOT NULL THEN 'number_assigned'
    ELSE 'status_changed'
  END;

  INSERT INTO public.tenant_sms_sender_profile_log (
    tenant_id,
    event_type,
    actor_user_id,
    status_from,
    status_to,
    notes,
    metadata
  ) VALUES (
    p_tenant_id,
    v_event_type,
    NULL,
    COALESCE(v_existing_status, 'not_requested'),
    v_row.provisioning_status,
    NULLIF(BTRIM(p_note), ''),
    (
      jsonb_build_object(
        'performed_by_role', 'system',
        'source', v_source,
        'sms_addon_active', v_sms_addon_active,
        'sms_enabled_set_to', v_enable_sms,
        'error', NULLIF(BTRIM(p_error), '')
      ) || v_payload
    )
  );

  RETURN jsonb_build_object(
    'tenant_id', v_row.tenant_id,
    'sender_type', v_row.sender_type,
    'provisioning_status', v_row.provisioning_status,
    'twilio_phone_number_sid', v_row.twilio_phone_number_sid,
    'twilio_phone_number_e164', v_row.twilio_phone_number_e164,
    'requested_at', v_row.requested_at,
    'verification_submitted_at', v_row.verification_submitted_at,
    'verification_approved_at', v_row.verification_approved_at,
    'verification_rejected_at', v_row.verification_rejected_at,
    'billing_start_at', v_row.billing_start_at,
    'last_error', v_row.last_error,
    'updated_at', v_row.updated_at,
    'sms_enabled', v_enable_sms
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_system_set_sms_sender_status(
  uuid, text, text, text, text, text, text, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rpc_system_set_sms_sender_status(
  uuid, text, text, text, text, text, text, jsonb
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_system_set_sms_sender_status(
  uuid, text, text, text, text, text, text, jsonb
) TO service_role;

-- ---------------------------------------------------------------------------
-- 4) SMS metering rollup worker RPC (admin_dev + service_role)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_admin_rollup_sms_usage_events(
  p_tenant_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer;
  v_is_service_role boolean := false;
  v_is_admin_dev boolean := false;
  v_attempted integer := 0;
  v_delta_rows integer := 0;
  v_rollup_rows integer := 0;
  v_total_segment_delta bigint := 0;
  v_total_message_delta bigint := 0;
BEGIN
  v_is_service_role := COALESCE(auth.jwt() ->> 'role', '') = 'service_role';
  v_is_admin_dev := public.current_user_is_admin_dev();

  IF NOT v_is_service_role AND NOT v_is_admin_dev THEN
    RAISE EXCEPTION 'Only admin_dev or service_role can run SMS usage rollups';
  END IF;

  v_limit := LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 20000);

  WITH target AS (
    SELECT
      e.id,
      e.tenant_id,
      (timezone('UTC', e.occurred_at))::date AS usage_date,
      e.direction,
      e.occurred_at,
      CASE WHEN e.billable THEN 1 ELSE 0 END AS current_message_count,
      CASE WHEN e.billable THEN e.segment_count ELSE 0 END AS current_segment_count,
      CASE
        WHEN e.billable AND e.segment_count_source IN ('twilio_api', 'twilio_callback') THEN e.segment_count
        ELSE 0
      END AS current_twilio_segments,
      CASE
        WHEN e.billable AND e.segment_count_source = 'estimated' THEN e.segment_count
        ELSE 0
      END AS current_estimated_segments,
      COALESCE(e.aggregated_message_count, 0) AS previous_message_count,
      COALESCE(e.aggregated_segment_count, 0) AS previous_segment_count,
      COALESCE(e.aggregated_twilio_segment_count, 0) AS previous_twilio_segments,
      COALESCE(e.aggregated_estimated_segment_count, 0) AS previous_estimated_segments
    FROM public.sms_usage_events e
    WHERE
      (e.aggregated_at IS NULL OR e.needs_reconciliation = true)
      AND (p_tenant_id IS NULL OR e.tenant_id = p_tenant_id)
    ORDER BY e.occurred_at ASC, e.created_at ASC, e.id ASC
    LIMIT v_limit
  ),
  deltas AS (
    SELECT
      t.*,
      (t.current_message_count - t.previous_message_count) AS delta_messages,
      (t.current_segment_count - t.previous_segment_count) AS delta_segments,
      (t.current_twilio_segments - t.previous_twilio_segments) AS delta_twilio_segments,
      (t.current_estimated_segments - t.previous_estimated_segments) AS delta_estimated_segments
    FROM target t
  ),
  grouped AS (
    SELECT
      d.tenant_id,
      d.usage_date,
      d.direction,
      SUM(d.delta_messages)::integer AS delta_messages,
      SUM(d.delta_segments)::integer AS delta_segments,
      SUM(d.delta_twilio_segments)::integer AS delta_twilio_segments,
      SUM(d.delta_estimated_segments)::integer AS delta_estimated_segments,
      MIN(d.occurred_at) AS first_event_at,
      MAX(d.occurred_at) AS last_event_at
    FROM deltas d
    WHERE
      d.delta_messages <> 0
      OR d.delta_segments <> 0
      OR d.delta_twilio_segments <> 0
      OR d.delta_estimated_segments <> 0
    GROUP BY d.tenant_id, d.usage_date, d.direction
  ),
  upsert_rollups AS (
    INSERT INTO public.sms_usage_daily_rollups (
      tenant_id,
      usage_date,
      direction,
      message_count,
      segment_count,
      twilio_exact_segment_count,
      estimated_segment_count,
      first_event_at,
      last_event_at,
      last_aggregated_at,
      metadata
    )
    SELECT
      g.tenant_id,
      g.usage_date,
      g.direction,
      g.delta_messages,
      g.delta_segments,
      g.delta_twilio_segments,
      g.delta_estimated_segments,
      g.first_event_at,
      g.last_event_at,
      now(),
      jsonb_build_object('rollup_source', 'rpc_admin_rollup_sms_usage_events')
    FROM grouped g
    ON CONFLICT (tenant_id, usage_date, direction) DO UPDATE SET
      message_count = GREATEST(0, public.sms_usage_daily_rollups.message_count + EXCLUDED.message_count),
      segment_count = GREATEST(0, public.sms_usage_daily_rollups.segment_count + EXCLUDED.segment_count),
      twilio_exact_segment_count = GREATEST(
        0,
        public.sms_usage_daily_rollups.twilio_exact_segment_count + EXCLUDED.twilio_exact_segment_count
      ),
      estimated_segment_count = GREATEST(
        0,
        public.sms_usage_daily_rollups.estimated_segment_count + EXCLUDED.estimated_segment_count
      ),
      first_event_at = CASE
        WHEN public.sms_usage_daily_rollups.first_event_at IS NULL THEN EXCLUDED.first_event_at
        WHEN EXCLUDED.first_event_at IS NULL THEN public.sms_usage_daily_rollups.first_event_at
        ELSE LEAST(public.sms_usage_daily_rollups.first_event_at, EXCLUDED.first_event_at)
      END,
      last_event_at = CASE
        WHEN public.sms_usage_daily_rollups.last_event_at IS NULL THEN EXCLUDED.last_event_at
        WHEN EXCLUDED.last_event_at IS NULL THEN public.sms_usage_daily_rollups.last_event_at
        ELSE GREATEST(public.sms_usage_daily_rollups.last_event_at, EXCLUDED.last_event_at)
      END,
      last_aggregated_at = now(),
      metadata = COALESCE(public.sms_usage_daily_rollups.metadata, '{}'::jsonb)
        || jsonb_build_object('last_rollup_source', 'rpc_admin_rollup_sms_usage_events')
  ),
  mark_events AS (
    UPDATE public.sms_usage_events e
       SET aggregated_at = now(),
           aggregated_message_count = d.current_message_count,
           aggregated_segment_count = d.current_segment_count,
           aggregated_twilio_segment_count = d.current_twilio_segments,
           aggregated_estimated_segment_count = d.current_estimated_segments,
           needs_reconciliation = false
      FROM deltas d
     WHERE e.id = d.id
  )
  SELECT
    COALESCE((SELECT COUNT(*) FROM target), 0),
    COALESCE((SELECT COUNT(*) FROM deltas WHERE delta_messages <> 0 OR delta_segments <> 0 OR delta_twilio_segments <> 0 OR delta_estimated_segments <> 0), 0),
    COALESCE((SELECT COUNT(*) FROM grouped), 0),
    COALESCE((SELECT SUM(delta_segments)::bigint FROM grouped), 0),
    COALESCE((SELECT SUM(delta_messages)::bigint FROM grouped), 0)
  INTO
    v_attempted,
    v_delta_rows,
    v_rollup_rows,
    v_total_segment_delta,
    v_total_message_delta;

  RETURN jsonb_build_object(
    'ok', true,
    'tenant_id', p_tenant_id,
    'limit', v_limit,
    'attempted_events', v_attempted,
    'changed_events', v_delta_rows,
    'rollup_rows', v_rollup_rows,
    'segment_delta', v_total_segment_delta,
    'message_delta', v_total_message_delta
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_admin_rollup_sms_usage_events(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_admin_rollup_sms_usage_events(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_admin_rollup_sms_usage_events(uuid, integer) TO service_role;

COMMENT ON TABLE public.sms_usage_events IS
'Raw inbound/outbound SMS usage events captured from Twilio send + webhook callbacks, with reconciliation fields.';
COMMENT ON TABLE public.sms_usage_daily_rollups IS
'Daily tenant SMS segment/message rollups from sms_usage_events for billing and provider reconciliation.';
COMMENT ON FUNCTION public.rpc_system_set_sms_sender_status(
  uuid, text, text, text, text, text, text, jsonb
) IS
'Service-role lifecycle transition RPC for platform-managed SMS sender status updates from automated callbacks/workers.';
COMMENT ON FUNCTION public.rpc_admin_rollup_sms_usage_events(uuid, integer) IS
'Roll up unreconciled SMS usage events into daily tenant aggregates (admin_dev + service_role).';
