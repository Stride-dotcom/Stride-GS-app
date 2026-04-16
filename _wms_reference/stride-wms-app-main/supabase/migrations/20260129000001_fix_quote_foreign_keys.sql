-- Fix Quote Foreign Keys Migration
-- Updates foreign keys to reference classes and service_events tables
-- instead of the now-removed quote_classes and quote_services tables

-- ============================================================================
-- SECTION 1: Drop old tables that are no longer needed
-- ============================================================================

-- Drop quote_service_rates if it exists (no longer needed - rates come from service_events)
DROP TABLE IF EXISTS public.quote_service_rates CASCADE;

-- Drop quote_services if it exists (no longer needed - services come from service_events)
DROP TABLE IF EXISTS public.quote_services CASCADE;

-- Drop quote_classes if it exists (no longer needed - classes come from classes table)
DROP TABLE IF EXISTS public.quote_classes CASCADE;

-- Drop the old billing unit enum if it exists
DROP TYPE IF EXISTS quote_billing_unit CASCADE;

-- ============================================================================
-- SECTION 2: Fix quote_class_lines foreign key
-- ============================================================================

-- Drop the old foreign key constraint if it exists
ALTER TABLE public.quote_class_lines
  DROP CONSTRAINT IF EXISTS quote_class_lines_class_id_fkey;

-- Add the new foreign key constraint referencing classes table
ALTER TABLE public.quote_class_lines
  ADD CONSTRAINT quote_class_lines_class_id_fkey
  FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE RESTRICT;

-- ============================================================================
-- SECTION 3: Fix quote_selected_services foreign key
-- ============================================================================

-- Drop the old foreign key constraint if it exists
ALTER TABLE public.quote_selected_services
  DROP CONSTRAINT IF EXISTS quote_selected_services_service_id_fkey;

-- Add the new foreign key constraint referencing service_events table
ALTER TABLE public.quote_selected_services
  ADD CONSTRAINT quote_selected_services_service_id_fkey
  FOREIGN KEY (service_id) REFERENCES public.service_events(id) ON DELETE RESTRICT;

-- ============================================================================
-- SECTION 4: Fix quote_rate_overrides foreign keys
-- ============================================================================

-- Drop the old foreign key constraints if they exist
ALTER TABLE public.quote_rate_overrides
  DROP CONSTRAINT IF EXISTS quote_rate_overrides_service_id_fkey;

ALTER TABLE public.quote_rate_overrides
  DROP CONSTRAINT IF EXISTS quote_rate_overrides_class_id_fkey;

-- Add the new foreign key constraints
ALTER TABLE public.quote_rate_overrides
  ADD CONSTRAINT quote_rate_overrides_service_id_fkey
  FOREIGN KEY (service_id) REFERENCES public.service_events(id) ON DELETE CASCADE;

ALTER TABLE public.quote_rate_overrides
  ADD CONSTRAINT quote_rate_overrides_class_id_fkey
  FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE SET NULL;

-- ============================================================================
-- SECTION 5: Create quote_class_service_selections table if not exists
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.quote_class_service_selections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE RESTRICT,
  service_id UUID NOT NULL REFERENCES public.service_events(id) ON DELETE RESTRICT,
  is_selected BOOLEAN DEFAULT true,
  qty_override NUMERIC(10,2),

  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),

  UNIQUE(quote_id, class_id, service_id)
);

CREATE INDEX IF NOT EXISTS idx_quote_class_service_selections_quote
  ON public.quote_class_service_selections(quote_id);

-- Enable RLS
ALTER TABLE public.quote_class_service_selections ENABLE ROW LEVEL SECURITY;

-- RLS Policy
DROP POLICY IF EXISTS "Users can manage quote class service selections" ON public.quote_class_service_selections;
CREATE POLICY "Users can manage quote class service selections"
  ON public.quote_class_service_selections FOR ALL
  TO authenticated
  USING (quote_id IN (SELECT id FROM public.quotes WHERE tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())))
  WITH CHECK (quote_id IN (SELECT id FROM public.quotes WHERE tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())));

-- Updated_at trigger
DROP TRIGGER IF EXISTS set_quote_class_service_selections_updated_at ON public.quote_class_service_selections;
CREATE TRIGGER set_quote_class_service_selections_updated_at
  BEFORE UPDATE ON public.quote_class_service_selections
  FOR EACH ROW
  EXECUTE FUNCTION set_quote_updated_at();

COMMENT ON TABLE public.quote_class_service_selections IS 'Per-class service selections with optional qty overrides - references classes and service_events tables';
