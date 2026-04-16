BEGIN;

DO $$
DECLARE
  v_tenant UUID := gen_random_uuid();
  v_id     UUID;
  v_blocked BOOLEAN := false;
BEGIN

  -- Insert draft shipment
  INSERT INTO shipments (
    id,
    tenant_id,
    shipment_type,
    inbound_kind,
    inbound_status
  )
  VALUES (
    gen_random_uuid(),
    v_tenant,
    'inbound',
    'dock_intake',
    'draft'
  )
  RETURNING id INTO v_id;

  -- Attempt illegal transition: draft → closed
  BEGIN
    UPDATE shipments
       SET inbound_status = 'closed'
     WHERE id = v_id;
  EXCEPTION
    WHEN others THEN
      v_blocked := true;
  END;

  IF NOT v_blocked THEN
    RAISE EXCEPTION 'State machine FAILED — illegal transition draft→closed was allowed';
  END IF;

  RAISE NOTICE 'State machine correctly blocked illegal transition draft→closed.';

END $$;

ROLLBACK;
