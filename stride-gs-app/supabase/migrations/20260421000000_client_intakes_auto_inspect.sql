-- client_intakes.auto_inspect — prospect's opt-in for automatic
-- inspection of every inbound shipment on receipt.
--
-- Default false: opening packages is chargeable and invasive; we
-- only do it when the client has explicitly authorised it. The intake
-- form presents a plain-language disclosure (§ StepTerms) before the
-- prospect checks this box. At activation time the value is wired into
-- the client's AUTO_INSPECTION setting via prefillFromIntake.

ALTER TABLE public.client_intakes
  ADD COLUMN IF NOT EXISTS auto_inspect boolean NOT NULL DEFAULT false;
