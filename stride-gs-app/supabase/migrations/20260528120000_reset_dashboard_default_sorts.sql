-- Reset Dashboard default sorts to "nearest due date first" (2026-05-28).
--
-- Justin: dashboard default view for everyone should be sorted by due
-- date / scheduled / oldest-waiting (urgent at top) across all three
-- Dashboard sections — Tasks, Repairs, Will Calls. Code defaults already
-- match for Tasks (taskDueDate asc) and Will Calls (wcScheduled asc),
-- and a companion code change updates Repairs from `repairCreated desc`
-- to `repairCreated asc` (oldest waiting first — proxy for "due date"
-- since repairs have no due-date column).
--
-- Users who had customized their sort kept that override via
-- user_view_prefs.prefs.sorting. This migration force-overwrites their
-- `sorting` field with the new defaults so they all snap to the new
-- shared view on next page load.
--
-- Survey before applying showed: dashboard-tasks has 2 customized rows,
-- dashboard-repairs has 0, dashboard-willcalls has 0. So only the
-- 2 Tasks rows get rewritten in practice — but the UPDATE is written
-- so it's a no-op on any future row whose page_key matches one of the
-- three but whose `sorting` is already at the target value.
--
-- Idempotent: re-running this migration is safe — the UPDATE only fires
-- on rows whose sorting differs from the target, and writes the same
-- JSON each time.

UPDATE user_view_prefs
SET prefs    = jsonb_set(
                 COALESCE(prefs, '{}'::jsonb),
                 '{sorting}',
                 '[{"id":"taskDueDate","desc":false},{"id":"taskCreated","desc":true}]'::jsonb
               ),
    updated_at = NOW()
WHERE page_key = 'dashboard-tasks'
  AND COALESCE(prefs->'sorting', 'null'::jsonb)
        != '[{"id":"taskDueDate","desc":false},{"id":"taskCreated","desc":true}]'::jsonb;

UPDATE user_view_prefs
SET prefs    = jsonb_set(
                 COALESCE(prefs, '{}'::jsonb),
                 '{sorting}',
                 '[{"id":"repairCreated","desc":false}]'::jsonb
               ),
    updated_at = NOW()
WHERE page_key = 'dashboard-repairs'
  AND COALESCE(prefs->'sorting', 'null'::jsonb)
        != '[{"id":"repairCreated","desc":false}]'::jsonb;

UPDATE user_view_prefs
SET prefs    = jsonb_set(
                 COALESCE(prefs, '{}'::jsonb),
                 '{sorting}',
                 '[{"id":"wcScheduled","desc":false}]'::jsonb
               ),
    updated_at = NOW()
WHERE page_key = 'dashboard-willcalls'
  AND COALESCE(prefs->'sorting', 'null'::jsonb)
        != '[{"id":"wcScheduled","desc":false}]'::jsonb;
