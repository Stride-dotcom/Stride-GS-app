import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from './use-toast';

export interface TemplateResult {
  success: boolean;
  tenant_id: string;
  categories_added: number;
  task_types_added: number;
  classes_added: number;
  total_categories: number;
  total_task_types: number;
  total_classes: number;
  services_added?: number;
  total_services?: number;
}

export function useTenantTemplates() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [lastResult, setLastResult] = useState<TemplateResult | null>(null);

  const applyCoreDefaults = async (): Promise<TemplateResult | null> => {
    if (!profile?.tenant_id) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No tenant ID available',
      });
      return null;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('apply_core_defaults', {
        p_tenant_id: profile.tenant_id,
        p_user_id: profile.id,
      });

      if (error) throw error;

      const result = data as unknown as TemplateResult;
      setLastResult(result);

      const addedCount = result.categories_added + result.task_types_added + result.classes_added;

      if (addedCount === 0) {
        toast({
          title: 'Already Up to Date',
          description: 'All core defaults are already present. No changes made.',
        });
      } else {
        toast({
          title: 'Core Defaults Applied',
          description: `Added ${result.categories_added} categories, ${result.task_types_added} task types, ${result.classes_added} classes.`,
        });
      }

      return result;
    } catch (error) {
      console.error('Error applying core defaults:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to Apply Core Defaults',
        description: error instanceof Error ? error.message : 'An error occurred',
      });
      return null;
    } finally {
      setLoading(false);
    }
  };

  const applyFullStarter = async (): Promise<TemplateResult | null> => {
    if (!profile?.tenant_id) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'No tenant ID available',
      });
      return null;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('apply_full_starter', {
        p_tenant_id: profile.tenant_id,
        p_user_id: profile.id,
      });

      if (error) throw error;

      const result = data as unknown as TemplateResult;
      setLastResult(result);

      const coreAdded = result.categories_added + result.task_types_added + result.classes_added;
      const servicesAdded = result.services_added || 0;
      const totalAdded = coreAdded + servicesAdded;

      if (totalAdded === 0) {
        toast({
          title: 'Already Up to Date',
          description: 'All starter data is already present. No changes made.',
        });
      } else {
        toast({
          title: 'Full Starter Applied',
          description: `Added ${result.categories_added} categories, ${result.task_types_added} task types, ${result.classes_added} classes, ${servicesAdded} price list entries.`,
        });
      }

      return result;
    } catch (error) {
      console.error('Error applying full starter:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to Apply Full Starter',
        description: error instanceof Error ? error.message : 'An error occurred',
      });
      return null;
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    lastResult,
    applyCoreDefaults,
    applyFullStarter,
  };
}
