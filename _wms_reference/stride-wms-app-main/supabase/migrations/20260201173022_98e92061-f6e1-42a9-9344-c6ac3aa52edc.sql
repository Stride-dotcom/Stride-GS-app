-- Remove the conflicting constraint that doesn't match the application's claim statuses
-- The claims_status_check constraint has the correct values that match CLAIM_STATUS_LABELS in useClaims.ts
ALTER TABLE public.claims DROP CONSTRAINT IF EXISTS valid_claim_status;