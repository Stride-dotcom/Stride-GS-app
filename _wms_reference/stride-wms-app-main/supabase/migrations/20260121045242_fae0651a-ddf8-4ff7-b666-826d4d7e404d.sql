-- Phase 1: Add 'return' to the shipments release_type constraint
-- This allows creating return shipments with release_type = 'return'

ALTER TABLE shipments DROP CONSTRAINT IF EXISTS shipments_release_type_check;

ALTER TABLE shipments ADD CONSTRAINT shipments_release_type_check 
  CHECK (release_type IS NULL OR release_type = ANY (ARRAY['will_call'::text, 'disposal'::text, 'return'::text]));