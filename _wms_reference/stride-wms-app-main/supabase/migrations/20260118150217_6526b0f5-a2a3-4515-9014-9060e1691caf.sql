-- ============================================
-- COMPREHENSIVE FEATURE MIGRATION
-- Employees, Receiving Sessions, Dashboard, Invoices, Account Recipients
-- ============================================

-- ============================================
-- A) EMPLOYEES - Extended user fields for pay data
-- ============================================

-- Add pay fields to users table (admin-only access via RLS)
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS phone TEXT,
ADD COLUMN IF NOT EXISTS pay_type TEXT CHECK (pay_type IN ('hourly', 'salary')),
ADD COLUMN IF NOT EXISTS pay_rate NUMERIC(10,2),
ADD COLUMN IF NOT EXISTS overtime_eligible BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS cost_center TEXT,
ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS invite_token TEXT,
ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS enrolled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS enrolled_at TIMESTAMPTZ;

-- Add repair_tech role if not exists
INSERT INTO public.roles (tenant_id, name, description, permissions, is_system)
SELECT t.id, 'repair_tech', 'Repair technician - handles item repairs and touch-ups', 
  '["items.read", "items.update", "tasks.read", "tasks.update", "notes.create", "notes.read", "attachments.create"]'::jsonb, true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.roles WHERE tenant_id = t.id AND name = 'repair_tech' AND deleted_at IS NULL
);

-- ============================================
-- B) RECEIVING SESSIONS - Lock shipment during receiving
-- ============================================

CREATE TABLE IF NOT EXISTS public.receiving_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  shipment_id UUID NOT NULL REFERENCES public.shipments(id),
  started_by UUID NOT NULL REFERENCES public.users(id),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'cancelled')),
  notes TEXT,
  verification_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(shipment_id, status) -- Only one active session per shipment
);

-- Enable RLS
ALTER TABLE public.receiving_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "receiving_sessions_tenant_isolation" ON public.receiving_sessions
  FOR ALL USING (tenant_id = public.get_current_user_tenant_id());

CREATE POLICY "receiving_sessions_select" ON public.receiving_sessions
  FOR SELECT USING (tenant_id = public.get_current_user_tenant_id());

CREATE POLICY "receiving_sessions_insert" ON public.receiving_sessions
  FOR INSERT WITH CHECK (tenant_id = public.get_current_user_tenant_id());

CREATE POLICY "receiving_sessions_update" ON public.receiving_sessions
  FOR UPDATE USING (tenant_id = public.get_current_user_tenant_id());

-- ============================================
-- D) DASHBOARD - User card order preferences
-- ============================================

CREATE TABLE IF NOT EXISTS public.user_dashboard_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  card_order JSONB DEFAULT '[]'::jsonb,
  hidden_cards JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE public.user_dashboard_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policies - users can only see/edit their own preferences
CREATE POLICY "user_dashboard_prefs_own" ON public.user_dashboard_preferences
  FOR ALL USING (user_id = auth.uid());

-- ============================================
-- F) INVOICES - Global sequence for invoice numbering
-- ============================================

-- Create invoice number sequence if not exists
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = 'invoice_number_seq') THEN
    CREATE SEQUENCE public.invoice_number_seq START WITH 1;
  END IF;
END $$;

-- Function to generate invoice number
CREATE OR REPLACE FUNCTION public.generate_invoice_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
    next_val INTEGER;
BEGIN
    next_val := nextval('invoice_number_seq');
    RETURN 'INV-' || LPAD(next_val::TEXT, 6, '0');
END;
$$;

-- ============================================
-- H) ACCOUNTS - Alert recipients field
-- ============================================

ALTER TABLE public.accounts 
ADD COLUMN IF NOT EXISTS account_alert_recipients TEXT;

-- ============================================
-- Communications - Add Employee Invite alert type
-- ============================================

-- Insert employee invite alert if it doesn't exist
INSERT INTO public.communication_alerts (tenant_id, name, key, description, trigger_event, channels, is_enabled)
SELECT t.id, 'Employee Invitation', 'EMPLOYEE_INVITE', 'Sent when a new employee is invited to the system', 'employee.invited',
  '{"email": true, "sms": false}'::jsonb, true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.communication_alerts WHERE tenant_id = t.id AND key = 'EMPLOYEE_INVITE'
);

-- Insert shipment received alert if it doesn't exist  
INSERT INTO public.communication_alerts (tenant_id, name, key, description, trigger_event, channels, is_enabled)
SELECT t.id, 'Shipment Received', 'SHIPMENT_RECEIVED', 'Sent when a shipment is fully received', 'shipment.received',
  '{"email": true, "sms": true}'::jsonb, true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.communication_alerts WHERE tenant_id = t.id AND key = 'SHIPMENT_RECEIVED'
);

-- Insert invoice created alert if it doesn't exist
INSERT INTO public.communication_alerts (tenant_id, name, key, description, trigger_event, channels, is_enabled)
SELECT t.id, 'Invoice Created', 'INVOICE_CREATED', 'Sent when a new invoice is generated', 'invoice.created',
  '{"email": true, "sms": false}'::jsonb, true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.communication_alerts WHERE tenant_id = t.id AND key = 'INVOICE_CREATED'
);

-- ============================================
-- Triggers
-- ============================================

CREATE OR REPLACE FUNCTION public.update_receiving_session_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_receiving_sessions_updated_at ON public.receiving_sessions;
CREATE TRIGGER update_receiving_sessions_updated_at
  BEFORE UPDATE ON public.receiving_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_receiving_session_updated_at();

DROP TRIGGER IF EXISTS update_user_dashboard_prefs_updated_at ON public.user_dashboard_preferences;
CREATE TRIGGER update_user_dashboard_prefs_updated_at
  BEFORE UPDATE ON public.user_dashboard_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();