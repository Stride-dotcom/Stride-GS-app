-- =====================================================
-- Seed 17 Communication Alerts with 34 Templates (Email + SMS)
-- Uses Cowboy-inspired minimalist design for email templates
-- =====================================================

-- Helper function to get all tenants for seeding
DO $$
DECLARE
  tenant_rec RECORD;
  alert_rec RECORD;
  email_template_html TEXT;
  sms_template TEXT;
BEGIN
  -- Loop through all tenants
  FOR tenant_rec IN SELECT id FROM tenants LOOP
    
    -- =====================================================
    -- 1. SHIPMENT_RECEIVED
    -- =====================================================
    INSERT INTO communication_alerts (tenant_id, key, name, description, trigger_event, is_enabled, channels, timing_rule)
    SELECT tenant_rec.id, 'SHIPMENT_RECEIVED', 'Shipment Received', 'Sent when a shipment arrives at facility', 'shipment.received', true, '{"email": true, "sms": true}'::jsonb, 'immediate'
    WHERE NOT EXISTS (SELECT 1 FROM communication_alerts WHERE key = 'SHIPMENT_RECEIVED' AND tenant_id = tenant_rec.id);
    
    SELECT id INTO alert_rec FROM communication_alerts WHERE key = 'SHIPMENT_RECEIVED' AND tenant_id = tenant_rec.id;
    
    IF alert_rec.id IS NOT NULL THEN
      -- Email template
      INSERT INTO communication_templates (tenant_id, alert_id, channel, subject_template, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'email', 'Your shipment has arrived',
'<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:48px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;">
<tr><td style="padding:48px 48px 32px;text-align:center;">
<img src="{{brand_logo_url}}" alt="{{tenant_name}}" style="max-height:40px;">
</td></tr>
<tr><td style="padding:0 48px 24px;text-align:center;">
<h1 style="margin:0;font-family:Georgia,serif;font-size:36px;font-weight:400;color:#111827;line-height:1.2;">Your shipment<br>has arrived</h1>
</td></tr>
<tr><td style="padding:0 48px 32px;text-align:center;">
<p style="margin:0;font-size:16px;color:#374151;line-height:1.6;">Shipment <strong>{{shipment_number}}</strong> was received at our facility on {{shipment_received_date}}.</p>
</td></tr>
<tr><td style="padding:0 48px 32px;">
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;">
<tr>
<td style="padding:20px;border-bottom:1px solid #e5e7eb;"><span style="font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Items Received</span><br><span style="font-size:24px;font-weight:600;color:#111827;">{{items_count}}</span></td>
<td style="padding:20px;border-bottom:1px solid #e5e7eb;border-left:1px solid #e5e7eb;"><span style="font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Account</span><br><span style="font-size:16px;color:#111827;">{{account_name}}</span></td>
</tr>
</table>
</td></tr>
<tr><td style="padding:0 48px 48px;text-align:center;">
<a href="{{shipment_link}}" style="display:inline-block;padding:16px 32px;background-color:#111827;color:#ffffff;text-decoration:none;font-size:16px;font-weight:500;">View Shipment Details</a>
</td></tr>
<tr><td style="padding:0 48px;"><div style="border-top:1px solid #e5e7eb;"></div></td></tr>
<tr><td style="padding:32px 48px;text-align:center;">
<p style="margin:0 0 8px;font-size:13px;color:#6b7280;">{{tenant_name}}</p>
<p style="margin:0;font-size:13px;color:#9ca3af;"><a href="{{unsubscribe_link}}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a></p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>', 'html'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'email');
      
      -- SMS template
      INSERT INTO communication_templates (tenant_id, alert_id, channel, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'sms', '{{tenant_name}}: Shipment {{shipment_number}} received with {{items_count}} items. View: {{shipment_link}}', 'text'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'sms');
    END IF;

    -- =====================================================
    -- 2. SHIPMENT_STATUS_CHANGED
    -- =====================================================
    INSERT INTO communication_alerts (tenant_id, key, name, description, trigger_event, is_enabled, channels, timing_rule)
    SELECT tenant_rec.id, 'SHIPMENT_STATUS_CHANGED', 'Shipment Status Update', 'Sent when shipment status changes', 'shipment.status_changed', true, '{"email": true, "sms": true}'::jsonb, 'immediate'
    WHERE NOT EXISTS (SELECT 1 FROM communication_alerts WHERE key = 'SHIPMENT_STATUS_CHANGED' AND tenant_id = tenant_rec.id);
    
    SELECT id INTO alert_rec FROM communication_alerts WHERE key = 'SHIPMENT_STATUS_CHANGED' AND tenant_id = tenant_rec.id;
    
    IF alert_rec.id IS NOT NULL THEN
      INSERT INTO communication_templates (tenant_id, alert_id, channel, subject_template, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'email', 'Shipment update: {{shipment_number}}',
'<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:48px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;">
<tr><td style="padding:48px 48px 32px;text-align:center;"><img src="{{brand_logo_url}}" alt="{{tenant_name}}" style="max-height:40px;"></td></tr>
<tr><td style="padding:0 48px 24px;text-align:center;">
<h1 style="margin:0;font-family:Georgia,serif;font-size:36px;font-weight:400;color:#111827;line-height:1.2;">Shipment update</h1>
</td></tr>
<tr><td style="padding:0 48px 32px;text-align:center;">
<p style="margin:0;font-size:16px;color:#374151;line-height:1.6;">Shipment <strong>{{shipment_number}}</strong> status has been updated to <strong>{{shipment_status}}</strong>.</p>
</td></tr>
<tr><td style="padding:0 48px 48px;text-align:center;">
<a href="{{shipment_link}}" style="display:inline-block;padding:16px 32px;background-color:#111827;color:#ffffff;text-decoration:none;font-size:16px;font-weight:500;">Track Shipment</a>
</td></tr>
<tr><td style="padding:0 48px;"><div style="border-top:1px solid #e5e7eb;"></div></td></tr>
<tr><td style="padding:32px 48px;text-align:center;"><p style="margin:0 0 8px;font-size:13px;color:#6b7280;">{{tenant_name}}</p><p style="margin:0;font-size:13px;color:#9ca3af;"><a href="{{unsubscribe_link}}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a></p></td></tr>
</table>
</td></tr>
</table>
</body></html>', 'html'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'email');
      
      INSERT INTO communication_templates (tenant_id, alert_id, channel, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'sms', '{{tenant_name}}: Shipment {{shipment_number}} is now {{shipment_status}}. Track: {{shipment_link}}', 'text'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'sms');
    END IF;

    -- =====================================================
    -- 3. SHIPMENT_COMPLETED
    -- =====================================================
    INSERT INTO communication_alerts (tenant_id, key, name, description, trigger_event, is_enabled, channels, timing_rule)
    SELECT tenant_rec.id, 'SHIPMENT_COMPLETED', 'Shipment Completed', 'Sent when shipment is fully processed', 'shipment.completed', true, '{"email": true, "sms": true}'::jsonb, 'immediate'
    WHERE NOT EXISTS (SELECT 1 FROM communication_alerts WHERE key = 'SHIPMENT_COMPLETED' AND tenant_id = tenant_rec.id);
    
    SELECT id INTO alert_rec FROM communication_alerts WHERE key = 'SHIPMENT_COMPLETED' AND tenant_id = tenant_rec.id;
    
    IF alert_rec.id IS NOT NULL THEN
      INSERT INTO communication_templates (tenant_id, alert_id, channel, subject_template, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'email', 'Shipment complete: {{shipment_number}}',
'<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:48px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;">
<tr><td style="padding:48px 48px 32px;text-align:center;"><img src="{{brand_logo_url}}" alt="{{tenant_name}}" style="max-height:40px;"></td></tr>
<tr><td style="padding:0 48px 24px;text-align:center;">
<h1 style="margin:0;font-family:Georgia,serif;font-size:36px;font-weight:400;color:#111827;line-height:1.2;">Shipment<br>complete</h1>
</td></tr>
<tr><td style="padding:0 48px 32px;text-align:center;">
<p style="margin:0;font-size:16px;color:#374151;line-height:1.6;">All items from shipment <strong>{{shipment_number}}</strong> have been processed and are now in storage.</p>
</td></tr>
<tr><td style="padding:0 48px 48px;text-align:center;">
<a href="{{shipment_link}}" style="display:inline-block;padding:16px 32px;background-color:#111827;color:#ffffff;text-decoration:none;font-size:16px;font-weight:500;">View Summary</a>
</td></tr>
<tr><td style="padding:0 48px;"><div style="border-top:1px solid #e5e7eb;"></div></td></tr>
<tr><td style="padding:32px 48px;text-align:center;"><p style="margin:0 0 8px;font-size:13px;color:#6b7280;">{{tenant_name}}</p><p style="margin:0;font-size:13px;color:#9ca3af;"><a href="{{unsubscribe_link}}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a></p></td></tr>
</table>
</td></tr>
</table>
</body></html>', 'html'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'email');
      
      INSERT INTO communication_templates (tenant_id, alert_id, channel, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'sms', '{{tenant_name}}: Shipment {{shipment_number}} complete. All items processed.', 'text'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'sms');
    END IF;

    -- =====================================================
    -- 4. ITEM_RECEIVED
    -- =====================================================
    INSERT INTO communication_alerts (tenant_id, key, name, description, trigger_event, is_enabled, channels, timing_rule)
    SELECT tenant_rec.id, 'ITEM_RECEIVED', 'Item Received', 'Sent when individual item is received', 'item.received', true, '{"email": true, "sms": false}'::jsonb, 'immediate'
    WHERE NOT EXISTS (SELECT 1 FROM communication_alerts WHERE key = 'ITEM_RECEIVED' AND tenant_id = tenant_rec.id);
    
    SELECT id INTO alert_rec FROM communication_alerts WHERE key = 'ITEM_RECEIVED' AND tenant_id = tenant_rec.id;
    
    IF alert_rec.id IS NOT NULL THEN
      INSERT INTO communication_templates (tenant_id, alert_id, channel, subject_template, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'email', 'Item received: {{item_code}}',
'<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:48px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;">
<tr><td style="padding:48px 48px 32px;text-align:center;"><img src="{{brand_logo_url}}" alt="{{tenant_name}}" style="max-height:40px;"></td></tr>
<tr><td style="padding:0 48px 24px;text-align:center;">
<h1 style="margin:0;font-family:Georgia,serif;font-size:36px;font-weight:400;color:#111827;line-height:1.2;">Item received</h1>
</td></tr>
<tr><td style="padding:0 48px 32px;text-align:center;">
<p style="margin:0;font-size:16px;color:#374151;line-height:1.6;">Item <strong>{{item_code}}</strong> has been received and stored at <strong>{{item_location}}</strong>.</p>
</td></tr>
<tr><td style="padding:0 48px 48px;text-align:center;">
<a href="{{item_link}}" style="display:inline-block;padding:16px 32px;background-color:#111827;color:#ffffff;text-decoration:none;font-size:16px;font-weight:500;">View Item</a>
</td></tr>
<tr><td style="padding:0 48px;"><div style="border-top:1px solid #e5e7eb;"></div></td></tr>
<tr><td style="padding:32px 48px;text-align:center;"><p style="margin:0 0 8px;font-size:13px;color:#6b7280;">{{tenant_name}}</p><p style="margin:0;font-size:13px;color:#9ca3af;"><a href="{{unsubscribe_link}}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a></p></td></tr>
</table>
</td></tr>
</table>
</body></html>', 'html'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'email');
      
      INSERT INTO communication_templates (tenant_id, alert_id, channel, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'sms', '{{tenant_name}}: Item {{item_code}} received at {{item_location}}.', 'text'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'sms');
    END IF;

    -- =====================================================
    -- 5. ITEM_DAMAGED
    -- =====================================================
    INSERT INTO communication_alerts (tenant_id, key, name, description, trigger_event, is_enabled, channels, timing_rule)
    SELECT tenant_rec.id, 'ITEM_DAMAGED', 'Item Damaged', 'Sent when damage is reported on an item', 'item.damaged', true, '{"email": true, "sms": true}'::jsonb, 'immediate'
    WHERE NOT EXISTS (SELECT 1 FROM communication_alerts WHERE key = 'ITEM_DAMAGED' AND tenant_id = tenant_rec.id);
    
    SELECT id INTO alert_rec FROM communication_alerts WHERE key = 'ITEM_DAMAGED' AND tenant_id = tenant_rec.id;
    
    IF alert_rec.id IS NOT NULL THEN
      INSERT INTO communication_templates (tenant_id, alert_id, channel, subject_template, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'email', 'Damage reported: {{item_code}}',
'<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:48px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;">
<tr><td style="padding:48px 48px 32px;text-align:center;"><img src="{{brand_logo_url}}" alt="{{tenant_name}}" style="max-height:40px;"></td></tr>
<tr><td style="padding:0 48px 24px;text-align:center;">
<h1 style="margin:0;font-family:Georgia,serif;font-size:36px;font-weight:400;color:#111827;line-height:1.2;">Damage<br>reported</h1>
</td></tr>
<tr><td style="padding:0 48px 32px;text-align:center;">
<p style="margin:0;font-size:16px;color:#374151;line-height:1.6;">Damage has been reported on item <strong>{{item_code}}</strong>.</p>
<p style="margin:16px 0 0;font-size:14px;color:#6b7280;">{{damage_notes}}</p>
</td></tr>
<tr><td style="padding:0 48px 48px;text-align:center;">
<a href="{{item_link}}" style="display:inline-block;padding:16px 32px;background-color:#111827;color:#ffffff;text-decoration:none;font-size:16px;font-weight:500;">View Damage Report</a>
</td></tr>
<tr><td style="padding:0 48px;"><div style="border-top:1px solid #e5e7eb;"></div></td></tr>
<tr><td style="padding:32px 48px;text-align:center;"><p style="margin:0 0 8px;font-size:13px;color:#6b7280;">{{tenant_name}}</p><p style="margin:0;font-size:13px;color:#9ca3af;"><a href="{{unsubscribe_link}}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a></p></td></tr>
</table>
</td></tr>
</table>
</body></html>', 'html'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'email');
      
      INSERT INTO communication_templates (tenant_id, alert_id, channel, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'sms', '{{tenant_name}}: Damage reported on {{item_code}}. View: {{item_link}}', 'text'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'sms');
    END IF;

    -- =====================================================
    -- 6. ITEM_LOCATION_CHANGED
    -- =====================================================
    INSERT INTO communication_alerts (tenant_id, key, name, description, trigger_event, is_enabled, channels, timing_rule)
    SELECT tenant_rec.id, 'ITEM_LOCATION_CHANGED', 'Item Location Changed', 'Sent when item is moved to new location', 'item.location_changed', true, '{"email": true, "sms": false}'::jsonb, 'immediate'
    WHERE NOT EXISTS (SELECT 1 FROM communication_alerts WHERE key = 'ITEM_LOCATION_CHANGED' AND tenant_id = tenant_rec.id);
    
    SELECT id INTO alert_rec FROM communication_alerts WHERE key = 'ITEM_LOCATION_CHANGED' AND tenant_id = tenant_rec.id;
    
    IF alert_rec.id IS NOT NULL THEN
      INSERT INTO communication_templates (tenant_id, alert_id, channel, subject_template, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'email', 'Item moved: {{item_code}}',
'<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:48px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;">
<tr><td style="padding:48px 48px 32px;text-align:center;"><img src="{{brand_logo_url}}" alt="{{tenant_name}}" style="max-height:40px;"></td></tr>
<tr><td style="padding:0 48px 24px;text-align:center;">
<h1 style="margin:0;font-family:Georgia,serif;font-size:36px;font-weight:400;color:#111827;line-height:1.2;">Item moved</h1>
</td></tr>
<tr><td style="padding:0 48px 32px;text-align:center;">
<p style="margin:0;font-size:16px;color:#374151;line-height:1.6;">Item <strong>{{item_code}}</strong> has been moved to <strong>{{item_location}}</strong>.</p>
</td></tr>
<tr><td style="padding:0 48px 48px;text-align:center;">
<a href="{{item_link}}" style="display:inline-block;padding:16px 32px;background-color:#111827;color:#ffffff;text-decoration:none;font-size:16px;font-weight:500;">View Item</a>
</td></tr>
<tr><td style="padding:0 48px;"><div style="border-top:1px solid #e5e7eb;"></div></td></tr>
<tr><td style="padding:32px 48px;text-align:center;"><p style="margin:0 0 8px;font-size:13px;color:#6b7280;">{{tenant_name}}</p><p style="margin:0;font-size:13px;color:#9ca3af;"><a href="{{unsubscribe_link}}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a></p></td></tr>
</table>
</td></tr>
</table>
</body></html>', 'html'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'email');
      
      INSERT INTO communication_templates (tenant_id, alert_id, channel, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'sms', '{{tenant_name}}: Item {{item_code}} moved to {{item_location}}.', 'text'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'sms');
    END IF;

    -- =====================================================
    -- 7. TASK_CREATED
    -- =====================================================
    INSERT INTO communication_alerts (tenant_id, key, name, description, trigger_event, is_enabled, channels, timing_rule)
    SELECT tenant_rec.id, 'TASK_CREATED', 'Task Created', 'Sent when a new task is created', 'task.created', true, '{"email": true, "sms": false}'::jsonb, 'immediate'
    WHERE NOT EXISTS (SELECT 1 FROM communication_alerts WHERE key = 'TASK_CREATED' AND tenant_id = tenant_rec.id);
    
    SELECT id INTO alert_rec FROM communication_alerts WHERE key = 'TASK_CREATED' AND tenant_id = tenant_rec.id;
    
    IF alert_rec.id IS NOT NULL THEN
      INSERT INTO communication_templates (tenant_id, alert_id, channel, subject_template, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'email', 'New task: {{task_title}}',
'<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:48px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;">
<tr><td style="padding:48px 48px 32px;text-align:center;"><img src="{{brand_logo_url}}" alt="{{tenant_name}}" style="max-height:40px;"></td></tr>
<tr><td style="padding:0 48px 24px;text-align:center;">
<h1 style="margin:0;font-family:Georgia,serif;font-size:36px;font-weight:400;color:#111827;line-height:1.2;">New task</h1>
</td></tr>
<tr><td style="padding:0 48px 32px;text-align:center;">
<p style="margin:0;font-size:16px;color:#374151;line-height:1.6;">A new task has been created: <strong>{{task_title}}</strong></p>
<p style="margin:16px 0 0;font-size:14px;color:#6b7280;">Due: {{task_due_date}}</p>
</td></tr>
<tr><td style="padding:0 48px 48px;text-align:center;">
<a href="{{task_link}}" style="display:inline-block;padding:16px 32px;background-color:#111827;color:#ffffff;text-decoration:none;font-size:16px;font-weight:500;">View Task</a>
</td></tr>
<tr><td style="padding:0 48px;"><div style="border-top:1px solid #e5e7eb;"></div></td></tr>
<tr><td style="padding:32px 48px;text-align:center;"><p style="margin:0 0 8px;font-size:13px;color:#6b7280;">{{tenant_name}}</p><p style="margin:0;font-size:13px;color:#9ca3af;"><a href="{{unsubscribe_link}}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a></p></td></tr>
</table>
</td></tr>
</table>
</body></html>', 'html'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'email');
      
      INSERT INTO communication_templates (tenant_id, alert_id, channel, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'sms', '{{tenant_name}}: New task "{{task_title}}" due {{task_due_date}}. View: {{task_link}}', 'text'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'sms');
    END IF;

    -- =====================================================
    -- 8. TASK_ASSIGNED
    -- =====================================================
    INSERT INTO communication_alerts (tenant_id, key, name, description, trigger_event, is_enabled, channels, timing_rule)
    SELECT tenant_rec.id, 'TASK_ASSIGNED', 'Task Assigned', 'Sent when task is assigned to user', 'task.assigned', true, '{"email": true, "sms": true}'::jsonb, 'immediate'
    WHERE NOT EXISTS (SELECT 1 FROM communication_alerts WHERE key = 'TASK_ASSIGNED' AND tenant_id = tenant_rec.id);
    
    SELECT id INTO alert_rec FROM communication_alerts WHERE key = 'TASK_ASSIGNED' AND tenant_id = tenant_rec.id;
    
    IF alert_rec.id IS NOT NULL THEN
      INSERT INTO communication_templates (tenant_id, alert_id, channel, subject_template, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'email', 'Task assigned to you: {{task_title}}',
'<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:48px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;">
<tr><td style="padding:48px 48px 32px;text-align:center;"><img src="{{brand_logo_url}}" alt="{{tenant_name}}" style="max-height:40px;"></td></tr>
<tr><td style="padding:0 48px 24px;text-align:center;">
<h1 style="margin:0;font-family:Georgia,serif;font-size:36px;font-weight:400;color:#111827;line-height:1.2;">Task assigned<br>to you</h1>
</td></tr>
<tr><td style="padding:0 48px 32px;text-align:center;">
<p style="margin:0;font-size:16px;color:#374151;line-height:1.6;"><strong>{{task_title}}</strong></p>
<p style="margin:16px 0 0;font-size:14px;color:#6b7280;">Due: {{task_due_date}}</p>
</td></tr>
<tr><td style="padding:0 48px 48px;text-align:center;">
<a href="{{task_link}}" style="display:inline-block;padding:16px 32px;background-color:#111827;color:#ffffff;text-decoration:none;font-size:16px;font-weight:500;">View Task</a>
</td></tr>
<tr><td style="padding:0 48px;"><div style="border-top:1px solid #e5e7eb;"></div></td></tr>
<tr><td style="padding:32px 48px;text-align:center;"><p style="margin:0 0 8px;font-size:13px;color:#6b7280;">{{tenant_name}}</p><p style="margin:0;font-size:13px;color:#9ca3af;"><a href="{{unsubscribe_link}}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a></p></td></tr>
</table>
</td></tr>
</table>
</body></html>', 'html'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'email');
      
      INSERT INTO communication_templates (tenant_id, alert_id, channel, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'sms', '{{tenant_name}}: Task "{{task_title}}" assigned to you. Due {{task_due_date}}. View: {{task_link}}', 'text'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'sms');
    END IF;

    -- =====================================================
    -- 9. TASK_COMPLETED
    -- =====================================================
    INSERT INTO communication_alerts (tenant_id, key, name, description, trigger_event, is_enabled, channels, timing_rule)
    SELECT tenant_rec.id, 'TASK_COMPLETED', 'Task Completed', 'Sent when task is marked complete', 'task.completed', true, '{"email": true, "sms": false}'::jsonb, 'immediate'
    WHERE NOT EXISTS (SELECT 1 FROM communication_alerts WHERE key = 'TASK_COMPLETED' AND tenant_id = tenant_rec.id);
    
    SELECT id INTO alert_rec FROM communication_alerts WHERE key = 'TASK_COMPLETED' AND tenant_id = tenant_rec.id;
    
    IF alert_rec.id IS NOT NULL THEN
      INSERT INTO communication_templates (tenant_id, alert_id, channel, subject_template, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'email', 'Task complete: {{task_title}}',
'<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:48px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;">
<tr><td style="padding:48px 48px 32px;text-align:center;"><img src="{{brand_logo_url}}" alt="{{tenant_name}}" style="max-height:40px;"></td></tr>
<tr><td style="padding:0 48px 24px;text-align:center;">
<h1 style="margin:0;font-family:Georgia,serif;font-size:36px;font-weight:400;color:#111827;line-height:1.2;">Task complete</h1>
</td></tr>
<tr><td style="padding:0 48px 32px;text-align:center;">
<p style="margin:0;font-size:16px;color:#374151;line-height:1.6;">Task <strong>{{task_title}}</strong> has been completed.</p>
<p style="margin:16px 0 0;font-size:14px;color:#6b7280;">Completed by: {{task_completed_by}}</p>
</td></tr>
<tr><td style="padding:0 48px 48px;text-align:center;">
<a href="{{task_link}}" style="display:inline-block;padding:16px 32px;background-color:#111827;color:#ffffff;text-decoration:none;font-size:16px;font-weight:500;">View Details</a>
</td></tr>
<tr><td style="padding:0 48px;"><div style="border-top:1px solid #e5e7eb;"></div></td></tr>
<tr><td style="padding:32px 48px;text-align:center;"><p style="margin:0 0 8px;font-size:13px;color:#6b7280;">{{tenant_name}}</p><p style="margin:0;font-size:13px;color:#9ca3af;"><a href="{{unsubscribe_link}}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a></p></td></tr>
</table>
</td></tr>
</table>
</body></html>', 'html'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'email');
      
      INSERT INTO communication_templates (tenant_id, alert_id, channel, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'sms', '{{tenant_name}}: Task "{{task_title}}" completed.', 'text'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'sms');
    END IF;

    -- =====================================================
    -- 10. TASK_OVERDUE
    -- =====================================================
    INSERT INTO communication_alerts (tenant_id, key, name, description, trigger_event, is_enabled, channels, timing_rule)
    SELECT tenant_rec.id, 'TASK_OVERDUE', 'Task Overdue', 'Sent when task passes due date', 'task.overdue', true, '{"email": true, "sms": true}'::jsonb, 'immediate'
    WHERE NOT EXISTS (SELECT 1 FROM communication_alerts WHERE key = 'TASK_OVERDUE' AND tenant_id = tenant_rec.id);
    
    SELECT id INTO alert_rec FROM communication_alerts WHERE key = 'TASK_OVERDUE' AND tenant_id = tenant_rec.id;
    
    IF alert_rec.id IS NOT NULL THEN
      INSERT INTO communication_templates (tenant_id, alert_id, channel, subject_template, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'email', 'Task overdue: {{task_title}}',
'<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:48px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;">
<tr><td style="padding:48px 48px 32px;text-align:center;"><img src="{{brand_logo_url}}" alt="{{tenant_name}}" style="max-height:40px;"></td></tr>
<tr><td style="padding:0 48px 24px;text-align:center;">
<h1 style="margin:0;font-family:Georgia,serif;font-size:36px;font-weight:400;color:#111827;line-height:1.2;">Task overdue</h1>
</td></tr>
<tr><td style="padding:0 48px 24px;text-align:center;">
<p style="margin:0;font-size:16px;color:#374151;line-height:1.6;">A task requires your immediate attention.</p>
</td></tr>
<tr><td style="padding:0 48px 32px;">
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;">
<tr><td style="padding:20px;text-align:center;"><span style="font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Overdue By</span><br><span style="font-size:24px;font-weight:600;color:#dc2626;">{{task_days_overdue}} days</span></td></tr>
</table>
</td></tr>
<tr><td style="padding:0 48px 32px;text-align:center;">
<p style="margin:0;font-size:16px;color:#374151;"><strong>{{task_title}}</strong></p>
<p style="margin:8px 0 0;font-size:14px;color:#6b7280;">Due: {{task_due_date}}</p>
</td></tr>
<tr><td style="padding:0 48px 48px;text-align:center;">
<a href="{{task_link}}" style="display:inline-block;padding:16px 32px;background-color:#dc2626;color:#ffffff;text-decoration:none;font-size:16px;font-weight:500;">Complete Now</a>
</td></tr>
<tr><td style="padding:0 48px;"><div style="border-top:1px solid #e5e7eb;"></div></td></tr>
<tr><td style="padding:32px 48px;text-align:center;"><p style="margin:0 0 8px;font-size:13px;color:#6b7280;">{{tenant_name}}</p><p style="margin:0;font-size:13px;color:#9ca3af;"><a href="{{unsubscribe_link}}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a></p></td></tr>
</table>
</td></tr>
</table>
</body></html>', 'html'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'email');
      
      INSERT INTO communication_templates (tenant_id, alert_id, channel, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'sms', 'URGENT {{tenant_name}}: Task "{{task_title}}" is {{task_days_overdue}} days overdue. Complete now: {{task_link}}', 'text'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'sms');
    END IF;

    -- =====================================================
    -- 11. RELEASE_CREATED
    -- =====================================================
    INSERT INTO communication_alerts (tenant_id, key, name, description, trigger_event, is_enabled, channels, timing_rule)
    SELECT tenant_rec.id, 'RELEASE_CREATED', 'Release Created', 'Sent when release order is created', 'release.created', true, '{"email": true, "sms": false}'::jsonb, 'immediate'
    WHERE NOT EXISTS (SELECT 1 FROM communication_alerts WHERE key = 'RELEASE_CREATED' AND tenant_id = tenant_rec.id);
    
    SELECT id INTO alert_rec FROM communication_alerts WHERE key = 'RELEASE_CREATED' AND tenant_id = tenant_rec.id;
    
    IF alert_rec.id IS NOT NULL THEN
      INSERT INTO communication_templates (tenant_id, alert_id, channel, subject_template, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'email', 'Release order created: {{release_number}}',
'<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:48px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;">
<tr><td style="padding:48px 48px 32px;text-align:center;"><img src="{{brand_logo_url}}" alt="{{tenant_name}}" style="max-height:40px;"></td></tr>
<tr><td style="padding:0 48px 24px;text-align:center;">
<h1 style="margin:0;font-family:Georgia,serif;font-size:36px;font-weight:400;color:#111827;line-height:1.2;">Release order<br>created</h1>
</td></tr>
<tr><td style="padding:0 48px 32px;text-align:center;">
<p style="margin:0;font-size:16px;color:#374151;line-height:1.6;">Release order <strong>{{release_number}}</strong> has been created with {{release_items_count}} items.</p>
</td></tr>
<tr><td style="padding:0 48px 48px;text-align:center;">
<a href="{{release_link}}" style="display:inline-block;padding:16px 32px;background-color:#111827;color:#ffffff;text-decoration:none;font-size:16px;font-weight:500;">View Release</a>
</td></tr>
<tr><td style="padding:0 48px;"><div style="border-top:1px solid #e5e7eb;"></div></td></tr>
<tr><td style="padding:32px 48px;text-align:center;"><p style="margin:0 0 8px;font-size:13px;color:#6b7280;">{{tenant_name}}</p><p style="margin:0;font-size:13px;color:#9ca3af;"><a href="{{unsubscribe_link}}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a></p></td></tr>
</table>
</td></tr>
</table>
</body></html>', 'html'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'email');
      
      INSERT INTO communication_templates (tenant_id, alert_id, channel, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'sms', '{{tenant_name}}: Release {{release_number}} created with {{release_items_count}} items. View: {{release_link}}', 'text'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'sms');
    END IF;

    -- =====================================================
    -- 12. RELEASE_APPROVED
    -- =====================================================
    INSERT INTO communication_alerts (tenant_id, key, name, description, trigger_event, is_enabled, channels, timing_rule)
    SELECT tenant_rec.id, 'RELEASE_APPROVED', 'Release Approved', 'Sent when release is approved', 'release.approved', true, '{"email": true, "sms": true}'::jsonb, 'immediate'
    WHERE NOT EXISTS (SELECT 1 FROM communication_alerts WHERE key = 'RELEASE_APPROVED' AND tenant_id = tenant_rec.id);
    
    SELECT id INTO alert_rec FROM communication_alerts WHERE key = 'RELEASE_APPROVED' AND tenant_id = tenant_rec.id;
    
    IF alert_rec.id IS NOT NULL THEN
      INSERT INTO communication_templates (tenant_id, alert_id, channel, subject_template, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'email', 'Release approved: {{release_number}}',
'<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:48px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;">
<tr><td style="padding:48px 48px 32px;text-align:center;"><img src="{{brand_logo_url}}" alt="{{tenant_name}}" style="max-height:40px;"></td></tr>
<tr><td style="padding:0 48px 24px;text-align:center;">
<h1 style="margin:0;font-family:Georgia,serif;font-size:36px;font-weight:400;color:#111827;line-height:1.2;">Release<br>approved</h1>
</td></tr>
<tr><td style="padding:0 48px 32px;text-align:center;">
<p style="margin:0;font-size:16px;color:#374151;line-height:1.6;">Release order <strong>{{release_number}}</strong> has been approved and is ready for processing.</p>
</td></tr>
<tr><td style="padding:0 48px 48px;text-align:center;">
<a href="{{release_link}}" style="display:inline-block;padding:16px 32px;background-color:#111827;color:#ffffff;text-decoration:none;font-size:16px;font-weight:500;">View Release</a>
</td></tr>
<tr><td style="padding:0 48px;"><div style="border-top:1px solid #e5e7eb;"></div></td></tr>
<tr><td style="padding:32px 48px;text-align:center;"><p style="margin:0 0 8px;font-size:13px;color:#6b7280;">{{tenant_name}}</p><p style="margin:0;font-size:13px;color:#9ca3af;"><a href="{{unsubscribe_link}}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a></p></td></tr>
</table>
</td></tr>
</table>
</body></html>', 'html'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'email');
      
      INSERT INTO communication_templates (tenant_id, alert_id, channel, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'sms', '{{tenant_name}}: Release {{release_number}} approved. View: {{release_link}}', 'text'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'sms');
    END IF;

    -- =====================================================
    -- 13. RELEASE_COMPLETED
    -- =====================================================
    INSERT INTO communication_alerts (tenant_id, key, name, description, trigger_event, is_enabled, channels, timing_rule)
    SELECT tenant_rec.id, 'RELEASE_COMPLETED', 'Release Completed', 'Sent when release is completed', 'release.completed', true, '{"email": true, "sms": false}'::jsonb, 'immediate'
    WHERE NOT EXISTS (SELECT 1 FROM communication_alerts WHERE key = 'RELEASE_COMPLETED' AND tenant_id = tenant_rec.id);
    
    SELECT id INTO alert_rec FROM communication_alerts WHERE key = 'RELEASE_COMPLETED' AND tenant_id = tenant_rec.id;
    
    IF alert_rec.id IS NOT NULL THEN
      INSERT INTO communication_templates (tenant_id, alert_id, channel, subject_template, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'email', 'Release complete: {{release_number}}',
'<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:48px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;">
<tr><td style="padding:48px 48px 32px;text-align:center;"><img src="{{brand_logo_url}}" alt="{{tenant_name}}" style="max-height:40px;"></td></tr>
<tr><td style="padding:0 48px 24px;text-align:center;">
<h1 style="margin:0;font-family:Georgia,serif;font-size:36px;font-weight:400;color:#111827;line-height:1.2;">Release<br>complete</h1>
</td></tr>
<tr><td style="padding:0 48px 32px;text-align:center;">
<p style="margin:0;font-size:16px;color:#374151;line-height:1.6;">Release order <strong>{{release_number}}</strong> has been completed. All items have been picked and shipped.</p>
</td></tr>
<tr><td style="padding:0 48px 48px;text-align:center;">
<a href="{{release_link}}" style="display:inline-block;padding:16px 32px;background-color:#111827;color:#ffffff;text-decoration:none;font-size:16px;font-weight:500;">View Summary</a>
</td></tr>
<tr><td style="padding:0 48px;"><div style="border-top:1px solid #e5e7eb;"></div></td></tr>
<tr><td style="padding:32px 48px;text-align:center;"><p style="margin:0 0 8px;font-size:13px;color:#6b7280;">{{tenant_name}}</p><p style="margin:0;font-size:13px;color:#9ca3af;"><a href="{{unsubscribe_link}}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a></p></td></tr>
</table>
</td></tr>
</table>
</body></html>', 'html'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'email');
      
      INSERT INTO communication_templates (tenant_id, alert_id, channel, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'sms', '{{tenant_name}}: Release {{release_number}} complete. All items shipped.', 'text'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'sms');
    END IF;

    -- =====================================================
    -- 14. INVOICE_CREATED
    -- =====================================================
    INSERT INTO communication_alerts (tenant_id, key, name, description, trigger_event, is_enabled, channels, timing_rule)
    SELECT tenant_rec.id, 'INVOICE_CREATED', 'Invoice Created', 'Sent when invoice is generated', 'invoice.created', true, '{"email": true, "sms": true}'::jsonb, 'immediate'
    WHERE NOT EXISTS (SELECT 1 FROM communication_alerts WHERE key = 'INVOICE_CREATED' AND tenant_id = tenant_rec.id);
    
    SELECT id INTO alert_rec FROM communication_alerts WHERE key = 'INVOICE_CREATED' AND tenant_id = tenant_rec.id;
    
    IF alert_rec.id IS NOT NULL THEN
      INSERT INTO communication_templates (tenant_id, alert_id, channel, subject_template, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'email', 'Invoice ready: {{invoice_number}}',
'<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:48px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;">
<tr><td style="padding:48px 48px 32px;text-align:center;"><img src="{{brand_logo_url}}" alt="{{tenant_name}}" style="max-height:40px;"></td></tr>
<tr><td style="padding:0 48px 24px;text-align:center;">
<h1 style="margin:0;font-family:Georgia,serif;font-size:36px;font-weight:400;color:#111827;line-height:1.2;">Invoice ready</h1>
</td></tr>
<tr><td style="padding:0 48px 32px;">
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;">
<tr>
<td style="padding:20px;border-bottom:1px solid #e5e7eb;text-align:center;"><span style="font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Invoice</span><br><span style="font-size:18px;font-weight:600;color:#111827;">{{invoice_number}}</span></td>
<td style="padding:20px;border-bottom:1px solid #e5e7eb;border-left:1px solid #e5e7eb;text-align:center;"><span style="font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Amount</span><br><span style="font-size:24px;font-weight:600;color:#111827;">{{invoice_amount}}</span></td>
</tr>
</table>
</td></tr>
<tr><td style="padding:0 48px 48px;text-align:center;">
<a href="{{invoice_link}}" style="display:inline-block;padding:16px 32px;background-color:#111827;color:#ffffff;text-decoration:none;font-size:16px;font-weight:500;">View Invoice</a>
</td></tr>
<tr><td style="padding:0 48px;"><div style="border-top:1px solid #e5e7eb;"></div></td></tr>
<tr><td style="padding:32px 48px;text-align:center;"><p style="margin:0 0 8px;font-size:13px;color:#6b7280;">{{tenant_name}}</p><p style="margin:0;font-size:13px;color:#9ca3af;"><a href="{{unsubscribe_link}}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a></p></td></tr>
</table>
</td></tr>
</table>
</body></html>', 'html'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'email');
      
      INSERT INTO communication_templates (tenant_id, alert_id, channel, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'sms', '{{tenant_name}}: Invoice {{invoice_number}} ready for {{invoice_amount}}. View: {{invoice_link}}', 'text'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'sms');
    END IF;

    -- =====================================================
    -- 15. INVOICE_SENT
    -- =====================================================
    INSERT INTO communication_alerts (tenant_id, key, name, description, trigger_event, is_enabled, channels, timing_rule)
    SELECT tenant_rec.id, 'INVOICE_SENT', 'Invoice Sent', 'Sent when invoice is delivered to customer', 'invoice.sent', true, '{"email": true, "sms": true}'::jsonb, 'immediate'
    WHERE NOT EXISTS (SELECT 1 FROM communication_alerts WHERE key = 'INVOICE_SENT' AND tenant_id = tenant_rec.id);
    
    SELECT id INTO alert_rec FROM communication_alerts WHERE key = 'INVOICE_SENT' AND tenant_id = tenant_rec.id;
    
    IF alert_rec.id IS NOT NULL THEN
      INSERT INTO communication_templates (tenant_id, alert_id, channel, subject_template, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'email', 'Invoice {{invoice_number}} - Payment due {{invoice_due_date}}',
'<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:48px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;">
<tr><td style="padding:48px 48px 32px;text-align:center;"><img src="{{brand_logo_url}}" alt="{{tenant_name}}" style="max-height:40px;"></td></tr>
<tr><td style="padding:0 48px 24px;text-align:center;">
<h1 style="margin:0;font-family:Georgia,serif;font-size:36px;font-weight:400;color:#111827;line-height:1.2;">Your invoice</h1>
</td></tr>
<tr><td style="padding:0 48px 32px;">
<table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;">
<tr>
<td style="padding:20px;border-bottom:1px solid #e5e7eb;"><span style="font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Amount Due</span><br><span style="font-size:24px;font-weight:600;color:#111827;">{{invoice_amount}}</span></td>
<td style="padding:20px;border-bottom:1px solid #e5e7eb;border-left:1px solid #e5e7eb;"><span style="font-size:13px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Due Date</span><br><span style="font-size:18px;font-weight:600;color:#111827;">{{invoice_due_date}}</span></td>
</tr>
</table>
</td></tr>
<tr><td style="padding:0 48px 48px;text-align:center;">
<a href="{{invoice_link}}" style="display:inline-block;padding:16px 32px;background-color:#111827;color:#ffffff;text-decoration:none;font-size:16px;font-weight:500;">Pay Invoice</a>
</td></tr>
<tr><td style="padding:0 48px;"><div style="border-top:1px solid #e5e7eb;"></div></td></tr>
<tr><td style="padding:32px 48px;text-align:center;"><p style="margin:0 0 8px;font-size:13px;color:#6b7280;">{{tenant_name}}</p><p style="margin:0;font-size:13px;color:#9ca3af;"><a href="{{unsubscribe_link}}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a></p></td></tr>
</table>
</td></tr>
</table>
</body></html>', 'html'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'email');
      
      INSERT INTO communication_templates (tenant_id, alert_id, channel, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'sms', '{{tenant_name}}: Invoice {{invoice_number}} for {{invoice_amount}} due {{invoice_due_date}}. Pay: {{invoice_link}}', 'text'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'sms');
    END IF;

    -- =====================================================
    -- 16. PAYMENT_RECEIVED
    -- =====================================================
    INSERT INTO communication_alerts (tenant_id, key, name, description, trigger_event, is_enabled, channels, timing_rule)
    SELECT tenant_rec.id, 'PAYMENT_RECEIVED', 'Payment Received', 'Sent when payment is processed', 'payment.received', true, '{"email": true, "sms": true}'::jsonb, 'immediate'
    WHERE NOT EXISTS (SELECT 1 FROM communication_alerts WHERE key = 'PAYMENT_RECEIVED' AND tenant_id = tenant_rec.id);
    
    SELECT id INTO alert_rec FROM communication_alerts WHERE key = 'PAYMENT_RECEIVED' AND tenant_id = tenant_rec.id;
    
    IF alert_rec.id IS NOT NULL THEN
      INSERT INTO communication_templates (tenant_id, alert_id, channel, subject_template, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'email', 'Payment received - Thank you',
'<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:48px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;">
<tr><td style="padding:48px 48px 32px;text-align:center;"><img src="{{brand_logo_url}}" alt="{{tenant_name}}" style="max-height:40px;"></td></tr>
<tr><td style="padding:0 48px 24px;text-align:center;">
<h1 style="margin:0;font-family:Georgia,serif;font-size:36px;font-weight:400;color:#111827;line-height:1.2;">Payment<br>received</h1>
</td></tr>
<tr><td style="padding:0 48px 32px;text-align:center;">
<p style="margin:0;font-size:16px;color:#374151;line-height:1.6;">Thank you for your payment of <strong>{{payment_amount}}</strong>.</p>
<p style="margin:16px 0 0;font-size:14px;color:#6b7280;">Invoice: {{invoice_number}}</p>
</td></tr>
<tr><td style="padding:0 48px 48px;text-align:center;">
<a href="{{receipt_link}}" style="display:inline-block;padding:16px 32px;background-color:#111827;color:#ffffff;text-decoration:none;font-size:16px;font-weight:500;">View Receipt</a>
</td></tr>
<tr><td style="padding:0 48px;"><div style="border-top:1px solid #e5e7eb;"></div></td></tr>
<tr><td style="padding:32px 48px;text-align:center;"><p style="margin:0 0 8px;font-size:13px;color:#6b7280;">{{tenant_name}}</p><p style="margin:0;font-size:13px;color:#9ca3af;"><a href="{{unsubscribe_link}}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a></p></td></tr>
</table>
</td></tr>
</table>
</body></html>', 'html'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'email');
      
      INSERT INTO communication_templates (tenant_id, alert_id, channel, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'sms', '{{tenant_name}}: Payment of {{payment_amount}} received. Thank you!', 'text'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'sms');
    END IF;

    -- =====================================================
    -- 17. EMPLOYEE_INVITE
    -- =====================================================
    INSERT INTO communication_alerts (tenant_id, key, name, description, trigger_event, is_enabled, channels, timing_rule)
    SELECT tenant_rec.id, 'EMPLOYEE_INVITE', 'Employee Invitation', 'Sent to invite new team members', 'employee.invited', true, '{"email": true, "sms": true}'::jsonb, 'immediate'
    WHERE NOT EXISTS (SELECT 1 FROM communication_alerts WHERE key = 'EMPLOYEE_INVITE' AND tenant_id = tenant_rec.id);
    
    SELECT id INTO alert_rec FROM communication_alerts WHERE key = 'EMPLOYEE_INVITE' AND tenant_id = tenant_rec.id;
    
    IF alert_rec.id IS NOT NULL THEN
      INSERT INTO communication_templates (tenant_id, alert_id, channel, subject_template, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'email', 'You''re invited to join {{tenant_name}}',
'<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:48px 24px;">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#ffffff;">
<tr><td style="padding:48px 48px 32px;text-align:center;"><img src="{{brand_logo_url}}" alt="{{tenant_name}}" style="max-height:40px;"></td></tr>
<tr><td style="padding:0 48px 24px;text-align:center;">
<h1 style="margin:0;font-family:Georgia,serif;font-size:36px;font-weight:400;color:#111827;line-height:1.2;">You''re invited</h1>
</td></tr>
<tr><td style="padding:0 48px 32px;text-align:center;">
<p style="margin:0;font-size:16px;color:#374151;line-height:1.6;">You''ve been invited to join <strong>{{tenant_name}}</strong> as a team member.</p>
<p style="margin:16px 0 0;font-size:14px;color:#6b7280;">Invited by: {{inviter_name}}</p>
</td></tr>
<tr><td style="padding:0 48px 48px;text-align:center;">
<a href="{{invite_link}}" style="display:inline-block;padding:16px 32px;background-color:#111827;color:#ffffff;text-decoration:none;font-size:16px;font-weight:500;">Accept Invitation</a>
</td></tr>
<tr><td style="padding:0 48px;"><div style="border-top:1px solid #e5e7eb;"></div></td></tr>
<tr><td style="padding:32px 48px;text-align:center;"><p style="margin:0 0 8px;font-size:13px;color:#6b7280;">{{tenant_name}}</p><p style="margin:0;font-size:13px;color:#9ca3af;"><a href="{{unsubscribe_link}}" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a></p></td></tr>
</table>
</td></tr>
</table>
</body></html>', 'html'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'email');
      
      INSERT INTO communication_templates (tenant_id, alert_id, channel, body_template, body_format)
      SELECT tenant_rec.id, alert_rec.id, 'sms', '{{tenant_name}}: You''ve been invited to join the team. Accept: {{invite_link}}', 'text'
      WHERE NOT EXISTS (SELECT 1 FROM communication_templates WHERE alert_id = alert_rec.id AND channel = 'sms');
    END IF;

  END LOOP;
END $$;