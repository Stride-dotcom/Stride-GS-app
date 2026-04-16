/**
 * useAccountActivity - Reads activity rows for a given account.
 *
 * Sources:
 * - account_activity: direct account-level events (billing, invoices, settings)
 * - shipment_activity: via shipments where shipment.account_id = account
 * - task_activity: via tasks where task.account_id = account
 * - item_activity: via items where item.account_id = account
 *
 * Supports filter chips, text search, date range, and "load more" pagination.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface UnifiedActivity {
  id: string;
  source: 'account' | 'shipment' | 'task' | 'item';
  entity_id?: string;
  actor_name: string | null;
  event_type: string;
  event_label: string;
  details: Record<string, unknown>;
  created_at: string;
}

export type AccountActivityFilter =
  | 'all'
  | 'shipments'
  | 'tasks'
  | 'billing'
  | 'invoices'
  | 'items'
  | 'settings';

const ACCOUNT_BILLING_TYPES = [
  'billing_event_updated',
  'billing_event_voided',
  'billing_charge_added',
];

const ACCOUNT_INVOICE_TYPES = [
  'billing_event_invoiced',
  'billing_event_uninvoiced',
  'invoice_created',
  'invoice_voided',
];

const ACCOUNT_SETTINGS_TYPES = [
  'account_updated',
  'account_status_changed',
  'account_setting_changed',
  'account_created',
];

const PAGE_SIZE = 200;

export function useAccountActivity(accountId: string | undefined) {
  const [activities, setActivities] = useState<UnifiedActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<AccountActivityFilter>('all');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState<string | undefined>(undefined);
  const [dateTo, setDateTo] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const offsetRef = useRef(0);

  const fetchAccountActivity = useCallback(
    async (eventTypes: string[] | null, offset: number, limit: number) => {
      let query = (supabase as any).from('account_activity')
        .select('*')
        .eq('account_id', accountId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (eventTypes && eventTypes.length > 0) {
        query = query.in('event_type', eventTypes);
      }
      if (dateFrom) {
        query = query.gte('created_at', dateFrom);
      }
      if (dateTo) {
        query = query.lte('created_at', dateTo + 'T23:59:59.999Z');
      }

      const { data, error } = await query;
      if (error) {
        if (error.code !== '42P01') {
          console.error('[useAccountActivity] account_activity error:', error);
        }
        return [];
      }

      return (data || []).map((row: any): UnifiedActivity => ({
        id: row.id,
        source: 'account' as const,
        entity_id: row.account_id,
        actor_name: row.actor_name,
        event_type: row.event_type,
        event_label: row.event_label,
        details: row.details || {},
        created_at: row.created_at,
      }));
    },
    [accountId, dateFrom, dateTo],
  );

  const fetchEntityActivity = useCallback(
    async (
      entityTable: string,
      activityTable: string,
      idColumn: string,
      offset: number,
      limit: number,
    ): Promise<UnifiedActivity[]> => {
      // Step 1: Get entity IDs for this account
      const { data: entities, error: entityError } = await (supabase as any)
        .from(entityTable)
        .select('id')
        .eq('account_id', accountId!)
        .order('created_at', { ascending: false })
        .limit(200);

      if (entityError || !entities || entities.length === 0) {
        return [];
      }

      const entityIds = entities.map((e: any) => e.id);

      // Step 2: Get activity for those entities
      let query = (supabase as any).from(activityTable)
        .select('*, ' + idColumn)
        .in(idColumn, entityIds)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (dateFrom) {
        query = query.gte('created_at', dateFrom);
      }
      if (dateTo) {
        query = query.lte('created_at', dateTo + 'T23:59:59.999Z');
      }

      const { data, error } = await query;
      if (error) {
        if (error.code !== '42P01') {
          console.error(`[useAccountActivity] ${activityTable} error:`, error);
        }
        return [];
      }

      const source = entityTable === 'shipments'
        ? 'shipment'
        : entityTable === 'tasks'
          ? 'task'
          : 'item';

      return (data || []).map((row: any): UnifiedActivity => ({
        id: row.id,
        source: source as 'shipment' | 'task' | 'item',
        entity_id: row[idColumn],
        actor_name: row.actor_name,
        event_type: row.event_type,
        event_label: row.event_label,
        details: row.details || {},
        created_at: row.created_at,
      }));
    },
    [accountId, dateFrom, dateTo],
  );

  const fetchActivities = useCallback(
    async (isLoadMore = false) => {
      if (!accountId) return;

      if (isLoadMore) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        offsetRef.current = 0;
      }

      const offset = isLoadMore ? offsetRef.current : 0;

      try {
        let results: UnifiedActivity[] = [];

        switch (filter) {
          case 'all': {
            results = await fetchAccountActivity(null, offset, PAGE_SIZE + 1);
            break;
          }
          case 'billing': {
            results = await fetchAccountActivity(ACCOUNT_BILLING_TYPES, offset, PAGE_SIZE + 1);
            break;
          }
          case 'invoices': {
            results = await fetchAccountActivity(ACCOUNT_INVOICE_TYPES, offset, PAGE_SIZE + 1);
            break;
          }
          case 'settings': {
            results = await fetchAccountActivity(ACCOUNT_SETTINGS_TYPES, offset, PAGE_SIZE + 1);
            break;
          }
          case 'shipments': {
            results = await fetchEntityActivity(
              'shipments',
              'shipment_activity',
              'shipment_id',
              offset,
              PAGE_SIZE + 1,
            );
            break;
          }
          case 'tasks': {
            results = await fetchEntityActivity(
              'tasks',
              'task_activity',
              'task_id',
              offset,
              PAGE_SIZE + 1,
            );
            break;
          }
          case 'items': {
            results = await fetchEntityActivity(
              'items',
              'item_activity',
              'item_id',
              offset,
              PAGE_SIZE + 1,
            );
            break;
          }
        }

        // Check if there are more results
        const moreAvailable = results.length > PAGE_SIZE;
        setHasMore(moreAvailable);

        // Trim to page size
        const pageResults = moreAvailable ? results.slice(0, PAGE_SIZE) : results;

        // Sort by created_at desc
        pageResults.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );

        if (isLoadMore) {
          setActivities((prev) => [...prev, ...pageResults]);
        } else {
          setActivities(pageResults);
        }

        offsetRef.current = offset + pageResults.length;
      } catch (err) {
        console.error('[useAccountActivity] Unexpected error:', err);
        if (!isLoadMore) {
          setActivities([]);
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [accountId, filter, fetchAccountActivity, fetchEntityActivity],
  );

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  // Client-side search filtering
  const filteredActivities = search.trim()
    ? activities.filter((a) => {
        const q = search.toLowerCase();
        return (
          a.event_label.toLowerCase().includes(q) ||
          a.event_type.toLowerCase().includes(q) ||
          (a.actor_name && a.actor_name.toLowerCase().includes(q)) ||
          Object.values(a.details).some(
            (v) => typeof v === 'string' && v.toLowerCase().includes(q),
          )
        );
      })
    : activities;

  const loadMore = useCallback(() => {
    fetchActivities(true);
  }, [fetchActivities]);

  return {
    activities: filteredActivities,
    loading,
    loadingMore,
    filter,
    setFilter,
    search,
    setSearch,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    hasMore,
    loadMore,
    refetch: () => fetchActivities(false),
  };
}
