-- =============================================================================
-- Role consolidation cleanup
--
-- Canonical tenant roles: admin, manager, warehouse, technician, client_user, billing_manager
-- System roles: admin_dev (tenant_id IS NULL)
--
-- Deprecated roles removed:
--   repair_tech    → duplicate of technician (same permissions)
--   tenant_admin   → consolidated into admin (never seeded, but referenced)
--   warehouse_staff→ was identical to warehouse (never seeded)
--   ops_viewer     → phantom role (never seeded)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Reassign users from deprecated roles to canonical equivalents
--    before soft-deleting the role rows.
-- ---------------------------------------------------------------------------

-- Move repair_tech user_roles → technician
UPDATE public.user_roles
SET role_id = (
  SELECT r2.id
  FROM public.roles r2
  WHERE r2.tenant_id = (
    SELECT r1.tenant_id FROM public.roles r1 WHERE r1.id = user_roles.role_id
  )
  AND r2.name = 'technician'
  AND r2.deleted_at IS NULL
  LIMIT 1
)
WHERE role_id IN (
  SELECT id FROM public.roles WHERE name = 'repair_tech' AND deleted_at IS NULL
)
AND deleted_at IS NULL
AND EXISTS (
  -- only remap when the canonical role exists for this tenant
  SELECT 1
  FROM public.roles r2
  WHERE r2.tenant_id = (
    SELECT r1.tenant_id FROM public.roles r1 WHERE r1.id = user_roles.role_id
  )
    AND r2.name = 'technician'
    AND r2.deleted_at IS NULL
)
AND NOT EXISTS (
  -- skip if user already has technician role in same tenant
  SELECT 1 FROM public.user_roles ur2
  JOIN public.roles r2 ON r2.id = ur2.role_id
  WHERE ur2.user_id = user_roles.user_id
    AND r2.name = 'technician'
    AND r2.tenant_id = (SELECT tenant_id FROM public.roles WHERE id = user_roles.role_id)
    AND ur2.deleted_at IS NULL
);

-- Move tenant_admin user_roles → admin
UPDATE public.user_roles
SET role_id = (
  SELECT r2.id
  FROM public.roles r2
  WHERE r2.tenant_id = (
    SELECT r1.tenant_id FROM public.roles r1 WHERE r1.id = user_roles.role_id
  )
  AND r2.name = 'admin'
  AND r2.deleted_at IS NULL
  LIMIT 1
)
WHERE role_id IN (
  SELECT id FROM public.roles WHERE name = 'tenant_admin' AND deleted_at IS NULL
)
AND deleted_at IS NULL
AND EXISTS (
  -- only remap when the canonical role exists for this tenant
  SELECT 1
  FROM public.roles r2
  WHERE r2.tenant_id = (
    SELECT r1.tenant_id FROM public.roles r1 WHERE r1.id = user_roles.role_id
  )
    AND r2.name = 'admin'
    AND r2.deleted_at IS NULL
)
AND NOT EXISTS (
  SELECT 1 FROM public.user_roles ur2
  JOIN public.roles r2 ON r2.id = ur2.role_id
  WHERE ur2.user_id = user_roles.user_id
    AND r2.name = 'admin'
    AND r2.tenant_id = (SELECT tenant_id FROM public.roles WHERE id = user_roles.role_id)
    AND ur2.deleted_at IS NULL
);

-- Move warehouse_staff user_roles → warehouse
UPDATE public.user_roles
SET role_id = (
  SELECT r2.id
  FROM public.roles r2
  WHERE r2.tenant_id = (
    SELECT r1.tenant_id FROM public.roles r1 WHERE r1.id = user_roles.role_id
  )
  AND r2.name = 'warehouse'
  AND r2.deleted_at IS NULL
  LIMIT 1
)
WHERE role_id IN (
  SELECT id FROM public.roles WHERE name = 'warehouse_staff' AND deleted_at IS NULL
)
AND deleted_at IS NULL
AND EXISTS (
  -- only remap when the canonical role exists for this tenant
  SELECT 1
  FROM public.roles r2
  WHERE r2.tenant_id = (
    SELECT r1.tenant_id FROM public.roles r1 WHERE r1.id = user_roles.role_id
  )
    AND r2.name = 'warehouse'
    AND r2.deleted_at IS NULL
)
AND NOT EXISTS (
  SELECT 1 FROM public.user_roles ur2
  JOIN public.roles r2 ON r2.id = ur2.role_id
  WHERE ur2.user_id = user_roles.user_id
    AND r2.name = 'warehouse'
    AND r2.tenant_id = (SELECT tenant_id FROM public.roles WHERE id = user_roles.role_id)
    AND ur2.deleted_at IS NULL
);

-- Soft-delete any leftover user_roles still pointing at deprecated roles
-- (duplicates that couldn't be reassigned because user already had the canonical role)
UPDATE public.user_roles ur
SET deleted_at = now()
FROM public.roles dr
WHERE ur.deleted_at IS NULL
  AND ur.role_id = dr.id
  AND dr.deleted_at IS NULL
  AND dr.name IN ('repair_tech', 'tenant_admin', 'warehouse_staff', 'ops_viewer')
  AND (
    -- ops_viewer is deprecated with no canonical equivalent
    dr.name = 'ops_viewer'
    -- only remove mapped deprecated roles after canonical role exists
    OR (
      dr.name = 'repair_tech'
      AND EXISTS (
        SELECT 1 FROM public.roles r2
        WHERE r2.tenant_id = dr.tenant_id
          AND r2.name = 'technician'
          AND r2.deleted_at IS NULL
      )
    )
    OR (
      dr.name = 'tenant_admin'
      AND EXISTS (
        SELECT 1 FROM public.roles r2
        WHERE r2.tenant_id = dr.tenant_id
          AND r2.name = 'admin'
          AND r2.deleted_at IS NULL
      )
    )
    OR (
      dr.name = 'warehouse_staff'
      AND EXISTS (
        SELECT 1 FROM public.roles r2
        WHERE r2.tenant_id = dr.tenant_id
          AND r2.name = 'warehouse'
          AND r2.deleted_at IS NULL
      )
    )
  );

-- ---------------------------------------------------------------------------
-- 2. Soft-delete the deprecated role rows
-- ---------------------------------------------------------------------------
UPDATE public.roles
SET deleted_at = now()
WHERE name IN ('repair_tech', 'tenant_admin', 'warehouse_staff', 'ops_viewer')
  AND deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 3. Clean up tenant_in_app_role_eligibility rows for deprecated roles
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.tenant_in_app_role_eligibility') IS NOT NULL THEN
    DELETE FROM public.tenant_in_app_role_eligibility
    WHERE role_name IN ('repair_tech', 'tenant_admin', 'warehouse_staff', 'ops_viewer');
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 4. Update seed_standard_roles() to include billing_manager
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.seed_standard_roles(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Admin
  INSERT INTO public.roles (tenant_id, name, description, permissions, is_system)
  SELECT p_tenant_id, 'admin', 'Full administrative access to all resources', '["*"]'::jsonb, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.roles WHERE tenant_id = p_tenant_id AND name = 'admin' AND deleted_at IS NULL
  );

  -- Manager
  INSERT INTO public.roles (tenant_id, name, description, permissions, is_system)
  SELECT p_tenant_id, 'manager', 'Manage operations, billing, accounts, and warehouse staff',
    '["items.read", "items.create", "items.update", "items.move", "accounts.read", "accounts.create", "accounts.update", "billing.read", "billing.create", "tasks.read", "tasks.create", "tasks.update", "tasks.assign", "reports.read", "reports.create", "notes.create", "notes.read", "movements.read", "attachments.create", "sidemarks.read", "sidemarks.create", "sidemarks.update"]'::jsonb, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.roles WHERE tenant_id = p_tenant_id AND name = 'manager' AND deleted_at IS NULL
  );

  -- Warehouse
  INSERT INTO public.roles (tenant_id, name, description, permissions, is_system)
  SELECT p_tenant_id, 'warehouse', 'Warehouse operations - receiving, picking, moving inventory',
    '["items.read", "items.create", "items.update", "items.move", "tasks.read", "tasks.update", "notes.create", "notes.read", "movements.read", "attachments.create", "sidemarks.read"]'::jsonb, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.roles WHERE tenant_id = p_tenant_id AND name = 'warehouse' AND deleted_at IS NULL
  );

  -- Technician
  INSERT INTO public.roles (tenant_id, name, description, permissions, is_system)
  SELECT p_tenant_id, 'technician', 'Repair technician - limited access for quote submission and repairs',
    '["quotes.read", "quotes.submit", "items.read", "attachments.create"]'::jsonb, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.roles WHERE tenant_id = p_tenant_id AND name = 'technician' AND deleted_at IS NULL
  );

  -- Client User
  INSERT INTO public.roles (tenant_id, name, description, permissions, is_system)
  SELECT p_tenant_id, 'client_user', 'Client access - view own account inventory and orders only',
    '["items.read", "orders.read", "orders.create", "notes.read", "sidemarks.read", "quotes.request"]'::jsonb, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.roles WHERE tenant_id = p_tenant_id AND name = 'client_user' AND deleted_at IS NULL
  );

  -- Billing Manager
  INSERT INTO public.roles (tenant_id, name, description, permissions, is_system)
  SELECT p_tenant_id, 'billing_manager', 'Billing and invoicing - manages rates, billing reports, invoices, and accounts',
    '["billing.read", "billing.create", "billing.update", "invoices.read", "invoices.create", "invoices.update", "accounts.read", "accounts.update", "reports.read", "items.read", "tasks.read", "shipments.read", "notes.read", "sidemarks.read"]'::jsonb, true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.roles WHERE tenant_id = p_tenant_id AND name = 'billing_manager' AND deleted_at IS NULL
  );
END;
$function$;

-- Seed billing_manager for all existing tenants
INSERT INTO public.roles (tenant_id, name, description, permissions, is_system)
SELECT t.id, 'billing_manager', 'Billing and invoicing - manages rates, billing reports, invoices, and accounts',
  '["billing.read", "billing.create", "billing.update", "invoices.read", "invoices.create", "invoices.update", "accounts.read", "accounts.update", "reports.read", "items.read", "tasks.read", "shipments.read", "notes.read", "sidemarks.read"]'::jsonb, true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.roles WHERE tenant_id = t.id AND name = 'billing_manager' AND deleted_at IS NULL
);

-- ---------------------------------------------------------------------------
-- 5. Update rpc_get_my_in_app_role_eligibility() ORDER BY
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_my_in_app_role_eligibility()
RETURNS TABLE (
  role_name text,
  role_description text,
  is_system boolean,
  is_eligible boolean,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid := public.user_tenant_id();
BEGIN
  IF auth.uid() IS NULL OR v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  IF to_regclass('public.tenant_in_app_role_eligibility') IS NULL THEN
    RETURN QUERY
    SELECT
      lower(r.name) AS role_name,
      r.description AS role_description,
      COALESCE(r.is_system, false) AS is_system,
      true AS is_eligible,
      NULL::timestamptz AS updated_at
    FROM public.roles r
    WHERE r.tenant_id = v_tenant_id
      AND r.deleted_at IS NULL
    ORDER BY
      CASE lower(r.name)
        WHEN 'admin' THEN 1
        WHEN 'billing_manager' THEN 2
        WHEN 'manager' THEN 3
        WHEN 'warehouse' THEN 4
        WHEN 'technician' THEN 5
        WHEN 'client_user' THEN 6
        ELSE 100
      END,
      lower(r.name);
  ELSE
    RETURN QUERY
    SELECT
      lower(r.name) AS role_name,
      r.description AS role_description,
      COALESCE(r.is_system, false) AS is_system,
      COALESCE(e.is_eligible, true) AS is_eligible,
      e.updated_at
    FROM public.roles r
    LEFT JOIN public.tenant_in_app_role_eligibility e
      ON e.tenant_id = r.tenant_id
     AND e.role_name = lower(r.name)
    WHERE r.tenant_id = v_tenant_id
      AND r.deleted_at IS NULL
    ORDER BY
      CASE lower(r.name)
        WHEN 'admin' THEN 1
        WHEN 'billing_manager' THEN 2
        WHEN 'manager' THEN 3
        WHEN 'warehouse' THEN 4
        WHEN 'technician' THEN 5
        WHEN 'client_user' THEN 6
        ELSE 100
      END,
      lower(r.name);
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5b. Update get_user_role() priority — remove tenant_admin, add billing_manager
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.name
  FROM public.user_roles ur
  JOIN public.roles r ON ur.role_id = r.id
  WHERE ur.user_id = _user_id
    AND ur.deleted_at IS NULL
    AND r.deleted_at IS NULL
  ORDER BY
    CASE lower(r.name)
      WHEN 'admin' THEN 1
      WHEN 'billing_manager' THEN 2
      WHEN 'manager' THEN 3
      WHEN 'warehouse' THEN 4
      WHEN 'technician' THEN 5
      WHEN 'client_user' THEN 6
      ELSE 100
    END
  LIMIT 1
$$;

-- ---------------------------------------------------------------------------
-- 6. Update user_has_warehouse_access() — was checking 'tenant_admin', now 'admin'
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_has_warehouse_access(p_user_id uuid, p_warehouse_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM warehouse_permissions wp
        WHERE wp.user_id = p_user_id
          AND wp.warehouse_id = p_warehouse_id
          AND wp.deleted_at IS NULL
    ) OR EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = p_user_id
          AND r.name = 'admin'
          AND r.deleted_at IS NULL
          AND ur.deleted_at IS NULL
    );
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. Update user_can_access_sidemark() — remove tenant_admin from role list
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.user_can_access_sidemark(p_user_id UUID, p_sidemark_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_tenant_id UUID;
  v_sidemark_tenant_id UUID;
  v_user_role TEXT;
  v_user_account_id UUID;
  v_sidemark_account_id UUID;
BEGIN
  SELECT tenant_id INTO v_user_tenant_id FROM users WHERE id = p_user_id;
  SELECT tenant_id, account_id INTO v_sidemark_tenant_id, v_sidemark_account_id
  FROM sidemarks WHERE id = p_sidemark_id;

  IF v_user_tenant_id != v_sidemark_tenant_id THEN
    RETURN FALSE;
  END IF;

  v_user_role := public.get_user_role(p_user_id);

  IF v_user_role IN ('admin', 'manager', 'warehouse', 'billing_manager') THEN
    RETURN TRUE;
  END IF;

  IF v_user_role = 'client_user' THEN
    SELECT account_id INTO v_user_account_id FROM users WHERE id = p_user_id;
    RETURN v_user_account_id = v_sidemark_account_id;
  END IF;

  RETURN FALSE;
END;
$$;

-- ---------------------------------------------------------------------------
-- 8. Update can_access_document() — remove tenant_admin, add billing_manager
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_access_document(doc_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  doc RECORD;
  user_role TEXT;
BEGIN
  SELECT context_type, is_sensitive, tenant_id INTO doc
  FROM public.documents WHERE id = doc_id AND deleted_at IS NULL;

  IF NOT FOUND THEN RETURN false; END IF;

  IF doc.tenant_id != public.user_tenant_id() THEN RETURN false; END IF;

  user_role := public.get_user_role(auth.uid());

  -- Sensitive employee documents require admin/manager role
  IF doc.context_type = 'employee' AND doc.is_sensitive THEN
    RETURN user_role IN ('admin', 'manager');
  END IF;

  RETURN true;
END;
$$;

-- ---------------------------------------------------------------------------
-- 9. Update app_issues CHECK constraint for user_role to include new roles
-- ---------------------------------------------------------------------------
ALTER TABLE public.app_issues
  DROP CONSTRAINT IF EXISTS app_issues_user_role_check;

-- Normalize any legacy role values before enforcing the updated constraint.
UPDATE public.app_issues
SET user_role = 'admin'
WHERE user_role = 'tenant_admin';

ALTER TABLE public.app_issues
  ADD CONSTRAINT app_issues_user_role_check
  CHECK (user_role IS NULL OR user_role IN (
    'admin', 'admin_dev', 'manager', 'warehouse', 'technician', 'client_user', 'billing_manager'
  ));

-- ---------------------------------------------------------------------------
-- 10. Update app_issues RLS policies — remove tenant_admin
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can read app_issues" ON public.app_issues;
CREATE POLICY "Admins can read app_issues"
  ON public.app_issues FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
        AND r.name = 'admin'
        AND ur.deleted_at IS NULL
        AND r.deleted_at IS NULL
    )
    OR public.current_user_is_admin_dev()
  );

DROP POLICY IF EXISTS "Admins can update app_issues" ON public.app_issues;
CREATE POLICY "Admins can update app_issues"
  ON public.app_issues FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON ur.role_id = r.id
      WHERE ur.user_id = auth.uid()
        AND r.name = 'admin'
        AND ur.deleted_at IS NULL
        AND r.deleted_at IS NULL
    )
    OR public.current_user_is_admin_dev()
  );

-- ---------------------------------------------------------------------------
-- 11. Update documents RLS policy — remove tenant_admin
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Admins can update any document" ON public.documents;
CREATE POLICY "Admins can update any document"
ON public.documents FOR UPDATE
USING (
  tenant_id = public.user_tenant_id()
  AND public.get_user_role(auth.uid()) IN ('admin', 'manager')
);
