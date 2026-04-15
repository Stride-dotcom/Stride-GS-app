-- Add COD fields to will_calls table
ALTER TABLE will_calls
  ADD COLUMN IF NOT EXISTS cod boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS cod_amount numeric;
