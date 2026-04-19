-- ============================================================
-- Stride GS App — Task Due Date + Priority
--
-- Adds due_date (date) and priority (text, default 'Normal')
-- to the tasks table, matching the new GAS Tasks sheet columns.
-- ============================================================

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS priority text DEFAULT 'Normal';
