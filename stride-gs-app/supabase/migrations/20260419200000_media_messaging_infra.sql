-- Session 73 — Media + messaging infrastructure (Phase A).
--
-- Six tables to replace the Drive-based photo/document flows and to stand
-- up an in-app messaging + notification system:
--
--   item_photos           photos keyed to an inventory item
--   documents             arbitrary files attached to shipments/items/tasks/etc
--   entity_notes          threaded notes against any entity
--   messages              user-to-user / user-to-role messages
--   message_recipients    fan-out of messages to specific recipients
--   in_app_notifications  toast / bell notifications
--
-- RLS mirrors the existing patterns:
--   - admin + staff see everything in their tenant or globally
--   - clients see only their own tenant rows (filtered by JWT clientSheetId)
--   - service_role bypasses everything (GAS writes)
-- Realtime publication is enabled on every table so Supabase-Realtime
-- subscriptions work the same way they do for inventory/tasks/etc.
--
-- Storage buckets `photos` and `documents` are also created below, both
-- private, with tenant-scoped path RLS on storage.objects.

-- ────────────────────────────────────────────────────────────────────────
-- 1. item_photos
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.item_photos (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id           text        NOT NULL,
  tenant_id         text        NOT NULL,
  storage_key       text        NOT NULL,
  storage_url       text,
  thumbnail_key     text,
  file_name         text,
  file_size         integer,
  mime_type         text,
  is_primary        boolean     DEFAULT false,
  needs_attention   boolean     DEFAULT false,
  is_repair         boolean     DEFAULT false,
  photo_type        text        DEFAULT 'general'
                      CHECK (photo_type IN ('general','inspection','repair','receiving')),
  entity_type       text,
  entity_id         text,
  uploaded_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_by_name  text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

COMMENT ON TABLE public.item_photos
  IS 'Session 73 Phase A: photos for inventory items. Storage keys live in the `photos` bucket, tenant-scoped path convention {tenant_id}/{item_id}/{photo_id}.jpg.';

CREATE INDEX IF NOT EXISTS idx_item_photos_tenant       ON public.item_photos (tenant_id);
CREATE INDEX IF NOT EXISTS idx_item_photos_item         ON public.item_photos (item_id);
CREATE INDEX IF NOT EXISTS idx_item_photos_entity       ON public.item_photos (entity_type, entity_id) WHERE entity_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_item_photos_needs_attn   ON public.item_photos (tenant_id) WHERE needs_attention = true;

ALTER TABLE public.item_photos REPLICA IDENTITY FULL;

CREATE OR REPLACE FUNCTION public.item_photos_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS item_photos_updated_at ON public.item_photos;
CREATE TRIGGER item_photos_updated_at
  BEFORE UPDATE ON public.item_photos
  FOR EACH ROW EXECUTE FUNCTION public.item_photos_touch_updated_at();

ALTER TABLE public.item_photos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "item_photos_select_staff" ON public.item_photos;
CREATE POLICY "item_photos_select_staff" ON public.item_photos
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'));

DROP POLICY IF EXISTS "item_photos_select_own_tenant" ON public.item_photos;
CREATE POLICY "item_photos_select_own_tenant" ON public.item_photos
  FOR SELECT TO authenticated
  USING (
    (auth.jwt()->'user_metadata'->>'role') = 'client'
    AND tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId')
  );

DROP POLICY IF EXISTS "item_photos_write_staff" ON public.item_photos;
CREATE POLICY "item_photos_write_staff" ON public.item_photos
  FOR ALL TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'))
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'));

DROP POLICY IF EXISTS "item_photos_service_all" ON public.item_photos;
CREATE POLICY "item_photos_service_all" ON public.item_photos
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────────────────
-- 2. documents
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.documents (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         text        NOT NULL,
  context_type      text        NOT NULL
                      CHECK (context_type IN ('shipment','item','task','repair','willcall','claim')),
  context_id        text        NOT NULL,
  storage_key       text        NOT NULL,
  file_name         text        NOT NULL,
  file_size         integer,
  mime_type         text,
  page_count        integer,
  ocr_text          text,
  uploaded_by       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_by_name  text,
  deleted_at        timestamptz,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

COMMENT ON TABLE public.documents
  IS 'Session 73 Phase A: arbitrary file attachments keyed to any entity. Soft-deleted via deleted_at. Files live in the `documents` bucket at {tenant_id}/{context_type}/{context_id}/{doc_id}.{ext}.';

CREATE INDEX IF NOT EXISTS idx_documents_tenant        ON public.documents (tenant_id);
CREATE INDEX IF NOT EXISTS idx_documents_context       ON public.documents (context_type, context_id);
CREATE INDEX IF NOT EXISTS idx_documents_not_deleted   ON public.documents (tenant_id, context_type, context_id) WHERE deleted_at IS NULL;

ALTER TABLE public.documents REPLICA IDENTITY FULL;

CREATE OR REPLACE FUNCTION public.documents_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS documents_updated_at ON public.documents;
CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.documents_touch_updated_at();

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "documents_select_staff" ON public.documents;
CREATE POLICY "documents_select_staff" ON public.documents
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'));

DROP POLICY IF EXISTS "documents_select_own_tenant" ON public.documents;
CREATE POLICY "documents_select_own_tenant" ON public.documents
  FOR SELECT TO authenticated
  USING (
    (auth.jwt()->'user_metadata'->>'role') = 'client'
    AND tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId')
    AND deleted_at IS NULL
  );

DROP POLICY IF EXISTS "documents_write_staff" ON public.documents;
CREATE POLICY "documents_write_staff" ON public.documents
  FOR ALL TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'))
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'));

DROP POLICY IF EXISTS "documents_service_all" ON public.documents;
CREATE POLICY "documents_service_all" ON public.documents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────────────────
-- 3. entity_notes
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.entity_notes (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    text        NOT NULL,
  entity_type  text        NOT NULL,
  entity_id    text        NOT NULL,
  body         text        NOT NULL,
  note_type    text        DEFAULT 'note'
                 CHECK (note_type IN ('note','system','status_change','mention')),
  visibility   text        DEFAULT 'public'
                 CHECK (visibility IN ('public','staff_only','internal')),
  author_id    uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  author_name  text,
  mentions     jsonb       DEFAULT '[]'::jsonb,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

COMMENT ON TABLE public.entity_notes
  IS 'Session 73 Phase A: threaded notes against any entity (task / repair / will call / claim / etc). Visibility gates whether clients can see them.';

CREATE INDEX IF NOT EXISTS idx_entity_notes_tenant  ON public.entity_notes (tenant_id);
CREATE INDEX IF NOT EXISTS idx_entity_notes_entity  ON public.entity_notes (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_entity_notes_created ON public.entity_notes (created_at DESC);

ALTER TABLE public.entity_notes REPLICA IDENTITY FULL;

CREATE OR REPLACE FUNCTION public.entity_notes_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
DROP TRIGGER IF EXISTS entity_notes_updated_at ON public.entity_notes;
CREATE TRIGGER entity_notes_updated_at
  BEFORE UPDATE ON public.entity_notes
  FOR EACH ROW EXECUTE FUNCTION public.entity_notes_touch_updated_at();

ALTER TABLE public.entity_notes ENABLE ROW LEVEL SECURITY;

-- Staff + admin see every note (including internal + staff_only).
DROP POLICY IF EXISTS "entity_notes_select_staff" ON public.entity_notes;
CREATE POLICY "entity_notes_select_staff" ON public.entity_notes
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'));

-- Clients see only 'public' notes in their own tenant.
DROP POLICY IF EXISTS "entity_notes_select_client" ON public.entity_notes;
CREATE POLICY "entity_notes_select_client" ON public.entity_notes
  FOR SELECT TO authenticated
  USING (
    (auth.jwt()->'user_metadata'->>'role') = 'client'
    AND tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId')
    AND visibility = 'public'
  );

-- Staff + admin write anywhere.
DROP POLICY IF EXISTS "entity_notes_write_staff" ON public.entity_notes;
CREATE POLICY "entity_notes_write_staff" ON public.entity_notes
  FOR ALL TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'))
  WITH CHECK ((auth.jwt()->'user_metadata'->>'role') IN ('admin','staff'));

-- Clients can add public notes on their own tenant (commenting on their
-- own tasks / will calls / etc). They can't write staff_only or internal.
DROP POLICY IF EXISTS "entity_notes_insert_client" ON public.entity_notes;
CREATE POLICY "entity_notes_insert_client" ON public.entity_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    (auth.jwt()->'user_metadata'->>'role') = 'client'
    AND tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId')
    AND visibility = 'public'
  );

DROP POLICY IF EXISTS "entity_notes_service_all" ON public.entity_notes;
CREATE POLICY "entity_notes_service_all" ON public.entity_notes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────────────────
-- 4. messages
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messages (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            text        NOT NULL,
  sender_id            uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject              text,
  body                 text        NOT NULL,
  message_type         text        DEFAULT 'message'
                         CHECK (message_type IN ('message','alert','system')),
  priority             text        DEFAULT 'normal'
                         CHECK (priority IN ('low','normal','high','urgent')),
  related_entity_type  text,
  related_entity_id    text,
  metadata             jsonb       DEFAULT '{}'::jsonb,
  created_at           timestamptz DEFAULT now()
);

COMMENT ON TABLE public.messages
  IS 'Session 73 Phase A: outgoing messages. Fan-out to recipients via message_recipients. Sender sees own sent; recipients see messages they are on.';

CREATE INDEX IF NOT EXISTS idx_messages_tenant  ON public.messages (tenant_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender  ON public.messages (sender_id);
CREATE INDEX IF NOT EXISTS idx_messages_related ON public.messages (related_entity_type, related_entity_id) WHERE related_entity_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_messages_created ON public.messages (created_at DESC);

ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Sender sees their own sent messages.
DROP POLICY IF EXISTS "messages_select_sender" ON public.messages;
CREATE POLICY "messages_select_sender" ON public.messages
  FOR SELECT TO authenticated
  USING (sender_id = auth.uid());

-- Recipients see messages they're on (via message_recipients join).
DROP POLICY IF EXISTS "messages_select_recipient" ON public.messages;
CREATE POLICY "messages_select_recipient" ON public.messages
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.message_recipients r
    WHERE r.message_id = messages.id
      AND r.user_id = auth.uid()
  ));

-- Any authenticated user can send a message (sender_id must be them).
DROP POLICY IF EXISTS "messages_insert_own" ON public.messages;
CREATE POLICY "messages_insert_own" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid());

-- Sender can delete their own (CASCADEs to message_recipients).
DROP POLICY IF EXISTS "messages_delete_sender" ON public.messages;
CREATE POLICY "messages_delete_sender" ON public.messages
  FOR DELETE TO authenticated
  USING (sender_id = auth.uid());

DROP POLICY IF EXISTS "messages_service_all" ON public.messages;
CREATE POLICY "messages_service_all" ON public.messages
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────────────────
-- 5. message_recipients
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.message_recipients (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      uuid        NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  recipient_type  text        DEFAULT 'user'
                    CHECK (recipient_type IN ('user','role','department')),
  recipient_id    text        NOT NULL,
  user_id         uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  is_read         boolean     DEFAULT false,
  read_at         timestamptz,
  is_archived     boolean     DEFAULT false,
  created_at      timestamptz DEFAULT now()
);

COMMENT ON TABLE public.message_recipients
  IS 'Session 73 Phase A: fan-out of messages to specific recipients. recipient_id is a free-form id (user uuid, role name, department slug). user_id is the resolved auth.users row — always set so the RLS join is indexable.';

CREATE INDEX IF NOT EXISTS idx_message_recipients_message  ON public.message_recipients (message_id);
CREATE INDEX IF NOT EXISTS idx_message_recipients_user     ON public.message_recipients (user_id);
CREATE INDEX IF NOT EXISTS idx_message_recipients_unread   ON public.message_recipients (user_id) WHERE is_read = false AND is_archived = false;

ALTER TABLE public.message_recipients REPLICA IDENTITY FULL;
ALTER TABLE public.message_recipients ENABLE ROW LEVEL SECURITY;

-- Recipient sees their own row.
DROP POLICY IF EXISTS "msg_recipients_select_own" ON public.message_recipients;
CREATE POLICY "msg_recipients_select_own" ON public.message_recipients
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Sender sees the recipient rows for their own message (so "sent" views can render the recipient list).
DROP POLICY IF EXISTS "msg_recipients_select_sender" ON public.message_recipients;
CREATE POLICY "msg_recipients_select_sender" ON public.message_recipients
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = message_recipients.message_id
      AND m.sender_id = auth.uid()
  ));

-- Recipients mark their OWN row read/archived.
DROP POLICY IF EXISTS "msg_recipients_update_own" ON public.message_recipients;
CREATE POLICY "msg_recipients_update_own" ON public.message_recipients
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Sender can insert recipient rows for a message they own.
DROP POLICY IF EXISTS "msg_recipients_insert_sender" ON public.message_recipients;
CREATE POLICY "msg_recipients_insert_sender" ON public.message_recipients
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.messages m
    WHERE m.id = message_recipients.message_id
      AND m.sender_id = auth.uid()
  ));

DROP POLICY IF EXISTS "msg_recipients_service_all" ON public.message_recipients;
CREATE POLICY "msg_recipients_service_all" ON public.message_recipients
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────────────────
-- 6. in_app_notifications
-- ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.in_app_notifications (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            text        NOT NULL,
  user_id              uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title                text        NOT NULL,
  body                 text,
  icon                 text,
  category             text,
  related_entity_type  text,
  related_entity_id    text,
  action_url           text,
  is_read              boolean     DEFAULT false,
  read_at              timestamptz,
  priority             text        DEFAULT 'normal'
                         CHECK (priority IN ('low','normal','high','urgent')),
  created_at           timestamptz DEFAULT now()
);

COMMENT ON TABLE public.in_app_notifications
  IS 'Session 73 Phase A: toast + bell notifications. One row per (user, event). Written by triggers / GAS service-role inserts; the user marks read through the bell UI.';

CREATE INDEX IF NOT EXISTS idx_in_app_notifications_tenant  ON public.in_app_notifications (tenant_id);
CREATE INDEX IF NOT EXISTS idx_in_app_notifications_user    ON public.in_app_notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_in_app_notifications_unread  ON public.in_app_notifications (user_id) WHERE is_read = false;

ALTER TABLE public.in_app_notifications REPLICA IDENTITY FULL;
ALTER TABLE public.in_app_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select_own" ON public.in_app_notifications;
CREATE POLICY "notifications_select_own" ON public.in_app_notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "notifications_update_own" ON public.in_app_notifications;
CREATE POLICY "notifications_update_own" ON public.in_app_notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Any authenticated user can write a notification row for another user
-- (e.g. a comment triggers a mention notification for the mentioned user).
-- Tighten later if abuse becomes a concern.
DROP POLICY IF EXISTS "notifications_insert_auth" ON public.in_app_notifications;
CREATE POLICY "notifications_insert_auth" ON public.in_app_notifications
  FOR INSERT TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS "notifications_service_all" ON public.in_app_notifications;
CREATE POLICY "notifications_service_all" ON public.in_app_notifications
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ────────────────────────────────────────────────────────────────────────
-- Realtime — add every table to the supabase_realtime publication.
-- ────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'item_photos','documents','entity_notes',
    'messages','message_recipients','in_app_notifications'
  ])
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────
-- Storage buckets: photos + documents (both private).
-- Path convention: {tenant_id}/{context...}/filename. First segment is the
-- tenant id, which we check in the RLS policies below so clients can only
-- read their own tenant's objects.
-- ────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
  VALUES ('photos', 'photos', false)
  ON CONFLICT (id) DO UPDATE SET public = false;

INSERT INTO storage.buckets (id, name, public)
  VALUES ('documents', 'documents', false)
  ON CONFLICT (id) DO UPDATE SET public = false;

-- Clean up any prior versions of our policies on storage.objects so the
-- migration is idempotent.
DROP POLICY IF EXISTS "photos_select_tenant" ON storage.objects;
DROP POLICY IF EXISTS "photos_write_staff"    ON storage.objects;
DROP POLICY IF EXISTS "photos_service_all"    ON storage.objects;
DROP POLICY IF EXISTS "documents_select_tenant" ON storage.objects;
DROP POLICY IF EXISTS "documents_write_staff"    ON storage.objects;
DROP POLICY IF EXISTS "documents_service_all"    ON storage.objects;

-- photos bucket: staff/admin read all; clients read own-tenant only.
CREATE POLICY "photos_select_tenant" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'photos'
    AND (
      (auth.jwt()->'user_metadata'->>'role') IN ('admin','staff')
      OR split_part(name, '/', 1) = (auth.jwt()->'user_metadata'->>'clientSheetId')
    )
  );

CREATE POLICY "photos_write_staff" ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'photos'
    AND (auth.jwt()->'user_metadata'->>'role') IN ('admin','staff')
  )
  WITH CHECK (
    bucket_id = 'photos'
    AND (auth.jwt()->'user_metadata'->>'role') IN ('admin','staff')
  );

CREATE POLICY "photos_service_all" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'photos')
  WITH CHECK (bucket_id = 'photos');

-- documents bucket: same access model.
CREATE POLICY "documents_select_tenant" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'documents'
    AND (
      (auth.jwt()->'user_metadata'->>'role') IN ('admin','staff')
      OR split_part(name, '/', 1) = (auth.jwt()->'user_metadata'->>'clientSheetId')
    )
  );

CREATE POLICY "documents_write_staff" ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'documents'
    AND (auth.jwt()->'user_metadata'->>'role') IN ('admin','staff')
  )
  WITH CHECK (
    bucket_id = 'documents'
    AND (auth.jwt()->'user_metadata'->>'role') IN ('admin','staff')
  );

CREATE POLICY "documents_service_all" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'documents')
  WITH CHECK (bucket_id = 'documents');
