-- Phase 1: Database Schema Updates for Document Spec Features

-- Add item flags columns to items table
ALTER TABLE public.items 
ADD COLUMN IF NOT EXISTS is_overweight BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_oversize BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_unstackable BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS is_crated BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS needs_repair BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS needs_inspection BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS needs_warehouse_assembly BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS notify_dispatch BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS has_damage BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS primary_photo_url TEXT;

-- Add threaded notes support to existing item_notes table
ALTER TABLE public.item_notes 
ADD COLUMN IF NOT EXISTS parent_note_id UUID REFERENCES public.item_notes(id),
ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS is_current BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id);

-- Create item_photos table for photo management
CREATE TABLE IF NOT EXISTS public.item_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    storage_key TEXT NOT NULL,
    storage_url TEXT,
    file_name TEXT NOT NULL,
    file_size INTEGER,
    mime_type TEXT,
    is_primary BOOLEAN DEFAULT false,
    needs_attention BOOLEAN DEFAULT false,
    photo_type TEXT DEFAULT 'general',
    uploaded_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create repair_quotes table
CREATE TABLE IF NOT EXISTS public.repair_quotes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    flat_rate NUMERIC(10,2),
    technician_user_id UUID,
    technician_name TEXT,
    approval_status TEXT DEFAULT 'pending',
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    notes TEXT,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create repair_tech_tokens table for magic link access
CREATE TABLE IF NOT EXISTS public.repair_tech_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    token TEXT NOT NULL UNIQUE,
    technician_name TEXT,
    technician_email TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    accessed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create billing_events table for automated billing triggers
CREATE TABLE IF NOT EXISTS public.billing_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    account_id UUID,
    item_id UUID,
    task_id UUID,
    event_type TEXT NOT NULL,
    charge_type TEXT NOT NULL,
    description TEXT,
    quantity INTEGER DEFAULT 1,
    unit_rate NUMERIC(10,2) NOT NULL,
    total_amount NUMERIC(10,2) NOT NULL,
    needs_review BOOLEAN DEFAULT false,
    invoice_id UUID,
    invoiced_at TIMESTAMPTZ,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create task_notes table for threaded notes on tasks
CREATE TABLE IF NOT EXISTS public.task_notes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL,
    parent_note_id UUID,
    note TEXT NOT NULL,
    note_type TEXT DEFAULT 'internal',
    is_required BOOLEAN DEFAULT false,
    created_by UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add unable_to_complete fields to tasks table
ALTER TABLE public.tasks 
ADD COLUMN IF NOT EXISTS unable_to_complete BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS unable_to_complete_reason TEXT,
ADD COLUMN IF NOT EXISTS unable_to_complete_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS unable_to_complete_by UUID;

-- Create alert_queue table for email notifications
CREATE TABLE IF NOT EXISTS public.alert_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL,
    alert_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    recipient_emails TEXT[],
    subject TEXT NOT NULL,
    body_html TEXT,
    body_text TEXT,
    status TEXT DEFAULT 'pending',
    sent_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on new tables
ALTER TABLE public.item_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repair_tech_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alert_queue ENABLE ROW LEVEL SECURITY;

-- RLS Policies for item_photos
CREATE POLICY "item_photos_select" ON public.item_photos FOR SELECT USING (tenant_id = public.get_current_user_tenant_id());
CREATE POLICY "item_photos_insert" ON public.item_photos FOR INSERT WITH CHECK (tenant_id = public.get_current_user_tenant_id());
CREATE POLICY "item_photos_update" ON public.item_photos FOR UPDATE USING (tenant_id = public.get_current_user_tenant_id());
CREATE POLICY "item_photos_delete" ON public.item_photos FOR DELETE USING (tenant_id = public.get_current_user_tenant_id());

-- RLS Policies for repair_quotes
CREATE POLICY "repair_quotes_select" ON public.repair_quotes FOR SELECT USING (tenant_id = public.get_current_user_tenant_id());
CREATE POLICY "repair_quotes_all" ON public.repair_quotes FOR ALL USING (tenant_id = public.get_current_user_tenant_id());

-- RLS Policies for repair_tech_tokens (public read for token access)
CREATE POLICY "repair_tech_tokens_public_select" ON public.repair_tech_tokens FOR SELECT USING (true);
CREATE POLICY "repair_tech_tokens_tenant_all" ON public.repair_tech_tokens FOR INSERT WITH CHECK (tenant_id = public.get_current_user_tenant_id());

-- RLS Policies for billing_events
CREATE POLICY "billing_events_select" ON public.billing_events FOR SELECT USING (tenant_id = public.get_current_user_tenant_id());
CREATE POLICY "billing_events_all" ON public.billing_events FOR ALL USING (tenant_id = public.get_current_user_tenant_id());

-- RLS Policies for task_notes
CREATE POLICY "task_notes_select" ON public.task_notes FOR SELECT USING (tenant_id = public.get_current_user_tenant_id());
CREATE POLICY "task_notes_all" ON public.task_notes FOR ALL USING (tenant_id = public.get_current_user_tenant_id());

-- RLS Policies for alert_queue
CREATE POLICY "alert_queue_select" ON public.alert_queue FOR SELECT USING (tenant_id = public.get_current_user_tenant_id());
CREATE POLICY "alert_queue_all" ON public.alert_queue FOR ALL USING (tenant_id = public.get_current_user_tenant_id());

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_item_photos_item_id ON public.item_photos(item_id);
CREATE INDEX IF NOT EXISTS idx_repair_quotes_item_id ON public.repair_quotes(item_id);
CREATE INDEX IF NOT EXISTS idx_repair_tech_tokens_token ON public.repair_tech_tokens(token);
CREATE INDEX IF NOT EXISTS idx_billing_events_item ON public.billing_events(item_id);
CREATE INDEX IF NOT EXISTS idx_billing_events_task ON public.billing_events(task_id);
CREATE INDEX IF NOT EXISTS idx_task_notes_task ON public.task_notes(task_id);
CREATE INDEX IF NOT EXISTS idx_alert_queue_status ON public.alert_queue(status);