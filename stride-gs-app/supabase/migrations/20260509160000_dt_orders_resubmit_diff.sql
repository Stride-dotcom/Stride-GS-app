-- dt_orders.last_resubmit_* — capture WHAT changed when a client edits
-- a non-draft delivery order, so staff can scan the diff at a glance
-- on the OrderPage and in the office email.
--
-- last_resubmit_diff (jsonb):
--   { "<column>": { "old": <prev>, "new": <curr> }, ... }
--   Plus a synthetic 'items' key when the count changed:
--     { "items": { "old_count": N, "new_count": M } }
--   Cleared when staff Approves (banner disappears for the next iteration).
--
-- last_resubmit_at (timestamptz): timestamp of the most recent client
--   resubmit. Drives banner visibility on OrderPage.
--
-- last_resubmit_by (text): client display name / email for "Updated by ___".
--
-- Note: dt_orders is NOT in the parity_dryrun mirror set (per
-- MIGRATION_STATUS.md), so no parity_dryrun.dt_orders ALTER is required.

ALTER TABLE public.dt_orders
  ADD COLUMN IF NOT EXISTS last_resubmit_diff jsonb,
  ADD COLUMN IF NOT EXISTS last_resubmit_at   timestamptz,
  ADD COLUMN IF NOT EXISTS last_resubmit_by   text;

COMMENT ON COLUMN public.dt_orders.last_resubmit_diff
  IS 'JSONB diff captured when a client edits a non-draft order. Shape: { "<column>": { "old": <v>, "new": <v> } }. Cleared on staff Approve.';

-- Update the ORDER_UPDATED_BY_CLIENT email template body to render the
-- changes inline. Uses an HTML <ul> populated by the edge function via
-- the {{CHANGES_LIST}} token.
UPDATE public.email_templates
SET body =
  E'<div style="font-family: -apple-system, BlinkMacSystemFont, ''Segoe UI'', sans-serif; max-width: 640px; color: #111;">\n'
  || E'  <div style="background: #2563EB; color: #fff; padding: 16px 24px; border-radius: 8px 8px 0 0;">\n'
  || E'    <h2 style="margin: 0; font-size: 18px;">Order updated by {{CLIENT_NAME}}</h2>\n'
  || E'    <div style="font-size: 12px; opacity: 0.9; margin-top: 4px;">{{ORDER_NUMBER}} · {{ORDER_TYPE}}</div>\n'
  || E'  </div>\n'
  || E'  <div style="border: 1px solid #E5E7EB; border-top: 0; padding: 20px 24px; border-radius: 0 0 8px 8px; background: #fff;">\n'
  || E'    <p style="margin-top: 0; font-size: 14px;"><strong>{{CLIENT_NAME}}</strong> just updated this delivery order. The status has been flipped back to <strong>Pending Review</strong>; please review the changes and re-approve. If the order had already been pushed to DispatchTrack, you''ll see a <strong>Republish to DT</strong> button on the detail page after approving — clicking it replaces the existing DT order with the updated payload.</p>\n'
  || E'\n'
  || E'    <div style="background: #EFF6FF; border-left: 3px solid #2563EB; padding: 12px 14px; margin: 14px 0; border-radius: 4px;">\n'
  || E'      <div style="font-size: 11px; color: #1E40AF; text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; margin-bottom: 6px;">Changes</div>\n'
  || E'      <div style="font-size: 13px; color: #111;">{{CHANGES_LIST}}</div>\n'
  || E'    </div>\n'
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
  || E'    <div style="text-align:center; margin: 24px 0;">\n'
  || E'      <a href="{{ORDER_LINK}}" style="display:inline-block; padding:12px 28px; background:#2563EB; color:#fff; text-decoration:none; border-radius:6px; font-weight:600;">Review Updated Order</a>\n'
  || E'    </div>\n'
  || E'\n'
  || E'    <p style="color:#6B7280; font-size:11px; margin-bottom:0; text-align:center;">You''re receiving this because you''re on the office NOTIFICATION_EMAILS list.</p>\n'
  || E'  </div>\n'
  || E'</div>',
  updated_at = now()
WHERE template_key = 'ORDER_UPDATED_BY_CLIENT';
