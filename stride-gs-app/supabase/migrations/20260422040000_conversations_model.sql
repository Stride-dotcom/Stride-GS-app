-- ============================================================================
-- Conversations model (standard IM design)
--
-- Replaces the recipient-derived "thread" computation with a real
-- conversations table + participant list. Eliminates the asymmetric-RLS
-- bugs that made outgoing DMs disappear from open threads (Session 78
-- bandaid leaked outgoing messages across threads).
--
-- Strategy:
--   1. Create `conversations` and `conversation_participants` tables
--   2. Add `messages.conversation_id` (nullable during cutover)
--   3. Backfill: bucket existing messages into conversations and seed
--      participants from sender + recipients
--   4. RLS: read access via conversation participation
--   5. Keep `message_recipients` alive for read receipts + back-compat
--      during the React cutover (read receipts may move into
--      `conversation_participants.last_read_at` later)
-- ============================================================================

-- 1. conversations -----------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.conversations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                TEXT NOT NULL CHECK (kind IN ('dm', 'group', 'entity')),
  related_entity_type TEXT,
  related_entity_id   TEXT,
  tenant_id           TEXT,
  created_by          UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at     TIMESTAMPTZ
);

-- Entity conversations are uniquely keyed by (entity_type, entity_id) so
-- there can only be one thread per task/repair/will-call/shipment.
CREATE UNIQUE INDEX IF NOT EXISTS conversations_entity_unique
  ON public.conversations(related_entity_type, related_entity_id)
  WHERE related_entity_type IS NOT NULL AND related_entity_id IS NOT NULL;

-- 2. conversation_participants ----------------------------------------------

CREATE TABLE IF NOT EXISTS public.conversation_participants (
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL,
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_read_at    TIMESTAMPTZ,
  is_archived     BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (conversation_id, user_id)
);

CREATE INDEX IF NOT EXISTS conversation_participants_user_idx
  ON public.conversation_participants(user_id);

-- 3. messages.conversation_id ------------------------------------------------

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES public.conversations(id);

CREATE INDEX IF NOT EXISTS messages_conversation_idx
  ON public.messages(conversation_id, created_at);

-- 4. Backfill — entity conversations ----------------------------------------

-- 4a. Insert one conversation per (entity_type, entity_id).
INSERT INTO public.conversations (kind, related_entity_type, related_entity_id, tenant_id, created_at, last_message_at)
SELECT
  'entity',
  m.related_entity_type,
  m.related_entity_id,
  MAX(m.tenant_id),
  MIN(m.created_at),
  MAX(m.created_at)
FROM public.messages m
WHERE m.related_entity_type IS NOT NULL
  AND m.related_entity_id   IS NOT NULL
  AND m.conversation_id     IS NULL
GROUP BY m.related_entity_type, m.related_entity_id
ON CONFLICT DO NOTHING;

-- 4b. Stamp conversation_id onto each entity message.
UPDATE public.messages m
SET conversation_id = c.id
FROM public.conversations c
WHERE c.kind = 'entity'
  AND c.related_entity_type = m.related_entity_type
  AND c.related_entity_id   = m.related_entity_id
  AND m.conversation_id IS NULL;

-- 4c. Seed entity participants from senders + recipients across the thread.
INSERT INTO public.conversation_participants (conversation_id, user_id, joined_at)
SELECT DISTINCT m.conversation_id, m.sender_id, MIN(m.created_at)
FROM public.messages m
WHERE m.conversation_id IS NOT NULL AND m.sender_id IS NOT NULL
GROUP BY m.conversation_id, m.sender_id
ON CONFLICT DO NOTHING;

INSERT INTO public.conversation_participants (conversation_id, user_id, joined_at)
SELECT DISTINCT m.conversation_id, mr.user_id, MIN(m.created_at)
FROM public.messages m
JOIN public.message_recipients mr ON mr.message_id = m.id
WHERE m.conversation_id IS NOT NULL AND mr.user_id IS NOT NULL
GROUP BY m.conversation_id, mr.user_id
ON CONFLICT DO NOTHING;

-- 5. Backfill — direct message conversations --------------------------------
--
-- For DMs, the conversation key is the sorted set of participant uids.
-- We loop one signature at a time inside a DO block so the whole backfill
-- runs in one execution context (TEMP TABLE didn't survive across
-- statements in the Supabase SQL editor's transaction wrapping).
DO $$
DECLARE
  rec RECORD;
  v_conv_id UUID;
BEGIN
  FOR rec IN
    SELECT
      sig,
      MAX(tenant_id) AS tenant_id,
      MIN(created_at) AS first_at,
      MAX(created_at) AS last_at,
      CASE WHEN array_length(sig, 1) <= 2 THEN 'dm' ELSE 'group' END AS kind
    FROM (
      SELECT
        m.id AS message_id,
        m.tenant_id,
        m.created_at,
        (
          SELECT array_agg(DISTINCT u ORDER BY u)
          FROM unnest(
            ARRAY[m.sender_id] || COALESCE(
              (SELECT array_agg(mr.user_id) FROM public.message_recipients mr WHERE mr.message_id = m.id),
              ARRAY[]::uuid[]
            )
          ) AS u
          WHERE u IS NOT NULL
        ) AS sig
      FROM public.messages m
      WHERE m.related_entity_type IS NULL
        AND m.conversation_id IS NULL
        AND m.sender_id IS NOT NULL
    ) AS sig_per_msg
    WHERE sig IS NOT NULL AND array_length(sig, 1) >= 1
    GROUP BY sig
  LOOP
    INSERT INTO public.conversations (kind, tenant_id, created_at, last_message_at)
    VALUES (rec.kind, rec.tenant_id, rec.first_at, rec.last_at)
    RETURNING id INTO v_conv_id;

    UPDATE public.messages m
    SET conversation_id = v_conv_id
    WHERE m.related_entity_type IS NULL
      AND m.conversation_id IS NULL
      AND m.sender_id IS NOT NULL
      AND (
        SELECT array_agg(DISTINCT u ORDER BY u)
        FROM unnest(
          ARRAY[m.sender_id] || COALESCE(
            (SELECT array_agg(mr.user_id) FROM public.message_recipients mr WHERE mr.message_id = m.id),
            ARRAY[]::uuid[]
          )
        ) AS u
        WHERE u IS NOT NULL
      ) = rec.sig;

    INSERT INTO public.conversation_participants (conversation_id, user_id, joined_at)
    SELECT v_conv_id, u, rec.first_at
    FROM unnest(rec.sig) AS u
    ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- 6. RLS on conversations ----------------------------------------------------

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS conversations_select ON public.conversations;
CREATE POLICY conversations_select ON public.conversations
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants p
      WHERE p.conversation_id = conversations.id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS conversations_insert ON public.conversations;
CREATE POLICY conversations_insert ON public.conversations
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS conversations_update_participant ON public.conversations;
CREATE POLICY conversations_update_participant ON public.conversations
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants p
      WHERE p.conversation_id = conversations.id
        AND p.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS conversations_service_all ON public.conversations;
CREATE POLICY conversations_service_all ON public.conversations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 7. RLS on conversation_participants ---------------------------------------

ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;

-- Participants can see all rows for any conversation they're in (so they
-- can render the participant list / "who's read this" markers).
DROP POLICY IF EXISTS conv_participants_select ON public.conversation_participants;
CREATE POLICY conv_participants_select ON public.conversation_participants
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.conversation_participants self
      WHERE self.conversation_id = conversation_participants.conversation_id
        AND self.user_id = auth.uid()
    )
  );

-- Inserts are open (sendMessage creates participant rows server-side).
DROP POLICY IF EXISTS conv_participants_insert ON public.conversation_participants;
CREATE POLICY conv_participants_insert ON public.conversation_participants
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- A user can only update their OWN participant row (last_read_at, archived).
DROP POLICY IF EXISTS conv_participants_update_own ON public.conversation_participants;
CREATE POLICY conv_participants_update_own ON public.conversation_participants
  FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS conv_participants_service_all ON public.conversation_participants;
CREATE POLICY conv_participants_service_all ON public.conversation_participants
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 8. RLS on messages — add conversation-based read path ---------------------
-- Keep the existing `messages_select_sender` + `messages_select_recipient`
-- policies as fallbacks during cutover. Postgres OR's all SELECT policies
-- together, so adding this new one strictly broadens visibility (no risk
-- of locking anyone out). It can be retired once the front-end is fully
-- on the conversations model.
DROP POLICY IF EXISTS "messages_select_via_conversation" ON public.messages;
CREATE POLICY "messages_select_via_conversation" ON public.messages
  FOR SELECT TO authenticated
  USING (
    conversation_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.conversation_participants p
      WHERE p.conversation_id = messages.conversation_id
        AND p.user_id = auth.uid()
    )
  );

-- 9. Realtime publication ---------------------------------------------------
-- Add the new tables to supabase_realtime so the React hook can subscribe
-- to conversation/message changes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversation_participants'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_participants';
  END IF;
END $$;

-- 10. Trigger to update conversations.last_message_at ----------------------

CREATE OR REPLACE FUNCTION public.touch_conversation_last_message_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.conversation_id IS NOT NULL THEN
    UPDATE public.conversations
    SET last_message_at = GREATEST(COALESCE(last_message_at, NEW.created_at), NEW.created_at)
    WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS messages_touch_conversation ON public.messages;
CREATE TRIGGER messages_touch_conversation
  AFTER INSERT ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_conversation_last_message_at();
