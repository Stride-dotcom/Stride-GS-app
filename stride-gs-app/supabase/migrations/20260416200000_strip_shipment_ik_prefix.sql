-- Session 70 fix #4 — strip leaked [IK:<uuid>] idempotency-key prefix from
-- existing rows in public.shipments.notes. StrideAPI.gs v38.61.0 stops new
-- writes from leaking the prefix; this one-time UPDATE cleans up historical
-- rows that shipped before the fix.
--
-- Pattern: notes starts with "[IK:<anything but ]>]" followed by optional
-- whitespace. Matches Gmail-style `[IK:19d7792c-9341-4cee-9bce-962665df1997] `.
UPDATE public.shipments
SET notes = regexp_replace(notes, '^\[IK:[^\]]*\]\s*', '')
WHERE notes LIKE '[IK:%]%';
