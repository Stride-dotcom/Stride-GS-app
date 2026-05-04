-- Migration: rewrite §3 of the DOC_CLIENT_TC body for the new autopay model.
--
-- Previously: §3 forced autopay for every client ("when your account
-- activates, you're authorizing us to auto-charge…"). Late fee triggered
-- at 30 days past due.
--
-- New model:
--   • Card on file is collected at intake (always, except for grandfathered
--     clients on terms with no card)
--   • Autopay is optional — opt-in checkbox on Step 4
--   • Methods: credit (3% processor fee from bank), debit, ACH
--   • 7-day grace period before late fees accrue
--   • Card on file authorizes past-due charges as safety net
--   • Late fee rate stays 1.5%/month (already in original §3)
--   • 30-day dispute window added
--
-- Voice match: friendly contractions, "In short:" callouts with the orange
-- left border (`#FFF7F0` background, `#E8692A` border-left), inline option
-- styling consistent with §2.A / §2.B's `#F5F2EE` blocks.
--
-- Surgical replacement via regexp_replace so §1, §2, §4, §5, signature
-- block all stay byte-identical. The body's SHA-256 changes (intentional
-- per Decision #21 — that's what triggers the re-sign cron).

UPDATE email_templates
SET
  body = regexp_replace(
    body,
    '<section data-tc-section="billing"[\s\S]*?</section>',
    E'<section data-tc-section="billing" data-tc-label="Billing & payment">\n'
    || E'  <h2>3. Billing &amp; payment</h2>\n'
    || E'  <p style="background:#FFF7F0;border-left:3px solid #E8692A;padding:10px 14px;margin:10px 0;border-radius:4px;"><strong>In short:</strong> we invoice monthly, you''ve got 15 days to flag anything weird, then payment processes — either auto-charged (if you''re enrolled in autopay) or due by your invoice date if you''re on terms. Either way, we keep a payment method on file with our processor as a past-due safety net. We never see or store your full payment details.</p>\n'
    || E'\n'
    || E'  <h3>How we invoice</h3>\n'
    || E'  <p>We send invoices monthly (or more often if you want). Every line item ties back to the work order, task, repair, or will-call that authorized it — no surprise charges, no mystery fees.</p>\n'
    || E'\n'
    || E'  <h3>Your review window</h3>\n'
    || E'  <p>You''ve got <strong>15 days</strong> from the invoice send-date to look it over and flag anything that looks off. Just email us. After that window, the invoice is accepted.</p>\n'
    || E'\n'
    || E'  <h3>Payment methods on file</h3>\n'
    || E'  <p>We accept <strong>credit cards, debit cards, and ACH bank transfers</strong> through our merchant processor, <a href="https://paymnt.io">Paymnt.io</a>. We never see or store your full card or bank info — Paymnt.io does. You can update or remove your payment method anytime through their portal.</p>\n'
    || E'  <p><strong>Heads up:</strong> credit-card payments incur a <strong>3% processing fee</strong> charged by the bank — not by us. Debit and ACH have no processing fee.</p>\n'
    || E'\n'
    || E'  <h3>Autopay (optional)</h3>\n'
    || E'  <p>If you''ve enrolled in autopay, you''re authorizing us to charge your payment method on file the business day after the 15-day review window closes. You can switch to terms billing or cancel autopay anytime — just email us.</p>\n'
    || E'\n'
    || E'  <h3>Terms billing</h3>\n'
    || E'  <p>If you''re on terms instead of autopay, payment is due by the date on each invoice. Even on terms, we keep a payment method on file as a past-due safety net — see below.</p>\n'
    || E'\n'
    || E'  <h3>Past-due charges and late fees</h3>\n'
    || E'  <p>An invoice is past due if not paid within <strong>7 days</strong> of the due date. Past-due invoices accrue interest at <strong>1.5% per month</strong> (that''s 18% APR) or the max Washington law allows — whichever is lower, assessed monthly until paid.</p>\n'
    || E'  <p>If you''ve authorized us to keep a payment method on file, we can charge it for any past-due balance plus accrued late fees, without further notice, after the 7-day grace period.</p>\n'
    || E'\n'
    || E'  <h3>Disputing a line item</h3>\n'
    || E'  <p>If you dispute something, cite the specific line and tell us why within <strong>30 days</strong> of the charge date. The rest of the invoice still gets paid on schedule. We''ll get back to you within 10 business days. Disputes raised after 30 days are waived.</p>\n'
    || E'\n'
    || E'  <h3>Will-call COD pickups</h3>\n'
    || E'  <p>If a will-call is marked "COD" (cash on delivery), we''ll need payment before we release the items. No payment = no release.</p>\n'
    || E'</section>',
    'g'
  ),
  notes = COALESCE(notes, '') || E'\n[2026-05-04] §3 rewritten for autopay opt-in model. Late fee grace period changed 30→7 days. Added 3% CC fee disclosure, methods accepted, terms-billing branch, dispute window. Body SHA-256 changes — re-sign cron will fire for all clients.',
  updated_at = NOW()
WHERE template_key = 'DOC_CLIENT_TC';
