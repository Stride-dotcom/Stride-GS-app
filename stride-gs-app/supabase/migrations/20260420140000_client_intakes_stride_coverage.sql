-- client_intakes.insurance_choice — add 'stride_coverage' as an
-- allowed value. Rationale: Stride is not licensed to sell insurance;
-- the correct framing is "client is added to Stride's policy for a
-- processing fee ($300/mo per $100K declared value, $300/mo min)".
-- The old label "EIS Coverage" was misleading both about the seller
-- and the product.
--
-- Back-compat: 'eis_coverage' stays accepted so any intake rows
-- submitted before this migration remain valid. New intakes write
-- 'stride_coverage'. The admin review pane in Intakes.tsx treats the
-- two as equivalent for display.

ALTER TABLE public.client_intakes
  DROP CONSTRAINT IF EXISTS client_intakes_insurance_choice_check;

ALTER TABLE public.client_intakes
  ADD CONSTRAINT client_intakes_insurance_choice_check
  CHECK (insurance_choice IS NULL OR insurance_choice IN ('own_policy','eis_coverage','stride_coverage'));
