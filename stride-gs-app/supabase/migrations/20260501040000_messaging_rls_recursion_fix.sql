-- Session 89 hot-fix — messaging RLS infinite-recursion repair.
--
-- After applying 20260501030000_messaging_conversations_model_finish the
-- live DB started returning 500s on `GET /conversations` and on the
-- INSERT…RETURNING used by `useMessages.sendMessage`. Postgres logs:
--
--   ERROR  42P17: infinite recursion detected in policy for relation
--                 "conversation_participants"
--   ERROR  42P17: infinite recursion detected in policy for relation
--                 "messages"
--
-- Two cycles were involved.
--
--   Cycle A — conversations / conversation_participants:
--     conversations_select          → EXISTS conversation_participants
--     conv_participants_select      → EXISTS conversation_participants (self)
--   Postgres re-applies RLS to every reference of a table inside an RLS
--   subquery, so the self-EXISTS in conv_participants_select fired
--   conv_participants_select again, and again. Catastrophic loop.
--
--   Cycle B — messages / message_recipients:
--     messages_select_recipient     → EXISTS message_recipients
--     msg_recipients_select_own     → user_id = auth.uid()
--                                     OR EXISTS messages (sender branch)
--   Reading messages fired messages_select_recipient → which read
--   message_recipients → which fired msg_recipients_select_own's
--   sender-EXISTS branch on messages → loop.
--
-- Fix pattern: route the cross-table membership checks through
-- SECURITY DEFINER helper functions. SECURITY DEFINER bypasses RLS on
-- the inner SELECT, so each level resolves at depth 1.
--
--   public.is_conversation_member(conv_id, user_id) → BOOLEAN
--   public.is_message_sender   (msg_id,  user_id) → BOOLEAN
--
-- Rewritten policies:
--   • conversations_select               → is_conversation_member(id, auth.uid())
--   • conversations_update_participant   → is_conversation_member(id, auth.uid())
--   • conv_participants_select           → user_id = auth.uid() OR is_conversation_member(...)
--   • messages_select_via_conversation   → is_conversation_member(conversation_id, auth.uid())
--   • msg_recipients_select_own          → user_id = auth.uid() OR is_message_sender(...)
--   • msg_recipients_select_sender       → is_message_sender(message_id, auth.uid())
--
-- `messages_select_recipient` is dropped entirely — its purpose
-- (recipients see messages they're on) is now covered by
-- `messages_select_via_conversation`, since recipients are always on
-- `conversation_participants` for their conversation.

-- ────────────────────────────────────────────────────────────────────────
-- 1. Helper functions
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_conversation_member(
  p_conv_id UUID,
  p_user_id UUID
) RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_participants
    WHERE conversation_id = p_conv_id
      AND user_id = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_conversation_member(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_conversation_member(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.is_message_sender(
  p_message_id UUID,
  p_user_id    UUID
) RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.messages
    WHERE id = p_message_id
      AND sender_id = p_user_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_message_sender(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_message_sender(UUID, UUID) TO authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 2. Conversations / participants policies
-- ────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS conv_participants_select ON public.conversation_participants;
CREATE POLICY conv_participants_select ON public.conversation_participants
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_conversation_member(conversation_id, auth.uid())
  );

DROP POLICY IF EXISTS conversations_select ON public.conversations;
CREATE POLICY conversations_select ON public.conversations
  FOR SELECT
  USING (public.is_conversation_member(id, auth.uid()));

DROP POLICY IF EXISTS conversations_update_participant ON public.conversations;
CREATE POLICY conversations_update_participant ON public.conversations
  FOR UPDATE
  USING (public.is_conversation_member(id, auth.uid()));

-- ────────────────────────────────────────────────────────────────────────
-- 3. Messages / recipients policies
-- ────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS messages_select_via_conversation ON public.messages;
CREATE POLICY messages_select_via_conversation ON public.messages
  FOR SELECT TO authenticated
  USING (
    conversation_id IS NOT NULL
    AND public.is_conversation_member(conversation_id, auth.uid())
  );

-- Now that messages_select_via_conversation handles recipient visibility,
-- the old recipient-EXISTS subquery is redundant and was the second half
-- of the recursion cycle. Drop it.
DROP POLICY IF EXISTS messages_select_recipient ON public.messages;

DROP POLICY IF EXISTS msg_recipients_select_own ON public.message_recipients;
CREATE POLICY msg_recipients_select_own ON public.message_recipients
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_message_sender(message_id, auth.uid())
  );

DROP POLICY IF EXISTS msg_recipients_select_sender ON public.message_recipients;
CREATE POLICY msg_recipients_select_sender ON public.message_recipients
  FOR SELECT TO authenticated
  USING (public.is_message_sender(message_id, auth.uid()));
