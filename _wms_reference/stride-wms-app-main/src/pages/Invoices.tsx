import { useEffect, useState, useMemo } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useInvoices, Invoice, InvoiceLine, InvoiceType, InvoiceGrouping } from "@/hooks/useInvoices";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/ui/StatusIndicator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Plus, FileText, Send, Eye, XCircle, Calendar, Download, ArrowUpDown, Save, ChevronUp, ChevronDown, Printer, Settings2, Mail, FileSpreadsheet, Palette } from "lucide-react";
import ExcelJS from 'exceljs';
import { addJsonSheet, setColumnWidths, downloadWorkbook } from '@/lib/excelUtils';
import { useAuth } from "@/contexts/AuthContext";
import { InvoiceTemplateTab } from "@/components/invoices/InvoiceTemplateTab";
import { sendEmail, buildInvoiceSentEmail } from "@/lib/email";
import { queueInvoiceSentAlert } from "@/lib/alertQueue";
import { downloadInvoicePdf, printInvoicePdf, InvoicePdfData } from "@/lib/invoicePdf";
import { EntityActivityFeed } from "@/components/activity/EntityActivityFeed";

interface Account {
  id: string;
  account_name: string;
  account_code: string;
  billing_contact_name: string | null;
  billing_contact_email: string | null;
  billing_address: string | null;
  billing_city: string | null;
  billing_state: string | null;
  billing_postal_code: string | null;
  billing_country: string | null;
  billing_net_terms: number | null;
}

interface TenantCompanySettings {
  company_name: string | null;
  company_address: string | null;
  company_phone: string | null;
  company_email: string | null;
  company_website: string | null;
  logo_url: string | null;
  brand_color?: string | null;
}

interface Sidemark {
  id: string;
  sidemark_name: string;
}

type SortField = 'invoice_number' | 'created_at' | 'total' | 'status' | 'account';
type SortDir = 'asc' | 'desc';
type LocalInvoiceGrouping = 'by_sidemark' | 'by_account';
type LineSortOption = 'date' | 'service' | 'item' | 'amount';

const shortId = (id: string) => id.slice(-6);

interface SelectedBillingEvent {
  id: string;
  account_id: string;
  account_name: string;
  sidemark_name: string | null;
  charge_type: string;
  description: string | null;
  quantity: number;
  total_amount: number;
  occurred_at: string;
}

export default function Invoices() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { createInvoiceDraft, markInvoiceSent, voidInvoice, fetchInvoices, fetchInvoiceLines, generateStorageForDate, updateInvoiceNotes, createInvoicesFromEvents, removeInvoiceLine, deleteInvoice } = useInvoices();
  
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sidemarks, setSidemarks] = useState<Sidemark[]>([]);
  const [selectedSidemarkId, setSelectedSidemarkId] = useState<string>("");
  const [periodStart, setPeriodStart] = useState<string>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  });
  const [periodEnd, setPeriodEnd] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [invoiceType, setInvoiceType] = useState<InvoiceType>("weekly_services");
  const [includeEarlier, setIncludeEarlier] = useState(false);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  
  // Sorting
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  
  // Lines dialog
  const [linesDialogOpen, setLinesDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [chargeNameMap, setChargeNameMap] = useState<Map<string, string>>(new Map());
  
  // Notes editing
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  // Storage generation
  const [storageDate, setStorageDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [generatingStorage, setGeneratingStorage] = useState(false);

  // Invoice generation options
  const [invoiceGrouping, setInvoiceGrouping] = useState<InvoiceGrouping>('by_sidemark');
  const [lineSortOption, setLineSortOption] = useState<LineSortOption>('date');

  // Storage billing period (for monthly storage invoices)
  const [storagePeriodStart, setStoragePeriodStart] = useState<string>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  });
  const [storagePeriodEnd, setStoragePeriodEnd] = useState<string>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
  });
  const [generateStorageForPeriod, setGenerateStorageForPeriod] = useState(false);

  // Batch invoice creation
  const [batchCreating, setBatchCreating] = useState(false);
  const [selectedAccountsForBatch, setSelectedAccountsForBatch] = useState<string[]>([]);

  // Billing report flow - deprecated (invoice creation now inline on billing report)
  const [fromBillingReport, setFromBillingReport] = useState(false);
  const [selectedBillingEvents, setSelectedBillingEvents] = useState<SelectedBillingEvent[]>([]);
  const [billingReportGrouping, setBillingReportGrouping] = useState<InvoiceGrouping>('by_account');
  const [billingReportInvoiceType, setBillingReportInvoiceType] = useState<InvoiceType>('manual');
  const [creatingFromReport, setCreatingFromReport] = useState(false);

  // Tenant company settings for PDF
  const [tenantSettings, setTenantSettings] = useState<TenantCompanySettings | null>(null);

  // Invoice line removal
  const [removingLineId, setRemovingLineId] = useState<string | null>(null);

  // Invoice selection for bulk actions
  const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(new Set());
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkDownloading, setBulkDownloading] = useState(false);

  // Load accounts
  useEffect(() => {
    async function loadAccounts() {
      if (!profile?.tenant_id) return;
      const { data } = await supabase
        .from("accounts")
        .select("id, account_name, account_code, billing_contact_name, billing_contact_email, billing_address, billing_city, billing_state, billing_postal_code, billing_country, billing_net_terms")
        .eq("tenant_id", profile.tenant_id)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("account_name");
      setAccounts(data || []);
    }
    loadAccounts();
  }, [profile?.tenant_id]);

  // Load tenant company settings + brand color
  useEffect(() => {
    async function loadTenantSettings() {
      if (!profile?.tenant_id) return;
      const [settingsRes, brandRes] = await Promise.all([
        supabase
          .from("tenant_company_settings")
          .select("company_name, company_address, company_phone, company_email, company_website, logo_url")
          .eq("tenant_id", profile.tenant_id)
          .maybeSingle(),
        supabase
          .from("communication_brand_settings")
          .select("brand_primary_color")
          .eq("tenant_id", profile.tenant_id)
          .maybeSingle(),
      ]);
      setTenantSettings({
        ...settingsRes.data,
        brand_color: brandRes.data?.brand_primary_color || null,
      } as TenantCompanySettings);
    }
    loadTenantSettings();
  }, [profile?.tenant_id]);

  // Check if coming from billing report and load selected events
  useEffect(() => {
    const source = searchParams.get('source');
    const tab = searchParams.get('tab');

    if (source === 'billing-report' && tab === 'create') {
      setFromBillingReport(true);

      // Load selected billing event IDs from sessionStorage
      const storedIds = sessionStorage.getItem('invoiceSelectedBillingEvents');
      if (storedIds) {
        const eventIds = JSON.parse(storedIds) as string[];
        if (eventIds.length > 0) {
          // Fetch the billing event details
          loadSelectedBillingEvents(eventIds);
        }
      }

      // Clean up URL params
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  // Load billing events by IDs
  const loadSelectedBillingEvents = async (eventIds: string[]) => {
    if (!profile?.tenant_id) return;

    const { data: events, error } = await supabase
      .from("billing_events")
      .select(`
        id, account_id, sidemark_id, charge_type, description, quantity, total_amount, occurred_at,
        accounts:account_id(account_name)
      `)
      .in("id", eventIds)
      .eq("status", "unbilled");

    if (error) {
      console.error("Failed to load billing events:", error);
      toast({ title: "Error", description: "Failed to load selected billing events.", variant: "destructive" });
      return;
    }

    if (!events || events.length === 0) {
      toast({ title: "No events", description: "No unbilled events found. They may have already been invoiced.", variant: "destructive" });
      setFromBillingReport(false);
      return;
    }

    // Get sidemark names
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

    const selectedEvents: SelectedBillingEvent[] = events.map((e: any) => ({
      id: e.id,
      account_id: e.account_id,
      account_name: e.accounts?.account_name || 'Unknown',
      sidemark_name: e.sidemark_id ? (sidemarkMap[e.sidemark_id] || null) : null,
      charge_type: e.charge_type,
      description: e.description,
      quantity: e.quantity || 1,
      total_amount: e.total_amount || 0,
      occurred_at: e.occurred_at,
    }));

    setSelectedBillingEvents(selectedEvents);

    // Clear sessionStorage
    sessionStorage.removeItem('invoiceSelectedBillingEvents');
  };

  // Create invoices from selected billing events
  const handleCreateFromBillingReport = async () => {
    if (selectedBillingEvents.length === 0) {
      toast({ title: "No events", description: "No billing events selected.", variant: "destructive" });
      return;
    }

    setCreatingFromReport(true);
    const result = await createInvoicesFromEvents({
      billingEventIds: selectedBillingEvents.map(e => e.id),
      grouping: billingReportGrouping,
      invoiceType: billingReportInvoiceType,
    });

    if (result.success > 0) {
      setSelectedBillingEvents([]);
      setFromBillingReport(false);
      await load();
    }
    setCreatingFromReport(false);
  };

  // Cancel billing report flow
  const handleCancelBillingReportFlow = () => {
    setSelectedBillingEvents([]);
    setFromBillingReport(false);
    sessionStorage.removeItem('invoiceSelectedBillingEvents');
  };

  // Invoice selection helpers
  const toggleInvoiceSelection = (id: string) => {
    setSelectedInvoices(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  };

  const toggleSelectAllInvoices = () => {
    if (selectedInvoices.size === invoices.length && invoices.length > 0) {
      setSelectedInvoices(new Set());
    } else {
      setSelectedInvoices(new Set(invoices.map(inv => inv.id)));
    }
  };

  const allInvoicesSelected = invoices.length > 0 && selectedInvoices.size === invoices.length;
  const someInvoicesSelected = selectedInvoices.size > 0 && !allInvoicesSelected;

  // Bulk send emails for selected invoices
  const handleBulkSendEmails = async () => {
    if (selectedInvoices.size === 0) {
      toast({ title: "No invoices selected", description: "Please select at least one invoice.", variant: "destructive" });
      return;
    }

    setBulkSending(true);
    let successCount = 0;
    let failCount = 0;

    for (const invoiceId of selectedInvoices) {
      const invoice = invoices.find(inv => inv.id === invoiceId);
      if (!invoice || invoice.status === 'void') continue;

      try {
        // Get invoice lines
        const lines = await fetchInvoiceLines(invoiceId);
        if (!lines || lines.length === 0) continue;

        // Build PDF data
        const pdfData = buildPdfData(invoice, lines);
        if (!pdfData) continue;

        // Get account email
        const account = accounts.find(a => a.id === invoice.account_id);
        if (!account?.billing_contact_email) {
          failCount++;
          continue;
        }

        // Send email with invoice (uses existing sendEmail function)
        const emailData = buildInvoiceSentEmail({
          invoiceNumber: invoice.invoice_number,
          accountName: account.account_name,
          periodStart: invoice.period_start || '',
          periodEnd: invoice.period_end || '',
          total: Number(invoice.total || 0),
          lineCount: lines.length,
        });

        const emailResult = await sendEmail(
          account.billing_contact_email,
          `Invoice ${invoice.invoice_number} from ${tenantSettings?.company_name || 'Stride WMS'}`,
          emailData.html,
          profile?.tenant_id,
        );

        if (emailResult.ok) {
          // Mark as sent
          await markInvoiceSent(invoiceId);
          successCount++;
        } else {
          failCount++;
        }
      } catch (err) {
        console.error(`Failed to send invoice ${invoiceId}:`, err);
        failCount++;
      }
    }

    await load();
    setSelectedInvoices(new Set());
    setBulkSending(false);

    if (successCount > 0) {
      toast({
        title: "Emails sent",
        description: `Sent ${successCount} invoice(s)${failCount > 0 ? `, ${failCount} failed` : ''}`,
      });
    } else {
      toast({
        title: "Failed to send",
        description: "Could not send any invoices. Check billing contact emails.",
        variant: "destructive",
      });
    }
  };

  // Bulk download selected invoices as Excel
  const handleBulkDownloadExcel = async () => {
    if (selectedInvoices.size === 0) {
      toast({ title: "No invoices selected", description: "Please select at least one invoice.", variant: "destructive" });
      return;
    }

    setBulkDownloading(true);

    // Get selected invoice data
    const selectedInvoiceData = invoices.filter(inv => selectedInvoices.has(inv.id));

    // Build Excel data
    const excelData = selectedInvoiceData.map(inv => {
      const account = accounts.find(a => a.id === inv.account_id);
      return {
        'Invoice #': inv.invoice_number,
        'Account': account?.account_name || '-',
        'Account Code': account?.account_code || '-',
        'Type': inv.invoice_type || '-',
        'Period Start': inv.period_start || '-',
        'Period End': inv.period_end || '-',
        'Status': inv.status,
        'Subtotal': Number(inv.subtotal || 0),
        'Tax': Number(inv.tax_total || 0),
        'Total': Number(inv.total || 0),
        'Created': inv.created_at?.slice(0, 10) || '-',
        'Sent': inv.sent_at?.slice(0, 10) || '-',
        'Notes': inv.notes || '',
      };
    });

    // Create workbook
    const wb = new ExcelJS.Workbook();
    const ws = addJsonSheet(wb, excelData, 'Invoices');

    // Set column widths
    setColumnWidths(ws, [18, 25, 12, 15, 12, 12, 10, 12, 10, 12, 12, 12, 30]);

    // Generate and download
    await downloadWorkbook(wb, `invoices_export_${new Date().toISOString().slice(0, 10)}.xlsx`);

    setBulkDownloading(false);
    toast({ title: "Downloaded", description: `Exported ${selectedInvoiceData.length} invoice(s) to Excel.` });
  };

  // Load sidemarks when account changes
  useEffect(() => {
    async function loadSidemarks() {
      if (!accountId) {
        setSidemarks([]);
        setSelectedSidemarkId("");
        return;
      }
      const { data } = await supabase
        .from("sidemarks")
        .select("id, sidemark_name")
        .eq("account_id", accountId)
        .is("deleted_at", null)
        .order("sidemark_name");
      setSidemarks(data || []);
    }
    loadSidemarks();
  }, [accountId]);

  const load = async () => {
    setLoading(true);
    const data = await fetchInvoices({ limit: 100 });
    setInvoices(data);
    setLoading(false);
  };

  useEffect(() => {
    if (profile?.tenant_id) {
      load();
    }
  }, [profile?.tenant_id]);

  // Sorted invoices
  const sortedInvoices = useMemo(() => {
    return [...invoices].sort((a, b) => {
      let aVal: any, bVal: any;
      switch (sortField) {
        case 'invoice_number':
          aVal = a.invoice_number || '';
          bVal = b.invoice_number || '';
          break;
        case 'total':
          aVal = Number(a.total) || 0;
          bVal = Number(b.total) || 0;
          break;
        case 'status':
          aVal = a.status || '';
          bVal = b.status || '';
          break;
        case 'account': {
          const aAcct = accounts.find(acc => acc.id === a.account_id);
          const bAcct = accounts.find(acc => acc.id === b.account_id);
          aVal = aAcct?.account_name || '';
          bVal = bAcct?.account_name || '';
          break;
        }
        case 'created_at':
        default:
          aVal = a.created_at || '';
          bVal = b.created_at || '';
          break;
      }
      if (sortDir === 'asc') {
        return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      } else {
        return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
      }
    });
  }, [invoices, sortField, sortDir, accounts]);

  // Sort invoice lines
  const sortedLines = useMemo(() => {
    return [...lines].sort((a, b) => {
      switch (lineSortOption) {
        case 'service': {
          const aName = chargeNameMap.get((a as any).service_id) || (a as any).charge_type || '';
          const bName = chargeNameMap.get((b as any).service_id) || (b as any).charge_type || '';
          return aName.localeCompare(bName);
        }
        case 'item':
          return (String(a.item_id) || '').localeCompare(String(b.item_id) || '');
        case 'amount':
          return (Number(b.total_amount) || 0) - (Number(a.total_amount) || 0);
        case 'date':
        default:
          return 0; // Keep original order (by created_at)
      }
    });
  }, [lines, lineSortOption, chargeNameMap]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-50" />;
    return sortDir === 'asc' ? <ChevronUp className="h-3 w-3 ml-1" /> : <ChevronDown className="h-3 w-3 ml-1" />;
  };

  const createDraft = async () => {
    if (!accountId) {
      toast({ title: "Account required", description: "Please select an account.", variant: "destructive" });
      return;
    }
    setCreating(true);

    // If grouping by sidemark and no specific sidemark selected, create separate invoices for each sidemark
    if (invoiceGrouping === 'by_sidemark' && !selectedSidemarkId && sidemarks.length > 0) {
      let createdCount = 0;
      for (const sidemark of sidemarks) {
        const inv = await createInvoiceDraft({
          accountId,
          invoiceType,
          periodStart,
          periodEnd,
          sidemark: sidemark.id,
          includeUnbilledBeforePeriod: includeEarlier,
        });
        if (inv) createdCount++;
      }
      // Also create one for charges without sidemark
      const inv = await createInvoiceDraft({
        accountId,
        invoiceType,
        periodStart,
        periodEnd,
        sidemark: null,
        includeUnbilledBeforePeriod: includeEarlier,
      });
      if (inv) createdCount++;

      if (createdCount > 0) {
        toast({ title: "Invoices created", description: `Created ${createdCount} invoice draft(s) for ${accounts.find(a => a.id === accountId)?.account_name}.` });
      }
      await load();
    } else {
      // Single invoice for account (by_account grouping or specific sidemark selected)
      const inv = await createInvoiceDraft({
        accountId,
        invoiceType,
        periodStart,
        periodEnd,
        sidemark: selectedSidemarkId || null,
        includeUnbilledBeforePeriod: includeEarlier,
      });
      if (inv) await load();
    }
    setCreating(false);
  };

  // Batch create invoices for multiple accounts
  const createBatchInvoices = async () => {
    if (selectedAccountsForBatch.length === 0) {
      toast({ title: "No accounts selected", description: "Please select at least one account.", variant: "destructive" });
      return;
    }

    setBatchCreating(true);
    let totalCreated = 0;

    for (const acctId of selectedAccountsForBatch) {
      if (invoiceGrouping === 'by_sidemark') {
        // Get sidemarks for this account
        const { data: acctSidemarks } = await supabase
          .from("sidemarks")
          .select("id")
          .eq("account_id", acctId)
          .is("deleted_at", null);

        if (acctSidemarks && acctSidemarks.length > 0) {
          for (const sm of acctSidemarks) {
            const inv = await createInvoiceDraft({
              accountId: acctId,
              invoiceType,
              periodStart,
              periodEnd,
              sidemark: sm.id,
              includeUnbilledBeforePeriod: includeEarlier,
            });
            if (inv) totalCreated++;
          }
        }
        // Also create for charges without sidemark
        const inv = await createInvoiceDraft({
          accountId: acctId,
          invoiceType,
          periodStart,
          periodEnd,
          sidemark: null,
          includeUnbilledBeforePeriod: includeEarlier,
        });
        if (inv) totalCreated++;
      } else {
        // One invoice per account
        const inv = await createInvoiceDraft({
          accountId: acctId,
          invoiceType,
          periodStart,
          periodEnd,
          sidemark: null,
          includeUnbilledBeforePeriod: includeEarlier,
        });
        if (inv) totalCreated++;
      }
    }

    if (totalCreated > 0) {
      toast({ title: "Batch invoices created", description: `Created ${totalCreated} invoice draft(s).` });
    }

    await load();
    setSelectedAccountsForBatch([]);
    setBatchCreating(false);
  };

  const openLines = async (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setNotesValue(invoice.notes || "");
    setEditingNotes(false);
    setLinesDialogOpen(true);
    setLoadingLines(true);
    const data = await fetchInvoiceLines(invoice.id);
    setLines(data);

    // Fetch charge_types for service name lookup
    const serviceIds = [...new Set(data.map(l => (l as any).service_id).filter(Boolean))] as string[];
    if (serviceIds.length > 0) {
      const { data: chargeTypes } = await supabase
        .from('charge_types')
        .select('id, charge_name')
        .in('id', serviceIds);
      const map = new Map<string, string>();
      (chargeTypes || []).forEach((ct) => map.set(ct.id, ct.charge_name));
      setChargeNameMap(map);
    } else {
      setChargeNameMap(new Map());
    }

    setLoadingLines(false);
  };

  // Generate PDF data for an invoice
  const buildPdfData = (invoice: Invoice, invoiceLines: InvoiceLine[]): InvoicePdfData | null => {
    const account = accounts.find(a => a.id === invoice.account_id);
    if (!account) return null;

    // Calculate due date based on net terms
    const invoiceDate = invoice.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10);
    const netTerms = account.billing_net_terms || 30;
    const parsedInvoiceDate = new Date(invoiceDate);
    const dueDate = isNaN(parsedInvoiceDate.getTime())
      ? new Date()
      : parsedInvoiceDate;
    dueDate.setDate(dueDate.getDate() + netTerms);

    const safePeriodStart = invoice.period_start && !isNaN(new Date(invoice.period_start).getTime())
      ? invoice.period_start : 'N/A';
    const safePeriodEnd = invoice.period_end && !isNaN(new Date(invoice.period_end).getTime())
      ? invoice.period_end : 'N/A';

    return {
      invoiceNumber: invoice.invoice_number,
      invoiceDate: invoiceDate,
      dueDate: dueDate.toISOString().slice(0, 10),
      periodStart: safePeriodStart,
      periodEnd: safePeriodEnd,
      invoiceType: invoice.invoice_type || 'manual',

      companyName: tenantSettings?.company_name || 'Stride WMS',
      companyAddress: tenantSettings?.company_address || undefined,
      companyPhone: tenantSettings?.company_phone || undefined,
      companyEmail: tenantSettings?.company_email || undefined,
      companyWebsite: tenantSettings?.company_website || undefined,
      companyLogo: tenantSettings?.logo_url || undefined,
      brandColor: tenantSettings?.brand_color || undefined,

      accountName: account.account_name,
      accountCode: account.account_code,
      billingContactName: account.billing_contact_name || undefined,
      billingContactEmail: account.billing_contact_email || undefined,
      billingAddress: account.billing_address || undefined,
      billingCity: account.billing_city || undefined,
      billingState: account.billing_state || undefined,
      billingPostalCode: account.billing_postal_code || undefined,
      billingCountry: account.billing_country || undefined,

      lines: invoiceLines.map(line => ({
        serviceCode: String(line.service_code) || '-',
        description: line.description || undefined,
        quantity: line.quantity,
        unitRate: Number(line.unit_rate) || 0,
        lineTotal: Number(line.total_amount) || 0,
      })),

      subtotal: Number(invoice.subtotal) || 0,
      taxRate: Number(invoice.tax_total) > 0 ? 0.1 : undefined,
      taxAmount: Number(invoice.tax_total) || 0,
      total: Number(invoice.total) || 0,

      notes: invoice.notes || undefined,
      paymentTerms: `Net ${netTerms} days`,
    };
  };

  const handleDownloadPdf = async () => {
    if (!selectedInvoice) return;
    const pdfData = buildPdfData(selectedInvoice, sortedLines);
    if (pdfData) {
      await downloadInvoicePdf(pdfData);
      toast({ title: "PDF Downloaded", description: `Invoice ${selectedInvoice.invoice_number} downloaded.` });
    }
  };

  const handlePrintPdf = async () => {
    if (!selectedInvoice) return;
    const pdfData = buildPdfData(selectedInvoice, sortedLines);
    if (pdfData) {
      await printInvoicePdf(pdfData);
    }
  };

  const handleSaveNotes = async () => {
    if (!selectedInvoice) return;
    setSavingNotes(true);
    const ok = await updateInvoiceNotes(selectedInvoice.id, notesValue);
    if (ok) {
      setSelectedInvoice({ ...selectedInvoice, notes: notesValue });
      setEditingNotes(false);
      // Update in list
      setInvoices(prev => prev.map(inv => inv.id === selectedInvoice.id ? { ...inv, notes: notesValue } : inv));
    }
    setSavingNotes(false);
  };

  // CSV Export for invoice lines
  const exportLinesCSV = () => {
    if (!lines.length || !selectedInvoice) return;
    
    const headers = ['Service Code', 'Description', 'Quantity', 'Unit Rate', 'Line Total'];
    const rows = lines.map(line => [
      line.service_code || '',
      (line.description || '').replace(/,/g, ';'),
      line.quantity,
      Number(line.unit_rate || 0).toFixed(2),
      Number(line.total_amount || 0).toFixed(2),
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${selectedInvoice.invoice_number}_lines.csv`;
    link.click();
  };

  // CSV Export for all invoices
  const exportInvoicesCSV = () => {
    if (!invoices.length) return;
    
    const headers = ['Invoice #', 'Account', 'Type', 'Period Start', 'Period End', 'Status', 'Subtotal', 'Total', 'Created', 'Sent'];
    const rows = invoices.map(inv => {
      const account = accounts.find(a => a.id === inv.account_id);
      return [
        inv.invoice_number,
        account?.account_name || inv.account_id.slice(0, 8),
        inv.invoice_type || '',
        inv.period_start || '',
        inv.period_end || '',
        inv.status,
        Number(inv.subtotal || 0).toFixed(2),
        Number(inv.total || 0).toFixed(2),
        inv.created_at?.slice(0, 10) || '',
        inv.sent_at?.slice(0, 10) || '',
      ];
    });
    
    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `invoices_export_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
  };

  const handleSendInvoice = async (invoice: Invoice) => {
    const ok = await markInvoiceSent(invoice.id);
    if (ok && profile?.tenant_id) {
      // Find account email
      const account = accounts.find(a => a.id === invoice.account_id);
      
      // Queue alert for standard alert processing
      await queueInvoiceSentAlert(
        profile.tenant_id,
        invoice.id,
        invoice.invoice_number,
        invoice.total || 0,
        account?.billing_contact_email || undefined
      );
      
      // Also send direct email if account has billing contact
      if (account?.billing_contact_email) {
        const emailData = buildInvoiceSentEmail({
          invoiceNumber: invoice.invoice_number,
          accountName: account.account_name,
          periodStart: invoice.period_start || '',
          periodEnd: invoice.period_end || '',
          total: invoice.total || 0,
          lineCount: lines.length || 0,
        });
        
        const result = await sendEmail(account.billing_contact_email, emailData.subject, emailData.html, profile?.tenant_id);
        if (result.ok) {
          toast({ title: "Email sent", description: `Invoice email sent to ${account.billing_contact_email}` });
        } else {
          toast({ title: "Email queued", description: "Invoice alert queued for delivery." });
        }
      }
      await load();
    }
  };

  const handleVoidInvoice = async (invoiceId: string) => {
    const ok = await voidInvoice(invoiceId);
    if (ok) await load();
  };

  // Remove a single line from an invoice (returns billing event to unbilled)
  const handleRemoveInvoiceLine = async (lineId: string) => {
    if (!selectedInvoice) return;

    const confirmed = window.confirm(
      "Remove this line from the invoice? The billing charge will return to unbilled status."
    );
    if (!confirmed) return;

    setRemovingLineId(lineId);
    const ok = await removeInvoiceLine(lineId, selectedInvoice.id);
    if (ok) {
      // Refresh lines
      const updatedLines = await fetchInvoiceLines(selectedInvoice.id);
      setLines(updatedLines);

      // If invoice was deleted (no lines), close dialog and reload
      if (updatedLines.length === 0) {
        setLinesDialogOpen(false);
        setSelectedInvoice(null);
      } else {
        // Recalculate invoice total in local state
        const newTotal = updatedLines.reduce((sum, l) => sum + Number(l.total_amount || 0), 0);
        setSelectedInvoice(prev => prev ? { ...prev, subtotal: newTotal, total: newTotal } : null);
      }

      await load();
    }
    setRemovingLineId(null);
  };

  // Delete entire invoice
  const handleDeleteInvoice = async (invoiceId: string) => {
    const confirmed = window.confirm(
      "Delete this invoice entirely? All billing charges will return to unbilled status and can be re-invoiced."
    );
    if (!confirmed) return;

    const ok = await deleteInvoice(invoiceId);
    if (ok) {
      setLinesDialogOpen(false);
      setSelectedInvoice(null);
      await load();
    }
  };

  const handleGenerateStorage = async () => {
    setGeneratingStorage(true);
    await generateStorageForDate(storageDate);
    setGeneratingStorage(false);
  };

  const getStatusBadge = (status: string) => (
    <StatusIndicator status={status} size="sm" />
  );

  const getTypeBadge = (type: string) => {
    switch (type) {
      case "weekly_services":
        return <Badge variant="secondary">Weekly Services</Badge>;
      case "monthly_storage":
        return <Badge variant="secondary">Monthly Storage</Badge>;
      case "closeout":
        return <Badge variant="secondary">Closeout</Badge>;
      case "manual":
        return <Badge variant="secondary">Manual</Badge>;
      default:
        return <Badge variant="secondary">{type}</Badge>;
    }
  };

  // Main page tab state — uses ?view= to avoid collision with billing-event ?tab= param
  const [mainTab, setMainTab] = useState<'invoices' | 'template'>(() => {
    const v = searchParams.get('view');
    return v === 'template' ? 'template' : 'invoices';
  });

  const handleMainTabChange = (v: string) => {
    const tab = v as 'invoices' | 'template';
    setMainTab(tab);
    const next = new URLSearchParams(searchParams);
    next.set('view', tab);
    setSearchParams(next, { replace: true });
  };

  return (
    <DashboardLayout>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Revenue Ledger</h1>
            <p className="text-muted-foreground">Create, manage, and customize invoices</p>
          </div>
          <div className="flex items-center gap-2">
            {mainTab === 'invoices' && (
              <Button variant="outline" onClick={load} disabled={loading}>
                <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                {loading ? "Loading..." : "Refresh"}
              </Button>
            )}
          </div>
        </div>

        {/* Main Tabs */}
        <Tabs value={mainTab} onValueChange={handleMainTabChange}>
          <TabsList>
            <TabsTrigger value="invoices" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Invoices
            </TabsTrigger>
            <TabsTrigger value="template" className="flex items-center gap-2">
              <Palette className="h-4 w-4" />
              Template
            </TabsTrigger>
          </TabsList>

          <TabsContent value="invoices" className="space-y-6 mt-4">

        {/* Create from Billing Report Card - appears when coming from billing report */}
        {fromBillingReport && selectedBillingEvents.length > 0 && (
          <Card className="border-blue-200 bg-blue-50/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-blue-700">
                <FileText className="h-5 w-5" />
                Create Invoices from Selected Billing Events
              </CardTitle>
              <CardDescription>
                {selectedBillingEvents.length} billing event(s) selected totaling ${selectedBillingEvents.reduce((sum, e) => sum + Number(e.total_amount || 0), 0).toFixed(2)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Summary of selected events */}
              <div className="border rounded-lg overflow-auto max-h-48 bg-white">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Sidemark</TableHead>
                      <TableHead>Charge</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedBillingEvents.slice(0, 10).map((event) => (
                      <TableRow key={event.id}>
                        <TableCell>{event.occurred_at?.slice(0, 10)}</TableCell>
                        <TableCell>{event.account_name}</TableCell>
                        <TableCell>{event.sidemark_name || '-'}</TableCell>
                        <TableCell>{event.charge_type}</TableCell>
                        <TableCell className="text-right">${Number(event.total_amount || 0).toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                    {selectedBillingEvents.length > 10 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          ... and {selectedBillingEvents.length - 10} more events
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Invoice creation options */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-medium">Invoice Grouping</label>
                  <Select value={billingReportGrouping} onValueChange={(v) => setBillingReportGrouping(v as InvoiceGrouping)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="by_account">Separate invoice per Account</SelectItem>
                      <SelectItem value="by_sidemark">Separate invoice per Sidemark</SelectItem>
                      <SelectItem value="by_account_sidemark">Separate by Account + Sidemark</SelectItem>
                      <SelectItem value="include_subaccounts">Include sub-accounts on parent invoice</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Invoice Type</label>
                  <Select value={billingReportInvoiceType} onValueChange={(v) => setBillingReportInvoiceType(v as InvoiceType)}>
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
                <div className="flex items-end gap-2">
                  <Button
                    onClick={handleCreateFromBillingReport}
                    disabled={creatingFromReport}
                    className="flex-1"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {creatingFromReport ? "Creating..." : "Create Invoices"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleCancelBillingReportFlow}
                    disabled={creatingFromReport}
                  >
                    Cancel
                  </Button>
                </div>
              </div>

              {/* Grouping explanation */}
              <div className="text-sm text-muted-foreground bg-white p-3 rounded-lg border">
                {billingReportGrouping === 'by_account' && (
                  <p>One invoice will be created for each unique account in the selection.</p>
                )}
                {billingReportGrouping === 'by_sidemark' && (
                  <p>Separate invoices will be created for each sidemark. Events without a sidemark will be grouped by account.</p>
                )}
                {billingReportGrouping === 'by_account_sidemark' && (
                  <p>Separate invoices will be created for each unique account + sidemark combination.</p>
                )}
                {billingReportGrouping === 'include_subaccounts' && (
                  <p>Sub-account charges will be included on their parent account's invoice. Parent accounts get all charges from their sub-accounts.</p>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Storage Generation Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" />
              Storage Charge Billing
            </CardTitle>
            <CardDescription>
              Generate storage charges for a date range or specific date. Storage charges are calculated daily based on item rates.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Single Day Storage */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Single Day Generation</h4>
              <div className="flex items-end gap-4">
                <div className="space-y-1">
                  <label className="text-sm text-muted-foreground">Date</label>
                  <Input
                    type="date"
                    value={storageDate}
                    onChange={(e) => setStorageDate(e.target.value)}
                    className="w-[200px]"
                  />
                </div>
                <Button onClick={handleGenerateStorage} disabled={generatingStorage} variant="outline">
                  {generatingStorage ? "Generating..." : "Generate for Day"}
                </Button>
              </div>
            </div>

            {/* Period Storage Generation */}
            <div className="border-t pt-4 space-y-2">
              <h4 className="text-sm font-medium">Period Storage Generation</h4>
              <p className="text-xs text-muted-foreground">
                Generate storage charges for all days in a period. Useful for monthly storage billing.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                <div className="space-y-1">
                  <label className="text-sm text-muted-foreground">Period Start</label>
                  <Input
                    type="date"
                    value={storagePeriodStart}
                    onChange={(e) => setStoragePeriodStart(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm text-muted-foreground">Period End</label>
                  <Input
                    type="date"
                    value={storagePeriodEnd}
                    onChange={(e) => setStoragePeriodEnd(e.target.value)}
                  />
                </div>
                <Button
                  onClick={async () => {
                    setGenerateStorageForPeriod(true);
                    const startDate = new Date(storagePeriodStart);
                    const endDate = new Date(storagePeriodEnd);
                    const current = startDate;
                    let count = 0;
                    while (current <= endDate) {
                      await generateStorageForDate(current.toISOString().slice(0, 10));
                      count++;
                      current.setDate(current.getDate() + 1);
                    }
                    toast({ title: "Storage charges generated", description: `Generated storage for ${count} day(s).` });
                    setGenerateStorageForPeriod(false);
                  }}
                  disabled={generateStorageForPeriod}
                >
                  {generateStorageForPeriod ? "Generating..." : "Generate for Period"}
                </Button>
                <div className="text-sm text-muted-foreground">
                  {Math.ceil((new Date(storagePeriodEnd).getTime() - new Date(storagePeriodStart).getTime()) / (1000 * 60 * 60 * 24)) + 1} day(s)
                </div>
              </div>
            </div>

            {/* Quick Presets */}
            <div className="border-t pt-4 space-y-2">
              <h4 className="text-sm font-medium">Quick Presets</h4>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const d = new Date();
                    const firstDay = new Date(d.getFullYear(), d.getMonth() - 1, 1);
                    const lastDay = new Date(d.getFullYear(), d.getMonth(), 0);
                    setStoragePeriodStart(firstDay.toISOString().slice(0, 10));
                    setStoragePeriodEnd(lastDay.toISOString().slice(0, 10));
                  }}
                >
                  Last Month
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const d = new Date();
                    const firstDay = new Date(d.getFullYear(), d.getMonth(), 1);
                    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0);
                    setStoragePeriodStart(firstDay.toISOString().slice(0, 10));
                    setStoragePeriodEnd(lastDay.toISOString().slice(0, 10));
                  }}
                >
                  This Month
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const d = new Date();
                    const lastWeekStart = new Date(d);
                    lastWeekStart.setDate(d.getDate() - d.getDay() - 7);
                    const lastWeekEnd = new Date(lastWeekStart);
                    lastWeekEnd.setDate(lastWeekStart.getDate() + 6);
                    setStoragePeriodStart(lastWeekStart.toISOString().slice(0, 10));
                    setStoragePeriodEnd(lastWeekEnd.toISOString().slice(0, 10));
                  }}
                >
                  Last Week
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Create Invoice Draft */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Create Invoice Draft
            </CardTitle>
            <CardDescription>
              Create invoices from unbilled charges with flexible grouping options
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
              <div className="md:col-span-2 space-y-1">
                <label className="text-sm font-medium">Account</label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger>
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
              <div className="space-y-1">
                <label className="text-sm font-medium">Invoice Grouping</label>
                <Select value={invoiceGrouping} onValueChange={(v) => setInvoiceGrouping(v as InvoiceGrouping)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="by_sidemark">Separate by Sidemark</SelectItem>
                    <SelectItem value="by_account">One per Account</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Sidemark {invoiceGrouping === 'by_account' ? '(ignored)' : '(optional)'}</label>
                <Select
                  value={selectedSidemarkId || '__all__'}
                  onValueChange={(v) => setSelectedSidemarkId(v === '__all__' ? '' : v)}
                  disabled={!accountId || invoiceGrouping === 'by_account'}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All sidemarks" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">All sidemarks (create per sidemark)</SelectItem>
                    {sidemarks.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.sidemark_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Type</label>
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
              <div className="space-y-1">
                <label className="text-sm font-medium">Line Sorting</label>
                <Select value={lineSortOption} onValueChange={(v) => setLineSortOption(v as LineSortOption)}>
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
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">Period Start</label>
                <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Period End</label>
                <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="includeEarlier"
                  checked={includeEarlier}
                  onCheckedChange={(checked) => setIncludeEarlier(checked === true)}
                />
                <label htmlFor="includeEarlier" className="text-sm text-muted-foreground">
                  Include unbilled charges earlier than period (catch-up for suspense/unclaimed items)
                </label>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={createDraft} disabled={creating || !accountId}>
                <Plus className="h-4 w-4 mr-2" />
                {creating ? "Creating..." : "Create Draft"}
              </Button>
              {invoiceGrouping === 'by_sidemark' && !selectedSidemarkId && sidemarks.length > 0 && (
                <p className="text-sm text-muted-foreground self-center">
                  Will create separate invoices for {sidemarks.length} sidemark(s) + 1 for unassigned charges
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Batch Invoice Creation */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Batch Invoice Creation
            </CardTitle>
            <CardDescription>
              Create invoices for multiple accounts at once using the same period and settings
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Select Accounts</label>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-48 overflow-y-auto border rounded-md p-3">
                {accounts.map((a) => (
                  <div key={a.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`batch-${a.id}`}
                      checked={selectedAccountsForBatch.includes(a.id)}
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedAccountsForBatch(prev => [...prev, a.id]);
                        } else {
                          setSelectedAccountsForBatch(prev => prev.filter(id => id !== a.id));
                        }
                      }}
                    />
                    <label htmlFor={`batch-${a.id}`} className="text-sm cursor-pointer">
                      {a.account_code} - {a.account_name}
                    </label>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedAccountsForBatch(accounts.map(a => a.id))}
                >
                  Select All
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedAccountsForBatch([])}
                >
                  Clear All
                </Button>
              </div>
            </div>
            <Button
              onClick={createBatchInvoices}
              disabled={batchCreating || selectedAccountsForBatch.length === 0}
            >
              <Plus className="h-4 w-4 mr-2" />
              {batchCreating ? "Creating..." : `Create Invoices for ${selectedAccountsForBatch.length} Account(s)`}
            </Button>
          </CardContent>
        </Card>

        {/* Invoices Table */}
        <Card>
          <CardHeader className="flex-row items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Recent Invoices ({invoices.length})
              </CardTitle>
              {selectedInvoices.size > 0 && (
                <span className="text-sm text-muted-foreground">
                  {selectedInvoices.size} selected
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {/* Bulk action buttons */}
              {selectedInvoices.size > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleBulkSendEmails}
                    disabled={bulkSending}
                  >
                    <Mail className="h-4 w-4 mr-2" />
                    {bulkSending ? "Sending..." : `Email (${selectedInvoices.size})`}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleBulkDownloadExcel}
                    disabled={bulkDownloading}
                  >
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    {bulkDownloading ? "Exporting..." : "Export Excel"}
                  </Button>
                </>
              )}
              <Button variant="outline" size="sm" onClick={exportInvoicesCSV} disabled={!invoices.length}>
                <Download className="h-4 w-4 mr-2" />
                Export CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allInvoicesSelected}
                        onCheckedChange={toggleSelectAllInvoices}
                        className={someInvoicesSelected ? "data-[state=checked]:bg-primary/50" : ""}
                      />
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => toggleSort('invoice_number')}
                    >
                      <span className="flex items-center">Invoice # <SortIcon field="invoice_number" /></span>
                    </TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => toggleSort('status')}
                    >
                      <span className="flex items-center">Status <SortIcon field="status" /></span>
                    </TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                    <TableHead
                      className="text-right cursor-pointer select-none"
                      onClick={() => toggleSort('total')}
                    >
                      <span className="flex items-center justify-end">Total <SortIcon field="total" /></span>
                    </TableHead>
                    <TableHead
                      className="cursor-pointer select-none"
                      onClick={() => toggleSort('created_at')}
                    >
                      <span className="flex items-center">Created <SortIcon field="created_at" /></span>
                    </TableHead>
                    <TableHead>Sent</TableHead>
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedInvoices.map((inv) => {
                    const account = accounts.find(a => a.id === inv.account_id);
                    return (
                      <TableRow key={inv.id} className={selectedInvoices.has(inv.id) ? 'bg-blue-50' : ''}>
                        <TableCell>
                          <Checkbox
                            checked={selectedInvoices.has(inv.id)}
                            onCheckedChange={() => toggleInvoiceSelection(inv.id)}
                          />
                        </TableCell>
                        <TableCell className="font-semibold">{inv.invoice_number}</TableCell>
                        <TableCell>{account?.account_name || inv.account_id.slice(0, 8)}</TableCell>
                        <TableCell>{getTypeBadge(inv.invoice_type)}</TableCell>
                        <TableCell>{inv.period_start} to {inv.period_end}</TableCell>
                        <TableCell>{getStatusBadge(inv.status)}</TableCell>
                        <TableCell className="text-right">${Number(inv.subtotal || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right font-semibold">${Number(inv.total || 0).toFixed(2)}</TableCell>
                        <TableCell>{inv.created_at?.slice(0, 10)}</TableCell>
                        <TableCell>{inv.sent_at?.slice(0, 10) || "-"}</TableCell>
                        <TableCell>
                          <div className="flex justify-center gap-1">
                            <Button size="sm" variant="ghost" onClick={() => openLines(inv)}>
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleSendInvoice(inv)}
                              disabled={inv.status !== "draft"}
                            >
                              <Send className="h-4 w-4" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleVoidInvoice(inv.id)}
                              disabled={inv.status === "void"}
                            >
                              <XCircle className="h-4 w-4 text-red-500" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  {!invoices.length && (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                        No invoices yet
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Invoice Lines Dialog */}
        <Dialog open={linesDialogOpen} onOpenChange={setLinesDialogOpen}>
          <DialogContent className="w-[95vw] max-w-[95vw] sm:max-w-4xl max-h-[80vh] overflow-auto">
            <DialogHeader>
              <DialogTitle>Invoice Lines - {selectedInvoice?.invoice_number}</DialogTitle>
              <DialogDescription>
                {selectedInvoice?.period_start} to {selectedInvoice?.period_end}
              </DialogDescription>
            </DialogHeader>
            {loadingLines ? (
              <div className="p-8 text-center text-muted-foreground">Loading lines...</div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm text-muted-foreground">{sortedLines.length} line item(s)</span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm">Sort by:</span>
                    <Select value={lineSortOption} onValueChange={(v) => setLineSortOption(v as LineSortOption)}>
                      <SelectTrigger className="w-[150px] h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="date">Date</SelectItem>
                        <SelectItem value="service">Service Type</SelectItem>
                        <SelectItem value="item">Item</SelectItem>
                        <SelectItem value="amount">Amount</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="w-full overflow-x-auto">
                <Table className="min-w-[720px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Service</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Qty</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Rate</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Total</TableHead>
                      {selectedInvoice && selectedInvoice.status !== 'paid' && (
                        <TableHead className="w-10"></TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedLines.map((line) => {
                      const serviceLabel =
                        chargeNameMap.get((line as any).service_id) ||
                        (line as any).charge_type ||
                        (typeof line.description === 'string' ? line.description : '') ||
                        '\u2014';
                      const entityLabel =
                        (line as any).task_id ? `Task: ${shortId((line as any).task_id)}` :
                        line.item_id ? `Item: ${shortId(line.item_id)}` :
                        (line as any).shipment_id ? `Shipment: ${shortId((line as any).shipment_id)}` :
                        (typeof line.description === 'string' ? line.description : '\u2014');
                      return (
                      <TableRow key={line.id}>
                        <TableCell className="font-medium max-w-[240px] truncate">{serviceLabel}</TableCell>
                        <TableCell className="max-w-[220px] truncate">{entityLabel}</TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">{line.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums whitespace-nowrap">${Number(line.unit_rate || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums whitespace-nowrap">${Number(line.total_amount || 0).toFixed(2)}</TableCell>
                        {selectedInvoice && selectedInvoice.status !== 'paid' && (
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleRemoveInvoiceLine(line.id)}
                              disabled={removingLineId === line.id}
                              className="text-red-500 hover:text-red-700 h-7 w-7 p-0"
                              title="Remove line (returns to unbilled)"
                            >
                              {removingLineId === line.id ? (
                                <RefreshCw className="h-3 w-3 animate-spin" />
                              ) : (
                                <XCircle className="h-3 w-3" />
                              )}
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                      );
                    })}
                    {!sortedLines.length && (
                      <TableRow>
                        <TableCell colSpan={selectedInvoice && selectedInvoice.status !== 'paid' ? 6 : 5} className="text-center py-8 text-muted-foreground">
                          No lines found
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                </div>

                {/* Notes Section */}
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-medium">Notes</label>
                    {!editingNotes && selectedInvoice?.status === 'draft' && (
                      <Button variant="ghost" size="sm" onClick={() => setEditingNotes(true)}>
                        Edit
                      </Button>
                    )}
                  </div>
                  {editingNotes ? (
                    <div className="space-y-2">
                      <Textarea
                        value={notesValue}
                        onChange={(e) => setNotesValue(e.target.value)}
                        placeholder="Add notes for this invoice..."
                        rows={3}
                      />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={handleSaveNotes} disabled={savingNotes}>
                          <Save className="h-4 w-4 mr-1" />
                          {savingNotes ? "Saving..." : "Save"}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => { setEditingNotes(false); setNotesValue(selectedInvoice?.notes || ""); }}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground border rounded p-2 min-h-[60px]">
                      {selectedInvoice?.notes || "No notes"}
                    </p>
                  )}
                </div>
              </>
            )}

            {/* Activity Feed */}
            {selectedInvoice && (
              <div className="mt-4">
                <EntityActivityFeed
                  entityType="invoice"
                  entityId={selectedInvoice.id}
                  title="Activity"
                  description="Timeline of changes to this invoice"
                />
              </div>
            )}

            <DialogFooter className="flex flex-col sm:flex-row justify-between items-start sm:items-center pt-4 border-t gap-4">
              <div className="flex items-center gap-4">
                <div className="text-lg font-semibold tabular-nums whitespace-nowrap">
                  Total: ${sortedLines.reduce((s, l) => s + Number((l as any).total_amount || 0), 0).toFixed(2)}
                </div>
                {selectedInvoice && selectedInvoice.status !== 'paid' && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => selectedInvoice && handleDeleteInvoice(selectedInvoice.id)}
                  >
                    <XCircle className="h-4 w-4 mr-1" />
                    Delete Invoice
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={!sortedLines.length}>
                  <Download className="h-4 w-4 mr-2" />
                  Download PDF
                </Button>
                <Button variant="outline" size="sm" onClick={handlePrintPdf} disabled={!sortedLines.length}>
                  <Printer className="h-4 w-4 mr-2" />
                  Print
                </Button>
                <Button variant="outline" size="sm" onClick={exportLinesCSV} disabled={!sortedLines.length}>
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </Button>
                <Button variant="outline" onClick={() => setLinesDialogOpen(false)}>
                  Close
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>
          </TabsContent>

          {/* Template Tab */}
          <TabsContent value="template" className="mt-4">
            <InvoiceTemplateTab />
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
