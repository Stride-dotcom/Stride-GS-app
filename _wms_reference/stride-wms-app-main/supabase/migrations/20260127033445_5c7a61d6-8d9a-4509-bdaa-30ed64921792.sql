-- ============================================================================
-- Notifications and Messaging System
-- Adds departments, in-app messaging, and notification support
-- ============================================================================

-- ============================================================================
-- 1. DEPARTMENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_departments_tenant ON public.departments(tenant_id) WHERE deleted_at IS NULL;

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "departments_tenant_isolation" ON public.departments;
CREATE POLICY "departments_tenant_isolation" ON public.departments
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

-- ============================================================================
-- 2. USER_DEPARTMENTS JUNCTION TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.user_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.users(id),
  deleted_at TIMESTAMPTZ,
  UNIQUE(user_id, department_id)
);

CREATE INDEX IF NOT EXISTS idx_user_departments_user ON public.user_departments(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_departments_department ON public.user_departments(department_id) WHERE deleted_at IS NULL;

ALTER TABLE public.user_departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_departments_tenant_isolation" ON public.user_departments;
CREATE POLICY "user_departments_tenant_isolation" ON public.user_departments
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = user_departments.user_id
      AND u.tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
    )
  );

-- ============================================================================
-- 3. MESSAGES TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.users(id),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  message_type TEXT NOT NULL DEFAULT 'message' CHECK (message_type IN ('message', 'alert', 'system')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  related_entity_type TEXT,
  related_entity_id UUID,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_messages_tenant ON public.messages(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages(sender_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_created ON public.messages(created_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_tenant_isolation" ON public.messages;
CREATE POLICY "messages_tenant_isolation" ON public.messages
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

-- ============================================================================
-- 4. MESSAGE_RECIPIENTS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.message_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('user', 'role', 'department')),
  recipient_id UUID NOT NULL,
  user_id UUID REFERENCES public.users(id),
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_message_recipients_message ON public.message_recipients(message_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_message_recipients_user ON public.message_recipients(user_id) WHERE deleted_at IS NULL AND is_archived = false;
CREATE INDEX IF NOT EXISTS idx_message_recipients_unread ON public.message_recipients(user_id, is_read) WHERE deleted_at IS NULL AND is_read = false;

ALTER TABLE public.message_recipients ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "message_recipients_user_access" ON public.message_recipients;
CREATE POLICY "message_recipients_user_access" ON public.message_recipients
  FOR ALL USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.messages m WHERE m.id = message_recipients.message_id AND m.sender_id = auth.uid()
    )
  );

-- ============================================================================
-- 5. IN_APP_NOTIFICATIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.in_app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  alert_queue_id UUID REFERENCES public.alert_queue(id),
  notification_event_id UUID,
  title TEXT NOT NULL,
  body TEXT,
  icon TEXT,
  category TEXT NOT NULL DEFAULT 'general' CHECK (category IN (
    'general', 'shipment', 'item', 'task', 'invoice', 'claim', 'system', 'message'
  )),
  related_entity_type TEXT,
  related_entity_id UUID,
  action_url TEXT,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_in_app_notifications_user ON public.in_app_notifications(user_id, is_read, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_in_app_notifications_unread ON public.in_app_notifications(user_id) WHERE deleted_at IS NULL AND is_read = false;

ALTER TABLE public.in_app_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "in_app_notifications_user_access" ON public.in_app_notifications;
CREATE POLICY "in_app_notifications_user_access" ON public.in_app_notifications
  FOR ALL USING (user_id = auth.uid());

-- ============================================================================
-- 6. MESSAGING FUNCTIONS
-- ============================================================================

CREATE OR REPLACE FUNCTION get_unread_message_count(p_user_id UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)::INTEGER
    FROM public.message_recipients mr
    JOIN public.messages m ON m.id = mr.message_id
    WHERE mr.user_id = p_user_id
    AND mr.is_read = false
    AND mr.deleted_at IS NULL
    AND m.deleted_at IS NULL
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION get_unread_notification_count(p_user_id UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN (
    SELECT COUNT(*)::INTEGER
    FROM public.in_app_notifications
    WHERE user_id = p_user_id
    AND is_read = false
    AND deleted_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION get_total_unread_count(p_user_id UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN get_unread_message_count(p_user_id) + get_unread_notification_count(p_user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION mark_message_read(p_message_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE public.message_recipients
  SET is_read = true, read_at = now()
  WHERE message_id = p_message_id
  AND user_id = p_user_id
  AND deleted_at IS NULL;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION mark_notification_read(p_notification_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE public.in_app_notifications
  SET is_read = true, read_at = now()
  WHERE id = p_notification_id
  AND user_id = auth.uid()
  AND deleted_at IS NULL;
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION mark_all_notifications_read()
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE public.in_app_notifications
  SET is_read = true, read_at = now()
  WHERE user_id = auth.uid()
  AND is_read = false
  AND deleted_at IS NULL;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ============================================================================
-- 7. GRANT PERMISSIONS
-- ============================================================================

GRANT ALL ON public.departments TO authenticated;
GRANT ALL ON public.user_departments TO authenticated;
GRANT ALL ON public.messages TO authenticated;
GRANT ALL ON public.message_recipients TO authenticated;
GRANT ALL ON public.in_app_notifications TO authenticated;

GRANT EXECUTE ON FUNCTION get_unread_message_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_unread_notification_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_total_unread_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_message_read(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_notification_read(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_all_notifications_read() TO authenticated;