/**
 * useTaskServiceLines - Manages service lines on tasks.
 *
 * Service lines are stored in the `task_custom_charges` table with a JSON flag
 * in `charge_description` to distinguish them from regular custom charges.
 *
 * Each service line represents a charge_type (service) attached to a task.
 * At completion time, service lines drive billing event creation.
 */

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

// =============================================================================
// TYPES
// =============================================================================

export interface TaskServiceLine {
  id: string;
  task_id: string;
  tenant_id: string;
  charge_code: string;
  charge_name: string;
  qty: number;
  minutes: number;
  input_mode: 'qty' | 'time' | 'both';
  charge_type_id: string | null;
  added_by: string | null;
  created_at: string | null;
}

interface ServiceLineMetadata {
  is_service_line: true;
  charge_type_id: string | null;
  input_mode: 'qty' | 'time' | 'both';
  minutes: number;
}

// =============================================================================
// HELPERS
// =============================================================================

function parseServiceLineMetadata(description: string | null): ServiceLineMetadata | null {
  if (!description) return null;
  try {
    const parsed = JSON.parse(description);
    if (parsed?.is_service_line === true) {
      return parsed as ServiceLineMetadata;
    }
    return null;
  } catch {
    return null;
  }
}

function toServiceLine(row: any): TaskServiceLine | null {
  const meta = parseServiceLineMetadata(row.charge_description);
  if (!meta) return null;

  return {
    id: row.id,
    task_id: row.task_id,
    tenant_id: row.tenant_id,
    charge_code: row.charge_type || '',
    charge_name: row.charge_name,
    qty: row.charge_amount ?? 1,
    minutes: meta.minutes ?? 0,
    input_mode: meta.input_mode || 'qty',
    charge_type_id: meta.charge_type_id || null,
    added_by: row.created_by,
    created_at: row.created_at,
  };
}

function buildMetadataJson(
  chargeTypeId: string | null,
  inputMode: string,
  minutes: number,
): string {
  const meta: ServiceLineMetadata = {
    is_service_line: true,
    charge_type_id: chargeTypeId,
    input_mode: (inputMode as 'qty' | 'time' | 'both') || 'qty',
    minutes: minutes || 0,
  };
  return JSON.stringify(meta);
}

// =============================================================================
// Check if a task_custom_charges row is a service line
// =============================================================================

export function isServiceLineRow(row: { charge_description?: string | null }): boolean {
  return parseServiceLineMetadata(row.charge_description ?? null) !== null;
}

// =============================================================================
// HOOK
// =============================================================================

export function useTaskServiceLines(taskId: string | undefined) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [serviceLines, setServiceLines] = useState<TaskServiceLine[]>([]);
  const [loading, setLoading] = useState(false);

  // Fetch all service lines for a task
  const fetchServiceLines = useCallback(async () => {
    if (!taskId || !profile?.tenant_id) return;

    try {
      setLoading(true);
      const { data, error } = await (supabase
        .from('task_custom_charges') as any)
        .select('*')
        .eq('task_id', taskId)
        .eq('tenant_id', profile.tenant_id)
        .order('created_at', { ascending: true });

      if (error) throw error;

      const lines = (data || [])
        .map(toServiceLine)
        .filter((line: TaskServiceLine | null): line is TaskServiceLine => line !== null);

      setServiceLines(lines);
    } catch (error: any) {
      console.error('[useTaskServiceLines] fetch error:', error);
    } finally {
      setLoading(false);
    }
  }, [taskId, profile?.tenant_id]);

  // Add a service line
  const addServiceLine = useCallback(async (params: {
    charge_code: string;
    charge_name: string;
    charge_type_id?: string | null;
    input_mode?: string;
    qty?: number;
    minutes?: number;
  }): Promise<TaskServiceLine | null> => {
    if (!taskId || !profile?.tenant_id || !profile?.id) return null;

    // Prevent duplicates — same charge_code on same task
    const existing = serviceLines.find(sl => sl.charge_code === params.charge_code);
    if (existing) {
      toast({
        variant: 'destructive',
        title: 'Already added',
        description: `${params.charge_name} is already on this task.`,
      });
      return null;
    }

    try {
      const { data, error } = await (supabase
        .from('task_custom_charges') as any)
        .insert({
          task_id: taskId,
          tenant_id: profile.tenant_id,
          charge_type: params.charge_code,
          charge_name: params.charge_name,
          charge_amount: params.qty ?? 1,
          charge_description: buildMetadataJson(
            params.charge_type_id ?? null,
            params.input_mode || 'qty',
            params.minutes ?? 0,
          ),
          created_by: profile.id,
        })
        .select()
        .single();

      if (error) throw error;

      const line = toServiceLine(data);
      if (line) {
        setServiceLines(prev => [...prev, line]);
      }
      return line;
    } catch (error: any) {
      console.error('[useTaskServiceLines] add error:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to add service',
        description: error.message,
      });
      return null;
    }
  }, [taskId, profile?.tenant_id, profile?.id, serviceLines, toast]);

  // Update qty/minutes on a service line
  const updateServiceLine = useCallback(async (
    lineId: string,
    updates: { qty?: number; minutes?: number },
  ): Promise<boolean> => {
    try {
      const line = serviceLines.find(sl => sl.id === lineId);
      if (!line) return false;

      const updatePayload: any = {};
      if (updates.qty !== undefined) {
        updatePayload.charge_amount = updates.qty;
      }

      // Update metadata JSON with new minutes
      const newMinutes = updates.minutes ?? line.minutes;
      const newQty = updates.qty ?? line.qty;
      updatePayload.charge_description = buildMetadataJson(
        line.charge_type_id,
        line.input_mode,
        newMinutes,
      );

      const { error } = await (supabase
        .from('task_custom_charges') as any)
        .update(updatePayload)
        .eq('id', lineId);

      if (error) throw error;

      setServiceLines(prev =>
        prev.map(sl =>
          sl.id === lineId
            ? { ...sl, qty: newQty, minutes: newMinutes }
            : sl,
        ),
      );
      return true;
    } catch (error: any) {
      console.error('[useTaskServiceLines] update error:', error);
      return false;
    }
  }, [serviceLines]);

  // Remove a service line
  const removeServiceLine = useCallback(async (lineId: string): Promise<boolean> => {
    try {
      const { error } = await (supabase
        .from('task_custom_charges') as any)
        .delete()
        .eq('id', lineId);

      if (error) throw error;

      setServiceLines(prev => prev.filter(sl => sl.id !== lineId));
      return true;
    } catch (error: any) {
      console.error('[useTaskServiceLines] remove error:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to remove service',
        description: error.message,
      });
      return false;
    }
  }, [toast]);

  // Pre-populate service lines from task type template (task_type_charge_links)
  // Single source of truth — no fallback to billing_service_code
  const loadFromTemplate = useCallback(async (taskTypeId: string): Promise<number> => {
    if (!taskId || !profile?.tenant_id || !profile?.id) return 0;

    let addedCount = 0;

    try {
      // Fetch linked charge type IDs from task_type_charge_links
      const { data: links, error } = await (supabase as any)
        .from('task_type_charge_links')
        .select('charge_type_id')
        .eq('task_type_id', taskTypeId);

      if (error) {
        if (error.code === 'PGRST200' || error.code === '42P01') {
          return 0;
        }
        console.error('[useTaskServiceLines] loadFromTemplate links error:', error);
        return 0;
      }

      const chargeTypeIds = [...new Set(((links || []) as any[]).map((link: any) => link.charge_type_id).filter(Boolean))] as string[];
      if (chargeTypeIds.length === 0) return 0;

      const { data: chargeTypes, error: chargeTypesError } = await supabase
        .from('charge_types')
        .select('*')
        .in('id', chargeTypeIds);

      if (chargeTypesError || !chargeTypes) {
        console.error('[useTaskServiceLines] loadFromTemplate charge types error:', chargeTypesError);
        return 0;
      }

      // Add each linked charge type as a service line (skip duplicates)
      for (const ct of chargeTypes) {
        const existing = serviceLines.find(sl => sl.charge_code === ct.charge_code);
        if (existing) continue;

        await addServiceLine({
          charge_code: ct.charge_code,
          charge_name: ct.charge_name,
          charge_type_id: ct.id,
          input_mode: ct.input_mode || 'qty',
          qty: 1,
          minutes: 0,
        });
        addedCount++;
      }
    } catch (error: any) {
      console.error('[useTaskServiceLines] loadFromTemplate error:', error);
    }

    return addedCount;
  }, [taskId, profile?.tenant_id, profile?.id, serviceLines, addServiceLine]);

  return {
    serviceLines,
    loading,
    fetchServiceLines,
    addServiceLine,
    updateServiceLine,
    removeServiceLine,
    loadFromTemplate,
  };
}

// =============================================================================
// STATIC HELPER: Fetch service lines for a task (no hook)
// =============================================================================

export async function fetchTaskServiceLinesStatic(
  taskId: string,
  tenantId: string,
): Promise<TaskServiceLine[]> {
  const { data, error } = await (supabase
    .from('task_custom_charges') as any)
    .select('*')
    .eq('task_id', taskId)
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });

  if (error || !data) return [];

  return data
    .map(toServiceLine)
    .filter((line: TaskServiceLine | null): line is TaskServiceLine => line !== null);
}
