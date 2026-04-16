-- Create tenant_preferences table for organization operational settings
CREATE TABLE public.tenant_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  
  -- Storage & Inspection Settings (ACTIVE)
  free_storage_days INTEGER NOT NULL DEFAULT 0,
  will_call_minimum DECIMAL(10,2) NOT NULL DEFAULT 30.00,
  should_create_inspections BOOLEAN NOT NULL DEFAULT false,
  
  -- Billing & Rate Settings (only daily_storage_rate ACTIVE for now)
  daily_storage_rate_per_cuft DECIMAL(10,4) NOT NULL DEFAULT 0.04,
  
  -- Future billing rates (stored but UI disabled)
  shipment_minimum DECIMAL(10,2) DEFAULT 0.00,
  hourly_rate DECIMAL(10,2) DEFAULT 250.00,
  base_rate_includes_pieces INTEGER DEFAULT 3,
  additional_piece_rate DECIMAL(10,2) DEFAULT 20.00,
  items_to_switch_to_hourly INTEGER DEFAULT 20,
  max_assemblies_in_base_rate INTEGER DEFAULT 0,
  base_order_minutes INTEGER DEFAULT 4,
  extra_stop_rate DECIMAL(10,2) DEFAULT 125.00,
  high_rise_additional_piece_fee DECIMAL(10,2) DEFAULT 0.00,
  exchange_order_addition DECIMAL(10,2) DEFAULT 125.00,
  extra_furniture_moving_minimum DECIMAL(10,2) DEFAULT 40.00,
  
  -- Cancellation & Removal Fees (future)
  late_cancellation_fee DECIMAL(10,2) DEFAULT 100.00,
  removal_first_2_pieces DECIMAL(10,2) DEFAULT 185.00,
  removal_extra_piece_default DECIMAL(10,2) DEFAULT 0.00,
  
  -- Custom Field Labels (future)
  order_field_label TEXT DEFAULT 'Order #',
  order_field_required BOOLEAN DEFAULT true,
  custom_field_1_label TEXT DEFAULT 'Sidemark',
  custom_field_1_required BOOLEAN DEFAULT false,
  
  -- Operational Rules (future)
  require_signature_to_finish BOOLEAN DEFAULT true,
  allow_typed_name_as_signature BOOLEAN DEFAULT true,
  allow_billing_to_consumer BOOLEAN DEFAULT true,
  allow_billing_to_account BOOLEAN DEFAULT true,
  allow_felt_pads BOOLEAN DEFAULT true,
  
  -- Scheduling & Reservations (future)
  default_order_bill_to TEXT DEFAULT 'No Default',
  morning_starts_at TIME DEFAULT '09:00',
  window_length_hours INTEGER DEFAULT 2,
  reservation_cut_off_time TIME DEFAULT '10:00',
  reservation_prep_days_required INTEGER DEFAULT 0,
  num_reservation_date_choices INTEGER DEFAULT 6,
  minutes_before_arrival_notification INTEGER DEFAULT 15,
  
  -- Break Settings (future)
  break_minutes INTEGER DEFAULT 30,
  break_every_hours INTEGER DEFAULT 4,
  
  -- Default Notes
  default_shipment_notes TEXT,
  
  -- Legal & Policy Links (ACTIVE)
  terms_of_service_url TEXT,
  privacy_policy_url TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT tenant_preferences_tenant_id_unique UNIQUE(tenant_id)
);

-- Enable RLS
ALTER TABLE public.tenant_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view their tenant preferences"
  ON public.tenant_preferences
  FOR SELECT
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

CREATE POLICY "Tenant admins can insert preferences"
  ON public.tenant_preferences
  FOR INSERT
  WITH CHECK (
    tenant_id IN (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

CREATE POLICY "Tenant admins can update preferences"
  ON public.tenant_preferences
  FOR UPDATE
  USING (
    tenant_id IN (
      SELECT tenant_id FROM public.users WHERE id = auth.uid()
    )
  );

-- Create trigger for updated_at
CREATE TRIGGER update_tenant_preferences_updated_at
  BEFORE UPDATE ON public.tenant_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Add released_at column to items table for tracking when items exit active inventory
ALTER TABLE public.items ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;

-- Add email domain configuration columns to communication_brand_settings
ALTER TABLE public.communication_brand_settings 
  ADD COLUMN IF NOT EXISTS custom_email_domain TEXT,
  ADD COLUMN IF NOT EXISTS email_domain_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS email_verification_type TEXT CHECK (email_verification_type IN ('simple', 'dns')),
  ADD COLUMN IF NOT EXISTS email_verification_token TEXT,
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dkim_verified BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS spf_verified BOOLEAN DEFAULT false;