-- Schema reconciliation: track out-of-band ALTERs that landed in production
-- via the Supabase SQL editor / MCP apply_migration but never landed as a
-- repo-tracked migration.
--
-- Background: 2026-05-24 audit (AUDIT-schema-alignment.md) flagged 14 columns
-- referenced by Edge Function handlers + the public-form RPC as "not in any
-- ADD COLUMN migration found in repo". Live `information_schema.columns`
-- queries against the production project confirmed every one of those
-- columns DOES exist on the live DB — they were just never committed to the
-- migrations tree. This migration backfills the source of truth so:
--   1. A fresh `supabase db reset` reproduces the live schema shape.
--   2. Future audits won't re-flag the same columns as missing.
--   3. The handler code (dt-push-order, notify-task-client-note,
--      _shared/release-on-dt-finished) stays valid against the tracked
--      schema, not just the live drift.
--
-- All statements are idempotent — `ADD COLUMN IF NOT EXISTS` is a no-op
-- when the column already exists, so repeated `supabase db push` against
-- production has no effect.

-- ── public.entity_notes ─────────────────────────────────────────────────
-- is_system: marks system-generated notes (status changes, acceptance
-- acknowledgements). Source: useEntityNotes.addNote writes this on INSERT.
-- Consumers: notify-task-client-note (acceptance detection),
-- _shared/release-on-dt-finished (audit note marker), useItemNotes (filter).
ALTER TABLE public.entity_notes
  ADD COLUMN IF NOT EXISTS is_system   boolean NOT NULL DEFAULT false;

-- author_role: 'admin' | 'staff' | 'client' — captures the author's app
-- role at INSERT time so the server-side notifier can distinguish
-- client-authored notes (which fire ops alerts) from staff/admin notes
-- (which do not). Source: useEntityNotes.addNote.
ALTER TABLE public.entity_notes
  ADD COLUMN IF NOT EXISTS author_role text;

COMMENT ON COLUMN public.entity_notes.is_system IS
  'True for system-generated notes (status changes, acceptance acknowledgements). Reconciled from out-of-band ALTER on 2026-05-24.';
COMMENT ON COLUMN public.entity_notes.author_role IS
  'App role of the note author at write time (admin|staff|client). Reconciled from out-of-band ALTER on 2026-05-24.';

-- ── public.dt_orders ────────────────────────────────────────────────────
-- Eight columns the dt-push-order handler reads/writes that were missing
-- from the tracked migrations. Verified present on the live DB.
ALTER TABLE public.dt_orders
  ADD COLUMN IF NOT EXISTS contact_phone2      text,
  ADD COLUMN IF NOT EXISTS order_notes         text,
  ADD COLUMN IF NOT EXISTS driver_notes        text,
  ADD COLUMN IF NOT EXISTS internal_notes      text,
  ADD COLUMN IF NOT EXISTS billing_method      text,
  ADD COLUMN IF NOT EXISTS coverage_option_id  text,
  ADD COLUMN IF NOT EXISTS coverage_charge     numeric,
  ADD COLUMN IF NOT EXISTS declared_value      numeric;

COMMENT ON COLUMN public.dt_orders.contact_phone2     IS 'Secondary contact phone. Reconciled 2026-05-24.';
COMMENT ON COLUMN public.dt_orders.order_notes        IS 'Customer-visible order notes (legacy field; new code prefers details). Reconciled 2026-05-24.';
COMMENT ON COLUMN public.dt_orders.driver_notes       IS 'Driver-facing notes shown on the DT mobile app. Reconciled 2026-05-24.';
COMMENT ON COLUMN public.dt_orders.internal_notes     IS 'Internal-only notes pushed as Private note in DT. Reconciled 2026-05-24.';
COMMENT ON COLUMN public.dt_orders.billing_method     IS 'How the order will be billed (e.g. customer_collect). Reconciled 2026-05-24.';
COMMENT ON COLUMN public.dt_orders.coverage_option_id IS 'FK to coverage_options.id for declared-value insurance. Reconciled 2026-05-24.';
COMMENT ON COLUMN public.dt_orders.coverage_charge    IS 'Computed coverage charge for declared-value insurance. Reconciled 2026-05-24.';
COMMENT ON COLUMN public.dt_orders.declared_value     IS 'Declared item value driving coverage_charge computation. Reconciled 2026-05-24.';

-- ── public.dt_order_items ───────────────────────────────────────────────
-- Four columns the dt-push-order handler reads/writes that were missing
-- from the tracked migrations. Verified present on the live DB.
ALTER TABLE public.dt_order_items
  ADD COLUMN IF NOT EXISTS class_name text,
  ADD COLUMN IF NOT EXISTS vendor     text,
  ADD COLUMN IF NOT EXISTS room       text,
  ADD COLUMN IF NOT EXISTS cubic_feet numeric;

COMMENT ON COLUMN public.dt_order_items.class_name IS 'Display name for the item class (paired with class_code). Reconciled 2026-05-24.';
COMMENT ON COLUMN public.dt_order_items.vendor     IS 'Vendor / manufacturer attribution for the item. Reconciled 2026-05-24.';
COMMENT ON COLUMN public.dt_order_items.room       IS 'Destination room for the delivery. Reconciled 2026-05-24.';
COMMENT ON COLUMN public.dt_order_items.cubic_feet IS 'Volumetric footprint for capacity calc. Reconciled 2026-05-24.';
