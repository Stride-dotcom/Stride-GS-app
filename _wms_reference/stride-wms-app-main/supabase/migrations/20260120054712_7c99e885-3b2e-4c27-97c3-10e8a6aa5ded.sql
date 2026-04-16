-- Convert v_items_with_location to SECURITY INVOKER
ALTER VIEW v_items_with_location SET (security_invoker = on);

-- Convert v_movement_history to SECURITY INVOKER
ALTER VIEW v_movement_history SET (security_invoker = on);