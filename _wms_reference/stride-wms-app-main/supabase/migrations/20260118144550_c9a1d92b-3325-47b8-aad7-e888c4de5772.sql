-- Communication Alerts table
CREATE TABLE public.communication_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  key TEXT NOT NULL,
  description TEXT,
  is_enabled BOOLEAN NOT NULL DEFAULT true,
  channels JSONB NOT NULL DEFAULT '{"email": true, "sms": true}'::jsonb,
  trigger_event TEXT NOT NULL,
  timing_rule TEXT NOT NULL DEFAULT 'immediate',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, key)
);

-- Communication Templates table
CREATE TABLE public.communication_templates (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  alert_id UUID NOT NULL REFERENCES public.communication_alerts(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'sms')),
  subject_template TEXT,
  body_template TEXT NOT NULL,
  body_format TEXT NOT NULL DEFAULT 'html' CHECK (body_format IN ('html', 'text')),
  from_name TEXT,
  from_email TEXT,
  sms_sender_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(alert_id, channel)
);

-- Communication Template Versions table
CREATE TABLE public.communication_template_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_id UUID NOT NULL REFERENCES public.communication_templates(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL,
  subject_template TEXT,
  body_template TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.users(id)
);

-- Communication Design Elements table
CREATE TABLE public.communication_design_elements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('icon', 'header_block', 'button', 'divider', 'callout')),
  html_snippet TEXT NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Communication Brand Settings table
CREATE TABLE public.communication_brand_settings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE UNIQUE,
  brand_logo_url TEXT,
  brand_primary_color TEXT NOT NULL DEFAULT '#FD5A2A',
  brand_support_email TEXT,
  portal_base_url TEXT,
  from_name TEXT DEFAULT 'Stride Logistics',
  from_email TEXT,
  sms_sender_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.communication_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_design_elements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.communication_brand_settings ENABLE ROW LEVEL SECURITY;

-- Helper function to check if user is admin
CREATE OR REPLACE FUNCTION public.is_communication_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.roles r ON ur.role_id = r.id
    WHERE ur.user_id = auth.uid() 
    AND ur.deleted_at IS NULL
    AND r.key IN ('admin', 'super_admin')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS Policies for communication_alerts
CREATE POLICY "Users can view their tenant alerts"
ON public.communication_alerts FOR SELECT
USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Admins can insert alerts"
ON public.communication_alerts FOR INSERT
WITH CHECK (
  tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  AND public.is_communication_admin()
);

CREATE POLICY "Admins can update alerts"
ON public.communication_alerts FOR UPDATE
USING (
  tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  AND public.is_communication_admin()
);

CREATE POLICY "Admins can delete alerts"
ON public.communication_alerts FOR DELETE
USING (
  tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  AND public.is_communication_admin()
);

-- RLS Policies for communication_templates
CREATE POLICY "Users can view their tenant templates"
ON public.communication_templates FOR SELECT
USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Admins can insert templates"
ON public.communication_templates FOR INSERT
WITH CHECK (
  tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  AND public.is_communication_admin()
);

CREATE POLICY "Admins can update templates"
ON public.communication_templates FOR UPDATE
USING (
  tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  AND public.is_communication_admin()
);

CREATE POLICY "Admins can delete templates"
ON public.communication_templates FOR DELETE
USING (
  tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  AND public.is_communication_admin()
);

-- RLS Policies for communication_template_versions
CREATE POLICY "Users can view their tenant template versions"
ON public.communication_template_versions FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.communication_templates t
    WHERE t.id = template_id
    AND t.tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  )
);

CREATE POLICY "Admins can insert template versions"
ON public.communication_template_versions FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.communication_templates t
    WHERE t.id = template_id
    AND t.tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  )
  AND public.is_communication_admin()
);

-- RLS Policies for communication_design_elements
CREATE POLICY "Users can view design elements"
ON public.communication_design_elements FOR SELECT
USING (
  is_system = true
  OR tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
);

CREATE POLICY "Admins can insert design elements"
ON public.communication_design_elements FOR INSERT
WITH CHECK (
  tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  AND public.is_communication_admin()
);

CREATE POLICY "Admins can update design elements"
ON public.communication_design_elements FOR UPDATE
USING (
  tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  AND is_system = false
  AND public.is_communication_admin()
);

CREATE POLICY "Admins can delete design elements"
ON public.communication_design_elements FOR DELETE
USING (
  tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  AND is_system = false
  AND public.is_communication_admin()
);

-- RLS Policies for communication_brand_settings
CREATE POLICY "Users can view their tenant brand settings"
ON public.communication_brand_settings FOR SELECT
USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "Admins can insert brand settings"
ON public.communication_brand_settings FOR INSERT
WITH CHECK (
  tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  AND public.is_communication_admin()
);

CREATE POLICY "Admins can update brand settings"
ON public.communication_brand_settings FOR UPDATE
USING (
  tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  AND public.is_communication_admin()
);

-- Insert system design elements (icons and blocks)
INSERT INTO public.communication_design_elements (name, category, html_snippet, is_system) VALUES
('Warehouse', 'icon', '<img src="data:image/svg+xml,%3Csvg xmlns=''http://www.w3.org/2000/svg'' width=''24'' height=''24'' viewBox=''0 0 24 24'' fill=''none'' stroke=''%23FD5A2A'' stroke-width=''2'' stroke-linecap=''round'' stroke-linejoin=''round''%3E%3Cpath d=''M22 8.35V20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.35A2 2 0 0 1 3.26 6.5l8-3.2a2 2 0 0 1 1.48 0l8 3.2A2 2 0 0 1 22 8.35Z''/%3E%3Cpath d=''M6 18h12''/%3E%3Cpath d=''M6 14h12''/%3E%3Crect x=''6'' y=''10'' width=''12'' height=''12''/%3E%3C/svg%3E" alt="Warehouse" style="width:24px;height:24px;vertical-align:middle;" />', true),
('Delivery Truck', 'icon', '<img src="data:image/svg+xml,%3Csvg xmlns=''http://www.w3.org/2000/svg'' width=''24'' height=''24'' viewBox=''0 0 24 24'' fill=''none'' stroke=''%23FD5A2A'' stroke-width=''2'' stroke-linecap=''round'' stroke-linejoin=''round''%3E%3Cpath d=''M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2''/%3E%3Cpath d=''M15 18H9''/%3E%3Cpath d=''M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14''/%3E%3Ccircle cx=''17'' cy=''18'' r=''2''/%3E%3Ccircle cx=''7'' cy=''18'' r=''2''/%3E%3C/svg%3E" alt="Truck" style="width:24px;height:24px;vertical-align:middle;" />', true),
('Person', 'icon', '<img src="data:image/svg+xml,%3Csvg xmlns=''http://www.w3.org/2000/svg'' width=''24'' height=''24'' viewBox=''0 0 24 24'' fill=''none'' stroke=''%23FD5A2A'' stroke-width=''2'' stroke-linecap=''round'' stroke-linejoin=''round''%3E%3Ccircle cx=''12'' cy=''8'' r=''5''/%3E%3Cpath d=''M20 21a8 8 0 0 0-16 0''/%3E%3C/svg%3E" alt="Person" style="width:24px;height:24px;vertical-align:middle;" />', true),
('Camera', 'icon', '<img src="data:image/svg+xml,%3Csvg xmlns=''http://www.w3.org/2000/svg'' width=''24'' height=''24'' viewBox=''0 0 24 24'' fill=''none'' stroke=''%23FD5A2A'' stroke-width=''2'' stroke-linecap=''round'' stroke-linejoin=''round''%3E%3Cpath d=''M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z''/%3E%3Ccircle cx=''12'' cy=''13'' r=''3''/%3E%3C/svg%3E" alt="Camera" style="width:24px;height:24px;vertical-align:middle;" />', true),
('Checkmark', 'icon', '<img src="data:image/svg+xml,%3Csvg xmlns=''http://www.w3.org/2000/svg'' width=''24'' height=''24'' viewBox=''0 0 24 24'' fill=''none'' stroke=''%2322c55e'' stroke-width=''2'' stroke-linecap=''round'' stroke-linejoin=''round''%3E%3Cpath d=''M22 11.08V12a10 10 0 1 1-5.93-9.14''/%3E%3Cpath d=''m9 11 3 3L22 4''/%3E%3C/svg%3E" alt="Checkmark" style="width:24px;height:24px;vertical-align:middle;" />', true),
('Alert', 'icon', '<img src="data:image/svg+xml,%3Csvg xmlns=''http://www.w3.org/2000/svg'' width=''24'' height=''24'' viewBox=''0 0 24 24'' fill=''none'' stroke=''%23eab308'' stroke-width=''2'' stroke-linecap=''round'' stroke-linejoin=''round''%3E%3Cpath d=''m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3''/%3E%3Cpath d=''M12 9v4''/%3E%3Cpath d=''M12 17h.01''/%3E%3C/svg%3E" alt="Alert" style="width:24px;height:24px;vertical-align:middle;" />', true),
('Package', 'icon', '<img src="data:image/svg+xml,%3Csvg xmlns=''http://www.w3.org/2000/svg'' width=''24'' height=''24'' viewBox=''0 0 24 24'' fill=''none'' stroke=''%23FD5A2A'' stroke-width=''2'' stroke-linecap=''round'' stroke-linejoin=''round''%3E%3Cpath d=''m7.5 4.27 9 5.15''/%3E%3Cpath d=''M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z''/%3E%3Cpath d=''m3.3 7 8.7 5 8.7-5''/%3E%3Cpath d=''M12 22V12''/%3E%3C/svg%3E" alt="Package" style="width:24px;height:24px;vertical-align:middle;" />', true),
('Calendar', 'icon', '<img src="data:image/svg+xml,%3Csvg xmlns=''http://www.w3.org/2000/svg'' width=''24'' height=''24'' viewBox=''0 0 24 24'' fill=''none'' stroke=''%23FD5A2A'' stroke-width=''2'' stroke-linecap=''round'' stroke-linejoin=''round''%3E%3Cpath d=''M8 2v4''/%3E%3Cpath d=''M16 2v4''/%3E%3Crect width=''18'' height=''18'' x=''3'' y=''4'' rx=''2''/%3E%3Cpath d=''M3 10h18''/%3E%3C/svg%3E" alt="Calendar" style="width:24px;height:24px;vertical-align:middle;" />', true),
('Location', 'icon', '<img src="data:image/svg+xml,%3Csvg xmlns=''http://www.w3.org/2000/svg'' width=''24'' height=''24'' viewBox=''0 0 24 24'' fill=''none'' stroke=''%23FD5A2A'' stroke-width=''2'' stroke-linecap=''round'' stroke-linejoin=''round''%3E%3Cpath d=''M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z''/%3E%3Ccircle cx=''12'' cy=''10'' r=''3''/%3E%3C/svg%3E" alt="Location" style="width:24px;height:24px;vertical-align:middle;" />', true),
('Simple Divider', 'divider', '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td style="border-top:1px solid #e5e7eb;"></td></tr></table>', true),
('Accent Divider', 'divider', '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td style="border-top:2px solid #FD5A2A;"></td></tr></table>', true),
('Success Callout', 'callout', '<table width="100%" cellpadding="16" cellspacing="0" border="0" style="background-color:#f0fdf4;border-left:4px solid #22c55e;border-radius:8px;margin:16px 0;"><tr><td style="color:#166534;font-size:14px;">Your content here</td></tr></table>', true),
('Info Callout', 'callout', '<table width="100%" cellpadding="16" cellspacing="0" border="0" style="background-color:#eff6ff;border-left:4px solid #3b82f6;border-radius:8px;margin:16px 0;"><tr><td style="color:#1e40af;font-size:14px;">Your content here</td></tr></table>', true),
('Warning Callout', 'callout', '<table width="100%" cellpadding="16" cellspacing="0" border="0" style="background-color:#fefce8;border-left:4px solid #eab308;border-radius:8px;margin:16px 0;"><tr><td style="color:#854d0e;font-size:14px;">Your content here</td></tr></table>', true),
('Primary CTA Button', 'button', '<table cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;"><tr><td style="background-color:#FD5A2A;border-radius:6px;"><a href="{{portal_base_url}}" target="_blank" style="display:inline-block;padding:12px 24px;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;">View in Portal</a></td></tr></table>', true),
('Secondary Button', 'button', '<table cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;"><tr><td style="background-color:#ffffff;border:2px solid #FD5A2A;border-radius:6px;"><a href="{{portal_base_url}}" target="_blank" style="display:inline-block;padding:12px 24px;color:#FD5A2A;text-decoration:none;font-weight:600;font-size:14px;">Learn More</a></td></tr></table>', true),
('Email Header', 'header_block', '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#111111;border-radius:8px 8px 0 0;"><tr><td style="padding:24px;text-align:center;"><span style="color:#ffffff;font-size:20px;font-weight:700;">Stride Logistics</span></td></tr></table>', true),
('Email Footer', 'header_block', '<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;border-radius:0 0 8px 8px;margin-top:24px;"><tr><td style="padding:24px;text-align:center;color:#6b7280;font-size:12px;"><p style="margin:0 0 8px;">Need help? Contact us at {{brand_support_email}}</p><table cellpadding="0" cellspacing="0" border="0" style="margin:16px auto;"><tr><td style="background-color:#FD5A2A;border-radius:6px;"><a href="{{portal_base_url}}" target="_blank" style="display:inline-block;padding:10px 20px;color:#ffffff;text-decoration:none;font-weight:600;font-size:13px;">Open Portal</a></td></tr></table></td></tr></table>', true);

-- Create updated_at triggers
CREATE OR REPLACE FUNCTION update_communication_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_communication_alerts_updated_at
BEFORE UPDATE ON public.communication_alerts
FOR EACH ROW EXECUTE FUNCTION update_communication_updated_at();

CREATE TRIGGER update_communication_templates_updated_at
BEFORE UPDATE ON public.communication_templates
FOR EACH ROW EXECUTE FUNCTION update_communication_updated_at();

CREATE TRIGGER update_communication_brand_settings_updated_at
BEFORE UPDATE ON public.communication_brand_settings
FOR EACH ROW EXECUTE FUNCTION update_communication_updated_at();