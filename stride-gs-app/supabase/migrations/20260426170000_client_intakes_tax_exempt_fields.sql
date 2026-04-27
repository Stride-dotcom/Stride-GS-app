-- ============================================================
-- Add tax-exempt + cert-expiry columns to client_intakes so the
-- public intake form can capture wholesale status at sign-up.
--
-- Fields on activation flow forward to clients.tax_exempt /
-- clients.tax_exempt_reason / clients.resale_cert_expires via
-- IntakesPanel.prefillFromIntake → OnboardClientFormData →
-- handleClientSubmit's post-create Supabase write.
--
-- 2026-04-26 PST
-- ============================================================

ALTER TABLE public.client_intakes
  ADD COLUMN IF NOT EXISTS tax_exempt boolean,
  ADD COLUMN IF NOT EXISTS tax_exempt_reason text,
  ADD COLUMN IF NOT EXISTS resale_cert_expires date;

COMMENT ON COLUMN public.client_intakes.tax_exempt IS
  'Prospect indicated they are a wholesale customer (resale exemption). null = question not asked yet (legacy intakes).';
COMMENT ON COLUMN public.client_intakes.tax_exempt_reason IS
  'Resale / Out-of-state / Government / Non-profit / Other.';
COMMENT ON COLUMN public.client_intakes.resale_cert_expires IS
  'Date the prospect''s resale certificate expires. Surfaces in admin review and is forwarded to clients.resale_cert_expires on activation.';

NOTIFY pgrst, 'reload schema';
