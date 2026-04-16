-- Update Service Event Rates
-- This migration updates rates to match the standard price list

-- Update 2HRO rate from 310 to 110
UPDATE public.service_events
SET rate = 110, updated_at = now()
WHERE service_code = '2HRO' AND rate = 310;

-- Update 30MA rate from 70 to 75
UPDATE public.service_events
SET rate = 75, updated_at = now()
WHERE service_code = '30MA' AND rate = 70;