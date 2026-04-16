-- Repair Quotes Single-Item Enforcement + Office Pricing
-- This migration adds office pricing fields and ensures single-item quotes

-- =============================================================================
-- Add Office Pricing Fields to repair_quotes
-- =============================================================================
DO $$
BEGIN
  -- Add customer_price (final client price, set by office)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'repair_quotes' AND column_name = 'customer_price')
  THEN
    ALTER TABLE repair_quotes ADD COLUMN customer_price numeric;
  END IF;

  -- Add internal_cost (optional internal cost tracking)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'repair_quotes' AND column_name = 'internal_cost')
  THEN
    ALTER TABLE repair_quotes ADD COLUMN internal_cost numeric;
  END IF;

  -- Add office_notes (admin/manager notes)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'repair_quotes' AND column_name = 'office_notes')
  THEN
    ALTER TABLE repair_quotes ADD COLUMN office_notes text;
  END IF;

  -- Add pricing_locked (lock after sending to client)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'repair_quotes' AND column_name = 'pricing_locked')
  THEN
    ALTER TABLE repair_quotes ADD COLUMN pricing_locked boolean DEFAULT false;
  END IF;

  -- Add repair_task_id (link to created repair task after acceptance)
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'repair_quotes' AND column_name = 'repair_task_id')
  THEN
    ALTER TABLE repair_quotes ADD COLUMN repair_task_id uuid REFERENCES tasks(id);
  END IF;
END $$;

-- =============================================================================
-- Create index for repair_task_id lookup
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_repair_quotes_repair_task_id ON repair_quotes(repair_task_id);

-- =============================================================================
-- Function to auto-create repair task when quote is accepted
-- =============================================================================
CREATE OR REPLACE FUNCTION create_repair_task_on_quote_acceptance()
RETURNS TRIGGER AS $$
DECLARE
  v_item RECORD;
  v_task_id uuid;
BEGIN
  -- Only trigger on status change to 'accepted'
  IF NEW.status = 'accepted' AND (OLD.status IS NULL OR OLD.status != 'accepted') THEN
    -- Check if repair task already exists
    IF NEW.repair_task_id IS NOT NULL THEN
      RETURN NEW;
    END IF;

    -- Get item details
    SELECT * INTO v_item FROM items WHERE id = NEW.item_id;

    IF v_item IS NULL THEN
      RAISE EXCEPTION 'Item not found for repair quote';
    END IF;

    -- Create the repair task
    INSERT INTO tasks (
      tenant_id,
      warehouse_id,
      account_id,
      title,
      task_type,
      status,
      related_item_id,
      sidemark,
      metadata,
      created_at,
      updated_at
    ) VALUES (
      NEW.tenant_id,
      v_item.warehouse_id,
      NEW.account_id,
      'Repair - ' || COALESCE(v_item.item_code, 'Item'),
      'Repair',
      'pending',
      NEW.item_id,
      v_item.sidemark,
      jsonb_build_object(
        'repair_quote_id', NEW.id,
        'customer_price', NEW.customer_price,
        'auto_created', true
      ),
      now(),
      now()
    )
    RETURNING id INTO v_task_id;

    -- Create task_items record (single item)
    INSERT INTO task_items (task_id, item_id)
    VALUES (v_task_id, NEW.item_id);

    -- Update the quote with the task id
    NEW.repair_task_id := v_task_id;

    -- Lock pricing after acceptance
    NEW.pricing_locked := true;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if exists and recreate
DROP TRIGGER IF EXISTS repair_quote_acceptance_trigger ON repair_quotes;

CREATE TRIGGER repair_quote_acceptance_trigger
  BEFORE UPDATE ON repair_quotes
  FOR EACH ROW
  EXECUTE FUNCTION create_repair_task_on_quote_acceptance();

-- =============================================================================
-- Validation function to ensure single-item repair quotes
-- =============================================================================
CREATE OR REPLACE FUNCTION validate_repair_quote_single_item()
RETURNS TRIGGER AS $$
BEGIN
  -- Ensure item_id is set (NOT NULL already enforced by schema, but double-check)
  IF NEW.item_id IS NULL THEN
    RAISE EXCEPTION 'Repair quotes must be associated with exactly one item';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply validation trigger
DROP TRIGGER IF EXISTS repair_quote_single_item_check ON repair_quotes;

CREATE TRIGGER repair_quote_single_item_check
  BEFORE INSERT OR UPDATE ON repair_quotes
  FOR EACH ROW
  EXECUTE FUNCTION validate_repair_quote_single_item();

-- =============================================================================
-- Function to check for existing open quotes on an item
-- =============================================================================
CREATE OR REPLACE FUNCTION check_existing_repair_quote(
  p_item_id uuid,
  p_tenant_id uuid
)
RETURNS jsonb AS $$
DECLARE
  v_existing_quote RECORD;
BEGIN
  -- Find any open quote for this item
  SELECT id, status INTO v_existing_quote
  FROM repair_quotes
  WHERE item_id = p_item_id
    AND tenant_id = p_tenant_id
    AND status NOT IN ('declined', 'closed', 'expired', 'cancelled')
  LIMIT 1;

  IF v_existing_quote.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'exists', true,
      'quote_id', v_existing_quote.id,
      'status', v_existing_quote.status
    );
  END IF;

  RETURN jsonb_build_object('exists', false);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================================
-- Function to create repair quote from client request
-- =============================================================================
CREATE OR REPLACE FUNCTION create_client_repair_quote_request(
  p_item_id uuid,
  p_account_id uuid,
  p_tenant_id uuid,
  p_source_task_id uuid DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
  v_existing jsonb;
  v_quote_id uuid;
  v_item RECORD;
BEGIN
  -- Check for existing open quote
  v_existing := check_existing_repair_quote(p_item_id, p_tenant_id);

  IF (v_existing->>'exists')::boolean THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'An open quote already exists for this item',
      'existing_quote_id', v_existing->>'quote_id'
    );
  END IF;

  -- Get item details
  SELECT * INTO v_item FROM items WHERE id = p_item_id;

  IF v_item IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'Item not found'
    );
  END IF;

  -- Create the quote request
  INSERT INTO repair_quotes (
    tenant_id,
    account_id,
    item_id,
    sidemark_id,
    source_task_id,
    status,
    notes,
    audit_log,
    created_at,
    updated_at
  ) VALUES (
    p_tenant_id,
    p_account_id,
    p_item_id,
    v_item.sidemark_id,
    p_source_task_id,
    'awaiting_assignment',
    p_notes,
    jsonb_build_array(
      jsonb_build_object(
        'action', 'created',
        'at', now(),
        'by_type', 'client',
        'details', jsonb_build_object('source', 'client_request')
      )
    ),
    now(),
    now()
  )
  RETURNING id INTO v_quote_id;

  RETURN jsonb_build_object(
    'success', true,
    'quote_id', v_quote_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
