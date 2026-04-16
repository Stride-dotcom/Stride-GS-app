-- Fix: pricing_rules missing unique index needed for upsert; also make backfill idempotent for NULL class_code

-- 1) Add unique index to support ON CONFLICT (safe: we verified no duplicates)
CREATE UNIQUE INDEX IF NOT EXISTS pricing_rules_charge_type_class_uidx
  ON public.pricing_rules (charge_type_id, class_code);

-- 2) Re-run backfill (safe) with NULL-safe upsert logic
DO $$
DECLARE
  rec RECORD;
  mapped_trigger TEXT;
  mapped_unit TEXT;
  mapped_category TEXT;
  mapped_input_mode TEXT;
  ct_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='service_events'
  ) THEN
    RAISE NOTICE 'Skipping backfill: public.service_events does not exist';
    RETURN;
  END IF;

  -- Ensure charge_types exist
  FOR rec IN
    SELECT DISTINCT ON (tenant_id, service_code)
      tenant_id,
      service_code,
      service_name,
      billing_unit,
      billing_trigger,
      service_time_minutes,
      taxable,
      is_active,
      add_flag,
      add_to_service_event_scan,
      alert_rule,
      notes
    FROM public.service_events
    WHERE tenant_id IS NOT NULL
      AND service_code IS NOT NULL
    ORDER BY tenant_id, service_code, (class_code IS NULL) DESC, created_at
  LOOP
    mapped_trigger := CASE
      WHEN rec.billing_trigger ILIKE '%auto%' OR rec.billing_trigger ILIKE '%calculate%' THEN 'auto'
      WHEN rec.billing_trigger ILIKE '%task%' OR rec.billing_trigger ILIKE '%completion%' THEN 'task'
      WHEN rec.billing_trigger ILIKE '%ship%' OR rec.billing_trigger ILIKE '%receive%' OR rec.billing_trigger ILIKE '%inbound%' OR rec.billing_trigger ILIKE '%outbound%' THEN 'shipment'
      WHEN rec.billing_trigger ILIKE '%storage%' OR rec.billing_trigger ILIKE '%day%' OR rec.billing_trigger ILIKE '%month%' THEN 'storage'
      ELSE 'manual'
    END;

    mapped_unit := CASE
      WHEN rec.billing_unit ILIKE '%day%' THEN 'per_day'
      WHEN rec.billing_unit ILIKE '%month%' THEN 'per_month'
      WHEN rec.billing_unit ILIKE '%hour%' THEN 'per_hour'
      WHEN rec.billing_unit ILIKE '%minute%' THEN 'per_minute'
      WHEN rec.billing_unit ILIKE '%task%' THEN 'per_task'
      WHEN rec.billing_unit ILIKE '%item%' THEN 'per_item'
      ELSE 'each'
    END;

    mapped_category := CASE
      WHEN rec.service_code ILIKE '%recv%' OR rec.service_code ILIKE '%rcvg%' OR rec.service_code ILIKE '%receive%' THEN 'receiving'
      WHEN rec.service_code ILIKE '%stor%' THEN 'storage'
      WHEN rec.service_code ILIKE '%ship%' OR rec.service_code ILIKE '%outbound%' OR rec.service_code ILIKE '%will_call%' THEN 'shipping'
      WHEN rec.service_code ILIKE '%insp%' OR rec.service_code ILIKE '%assy%' OR rec.service_code ILIKE '%repair%' THEN 'task'
      ELSE 'general'
    END;

    mapped_input_mode := CASE
      WHEN mapped_unit IN ('per_hour', 'per_minute') THEN 'time'
      WHEN rec.service_code ILIKE '%labor%' OR rec.service_code ILIKE '%hr%' THEN 'time'
      ELSE 'qty'
    END;

    SELECT id INTO ct_id
    FROM public.charge_types
    WHERE tenant_id = rec.tenant_id
      AND charge_code = rec.service_code;

    IF ct_id IS NULL THEN
      INSERT INTO public.charge_types (
        tenant_id,
        charge_code,
        charge_name,
        category,
        is_active,
        is_taxable,
        default_trigger,
        input_mode,
        add_to_scan,
        add_flag,
        alert_rule,
        notes,
        legacy_service_code
      ) VALUES (
        rec.tenant_id,
        rec.service_code,
        rec.service_name,
        mapped_category,
        rec.is_active,
        COALESCE(rec.taxable, false),
        mapped_trigger,
        mapped_input_mode,
        COALESCE(rec.add_to_service_event_scan, false),
        COALESCE(rec.add_flag, false),
        COALESCE(rec.alert_rule, 'none'),
        rec.notes,
        rec.service_code
      )
      RETURNING id INTO ct_id;
    END IF;
  END LOOP;

  -- Upsert pricing rules
  FOR rec IN
    SELECT
      sev.tenant_id,
      sev.service_code,
      sev.class_code,
      sev.rate,
      sev.billing_unit,
      sev.service_time_minutes,
      ct.id AS charge_type_id
    FROM public.service_events AS sev
    JOIN public.charge_types AS ct
      ON ct.tenant_id = sev.tenant_id
     AND ct.charge_code = sev.service_code
    WHERE sev.tenant_id IS NOT NULL
      AND ct.deleted_at IS NULL
  LOOP
    mapped_unit := CASE
      WHEN rec.billing_unit ILIKE '%day%' THEN 'per_day'
      WHEN rec.billing_unit ILIKE '%month%' THEN 'per_month'
      WHEN rec.billing_unit ILIKE '%hour%' THEN 'per_hour'
      WHEN rec.billing_unit ILIKE '%minute%' THEN 'per_minute'
      WHEN rec.billing_unit ILIKE '%task%' THEN 'per_task'
      WHEN rec.billing_unit ILIKE '%item%' THEN 'per_item'
      ELSE 'each'
    END;

    -- NULL class_code: UPDATE first (idempotent), INSERT if missing
    IF rec.class_code IS NULL THEN
      UPDATE public.pricing_rules
      SET
        tenant_id = rec.tenant_id,
        charge_type_id = rec.charge_type_id,
        pricing_method = 'flat',
        unit = mapped_unit,
        rate = COALESCE(rec.rate, 0),
        is_default = true,
        service_time_minutes = COALESCE(rec.service_time_minutes, 0),
        updated_at = now()
      WHERE charge_type_id = rec.charge_type_id
        AND class_code IS NULL
        AND deleted_at IS NULL;

      IF NOT FOUND THEN
        INSERT INTO public.pricing_rules (
          tenant_id,
          charge_type_id,
          pricing_method,
          class_code,
          unit,
          rate,
          is_default,
          service_time_minutes
        ) VALUES (
          rec.tenant_id,
          rec.charge_type_id,
          'flat',
          NULL,
          mapped_unit,
          COALESCE(rec.rate, 0),
          true,
          COALESCE(rec.service_time_minutes, 0)
        );
      END IF;

    ELSE
      INSERT INTO public.pricing_rules (
        tenant_id,
        charge_type_id,
        pricing_method,
        class_code,
        unit,
        rate,
        is_default,
        service_time_minutes
      ) VALUES (
        rec.tenant_id,
        rec.charge_type_id,
        'class_based',
        rec.class_code,
        mapped_unit,
        COALESCE(rec.rate, 0),
        false,
        COALESCE(rec.service_time_minutes, 0)
      )
      ON CONFLICT (charge_type_id, class_code) DO UPDATE SET
        rate = EXCLUDED.rate,
        unit = EXCLUDED.unit,
        service_time_minutes = EXCLUDED.service_time_minutes,
        updated_at = now();
    END IF;
  END LOOP;

  RAISE NOTICE 'Backfill complete (unique index + NULL-safe upsert)';
END $$;
