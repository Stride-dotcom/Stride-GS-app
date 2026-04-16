import { useEffect, useMemo, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/ui/StatusIndicator";
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { PushToQuickBooksButton } from "@/components/billing/PushToQuickBooksButton";
import { BillingEventForSync } from "@/hooks/useQuickBooks";
import { useAuth } from "@/contexts/AuthContext";
import { logBillingActivity } from "@/lib/activity/logActivity";
import { MultiSelect } from "@/components/ui/multi-select";
import { useInvoices, InvoiceGrouping, InvoiceType } from "@/hooks/useInvoices";
import ExcelJS from 'exceljs';
import { addJsonSheet, setColumnWidths, downloadWorkbook } from '@/lib/excelUtils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { voidBillingEventsBatch, updateBillingEventFields, createEventRaw } from '@/services/billing';

interface BillingEventRow {
  id: string;
  occurred_at: string;
  account_id: string;
  item_id: string | null;
  shipment_id: string | null;
  task_id: string | null;
  sidemark_id: string | null;
  event_type: string;
  charge_type: string;
  description: string | null;
  quantity: number;
  unit_rate: number;
  total_amount: number;
  status: string;
  invoice_id: string | null;
  account_name?: string;
  item_code?: string;
  sidemark_name?: string;
}

interface Account {
  id: string;
  account_name: string;
  account_code: string;
  billing_contact_email?: string | null;
}

interface Sidemark {
  id: string;
  sidemark_name: string;
  account_id: string;
}

interface ServiceEvent {
  id: string;
  service_code: string;
  service_name: string;
}

// Track edits per row
interface RowEdit {
  description: string;
  quantity: string;
  unit_rate: string;
  sidemark_id: string;
}

type SortField = 'occurred_at' | 'account_name' | 'sidemark_name' | 'item_code' | 'event_type' | 'charge_type' | 'description' | 'quantity' | 'unit_rate' | 'total_amount' | 'status';
type SortDirection = 'asc' | 'desc';
type FilterMode = 'date_range' | 'all_unbilled';
type LineSortOption = 'date' | 'service' | 'item' | 'amount';

/** Stable string from current filters – used as localStorage key for inactive-service suppression. */
function computeFilterHash(
  tenantId: string,
  mode: FilterMode,
  accounts: string[],
  services: string[],
  startDate: string,
  endDate: string,
): string {
  const parts = [
    tenantId,
    mode,
    [...accounts].sort().join(','),
    [...services].sort().join(','),
    mode === 'date_range' ? `${startDate}:${endDate}` : '',
  ];
  return parts.join('|');
}

// ============================================
// BILLING SAFETY HELPER FUNCTIONS (Phase 5A.1)
// ============================================
// These functions check if a billing line item is safe for invoicing
// without modifying any billing calculations.
//
// BLOCKING ISSUES (prevent invoice creation):
// - Rate is NULL/undefined/NaN (missing rate)
// - Missing class rate mapping (future enhancement)
//
// NON-BLOCKING WARNINGS (allowed but flagged):
// - Rate is $0.00 (intentional zero-rate is valid)

/**
 * Check if a billing line has a valid rate for invoicing
 * Returns true if the rate is set (not NULL/undefined/NaN)
 * NOTE: A rate of exactly 0 is ALLOWED - $0 billing is intentional in some cases
 */
function isLineSafe(row: BillingEventRow): boolean {
  const rate = row.unit_rate;
  // Only NULL, undefined, or NaN are considered unsafe (truly missing)
  // Rate === 0 is ALLOWED - it's a valid intentional rate
  if (rate === null || rate === undefined || (typeof rate === 'number' && isNaN(rate))) {
    return false;
  }
  return true;
}

/**
 * Get the BLOCKING issue with a billing line (prevents invoicing)
 * Returns null if the line is safe for invoicing
 */
function getLineIssue(row: BillingEventRow): string | null {
  const rate = row.unit_rate;

  // Only truly missing rates are blocking issues
  if (rate === null || rate === undefined) {
    return "Rate not set";
  }

  if (typeof rate === 'number' && isNaN(rate)) {
    return "Invalid rate";
  }

  // NOTE: Rate === 0 is NOT a blocking issue - $0 billing is intentional
  // Future: Add class rate mapping check here if billing_events gains class_code field

  return null;
}

/**
 * Get a NON-BLOCKING warning for a billing line (does not prevent invoicing)
 * Returns null if there are no warnings
 */
function getLineWarning(row: BillingEventRow): string | null {
  const rate = row.unit_rate;

  // $0 rate is a warning (might be unintentional) but not a blocking issue
  if (rate === 0) {
    return "Rate is $0.00";
  }

  return null;
}

function formatDateMMDDYY(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

function toCSV(rows: BillingEventRow[]) {
  if (!rows.length) return "";
  const headers = ["occurred_at", "account_name", "item_code", "event_type", "charge_type", "description", "quantity", "unit_rate", "total_amount", "status", "invoice_id"];
  const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [headers.map(escape).join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => {
      if (h === 'occurred_at') {
        return escape(formatDateMMDDYY(r.occurred_at));
      }
      return escape(r[h as keyof BillingEventRow]);
    }).join(","));
  }
  return lines.join("\n");
}

export function BillingReportTab() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { createInvoicesFromEvents } = useInvoices();

  const [start, setStart] = useState<string>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  });
  const [end, setEnd] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(['unbilled']);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [rows, setRows] = useState<BillingEventRow[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [services, setServices] = useState<ServiceEvent[]>([]);
  const [sidemarks, setSidemarks] = useState<Sidemark[]>([]);
  const [loading, setLoading] = useState(false);

  // Sorting state
  const [sortField, setSortField] = useState<SortField>('occurred_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Inline editing state - track edits per row
  const [rowEdits, setRowEdits] = useState<Record<string, RowEdit>>({});
  const [editingCell, setEditingCell] = useState<{ rowId: string; field: 'description' | 'quantity' | 'unit_rate' | 'sidemark_id' } | null>(null);
  const [savingRows, setSavingRows] = useState(false);

  // Selection state for bulk actions
  const [selectedRows, setSelectedRows] = useState<Set<string>>(new Set());

  // Unsaved changes dialog
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);

  // Inactive service type handling
  const [inactiveServiceDialogOpen, setInactiveServiceDialogOpen] = useState(false);
  const [inactiveServiceEvents, setInactiveServiceEvents] = useState<{
    serviceName: string;
    count: number;
    total: number;
    eventIds: string[];
  }[]>([]);
  const [pendingBillingEvents, setPendingBillingEvents] = useState<BillingEventRow[]>([]);

  // Add custom charge dialog
  const [addChargeOpen, setAddChargeOpen] = useState(false);
  const [addChargeLoading, setAddChargeLoading] = useState(false);
  const [newCharge, setNewCharge] = useState({
    account_id: '',
    sidemark_id: '',
    charge_type: '',
    description: '',
    quantity: '1',
    unit_rate: '',
    occurred_at: new Date().toISOString().slice(0, 10),
  });

  // Filter mode: date_range or all_unbilled
  const [filterMode, setFilterMode] = useState<FilterMode>('date_range');

  // Inline Create Invoices panel state
  const [showCreatePanel, setShowCreatePanel] = useState(false);
  const [invoiceGrouping, setInvoiceGrouping] = useState<InvoiceGrouping>('by_account');
  const [invoiceLineSorting, setInvoiceLineSorting] = useState<LineSortOption>('date');
  const [invoiceType, setInvoiceType] = useState<InvoiceType>('weekly_services');
  const [invoicePeriodStart, setInvoicePeriodStart] = useState<string>('');
  const [invoicePeriodEnd, setInvoicePeriodEnd] = useState<string>('');
  const [creatingInvoices, setCreatingInvoices] = useState(false);
  const [combinedConfirmOpen, setCombinedConfirmOpen] = useState(false);

  // Bulk void state
  const [bulkVoidConfirmOpen, setBulkVoidConfirmOpen] = useState(false);
  const [bulkVoiding, setBulkVoiding] = useState(false);

  // Billing Safety UX (Phase 5A)
  const [showOnlyIssues, setShowOnlyIssues] = useState(false);
  const [unsafeInvoiceDialogOpen, setUnsafeInvoiceDialogOpen] = useState(false);
  const [pendingUnsafeEventIds, setPendingUnsafeEventIds] = useState<string[]>([]);

  // Check if there are unsaved changes
  const hasUnsavedChanges = useMemo(() => {
    return Object.keys(rowEdits).length > 0;
  }, [rowEdits]);

  // Warn before leaving page with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
        return '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    async function loadAccounts() {
      if (!profile?.tenant_id) return;
      const { data } = await supabase
        .from("accounts")
        .select("id, account_name, account_code, billing_contact_email")
        .eq("tenant_id", profile.tenant_id)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("account_name");
      setAccounts(data || []);
    }
    loadAccounts();
  }, [profile?.tenant_id]);

  useEffect(() => {
    async function loadServices() {
      if (!profile?.tenant_id) return;
      const { data } = await supabase
        .from("service_events")
        .select("id, service_code, service_name")
        .eq("tenant_id", profile.tenant_id)
        .eq("is_active", true)
        .is("class_code", null)
        .order("service_name");
      setServices((data as ServiceEvent[]) || []);
    }
    loadServices();
  }, [profile?.tenant_id]);

  useEffect(() => {
    async function loadSidemarks() {
      if (!profile?.tenant_id) return;
      const { data } = await supabase
        .from("sidemarks")
        .select("id, sidemark_name, account_id")
        .is("deleted_at", null)
        .order("sidemark_name");
      setSidemarks((data as Sidemark[]) || []);
    }
    loadSidemarks();
  }, [profile?.tenant_id]);

  // Get sidemarks for selected account
  const accountSidemarks = useMemo(() => {
    if (!newCharge.account_id) return [];
    return sidemarks.filter(s => s.account_id === newCharge.account_id);
  }, [sidemarks, newCharge.account_id]);

  // Get sidemarks for a specific row's account
  const getSidemarksForRow = useCallback((accountId: string) => {
    return sidemarks.filter(s => s.account_id === accountId);
  }, [sidemarks]);

  const fetchRows = useCallback(async () => {
    if (!profile?.tenant_id) return;

    setLoading(true);
    setSelectedRows(new Set());
    setShowCreatePanel(false);
    setRowEdits({}); // Clear any pending edits
    setEditingCell(null);
    try {
      let query = (supabase
        .from("billing_events") as any)
        .select(`
          id, occurred_at, account_id, item_id, shipment_id, task_id, sidemark_id, event_type, charge_type,
          description, quantity, unit_rate, total_amount, status, invoice_id
        `)
        .eq("tenant_id", profile.tenant_id)
        .order("occurred_at", { ascending: false })
        .limit(1000);

      // Apply date range filter only in date_range mode
      if (filterMode === 'date_range') {
        query = query
          .gte("occurred_at", `${start}T00:00:00.000Z`)
          .lte("occurred_at", `${end}T23:59:59.999Z`);
      } else {
        // All Unbilled mode: force status to unbilled
        query = query.eq("status", "unbilled");
      }

      if (selectedAccounts.length > 0) {
        query = query.in("account_id", selectedAccounts);
      }
      // Apply status filter in date_range mode (fallback to unbilled if none selected)
      if (filterMode === 'date_range') {
        const effectiveStatuses = selectedStatuses.length > 0 ? selectedStatuses : ['unbilled'];
        query = query.in("status", effectiveStatuses);
      }
      if (selectedServices.length > 0) {
        const hasAddon = selectedServices.includes('__addon__');
        const regularServices = selectedServices.filter(s => s !== '__addon__');
        if (hasAddon && regularServices.length > 0) {
          query = query.or(`charge_type.in.(${regularServices.join(',')}),event_type.eq.addon`);
        } else if (hasAddon) {
          query = query.eq("event_type", "addon");
        } else {
          query = query.in("charge_type", regularServices);
        }
      }

      const { data, error } = await query;
      if (error) throw error;

      // Fetch account names and sidemark names separately
      const accountIds = [...new Set((data || []).map((r: any) => r.account_id).filter(Boolean))] as string[];
      const sidemarkIds = [...new Set((data || []).map((r: any) => r.sidemark_id).filter(Boolean))] as string[];
      const itemIds = [...new Set((data || []).map((r: any) => r.item_id).filter(Boolean))] as string[];

      let accountMap: Record<string, string> = {};
      let sidemarkMap: Record<string, string> = {};
      let itemMap: Record<string, string> = {};

      if (accountIds.length > 0) {
        const { data: accts } = await supabase
          .from("accounts")
          .select("id, account_name")
          .in("id", accountIds);
        if (accts) {
          accountMap = Object.fromEntries(accts.map((a: any) => [a.id, a.account_name]));
        }
      }

      if (sidemarkIds.length > 0) {
        const { data: sms } = await supabase
          .from("sidemarks")
          .select("id, sidemark_name")
          .in("id", sidemarkIds);
        if (sms) {
          sidemarkMap = Object.fromEntries(sms.map((s: any) => [s.id, s.sidemark_name]));
        }
      }

      if (itemIds.length > 0) {
        const { data: items } = await supabase
          .from("items")
          .select("id, item_code")
          .in("id", itemIds);
        if (items) {
          itemMap = Object.fromEntries(items.map((i: any) => [i.id, i.item_code]));
        }
      }

      const transformed = (data || []).map((row: any) => ({
        ...row,
        account_name: row.account_id ? (accountMap[row.account_id] || "-") : "-",
        item_code: row.item_id ? (itemMap[row.item_id] || "-") : "-",
        sidemark_name: row.sidemark_id ? (sidemarkMap[row.sidemark_id] || "-") : "-",
      }));

      // Check for inactive service types
      const chargeTypes = [...new Set(transformed.map((r: BillingEventRow) => r.charge_type).filter(Boolean))] as string[];

      if (chargeTypes.length > 0) {
        // Fetch service status for all charge types
        const { data: serviceData } = await supabase
          .from('service_events')
          .select('service_code, service_name, is_active')
          .eq('tenant_id', profile.tenant_id)
          .in('service_code', chargeTypes);

        // Create map of service code -> { name, isActive }
        const serviceMap = new Map(
          serviceData?.map(s => [s.service_code, { name: s.service_name, isActive: s.is_active }]) || []
        );

        // Find events with inactive service types (skip already-voided events)
        const eventsWithInactive = transformed.filter((event: BillingEventRow) => {
          if (event.status === 'void') return false;
          const serviceInfo = serviceMap.get(event.charge_type);
          return serviceInfo && !serviceInfo.isActive;
        });

        if (eventsWithInactive.length > 0) {
          // Check if user previously chose "Include Anyway" for this filter combination
          const hash = computeFilterHash(profile.tenant_id, filterMode, selectedAccounts, selectedServices, start, end);
          const suppressionKey = `inactive_service_warning_ignored::${profile.tenant_id}::${hash}`;
          if (localStorage.getItem(suppressionKey)) {
            setRows(transformed);
            setLoading(false);
            return;
          }

          // Group by service type for display
          const groupedByService = new Map<string, { name: string; events: BillingEventRow[] }>();

          eventsWithInactive.forEach((event: BillingEventRow) => {
            const serviceInfo = serviceMap.get(event.charge_type);
            if (!groupedByService.has(event.charge_type)) {
              groupedByService.set(event.charge_type, {
                name: serviceInfo?.name || event.charge_type,
                events: [],
              });
            }
            groupedByService.get(event.charge_type)!.events.push(event);
          });

          const inactiveGroups = Array.from(groupedByService.values()).map(group => ({
            serviceName: group.name,
            count: group.events.length,
            total: group.events.reduce((sum, e) => sum + Number(e.total_amount || 0), 0),
            eventIds: group.events.map(e => e.id),
          }));

          // Store state and show dialog
          setInactiveServiceEvents(inactiveGroups);
          setPendingBillingEvents(transformed);
          setInactiveServiceDialogOpen(true);
          setLoading(false);
          return;
        }
      }

      setRows(transformed);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unknown error";
      console.error(e);
      toast({ title: "Failed to load report", description: message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, start, end, selectedAccounts, selectedStatuses, selectedServices, filterMode, toast]);

  // Inactive service type handlers
  const handleIncludeInactiveServices = () => {
    // Store suppression flag so modal won't re-appear for this filter combination
    if (profile?.tenant_id) {
      const hash = computeFilterHash(profile.tenant_id, filterMode, selectedAccounts, selectedServices, start, end);
      const suppressionKey = `inactive_service_warning_ignored::${profile.tenant_id}::${hash}`;
      localStorage.setItem(suppressionKey, 'true');
    }
    setRows(pendingBillingEvents);
    setInactiveServiceDialogOpen(false);
    setPendingBillingEvents([]);
    setInactiveServiceEvents([]);
  };

  const handleVoidInactiveServices = async () => {
    const eventIdsToVoid = inactiveServiceEvents.flatMap(g => g.eventIds);

    // Void the events
    const result = await voidBillingEventsBatch({ eventIds: eventIdsToVoid });

    if (!result.success) {
      toast({ title: 'Error voiding events', variant: 'destructive' });
      return;
    }

    // Log activity for voided billing events
    if (profile?.tenant_id) {
      const voidedRows = pendingBillingEvents.filter(e => eventIdsToVoid.includes(e.id));
      for (const row of voidedRows) {
        logBillingActivity({
          tenantId: profile.tenant_id,
          actorUserId: profile.id,
          eventType: 'billing_event_voided',
          eventLabel: `Billing charge voided: ${row.charge_type}`,
          details: {
            billing_event_id: row.id,
            service_code: row.charge_type,
            reason: 'inactive_service_type',
            amount: row.total_amount,
          },
          itemId: row.item_id,
          shipmentId: row.shipment_id,
          taskId: row.task_id,
          accountId: row.account_id,
        });
      }
    }

    toast({
      title: 'Events Voided',
      description: `Voided ${eventIdsToVoid.length} billing event(s) with inactive service types.`,
    });

    // Clean up dialog state before refresh
    setInactiveServiceDialogOpen(false);
    setPendingBillingEvents([]);
    setInactiveServiceEvents([]);

    // Re-fetch from database so voided events show correct status
    fetchRows();
  };

  const handleCancelInactiveDialog = () => {
    setInactiveServiceDialogOpen(false);
    setPendingBillingEvents([]);
    setInactiveServiceEvents([]);
  };

  // Bulk void selected rows
  const handleBulkVoid = async () => {
    const eventIds = Array.from(selectedRows);
    if (eventIds.length === 0) return;

    // Guard: prevent voiding invoiced events (race condition safety)
    const invoicedInSelection = eventIds.filter(id => {
      const row = rows.find(r => r.id === id);
      return row?.status === 'invoiced';
    });
    if (invoicedInSelection.length > 0) {
      toast({ title: 'Cannot void', description: `${invoicedInSelection.length} selected charge(s) are invoiced and cannot be voided.`, variant: 'destructive' });
      return;
    }

    setBulkVoiding(true);
    try {
      const result = await voidBillingEventsBatch({ eventIds });

      if (!result.success) {
        toast({ title: 'Error voiding events', description: result.error || 'Unknown error', variant: 'destructive' });
        return;
      }

      // Log activity for voided billing events
      if (profile?.tenant_id) {
        const voidedRows = rows.filter(r => eventIds.includes(r.id));
        for (const row of voidedRows) {
          logBillingActivity({
            tenantId: profile.tenant_id,
            actorUserId: profile.id,
            eventType: 'billing_event_voided',
            eventLabel: `Billing charge voided: ${row.charge_type}`,
            details: {
              billing_event_id: row.id,
              service_code: row.charge_type,
              reason: 'manual_bulk_void',
              amount: row.total_amount,
            },
            itemId: row.item_id,
            shipmentId: row.shipment_id,
            taskId: row.task_id,
            accountId: row.account_id,
          });
        }
      }

      toast({
        title: 'Events Voided',
        description: `Voided ${eventIds.length} billing event(s).`,
      });

      setSelectedRows(new Set());
      setBulkVoidConfirmOpen(false);
      fetchRows();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      toast({ title: 'Void failed', description: message, variant: 'destructive' });
    } finally {
      setBulkVoiding(false);
    }
  };

  // Sort rows
  const sortedRows = useMemo(() => {
    const sorted = [...rows].sort((a, b) => {
      let aVal: any = a[sortField];
      let bVal: any = b[sortField];

      // Handle null/undefined
      if (aVal == null) aVal = '';
      if (bVal == null) bVal = '';

      // Handle numeric fields
      if (sortField === 'quantity' || sortField === 'unit_rate' || sortField === 'total_amount') {
        aVal = Number(aVal) || 0;
        bVal = Number(bVal) || 0;
      }

      // Handle dates
      if (sortField === 'occurred_at') {
        aVal = new Date(aVal).getTime();
        bVal = new Date(bVal).getTime();
      }

      // Compare
      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = (bVal as string).toLowerCase();
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [rows, sortField, sortDirection]);

  // Universal search - filter across all fields
  const filteredRows = useMemo(() => {
    let result = sortedRows;

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      result = result.filter(row => {
        // Create array of all searchable field values
        const searchableValues = [
          row.item_code,                    // Item code
          row.description,                  // Description
          row.account_name,                 // Account name
          row.sidemark_name,                // Sidemark name
          row.charge_type,                  // Charge type / service code
          row.event_type,                   // Event type
          row.occurred_at,                  // Date
          formatDateMMDDYY(row.occurred_at), // Formatted date
          row.total_amount?.toString(),     // Amount as string
          row.unit_rate?.toString(),        // Rate as string
          row.quantity?.toString(),         // Quantity as string
          row.status,                       // Status
          row.invoice_id,                   // Invoice ID
        ];

        // Return true if any field contains the search query
        return searchableValues.some(value =>
          value?.toLowerCase?.()?.includes(query)
        );
      });
    }

    // Apply "Show only issues" filter (Phase 5A)
    if (showOnlyIssues) {
      result = result.filter(row => row.status === 'unbilled' && !isLineSafe(row));
    }

    return result;
  }, [sortedRows, searchQuery, showOnlyIssues]);

  // Billing Safety: Count of unbilled rows with issues (Phase 5A)
  const unbilledIssueRows = useMemo(() => {
    return rows.filter(r => r.status === 'unbilled' && !isLineSafe(r));
  }, [rows]);

  const unbilledIssueCount = unbilledIssueRows.length;
  const unbilledIssueTotal = useMemo(() => {
    return unbilledIssueRows.reduce((sum, r) => sum + Number(r.quantity || 0), 0);
  }, [unbilledIssueRows]);

  // Handle column header click for sorting
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Get sort icon for column header
  const getSortIcon = (field: SortField) => {
    if (sortField !== field) {
      return <MaterialIcon name="unfold_more" size="sm" className="ml-1 opacity-30" />;
    }
    return sortDirection === 'asc'
      ? <MaterialIcon name="arrow_upward" size="sm" className="ml-1" />
      : <MaterialIcon name="arrow_downward" size="sm" className="ml-1" />;
  };

  // Handle inline edit - start editing a cell
  const startCellEdit = (row: BillingEventRow, field: 'description' | 'quantity' | 'unit_rate' | 'sidemark_id') => {
    if (row.status !== 'unbilled') return;

    // Initialize edit state for this row if not exists
    if (!rowEdits[row.id]) {
      setRowEdits(prev => ({
        ...prev,
        [row.id]: {
          description: row.description || '',
          quantity: row.quantity.toString(),
          unit_rate: row.unit_rate.toString(),
          sidemark_id: row.sidemark_id || '',
        }
      }));
    }
    setEditingCell({ rowId: row.id, field });
  };

  // Handle inline edit value change
  const handleEditChange = (rowId: string, field: keyof RowEdit, value: string) => {
    setRowEdits(prev => ({
      ...prev,
      [rowId]: {
        ...prev[rowId],
        [field]: value
      }
    }));
  };

  // Handle blur - finish editing cell
  const handleCellBlur = () => {
    setEditingCell(null);
  };

  // Handle key press in edit field
  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setEditingCell(null);
    } else if (e.key === 'Escape') {
      // Revert changes for this row
      if (editingCell) {
        const row = rows.find(r => r.id === editingCell.rowId);
        if (row) {
          setRowEdits(prev => {
            const { [editingCell.rowId]: _, ...rest } = prev;
            return rest;
          });
        }
      }
      setEditingCell(null);
    }
  };

  // Get display value for a row (edited or original)
  const getRowValue = (row: BillingEventRow, field: 'description' | 'quantity' | 'unit_rate' | 'sidemark_id') => {
    if (rowEdits[row.id]) {
      return rowEdits[row.id][field];
    }
    if (field === 'description') return row.description || '';
    if (field === 'quantity') return row.quantity.toString();
    if (field === 'unit_rate') return row.unit_rate.toString();
    if (field === 'sidemark_id') return row.sidemark_id || '';
    return '';
  };

  // Calculate total for a row (uses edited values if available)
  const getRowTotal = (row: BillingEventRow) => {
    if (rowEdits[row.id]) {
      const qty = parseFloat(rowEdits[row.id].quantity) || 0;
      const rate = parseFloat(rowEdits[row.id].unit_rate) || 0;
      return qty * rate;
    }
    return row.total_amount ?? 0;
  };

  // Get sidemark name for display
  const getSidemarkName = (row: BillingEventRow) => {
    if (rowEdits[row.id] && rowEdits[row.id].sidemark_id) {
      const sidemark = sidemarks.find(s => s.id === rowEdits[row.id].sidemark_id);
      return sidemark?.sidemark_name || '-';
    }
    return row.sidemark_name || '-';
  };

  // Save all edited rows with activity logging
  const saveAllEdits = async () => {
    const editedRowIds = Object.keys(rowEdits);
    if (editedRowIds.length === 0) return;

    setSavingRows(true);
    try {
      for (const rowId of editedRowIds) {
        const edit = rowEdits[rowId];
        const originalRow = rows.find(r => r.id === rowId);
        const unitRate = parseFloat(edit.unit_rate);
        const quantity = parseFloat(edit.quantity);

        if (isNaN(unitRate) || unitRate < 0) {
          toast({ title: "Invalid rate", description: `Please enter a valid rate for row.`, variant: "destructive" });
          continue;
        }
        if (isNaN(quantity) || quantity <= 0) {
          toast({ title: "Invalid quantity", description: `Please enter a valid quantity for row.`, variant: "destructive" });
          continue;
        }

        // Capture before values for activity logging
        const beforeRow = rows.find(r => r.id === rowId);

        const totalAmount = unitRate * quantity;
        const updateResult = await updateBillingEventFields({
          eventId: rowId,
          patch: {
            unit_rate: unitRate,
            quantity: quantity,
            total_amount: totalAmount,
            description: edit.description || null,
            sidemark_id: edit.sidemark_id || null,
          },
        });

        if (!updateResult.success) throw new Error(updateResult.error);

        // Log activity for billing event update (only if values actually changed)
        if (originalRow && profile?.tenant_id) {
          const changes: Record<string, unknown> = {};
          if (originalRow.quantity !== quantity) {
            changes.quantity_before = originalRow.quantity;
            changes.quantity_after = quantity;
          }
          if (originalRow.unit_rate !== unitRate) {
            changes.rate_before = originalRow.unit_rate;
            changes.rate_after = unitRate;
          }
          if ((originalRow.description || null) !== (edit.description || null)) {
            changes.description_before = originalRow.description;
            changes.description_after = edit.description || null;
          }

          if (Object.keys(changes).length > 0) {
            logBillingActivity({
              tenantId: profile.tenant_id,
              actorUserId: profile.id,
              eventType: 'billing_event_updated',
              eventLabel: `Billing charge edited: ${originalRow.charge_type}`,
              details: {
                billing_event_id: rowId,
                service_code: originalRow.charge_type,
                ...changes,
              },
              itemId: originalRow.item_id,
              shipmentId: originalRow.shipment_id,
              taskId: originalRow.task_id,
              accountId: originalRow.account_id,
            });
          }
        }

        // Update local state
        setRows(prev => prev.map(r =>
          r.id === rowId
            ? {
                ...r,
                unit_rate: unitRate,
                quantity: quantity,
                total_amount: totalAmount,
                description: edit.description || null,
                sidemark_id: edit.sidemark_id || null,
                sidemark_name: edit.sidemark_id ? (sidemarks.find(s => s.id === edit.sidemark_id)?.sidemark_name || '-') : '-',
              }
            : r
        ));
      }

      // Clear all edits
      setRowEdits({});
      toast({ title: "Saved", description: `${editedRowIds.length} row(s) updated successfully.` });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unknown error";
      toast({ title: "Failed to save", description: message, variant: "destructive" });
    } finally {
      setSavingRows(false);
    }
  };

  // Discard all changes
  const discardChanges = () => {
    setRowEdits({});
    setEditingCell(null);
    toast({ title: "Changes discarded" });
  };

  // Add custom charge
  const handleAddCharge = async () => {
    if (!profile?.tenant_id || !profile?.id) return;

    if (!newCharge.account_id) {
      toast({ title: "Account required", description: "Please select an account.", variant: "destructive" });
      return;
    }
    if (!newCharge.charge_type.trim()) {
      toast({ title: "Charge type required", description: "Please enter a charge type.", variant: "destructive" });
      return;
    }

    const unitRate = parseFloat(newCharge.unit_rate);
    const quantity = parseFloat(newCharge.quantity);

    if (isNaN(unitRate) || unitRate <= 0) {
      toast({ title: "Invalid rate", description: "Please enter a valid positive rate.", variant: "destructive" });
      return;
    }
    if (isNaN(quantity) || quantity <= 0) {
      toast({ title: "Invalid quantity", description: "Please enter a valid positive quantity.", variant: "destructive" });
      return;
    }

    setAddChargeLoading(true);
    try {
      const insertResult = await createEventRaw({
          tenant_id: profile.tenant_id,
          account_id: newCharge.account_id,
          sidemark_id: newCharge.sidemark_id || null,
          event_type: 'addon',
          charge_type: newCharge.charge_type.trim(),
          description: newCharge.description.trim() || null,
          quantity: quantity,
          unit_rate: unitRate,
          total_amount: unitRate * quantity,
          status: 'unbilled',
          occurred_at: `${newCharge.occurred_at}T12:00:00.000Z`,
          created_by: profile.id,
          metadata: { source: 'billing_report_addon' },
        } as any);

      if (!insertResult.success) throw new Error(insertResult.error);

      toast({ title: "Charge added", description: `Custom charge of $${(unitRate * quantity).toFixed(2)} added successfully.` });
      setAddChargeOpen(false);
      setNewCharge({
        account_id: '',
        sidemark_id: '',
        charge_type: '',
        description: '',
        quantity: '1',
        unit_rate: '',
        occurred_at: new Date().toISOString().slice(0, 10),
      });
      fetchRows();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unknown error";
      toast({ title: "Failed to add charge", description: message, variant: "destructive" });
    } finally {
      setAddChargeLoading(false);
    }
  };

  // Toggle row selection
  const toggleRowSelection = (id: string) => {
    setSelectedRows(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  // Select/deselect all unbilled rows in the current filtered view
  const toggleSelectAll = () => {
    const unbilledFilteredRows = filteredRows.filter(r => r.status === 'unbilled');
    const allSelected = unbilledFilteredRows.length > 0 && unbilledFilteredRows.every(r => selectedRows.has(r.id));
    if (allSelected) {
      setSelectedRows(new Set());
    } else {
      setSelectedRows(new Set(unbilledFilteredRows.map(r => r.id)));
    }
  };

  // Check if all unbilled in filtered view are selected
  const allUnbilledSelected = useMemo(() => {
    const unbilledFilteredRows = filteredRows.filter(r => r.status === 'unbilled');
    return unbilledFilteredRows.length > 0 && unbilledFilteredRows.every(r => selectedRows.has(r.id));
  }, [filteredRows, selectedRows]);

  // Check if some unbilled in filtered view are selected
  const someUnbilledSelected = useMemo(() => {
    const unbilledFilteredRows = filteredRows.filter(r => r.status === 'unbilled');
    return unbilledFilteredRows.some(r => selectedRows.has(r.id)) && !allUnbilledSelected;
  }, [filteredRows, selectedRows, allUnbilledSelected]);


  // Handle navigation after unsaved changes dialog
  const handleProceedWithNavigation = () => {
    setShowUnsavedDialog(false);
    if (pendingNavigation === 'create-invoice') {
      openCreatePanel();
    }
    setPendingNavigation(null);
  };

  const handleSaveAndProceed = async () => {
    await saveAllEdits();
    setShowUnsavedDialog(false);
    if (pendingNavigation === 'create-invoice') {
      openCreatePanel();
    }
    setPendingNavigation(null);
  };

  // Open inline Create Invoices panel
  const openCreatePanel = () => {
    // Compute period from selected events
    const selectedEventRows = rows.filter(r => selectedRows.has(r.id));
    const dates = selectedEventRows.map(r => r.occurred_at?.slice(0, 10)).filter(Boolean).sort();
    setInvoicePeriodStart(dates[0] || new Date().toISOString().slice(0, 10));
    setInvoicePeriodEnd(dates[dates.length - 1] || new Date().toISOString().slice(0, 10));
    setShowCreatePanel(true);
  };

  // Validate selection and show Create Invoices panel
  // Phase 5A: Block if any selected rows have billing issues
  const handleCreateInvoice = () => {
    const unbilledEventIds = Array.from(selectedRows).filter(id => {
      const row = rows.find(r => r.id === id);
      return row?.status === 'unbilled';
    });

    // Check if any selected rows are NOT unbilled
    const nonUnbilledCount = selectedRows.size - unbilledEventIds.length;
    if (nonUnbilledCount > 0) {
      toast({
        title: 'Selection contains non-unbilled rows',
        description: `${nonUnbilledCount} selected row(s) are reserved/invoiced. Please deselect them first.`,
        variant: 'destructive',
      });
      return;
    }

    if (unbilledEventIds.length === 0) {
      toast({
        title: 'No unbilled charges selected',
        description: 'Please select unbilled charges to create an invoice.',
        variant: 'destructive',
      });
      return;
    }

    // Phase 5A: Check for unsafe lines before proceeding
    const unsafeIds = unbilledEventIds.filter(id => {
      const row = rows.find(r => r.id === id);
      return row && !isLineSafe(row);
    });

    if (unsafeIds.length > 0) {
      setPendingUnsafeEventIds(unsafeIds);
      setUnsafeInvoiceDialogOpen(true);
      return;
    }

    // Check for unsaved edits
    if (hasUnsavedChanges) {
      setPendingNavigation('create-invoice');
      setShowUnsavedDialog(true);
      return;
    }

    // All lines are safe, open inline panel
    openCreatePanel();
  };

  // Execute Create Draft Invoices
  const handleExecuteCreateInvoices = async () => {
    if (invoiceGrouping === 'single') {
      // Require confirmation for combined invoice across accounts
      const accountIds = new Set(
        rows.filter(r => selectedRows.has(r.id)).map(r => r.account_id)
      );
      if (accountIds.size > 1) {
        setCombinedConfirmOpen(true);
        return;
      }
    }
    await executeCreateInvoices();
  };

  const executeCreateInvoices = async () => {
    setCombinedConfirmOpen(false);
    setCreatingInvoices(true);

    try {
      const selectedEventIds = Array.from(selectedRows);

      // Re-validate: fresh query to ensure all are still unbilled
      const { data: freshEvents, error: freshErr } = await supabase
        .from("billing_events")
        .select("id, status")
        .in("id", selectedEventIds);

      if (freshErr) throw freshErr;

      const staleEvents = (freshEvents || []).filter(e => e.status !== 'unbilled');
      if (staleEvents.length > 0) {
        toast({
          title: 'Some events already invoiced',
          description: `${staleEvents.length} event(s) were invoiced by another user. Please refresh and try again.`,
          variant: 'destructive',
        });
        setCreatingInvoices(false);
        return;
      }

      const result = await createInvoicesFromEvents({
        billingEventIds: selectedEventIds,
        grouping: invoiceGrouping,
        invoiceType: invoiceType,
      });

      if (result.success > 0) {
        // Activity logging for invoiced events is handled in useInvoices.ts

        // Clear selection and panel
        setSelectedRows(new Set());
        setShowCreatePanel(false);

        toast({
          title: 'Invoices created',
          description: `Created ${result.success} draft invoice(s) with ${Array.from(selectedRows).length} line items.`,
        });

        // Navigate to invoices page to see the new drafts
        navigate('/billing/invoices');
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "Unknown error";
      toast({ title: "Invoice creation failed", description: message, variant: "destructive" });
    } finally {
      setCreatingInvoices(false);
    }
  };

  // Selected rows summary for the create panel
  const selectedRowsSummary = useMemo(() => {
    const selected = rows.filter(r => selectedRows.has(r.id));
    const total = selected.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);
    const accountIds = new Set(selected.map(r => r.account_id));
    const accountNames = [...accountIds].map(id => {
      const row = selected.find(r => r.account_id === id);
      return row?.account_name || 'Unknown';
    });
    return { count: selected.length, total, accountCount: accountIds.size, accountNames };
  }, [rows, selectedRows]);

  // Phase 5A: Get details of unsafe rows for the modal
  const getUnsafeRowDetails = useMemo(() => {
    return pendingUnsafeEventIds.map(id => {
      const row = rows.find(r => r.id === id);
      if (!row) return null;
      return {
        id: row.id,
        account: row.account_name || 'Unknown',
        chargeType: row.charge_type,
        issue: getLineIssue(row) || 'Unknown issue',
        quantity: row.quantity,
      };
    }).filter(Boolean);
  }, [pendingUnsafeEventIds, rows]);

  // Get unique charge types for service filter
  const uniqueChargeTypes = useMemo(() => {
    const types = new Set<string>();
    rows.forEach(r => {
      if (r.charge_type) types.add(r.charge_type);
    });
    // Also add from services
    services.forEach(s => types.add(s.service_code));
    return Array.from(types).sort();
  }, [rows, services]);

  const exportExcel = async () => {
    // Prepare data for Excel export
    const excelData = rows.map(r => ({
      'Date': formatDateMMDDYY(r.occurred_at),
      'Account': r.account_name || '-',
      'Sidemark': r.sidemark_name || '-',
      'Item': r.item_code || '-',
      'Event Type': r.event_type,
      'Charge Type': r.charge_type,
      'Description': r.description || '',
      'Quantity': r.quantity,
      'Unit Rate': r.unit_rate,
      'Total': r.total_amount,
      'Status': r.status,
      'Invoice ID': r.invoice_id || '',
    }));

    // Create workbook and worksheet
    const wb = new ExcelJS.Workbook();
    const ws = addJsonSheet(wb, excelData, 'Billing Report');

    // Set column widths
    setColumnWidths(ws, [12, 25, 20, 15, 15, 20, 30, 10, 12, 12, 12, 15]);

    // Generate Excel file and download
    await downloadWorkbook(wb, `billing_report_${start}_to_${end}.xlsx`);
  };

  useEffect(() => {
    if (profile?.tenant_id) {
      fetchRows();
    }
  }, [profile?.tenant_id]);

  const stats = useMemo(() => {
    const unbilled = rows.filter(r => r.status === "unbilled").reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const invoiced = rows.filter(r => r.status === "invoiced").reduce((s, r) => s + Number(r.total_amount || 0), 0);
    const voided = rows.filter(r => r.status === "void").reduce((s, r) => s + Number(r.total_amount || 0), 0);
    return { unbilled, invoiced, voided, total: unbilled + invoiced };
  }, [rows]);

  // Transform unbilled events for QuickBooks sync
  const unbilledEventsForSync: BillingEventForSync[] = useMemo(() => {
    return rows
      .filter(r => r.status === "unbilled" && r.account_id)
      .map(r => ({
        id: r.id,
        account_id: r.account_id,
        event_type: r.event_type,
        charge_type: r.charge_type,
        description: r.description || `${r.charge_type} charge`,
        quantity: r.quantity,
        unit_rate: r.unit_rate,
        total_amount: r.total_amount,
        occurred_at: r.occurred_at,
        item_id: r.item_id || undefined,
        item_code: r.item_code || undefined,
      }));
  }, [rows]);

  const getStatusBadge = (status: string) => (
    <StatusIndicator status={status} size="sm" />
  );

  // Sortable column header component
  const SortableHeader = ({ field, children, className = '' }: { field: SortField; children: React.ReactNode; className?: string }) => (
    <th
      className={`p-3 border-b font-medium cursor-pointer hover:bg-muted/80 select-none ${className}`}
      onClick={() => handleSort(field)}
    >
      <div className="flex items-center">
        {children}
        {getSortIcon(field)}
      </div>
    </th>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Billing Report</h2>
          <p className="text-muted-foreground text-sm">View, edit, and manage billing events</p>
        </div>
        <div className="flex gap-2">
          {selectedRows.size > 0 && !showCreatePanel && (
            <>
              <Button onClick={handleCreateInvoice} size="sm" variant="default">
                <MaterialIcon name="receipt" size="sm" className="mr-2" />
                Create Invoices ({selectedRows.size})
              </Button>
              <Button onClick={() => setBulkVoidConfirmOpen(true)} size="sm" variant="outline" className="text-destructive border-destructive/50 hover:bg-destructive/10">
                <MaterialIcon name="cancel" size="sm" className="mr-2" />
                Void Selected ({selectedRows.size})
              </Button>
            </>
          )}
          <Button onClick={() => setAddChargeOpen(true)} size="sm" variant="outline">
            <MaterialIcon name="add" size="sm" className="mr-2" />
            Add Charge
          </Button>
          <Button onClick={fetchRows} disabled={loading} variant="outline" size="sm">
            <MaterialIcon name="refresh" size="sm" className={`mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={!rows.length}>
            <MaterialIcon name="download" size="sm" className="mr-2" />
            Export Excel
          </Button>
          <PushToQuickBooksButton
            billingEvents={unbilledEventsForSync}
            periodStart={start}
            periodEnd={end}
            disabled={unbilledEventsForSync.length === 0}
            onSyncComplete={() => fetchRows()}
          />
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Unbilled</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600 tabular-nums">${stats.unbilled.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Invoiced</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600 tabular-nums">${stats.invoiced.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Voided</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600 tabular-nums">${stats.voided.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Active</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold tabular-nums">${stats.total.toFixed(2)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Phase 5A.1: Billing Issues Banner - Only shows for BLOCKING issues (missing rates) */}
      {unbilledIssueCount > 0 && (
        <Card className="border-red-300 bg-red-50 dark:bg-red-950/30">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900">
                  <MaterialIcon name="error" size="md" className="text-red-600" />
                </div>
                <div>
                  <p className="font-medium text-red-800 dark:text-red-200">
                    {unbilledIssueCount} billing line{unbilledIssueCount !== 1 ? 's' : ''} blocked from invoicing
                  </p>
                  <p className="text-sm text-red-700 dark:text-red-300">
                    {unbilledIssueTotal} item{unbilledIssueTotal !== 1 ? 's' : ''} with missing rates must be fixed before creating invoices
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="border-red-400 text-red-700 hover:bg-red-100"
                onClick={() => setShowOnlyIssues(!showOnlyIssues)}
              >
                <MaterialIcon name={showOnlyIssues ? "visibility_off" : "visibility"} size="sm" className="mr-2" />
                {showOnlyIssues ? 'Show All' : 'Show Only Issues'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Inline Create Invoices Panel */}
      {showCreatePanel && selectedRows.size > 0 && (
        <Card className="border-blue-300 bg-blue-50/50 dark:bg-blue-950/20">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                  <MaterialIcon name="receipt_long" size="md" />
                  Create Draft Invoices
                </CardTitle>
                <CardDescription>
                  {selectedRowsSummary.count} charge(s) totaling ${selectedRowsSummary.total.toFixed(2)} across {selectedRowsSummary.accountCount} account(s)
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setShowCreatePanel(false)}>
                <MaterialIcon name="close" size="sm" />
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Grouping */}
              <div className="space-y-1">
                <Label className="text-sm font-medium">Grouping</Label>
                <Select value={invoiceGrouping} onValueChange={(v) => setInvoiceGrouping(v as InvoiceGrouping)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="by_account">One invoice per account</SelectItem>
                    <SelectItem value="by_account_sidemark">Separate by account + sidemark</SelectItem>
                    <SelectItem value="single">One combined invoice</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Line sorting */}
              <div className="space-y-1">
                <Label className="text-sm font-medium">Line Sorting</Label>
                <Select value={invoiceLineSorting} onValueChange={(v) => setInvoiceLineSorting(v as LineSortOption)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date">By Date</SelectItem>
                    <SelectItem value="service">By Service Type</SelectItem>
                    <SelectItem value="item">By Item</SelectItem>
                    <SelectItem value="amount">By Amount (High to Low)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Invoice Type */}
              <div className="space-y-1">
                <Label className="text-sm font-medium">Invoice Type</Label>
                <Select value={invoiceType} onValueChange={(v) => setInvoiceType(v as InvoiceType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly_services">Weekly Services</SelectItem>
                    <SelectItem value="monthly_storage">Monthly Storage</SelectItem>
                    <SelectItem value="closeout">Closeout</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Period (optional, for header) */}
              <div className="space-y-1">
                <Label className="text-sm font-medium">Period (optional)</Label>
                <div className="flex gap-2">
                  <Input
                    type="date"
                    value={invoicePeriodStart}
                    onChange={(e) => setInvoicePeriodStart(e.target.value)}
                    className="text-xs"
                  />
                  <Input
                    type="date"
                    value={invoicePeriodEnd}
                    onChange={(e) => setInvoicePeriodEnd(e.target.value)}
                    className="text-xs"
                  />
                </div>
              </div>
            </div>

            {/* Grouping explanation */}
            <div className="text-sm text-muted-foreground bg-white dark:bg-background p-2 rounded border">
              {invoiceGrouping === 'by_account' && (
                <span>Will create {selectedRowsSummary.accountCount} invoice(s) - one per account.</span>
              )}
              {invoiceGrouping === 'by_account_sidemark' && (
                <span>Will create separate invoices for each unique account + sidemark combination.</span>
              )}
              {invoiceGrouping === 'single' && selectedRowsSummary.accountCount > 1 && (
                <span className="text-amber-600">Will create 1 combined invoice across {selectedRowsSummary.accountCount} accounts. Confirmation required.</span>
              )}
              {invoiceGrouping === 'single' && selectedRowsSummary.accountCount === 1 && (
                <span>Will create 1 invoice for {selectedRowsSummary.accountNames[0]}.</span>
              )}
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-3">
              <Button
                onClick={handleExecuteCreateInvoices}
                disabled={creatingInvoices}
                className="bg-blue-600 hover:bg-blue-700"
              >
                {creatingInvoices && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
                <MaterialIcon name="receipt" size="sm" className="mr-2" />
                {creatingInvoices ? 'Creating...' : `Create Draft Invoice${selectedRowsSummary.accountCount > 1 && invoiceGrouping !== 'single' ? 's' : ''}`}
              </Button>
              <Button variant="outline" onClick={() => { setShowCreatePanel(false); setSelectedRows(new Set()); }} disabled={creatingInvoices}>
                Cancel Selection
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          {/* Filter Mode Toggle */}
          <div className="flex items-center gap-2 mb-4">
            <span className="text-sm font-medium text-muted-foreground">Mode:</span>
            <div className="inline-flex rounded-md border">
              <button
                className={`px-3 py-1.5 text-sm font-medium rounded-l-md transition-colors ${filterMode === 'date_range' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
                onClick={() => setFilterMode('date_range')}
              >
                Date Range
              </button>
              <button
                className={`px-3 py-1.5 text-sm font-medium rounded-r-md transition-colors ${filterMode === 'all_unbilled' ? 'bg-primary text-primary-foreground' : 'bg-background hover:bg-muted'}`}
                onClick={() => setFilterMode('all_unbilled')}
              >
                All Unbilled
              </button>
            </div>
            {filterMode === 'all_unbilled' && (
              <span className="text-xs text-muted-foreground ml-2">
                Shows all unbilled charges regardless of date
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="space-y-1">
              <label className="text-sm font-medium">Start Date</label>
              <Input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                disabled={filterMode === 'all_unbilled'}
                className={filterMode === 'all_unbilled' ? 'opacity-50' : ''}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">End Date</label>
              <Input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                disabled={filterMode === 'all_unbilled'}
                className={filterMode === 'all_unbilled' ? 'opacity-50' : ''}
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Account</label>
              <MultiSelect
                options={accounts.map((a) => ({
                  value: a.id,
                  label: `${a.account_code} - ${a.account_name}`,
                }))}
                selected={selectedAccounts}
                onChange={setSelectedAccounts}
                placeholder="All accounts"
                emptyMessage="No accounts found"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Status{filterMode === 'all_unbilled' ? ' (Unbilled only)' : ''}</label>
              {filterMode === 'all_unbilled' ? (
                <div className="flex h-10 items-center rounded-md border bg-muted/50 px-3 text-sm text-muted-foreground">
                  Unbilled only
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {([
                    { value: 'unbilled', label: 'Unbilled', activeClass: 'bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40' },
                    { value: 'invoiced', label: 'Invoiced', activeClass: 'bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/40' },
                    { value: 'void', label: 'Void', activeClass: 'bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/40' },
                  ] as const).map(({ value, label, activeClass }) => {
                    const isActive = selectedStatuses.includes(value);
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => {
                          setSelectedStatuses(prev =>
                            isActive
                              ? prev.filter(s => s !== value)
                              : [...prev, value]
                          );
                        }}
                        className={`px-3 py-1.5 text-xs font-medium rounded-full border transition-colors ${
                          isActive
                            ? activeClass
                            : 'bg-background text-muted-foreground border-border hover:bg-muted'
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground leading-tight">
                Unbilled is for invoicing. Enable Invoiced/Void to review history.
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Service Type</label>
              <MultiSelect
                options={[
                  { value: '__addon__', label: 'Add Charge (Manual)' },
                  ...services.map((s) => ({
                    value: s.service_code,
                    label: s.service_name || s.service_code,
                  })),
                ]}
                selected={selectedServices}
                onChange={setSelectedServices}
                placeholder="All services"
                emptyMessage="No services found"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Search</label>
              <div className="relative">
                <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by item, description, account, date, sidemark..."
                  className="pl-9"
                />
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-between items-center">
            <div className="text-sm text-muted-foreground flex items-center gap-4">
              {selectedRows.size > 0 && (
                <span className="font-medium text-blue-600">{selectedRows.size} row(s) selected &mdash; ${rows.filter(r => selectedRows.has(r.id)).reduce((s, r) => s + Number(r.total_amount || 0), 0).toFixed(2)}</span>
              )}
              {hasUnsavedChanges && (
                <span className="text-amber-600 flex items-center gap-1">
                  <MaterialIcon name="edit" size="sm" />
                  {Object.keys(rowEdits).length} unsaved change(s)
                </span>
              )}
            </div>
            <div className="flex gap-2">
              {/* Save/Discard buttons when there are unsaved changes */}
              {hasUnsavedChanges && (
                <>
                  <Button variant="outline" size="sm" onClick={discardChanges}>
                    Discard Changes
                  </Button>
                  <Button size="sm" onClick={saveAllEdits} disabled={savingRows}>
                    {savingRows && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
                    Save Changes
                  </Button>
                </>
              )}
              {/* Create Invoice button - opens inline panel */}
              {selectedRows.size > 0 && !showCreatePanel && (
                <Button onClick={handleCreateInvoice} size="sm" variant="default">
                  <MaterialIcon name="receipt" size="sm" className="mr-2" />
                  Create Invoices ({selectedRows.size})
                </Button>
              )}
              {filterMode === 'date_range' && !(selectedStatuses.length === 1 && selectedStatuses[0] === 'unbilled') && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedStatuses(['unbilled'])}
                >
                  <MaterialIcon name="restart_alt" size="sm" className="mr-1" />
                  Reset Filters
                </Button>
              )}
              <Button onClick={fetchRows} disabled={loading}>
                <MaterialIcon name="search" size="sm" className="mr-2" />
                Run Report
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="description" size="md" />
            Billing Events ({filteredRows.length}{searchQuery.trim() && filteredRows.length !== rows.length ? ` of ${rows.length}` : ''})
          </CardTitle>
          <CardDescription>
            Click on Description, Qty, Sidemark, or Rate fields to edit unbilled charges. Click column headers to sort.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="w-10 p-3 border-b">
                    <Checkbox
                      checked={allUnbilledSelected}
                      onCheckedChange={toggleSelectAll}
                      className={someUnbilledSelected ? "data-[state=checked]:bg-primary/50" : ""}
                    />
                  </th>
                  {/* Phase 5A: Billing Safety Status Column */}
                  <th className="w-10 p-3 border-b text-center" title="Billing Status">
                    <MaterialIcon name="verified" size="sm" className="text-muted-foreground" />
                  </th>
                  <SortableHeader field="occurred_at" className="text-left">Date</SortableHeader>
                  <SortableHeader field="account_name" className="text-left">Account</SortableHeader>
                  <SortableHeader field="sidemark_name" className="text-left">Sidemark</SortableHeader>
                  <SortableHeader field="item_code" className="text-left">Item</SortableHeader>
                  <SortableHeader field="event_type" className="text-left">Type</SortableHeader>
                  <SortableHeader field="charge_type" className="text-left">Charge</SortableHeader>
                  <SortableHeader field="description" className="text-left min-w-[150px]">Description</SortableHeader>
                  <SortableHeader field="quantity" className="text-right w-20">Qty</SortableHeader>
                  <SortableHeader field="unit_rate" className="text-right w-24">Rate</SortableHeader>
                  <SortableHeader field="total_amount" className="text-right">Total</SortableHeader>
                  <SortableHeader field="status" className="text-center">Status</SortableHeader>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => {
                  const canEdit = r.status === 'unbilled';
                  const hasEdits = !!rowEdits[r.id];
                  const rowSidemarks = getSidemarksForRow(r.account_id);
                  const hasMissingRate = r.status === 'unbilled' && (r.unit_rate === null || r.unit_rate === undefined);

                  return (
                    <tr key={r.id} className={`border-b hover:bg-muted/50 ${hasMissingRate ? 'bg-red-50 dark:bg-red-950/20' : hasEdits ? 'bg-amber-50' : ''}`}>
                      <td className="p-3">
                        {canEdit && (
                          <Checkbox
                            checked={selectedRows.has(r.id)}
                            onCheckedChange={() => toggleRowSelection(r.id)}
                          />
                        )}
                      </td>
                      {/* Phase 5A.1: Billing Safety Status Indicator */}
                      <td className="p-3 text-center">
                        {r.status === 'unbilled' ? (
                          (() => {
                            const issue = getLineIssue(r);
                            const warning = getLineWarning(r);

                            if (issue) {
                              // BLOCKING: Missing rate - cannot invoice
                              return (
                                <span className="text-red-500" title={`Blocked: ${issue}`}>
                                  <MaterialIcon name="error" size="sm" />
                                </span>
                              );
                            } else if (warning) {
                              // WARNING: $0 rate - allowed but flagged
                              return (
                                <span className="text-blue-500" title={`Warning: ${warning}`}>
                                  <MaterialIcon name="info" size="sm" />
                                </span>
                              );
                            } else {
                              // SAFE: Ready for invoicing
                              return (
                                <span className="text-green-600" title="Ready for invoicing">
                                  <MaterialIcon name="check_circle" size="sm" />
                                </span>
                              );
                            }
                          })()
                        ) : (
                          <span className="text-muted-foreground" title="Already processed">
                            <MaterialIcon name="remove" size="sm" />
                          </span>
                        )}
                      </td>
                      <td className="p-3 whitespace-nowrap">{r.occurred_at?.slice(0, 10)}</td>
                      <td className="p-3 max-w-[180px] truncate">{r.account_name}</td>
                      {/* Sidemark - Editable */}
                      <td className="p-3 text-xs max-w-[150px] truncate">
                        {canEdit && editingCell?.rowId === r.id && editingCell?.field === 'sidemark_id' ? (
                          <Select
                            value={getRowValue(r, 'sidemark_id') || '__none__'}
                            onValueChange={(v) => handleEditChange(r.id, 'sidemark_id', v === '__none__' ? '' : v)}
                          >
                            <SelectTrigger className="h-8 text-xs w-32" onBlur={handleCellBlur}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">None</SelectItem>
                              {rowSidemarks.map((s) => (
                                <SelectItem key={s.id} value={s.id}>{s.sidemark_name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span
                            className={canEdit ? 'cursor-text hover:bg-muted p-1 rounded' : ''}
                            onClick={() => canEdit && startCellEdit(r, 'sidemark_id')}
                          >
                            {getSidemarkName(r)}
                          </span>
                        )}
                      </td>
                      <td className="p-3 font-mono text-xs">{r.item_code}</td>
                      <td className="p-3">{r.event_type}</td>
                      <td className="p-3">{r.charge_type || r.description || '\u2014'}</td>
                      {/* Description - Editable */}
                      <td className="p-3 max-w-[200px]">
                        {canEdit && editingCell?.rowId === r.id && editingCell?.field === 'description' ? (
                          <Input
                            autoFocus
                            value={getRowValue(r, 'description')}
                            onChange={(e) => handleEditChange(r.id, 'description', e.target.value)}
                            onBlur={handleCellBlur}
                            onKeyDown={handleEditKeyDown}
                            className="h-8 text-sm"
                            placeholder="Description"
                          />
                        ) : (
                          <span
                            className={`truncate block ${canEdit ? 'cursor-text hover:bg-muted p-1 rounded' : ''}`}
                            onClick={() => canEdit && startCellEdit(r, 'description')}
                          >
                            {getRowValue(r, 'description') || "-"}
                          </span>
                        )}
                      </td>
                      {/* Quantity - Editable */}
                      <td className="p-3 text-right tabular-nums whitespace-nowrap">
                        {canEdit && editingCell?.rowId === r.id && editingCell?.field === 'quantity' ? (
                          <Input
                            autoFocus
                            type="number"
                            value={getRowValue(r, 'quantity')}
                            onChange={(e) => handleEditChange(r.id, 'quantity', e.target.value)}
                            onBlur={handleCellBlur}
                            onKeyDown={handleEditKeyDown}
                            className="h-8 text-sm w-20 text-right"
                            step="1"
                            min="1"
                          />
                        ) : (
                          <span
                            className={canEdit ? 'cursor-text hover:bg-muted p-1 rounded' : ''}
                            onClick={() => canEdit && startCellEdit(r, 'quantity')}
                          >
                            {getRowValue(r, 'quantity')}
                          </span>
                        )}
                      </td>
                      {/* Rate - Editable - Shows MISSING RATE badge if null */}
                      <td className="p-3 text-right tabular-nums whitespace-nowrap">
                        {canEdit && editingCell?.rowId === r.id && editingCell?.field === 'unit_rate' ? (
                          <Input
                            autoFocus
                            type="number"
                            value={getRowValue(r, 'unit_rate')}
                            onChange={(e) => handleEditChange(r.id, 'unit_rate', e.target.value)}
                            onBlur={handleCellBlur}
                            onKeyDown={handleEditKeyDown}
                            className="h-8 text-sm w-24 text-right"
                            step="0.01"
                            min="0"
                          />
                        ) : hasMissingRate ? (
                          <Badge
                            variant="destructive"
                            className="cursor-pointer text-xs font-semibold animate-pulse"
                            onClick={() => canEdit && startCellEdit(r, 'unit_rate')}
                          >
                            MISSING RATE
                          </Badge>
                        ) : (
                          <span
                            className={canEdit ? 'cursor-text hover:bg-muted p-1 rounded' : ''}
                            onClick={() => canEdit && startCellEdit(r, 'unit_rate')}
                          >
                            ${Number(getRowValue(r, 'unit_rate') || 0).toFixed(2)}
                          </span>
                        )}
                      </td>
                      {/* Total - Auto-calculated (shows N/A if rate is missing) */}
                      <td className="p-3 text-right font-semibold tabular-nums whitespace-nowrap">
                        {hasMissingRate ? (
                          <span className="text-red-500 text-sm">N/A</span>
                        ) : (
                          <span className={hasEdits ? 'text-amber-600' : ''}>
                            ${getRowTotal(r).toFixed(2)}
                          </span>
                        )}
                      </td>
                      <td className="p-3 text-center">{getStatusBadge(r.status)}</td>
                    </tr>
                  );
                })}
                {filteredRows.length === 0 && (
                  <tr>
                    <td className="p-8 text-center text-muted-foreground" colSpan={13}>
                      {rows.length === 0
                        ? 'No billing events found for the selected filters'
                        : showOnlyIssues
                          ? 'No billing issues found - all unbilled lines have valid rates'
                          : `No results match "${searchQuery}"`}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Add Custom Charge Dialog */}
      <Dialog open={addChargeOpen} onOpenChange={setAddChargeOpen}>
        <DialogContent className="sm:max-w-[550px]">
          <DialogHeader>
            <DialogTitle>Add Custom Charge</DialogTitle>
            <DialogDescription>
              Create a new billing charge that will be added to the unbilled charges
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="charge_account">Account *</Label>
                <Select
                  value={newCharge.account_id}
                  onValueChange={(v) => setNewCharge({ ...newCharge, account_id: v, sidemark_id: '' })}
                >
                  <SelectTrigger id="charge_account">
                    <SelectValue placeholder="Select account..." />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.account_code} - {a.account_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="charge_sidemark">Sidemark (optional)</Label>
                <Select
                  value={newCharge.sidemark_id || '__none__'}
                  onValueChange={(v) => setNewCharge({ ...newCharge, sidemark_id: v === '__none__' ? '' : v })}
                  disabled={!newCharge.account_id}
                >
                  <SelectTrigger id="charge_sidemark">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {accountSidemarks.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.sidemark_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="charge_type">Charge Type *</Label>
                <Input
                  id="charge_type"
                  value={newCharge.charge_type}
                  onChange={(e) => setNewCharge({ ...newCharge, charge_type: e.target.value })}
                  placeholder="e.g., ADDITIONAL_SERVICE"
                  list="charge-types"
                />
                <datalist id="charge-types">
                  {uniqueChargeTypes.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>

              <div className="space-y-2">
                <Label htmlFor="charge_date">Charge Date</Label>
                <Input
                  id="charge_date"
                  type="date"
                  value={newCharge.occurred_at}
                  onChange={(e) => setNewCharge({ ...newCharge, occurred_at: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="charge_qty">Quantity *</Label>
                <Input
                  id="charge_qty"
                  type="number"
                  value={newCharge.quantity}
                  onChange={(e) => setNewCharge({ ...newCharge, quantity: e.target.value })}
                  min="1"
                  step="1"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="charge_rate">Unit Rate *</Label>
                <Input
                  id="charge_rate"
                  type="number"
                  value={newCharge.unit_rate}
                  onChange={(e) => setNewCharge({ ...newCharge, unit_rate: e.target.value })}
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                />
              </div>
            </div>

            {newCharge.unit_rate && newCharge.quantity && (
              <div className="text-right text-lg font-semibold text-blue-600">
                Total: ${(parseFloat(newCharge.unit_rate || '0') * parseFloat(newCharge.quantity || '0')).toFixed(2)}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="charge_desc">Description</Label>
              <Textarea
                id="charge_desc"
                value={newCharge.description}
                onChange={(e) => setNewCharge({ ...newCharge, description: e.target.value })}
                placeholder="Optional description for this charge..."
                rows={2}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddChargeOpen(false)} disabled={addChargeLoading}>
              Cancel
            </Button>
            <Button onClick={handleAddCharge} disabled={addChargeLoading}>
              {addChargeLoading && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
              Add Charge
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unsaved Changes Dialog */}
      <AlertDialog open={showUnsavedDialog} onOpenChange={setShowUnsavedDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have {Object.keys(rowEdits).length} unsaved change(s). Would you like to save them before proceeding?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingNavigation(null)}>Cancel</AlertDialogCancel>
            <Button variant="outline" onClick={handleProceedWithNavigation}>
              Discard & Continue
            </Button>
            <AlertDialogAction onClick={handleSaveAndProceed}>
              Save & Continue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Inactive Service Types Dialog */}
      <Dialog open={inactiveServiceDialogOpen} onOpenChange={setInactiveServiceDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="warning" size="md" className="text-yellow-500" />
              Inactive Service Types Found
            </DialogTitle>
            <DialogDescription>
              The following billing events use service types that are now inactive:
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="bg-muted rounded-lg p-3 space-y-2 max-h-[200px] overflow-y-auto">
              {inactiveServiceEvents.map((group, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span>{group.count}x "{group.serviceName}"</span>
                  <span className="font-medium">${group.total.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground mt-3">
              Total: {inactiveServiceEvents.reduce((sum, g) => sum + g.count, 0)} event(s) worth ${inactiveServiceEvents.reduce((sum, g) => sum + g.total, 0).toFixed(2)}
            </p>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={handleCancelInactiveDialog}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleVoidInactiveServices}>
              Void Events
            </Button>
            <Button onClick={handleIncludeInactiveServices}>
              Include Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Phase 5A.1: Unsafe Invoice Blocking Modal - Only blocks for missing rates */}
      <AlertDialog open={unsafeInvoiceDialogOpen} onOpenChange={setUnsafeInvoiceDialogOpen}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600">
              <MaterialIcon name="error" size="md" />
              Cannot Create Invoice
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingUnsafeEventIds.length} of your selected billing line{pendingUnsafeEventIds.length !== 1 ? 's have' : ' has'} missing rates that must be set before creating an invoice.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="py-4">
            <div className="bg-red-50 dark:bg-red-950/30 rounded-lg p-3 space-y-2 max-h-[200px] overflow-y-auto border border-red-200">
              {getUnsafeRowDetails.map((detail: any, i: number) => (
                <div key={i} className="flex justify-between text-sm items-center">
                  <div>
                    <span className="font-medium">{detail.chargeType}</span>
                    <span className="text-muted-foreground ml-2">({detail.account})</span>
                  </div>
                  <Badge variant="outline" className="bg-red-100 text-red-700 border-red-300">
                    {detail.issue}
                  </Badge>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground mt-3">
              Click on the Rate field for each line to set a rate, then try again.
            </p>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => {
              setUnsafeInvoiceDialogOpen(false);
              setPendingUnsafeEventIds([]);
            }}>
              Close
            </AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                setUnsafeInvoiceDialogOpen(false);
                setPendingUnsafeEventIds([]);
                setShowOnlyIssues(true);
              }}
            >
              <MaterialIcon name="visibility" size="sm" className="mr-2" />
              Show Issues
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Void Confirmation Dialog */}
      <AlertDialog open={bulkVoidConfirmOpen} onOpenChange={setBulkVoidConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <MaterialIcon name="cancel" size="md" className="text-destructive" />
              Void selected charges?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will mark {selectedRows.size} billing event{selectedRows.size !== 1 ? 's' : ''} as void. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkVoiding}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkVoid}
              disabled={bulkVoiding}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkVoiding ? 'Voiding\u2026' : 'Void'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Combined Invoice Confirmation Dialog */}
      <AlertDialog open={combinedConfirmOpen} onOpenChange={setCombinedConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <MaterialIcon name="warning" size="md" className="text-amber-500" />
              Combine Multiple Accounts?
            </AlertDialogTitle>
            <AlertDialogDescription>
              You are about to create a single combined invoice across {selectedRowsSummary.accountCount} different accounts ({selectedRowsSummary.accountNames.join(', ')}). This is unusual and may cause billing confusion. Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={executeCreateInvoices}>
              Yes, Create Combined Invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
