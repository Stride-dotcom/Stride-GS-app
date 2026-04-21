-- Add the auto_inspect opt-in flag to client_intakes.
--
-- Stride does not automatically inspect inbound shipments. The T&C §2.A
-- (handling valuation) makes clear that inspection is opt-in. This
-- column captures the prospect's choice at signing time and gets copied
-- into the client's AUTO_INSPECTION setting at activation (see
-- IntakesPanel.activateFromIntake prefillFromIntake).
--
-- Default false — opt-in is a deliberate affirmative action, and older
-- intakes (pre-this-column) stay at the cautious default.
ALTER TABLE public.client_intakes
  ADD COLUMN IF NOT EXISTS auto_inspect boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.client_intakes.auto_inspect IS
  'Prospect opted in to Stride auto-inspecting inbound shipments for visible shipping damage. Copied into client settings AUTO_INSPECTION on activation.';
