-- QA Test Console Tables
-- Stores test run information and results for automated system tests

-- =============================================================================
-- QA Test Runs Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS qa_test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  warehouse_id uuid REFERENCES warehouses(id) ON DELETE SET NULL,
  executed_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  pass_count integer NOT NULL DEFAULT 0,
  fail_count integer NOT NULL DEFAULT 0,
  skip_count integer NOT NULL DEFAULT 0,
  mode text NOT NULL DEFAULT 'create_cleanup' CHECK (mode IN ('create_cleanup', 'create_only')),
  suites_requested text[] NOT NULL DEFAULT '{}',
  metadata jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- QA Test Results Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS qa_test_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES qa_test_runs(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  suite text NOT NULL,
  test_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'pass', 'fail', 'skip', 'running')),
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  error_stack text,
  details jsonb DEFAULT '{}',
  logs text,
  entity_ids jsonb DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- =============================================================================
-- Indexes
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_qa_test_runs_tenant_id ON qa_test_runs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_qa_test_runs_status ON qa_test_runs(status);
CREATE INDEX IF NOT EXISTS idx_qa_test_runs_started_at ON qa_test_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_qa_test_runs_executed_by ON qa_test_runs(executed_by);

CREATE INDEX IF NOT EXISTS idx_qa_test_results_run_id ON qa_test_results(run_id);
CREATE INDEX IF NOT EXISTS idx_qa_test_results_tenant_id ON qa_test_results(tenant_id);
CREATE INDEX IF NOT EXISTS idx_qa_test_results_suite ON qa_test_results(suite);
CREATE INDEX IF NOT EXISTS idx_qa_test_results_status ON qa_test_results(status);

-- =============================================================================
-- Row Level Security
-- =============================================================================
ALTER TABLE qa_test_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE qa_test_results ENABLE ROW LEVEL SECURITY;

-- QA Test Runs Policies
CREATE POLICY "qa_test_runs_tenant_isolation" ON qa_test_runs
  FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "qa_test_runs_admin_only" ON qa_test_runs
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('admin', 'tenant_admin', 'manager')
      AND ur.deleted_at IS NULL
    )
  );

-- QA Test Results Policies
CREATE POLICY "qa_test_results_tenant_isolation" ON qa_test_results
  FOR ALL
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "qa_test_results_admin_only" ON qa_test_results
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_roles ur
      JOIN roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('admin', 'tenant_admin', 'manager')
      AND ur.deleted_at IS NULL
    )
  );

-- =============================================================================
-- Updated At Triggers
-- =============================================================================
CREATE OR REPLACE FUNCTION update_qa_test_runs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER qa_test_runs_updated_at
  BEFORE UPDATE ON qa_test_runs
  FOR EACH ROW
  EXECUTE FUNCTION update_qa_test_runs_updated_at();

CREATE OR REPLACE FUNCTION update_qa_test_results_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER qa_test_results_updated_at
  BEFORE UPDATE ON qa_test_results
  FOR EACH ROW
  EXECUTE FUNCTION update_qa_test_results_updated_at();

-- =============================================================================
-- Helper function to cleanup QA test data by run_id
-- =============================================================================
CREATE OR REPLACE FUNCTION cleanup_qa_test_data(p_run_id uuid)
RETURNS jsonb AS $$
DECLARE
  v_deleted_counts jsonb := '{}';
  v_count integer;
BEGIN
  -- Delete items tagged with this QA run
  DELETE FROM items
  WHERE metadata->>'qa_test' = 'true'
    AND metadata->>'qa_run_id' = p_run_id::text;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted_counts := v_deleted_counts || jsonb_build_object('items', v_count);

  -- Delete shipment_items tagged with this QA run
  DELETE FROM shipment_items
  WHERE metadata->>'qa_test' = 'true'
    AND metadata->>'qa_run_id' = p_run_id::text;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted_counts := v_deleted_counts || jsonb_build_object('shipment_items', v_count);

  -- Delete shipments tagged with this QA run
  DELETE FROM shipments
  WHERE metadata->>'qa_test' = 'true'
    AND metadata->>'qa_run_id' = p_run_id::text;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted_counts := v_deleted_counts || jsonb_build_object('shipments', v_count);

  -- Delete task_items tagged with this QA run (via task metadata)
  DELETE FROM task_items
  WHERE task_id IN (
    SELECT id FROM tasks
    WHERE metadata->>'qa_test' = 'true'
      AND metadata->>'qa_run_id' = p_run_id::text
  );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted_counts := v_deleted_counts || jsonb_build_object('task_items', v_count);

  -- Delete tasks tagged with this QA run
  DELETE FROM tasks
  WHERE metadata->>'qa_test' = 'true'
    AND metadata->>'qa_run_id' = p_run_id::text;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted_counts := v_deleted_counts || jsonb_build_object('tasks', v_count);

  -- Delete claims tagged with this QA run
  DELETE FROM claims
  WHERE metadata->>'qa_test' = 'true'
    AND metadata->>'qa_run_id' = p_run_id::text;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted_counts := v_deleted_counts || jsonb_build_object('claims', v_count);

  -- Delete stocktakes tagged with this QA run
  DELETE FROM stocktakes
  WHERE metadata->>'qa_test' = 'true'
    AND metadata->>'qa_run_id' = p_run_id::text;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted_counts := v_deleted_counts || jsonb_build_object('stocktakes', v_count);

  -- Delete item_photos tagged with this QA run
  DELETE FROM item_photos
  WHERE metadata->>'qa_test' = 'true'
    AND metadata->>'qa_run_id' = p_run_id::text;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  v_deleted_counts := v_deleted_counts || jsonb_build_object('item_photos', v_count);

  RETURN jsonb_build_object(
    'success', true,
    'deleted_counts', v_deleted_counts,
    'run_id', p_run_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
