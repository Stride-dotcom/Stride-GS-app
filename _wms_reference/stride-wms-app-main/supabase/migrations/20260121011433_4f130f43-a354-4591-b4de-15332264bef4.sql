-- Simplify task priority to only 'normal' and 'urgent'
-- Step 1: Remove old priority constraint
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_priority_check;

-- Step 2: Migrate existing 'low', 'medium', or 'high' priorities to 'normal'
UPDATE tasks 
SET priority = 'normal' 
WHERE priority IN ('low', 'medium', 'high');

-- Step 3: Add new constraint with only normal and urgent
ALTER TABLE tasks ADD CONSTRAINT tasks_priority_check 
  CHECK (priority IN ('normal', 'urgent'));

-- Step 4: Ensure default is 'normal'
ALTER TABLE tasks ALTER COLUMN priority SET DEFAULT 'normal';