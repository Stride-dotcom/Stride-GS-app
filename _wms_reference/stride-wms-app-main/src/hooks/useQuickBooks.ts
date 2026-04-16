import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface QBOConnectionStatus {
  connected: boolean;
  companyName?: string;
  realmId?: string;
  connectedAt?: string;
  lastSyncAt?: string;
  tokenExpiresSoon?: boolean;
  refreshTokenExpired?: boolean;
}

export interface BillingEventForSync {
  id: string;
  account_id: string;
  event_type: string;
  charge_type: string;
  description: string;
  quantity: number;
  unit_rate: number;
  total_amount: number;
  occurred_at: string;
  item_id?: string;
  item_code?: string;
}

export interface SyncResult {
  accountId: string;
  accountName: string;
  success: boolean;
  qboInvoiceId?: string;
  qboInvoiceNumber?: string;
  error?: string;
  lineCount: number;
  total: number;
}

export interface SyncResponse {
  success: boolean;
  results: SyncResult[];
  summary: {
    totalAccounts: number;
    successCount: number;
    failedCount: number;
    totalInvoiced: number;
  };
  error?: string;
}

export interface SyncLogEntry {
  id: string;
  account_id: string;
  account_name?: string;
  qbo_invoice_id: string;
  qbo_invoice_number?: string;
  period_start: string;
  period_end: string;
  line_count: number;
  subtotal: number;
  total_amount: number;
  synced_at: string;
  synced_by?: string;
  synced_by_name?: string;
  status: string;
  error_message?: string;
}

export function useQuickBooks() {
  const { profile } = useAuth();
  const [connectionStatus, setConnectionStatus] = useState<QBOConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check connection status
  const checkConnection = useCallback(async () => {
    if (!profile?.tenant_id) {
      setConnectionStatus(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        throw new Error('Not authenticated');
      }

      const { data, error: fnError } = await supabase.functions.invoke('qbo-auth/status', {
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
      });

      if (fnError) {
        throw fnError;
      }

      setConnectionStatus(data);
    } catch (err) {
      console.error('Error checking QBO connection:', err);
      setError(err instanceof Error ? err.message : 'Failed to check connection');
      setConnectionStatus({ connected: false });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id]);

  // Initial connection check
  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  // Initiate OAuth connection
  const connect = useCallback(async (): Promise<string | null> => {
    if (!profile?.tenant_id) {
      setError('No tenant found');
      return null;
    }

    try {
      setError(null);

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        throw new Error('Not authenticated');
      }

      const { data, error: fnError } = await supabase.functions.invoke('qbo-auth/connect', {
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
      });

      if (fnError) {
        throw fnError;
      }

      if (data?.authUrl) {
        return data.authUrl;
      }

      throw new Error(data?.error || 'Failed to get authorization URL');
    } catch (err) {
      console.error('Error initiating QBO connection:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to connect';
      setError(errorMessage);
      return null;
    }
  }, [profile?.tenant_id]);

  // Disconnect from QBO
  const disconnect = useCallback(async (): Promise<boolean> => {
    if (!profile?.tenant_id) {
      setError('No tenant found');
      return false;
    }

    try {
      setError(null);

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        throw new Error('Not authenticated');
      }

      const { data, error: fnError } = await supabase.functions.invoke('qbo-auth/disconnect', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
      });

      if (fnError) {
        throw fnError;
      }

      if (data?.success) {
        setConnectionStatus({ connected: false });
        return true;
      }

      throw new Error(data?.error || 'Failed to disconnect');
    } catch (err) {
      console.error('Error disconnecting QBO:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to disconnect';
      setError(errorMessage);
      return false;
    }
  }, [profile?.tenant_id]);

  // Sync billing events to QBO as invoices
  const syncToQuickBooks = useCallback(async (
    billingEvents: BillingEventForSync[],
    periodStart: string,
    periodEnd: string
  ): Promise<SyncResponse> => {
    if (!profile?.tenant_id) {
      return {
        success: false,
        results: [],
        summary: { totalAccounts: 0, successCount: 0, failedCount: 0, totalInvoiced: 0 },
        error: 'No tenant found',
      };
    }

    if (billingEvents.length === 0) {
      return {
        success: false,
        results: [],
        summary: { totalAccounts: 0, successCount: 0, failedCount: 0, totalInvoiced: 0 },
        error: 'No billing events to sync',
      };
    }

    try {
      setSyncing(true);
      setError(null);

      const { data: sessionData } = await supabase.auth.getSession();
      if (!sessionData.session) {
        throw new Error('Not authenticated');
      }

      const { data, error: fnError } = await supabase.functions.invoke('qbo-sync/invoices', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
        },
        body: {
          billingEvents,
          periodStart,
          periodEnd,
        },
      });

      if (fnError) {
        throw fnError;
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      // Refresh connection status after sync
      await checkConnection();

      return {
        success: true,
        results: data.results || [],
        summary: data.summary || { totalAccounts: 0, successCount: 0, failedCount: 0, totalInvoiced: 0 },
      };
    } catch (err) {
      console.error('Error syncing to QBO:', err);
      const errorMessage = err instanceof Error ? err.message : 'Failed to sync';
      setError(errorMessage);
      return {
        success: false,
        results: [],
        summary: { totalAccounts: 0, successCount: 0, failedCount: 0, totalInvoiced: 0 },
        error: errorMessage,
      };
    } finally {
      setSyncing(false);
    }
  }, [profile?.tenant_id, checkConnection]);

  // Fetch sync history
  const fetchSyncHistory = useCallback(async (
    options?: {
      accountId?: string;
      periodStart?: string;
      periodEnd?: string;
      limit?: number;
    }
  ): Promise<SyncLogEntry[]> => {
    if (!profile?.tenant_id) {
      return [];
    }

    try {
      let query = (supabase
        .from('qbo_invoice_sync_log') as any)
        .select(`
          *,
          accounts:account_id (account_name),
          users:synced_by (full_name)
        `)
        .eq('tenant_id', profile.tenant_id)
        .order('synced_at', { ascending: false });

      if (options?.accountId) {
        query = query.eq('account_id', options.accountId);
      }

      if (options?.periodStart) {
        query = query.gte('period_start', options.periodStart);
      }

      if (options?.periodEnd) {
        query = query.lte('period_end', options.periodEnd);
      }

      if (options?.limit) {
        query = query.limit(options.limit);
      }

      const { data, error: queryError } = await query;

      if (queryError) {
        console.error('Error fetching sync history:', queryError);
        return [];
      }

      return (data || []).map((entry: any) => ({
        ...entry,
        account_name: entry.accounts?.account_name,
        synced_by_name: entry.users?.full_name,
      }));
    } catch (err) {
      console.error('Error fetching sync history:', err);
      return [];
    }
  }, [profile?.tenant_id]);

  // Check if an account has been synced for a specific period
  const checkAccountSyncStatus = useCallback(async (
    accountId: string,
    periodStart: string,
    periodEnd: string
  ): Promise<{ synced: boolean; syncLog?: SyncLogEntry }> => {
    if (!profile?.tenant_id) {
      return { synced: false };
    }

    try {
      const { data, error: queryError } = await (supabase
        .from('qbo_invoice_sync_log') as any)
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('account_id', accountId)
        .eq('period_start', periodStart)
        .eq('period_end', periodEnd)
        .eq('status', 'success')
        .order('synced_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (queryError) {
        console.error('Error checking account sync status:', queryError);
        return { synced: false };
      }

      return {
        synced: !!data,
        syncLog: data || undefined,
      };
    } catch (err) {
      console.error('Error checking account sync status:', err);
      return { synced: false };
    }
  }, [profile?.tenant_id]);

  return {
    // Connection status
    connectionStatus,
    isConnected: connectionStatus?.connected ?? false,
    loading,
    error,

    // Actions
    checkConnection,
    connect,
    disconnect,
    syncToQuickBooks,
    syncing,

    // History
    fetchSyncHistory,
    checkAccountSyncStatus,
  };
}
