-- ============================================================
-- shipment_activity, task_activity, account_activity
-- Parallel audit logging tables matching item_activity structure.
-- Tracks billing edits, invoice events, and operational changes.
-- ============================================================

-- ===================== SHIPMENT_ACTIVITY =====================
CREATE TABLE IF NOT EXISTS public.shipment_activity (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL,
    shipment_id     uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,

    -- Actor snapshot (denormalized for fast display)
    actor_user_id   uuid,
    actor_name      text,

    -- Event classification
    event_type      text NOT NULL,
    event_label     text NOT NULL,

    -- Arbitrary structured payload
    details         jsonb NOT NULL DEFAULT '{}'::jsonb,

    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shipment_activity_lookup
    ON public.shipment_activity (tenant_id, shipment_id, created_at DESC);

ALTER TABLE public.shipment_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shipment_activity_select_tenant"
    ON public.shipment_activity FOR SELECT
    USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "shipment_activity_insert_tenant"
    ON public.shipment_activity FOR INSERT
    WITH CHECK (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));


-- ===================== TASK_ACTIVITY =====================
CREATE TABLE IF NOT EXISTS public.task_activity (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL,
    task_id         uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,

    -- Actor snapshot (denormalized for fast display)
    actor_user_id   uuid,
    actor_name      text,

    -- Event classification
    event_type      text NOT NULL,
    event_label     text NOT NULL,

    -- Arbitrary structured payload
    details         jsonb NOT NULL DEFAULT '{}'::jsonb,

    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_task_activity_lookup
    ON public.task_activity (tenant_id, task_id, created_at DESC);

ALTER TABLE public.task_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "task_activity_select_tenant"
    ON public.task_activity FOR SELECT
    USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "task_activity_insert_tenant"
    ON public.task_activity FOR INSERT
    WITH CHECK (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));


-- ===================== ACCOUNT_ACTIVITY =====================
CREATE TABLE IF NOT EXISTS public.account_activity (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL,
    account_id      uuid NOT NULL REFERENCES public.accounts(id) ON DELETE CASCADE,

    -- Actor snapshot (denormalized for fast display)
    actor_user_id   uuid,
    actor_name      text,

    -- Event classification
    event_type      text NOT NULL,
    event_label     text NOT NULL,

    -- Arbitrary structured payload
    details         jsonb NOT NULL DEFAULT '{}'::jsonb,

    created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_account_activity_lookup
    ON public.account_activity (tenant_id, account_id, created_at DESC);

ALTER TABLE public.account_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "account_activity_select_tenant"
    ON public.account_activity FOR SELECT
    USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

CREATE POLICY "account_activity_insert_tenant"
    ON public.account_activity FOR INSERT
    WITH CHECK (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));
