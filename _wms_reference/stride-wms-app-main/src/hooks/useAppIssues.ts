import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface AppIssue {
  id: string;
  created_at: string;
  environment: 'dev' | 'prod';
  app_version: string | null;
  user_id: string | null;
  user_role: string | null;
  account_id: string | null;
  tenant_id: string | null;
  route: string;
  component_name: string | null;
  action_context: string | null;
  level: 'error' | 'warning';
  error_message: string;
  stack_trace: string | null;
  http_status: number | null;
  supabase_error_code: string | null;
  request_summary: Record<string, unknown> | null;
  severity: 'P0' | 'P1' | 'P2';
  fingerprint: string;
  status: 'new' | 'acknowledged' | 'fixed' | 'ignored';
}

export interface GroupedIssue {
  fingerprint: string;
  count: number;
  last_seen: string;
  first_seen: string;
  error_message: string;
  level: 'error' | 'warning';
  severity: 'P0' | 'P1' | 'P2';
  status: 'new' | 'acknowledged' | 'fixed' | 'ignored';
  affected_routes: string[];
  affected_roles: string[];
  component_name: string | null;
  issues: AppIssue[];
}

export interface IssueFilters {
  environment?: 'dev' | 'prod';
  level?: 'error' | 'warning';
  severity?: 'P0' | 'P1' | 'P2';
  status?: 'new' | 'acknowledged' | 'fixed' | 'ignored';
  role?: string;
  routeContains?: string;
  dateFrom?: string;
  dateTo?: string;
}

export function useAppIssues(filters: IssueFilters = {}) {
  const [issues, setIssues] = useState<AppIssue[]>([]);
  const [groupedIssues, setGroupedIssues] = useState<GroupedIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchIssues = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      let query = supabase
        .from('app_issues')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1000);

      // Apply filters
      if (filters.environment) {
        query = query.eq('environment', filters.environment);
      }
      if (filters.level) {
        query = query.eq('level', filters.level);
      }
      if (filters.severity) {
        query = query.eq('severity', filters.severity);
      }
      if (filters.status) {
        query = query.eq('status', filters.status);
      }
      if (filters.role) {
        query = query.eq('user_role', filters.role);
      }
      if (filters.routeContains) {
        query = query.ilike('route', `%${filters.routeContains}%`);
      }
      if (filters.dateFrom) {
        query = query.gte('created_at', filters.dateFrom);
      }
      if (filters.dateTo) {
        query = query.lte('created_at', filters.dateTo);
      }

      const { data, error: queryError } = await query;

      if (queryError) {
        setError(queryError.message);
        return;
      }

      const typedData = (data || []) as AppIssue[];
      setIssues(typedData);

      // Group by fingerprint
      const grouped = new Map<string, GroupedIssue>();

      for (const issue of typedData) {
        const existing = grouped.get(issue.fingerprint);

        if (existing) {
          existing.count++;
          if (new Date(issue.created_at) > new Date(existing.last_seen)) {
            existing.last_seen = issue.created_at;
            existing.status = issue.status; // Use most recent status
          }
          if (new Date(issue.created_at) < new Date(existing.first_seen)) {
            existing.first_seen = issue.created_at;
          }
          if (!existing.affected_routes.includes(issue.route)) {
            existing.affected_routes.push(issue.route);
          }
          if (issue.user_role && !existing.affected_roles.includes(issue.user_role)) {
            existing.affected_roles.push(issue.user_role);
          }
          existing.issues.push(issue);
        } else {
          grouped.set(issue.fingerprint, {
            fingerprint: issue.fingerprint,
            count: 1,
            last_seen: issue.created_at,
            first_seen: issue.created_at,
            error_message: issue.error_message,
            level: issue.level,
            severity: issue.severity,
            status: issue.status,
            affected_routes: [issue.route],
            affected_roles: issue.user_role ? [issue.user_role] : [],
            component_name: issue.component_name,
            issues: [issue],
          });
        }
      }

      // Sort by last_seen desc, then by severity
      const sortedGroups = Array.from(grouped.values()).sort((a, b) => {
        // P0 > P1 > P2
        const severityOrder = { P0: 0, P1: 1, P2: 2 };
        if (severityOrder[a.severity] !== severityOrder[b.severity]) {
          return severityOrder[a.severity] - severityOrder[b.severity];
        }
        return new Date(b.last_seen).getTime() - new Date(a.last_seen).getTime();
      });

      setGroupedIssues(sortedGroups);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch issues');
    } finally {
      setLoading(false);
    }
  }, [filters.environment, filters.level, filters.severity, filters.status, filters.role, filters.routeContains, filters.dateFrom, filters.dateTo]);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  const updateStatus = useCallback(async (
    fingerprint: string,
    newStatus: 'new' | 'acknowledged' | 'fixed' | 'ignored'
  ) => {
    try {
      const { error: updateError } = await supabase
        .from('app_issues')
        .update({ status: newStatus })
        .eq('fingerprint', fingerprint);

      if (updateError) {
        throw updateError;
      }

      // Refresh data
      await fetchIssues();
      return true;
    } catch (err) {
      console.error('Failed to update status:', err);
      return false;
    }
  }, [fetchIssues]);

  const updateSingleStatus = useCallback(async (
    issueId: string,
    newStatus: 'new' | 'acknowledged' | 'fixed' | 'ignored'
  ) => {
    try {
      const { error: updateError } = await supabase
        .from('app_issues')
        .update({ status: newStatus })
        .eq('id', issueId);

      if (updateError) {
        throw updateError;
      }

      await fetchIssues();
      return true;
    } catch (err) {
      console.error('Failed to update status:', err);
      return false;
    }
  }, [fetchIssues]);

  return {
    issues,
    groupedIssues,
    loading,
    error,
    refetch: fetchIssues,
    updateStatus,
    updateSingleStatus,
  };
}
