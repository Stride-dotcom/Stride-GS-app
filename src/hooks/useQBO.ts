/**
 * useQBO — QuickBooks Online integration hook.
 *
 * Manages QBO connection status, OAuth flow, and invoice push.
 * All QBO tokens are server-side only — never stored in React state or localStorage.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  fetchQboStatus,
  fetchQboAuthUrl,
  postQboCreateInvoice,
  postQboDisconnect,
} from '../lib/api';
import type { QboCreateInvoiceResponse } from '../lib/api';

export interface UseQBOResult {
  connected: boolean;
  companyName: string | undefined;
  loading: boolean;
  error: string | undefined;
  refreshStatus: () => Promise<void>;
  startAuth: () => Promise<void>;
  disconnect: () => Promise<void>;
  pushInvoice: (ledgerRowIds: string[], forceRePush?: boolean) => Promise<QboCreateInvoiceResponse | null>;
}

export function useQBO(): UseQBOResult {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);
  const [companyName, setCompanyName] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const listenerRef = useRef<((e: MessageEvent) => void) | null>(null);

  const isAdmin = user?.role === 'admin';

  const refreshStatus = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setError(undefined);
    try {
      const res = await fetchQboStatus();
      if (res.ok && res.data) {
        setConnected(res.data.connected);
        setCompanyName(res.data.companyName);
        if (!res.data.connected && res.data.error) {
          setError(res.data.error);
        }
      } else {
        setConnected(false);
        setError(res.error || 'Failed to check QBO status');
      }
    } catch (e) {
      setConnected(false);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  // Check status on mount (admin only)
  useEffect(() => {
    if (isAdmin) {
      refreshStatus();
    }
  }, [isAdmin, refreshStatus]);

  // Listen for postMessage from OAuth popup
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      // Accept messages from any origin (popup is on a different domain — script.google.com)
      if (event.data && typeof event.data === 'object' && 'success' in event.data) {
        if (event.data.success) {
          refreshStatus();
        } else {
          setError(event.data.error || 'OAuth authorization failed');
        }
      }
    };
    listenerRef.current = handler;
    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
      listenerRef.current = null;
    };
  }, [refreshStatus]);

  const startAuth = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const res = await fetchQboAuthUrl();
      if (res.ok && res.data?.url) {
        // Open OAuth popup
        const w = 600, h = 700;
        const left = window.screenX + (window.outerWidth - w) / 2;
        const top = window.screenY + (window.outerHeight - h) / 2;
        window.open(
          res.data.url,
          'qbo_auth',
          `width=${w},height=${h},left=${left},top=${top},toolbar=no,menubar=no`
        );
      } else {
        setError(res.error || 'Failed to get QBO auth URL');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const res = await postQboDisconnect();
      if (res.ok && res.data?.success) {
        setConnected(false);
        setCompanyName(undefined);
      } else {
        setError(res.error || 'Failed to disconnect QBO');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const pushInvoice = useCallback(async (
    ledgerRowIds: string[],
    forceRePush: boolean = false
  ): Promise<QboCreateInvoiceResponse | null> => {
    try {
      const res = await postQboCreateInvoice(ledgerRowIds, forceRePush);
      if (res.ok && res.data) {
        return res.data;
      }
      return {
        success: false,
        pushedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        results: [],
        error: res.error || 'QBO push failed',
      };
    } catch (e) {
      return {
        success: false,
        pushedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        results: [],
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }, []);

  return {
    connected,
    companyName,
    loading,
    error,
    refreshStatus,
    startAuth,
    disconnect,
    pushInvoice,
  };
}
