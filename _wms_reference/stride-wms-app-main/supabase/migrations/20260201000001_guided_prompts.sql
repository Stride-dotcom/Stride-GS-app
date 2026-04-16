-- GUIDED PROMPTS SYSTEM
-- Tracks user experience levels and provides context-aware guidance during workflows

-- Create experience level enum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'experience_level') THEN
    CREATE TYPE experience_level AS ENUM ('new', 'learning', 'experienced');
  END IF;
END $$;

-- User Prompt Settings - Stores per-user guidance preferences
CREATE TABLE IF NOT EXISTS user_prompt_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  experience_level experience_level NOT NULL DEFAULT 'new',
  show_tooltips BOOLEAN NOT NULL DEFAULT true,
  show_contextual_help BOOLEAN NOT NULL DEFAULT true,
  task_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_level_change_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT user_prompt_settings_user_unique UNIQUE (user_id)
);

-- Guided Prompts - Template library of contextual prompts
CREATE TABLE IF NOT EXISTS guided_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE, -- NULL = global/system prompts
  workflow_key TEXT NOT NULL, -- e.g., 'receiving', 'inspection', 'release'
  step_key TEXT NOT NULL, -- e.g., 'photo_capture', 'quantity_confirm'
  experience_level experience_level NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  icon TEXT, -- Icon name for display
  action_label TEXT, -- Button label if applicable
  display_type TEXT NOT NULL DEFAULT 'tooltip', -- 'tooltip', 'modal', 'inline'
  priority INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT guided_prompts_unique UNIQUE (tenant_id, workflow_key, step_key, experience_level)
);

-- User Prompt Dismissals - Track which prompts a user has dismissed
CREATE TABLE IF NOT EXISTS user_prompt_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  prompt_id UUID NOT NULL REFERENCES guided_prompts(id) ON DELETE CASCADE,
  dismissed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  snooze_until TIMESTAMPTZ, -- NULL = permanently dismissed

  CONSTRAINT user_prompt_dismissals_unique UNIQUE (user_id, prompt_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_user_prompt_settings_user ON user_prompt_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_prompt_settings_tenant ON user_prompt_settings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_guided_prompts_workflow ON guided_prompts(workflow_key, step_key);
CREATE INDEX IF NOT EXISTS idx_guided_prompts_tenant ON guided_prompts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_prompt_dismissals_user ON user_prompt_dismissals(user_id);

-- Enable RLS
ALTER TABLE user_prompt_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE guided_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_prompt_dismissals ENABLE ROW LEVEL SECURITY;

-- RLS for user_prompt_settings (user can only see/edit their own settings)
DROP POLICY IF EXISTS "user_prompt_settings_own" ON user_prompt_settings;
CREATE POLICY "user_prompt_settings_own" ON user_prompt_settings
  FOR ALL
  USING (user_id = auth.uid());

-- RLS for guided_prompts (tenant isolation, plus access to global prompts)
DROP POLICY IF EXISTS "guided_prompts_tenant_access" ON guided_prompts;
CREATE POLICY "guided_prompts_tenant_access" ON guided_prompts
  FOR SELECT
  USING (
    tenant_id IS NULL -- Global prompts visible to all
    OR tenant_id::text = auth.jwt() ->> 'tenant_id'
  );

-- Only tenant admins can manage prompts
DROP POLICY IF EXISTS "guided_prompts_tenant_manage" ON guided_prompts;
CREATE POLICY "guided_prompts_tenant_manage" ON guided_prompts
  FOR ALL
  USING (
    tenant_id::text = auth.jwt() ->> 'tenant_id'
  );

-- RLS for user_prompt_dismissals (user can only see/edit their own)
DROP POLICY IF EXISTS "user_prompt_dismissals_own" ON user_prompt_dismissals;
CREATE POLICY "user_prompt_dismissals_own" ON user_prompt_dismissals
  FOR ALL
  USING (user_id = auth.uid());

-- Trigger for updated_at on user_prompt_settings
CREATE OR REPLACE FUNCTION update_user_prompt_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_prompt_settings_updated_at ON user_prompt_settings;
CREATE TRIGGER user_prompt_settings_updated_at
  BEFORE UPDATE ON user_prompt_settings
  FOR EACH ROW
  EXECUTE FUNCTION update_user_prompt_settings_updated_at();

-- Trigger for updated_at on guided_prompts
CREATE OR REPLACE FUNCTION update_guided_prompts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guided_prompts_updated_at ON guided_prompts;
CREATE TRIGGER guided_prompts_updated_at
  BEFORE UPDATE ON guided_prompts
  FOR EACH ROW
  EXECUTE FUNCTION update_guided_prompts_updated_at();

-- Comments for documentation
COMMENT ON TABLE user_prompt_settings IS 'Stores per-user guidance preferences and experience level for the guided prompts system';
COMMENT ON TABLE guided_prompts IS 'Library of contextual prompts shown during workflows based on user experience level';
COMMENT ON TABLE user_prompt_dismissals IS 'Tracks which prompts a user has dismissed or snoozed';
COMMENT ON COLUMN user_prompt_settings.experience_level IS 'User experience level: new, learning, or experienced';
COMMENT ON COLUMN user_prompt_settings.task_counts IS 'JSON object tracking completed task counts per workflow type';
COMMENT ON COLUMN guided_prompts.workflow_key IS 'Workflow identifier (e.g., receiving, inspection, release)';
COMMENT ON COLUMN guided_prompts.step_key IS 'Step within workflow (e.g., photo_capture, quantity_confirm)';

-- Insert some default global prompts for new users
INSERT INTO guided_prompts (tenant_id, workflow_key, step_key, experience_level, title, message, display_type, priority)
VALUES
  (NULL, 'receiving', 'photo_capture', 'new', 'Photo Tips', 'Take clear photos of all labels and any visible damage. Good photos help with claims!', 'tooltip', 10),
  (NULL, 'receiving', 'quantity_confirm', 'new', 'Count Carefully', 'Double-check your count matches the packing slip. Report any discrepancies.', 'tooltip', 10),
  (NULL, 'inspection', 'damage_check', 'new', 'Check Everything', 'Inspect items for hidden damage - look under packaging and inside boxes.', 'tooltip', 10),
  (NULL, 'inspection', 'notes', 'new', 'Be Descriptive', 'Include specific details: size, location, and type of any issues found.', 'inline', 5),
  (NULL, 'release', 'verify_recipient', 'new', 'Verify Identity', 'Always confirm the recipient matches the release authorization before handing over items.', 'modal', 20)
ON CONFLICT (tenant_id, workflow_key, step_key, experience_level) DO NOTHING;
