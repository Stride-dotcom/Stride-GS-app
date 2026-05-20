-- Doc-template header parity + DOC_RECEIVING print-CSS catch-up.
--
-- The 2026-05-13 print-CSS-parity migration brought DOC_TASK_WORK_ORDER and
-- DOC_REPAIR_WORK_ORDER into parity with DOC_WILL_CALL_RELEASE
-- (@page{size:letter;margin:0.4in;} + table{width:100%}) but missed
-- DOC_RECEIVING entirely — its body still carries
-- `table{border-collapse:collapse;width:8in;}` with no @page rule, so on
-- print the 8in content overflows the ~7.5in printable area (browser
-- default ~0.5in margins) and the items table looks pushed left /
-- truncated. This migration extends the same fix to DOC_RECEIVING.
--
-- Separately, the header-text block ("Stride Logistics WMS · address")
-- on DOC_RECEIVING / DOC_REPAIR_WORK_ORDER / DOC_TASK_WORK_ORDER uses
-- `<span>Stride Logistics </span><span>WMS</span><br><span>address</span>`
-- which can wrap "Stride Logistics" / "WMS" onto two lines when the
-- print engine compresses the column under tight margins. The
-- DOC_WILL_CALL_RELEASE template already shipped with the right
-- structure: `<div white-space:nowrap>` wrapping the title + a
-- separate nowrap div for the address. Bring the other three docs to
-- match — title stays one line tight to the logo on every doc.
--
-- All UPDATEs are idempotent: the find-string is the exact pre-fix
-- HTML, the replace-string contains a marker comment so re-running
-- the migration is a no-op (the second pass finds no match).

-- ── 1. Print-CSS parity for DOC_RECEIVING ────────────────────────────
UPDATE email_templates
   SET body = REPLACE(
     body,
     'body{font-family:Arial,Helvetica,sans-serif;color:#1E293B;margin:0;padding:0;}table{border-collapse:collapse;width:8in;}',
     '@page{size:letter;margin:0.4in;}html,body{margin:0;padding:0;}*{box-sizing:border-box;}body{font-family:Arial,Helvetica,sans-serif;color:#1E293B;}table{border-collapse:collapse;width:100%;}.no-break{page-break-inside:avoid;}'
   ),
       updated_at = now()
 WHERE template_key = 'DOC_RECEIVING';

-- DOC_RECEIVING also wraps its content in `<div style="width:8in;margin:0;">`
-- which keeps it locked to 8in regardless of the table CSS above. Drop
-- the explicit 8in on the outer wrapper so the whole doc inherits the
-- @page printable width set above.
UPDATE email_templates
   SET body = REPLACE(
     body,
     '<div style="width:8in;margin:0;">',
     '<div style="width:100%;margin:0;">'
   ),
       updated_at = now()
 WHERE template_key = 'DOC_RECEIVING';

-- ── 2. Header-text block parity ──────────────────────────────────────
-- Three docs share the same broken block. One REPLACE per template
-- (no global UPDATE … WHERE template_key IN (…) so failed matches on a
-- previously-fixed row don't silently no-op a row that still needs
-- the fix). The new block uses div+nowrap so the title row can't wrap.
UPDATE email_templates
   SET body = REPLACE(
     body,
     '<span style="font-size:20px;font-weight:bold;color:#1E293B;">Stride Logistics </span><span style="font-size:20px;font-weight:bold;color:#E85D2D;">WMS</span><br><span style="font-size:10px;color:#64748B;">Kent, WA &middot; whse@stridenw.com &middot; 206-550-1848</span>',
     '<div style="font-size:20px;font-weight:bold;line-height:1.1;white-space:nowrap;"><span style="color:#1E293B;">Stride Logistics</span> <span style="color:#E85D2D;">WMS</span></div><div style="font-size:10px;color:#64748B;margin-top:2px;white-space:nowrap;">Kent, WA &middot; whse@stridenw.com &middot; 206-550-1848</div>'
   ),
       updated_at = now()
 WHERE template_key IN ('DOC_RECEIVING','DOC_REPAIR_WORK_ORDER','DOC_TASK_WORK_ORDER');

-- Tighten the logo→text gap on the same three. The current cell uses
-- `padding-right:10px;` which leaves an extra ~7px of dead space
-- between the logo and "Stride Logistics" vs. the WC template's
-- `padding-right:8px;`. Match WC for visual parity.
UPDATE email_templates
   SET body = REPLACE(
     body,
     '<td style="vertical-align:middle;padding-right:10px;"><img src="{{LOGO_URL}}" alt="Logo" style="height:38px;width:38px;" /></td>',
     '<td style="vertical-align:middle;padding-right:8px;"><img src="{{LOGO_URL}}" alt="Logo" style="height:38px;width:38px;display:block;" /></td>'
   ),
       updated_at = now()
 WHERE template_key IN ('DOC_RECEIVING','DOC_REPAIR_WORK_ORDER','DOC_TASK_WORK_ORDER');

-- ── 3. Sanity guards ────────────────────────────────────────────────
-- Verify the fix landed (no `width:8in` on Receiving, all 4 docs have
-- @page, no `<br>` between Stride Logistics and the address line). If
-- any of these assertions fail, the migration aborts before commit.
DO $$
DECLARE
  bad_count int;
BEGIN
  SELECT count(*) INTO bad_count
    FROM email_templates
   WHERE template_key = 'DOC_RECEIVING'
     AND body LIKE '%table{border-collapse:collapse;width:8in;}%';
  IF bad_count > 0 THEN
    RAISE EXCEPTION 'DOC_RECEIVING still has hardcoded width:8in table CSS — REPLACE missed';
  END IF;

  SELECT count(*) INTO bad_count
    FROM email_templates
   WHERE template_key IN ('DOC_WILL_CALL_RELEASE','DOC_RECEIVING','DOC_REPAIR_WORK_ORDER','DOC_TASK_WORK_ORDER')
     AND body NOT LIKE '%@page{size:letter%';
  IF bad_count > 0 THEN
    RAISE EXCEPTION '% of 4 doc templates missing @page print-CSS rule', bad_count;
  END IF;

  SELECT count(*) INTO bad_count
    FROM email_templates
   WHERE template_key IN ('DOC_RECEIVING','DOC_REPAIR_WORK_ORDER','DOC_TASK_WORK_ORDER')
     AND body LIKE '%Stride Logistics </span><span style="font-size:20px;font-weight:bold;color:#E85D2D;">WMS</span><br>%';
  IF bad_count > 0 THEN
    RAISE EXCEPTION '% of 3 docs still carry the old span+<br> title block', bad_count;
  END IF;
END;
$$;
