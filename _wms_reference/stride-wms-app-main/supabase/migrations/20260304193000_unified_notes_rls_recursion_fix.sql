-- =============================================================================
-- Unified Notes - RLS recursion fix
-- =============================================================================
-- Fixes infinite recursion between:
--   - notes client SELECT policy (which queried note_entity_links)
--   - note_entity_links client SELECT policy (which queried notes)
--
-- Symptoms in diagnostics:
--   code 42P17 "infinite recursion detected in policy for relation \"notes\""
-- =============================================================================

DROP POLICY IF EXISTS "Client users can read public notes in their account context" ON public.notes;

CREATE POLICY "Client users can read public notes in their account context"
  ON public.notes FOR SELECT
  TO authenticated
  USING (
    public.is_client_user()
    AND tenant_id = public.user_tenant_id()
    AND visibility = 'public'
    AND (
      (source_entity_type = 'shipment' AND EXISTS (
        SELECT 1
        FROM public.shipments s
        WHERE s.id = source_entity_id
          AND s.tenant_id = public.user_tenant_id()
          AND s.account_id = public.client_portal_account_id()
      ))
      OR (source_entity_type = 'item' AND EXISTS (
        SELECT 1
        FROM public.items i
        WHERE i.id = source_entity_id
          AND i.tenant_id = public.user_tenant_id()
          AND i.account_id = public.client_portal_account_id()
      ))
      OR (source_entity_type = 'task' AND EXISTS (
        SELECT 1
        FROM public.tasks t
        WHERE t.id = source_entity_id
          AND t.tenant_id = public.user_tenant_id()
          AND t.account_id = public.client_portal_account_id()
      ))
      OR (source_entity_type = 'claim' AND EXISTS (
        SELECT 1
        FROM public.claims c
        WHERE c.id = source_entity_id
          AND c.tenant_id = public.user_tenant_id()
          AND c.account_id = public.client_portal_account_id()
      ))
      OR (source_entity_type = 'quote' AND EXISTS (
        SELECT 1
        FROM public.quotes q
        WHERE q.id = source_entity_id
          AND q.tenant_id = public.user_tenant_id()
          AND q.account_id = public.client_portal_account_id()
      ))
      OR (source_entity_type = 'repair_quote' AND EXISTS (
        SELECT 1
        FROM public.repair_quotes rq
        WHERE rq.id = source_entity_id
          AND rq.tenant_id = public.user_tenant_id()
          AND rq.account_id = public.client_portal_account_id()
      ))
    )
  );
