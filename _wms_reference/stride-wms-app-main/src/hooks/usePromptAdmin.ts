import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  GuidedPrompt,
  UserPromptSettings,
  TenantPromptDefaults,
  PromptUpgradeSuggestion,
  PromptLevel,
} from '@/types/guidedPrompts';

interface UserWithSettings extends UserPromptSettings {
  users?: {
    first_name: string;
    last_name: string;
    email: string;
  };
}

interface SuggestionWithUser extends PromptUpgradeSuggestion {
  users?: {
    first_name: string;
    last_name: string;
    email: string;
  };
}

export function usePromptAdmin() {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [allUserSettings, setAllUserSettings] = useState<UserWithSettings[]>([]);
  const [tenantDefaults, setTenantDefaults] = useState<TenantPromptDefaults | null>(null);
  const [pendingSuggestions, setPendingSuggestions] = useState<SuggestionWithUser[]>([]);
  const [allPrompts, setAllPrompts] = useState<GuidedPrompt[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load all data
  const loadData = useCallback(async () => {
    if (!profile?.tenant_id) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      // Load all user settings with user info
      const { data: userSettings } = await (supabase
        .from('user_prompt_settings') as any)
        .select(`
          *,
          users:user_id(first_name, last_name, email)
        `)
        .eq('tenant_id', profile.tenant_id);

      setAllUserSettings(userSettings || []);

      // Load tenant defaults
      const { data: defaults } = await (supabase
        .from('tenant_prompt_defaults') as any)
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .single();

      setTenantDefaults(defaults);

      // Load pending suggestions with user info
      const { data: suggestions } = await (supabase
        .from('prompt_upgrade_suggestions') as any)
        .select(`
          *,
          users:user_id(first_name, last_name, email)
        `)
        .eq('tenant_id', profile.tenant_id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      setPendingSuggestions(suggestions || []);

      // Load all prompts
      const { data: prompts } = await (supabase
        .from('guided_prompts') as any)
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .order('workflow')
        .order('sort_order');

      setAllPrompts(prompts || []);
    } catch (error) {
      console.error('Error loading prompt admin data:', error);
    } finally {
      setIsLoading(false);
    }
  }, [profile?.tenant_id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Update user settings
  const updateUserSettings = useCallback(async (
    userId: string,
    updates: Partial<UserPromptSettings>
  ): Promise<boolean> => {
    if (!profile?.tenant_id || !profile?.id) return false;

    try {
      const { error } = await (supabase
        .from('user_prompt_settings') as any)
        .update({
          ...updates,
          updated_by: profile.id,
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', profile.tenant_id)
        .eq('user_id', userId);

      if (error) throw error;

      toast({
        title: 'Settings Updated',
        description: 'User prompt settings have been updated.',
      });

      await loadData();
      return true;
    } catch (error) {
      console.error('Error updating user settings:', error);
      toast({
        title: 'Error',
        description: 'Failed to update user settings.',
        variant: 'destructive',
      });
      return false;
    }
  }, [profile?.tenant_id, profile?.id, loadData, toast]);

  // Update tenant defaults
  const updateTenantDefaults = useCallback(async (
    updates: Partial<TenantPromptDefaults>
  ): Promise<boolean> => {
    if (!profile?.tenant_id) return false;

    try {
      const { error } = await (supabase
        .from('tenant_prompt_defaults') as any)
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', profile.tenant_id);

      if (error) throw error;

      toast({
        title: 'Defaults Updated',
        description: 'Organization prompt defaults have been updated.',
      });

      await loadData();
      return true;
    } catch (error) {
      console.error('Error updating tenant defaults:', error);
      toast({
        title: 'Error',
        description: 'Failed to update organization defaults.',
        variant: 'destructive',
      });
      return false;
    }
  }, [profile?.tenant_id, loadData, toast]);

  // Approve upgrade suggestion
  const approveSuggestion = useCallback(async (
    suggestionId: string
  ): Promise<boolean> => {
    if (!profile?.tenant_id || !profile?.id) return false;

    try {
      // Get the suggestion
      const { data: suggestion } = await (supabase
        .from('prompt_upgrade_suggestions') as any)
        .select('*')
        .eq('id', suggestionId)
        .single();

      if (!suggestion) throw new Error('Suggestion not found');

      // Update user's prompt level
      await (supabase
        .from('user_prompt_settings') as any)
        .update({
          prompt_level: suggestion.suggested_level,
          updated_by: profile.id,
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', profile.tenant_id)
        .eq('user_id', suggestion.user_id);

      // Mark suggestion as approved
      const { error } = await (supabase
        .from('prompt_upgrade_suggestions') as any)
        .update({
          status: 'approved',
          resolved_by: profile.id,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', suggestionId);

      if (error) throw error;

      toast({
        title: 'Upgrade Approved',
        description: 'User has been upgraded to the new prompt level.',
      });

      await loadData();
      return true;
    } catch (error) {
      console.error('Error approving suggestion:', error);
      toast({
        title: 'Error',
        description: 'Failed to approve upgrade.',
        variant: 'destructive',
      });
      return false;
    }
  }, [profile?.tenant_id, profile?.id, loadData, toast]);

  // Dismiss upgrade suggestion
  const dismissSuggestion = useCallback(async (
    suggestionId: string
  ): Promise<boolean> => {
    if (!profile?.tenant_id || !profile?.id) return false;

    try {
      const { error } = await (supabase
        .from('prompt_upgrade_suggestions') as any)
        .update({
          status: 'dismissed',
          resolved_by: profile.id,
          resolved_at: new Date().toISOString(),
        })
        .eq('id', suggestionId);

      if (error) throw error;

      toast({
        title: 'Suggestion Dismissed',
        description: 'The upgrade suggestion has been dismissed.',
      });

      await loadData();
      return true;
    } catch (error) {
      console.error('Error dismissing suggestion:', error);
      toast({
        title: 'Error',
        description: 'Failed to dismiss suggestion.',
        variant: 'destructive',
      });
      return false;
    }
  }, [profile?.tenant_id, profile?.id, loadData, toast]);

  // Toggle prompt active state
  const togglePromptActive = useCallback(async (
    promptId: string,
    isActive: boolean
  ): Promise<boolean> => {
    if (!profile?.tenant_id) return false;

    try {
      const { error } = await (supabase
        .from('guided_prompts') as any)
        .update({
          is_active: isActive,
          updated_at: new Date().toISOString(),
        })
        .eq('id', promptId);

      if (error) throw error;

      toast({
        title: isActive ? 'Prompt Enabled' : 'Prompt Disabled',
        description: `The prompt has been ${isActive ? 'enabled' : 'disabled'}.`,
      });

      await loadData();
      return true;
    } catch (error) {
      console.error('Error toggling prompt:', error);
      toast({
        title: 'Error',
        description: 'Failed to update prompt status.',
        variant: 'destructive',
      });
      return false;
    }
  }, [profile?.tenant_id, loadData, toast]);

  // Create user settings for a user who doesn't have them
  const createUserSettings = useCallback(async (
    userId: string,
    level: PromptLevel = 'training'
  ): Promise<boolean> => {
    if (!profile?.tenant_id) return false;

    try {
      const { error } = await (supabase
        .from('user_prompt_settings') as any)
        .insert({
          tenant_id: profile.tenant_id,
          user_id: userId,
          prompt_level: level,
          prompt_reminder_days: tenantDefaults?.default_reminder_days || 30,
        });

      if (error) throw error;

      await loadData();
      return true;
    } catch (error) {
      console.error('Error creating user settings:', error);
      return false;
    }
  }, [profile?.tenant_id, tenantDefaults?.default_reminder_days, loadData]);

  // Update a guided prompt
  const updatePrompt = useCallback(async (
    promptId: string,
    updates: Partial<GuidedPrompt>
  ): Promise<boolean> => {
    if (!profile?.tenant_id) return false;

    try {
      const { error } = await (supabase
        .from('guided_prompts') as any)
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', promptId)
        .eq('tenant_id', profile.tenant_id);

      if (error) throw error;

      toast({
        title: 'Prompt Updated',
        description: 'The prompt has been updated successfully.',
      });

      await loadData();
      return true;
    } catch (error) {
      console.error('Error updating prompt:', error);
      toast({
        title: 'Error',
        description: 'Failed to update prompt.',
        variant: 'destructive',
      });
      return false;
    }
  }, [profile?.tenant_id, loadData, toast]);

  // Delete a guided prompt
  const deletePrompt = useCallback(async (
    promptId: string
  ): Promise<boolean> => {
    if (!profile?.tenant_id) return false;

    try {
      const { error } = await (supabase
        .from('guided_prompts') as any)
        .delete()
        .eq('id', promptId)
        .eq('tenant_id', profile.tenant_id);

      if (error) throw error;

      toast({
        title: 'Prompt Deleted',
        description: 'The prompt has been permanently deleted.',
      });

      await loadData();
      return true;
    } catch (error) {
      console.error('Error deleting prompt:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete prompt.',
        variant: 'destructive',
      });
      return false;
    }
  }, [profile?.tenant_id, loadData, toast]);

  return {
    // State
    isLoading,
    allUserSettings,
    tenantDefaults,
    pendingSuggestions,
    allPrompts,

    // Actions
    updateUserSettings,
    updateTenantDefaults,
    approveSuggestion,
    dismissSuggestion,
    togglePromptActive,
    createUserSettings,
    updatePrompt,
    deletePrompt,
    refetch: loadData,
  };
}
