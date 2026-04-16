import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useInvoices, Invoice, InvoiceLine, InvoiceType, InvoiceGrouping } from "@/hooks/useInvoices";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import ExcelJS from 'exceljs';
import { addJsonSheet, setColumnWidths, downloadWorkbook } from '@/lib/excelUtils';
import { useAuth } from "@/contexts/AuthContext";
import { sendEmail, buildInvoiceSentEmail } from "@/lib/email";
import { queueInvoiceSentAlert } from "@/lib/alertQueue";
import { downloadInvoicePdf, printInvoicePdf, InvoicePdfData } from "@/lib/invoicePdf";
import { StatusIndicator } from '@/components/ui/StatusIndicator';

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
type LineSortOption = 'date' | 'service' | 'item' | 'amount';

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

export function RevenueLedgerTab() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const { createInvoiceDraft, markInvoiceSent, voidInvoice, fetchInvoices, fetchInvoiceLines, updateInvoiceNotes, createInvoicesFromEvents } = useInvoices();

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

  // Notes editing
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);

  // Invoice generation options
  const [invoiceGrouping, setInvoiceGrouping] = useState<InvoiceGrouping>('by_sidemark');
  const [lineSortOption, setLineSortOption] = useState<LineSortOption>('date');

  // Billing report flow - selected events from billing report
  const [fromBillingReport, setFromBillingReport] = useState(false);
  const [selectedBillingEvents, setSelectedBillingEvents] = useState<SelectedBillingEvent[]>([]);
  const [billingReportGrouping, setBillingReportGrouping] = useState<InvoiceGrouping>('by_account');
  const [billingReportInvoiceType, setBillingReportInvoiceType] = useState<InvoiceType>('manual');
  const [creatingFromReport, setCreatingFromReport] = useState(false);

  // Grouping checkboxes for billing report flow
  const [groupByAccount, setGroupByAccount] = useState(true);
  const [groupBySidemark, setGroupBySidemark] = useState(false);
  const [groupByServiceType, setGroupByServiceType] = useState(false);

  // Sort direction for invoice lines
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Tenant company settings for PDF
  const [tenantSettings, setTenantSettings] = useState<TenantCompanySettings | null>(null);

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

    // Convert checkbox states to grouping value
    let grouping: InvoiceGrouping = 'single';
    if (groupByAccount && groupBySidemark) {
      grouping = 'by_account_sidemark';
    } else if (groupByAccount && !groupBySidemark) {
      grouping = 'by_account';
    } else if (!groupByAccount && groupBySidemark) {
      grouping = 'by_sidemark';
    }
    // When no checkboxes are selected, 'single' creates one invoice for all events

    setCreatingFromReport(true);
    const result = await createInvoicesFromEvents({
      billingEventIds: selectedBillingEvents.map(e => e.id),
      grouping,
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
        if (lines.length === 0) continue;

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
        case 'service':
          return (String(a.service_code) || '').localeCompare(String(b.service_code) || '');
        case 'item':
          return (String(a.item_id) || '').localeCompare(String(b.item_id) || '');
        case 'amount':
          return (Number(b.total_amount) || 0) - (Number(a.total_amount) || 0);
        case 'date':
        default:
          return 0; // Keep original order (by created_at)
      }
    });
  }, [lines, lineSortOption]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <MaterialIcon name="swap_vert" style={{ fontSize: '12px' }} className="ml-1 opacity-50" />;
    return sortDir === 'asc' ? <MaterialIcon name="expand_less" style={{ fontSize: '12px' }} className="ml-1" /> : <MaterialIcon name="expand_more" style={{ fontSize: '12px' }} className="ml-1" />;
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

  const openLines = async (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setNotesValue(invoice.notes || "");
    setEditingNotes(false);
    setLinesDialogOpen(true);
    setLoadingLines(true);
    const data = await fetchInvoiceLines(invoice.id);
    setLines(data);
    setLoadingLines(false);
  };

  // Generate PDF data for an invoice
  const buildPdfData = (invoice: Invoice, invoiceLines: InvoiceLine[]): InvoicePdfData | null => {
    const account = accounts.find(a => a.id === invoice.account_id);
    if (!account) return null;

    // Calculate due date based on net terms
    const invoiceDate = invoice.created_at?.slice(0, 10) || new Date().toISOString().slice(0, 10);
    const netTerms = account.billing_net_terms || 30;
    const dueDate = new Date(invoiceDate);
    dueDate.setDate(dueDate.getDate() + netTerms);

    return {
      invoiceNumber: invoice.invoice_number,
      invoiceDate: invoiceDate,
      dueDate: dueDate.toISOString().slice(0, 10),
      periodStart: invoice.period_start || '',
      periodEnd: invoice.period_end || '',
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Invoice Builder</h2>
          <p className="text-muted-foreground text-sm">Build and manage invoice drafts from billing events</p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          <MaterialIcon name="refresh" size="sm" className={`mr-2 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Loading..." : "Refresh"}
        </Button>
      </div>

      {/* Create from Billing Report Card - appears when coming from billing report */}
      {fromBillingReport && selectedBillingEvents.length > 0 && (
        <Card className="border-blue-200 bg-blue-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-blue-700">
              <MaterialIcon name="description" size="md" />
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Grouping Options */}
              <div className="space-y-3">
                <label className="text-sm font-medium">Grouping Options</label>
                <div className="space-y-2 p-4 border rounded-lg bg-white">
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="groupByAccount"
                      checked={groupByAccount}
                      onCheckedChange={(checked) => setGroupByAccount(!!checked)}
                    />
                    <label htmlFor="groupByAccount" className="text-sm font-normal cursor-pointer">
                      By Account <span className="text-muted-foreground">(one invoice per account)</span>
                    </label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="groupBySidemark"
                      checked={groupBySidemark}
                      onCheckedChange={(checked) => setGroupBySidemark(!!checked)}
                    />
                    <label htmlFor="groupBySidemark" className="text-sm font-normal cursor-pointer">
                      By Sidemark <span className="text-muted-foreground">(separate invoice per sidemark)</span>
                    </label>
                  </div>
                  <div className="flex items-center space-x-2 opacity-50">
                    <Checkbox
                      id="groupByServiceType"
                      checked={false}
                      disabled
                    />
                    <label htmlFor="groupByServiceType" className="text-sm font-normal">
                      By Service Type <span className="text-muted-foreground">(coming soon)</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Invoice Type and Line Sorting */}
              <div className="space-y-4">
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
                <div className="grid grid-cols-2 gap-4">
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
                        <SelectItem value="amount">By Amount</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Sort Direction</label>
                    <Select value={sortDirection} onValueChange={(v) => setSortDirection(v as 'asc' | 'desc')}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="asc">Ascending</SelectItem>
                        <SelectItem value="desc">Descending</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-2 pt-2">
              <Button
                onClick={handleCreateFromBillingReport}
                disabled={creatingFromReport}
              >
                <MaterialIcon name="add" size="sm" className="mr-2" />
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

            {/* Grouping explanation */}
            <div className="text-sm text-muted-foreground bg-white p-3 rounded-lg border">
              {!groupByAccount && !groupBySidemark && (
                <p>One single invoice will be created with all selected billing events.</p>
              )}
              {groupByAccount && !groupBySidemark && (
                <p>One invoice will be created for each unique account in the selection.</p>
              )}
              {groupByAccount && groupBySidemark && (
                <p>Separate invoices will be created for each unique account + sidemark combination.</p>
              )}
              {!groupByAccount && groupBySidemark && (
                <p>One invoice will be created for each unique sidemark (regardless of account).</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create Invoice Draft */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="add" size="md" />
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
              <MaterialIcon name="add" size="sm" className="mr-2" />
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

      {/* Invoices Table */}
      <Card>
        <CardHeader className="flex-row items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="description" size="md" />
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
                  <MaterialIcon name="mail" size="sm" className="mr-2" />
                  {bulkSending ? "Sending..." : `Email (${selectedInvoices.size})`}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleBulkDownloadExcel}
                  disabled={bulkDownloading}
                >
                  <MaterialIcon name="table_chart" size="sm" className="mr-2" />
                  {bulkDownloading ? "Exporting..." : "Export Excel"}
                </Button>
              </>
            )}
            <Button variant="outline" size="sm" onClick={exportInvoicesCSV} disabled={!invoices.length}>
              <MaterialIcon name="download" size="sm" className="mr-2" />
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
                            <MaterialIcon name="visibility" size="sm" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleSendInvoice(inv)}
                            disabled={inv.status !== "draft"}
                          >
                            <MaterialIcon name="send" size="sm" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleVoidInvoice(inv.id)}
                            disabled={inv.status === "void"}
                          >
                            <MaterialIcon name="cancel" size="sm" className="text-red-500" />
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
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-auto">
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
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Service</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedLines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="font-medium">{String(line.service_code)}</TableCell>
                      <TableCell>{line.description || "-"}</TableCell>
                      <TableCell className="text-right">{line.quantity}</TableCell>
                      <TableCell className="text-right">${Number(line.unit_rate || 0).toFixed(2)}</TableCell>
                      <TableCell className="text-right font-semibold">${Number(line.total_amount || 0).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                  {!sortedLines.length && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        No lines found
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>

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
                        <MaterialIcon name="save" size="sm" className="mr-1" />
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
          <DialogFooter className="flex flex-col sm:flex-row justify-between items-start sm:items-center pt-4 border-t gap-4">
            <div className="text-lg font-semibold">
              Total: ${Number(selectedInvoice?.total || 0).toFixed(2)}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={handleDownloadPdf} disabled={!sortedLines.length}>
                <MaterialIcon name="download" size="sm" className="mr-2" />
                Download PDF
              </Button>
              <Button variant="outline" size="sm" onClick={handlePrintPdf} disabled={!sortedLines.length}>
                <MaterialIcon name="print" size="sm" className="mr-2" />
                Print
              </Button>
              <Button variant="outline" size="sm" onClick={exportLinesCSV} disabled={!sortedLines.length}>
                <MaterialIcon name="download" size="sm" className="mr-2" />
                Export CSV
              </Button>
              <Button variant="outline" onClick={() => setLinesDialogOpen(false)}>
                Close
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
