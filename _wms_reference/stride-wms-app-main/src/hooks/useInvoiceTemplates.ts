import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import type { Json } from '@/integrations/supabase/types';

export interface InvoiceTemplate {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  html_content: string;
  css_content: string | null;
  settings: Record<string, unknown>;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface CreateTemplateInput {
  name: string;
  description?: string;
  html_content: string;
  css_content?: string;
  settings?: Record<string, unknown>;
  is_default?: boolean;
}

export interface UpdateTemplateInput {
  name?: string;
  description?: string;
  html_content?: string;
  css_content?: string;
  settings?: Record<string, unknown>;
  is_default?: boolean;
  is_active?: boolean;
}

export function useInvoiceTemplates() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<InvoiceTemplate[]>([]);
  const [currentTemplate, setCurrentTemplate] = useState<InvoiceTemplate | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // Fetch all templates for the tenant
  const fetchTemplates = useCallback(async () => {
    if (!profile?.tenant_id) return;

    try {
      setIsLoading(true);
      setError(null);

      const { data, error: fetchError } = await (supabase as any)
        .from('invoice_templates')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .order('name', { ascending: true });

      if (fetchError) throw fetchError;

      setTemplates((data as InvoiceTemplate[]) || []);
    } catch (err) {
      console.error('Error fetching invoice templates:', err);
      setError(err as Error);
    } finally {
      setIsLoading(false);
    }
  }, [profile?.tenant_id]);

  // Load initial templates
  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // Load a specific template
  const loadTemplate = useCallback(async (templateId: string) => {
    if (!profile?.tenant_id) return null;

    try {
      const { data, error: fetchError } = await (supabase as any)
        .from('invoice_templates')
        .select('*')
        .eq('id', templateId)
        .eq('tenant_id', profile.tenant_id)
        .single();

      if (fetchError) throw fetchError;

      setCurrentTemplate(data as InvoiceTemplate);
      return data as InvoiceTemplate;
    } catch (err) {
      console.error('Error loading template:', err);
      toast({
        title: 'Error',
        description: 'Failed to load template',
        variant: 'destructive',
      });
      return null;
    }
  }, [profile?.tenant_id, toast]);

  // Create a new template
  const createTemplate = useCallback(async (input: CreateTemplateInput): Promise<InvoiceTemplate | null> => {
    if (!profile?.tenant_id || !profile?.id) {
      toast({
        title: 'Error',
        description: 'You must be logged in to create templates',
        variant: 'destructive',
      });
      return null;
    }

    try {
      const { data, error: createError } = await (supabase as any)
        .from('invoice_templates')
        .insert({
          tenant_id: profile.tenant_id,
          name: input.name,
          description: input.description || null,
          html_content: input.html_content,
          css_content: input.css_content || null,
          settings: input.settings || {},
          is_default: input.is_default || false,
          created_by: profile.id,
        })
        .select()
        .single();

      if (createError) throw createError;

      // Refresh templates list
      await fetchTemplates();

      toast({
        title: 'Success',
        description: 'Template created successfully',
      });

      return data as InvoiceTemplate;
    } catch (err) {
      console.error('Error creating template:', err);
      toast({
        title: 'Error',
        description: 'Failed to create template',
        variant: 'destructive',
      });
      return null;
    }
  }, [profile?.tenant_id, profile?.id, toast, fetchTemplates]);

  // Update an existing template
  const updateTemplate = useCallback(async (templateId: string, input: UpdateTemplateInput): Promise<InvoiceTemplate | null> => {
    if (!profile?.tenant_id || !profile?.id) {
      toast({
        title: 'Error',
        description: 'You must be logged in to update templates',
        variant: 'destructive',
      });
      return null;
    }

    try {
      const { data, error: updateError } = await (supabase as any)
        .from('invoice_templates')
        .update({
          ...input,
          settings: input.settings as Json,
          updated_by: profile.id,
          updated_at: new Date().toISOString(),
        })
        .eq('id', templateId)
        .eq('tenant_id', profile.tenant_id)
        .select()
        .single();

      if (updateError) throw updateError;

      // Update local state
      setTemplates(prev => prev.map(t => t.id === templateId ? (data as InvoiceTemplate) : t));
      if (currentTemplate?.id === templateId) {
        setCurrentTemplate(data as InvoiceTemplate);
      }

      toast({
        title: 'Success',
        description: 'Template updated successfully',
      });

      return data as InvoiceTemplate;
    } catch (err) {
      console.error('Error updating template:', err);
      toast({
        title: 'Error',
        description: 'Failed to update template',
        variant: 'destructive',
      });
      return null;
    }
  }, [profile?.tenant_id, profile?.id, toast, currentTemplate?.id]);

  // Delete a template (soft delete by setting is_active to false)
  const deleteTemplate = useCallback(async (templateId: string): Promise<boolean> => {
    if (!profile?.tenant_id) {
      toast({
        title: 'Error',
        description: 'You must be logged in to delete templates',
        variant: 'destructive',
      });
      return false;
    }

    try {
      const { error: deleteError } = await (supabase as any)
        .from('invoice_templates')
        .update({ is_active: false })
        .eq('id', templateId)
        .eq('tenant_id', profile.tenant_id);

      if (deleteError) throw deleteError;

      // Update local state
      setTemplates(prev => prev.filter(t => t.id !== templateId));
      if (currentTemplate?.id === templateId) {
        setCurrentTemplate(null);
      }

      toast({
        title: 'Success',
        description: 'Template deleted successfully',
      });

      return true;
    } catch (err) {
      console.error('Error deleting template:', err);
      toast({
        title: 'Error',
        description: 'Failed to delete template',
        variant: 'destructive',
      });
      return false;
    }
  }, [profile?.tenant_id, toast, currentTemplate?.id]);

  // Set a template as the default
  const setDefaultTemplate = useCallback(async (templateId: string): Promise<boolean> => {
    if (!profile?.tenant_id) {
      toast({
        title: 'Error',
        description: 'You must be logged in to set default template',
        variant: 'destructive',
      });
      return false;
    }

    try {
      // The database trigger will handle unsetting the previous default
      const { error: updateError } = await (supabase as any)
        .from('invoice_templates')
        .update({ is_default: true })
        .eq('id', templateId)
        .eq('tenant_id', profile.tenant_id);

      if (updateError) throw updateError;

      // Refresh templates to get updated is_default values
      await fetchTemplates();

      toast({
        title: 'Success',
        description: 'Default template updated',
      });

      return true;
    } catch (err) {
      console.error('Error setting default template:', err);
      toast({
        title: 'Error',
        description: 'Failed to set default template',
        variant: 'destructive',
      });
      return false;
    }
  }, [profile?.tenant_id, toast, fetchTemplates]);

  // Get the default template for the tenant
  const getDefaultTemplate = useCallback(async (): Promise<InvoiceTemplate | null> => {
    if (!profile?.tenant_id) return null;

    try {
      const { data, error: fetchError } = await (supabase as any)
        .from('invoice_templates')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_default', true)
        .eq('is_active', true)
        .single();

      if (fetchError) {
        // No default template found, return first active template
        const { data: firstTemplate } = await (supabase as any)
          .from('invoice_templates')
          .select('*')
          .eq('tenant_id', profile.tenant_id)
          .eq('is_active', true)
          .order('created_at', { ascending: true })
          .limit(1)
          .single();

        return firstTemplate as InvoiceTemplate | null;
      }

      return data as InvoiceTemplate;
    } catch (err) {
      console.error('Error getting default template:', err);
      return null;
    }
  }, [profile?.tenant_id]);

  // Duplicate a template
  const duplicateTemplate = useCallback(async (templateId: string, newName?: string): Promise<InvoiceTemplate | null> => {
    const template = templates.find(t => t.id === templateId);
    if (!template) {
      toast({
        title: 'Error',
        description: 'Template not found',
        variant: 'destructive',
      });
      return null;
    }

    return createTemplate({
      name: newName || `${template.name} (Copy)`,
      description: template.description || undefined,
      html_content: template.html_content,
      css_content: template.css_content || undefined,
      settings: template.settings,
      is_default: false,
    });
  }, [templates, toast, createTemplate]);

  return {
    templates,
    currentTemplate,
    isLoading,
    error,
    fetchTemplates,
    loadTemplate,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    setDefaultTemplate,
    getDefaultTemplate,
    duplicateTemplate,
  };
}
