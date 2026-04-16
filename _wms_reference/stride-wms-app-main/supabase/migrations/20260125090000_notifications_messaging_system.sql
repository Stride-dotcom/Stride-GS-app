-- ============================================================================
-- Notifications and Messaging System
-- Adds departments, in-app messaging, and notification support
-- ============================================================================

-- ============================================================================
-- 1. DEPARTMENTS TABLE
-- Allows organizing users into departments (e.g., Receiving, Inspection, Shipping)
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

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_departments_tenant ON public.departments(tenant_id) WHERE deleted_at IS NULL;

-- RLS policies
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "departments_tenant_isolation" ON public.departments;
CREATE POLICY "departments_tenant_isolation" ON public.departments
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

-- ============================================================================
-- 2. USER_DEPARTMENTS JUNCTION TABLE
-- Links users to departments (many-to-many)
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

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_user_departments_user ON public.user_departments(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_user_departments_department ON public.user_departments(department_id) WHERE deleted_at IS NULL;

-- RLS policies
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
-- Stores in-app messages between users
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES public.users(id),

  -- Subject and content
  subject TEXT NOT NULL,
  body TEXT NOT NULL,

  -- Message type
  message_type TEXT NOT NULL DEFAULT 'message' CHECK (message_type IN ('message', 'alert', 'system')),

  -- Priority
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),

  -- Optional link to related entity
  related_entity_type TEXT, -- 'shipment', 'item', 'task', 'invoice', 'claim', etc.
  related_entity_id UUID,

  -- Metadata for flexibility
  metadata JSONB DEFAULT '{}',

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_messages_tenant ON public.messages(tenant_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_sender ON public.messages(sender_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_messages_created ON public.messages(created_at DESC) WHERE deleted_at IS NULL;

-- RLS policies
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_tenant_isolation" ON public.messages;
CREATE POLICY "messages_tenant_isolation" ON public.messages
  FOR ALL USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

-- ============================================================================
-- 4. MESSAGE_RECIPIENTS TABLE
-- Tracks who receives each message and their read status
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.message_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,

  -- Recipient can be a user, role, or department
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('user', 'role', 'department')),
  recipient_id UUID NOT NULL, -- user_id, role_id, or department_id

  -- For department/role recipients, this expands to individual users
  user_id UUID REFERENCES public.users(id), -- The actual user who received it

  -- Read tracking
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,

  -- Archived (user can archive messages without deleting)
  is_archived BOOLEAN NOT NULL DEFAULT false,
  archived_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_message_recipients_message ON public.message_recipients(message_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_message_recipients_user ON public.message_recipients(user_id) WHERE deleted_at IS NULL AND is_archived = false;
CREATE INDEX IF NOT EXISTS idx_message_recipients_unread ON public.message_recipients(user_id, is_read) WHERE deleted_at IS NULL AND is_read = false;

-- RLS policies
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
-- 5. UPDATE ALERT_TYPES TO INCLUDE IN_APP NOTIFICATIONS
-- Add 'in_app' as a delivery channel option
-- ============================================================================

-- Check if alert_types table exists and add in_app channel support
DO $$
BEGIN
  -- Add in_app to the delivery_channels column if it uses an enum or check constraint
  -- For JSON-based channels, this is handled by the application
  NULL;
END $$;

-- ============================================================================
-- 6. IN_APP_NOTIFICATIONS TABLE
-- Links alerts to in-app notifications for real-time delivery
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.in_app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- Link to alert system (optional - notifications can also be standalone)
  alert_queue_id UUID REFERENCES public.alert_queue(id),
  notification_event_id UUID, -- Link to notification_events if triggered by alert

  -- Notification content
  title TEXT NOT NULL,
  body TEXT,
  icon TEXT, -- Icon name for display

  -- Categorization
  category TEXT NOT NULL DEFAULT 'general' CHECK (category IN (
    'general', 'shipment', 'item', 'task', 'invoice', 'claim', 'system', 'message'
  )),

  -- Related entity for click-through navigation
  related_entity_type TEXT,
  related_entity_id UUID,
  action_url TEXT, -- URL to navigate to when clicked

  -- Read tracking
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,

  -- Priority for display ordering
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ, -- Optional expiration
  deleted_at TIMESTAMPTZ
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_in_app_notifications_user ON public.in_app_notifications(user_id, is_read, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_in_app_notifications_unread ON public.in_app_notifications(user_id) WHERE deleted_at IS NULL AND is_read = false;

-- RLS policies
ALTER TABLE public.in_app_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "in_app_notifications_user_access" ON public.in_app_notifications;
CREATE POLICY "in_app_notifications_user_access" ON public.in_app_notifications
  FOR ALL USING (user_id = auth.uid());

-- ============================================================================
-- 7. FUNCTIONS FOR MESSAGING
-- ============================================================================

-- Function to expand department/role recipients to individual users
CREATE OR REPLACE FUNCTION expand_message_recipients()
RETURNS TRIGGER AS $$
BEGIN
  -- If recipient is a department, create entries for all users in that department
  IF NEW.recipient_type = 'department' AND NEW.user_id IS NULL THEN
    INSERT INTO public.message_recipients (message_id, recipient_type, recipient_id, user_id)
    SELECT
      NEW.message_id,
      'user',
      ud.user_id,
      ud.user_id
    FROM public.user_departments ud
    WHERE ud.department_id = NEW.recipient_id
    AND ud.deleted_at IS NULL
    ON CONFLICT (message_id, recipient_type, recipient_id) DO NOTHING;
  END IF;

  -- If recipient is a role, create entries for all users with that role
  IF NEW.recipient_type = 'role' AND NEW.user_id IS NULL THEN
    INSERT INTO public.message_recipients (message_id, recipient_type, recipient_id, user_id)
    SELECT
      NEW.message_id,
      'user',
      ur.user_id,
      ur.user_id
    FROM public.user_roles ur
    WHERE ur.role_id = NEW.recipient_id
    AND ur.deleted_at IS NULL
    ON CONFLICT (message_id, recipient_type, recipient_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to expand recipients
DROP TRIGGER IF EXISTS expand_message_recipients_trigger ON public.message_recipients;
CREATE TRIGGER expand_message_recipients_trigger
  AFTER INSERT ON public.message_recipients
  FOR EACH ROW
  EXECUTE FUNCTION expand_message_recipients();

-- Function to get unread message count for a user
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get unread notification count for a user
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get combined unread count (messages + notifications)
CREATE OR REPLACE FUNCTION get_total_unread_count(p_user_id UUID)
RETURNS INTEGER AS $$
BEGIN
  RETURN get_unread_message_count(p_user_id) + get_unread_notification_count(p_user_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to mark message as read
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to mark notification as read
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to mark all notifications as read for a user
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- 8. GRANT PERMISSIONS
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

-- ============================================================================
-- 9. SEED DEFAULT DEPARTMENTS
-- ============================================================================

-- Note: Default departments are tenant-specific and should be created
-- when a new tenant is onboarded, not as a global seed.
-- Example departments: Receiving, Inspection, Shipping, Administration
