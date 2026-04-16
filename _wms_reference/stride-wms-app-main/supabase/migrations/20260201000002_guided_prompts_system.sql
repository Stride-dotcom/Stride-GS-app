-- ============================================================================
-- GUIDED PROMPTS SYSTEM
-- Training Mode, Help System, and Competency Tracking
-- Includes: severity-based filtering, snooze support, versioning, conditions
-- ============================================================================

-- ============================================================================
-- CLEANUP: Drop existing tables if they exist (for clean migration)
-- Order matters due to foreign key constraints
-- ============================================================================

DROP TABLE IF EXISTS public.prompt_acknowledgments CASCADE;
DROP TABLE IF EXISTS public.prompt_competency_tracking CASCADE;
DROP TABLE IF EXISTS public.prompt_upgrade_suggestions CASCADE;
DROP TABLE IF EXISTS public.tenant_prompt_defaults CASCADE;
DROP TABLE IF EXISTS public.user_prompt_settings CASCADE;
DROP TABLE IF EXISTS public.guided_prompts CASCADE;

-- Also drop functions if they exist
DROP FUNCTION IF EXISTS public.validate_workflow_completion(TEXT, UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS public.can_complete_workflow(TEXT, UUID, TEXT);

-- ============================================================================
-- 1. USER_PROMPT_SETTINGS
-- Stores individual user prompt preferences and upgrade notification status
-- ============================================================================

CREATE TABLE public.user_prompt_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  -- User's current prompt level: training, standard, advanced
  prompt_level TEXT NOT NULL DEFAULT 'training'
    CHECK (prompt_level IN ('training', 'standard', 'advanced')),
  prompts_enabled_at TIMESTAMPTZ DEFAULT NOW(),

  prompt_reminder_days INTEGER DEFAULT 30,
  reminder_sent_at TIMESTAMPTZ,

  user_notified_for_upgrade BOOLEAN DEFAULT FALSE,
  manager_notified_for_upgrade BOOLEAN DEFAULT FALSE,

  updated_by UUID REFERENCES public.users(id),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (tenant_id, user_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_user_prompt_settings_tenant ON public.user_prompt_settings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_user_prompt_settings_user ON public.user_prompt_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_user_prompt_settings_level ON public.user_prompt_settings(prompt_level);

-- RLS
ALTER TABLE public.user_prompt_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "user_prompt_settings_select" ON public.user_prompt_settings;
CREATE POLICY "user_prompt_settings_select" ON public.user_prompt_settings
  FOR SELECT USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "user_prompt_settings_insert" ON public.user_prompt_settings;
CREATE POLICY "user_prompt_settings_insert" ON public.user_prompt_settings
  FOR INSERT WITH CHECK (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "user_prompt_settings_update_own" ON public.user_prompt_settings;
CREATE POLICY "user_prompt_settings_update_own" ON public.user_prompt_settings
  FOR UPDATE USING (
    user_id = auth.uid()
    OR (
      tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.roles r ON r.id = ur.role_id
        WHERE ur.user_id = auth.uid()
        AND r.name IN ('tenant_admin', 'manager')
        AND ur.deleted_at IS NULL
      )
    )
  );

DROP POLICY IF EXISTS "user_prompt_settings_delete" ON public.user_prompt_settings;
CREATE POLICY "user_prompt_settings_delete" ON public.user_prompt_settings
  FOR DELETE USING (
    tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
      AND r.name = 'tenant_admin'
      AND ur.deleted_at IS NULL
    )
  );

-- ============================================================================
-- 2. GUIDED_PROMPTS
-- Stores all prompt definitions (tenant_id NULL = global base prompts)
-- ============================================================================

CREATE TABLE public.guided_prompts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL tenant_id = global base prompt, can be overridden by tenant
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE CASCADE,

  prompt_key TEXT NOT NULL,
  workflow TEXT NOT NULL,
  trigger_point TEXT NOT NULL CHECK (trigger_point IN ('before', 'during', 'after')),
  prompt_type TEXT NOT NULL CHECK (prompt_type IN ('modal', 'slide_panel', 'tooltip', 'toast', 'bottom_sheet')),

  -- Deprecated: use severity instead
  min_level TEXT NOT NULL DEFAULT 'training'
    CHECK (min_level IN ('training', 'standard', 'advanced')),

  -- Severity determines visibility by user level:
  -- 'info' = training only, 'warning' = training+standard, 'blocking' = everyone
  severity TEXT NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'warning', 'blocking')),

  title TEXT NOT NULL,
  message TEXT NOT NULL,
  tip_text TEXT,

  checklist_items JSONB,
  buttons JSONB,

  requires_confirmation BOOLEAN DEFAULT FALSE,
  sort_order DECIMAL(10,2) DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,

  -- Versioning
  version INTEGER DEFAULT 1,
  published_at TIMESTAMPTZ DEFAULT NOW(),
  archived_at TIMESTAMPTZ,

  -- Override tracking: points to base prompt this overrides
  base_prompt_id UUID REFERENCES public.guided_prompts(id) ON DELETE SET NULL,

  -- Complex validation conditions
  conditions JSONB,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Unique constraint that handles global prompts (tenant_id NULL)
-- Only applies to base prompts (not overrides)
CREATE UNIQUE INDEX IF NOT EXISTS idx_guided_prompts_unique_key
  ON public.guided_prompts (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), prompt_key)
  WHERE base_prompt_id IS NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_guided_prompts_tenant ON public.guided_prompts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_guided_prompts_workflow ON public.guided_prompts(workflow);
CREATE INDEX IF NOT EXISTS idx_guided_prompts_trigger ON public.guided_prompts(trigger_point);
CREATE INDEX IF NOT EXISTS idx_guided_prompts_severity ON public.guided_prompts(severity);
CREATE INDEX IF NOT EXISTS idx_guided_prompts_active ON public.guided_prompts(is_active) WHERE is_active = TRUE;

-- RLS - Global prompts (tenant_id IS NULL) visible to all authenticated users
ALTER TABLE public.guided_prompts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "guided_prompts_select" ON public.guided_prompts;
CREATE POLICY "guided_prompts_select" ON public.guided_prompts
  FOR SELECT USING (
    tenant_id IS NULL  -- global prompts visible to all authenticated users
    OR tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "guided_prompts_insert" ON public.guided_prompts;
CREATE POLICY "guided_prompts_insert" ON public.guided_prompts
  FOR INSERT WITH CHECK (
    tenant_id IS NOT NULL
    AND tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('tenant_admin', 'manager')
      AND ur.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "guided_prompts_update" ON public.guided_prompts;
CREATE POLICY "guided_prompts_update" ON public.guided_prompts
  FOR UPDATE USING (
    tenant_id IS NOT NULL
    AND tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('tenant_admin', 'manager')
      AND ur.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "guided_prompts_delete" ON public.guided_prompts;
CREATE POLICY "guided_prompts_delete" ON public.guided_prompts
  FOR DELETE USING (
    tenant_id IS NOT NULL
    AND tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
      AND r.name = 'tenant_admin'
      AND ur.deleted_at IS NULL
    )
  );

-- ============================================================================
-- 3. PROMPT_ACKNOWLEDGMENTS
-- Tracks when users acknowledge/confirm prompts (with snooze support)
-- ============================================================================

CREATE TABLE public.prompt_acknowledgments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  prompt_id UUID NOT NULL REFERENCES public.guided_prompts(id) ON DELETE CASCADE,

  context_type TEXT,
  context_id UUID,

  was_confirmed BOOLEAN DEFAULT FALSE,
  checklist_state JSONB,

  -- Snooze support
  status TEXT DEFAULT 'acknowledged'
    CHECK (status IN ('acknowledged', 'snoozed', 'dismissed')),
  snoozed_until TIMESTAMPTZ,

  acknowledged_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_prompt_acknowledgments_tenant ON public.prompt_acknowledgments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_prompt_acknowledgments_user ON public.prompt_acknowledgments(user_id);
CREATE INDEX IF NOT EXISTS idx_prompt_acknowledgments_prompt ON public.prompt_acknowledgments(prompt_id);
CREATE INDEX IF NOT EXISTS idx_prompt_acknowledgments_context ON public.prompt_acknowledgments(context_type, context_id);
CREATE INDEX IF NOT EXISTS idx_prompt_acknowledgments_status ON public.prompt_acknowledgments(status);

-- RLS
ALTER TABLE public.prompt_acknowledgments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prompt_acknowledgments_select" ON public.prompt_acknowledgments;
CREATE POLICY "prompt_acknowledgments_select" ON public.prompt_acknowledgments
  FOR SELECT USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "prompt_acknowledgments_insert" ON public.prompt_acknowledgments;
CREATE POLICY "prompt_acknowledgments_insert" ON public.prompt_acknowledgments
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  );

-- ============================================================================
-- 4. PROMPT_COMPETENCY_TRACKING
-- Tracks user performance per workflow for upgrade qualification
-- ============================================================================

CREATE TABLE public.prompt_competency_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workflow TEXT NOT NULL,

  tasks_completed INTEGER DEFAULT 0,
  tasks_with_errors INTEGER DEFAULT 0,
  missing_photos_count INTEGER DEFAULT 0,
  location_errors_count INTEGER DEFAULT 0,
  failed_completions_count INTEGER DEFAULT 0,

  last_task_completed_at TIMESTAMPTZ,

  qualifies_for_upgrade BOOLEAN DEFAULT FALSE,
  qualified_at TIMESTAMPTZ,

  -- Analytics
  blocked_action_count INTEGER DEFAULT 0,
  prompts_shown_count INTEGER DEFAULT 0,
  prompts_confirmed_count INTEGER DEFAULT 0,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (tenant_id, user_id, workflow)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_prompt_competency_tenant ON public.prompt_competency_tracking(tenant_id);
CREATE INDEX IF NOT EXISTS idx_prompt_competency_user ON public.prompt_competency_tracking(user_id);
CREATE INDEX IF NOT EXISTS idx_prompt_competency_workflow ON public.prompt_competency_tracking(workflow);
CREATE INDEX IF NOT EXISTS idx_prompt_competency_qualified ON public.prompt_competency_tracking(qualifies_for_upgrade) WHERE qualifies_for_upgrade = TRUE;

-- RLS
ALTER TABLE public.prompt_competency_tracking ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prompt_competency_select" ON public.prompt_competency_tracking;
CREATE POLICY "prompt_competency_select" ON public.prompt_competency_tracking
  FOR SELECT USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "prompt_competency_insert" ON public.prompt_competency_tracking;
CREATE POLICY "prompt_competency_insert" ON public.prompt_competency_tracking
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
  );

DROP POLICY IF EXISTS "prompt_competency_update" ON public.prompt_competency_tracking;
CREATE POLICY "prompt_competency_update" ON public.prompt_competency_tracking
  FOR UPDATE USING (
    user_id = auth.uid()
    OR (
      tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
      AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        JOIN public.roles r ON r.id = ur.role_id
        WHERE ur.user_id = auth.uid()
        AND r.name IN ('tenant_admin', 'manager')
        AND ur.deleted_at IS NULL
      )
    )
  );

-- ============================================================================
-- 5. PROMPT_UPGRADE_SUGGESTIONS
-- Tracks pending upgrade suggestions for manager review
-- ============================================================================

CREATE TABLE public.prompt_upgrade_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,

  current_level TEXT NOT NULL CHECK (current_level IN ('training', 'standard', 'advanced')),
  suggested_level TEXT NOT NULL CHECK (suggested_level IN ('training', 'standard', 'advanced')),
  reason TEXT NOT NULL,
  qualified_workflows JSONB,

  user_notified_at TIMESTAMPTZ,
  manager_notified_at TIMESTAMPTZ,

  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'dismissed')),
  resolved_by UUID REFERENCES public.users(id),
  resolved_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_prompt_upgrade_suggestions_tenant ON public.prompt_upgrade_suggestions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_prompt_upgrade_suggestions_user ON public.prompt_upgrade_suggestions(user_id);
CREATE INDEX IF NOT EXISTS idx_prompt_upgrade_suggestions_status ON public.prompt_upgrade_suggestions(status) WHERE status = 'pending';

-- RLS
ALTER TABLE public.prompt_upgrade_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "prompt_upgrade_suggestions_select" ON public.prompt_upgrade_suggestions;
CREATE POLICY "prompt_upgrade_suggestions_select" ON public.prompt_upgrade_suggestions
  FOR SELECT USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "prompt_upgrade_suggestions_insert" ON public.prompt_upgrade_suggestions;
CREATE POLICY "prompt_upgrade_suggestions_insert" ON public.prompt_upgrade_suggestions
  FOR INSERT WITH CHECK (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "prompt_upgrade_suggestions_update" ON public.prompt_upgrade_suggestions;
CREATE POLICY "prompt_upgrade_suggestions_update" ON public.prompt_upgrade_suggestions
  FOR UPDATE USING (
    tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('tenant_admin', 'manager')
      AND ur.deleted_at IS NULL
    )
  );

-- ============================================================================
-- 6. TENANT_PROMPT_DEFAULTS
-- Org-level prompt configuration
-- ============================================================================

CREATE TABLE public.tenant_prompt_defaults (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,

  default_prompt_level TEXT DEFAULT 'training'
    CHECK (default_prompt_level IN ('training', 'standard', 'advanced')),
  default_reminder_days INTEGER DEFAULT 30,

  competency_tasks_required INTEGER DEFAULT 10,
  competency_max_errors INTEGER DEFAULT 0,
  competency_max_missing_photos INTEGER DEFAULT 0,
  competency_max_location_errors INTEGER DEFAULT 0,

  auto_suggestion_enabled BOOLEAN DEFAULT TRUE,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE (tenant_id)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tenant_prompt_defaults_tenant ON public.tenant_prompt_defaults(tenant_id);

-- RLS
ALTER TABLE public.tenant_prompt_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_prompt_defaults_select" ON public.tenant_prompt_defaults;
CREATE POLICY "tenant_prompt_defaults_select" ON public.tenant_prompt_defaults
  FOR SELECT USING (tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid()));

DROP POLICY IF EXISTS "tenant_prompt_defaults_insert" ON public.tenant_prompt_defaults;
CREATE POLICY "tenant_prompt_defaults_insert" ON public.tenant_prompt_defaults
  FOR INSERT WITH CHECK (
    tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
      AND r.name = 'tenant_admin'
      AND ur.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS "tenant_prompt_defaults_update" ON public.tenant_prompt_defaults;
CREATE POLICY "tenant_prompt_defaults_update" ON public.tenant_prompt_defaults
  FOR UPDATE USING (
    tenant_id = (SELECT tenant_id FROM public.users WHERE id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = auth.uid()
      AND r.name IN ('tenant_admin', 'manager')
      AND ur.deleted_at IS NULL
    )
  );

-- ============================================================================
-- 7. SERVER-SIDE VALIDATION FUNCTIONS
-- ============================================================================

-- Validate workflow completion - returns prompts that should be shown
CREATE OR REPLACE FUNCTION public.validate_workflow_completion(
  p_entity_type TEXT,
  p_entity_id UUID,
  p_workflow TEXT,
  p_user_id UUID DEFAULT NULL
)
RETURNS TABLE (
  prompt_key TEXT,
  severity TEXT,
  title TEXT,
  message TEXT,
  is_blocking BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_tenant_id UUID;
  v_user_level TEXT;
BEGIN
  -- Get user and tenant
  v_user_id := COALESCE(p_user_id, auth.uid());
  SELECT tenant_id INTO v_tenant_id FROM public.users WHERE id = v_user_id;

  -- Get user's prompt level
  SELECT prompt_level INTO v_user_level
  FROM public.user_prompt_settings
  WHERE user_id = v_user_id AND tenant_id = v_tenant_id;

  v_user_level := COALESCE(v_user_level, 'training');

  -- Return prompts that should be shown based on severity and user level
  -- training: sees info, warning, blocking
  -- standard: sees warning, blocking
  -- advanced: sees blocking only
  RETURN QUERY
  SELECT
    gp.prompt_key,
    gp.severity,
    gp.title,
    gp.message,
    (gp.severity = 'blocking') AS is_blocking
  FROM public.guided_prompts gp
  WHERE gp.workflow = p_workflow
    AND gp.is_active = TRUE
    AND gp.archived_at IS NULL
    AND (gp.tenant_id IS NULL OR gp.tenant_id = v_tenant_id)
    AND (
      -- Training users see all severities
      (v_user_level = 'training')
      -- Standard users see warning and blocking
      OR (v_user_level = 'standard' AND gp.severity IN ('warning', 'blocking'))
      -- Advanced users see blocking only
      OR (v_user_level = 'advanced' AND gp.severity = 'blocking')
    )
    -- Check if user hasn't already acknowledged this prompt for this entity
    AND NOT EXISTS (
      SELECT 1 FROM public.prompt_acknowledgments pa
      WHERE pa.prompt_id = gp.id
        AND pa.user_id = v_user_id
        AND pa.context_type = p_entity_type
        AND pa.context_id = p_entity_id
        AND pa.was_confirmed = TRUE
        AND (pa.status != 'snoozed' OR pa.snoozed_until < NOW())
    )
  ORDER BY gp.sort_order;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.validate_workflow_completion TO authenticated;

-- Check if user can complete workflow (no blocking prompts pending)
CREATE OR REPLACE FUNCTION public.can_complete_workflow(
  p_entity_type TEXT,
  p_entity_id UUID,
  p_workflow TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_has_blocking BOOLEAN;
BEGIN
  -- Check if any blocking prompts haven't been acknowledged
  SELECT EXISTS (
    SELECT 1 FROM public.validate_workflow_completion(p_entity_type, p_entity_id, p_workflow)
    WHERE is_blocking = TRUE
  ) INTO v_has_blocking;

  RETURN NOT v_has_blocking;
END;
$$;

-- Grant execute permission
GRANT EXECUTE ON FUNCTION public.can_complete_workflow TO authenticated;

-- ============================================================================
-- COMMENTS
-- ============================================================================

COMMENT ON TABLE public.guided_prompts IS 'Guided prompt definitions for training mode. tenant_id=NULL for global base prompts.';
COMMENT ON COLUMN public.guided_prompts.severity IS 'info=training only, warning=training+standard, blocking=everyone';
COMMENT ON COLUMN public.guided_prompts.conditions IS 'JSONB conditions for when to show prompt. Operators: eq, ne, in, not_in, gt, lt, gte, lte, is_null, is_not_null, contains';
COMMENT ON COLUMN public.guided_prompts.workflow IS 'Workflow types: receiving, inspection, assembly, repair, movement, stocktake, scan_hub, outbound, claims, will_call';

-- ============================================================================
-- DONE
-- ============================================================================
