-- Add flag_is_indicator column to charge_types
ALTER TABLE charge_types ADD COLUMN IF NOT EXISTS flag_is_indicator boolean DEFAULT false;

-- Create item_flags table for storing indicator flag state (non-billing flags)
CREATE TABLE IF NOT EXISTS item_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  charge_type_id uuid REFERENCES charge_types(id) ON DELETE SET NULL,
  service_code text NOT NULL,
  created_at timestamptz DEFAULT now(),
  created_by uuid,
  CONSTRAINT item_flags_unique UNIQUE(item_id, service_code)
);

-- Add RLS policies for item_flags
ALTER TABLE item_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view item_flags in their tenant"
  ON item_flags FOR SELECT
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can insert item_flags in their tenant"
  ON item_flags FOR INSERT
  WITH CHECK (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Users can delete item_flags in their tenant"
  ON item_flags FOR DELETE
  USING (tenant_id = (SELECT tenant_id FROM users WHERE id = auth.uid()));

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS item_flags_item_id_idx ON item_flags(item_id);
CREATE INDEX IF NOT EXISTS item_flags_tenant_id_idx ON item_flags(tenant_id);
