-- Client Portal Invitations and Access
-- Allows warehouse staff to invite account contacts to access a client portal

-- Create client_portal_users table (clients who can log in)
CREATE TABLE IF NOT EXISTS public.client_portal_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,
  phone TEXT,

  is_primary BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,

  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),

  CONSTRAINT client_portal_users_email_tenant_unique UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_client_portal_users_tenant ON public.client_portal_users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_client_portal_users_account ON public.client_portal_users(account_id);
CREATE INDEX IF NOT EXISTS idx_client_portal_users_auth ON public.client_portal_users(auth_user_id);
CREATE INDEX IF NOT EXISTS idx_client_portal_users_email ON public.client_portal_users(email);

ALTER TABLE public.client_portal_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view client portal users in their tenant" ON public.client_portal_users;
CREATE POLICY "Staff can view client portal users in their tenant"
  ON public.client_portal_users FOR SELECT TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Staff can manage client portal users in their tenant" ON public.client_portal_users;
CREATE POLICY "Staff can manage client portal users in their tenant"
  ON public.client_portal_users FOR ALL TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

-- Create client_invitations table
CREATE TABLE IF NOT EXISTS public.client_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,

  email TEXT NOT NULL,
  first_name TEXT,
  last_name TEXT,

  token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'accepted', 'expired', 'cancelled')),

  sent_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES auth.users(id),

  client_portal_user_id UUID REFERENCES public.client_portal_users(id)
);

CREATE INDEX IF NOT EXISTS idx_client_invitations_tenant ON public.client_invitations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_client_invitations_account ON public.client_invitations(account_id);
CREATE INDEX IF NOT EXISTS idx_client_invitations_token ON public.client_invitations(token);
CREATE INDEX IF NOT EXISTS idx_client_invitations_email ON public.client_invitations(email);
CREATE INDEX IF NOT EXISTS idx_client_invitations_status ON public.client_invitations(status);

ALTER TABLE public.client_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view invitations in their tenant" ON public.client_invitations;
CREATE POLICY "Staff can view invitations in their tenant"
  ON public.client_invitations FOR SELECT TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Staff can manage invitations in their tenant" ON public.client_invitations;
CREATE POLICY "Staff can manage invitations in their tenant"
  ON public.client_invitations FOR ALL TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "Anyone can validate invitation tokens" ON public.client_invitations;
CREATE POLICY "Anyone can validate invitation tokens"
  ON public.client_invitations FOR SELECT TO anon
  USING (true);

-- Add trigger for updated_at
DROP TRIGGER IF EXISTS set_client_portal_users_updated_at ON public.client_portal_users;
CREATE TRIGGER set_client_portal_users_updated_at
  BEFORE UPDATE ON public.client_portal_users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Create email_logs table for tracking sent emails
CREATE TABLE IF NOT EXISTS public.email_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,

  email_type TEXT NOT NULL,
  recipient_email TEXT NOT NULL,
  recipient_name TEXT,
  subject TEXT NOT NULL,

  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'bounced')),

  resend_id TEXT,
  error_message TEXT,

  entity_type TEXT,
  entity_id UUID,

  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_logs_tenant ON public.email_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON public.email_logs(status);
CREATE INDEX IF NOT EXISTS idx_email_logs_type ON public.email_logs(email_type);
CREATE INDEX IF NOT EXISTS idx_email_logs_entity ON public.email_logs(entity_type, entity_id);

ALTER TABLE public.email_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view email logs in their tenant" ON public.email_logs;
CREATE POLICY "Staff can view email logs in their tenant"
  ON public.email_logs FOR SELECT TO authenticated
  USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "System can insert email logs" ON public.email_logs;
CREATE POLICY "System can insert email logs"
  ON public.email_logs FOR INSERT TO authenticated
  WITH CHECK (true);