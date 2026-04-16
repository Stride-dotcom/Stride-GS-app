-- Fix search_path for the trigger function
CREATE OR REPLACE FUNCTION handle_item_release_on_location_change()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
AS $$
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