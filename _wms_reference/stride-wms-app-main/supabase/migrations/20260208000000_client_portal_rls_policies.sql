-- Client Portal RLS: Scope client_user access to their account(s) only
-- Staff users continue to see all data in their tenant (no change)
-- Client users can only see data belonging to their account

-- Helper function: returns the account_id for a client portal user, or NULL for staff
CREATE OR REPLACE FUNCTION public.client_portal_account_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_account_id UUID;
BEGIN
    SELECT account_id INTO v_account_id
    FROM public.client_portal_users
    WHERE auth_user_id = auth.uid()
      AND is_active = true
    LIMIT 1;

    RETURN v_account_id;
END;
$function$;

-- Helper function: check if current user is a client portal user
CREATE OR REPLACE FUNCTION public.is_client_user()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.client_portal_users
        WHERE auth_user_id = auth.uid()
          AND is_active = true
    );
END;
$function$;


-- =============================================================
-- ITEMS: Client can only SELECT items in their account
-- =============================================================

-- Add client-scoped read policy (existing staff policy stays intact)
CREATE POLICY "Client users can view items in their account"
    ON public.items FOR SELECT TO authenticated
    USING (
        public.is_client_user()
        AND tenant_id = public.user_tenant_id()
        AND account_id = public.client_portal_account_id()
    );


-- =============================================================
-- SHIPMENTS: Client can only SELECT shipments for their account
-- =============================================================

CREATE POLICY "Client users can view shipments in their account"
    ON public.shipments FOR SELECT TO authenticated
    USING (
        public.is_client_user()
        AND tenant_id = public.user_tenant_id()
        AND account_id = public.client_portal_account_id()
    );


-- =============================================================
-- SHIPMENT_ITEMS: Client can view shipment items via their account shipments
-- =============================================================

CREATE POLICY "Client users can view shipment items in their account"
    ON public.shipment_items FOR SELECT TO authenticated
    USING (
        public.is_client_user()
        AND EXISTS (
            SELECT 1 FROM public.shipments s
            WHERE s.id = shipment_items.shipment_id
            AND s.tenant_id = public.user_tenant_id()
            AND s.account_id = public.client_portal_account_id()
        )
    );


-- =============================================================
-- CLAIMS: Client can only SELECT claims for their account
-- =============================================================

CREATE POLICY "Client users can view claims in their account"
    ON public.claims FOR SELECT TO authenticated
    USING (
        public.is_client_user()
        AND tenant_id = public.user_tenant_id()
        AND account_id = public.client_portal_account_id()
    );


-- =============================================================
-- CLAIM_ITEMS: Client can view claim items via their account claims
-- =============================================================

CREATE POLICY "Client users can view claim items in their account"
    ON public.claim_items FOR SELECT TO authenticated
    USING (
        public.is_client_user()
        AND EXISTS (
            SELECT 1 FROM public.claims c
            WHERE c.id = claim_items.claim_id
            AND c.tenant_id = public.user_tenant_id()
            AND c.account_id = public.client_portal_account_id()
        )
    );


-- =============================================================
-- REPAIR_QUOTES: Client can view quotes for their account
-- =============================================================

CREATE POLICY "Client users can view repair quotes in their account"
    ON public.repair_quotes FOR SELECT TO authenticated
    USING (
        public.is_client_user()
        AND tenant_id = public.user_tenant_id()
        AND account_id = public.client_portal_account_id()
    );


-- =============================================================
-- ITEM_PHOTOS: Client can view photos of items in their account
-- =============================================================

CREATE POLICY "Client users can view item photos in their account"
    ON public.item_photos FOR SELECT TO authenticated
    USING (
        public.is_client_user()
        AND EXISTS (
            SELECT 1 FROM public.items i
            WHERE i.id = item_photos.item_id
            AND i.tenant_id = public.user_tenant_id()
            AND i.account_id = public.client_portal_account_id()
        )
    );


-- =============================================================
-- SHIPMENT_DOCUMENTS: Client can view documents on their shipments
-- =============================================================

CREATE POLICY "Client users can view shipment documents in their account"
    ON public.shipment_documents FOR SELECT TO authenticated
    USING (
        public.is_client_user()
        AND EXISTS (
            SELECT 1 FROM public.shipments s
            WHERE s.id = shipment_documents.shipment_id
            AND s.tenant_id = public.user_tenant_id()
            AND s.account_id = public.client_portal_account_id()
        )
    );


-- =============================================================
-- SHIPMENT_NOTES: Client can view notes on their shipments
-- =============================================================

CREATE POLICY "Client users can view shipment notes in their account"
    ON public.shipment_notes FOR SELECT TO authenticated
    USING (
        public.is_client_user()
        AND EXISTS (
            SELECT 1 FROM public.shipments s
            WHERE s.id = shipment_notes.shipment_id
            AND s.tenant_id = public.user_tenant_id()
            AND s.account_id = public.client_portal_account_id()
        )
    );


-- =============================================================
-- SHIPMENT_PHOTOS: Client can view photos on their shipments
-- =============================================================

CREATE POLICY "Client users can view shipment photos in their account"
    ON public.shipment_photos FOR SELECT TO authenticated
    USING (
        public.is_client_user()
        AND EXISTS (
            SELECT 1 FROM public.shipments s
            WHERE s.id = shipment_photos.shipment_id
            AND s.tenant_id = public.user_tenant_id()
            AND s.account_id = public.client_portal_account_id()
        )
    );


-- =============================================================
-- Now tighten existing staff policies to exclude client users
-- This ensures client users ONLY go through the account-scoped policies above
-- =============================================================

-- ITEMS: Tighten existing tenant-wide SELECT to staff only
DROP POLICY IF EXISTS "Users can view items in their tenant" ON public.items;
CREATE POLICY "Staff can view items in their tenant"
    ON public.items FOR SELECT TO authenticated
    USING (
        NOT public.is_client_user()
        AND tenant_id = public.user_tenant_id()
    );

-- SHIPMENTS: Tighten existing tenant-wide SELECT to staff only
DROP POLICY IF EXISTS "Users can view shipments in their tenant" ON public.shipments;
CREATE POLICY "Staff can view shipments in their tenant"
    ON public.shipments FOR SELECT TO authenticated
    USING (
        NOT public.is_client_user()
        AND tenant_id = public.user_tenant_id()
    );

-- SHIPMENT_ITEMS: Tighten existing tenant-wide SELECT to staff only
DROP POLICY IF EXISTS "Users can view shipment items via shipment tenant" ON public.shipment_items;
CREATE POLICY "Staff can view shipment items in their tenant"
    ON public.shipment_items FOR SELECT TO authenticated
    USING (
        NOT public.is_client_user()
        AND EXISTS (
            SELECT 1 FROM public.shipments s
            WHERE s.id = shipment_items.shipment_id
            AND s.tenant_id = public.user_tenant_id()
        )
    );

-- CLAIMS: Tighten existing tenant-wide policy to staff only
DROP POLICY IF EXISTS "Tenant isolation for claims" ON public.claims;
CREATE POLICY "Staff can view claims in their tenant"
    ON public.claims FOR SELECT TO authenticated
    USING (
        NOT public.is_client_user()
        AND tenant_id = public.user_tenant_id()
    );
