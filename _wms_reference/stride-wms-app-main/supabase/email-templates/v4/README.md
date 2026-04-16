# Stride WMS Email Templates (v4) — Missing Pack

Drop these files into your repo at:

- `supabase/email-templates/v4/` (HTML)
- `supabase/email-templates/v4/sms/` (SMS)

## Token Standards (Required)
Global / Branding:
- {{tenant_name}}
- {{brand_logo_url}}
- {{brand_primary_color}}
- {{brand_support_email}}
- {{brand_terms_url}}
- {{brand_privacy_url}}
- {{tenant_company_address}}
- {{portal_base_url}}

Common entity tokens (as applicable):
- Shipments: {{shipment_number}}, {{shipment_status}}, {{shipment_link}}, {{scheduled_date}}, {{delivery_window}}, {{delay_reason}}, {{delivered_at}}
- Releases: {{release_number}}, {{portal_release_url}}, {{pickup_hours}}, {{released_at}}
- Inspections: {{inspection_number}}, {{portal_inspection_url}}, {{inspection_issues_count}}, {{shipment_number}}
- Tasks: {{task_title}}, {{task_type}}, {{task_due_date}}, {{task_days_overdue}}, {{assigned_to_name}}, {{completed_by_name}}, {{task_link}}
- Repairs: {{item_code}}, {{repair_type}}, {{repair_completed_at}}, {{repair_estimate_amount}}, {{portal_repair_url}}, {{item_photos_link}}

Arrays / Tables (pre-rendered HTML recommended for v1):
- {{items_table_html}}
- {{inspection_findings_table_html}}
- {{task_services_table_html}}
- {{repair_actions_table_html}}

CTA (optional):
- {{cta_label}}
- {{portal_action_url}}

This pack includes a `manifest.json` mapping `trigger_event` → template files.
