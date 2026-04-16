-- Marketing campaigns, templates, settings read-cache tables
-- Admin/staff only (Marketing page is RoleGuarded to admin).

CREATE TABLE IF NOT EXISTS public.marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id text NOT NULL,
  name text, type text, status text, priority integer,
  target_type text, target_value text, enrollment_mode text,
  initial_template text, follow_up_1_template text, follow_up_2_template text, follow_up_3_template text,
  max_follow_ups integer, follow_up_interval_days integer,
  daily_send_limit integer, send_window_start integer, send_window_end integer,
  start_date text, end_date text, test_mode boolean DEFAULT false, test_recipient text,
  created_date text, last_run_date text, validation_status text, validation_notes text, last_error text,
  total_sent integer DEFAULT 0, total_replied integer DEFAULT 0, total_bounced integer DEFAULT 0,
  total_unsubscribed integer DEFAULT 0, total_converted integer DEFAULT 0,
  notes text, custom_1 text, custom_2 text, custom_3 text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.marketing_campaigns ADD CONSTRAINT marketing_campaigns_campaign_id_unique UNIQUE (campaign_id);
CREATE INDEX idx_marketing_campaigns_status ON public.marketing_campaigns (status);
ALTER TABLE public.marketing_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "marketing_campaigns_select_admin_staff" ON public.marketing_campaigns FOR SELECT USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));
CREATE POLICY "marketing_campaigns_service_role_all" ON public.marketing_campaigns FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE public.marketing_campaigns REPLICA IDENTITY FULL;

CREATE TABLE IF NOT EXISTS public.marketing_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL, subject text, preview_text text, html_body text,
  version text, type text, active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);
ALTER TABLE public.marketing_templates ADD CONSTRAINT marketing_templates_name_unique UNIQUE (name);
ALTER TABLE public.marketing_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "marketing_templates_select_admin_staff" ON public.marketing_templates FOR SELECT USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));
CREATE POLICY "marketing_templates_service_role_all" ON public.marketing_templates FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE public.marketing_templates REPLICA IDENTITY FULL;

CREATE TABLE IF NOT EXISTS public.marketing_settings (
  id integer PRIMARY KEY DEFAULT 1,
  daily_digest_email text, booking_url text, unsubscribe_base_url text,
  sender_name text, sender_phone text, sender_email text,
  send_from_email text, website_url text,
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT marketing_settings_singleton CHECK (id = 1)
);
ALTER TABLE public.marketing_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "marketing_settings_select_admin_staff" ON public.marketing_settings FOR SELECT USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));
CREATE POLICY "marketing_settings_service_role_all" ON public.marketing_settings FOR ALL USING (true) WITH CHECK (true);
ALTER TABLE public.marketing_settings REPLICA IDENTITY FULL;
