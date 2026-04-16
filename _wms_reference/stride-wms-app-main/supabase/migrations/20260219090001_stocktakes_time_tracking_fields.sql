-- =============================================================================
-- Stocktakes: Time tracking snapshot fields
-- =============================================================================
-- Adds optional fields so we can snapshot service time onto the stocktake record
-- (consistent with tasks/shipments using metadata.service_time).

ALTER TABLE public.stocktakes
  ADD COLUMN IF NOT EXISTS metadata jsonb NULL;

ALTER TABLE public.stocktakes
  ADD COLUMN IF NOT EXISTS duration_minutes integer NULL;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stocktakes_duration_minutes_nonnegative'
  ) THEN
    ALTER TABLE public.stocktakes
      ADD CONSTRAINT stocktakes_duration_minutes_nonnegative
      CHECK (duration_minutes IS NULL OR duration_minutes >= 0);
  END IF;
END $$;

