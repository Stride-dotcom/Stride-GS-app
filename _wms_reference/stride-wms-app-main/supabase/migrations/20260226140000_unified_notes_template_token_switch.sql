-- =============================================================================
-- Unified Notes Token Switch for system templates
-- =============================================================================
-- Replaces legacy generic note placeholders (e.g. [[notes]], [[task_notes]])
-- with explicit unified note tokens by entity + audience:
--   [[entity.internal_notes]] / [[entity.public_notes]] / [[entity.exception_notes]]
-- =============================================================================

CREATE OR REPLACE FUNCTION public._replace_legacy_note_placeholders(
  p_input text,
  p_replacement text
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_result text := coalesce(p_input, '');
BEGIN
  IF p_replacement IS NULL OR btrim(p_replacement) = '' THEN
    RETURN v_result;
  END IF;

  -- [[...]]
  v_result := regexp_replace(
    v_result,
    '\[\[(?:notes|task[._]notes|shipment[._]notes|item[._]notes|claim[._]notes|quote[._]notes|stocktake[._]notes|repair_quote[._]notes)\]\]',
    p_replacement,
    'gi'
  );

  -- {{...}}
  v_result := regexp_replace(
    v_result,
    '\{\{(?:notes|task[._]notes|shipment[._]notes|item[._]notes|claim[._]notes|quote[._]notes|stocktake[._]notes|repair_quote[._]notes)\}\}',
    p_replacement,
    'gi'
  );

  -- { ... } single-brace fallback
  v_result := regexp_replace(
    v_result,
    '(?<!\{)\{(?:notes|task[._]notes|shipment[._]notes|item[._]notes|claim[._]notes|quote[._]notes|stocktake[._]notes|repair_quote[._]notes)\}(?!\})',
    p_replacement,
    'gi'
  );

  RETURN v_result;
END;
$$;

WITH template_scope AS (
  SELECT
    ct.id,
    ca.trigger_event,
    coalesce(ctc.audience, 'internal') AS audience,
    CASE
      WHEN ca.trigger_event LIKE 'task%' OR ca.trigger_event LIKE 'inspection%' THEN 'task'
      WHEN ca.trigger_event LIKE 'shipment%'
        OR ca.trigger_event LIKE 'receiving.%'
        OR ca.trigger_event LIKE 'will_call%'
        OR ca.trigger_event LIKE 'release.%'
      THEN 'shipment'
      WHEN ca.trigger_event LIKE 'claim%' OR ca.trigger_event LIKE 'client.claim%' THEN 'claim'
      WHEN ca.trigger_event LIKE 'item%' THEN 'item'
      WHEN ca.trigger_event LIKE 'stocktake%' THEN 'stocktake'
      WHEN ca.trigger_event LIKE 'repair.%' THEN 'repair_quote'
      WHEN ca.trigger_event LIKE 'quote%' THEN 'quote'
      ELSE NULL
    END AS entity_token
  FROM public.communication_templates ct
  JOIN public.communication_alerts ca
    ON ca.id = ct.alert_id
  LEFT JOIN public.communication_trigger_catalog ctc
    ON ctc.key = ca.trigger_event
),
replacements AS (
  SELECT
    ts.id,
    CASE
      WHEN ts.entity_token IS NULL THEN NULL
      WHEN ts.entity_token = 'shipment' AND ts.trigger_event ILIKE '%exception%'
        THEN '[[shipment.exception_notes]]'
      WHEN ts.audience = 'internal'
        THEN format('[[%s.internal_notes]]', ts.entity_token)
      WHEN ts.audience = 'client'
        THEN format('[[%s.public_notes]]', ts.entity_token)
      ELSE
        format('[[%s.public_notes]]', ts.entity_token)
    END AS replacement_token
  FROM template_scope ts
)
UPDATE public.communication_templates ct
SET
  subject_template = public._replace_legacy_note_placeholders(ct.subject_template, r.replacement_token),
  body_template = public._replace_legacy_note_placeholders(ct.body_template, r.replacement_token),
  updated_at = now()
FROM replacements r
WHERE ct.id = r.id
  AND r.replacement_token IS NOT NULL
  AND (
    public._replace_legacy_note_placeholders(ct.subject_template, r.replacement_token) IS DISTINCT FROM ct.subject_template
    OR public._replace_legacy_note_placeholders(ct.body_template, r.replacement_token) IS DISTINCT FROM ct.body_template
  );

