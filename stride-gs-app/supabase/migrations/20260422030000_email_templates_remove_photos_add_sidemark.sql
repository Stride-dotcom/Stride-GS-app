-- Fix 1: Remove "Open Photos" CTA button from email templates.
-- Photos are accessible inside the Portal; the separate Drive folder link is redundant
-- and confusing. Keep only the "View in Stride Hub" / "Approve or Decline" CTA.

-- Templates using {{PHOTOS_URL}}
UPDATE public.email_templates
SET
  body       = REPLACE(
    body,
    '<a href="{{PHOTOS_URL}}" style="display:inline-block;background:#1C1C1C;color:#fff;font-weight:600;font-size:11px;letter-spacing:2px;text-transform:uppercase;text-decoration:none;padding:16px 32px;border-radius:100px;margin:4px">Open Photos</a>',
    ''
  ),
  updated_at = now()
WHERE template_key IN (
    'INSP_EMAIL',
    'REPAIR_QUOTE',
    'REPAIR_QUOTE_REQUEST',
    'SHIPMENT_RECEIVED',
    'TASK_COMPLETE',
    'WILL_CALL_RELEASE'
  )
  AND body LIKE '%Open Photos%';

-- REPAIR_COMPLETE uses {{REPAIR_PHOTOS_URL}} rather than {{PHOTOS_URL}}
UPDATE public.email_templates
SET
  body       = REPLACE(
    body,
    '<a href="{{REPAIR_PHOTOS_URL}}" style="display:inline-block;background:#1C1C1C;color:#fff;font-weight:600;font-size:11px;letter-spacing:2px;text-transform:uppercase;text-decoration:none;padding:16px 32px;border-radius:100px;margin:4px">Open Photos</a>',
    ''
  ),
  updated_at = now()
WHERE template_key = 'REPAIR_COMPLETE'
  AND body LIKE '%Open Photos%';

-- Fix 3: Add {{SIDEMARK_HEADER}} placeholder to will call templates.
-- GAS WillCalls.gs has emitted this token since v4.5.0 but the template bodies
-- never had the placeholder, so sidemark was silently dropped every email.
-- Guards (body NOT LIKE) make these updates idempotent.

UPDATE public.email_templates
SET
  body       = REPLACE(
    body,
    '<div style="background:#FFFFFF;border-radius:20px;padding:40px;margin-bottom:16px"><div style="font-size:10px;font-weight:500;letter-spacing:4px;color:#E8692A;text-transform:uppercase;margin-bottom:12px">Pickup Details</div>',
    '<div style="background:#FFFFFF;border-radius:20px;padding:40px;margin-bottom:16px">{{SIDEMARK_HEADER}}<div style="font-size:10px;font-weight:500;letter-spacing:4px;color:#E8692A;text-transform:uppercase;margin-bottom:12px">Pickup Details</div>'
  ),
  updated_at = now()
WHERE template_key = 'WILL_CALL_CREATED'
  AND body NOT LIKE '%{{SIDEMARK_HEADER}}%';

UPDATE public.email_templates
SET
  body       = REPLACE(
    body,
    '<div style="background:#FFFFFF;border-radius:20px;padding:40px;margin-bottom:16px"><div style="font-size:10px;font-weight:500;letter-spacing:4px;color:#E8692A;text-transform:uppercase;margin-bottom:12px">Release Details</div>',
    '<div style="background:#FFFFFF;border-radius:20px;padding:40px;margin-bottom:16px">{{SIDEMARK_HEADER}}<div style="font-size:10px;font-weight:500;letter-spacing:4px;color:#E8692A;text-transform:uppercase;margin-bottom:12px">Release Details</div>'
  ),
  updated_at = now()
WHERE template_key = 'WILL_CALL_RELEASE'
  AND body NOT LIKE '%{{SIDEMARK_HEADER}}%';
