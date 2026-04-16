-- Step 1: Drop all three FK constraints
ALTER TABLE public.quote_class_service_selections
  DROP CONSTRAINT IF EXISTS quote_class_service_selections_service_id_fkey;
ALTER TABLE public.quote_selected_services
  DROP CONSTRAINT IF EXISTS quote_selected_services_service_id_fkey;
ALTER TABLE public.quote_rate_overrides
  DROP CONSTRAINT IF EXISTS quote_rate_overrides_service_id_fkey;

-- Step 2: Build FULL mapping from ALL service_events IDs to charge_types IDs
CREATE TEMP TABLE se_to_ct_map AS
SELECT se.id as se_id, ct.id as ct_id
FROM service_events se
JOIN charge_types ct ON ct.charge_code = se.service_code AND ct.tenant_id = se.tenant_id AND ct.deleted_at IS NULL;

-- Step 3: Delete duplicates from quote_class_service_selections
DELETE FROM public.quote_class_service_selections
WHERE id IN (
  SELECT id FROM (
    SELECT css.id,
      ROW_NUMBER() OVER (PARTITION BY css.quote_id, css.class_id, m.ct_id ORDER BY css.qty_override DESC NULLS LAST, css.created_at) as rn
    FROM public.quote_class_service_selections css
    JOIN se_to_ct_map m ON m.se_id = css.service_id
  ) sub WHERE rn > 1
);

-- Update mapped rows
UPDATE public.quote_class_service_selections css SET service_id = m.ct_id
FROM se_to_ct_map m WHERE css.service_id = m.se_id;

-- Delete orphan rows (service_events that have no charge_types match)
DELETE FROM public.quote_class_service_selections
WHERE NOT EXISTS (SELECT 1 FROM charge_types ct WHERE ct.id = service_id);

-- Step 4: Delete duplicates from quote_selected_services  
DELETE FROM public.quote_selected_services
WHERE id IN (
  SELECT id FROM (
    SELECT qss.id,
      ROW_NUMBER() OVER (PARTITION BY qss.quote_id, m.ct_id ORDER BY qss.created_at) as rn
    FROM public.quote_selected_services qss
    JOIN se_to_ct_map m ON m.se_id = qss.service_id
  ) sub WHERE rn > 1
);

UPDATE public.quote_selected_services qss SET service_id = m.ct_id
FROM se_to_ct_map m WHERE qss.service_id = m.se_id;

-- Delete orphan rows
DELETE FROM public.quote_selected_services
WHERE NOT EXISTS (SELECT 1 FROM charge_types ct WHERE ct.id = service_id);

-- Step 5: Delete duplicates from quote_rate_overrides
DELETE FROM public.quote_rate_overrides
WHERE id IN (
  SELECT id FROM (
    SELECT qro.id,
      ROW_NUMBER() OVER (PARTITION BY qro.quote_id, m.ct_id, qro.class_id ORDER BY qro.created_at) as rn
    FROM public.quote_rate_overrides qro
    JOIN se_to_ct_map m ON m.se_id = qro.service_id
  ) sub WHERE rn > 1
);

UPDATE public.quote_rate_overrides qro SET service_id = m.ct_id
FROM se_to_ct_map m WHERE qro.service_id = m.se_id;

DELETE FROM public.quote_rate_overrides
WHERE NOT EXISTS (SELECT 1 FROM charge_types ct WHERE ct.id = service_id);

-- Step 6: Re-add FK constraints to charge_types
ALTER TABLE public.quote_class_service_selections
  ADD CONSTRAINT quote_class_service_selections_service_id_fkey
  FOREIGN KEY (service_id) REFERENCES public.charge_types(id) ON DELETE RESTRICT;

ALTER TABLE public.quote_selected_services
  ADD CONSTRAINT quote_selected_services_service_id_fkey
  FOREIGN KEY (service_id) REFERENCES public.charge_types(id) ON DELETE RESTRICT;

ALTER TABLE public.quote_rate_overrides
  ADD CONSTRAINT quote_rate_overrides_service_id_fkey
  FOREIGN KEY (service_id) REFERENCES public.charge_types(id) ON DELETE CASCADE;

DROP TABLE IF EXISTS se_to_ct_map;