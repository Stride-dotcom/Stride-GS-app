-- Multi-tenant RLS access fix.
--
-- Until now, every client-facing RLS policy checked
--
--     tenant_id = (auth.jwt() -> 'user_metadata' ->> 'clientSheetId')
--
-- against a SINGLE primary clientSheetId from the JWT. Client users assigned
-- to multiple tenants (e.g. a designer with 3 sister-firm accounts) could see
-- their accessibleClientSheetIds list in the React app (computed at login by
-- GAS via getUserAccessScope_), and Inventory/Tasks/etc. lists fetched
-- through the React layer correctly spanned all 3 tenants. But any direct
-- Supabase fetch — including every entity DEEPLINK — went through RLS, which
-- only knew about the primary. Rows in the secondary tenants got filtered
-- out before reaching React, surfacing as "Item not found" errors on perfectly
-- valid deeplinks for the user's other accounts.
--
-- Fix has two parts:
--
--   (1) New helper `public.user_has_tenant_access(text)` — returns true if
--       the given tenant matches the user's primary clientSheetId OR appears
--       in the JWT's accessibleClientSheetIds array. Defaults safely (empty
--       array) so single-tenant users keep working with the legacy primary
--       check.
--
--   (2) Every affected `*_select_client` / write-side client policy is
--       rewritten to call the helper. Storage policies that key off the
--       folder-name path get a parallel helper that handles the '_'→'-'
--       substitution Supabase storage paths use.
--
-- The companion AuthContext.tsx change populates `accessibleClientSheetIds`
-- in user_metadata at every login (cached + full-verify paths), so single-
-- tenant users see no behavior change and multi-tenant users can hit their
-- secondary tenants the moment they log in after this ships.
--
-- Idempotent — DROP POLICY IF EXISTS + CREATE POLICY for each entry. Safe
-- to re-run.

-- ─── 1. Helpers ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.user_has_tenant_access(tenant text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    tenant IS NOT NULL
    AND (
      tenant = (auth.jwt() -> 'user_metadata' ->> 'clientSheetId')
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(
          COALESCE(auth.jwt() -> 'user_metadata' -> 'accessibleClientSheetIds', '[]'::jsonb)
        ) AS a(tid)
        WHERE a.tid = tenant
      )
    )
$$;

COMMENT ON FUNCTION public.user_has_tenant_access(text)
  IS 'Returns true if `tenant` matches the user''s primary JWT clientSheetId OR appears in JWT accessibleClientSheetIds. Use in RLS policies wherever a tenant-scope check was previously `tenant_id = clientSheetId`.';

GRANT EXECUTE ON FUNCTION public.user_has_tenant_access(text) TO authenticated, anon, service_role;

-- Storage variant — folder names in Supabase Storage paths use '-' rather
-- than '_', so a tenant ID like '1ABC_DEF' becomes '1ABC-DEF' on disk.
-- This helper accepts either form for any of the user's accessible tenants.
CREATE OR REPLACE FUNCTION public.user_has_tenant_access_storage(folder text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT
    folder IS NOT NULL
    AND (
      folder = (auth.jwt() -> 'user_metadata' ->> 'clientSheetId')
      OR folder = replace((auth.jwt() -> 'user_metadata' ->> 'clientSheetId'), '_', '-')
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(
          COALESCE(auth.jwt() -> 'user_metadata' -> 'accessibleClientSheetIds', '[]'::jsonb)
        ) AS a(tid)
        WHERE a.tid = folder OR replace(a.tid, '_', '-') = folder
      )
    )
$$;

COMMENT ON FUNCTION public.user_has_tenant_access_storage(text)
  IS 'Storage variant of user_has_tenant_access: also accepts the underscore-to-hyphen folder-path encoding Supabase storage uses.';

GRANT EXECUTE ON FUNCTION public.user_has_tenant_access_storage(text) TO authenticated, anon, service_role;

-- ─── 2. Public-schema policies ──────────────────────────────────────────────

-- inventory
DROP POLICY IF EXISTS inventory_select_client ON public.inventory;
CREATE POLICY inventory_select_client ON public.inventory
  FOR SELECT TO authenticated
  USING (public.user_has_tenant_access(tenant_id));

-- tasks
DROP POLICY IF EXISTS tasks_select_client ON public.tasks;
CREATE POLICY tasks_select_client ON public.tasks
  FOR SELECT TO authenticated
  USING (public.user_has_tenant_access(tenant_id));

-- repairs
DROP POLICY IF EXISTS repairs_select_client ON public.repairs;
CREATE POLICY repairs_select_client ON public.repairs
  FOR SELECT TO authenticated
  USING (public.user_has_tenant_access(tenant_id));

-- shipments
DROP POLICY IF EXISTS shipments_select_client ON public.shipments;
CREATE POLICY shipments_select_client ON public.shipments
  FOR SELECT TO authenticated
  USING (public.user_has_tenant_access(tenant_id));

-- will_calls
DROP POLICY IF EXISTS will_calls_select_client ON public.will_calls;
CREATE POLICY will_calls_select_client ON public.will_calls
  FOR SELECT TO authenticated
  USING (public.user_has_tenant_access(tenant_id));

-- will_call_items
DROP POLICY IF EXISTS will_call_items_select_client ON public.will_call_items;
CREATE POLICY will_call_items_select_client ON public.will_call_items
  FOR SELECT TO authenticated
  USING (public.user_has_tenant_access(tenant_id));

-- billing
DROP POLICY IF EXISTS billing_select_client ON public.billing;
CREATE POLICY billing_select_client ON public.billing
  FOR SELECT TO authenticated
  USING (public.user_has_tenant_access(tenant_id));

-- claims (subquery against clients.spreadsheet_id)
DROP POLICY IF EXISTS claims_select_client_own ON public.claims;
CREATE POLICY claims_select_client_own ON public.claims
  FOR SELECT
  USING (
    ((auth.jwt() -> 'user_metadata' ->> 'role') = 'client')
    AND company_client_name IN (
      SELECT clients.name FROM public.clients
      WHERE public.user_has_tenant_access(clients.spreadsheet_id)
    )
  );

-- clients (own row select + update)
DROP POLICY IF EXISTS clients_select_own ON public.clients;
CREATE POLICY clients_select_own ON public.clients
  FOR SELECT TO authenticated
  USING (public.user_has_tenant_access(spreadsheet_id));

DROP POLICY IF EXISTS clients_update_own ON public.clients;
CREATE POLICY clients_update_own ON public.clients
  FOR UPDATE TO authenticated
  USING (public.user_has_tenant_access(spreadsheet_id))
  WITH CHECK (public.user_has_tenant_access(spreadsheet_id));

-- client_insurance
DROP POLICY IF EXISTS client_insurance_client_read ON public.client_insurance;
CREATE POLICY client_insurance_client_read ON public.client_insurance
  FOR SELECT TO authenticated
  USING (
    ((auth.jwt() -> 'user_metadata' ->> 'role') = 'client')
    AND public.user_has_tenant_access(tenant_id)
  );

-- entity_notes (select + insert)
DROP POLICY IF EXISTS entity_notes_select_client ON public.entity_notes;
CREATE POLICY entity_notes_select_client ON public.entity_notes
  FOR SELECT TO authenticated
  USING (
    ((auth.jwt() -> 'user_metadata' ->> 'role') = 'client')
    AND public.user_has_tenant_access(tenant_id)
    AND visibility = 'public'
  );

DROP POLICY IF EXISTS entity_notes_insert_client ON public.entity_notes;
CREATE POLICY entity_notes_insert_client ON public.entity_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    ((auth.jwt() -> 'user_metadata' ->> 'role') = 'client')
    AND public.user_has_tenant_access(tenant_id)
    AND visibility = 'public'
  );

-- entity_audit_log (mixed staff/client condition)
DROP POLICY IF EXISTS entity_audit_log_select_authed ON public.entity_audit_log;
CREATE POLICY entity_audit_log_select_authed ON public.entity_audit_log
  FOR SELECT TO authenticated
  USING (
    ((auth.jwt() -> 'user_metadata' ->> 'role') = ANY (ARRAY['admin','staff']))
    OR public.user_has_tenant_access(tenant_id)
  );

-- documents
DROP POLICY IF EXISTS documents_select_own_tenant ON public.documents;
CREATE POLICY documents_select_own_tenant ON public.documents
  FOR SELECT TO authenticated
  USING (
    ((auth.jwt() -> 'user_metadata' ->> 'role') = 'client')
    AND public.user_has_tenant_access(tenant_id)
    AND deleted_at IS NULL
  );

-- email_sends
DROP POLICY IF EXISTS email_sends_select_own_tenant ON public.email_sends;
CREATE POLICY email_sends_select_own_tenant ON public.email_sends
  FOR SELECT TO authenticated
  USING (
    ((auth.jwt() -> 'user_metadata' ->> 'role') = 'client')
    AND public.user_has_tenant_access(tenant_id)
  );

-- item_photos
DROP POLICY IF EXISTS item_photos_select_own_tenant ON public.item_photos;
CREATE POLICY item_photos_select_own_tenant ON public.item_photos
  FOR SELECT TO authenticated
  USING (
    ((auth.jwt() -> 'user_metadata' ->> 'role') = 'client')
    AND public.user_has_tenant_access(tenant_id)
  );

-- move_history
DROP POLICY IF EXISTS move_history_select_client ON public.move_history;
CREATE POLICY move_history_select_client ON public.move_history
  FOR SELECT TO authenticated
  USING (public.user_has_tenant_access(tenant_id));

-- autocomplete_db
DROP POLICY IF EXISTS autocomplete_db_select_client ON public.autocomplete_db;
CREATE POLICY autocomplete_db_select_client ON public.autocomplete_db
  FOR SELECT TO authenticated
  USING (
    ((auth.jwt() -> 'user_metadata' ->> 'role') = 'client')
    AND public.user_has_tenant_access(tenant_id)
  );

-- dt_address_book (select + write + update)
DROP POLICY IF EXISTS address_book_select_client ON public.dt_address_book;
CREATE POLICY address_book_select_client ON public.dt_address_book
  FOR SELECT TO authenticated
  USING (public.user_has_tenant_access(tenant_id));

DROP POLICY IF EXISTS address_book_write_client ON public.dt_address_book;
CREATE POLICY address_book_write_client ON public.dt_address_book
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_tenant_access(tenant_id));

DROP POLICY IF EXISTS address_book_update_client ON public.dt_address_book;
CREATE POLICY address_book_update_client ON public.dt_address_book
  FOR UPDATE TO authenticated
  USING (public.user_has_tenant_access(tenant_id))
  WITH CHECK (public.user_has_tenant_access(tenant_id));

-- dt_orders (select + insert + update)
DROP POLICY IF EXISTS dt_orders_select_client ON public.dt_orders;
CREATE POLICY dt_orders_select_client ON public.dt_orders
  FOR SELECT TO authenticated
  USING (public.user_has_tenant_access(tenant_id));

DROP POLICY IF EXISTS dt_orders_insert_client ON public.dt_orders;
CREATE POLICY dt_orders_insert_client ON public.dt_orders
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_tenant_access(tenant_id));

DROP POLICY IF EXISTS dt_orders_update_client ON public.dt_orders;
CREATE POLICY dt_orders_update_client ON public.dt_orders
  FOR UPDATE TO authenticated
  USING (public.user_has_tenant_access(tenant_id))
  WITH CHECK (public.user_has_tenant_access(tenant_id));

-- dt_order_items (select + insert + update + delete)
DROP POLICY IF EXISTS dt_order_items_select_client ON public.dt_order_items;
CREATE POLICY dt_order_items_select_client ON public.dt_order_items
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.dt_orders o
      WHERE o.id = dt_order_items.dt_order_id
        AND public.user_has_tenant_access(o.tenant_id)
    )
  );

DROP POLICY IF EXISTS dt_order_items_insert_client ON public.dt_order_items;
CREATE POLICY dt_order_items_insert_client ON public.dt_order_items
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.dt_orders o
      WHERE o.id = dt_order_items.dt_order_id
        AND public.user_has_tenant_access(o.tenant_id)
    )
  );

DROP POLICY IF EXISTS dt_order_items_update_client ON public.dt_order_items;
CREATE POLICY dt_order_items_update_client ON public.dt_order_items
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.dt_orders o
      WHERE o.id = dt_order_items.dt_order_id
        AND public.user_has_tenant_access(o.tenant_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.dt_orders o
      WHERE o.id = dt_order_items.dt_order_id
        AND public.user_has_tenant_access(o.tenant_id)
    )
  );

DROP POLICY IF EXISTS dt_order_items_delete_client ON public.dt_order_items;
CREATE POLICY dt_order_items_delete_client ON public.dt_order_items
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.dt_orders o
      WHERE o.id = dt_order_items.dt_order_id
        AND public.user_has_tenant_access(o.tenant_id)
    )
  );

-- dt_order_history
DROP POLICY IF EXISTS dt_order_history_select_client ON public.dt_order_history;
CREATE POLICY dt_order_history_select_client ON public.dt_order_history
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.dt_orders o
      WHERE o.id = dt_order_history.dt_order_id
        AND public.user_has_tenant_access(o.tenant_id)
    )
  );

-- dt_order_notes (visibility-gated)
DROP POLICY IF EXISTS dt_order_notes_select_client ON public.dt_order_notes;
CREATE POLICY dt_order_notes_select_client ON public.dt_order_notes
  FOR SELECT TO authenticated
  USING (
    visibility = 'public'
    AND EXISTS (
      SELECT 1 FROM public.dt_orders o
      WHERE o.id = dt_order_notes.dt_order_id
        AND public.user_has_tenant_access(o.tenant_id)
    )
  );

-- dt_order_photos (portal-visible)
DROP POLICY IF EXISTS dt_order_photos_select_client ON public.dt_order_photos;
CREATE POLICY dt_order_photos_select_client ON public.dt_order_photos
  FOR SELECT TO authenticated
  USING (
    visible_in_portal = true
    AND EXISTS (
      SELECT 1 FROM public.dt_orders o
      WHERE o.id = dt_order_photos.dt_order_id
        AND public.user_has_tenant_access(o.tenant_id)
    )
  );

-- expected_shipments — TWO duplicate select policies pre-existed; rewrite both
DROP POLICY IF EXISTS exp_ship_select_own ON public.expected_shipments;
CREATE POLICY exp_ship_select_own ON public.expected_shipments
  FOR SELECT TO authenticated
  USING (
    ((auth.jwt() -> 'user_metadata' ->> 'role') = 'client')
    AND public.user_has_tenant_access(tenant_id)
  );

DROP POLICY IF EXISTS expected_shipments_select_client ON public.expected_shipments;
CREATE POLICY expected_shipments_select_client ON public.expected_shipments
  FOR SELECT TO authenticated
  USING (public.user_has_tenant_access(tenant_id));

DROP POLICY IF EXISTS exp_ship_insert_own ON public.expected_shipments;
CREATE POLICY exp_ship_insert_own ON public.expected_shipments
  FOR INSERT TO authenticated
  WITH CHECK (
    ((auth.jwt() -> 'user_metadata' ->> 'role') = 'client')
    AND public.user_has_tenant_access(tenant_id)
  );

DROP POLICY IF EXISTS expected_shipments_insert_client ON public.expected_shipments;
CREATE POLICY expected_shipments_insert_client ON public.expected_shipments
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_tenant_access(tenant_id));

DROP POLICY IF EXISTS expected_shipments_update_client ON public.expected_shipments;
CREATE POLICY expected_shipments_update_client ON public.expected_shipments
  FOR UPDATE TO authenticated
  USING (public.user_has_tenant_access(tenant_id))
  WITH CHECK (public.user_has_tenant_access(tenant_id));

-- photo_shares (insert + select)
DROP POLICY IF EXISTS photo_shares_client_read_own_tenant ON public.photo_shares;
CREATE POLICY photo_shares_client_read_own_tenant ON public.photo_shares
  FOR SELECT TO authenticated
  USING (
    ((auth.jwt() -> 'user_metadata' ->> 'role') = 'client')
    AND public.user_has_tenant_access(tenant_id)
  );

DROP POLICY IF EXISTS photo_shares_client_insert_own_tenant ON public.photo_shares;
CREATE POLICY photo_shares_client_insert_own_tenant ON public.photo_shares
  FOR INSERT TO authenticated
  WITH CHECK (
    ((auth.jwt() -> 'user_metadata' ->> 'role') = 'client')
    AND public.user_has_tenant_access(tenant_id)
    AND created_by = auth.uid()
  );

-- ─── 3. Storage policies ────────────────────────────────────────────────────

DROP POLICY IF EXISTS documents_select_tenant ON storage.objects;
CREATE POLICY documents_select_tenant ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'documents'
    AND (
      ((auth.jwt() -> 'user_metadata' ->> 'role') = ANY (ARRAY['admin','staff']))
      OR public.user_has_tenant_access_storage(split_part(name, '/', 1))
    )
  );

DROP POLICY IF EXISTS dt_pod_photos_select_client ON storage.objects;
CREATE POLICY dt_pod_photos_select_client ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'dt-pod-photos'
    AND public.user_has_tenant_access_storage((storage.foldername(name))[1])
  );

DROP POLICY IF EXISTS invoices_read_own_tenant ON storage.objects;
CREATE POLICY invoices_read_own_tenant ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'invoices'
    AND ((auth.jwt() -> 'user_metadata' ->> 'role') = 'client')
    AND public.user_has_tenant_access_storage((storage.foldername(name))[1])
  );

-- photos bucket — keep the row-based fallback via item_photos (post-transfer
-- safety net from PR #229). Add multi-tenant on both the path-prefix branch
-- AND the item_photos.tenant_id branch so transferred photos remain readable
-- across all the user's accessible tenants.
DROP POLICY IF EXISTS photos_select_tenant ON storage.objects;
CREATE POLICY photos_select_tenant ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'photos'
    AND (
      ((auth.jwt() -> 'user_metadata' ->> 'role') = ANY (ARRAY['admin','staff']))
      OR public.user_has_tenant_access_storage(split_part(name, '/', 1))
      OR EXISTS (
        SELECT 1 FROM public.item_photos ip
        WHERE (ip.storage_key = objects.name OR ip.thumbnail_key = objects.name)
          AND public.user_has_tenant_access(ip.tenant_id)
      )
    )
  );
