
-- ============================================
-- STRIDE WMS REBUILD - PHASE 2: SHIPMENTS & INVENTORY (FINAL)
-- ============================================

-- 1. CREATE ENUM TYPES
-- ============================================

DO $$ BEGIN
  CREATE TYPE shipment_type_enum AS ENUM ('inbound', 'outbound', 'return', 'disposal');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE shipment_status_enum AS ENUM ('expected', 'in_progress', 'received', 'released', 'completed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE item_status_enum AS ENUM ('pending', 'active', 'released', 'disposed', 'lost');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE movement_type_enum AS ENUM ('receiving', 'putaway', 'pick', 'move', 'release', 'stocktake_correction', 'reactivation');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE media_type_enum AS ENUM ('photo', 'document', 'video');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE shipment_item_status_enum AS ENUM ('pending', 'received', 'partial', 'released', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. UPDATE SHIPMENTS TABLE
-- ============================================
ALTER TABLE public.shipments 
  ADD COLUMN IF NOT EXISTS sidemark_id UUID REFERENCES public.sidemarks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_shipments_sidemark_id ON public.shipments(sidemark_id);

-- 3. SHIPMENT_MEDIA TABLE (unified photos + docs)
-- ============================================
CREATE TABLE IF NOT EXISTS public.shipment_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  shipment_id UUID NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL DEFAULT 'photo',
  storage_key TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  caption TEXT,
  uploaded_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  CONSTRAINT shipment_media_type_check CHECK (media_type IN ('photo', 'document', 'video'))
);

CREATE INDEX IF NOT EXISTS idx_shipment_media_tenant_id ON public.shipment_media(tenant_id);
CREATE INDEX IF NOT EXISTS idx_shipment_media_shipment_id ON public.shipment_media(shipment_id);

ALTER TABLE public.shipment_media ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shipment_media_tenant_isolation" ON public.shipment_media;
CREATE POLICY "shipment_media_tenant_isolation" ON public.shipment_media
  FOR ALL USING (tenant_id = public.user_tenant_id());

-- 4. ADD account_id TO ITEMS TABLE (proper FK reference)
-- ============================================
ALTER TABLE public.items 
  ADD COLUMN IF NOT EXISTS account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL;

-- 5. UPDATE ITEMS TABLE (add critical columns for billing)
-- ============================================
ALTER TABLE public.items 
  ADD COLUMN IF NOT EXISTS sidemark_id UUID REFERENCES public.sidemarks(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS class_id UUID,
  ADD COLUMN IF NOT EXISTS received_date DATE,
  ADD COLUMN IF NOT EXISTS released_date DATE,
  ADD COLUMN IF NOT EXISTS last_storage_invoiced_through DATE,
  ADD COLUMN IF NOT EXISTS declared_value DECIMAL(12,2),
  ADD COLUMN IF NOT EXISTS coverage_type TEXT DEFAULT 'standard';

-- Sync received_date from received_at if it exists
UPDATE public.items 
SET received_date = received_at::date 
WHERE received_at IS NOT NULL AND received_date IS NULL;

-- Sync released_date from released_at if it exists
UPDATE public.items 
SET released_date = released_at::date 
WHERE released_at IS NOT NULL AND released_date IS NULL;

-- Add constraint for coverage_type
ALTER TABLE public.items 
  DROP CONSTRAINT IF EXISTS items_coverage_type_check;
  
ALTER TABLE public.items 
  ADD CONSTRAINT items_coverage_type_check 
  CHECK (coverage_type IN ('standard', 'enhanced', 'full', 'pending'));

-- Add indexes for items
CREATE INDEX IF NOT EXISTS idx_items_account_id ON public.items(account_id);
CREATE INDEX IF NOT EXISTS idx_items_sidemark_id ON public.items(sidemark_id);
CREATE INDEX IF NOT EXISTS idx_items_class_id ON public.items(class_id);
CREATE INDEX IF NOT EXISTS idx_items_account_sidemark ON public.items(account_id, sidemark_id);
CREATE INDEX IF NOT EXISTS idx_items_received_date ON public.items(received_date);
CREATE INDEX IF NOT EXISTS idx_items_released_date ON public.items(released_date);
CREATE INDEX IF NOT EXISTS idx_items_storage_billing ON public.items(tenant_id, last_storage_invoiced_through) WHERE released_date IS NULL;

-- Unique item_code per tenant
DROP INDEX IF EXISTS idx_items_tenant_item_code;
CREATE UNIQUE INDEX idx_items_tenant_item_code ON public.items(tenant_id, item_code);

-- 6. ADD tenant_id TO MOVEMENTS TABLE
-- ============================================
ALTER TABLE public.movements
  ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE;

-- Backfill tenant_id from items
UPDATE public.movements m
SET tenant_id = i.tenant_id
FROM public.items i
WHERE m.item_id = i.id AND m.tenant_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_movements_tenant_id ON public.movements(tenant_id);
CREATE INDEX IF NOT EXISTS idx_movements_item_id ON public.movements(item_id);
CREATE INDEX IF NOT EXISTS idx_movements_created_at ON public.movements(created_at DESC);

-- 7. ITEM_FLAGS TABLE (time/price modifiers applied to items)
-- ============================================
CREATE TABLE IF NOT EXISTS public.item_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  flag_id UUID NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_by UUID REFERENCES public.users(id),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES public.users(id),
  notes TEXT,
  
  CONSTRAINT item_flags_unique UNIQUE (item_id, flag_id, applied_at)
);

CREATE INDEX IF NOT EXISTS idx_item_flags_tenant_id ON public.item_flags(tenant_id);
CREATE INDEX IF NOT EXISTS idx_item_flags_item_id ON public.item_flags(item_id);
CREATE INDEX IF NOT EXISTS idx_item_flags_active ON public.item_flags(item_id) WHERE resolved_at IS NULL;

ALTER TABLE public.item_flags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "item_flags_tenant_isolation" ON public.item_flags;
CREATE POLICY "item_flags_tenant_isolation" ON public.item_flags
  FOR ALL USING (tenant_id = public.user_tenant_id());

-- 8. ITEM_AUDIT_LOG TABLE (full change history)
-- ============================================
CREATE TABLE IF NOT EXISTS public.item_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  item_id UUID NOT NULL REFERENCES public.items(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  field_changed TEXT,
  old_value TEXT,
  new_value TEXT,
  changed_by UUID REFERENCES public.users(id),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_item_audit_log_tenant_id ON public.item_audit_log(tenant_id);
CREATE INDEX IF NOT EXISTS idx_item_audit_log_item_id ON public.item_audit_log(item_id);
CREATE INDEX IF NOT EXISTS idx_item_audit_log_changed_at ON public.item_audit_log(changed_at DESC);

ALTER TABLE public.item_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "item_audit_log_tenant_isolation" ON public.item_audit_log;
CREATE POLICY "item_audit_log_tenant_isolation" ON public.item_audit_log
  FOR ALL USING (tenant_id = public.user_tenant_id());

-- 9. UPDATE ITEM_PHOTOS TABLE (add flags)
-- ============================================
ALTER TABLE public.item_photos
  ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS needs_attention BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS caption TEXT;

-- 10. TRIGGER: Auto-log item field changes
-- ============================================
CREATE OR REPLACE FUNCTION public.log_item_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.sidemark_id IS DISTINCT FROM NEW.sidemark_id THEN
    INSERT INTO item_audit_log (tenant_id, item_id, action, field_changed, old_value, new_value, changed_by)
    VALUES (NEW.tenant_id, NEW.id, 'sidemark_changed', 'sidemark_id', OLD.sidemark_id::text, NEW.sidemark_id::text, auth.uid());
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO item_audit_log (tenant_id, item_id, action, field_changed, old_value, new_value, changed_by)
    VALUES (NEW.tenant_id, NEW.id, 'status_changed', 'status', OLD.status, NEW.status, auth.uid());
  END IF;

  IF OLD.current_location_id IS DISTINCT FROM NEW.current_location_id THEN
    INSERT INTO item_audit_log (tenant_id, item_id, action, field_changed, old_value, new_value, changed_by)
    VALUES (NEW.tenant_id, NEW.id, 'location_changed', 'current_location_id', OLD.current_location_id::text, NEW.current_location_id::text, auth.uid());
  END IF;

  IF OLD.declared_value IS DISTINCT FROM NEW.declared_value THEN
    INSERT INTO item_audit_log (tenant_id, item_id, action, field_changed, old_value, new_value, changed_by)
    VALUES (NEW.tenant_id, NEW.id, 'updated', 'declared_value', OLD.declared_value::text, NEW.declared_value::text, auth.uid());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_log_item_changes ON public.items;
CREATE TRIGGER trigger_log_item_changes
  AFTER UPDATE ON public.items
  FOR EACH ROW
  EXECUTE FUNCTION public.log_item_changes();

-- 11. TRIGGER: Create movement on location change
-- ============================================
CREATE OR REPLACE FUNCTION public.create_movement_on_location_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF OLD.current_location_id IS DISTINCT FROM NEW.current_location_id 
     AND NEW.current_location_id IS NOT NULL THEN
    
    INSERT INTO movements (
      tenant_id, 
      item_id, 
      from_location_id, 
      to_location_id, 
      actor_id,
      actor_type,
      action_type
    ) VALUES (
      NEW.tenant_id,
      NEW.id,
      OLD.current_location_id,
      NEW.current_location_id,
      auth.uid(),
      'user',
      CASE 
        WHEN OLD.current_location_id IS NULL THEN 'receiving'
        WHEN NEW.status = 'released' THEN 'release'
        ELSE 'move'
      END
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_create_movement_on_location_change ON public.items;
CREATE TRIGGER trigger_create_movement_on_location_change
  AFTER UPDATE ON public.items
  FOR EACH ROW
  EXECUTE FUNCTION public.create_movement_on_location_change();

-- 12. FUNCTION: Batch move items (using existing movements schema)
-- ============================================
CREATE OR REPLACE FUNCTION public.batch_move_items(
  p_item_ids UUID[],
  p_to_location_id UUID,
  p_action_type TEXT DEFAULT 'move',
  p_note TEXT DEFAULT NULL
)
RETURNS TABLE(item_id UUID, success BOOLEAN, error_message TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_item_id UUID;
  v_tenant_id UUID;
  v_old_location_id UUID;
BEGIN
  v_tenant_id := public.user_tenant_id();
  
  FOREACH v_item_id IN ARRAY p_item_ids
  LOOP
    BEGIN
      SELECT current_location_id INTO v_old_location_id
      FROM items WHERE id = v_item_id AND tenant_id = v_tenant_id;
      
      IF NOT FOUND THEN
        item_id := v_item_id;
        success := FALSE;
        error_message := 'Item not found or access denied';
        RETURN NEXT;
        CONTINUE;
      END IF;
      
      UPDATE items 
      SET current_location_id = p_to_location_id,
          updated_at = now()
      WHERE id = v_item_id AND tenant_id = v_tenant_id;
      
      INSERT INTO movements (tenant_id, item_id, from_location_id, to_location_id, actor_id, actor_type, action_type, note)
      VALUES (v_tenant_id, v_item_id, v_old_location_id, p_to_location_id, auth.uid(), 'user', p_action_type, p_note);
      
      item_id := v_item_id;
      success := TRUE;
      error_message := NULL;
      RETURN NEXT;
      
    EXCEPTION WHEN OTHERS THEN
      item_id := v_item_id;
      success := FALSE;
      error_message := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END;
$$;

-- 13. FUNCTION: Generate item code
-- ============================================
CREATE SEQUENCE IF NOT EXISTS item_code_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_item_code(p_tenant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  v_next_val INTEGER;
  v_prefix TEXT;
BEGIN
  SELECT COALESCE(
    (SELECT setting_value->>'item_code_prefix' FROM tenant_settings WHERE tenant_id = p_tenant_id AND setting_key = 'item_code_prefix'),
    'ITM'
  ) INTO v_prefix;
  
  v_next_val := nextval('item_code_seq');
  RETURN v_prefix || '-' || LPAD(v_next_val::TEXT, 6, '0');
END;
$$;

-- 14. TRIGGER: Auto-set item_code on insert
-- ============================================
CREATE OR REPLACE FUNCTION public.set_item_code_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.item_code IS NULL OR NEW.item_code = '' THEN
    NEW.item_code := public.generate_item_code(NEW.tenant_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_set_item_code ON public.items;
CREATE TRIGGER trigger_set_item_code
  BEFORE INSERT ON public.items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_item_code_on_insert();

-- 15. TRIGGER: Set received_date and released_date from status
-- ============================================
CREATE OR REPLACE FUNCTION public.set_item_dates_from_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'active' AND OLD.status = 'pending' AND NEW.received_date IS NULL THEN
    NEW.received_date := CURRENT_DATE;
  END IF;
  
  IF NEW.status = 'released' AND OLD.status != 'released' AND NEW.released_date IS NULL THEN
    NEW.released_date := CURRENT_DATE;
  END IF;
  
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_set_item_dates ON public.items;
CREATE TRIGGER trigger_set_item_dates
  BEFORE UPDATE ON public.items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_item_dates_from_status();

-- 16. GRANT PERMISSIONS
-- ============================================
GRANT ALL ON public.shipment_media TO authenticated;
GRANT ALL ON public.item_flags TO authenticated;
GRANT ALL ON public.item_audit_log TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE item_code_seq TO authenticated;
