-- Pluralize ALL repair email templates for multi-item (batch) repairs
-- =====================================================================
-- PR #689/#692 made the REPAIR_QUOTE email list every item on a repair
-- ({{ITEM_ID}} = "64001, 64002") and pluralize its wording with two
-- count-aware tokens:
--   {{ITEM_NOUN}}     → "item"    | "items"
--   {{ITEM_ID_LABEL}} → "Item ID" | "Item IDs"
-- ...but the OTHER repair emails were left singular. A batch repair's quote-
-- request, approve, decline, and completion emails each hard-coded the word
-- "item"/"Item ID" and showed only the primary item ID in the subject + dark
-- header card (the item-details TABLE already listed all items — only the
-- header/subject lagged). A client replied confused ("one chair, or both?").
--
-- This migration finishes the job: swap the static singular literals in the
-- four remaining repair templates for the same count-aware tokens, which the
-- edge functions now emit (request-repair-quote-sb, respond-repair-quote-sb,
-- complete-repair-sb — all updated to list ALL repair_items in {{ITEM_ID}}).
--
-- DEPLOY ORDER IS LOAD-BEARING (same as PR #692): the edge functions that
-- emit {{ITEM_NOUN}} / {{ITEM_ID_LABEL}} ship FIRST, THEN this migration
-- introduces the placeholders. send-email only replaces tokens the caller
-- passes, so if this migration ran before the EF deploy, a send in the gap
-- would render a literal "{{ITEM_NOUN}}" / "{{ITEM_ID_LABEL}}".
--
-- Subjects ARE tokenized by send-email (they already interpolate {{ITEM_ID}}
-- and {{CLIENT_NAME}}), so {{ITEM_ID_LABEL}} in a subject is replaced too.
-- REPAIR_APPROVED / REPAIR_DECLINED subjects read "{{ITEM_ID}} - {{CLIENT_NAME}}"
-- with no "Item ID" word, so they need no subject change — {{ITEM_ID}} now
-- carries the full comma-joined list on its own.
--
-- The dash in REPAIR_COMPLETE's header sentence is an em-dash (U+2014). Each
-- search string below was verified to occur EXACTLY ONCE in the live body /
-- subject (the item-details table's own "Item ID" column header is rendered
-- by the edge function, not stored in the template body, so it is untouched).
-- replace() is a no-op when the substring is absent, so this migration is
-- idempotent; each verification block fails loudly if the swap didn't take.

-- ── REPAIR_QUOTE_REQUEST ────────────────────────────────────────────
-- subject:  "… Item ID {{ITEM_ID}}"  → "… {{ITEM_ID_LABEL}} {{ITEM_ID}}"
-- body card: ">Item ID</div>"        → ">{{ITEM_ID_LABEL}}</div>"
UPDATE email_templates
SET subject = replace(subject, 'Item ID {{ITEM_ID}}', '{{ITEM_ID_LABEL}} {{ITEM_ID}}'),
    body    = replace(body,    '>Item ID</div>',      '>{{ITEM_ID_LABEL}}</div>')
WHERE template_key = 'REPAIR_QUOTE_REQUEST';

-- ── REPAIR_APPROVED ─────────────────────────────────────────────────
-- body sentence: "for item {{ITEM_ID}}." → "for {{ITEM_NOUN}} {{ITEM_ID}}."
-- body card:     ">Item ID</div>"        → ">{{ITEM_ID_LABEL}}</div>"
UPDATE email_templates
SET body = replace(
             replace(body, 'for item {{ITEM_ID}}', 'for {{ITEM_NOUN}} {{ITEM_ID}}'),
             '>Item ID</div>', '>{{ITEM_ID_LABEL}}</div>'
           )
WHERE template_key = 'REPAIR_APPROVED';

-- ── REPAIR_DECLINED ─────────────────────────────────────────────────
-- body sentence: "for item {{ITEM_ID}} (" → "for {{ITEM_NOUN}} {{ITEM_ID}} ("
-- body card:     ">Item ID</div>"         → ">{{ITEM_ID_LABEL}}</div>"
UPDATE email_templates
SET body = replace(
             replace(body, 'for item {{ITEM_ID}}', 'for {{ITEM_NOUN}} {{ITEM_ID}}'),
             '>Item ID</div>', '>{{ITEM_ID_LABEL}}</div>'
           )
WHERE template_key = 'REPAIR_DECLINED';

-- ── REPAIR_COMPLETE ─────────────────────────────────────────────────
-- subject:       "… Item ID {{ITEM_ID}} …"     → "… {{ITEM_ID_LABEL}} {{ITEM_ID}} …"
-- body sentence: "— item {{ITEM_ID}}."(em-dash) → "— {{ITEM_NOUN}} {{ITEM_ID}}."
UPDATE email_templates
SET subject = replace(subject, 'Item ID {{ITEM_ID}}', '{{ITEM_ID_LABEL}} {{ITEM_ID}}'),
    body    = replace(body, E'— item {{ITEM_ID}}.', E'— {{ITEM_NOUN}} {{ITEM_ID}}.')
WHERE template_key = 'REPAIR_COMPLETE';

-- ── Verify every swap took (fail loudly on regression) ──────────────
DO $$
DECLARE
  ok boolean;
BEGIN
  -- REPAIR_QUOTE_REQUEST
  SELECT subject LIKE '%{{ITEM_ID_LABEL}} {{ITEM_ID}}%'
     AND body    LIKE '%>{{ITEM_ID_LABEL}}</div>%'
     AND subject NOT LIKE '%Item ID {{ITEM_ID}}%'
     AND body    NOT LIKE '%>Item ID</div>%'
    INTO ok FROM email_templates WHERE template_key = 'REPAIR_QUOTE_REQUEST';
  IF NOT FOUND THEN RAISE EXCEPTION 'REPAIR_QUOTE_REQUEST row not found'; END IF;
  IF NOT ok THEN RAISE EXCEPTION 'REPAIR_QUOTE_REQUEST plural token swap did not apply'; END IF;

  -- REPAIR_APPROVED
  SELECT body LIKE '%for {{ITEM_NOUN}} {{ITEM_ID}}%'
     AND body LIKE '%>{{ITEM_ID_LABEL}}</div>%'
     AND body NOT LIKE '%for item {{ITEM_ID}}%'
     AND body NOT LIKE '%>Item ID</div>%'
    INTO ok FROM email_templates WHERE template_key = 'REPAIR_APPROVED';
  IF NOT FOUND THEN RAISE EXCEPTION 'REPAIR_APPROVED row not found'; END IF;
  IF NOT ok THEN RAISE EXCEPTION 'REPAIR_APPROVED plural token swap did not apply'; END IF;

  -- REPAIR_DECLINED
  SELECT body LIKE '%for {{ITEM_NOUN}} {{ITEM_ID}}%'
     AND body LIKE '%>{{ITEM_ID_LABEL}}</div>%'
     AND body NOT LIKE '%for item {{ITEM_ID}}%'
     AND body NOT LIKE '%>Item ID</div>%'
    INTO ok FROM email_templates WHERE template_key = 'REPAIR_DECLINED';
  IF NOT FOUND THEN RAISE EXCEPTION 'REPAIR_DECLINED row not found'; END IF;
  IF NOT ok THEN RAISE EXCEPTION 'REPAIR_DECLINED plural token swap did not apply'; END IF;

  -- REPAIR_COMPLETE
  SELECT subject LIKE '%{{ITEM_ID_LABEL}} {{ITEM_ID}}%'
     AND body    LIKE '%{{ITEM_NOUN}} {{ITEM_ID}}.%'
     AND subject NOT LIKE '%Item ID {{ITEM_ID}}%'
     AND body    NOT LIKE E'%— item {{ITEM_ID}}.%'
    INTO ok FROM email_templates WHERE template_key = 'REPAIR_COMPLETE';
  IF NOT FOUND THEN RAISE EXCEPTION 'REPAIR_COMPLETE row not found'; END IF;
  IF NOT ok THEN RAISE EXCEPTION 'REPAIR_COMPLETE plural token swap did not apply'; END IF;
END $$;
