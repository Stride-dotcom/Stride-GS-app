/**
 * useInvoices — reads the client-facing invoice list from
 * public.invoice_tracking. RLS scopes the result automatically:
 *   - client roles see only their own tenant(s) (invoice_tracking_client_select)
 *   - admin/staff see all (invoice_tracking_staff)
 *
 * Realtime: invoice_tracking is in the supabase_realtime publication
 * (20260505000001_invoice_tracking.sql), so we subscribe directly to a
 * postgres_changes channel and refetch on any INSERT/UPDATE/DELETE. The
 * central useSupabaseRealtime channel doesn't cover this table, so the
 * subscription is local to the hook.
 */
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

export interface InvoiceRecord {
  invoiceNo: string;
  tenantId: string;
  clientName: string;
  invoiceDate: string | null;
  total: number;
  lineCount: number;
  qboPaid: boolean;
  pdfPath: string | null;
  createdAt: string | null;
}

interface InvoicesState {
  invoices: InvoiceRecord[];
  loading: boolean;
  error: string | null;
}

function mapRow(r: Record<string, unknown>): InvoiceRecord {
  return {
    invoiceNo: String(r.invoice_no || ''),
    tenantId: String(r.tenant_id || ''),
    clientName: String(r.client_name || ''),
    invoiceDate: r.invoice_date ? String(r.invoice_date) : null,
    total: Number(r.total) || 0,
    lineCount: Number(r.line_count) || 0,
    qboPaid: r.qbo_paid === true,
    pdfPath: r.pdf_path ? String(r.pdf_path) : null,
    createdAt: r.created_at ? String(r.created_at) : null,
  };
}

export function useInvoices(enabled = true) {
  const [state, setState] = useState<InvoicesState>({
    invoices: [],
    loading: enabled,
    error: null,
  });

  const fetchInvoices = useCallback(async () => {
    setState(s => ({ ...s, loading: true }));
    try {
      const { data, error } = await supabase
        .from('invoice_tracking')
        .select('invoice_no, tenant_id, client_name, invoice_date, total, line_count, qbo_paid, pdf_path, created_at')
        .order('invoice_date', { ascending: false, nullsFirst: false });
      if (error) throw new Error(error.message);
      const invoices = (data as Record<string, unknown>[] | null ?? []).map(mapRow);
      setState({ invoices, loading: false, error: null });
    } catch (e) {
      setState({ invoices: [], loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState({ invoices: [], loading: false, error: null });
      return;
    }
    fetchInvoices();

    const channel = supabase
      .channel('invoice_tracking_portal')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'invoice_tracking' },
        () => { fetchInvoices(); },
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [enabled, fetchInvoices]);

  return { ...state, refetch: fetchInvoices };
}
