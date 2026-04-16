-- Update Price List - Match exact spreadsheet data
-- All billing_unit values are Day or Item (no Task)
-- ============================================================================

-- Update the seed_service_events function with corrected data
CREATE OR REPLACE FUNCTION public.seed_service_events(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Clear existing service events for this tenant (fresh start)
  DELETE FROM public.service_events WHERE tenant_id = p_tenant_id;

  -- Insert all service events matching the spreadsheet exactly
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
  (p_tenant_id, 'XL', 'Pull_Prep', 'Pull Prep Load', 'Item', 7, 9, true, false, true, 'Pull Item, Prepare and Load', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'XXL', 'Pull_Prep', 'Pull Prep Load', 'Item', 9, 12, true, false, true, 'Pull Item, Prepare and Load', false, true, 'none', 'SCAN EVENT'),

  -- Re-Label
  (p_tenant_id, NULL, 'Re_Label', 'Re-Label', 'Item', 3, 6, true, false, true, 'Apply new labels on package', false, true, 'none', 'SCAN EVENT'),

  -- Restock Standard
  (p_tenant_id, NULL, 'Restock_Std', 'Restock', 'Item', 7, 35, true, true, false, 'Restock Item', false, true, 'none', 'SCAN EVENT'),

  -- Restock Large
  (p_tenant_id, NULL, 'Restock_Lrg', 'Restock', 'Item', 10, 50, true, true, false, 'Restock Item', false, true, 'none', 'SCAN EVENT'),

  -- Wrap / Shrink Wrapping
  (p_tenant_id, NULL, 'Wrap', 'Shrink Wrapping', 'Item', 4, 15, true, true, false, 'Shrink wrap added', false, true, 'none', 'SCAN EVENT'),

  -- Sit Test (by class)
  (p_tenant_id, 'XS', 'Sit_test', 'Sit Test', 'Item', 5, 2, true, false, true, 'Sit Test or Viewing', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'S', 'Sit_test', 'Sit Test', 'Item', 5, 3, true, false, true, 'Sit Test or Viewing', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'M', 'Sit_test', 'Sit Test', 'Item', 5, 5, true, false, true, 'Sit Test or Viewing', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'L', 'Sit_test', 'Sit Test', 'Item', 5, 7, true, false, true, 'Sit Test or Viewing', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'XL', 'Sit_test', 'Sit Test', 'Item', 7, 9, true, false, true, 'Sit Test or Viewing', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'XXL', 'Sit_test', 'Sit Test', 'Item', 9, 12, true, false, true, 'Sit Test or Viewing', true, true, 'none', 'SCAN EVENT'),

  -- Receiving (by class)
  (p_tenant_id, 'XS', 'RCVG', 'Receiving', 'Item', 5, 10, true, false, true, 'Receive and put away Item', false, false, 'none', 'Shipment'),
  (p_tenant_id, 'S', 'RCVG', 'Receiving', 'Item', 5, 10, true, false, true, 'Receive and put away Item', false, false, 'none', 'Shipment'),
  (p_tenant_id, 'M', 'RCVG', 'Receiving', 'Item', 5, 15, true, false, true, 'Receive and put away Item', false, false, 'none', 'Shipment'),
  (p_tenant_id, 'L', 'RCVG', 'Receiving', 'Item', 5, 15, true, false, true, 'Receive and put away Item', false, false, 'none', 'Shipment'),
  (p_tenant_id, 'XL', 'RCVG', 'Receiving', 'Item', 7, 20, true, false, true, 'Receive and put away Item', false, false, 'none', 'Shipment'),
  (p_tenant_id, 'XXL', 'RCVG', 'Receiving', 'Item', 9, 25, true, false, true, 'Receive and put away Item', false, false, 'none', 'Shipment'),

  -- Returns Processing (by class)
  (p_tenant_id, 'XS', 'Returns', 'Returns Processing', 'Item', 5, 10, true, false, true, 'Return Shipment Processing', false, false, 'none', 'Shipment'),
  (p_tenant_id, 'S', 'Returns', 'Returns Processing', 'Item', 5, 10, true, false, true, 'Return Shipment Processing', false, false, 'none', 'Shipment'),
  (p_tenant_id, 'M', 'Returns', 'Returns Processing', 'Item', 5, 15, true, false, true, 'Return Shipment Processing', false, false, 'none', 'Shipment'),
  (p_tenant_id, 'L', 'Returns', 'Returns Processing', 'Item', 5, 15, true, false, true, 'Return Shipment Processing', false, false, 'none', 'Shipment'),
  (p_tenant_id, 'XL', 'Returns', 'Returns Processing', 'Item', 7, 20, true, false, true, 'Return Shipment Processing', false, false, 'none', 'Shipment'),
  (p_tenant_id, 'XXL', 'Returns', 'Returns Processing', 'Item', 9, 25, true, false, true, 'Return Shipment Processing', false, false, 'none', 'Shipment'),

  -- Stocktake
  (p_tenant_id, NULL, 'STOCKTAKE', 'Stocktake', 'Item', 2, 2, true, false, true, 'Flat per item scanned.', false, false, 'none', 'Stocktake'),

  -- Disposal (by class)
  (p_tenant_id, 'XS', 'Disposal', 'Disposal', 'Item', 7, 10, true, false, true, 'Disposal Or Donation', false, false, 'none', 'TASK'),
  (p_tenant_id, 'S', 'Disposal', 'Disposal', 'Item', 7, 25, true, false, true, 'Disposal Or Donation', false, false, 'none', 'TASK'),
  (p_tenant_id, 'M', 'Disposal', 'Disposal', 'Item', 9, 50, true, false, true, 'Disposal Or Donation', false, false, 'none', 'TASK'),
  (p_tenant_id, 'L', 'Disposal', 'Disposal', 'Item', 10, 100, true, false, true, 'Disposal Or Donation', false, false, 'none', 'TASK'),
  (p_tenant_id, 'XL', 'Disposal', 'Disposal', 'Item', 14, 185, true, false, true, 'Disposal Or Donation', false, false, 'none', 'TASK'),
  (p_tenant_id, 'XXL', 'Disposal', 'Disposal', 'Item', 20, 250, true, false, true, 'Disposal Or Donation', false, false, 'none', 'TASK'),

  -- Assembly Services (billing_unit = Item)
  (p_tenant_id, NULL, '5MA', 'Assembly <15', 'Item', 5, 25, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, '15MA', 'Assembly 15m', 'Item', 15, 35, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, '30MA', 'Assembly 30m', 'Item', 30, 70, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, '45MA', 'Assembly 45m', 'Item', 45, 105, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, '60MA', 'Assembly 60m', 'Item', 60, 140, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, '75MA', 'Assembly 75m', 'Item', 75, 175, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, '90MA', 'Assembly 1.5hr', 'Item', 90, 210, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, '120MA', 'Assembly 120m', 'Item', 120, 245, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),

  -- Quote Required Assembly
  (p_tenant_id, NULL, 'QR_ASSM', 'Assembly Mgr Quote Req', 'Item', NULL, 0, true, false, true, 'Manager Quote Required Assembly', false, false, 'email_office', 'Task - Assign Rate'),

  -- Repair Services (billing_unit = Item)
  (p_tenant_id, NULL, '1HRO', '1 Hr Repair', 'Item', 60, 105, true, false, true, 'Repair', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, '1.5HRO', 'Repair 1.5hr', 'Item', 90, 212.5, true, false, true, 'Repair', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, '2HRO', 'Repair 2hr', 'Item', 60, 110, true, false, true, 'Repair', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, '2.5HRO', 'Repair 2.5hr', 'Item', 150, 387.5, true, false, true, 'Repair', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, '3HRO', 'Repair 3hr', 'Item', 180, 465, true, false, true, 'Repair', false, false, 'none', 'Task - Assign Rate'),

  -- Quote Required Repair
  (p_tenant_id, NULL, 'QR_REPAIR', 'Repair Mgr Quote Req', 'Item', NULL, 0, true, false, true, 'Manager Quote Required Repair', false, false, 'none', 'Task - Assign Rate'),

  -- Inspection (by class) - billing_unit = Item
  (p_tenant_id, 'XS', 'INSP', 'Inspection', 'Item', 7, 15, true, false, true, 'Inspection and pack for storage', false, false, 'email_office', 'Through Task'),
  (p_tenant_id, 'S', 'INSP', 'Inspection', 'Item', 7, 25, true, false, true, 'Inspection and pack for storage', false, false, 'none', 'Through Task'),
  (p_tenant_id, 'M', 'INSP', 'Inspection', 'Item', 9, 35, true, false, true, 'Inspection and pack for storage', false, false, 'none', 'Through Task'),
  (p_tenant_id, 'L', 'INSP', 'Inspection', 'Item', 10, 55, true, false, true, 'Inspection and pack for storage', false, false, 'none', 'Through Task'),
  (p_tenant_id, 'XL', 'INSP', 'Inspection', 'Item', 14, 65, true, false, true, 'Inspection and pack for storage', false, false, 'none', 'Through Task'),
  (p_tenant_id, 'XXL', 'INSP', 'Inspection', 'Item', 20, 75, true, false, true, 'Inspection and pack for storage', false, false, 'none', 'Through Task'),

  -- Will Call (by class) - billing_unit = Item
  (p_tenant_id, 'XS', 'Will_Call', 'Will Call', 'Item', 5, 10, true, false, true, 'Will Call / Outbound Shipment', false, false, 'none', 'Through Task'),
  (p_tenant_id, 'S', 'Will_Call', 'Will Call', 'Item', 5, 10, true, false, true, 'Will Call / Outbound Shipment', false, false, 'none', 'Through Task'),
  (p_tenant_id, 'M', 'Will_Call', 'Will Call', 'Item', 5, 15, true, false, true, 'Will Call / Outbound Shipment', false, false, 'none', 'Through Task'),
  (p_tenant_id, 'L', 'Will_Call', 'Will Call', 'Item', 5, 15, true, false, true, 'Will Call / Outbound Shipment', false, false, 'none', 'Through Task'),
  (p_tenant_id, 'XL', 'Will_Call', 'Will Call', 'Item', 7, 20, true, false, true, 'Will Call / Outbound Shipment', false, false, 'none', 'Through Task'),
  (p_tenant_id, 'XXL', 'Will_Call', 'Will Call', 'Item', 9, 25, true, false, true, 'Will Call / Outbound Shipment', false, false, 'none', 'Through Task');

END;
$$;

COMMENT ON FUNCTION public.seed_service_events IS 'Populate standard price list for a tenant - matches spreadsheet exactly';
