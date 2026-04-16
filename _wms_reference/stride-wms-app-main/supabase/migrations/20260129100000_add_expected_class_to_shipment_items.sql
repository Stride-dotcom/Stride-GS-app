-- Add expected_class_id column to shipment_items table
-- This allows users to pre-specify the class for incoming items

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'shipment_items' AND column_name = 'expected_class_id'
  ) THEN
    ALTER TABLE public.shipment_items
      ADD COLUMN expected_class_id UUID REFERENCES public.classes(id) ON DELETE SET NULL;

    CREATE INDEX IF NOT EXISTS idx_shipment_items_expected_class
      ON public.shipment_items(expected_class_id);
  END IF;
END $$;

COMMENT ON COLUMN public.shipment_items.expected_class_id IS 'Expected size class for the item (XS, S, M, L, XL, XXL)';
