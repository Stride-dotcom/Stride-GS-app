import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useInvoices, useBillableCharges, BillableCharge, Invoice } from '@/hooks/useBilling';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { jsPDF } from 'jspdf';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface Account {
  id: string;
  account_name: string;
  account_code: string;
  parent_account_id: string | null;
}

const CHARGE_TYPE_OPTIONS = [
  { value: 'tasks', label: 'Task Charges (Receiving, Shipping, Assembly, etc.)' },
  { value: 'custom', label: 'Custom Billing Charges' },
];

export function InvoicesTab() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { invoices, loading: invoicesLoading, createInvoice, updateInvoiceStatus, refetch: refetchInvoices } = useInvoices();

  // Filters and state
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [includeSubAccounts, setIncludeSubAccounts] = useState(true);
  const [dateRange, setDateRange] = useState({
    start: startOfMonth(new Date()),
    end: endOfMonth(new Date()),
  });
  const [chargeTypes, setChargeTypes] = useState<string[]>(['tasks', 'custom']);
  const [searchQuery, setSearchQuery] = useState('');

  // Create invoice dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedCharges, setSelectedCharges] = useState<Set<string>>(new Set());
  const [creatingInvoice, setCreatingInvoice] = useState(false);

  // View invoice dialog
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [invoiceLineItems, setInvoiceLineItems] = useState<any[]>([]);

  // Billable charges
  const {
    charges,
    loading: chargesLoading,
    refetch: refetchCharges,
  } = useBillableCharges(
    selectedAccountIds,
    format(dateRange.start, 'yyyy-MM-dd'),
    format(dateRange.end, 'yyyy-MM-dd'),
    chargeTypes
  );

  useEffect(() => {
    fetchAccounts();
  }, [profile?.tenant_id]);

  const fetchAccounts = async () => {
    if (!profile?.tenant_id) return;

    const { data, error } = await supabase
      .from('accounts')
      .select('id, account_name, account_code, parent_account_id')
      .eq('tenant_id', profile.tenant_id)
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('account_name');

    if (!error) {
      setAccounts(data || []);
    }
  };

  const handleAccountSelect = (accountId: string, checked: boolean) => {
    const newSelected = new Set(selectedAccountIds);

    if (checked) {
      newSelected.add(accountId);
      if (includeSubAccounts) {
        accounts
          .filter(a => a.parent_account_id === accountId)
          .forEach(a => newSelected.add(a.id));
      }
    } else {
      newSelected.delete(accountId);
    }

    setSelectedAccountIds(Array.from(newSelected));
  };

  const handleChargeTypeToggle = (chargeType: string) => {
    setChargeTypes(prev =>
      prev.includes(chargeType)
        ? prev.filter(t => t !== chargeType)
        : [...prev, chargeType]
    );
  };

  const toggleChargeSelection = (chargeId: string) => {
    const newSelected = new Set(selectedCharges);
    if (newSelected.has(chargeId)) {
      newSelected.delete(chargeId);
    } else {
      newSelected.add(chargeId);
    }
    setSelectedCharges(newSelected);
  };

  const selectAllCharges = () => {
    if (selectedCharges.size === filteredCharges.length) {
      setSelectedCharges(new Set());
    } else {
      setSelectedCharges(new Set(filteredCharges.map(c => c.id)));
    }
  };

  const handleCreateInvoice = async () => {
    if (selectedCharges.size === 0 || selectedAccountIds.length === 0) return;

    setCreatingInvoice(true);
    try {
      const chargesByAccount = new Map<string, BillableCharge[]>();

      for (const chargeId of selectedCharges) {
        const charge = charges.find(c => c.id === chargeId);
        if (charge) {
          const existing = chargesByAccount.get(charge.account_id) || [];
          existing.push(charge);
          chargesByAccount.set(charge.account_id, existing);
        }
      }

      for (const [accountId, accountCharges] of chargesByAccount) {
        // Sort by service type then by date
        const sortedCharges = accountCharges.sort((a, b) => {
          const typeCompare = (a.service_type || '').localeCompare(b.service_type || '');
          if (typeCompare !== 0) return typeCompare;
          return new Date(a.service_date).getTime() - new Date(b.service_date).getTime();
        });

        const lineItems = sortedCharges.map(charge => ({
          description: charge.description,
          line_item_type: charge.charge_type,
          service_type: charge.service_type,
          service_date: charge.service_date,
          quantity: charge.quantity,
          unit_price: charge.unit_price,
          line_total: charge.total,
          item_id: charge.item_id || null,
          item_code: charge.item_code || null,
          task_id: charge.task_id || null,
          account_code: null,
        }));

        await createInvoice(
          accountId,
          format(dateRange.start, 'yyyy-MM-dd'),
          format(dateRange.end, 'yyyy-MM-dd'),
          lineItems
        );

        const customChargeIds = accountCharges
          .filter(c => c.charge_type === 'custom')
          .map(c => c.id.replace('custom-', ''));

        if (customChargeIds.length > 0) {
          await supabase
            .from('custom_billing_charges')
            .update({ invoiced_at: new Date().toISOString() })
            .in('id', customChargeIds);
        }
      }

      toast({
        title: 'Invoice(s) Created',
        description: `Created ${chargesByAccount.size} invoice(s) successfully.`,
      });

      setCreateDialogOpen(false);
      setSelectedCharges(new Set());
      refetchCharges();
      refetchInvoices();
    } catch (error) {
      console.error('Error creating invoice:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to create invoice(s).',
      });
    } finally {
      setCreatingInvoice(false);
    }
  };

  const handleViewInvoice = async (invoice: Invoice) => {
    setSelectedInvoice(invoice);

    const { data } = await supabase
      .from('invoice_line_items')
      .select('*')
      .eq('invoice_id', invoice.id)
      .order('sort_order');

    setInvoiceLineItems(data || []);
    setViewDialogOpen(true);
  };

  const handleDownloadPDF = async (invoice: Invoice) => {
    const { data: lineItems } = await supabase
      .from('invoice_line_items')
      .select('*')
      .eq('invoice_id', invoice.id)
      .order('service_type')
      .order('service_date');

    const { data: account } = await supabase
      .from('accounts')
      .select('account_name, billing_address, billing_city, billing_state, billing_postal_code')
      .eq('id', invoice.account_id)
      .single();

    const { data: tenantSettings } = await supabase
      .from('tenant_company_settings')
      .select('company_name, logo_url')
      .eq('tenant_id', profile?.tenant_id)
      .maybeSingle();

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    
    // Header
    doc.setFontSize(24);
    doc.setTextColor(253, 90, 42); // Stride orange
    doc.text(tenantSettings?.company_name || 'Invoice', 20, 30);
    
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text(`Invoice #: ${invoice.invoice_number}`, pageWidth - 20, 30, { align: 'right' });
    doc.text(`Date: ${format(new Date(invoice.invoice_date), 'MMM d, yyyy')}`, pageWidth - 20, 38, { align: 'right' });
    if (invoice.due_date) {
      doc.text(`Due: ${format(new Date(invoice.due_date), 'MMM d, yyyy')}`, pageWidth - 20, 46, { align: 'right' });
    }

    // Bill To
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    doc.text('BILL TO:', 20, 60);
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(11);
    doc.text(account?.account_name || '', 20, 68);
    if (account?.billing_address) doc.text(account.billing_address, 20, 75);
    if (account?.billing_city) {
      doc.text(`${account.billing_city}, ${account.billing_state || ''} ${account.billing_postal_code || ''}`, 20, 82);
    }

    // Line items table
    let yPos = 100;
    doc.setFillColor(243, 244, 246);
    doc.rect(20, yPos - 5, pageWidth - 40, 10, 'F');
    
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text('Description', 22, yPos);
    doc.text('Qty', 120, yPos);
    doc.text('Rate', 140, yPos);
    doc.text('Amount', pageWidth - 22, yPos, { align: 'right' });
    
    yPos += 12;
    doc.setTextColor(0, 0, 0);

    (lineItems || []).forEach((item: any) => {
      if (yPos > 260) {
        doc.addPage();
        yPos = 30;
      }
      
      doc.text(item.description?.substring(0, 50) || '', 22, yPos);
      doc.text(String(item.quantity || 1), 120, yPos);
      doc.text(`$${(item.unit_price || 0).toFixed(2)}`, 140, yPos);
      doc.text(`$${(item.line_total || 0).toFixed(2)}`, pageWidth - 22, yPos, { align: 'right' });
      yPos += 8;
    });

    // Totals
    yPos += 10;
    doc.setDrawColor(200, 200, 200);
    doc.line(120, yPos, pageWidth - 20, yPos);
    yPos += 10;
    
    doc.setFontSize(11);
    doc.text('Subtotal:', 140, yPos);
    doc.text(`$${(invoice.subtotal || 0).toFixed(2)}`, pageWidth - 22, yPos, { align: 'right' });
    
    if (invoice.tax_amount) {
      yPos += 8;
      doc.text('Tax:', 140, yPos);
      doc.text(`$${invoice.tax_amount.toFixed(2)}`, pageWidth - 22, yPos, { align: 'right' });
    }
    
    yPos += 10;
    doc.setFontSize(14);
    doc.setTextColor(253, 90, 42);
    doc.text('Total:', 140, yPos);
    doc.text(`$${(invoice.total_amount || 0).toFixed(2)}`, pageWidth - 22, yPos, { align: 'right' });

    doc.save(`${invoice.invoice_number}.pdf`);
  };

  const handleSendInvoice = async (invoiceId: string) => {
    await updateInvoiceStatus(invoiceId, 'sent');
    toast({ title: 'Invoice Sent', description: 'Invoice status updated to sent.' });
  };

  const handleMarkPaid = async (invoiceId: string) => {
    await updateInvoiceStatus(invoiceId, 'paid');
    toast({ title: 'Invoice Paid', description: 'Invoice marked as paid.' });
  };

  const filteredCharges = charges.filter(charge =>
    charge.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    charge.account_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    charge.item_code?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const selectedTotal = Array.from(selectedCharges).reduce((sum, chargeId) => {
    const charge = charges.find(c => c.id === chargeId);
    return sum + (charge?.total || 0);
  }, 0);

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      draft: 'secondary',
      sent: 'default',
      paid: 'outline',
      overdue: 'destructive',
    };
    return <Badge variant={variants[status] || 'default'}>{status}</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="filter_list" size="md" />
            Create Invoice
          </CardTitle>
          <CardDescription>
            Select accounts, date range, and charges to create invoices
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Date Range */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Period Start</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <MaterialIcon name="calendar_today" size="sm" className="mr-2" />
                    {format(dateRange.start, 'PPP')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateRange.start}
                    onSelect={(date) =>
                      date && setDateRange(prev => ({ ...prev, start: date }))
                    }
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>Period End</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start">
                    <MaterialIcon name="calendar_today" size="sm" className="mr-2" />
                    {format(dateRange.end, 'PPP')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={dateRange.end}
                    onSelect={(date) =>
                      date && setDateRange(prev => ({ ...prev, end: date }))
                    }
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          {/* Charge Types */}
          <div className="space-y-2">
            <Label>Charge Types</Label>
            <div className="flex flex-wrap gap-4">
              {CHARGE_TYPE_OPTIONS.map(option => (
                <div key={option.value} className="flex items-center space-x-2">
                  <Checkbox
                    id={option.value}
                    checked={chargeTypes.includes(option.value)}
                    onCheckedChange={() => handleChargeTypeToggle(option.value)}
                  />
                  <label htmlFor={option.value} className="text-sm">
                    {option.label}
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* Account Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Accounts</Label>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="include-sub"
                  checked={includeSubAccounts}
                  onCheckedChange={(checked) => setIncludeSubAccounts(!!checked)}
                />
                <label htmlFor="include-sub" className="text-sm">
                  Include sub-accounts
                </label>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-3 max-h-48 overflow-y-auto border rounded-md p-4">
              {accounts
                .filter(a => !a.parent_account_id)
                .map(account => (
                  <div key={account.id} className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id={account.id}
                        checked={selectedAccountIds.includes(account.id)}
                        onCheckedChange={(checked) =>
                          handleAccountSelect(account.id, !!checked)
                        }
                      />
                      <label htmlFor={account.id} className="text-sm font-medium">
                        {account.account_name}
                      </label>
                    </div>
                    {accounts
                      .filter(a => a.parent_account_id === account.id)
                      .map(sub => (
                        <div
                          key={sub.id}
                          className="flex items-center space-x-2 ml-6"
                        >
                          <Checkbox
                            id={sub.id}
                            checked={selectedAccountIds.includes(sub.id)}
                            onCheckedChange={(checked) =>
                              handleAccountSelect(sub.id, !!checked)
                            }
                          />
                          <label htmlFor={sub.id} className="text-sm text-muted-foreground">
                            {sub.account_name}
                          </label>
                        </div>
                      ))}
                  </div>
                ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Billable Charges */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Billable Charges</CardTitle>
              <CardDescription>
                {filteredCharges.length} charges found
                {selectedCharges.size > 0 && (
                  <span className="ml-2">
                    • {selectedCharges.size} selected (${selectedTotal.toFixed(2)})
                  </span>
                )}
              </CardDescription>
            </div>
            {selectedCharges.size > 0 && (
              <Button onClick={() => setCreateDialogOpen(true)}>
                <MaterialIcon name="add" size="sm" className="mr-2" />
                Create Invoice(s)
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-4">
            <div className="relative">
              <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search charges..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>

          {chargesLoading ? (
            <div className="flex items-center justify-center h-48">
              <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
            </div>
          ) : selectedAccountIds.length === 0 ? (
            <div className="text-center py-12">
              <MaterialIcon name="attach_money" className="mx-auto text-muted-foreground" style={{ fontSize: '48px' }} />
              <h3 className="mt-4 text-lg font-semibold">Select Accounts</h3>
              <p className="text-muted-foreground">
                Choose one or more accounts to view billable charges
              </p>
            </div>
          ) : filteredCharges.length === 0 ? (
            <div className="text-center py-12">
              <MaterialIcon name="description" className="mx-auto text-muted-foreground" style={{ fontSize: '48px' }} />
              <h3 className="mt-4 text-lg font-semibold">No Charges Found</h3>
              <p className="text-muted-foreground">
                No billable charges for the selected criteria
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={selectedCharges.size === filteredCharges.length}
                      onCheckedChange={selectAllCharges}
                    />
                  </TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead className="text-right">Rate</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredCharges.map((charge) => (
                  <TableRow key={charge.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedCharges.has(charge.id)}
                        onCheckedChange={() => toggleChargeSelection(charge.id)}
                      />
                    </TableCell>
                    <TableCell>{format(new Date(charge.service_date), 'MMM d')}</TableCell>
                    <TableCell>{charge.account_name}</TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {charge.description}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{charge.service_type}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{charge.quantity}</TableCell>
                    <TableCell className="text-right">${charge.unit_price.toFixed(2)}</TableCell>
                    <TableCell className="text-right font-medium">${charge.total.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Existing Invoices */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Invoices</CardTitle>
          <CardDescription>View and manage existing invoices</CardDescription>
        </CardHeader>
        <CardContent>
          {invoicesLoading ? (
            <div className="flex items-center justify-center h-32">
              <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
            </div>
          ) : invoices.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">No invoices yet</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-32">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.slice(0, 10).map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium">{invoice.invoice_number}</TableCell>
                    <TableCell>{invoice.account_name}</TableCell>
                    <TableCell>{format(new Date(invoice.invoice_date), 'MMM d, yyyy')}</TableCell>
                    <TableCell>
                      {invoice.due_date
                        ? format(new Date(invoice.due_date), 'MMM d, yyyy')
                        : '-'}
                    </TableCell>
                    <TableCell className="text-right">
                      ${(invoice.total_amount || 0).toFixed(2)}
                    </TableCell>
                    <TableCell>{getStatusBadge(invoice.status || 'draft')}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleViewInvoice(invoice)}
                        >
                          <MaterialIcon name="visibility" size="sm" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDownloadPDF(invoice)}
                        >
                          <MaterialIcon name="download" size="sm" />
                        </Button>
                        {invoice.status === 'draft' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleSendInvoice(invoice.id)}
                          >
                            <MaterialIcon name="send" size="sm" />
                          </Button>
                        )}
                        {invoice.status === 'sent' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleMarkPaid(invoice.id)}
                          >
                            <MaterialIcon name="check_circle" size="sm" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create Invoice Confirmation Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Invoice(s)</DialogTitle>
            <DialogDescription>
              Create invoices for {selectedCharges.size} selected charges totaling ${selectedTotal.toFixed(2)}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              This will create one invoice per account with all selected charges.
              Invoice numbers will be automatically generated (INV-XXXXXX).
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateInvoice} disabled={creatingInvoice}>
              {creatingInvoice ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <MaterialIcon name="add" size="sm" className="mr-2" />
                  Create Invoice(s)
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View Invoice Dialog */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Invoice {selectedInvoice?.invoice_number}</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh]">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Account:</span>
                  <p className="font-medium">{selectedInvoice?.account_name}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Status:</span>
                  <p>{getStatusBadge(selectedInvoice?.status || 'draft')}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Invoice Date:</span>
                  <p>{selectedInvoice?.invoice_date && format(new Date(selectedInvoice.invoice_date), 'MMM d, yyyy')}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Due Date:</span>
                  <p>{selectedInvoice?.due_date ? format(new Date(selectedInvoice.due_date), 'MMM d, yyyy') : '-'}</p>
                </div>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoiceLineItems.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>{item.description}</TableCell>
                      <TableCell className="text-right">{item.quantity || 1}</TableCell>
                      <TableCell className="text-right">${(item.unit_price || 0).toFixed(2)}</TableCell>
                      <TableCell className="text-right">${(item.line_total || 0).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex justify-end">
                <div className="text-right space-y-1">
                  <p className="text-sm">Subtotal: ${(selectedInvoice?.subtotal || 0).toFixed(2)}</p>
                  {selectedInvoice?.tax_amount && (
                    <p className="text-sm">Tax: ${selectedInvoice.tax_amount.toFixed(2)}</p>
                  )}
                  <p className="text-lg font-bold">Total: ${(selectedInvoice?.total_amount || 0).toFixed(2)}</p>
                </div>
              </div>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
