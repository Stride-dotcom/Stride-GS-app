-- Session 89 — Messaging rebuild on the conversations model.
--
-- Three things this migration does:
--
-- 1. Backfill the 42 messages still sitting at conversation_id IS NULL
--    (sent after the original backfill in 20260422040000 because nothing
--    on the write path was assigning conversation_id). Same DM/group/entity
--    bucketing logic as the original migration; the SELECTs are scoped to
--    `WHERE conversation_id IS NULL` so it's idempotent on re-run.
--
-- 2. Add the canonical `messages_select_via_conversation` SELECT policy.
--    The conversations migration declared it but the live DB doesn't have
--    it (verified via pg_policy). With the rewritten useMessages.ts every
--    new send goes through find_or_create_conversation → INSERT message
--    with conversation_id, so participant-based visibility is the right
--    primary path. `messages_select_sender` and `messages_select_recipient`
--    stay in place as fallbacks for legacy NULL-conversation rows and as
--    a safety net during INSERT...RETURNING (the sender's own row is
--    always readable via sender_id = auth.uid(), even before the
--    participant subquery resolves).
--
-- 3. Drop `messages_select_staff` — admin/staff are NOT exempt from the
--    "you only see messages you sent or received" product rule. Recipient
--    picker filtering happens in React; visibility is uniform at the RLS
--    layer.
--
-- 4. Add two SECURITY DEFINER RPCs the React `sendMessage` flow relies on:
--    `find_or_create_dm_conversation(other_user_ids, tenant_id)` and
--    `find_or_create_entity_conversation(entity_type, entity_id,
--    tenant_id, other_user_ids)`. Both return the conversation id and
--    seed `conversation_participants` rows for every involved user. They
--    bypass RLS on conversations/participants (necessary because a
--    fresh conversation has no participant rows yet, so the standard
--    SELECT policies would block the participants insert).

-- ────────────────────────────────────────────────────────────────────────
-- 1. Backfill
-- ────────────────────────────────────────────────────────────────────────

-- 1a. Entity messages → entity conversations.
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
  AND m.related_entity_id IS NOT NULL
  AND m.conversation_id IS NULL
GROUP BY m.related_entity_type, m.related_entity_id
ON CONFLICT DO NOTHING;

UPDATE public.messages m
SET conversation_id = c.id
FROM public.conversations c
WHERE c.kind = 'entity'
  AND c.related_entity_type = m.related_entity_type
  AND c.related_entity_id   = m.related_entity_id
  AND m.conversation_id IS NULL;

-- 1b. Seed participants from senders + recipients across the whole
--     messages table (not just newly-stamped rows — re-running is
--     idempotent thanks to the PK ON CONFLICT).
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

-- 1c. DM/group messages → conversation per sorted participant signature.
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
    -- Reuse an existing matching conversation if one exists (prevents
    -- duplicates when this migration is run a second time after new
    -- DM/group messages have already been bucketed).
    SELECT c.id INTO v_conv_id
    FROM public.conversations c
    WHERE c.kind = rec.kind
      AND c.related_entity_type IS NULL
      AND (
        SELECT array_agg(p.user_id ORDER BY p.user_id)
        FROM public.conversation_participants p
        WHERE p.conversation_id = c.id
      ) = rec.sig
    LIMIT 1;

    IF v_conv_id IS NULL THEN
      INSERT INTO public.conversations (kind, tenant_id, created_at, last_message_at)
      VALUES (rec.kind, rec.tenant_id, rec.first_at, rec.last_at)
      RETURNING id INTO v_conv_id;

      INSERT INTO public.conversation_participants (conversation_id, user_id, joined_at)
      SELECT v_conv_id, u, rec.first_at
      FROM unnest(rec.sig) AS u
      ON CONFLICT DO NOTHING;
    END IF;

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
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────────────────
-- 2. Canonical SELECT policy: read messages where I'm a participant.
-- ────────────────────────────────────────────────────────────────────────
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

-- ────────────────────────────────────────────────────────────────────────
-- 3. Drop the staff-sees-everything visibility leak.
-- ────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "messages_select_staff" ON public.messages;

-- ────────────────────────────────────────────────────────────────────────
-- 4. Conversation find-or-create RPCs.
--    SECURITY DEFINER so the participant rows can be inserted before any
--    participant exists for the new conversation (which would otherwise
--    block the conversation INSERT under the participant-EXISTS RLS
--    policies on conversations/conversation_participants).
-- ────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.find_or_create_dm_conversation(
  p_other_user_ids UUID[],
  p_tenant_id      TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_self             UUID := auth.uid();
  v_all_participants UUID[];
  v_conv_id          UUID;
  v_kind             TEXT;
BEGIN
  IF v_self IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Build the sorted, distinct participant set from {self} ∪ p_other_user_ids.
  SELECT array_agg(DISTINCT u ORDER BY u) INTO v_all_participants
  FROM unnest(array[v_self] || COALESCE(p_other_user_ids, ARRAY[]::UUID[])) AS u
  WHERE u IS NOT NULL;

  IF v_all_participants IS NULL OR array_length(v_all_participants, 1) < 2 THEN
    RAISE EXCEPTION 'find_or_create_dm_conversation needs at least one other participant';
  END IF;

  v_kind := CASE WHEN array_length(v_all_participants, 1) = 2 THEN 'dm' ELSE 'group' END;

  -- Find an existing DM/group conversation whose participant set is
  -- *exactly* this signature (no missing, no extra).
  SELECT c.id INTO v_conv_id
  FROM public.conversations c
  WHERE c.kind = v_kind
    AND c.related_entity_type IS NULL
    AND (
      SELECT array_agg(p.user_id ORDER BY p.user_id)
      FROM public.conversation_participants p
      WHERE p.conversation_id = c.id
    ) = v_all_participants
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    RETURN v_conv_id;
  END IF;

  INSERT INTO public.conversations (kind, tenant_id, created_by, last_message_at)
  VALUES (v_kind, p_tenant_id, v_self, NOW())
  RETURNING id INTO v_conv_id;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  SELECT v_conv_id, u FROM unnest(v_all_participants) AS u
  ON CONFLICT DO NOTHING;

  RETURN v_conv_id;
END;
$$;

REVOKE ALL ON FUNCTION public.find_or_create_dm_conversation(UUID[], TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_or_create_dm_conversation(UUID[], TEXT) TO authenticated;


CREATE OR REPLACE FUNCTION public.find_or_create_entity_conversation(
  p_entity_type    TEXT,
  p_entity_id      TEXT,
  p_tenant_id      TEXT,
  p_other_user_ids UUID[]
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_self    UUID := auth.uid();
  v_conv_id UUID;
BEGIN
  IF v_self IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_entity_type IS NULL OR p_entity_id IS NULL THEN
    RAISE EXCEPTION 'entity_type and entity_id are required';
  END IF;

  -- Look up the existing entity conversation; create on miss. The
  -- nested BEGIN…EXCEPTION handles the rare race where a concurrent
  -- caller inserts between our SELECT and INSERT (the partial unique
  -- index on (related_entity_type, related_entity_id) raises
  -- unique_violation in that case).
  SELECT id INTO v_conv_id
  FROM public.conversations
  WHERE related_entity_type = p_entity_type
    AND related_entity_id   = p_entity_id
  LIMIT 1;

  IF v_conv_id IS NULL THEN
    BEGIN
      INSERT INTO public.conversations (
        kind, related_entity_type, related_entity_id, tenant_id,
        created_by, last_message_at
      )
      VALUES ('entity', p_entity_type, p_entity_id, p_tenant_id, v_self, NOW())
      RETURNING id INTO v_conv_id;
    EXCEPTION WHEN unique_violation THEN
      SELECT id INTO v_conv_id
      FROM public.conversations
      WHERE related_entity_type = p_entity_type
        AND related_entity_id   = p_entity_id
      LIMIT 1;
    END;
  END IF;

  -- Add self + provided users as participants. ON CONFLICT (PK) handles
  -- the idempotent case where we're re-opening a thread we're already in.
  INSERT INTO public.conversation_participants (conversation_id, user_id)
  SELECT v_conv_id, u
  FROM unnest(array[v_self] || COALESCE(p_other_user_ids, ARRAY[]::UUID[])) AS u
  WHERE u IS NOT NULL
  ON CONFLICT DO NOTHING;

  RETURN v_conv_id;
END;
$$;

REVOKE ALL ON FUNCTION public.find_or_create_entity_conversation(TEXT, TEXT, TEXT, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.find_or_create_entity_conversation(TEXT, TEXT, TEXT, UUID[]) TO authenticated;
