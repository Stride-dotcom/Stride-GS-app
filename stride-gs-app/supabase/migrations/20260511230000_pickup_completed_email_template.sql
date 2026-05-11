-- PICKUP_COMPLETED email template — fired by dt-webhook-ingest when DT
-- pushes a Service_Route_Finished alert for any order with
-- order_type='pickup'. Real-time path (webhook → notify-pickup-completed
-- → send-email), no polling involved. The ops team gets the alert
-- within seconds of the driver tapping "Finish" in the DT driver app
-- so they can mark the linked delivery as "items in hand" without
-- waiting for a daily reconciliation.
--
-- Tokens:
--   ORDER_NUMBER         — pickup leg DT identifier (e.g. MRS-00047-P)
--   LINKED_DELIVERY      — delivery leg DT identifier when P+D pair, or "—"
--   ORDER_TYPE           — "Pickup & Delivery" or "Standalone Pickup"
--   CLIENT_NAME          — Stride client display name
--   PICKUP_ADDRESS       — pickup contact + address
--   COMPLETED_AT         — finished_at timestamp (DT-side), or webhook receipt time
--   DRIVER_NAME          — driver who completed it, or "—" if missing
--   ITEM_COUNT           — count of dt_order_items on the pickup leg
--   APP_LINK             — deep link to the pickup order page
--   DELIVERY_LINK        — deep link to the delivery order page (P+D only) or "—"
INSERT INTO email_templates (template_key, subject, body, category, active)
VALUES (
  'PICKUP_COMPLETED',
  '✓ Pickup completed — {{ORDER_NUMBER}} ({{CLIENT_NAME}})',
  $body$
<p>The DispatchTrack pickup just finished.</p>

<table style="border-collapse:collapse;font-size:14px;margin:12px 0;">
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Order:</td>          <td style="padding:4px 0;"><strong>{{ORDER_NUMBER}}</strong></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Type:</td>           <td style="padding:4px 0;">{{ORDER_TYPE}}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Client:</td>         <td style="padding:4px 0;">{{CLIENT_NAME}}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Pickup address:</td> <td style="padding:4px 0;">{{PICKUP_ADDRESS}}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Items:</td>          <td style="padding:4px 0;">{{ITEM_COUNT}}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Driver:</td>         <td style="padding:4px 0;">{{DRIVER_NAME}}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Completed at:</td>   <td style="padding:4px 0;">{{COMPLETED_AT}}</td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666;">Linked delivery:</td><td style="padding:4px 0;">{{LINKED_DELIVERY}}</td></tr>
</table>

<p style="margin:16px 0;">
  <a href="{{APP_LINK}}" style="background:#ea580c;color:#fff;text-decoration:none;padding:8px 16px;border-radius:6px;font-weight:600;">Open Pickup Order</a>
  &nbsp;
  <a href="{{DELIVERY_LINK}}" style="background:#fff;border:1px solid #ea580c;color:#ea580c;text-decoration:none;padding:8px 16px;border-radius:6px;font-weight:600;">Open Delivery Order</a>
</p>

<p style="color:#666;font-size:12px;margin-top:24px;">
  Sent automatically by Stride when DispatchTrack pushed a Service_Route_Finished alert.
  This is the real-time path — no manual sync needed.
</p>
  $body$,
  'operations',
  TRUE
)
ON CONFLICT (template_key) DO UPDATE
SET subject    = EXCLUDED.subject,
    body       = EXCLUDED.body,
    category   = EXCLUDED.category,
    active     = EXCLUDED.active,
    updated_at = NOW();
