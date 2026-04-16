-- =============================================================================
-- Time Tracking: tenant preferences for concurrent timers ("collaborate mode")
-- =============================================================================

ALTER TABLE public.tenant_preferences
  ADD COLUMN IF NOT EXISTS time_tracking_allow_concurrent_tasks boolean NOT NULL DEFAULT true;

ALTER TABLE public.tenant_preferences
  ADD COLUMN IF NOT EXISTS time_tracking_allow_concurrent_shipments boolean NOT NULL DEFAULT true;

ALTER TABLE public.tenant_preferences
  ADD COLUMN IF NOT EXISTS time_tracking_allow_concurrent_stocktakes boolean NOT NULL DEFAULT true;

