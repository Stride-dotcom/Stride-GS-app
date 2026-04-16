-- Add test alert preferences to user_dashboard_preferences
ALTER TABLE user_dashboard_preferences 
ADD COLUMN IF NOT EXISTS test_email TEXT,
ADD COLUMN IF NOT EXISTS test_phone TEXT;