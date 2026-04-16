import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { logItemActivity } from '@/lib/activity/logItemActivity';
import type { TimerStartResult } from '@/hooks/useJobTimer';
import { mergeServiceTimeActualSnapshot } from '@/lib/time/serviceTimeSnapshot';
import { minutesBetweenIso } from '@/lib/time/minutesBetweenIso';
import { timerEndJob, timerStartJob } from '@/lib/time/timerClient';

// Type-safe supabase client cast for tables/functions not in generated types
const db = supabase as any;

// Types
export type StocktakeStatus = 'draft' | 'active' | 'closed' | 'cancelled';
export type ScanResult = 'expected' | 'unexpected' | 'wrong_location' | 'released_conflict' | 'duplicate' | 'not_found';
export type ResultType = 'missing' | 'found_expected' | 'found_wrong_location' | 'found_unexpected' | 'released_found';

export interface Stocktake {
  id: string;
  tenant_id: string;
  stocktake_number: string;
  name: string | null;
  warehouse_id: string;
  location_id: string | null; // Legacy single location
  location_ids: string[] | null; // New multi-location
  status: StocktakeStatus;
  freeze_moves: boolean;
  allow_location_auto_fix: boolean;
  billable: boolean;
  include_accounts: string[] | null;
  scheduled_date: string | null;
  started_at: string | null;
  completed_at: string | null;
  closed_at: string | null;
  closed_by: string | null;
  created_at: string;
  created_by: string | null;
  assigned_to: string | null;
  expected_item_count: number | null;
  counted_item_count: number | null;
  variance_count: number | null;
  duration_minutes: number | null;
  notes: string | null;
  metadata: Json | null;
  deleted_at: string | null;
  warehouse?: { id: string; name: string } | null;
  locations?: { id: string; code: string; name: string | null }[];
  assigned_user?: { id: string; first_name: string | null; last_name: string | null } | null;
}

export interface StocktakeExpectedItem {
  id: string;
  stocktake_id: string;
  item_id: string;
  expected_location_id: string | null;
  item_code: string;
  item_description: string | null;
  account_id: string | null;
  created_at: string;
  item?: {
    id: string;
    item_code: string;
    description: string | null;
    status: string;
  };
  expected_location?: {
    id: string;
    code: string;
    name: string | null;
  };
}

export interface StocktakeScan {
  id: string;
  stocktake_id: string;
  scanned_by: string;
  scanned_at: string;
  scanned_location_id: string;
  item_id: string | null;
  item_code: string | null;
  scan_result: ScanResult;
  fault_reason: string | null;
  auto_fix_applied: boolean;
  old_location_id: string | null;
  new_location_id: string | null;
  scanned_location?: { id: string; code: string };
  scanned_by_user?: { first_name: string | null; last_name: string | null };
}

export interface StocktakeResult {
  id: string;
  stocktake_id: string;
  item_id: string | null;
  item_code: string;
  expected_location_id: string | null;
  scanned_location_id: string | null;
  result: ResultType;
  resolved: boolean;
  resolution_notes: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  expected_location?: { id: string; code: string };
  scanned_location?: { id: string; code: string };
  item?: { id: string; item_code: string; description: string | null };
}

export interface StocktakeScanStats {
  stocktake_id: string;
  stocktake_number: string;
  name: string | null;
  status: string;
  expected_item_count: number | null;
  total_scans: number;
  unique_items_scanned: number;
  found_expected: number;
  found_wrong_location: number;
  found_unexpected: number;
  duplicates: number;
  released_conflicts: number;
  not_yet_scanned: number;
}

export interface CreateStocktakeData {
  name?: string;
  warehouse_id: string;
  location_ids?: string[];
  freeze_moves?: boolean;
  allow_location_auto_fix?: boolean;
  billable?: boolean;
  include_accounts?: string[];
  scheduled_date?: string | null;
  notes?: string | null;
}

export interface StocktakeFilters {
  status?: StocktakeStatus;
  warehouseId?: string;
}

// Main hook for stocktakes list
export function useStocktakes(filters?: StocktakeFilters) {
  const [stocktakes, setStocktakes] = useState<Stocktake[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { profile } = useAuth();

  const fetchStocktakes = useCallback(async () => {
    if (!profile?.tenant_id) return;

    try {
      setLoading(true);
      let query = db
        .from('stocktakes')
        .select(`
          *,
          warehouse:warehouses!stocktakes_warehouse_id_fkey(id, name),
          assigned_user:users!stocktakes_assigned_to_fkey(id, first_name, last_name)
        `)
        .eq('tenant_id', profile.tenant_id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (filters?.status) {
        query = query.eq('status', filters.status);
      }
      if (filters?.warehouseId) {
        query = query.eq('warehouse_id', filters.warehouseId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setStocktakes((data || []) as unknown as Stocktake[]);
    } catch (error) {
      console.error('Error fetching stocktakes:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load stocktakes',
      });
    } finally {
      setLoading(false);
    }
  }, [filters?.status, filters?.warehouseId, profile?.tenant_id, toast]);

  useEffect(() => {
    fetchStocktakes();
  }, [fetchStocktakes]);

  const createStocktake = async (data: CreateStocktakeData) => {
    if (!profile?.tenant_id) throw new Error('No tenant');

    const insertData = {
      tenant_id: profile.tenant_id,
      created_by: profile.id,
      stocktake_number: '', // Will be set by trigger
      name: data.name || null,
      warehouse_id: data.warehouse_id,
      location_ids: data.location_ids ? JSON.stringify(data.location_ids) : null,
      freeze_moves: data.freeze_moves ?? false,
      allow_location_auto_fix: data.allow_location_auto_fix ?? false,
      billable: data.billable ?? false,
      include_accounts: data.include_accounts ? JSON.stringify(data.include_accounts) : null,
      scheduled_date: data.scheduled_date || null,
      notes: data.notes || null,
      status: 'draft',
    };

    const { data: result, error } = await db
      .from('stocktakes')
      .insert([insertData])
      .select()
      .single();

    if (error) throw error;

    const initialNote = data.notes?.trim();
    if (initialNote) {
      const { error: noteError } = await db.rpc('create_unified_note', {
        p_entity_type: 'stocktake',
        p_entity_id: result.id,
        p_note_text: initialNote,
        p_note_type: 'internal',
        p_source_entity_number: result.stocktake_number || null,
        p_metadata: {
          source: 'stocktake_create',
          legacy_column: 'stocktakes.notes',
        },
      });
      if (noteError) {
        // Keep stocktake creation successful even if note mirroring fails.
        console.warn('[useStocktakes] Failed to mirror initial note into unified notes:', noteError.message);
      }
    }

    toast({
      title: 'Stocktake Created',
      description: `Stocktake ${result.stocktake_number} has been created`,
    });

    await fetchStocktakes();
    return result;
  };

  const startStocktakeDetailed = useCallback(async (
    id: string,
    options?: { pauseExisting?: boolean },
  ): Promise<TimerStartResult> => {
    if (!profile?.tenant_id || !profile?.id) {
      return { ok: false, error_code: 'NOT_AUTHENTICATED', error_message: 'Not authenticated' } as TimerStartResult;
    }

    const nowIso = new Date().toISOString();

    try {
      // Start the timer first (so we count the full workflow from the user's click).
      const timerResult = await timerStartJob({
        tenantId: profile.tenant_id,
        userId: profile.id,
        jobType: 'stocktake',
        jobId: id,
        pauseExisting: options?.pauseExisting ?? false,
      });
      if (timerResult?.ok === false) return timerResult;

      // Initialize expected items using RPC
      const { data: itemCount, error: initError } = await db.rpc(
        'initialize_stocktake_expected_items',
        { p_stocktake_id: id }
      );
      if (initError) throw initError;

      // Update status to active
      const { error } = await db
        .from('stocktakes')
        .update({
          status: 'active',
          started_at: nowIso,
        })
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;

      toast({
        title: 'Stocktake Started',
        description: `Found ${itemCount} items to count`,
      });

      await fetchStocktakes();
      return timerResult;
    } catch (err: any) {
      // Best-effort rollback: don't leave a timer running if we failed to start the stocktake.
      try {
        await timerEndJob({
          tenantId: profile?.tenant_id,
          userId: profile?.id,
          jobType: 'stocktake',
          jobId: id,
          reason: 'rollback',
        });
      } catch {
        // ignore
      }

      return {
        ok: false,
        error_code: 'START_FAILED',
        error_message: err?.message || 'Failed to start stocktake',
      } as TimerStartResult;
    }
  }, [profile?.tenant_id, profile?.id, toast, fetchStocktakes]);

  const startStocktake = async (id: string) => {
    const res = await startStocktakeDetailed(id, { pauseExisting: false });
    if ((res as any)?.ok === false) {
      throw new Error((res as any)?.error_message || 'Failed to start stocktake');
    }
    return res;
  };

  const closeStocktake = async (id: string) => {
    if (!profile?.id) throw new Error('No user');

    // Use RPC to close and generate results
    const { data, error } = await db.rpc('close_stocktake', {
      p_stocktake_id: id,
      p_closed_by: profile.id,
    });

    if (error) throw error;

    const result = data?.[0];
    const varianceCount = (result?.missing || 0) + (result?.found_wrong_location || 0) + (result?.unexpected || 0);

    toast({
      title: 'Stocktake Closed',
      description: varianceCount > 0
        ? `Completed with ${varianceCount} variance(s)`
        : 'Completed with no variances',
    });

    // Stop timer interval (best-effort)
    try {
      await timerEndJob({
        tenantId: profile?.tenant_id,
        userId: profile?.id,
        jobType: 'stocktake',
        jobId: id,
        reason: 'complete',
      });
    } catch (timerErr) {
      console.warn('[useStocktakes] Failed to end stocktake timer:', timerErr);
    }

    // Snapshot actual minutes on the stocktake record (best-effort; must not block close)
    try {
      if (profile?.tenant_id) {
        const snapshotAt = new Date().toISOString();

        const { data: rows } = await (supabase
          .from('job_time_intervals') as any)
          .select('started_at, ended_at')
          .eq('tenant_id', profile.tenant_id)
          .eq('job_type', 'stocktake')
          .eq('job_id', id);

        const laborMinutes = Math.round(
          (rows || []).reduce((sum: number, r: any) => {
            const start = r.started_at as string;
            const end = (r.ended_at as string | null) || snapshotAt;
            return sum + minutesBetweenIso(start, end);
          }, 0)
        );

        const { data: stRow } = await db
          .from('stocktakes')
          .select('metadata')
          .eq('id', id)
          .maybeSingle();

        const merged = mergeServiceTimeActualSnapshot(stRow?.metadata ?? null, {
          actual_cycle_minutes: laborMinutes,
          actual_labor_minutes: laborMinutes,
          actual_snapshot_at: snapshotAt,
          actual_version: 1,
        });

        await db
          .from('stocktakes')
          .update({
            duration_minutes: laborMinutes,
            metadata: merged,
          })
          .eq('id', id);
      }
    } catch (snapshotErr) {
      console.warn('[useStocktakes] Failed to snapshot stocktake actual time:', snapshotErr);
    }

    await fetchStocktakes();
    return result;
  };

  const cancelStocktake = async (id: string) => {
    const { error } = await db
      .from('stocktakes')
      .update({ status: 'cancelled' })
      .eq('id', id);

    if (error) throw error;

    toast({
      title: 'Stocktake Cancelled',
    });

    // Stop timer interval if it was running (best-effort)
    try {
      await timerEndJob({
        tenantId: profile?.tenant_id,
        userId: profile?.id,
        jobType: 'stocktake',
        jobId: id,
        reason: 'cancel',
      });
    } catch {
      // ignore
    }

    await fetchStocktakes();
  };

  return {
    stocktakes,
    loading,
    refetch: fetchStocktakes,
    createStocktake,
    startStocktakeDetailed,
    startStocktake,
    closeStocktake,
    cancelStocktake,
  };
}

// Hook for a single stocktake with scan functionality
export function useStocktakeScan(stocktakeId: string) {
  const [stocktake, setStocktake] = useState<Stocktake | null>(null);
  const [expectedItems, setExpectedItems] = useState<StocktakeExpectedItem[]>([]);
  const [scans, setScans] = useState<StocktakeScan[]>([]);
  const [stats, setStats] = useState<StocktakeScanStats | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { profile } = useAuth();

  const fetchStocktake = useCallback(async () => {
    if (!stocktakeId) return;

    try {
      const { data, error } = await db
        .from('stocktakes')
        .select(`
          *,
          warehouse:warehouses!stocktakes_warehouse_id_fkey(id, name)
        `)
        .eq('id', stocktakeId)
        .single();

      if (error) throw error;
      setStocktake(data as unknown as Stocktake);
    } catch (error) {
      console.error('Error fetching stocktake:', error);
    }
  }, [stocktakeId]);

  const fetchExpectedItems = useCallback(async () => {
    if (!stocktakeId) return;

    try {
      const { data, error } = await db
        .from('stocktake_expected_items')
        .select(`
          *,
          expected_location:locations!stocktake_expected_items_expected_location_id_fkey(id, code, name)
        `)
        .eq('stocktake_id', stocktakeId)
        .order('item_code');

      if (error) throw error;
      setExpectedItems((data || []) as unknown as StocktakeExpectedItem[]);
    } catch (error) {
      console.error('Error fetching expected items:', error);
    }
  }, [stocktakeId]);

  const fetchScans = useCallback(async () => {
    if (!stocktakeId) return;

    try {
      const { data, error } = await db
        .from('stocktake_scans')
        .select(`
          *,
          scanned_location:locations!stocktake_scans_scanned_location_id_fkey(id, code),
          scanned_by_user:users!stocktake_scans_scanned_by_fkey(first_name, last_name)
        `)
        .eq('stocktake_id', stocktakeId)
        .order('scanned_at', { ascending: false });

      if (error) throw error;
      setScans((data || []) as unknown as StocktakeScan[]);
    } catch (error) {
      console.error('Error fetching scans:', error);
    }
  }, [stocktakeId]);

  const fetchStats = useCallback(async () => {
    if (!stocktakeId) return;

    try {
      const { data, error } = await db
        .from('v_stocktake_scan_stats')
        .select('*')
        .eq('stocktake_id', stocktakeId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      setStats(data as unknown as StocktakeScanStats);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  }, [stocktakeId]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStocktake(), fetchExpectedItems(), fetchScans(), fetchStats()]);
    setLoading(false);
  }, [fetchStocktake, fetchExpectedItems, fetchScans, fetchStats]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const recordScan = async (locationId: string, itemId: string, itemCode: string) => {
    if (!profile?.id) throw new Error('No user');

    const { data, error } = await db.rpc('record_stocktake_scan', {
      p_stocktake_id: stocktakeId,
      p_scanned_by: profile.id,
      p_scanned_location_id: locationId,
      p_item_id: itemId,
      p_item_code: itemCode,
    });

    if (error) throw error;

    const result = data?.[0];

    // Activity log on the item (best-effort)
    if (profile?.tenant_id) {
      const stNumber = stocktake?.stocktake_number || null;
      logItemActivity({
        tenantId: profile.tenant_id,
        itemId,
        actorUserId: profile.id,
        eventType: 'inventory_count_recorded',
        eventLabel: `Count recorded${stNumber ? ` (${stNumber})` : ''}`,
        details: {
          stocktake_id: stocktakeId,
          stocktake_number: stNumber,
          scanned_location_id: locationId,
          item_code: itemCode,
          scan_result: result?.result ?? null,
          was_expected: result?.was_expected ?? null,
          auto_fixed: result?.auto_fixed ?? null,
        },
      });
    }

    // Refresh data
    await Promise.all([fetchScans(), fetchStats()]);

    return {
      scanId: result?.scan_id,
      result: result?.result as ScanResult,
      wasExpected: result?.was_expected,
      expectedLocationId: result?.expected_location_id,
      autoFixed: result?.auto_fixed,
      message: result?.message,
    };
  };

  return {
    stocktake,
    expectedItems,
    scans,
    stats,
    loading,
    refetch: fetchAll,
    recordScan,
  };
}

// Hook for stocktake results/report
export function useStocktakeResults(stocktakeId: string) {
  const [results, setResults] = useState<StocktakeResult[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { profile } = useAuth();

  const fetchResults = useCallback(async () => {
    if (!stocktakeId) return;

    try {
      setLoading(true);
      const { data, error } = await db
        .from('stocktake_results')
        .select(`
          *,
          expected_location:locations!stocktake_results_expected_location_id_fkey(id, code),
          scanned_location:locations!stocktake_results_scanned_location_id_fkey(id, code),
          item:items!stocktake_results_item_id_fkey(id, item_code, description)
        `)
        .eq('stocktake_id', stocktakeId)
        .order('result')
        .order('item_code');

      if (error) throw error;
      setResults((data || []) as unknown as StocktakeResult[]);
    } catch (error) {
      console.error('Error fetching results:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load stocktake results',
      });
    } finally {
      setLoading(false);
    }
  }, [stocktakeId, toast]);

  useEffect(() => {
    fetchResults();
  }, [fetchResults]);

  const resolveResult = async (resultId: string, notes: string) => {
    if (!profile?.id) throw new Error('No user');

    const { error } = await db
      .from('stocktake_results')
      .update({
        resolved: true,
        resolution_notes: notes,
        resolved_by: profile.id,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', resultId);

    if (error) throw error;

    const trimmedNotes = notes.trim();
    if (trimmedNotes && profile?.tenant_id) {
      const resultRow = results.find((r) => r.id === resultId);
      let stocktakeNumber: string | null = null;

      const { data: stocktakeRow, error: stocktakeError } = await db
        .from('stocktakes')
        .select('stocktake_number')
        .eq('id', stocktakeId)
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle();

      if (stocktakeError) {
        console.warn('[useStocktakeResults] Failed to load stocktake number for unified note mirror:', stocktakeError.message);
      } else {
        stocktakeNumber = stocktakeRow?.stocktake_number || null;
      }

      const itemRef = resultRow?.item_code ? `item ${resultRow.item_code}` : 'item';
      const summary = `Variance resolved for ${itemRef}: ${trimmedNotes}`;

      const { error: noteError } = await (db as any).rpc('create_unified_note', {
        p_entity_type: 'stocktake',
        p_entity_id: stocktakeId,
        p_note_text: summary,
        p_note_type: 'internal',
        p_source_entity_number: stocktakeNumber,
        p_metadata: {
          source: 'stocktake_result_resolve',
          result_id: resultId,
          result_type: resultRow?.result || null,
          item_code: resultRow?.item_code || null,
          legacy_field: 'stocktake_results.resolution_notes',
        },
      });
      if (noteError) {
        console.warn('[useStocktakeResults] Failed to mirror resolution notes into unified notes:', noteError.message);
      }
    }

    toast({
      title: 'Variance Resolved',
    });

    await fetchResults();
  };

  return {
    results,
    loading,
    refetch: fetchResults,
    resolveResult,
  };
}

// Hook to check freeze status for an item
export function useStocktakeFreezeCheck() {
  const { profile } = useAuth();

  const checkFreeze = async (itemId: string): Promise<{
    isFrozen: boolean;
    stocktakeId?: string;
    stocktakeNumber?: string;
    message?: string;
  }> => {
    if (!profile?.tenant_id) return { isFrozen: false };

    const { data, error } = await db.rpc('check_stocktake_freeze', {
      p_item_id: itemId,
      p_tenant_id: profile.tenant_id,
    });

    if (error) {
      console.error('Error checking freeze:', error);
      return { isFrozen: false };
    }

    const result = data?.[0];
    return {
      isFrozen: result?.is_frozen ?? false,
      stocktakeId: result?.stocktake_id,
      stocktakeNumber: result?.stocktake_number,
      message: result?.message,
    };
  };

  return { checkFreeze };
}
