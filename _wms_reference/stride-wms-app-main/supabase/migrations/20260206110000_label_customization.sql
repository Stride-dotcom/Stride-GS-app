-- Migration: Add label_config JSONB column to tenant_preferences
-- Stores customizable label layout: which fields to show, their order, and font sizes.

ALTER TABLE public.tenant_preferences
  ADD COLUMN IF NOT EXISTS label_config jsonb DEFAULT NULL;

COMMENT ON COLUMN public.tenant_preferences.label_config IS
  'JSON config for item label customization. Schema: { fields: [{key, enabled, fontSize}], qrSize, showBorder, showQR }';
