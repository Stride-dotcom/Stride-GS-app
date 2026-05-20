-- Follow-up to 20260520220000: the prior migration dropped the `width:8in`
-- on DOC_RECEIVING's outer wrapper but missed the same wrapper on
-- DOC_REPAIR_WORK_ORDER + DOC_TASK_WORK_ORDER. The 2026-05-13 print-CSS
-- parity migration only touched the body-level `<style>table{width:8in}`
-- rule, not the inline `<div style="width:8in;margin:0;">` near the top
-- of every doc. Both lock the layout to 8in regardless of the @page
-- margin set above. Drop them so the contents flow to the @page-defined
-- printable width on every doc.

UPDATE email_templates
   SET body = REPLACE(
     body,
     '<div style="width:8in;margin:0;">',
     '<div style="width:100%;margin:0;">'
   ),
       updated_at = now()
 WHERE template_key IN ('DOC_REPAIR_WORK_ORDER','DOC_TASK_WORK_ORDER');

DO $$
DECLARE bad_count int;
BEGIN
  SELECT count(*) INTO bad_count
    FROM email_templates
   WHERE template_key IN ('DOC_WILL_CALL_RELEASE','DOC_RECEIVING','DOC_REPAIR_WORK_ORDER','DOC_TASK_WORK_ORDER')
     AND body LIKE '%width:8in%';
  IF bad_count > 0 THEN
    RAISE EXCEPTION '% doc template(s) still carry a width:8in artifact', bad_count;
  END IF;
END;
$$;
