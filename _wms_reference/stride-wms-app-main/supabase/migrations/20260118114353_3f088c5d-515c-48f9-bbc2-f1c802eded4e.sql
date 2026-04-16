-- Add unable_to_complete_note column to tasks table for storing the reason when a task cannot be completed
ALTER TABLE public.tasks 
ADD COLUMN IF NOT EXISTS unable_to_complete_note TEXT;