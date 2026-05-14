-- Task / Repair Work Order templates were missing @page print CSS and
-- used a hardcoded `table{width:8in;}` that overflowed Letter paper once
-- browser default print margins (~0.5in each side, so 7.5in printable)
-- kicked in. The WC Release template already shipped with the right
-- combo: @page{size:letter;margin:0.4in;} + *{box-sizing:border-box;}
-- + table{width:100%}. Bring Task / Repair into parity.

UPDATE email_templates
   SET body = REPLACE(
     body,
     'body{font-family:Arial,Helvetica,sans-serif;color:#1E293B;margin:0;padding:0;}table{border-collapse:collapse;width:8in;}',
     '@page{size:letter;margin:0.4in;}html,body{margin:0;padding:0;}*{box-sizing:border-box;}body{font-family:Arial,Helvetica,sans-serif;color:#1E293B;}table{border-collapse:collapse;width:100%;}.no-break{page-break-inside:avoid;}'
   ),
       updated_at = now()
 WHERE template_key IN ('DOC_TASK_WORK_ORDER','DOC_REPAIR_WORK_ORDER');
