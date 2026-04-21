-- dt_orders + dt_order_items INSERT/UPDATE RLS policies
-- Phase 2c: Allow authenticated users (staff/admin + clients) to create
-- and update orders through the app. Previously only service_role (Edge
-- Functions) could write; browser POSTs were 403ing.

-- Allow staff/admin to INSERT dt_orders (app-created orders)
CREATE POLICY "dt_orders_insert_staff"
ON public.dt_orders
FOR INSERT
TO authenticated
WITH CHECK (
  ((auth.jwt() -> 'user_metadata') ->> 'role') = ANY (ARRAY['admin', 'staff'])
);

-- Allow clients to INSERT dt_orders for their own tenant
CREATE POLICY "dt_orders_insert_client"
ON public.dt_orders
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id = ((auth.jwt() -> 'user_metadata') ->> 'clientSheetId')
);

-- Allow staff/admin to UPDATE dt_orders (review workflow + back-link updates)
CREATE POLICY "dt_orders_update_staff"
ON public.dt_orders
FOR UPDATE
TO authenticated
USING (
  ((auth.jwt() -> 'user_metadata') ->> 'role') = ANY (ARRAY['admin', 'staff'])
)
WITH CHECK (
  ((auth.jwt() -> 'user_metadata') ->> 'role') = ANY (ARRAY['admin', 'staff'])
);

-- Allow clients to UPDATE their own orders (linked_order_id back-fill for P+D)
CREATE POLICY "dt_orders_update_client"
ON public.dt_orders
FOR UPDATE
TO authenticated
USING (
  tenant_id = ((auth.jwt() -> 'user_metadata') ->> 'clientSheetId')
)
WITH CHECK (
  tenant_id = ((auth.jwt() -> 'user_metadata') ->> 'clientSheetId')
);

-- Allow staff/admin to INSERT dt_order_items
CREATE POLICY "dt_order_items_insert_staff"
ON public.dt_order_items
FOR INSERT
TO authenticated
WITH CHECK (
  ((auth.jwt() -> 'user_metadata') ->> 'role') = ANY (ARRAY['admin', 'staff'])
);

-- Allow clients to INSERT dt_order_items for orders they own
CREATE POLICY "dt_order_items_insert_client"
ON public.dt_order_items
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.dt_orders o
    WHERE o.id = dt_order_items.dt_order_id
    AND o.tenant_id = ((auth.jwt() -> 'user_metadata') ->> 'clientSheetId')
  )
);
