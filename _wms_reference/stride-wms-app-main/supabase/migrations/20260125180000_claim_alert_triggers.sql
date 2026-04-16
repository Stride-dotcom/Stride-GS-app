-- Claim Alert Triggers Migration
-- ================================================================================
-- Adds communication alert triggers for the claims acceptance workflow

-- Claim Determination Sent (to client)
INSERT INTO public.communication_alerts (tenant_id, name, key, description, trigger_event, channels, is_enabled)
SELECT t.id, 'Claim Determination Sent', 'CLAIM_DETERMINATION_SENT',
  'Sent to client when claim determination is ready for acceptance',
  'claim.determination_sent',
  '{"email": true, "sms": false}'::jsonb, true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.communication_alerts WHERE tenant_id = t.id AND key = 'CLAIM_DETERMINATION_SENT'
);

-- Claim Accepted by Client (to warehouse)
INSERT INTO public.communication_alerts (tenant_id, name, key, description, trigger_event, channels, is_enabled)
SELECT t.id, 'Client Accepted Claim', 'CLAIM_CLIENT_ACCEPTED',
  'Sent to warehouse admins when client accepts claim settlement',
  'claim.client_accepted',
  '{"email": true, "sms": false}'::jsonb, true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.communication_alerts WHERE tenant_id = t.id AND key = 'CLAIM_CLIENT_ACCEPTED'
);

-- Claim Declined by Client (to warehouse)
INSERT INTO public.communication_alerts (tenant_id, name, key, description, trigger_event, channels, is_enabled)
SELECT t.id, 'Client Declined Claim', 'CLAIM_CLIENT_DECLINED',
  'Sent to warehouse admins when client declines claim settlement',
  'claim.client_declined',
  '{"email": true, "sms": false}'::jsonb, true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.communication_alerts WHERE tenant_id = t.id AND key = 'CLAIM_CLIENT_DECLINED'
);

-- Claim Counter Offer (to warehouse)
INSERT INTO public.communication_alerts (tenant_id, name, key, description, trigger_event, channels, is_enabled)
SELECT t.id, 'Client Counter Offer on Claim', 'CLAIM_CLIENT_COUNTERED',
  'Sent to warehouse admins when client submits a counter offer',
  'claim.client_countered',
  '{"email": true, "sms": false}'::jsonb, true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.communication_alerts WHERE tenant_id = t.id AND key = 'CLAIM_CLIENT_COUNTERED'
);

-- Claim Attachment Added (to warehouse when client uploads)
INSERT INTO public.communication_alerts (tenant_id, name, key, description, trigger_event, channels, is_enabled)
SELECT t.id, 'Claim Attachment Added', 'CLAIM_ATTACHMENT_ADDED',
  'Sent when client uploads a photo or document to a claim',
  'claim.attachment_added',
  '{"email": true, "sms": false}'::jsonb, true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.communication_alerts WHERE tenant_id = t.id AND key = 'CLAIM_ATTACHMENT_ADDED'
);

-- Claim Note Added (to warehouse when client adds note)
INSERT INTO public.communication_alerts (tenant_id, name, key, description, trigger_event, channels, is_enabled)
SELECT t.id, 'Claim Note Added', 'CLAIM_NOTE_ADDED',
  'Sent when client adds a note to a claim',
  'claim.note_added',
  '{"email": true, "sms": false}'::jsonb, true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.communication_alerts WHERE tenant_id = t.id AND key = 'CLAIM_NOTE_ADDED'
);

-- Claim Requires Approval (to admins/managers)
INSERT INTO public.communication_alerts (tenant_id, name, key, description, trigger_event, channels, is_enabled)
SELECT t.id, 'Claim Requires Approval', 'CLAIM_REQUIRES_APPROVAL',
  'Sent when a claim exceeds the approval threshold and requires manager approval',
  'claim.requires_approval',
  '{"email": true, "sms": false}'::jsonb, true
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1 FROM public.communication_alerts WHERE tenant_id = t.id AND key = 'CLAIM_REQUIRES_APPROVAL'
);

-- Add comment for documentation
COMMENT ON TABLE public.communication_alerts IS
'Alert configurations for various system events.
Claim-related events:
- claim.filed: When a new claim is submitted
- claim.status_changed: When claim status changes
- claim.approved: When claim is approved
- claim.denied: When claim is denied
- claim.determination_sent: When determination is sent to client for acceptance
- claim.client_accepted: When client accepts the settlement
- claim.client_declined: When client declines the settlement
- claim.client_countered: When client submits a counter offer
- claim.attachment_added: When client uploads photo/document
- claim.note_added: When client adds a note
- claim.requires_approval: When claim exceeds approval threshold';
