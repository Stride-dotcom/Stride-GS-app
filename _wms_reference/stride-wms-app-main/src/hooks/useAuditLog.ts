import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface AuditLogEntry {
  id: string;
  tenant_id: string;
  entity_table: string;
  entity_id: string;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  changed_at: string;
  changed_by: string | null;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  snapshot: Record<string, unknown> | null;
  entity_name: string | null;
  entity_code: string | null;
  // Joined data
  user?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
  } | null;
}

export interface AuditLogFilters {
  entityTable?: string; // 'service_events' | 'task_types' | 'service_categories' | undefined (all)
  dateRange?: 'last7' | 'last30' | 'last90' | 'all';
  search?: string;
  userId?: string;
}

const PAGE_SIZE = 50;

export function useAuditLog(initialFilters?: AuditLogFilters) {
  const { profile } = useAuth();
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [filters, setFilters] = useState<AuditLogFilters>(initialFilters || {});
  const [offset, setOffset] = useState(0);

  const fetchAuditLog = useCallback(async (resetPagination = false) => {
    if (!profile?.tenant_id) return;

    const currentOffset = resetPagination ? 0 : offset;
    if (resetPagination) {
      setOffset(0);
      setEntries([]);
    }

    setLoading(true);
    try {
      let query = (supabase
        .from('audit_log') as any)
        .select(`
          *,
          user:users!audit_log_changed_by_fkey(id, first_name, last_name)
        `)
        .eq('tenant_id', profile.tenant_id)
        .order('changed_at', { ascending: false })
        .range(currentOffset, currentOffset + PAGE_SIZE - 1);

      // Apply entity table filter
      if (filters.entityTable) {
        query = query.eq('entity_table', filters.entityTable);
      }

      // Apply date range filter
      if (filters.dateRange && filters.dateRange !== 'all') {
        const now = new Date();
        let startDate: Date;

        switch (filters.dateRange) {
          case 'last7':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case 'last30':
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
          case 'last90':
            startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
            break;
          default:
            startDate = new Date(0);
        }

        query = query.gte('changed_at', startDate.toISOString());
      }

      // Apply user filter
      if (filters.userId) {
        query = query.eq('changed_by', filters.userId);
      }

      // Apply search filter (matches entity_code or entity_name)
      if (filters.search) {
        const searchTerm = `%${filters.search}%`;
        query = query.or(`entity_code.ilike.${searchTerm},entity_name.ilike.${searchTerm}`);
      }

      const { data, error } = await query;

      if (error) throw error;

      const newEntries = (data || []) as AuditLogEntry[];

      if (resetPagination) {
        setEntries(newEntries);
      } else {
        setEntries(prev => [...prev, ...newEntries]);
      }

      setHasMore(newEntries.length === PAGE_SIZE);
    } catch (error) {
      console.error('Error fetching audit log:', error);
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, filters, offset]);

  // Initial fetch and refetch when filters change
  useEffect(() => {
    fetchAuditLog(true);
  }, [profile?.tenant_id, filters]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) {
      setOffset(prev => prev + PAGE_SIZE);
      fetchAuditLog(false);
    }
  }, [loading, hasMore, fetchAuditLog]);

  const updateFilters = useCallback((newFilters: Partial<AuditLogFilters>) => {
    setFilters(prev => ({ ...prev, ...newFilters }));
  }, []);

  const refetch = useCallback(() => {
    fetchAuditLog(true);
  }, [fetchAuditLog]);

  return {
    entries,
    loading,
    hasMore,
    filters,
    updateFilters,
    loadMore,
    refetch,
  };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get human-readable entity type label
 */
export function getEntityTypeLabel(entityTable: string): string {
  switch (entityTable) {
    case 'service_events':
      return 'Price List';
    case 'task_types':
      return 'Task Type';
    case 'service_categories':
      return 'Category';
    default:
      return entityTable;
  }
}

/**
 * Get action badge color
 */
export function getActionColor(action: string): string {
  switch (action) {
    case 'INSERT':
      return 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400';
    case 'UPDATE':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400';
    case 'DELETE':
      return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
    default:
      return 'bg-gray-100 text-gray-800';
  }
}

/**
 * Format user name or return fallback
 */
export function formatUserName(user: AuditLogEntry['user']): string {
  if (!user) return 'System';
  const parts = [user.first_name, user.last_name].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : 'Unknown User';
}

/**
 * Generate human-readable summary for an audit entry
 */
export function formatAuditSummary(entry: AuditLogEntry): string {
  const entityLabel = entry.entity_code
    ? `"${entry.entity_code}"`
    : entry.entity_name
    ? `"${entry.entity_name}"`
    : '';

  const prefix = getEntityTypeLabel(entry.entity_table);

  if (entry.action === 'INSERT') {
    return `${prefix} ${entityLabel} created`;
  }

  if (entry.action === 'DELETE') {
    return `${prefix} ${entityLabel} deleted`;
  }

  if (entry.action === 'UPDATE' && entry.changes) {
    const parts: string[] = [];

    for (const [field, change] of Object.entries(entry.changes)) {
      if (field === 'rate') {
        const from = change.from !== null ? `$${change.from}` : 'null';
        const to = change.to !== null ? `$${change.to}` : 'null';
        parts.push(`rate: ${from} → ${to}`);
      } else if (field === 'is_active') {
        if (change.to === false) {
          parts.push('deactivated');
        } else {
          parts.push('activated');
        }
      } else if (field === 'default_service_code') {
        const from = change.from || 'none';
        const to = change.to || 'none';
        parts.push(`default service: ${from} → ${to}`);
      } else if (field === 'category_id') {
        parts.push('category changed');
      } else if (field === 'billing_trigger') {
        parts.push(`trigger: ${change.from || 'none'} → ${change.to || 'none'}`);
      } else if (field === 'taxable') {
        parts.push(change.to ? 'set taxable' : 'set non-taxable');
      } else {
        parts.push(`${field} changed`);
      }
    }

    if (parts.length > 0) {
      return `${prefix} ${entityLabel}: ${parts.join(', ')}`;
    }
  }

  return `${prefix} ${entityLabel} updated`;
}

/**
 * Format changes object for detail view
 */
export function formatChangesForDisplay(changes: Record<string, { from: unknown; to: unknown }> | null): Array<{
  field: string;
  from: string;
  to: string;
}> {
  if (!changes) return [];

  return Object.entries(changes).map(([field, change]) => ({
    field: formatFieldName(field),
    from: formatValue(change.from),
    to: formatValue(change.to),
  }));
}

function formatFieldName(field: string): string {
  return field
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '(empty)';
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'number') {
    return value.toString();
  }
  return String(value);
}
