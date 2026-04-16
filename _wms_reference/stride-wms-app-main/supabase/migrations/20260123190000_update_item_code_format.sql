-- Update item_code format to be more verbal-friendly: ITM-###-####
-- Keeps codes unique while being shorter/easier to call out.

CREATE OR REPLACE FUNCTION public.generate_item_code(p_tenant_id uuid)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_next bigint;
  v_try int := 0;
  v_hash text;
  v_digits text;
  v_candidate text;
  v_exists int;
BEGIN
  LOOP
    v_try := v_try + 1;
    v_next := nextval('public.item_code_seq');

    -- Derive digits from a hash of tenant_id + sequence value.
    v_hash := md5(p_tenant_id::text || ':' || v_next::text);
    v_digits := regexp_replace(v_hash, '[^0-9]', '', 'g');

    -- Ensure we have at least 7 digits to work with.
    IF length(v_digits) < 7 THEN
      v_digits := v_digits || lpad((v_next % 10000000)::text, 7, '0');
    END IF;

    -- Take first 7 digits and format: ###-####
    v_digits := substr(v_digits, 1, 7);
    v_candidate := 'ITM-' || substr(v_digits, 1, 3) || '-' || substr(v_digits, 4, 4);

    SELECT count(*) INTO v_exists
    FROM public.items
    WHERE tenant_id = p_tenant_id AND item_code = v_candidate;

    IF v_exists = 0 THEN
      RETURN v_candidate;
    END IF;

    -- Extremely unlikely fallback path
    IF v_try >= 15 THEN
      RETURN 'ITM-' || lpad((v_next % 1000)::text, 3, '0') || '-' || lpad((v_next % 10000)::text, 4, '0');
    END IF;
  END LOOP;
END;
$$;
