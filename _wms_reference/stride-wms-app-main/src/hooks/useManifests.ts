import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

// Type-safe supabase client cast for tables/functions not in generated types
const db = supabase as any;

// Types
export type ManifestStatus = 'draft' | 'active' | 'in_progress' | 'completed' | 'cancelled';
export type ManifestScanResult = 'valid' | 'not_on_manifest' | 'duplicate' | 'wrong_location' | 'item_not_found';
export type ManifestHistoryAction =
  | 'created'
  | 'updated'
  | 'item_added'
  | 'item_removed'
  | 'items_bulk_added'
  | 'items_bulk_removed'
  | 'started'
  | 'completed'
  | 'cancelled'
  | 'status_changed';

export interface Manifest {
  id: string;
  tenant_id: string;
  manifest_number: string;
  name: string;
  description: string | null;
  warehouse_id: string;
  location_ids: string[] | null;
  status: ManifestStatus;
  billable: boolean;
  include_accounts: string[] | null;
  expected_item_count: number;
  scanned_item_count: number;
  scheduled_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_by: string | null;
  updated_at: string;
  started_by: string | null;
  started_at: string | null;
  completed_by: string | null;
  completed_at: string | null;
  assigned_to: string | null;
  warehouse?: { id: string; name: string } | null;
  assigned_user?: { id: string; first_name: string | null; last_name: string | null } | null;
  created_by_user?: { id: string; first_name: string | null; last_name: string | null } | null;
}

export interface ManifestItem {
  id: string;
  manifest_id: string;
  item_id: string;
  expected_location_id: string | null;
  item_code: string;
  item_description: string | null;
  account_id: string | null;
  scanned: boolean;
  scanned_by: string | null;
  scanned_at: string | null;
  scanned_location_id: string | null;
  added_by: string | null;
  added_at: string;
  created_at: string;
  item?: {
    id: string;
    item_code: string;
    sku?: string | null;
    quantity?: number | null;
    size?: number | null;
    size_unit?: string | null;
    description: string | null;
    status: string;
    vendor?: string | null;
    sidemark?: string | null;
    room?: string | null;
    primary_photo_url?: string | null;
    metadata?: Record<string, unknown> | null;
  };
  expected_location?: {
    id: string;
    code: string;
    name: string | null;
  };
  scanned_location?: {
    id: string;
    code: string;
    name: string | null;
  };
  account?: {
    id: string;
    account_name: string;
  };
}

export interface ManifestScan {
  id: string;
  manifest_id: string;
  scanned_by: string;
  scanned_at: string;
  scanned_location_id: string;
  item_id: string | null;
  item_code: string;
  scan_result: ManifestScanResult;
  message: string | null;
  metadata: Record<string, any> | null;
  scanned_location?: { id: string; code: string };
  scanned_by_user?: { first_name: string | null; last_name: string | null };
}

export interface ManifestHistory {
  id: string;
  manifest_id: string;
  action: ManifestHistoryAction;
  changed_by: string;
  changed_at: string;
  old_values: Record<string, any> | null;
  new_values: Record<string, any> | null;
  description: string | null;
  affected_item_ids: string[] | null;
  changed_by_user?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
  };
}

export interface ManifestStats {
  manifest_id: string;
  manifest_number: string;
  name: string;
  status: ManifestStatus;
  expected_item_count: number;
  scanned_item_count: number;
  remaining_items: number;
  progress_percent: number;
  valid_scans: number;
  rejected_scans: number;
  duplicate_scans: number;
  created_by: string | null;
  created_at: string;
  started_by: string | null;
  started_at: string | null;
  completed_by: string | null;
  completed_at: string | null;
}

export interface CreateManifestData {
  name: string;
  description?: string;
  warehouse_id: string;
  location_ids?: string[];
  billable?: boolean;
  include_accounts?: string[];
  scheduled_date?: string | null;
  notes?: string | null;
  assigned_to?: string | null;
}

export interface UpdateManifestData {
  name?: string;
  description?: string;
  location_ids?: string[];
  billable?: boolean;
  include_accounts?: string[];
  scheduled_date?: string | null;
  notes?: string | null;
  assigned_to?: string | null;
}

export interface ManifestFilters {
  status?: ManifestStatus;
  warehouseId?: string;
}

// ============================================================================
// MAIN HOOK FOR MANIFESTS LIST
// ============================================================================

export function useManifests(filters?: ManifestFilters) {
  const [manifests, setManifests] = useState<Manifest[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { profile } = useAuth();

  const fetchManifests = useCallback(async () => {
    if (!profile?.tenant_id) return;

    try {
      setLoading(true);
      let query = db
        .from('stocktake_manifests')
        .select(`
          *,
          warehouse:warehouses!stocktake_manifests_warehouse_id_fkey(id, name),
          assigned_user:users!stocktake_manifests_assigned_to_fkey(id, first_name, last_name),
          created_by_user:users!stocktake_manifests_created_by_fkey(id, first_name, last_name)
        `)
        .eq('tenant_id', profile.tenant_id)
        .order('created_at', { ascending: false });

      if (filters?.status) {
        query = query.eq('status', filters.status);
      }
      if (filters?.warehouseId) {
        query = query.eq('warehouse_id', filters.warehouseId);
      }

      const { data, error } = await query;

      if (error) throw error;
      setManifests((data || []) as unknown as Manifest[]);
    } catch (error) {
      console.error('Error fetching manifests:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load manifests',
      });
    } finally {
      setLoading(false);
    }
  }, [filters?.status, filters?.warehouseId, profile?.tenant_id, toast]);

  useEffect(() => {
    fetchManifests();
  }, [fetchManifests]);

  const createManifest = async (data: CreateManifestData) => {
    if (!profile?.tenant_id) throw new Error('No tenant');

    const insertData = {
      tenant_id: profile.tenant_id,
      created_by: profile.id,
      manifest_number: '', // Will be set by trigger
      name: data.name,
      description: data.description || null,
      warehouse_id: data.warehouse_id,
      location_ids: data.location_ids ? JSON.stringify(data.location_ids) : null,
      billable: data.billable ?? false,
      include_accounts: data.include_accounts ? JSON.stringify(data.include_accounts) : null,
      scheduled_date: data.scheduled_date || null,
      notes: data.notes || null,
      assigned_to: data.assigned_to || null,
      status: 'draft',
    };

    const { data: result, error } = await db
      .from('stocktake_manifests')
      .insert([insertData])
      .select()
      .single();

    if (error) throw error;

    toast({
      title: 'Manifest Created',
      description: `Manifest ${result.manifest_number} has been created`,
    });

    await fetchManifests();
    return result;
  };

  const updateManifest = async (id: string, data: UpdateManifestData) => {
    if (!profile?.id) throw new Error('No user');

    const updateData: any = {
      updated_by: profile.id,
      updated_at: new Date().toISOString(),
    };

    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.location_ids !== undefined) updateData.location_ids = JSON.stringify(data.location_ids);
    if (data.billable !== undefined) updateData.billable = data.billable;
    if (data.include_accounts !== undefined) {
      updateData.include_accounts = data.include_accounts ? JSON.stringify(data.include_accounts) : null;
    }
    if (data.scheduled_date !== undefined) updateData.scheduled_date = data.scheduled_date;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.assigned_to !== undefined) updateData.assigned_to = data.assigned_to;

    const { data: result, error } = await db
      .from('stocktake_manifests')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    toast({
      title: 'Manifest Updated',
      description: 'Changes have been saved',
    });

    await fetchManifests();
    return result;
  };

  const deleteManifest = async (id: string) => {
    // Only delete draft manifests
    const { error } = await db
      .from('stocktake_manifests')
      .delete()
      .eq('id', id)
      .eq('status', 'draft');

    if (error) throw error;

    toast({
      title: 'Manifest Deleted',
    });

    await fetchManifests();
  };

  const startManifest = async (id: string) => {
    if (!profile?.id) throw new Error('No user');

    const { data, error } = await db.rpc('start_manifest', {
      p_manifest_id: id,
      p_user_id: profile.id,
    });

    if (error) throw error;

    const result = data?.[0];
    if (!result?.success) {
      throw new Error(result?.message || 'Failed to start manifest');
    }

    toast({
      title: 'Manifest Started',
      description: result.message,
    });

    await fetchManifests();
    return result;
  };

  const completeManifest = async (id: string) => {
    if (!profile?.id) throw new Error('No user');

    const { data, error } = await db.rpc('complete_manifest', {
      p_manifest_id: id,
      p_user_id: profile.id,
    });

    if (error) throw error;

    const result = data?.[0];
    if (!result?.success) {
      throw new Error(result?.message || 'Failed to complete manifest');
    }

    toast({
      title: 'Manifest Completed',
      description: result.message,
    });

    await fetchManifests();
    return result;
  };

  const cancelManifest = async (id: string, reason?: string) => {
    if (!profile?.id) throw new Error('No user');

    const { data, error } = await db.rpc('cancel_manifest', {
      p_manifest_id: id,
      p_user_id: profile.id,
      p_reason: reason || null,
    });

    if (error) throw error;

    const result = data?.[0];
    if (!result?.success) {
      throw new Error(result?.message || 'Failed to cancel manifest');
    }

    toast({
      title: 'Manifest Cancelled',
    });

    await fetchManifests();
  };

  const addItemsToManifest = async (manifestId: string, itemIds: string[]) => {
    if (!profile?.id) throw new Error('No user');

    const { data, error } = await db.rpc('add_manifest_items_bulk', {
      p_manifest_id: manifestId,
      p_item_ids: itemIds,
      p_added_by: profile.id,
    });

    if (error) throw error;

    const result = data?.[0];
    if (!result?.success) {
      throw new Error(result?.message || 'Failed to add items to manifest');
    }

    return result;
  };

  return {
    manifests,
    loading,
    refetch: fetchManifests,
    createManifest,
    updateManifest,
    deleteManifest,
    startManifest,
    completeManifest,
    cancelManifest,
    addItemsToManifest,
  };
}

// ============================================================================
// HOOK FOR SINGLE MANIFEST WITH ITEMS AND SCANNING
// ============================================================================

export function useManifestScan(manifestId: string) {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [items, setItems] = useState<ManifestItem[]>([]);
  const [scans, setScans] = useState<ManifestScan[]>([]);
  const [stats, setStats] = useState<ManifestStats | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { profile } = useAuth();

  const fetchManifest = useCallback(async () => {
    if (!manifestId) return;

    try {
      const { data, error } = await db
        .from('stocktake_manifests')
        .select(`
          *,
          warehouse:warehouses!stocktake_manifests_warehouse_id_fkey(id, name),
          assigned_user:users!stocktake_manifests_assigned_to_fkey(id, first_name, last_name)
        `)
        .eq('id', manifestId)
        .single();

      if (error) throw error;
      setManifest(data as unknown as Manifest);
    } catch (error) {
      console.error('Error fetching manifest:', error);
    }
  }, [manifestId]);

  const fetchItems = useCallback(async () => {
    if (!manifestId) return;

    try {
      const { data, error } = await db
        .from('stocktake_manifest_items')
        .select(`
          *,
          item:items(id, item_code, sku, quantity, size, size_unit, description, status, vendor, sidemark, room, primary_photo_url, metadata),
          expected_location:locations!stocktake_manifest_items_expected_location_id_fkey(id, code, name),
          scanned_location:locations!stocktake_manifest_items_scanned_location_id_fkey(id, code, name),
          account:accounts(id, account_name)
        `)
        .eq('manifest_id', manifestId)
        .order('item_code');

      if (error) throw error;
      setItems((data || []) as unknown as ManifestItem[]);
    } catch (error) {
      console.error('Error fetching manifest items:', error);
    }
  }, [manifestId]);

  const fetchScans = useCallback(async () => {
    if (!manifestId) return;

    try {
      const { data, error } = await db
        .from('stocktake_manifest_scans')
        .select(`
          *,
          scanned_location:locations!stocktake_manifest_scans_scanned_location_id_fkey(id, code),
          scanned_by_user:users!stocktake_manifest_scans_scanned_by_fkey(first_name, last_name)
        `)
        .eq('manifest_id', manifestId)
        .order('scanned_at', { ascending: false });

      if (error) throw error;
      setScans((data || []) as unknown as ManifestScan[]);
    } catch (error) {
      console.error('Error fetching scans:', error);
    }
  }, [manifestId]);

  const fetchStats = useCallback(async () => {
    if (!manifestId) return;

    try {
      const { data, error } = await db
        .from('v_manifest_stats')
        .select('*')
        .eq('manifest_id', manifestId)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      setStats(data as unknown as ManifestStats);
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  }, [manifestId]);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchManifest(), fetchItems(), fetchScans(), fetchStats()]);
    setLoading(false);
  }, [fetchManifest, fetchItems, fetchScans, fetchStats]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Record a scan - returns result with error flag for haptic feedback
  const recordScan = async (locationId: string, itemId: string, itemCode: string): Promise<{
    scanId: string;
    result: ManifestScanResult;
    isValid: boolean;
    message: string;
    triggerErrorFeedback: boolean;
  }> => {
    if (!profile?.id) throw new Error('No user');

    const { data, error } = await db.rpc('record_manifest_scan', {
      p_manifest_id: manifestId,
      p_scanned_by: profile.id,
      p_scanned_location_id: locationId,
      p_item_id: itemId,
      p_item_code: itemCode,
    });

    if (error) throw error;

    const result = data?.[0];

    // Refresh data after scan
    await Promise.all([fetchItems(), fetchScans(), fetchStats()]);

    return {
      scanId: result?.scan_id,
      result: result?.result as ManifestScanResult,
      isValid: result?.is_valid ?? false,
      message: result?.message ?? '',
      triggerErrorFeedback: result?.trigger_error_feedback ?? false,
    };
  };

  // Add items to manifest
  const addItems = async (itemIds: string[]) => {
    if (!profile?.id) throw new Error('No user');

    const { data, error } = await db.rpc('add_manifest_items_bulk', {
      p_manifest_id: manifestId,
      p_item_ids: itemIds,
      p_added_by: profile.id,
    });

    if (error) throw error;

    const result = data?.[0];
    if (!result?.success) {
      throw new Error(result?.message || 'Failed to add items');
    }

    toast({
      title: 'Items Added',
      description: result.message,
    });

    await Promise.all([fetchManifest(), fetchItems()]);
    return result;
  };

  // Remove items from manifest
  const removeItems = async (itemIds: string[]) => {
    if (!profile?.id) throw new Error('No user');

    const { data, error } = await db.rpc('remove_manifest_items_bulk', {
      p_manifest_id: manifestId,
      p_item_ids: itemIds,
      p_removed_by: profile.id,
    });

    if (error) throw error;

    const result = data?.[0];
    if (!result?.success) {
      throw new Error(result?.message || 'Failed to remove items');
    }

    toast({
      title: 'Items Removed',
      description: result.message,
    });

    await Promise.all([fetchManifest(), fetchItems()]);
    return result;
  };

  return {
    manifest,
    items,
    scans,
    stats,
    loading,
    refetch: fetchAll,
    recordScan,
    addItems,
    removeItems,
  };
}

// ============================================================================
// HOOK FOR MANIFEST AUDIT HISTORY
// ============================================================================

export function useManifestHistory(manifestId: string) {
  const [history, setHistory] = useState<ManifestHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetchHistory = useCallback(async () => {
    if (!manifestId) return;

    try {
      setLoading(true);
      const { data, error } = await db
        .from('stocktake_manifest_history')
        .select(`
          *,
          changed_by_user:users!stocktake_manifest_history_changed_by_fkey(id, first_name, last_name, email)
        `)
        .eq('manifest_id', manifestId)
        .order('changed_at', { ascending: false });

      if (error) throw error;
      setHistory((data || []) as unknown as ManifestHistory[]);
    } catch (error) {
      console.error('Error fetching manifest history:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load manifest history',
      });
    } finally {
      setLoading(false);
    }
  }, [manifestId, toast]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return {
    history,
    loading,
    refetch: fetchHistory,
  };
}

// ============================================================================
// HOOK FOR MANIFEST ITEMS MANAGEMENT (editing items on a draft manifest)
// ============================================================================

export function useManifestItems(manifestId: string) {
  const [items, setItems] = useState<ManifestItem[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();
  const { profile } = useAuth();

  const fetchItems = useCallback(async () => {
    if (!manifestId) return;

    try {
      setLoading(true);
      const { data, error } = await db
        .from('stocktake_manifest_items')
        .select(`
          *,
          item:items!stocktake_manifest_items_item_id_fkey(id, item_code, sku, description, status, vendor),
          expected_location:locations!stocktake_manifest_items_expected_location_id_fkey(id, code, name),
          account:accounts!stocktake_manifest_items_account_id_fkey(id, name)
        `)
        .eq('manifest_id', manifestId)
        .order('item_code');

      if (error) throw error;
      setItems((data || []) as unknown as ManifestItem[]);
    } catch (error) {
      console.error('Error fetching manifest items:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load manifest items',
      });
    } finally {
      setLoading(false);
    }
  }, [manifestId, toast]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  const addItem = async (itemId: string) => {
    if (!profile?.id) throw new Error('No user');

    // Get item details
    const { data: item, error: itemError } = await db
      .from('items')
      .select('id, item_code, description, current_location_id, account_id')
      .eq('id', itemId)
      .single();

    if (itemError) throw itemError;

    const { error } = await db
      .from('stocktake_manifest_items')
      .insert([{
        manifest_id: manifestId,
        item_id: itemId,
        expected_location_id: item.current_location_id,
        item_code: item.item_code,
        item_description: item.description,
        account_id: item.account_id,
        added_by: profile.id,
      }]);

    if (error) {
      if (error.code === '23505') {
        throw new Error('Item is already on this manifest');
      }
      throw error;
    }

    toast({
      title: 'Item Added',
      description: `${item.item_code} added to manifest`,
    });

    await fetchItems();
  };

  const removeItem = async (manifestItemId: string) => {
    const { error } = await db
      .from('stocktake_manifest_items')
      .delete()
      .eq('id', manifestItemId);

    if (error) throw error;

    toast({
      title: 'Item Removed',
    });

    await fetchItems();
  };

  const addItemsBulk = async (itemIds: string[]) => {
    if (!profile?.id) throw new Error('No user');

    const { data, error } = await db.rpc('add_manifest_items_bulk', {
      p_manifest_id: manifestId,
      p_item_ids: itemIds,
      p_added_by: profile.id,
    });

    if (error) throw error;

    const result = data?.[0];
    toast({
      title: 'Items Added',
      description: result?.message || `${result?.items_added || 0} items added`,
    });

    await fetchItems();
    return result;
  };

  const removeItemsBulk = async (itemIds: string[]) => {
    if (!profile?.id) throw new Error('No user');

    const { data, error } = await db.rpc('remove_manifest_items_bulk', {
      p_manifest_id: manifestId,
      p_item_ids: itemIds,
      p_removed_by: profile.id,
    });

    if (error) throw error;

    const result = data?.[0];
    toast({
      title: 'Items Removed',
      description: result?.message || `${result?.items_removed || 0} items removed`,
    });

    await fetchItems();
    return result;
  };

  return {
    items,
    loading,
    refetch: fetchItems,
    addItem,
    removeItem,
    addItemsBulk,
    removeItemsBulk,
  };
}
