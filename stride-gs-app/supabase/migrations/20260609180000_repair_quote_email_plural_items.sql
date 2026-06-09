-- Pluralize the REPAIR_QUOTE email header for multi-item repairs
-- =================================================================
-- The REPAIR_QUOTE template hard-coded the singular word "item" in the dark
-- header card ("Repair quote ready for {{CLIENT_NAME}} — item {{ITEM_ID}}")
-- and the summary-card label ("Item ID"). PR #689 made {{ITEM_ID}} list ALL
-- of a repair's items (e.g. "64001, 64002"), but the surrounding wording
-- stayed singular, so a 2-item quote read "— item 64001, 64002" / "Item ID:
-- 64001, 64002". A client replied confused ("one chair, or both?").
--
-- Swap the two static literals for count-aware tokens the send-repair-quote-sb
-- edge function now supplies:
--   {{ITEM_NOUN}}     → "item"   | "items"
--   {{ITEM_ID_LABEL}} → "Item ID" | "Item IDs"
--
-- Deploy order is LOAD-BEARING: the edge function (which emits these two
-- tokens) ships FIRST, then this migration introduces the placeholders. If
-- the migration ran first, a send in the gap would render a literal
-- "{{ITEM_NOUN}}" because send-email only replaces tokens the caller passes.
--
-- The dash is an em-dash (U+2014); the search strings below are byte-exact
-- against the live body and each occurs exactly once (the item-details table's
-- own "Item ID" column header is rendered by the edge function, not stored in
-- the template body, so it is not affected).
--
-- replace() is a no-op when the substring is absent, so this migration is
-- idempotent; the verification block fails loudly if the swap didn't take.

UPDATE email_templates
SET body = replace(
             replace(
               body,
               '{{CLIENT_NAME}} — item {{ITEM_ID}}',
               '{{CLIENT_NAME}} — {{ITEM_NOUN}} {{ITEM_ID}}'
             ),
             '>Item ID</div>',
             '>{{ITEM_ID_LABEL}}</div>'
           )
WHERE template_key = 'REPAIR_QUOTE';

DO $$
DECLARE
  ok boolean;
BEGIN
  SELECT body LIKE '%{{ITEM_NOUN}} {{ITEM_ID}}%'
     AND body LIKE '%{{ITEM_ID_LABEL}}%'
     AND body NOT LIKE '%— item {{ITEM_ID}}%'
     AND body NOT LIKE '%>Item ID</div>%'
    INTO ok
  FROM email_templates WHERE template_key = 'REPAIR_QUOTE';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPAIR_QUOTE template row not found in email_templates';
  END IF;
  IF NOT ok THEN
    RAISE EXCEPTION 'REPAIR_QUOTE plural-item token swap did not apply (old singular literal still present or new tokens missing)';
  END IF;
END $$;
