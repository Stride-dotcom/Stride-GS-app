-- Session 74: let the sender of a message read all recipient rows for
-- that message. The previous policy only allowed user_id = auth.uid(),
-- which meant when the sender loaded their own sent message they could
-- only see their own self-recipient row — not the row for the person
-- they sent it to. Client-side filter "participants must include both
-- self and other" then rejected the message, so the sender's bubble
-- disappeared the moment the thread refreshed.
--
-- This is safe: you already know who you sent the message to (you
-- typed it), so letting you SELECT those rows leaks nothing new.
-- Recipients still only see their own rows (via user_id match).

DROP POLICY IF EXISTS msg_recipients_select_own ON public.message_recipients;

CREATE POLICY msg_recipients_select_own ON public.message_recipients
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.messages m
      WHERE m.id = message_recipients.message_id
        AND m.sender_id = auth.uid()
    )
  );
