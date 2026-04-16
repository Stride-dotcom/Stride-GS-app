import { useState, useCallback, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  BillingEventForBuilder,
  InvoicePreview,
  PreviewLineItem,
  GroupByOptions,
  CreationResult,
  InvoiceBuilderSummary,
  PreviewCounts,
} from '@/lib/invoiceBuilder/types';
import { markBillingEventsInvoiced } from '@/services/billing';

export function useInvoiceBuilder() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // State
  const [billingEvents, setBillingEvents] = useState<BillingEventForBuilder[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [groupBy, setGroupBy] = useState<GroupByOptions>({
    account: true,
    sidemark: false,
    chargeType: false,
  });
  const [selectedPreviews, setSelectedPreviews] = useState<Set<string>>(new Set());
  const [previewNotes, setPreviewNotes] = useState<Record<string, string>>({});
  const [isCreating, setIsCreating] = useState(false);

  // Load billing events from URL params
  useEffect(() => {
    const eventsParam = searchParams.get('events');
    if (eventsParam && profile?.tenant_id) {
      const eventIds = eventsParam.split(',').filter(Boolean);
      if (eventIds.length > 0) {
        loadBillingEvents(eventIds);
      }
    }
  }, [searchParams, profile?.tenant_id]);

  // Fetch billing events by IDs
  const loadBillingEvents = useCallback(async (eventIds: string[]) => {
    if (!profile?.tenant_id || eventIds.length === 0) return;

    setIsLoading(true);
    try {
      const { data, error } = await (supabase
        .from('billing_events') as any)
        .select(`
          id,
          account_id,
          sidemark_id,
          charge_type,
          description,
          quantity,
          unit_rate,
          total_amount,
          occurred_at,
          item_id
        `)
        .in('id', eventIds)
        .eq('status', 'unbilled')
        .eq('tenant_id', profile.tenant_id);

      if (error) throw error;

      // Fetch related data
      const accountIds = [...new Set((data || []).map((e: any) => e.account_id).filter(Boolean))];
      const sidemarkIds = [...new Set((data || []).map((e: any) => e.sidemark_id).filter(Boolean))];
      const itemIds = [...new Set((data || []).map((e: any) => e.item_id).filter(Boolean))];

      let accountMap: Record<string, { name: string; code: string }> = {};
      let sidemarkMap: Record<string, string> = {};
      let itemMap: Record<string, string> = {};

      if (accountIds.length > 0) {
        const { data: accts } = await supabase
          .from('accounts')
          .select('id, account_name, account_code')
          .in('id', accountIds as string[]);
        if (accts) {
          accountMap = Object.fromEntries(
            accts.map((a: any) => [a.id, { name: a.account_name, code: a.account_code }])
          );
        }
      }

      if (sidemarkIds.length > 0) {
        const { data: sms } = await supabase
          .from('sidemarks')
          .select('id, sidemark_name')
          .in('id', sidemarkIds as string[]);
        if (sms) {
          sidemarkMap = Object.fromEntries(sms.map((s: any) => [s.id, s.sidemark_name]));
        }
      }

      if (itemIds.length > 0) {
        const { data: items } = await supabase
          .from('items')
          .select('id, item_code')
          .in('id', itemIds as string[]);
        if (items) {
          itemMap = Object.fromEntries(items.map((i: any) => [i.id, i.item_code]));
        }
      }

      const mapped: BillingEventForBuilder[] = (data || []).map((e: any) => ({
        id: e.id,
        account_id: e.account_id,
        account_name: accountMap[e.account_id]?.name || '',
        account_code: accountMap[e.account_id]?.code || '',
        sidemark_id: e.sidemark_id,
        sidemark_name: e.sidemark_id ? sidemarkMap[e.sidemark_id] || null : null,
        charge_type: e.charge_type,
        description: e.description,
        quantity: e.quantity,
        unit_rate: e.unit_rate,
        total_amount: e.total_amount,
        occurred_at: e.occurred_at,
        item_id: e.item_id,
        item_code: e.item_id ? itemMap[e.item_id] || null : null,
      }));

      setBillingEvents(mapped);
    } catch (err) {
      console.error('Error loading billing events:', err);
      toast({
        title: 'Error loading billing events',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [profile?.tenant_id, toast]);

  // Calculate invoice previews based on grouping
  const invoicePreviews = useMemo((): InvoicePreview[] => {
    if (billingEvents.length === 0) return [];

    const groups: Record<string, BillingEventForBuilder[]> = {};

    for (const event of billingEvents) {
      const keyParts: string[] = [];

      if (groupBy.account) {
        keyParts.push(`account:${event.account_id}`);
      }
      if (groupBy.sidemark) {
        keyParts.push(`sidemark:${event.sidemark_id || 'none'}`);
      }
      if (groupBy.chargeType) {
        keyParts.push(`charge:${event.charge_type}`);
      }

      const key = keyParts.length > 0 ? keyParts.join('|') : 'all';

      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(event);
    }

    return Object.entries(groups).map(([groupKey, events]) => {
      const firstEvent = events[0];
      const dates = events.map(e => e.occurred_at).filter(Boolean).sort();
      const chargeTypes = [...new Set(events.map(e => e.charge_type))];

      const lineItems: PreviewLineItem[] = events.map(e => ({
        billingEventId: e.id,
        occurredAt: e.occurred_at,
        chargeType: e.charge_type,
        description: e.description,
        quantity: e.quantity,
        unitRate: e.unit_rate,
        totalAmount: e.total_amount,
        itemCode: e.item_code,
        sidemarkName: e.sidemark_name,
      }));

      const subtotal = events.reduce((sum, e) => sum + Number(e.total_amount || 0), 0);

      return {
        id: groupKey,
        groupKey,
        accountId: firstEvent.account_id,
        accountName: firstEvent.account_name,
        accountCode: firstEvent.account_code,
        sidemarkId: groupBy.sidemark ? firstEvent.sidemark_id : null,
        sidemarkName: groupBy.sidemark ? firstEvent.sidemark_name : null,
        chargeTypes,
        billingEventIds: events.map(e => e.id),
        lineItems,
        subtotal,
        periodStart: dates[0]?.slice(0, 10) || '',
        periodEnd: dates[dates.length - 1]?.slice(0, 10) || '',
        notes: previewNotes[groupKey] || '',
      };
    });
  }, [billingEvents, groupBy, previewNotes]);

  // Auto-select all when previews change
  useEffect(() => {
    if (invoicePreviews.length > 0) {
      setSelectedPreviews(new Set(invoicePreviews.map(p => p.id)));
    }
  }, [invoicePreviews.length]);

  // Preview counts for grouping selector
  const previewCounts = useMemo((): PreviewCounts => {
    const byAccount = new Set(billingEvents.map(e => e.account_id)).size;
    const bySidemark = new Set(billingEvents.map(e => `${e.account_id}-${e.sidemark_id || 'none'}`)).size;
    const byChargeType = new Set(billingEvents.map(e => e.charge_type)).size;

    return {
      byAccount: byAccount || 1,
      bySidemark: bySidemark || 1,
      byChargeType: byChargeType || 1,
      custom: invoicePreviews.length || 1,
    };
  }, [billingEvents, invoicePreviews]);

  // Toggle preview selection
  const togglePreviewSelection = useCallback((previewId: string) => {
    setSelectedPreviews(prev => {
      const next = new Set(prev);
      if (next.has(previewId)) {
        next.delete(previewId);
      } else {
        next.add(previewId);
      }
      return next;
    });
  }, []);

  // Select/deselect all
  const toggleSelectAll = useCallback(() => {
    if (selectedPreviews.size === invoicePreviews.length) {
      setSelectedPreviews(new Set());
    } else {
      setSelectedPreviews(new Set(invoicePreviews.map(p => p.id)));
    }
  }, [invoicePreviews, selectedPreviews]);

  // Update notes for a preview
  const updatePreviewNotes = useCallback((previewId: string, notes: string) => {
    setPreviewNotes(prev => ({ ...prev, [previewId]: notes }));
  }, []);

  // Create invoices from selected previews
  const createInvoices = useCallback(async (): Promise<CreationResult> => {
    const result: CreationResult = {
      success: 0,
      failed: 0,
      invoiceIds: [],
      batchId: crypto.randomUUID(),
    };

    if (!profile?.tenant_id || !profile?.id) {
      toast({ title: 'Error', description: 'No tenant context', variant: 'destructive' });
      return result;
    }

    const selectedPreviewList = invoicePreviews.filter(p => selectedPreviews.has(p.id));
    if (selectedPreviewList.length === 0) {
      toast({ title: 'No invoices selected', variant: 'destructive' });
      return result;
    }

    setIsCreating(true);

    try {
      // Get account billing terms
      const accountIds = [...new Set(selectedPreviewList.map(p => p.accountId))];
      const { data: accountsData } = await supabase
        .from('accounts')
        .select('id, billing_net_terms')
        .in('id', accountIds);

      const accountTermsMap = new Map(
        (accountsData || []).map((a: any) => [a.id, a.billing_net_terms])
      );

      // Get org default net terms (using 'as any' since column may not be in typed schema)
      const { data: prefData } = await (supabase as any)
        .from('tenant_preferences')
        .select('default_net_terms')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle();

      const defaultNetTerms = (prefData as any)?.default_net_terms || 30;

      // Create each invoice
      for (const preview of selectedPreviewList) {
        try {
          // Get next invoice number using RPC function (using 'as any' since RPC may not be in typed schema)
          const { data: invNumData, error: invNumError } = await (supabase as any)
            .rpc('next_global_invoice_number');

          if (invNumError) throw invNumError;
          const invoiceNumber = invNumData as string;

          // Calculate due date
          const netTerms = accountTermsMap.get(preview.accountId) || defaultNetTerms;
          const invoiceDate = new Date();
          const dueDate = new Date(invoiceDate);
          dueDate.setDate(dueDate.getDate() + netTerms);

          // Create invoice record
          const { data: invoice, error: invError } = await (supabase
            .from('invoices') as any)
            .insert({
              tenant_id: profile.tenant_id,
              account_id: preview.accountId,
              sidemark_id: preview.sidemarkId,
              invoice_number: invoiceNumber,
              invoice_date: invoiceDate.toISOString().slice(0, 10),
              due_date: dueDate.toISOString().slice(0, 10),
              period_start: preview.periodStart,
              period_end: preview.periodEnd,
              status: 'draft',
              subtotal: preview.subtotal,
              tax_amount: 0,
              total_amount: preview.subtotal,
              notes: preview.notes || null,
              batch_id: result.batchId,
              created_by: profile.id,
            })
            .select('id')
            .single();

          if (invError) throw invError;

          // Create invoice lines
          const lines = preview.lineItems.map(item => ({
            tenant_id: profile.tenant_id,
            invoice_id: invoice.id,
            billing_event_id: item.billingEventId,
            charge_type: item.chargeType,
            description: item.description || item.chargeType,
            quantity: item.quantity,
            unit_rate: item.unitRate,
            total_amount: item.totalAmount,
            occurred_at: item.occurredAt,
            sidemark_name: item.sidemarkName,
          }));

          const { error: linesError } = await supabase
            .from('invoice_lines')
            .insert(lines);

          if (linesError) throw linesError;

          // Update billing events to invoiced status
          const markResult = await markBillingEventsInvoiced({
            eventIds: preview.billingEventIds,
            invoiceId: invoice.id,
            invoicedAt: new Date().toISOString(),
          });

          if (!markResult.success) throw new Error(markResult.error);

          result.success++;
          result.invoiceIds.push(invoice.id);

        } catch (err) {
          console.error('Error creating invoice:', err);
          result.failed++;
        }
      }

      // Show result toast
      if (result.success > 0) {
        toast({
          title: 'Invoices created',
          description: `Successfully created ${result.success} invoice(s)${result.failed > 0 ? `, ${result.failed} failed` : ''}`,
        });
      } else {
        toast({
          title: 'Invoice creation failed',
          description: 'Could not create any invoices',
          variant: 'destructive',
        });
      }

      return result;

    } catch (err) {
      console.error('Error in createInvoices:', err);
      toast({
        title: 'Error creating invoices',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
      return result;
    } finally {
      setIsCreating(false);
    }
  }, [profile, invoicePreviews, selectedPreviews, toast]);

  // Clear builder and navigate away
  const clearBuilder = useCallback(() => {
    setBillingEvents([]);
    setSelectedPreviews(new Set());
    setPreviewNotes({});
    setGroupBy({ account: true, sidemark: false, chargeType: false });

    const newParams = new URLSearchParams(searchParams);
    newParams.delete('events');
    setSearchParams(newParams);
  }, [searchParams, setSearchParams]);

  // Summary stats
  const summary: InvoiceBuilderSummary = useMemo(() => {
    const total = billingEvents.reduce((sum, e) => sum + Number(e.total_amount || 0), 0);
    const accountCount = new Set(billingEvents.map(e => e.account_id)).size;
    const dates = billingEvents.map(e => e.occurred_at).filter(Boolean).sort();

    return {
      eventCount: billingEvents.length,
      total,
      accountCount,
      dateRange: {
        start: dates[0]?.slice(0, 10) || '',
        end: dates[dates.length - 1]?.slice(0, 10) || '',
      },
    };
  }, [billingEvents]);

  return {
    billingEvents,
    isLoading,
    groupBy,
    setGroupBy,
    invoicePreviews,
    selectedPreviews,
    previewCounts,
    isCreating,
    summary,
    togglePreviewSelection,
    toggleSelectAll,
    updatePreviewNotes,
    createInvoices,
    clearBuilder,
  };
}
