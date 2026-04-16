-- ============================================================================
-- Admin-dev coverage RPC for platform alert template library
-- - Reports coverage of active trigger catalog rows across email/sms/in_app
-- - Treats missing OR inactive channel rows as a coverage gap
-- ============================================================================

CREATE OR REPLACE FUNCTION public.rpc_admin_get_platform_template_library_coverage(
  p_include_legacy boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT public.current_user_is_admin_dev() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  WITH trigger_base AS (
    SELECT
      c.key AS trigger_event,
      c.display_name,
      c.module_group,
      (
        c.display_name ILIKE '%(legacy)%'
        OR COALESCE(c.description, '') ILIKE 'legacy trigger:%'
      ) AS is_legacy
    FROM public.communication_trigger_catalog c
    WHERE c.is_active = true
  ),
  filtered_triggers AS (
    SELECT *
    FROM trigger_base
    WHERE p_include_legacy OR NOT is_legacy
  ),
  hidden_legacy AS (
    SELECT COUNT(*)::int AS cnt
    FROM trigger_base
    WHERE NOT p_include_legacy
      AND is_legacy
  ),
  expected_channels AS (
    SELECT unnest(ARRAY['email','sms','in_app']::text[]) AS channel
  ),
  coverage AS (
    SELECT
      t.trigger_event,
      t.display_name,
      t.module_group,
      t.is_legacy,
      e.channel,
      (l.id IS NOT NULL) AS exists_row,
      COALESCE(l.is_active, false) AS is_active_row
    FROM filtered_triggers t
    CROSS JOIN expected_channels e
    LEFT JOIN public.platform_alert_template_library l
      ON l.trigger_event = t.trigger_event
     AND l.channel = e.channel
  ),
  per_trigger AS (
    SELECT
      c.trigger_event,
      c.display_name,
      c.module_group,
      c.is_legacy,
      COALESCE(
        array_agg(c.channel ORDER BY c.channel)
          FILTER (WHERE NOT c.exists_row),
        ARRAY[]::text[]
      ) AS missing_channels,
      COALESCE(
        array_agg(c.channel ORDER BY c.channel)
          FILTER (WHERE c.exists_row AND NOT c.is_active_row),
        ARRAY[]::text[]
      ) AS inactive_channels,
      COUNT(*) FILTER (WHERE c.exists_row AND c.is_active_row)::int AS active_channel_count
    FROM coverage c
    GROUP BY c.trigger_event, c.display_name, c.module_group, c.is_legacy
  ),
  channel_missing AS (
    SELECT
      c.channel,
      COUNT(*) FILTER (WHERE NOT c.exists_row OR NOT c.is_active_row)::int AS missing_count
    FROM coverage c
    GROUP BY c.channel
  ),
  summary AS (
    SELECT
      COUNT(*)::int AS total_active_triggers,
      COUNT(*) FILTER (WHERE p.active_channel_count = 3)::int AS fully_covered_triggers,
      COUNT(*) FILTER (WHERE p.active_channel_count < 3)::int AS partial_or_missing_triggers,
      COALESCE(
        SUM(
          cardinality(p.missing_channels) + cardinality(p.inactive_channels)
        )::int,
        0
      ) AS missing_template_pairs
    FROM per_trigger p
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'include_legacy', p_include_legacy,
    'hidden_legacy_triggers', COALESCE((SELECT cnt FROM hidden_legacy), 0),
    'total_active_triggers', COALESCE(s.total_active_triggers, 0),
    'fully_covered_triggers', COALESCE(s.fully_covered_triggers, 0),
    'partial_or_missing_triggers', COALESCE(s.partial_or_missing_triggers, 0),
    'missing_template_pairs', COALESCE(s.missing_template_pairs, 0),
    'missing_by_channel', jsonb_build_object(
      'email', COALESCE((SELECT missing_count FROM channel_missing WHERE channel = 'email'), 0),
      'sms', COALESCE((SELECT missing_count FROM channel_missing WHERE channel = 'sms'), 0),
      'in_app', COALESCE((SELECT missing_count FROM channel_missing WHERE channel = 'in_app'), 0)
    ),
    'triggers', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'trigger_event', p.trigger_event,
          'display_name', p.display_name,
          'module_group', p.module_group,
          'is_legacy', p.is_legacy,
          'missing_channels', to_jsonb(p.missing_channels),
          'inactive_channels', to_jsonb(p.inactive_channels),
          'active_channel_count', p.active_channel_count
        )
        ORDER BY p.module_group, p.display_name, p.trigger_event
      )
      FROM per_trigger p
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM summary s;

  RETURN COALESCE(v_result, '{}'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_admin_get_platform_template_library_coverage(boolean) TO authenticated;

