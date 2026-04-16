-- Phase 6 patch: Add missing sidemark TEXT columns per specification

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS sidemark TEXT;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS sidemark TEXT;