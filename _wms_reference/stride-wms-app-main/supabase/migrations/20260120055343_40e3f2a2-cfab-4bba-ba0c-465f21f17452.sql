-- Migration 2: Add RLS policies for tables with RLS enabled but no policies (INFO level)
-- And fix all function search paths (WARN level)

-- RLS Policies for item_custom_charges
CREATE POLICY "Users can view item_custom_charges in their tenant"
ON public.item_custom_charges FOR SELECT
TO authenticated
USING (tenant_id = public.get_current_user_tenant_id());

CREATE POLICY "Users can insert item_custom_charges in their tenant"
ON public.item_custom_charges FOR INSERT
TO authenticated
WITH CHECK (tenant_id = public.get_current_user_tenant_id());

CREATE POLICY "Users can update item_custom_charges in their tenant"
ON public.item_custom_charges FOR UPDATE
TO authenticated
USING (tenant_id = public.get_current_user_tenant_id());

CREATE POLICY "Users can delete item_custom_charges in their tenant"
ON public.item_custom_charges FOR DELETE
TO authenticated
USING (tenant_id = public.get_current_user_tenant_id());

-- RLS Policies for task_custom_charges
CREATE POLICY "Users can view task_custom_charges in their tenant"
ON public.task_custom_charges FOR SELECT
TO authenticated
USING (tenant_id = public.get_current_user_tenant_id());

CREATE POLICY "Users can insert task_custom_charges in their tenant"
ON public.task_custom_charges FOR INSERT
TO authenticated
WITH CHECK (tenant_id = public.get_current_user_tenant_id());

CREATE POLICY "Users can update task_custom_charges in their tenant"
ON public.task_custom_charges FOR UPDATE
TO authenticated
USING (tenant_id = public.get_current_user_tenant_id());

CREATE POLICY "Users can delete task_custom_charges in their tenant"
ON public.task_custom_charges FOR DELETE
TO authenticated
USING (tenant_id = public.get_current_user_tenant_id());

-- Fix function search paths (WARN level)

-- 1. generate_shipment_number
CREATE OR REPLACE FUNCTION public.generate_shipment_number()
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
    next_val INTEGER;
BEGIN
    next_val := nextval('shipment_number_seq');
    RETURN 'SHP-' || LPAD(next_val::TEXT, 6, '0');
END;
$function$;

-- 2. set_shipment_number
CREATE OR REPLACE FUNCTION public.set_shipment_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
    IF NEW.shipment_number IS NULL OR NEW.shipment_number = '' THEN
        NEW.shipment_number := generate_shipment_number();
    END IF;
    RETURN NEW;
END;
$function$;

-- 3. update_communication_updated_at
CREATE OR REPLACE FUNCTION public.update_communication_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- 4. generate_invoice_number
CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
    next_val INTEGER;
BEGIN
    next_val := nextval('invoice_number_seq');
    RETURN 'INV-' || LPAD(next_val::TEXT, 6, '0');
END;
$function$;

-- 5. update_receiving_session_updated_at
CREATE OR REPLACE FUNCTION public.update_receiving_session_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$;

-- 6. update_updated_at_column
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$function$;

-- 7. user_has_permission
CREATE OR REPLACE FUNCTION public.user_has_permission(p_user_id uuid, p_permission character varying)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = p_user_id
          AND ur.deleted_at IS NULL
          AND r.deleted_at IS NULL
          AND (
              r.permissions @> jsonb_build_array(p_permission)
              OR r.permissions @> jsonb_build_array('*')
          )
    );
END;
$function$;

-- 8. current_user_id
CREATE OR REPLACE FUNCTION public.current_user_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    RETURN auth.uid();
EXCEPTION
    WHEN OTHERS THEN
        RETURN NULL;
END;
$function$;

-- 9. user_has_role (parameterized version)
CREATE OR REPLACE FUNCTION public.user_has_role(p_user_id uuid, p_role_name character varying)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = p_user_id
          AND r.name = p_role_name
          AND r.deleted_at IS NULL
          AND ur.deleted_at IS NULL
    );
END;
$function$;

-- 10. user_has_warehouse_access
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
          AND r.name = 'tenant_admin'
          AND r.deleted_at IS NULL
          AND ur.deleted_at IS NULL
    );
END;
$function$;

-- 11. update_tenant_email_layouts_updated_at
CREATE OR REPLACE FUNCTION public.update_tenant_email_layouts_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

-- 12. check_past_due_tasks
CREATE OR REPLACE FUNCTION public.check_past_due_tasks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  task_record RECORD;
  alert_type_rec RECORD;
BEGIN
  SELECT id INTO alert_type_rec FROM alert_types WHERE key = 'TASK_PAST_DUE';
  
  FOR task_record IN
    SELECT t.*, 
           (CURRENT_DATE - t.due_date) as days_overdue,
           u.email as assigned_to_email,
           u.first_name || ' ' || u.last_name as assigned_to_name,
           w.name as warehouse_name
    FROM tasks t
    LEFT JOIN users u ON t.assigned_to = u.id
    LEFT JOIN warehouses w ON t.warehouse_id = w.id
    WHERE t.status NOT IN ('completed', 'cancelled')
      AND t.due_date < CURRENT_DATE
      AND t.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM notification_events ne
        WHERE ne.alert_type_id = alert_type_rec.id
          AND ne.entity_id = t.id
          AND ne.created_at::date = CURRENT_DATE
      )
  LOOP
    INSERT INTO notification_events (
      tenant_id, alert_type_id, entity_type, entity_id, 
      event_payload, actor_type, actor_id
    ) VALUES (
      task_record.tenant_id,
      alert_type_rec.id,
      'task',
      task_record.id,
      jsonb_build_object(
        'task', jsonb_build_object(
          'id', task_record.id,
          'title', task_record.title,
          'type', task_record.task_type,
          'priority', task_record.priority,
          'assigned_to', task_record.assigned_to_name,
          'due_date', task_record.due_date,
          'days_overdue', task_record.days_overdue
        ),
        'warehouse', jsonb_build_object('name', task_record.warehouse_name),
        'tenant', jsonb_build_object('id', task_record.tenant_id)
      ),
      'system',
      NULL
    );
  END LOOP;
END;
$function$;

-- 13. is_tenant_admin (parameterized version)
CREATE OR REPLACE FUNCTION public.is_tenant_admin(user_id uuid, tenant_id_param uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  is_admin BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = user_id
      AND r.tenant_id = tenant_id_param
      AND r.name = 'admin'
      AND ur.deleted_at IS NULL
  ) INTO is_admin;
  
  RETURN is_admin;
END;
$function$;

-- 14. is_warehouse_staff
CREATE OR REPLACE FUNCTION public.is_warehouse_staff(user_id uuid, tenant_id_param uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  is_staff BOOLEAN;
BEGIN
  SELECT EXISTS(
    SELECT 1
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = user_id
      AND r.tenant_id = tenant_id_param
      AND ur.deleted_at IS NULL
  ) INTO is_staff;
  
  RETURN is_staff;
END;
$function$;

-- 15. get_current_user_tenant_id
CREATE OR REPLACE FUNCTION public.get_current_user_tenant_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    RETURN (
        SELECT tenant_id 
        FROM public.users 
        WHERE id = auth.uid()
    );
END;
$function$;