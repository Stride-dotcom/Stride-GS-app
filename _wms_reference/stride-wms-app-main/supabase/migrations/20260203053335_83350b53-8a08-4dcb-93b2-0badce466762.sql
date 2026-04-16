-- Fix: Update seed_service_events to handle foreign key constraints
-- Instead of DELETE, use UPSERT to avoid breaking quote_class_service_selections

CREATE OR REPLACE FUNCTION public.seed_service_events(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Use INSERT ... ON CONFLICT DO UPDATE to avoid foreign key violations
  -- First, mark all existing ones as inactive (soft "clear")
  UPDATE public.service_events 
  SET is_active = false 
  WHERE tenant_id = p_tenant_id;

  -- Insert all service events matching the spreadsheet exactly (using ON CONFLICT)
  INSERT INTO public.service_events (
    tenant_id, class_code, service_code, service_name, billing_unit,
    service_time_minutes, rate, taxable, uses_class_pricing, is_active,
    notes, add_flag, add_to_service_event_scan, alert_rule, billing_trigger
  ) VALUES
  -- Short Term Storage (by class)
  (p_tenant_id, 'XS', 'Short_Storage', 'Short Term Storage', 'Day', NULL, 0.5, true, false, true, 'Short Term Storage', false, false, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'S', 'Short_Storage', 'Short Term Storage', 'Day', NULL, 1.5, true, false, true, 'Short Term Storage', false, false, 'none', 'AUTOCALCULATE'),
  (p_tenant_id, 'M', 'Short_Storage', 'Short Term Storage', 'Day', NULL, 4.5, true, false, true, 'Short Term Storage', false, false, 'none', 'AUTOCALCULATE'),
  (p_tenant_id, 'L', 'Short_Storage', 'Short Term Storage', 'Day', NULL, 7.5, true, false, true, 'Short Term Storage', false, false, 'none', 'AUTOCALCULATE'),
  (p_tenant_id, 'XL', 'Short_Storage', 'Short Term Storage', 'Day', NULL, 10, true, false, true, 'Short Term Storage', false, false, 'none', 'AUTOCALCULATE'),
  (p_tenant_id, 'XXL', 'Short_Storage', 'Short Term Storage', 'Day', NULL, 15, true, false, true, 'Short Term Storage', false, false, 'none', 'AUTOCALCULATE'),
  -- Climate Control
  (p_tenant_id, NULL, 'Climate_Control', 'Climate Control', 'Item', NULL, 25, true, false, true, 'Requires Climate Control', true, false, 'email_office', 'Flag'),
  -- Crate Disposal
  (p_tenant_id, NULL, 'Crate_Disposal', 'Crate Disposal', 'Item', 20, 100, true, false, true, 'Crate Disposal', true, false, 'none', 'Flag'),
  -- Kitting
  (p_tenant_id, NULL, 'KITTING', 'Kitting', 'Item', 8, 15, true, false, true, 'Consolidating Multiple Pieces to One', true, true, 'none', 'Flag'),
  -- Minor Touch Up
  (p_tenant_id, NULL, 'Minor_Touch_Up', 'Minor Touch Up', 'Item', 7, 25, true, false, true, 'Minor Touch Up', true, true, 'none', 'Flag'),
  -- Multi Part Inspection
  (p_tenant_id, NULL, 'Multi_Insp', 'Multi Part Inspection', 'Item', 15, 20, true, true, false, 'Multiple Parts Added to Base Inspection', true, true, 'none', 'Flag'),
  -- Pallet Disposal
  (p_tenant_id, NULL, 'Pallet_Disposal', 'Pallet Disposal', 'Item', NULL, 10, true, false, true, 'Pallet Disposal', true, false, 'none', 'Flag'),
  -- Storage Charge (by class)
  (p_tenant_id, 'XS', 'STRG_DAY', 'Storage Charge', 'Day', NULL, 0.2, true, false, true, 'Storage charges', false, false, 'none', 'Per Item Auto Calculated'),
  (p_tenant_id, 'S', 'STRG_DAY', 'Storage Charge', 'Day', NULL, 0.6, true, false, true, 'Storage charges', false, false, 'none', 'Per Item Auto Calculated'),
  (p_tenant_id, 'M', 'STRG_DAY', 'Storage Charge', 'Day', NULL, 1.8, true, false, true, 'Storage charges', false, false, 'none', 'Per Item Auto Calculated'),
  (p_tenant_id, 'L', 'STRG_DAY', 'Storage Charge', 'Day', NULL, 3, true, false, true, 'Storage charges', false, false, 'none', 'Per Item Auto Calculated'),
  (p_tenant_id, 'XL', 'STRG_DAY', 'Storage Charge', 'Day', NULL, 4, true, false, true, 'Storage charges', false, false, 'none', 'Per Item Auto Calculated'),
  (p_tenant_id, 'XXL', 'STRG_DAY', 'Storage Charge', 'Day', NULL, 6, true, false, true, 'Storage charges', false, false, 'none', 'Per Item Auto Calculated'),
  -- Palletize Large
  (p_tenant_id, NULL, 'Palletize_Lrg', 'Palletize Large', 'Item', 20, 80, true, false, true, 'Provide pallet and attach goods', false, true, 'none', 'SCAN EVENT'),
  -- Palletize Standard
  (p_tenant_id, NULL, 'Palletize_Std', 'Palletize Standard', 'Item', 12, 40, true, false, true, 'Provide pallet and attach goods', false, true, 'none', 'SCAN EVENT'),
  -- Pull Prep (by class)
  (p_tenant_id, 'XS', 'Pull_Prep', 'Pull Prep Load', 'Item', 5, 2, true, false, true, 'Pull Item, Prepare and Load', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'S', 'Pull_Prep', 'Pull Prep Load', 'Item', 5, 3, true, false, true, 'Pull Item, Prepare and Load', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'M', 'Pull_Prep', 'Pull Prep Load', 'Item', 5, 5, true, false, true, 'Pull Item, Prepare and Load', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'L', 'Pull_Prep', 'Pull Prep Load', 'Item', 5, 7, true, false, true, 'Pull Item, Prepare and Load', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'XL', 'Pull_Prep', 'Pull Prep Load', 'Item', 5, 10, true, false, true, 'Pull Item, Prepare and Load', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'XXL', 'Pull_Prep', 'Pull Prep Load', 'Item', 5, 15, true, false, true, 'Pull Item, Prepare and Load', false, true, 'none', 'SCAN EVENT'),
  -- Condition Report - Major
  (p_tenant_id, NULL, 'COND_RPT_MAJOR', 'Condition Report - Major', 'Item', 75, 100, true, false, true, 'Major damage/detailed photo/measurement documentation', true, true, 'email_office', 'TASK COMPLETION'),
  -- Condition Report - Standard
  (p_tenant_id, NULL, 'COND_RPT', 'Condition Report - Standard', 'Item', 45, 50, true, false, true, 'Standard Condition Report', true, true, 'none', 'TASK COMPLETION'),
  -- Receiving (by class)
  (p_tenant_id, 'XS', 'RCVG', 'Receiving', 'Item', 7, 6, true, false, true, 'Receive + Unload + Label + Photo + Relocate (7min)', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'S', 'RCVG', 'Receiving', 'Item', 7, 8, true, false, true, 'Receive + Unload + Label + Photo + Relocate (7min)', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'M', 'RCVG', 'Receiving', 'Item', 12, 10, true, false, true, 'Receive + Unload + Label + Photo + Relocate (12min)', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'L', 'RCVG', 'Receiving', 'Item', 15, 18, true, false, true, 'Receive + Unload + Label + Photo + Relocate (15min)', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'XL', 'RCVG', 'Receiving', 'Item', 20, 30, true, false, true, 'Receive + Unload + Label + Photo + Relocate (20min)', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'XXL', 'RCVG', 'Receiving', 'Item', 30, 40, true, false, true, 'Receive + Unload + Label + Photo + Relocate (30min)', false, true, 'none', 'SCAN EVENT'),
  -- Inspection (by class)
  (p_tenant_id, 'XS', 'INSP', 'Inspection', 'Item', 20, 20, true, false, true, 'Visual Inspect + Photo + 10 dimension', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'S', 'INSP', 'Inspection', 'Item', 20, 25, true, false, true, 'Visual Inspect + Photo + 10 dimension', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'M', 'INSP', 'Inspection', 'Item', 20, 35, true, false, true, 'Visual Inspect + Photo + 10 dimension', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'L', 'INSP', 'Inspection', 'Item', 25, 45, true, false, true, 'Visual Inspect + Photo + 10 dimension (25min)', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'XL', 'INSP', 'Inspection', 'Item', 30, 60, true, false, true, 'Visual Inspect + Photo + 10 dimension (30min)', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'XXL', 'INSP', 'Inspection', 'Item', 40, 75, true, false, true, 'Visual Inspect + Photo + 10 dimension (40min)', false, true, 'none', 'SCAN EVENT'),
  -- Assembly (by class)
  (p_tenant_id, 'XS', 'ASSY', 'Assembly', 'Item', 15, 15, true, false, true, 'Full (Dis)assembly + Repack', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'S', 'ASSY', 'Assembly', 'Item', 20, 25, true, false, true, 'Full (Dis)assembly + Repack', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'M', 'ASSY', 'Assembly', 'Item', 40, 50, true, false, true, 'Full (Dis)assembly + Repack (40min)', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'L', 'ASSY', 'Assembly', 'Item', 60, 100, true, false, true, 'Full (Dis)assembly + Repack (1hr)', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'XL', 'ASSY', 'Assembly', 'Item', 75, 175, true, false, true, 'Full (Dis)assembly + Repack', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'XXL', 'ASSY', 'Assembly', 'Item', 90, 250, true, false, true, 'Full (Dis)assembly + Repack', false, true, 'none', 'SCAN EVENT'),
  -- Repair Labor
  (p_tenant_id, NULL, 'REPAIR_LABOR', 'Repair Labor', 'Hour', NULL, 100, true, false, true, 'Repair Labor', false, false, 'none', 'MANUAL/TASK'),
  -- Coverage
  (p_tenant_id, NULL, 'COV_FULL', 'Full Value Coverage', 'Item', NULL, 0.75, true, false, true, 'Full Value Coverage - 0.75% per month', false, false, 'none', 'AUTOCALCULATE'),
  (p_tenant_id, NULL, 'COV_BASIC', 'Basic Coverage', 'Item', NULL, 0, true, false, true, 'Basic 60c/lb Coverage', false, false, 'none', 'AUTOCALCULATE'),
  -- Misc
  (p_tenant_id, NULL, 'CUSTOMS_FEE', 'Customs Admin Fee', 'Item', NULL, 150, true, false, true, 'Customs documentation and coordination', false, false, 'none', 'MANUAL'),
  (p_tenant_id, NULL, 'MISC_CHARGE', 'Miscellaneous Charge', 'Item', NULL, 0, true, false, true, 'Miscellaneous charge - set rate as needed', false, false, 'none', 'MANUAL')
  ON CONFLICT (tenant_id, COALESCE(class_code, ''::text), service_code) 
  DO UPDATE SET
    service_name = EXCLUDED.service_name,
    billing_unit = EXCLUDED.billing_unit,
    service_time_minutes = EXCLUDED.service_time_minutes,
    rate = EXCLUDED.rate,
    taxable = EXCLUDED.taxable,
    uses_class_pricing = EXCLUDED.uses_class_pricing,
    is_active = true,
    notes = EXCLUDED.notes,
    add_flag = EXCLUDED.add_flag,
    add_to_service_event_scan = EXCLUDED.add_to_service_event_scan,
    alert_rule = EXCLUDED.alert_rule,
    billing_trigger = EXCLUDED.billing_trigger,
    updated_at = now();
END;
$$;
