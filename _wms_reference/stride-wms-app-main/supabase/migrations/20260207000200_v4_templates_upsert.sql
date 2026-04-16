-- ============================================================================
-- V4 Templates Upsert
-- ============================================================================
-- Seeds v4 email + SMS templates from manifest.json for all tenants.
--
-- OVERWRITE RULE:
--   Only update templates that have NOT been customized by the tenant.
--   A template is considered "customized" if updated_at > created_at.
--   Customized templates are SKIPPED (preserves tenant edits).
--
-- For NEW templates (no row exists yet): always insert.
-- ============================================================================

-- Helper function to upsert a single template pair (email + sms) for one trigger
CREATE OR REPLACE FUNCTION _v4_upsert_template(
  p_trigger_event TEXT,
  p_subject       TEXT,
  p_email_body    TEXT,
  p_sms_body      TEXT
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_alert RECORD;
  v_existing_template RECORD;
BEGIN
  -- Loop over every alert row that matches this trigger_event (one per tenant)
  FOR v_alert IN
    SELECT id, tenant_id
    FROM public.communication_alerts
    WHERE trigger_event = p_trigger_event
  LOOP
    -- ── EMAIL ──
    SELECT id, updated_at, created_at
    INTO v_existing_template
    FROM public.communication_templates
    WHERE alert_id = v_alert.id AND channel = 'email';

    IF v_existing_template IS NULL THEN
      -- No template yet → insert
      INSERT INTO public.communication_templates
        (tenant_id, alert_id, channel, subject_template, body_template, body_format)
      VALUES
        (v_alert.tenant_id, v_alert.id, 'email', p_subject, p_email_body, 'html');
    ELSIF v_existing_template.updated_at <= v_existing_template.created_at THEN
      -- Not customized → safe to overwrite with v4
      UPDATE public.communication_templates
      SET subject_template = p_subject,
          body_template    = p_email_body,
          body_format      = 'html'
      WHERE id = v_existing_template.id;
    END IF;
    -- else: customized → skip

    -- ── SMS ──
    IF p_sms_body IS NOT NULL AND p_sms_body <> '' THEN
      SELECT id, updated_at, created_at
      INTO v_existing_template
      FROM public.communication_templates
      WHERE alert_id = v_alert.id AND channel = 'sms';

      IF v_existing_template IS NULL THEN
        INSERT INTO public.communication_templates
          (tenant_id, alert_id, channel, subject_template, body_template, body_format)
        VALUES
          (v_alert.tenant_id, v_alert.id, 'sms', NULL, p_sms_body, 'text');
      ELSIF v_existing_template.updated_at <= v_existing_template.created_at THEN
        UPDATE public.communication_templates
        SET body_template = p_sms_body,
            body_format   = 'text'
        WHERE id = v_existing_template.id;
      END IF;
    END IF;

  END LOOP;
END;
$$;

-- ============================================================================
-- Now call the helper for each of the 16 manifest entries
-- ============================================================================

-- 1. shipment_created
SELECT _v4_upsert_template(
  'shipment_created',
  'Shipment Created — {{shipment_number}}',
  $email$<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Shipment Created</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">A shipment has been created in {{tenant_name}}.</div>
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
              <div style="font-size:20px;font-weight:900;color:#111827;margin:0 0 10px 0;">Shipment created</div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">We've created a shipment record for your account. You'll receive another update when it is received and processed.</div>
<div style='margin:10px 0 6px 0;'><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Shipment #</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{shipment_number}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Status</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{shipment_status}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Account</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{account_name}}</div>
        </div></div>
<div style='height:1px;background:#e5e7eb;margin:16px 0;'></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;"><b>Items summary</b></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">{{items_table_html}}</div>
<div style="margin:18px 0 6px 0;">
      <a href="{{shipment_link}}" style="display:inline-block;background:{{brand_primary_color}};color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 16px;border-radius:12px;">
        View shipment
      </a>
    </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <div style="font-size:12px;color:#6b7280;line-height:1.5;">
                Need help? Contact <a href="mailto:{{brand_support_email}}" style="color:#111827;">{{brand_support_email}}</a><br/>
                <a href="{{brand_terms_url}}" style="color:#6b7280;">Terms</a> ·
                <a href="{{brand_privacy_url}}" style="color:#6b7280;">Privacy</a>
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-top:10px;">{{tenant_company_address}}</div>
            </td>
          </tr>
        </table>
        <div style="font-size:11px;color:#9ca3af;margin-top:10px;">
          Sent by {{tenant_name}} · Powered by Stride WMS
        </div>
      </td>
    </tr>
  </table>
</body>
</html>$email$,
  'Shipment {{shipment_number}} created. View: {{shipment_link}}'
);

-- 2. shipment_scheduled
SELECT _v4_upsert_template(
  'shipment_scheduled',
  'Shipment Scheduled — {{shipment_number}}',
  $email$<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Shipment Scheduled</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your shipment has been scheduled.</div>
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
              <div style="font-size:20px;font-weight:900;color:#111827;margin:0 0 10px 0;">Shipment scheduled</div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">Your shipment has been scheduled. Use the link below to view details.</div>
<div style='margin:10px 0 6px 0;'><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Shipment #</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{shipment_number}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Scheduled</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{scheduled_date}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Account</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{account_name}}</div>
        </div></div>
<div style='height:1px;background:#e5e7eb;margin:16px 0;'></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;"><b>Items</b></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">{{items_table_html}}</div>
<div style="margin:18px 0 6px 0;">
      <a href="{{shipment_link}}" style="display:inline-block;background:{{brand_primary_color}};color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 16px;border-radius:12px;">
        Open shipment
      </a>
    </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <div style="font-size:12px;color:#6b7280;line-height:1.5;">
                Need help? Contact <a href="mailto:{{brand_support_email}}" style="color:#111827;">{{brand_support_email}}</a><br/>
                <a href="{{brand_terms_url}}" style="color:#6b7280;">Terms</a> ·
                <a href="{{brand_privacy_url}}" style="color:#6b7280;">Privacy</a>
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-top:10px;">{{tenant_company_address}}</div>
            </td>
          </tr>
        </table>
        <div style="font-size:11px;color:#9ca3af;margin-top:10px;">
          Sent by {{tenant_name}} · Powered by Stride WMS
        </div>
      </td>
    </tr>
  </table>
</body>
</html>$email$,
  'Shipment {{shipment_number}} scheduled for {{scheduled_date}}. {{shipment_link}}'
);

-- 3. shipment_delayed
SELECT _v4_upsert_template(
  'shipment_delayed',
  'Shipment Delayed — {{shipment_number}}',
  $email$<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Shipment Delayed</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">There's an update about your shipment schedule.</div>
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
              <div style="font-size:20px;font-weight:900;color:#111827;margin:0 0 10px 0;">Shipment delayed</div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">There has been a delay affecting your shipment timeline. We'll keep you updated as information changes.</div>
<div style='margin:10px 0 6px 0;'><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Shipment #</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{shipment_number}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Status</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{shipment_status}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Reason</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{delay_reason}}</div>
        </div></div>
<div style='height:1px;background:#e5e7eb;margin:16px 0;'></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;"><b>Current items summary</b></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">{{items_table_html}}</div>
<div style="margin:18px 0 6px 0;">
      <a href="{{shipment_link}}" style="display:inline-block;background:{{brand_primary_color}};color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 16px;border-radius:12px;">
        View shipment status
      </a>
    </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <div style="font-size:12px;color:#6b7280;line-height:1.5;">
                Need help? Contact <a href="mailto:{{brand_support_email}}" style="color:#111827;">{{brand_support_email}}</a><br/>
                <a href="{{brand_terms_url}}" style="color:#6b7280;">Terms</a> ·
                <a href="{{brand_privacy_url}}" style="color:#6b7280;">Privacy</a>
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-top:10px;">{{tenant_company_address}}</div>
            </td>
          </tr>
        </table>
        <div style="font-size:11px;color:#9ca3af;margin-top:10px;">
          Sent by {{tenant_name}} · Powered by Stride WMS
        </div>
      </td>
    </tr>
  </table>
</body>
</html>$email$,
  'Delay: Shipment {{shipment_number}}. Reason: {{delay_reason}}. {{shipment_link}}'
);

-- 4. shipment_out_for_delivery
SELECT _v4_upsert_template(
  'shipment_out_for_delivery',
  'Out for Delivery — {{shipment_number}}',
  $email$<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Shipment Out For Delivery</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your shipment is out for delivery.</div>
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
              <div style="font-size:20px;font-weight:900;color:#111827;margin:0 0 10px 0;">Out for delivery</div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">Your shipment is on the way. If you need to coordinate access or instructions, reply to this email or contact support.</div>
<div style='margin:10px 0 6px 0;'><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Shipment #</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{shipment_number}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Status</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{shipment_status}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Window</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{delivery_window}}</div>
        </div></div>
<div style='height:1px;background:#e5e7eb;margin:16px 0;'></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;"><b>Items</b></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">{{items_table_html}}</div>
<div style="margin:18px 0 6px 0;">
      <a href="{{shipment_link}}" style="display:inline-block;background:{{brand_primary_color}};color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 16px;border-radius:12px;">
        Track shipment
      </a>
    </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <div style="font-size:12px;color:#6b7280;line-height:1.5;">
                Need help? Contact <a href="mailto:{{brand_support_email}}" style="color:#111827;">{{brand_support_email}}</a><br/>
                <a href="{{brand_terms_url}}" style="color:#6b7280;">Terms</a> ·
                <a href="{{brand_privacy_url}}" style="color:#6b7280;">Privacy</a>
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-top:10px;">{{tenant_company_address}}</div>
            </td>
          </tr>
        </table>
        <div style="font-size:11px;color:#9ca3af;margin-top:10px;">
          Sent by {{tenant_name}} · Powered by Stride WMS
        </div>
      </td>
    </tr>
  </table>
</body>
</html>$email$,
  'Out for delivery: {{shipment_number}}. Window: {{delivery_window}}. {{shipment_link}}'
);

-- 5. shipment_delivered
SELECT _v4_upsert_template(
  'shipment_delivered',
  'Delivered — {{shipment_number}}',
  $email$<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Shipment Delivered</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your shipment has been delivered.</div>
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
              <div style="font-size:20px;font-weight:900;color:#111827;margin:0 0 10px 0;">Delivered</div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">Your shipment has been marked delivered. If anything looks off, please contact us as soon as possible.</div>
<div style='margin:10px 0 6px 0;'><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Shipment #</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{shipment_number}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Delivered</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{delivered_at}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Account</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{account_name}}</div>
        </div></div>
<div style='height:1px;background:#e5e7eb;margin:16px 0;'></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;"><b>Delivered items</b></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">{{items_table_html}}</div>
<div style="margin:18px 0 6px 0;">
      <a href="{{shipment_link}}" style="display:inline-block;background:{{brand_primary_color}};color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 16px;border-radius:12px;">
        View delivery details
      </a>
    </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <div style="font-size:12px;color:#6b7280;line-height:1.5;">
                Need help? Contact <a href="mailto:{{brand_support_email}}" style="color:#111827;">{{brand_support_email}}</a><br/>
                <a href="{{brand_terms_url}}" style="color:#6b7280;">Terms</a> ·
                <a href="{{brand_privacy_url}}" style="color:#6b7280;">Privacy</a>
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-top:10px;">{{tenant_company_address}}</div>
            </td>
          </tr>
        </table>
        <div style="font-size:11px;color:#9ca3af;margin-top:10px;">
          Sent by {{tenant_name}} · Powered by Stride WMS
        </div>
      </td>
    </tr>
  </table>
</body>
</html>$email$,
  'Delivered: {{shipment_number}} at {{delivered_at}}. {{shipment_link}}'
);

-- 6. will_call_ready
SELECT _v4_upsert_template(
  'will_call_ready',
  'Will-Call Ready — {{release_number}}',
  $email$<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Will Call Ready</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your will-call release is ready for pickup.</div>
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
              <div style="font-size:20px;font-weight:900;color:#111827;margin:0 0 10px 0;">Ready for pickup</div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">Your will-call release is ready. Please use the link below for pickup details and item list.</div>
<div style='margin:10px 0 6px 0;'><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Release #</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{release_number}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Pickup hours</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{pickup_hours}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Account</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{account_name}}</div>
        </div></div>
<div style='height:1px;background:#e5e7eb;margin:16px 0;'></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;"><b>Items ready</b></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">{{items_table_html}}</div>
<div style="margin:18px 0 6px 0;">
      <a href="{{portal_release_url}}" style="display:inline-block;background:{{brand_primary_color}};color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 16px;border-radius:12px;">
        View will-call details
      </a>
    </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <div style="font-size:12px;color:#6b7280;line-height:1.5;">
                Need help? Contact <a href="mailto:{{brand_support_email}}" style="color:#111827;">{{brand_support_email}}</a><br/>
                <a href="{{brand_terms_url}}" style="color:#6b7280;">Terms</a> ·
                <a href="{{brand_privacy_url}}" style="color:#6b7280;">Privacy</a>
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-top:10px;">{{tenant_company_address}}</div>
            </td>
          </tr>
        </table>
        <div style="font-size:11px;color:#9ca3af;margin-top:10px;">
          Sent by {{tenant_name}} · Powered by Stride WMS
        </div>
      </td>
    </tr>
  </table>
</body>
</html>$email$,
  'Will-call ready: {{release_number}}. {{portal_release_url}}'
);

-- 7. will_call_released
SELECT _v4_upsert_template(
  'will_call_released',
  'Will-Call Released — {{release_number}}',
  $email$<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Will Call Released</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your will-call release has been completed.</div>
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
              <div style="font-size:20px;font-weight:900;color:#111827;margin:0 0 10px 0;">Release completed</div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">Your will-call release has been completed. Keep this email for your records.</div>
<div style='margin:10px 0 6px 0;'><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Release #</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{release_number}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Released</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{released_at}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Account</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{account_name}}</div>
        </div></div>
<div style='height:1px;background:#e5e7eb;margin:16px 0;'></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;"><b>Released items</b></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">{{items_table_html}}</div>
<div style="margin:18px 0 6px 0;">
      <a href="{{portal_release_url}}" style="display:inline-block;background:{{brand_primary_color}};color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 16px;border-radius:12px;">
        View release record
      </a>
    </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <div style="font-size:12px;color:#6b7280;line-height:1.5;">
                Need help? Contact <a href="mailto:{{brand_support_email}}" style="color:#111827;">{{brand_support_email}}</a><br/>
                <a href="{{brand_terms_url}}" style="color:#6b7280;">Terms</a> ·
                <a href="{{brand_privacy_url}}" style="color:#6b7280;">Privacy</a>
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-top:10px;">{{tenant_company_address}}</div>
            </td>
          </tr>
        </table>
        <div style="font-size:11px;color:#9ca3af;margin-top:10px;">
          Sent by {{tenant_name}} · Powered by Stride WMS
        </div>
      </td>
    </tr>
  </table>
</body>
</html>$email$,
  'Will-call released: {{release_number}} at {{released_at}}. {{portal_release_url}}'
);

-- 8. inspection_started
SELECT _v4_upsert_template(
  'inspection_started',
  'Inspection Started — {{inspection_number}}',
  $email$<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Inspection Started</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">We've started an inspection.</div>
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
              <div style="font-size:20px;font-weight:900;color:#111827;margin:0 0 10px 0;">Inspection started</div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">We've started the inspection process. You'll receive a report when it's ready.</div>
<div style='margin:10px 0 6px 0;'><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Inspection #</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{inspection_number}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Shipment #</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{shipment_number}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Account</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{account_name}}</div>
        </div></div>
<div style='height:1px;background:#e5e7eb;margin:16px 0;'></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;"><b>Items in inspection</b></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">{{items_table_html}}</div>
<div style="margin:18px 0 6px 0;">
      <a href="{{portal_inspection_url}}" style="display:inline-block;background:{{brand_primary_color}};color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 16px;border-radius:12px;">
        View inspection
      </a>
    </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <div style="font-size:12px;color:#6b7280;line-height:1.5;">
                Need help? Contact <a href="mailto:{{brand_support_email}}" style="color:#111827;">{{brand_support_email}}</a><br/>
                <a href="{{brand_terms_url}}" style="color:#6b7280;">Terms</a> ·
                <a href="{{brand_privacy_url}}" style="color:#6b7280;">Privacy</a>
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-top:10px;">{{tenant_company_address}}</div>
            </td>
          </tr>
        </table>
        <div style="font-size:11px;color:#9ca3af;margin-top:10px;">
          Sent by {{tenant_name}} · Powered by Stride WMS
        </div>
      </td>
    </tr>
  </table>
</body>
</html>$email$,
  'Inspection started: {{inspection_number}}. {{portal_inspection_url}}'
);

-- 9. inspection_report_available
SELECT _v4_upsert_template(
  'inspection_report_available',
  'Inspection Report Available — {{inspection_number}}',
  $email$<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Inspection Report Available</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Your inspection report is ready to review.</div>
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
              <div style="font-size:20px;font-weight:900;color:#111827;margin:0 0 10px 0;">Inspection report available</div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">Your inspection report is ready. Review the summary below or open the report in the portal for full details.</div>
<div style='margin:10px 0 6px 0;'><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Inspection #</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{inspection_number}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Issues</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{inspection_issues_count}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Account</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{account_name}}</div>
        </div></div>
<div style='height:1px;background:#e5e7eb;margin:16px 0;'></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;"><b>Inspection findings</b></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">{{inspection_findings_table_html}}</div>
<div style='height:1px;background:#e5e7eb;margin:16px 0;'></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;"><b>Items</b></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">{{items_table_html}}</div>
<div style="margin:18px 0 6px 0;">
      <a href="{{portal_inspection_url}}" style="display:inline-block;background:{{brand_primary_color}};color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 16px;border-radius:12px;">
        Open inspection report
      </a>
    </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <div style="font-size:12px;color:#6b7280;line-height:1.5;">
                Need help? Contact <a href="mailto:{{brand_support_email}}" style="color:#111827;">{{brand_support_email}}</a><br/>
                <a href="{{brand_terms_url}}" style="color:#6b7280;">Terms</a> ·
                <a href="{{brand_privacy_url}}" style="color:#6b7280;">Privacy</a>
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-top:10px;">{{tenant_company_address}}</div>
            </td>
          </tr>
        </table>
        <div style="font-size:11px;color:#9ca3af;margin-top:10px;">
          Sent by {{tenant_name}} · Powered by Stride WMS
        </div>
      </td>
    </tr>
  </table>
</body>
</html>$email$,
  'Inspection report ready: {{inspection_number}}. Issues: {{inspection_issues_count}}. {{portal_inspection_url}}'
);

-- 10. inspection_requires_attention
SELECT _v4_upsert_template(
  'inspection_requires_attention',
  'Inspection Requires Attention — {{inspection_number}}',
  $email$<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Inspection Requires Attention</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Action may be required based on inspection findings.</div>
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
              <div style="font-size:20px;font-weight:900;color:#111827;margin:0 0 10px 0;">Inspection requires attention</div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">We found items that may require your review. Please open the report to confirm next steps.</div>
<div style='margin:10px 0 6px 0;'><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Inspection #</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{inspection_number}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Issues</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{inspection_issues_count}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Shipment #</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{shipment_number}}</div>
        </div></div>
<div style='height:1px;background:#e5e7eb;margin:16px 0;'></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;"><b>Key findings</b></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">{{inspection_findings_table_html}}</div>
<div style="margin:18px 0 6px 0;">
      <a href="{{portal_inspection_url}}" style="display:inline-block;background:{{brand_primary_color}};color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 16px;border-radius:12px;">
        Review inspection
      </a>
    </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <div style="font-size:12px;color:#6b7280;line-height:1.5;">
                Need help? Contact <a href="mailto:{{brand_support_email}}" style="color:#111827;">{{brand_support_email}}</a><br/>
                <a href="{{brand_terms_url}}" style="color:#6b7280;">Terms</a> ·
                <a href="{{brand_privacy_url}}" style="color:#6b7280;">Privacy</a>
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-top:10px;">{{tenant_company_address}}</div>
            </td>
          </tr>
        </table>
        <div style="font-size:11px;color:#9ca3af;margin-top:10px;">
          Sent by {{tenant_name}} · Powered by Stride WMS
        </div>
      </td>
    </tr>
  </table>
</body>
</html>$email$,
  'Action needed: Inspection {{inspection_number}}. {{portal_inspection_url}}'
);

-- 11. task_assigned
SELECT _v4_upsert_template(
  'task_assigned',
  'Task Assigned — {{task_title}}',
  $email$<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Task Assigned</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">A task has been assigned to {{assigned_to_name}}.</div>
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
              <div style="font-size:20px;font-weight:900;color:#111827;margin:0 0 10px 0;">Task assigned</div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">A task has been assigned and is ready for action.</div>
<div style='margin:10px 0 6px 0;'><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Task</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{task_title}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Type</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{task_type}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Due</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{task_due_date}}</div>
        </div></div>
<div style='height:1px;background:#e5e7eb;margin:16px 0;'></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;"><b>Items</b></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">{{items_table_html}}</div>
<div style='height:1px;background:#e5e7eb;margin:16px 0;'></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;"><b>Services</b></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">{{task_services_table_html}}</div>
<div style="margin:18px 0 6px 0;">
      <a href="{{task_link}}" style="display:inline-block;background:{{brand_primary_color}};color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 16px;border-radius:12px;">
        Open task
      </a>
    </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <div style="font-size:12px;color:#6b7280;line-height:1.5;">
                Need help? Contact <a href="mailto:{{brand_support_email}}" style="color:#111827;">{{brand_support_email}}</a><br/>
                <a href="{{brand_terms_url}}" style="color:#6b7280;">Terms</a> ·
                <a href="{{brand_privacy_url}}" style="color:#6b7280;">Privacy</a>
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-top:10px;">{{tenant_company_address}}</div>
            </td>
          </tr>
        </table>
        <div style="font-size:11px;color:#9ca3af;margin-top:10px;">
          Sent by {{tenant_name}} · Powered by Stride WMS
        </div>
      </td>
    </tr>
  </table>
</body>
</html>$email$,
  'Task assigned: {{task_title}} due {{task_due_date}}. {{task_link}}'
);

-- 12. task_completed
SELECT _v4_upsert_template(
  'task_completed',
  'Task Completed — {{task_title}}',
  $email$<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Task Completed</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">A task has been completed.</div>
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
              <div style="font-size:20px;font-weight:900;color:#111827;margin:0 0 10px 0;">Task completed</div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">A task has been marked completed. Review details in the portal if needed.</div>
<div style='margin:10px 0 6px 0;'><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Task</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{task_title}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Completed by</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{completed_by_name}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Account</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{account_name}}</div>
        </div></div>
<div style='height:1px;background:#e5e7eb;margin:16px 0;'></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;"><b>Items</b></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">{{items_table_html}}</div>
<div style='height:1px;background:#e5e7eb;margin:16px 0;'></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;"><b>Services performed</b></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">{{task_services_table_html}}</div>
<div style="margin:18px 0 6px 0;">
      <a href="{{task_link}}" style="display:inline-block;background:{{brand_primary_color}};color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 16px;border-radius:12px;">
        View task record
      </a>
    </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <div style="font-size:12px;color:#6b7280;line-height:1.5;">
                Need help? Contact <a href="mailto:{{brand_support_email}}" style="color:#111827;">{{brand_support_email}}</a><br/>
                <a href="{{brand_terms_url}}" style="color:#6b7280;">Terms</a> ·
                <a href="{{brand_privacy_url}}" style="color:#6b7280;">Privacy</a>
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-top:10px;">{{tenant_company_address}}</div>
            </td>
          </tr>
        </table>
        <div style="font-size:11px;color:#9ca3af;margin-top:10px;">
          Sent by {{tenant_name}} · Powered by Stride WMS
        </div>
      </td>
    </tr>
  </table>
</body>
</html>$email$,
  'Task completed: {{task_title}}. {{task_link}}'
);

-- 13. task_overdue
SELECT _v4_upsert_template(
  'task_overdue',
  'Task Overdue — {{task_title}} ({{task_days_overdue}} days)',
  $email$<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Task Overdue</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">A task is overdue and needs attention.</div>
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
              <div style="font-size:20px;font-weight:900;color:#111827;margin:0 0 10px 0;">Task overdue</div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">This task is overdue. Please review and update the status or due date.</div>
<div style='margin:10px 0 6px 0;'><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Task</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{task_title}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Due</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{task_due_date}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Overdue</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{task_days_overdue}} days</div>
        </div></div>
<div style='height:1px;background:#e5e7eb;margin:16px 0;'></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;"><b>Assigned to</b> {{assigned_to_name}}</div>
<div style="margin:18px 0 6px 0;">
      <a href="{{task_link}}" style="display:inline-block;background:{{brand_primary_color}};color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 16px;border-radius:12px;">
        Open task
      </a>
    </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <div style="font-size:12px;color:#6b7280;line-height:1.5;">
                Need help? Contact <a href="mailto:{{brand_support_email}}" style="color:#111827;">{{brand_support_email}}</a><br/>
                <a href="{{brand_terms_url}}" style="color:#6b7280;">Terms</a> ·
                <a href="{{brand_privacy_url}}" style="color:#6b7280;">Privacy</a>
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-top:10px;">{{tenant_company_address}}</div>
            </td>
          </tr>
        </table>
        <div style="font-size:11px;color:#9ca3af;margin-top:10px;">
          Sent by {{tenant_name}} · Powered by Stride WMS
        </div>
      </td>
    </tr>
  </table>
</body>
</html>$email$,
  'Overdue task: {{task_title}} ({{task_days_overdue}}d). {{task_link}}'
);

-- 14. repair_started
SELECT _v4_upsert_template(
  'repair_started',
  'Repair Started — {{item_code}}',
  $email$<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Repair Started</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Repair work has started for an item.</div>
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
              <div style="font-size:20px;font-weight:900;color:#111827;margin:0 0 10px 0;">Repair started</div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">Repair work has started. You'll receive an update when it is completed or if approval is required.</div>
<div style='margin:10px 0 6px 0;'><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Item</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{item_code}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Account</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{account_name}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Repair type</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{repair_type}}</div>
        </div></div>
<div style='height:1px;background:#e5e7eb;margin:16px 0;'></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;"><b>Repair actions</b></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">{{repair_actions_table_html}}</div>
<div style="margin:18px 0 6px 0;">
      <a href="{{item_photos_link}}" style="display:inline-block;background:{{brand_primary_color}};color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 16px;border-radius:12px;">
        View item
      </a>
    </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <div style="font-size:12px;color:#6b7280;line-height:1.5;">
                Need help? Contact <a href="mailto:{{brand_support_email}}" style="color:#111827;">{{brand_support_email}}</a><br/>
                <a href="{{brand_terms_url}}" style="color:#6b7280;">Terms</a> ·
                <a href="{{brand_privacy_url}}" style="color:#6b7280;">Privacy</a>
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-top:10px;">{{tenant_company_address}}</div>
            </td>
          </tr>
        </table>
        <div style="font-size:11px;color:#9ca3af;margin-top:10px;">
          Sent by {{tenant_name}} · Powered by Stride WMS
        </div>
      </td>
    </tr>
  </table>
</body>
</html>$email$,
  'Repair started: {{item_code}}. {{item_photos_link}}'
);

-- 15. repair_completed
SELECT _v4_upsert_template(
  'repair_completed',
  'Repair Completed — {{item_code}}',
  $email$<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Repair Completed</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Repair work has been completed.</div>
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
              <div style="font-size:20px;font-weight:900;color:#111827;margin:0 0 10px 0;">Repair completed</div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">Repair work has been completed for the item below.</div>
<div style='margin:10px 0 6px 0;'><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Item</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{item_code}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Account</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{account_name}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Completed</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{repair_completed_at}}</div>
        </div></div>
<div style='height:1px;background:#e5e7eb;margin:16px 0;'></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;"><b>Repair summary</b></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">{{repair_actions_table_html}}</div>
<div style="margin:18px 0 6px 0;">
      <a href="{{item_photos_link}}" style="display:inline-block;background:{{brand_primary_color}};color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 16px;border-radius:12px;">
        View item details
      </a>
    </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <div style="font-size:12px;color:#6b7280;line-height:1.5;">
                Need help? Contact <a href="mailto:{{brand_support_email}}" style="color:#111827;">{{brand_support_email}}</a><br/>
                <a href="{{brand_terms_url}}" style="color:#6b7280;">Terms</a> ·
                <a href="{{brand_privacy_url}}" style="color:#6b7280;">Privacy</a>
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-top:10px;">{{tenant_company_address}}</div>
            </td>
          </tr>
        </table>
        <div style="font-size:11px;color:#9ca3af;margin-top:10px;">
          Sent by {{tenant_name}} · Powered by Stride WMS
        </div>
      </td>
    </tr>
  </table>
</body>
</html>$email$,
  'Repair completed: {{item_code}}. {{item_photos_link}}'
);

-- 16. repair_requires_approval
SELECT _v4_upsert_template(
  'repair_requires_approval',
  'Repair Approval Needed — {{item_code}}',
  $email$<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Repair Requires Approval</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">Approval is needed before repair work continues.</div>
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
              <div style="font-size:20px;font-weight:900;color:#111827;margin:0 0 10px 0;">Repair approval needed</div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">We need approval before proceeding. Please review the estimate and approve or decline.</div>
<div style='margin:10px 0 6px 0;'><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Item</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{item_code}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Estimate</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{repair_estimate_amount}}</div>
        </div><div style="display:inline-block;margin:0 8px 8px 0;padding:8px 10px;border:1px solid #e5e7eb;border-radius:10px;background:#ffffff;">
          <div style="font-size:11px;color:#6b7280;margin-bottom:2px;">Account</div>
          <div style="font-size:13px;font-weight:700;color:#111827;">{{account_name}}</div>
        </div></div>
<div style='height:1px;background:#e5e7eb;margin:16px 0;'></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;"><b>Proposed work</b></div>
<div style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 12px 0;">{{repair_actions_table_html}}</div>
<div style="margin:18px 0 6px 0;">
      <a href="{{portal_repair_url}}" style="display:inline-block;background:{{brand_primary_color}};color:#ffffff;text-decoration:none;font-weight:800;font-size:14px;padding:12px 16px;border-radius:12px;">
        Review &amp; approve
      </a>
    </div>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 22px;background:#f9fafb;border-top:1px solid #e5e7eb;">
              <div style="font-size:12px;color:#6b7280;line-height:1.5;">
                Need help? Contact <a href="mailto:{{brand_support_email}}" style="color:#111827;">{{brand_support_email}}</a><br/>
                <a href="{{brand_terms_url}}" style="color:#6b7280;">Terms</a> ·
                <a href="{{brand_privacy_url}}" style="color:#6b7280;">Privacy</a>
              </div>
              <div style="font-size:11px;color:#9ca3af;margin-top:10px;">{{tenant_company_address}}</div>
            </td>
          </tr>
        </table>
        <div style="font-size:11px;color:#9ca3af;margin-top:10px;">
          Sent by {{tenant_name}} · Powered by Stride WMS
        </div>
      </td>
    </tr>
  </table>
</body>
</html>$email$,
  'Approval needed for repair {{item_code}}. Estimate {{repair_estimate_amount}}. {{portal_repair_url}}'
);

-- Clean up the helper function
DROP FUNCTION IF EXISTS _v4_upsert_template(TEXT, TEXT, TEXT, TEXT);
