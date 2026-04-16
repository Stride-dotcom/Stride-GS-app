-- Add column to track when overdue alert was sent (prevents duplicate alerts)
ALTER TABLE tasks 
ADD COLUMN IF NOT EXISTS overdue_alert_sent_at TIMESTAMPTZ DEFAULT NULL;

-- Create index for efficient querying of overdue tasks
CREATE INDEX IF NOT EXISTS idx_tasks_overdue_check 
ON tasks (due_date, status, deleted_at, overdue_alert_sent_at)
WHERE status NOT IN ('completed', 'cancelled') 
  AND deleted_at IS NULL 
  AND overdue_alert_sent_at IS NULL;