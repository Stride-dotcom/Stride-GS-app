-- ============================================================
-- Stride GS App — Supabase DispatchTrack Phase 1a Setup
-- Run this entire script in the Supabase SQL Editor:
--   https://supabase.com/dashboard/project/uqplppugeickmamycpuz/editor
-- ============================================================
--
-- TENANCY MODEL:
-- ─────────────────────────────────────────────────────────────
-- This project uses `tenant_id text NOT NULL` (= Google Sheets
-- clientSheetId, e.g. "1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74Og")
-- rather than `account_id uuid`. There is NO Supabase accounts
-- table; client identity is resolved from Google Sheets via
-- StrideAPI.gs and passed through as clientSheetId in the
-- Supabase Auth JWT user_metadata.
--
-- On dt_orders and dt_webhook_events, tenant_id is nullable.
-- Webhook orders may arrive before they are mapped to a known
-- client. Once mapped, the column is updated in-place.
--
-- RLS POLICY CHOICE:
-- ─────────────────────────────────────────────────────────────
-- Follows existing Phase 1 / Phase 3 convention exactly:
--   - Authenticated staff/admin: SELECT all rows (role check)
--   - Authenticated client users: SELECT own tenant_id only
--   - service_role: all operations (Apps Script write-through,
--     bypasses RLS without an explicit policy)
-- Exceptions:
--   - dt_statuses / dt_substatuses: public reference data,
--     any authenticated user may read.
--   - dt_credentials: admin-only (contains API secrets).
--   - dt_webhook_events / dt_orders_quarantine: staff/admin only.
--
-- STATUS CODE NAMESPACES:
-- ─────────────────────────────────────────────────────────────
-- dt_statuses holds two non-overlapping integer namespaces:
--   ids  0–11  = operational order statuses (DT `status` field)
--   ids 100+   = delivery outcome categories (DT category enum)
-- Both are kept in one table so status_id FK works uniformly.
--
-- PREREQUISITE:
-- ─────────────────────────────────────────────────────────────
-- Requires public.set_updated_at() trigger function created in
-- supabase-phase1-setup.sql. Run Phase 1 before this script.
-- ============================================================


-- ── 1. Reference: dt_statuses ────────────────────────────────
-- Lookup table for DispatchTrack status codes.
-- ids 0–11:  operational order statuses (from DT API `status` integer field).
-- ids 100+:  delivery outcome categories (from DT API category enum);
--            kept in a separate id range to avoid conflict with ids 2, 3, 4
--            which already represent 'on_delivery', 'assigned', 'on_delivery_out'.

CREATE TABLE IF NOT EXISTS public.dt_statuses (
  id            int           PRIMARY KEY,
  code          text          NOT NULL UNIQUE,
  name          text          NOT NULL,
  category      text          NOT NULL CHECK (category IN ('open','in_progress','completed','exception','cancelled')),
  display_order int           NOT NULL DEFAULT 0,
  color         text
);

INSERT INTO public.dt_statuses (id, code, name, category, display_order, color) VALUES
  -- Operational statuses (ids 0–11, match DT `status` integer directly)
  (0,   'entered',          'Entered',              'open',        0,   '#94a3b8'),
  (1,   'in_transit',       'In Transit',           'in_progress', 1,   '#3b82f6'),
  (2,   'on_delivery',      'On Delivery',          'in_progress', 2,   '#f59e0b'),
  (3,   'assigned',         'Assigned',             'open',        3,   '#8b5cf6'),
  (4,   'on_delivery_out',  'On Delivery (Out)',     'in_progress', 4,   '#f97316'),
  (5,   'arrived_at_place', 'Arrived at Place',     'in_progress', 5,   '#06b6d4'),
  (6,   'transfer',         'Transfer',             'in_progress', 6,   '#6366f1'),
  (7,   'arrived',          'Arrived',              'completed',   7,   '#22c55e'),
  (8,   'exception',        'Exception',            'exception',   8,   '#ef4444'),
  (9,   'deleted',          'Deleted',              'cancelled',   9,   '#64748b'),
  (10,  'locked',           'Locked',               'open',        10,  '#a78bfa'),
  (11,  'unlocked',         'Unlocked',             'open',        11,  '#c4b5fd'),
  -- Delivery outcome categories (ids 100–102, separate DT enum)
  (100, 'delivered',        'Delivered',            'completed',   100, '#16a34a'),
  (101, 'not_delivered',    'Not Delivered',        'exception',   101, '#dc2626'),
  (102, 'partial_delivery', 'Partial Delivery',     'completed',   102, '#d97706')
ON CONFLICT (id) DO NOTHING;


-- ── 2. Reference: dt_substatuses ─────────────────────────────
-- Sub-status codes within a parent DT status.
-- Seed with specific sub-status rows once DT API codes are confirmed.

CREATE TABLE IF NOT EXISTS public.dt_substatuses (
  id               int           PRIMARY KEY,
  code             text          NOT NULL UNIQUE,
  name             text          NOT NULL,
  parent_status_id int           REFERENCES public.dt_statuses(id) ON DELETE SET NULL,
  display_order    int           NOT NULL DEFAULT 0,
  color            text
);


-- ── 3. Core: dt_orders ───────────────────────────────────────
-- Full mirror of a DispatchTrack delivery order.
-- NO raw_payload column (per build plan: raw payload lives on
-- dt_webhook_events only, with 90-day retention).
-- tenant_id is nullable: webhook orders arrive before client mapping.

CREATE TABLE IF NOT EXISTS public.dt_orders (
  id                    uuid          DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id             text,                                              -- clientSheetId; nullable until mapped to a client
  dt_dispatch_id        int,                                               -- DT's internal dispatch integer
  dt_identifier         text          NOT NULL,                           -- DT's human-readable order ID (e.g. "DT-000123")
  dt_mode               smallint,                                          -- DT route mode integer
  is_pickup             boolean,
  status_id             int           REFERENCES public.dt_statuses(id),
  substatus_id          int           REFERENCES public.dt_substatuses(id),
  -- Contact / delivery address
  contact_name          text,
  contact_address       text,
  contact_city          text,
  contact_state         text,
  contact_zip           text,
  contact_phone         text,
  contact_email         text,
  contact_latitude      double precision,
  contact_longitude     double precision,
  -- Pickup address (variable structure; stored as JSON)
  pickup_address_json   jsonb,
  -- Canonical time window (local time; no tstzrange, no duplicate date columns)
  local_service_date    date,
  window_start_local    time,
  window_end_local      time,
  timezone              text          NOT NULL DEFAULT 'America/Los_Angeles',
  service_time_minutes  int,
  -- Routing / logistics
  load                  numeric,
  priority              smallint,
  -- Reference fields
  po_number             text,
  sidemark              text,
  client_reference      text,
  details               text,
  -- UI helpers
  latest_note_preview   text,                                              -- updated by trigger on dt_order_notes INSERT
  linked_order_id       uuid          REFERENCES public.dt_orders(id),    -- return leg or linked delivery
  -- Provenance
  source                text          CHECK (source IN ('app','dt_ui','webhook_backfill','reconcile')),
  last_synced_at        timestamptz,
  created_at            timestamptz   DEFAULT now(),
  updated_at            timestamptz   DEFAULT now(),
  -- Full-text search (GENERATED ALWAYS AS ... STORED requires PG 12+)
  search_vector         tsvector      GENERATED ALWAYS AS (
    to_tsvector('english',
      coalesce(dt_identifier,    '') || ' ' ||
      coalesce(po_number,        '') || ' ' ||
      coalesce(sidemark,         '') || ' ' ||
      coalesce(client_reference, '') || ' ' ||
      coalesce(contact_name,     '') || ' ' ||
      coalesce(contact_city,     '') || ' ' ||
      coalesce(details,          '')
    )
  ) STORED,
  -- Constraints
  -- Note: UNIQUE(tenant_id, dt_identifier) allows multiple NULL-tenant rows
  -- with the same dt_identifier (PG treats each NULL as distinct). Webhook
  -- idempotency for unmapped orders is enforced upstream via
  -- dt_webhook_events.idempotency_key before upsert.
  UNIQUE (tenant_id, dt_identifier),
  CHECK (
    window_end_local >= window_start_local
    OR window_start_local IS NULL
    OR window_end_local IS NULL
  )
);


-- ── 4. Items: dt_order_items ──────────────────────────────────
-- Line items within a DT order.
-- inventory_id links to public.inventory.id when the item maps
-- to an in-warehouse inventory record (nullable; may not exist).

CREATE TABLE IF NOT EXISTS public.dt_order_items (
  id                  uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  dt_order_id         uuid        NOT NULL REFERENCES public.dt_orders(id) ON DELETE CASCADE,
  inventory_id        uuid        REFERENCES public.inventory(id),         -- nullable; maps to Stride inventory item when known
  dt_item_code        text,
  description         text,
  quantity            numeric,
  original_quantity   numeric,
  delivered_quantity  numeric,
  unit_price          numeric,
  class_code          text,
  extras              jsonb,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);


-- ── 5. History: dt_order_history ─────────────────────────────
-- Event log for each order as returned by the DT history endpoint.
-- Append-only; rows are never updated.

CREATE TABLE IF NOT EXISTS public.dt_order_history (
  id              uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  dt_order_id     uuid        NOT NULL REFERENCES public.dt_orders(id) ON DELETE CASCADE,
  code            int,
  description     text,
  substatus_id    int         REFERENCES public.dt_substatuses(id),
  happened_at     timestamptz NOT NULL,
  owner_id        int,
  owner_name      text,
  owner_type      text,
  created_at      timestamptz DEFAULT now()
);


-- ── 6. Photos: dt_order_photos ────────────────────────────────
-- POD / signature / other photos associated with a DT order.
-- storage_path and thumbnail_path reference the `dt-pod-photos`
-- Supabase Storage bucket created in section 16 below.
-- Ingestion flow: background job fetches dt_url → stores in bucket
-- → updates storage_path; React reads from bucket, not dt_url.

CREATE TABLE IF NOT EXISTS public.dt_order_photos (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  dt_order_id       uuid        NOT NULL REFERENCES public.dt_orders(id) ON DELETE CASCADE,
  dt_url            text        NOT NULL,                                   -- original DT CDN URL (source of truth until fetched)
  storage_path      text,                                                   -- path in `dt-pod-photos` bucket once fetched
  thumbnail_path    text,
  content_type      text,
  size_bytes        bigint,
  captured_at       timestamptz,
  fetched_at        timestamptz,
  fetch_attempts    int         DEFAULT 0,
  fetch_error       text,
  kind              text        CHECK (kind IN ('pod','signature','other')),
  visible_in_portal boolean     DEFAULT true,
  retention_class   text        DEFAULT 'standard',
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);


-- ── 7. Notes: dt_order_notes ─────────────────────────────────
-- Driver / dispatcher / system notes on a DT order.
-- On INSERT with visibility='public', a trigger updates
-- dt_orders.latest_note_preview to left(body, 500).

CREATE TABLE IF NOT EXISTS public.dt_order_notes (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  dt_order_id   uuid        NOT NULL REFERENCES public.dt_orders(id) ON DELETE CASCADE,
  body          text        NOT NULL,
  author_name   text,
  author_type   text        CHECK (author_type IN ('driver','dispatcher','app_user','system')),
  visibility    text        NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','staff_only','internal')),
  created_at_dt timestamptz,                                                -- timestamp from DT (may differ from Supabase created_at)
  source        text        CHECK (source IN ('dt_webhook','app','manual_import')),
  created_at    timestamptz DEFAULT now()
);


-- ── 8. Webhooks: dt_webhook_events ────────────────────────────
-- Inbound DispatchTrack webhook events.
-- raw_payload is stored here (NOT on dt_orders per build plan).
-- 90-day retention enforced via retention_until; cleaned by a
-- scheduled job or cron trigger.
-- Idempotency: UNIQUE(idempotency_key) prevents double-processing.

CREATE TABLE IF NOT EXISTS public.dt_webhook_events (
  id                uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         text,                                                   -- nullable; resolved from payload during processing
  received_at       timestamptz NOT NULL DEFAULT now(),
  event_type        text        NOT NULL,
  dt_event_id       text,
  idempotency_key   text        NOT NULL,
  payload           jsonb       NOT NULL,
  processed         boolean     DEFAULT false,
  processing_error  text,
  processed_at      timestamptz,
  retention_until   timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  UNIQUE (idempotency_key)
);


-- ── 9. Config: dt_credentials ────────────────────────────────
-- Singleton row for Stride's DispatchTrack API credentials.
-- Sensitive — RLS is admin-only (see section 15).
-- auth_token_encrypted: encrypted before insert by the caller
-- (Apps Script or Edge Function); never stored plaintext.
-- orders_tab_enabled_roles: feature flag. No Supabase settings
-- table exists in this project; this singleton is the appropriate
-- home. Apps Script / the API reads this field and includes it in
-- the getClients/config response so React can gate the Orders tab.

CREATE TABLE IF NOT EXISTS public.dt_credentials (
  id                       uuid     DEFAULT gen_random_uuid() PRIMARY KEY,
  api_base_url             text,
  auth_token_encrypted     text,                                            -- never store plaintext token
  webhook_secret           text,
  rate_limit_daily         int      DEFAULT 1000,
  rate_limit_used_today    int      DEFAULT 0,
  last_reset_at            date,
  orders_tab_enabled_roles text[]   DEFAULT '{admin}',                     -- feature flag: roles that can see the Orders tab
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now()
);


-- ── 10. Quarantine: dt_orders_quarantine ─────────────────────
-- Holds DT webhook payloads that could not be mapped to a known
-- client / tenant. Operators review and resolve (promote or reject).

CREATE TABLE IF NOT EXISTS public.dt_orders_quarantine (
  id                    uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  received_at           timestamptz NOT NULL,
  dt_identifier         text,
  dt_dispatch_id        int,
  raw_payload           jsonb       NOT NULL,
  mapping_hint          jsonb,                                              -- structured hints from attempted auto-mapping
  status                text        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','rejected')),
  resolved_at           timestamptz,
  resolved_by           uuid,
  promoted_to_order_id  uuid        REFERENCES public.dt_orders(id)
);


-- ── 11. Audit: audit_log ─────────────────────────────────────
-- General-purpose audit trail for admin-visible mutations.
-- Populated by Apps Script / Edge Functions on sensitive writes.
-- No existing audit_log table was found in this project
-- (supabase-phase1-setup.sql and supabase-phase3-setup.sql
-- confirmed clean before creating this).

CREATE TABLE IF NOT EXISTS public.audit_log (
  id            uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       uuid,
  user_name     text,
  action        text,
  entity_type   text,
  entity_id     uuid,
  field_changed text,
  old_value     jsonb,
  new_value     jsonb,
  occurred_at   timestamptz DEFAULT now()
);


-- ── 12. Indexes ───────────────────────────────────────────────

-- dt_orders: the core query paths
CREATE INDEX IF NOT EXISTS idx_dt_orders_tenant
  ON public.dt_orders (tenant_id);
CREATE INDEX IF NOT EXISTS idx_dt_orders_status
  ON public.dt_orders (status_id);
CREATE INDEX IF NOT EXISTS idx_dt_orders_service_date
  ON public.dt_orders (local_service_date);
CREATE INDEX IF NOT EXISTS idx_dt_orders_search
  ON public.dt_orders USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_dt_orders_pickup_addr
  ON public.dt_orders USING GIN (pickup_address_json jsonb_path_ops);

-- dt_order_items
CREATE INDEX IF NOT EXISTS idx_dt_order_items_order
  ON public.dt_order_items (dt_order_id);
CREATE INDEX IF NOT EXISTS idx_dt_order_items_inventory
  ON public.dt_order_items (inventory_id);

-- dt_order_history
CREATE INDEX IF NOT EXISTS idx_dt_order_history_order
  ON public.dt_order_history (dt_order_id);
CREATE INDEX IF NOT EXISTS idx_dt_order_history_when
  ON public.dt_order_history (happened_at);

-- dt_order_photos
CREATE INDEX IF NOT EXISTS idx_dt_order_photos_order
  ON public.dt_order_photos (dt_order_id);

-- dt_order_notes
CREATE INDEX IF NOT EXISTS idx_dt_order_notes_order
  ON public.dt_order_notes (dt_order_id);

-- dt_webhook_events: the two common filter patterns
CREATE INDEX IF NOT EXISTS idx_dt_webhook_processed
  ON public.dt_webhook_events (processed, received_at);
CREATE INDEX IF NOT EXISTS idx_dt_webhook_retention
  ON public.dt_webhook_events (retention_until);

-- dt_orders_quarantine
CREATE INDEX IF NOT EXISTS idx_dt_quarantine_status
  ON public.dt_orders_quarantine (status);

-- audit_log
CREATE INDEX IF NOT EXISTS idx_audit_log_entity
  ON public.audit_log (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_occurred
  ON public.audit_log (occurred_at);


-- ── 13. Triggers ──────────────────────────────────────────────
-- set_updated_at() already exists (created in supabase-phase1-setup.sql).

CREATE OR REPLACE TRIGGER dt_orders_updated_at
  BEFORE UPDATE ON public.dt_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER dt_order_items_updated_at
  BEFORE UPDATE ON public.dt_order_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER dt_order_photos_updated_at
  BEFORE UPDATE ON public.dt_order_photos
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER dt_credentials_updated_at
  BEFORE UPDATE ON public.dt_credentials
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Note preview: on INSERT to dt_order_notes where visibility='public',
-- update dt_orders.latest_note_preview = first 500 chars of body.
-- Staff/internal notes do NOT update the preview.

CREATE OR REPLACE FUNCTION public.dt_update_order_note_preview()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.visibility = 'public' THEN
    UPDATE public.dt_orders
    SET   latest_note_preview = left(NEW.body, 500),
          updated_at           = now()
    WHERE id = NEW.dt_order_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER dt_order_notes_preview
  AFTER INSERT ON public.dt_order_notes
  FOR EACH ROW EXECUTE FUNCTION public.dt_update_order_note_preview();


-- ── 14. Enable Row-Level Security ─────────────────────────────

ALTER TABLE public.dt_statuses          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dt_substatuses       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dt_orders            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dt_order_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dt_order_history     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dt_order_photos      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dt_order_notes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dt_webhook_events    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dt_credentials       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dt_orders_quarantine ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log            ENABLE ROW LEVEL SECURITY;


-- ── 15. RLS Policies ─────────────────────────────────────────

-- DT_STATUSES / DT_SUBSTATUSES
-- Public reference data; any authenticated user may read.
-- service_role manages inserts/updates (new DT API versions).

CREATE POLICY "dt_statuses_select_all" ON public.dt_statuses
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "dt_statuses_service_all" ON public.dt_statuses
  FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "dt_substatuses_select_all" ON public.dt_substatuses
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "dt_substatuses_service_all" ON public.dt_substatuses
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- DT_ORDERS
CREATE POLICY "dt_orders_select_staff" ON public.dt_orders
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

CREATE POLICY "dt_orders_select_client" ON public.dt_orders
  FOR SELECT TO authenticated
  USING (tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId'));

CREATE POLICY "dt_orders_service_all" ON public.dt_orders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- DT_ORDER_ITEMS
-- No tenant_id column; client access joins back to dt_orders.
CREATE POLICY "dt_order_items_select_staff" ON public.dt_order_items
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

CREATE POLICY "dt_order_items_select_client" ON public.dt_order_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.dt_orders o
    WHERE  o.id        = dt_order_items.dt_order_id
      AND  o.tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId')
  ));

CREATE POLICY "dt_order_items_service_all" ON public.dt_order_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- DT_ORDER_HISTORY
CREATE POLICY "dt_order_history_select_staff" ON public.dt_order_history
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

CREATE POLICY "dt_order_history_select_client" ON public.dt_order_history
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.dt_orders o
    WHERE  o.id        = dt_order_history.dt_order_id
      AND  o.tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId')
  ));

CREATE POLICY "dt_order_history_service_all" ON public.dt_order_history
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- DT_ORDER_PHOTOS
-- Clients only see photos marked visible_in_portal = true.
CREATE POLICY "dt_order_photos_select_staff" ON public.dt_order_photos
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

CREATE POLICY "dt_order_photos_select_client" ON public.dt_order_photos
  FOR SELECT TO authenticated
  USING (
    visible_in_portal = true
    AND EXISTS (
      SELECT 1 FROM public.dt_orders o
      WHERE  o.id        = dt_order_photos.dt_order_id
        AND  o.tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId')
    )
  );

CREATE POLICY "dt_order_photos_service_all" ON public.dt_order_photos
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- DT_ORDER_NOTES
-- Clients only see visibility='public' notes.
CREATE POLICY "dt_order_notes_select_staff" ON public.dt_order_notes
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

CREATE POLICY "dt_order_notes_select_client" ON public.dt_order_notes
  FOR SELECT TO authenticated
  USING (
    visibility = 'public'
    AND EXISTS (
      SELECT 1 FROM public.dt_orders o
      WHERE  o.id        = dt_order_notes.dt_order_id
        AND  o.tenant_id = (auth.jwt()->'user_metadata'->>'clientSheetId')
    )
  );

CREATE POLICY "dt_order_notes_service_all" ON public.dt_order_notes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- DT_WEBHOOK_EVENTS — staff/admin only; clients never see raw webhooks
CREATE POLICY "dt_webhook_events_select_staff" ON public.dt_webhook_events
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

CREATE POLICY "dt_webhook_events_service_all" ON public.dt_webhook_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- DT_CREDENTIALS — admin only (contains encrypted API token + webhook secret)
CREATE POLICY "dt_credentials_select_admin" ON public.dt_credentials
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') = 'admin');

CREATE POLICY "dt_credentials_service_all" ON public.dt_credentials
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- DT_ORDERS_QUARANTINE — admin/staff only (unmapped orders; ops review)
CREATE POLICY "dt_quarantine_select_staff" ON public.dt_orders_quarantine
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

CREATE POLICY "dt_quarantine_service_all" ON public.dt_orders_quarantine
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- AUDIT_LOG — admin/staff read-only
CREATE POLICY "audit_log_select_staff" ON public.audit_log
  FOR SELECT TO authenticated
  USING ((auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff'));

CREATE POLICY "audit_log_service_all" ON public.audit_log
  FOR ALL TO service_role USING (true) WITH CHECK (true);


-- ── 16. Storage bucket: dt-pod-photos ────────────────────────
-- No existing Supabase Storage buckets in this project.
-- Creating a private bucket for POD / signature photos.
-- Photos are fetched from the DT CDN by a background job
-- (Edge Function or Apps Script) and stored here.
--
-- Path convention: {tenant_id}/{dt_order_id}/{photo_id}.{ext}
-- This matches the planned convention in Docs/Future_WMS_PDF_Architecture.md
-- (first path segment = tenant_id for RLS on storage.objects).
--
-- RLS:
--   staff/admin   → read all objects in this bucket
--   client users  → read objects where path[1] = their clientSheetId
--   service_role  → all operations (ingestion writes)

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'dt-pod-photos',
  'dt-pod-photos',
  false,                                                  -- private; URLs require a signed token
  10485760,                                               -- 10 MB per file
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "dt_pod_photos_select_staff"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'dt-pod-photos'
    AND (auth.jwt()->'user_metadata'->>'role') IN ('admin', 'staff')
  );

CREATE POLICY "dt_pod_photos_select_client"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'dt-pod-photos'
    AND (storage.foldername(name))[1] = (auth.jwt()->'user_metadata'->>'clientSheetId')
  );

CREATE POLICY "dt_pod_photos_service_all"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'dt-pod-photos')
  WITH CHECK (bucket_id = 'dt-pod-photos');


-- ── Done ──────────────────────────────────────────────────────
-- After running this script:
-- 1. Verify all 11 tables appear in Table Editor with RLS shield icon
-- 2. Verify `dt-pod-photos` bucket appears in Storage → Buckets
-- 3. DO NOT run any bulk sync — this is Phase 1a (schema only, view-ready)
-- 4. Seed dt_substatuses once DT API sub-status codes are confirmed
-- 5. Insert one row into dt_credentials when DT API credentials are available
-- 6. Phase 1b: wire React Orders tab behind orders_tab_enabled_roles check
-- 7. Phase 1c: build webhook ingest Edge Function to write dt_webhook_events
