-- Add bill_to field to tasks table
ALTER TABLE public.tasks 
ADD COLUMN IF NOT EXISTS bill_to TEXT DEFAULT 'account' CHECK (bill_to IN ('account', 'customer', 'no_charge'));

-- Add bill_to_customer_name for when billing to a different customer
ALTER TABLE public.tasks 
ADD COLUMN IF NOT EXISTS bill_to_customer_name TEXT;

-- Add bill_to_customer_email for customer billing
ALTER TABLE public.tasks 
ADD COLUMN IF NOT EXISTS bill_to_customer_email TEXT;

-- Add labor_rate to users table for employee time tracking
ALTER TABLE public.users 
ADD COLUMN IF NOT EXISTS labor_rate NUMERIC DEFAULT 0;

-- Add default_receiving_notes to accounts table
ALTER TABLE public.accounts 
ADD COLUMN IF NOT EXISTS default_receiving_notes TEXT;

-- Create photos storage bucket if not exists
INSERT INTO storage.buckets (id, name, public)
VALUES ('photos', 'photos', true)
ON CONFLICT (id) DO NOTHING;

-- Create storage policies for photos bucket
CREATE POLICY "Authenticated users can upload photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'photos');

CREATE POLICY "Authenticated users can view photos"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'photos');

CREATE POLICY "Users can update their own photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'photos');

CREATE POLICY "Users can delete their own photos"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'photos');

-- Add photo_urls JSONB column to items for storing photo references
ALTER TABLE public.items 
ADD COLUMN IF NOT EXISTS photo_urls JSONB DEFAULT '[]'::jsonb;

-- Add inspection_photos and repair_photos columns
ALTER TABLE public.items 
ADD COLUMN IF NOT EXISTS inspection_photos JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.items 
ADD COLUMN IF NOT EXISTS repair_photos JSONB DEFAULT '[]'::jsonb;

-- Add receiving documents to shipments
ALTER TABLE public.shipments 
ADD COLUMN IF NOT EXISTS receiving_documents JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.shipments 
ADD COLUMN IF NOT EXISTS receiving_photos JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.shipments 
ADD COLUMN IF NOT EXISTS receiving_notes TEXT;

-- Create will_call_orders table enhancements for signature
ALTER TABLE public.will_call_orders 
ADD COLUMN IF NOT EXISTS signature_data TEXT;

ALTER TABLE public.will_call_orders 
ADD COLUMN IF NOT EXISTS signature_name TEXT;

ALTER TABLE public.will_call_orders 
ADD COLUMN IF NOT EXISTS picked_up_by TEXT;

ALTER TABLE public.will_call_orders 
ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMP WITH TIME ZONE;

ALTER TABLE public.will_call_orders 
ADD COLUMN IF NOT EXISTS bill_to TEXT DEFAULT 'account' CHECK (bill_to IN ('account', 'customer', 'no_charge'));

-- Create disposal_orders table for tracking disposals
CREATE TABLE IF NOT EXISTS public.disposal_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  account_id UUID REFERENCES public.accounts(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
  bill_to TEXT DEFAULT 'account' CHECK (bill_to IN ('account', 'customer', 'no_charge')),
  bill_to_customer_name TEXT,
  disposal_reason TEXT,
  disposal_method TEXT,
  notes TEXT,
  completed_at TIMESTAMP WITH TIME ZONE,
  completed_by UUID REFERENCES public.users(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  deleted_at TIMESTAMP WITH TIME ZONE
);

-- Enable RLS on disposal_orders
ALTER TABLE public.disposal_orders ENABLE ROW LEVEL SECURITY;

-- RLS policies for disposal_orders
CREATE POLICY "Users can view disposal orders in their tenant"
ON public.disposal_orders FOR SELECT
USING (tenant_id = user_tenant_id());

CREATE POLICY "Users can create disposal orders in their tenant"
ON public.disposal_orders FOR INSERT
WITH CHECK (tenant_id = user_tenant_id());

CREATE POLICY "Users can update disposal orders in their tenant"
ON public.disposal_orders FOR UPDATE
USING (tenant_id = user_tenant_id());

-- Create disposal_order_items junction table
CREATE TABLE IF NOT EXISTS public.disposal_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  disposal_order_id UUID NOT NULL REFERENCES public.disposal_orders(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.items(id),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on disposal_order_items
ALTER TABLE public.disposal_order_items ENABLE ROW LEVEL SECURITY;

-- RLS policies for disposal_order_items
CREATE POLICY "Users can view disposal order items"
ON public.disposal_order_items FOR SELECT
USING (
  disposal_order_id IN (
    SELECT id FROM public.disposal_orders WHERE tenant_id = user_tenant_id()
  )
);

CREATE POLICY "Users can manage disposal order items"
ON public.disposal_order_items FOR ALL
USING (
  disposal_order_id IN (
    SELECT id FROM public.disposal_orders WHERE tenant_id = user_tenant_id()
  )
);

-- Add quantity, vendor, item_type_id to receiving process
ALTER TABLE public.receiving_batches 
ADD COLUMN IF NOT EXISTS vendor TEXT;

ALTER TABLE public.receiving_batches 
ADD COLUMN IF NOT EXISTS receiving_documents JSONB DEFAULT '[]'::jsonb;

ALTER TABLE public.receiving_batches 
ADD COLUMN IF NOT EXISTS receiving_photos JSONB DEFAULT '[]'::jsonb;

-- Create index for faster dashboard queries
CREATE INDEX IF NOT EXISTS idx_items_current_location ON public.items(current_location_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_status_type ON public.tasks(status, task_type) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON public.tasks(due_date) WHERE deleted_at IS NULL AND status NOT IN ('completed', 'cancelled');