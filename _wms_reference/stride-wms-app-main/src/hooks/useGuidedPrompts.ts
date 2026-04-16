import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  GuidedPrompt,
  UserPromptSettings,
  PromptLevel,
  PromptSeverity,
  PromptWorkflow,
  PromptTriggerPoint,
  PromptContext,
  CompetencyEventType,
  TenantPromptDefaults,
  PromptCompetencyTracking,
} from '@/types/guidedPrompts';
import { DEFAULT_PROMPTS } from '@/lib/defaultPrompts';

// Severity visibility by user level:
// - training: sees info, warning, blocking (all)
// - standard: sees warning, blocking
// - advanced: sees blocking only
const SEVERITY_VISIBLE_AT_LEVEL: Record<PromptLevel, PromptSeverity[]> = {
  training: ['info', 'warning', 'blocking'],
  standard: ['warning', 'blocking'],
  advanced: ['blocking'],
};

interface ActivePromptState {
  prompt: GuidedPrompt;
  context?: PromptContext;
}

export function useGuidedPrompts() {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [userSettings, setUserSettings] = useState<UserPromptSettings | null>(null);
  const [prompts, setPrompts] = useState<GuidedPrompt[]>([]);
  const [tenantDefaults, setTenantDefaults] = useState<TenantPromptDefaults | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activePrompt, setActivePrompt] = useState<ActivePromptState | null>(null);
  const [isHelpPanelOpen, setIsHelpPanelOpen] = useState(false);
  const [helpPanelWorkflow, setHelpPanelWorkflow] = useState<PromptWorkflow | null>(null);

  const promptLevel = useMemo<PromptLevel>(() => {
    return userSettings?.prompt_level || tenantDefaults?.default_prompt_level || 'training';
  }, [userSettings?.prompt_level, tenantDefaults?.default_prompt_level]);

  // Seed prompts for tenant if not present
  const seedPromptsIfMissing = useCallback(async (tenantId: string) => {
    try {
      // Check if prompts exist for this tenant
      const { count } = await (supabase
        .from('guided_prompts') as any)
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);

      if (count === 0) {
        // Insert default prompts for this tenant
        const promptsToInsert = DEFAULT_PROMPTS.map(p => ({
          ...p,
          tenant_id: tenantId,
        }));

        await (supabase
          .from('guided_prompts') as any)
          .insert(promptsToInsert);
      }
    } catch (error) {
      // Don't block UI if seeding fails
      console.error('Error seeding prompts:', error);
    }
  }, []);

  // Ensure user settings exist
  const ensureUserSettings = useCallback(async (tenantId: string, userId: string) => {
    try {
      const { data: existing } = await (supabase
        .from('user_prompt_settings') as any)
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('user_id', userId)
        .single();

      if (existing) {
        setUserSettings(existing);
        return existing;
      }

      // Create default settings
      const { data: defaults } = await (supabase
        .from('tenant_prompt_defaults') as any)
        .select('*')
        .eq('tenant_id', tenantId)
        .single();

      const newSettings = {
        tenant_id: tenantId,
        user_id: userId,
        prompt_level: defaults?.default_prompt_level || 'training',
        prompt_reminder_days: defaults?.default_reminder_days || 30,
      };

      const { data: created, error } = await (supabase
        .from('user_prompt_settings') as any)
        .insert(newSettings)
        .select()
        .single();

      if (error) throw error;
      setUserSettings(created);
      return created;
    } catch (error) {
      console.error('Error ensuring user settings:', error);
      return null;
    }
  }, []);

  // Ensure tenant defaults exist
  const ensureTenantDefaults = useCallback(async (tenantId: string) => {
    try {
      const { data: existing } = await (supabase
        .from('tenant_prompt_defaults') as any)
        .select('*')
        .eq('tenant_id', tenantId)
        .single();

      if (existing) {
        setTenantDefaults(existing);
        return existing;
      }

      // Create default tenant settings
      const { data: created, error } = await (supabase
        .from('tenant_prompt_defaults') as any)
        .insert({ tenant_id: tenantId })
        .select()
        .single();

      if (error) throw error;
      setTenantDefaults(created);
      return created;
    } catch (error) {
      console.error('Error ensuring tenant defaults:', error);
      return null;
    }
  }, []);

  // Load prompts
  const loadPrompts = useCallback(async (tenantId: string) => {
    try {
      const { data, error } = await (supabase
        .from('guided_prompts') as any)
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('workflow')
        .order('sort_order');

      if (error) throw error;
      setPrompts(data || []);
    } catch (error) {
      console.error('Error loading prompts:', error);
    }
  }, []);

  // Initialize on mount - track the tenant/user combo we've initialized for
  const initializedForRef = useRef<string | null>(null);
  useEffect(() => {
    const tenantUserId = profile?.tenant_id && profile?.id 
      ? `${profile.tenant_id}:${profile.id}` 
      : null;
    
    // Skip if no profile yet, or if we've already initialized for this tenant/user
    if (!tenantUserId || initializedForRef.current === tenantUserId) {
      if (!tenantUserId) setIsLoading(false);
      return;
    }
    
    const init = async () => {
      initializedForRef.current = tenantUserId;
      setIsLoading(true);
      try {
        await seedPromptsIfMissing(profile.tenant_id);
        await Promise.all([
          ensureTenantDefaults(profile.tenant_id),
          ensureUserSettings(profile.tenant_id, profile.id),
          loadPrompts(profile.tenant_id),
        ]);
      } catch (error) {
        console.error('Error initializing guided prompts:', error);
      } finally {
        setIsLoading(false);
      }
    };

    init();
  }, [profile?.tenant_id, profile?.id, seedPromptsIfMissing, ensureTenantDefaults, ensureUserSettings, loadPrompts]);

  // Get prompts for a workflow (optionally filtered by trigger point)
  const getPromptsForWorkflow = useCallback((
    workflow: PromptWorkflow,
    triggerPoint?: PromptTriggerPoint
  ): GuidedPrompt[] => {
    return prompts.filter(p => {
      const matchesWorkflow = p.workflow === workflow;
      const matchesTrigger = !triggerPoint || p.trigger_point === triggerPoint;
      return matchesWorkflow && matchesTrigger;
    }).sort((a, b) => a.sort_order - b.sort_order);
  }, [prompts]);

  // Check if a prompt should be shown based on user level and prompt severity
  const shouldShowPrompt = useCallback((prompt: GuidedPrompt): boolean => {
    // Get the severities visible at the user's level
    const visibleSeverities = SEVERITY_VISIBLE_AT_LEVEL[promptLevel];

    // Use severity if available, fallback to mapping min_level for backward compatibility
    const promptSeverity = prompt.severity || (
      prompt.min_level === 'advanced' ? 'blocking' :
      prompt.min_level === 'standard' ? 'warning' :
      'info'
    );

    return visibleSeverities.includes(promptSeverity);
  }, [promptLevel]);

  // Show a prompt
  const showPrompt = useCallback((
    promptKey: string,
    context?: PromptContext
  ): boolean => {
    const prompt = prompts.find(p => p.prompt_key === promptKey);

    if (!prompt) {
      console.warn(`Prompt not found: ${promptKey}`);
      return false;
    }

    if (!shouldShowPrompt(prompt)) {
      return false;
    }

    setActivePrompt({ prompt, context });
    return true;
  }, [prompts, shouldShowPrompt]);

  // Dismiss active prompt
  const dismissActivePrompt = useCallback(() => {
    setActivePrompt(null);
  }, []);

  // Acknowledge a prompt
  const acknowledgePrompt = useCallback(async (
    promptId: string,
    confirmed: boolean,
    checklistState?: Record<string, boolean>,
    context?: PromptContext,
    status: 'acknowledged' | 'snoozed' | 'dismissed' = 'acknowledged',
    snoozeDurationMinutes?: number
  ): Promise<boolean> => {
    if (!profile?.tenant_id || !profile?.id) return false;

    try {
      const snoozedUntil = status === 'snoozed' && snoozeDurationMinutes
        ? new Date(Date.now() + snoozeDurationMinutes * 60 * 1000).toISOString()
        : null;

      const { error } = await (supabase
        .from('prompt_acknowledgments') as any)
        .insert({
          tenant_id: profile.tenant_id,
          user_id: profile.id,
          prompt_id: promptId,
          was_confirmed: confirmed,
          checklist_state: checklistState,
          context_type: context?.contextType,
          context_id: context?.contextId,
          status,
          snoozed_until: snoozedUntil,
        });

      if (error) throw error;

      dismissActivePrompt();
      return true;
    } catch (error) {
      console.error('Error acknowledging prompt:', error);
      return false;
    }
  }, [profile?.tenant_id, profile?.id, dismissActivePrompt]);

  // Snooze a prompt for a given duration
  const snoozePrompt = useCallback(async (
    promptId: string,
    durationMinutes: number = 60,
    context?: PromptContext
  ): Promise<boolean> => {
    return acknowledgePrompt(promptId, false, undefined, context, 'snoozed', durationMinutes);
  }, [acknowledgePrompt]);

  // Track competency event
  const trackCompetencyEvent = useCallback(async (
    workflow: PromptWorkflow,
    eventType: CompetencyEventType
  ): Promise<void> => {
    if (!profile?.tenant_id || !profile?.id) return;

    try {
      // Get or create tracking record
      const { data: existing } = await (supabase
        .from('prompt_competency_tracking') as any)
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('user_id', profile.id)
        .eq('workflow', workflow)
        .single();

      const updates: Partial<PromptCompetencyTracking> = {
        updated_at: new Date().toISOString(),
      };

      switch (eventType) {
        case 'task_completed':
          updates.tasks_completed = (existing?.tasks_completed || 0) + 1;
          updates.last_task_completed_at = new Date().toISOString();
          break;
        case 'task_error':
          updates.tasks_with_errors = (existing?.tasks_with_errors || 0) + 1;
          break;
        case 'missing_photo':
          updates.missing_photos_count = (existing?.missing_photos_count || 0) + 1;
          break;
        case 'location_error':
          updates.location_errors_count = (existing?.location_errors_count || 0) + 1;
          break;
        case 'failed_completion':
          updates.failed_completions_count = (existing?.failed_completions_count || 0) + 1;
          break;
      }

      if (existing) {
        await (supabase
          .from('prompt_competency_tracking') as any)
          .update(updates)
          .eq('id', existing.id);
      } else {
        await (supabase
          .from('prompt_competency_tracking') as any)
          .insert({
            tenant_id: profile.tenant_id,
            user_id: profile.id,
            workflow,
            ...updates,
          });
      }

      // Check for upgrade qualification after task completion
      if (eventType === 'task_completed') {
        await checkUpgradeQualification();
      }
    } catch (error) {
      console.error('Error tracking competency event:', error);
    }
  }, [profile?.tenant_id, profile?.id]);

  // Check if user qualifies for upgrade
  const checkUpgradeQualification = useCallback(async () => {
    if (!profile?.tenant_id || !profile?.id || !tenantDefaults) return;

    try {
      // Get all tracking records for user
      const { data: trackingRecords } = await (supabase
        .from('prompt_competency_tracking') as any)
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('user_id', profile.id);

      if (!trackingRecords) return;

      const qualifiedWorkflows: PromptWorkflow[] = [];

      for (const record of trackingRecords) {
        // Check qualification criteria
        const qualifies =
          record.tasks_completed >= tenantDefaults.competency_tasks_required &&
          record.tasks_with_errors <= tenantDefaults.competency_max_errors &&
          record.missing_photos_count <= tenantDefaults.competency_max_missing_photos &&
          record.location_errors_count <= tenantDefaults.competency_max_location_errors;

        if (qualifies && !record.qualifies_for_upgrade) {
          // Mark as qualified
          await (supabase
            .from('prompt_competency_tracking') as any)
            .update({
              qualifies_for_upgrade: true,
              qualified_at: new Date().toISOString(),
            })
            .eq('id', record.id);

          qualifiedWorkflows.push(record.workflow);
        } else if (qualifies) {
          qualifiedWorkflows.push(record.workflow);
        }
      }

      // If 3+ workflows qualified, create upgrade suggestion
      if (qualifiedWorkflows.length >= 3 && userSettings?.prompt_level === 'training') {
        await createUpgradeSuggestion(qualifiedWorkflows);
      }
    } catch (error) {
      console.error('Error checking upgrade qualification:', error);
    }
  }, [profile?.tenant_id, profile?.id, tenantDefaults, userSettings?.prompt_level]);

  // Create upgrade suggestion
  const createUpgradeSuggestion = useCallback(async (qualifiedWorkflows: PromptWorkflow[]) => {
    if (!profile?.tenant_id || !profile?.id || !tenantDefaults?.auto_suggestion_enabled) return;

    try {
      // Check if pending suggestion already exists
      const { data: existing } = await (supabase
        .from('prompt_upgrade_suggestions') as any)
        .select('id')
        .eq('tenant_id', profile.tenant_id)
        .eq('user_id', profile.id)
        .eq('status', 'pending')
        .single();

      if (existing) return;

      // Create new suggestion
      const { data: suggestion, error } = await (supabase
        .from('prompt_upgrade_suggestions') as any)
        .insert({
          tenant_id: profile.tenant_id,
          user_id: profile.id,
          current_level: 'training',
          suggested_level: 'standard',
          reason: `Qualified in ${qualifiedWorkflows.length} workflows with excellent performance`,
          qualified_workflows: qualifiedWorkflows,
          user_notified_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw error;

      // Notify user
      toast({
        title: 'Level Upgrade Available',
        description: 'You may qualify for reduced training prompts. A manager will review your progress.',
      });

      // Try to notify manager (don't block on failure)
      try {
        await (supabase
          .from('prompt_upgrade_suggestions') as any)
          .update({ manager_notified_at: new Date().toISOString() })
          .eq('id', suggestion.id);
      } catch {
        // Manager notification is optional
      }
    } catch (error) {
      console.error('Error creating upgrade suggestion:', error);
    }
  }, [profile?.tenant_id, profile?.id, tenantDefaults?.auto_suggestion_enabled, toast]);

  // Help panel functions
  const openHelpPanel = useCallback((workflow: PromptWorkflow) => {
    setHelpPanelWorkflow(workflow);
    setIsHelpPanelOpen(true);
  }, []);

  const closeHelpPanel = useCallback(() => {
    setIsHelpPanelOpen(false);
    setHelpPanelWorkflow(null);
  }, []);

  return {
    // State
    userSettings,
    promptLevel,
    isLoading,
    prompts,

    // Prompt functions
    getPromptsForWorkflow,
    showPrompt,
    shouldShowPrompt,
    acknowledgePrompt,
    snoozePrompt,
    activePrompt,
    dismissActivePrompt,

    // Competency tracking
    trackCompetencyEvent,

    // Help panel
    isHelpPanelOpen,
    helpPanelWorkflow,
    openHelpPanel,
    closeHelpPanel,
  };
}
