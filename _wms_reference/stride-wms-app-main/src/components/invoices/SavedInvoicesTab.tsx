import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useInvoices, Invoice, InvoiceLine } from '@/hooks/useInvoices';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { downloadInvoicePdf, InvoicePdfData } from '@/lib/invoicePdf';
import { sendEmail, buildInvoiceSentEmail } from '@/lib/email';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { jsonToWorkbook, downloadWorkbook } from '@/lib/excelUtils';

interface Account {
  id: string;
  account_name: string;
  account_code: string;
  billing_contact_email: string | null;
}

interface TenantCompanySettings {
  company_name: string | null;
  company_address: string | null;
  company_phone: string | null;
  company_email: string | null;
  logo_url: string | null;
  brand_color?: string | null;
}

interface InvoiceWithDetails extends Invoice {
  // Explicit types for fields used in this component (overrides unknown from index signature)
  invoice_date?: string;
  due_date?: string | null;
  tax_amount?: number;
  accounts?: {
    account_name: string;
    account_code: string;
    billing_contact_email: string | null;
  };
}

type SortField = 'invoice_number' | 'created_at' | 'total' | 'status' | 'account';
type SortDir = 'asc' | 'desc';

export function SavedInvoicesTab() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { voidInvoice, markInvoiceSent, fetchInvoiceLines } = useInvoices();

  // Data state
  const [invoices, setInvoices] = useState<InvoiceWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tenantSettings, setTenantSettings] = useState<TenantCompanySettings | null>(null);

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [accountFilter, setAccountFilter] = useState('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Selection state
  const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(new Set());

  // Sorting state
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Dialog state
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceWithDetails | null>(null);
  const [invoiceLines, setInvoiceLines] = useState<InvoiceLine[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);

  // Bulk action state
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkDownloading, setBulkDownloading] = useState(false);

  // Load invoices
  const loadInvoices = useCallback(async () => {
    if (!profile?.tenant_id) return;
    setLoading(true);

    try {
      const { data, error } = await supabase
        .from('invoices')
        .select(`
          *,
          accounts!inner(account_name, account_code, billing_contact_email)
        `)
        .eq('tenant_id', profile.tenant_id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setInvoices(data || []);
    } catch (err) {
      console.error('Error loading invoices:', err);
      toast({ title: 'Error loading invoices', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, toast]);

  const loadAccounts = useCallback(async () => {
    if (!profile?.tenant_id) return;

    const { data } = await supabase
      .from('accounts')
      .select('id, account_name, account_code, billing_contact_email')
      .eq('tenant_id', profile.tenant_id)
      .eq('is_active', true)
      .is('deleted_at', null)
      .order('account_name');

    setAccounts(data || []);
  }, [profile?.tenant_id]);

  const loadTenantSettings = useCallback(async () => {
    if (!profile?.tenant_id) return;

    const [settingsRes, brandRes] = await Promise.all([
      supabase
        .from('tenant_company_settings')
        .select('company_name, company_address, company_phone, company_email, logo_url')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle(),
      supabase
        .from('communication_brand_settings')
        .select('brand_primary_color')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle(),
    ]);

    setTenantSettings({
      ...settingsRes.data,
      brand_color: brandRes.data?.brand_primary_color || null,
    } as TenantCompanySettings);
  }, [profile?.tenant_id]);

  useEffect(() => {
    loadInvoices();
    loadAccounts();
    loadTenantSettings();
  }, [loadInvoices, loadAccounts, loadTenantSettings]);

  // Universal search - searches across ALL fields
  const searchFilteredInvoices = useMemo(() => {
    if (!searchQuery.trim()) return invoices;

    const query = searchQuery.toLowerCase().trim();

    return invoices.filter(invoice => {
      const searchableValues = [
        invoice.invoice_number,
        invoice.accounts?.account_name,
        invoice.accounts?.account_code,
        invoice.invoice_date,
        invoice.due_date,
        invoice.period_start,
        invoice.period_end,
        invoice.status,
        invoice.subtotal?.toString(),
        invoice.total_amount?.toString(),
        invoice.notes,
      ];

      return searchableValues.some(field =>
        typeof field === 'string' && field.toLowerCase().includes(query)
      );
    });
  }, [invoices, searchQuery]);

  // Apply additional filters
  const filteredInvoices = useMemo(() => {
    return searchFilteredInvoices.filter(inv => {
      // Status filter
      if (statusFilter !== 'all' && inv.status !== statusFilter) return false;

      // Account filter
      if (accountFilter !== 'all' && inv.account_id !== accountFilter) return false;

      // Date range filter
      if (startDate && inv.invoice_date && inv.invoice_date < startDate) return false;
      if (endDate && inv.invoice_date && inv.invoice_date > endDate) return false;

      return true;
    });
  }, [searchFilteredInvoices, statusFilter, accountFilter, startDate, endDate]);

  // Sort invoices
  const sortedInvoices = useMemo(() => {
    return [...filteredInvoices].sort((a, b) => {
      let aVal: string | number = '';
      let bVal: string | number = '';

      switch (sortField) {
        case 'invoice_number':
          aVal = a.invoice_number || '';
          bVal = b.invoice_number || '';
          break;
        case 'created_at':
          aVal = new Date(a.created_at || 0).getTime();
          bVal = new Date(b.created_at || 0).getTime();
          break;
        case 'total':
          aVal = Number(a.total_amount || 0);
          bVal = Number(b.total_amount || 0);
          break;
        case 'status':
          aVal = a.status || '';
          bVal = b.status || '';
          break;
        case 'account':
          aVal = a.accounts?.account_name || '';
          bVal = b.accounts?.account_name || '';
          break;
      }

      if (typeof aVal === 'string') {
        aVal = aVal.toLowerCase();
        bVal = (bVal as string).toLowerCase();
      }

      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredInvoices, sortField, sortDir]);

  // Summary calculations
  const summary = useMemo(() => {
    const draft = filteredInvoices.filter(i => i.status === 'draft');
    const sent = filteredInvoices.filter(i => i.status === 'sent');
    const paid = filteredInvoices.filter(i => i.status === 'paid');

    return {
      draft: { count: draft.length, total: draft.reduce((s, i) => s + Number(i.total_amount || 0), 0) },
      sent: { count: sent.length, total: sent.reduce((s, i) => s + Number(i.total_amount || 0), 0) },
      paid: { count: paid.length, total: paid.reduce((s, i) => s + Number(i.total_amount || 0), 0) },
      total: {
        count: filteredInvoices.filter(i => i.status !== 'void').length,
        total: filteredInvoices.filter(i => i.status !== 'void').reduce((s, i) => s + Number(i.total_amount || 0), 0)
      },
    };
  }, [filteredInvoices]);

  // Clear all filters
  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setAccountFilter('all');
    setStartDate('');
    setEndDate('');
  };

  // Selection handlers
  const toggleInvoiceSelection = (id: string) => {
    setSelectedInvoices(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedInvoices.size === sortedInvoices.length) {
      setSelectedInvoices(new Set());
    } else {
      setSelectedInvoices(new Set(sortedInvoices.map(i => i.id)));
    }
  };

  const allSelected = sortedInvoices.length > 0 && selectedInvoices.size === sortedInvoices.length;
  const someSelected = selectedInvoices.size > 0 && !allSelected;

  // Sort handlers
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return <MaterialIcon name="unfold_more" size="sm" className="ml-1 opacity-30" />;
    }
    return sortDir === 'asc'
      ? <MaterialIcon name="arrow_upward" size="sm" className="ml-1" />
      : <MaterialIcon name="arrow_downward" size="sm" className="ml-1" />;
  };

  // Action handlers
  const handleViewInvoice = async (invoice: InvoiceWithDetails) => {
    setSelectedInvoice(invoice);
    setDetailDialogOpen(true);
    setLoadingLines(true);

    const lines = await fetchInvoiceLines(invoice.id);
    setInvoiceLines(lines);
    setLoadingLines(false);
  };

  const handleSendInvoice = async (invoice: InvoiceWithDetails) => {
    const account = accounts.find(a => a.id === invoice.account_id);
    if (!account?.billing_contact_email) {
      toast({ title: 'No email address', description: 'This account has no billing contact email.', variant: 'destructive' });
      return;
    }

    const lines = await fetchInvoiceLines(invoice.id);
    if (lines.length === 0) {
      toast({ title: 'No line items', description: 'This invoice has no line items.', variant: 'destructive' });
      return;
    }

    // Mark as sent
    const success = await markInvoiceSent(invoice.id);
    if (success) {
      // Send email notification
      const emailData = buildInvoiceSentEmail({
        invoiceNumber: invoice.invoice_number,
        accountName: account.account_name,
        periodStart: invoice.period_start || '',
        periodEnd: invoice.period_end || '',
        total: Number(invoice.total_amount || 0),
        lineCount: lines.length,
      });

      await sendEmail(account.billing_contact_email, emailData.subject, emailData.html, profile?.tenant_id);
      toast({ title: 'Invoice sent', description: `Invoice ${invoice.invoice_number} sent to ${account.billing_contact_email}` });
      loadInvoices();
    }
  };

  const handleDownloadPdf = async (invoice: InvoiceWithDetails) => {
    const lines = await fetchInvoiceLines(invoice.id);
    const account = accounts.find(a => a.id === invoice.account_id);

    if (!account || lines.length === 0) {
      toast({ title: 'Cannot generate PDF', description: 'Missing invoice data.', variant: 'destructive' });
      return;
    }

    const pdfData: InvoicePdfData = {
      invoiceNumber: invoice.invoice_number,
      invoiceDate: invoice.invoice_date || '',
      dueDate: invoice.due_date || '',
      periodStart: invoice.period_start || '',
      periodEnd: invoice.period_end || '',
      invoiceType: (invoice.invoice_type as string) || 'manual',
      accountName: account.account_name,
      accountCode: account.account_code,
      billingAddress: '',
      companyName: tenantSettings?.company_name || 'Stride WMS',
      companyAddress: tenantSettings?.company_address || '',
      companyPhone: tenantSettings?.company_phone || '',
      companyEmail: tenantSettings?.company_email || '',
      companyLogo: tenantSettings?.logo_url || undefined,
      brandColor: tenantSettings?.brand_color || undefined,
      lines: lines.map(l => ({
        date: (l.occurred_at as string)?.slice(0, 10) || '',
        description: (l.description as string) || (l.charge_type as string) || '',
        sidemark: (l.sidemark_name as string) || '',
        quantity: l.quantity,
        unitRate: l.unit_rate,
        lineTotal: l.total_amount,
        rate: l.unit_rate,
        total: l.total_amount,
      })),
      subtotal: Number(invoice.subtotal || 0),
      taxAmount: Number(invoice.tax_amount || 0),
      total: Number(invoice.total_amount || 0),
      notes: invoice.notes || '',
    };

    await downloadInvoicePdf(pdfData);
  };

  const handleVoidInvoice = async (invoice: InvoiceWithDetails) => {
    const success = await voidInvoice(invoice.id);
    if (success) {
      loadInvoices();
    }
  };

  // Bulk actions
  const handleBulkSend = async () => {
    const draftInvoices = sortedInvoices.filter(i =>
      selectedInvoices.has(i.id) && i.status === 'draft'
    );

    if (draftInvoices.length === 0) {
      toast({ title: 'No draft invoices', description: 'Only draft invoices can be sent.', variant: 'destructive' });
      return;
    }

    setBulkSending(true);
    let successCount = 0;

    for (const invoice of draftInvoices) {
      try {
        const account = accounts.find(a => a.id === invoice.account_id);
        if (!account?.billing_contact_email) continue;

        const lines = await fetchInvoiceLines(invoice.id);
        if (lines.length === 0) continue;

        const success = await markInvoiceSent(invoice.id);
        if (success) {
          const emailData = buildInvoiceSentEmail({
            invoiceNumber: invoice.invoice_number,
            accountName: account.account_name,
            periodStart: invoice.period_start || '',
            periodEnd: invoice.period_end || '',
            total: Number(invoice.total_amount || 0),
            lineCount: lines.length,
          });

          await sendEmail(account.billing_contact_email, emailData.subject, emailData.html, profile?.tenant_id);
          successCount++;
        }
      } catch (err) {
        console.error('Error sending invoice:', err);
      }
    }

    toast({ title: 'Invoices sent', description: `${successCount} invoice(s) sent successfully.` });
    setSelectedInvoices(new Set());
    loadInvoices();
    setBulkSending(false);
  };

  const handleBulkDownloadExcel = async () => {
    const selectedList = sortedInvoices.filter(i => selectedInvoices.has(i.id));
    if (selectedList.length === 0) return;

    setBulkDownloading(true);

    const rows = selectedList.map(inv => ({
      'Invoice #': inv.invoice_number,
      'Account': inv.accounts?.account_name || '',
      'Account Code': inv.accounts?.account_code || '',
      'Date': inv.invoice_date || '',
      'Due Date': inv.due_date || '',
      'Period Start': inv.period_start || '',
      'Period End': inv.period_end || '',
      'Status': inv.status || '',
      'Subtotal': Number(inv.subtotal || 0).toFixed(2),
      'Tax': Number(inv.tax_amount || 0).toFixed(2),
      'Total': Number(inv.total_amount || 0).toFixed(2),
    }));

    const { workbook } = jsonToWorkbook(rows, 'Invoices');
    await downloadWorkbook(workbook, `invoices-export-${new Date().toISOString().slice(0, 10)}.xlsx`);

    setBulkDownloading(false);
  };

  const getStatusBadge = (status: string) => (
    <StatusIndicator status={status} size="sm" />
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Saved Invoices</h2>
          <p className="text-muted-foreground text-sm">View and manage all invoices</p>
        </div>
        <Button variant="outline" onClick={loadInvoices} disabled={loading}>
          <MaterialIcon name="refresh" size="sm" className={`mr-2 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Loading..." : "Refresh"}
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Draft</div>
            <div className="text-2xl font-bold text-blue-600">{summary.draft.count}</div>
            <div className="text-sm text-muted-foreground tabular-nums whitespace-nowrap">${summary.draft.total.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Sent</div>
            <div className="text-2xl font-bold text-green-600">{summary.sent.count}</div>
            <div className="text-sm text-muted-foreground tabular-nums whitespace-nowrap">${summary.sent.total.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Paid</div>
            <div className="text-2xl font-bold text-emerald-600">{summary.paid.count}</div>
            <div className="text-sm text-muted-foreground tabular-nums whitespace-nowrap">${summary.paid.total.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-sm text-muted-foreground">Total Active</div>
            <div className="text-2xl font-bold">{summary.total.count}</div>
            <div className="text-sm text-muted-foreground tabular-nums whitespace-nowrap">${summary.total.total.toFixed(2)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <MaterialIcon name="filter_list" size="sm" />
            Filters
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-2 space-y-1">
              <label className="text-sm font-medium">Search</label>
              <div className="relative">
                <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by invoice #, account, date..."
                  className="pl-9"
                />
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Status</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="sent">Sent</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="void">Void</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Account</label>
              <Select value={accountFilter} onValueChange={setAccountFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Accounts</SelectItem>
                  {accounts.map(a => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.account_code} - {a.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Date Range</label>
              <div className="flex gap-2">
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="flex-1"
                />
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="flex-1"
                />
              </div>
            </div>
          </div>
          <div className="mt-4 flex justify-between items-center">
            <div className="text-sm text-muted-foreground">
              {sortedInvoices.length} invoice(s) found
              {selectedInvoices.size > 0 && ` · ${selectedInvoices.size} selected`}
            </div>
            <div className="flex gap-2">
              {(searchQuery || statusFilter !== 'all' || accountFilter !== 'all' || startDate || endDate) && (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear Filters
                </Button>
              )}
              {selectedInvoices.size > 0 && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleBulkSend}
                    disabled={bulkSending}
                  >
                    <MaterialIcon name="mail" size="sm" className="mr-2" />
                    {bulkSending ? "Sending..." : `Send (${selectedInvoices.size})`}
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
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Invoices Table */}
      <Card>
        <CardContent className="pt-6">
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleSelectAll}
                      className={someSelected ? "data-[state=checked]:bg-primary/50" : ""}
                    />
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => handleSort('invoice_number')}
                  >
                    <span className="flex items-center">Invoice # <SortIcon field="invoice_number" /></span>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => handleSort('account')}
                  >
                    <span className="flex items-center">Account <SortIcon field="account" /></span>
                  </TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => handleSort('created_at')}
                  >
                    <span className="flex items-center">Date <SortIcon field="created_at" /></span>
                  </TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead
                    className="cursor-pointer select-none"
                    onClick={() => handleSort('status')}
                  >
                    <span className="flex items-center">Status <SortIcon field="status" /></span>
                  </TableHead>
                  <TableHead
                    className="text-right cursor-pointer select-none"
                    onClick={() => handleSort('total')}
                  >
                    <span className="flex items-center justify-end">Total <SortIcon field="total" /></span>
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedInvoices.map(invoice => (
                  <TableRow key={invoice.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedInvoices.has(invoice.id)}
                        onCheckedChange={() => toggleInvoiceSelection(invoice.id)}
                      />
                    </TableCell>
                    <TableCell className="font-mono">{invoice.invoice_number}</TableCell>
                    <TableCell>
                      <div>{invoice.accounts?.account_name}</div>
                      <div className="text-xs text-muted-foreground">{invoice.accounts?.account_code}</div>
                    </TableCell>
                    <TableCell>{invoice.invoice_date?.slice(0, 10)}</TableCell>
                    <TableCell>
                      {invoice.period_start && invoice.period_end && (
                        <span className="text-sm">
                          {invoice.period_start.slice(5)} - {invoice.period_end.slice(5)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{getStatusBadge(invoice.status || 'draft')}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums whitespace-nowrap">
                      ${Number(invoice.total_amount || 0).toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => handleViewInvoice(invoice)} title="View">
                          <MaterialIcon name="visibility" size="sm" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDownloadPdf(invoice)} title="Download PDF">
                          <MaterialIcon name="download" size="sm" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleSendInvoice(invoice)}
                          disabled={invoice.status !== 'draft'}
                          title="Send"
                        >
                          <MaterialIcon name="send" size="sm" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleVoidInvoice(invoice)}
                          disabled={invoice.status === 'void' || invoice.status === 'paid'}
                          title="Void"
                        >
                          <MaterialIcon name="cancel" size="sm" className="text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {sortedInvoices.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      {invoices.length === 0 ? 'No invoices found' : `No results match "${searchQuery}"`}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Invoice Detail Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="description" size="md" />
              Invoice {selectedInvoice?.invoice_number}
            </DialogTitle>
            <DialogDescription>
              {selectedInvoice?.accounts?.account_name} · {getStatusBadge(selectedInvoice?.status || 'draft')}
            </DialogDescription>
          </DialogHeader>

          {loadingLines ? (
            <div className="py-8 text-center">Loading line items...</div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div>
                  <div className="text-muted-foreground">Invoice Date</div>
                  <div className="font-medium">{selectedInvoice?.invoice_date || '-'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Due Date</div>
                  <div className="font-medium">{selectedInvoice?.due_date ?? '-'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground">Period</div>
                  <div className="font-medium">
                    {selectedInvoice?.period_start} to {selectedInvoice?.period_end}
                  </div>
                </div>
                <div>
                  <div className="text-muted-foreground">Total</div>
                  <div className="font-medium text-lg tabular-nums">${Number(selectedInvoice?.total_amount || 0).toFixed(2)}</div>
                </div>
              </div>

              <div className="border rounded-lg overflow-auto max-w-full">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="whitespace-nowrap">Date</TableHead>
                      <TableHead className="min-w-[200px]">Description</TableHead>
                      <TableHead className="whitespace-nowrap">Sidemark</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Qty</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Rate</TableHead>
                      <TableHead className="text-right whitespace-nowrap">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invoiceLines.map(line => (
                      <TableRow key={line.id}>
                        <TableCell className="whitespace-nowrap">{(line.occurred_at as string)?.slice(0, 10) || '-'}</TableCell>
                        <TableCell className="max-w-[300px] break-words">{(line.description as string) || (line.charge_type as string) || '-'}</TableCell>
                        <TableCell>{(line.sidemark_name as string) || '-'}</TableCell>
                        <TableCell className="text-right tabular-nums">{line.quantity}</TableCell>
                        <TableCell className="text-right tabular-nums">${Number(line.unit_rate || 0).toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">${Number(line.total_amount || 0).toFixed(2)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {selectedInvoice?.notes && (
                <div>
                  <div className="text-sm text-muted-foreground mb-1">Notes</div>
                  <div className="text-sm p-3 bg-muted rounded-lg">{selectedInvoice.notes}</div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailDialogOpen(false)}>
              Close
            </Button>
            {selectedInvoice && (
              <>
                <Button variant="outline" onClick={() => handleDownloadPdf(selectedInvoice)}>
                  <MaterialIcon name="download" size="sm" className="mr-2" />
                  Download PDF
                </Button>
                {selectedInvoice.status === 'draft' && (
                  <Button onClick={() => {
                    handleSendInvoice(selectedInvoice);
                    setDetailDialogOpen(false);
                  }}>
                    <MaterialIcon name="send" size="sm" className="mr-2" />
                    Send Invoice
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
