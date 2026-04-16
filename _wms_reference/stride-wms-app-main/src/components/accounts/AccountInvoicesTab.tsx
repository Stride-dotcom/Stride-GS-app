import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { downloadInvoicePdf, InvoicePdfData } from '@/lib/invoicePdf';

interface BrandInfo {
  brand_color: string | null;
}

interface AccountInvoicesTabProps {
  accountId: string;
  accountName: string;
}

interface Invoice {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  period_start: string | null;
  period_end: string | null;
  status: string;
  total_amount: number;
  paid_amount: number | null;
}

interface InvoiceLine {
  id: string;
  description: string;
  charge_type: string;
  quantity: number;
  unit_rate: number;
  total_amount: number;
  occurred_at: string | null;
  sidemark_name: string | null;
}

export function AccountInvoicesTab({ accountId, accountName }: AccountInvoicesTabProps) {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [brandInfo, setBrandInfo] = useState<BrandInfo>({ brand_color: null });

  const loadInvoices = useCallback(async () => {
    if (!profile?.tenant_id) {
      setLoading(false);
      return;
    }
    setLoading(true);

    const { data, error } = await (supabase
      .from('invoices') as any)
      .select('*')
      .eq('tenant_id', profile.tenant_id)
      .eq('account_id', accountId)
      .order('invoice_date', { ascending: false });

    if (!error) {
      setInvoices(data || []);
    }
    setLoading(false);
  }, [profile?.tenant_id, accountId]);

  useEffect(() => {
    loadInvoices();
    // Load brand color
    if (profile?.tenant_id) {
      supabase
        .from('communication_brand_settings')
        .select('brand_primary_color')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle()
        .then(({ data }) => {
          setBrandInfo({ brand_color: data?.brand_primary_color || null });
        });
    }
  }, [loadInvoices, profile?.tenant_id]);

  const filteredInvoices = useMemo(() => {
    if (statusFilter === 'all') return invoices;
    return invoices.filter(i => i.status === statusFilter);
  }, [invoices, statusFilter]);

  const summary = useMemo(() => {
    const total = invoices.reduce((s, i) => s + Number(i.total_amount || 0), 0);
    // Calculate outstanding: total_amount - paid_amount for draft/sent invoices
    const outstanding = invoices
      .filter(i => i.status === 'draft' || i.status === 'sent')
      .reduce((s, i) => {
        const invoiceTotal = Number(i.total_amount || 0);
        const paidAmount = Number(i.paid_amount || 0);
        return s + Math.max(0, invoiceTotal - paidAmount);
      }, 0);
    return { total, outstanding, count: invoices.length };
  }, [invoices]);

  const handleDownload = async (invoice: Invoice) => {
    setDownloadingId(invoice.id);

    try {
      // Fetch invoice lines
      const { data: lines, error } = await supabase
        .from('invoice_lines')
        .select('*')
        .eq('invoice_id', invoice.id)
        .order('occurred_at', { ascending: true });

      if (error) throw error;

      const pdfData: InvoicePdfData = {
        invoiceNumber: invoice.invoice_number,
        invoiceDate: invoice.invoice_date,
        dueDate: invoice.due_date || undefined,
        periodStart: invoice.period_start || '',
        periodEnd: invoice.period_end || '',
        invoiceType: 'manual',
        companyName: 'Stride Warehouse',
        accountName: accountName,
        accountCode: '',
        brandColor: brandInfo.brand_color || undefined,
        lines: (lines || []).map((l: InvoiceLine) => ({
          date: l.occurred_at?.slice(0, 10) || '',
          description: l.description || l.charge_type || '',
          sidemark: l.sidemark_name || '',
          quantity: l.quantity,
          unitRate: l.unit_rate,
          lineTotal: l.total_amount,
          rate: l.unit_rate,
          total: l.total_amount,
        })),
        subtotal: invoice.total_amount || 0,
        total: invoice.total_amount || 0,
      };
      await downloadInvoicePdf(pdfData);
    } catch (err) {
      console.error('Error downloading invoice:', err);
      toast({ title: 'Error downloading invoice', variant: 'destructive' });
    } finally {
      setDownloadingId(null);
    }
  };

  const getStatusBadge = (status: string) => (
    <StatusIndicator status={status} size="sm" />
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <MaterialIcon name="progress_activity" className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-6 text-sm">
            <div>
              <span className="text-muted-foreground">Total Invoiced:</span>
              <span className="ml-2 font-semibold">${summary.total.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Outstanding:</span>
              <span className="ml-2 font-semibold text-orange-600">${summary.outstanding.toFixed(2)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Invoices:</span>
              <span className="ml-2 font-semibold">{summary.count}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filter */}
      <div className="flex items-center gap-2">
        <span className="text-sm">Status:</span>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="sent">Sent</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="void">Void</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredInvoices.map(invoice => (
                <TableRow key={invoice.id}>
                  <TableCell className="font-mono font-medium">{invoice.invoice_number}</TableCell>
                  <TableCell>{invoice.invoice_date}</TableCell>
                  <TableCell>{invoice.period_start} - {invoice.period_end}</TableCell>
                  <TableCell className="text-right font-medium">${Number(invoice.total_amount || 0).toFixed(2)}</TableCell>
                  <TableCell>{getStatusBadge(invoice.status)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDownload(invoice)}
                        disabled={downloadingId === invoice.id}
                      >
                        <MaterialIcon
                          name={downloadingId === invoice.id ? "progress_activity" : "download"}
                          size="sm"
                          className={`mr-1 ${downloadingId === invoice.id ? "animate-spin" : ""}`}
                        />
                        PDF
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredInvoices.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No invoices found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
