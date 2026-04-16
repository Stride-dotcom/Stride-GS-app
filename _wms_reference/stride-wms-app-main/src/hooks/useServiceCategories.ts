/**
 * useServiceCategories - Hook for managing service categories
 * Categories are UI/reporting metadata only - they do NOT affect billing logic
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

export interface ServiceCategory {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_system: boolean;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export interface CreateCategoryInput {
  name: string;
  description?: string;
  sort_order?: number;
  is_active?: boolean;
}

export interface UpdateCategoryInput {
  id: string;
  name?: string;
  description?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export function useServiceCategories() {
  const [categories, setCategories] = useState<ServiceCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  const { profile } = useAuth();

  // Fetch all categories for current tenant
  const fetchCategories = useCallback(async () => {
    if (!profile?.tenant_id) {
      setCategories([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const { data, error } = await (supabase
        .from('service_categories') as any)
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .order('sort_order')
        .order('name');

      if (error) {
        console.error('[useServiceCategories] Fetch failed:', error);
        toast({
          variant: 'destructive',
          title: 'Error loading categories',
          description: error.message,
        });
        return;
      }

      setCategories(data || []);
    } catch (error: any) {
      console.error('[useServiceCategories] Unexpected error:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load service categories',
      });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, toast]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  // Get only active categories (for dropdowns)
  const activeCategories = useMemo(() => {
    return categories.filter(c => c.is_active);
  }, [categories]);

  // Create a new category
  const createCategory = useCallback(async (input: CreateCategoryInput): Promise<boolean> => {
    if (!profile?.tenant_id || !profile?.id) return false;

    setSaving(true);
    try {
      // Check if name already exists
      const existingNames = categories.map(c => c.name.toLowerCase());
      if (existingNames.includes(input.name.toLowerCase())) {
        toast({
          variant: 'destructive',
          title: 'Category Exists',
          description: `A category named "${input.name}" already exists.`,
        });
        return false;
      }

      const { error } = await (supabase
        .from('service_categories') as any)
        .insert({
          tenant_id: profile.tenant_id,
          name: input.name.trim(),
          description: input.description?.trim() || null,
          sort_order: input.sort_order ?? 0,
          is_active: input.is_active ?? true,
          is_system: false,
          created_by: profile.id,
          updated_by: profile.id,
        });

      if (error) {
        console.error('[useServiceCategories] Create failed:', error);
        toast({
          variant: 'destructive',
          title: 'Create Failed',
          description: error.message,
        });
        return false;
      }

      toast({
        title: 'Category Created',
        description: `Category "${input.name}" has been created.`,
      });

      await fetchCategories();
      return true;
    } catch (error: any) {
      console.error('[useServiceCategories] Create error:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to create category',
      });
      return false;
    } finally {
      setSaving(false);
    }
  }, [profile?.tenant_id, profile?.id, categories, toast, fetchCategories]);

  // Update a category
  const updateCategory = useCallback(async (input: UpdateCategoryInput): Promise<boolean> => {
    if (!profile?.tenant_id || !profile?.id) return false;

    setSaving(true);
    try {
      const { id, ...updateData } = input;

      // Check if name already exists (excluding current category)
      if (updateData.name) {
        const otherCategories = categories.filter(c => c.id !== id);
        const existingNames = otherCategories.map(c => c.name.toLowerCase());
        if (existingNames.includes(updateData.name.toLowerCase())) {
          toast({
            variant: 'destructive',
            title: 'Category Exists',
            description: `A category named "${updateData.name}" already exists.`,
          });
          return false;
        }
      }

      const { error } = await (supabase
        .from('service_categories') as any)
        .update({
          ...updateData,
          updated_at: new Date().toISOString(),
          updated_by: profile.id,
        })
        .eq('id', id)
        .eq('tenant_id', profile.tenant_id);

      if (error) {
        console.error('[useServiceCategories] Update failed:', error);
        toast({
          variant: 'destructive',
          title: 'Update Failed',
          description: error.message,
        });
        return false;
      }

      toast({
        title: 'Category Updated',
        description: 'Category has been updated successfully.',
      });

      await fetchCategories();
      return true;
    } catch (error: any) {
      console.error('[useServiceCategories] Update error:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update category',
      });
      return false;
    } finally {
      setSaving(false);
    }
  }, [profile?.tenant_id, profile?.id, categories, toast, fetchCategories]);

  // Delete a category (only if not in use and not system)
  const deleteCategory = useCallback(async (id: string): Promise<boolean> => {
    if (!profile?.tenant_id) return false;

    const category = categories.find(c => c.id === id);
    if (!category) return false;

    // Check if it's a system category
    if (category.is_system) {
      toast({
        variant: 'destructive',
        title: 'Cannot Delete',
        description: 'System categories cannot be deleted. You can disable them instead.',
      });
      return false;
    }

    setSaving(true);
    try {
      // Check if category is in use by any service_events
      const { data: usedBy, error: checkError } = await (supabase
        .from('service_events') as any)
        .select('id')
        .eq('tenant_id', profile.tenant_id)
        .eq('category_id', id)
        .limit(1);

      if (checkError) {
        console.error('[useServiceCategories] Check usage failed:', checkError);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to check if category is in use',
        });
        return false;
      }

      if (usedBy && usedBy.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Cannot Delete',
          description: 'This category is in use by services. Remove the category from those services first, or disable the category instead.',
        });
        return false;
      }

      const { error } = await (supabase
        .from('service_categories') as any)
        .delete()
        .eq('id', id)
        .eq('tenant_id', profile.tenant_id);

      if (error) {
        console.error('[useServiceCategories] Delete failed:', error);
        toast({
          variant: 'destructive',
          title: 'Delete Failed',
          description: error.message,
        });
        return false;
      }

      toast({
        title: 'Category Deleted',
        description: `Category "${category.name}" has been deleted.`,
      });

      await fetchCategories();
      return true;
    } catch (error: any) {
      console.error('[useServiceCategories] Delete error:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to delete category',
      });
      return false;
    } finally {
      setSaving(false);
    }
  }, [profile?.tenant_id, categories, toast, fetchCategories]);

  // Toggle category active status
  const toggleActive = useCallback(async (id: string): Promise<boolean> => {
    const category = categories.find(c => c.id === id);
    if (!category) return false;

    return updateCategory({
      id,
      is_active: !category.is_active,
    });
  }, [categories, updateCategory]);

  // Get category by ID
  const getCategoryById = useCallback((id: string | null): ServiceCategory | undefined => {
    if (!id) return undefined;
    return categories.find(c => c.id === id);
  }, [categories]);

  // Get category name by ID (for display)
  const getCategoryName = useCallback((id: string | null): string => {
    if (!id) return '';
    const category = categories.find(c => c.id === id);
    return category?.name || '';
  }, [categories]);

  return {
    // Data
    categories,
    activeCategories,

    // State
    loading,
    saving,

    // Actions
    refetch: fetchCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    toggleActive,

    // Helpers
    getCategoryById,
    getCategoryName,
  };
}
