-- Update Service Event Rates
-- This migration updates rates to match the standard price list
-- ============================================================================

-- Update 2HRO rate from 310 to 110
UPDATE public.service_events
SET rate = 110, updated_at = now()
WHERE service_code = '2HRO' AND rate = 310;

-- Update 30MA rate from 70 to 75
UPDATE public.service_events
SET rate = 75, updated_at = now()
WHERE service_code = '30MA' AND rate = 70;

-- Also update the seed function for new tenants
CREATE OR REPLACE FUNCTION public.seed_service_events(p_tenant_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Clear existing service events for this tenant (fresh start)
  DELETE FROM public.service_events WHERE tenant_id = p_tenant_id;

  -- Insert all service events
  INSERT INTO public.service_events (
    tenant_id, class_code, service_code, service_name, billing_unit,
    service_time_minutes, rate, taxable, uses_class_pricing, is_active,
    notes, add_flag, add_to_service_event_scan, alert_rule, billing_trigger
  ) VALUES
  -- Short Term Storage (by class) - AUTOCALCULATE
  (p_tenant_id, 'XS', 'Short_Storage', 'Short Term Storage', 'Day', NULL, 0.5, true, false, true, 'Short Term Storage', false, false, 'none', 'AUTOCALCULATE'),
  (p_tenant_id, 'S', 'Short_Storage', 'Short Term Storage', 'Day', NULL, 1.5, true, false, true, 'Short Term Storage', false, false, 'none', 'AUTOCALCULATE'),
  (p_tenant_id, 'M', 'Short_Storage', 'Short Term Storage', 'Day', NULL, 4.5, true, false, true, 'Short Term Storage', false, false, 'none', 'AUTOCALCULATE'),
  (p_tenant_id, 'L', 'Short_Storage', 'Short Term Storage', 'Day', NULL, 7.5, true, false, true, 'Short Term Storage', false, false, 'none', 'AUTOCALCULATE'),
  (p_tenant_id, 'XL', 'Short_Storage', 'Short Term Storage', 'Day', NULL, 10, true, false, true, 'Short Term Storage', false, false, 'none', 'AUTOCALCULATE'),
  (p_tenant_id, 'XXL', 'Short_Storage', 'Short Term Storage', 'Day', NULL, 15, true, false, true, 'Short Term Storage', false, false, 'none', 'AUTOCALCULATE'),

  -- Climate Control - Flag
  (p_tenant_id, NULL, 'Climate_Control', 'Climate Control', 'Item', NULL, 25, true, false, true, 'Requires Climate Control', true, false, 'email_office', 'Flag'),

  -- Crate Disposal - Flag
  (p_tenant_id, NULL, 'Crate_Disposal', 'Crate Disposal', 'Item', NULL, 100, true, false, true, 'Crate Disposal', true, false, 'none', 'Flag'),

  -- Kitting - Flag
  (p_tenant_id, NULL, 'KITTING', 'Kitting', 'Item', NULL, 15, true, false, true, 'Consolidating Multiple Pieces to One', true, true, 'none', 'Flag'),

  -- Minor Touch Up - Flag
  (p_tenant_id, NULL, 'Minor_Touch_Up', 'Minor Touch Up', 'Item', NULL, 25, true, false, true, 'Minor Touch Up', true, true, 'none', 'Flag'),

  -- Multi Part Inspection - Flag
  (p_tenant_id, NULL, 'Multi_Insp', 'Multi Part Inspection', 'Item', NULL, 20, true, true, true, 'Multiple Parts Added to Base Inspection', true, true, 'none', 'Flag'),

  -- Pallet Disposal - Flag
  (p_tenant_id, NULL, 'Pallet_Disposal', 'Pallet Disposal', 'Item', NULL, 10, true, false, true, 'Pallet Disposal', true, false, 'none', 'Flag'),

  -- Storage Charge (by class) - Per Item Auto Calculated
  (p_tenant_id, 'XS', 'STRG_DAY', 'Storage Charge', 'Day', NULL, 0.2, true, false, true, 'Storage charges', false, false, 'none', 'Per Item Auto Calculated'),
  (p_tenant_id, 'S', 'STRG_DAY', 'Storage Charge', 'Day', NULL, 0.6, true, false, true, 'Storage charges', false, false, 'none', 'Per Item Auto Calculated'),
  (p_tenant_id, 'M', 'STRG_DAY', 'Storage Charge', 'Day', NULL, 1.8, true, false, true, 'Storage charges', false, false, 'none', 'Per Item Auto Calculated'),
  (p_tenant_id, 'L', 'STRG_DAY', 'Storage Charge', 'Day', NULL, 3, true, false, true, 'Storage charges', false, false, 'none', 'Per Item Auto Calculated'),
  (p_tenant_id, 'XL', 'STRG_DAY', 'Storage Charge', 'Day', NULL, 4, true, false, true, 'Storage charges', false, false, 'none', 'Per Item Auto Calculated'),
  (p_tenant_id, 'XXL', 'STRG_DAY', 'Storage Charge', 'Day', NULL, 6, true, false, true, 'Storage charges', false, false, 'none', 'Per Item Auto Calculated'),

  -- Palletize Large - SCAN EVENT
  (p_tenant_id, NULL, 'Palletize_Lrg', 'Palletize Large', 'Item', NULL, 80, true, false, true, 'Provide pallet and attach goods', false, true, 'none', 'SCAN EVENT'),

  -- Palletize Standard - SCAN EVENT
  (p_tenant_id, NULL, 'Palletize_Std', 'Palletize Standard', 'Item', NULL, 40, true, false, true, 'Provide pallet and attach goods', false, true, 'none', 'SCAN EVENT'),

  -- Pull Prep (by class) - SCAN EVENT
  (p_tenant_id, 'XS', 'Pull_Prep', 'Pull Prep Load', 'Item', 5, 2, true, false, true, 'Pull Item, Prepare and Load', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'S', 'Pull_Prep', 'Pull Prep Load', 'Item', 5, 3, true, false, true, 'Pull Item, Prepare and Load', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'M', 'Pull_Prep', 'Pull Prep Load', 'Item', 5, 5, true, false, true, 'Pull Item, Prepare and Load', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'L', 'Pull_Prep', 'Pull Prep Load', 'Item', 5, 7, true, false, true, 'Pull Item, Prepare and Load', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'XL', 'Pull_Prep', 'Pull Prep Load', 'Item', 7, 9, true, false, true, 'Pull Item, Prepare and Load', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'XXL', 'Pull_Prep', 'Pull Prep Load', 'Item', 9, 12, true, false, true, 'Pull Item, Prepare and Load', false, true, 'none', 'SCAN EVENT'),

  -- Re-Label - SCAN EVENT
  (p_tenant_id, NULL, 'Re_Label', 'Re-Label', 'Item', NULL, 6, true, false, true, 'Apply new labels on package', false, true, 'none', 'SCAN EVENT'),

  -- Restock Standard - SCAN EVENT
  (p_tenant_id, NULL, 'Restock_Std', 'Restock', 'Item', NULL, 35, true, true, true, 'Restock Item', false, true, 'none', 'SCAN EVENT'),

  -- Restock Large - SCAN EVENT
  (p_tenant_id, NULL, 'Restock_Lrg', 'Restock', 'Item', NULL, 50, true, true, true, 'Restock Item', false, true, 'none', 'SCAN EVENT'),

  -- Wrap / Shrink Wrapping - SCAN EVENT
  (p_tenant_id, NULL, 'Wrap', 'Shrink Wrapping', 'Item', NULL, 15, true, true, true, 'Shrink wrap added', false, true, 'none', 'SCAN EVENT'),

  -- Sit Test (by class) - SCAN EVENT
  (p_tenant_id, 'XS', 'Sit_test', 'Sit Test', 'Item', 5, 2, true, false, true, 'Sit Test or Viewing', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'S', 'Sit_test', 'Sit Test', 'Item', 5, 3, true, false, true, 'Sit Test or Viewing', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'M', 'Sit_test', 'Sit Test', 'Item', 5, 5, true, false, true, 'Sit Test or Viewing', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'L', 'Sit_test', 'Sit Test', 'Item', 5, 7, true, false, true, 'Sit Test or Viewing', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'XL', 'Sit_test', 'Sit Test', 'Item', 7, 9, true, false, true, 'Sit Test or Viewing', false, true, 'none', 'SCAN EVENT'),
  (p_tenant_id, 'XXL', 'Sit_test', 'Sit Test', 'Item', 9, 12, true, false, true, 'Sit Test or Viewing', true, true, 'none', 'SCAN EVENT'),

  -- Receiving (by class) - Shipment
  (p_tenant_id, 'XS', 'RCVG', 'Receiving', 'Item', 5, 10, true, false, true, 'Receive and put away Item', false, false, 'none', 'Shipment'),
  (p_tenant_id, 'S', 'RCVG', 'Receiving', 'Item', 5, 10, true, false, true, 'Receive and put away Item', false, false, 'none', 'Shipment'),
  (p_tenant_id, 'M', 'RCVG', 'Receiving', 'Item', 5, 15, true, false, true, 'Receive and put away Item', false, false, 'none', 'Shipment'),
  (p_tenant_id, 'L', 'RCVG', 'Receiving', 'Item', 5, 15, true, false, true, 'Receive and put away Item', false, false, 'none', 'Shipment'),
  (p_tenant_id, 'XL', 'RCVG', 'Receiving', 'Item', 7, 20, true, false, true, 'Receive and put away Item', false, false, 'none', 'Shipment'),
  (p_tenant_id, 'XXL', 'RCVG', 'Receiving', 'Item', 9, 25, true, false, true, 'Receive and put away Item', false, false, 'none', 'Shipment'),

  -- Returns Processing (by class) - Shipment
  (p_tenant_id, 'XS', 'Returns', 'Returns Processing', 'Item', 5, 10, true, false, true, 'Return Shipment Processing', false, false, 'none', 'Shipment'),
  (p_tenant_id, 'S', 'Returns', 'Returns Processing', 'Item', 5, 10, true, false, true, 'Return Shipment Processing', false, false, 'none', 'Shipment'),
  (p_tenant_id, 'M', 'Returns', 'Returns Processing', 'Item', 5, 13, true, false, true, 'Return Shipment Processing', false, false, 'none', 'Shipment'),
  (p_tenant_id, 'L', 'Returns', 'Returns Processing', 'Item', 5, 15, true, false, true, 'Return Shipment Processing', false, false, 'none', 'Shipment'),
  (p_tenant_id, 'XL', 'Returns', 'Returns Processing', 'Item', 7, 20, true, false, true, 'Return Shipment Processing', false, false, 'none', 'Shipment'),
  (p_tenant_id, 'XXL', 'Returns', 'Returns Processing', 'Item', 9, 25, true, false, true, 'Return Shipment Processing', false, false, 'none', 'Shipment'),

  -- Stocktake - Stocktake
  (p_tenant_id, NULL, 'STOCKTAKE', 'Stocktake', 'Item', NULL, 2, true, false, true, 'Flat per item scanned.', false, false, 'none', 'Stocktake'),

  -- Disposal (by class) - TASK
  (p_tenant_id, 'XS', 'Disposal', 'Disposal', 'Item', 7, 10, true, false, true, 'Disposal Or Donation', false, false, 'none', 'TASK'),
  (p_tenant_id, 'S', 'Disposal', 'Disposal', 'Item', 7, 25, true, false, true, 'Disposal Or Donation', false, false, 'none', 'TASK'),
  (p_tenant_id, 'M', 'Disposal', 'Disposal', 'Item', 9, 50, true, false, true, 'Disposal Or Donation', false, false, 'none', 'TASK'),
  (p_tenant_id, 'L', 'Disposal', 'Disposal', 'Item', 10, 100, true, false, true, 'Disposal Or Donation', false, false, 'none', 'TASK'),
  (p_tenant_id, 'XL', 'Disposal', 'Disposal', 'Item', 14, 185, true, false, true, 'Disposal Or Donation', false, false, 'none', 'TASK'),
  (p_tenant_id, 'XXL', 'Disposal', 'Disposal', 'Item', 20, 250, true, false, true, 'Disposal Or Donation', false, false, 'none', 'TASK'),

  -- Assembly Services - Task - Assign Rate
  (p_tenant_id, NULL, '5MA', '<15 Minute Assembly', 'Task', NULL, 25, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, '1HRO', '1 Hr Repair', 'Task', NULL, 105, true, false, true, 'Repair', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, '1.5HRO', '1.5 Hr Repair', 'Task', NULL, 212.5, true, false, true, 'Repair', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, '120MA', '120 Minute Assembly', 'Task', NULL, 245, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, '15MA', '15 Minute Assembly', 'Task', NULL, 35, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, '2HRO', '2 Hr Repair', 'Task', NULL, 110, true, false, true, 'Repair', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, '2.5HRO', '2.5 Hr Repair', 'Task', NULL, 387.5, true, false, true, 'Repair', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, '3HRO', '3 Hr Repair', 'Task', NULL, 465, true, false, true, 'Repair', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, '30MA', '30 Minute Assembly', 'Task', NULL, 75, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, '45MA', '45 Minute Assembly', 'Task', NULL, 105, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, '60MA', '60 Minute Assembly', 'Task', NULL, 140, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, '75MA', '75 Minute Assembly', 'Task', NULL, 175, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, '90MA', '90 Minute Assembly', 'Task', NULL, 210, true, false, true, 'Assembly', false, false, 'none', 'Task - Assign Rate'),

  -- Quote Required Services - Task - Assign Rate
  (p_tenant_id, NULL, 'QR_REPAIR', 'Mgr Quote Req Repair', 'Task', NULL, 0, true, false, true, 'Manager Quote Required Repair', false, false, 'none', 'Task - Assign Rate'),
  (p_tenant_id, NULL, 'QR_ASSM', 'Mgr Quote Req Assembly', 'Task', NULL, 0, true, false, true, 'Manager Quote Required Assembly', false, false, 'email_office', 'Task - Assign Rate'),

  -- Inspection (by class) - Through Task
  (p_tenant_id, 'XS', 'INSP', 'Inspection', 'Task', 7, 15, true, false, true, 'Inspection and pack for storage', false, false, 'email_office', 'Through Task'),
  (p_tenant_id, 'S', 'INSP', 'Inspection', 'Task', 7, 25, true, false, true, 'Inspection and pack for storage', false, false, 'none', 'Through Task'),
  (p_tenant_id, 'M', 'INSP', 'Inspection', 'Task', 9, 35, true, false, true, 'Inspection and pack for storage', false, false, 'none', 'Through Task'),
  (p_tenant_id, 'L', 'INSP', 'Inspection', 'Task', 10, 55, true, false, true, 'Inspection and pack for storage', false, false, 'none', 'Through Task'),
  (p_tenant_id, 'XL', 'INSP', 'Inspection', 'Task', 14, 65, true, false, true, 'Inspection and pack for storage', false, false, 'none', 'Through Task'),
  (p_tenant_id, 'XXL', 'INSP', 'Inspection', 'Task', 20, 75, true, false, true, 'Inspection and pack for storage', false, false, 'none', 'Through Task'),

  -- Will Call (by class) - Through Task
  (p_tenant_id, 'XS', 'Will_Call', 'Will Call', 'Task', 5, 10, true, false, true, 'Will Call / Outbound Shipment', false, false, 'none', 'Through Task'),
  (p_tenant_id, 'S', 'Will_Call', 'Will Call', 'Task', 5, 10, true, false, true, 'Will Call / Outbound Shipment', false, false, 'none', 'Through Task'),
  (p_tenant_id, 'M', 'Will_Call', 'Will Call', 'Task', 5, 15, true, false, true, 'Will Call / Outbound Shipment', false, false, 'none', 'Through Task'),
  (p_tenant_id, 'L', 'Will_Call', 'Will Call', 'Task', 5, 15, true, false, true, 'Will Call / Outbound Shipment', false, false, 'none', 'Through Task'),
  (p_tenant_id, 'XL', 'Will_Call', 'Will Call', 'Task', 7, 20, true, false, true, 'Will Call / Outbound Shipment', false, false, 'none', 'Through Task'),
  (p_tenant_id, 'XXL', 'Will_Call', 'Will Call', 'Task', 9, 25, true, false, true, 'Will Call / Outbound Shipment', false, false, 'none', 'Through Task');

END;
$$;

-- Seed service events for all existing tenants that don't have any
DO $$
DECLARE
  tenant_record RECORD;
BEGIN
  FOR tenant_record IN
    SELECT DISTINCT t.id as tenant_id
    FROM public.tenants t
    WHERE NOT EXISTS (
      SELECT 1 FROM public.service_events se WHERE se.tenant_id = t.id
    )
  LOOP
    PERFORM public.seed_service_events(tenant_record.tenant_id);
    RAISE NOTICE 'Seeded service events for tenant %', tenant_record.tenant_id;
  END LOOP;
END;
$$;
