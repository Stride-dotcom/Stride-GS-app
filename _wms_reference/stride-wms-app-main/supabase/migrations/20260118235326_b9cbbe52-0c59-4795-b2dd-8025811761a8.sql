-- Create account_task_permissions table for Account Portal configuration
CREATE TABLE IF NOT EXISTS account_task_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  task_type_id uuid NOT NULL REFERENCES task_types(id) ON DELETE CASCADE,
  is_allowed boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(account_id, task_type_id)
);

-- Enable RLS on account_task_permissions
ALTER TABLE account_task_permissions ENABLE ROW LEVEL SECURITY;

-- Create RLS policies for account_task_permissions
CREATE POLICY "Users can view account_task_permissions for their tenant"
ON account_task_permissions
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM accounts a
    JOIN users u ON u.tenant_id = a.tenant_id
    WHERE a.id = account_task_permissions.account_id
    AND u.id = auth.uid()
  )
);

CREATE POLICY "Tenant admins can manage account_task_permissions"
ON account_task_permissions
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM accounts a
    JOIN users u ON u.tenant_id = a.tenant_id
    JOIN user_roles ur ON ur.user_id = u.id
    JOIN roles r ON r.id = ur.role_id
    WHERE a.id = account_task_permissions.account_id
    AND u.id = auth.uid()
    AND r.name IN ('Admin', 'Tenant Admin')
  )
);