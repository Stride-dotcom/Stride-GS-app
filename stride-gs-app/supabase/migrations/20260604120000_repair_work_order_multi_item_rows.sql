-- Render ALL items in the DOC_REPAIR_WORK_ORDER work order
-- =================================================================
-- The repair work order's ITEM DETAILS table hardcoded a SINGLE data row
-- (Item ID / Qty / Vendor / Description / Sidemark / Room / Location, filled
-- by the {{ITEM_*}} tokens). Multi-item repairs (public.repair_items, N rows)
-- therefore printed only the primary item — staff working a multi-item repair
-- never saw the other items on the printout.
--
-- Replace that one hardcoded <tr> with a single {{ITEM_ROWS}} token. The React
-- renderer (docTokens.ts buildRepairTokens) now fills {{ITEM_ROWS}} with one
-- <tr> per item (identical cell styling), falling back to a single synthesized
-- row for legacy single-item repairs.
--
-- Deploy order: buildRepairTokens still emits the legacy single {{ITEM_*}}
-- tokens AS WELL as {{ITEM_ROWS}}, so neither the pre- nor post-migration
-- template ever renders a literal placeholder regardless of which ships first.
-- The two active GAS renderers of this doc (handleStartRepair_ /
-- handleRespondToRepairQuote_) are commented out (PR #507 — React DocRenderer
-- is the only live renderer), so they are unaffected by the token swap.
--
-- Idempotent: WHERE guard skips the row once {{ITEM_ROWS}} is present, and the
-- verification block fails loudly if the swap didn't take.

UPDATE email_templates
SET body = replace(
             body,
             '<tr><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;font-weight:bold;">{{ITEM_ID}}</td><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;text-align:center;">{{ITEM_QTY}}</td><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;">{{ITEM_VENDOR}}</td><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;">{{ITEM_DESC}}</td><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;">{{ITEM_SIDEMARK}}</td><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;">{{ITEM_ROOM}}</td><td style="padding:6px;font-size:11px;border-bottom:1px solid #E2E8F0;font-family:monospace;">{{ITEM_LOCATION}}</td></tr>',
             '{{ITEM_ROWS}}'
           )
WHERE template_key = 'DOC_REPAIR_WORK_ORDER'
  AND body NOT LIKE '%{{ITEM_ROWS}}%';

DO $$
DECLARE
  ok boolean;
BEGIN
  SELECT body LIKE '%{{ITEM_ROWS}}%' AND body NOT LIKE '%{{ITEM_ID}}%'
    INTO ok
  FROM email_templates WHERE template_key = 'DOC_REPAIR_WORK_ORDER';
  -- No row at all → the template was never seeded; fail loudly rather than
  -- pass silently (IF NOT NULL is not true, so the row-absent case needs its
  -- own guard).
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DOC_REPAIR_WORK_ORDER template row not found in email_templates';
  END IF;
  IF NOT ok THEN
    RAISE EXCEPTION 'DOC_REPAIR_WORK_ORDER multi-item {{ITEM_ROWS}} swap did not apply (single-row {{ITEM_ID}} token still present or {{ITEM_ROWS}} missing)';
  END IF;
END $$;
