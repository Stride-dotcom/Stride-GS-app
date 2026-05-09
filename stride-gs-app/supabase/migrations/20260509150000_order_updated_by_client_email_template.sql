-- Email template: ORDER_UPDATED_BY_CLIENT
--
-- Fires when a client edits a non-draft delivery order via the
-- CreateDeliveryOrderModal "Save Changes" path. The save flips
-- review_status BACK to 'pending_review' regardless of whatever it was
-- (approved / scheduled / pending_review again), and this email goes
-- to the office distro to flag that an existing order needs another
-- look — and a re-push to DispatchTrack if it had previously been
-- pushed.
--
-- Token vocabulary mirrors ORDER_REVISION_REQUESTED so notify-order-revision
-- can reuse its build path with one switch on the action. CTA points to
-- the order detail page so the reviewer can re-approve in one click.
--
-- Recipients: NOTIFICATION_EMAILS (office). The submitter is NOT cc'd
-- because the submitter IS the client who just made the edit — they
-- already know.

INSERT INTO public.email_templates (
  template_key,
  subject,
  body,
  notes,
  recipients,
  category,
  active
) VALUES (
  'ORDER_UPDATED_BY_CLIENT',
  '🔄 Order Updated by Client — {{ORDER_NUMBER}} needs re-review',
  E'<div style="font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', sans-serif; max-width: 640px; color: #111;">\n'
  || E'  <div style="background: #2563EB; color: #fff; padding: 16px 24px; border-radius: 8px 8px 0 0;">\n'
  || E'    <h2 style="margin: 0; font-size: 18px;">Order updated by {{CLIENT_NAME}}</h2>\n'
  || E'    <div style="font-size: 12px; opacity: 0.9; margin-top: 4px;">{{ORDER_NUMBER}} · {{ORDER_TYPE}}</div>\n'
  || E'  </div>\n'
  || E'  <div style="border: 1px solid #E5E7EB; border-top: 0; padding: 20px 24px; border-radius: 0 0 8px 8px; background: #fff;">\n'
  || E'    <p style="margin-top: 0; font-size: 14px;">'
  || E'<strong>{{CLIENT_NAME}}</strong> just updated this delivery order. The status has been flipped back to <strong>Pending Review</strong>; please review the changes and re-approve. '
  || E'If the order had already been pushed to DispatchTrack, you''ll see a <strong>Republish to DT</strong> button on the detail page after approving — clicking it replaces the existing DT order with the updated payload.'
  || E'</p>\n'
  || E'\n'
  || E'    <table style="width:100%; border-collapse: collapse; margin: 16px 0; font-size: 13px;">\n'
  || E'      <tr><td style="padding:6px 12px 6px 0; color:#6B7280; width: 130px;">Order</td><td style="padding:6px 0;"><strong>{{ORDER_NUMBER}}</strong> ({{ORDER_TYPE}})</td></tr>\n'
  || E'      <tr><td style="padding:6px 12px 6px 0; color:#6B7280;">Client</td><td style="padding:6px 0;">{{CLIENT_NAME}}</td></tr>\n'
  || E'      <tr><td style="padding:6px 12px 6px 0; color:#6B7280;">Contact</td><td style="padding:6px 0;">{{CONTACT_NAME}}</td></tr>\n'
  || E'      <tr><td style="padding:6px 12px 6px 0; color:#6B7280;">Address</td><td style="padding:6px 0;">{{CONTACT_ADDRESS}}</td></tr>\n'
  || E'      <tr><td style="padding:6px 12px 6px 0; color:#6B7280;">Service Date</td><td style="padding:6px 0;">{{SERVICE_DATE}}</td></tr>\n'
  || E'      <tr><td style="padding:6px 12px 6px 0; color:#6B7280;">Items</td><td style="padding:6px 0;">{{ITEM_COUNT}}</td></tr>\n'
  || E'      <tr><td style="padding:6px 12px 6px 0; color:#6B7280;">Total</td><td style="padding:6px 0;"><strong>{{ORDER_TOTAL}}</strong></td></tr>\n'
  || E'      <tr><td style="padding:6px 12px 6px 0; color:#6B7280;">Updated by</td><td style="padding:6px 0;">{{REVIEWER_NAME}}</td></tr>\n'
  || E'    </table>\n'
  || E'\n'
  || E'    <div style="background: #EFF6FF; border-left: 3px solid #2563EB; padding: 12px 14px; margin: 14px 0; border-radius: 4px;">\n'
  || E'      <div style="font-size: 11px; color: #1E40AF; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; margin-bottom: 6px;">Audit trail</div>\n'
  || E'      <div style="font-size: 13px; color: #111; white-space: pre-wrap;">{{REVIEW_NOTES}}</div>\n'
  || E'    </div>\n'
  || E'\n'
  || E'    <div style="text-align:center; margin: 24px 0;">\n'
  || E'      <a href="{{ORDER_LINK}}" style="display:inline-block; padding:12px 28px; background:#2563EB; color:#fff; text-decoration:none; border-radius:6px; font-weight:600;">Review Updated Order</a>\n'
  || E'    </div>\n'
  || E'\n'
  || E'    <p style="color:#6B7280; font-size:11px; margin-bottom:0; text-align:center;">You''re receiving this because you''re on the office NOTIFICATION_EMAILS list.</p>\n'
  || E'  </div>\n'
  || E'</div>',
  E'Sent when a client edits a non-draft delivery order (pending_review / approved / scheduled). The save handler flips review_status back to ''pending_review'' so the office knows to re-review. If the order was previously pushed to DispatchTrack, the OrderPage Push to DT pill auto-surfaces after re-approval (its visibility predicate compares updated_at to pushed_to_dt_at).\n\nTokens (matches ORDER_REVISION_REQUESTED):\n  ORDER_NUMBER     dt_identifier (+ pickup leg suffix on P+D)\n  ORDER_TYPE       Delivery / Pickup / Service Only / Pickup & Delivery\n  CLIENT_NAME      tenant client name\n  CONTACT_NAME     order contact_name\n  CONTACT_ADDRESS  one-line concatenated address\n  SERVICE_DATE     local_service_date (or empty)\n  ITEM_COUNT       count of dt_order_items\n  ORDER_TOTAL      formatted dollar amount or "Quote Required"\n  REVIEWER_NAME    in this template, the CLIENT name (the actor)\n  REVIEW_NOTES     "Updated by [client] on [date]" + any prior review_notes\n  ORDER_LINK       /#/orders/<id>?client=<tenant>\n\nRecipients: NOTIFICATION_EMAILS (office only). The client who edited is NOT cc''d because they already know — they just clicked Save Changes.',
  '',
  'order',
  TRUE
)
ON CONFLICT (template_key) DO NOTHING;
