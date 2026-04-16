import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { logBillingActivity } from "@/lib/activity/logActivity";

export type InvoiceType = "weekly_services" | "monthly_storage" | "closeout" | "manual";
export type InvoiceStatus = "draft" | "sent" | "void";

// Use 'any' for DB row types since schema varies
export interface Invoice {
  id: string;
  tenant_id: string;
  account_id: string;
  invoice_number: string;
  invoice_type?: string;
  period_start?: string;
  period_end?: string;
  status: string;
  subtotal?: number;
  tax_total?: number;
  total?: number;
  total_amount?: number;
  notes?: string | null;
  created_by?: string | null;
  created_at: string;
  sent_at?: string | null;
  [key: string]: unknown;
}

export interface InvoiceLine {
  id: string;
  invoice_id: string;
  billing_event_id?: string | null;
  item_id?: string | null;
  description?: string | null;
  quantity: number;
  unit_rate: number;
  total_amount?: number;
  [key: string]: unknown;
}

export interface CreateInvoiceArgs {
  accountId: string;
  sidemark?: string | null;
  invoiceType: InvoiceType;
  periodStart: string;
  periodEnd: string;
  includeUnbilledBeforePeriod?: boolean;
}

export type InvoiceGrouping =
  | 'single'               // All events in one invoice (no grouping)
  | 'by_account'           // One invoice per account
  | 'by_sidemark'          // Separate invoices for each sidemark
  | 'by_account_sidemark'  // Separate by both account AND sidemark
  | 'include_subaccounts'; // Include sub-account charges on parent account invoice

export interface CreateInvoicesFromEventsArgs {
  billingEventIds: string[];
  grouping: InvoiceGrouping;
  invoiceType: InvoiceType;
}

export function useInvoices() {
  const { toast } = useToast();
  const { profile } = useAuth();

  const createInvoiceDraft = useCallback(async (args: CreateInvoiceArgs): Promise<Invoice | null> => {
    try {
      if (!profile?.tenant_id) {
        throw new Error("No tenant context");
      }

      // 1) get invoice number from RPC
      const { data: invNum, error: invNumErr } = await supabase.rpc("next_invoice_number");
      if (invNumErr) throw invNumErr;
      const invoice_number = invNum as string;

      // 2) fetch unbilled billing_events for account in period (and optionally earlier)
      let query = supabase
        .from("billing_events")
        .select("*")
        .eq("account_id", args.accountId)
        .eq("status", "unbilled");

      // Optional sidemark filter
      if (args.sidemark) {
        query = query.eq("sidemark_id", args.sidemark);
      }

      if (args.includeUnbilledBeforePeriod) {
        // Include all unbilled charges up to period end
        query = query.lte("occurred_at", `${args.periodEnd}T23:59:59.999Z`);
      } else {
        // Only charges within period
        query = query
          .gte("occurred_at", `${args.periodStart}T00:00:00.000Z`)
          .lte("occurred_at", `${args.periodEnd}T23:59:59.999Z`);
      }

      const { data: events, error: eventsErr } = await query;
      if (eventsErr) throw eventsErr;

      if (!events || events.length === 0) {
        toast({ title: "No unbilled charges", description: "There are no unbilled charges for the selected period." });
        return null;
      }

      const subtotal = events.reduce((sum, e) => sum + Number(e.total_amount || 0), 0);

      // 3) create invoice draft (note: invoice_type not in schema, use notes for metadata)
      const { data: invoice, error: invErr } = await (supabase
        .from("invoices") as any)
        .insert({
          tenant_id: profile.tenant_id,
          account_id: args.accountId,
          sidemark_id: args.sidemark || null,
          invoice_number,
          period_start: args.periodStart,
          period_end: args.periodEnd,
          status: "draft",
          subtotal,
          tax_amount: 0,
          total_amount: subtotal,
          created_by: profile.id,
          notes: `Type: ${args.invoiceType}`,
        })
        .select("*")
        .single();

      if (invErr) throw invErr;

      // 4) create invoice lines from events
      const lines = events.map((e) => {
        const qty = e.quantity ?? 1;
        const rate = e.unit_rate ?? e.total_amount ?? 0;
        return {
          tenant_id: profile.tenant_id,
          invoice_id: invoice.id,
          billing_event_id: e.id,
          item_id: e.item_id || null,
          description: e.description || e.charge_type || e.event_type,
          quantity: qty,
          unit_rate: rate,
          total_amount: Math.round(qty * rate * 100) / 100,
        };
      });

      const { error: linesErr } = await supabase.from("invoice_lines").insert(lines);
      if (linesErr) throw linesErr;

      // 5) mark billing_events invoiced
      const { error: updErr } = await supabase
        .from("billing_events")
        .update({ status: "invoiced", invoice_id: invoice.id, invoiced_at: new Date().toISOString() })
        .in("id", events.map((e) => e.id));

      if (updErr) throw updErr;

      // 6) Log activity for each billing event becoming invoiced
      for (const e of events) {
        logBillingActivity({
          tenantId: profile.tenant_id,
          actorUserId: profile.id,
          eventType: 'billing_event_invoiced',
          eventLabel: `Charge invoiced: ${e.description || e.charge_type || e.event_type}`,
          details: {
            billing_event_id: e.id,
            invoice_id: invoice.id,
            invoice_number,
            total_amount: e.total_amount,
            service_code: e.charge_type,
          },
          itemId: e.item_id,
          shipmentId: e.shipment_id,
          taskId: e.task_id,
          accountId: e.account_id,
        });
      }

      toast({ title: "Invoice draft created", description: `${invoice_number} created with ${lines.length} line(s).` });
      return invoice as unknown as Invoice;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("createInvoiceDraft error", err);
      toast({ title: "Invoice creation failed", description: message, variant: "destructive" });
      return null;
    }
  }, [profile, toast]);

  const markInvoiceSent = useCallback(async (invoiceId: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from("invoices")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", invoiceId);
      if (error) throw error;

      toast({ title: "Invoice marked sent", description: "Invoice status updated to Sent." });
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("markInvoiceSent error", err);
      toast({ title: "Failed to mark sent", description: message, variant: "destructive" });
      return false;
    }
  }, [toast]);

  const voidInvoice = useCallback(async (invoiceId: string): Promise<boolean> => {
    // Show confirmation dialog
    const confirmed = window.confirm(
      "Are you sure you want to void this invoice?\n\n" +
      "The billing events will be returned to unbilled status and can be re-invoiced."
    );

    if (!confirmed) {
      return false;
    }

    try {
      if (!profile?.tenant_id) {
        throw new Error("No tenant context");
      }

      // 1) Get invoice details for the success message
      const { data: invoice, error: fetchErr } = await supabase
        .from("invoices")
        .select("invoice_number, account_id")
        .eq("id", invoiceId)
        .single();

      if (fetchErr) {
        console.error("Error fetching invoice:", fetchErr);
        throw new Error("Failed to fetch invoice details");
      }

      // 1b) Fetch billing events before updating (for activity logging)
      const { data: linkedEvents } = await supabase
        .from("billing_events")
        .select("id, item_id, shipment_id, task_id, account_id, charge_type, description, event_type, total_amount")
        .eq("invoice_id", invoiceId);

      // 2) Update invoice status to 'void'
      const { error: invoiceErr } = await supabase
        .from("invoices")
        .update({
          status: "void",
          voided_at: new Date().toISOString(),
        })
        .eq("id", invoiceId);

      if (invoiceErr) {
        console.error("Error voiding invoice:", invoiceErr);
        throw new Error("Failed to void invoice");
      }

      // 3) Return billing events to 'unbilled' status
      // CRITICAL: This sets status to 'unbilled', NOT 'void'
      // CRITICAL: This clears the invoice_id and invoiced_at fields
      // CRITICAL: This does NOT create any reversal entries
      const { error: eventsErr } = await supabase
        .from("billing_events")
        .update({
          status: "unbilled",
          invoice_id: null,
          invoiced_at: null,
        })
        .eq("invoice_id", invoiceId);

      if (eventsErr) {
        console.error("Error updating billing events:", eventsErr);
        throw new Error("Failed to update billing events");
      }

      // 4) Log activity for each billing event becoming uninvoiced
      if (linkedEvents) {
        for (const e of linkedEvents) {
          logBillingActivity({
            tenantId: profile.tenant_id,
            actorUserId: profile.id,
            eventType: 'billing_event_uninvoiced',
            eventLabel: `Charge uninvoiced: ${e.description || e.charge_type || e.event_type}`,
            details: {
              billing_event_id: e.id,
              invoice_id: invoiceId,
              invoice_number: invoice.invoice_number,
              reason: 'invoice_voided',
              total_amount: e.total_amount,
            },
            itemId: e.item_id,
            shipmentId: e.shipment_id,
            taskId: e.task_id,
            accountId: e.account_id,
          });
        }
      }

      toast({
        title: "Invoice Voided",
        description: `Invoice ${invoice.invoice_number} has been voided. Billing events returned to unbilled status.`,
      });
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("voidInvoice error:", err);
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
      return false;
    }
  }, [profile, toast]);

  const fetchInvoices = useCallback(async (filters?: {
    accountId?: string;
    status?: InvoiceStatus;
    limit?: number;
  }): Promise<Invoice[]> => {
    try {
      let query = supabase
        .from("invoices")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(filters?.limit || 50);

      if (filters?.accountId) {
        query = query.eq("account_id", filters.accountId);
      }
      if (filters?.status) {
        query = query.eq("status", filters.status);
      }

      const { data, error } = await query;
      if (error) throw error;

      return (data || []) as unknown as Invoice[];
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("fetchInvoices error", err);
      toast({ title: "Failed to load invoices", description: message, variant: "destructive" });
      return [];
    }
  }, [toast]);

  const fetchInvoiceLines = useCallback(async (invoiceId: string): Promise<InvoiceLine[]> => {
    try {
      const { data, error } = await supabase
        .from("invoice_lines")
        .select("*")
        .eq("invoice_id", invoiceId)
        .order("created_at", { ascending: true });

      if (error) throw error;
      return (data || []) as unknown as InvoiceLine[];
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("fetchInvoiceLines error", err);
      toast({ title: "Failed to load invoice lines", description: message, variant: "destructive" });
      return [];
    }
  }, [toast]);

  const generateStorageForDate = useCallback(async (date: string): Promise<boolean> => {
    try {
      const { error } = await supabase.rpc("generate_storage_for_date", { p_date: date });
      if (error) throw error;
      
      toast({ title: "Storage charges generated", description: `Storage charges for ${date} have been created.` });
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("generateStorageForDate error", err);
      toast({ title: "Failed to generate storage charges", description: message, variant: "destructive" });
      return false;
    }
  }, [toast]);

  const updateInvoiceNotes = useCallback(async (invoiceId: string, notes: string): Promise<boolean> => {
    try {
      const { error } = await supabase
        .from("invoices")
        .update({ notes })
        .eq("id", invoiceId);
      if (error) throw error;

      toast({ title: "Notes saved", description: "Invoice notes have been updated." });
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("updateInvoiceNotes error", err);
      toast({ title: "Failed to save notes", description: message, variant: "destructive" });
      return false;
    }
  }, [toast]);

  const markInvoicePaid = useCallback(async (
    invoiceId: string,
    paidAmount: number,
    paymentDate?: string,
    paymentMethod?: string,
    paymentReference?: string
  ): Promise<boolean> => {
    try {
      const updatePayload: Record<string, unknown> = {
        status: 'paid',
        paid_amount: paidAmount,
        paid_at: paymentDate || new Date().toISOString(),
      };

      if (paymentMethod) {
        updatePayload.payment_method = paymentMethod;
      }
      if (paymentReference) {
        updatePayload.payment_reference = paymentReference;
      }

      const { error } = await supabase
        .from("invoices")
        .update(updatePayload)
        .eq("id", invoiceId);

      if (error) throw error;

      toast({ title: "Invoice marked paid", description: `Payment of $${paidAmount.toFixed(2)} recorded.` });
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("markInvoicePaid error", err);
      toast({ title: "Failed to mark paid", description: message, variant: "destructive" });
      return false;
    }
  }, [toast]);

  // Create batch invoices - one per account from a list of billing event IDs
  const createBatchInvoices = useCallback(async (
    eventIds: string[],
    periodStart: string,
    periodEnd: string
  ): Promise<{ success: number; failed: number; invoices: Invoice[] }> => {
    const result = { success: 0, failed: 0, invoices: [] as Invoice[] };

    try {
      if (!profile?.tenant_id) {
        throw new Error("No tenant context");
      }

      if (eventIds.length === 0) {
        toast({ title: "No events selected", description: "Please select billing events to invoice." });
        return result;
      }

      // Fetch all selected billing events
      const { data: events, error: eventsErr } = await supabase
        .from("billing_events")
        .select("*, accounts:account_id(account_name)")
        .in("id", eventIds)
        .eq("status", "unbilled");

      if (eventsErr) throw eventsErr;

      if (!events || events.length === 0) {
        toast({ title: "No unbilled events", description: "All selected events are already invoiced or void." });
        return result;
      }

      // Group events by account_id
      const eventsByAccount = events.reduce((acc, event) => {
        const accountId = event.account_id;
        if (!accountId) return acc;
        if (!acc[accountId]) {
          acc[accountId] = {
            accountName: (event.accounts as any)?.account_name || 'Unknown',
            events: []
          };
        }
        acc[accountId].events.push(event);
        return acc;
      }, {} as Record<string, { accountName: string; events: any[] }>);

      // Create invoice for each account
      for (const [accountId, { accountName, events: accountEvents }] of Object.entries(eventsByAccount)) {
        try {
          // Get invoice number
          const { data: invNum, error: invNumErr } = await supabase.rpc("next_invoice_number");
          if (invNumErr) throw invNumErr;
          const invoice_number = invNum as string;

          const subtotal = accountEvents.reduce((sum, e) => sum + Number(e.total_amount || 0), 0);

          // Create invoice
          const { data: invoice, error: invErr } = await (supabase
            .from("invoices") as any)
            .insert({
              tenant_id: profile.tenant_id,
              account_id: accountId,
              invoice_number,
              period_start: periodStart,
              period_end: periodEnd,
              status: "draft",
              subtotal,
              tax_amount: 0,
              total_amount: subtotal,
              created_by: profile.id,
              notes: `Batch invoice for ${accountName}`,
            })
            .select("*")
            .single();

          if (invErr) throw invErr;

          // Create invoice lines
          const lines = accountEvents.map((e) => {
            const qty = e.quantity ?? 1;
            const rate = e.unit_rate ?? e.total_amount ?? 0;
            return {
              tenant_id: profile.tenant_id,
              invoice_id: invoice.id,
              billing_event_id: e.id,
              item_id: e.item_id || null,
              description: e.description || e.charge_type || e.event_type,
              quantity: qty,
              unit_rate: rate,
              total_amount: Math.round(qty * rate * 100) / 100,
            };
          });

          const { error: linesErr } = await supabase.from("invoice_lines").insert(lines);
          if (linesErr) throw linesErr;

          // Mark billing events as invoiced
          const { error: updErr } = await supabase
            .from("billing_events")
            .update({ status: "invoiced", invoice_id: invoice.id, invoiced_at: new Date().toISOString() })
            .in("id", accountEvents.map((e) => e.id));

          if (updErr) throw updErr;

          // Log activity for each billing event becoming invoiced
          for (const e of accountEvents) {
            logBillingActivity({
              tenantId: profile.tenant_id,
              actorUserId: profile.id,
              eventType: 'billing_event_invoiced',
              eventLabel: `Charge invoiced: ${e.description || e.charge_type || e.event_type}`,
              details: {
                billing_event_id: e.id,
                invoice_id: invoice.id,
                invoice_number,
                total_amount: e.total_amount,
                service_code: e.charge_type,
              },
              itemId: e.item_id,
              shipmentId: e.shipment_id,
              taskId: e.task_id,
              accountId: e.account_id,
            });
          }

          result.invoices.push(invoice as unknown as Invoice);
          result.success++;
        } catch (err) {
          console.error(`Failed to create invoice for account ${accountId}:`, err);
          result.failed++;
        }
      }

      if (result.success > 0) {
        toast({
          title: "Batch invoices created",
          description: `Created ${result.success} invoice(s)${result.failed > 0 ? `, ${result.failed} failed` : ''}`,
        });
      } else {
        toast({
          variant: "destructive",
          title: "Invoice creation failed",
          description: "Could not create any invoices.",
        });
      }

      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("createBatchInvoices error", err);
      toast({ title: "Batch invoice creation failed", description: message, variant: "destructive" });
      return result;
    }
  }, [profile, toast]);

  // Enhanced invoice creation from selected billing events with flexible grouping
  const createInvoicesFromEvents = useCallback(async (
    args: CreateInvoicesFromEventsArgs
  ): Promise<{ success: number; failed: number; invoices: Invoice[] }> => {
    const result = { success: 0, failed: 0, invoices: [] as Invoice[] };

    try {
      if (!profile?.tenant_id) {
        throw new Error("No tenant context");
      }

      if (args.billingEventIds.length === 0) {
        toast({ title: "No events selected", description: "Please select billing events to invoice." });
        return result;
      }

      // Fetch all selected billing events with related data
      const { data: events, error: eventsErr } = await supabase
        .from("billing_events")
        .select(`
          *,
          accounts:account_id(id, account_code, account_name, parent_account_id)
        `)
        .in("id", args.billingEventIds)
        .eq("status", "unbilled");

      if (eventsErr) throw eventsErr;

      if (!events || events.length === 0) {
        toast({ title: "No unbilled events", description: "All selected events are already invoiced or void." });
        return result;
      }

      // Get sidemark info separately
      const sidemarkIds = [...new Set(events.map(e => e.sidemark_id).filter(Boolean))];
      let sidemarkMap: Record<string, string> = {};
      if (sidemarkIds.length > 0) {
        const { data: sidemarks } = await supabase
          .from("sidemarks")
          .select("id, sidemark_name")
          .in("id", sidemarkIds);
        if (sidemarks) {
          sidemarkMap = Object.fromEntries(sidemarks.map(s => [s.id, s.sidemark_name]));
        }
      }

      // Determine date range from events
      const dates = events.map(e => e.occurred_at?.slice(0, 10)).filter(Boolean).sort();
      const periodStart = dates[0] || new Date().toISOString().slice(0, 10);
      const periodEnd = dates[dates.length - 1] || periodStart;

      // Group events based on grouping strategy
      type GroupKey = string;
      type EventGroup = {
        accountId: string;
        accountCode: string;
        accountName: string;
        sidemarkId: string | null;
        sidemarkName: string | null;
        events: any[];
      };
      const groups: Record<GroupKey, EventGroup> = {};

      for (const event of events) {
        const account = event.accounts as any;
        let groupKey: string;
        let targetAccountId = event.account_id;

        // Handle grouping based on strategy
        if (args.grouping === 'single') {
          // All events in one invoice - use first account as the invoice account
          groupKey = 'single';
        } else if (args.grouping === 'include_subaccounts' && account?.parent_account_id) {
          // Use parent account instead
          targetAccountId = account.parent_account_id;
          groupKey = targetAccountId;
        } else if (args.grouping === 'by_account_sidemark') {
          groupKey = `${event.account_id}-${event.sidemark_id || 'none'}`;
        } else if (args.grouping === 'by_sidemark') {
          groupKey = event.sidemark_id || `account-${event.account_id}`;
        } else {
          // by_account
          groupKey = event.account_id;
        }

        if (!groups[groupKey]) {
          groups[groupKey] = {
            accountId: targetAccountId,
            accountCode: account?.account_code || 'UNKNOWN',
            accountName: account?.account_name || 'Unknown Account',
            sidemarkId: args.grouping === 'by_sidemark' || args.grouping === 'by_account_sidemark'
              ? event.sidemark_id : null,
            sidemarkName: event.sidemark_id ? (sidemarkMap[event.sidemark_id] || null) : null,
            events: [],
          };
        }
        groups[groupKey].events.push(event);
      }

      // Fetch parent account info if needed for sub-account grouping
      if (args.grouping === 'include_subaccounts') {
        const parentIds = [...new Set(Object.values(groups).map(g => g.accountId))];
        const { data: parentAccounts } = await supabase
          .from("accounts")
          .select("id, account_code, account_name")
          .in("id", parentIds);
        if (parentAccounts) {
          const parentMap = Object.fromEntries(parentAccounts.map(a => [a.id, a]));
          for (const group of Object.values(groups)) {
            const parent = parentMap[group.accountId];
            if (parent) {
              group.accountCode = parent.account_code;
              group.accountName = parent.account_name;
            }
          }
        }
      }

      // Create invoice for each group
      for (const group of Object.values(groups)) {
        try {
          // Get next invoice number with account code format: INV-{account_code}-XXXXX
          const { data: invNum, error: invNumErr } = await supabase.rpc("next_invoice_number");
          if (invNumErr) throw invNumErr;

          // Format: INV-{account_code}-00001
          const baseNumber = invNum as string;
          const numericPart = baseNumber.replace(/\D/g, '') || '00001';
          const invoice_number = `INV-${group.accountCode}-${numericPart.padStart(5, '0')}`;

          const subtotal = group.events.reduce((sum, e) => sum + Number(e.total_amount || 0), 0);

          // Build notes
          let notes = `Type: ${args.invoiceType}`;
          if (group.sidemarkName) {
            notes += ` | Sidemark: ${group.sidemarkName}`;
          }

          // Create invoice
          const { data: invoice, error: invErr } = await (supabase
            .from("invoices") as any)
            .insert({
              tenant_id: profile.tenant_id,
              account_id: group.accountId,
              sidemark_id: group.sidemarkId,
              invoice_number,
              period_start: periodStart,
              period_end: periodEnd,
              status: "draft",
              subtotal,
              tax_amount: 0,
              total_amount: subtotal,
              created_by: profile.id,
              notes,
            })
            .select("*")
            .single();

          if (invErr) throw invErr;

          // Create invoice lines
          const lines = group.events.map((e) => {
            const qty = e.quantity ?? 1;
            const rate = e.unit_rate ?? e.total_amount ?? 0;
            return {
              tenant_id: profile.tenant_id,
              invoice_id: invoice.id,
              billing_event_id: e.id,
              item_id: e.item_id || null,
              description: e.description || e.charge_type || e.event_type,
              quantity: qty,
              unit_rate: rate,
              total_amount: Math.round(qty * rate * 100) / 100,
            };
          });

          const { error: linesErr } = await supabase.from("invoice_lines").insert(lines);
          if (linesErr) throw linesErr;

          // Mark billing events as invoiced
          const { error: updErr } = await supabase
            .from("billing_events")
            .update({ status: "invoiced", invoice_id: invoice.id, invoiced_at: new Date().toISOString() })
            .in("id", group.events.map((e) => e.id));

          if (updErr) throw updErr;

          // Log activity for each billing event becoming invoiced
          for (const e of group.events) {
            logBillingActivity({
              tenantId: profile.tenant_id,
              actorUserId: profile.id,
              eventType: 'billing_event_invoiced',
              eventLabel: `Charge invoiced: ${e.description || e.charge_type || e.event_type}`,
              details: {
                billing_event_id: e.id,
                invoice_id: invoice.id,
                invoice_number,
                total_amount: e.total_amount,
                service_code: e.charge_type,
              },
              itemId: e.item_id,
              shipmentId: e.shipment_id,
              taskId: e.task_id,
              accountId: e.account_id,
            });
          }

          result.invoices.push(invoice as unknown as Invoice);
          result.success++;
        } catch (err) {
          console.error(`Failed to create invoice for group:`, err);
          result.failed++;
        }
      }

      if (result.success > 0) {
        toast({
          title: "Invoices created",
          description: `Created ${result.success} invoice(s)${result.failed > 0 ? `, ${result.failed} failed` : ''} with ${events.length} line items`,
        });
      } else {
        toast({
          variant: "destructive",
          title: "Invoice creation failed",
          description: "Could not create any invoices.",
        });
      }

      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("createInvoicesFromEvents error", err);
      toast({ title: "Invoice creation failed", description: message, variant: "destructive" });
      return result;
    }
  }, [profile, toast]);

  // Remove a single invoice line and return its billing event to unbilled
  const removeInvoiceLine = useCallback(async (
    lineId: string,
    invoiceId: string
  ): Promise<boolean> => {
    try {
      if (!profile?.tenant_id) {
        throw new Error("No tenant context");
      }

      // 1) Fetch the invoice line to get billing_event_id
      const { data: line, error: lineErr } = await supabase
        .from("invoice_lines")
        .select("id, billing_event_id, item_id, description, total_amount")
        .eq("id", lineId)
        .single();

      if (lineErr || !line) {
        throw new Error("Invoice line not found");
      }

      // 2) Delete the invoice line
      const { error: deleteErr } = await supabase
        .from("invoice_lines")
        .delete()
        .eq("id", lineId);

      if (deleteErr) throw deleteErr;

      // 3) If linked to a billing event, return it to unbilled
      if (line.billing_event_id) {
        // Fetch billing event entity IDs before updating
        const { data: billingEvent } = await supabase
          .from("billing_events")
          .select("item_id, shipment_id, task_id, account_id, charge_type")
          .eq("id", line.billing_event_id)
          .single();

        const { error: eventErr } = await supabase
          .from("billing_events")
          .update({
            status: "unbilled",
            invoice_id: null,
            invoiced_at: null,
          })
          .eq("id", line.billing_event_id);

        if (eventErr) throw eventErr;

        // Log activity to all linked entity tables
        if (profile.id && billingEvent) {
          logBillingActivity({
            tenantId: profile.tenant_id,
            actorUserId: profile.id,
            eventType: 'billing_event_uninvoiced',
            eventLabel: `Charge removed from invoice: ${line.description || 'Unknown'}`,
            details: {
              billing_event_id: line.billing_event_id,
              invoice_id: invoiceId,
              reason: 'removed_from_invoice',
            },
            itemId: billingEvent.item_id,
            shipmentId: billingEvent.shipment_id,
            taskId: billingEvent.task_id,
            accountId: billingEvent.account_id,
          });
        }
      }

      // 4) Recalculate invoice totals
      const { data: remainingLines, error: remainErr } = await supabase
        .from("invoice_lines")
        .select("total_amount")
        .eq("invoice_id", invoiceId);

      if (remainErr) throw remainErr;

      const newSubtotal = (remainingLines || []).reduce(
        (sum, l) => sum + Number(l.total_amount || 0), 0
      );

      const { error: updateErr } = await (supabase
        .from("invoices") as any)
        .update({
          subtotal: newSubtotal,
          total_amount: newSubtotal,
        })
        .eq("id", invoiceId);

      if (updateErr) throw updateErr;

      // 5) If no lines remain, delete the invoice
      if (!remainingLines || remainingLines.length === 0) {
        await supabase.from("invoices").delete().eq("id", invoiceId);
        toast({ title: "Invoice deleted", description: "Invoice had no remaining lines and was removed." });
      } else {
        toast({ title: "Line removed", description: "Billing event returned to unbilled status." });
      }

      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Failed to remove line", description: message, variant: "destructive" });
      return false;
    }
  }, [profile, toast]);

  // Delete an entire invoice and return all billing events to unbilled
  const deleteInvoice = useCallback(async (invoiceId: string): Promise<boolean> => {
    try {
      if (!profile?.tenant_id) {
        throw new Error("No tenant context");
      }

      // 1) Get invoice lines to find billing events
      const { data: lines, error: linesErr } = await supabase
        .from("invoice_lines")
        .select("billing_event_id, item_id, description")
        .eq("invoice_id", invoiceId);

      if (linesErr) throw linesErr;

      // 2) Return all linked billing events to unbilled
      const billingEventIds = (lines || [])
        .map(l => l.billing_event_id)
        .filter(Boolean) as string[];

      if (billingEventIds.length > 0) {
        // Fetch billing event entity IDs before updating
        const { data: billingEvents } = await supabase
          .from("billing_events")
          .select("id, item_id, shipment_id, task_id, account_id, charge_type, description, event_type, total_amount")
          .in("id", billingEventIds);

        const { error: eventErr } = await supabase
          .from("billing_events")
          .update({
            status: "unbilled",
            invoice_id: null,
            invoiced_at: null,
          })
          .in("id", billingEventIds);

        if (eventErr) throw eventErr;

        // Log activity to all linked entity tables
        if (profile.id && billingEvents) {
          for (const e of billingEvents) {
            logBillingActivity({
              tenantId: profile.tenant_id,
              actorUserId: profile.id,
              eventType: 'billing_event_uninvoiced',
              eventLabel: `Charge returned to unbilled: ${e.description || e.charge_type || e.event_type} (invoice deleted)`,
              details: {
                billing_event_id: e.id,
                invoice_id: invoiceId,
                reason: 'invoice_deleted',
                total_amount: e.total_amount,
              },
              itemId: e.item_id,
              shipmentId: e.shipment_id,
              taskId: e.task_id,
              accountId: e.account_id,
            });
          }
        }
      }

      // 3) Delete invoice lines
      await supabase.from("invoice_lines").delete().eq("invoice_id", invoiceId);

      // 4) Delete the invoice
      const { error: invErr } = await supabase.from("invoices").delete().eq("id", invoiceId);
      if (invErr) throw invErr;

      toast({
        title: "Invoice deleted",
        description: `Invoice deleted. ${billingEventIds.length} billing event(s) returned to unbilled.`,
      });
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Failed to delete invoice", description: message, variant: "destructive" });
      return false;
    }
  }, [profile, toast]);

  return {
    createInvoiceDraft,
    markInvoiceSent,
    markInvoicePaid,
    voidInvoice,
    fetchInvoices,
    fetchInvoiceLines,
    generateStorageForDate,
    updateInvoiceNotes,
    createBatchInvoices,
    createInvoicesFromEvents,
    removeInvoiceLine,
    deleteInvoice,
  };
}
