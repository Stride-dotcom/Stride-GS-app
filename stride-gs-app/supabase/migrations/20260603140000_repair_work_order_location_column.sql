-- Add a Location column to the DOC_REPAIR_WORK_ORDER items table
-- =================================================================
-- The repair work order's ITEM DETAILS table showed Item ID / Qty / Vendor /
-- Description / Sidemark / Room but not the item's warehouse Location — so the
-- staff working the repair couldn't see where to pull the item from. Add a
-- Location header + a {{ITEM_LOCATION}} cell (monospace, matching the location
-- styling in the receiving / will-call docs) after Room.
--
-- Both renderers fill {{ITEM_LOCATION}} as of this change: React docTokens.ts
-- (buildRepairTokens) and GAS StrideAPI.gs (handleStartRepair_ +
-- handleRespondToRepairQuote_). This migration is applied AFTER those deploy,
-- so the token is never left unrendered.
--
-- Idempotent: the WHERE guard skips the row if the Location header is already
-- present (re-run safe).

UPDATE email_templates
SET body = replace(
             replace(
               body,
               '<th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Room</th></tr>',
               '<th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Room</th><th style="padding:5px 6px;font-size:9px;color:#fff;font-weight:bold;text-align:left;">Location</th></tr>'
             ),
             '{{ITEM_ROOM}}</td></tr>',
             '{{ITEM_ROOM}}</td><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;font-family:monospace;">{{ITEM_LOCATION}}</td></tr>'
           )
WHERE template_key = 'DOC_REPAIR_WORK_ORDER'
  AND body NOT LIKE '%>Location</th>%';

DO $$
DECLARE
  ok boolean;
BEGIN
  SELECT body LIKE '%>Location</th>%' AND body LIKE '%{{ITEM_LOCATION}}%'
    INTO ok
  FROM email_templates WHERE template_key = 'DOC_REPAIR_WORK_ORDER';
  IF NOT ok THEN
    RAISE EXCEPTION 'DOC_REPAIR_WORK_ORDER Location column not present after update';
  END IF;
END $$;
