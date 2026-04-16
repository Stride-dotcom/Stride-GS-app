-- ============================================================================
-- Split workflow alerts (grouped item partial requests)
-- ============================================================================
-- Adds three new trigger events:
--  - split.required       (internal)  When a grouped-item partial request requires warehouse split
--  - split.completed      (client)    When warehouse completes the split task
--  - split.manual_review  (internal)  When client partial requests are disabled -> pending review
--
-- This migration:
--  1) Registers triggers in communication_trigger_catalog
--  2) Ensures communication_alerts rows exist for every tenant (configurable)
--  3) Seeds v4-style email + sms templates using _v4_upsert_template()
--  4) Seeds in-app templates for role-based recipients (warehouse/manager)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Trigger catalog entries (global)
-- ----------------------------------------------------------------------------
INSERT INTO public.communication_trigger_catalog
  (key, display_name, description, module_group, audience, default_channels, severity)
VALUES
  ('split.required',      'Split Required',             'A grouped item partial request requires a warehouse split task before the job can start.', 'tasks',   'internal', ARRAY['email','in_app'], 'warn'),
  ('split.completed',     'Split Completed',            'The warehouse completed a split/relabel task (notify requester).',                         'tasks',   'client',   ARRAY['email'],          'info'),
  ('split.manual_review', 'Split Request Pending Review','Client requested partial grouped qty but automated split tasks are disabled; manual review required.', 'tasks', 'internal', ARRAY['email','in_app'], 'warn')
ON CONFLICT (key) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 2) Ensure tenant-scoped communication_alerts rows exist
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_tenant RECORD;
BEGIN
  FOR v_tenant IN (SELECT id FROM public.tenants) LOOP

    -- split.required (internal)
    INSERT INTO public.communication_alerts
      (tenant_id, name, key, description, trigger_event, channels, is_enabled, timing_rule)
    VALUES (
      v_tenant.id,
      'Split Required',
      'SPLIT_REQUIRED',
      'Sent when a grouped-item partial request requires a warehouse split before the job can start.',
      'split.required',
      '{"email": true, "sms": false, "in_app": true}'::jsonb,
      true,
      'immediate'
    )
    ON CONFLICT (tenant_id, key) DO UPDATE SET
      trigger_event = EXCLUDED.trigger_event,
      description   = EXCLUDED.description;

    -- split.completed (client)
    INSERT INTO public.communication_alerts
      (tenant_id, name, key, description, trigger_event, channels, is_enabled, timing_rule)
    VALUES (
      v_tenant.id,
      'Split Completed',
      'SPLIT_COMPLETED',
      'Sent when the warehouse completes a split/relabel task (client notification).',
      'split.completed',
      '{"email": true, "sms": false, "in_app": false}'::jsonb,
      true,
      'immediate'
    )
    ON CONFLICT (tenant_id, key) DO UPDATE SET
      trigger_event = EXCLUDED.trigger_event,
      description   = EXCLUDED.description;

    -- split.manual_review (internal)
    INSERT INTO public.communication_alerts
      (tenant_id, name, key, description, trigger_event, channels, is_enabled, timing_rule)
    VALUES (
      v_tenant.id,
      'Split Pending Review',
      'SPLIT_MANUAL_REVIEW',
      'Sent when a client requests a partial quantity from a grouped item but automated split tasks are disabled (Pending review).',
      'split.manual_review',
      '{"email": true, "sms": false, "in_app": true}'::jsonb,
      true,
      'immediate'
    )
    ON CONFLICT (tenant_id, key) DO UPDATE SET
      trigger_event = EXCLUDED.trigger_event,
      description   = EXCLUDED.description;

  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 3) Seed v4-style email + sms templates (HTML)
-- ----------------------------------------------------------------------------
-- NOTE: Requires _v4_upsert_template() from 20260207000200_v4_templates_upsert.sql

-- split.required
SELECT _v4_upsert_template(
  'split.required',
  'Split Required — {{item_code}}',
  $email$<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Split Required</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Split required for {{item_code}}.</div>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f7f9;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="640" style="max-width:640px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr>
            <td style="padding:18px 22px;border-bottom:4px solid {{brand_primary_color}};background:#ffffff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td valign="middle">
                    <div style="font-size:18px;font-weight:800;color:#111827;line-height:1.1;">{{tenant_name}}</div>
                    <div style="font-size:12px;color:#6b7280;margin-top:4px;">Automated Notification</div>
                  </td>
                  <td align="right" valign="middle">
                    <img src="{{brand_logo_url}}" alt="{{tenant_name}} logo" style="height:34px;max-width:180px;object-fit:contain;" />
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:22px;">
              <div style="font-size:20px;font-weight:900;color:#111827;margin:0 0 10px 0;">Split required</div>
              <div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 14px 0;">
                A partial quantity was requested from a grouped item. A warehouse <strong>Split</strong> task is required before the job can start.
              </div>

              <div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
                <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Item</div>
                <div style="font-size:13px;font-weight:700;color:#111827;">{{item_code}}</div>
              </div>
              <div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
                <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Current Location</div>
                <div style="font-size:13px;font-weight:700;color:#111827;">{{item_location}}</div>
              </div>
              <div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
                <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Qty (grouped)</div>
                <div style="font-size:13px;font-weight:700;color:#111827;">{{split_grouped_qty}}</div>
              </div>
              <div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
                <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Keep (parent)</div>
                <div style="font-size:13px;font-weight:700;color:#111827;">{{split_keep_qty}}</div>
              </div>
              <div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
                <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Split (new labels)</div>
                <div style="font-size:13px;font-weight:700;color:#111827;">{{split_leftover_qty}}</div>
              </div>

              <div style="height:1px;background:#e5e7eb;margin:16px 0;"></div>

              <div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 10px 0;">
                <strong>Origin Job:</strong> {{origin_job_type}} {{origin_job_number}}<br/>
                <a href="{{origin_job_link}}" style="color:{{brand_primary_color}};text-decoration:none;">{{origin_job_link}}</a>
              </div>

              <div style="margin:0 0 14px 0;padding:12px 14px;border:1px solid #e5e7eb;border-radius:12px;background:#f9fafb;">
                <div style="font-size:12px;font-weight:800;color:#111827;margin:0 0 6px 0;">Notes</div>
                <div style="font-size:13px;color:#374151;white-space:pre-wrap;">{{split_request_notes}}</div>
              </div>

              <div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">
                <strong>Items summary</strong>
              </div>
              <div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">{{items_table_html}}</div>

              <div style="margin:18px 0 6px 0;">
                <a href="{{task_link}}" style="display:inline-block;background:{{brand_primary_color}};color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 16px;border-radius:12px;">
                  Open split task
                </a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <div style="font-size:12px;color:#6b7280;line-height:1.6;">
                You are receiving this email because alerts are enabled for {{tenant_name}}.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>$email$,
  'Split required for {{item_code}} (keep {{split_keep_qty}} of {{split_grouped_qty}}). Location: {{item_location}}.'
);

-- split.completed
SELECT _v4_upsert_template(
  'split.completed',
  'Split Completed — {{item_code}}',
  $email$<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Split Completed</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Split completed for {{item_code}}.</div>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f7f9;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="640" style="max-width:640px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr>
            <td style="padding:18px 22px;border-bottom:4px solid {{brand_primary_color}};background:#ffffff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td valign="middle">
                    <div style="font-size:18px;font-weight:800;color:#111827;line-height:1.1;">{{tenant_name}}</div>
                    <div style="font-size:12px;color:#6b7280;margin-top:4px;">Automated Notification</div>
                  </td>
                  <td align="right" valign="middle">
                    <img src="{{brand_logo_url}}" alt="{{tenant_name}} logo" style="height:34px;max-width:180px;object-fit:contain;" />
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:22px;">
              <div style="font-size:20px;font-weight:900;color:#111827;margin:0 0 10px 0;">Split completed</div>
              <div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 14px 0;">
                The warehouse has completed the split/relabel step for your request.
              </div>

              <div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
                <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Item</div>
                <div style="font-size:13px;font-weight:700;color:#111827;">{{item_code}}</div>
              </div>
              <div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
                <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Qty (grouped)</div>
                <div style="font-size:13px;font-weight:700;color:#111827;">{{split_grouped_qty}}</div>
              </div>
              <div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
                <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Keep (parent)</div>
                <div style="font-size:13px;font-weight:700;color:#111827;">{{split_keep_qty}}</div>
              </div>
              <div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
                <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">New labels</div>
                <div style="font-size:13px;font-weight:700;color:#111827;">{{split_leftover_qty}}</div>
              </div>

              <div style="height:1px;background:#e5e7eb;margin:16px 0;"></div>

              <div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 8px 0;">
                <strong>New item codes</strong>
              </div>
              <pre style="margin:0 0 14px 0;padding:12px 14px;border:1px solid #e5e7eb;border-radius:12px;background:#f9fafb;white-space:pre-wrap;">{{split_child_codes_list_text}}</pre>

              <div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 10px 0;">
                <strong>Origin Job:</strong> {{origin_job_type}} {{origin_job_number}}<br/>
                <a href="{{origin_job_link}}" style="color:{{brand_primary_color}};text-decoration:none;">{{origin_job_link}}</a>
              </div>

              <div style="margin:18px 0 6px 0;">
                <a href="{{origin_job_link}}" style="display:inline-block;background:{{brand_primary_color}};color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 16px;border-radius:12px;">
                  View job
                </a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <div style="font-size:12px;color:#6b7280;line-height:1.6;">
                You are receiving this email because alerts are enabled for {{tenant_name}}.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>$email$,
  'Split completed for {{item_code}}. New labels created: {{split_leftover_qty}}.'
);

-- split.manual_review
SELECT _v4_upsert_template(
  'split.manual_review',
  'Pending Review — Partial request from grouped item ({{item_code}})',
  $email$<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Split Pending Review</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Pending review for {{item_code}}.</div>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f7f9;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="640" style="max-width:640px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
          <tr>
            <td style="padding:18px 22px;border-bottom:4px solid {{brand_primary_color}};background:#ffffff;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td valign="middle">
                    <div style="font-size:18px;font-weight:800;color:#111827;line-height:1.1;">{{tenant_name}}</div>
                    <div style="font-size:12px;color:#6b7280;margin-top:4px;">Automated Notification</div>
                  </td>
                  <td align="right" valign="middle">
                    <img src="{{brand_logo_url}}" alt="{{tenant_name}} logo" style="height:34px;max-width:180px;object-fit:contain;" />
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:22px;">
              <div style="font-size:20px;font-weight:900;color:#111827;margin:0 0 10px 0;">Pending review</div>
              <div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 14px 0;">
                A client requested a partial quantity from a grouped item, but automated split tasks are disabled for this tenant. This job is marked <strong>Pending review</strong>.
              </div>

              <div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
                <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Item</div>
                <div style="font-size:13px;font-weight:700;color:#111827;">{{item_code}}</div>
              </div>
              <div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
                <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Current Location</div>
                <div style="font-size:13px;font-weight:700;color:#111827;">{{item_location}}</div>
              </div>
              <div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
                <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Qty (grouped)</div>
                <div style="font-size:13px;font-weight:700;color:#111827;">{{split_grouped_qty}}</div>
              </div>
              <div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
                <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Requested</div>
                <div style="font-size:13px;font-weight:700;color:#111827;">{{split_keep_qty}}</div>
              </div>

              <div style="height:1px;background:#e5e7eb;margin:16px 0;"></div>

              <div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 10px 0;">
                <strong>Origin Job:</strong> {{origin_job_type}} {{origin_job_number}}<br/>
                <a href="{{origin_job_link}}" style="color:{{brand_primary_color}};text-decoration:none;">{{origin_job_link}}</a>
              </div>

              <div style="margin:0 0 14px 0;padding:12px 14px;border:1px solid #e5e7eb;border-radius:12px;background:#f9fafb;">
                <div style="font-size:12px;font-weight:800;color:#111827;margin:0 0 6px 0;">Notes</div>
                <div style="font-size:13px;color:#374151;white-space:pre-wrap;">{{split_request_notes}}</div>
              </div>

              <div style="margin:18px 0 6px 0;">
                <a href="{{origin_job_link}}" style="display:inline-block;background:{{brand_primary_color}};color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 16px;border-radius:12px;">
                  View job
                </a>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <div style="font-size:12px;color:#6b7280;line-height:1.6;">
                You are receiving this email because alerts are enabled for {{tenant_name}}.
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>$email$,
  'Pending review — partial request from grouped item {{item_code}} (requested {{split_keep_qty}} of {{split_grouped_qty}}).'
);

-- ----------------------------------------------------------------------------
-- 4) Seed in-app templates (role targeting)
-- ----------------------------------------------------------------------------
INSERT INTO public.communication_templates (
  id, tenant_id, alert_id, channel, subject_template, body_template, body_format, in_app_recipients, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  ca.tenant_id,
  ca.id,
  'in_app',
  ca.name,
  CASE
    WHEN ca.trigger_event = 'split.required' THEN 'Split required for [[item_code]] (keep [[split_keep_qty]] of [[split_grouped_qty]]).'
    WHEN ca.trigger_event = 'split.manual_review' THEN 'Pending review — partial request from grouped item [[item_code]].'
    WHEN ca.trigger_event = 'split.completed' THEN 'Split completed for [[item_code]].'
    ELSE ca.name
  END,
  'text',
  CASE
    WHEN ca.trigger_event IN ('split.required', 'split.manual_review') THEN '[[warehouse_role]], [[manager_role]]'
    ELSE '[[manager_role]]'
  END,
  NOW(),
  NOW()
FROM public.communication_alerts ca
WHERE ca.trigger_event IN ('split.required', 'split.completed', 'split.manual_review')
  AND NOT EXISTS (
    SELECT 1 FROM public.communication_templates ct
    WHERE ct.alert_id = ca.id AND ct.channel = 'in_app'
  );

