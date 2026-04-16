/**
 * useTaskActivity - Reads task_activity rows for a given task.
 * Provides filter support and newest-first ordering.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface TaskActivity {
  id: string;
  tenant_id: string;
  task_id: string;
  actor_user_id: string | null;
  actor_name: string | null;
  event_type: string;
  event_label: string;
  details: Record<string, unknown>;
  created_at: string;
}

export type TaskActivityFilter = 'all' | 'billing' | 'status' | 'assignment';

const FILTER_PREFIX_MAP: Record<Exclude<TaskActivityFilter, 'all'>, string[]> = {
  billing: [
    'billing_event_updated',
    'billing_event_invoiced',
    'billing_event_uninvoiced',
    'billing_event_voided',
    'billing_charge_added',
  ],
  status: [
    'task_status_changed',
    'task_completed',
    'task_started',
    'task_unable',
  ],
  assignment: [
    'task_assigned',
    'task_reassigned',
  ],
};

export function useTaskActivity(taskId: string | undefined) {
  const [activities, setActivities] = useState<TaskActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TaskActivityFilter>('all');

  const fetchActivities = useCallback(async () => {
    if (!taskId) return;

    setLoading(true);
    try {
      let query = (supabase.from('task_activity') as any)
        .select('*')
        .eq('task_id', taskId)
        .order('created_at', { ascending: false })
        .limit(200);

      if (filter !== 'all') {
        const prefixes = FILTER_PREFIX_MAP[filter];
        if (prefixes && prefixes.length > 0) {
          query = query.in('event_type', prefixes);
        }
      }

      const { data, error } = await query;

      if (error) {
        if (error.code !== '42P01') {
          console.error('[useTaskActivity] Error:', error);
        }
        setActivities([]);
        return;
      }

      setActivities(data || []);
    } catch (err) {
      console.error('[useTaskActivity] Unexpected error:', err);
      setActivities([]);
    } finally {
      setLoading(false);
    }
  }, [taskId, filter]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  return {
    activities,
    loading,
    filter,
    setFilter,
    refetch: fetchActivities,
  };
}
