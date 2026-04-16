-- Create trigger function to auto-release items moved to release locations
CREATE OR REPLACE FUNCTION handle_item_release_on_location_change()
RETURNS TRIGGER AS $$
DECLARE
  location_type TEXT;
BEGIN
  -- Only proceed if location actually changed
  IF NEW.current_location_id IS DISTINCT FROM OLD.current_location_id 
     AND NEW.current_location_id IS NOT NULL THEN
    
    -- Get the type of the new location
    SELECT type INTO location_type
    FROM locations
    WHERE id = NEW.current_location_id;
    
    -- If moving to a release-type location, update status
    IF location_type = 'release' THEN
      NEW.status := 'released';
      NEW.released_at := NOW();
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on items table
DROP TRIGGER IF EXISTS trigger_item_release_on_location ON items;
CREATE TRIGGER trigger_item_release_on_location
  BEFORE UPDATE ON items
  FOR EACH ROW
  EXECUTE FUNCTION handle_item_release_on_location_change();

-- Create a "Released" location for each existing warehouse
INSERT INTO locations (code, name, warehouse_id, type, status)
SELECT 
  'RELEASED',
  'Released Items',
  id,
  'release',
  'active'
FROM warehouses
WHERE deleted_at IS NULL
ON CONFLICT DO NOTHING;