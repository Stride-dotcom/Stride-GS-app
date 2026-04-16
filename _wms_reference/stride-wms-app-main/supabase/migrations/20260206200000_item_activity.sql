-- ============================================================
-- item_activity: Unified activity log for items
-- Tracks all meaningful changes: flags, billing, notes, photos,
-- status changes, movements, tasks, etc.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.item_activity (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid NOT NULL,
    item_id     uuid NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,

    -- Actor snapshot (denormalized for fast display)
    actor_user_id uuid,
    actor_name    text,

    -- Event classification
    event_type  text NOT NULL,   -- e.g. 'item_flag_applied', 'item_status_changed'
    event_label text NOT NULL,   -- human-friendly label shown in timeline

    -- Arbitrary structured payload
    details     jsonb NOT NULL DEFAULT '{}'::jsonb,

    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Primary lookup index: activities for an item sorted newest-first
CREATE INDEX IF NOT EXISTS idx_item_activity_item_created
    ON public.item_activity (tenant_id, item_id, created_at DESC);

-- Enable RLS
ALTER TABLE public.item_activity ENABLE ROW LEVEL SECURITY;

-- Tenant-scoped read
CREATE POLICY "item_activity_select_tenant"
    ON public.item_activity FOR SELECT
    USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

-- Tenant-scoped insert
CREATE POLICY "item_activity_insert_tenant"
    ON public.item_activity FOR INSERT
    WITH CHECK (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));
