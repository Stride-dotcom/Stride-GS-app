-- =============================================================================
-- Messages + Alerts inbox enhancements
-- - Archive support for in_app_notifications
-- - Read/unread helper RPCs for messages + notifications
-- - Unread counters exclude archived notifications
-- =============================================================================

ALTER TABLE public.in_app_notifications
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_in_app_notifications_user_archive
  ON public.in_app_notifications(user_id, is_archived, is_read, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.get_unread_notification_count(p_user_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)::integer
    FROM public.in_app_notifications
    WHERE user_id = p_user_id
      AND is_read = false
      AND COALESCE(is_archived, false) = false
      AND deleted_at IS NULL
      AND (expires_at IS NULL OR expires_at > now())
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_message_unread(
  p_message_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.message_recipients
  SET is_read = false, read_at = NULL
  WHERE message_id = p_message_id
    AND user_id = p_user_id
    AND deleted_at IS NULL;

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_messages_read()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.message_recipients
  SET is_read = true, read_at = now()
  WHERE user_id = auth.uid()
    AND is_read = false
    AND is_archived = false
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_message_for_me(
  p_message_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.message_recipients
  SET is_archived = true, archived_at = now()
  WHERE user_id = auth.uid()
    AND message_id = p_message_id
    AND deleted_at IS NULL;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_message_for_me(
  p_message_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.message_recipients
  SET is_archived = false, archived_at = NULL
  WHERE user_id = auth.uid()
    AND message_id = p_message_id
    AND deleted_at IS NULL;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_notification_unread(
  p_notification_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.in_app_notifications
  SET is_read = false, read_at = NULL
  WHERE id = p_notification_id
    AND user_id = auth.uid()
    AND deleted_at IS NULL;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.archive_notification_for_me(
  p_notification_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.in_app_notifications
  SET is_archived = true, archived_at = now()
  WHERE id = p_notification_id
    AND user_id = auth.uid()
    AND deleted_at IS NULL;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_notification_for_me(
  p_notification_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.in_app_notifications
  SET is_archived = false, archived_at = NULL
  WHERE id = p_notification_id
    AND user_id = auth.uid()
    AND deleted_at IS NULL;
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_all_alert_notifications_read()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.in_app_notifications
  SET is_read = true, read_at = now()
  WHERE user_id = auth.uid()
    AND is_read = false
    AND COALESCE(is_archived, false) = false
    AND deleted_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_message_unread(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_messages_read() TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_message_for_me(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_message_for_me(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_notification_unread(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_notification_for_me(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_notification_for_me(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_all_alert_notifications_read() TO authenticated;
