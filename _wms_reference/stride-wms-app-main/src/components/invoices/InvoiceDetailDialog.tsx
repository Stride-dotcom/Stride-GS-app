import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { downloadInvoicePdf, printInvoicePdf, InvoicePdfData } from '@/lib/invoicePdf';

interface InvoiceDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: {
    id: string;
    invoice_number: string;
    account_id: string;
    invoice_date: string;
    due_date: string | null;
    period_start: string | null;
    period_end: string | null;
    status: string;
    payment_status: string | null;
    subtotal: number;
    tax_amount: number | null;
    total_amount: number;
    paid_amount: number | null;
    notes: string | null;
    accounts?: {
      account_name: string;
      account_code: string;
      billing_contact_email?: string | null;
    };
  };
  onRefresh: () => void;
}

interface InvoiceLine {
  id: string;
  charge_type: string;
  description: string | null;
  quantity: number;
  unit_rate: number;
  total_amount: number;
  occurred_at: string | null;
  sidemark_name: string | null;
}

export function InvoiceDetailDialog({
  open,
  onOpenChange,
  invoice,
  onRefresh,
}: InvoiceDetailDialogProps) {
  const { toast } = useToast();

  const [lines, setLines] = useState<InvoiceLine[]>([]);
  const [loadingLines, setLoadingLines] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(invoice.notes || '');
  const [savingNotes, setSavingNotes] = useState(false);

  // Load invoice lines when dialog opens
  useEffect(() => {
    if (open && invoice.id) {
      loadLines();
      setNotesValue(invoice.notes || '');
      setEditingNotes(false);
    }
  }, [open, invoice.id]);

  const loadLines = async () => {
    setLoadingLines(true);
    try {
      const { data, error } = await supabase
        .from('invoice_lines')
        .select('*')
        .eq('invoice_id', invoice.id)
        .order('occurred_at', { ascending: true });

      if (error) throw error;
      setLines((data || []) as InvoiceLine[]);
    } catch (err) {
      console.error('Error loading invoice lines:', err);
    } finally {
      setLoadingLines(false);
    }
  };

  const handleDownloadPdf = async () => {
    const pdfData = await generatePdfData();
    if (pdfData) {
      await downloadInvoicePdf(pdfData);
    }
  };

  const handlePrintPdf = async () => {
    const pdfData = await generatePdfData();
    if (pdfData) {
      await printInvoicePdf(pdfData);
    }
  };

  const generatePdfData = async (): Promise<InvoicePdfData | null> => {
    const account = invoice.accounts;
    if (!account) return null;

    return {
      invoiceNumber: invoice.invoice_number,
      invoiceDate: invoice.invoice_date,
      dueDate: invoice.due_date || undefined,
      periodStart: invoice.period_start || '',
      periodEnd: invoice.period_end || '',
      invoiceType: 'manual',
      companyName: 'Stride Warehouse',
      accountName: account.account_name,
      accountCode: account.account_code,
      billingContactEmail: account.billing_contact_email || undefined,
      lines: lines.map(l => ({
        serviceCode: l.charge_type || '',
        description: l.description || undefined,
        quantity: l.quantity,
        unitRate: l.unit_rate,
        lineTotal: l.total_amount,
      })),
      subtotal: invoice.subtotal || 0,
      taxAmount: invoice.tax_amount || undefined,
      total: invoice.total_amount || 0,
      notes: invoice.notes || undefined,
    };
  };

  const handleSaveNotes = async () => {
    setSavingNotes(true);
    try {
      const { error } = await supabase
        .from('invoices')
        .update({ notes: notesValue })
        .eq('id', invoice.id);

      if (error) throw error;

      toast({ title: 'Notes saved' });
      setEditingNotes(false);
      onRefresh();
    } catch (err) {
      toast({ title: 'Error saving notes', variant: 'destructive' });
    } finally {
      setSavingNotes(false);
    }
  };

  const getStatusBadge = (status: string, paymentStatus: string | null) => {
    if (status === 'sent' && paymentStatus === 'partial') {
      return <StatusIndicator status="partial" label="Partial Payment" size="sm" />;
    }
    return <StatusIndicator status={status} size="sm" />;
  };

  const subtotal = lines.reduce((sum, l) => sum + Number(l.total_amount || 0), 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-xl">
                Invoice {invoice.invoice_number}
              </DialogTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {invoice.accounts?.account_name} ({invoice.accounts?.account_code})
              </p>
            </div>
            {getStatusBadge(invoice.status, invoice.payment_status)}
          </div>
        </DialogHeader>

        {/* Invoice Details */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 py-4 border-b">
          <div>
            <p className="text-xs text-muted-foreground">Invoice Date</p>
            <p className="font-medium">{invoice.invoice_date}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Due Date</p>
            <p className="font-medium">{invoice.due_date || 'Upon Receipt'}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Period</p>
            <p className="font-medium">{invoice.period_start} - {invoice.period_end}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Amount</p>
            <p className="font-medium text-lg">${Number(invoice.total_amount || 0).toFixed(2)}</p>
          </div>
        </div>

        {/* Line Items */}
        <div className="py-4">
          <h3 className="font-medium mb-3">Line Items ({lines.length})</h3>
          {loadingLines ? (
            <div className="flex items-center justify-center py-8">
              <MaterialIcon name="progress_activity" className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Service</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => (
                    <TableRow key={line.id}>
                      <TableCell className="text-sm">{line.occurred_at?.slice(0, 10) || '-'}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{line.charge_type || line.description || '\u2014'}</Badge>
                      </TableCell>
                      <TableCell className="text-sm">{line.description || '-'}</TableCell>
                      <TableCell className="text-right">{line.quantity}</TableCell>
                      <TableCell className="text-right">${Number(line.unit_rate || 0).toFixed(2)}</TableCell>
                      <TableCell className="text-right font-medium">${Number(line.total_amount || 0).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                  {lines.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        No line items
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Totals */}
        <div className="flex justify-end py-4 border-t">
          <div className="w-64 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Subtotal:</span>
              <span>${subtotal.toFixed(2)}</span>
            </div>
            {invoice.tax_amount && Number(invoice.tax_amount) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Tax:</span>
                <span>${Number(invoice.tax_amount).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-lg border-t pt-2">
              <span>Total:</span>
              <span>${Number(invoice.total_amount || 0).toFixed(2)}</span>
            </div>
            {invoice.paid_amount && Number(invoice.paid_amount) > 0 && (
              <>
                <div className="flex justify-between text-sm text-green-600">
                  <span>Paid:</span>
                  <span>-${Number(invoice.paid_amount).toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Balance Due:</span>
                  <span>${(Number(invoice.total_amount || 0) - Number(invoice.paid_amount || 0)).toFixed(2)}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Notes */}
        <div className="py-4 border-t">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-medium">Notes</h3>
            {!editingNotes && invoice.status === 'draft' && (
              <Button variant="ghost" size="sm" onClick={() => setEditingNotes(true)}>
                <MaterialIcon name="edit" size="sm" className="mr-1" />
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
                  {savingNotes ? 'Saving...' : 'Save'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditingNotes(false);
                    setNotesValue(invoice.notes || '');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground bg-muted/50 rounded p-3 min-h-[60px]">
              {invoice.notes || 'No notes'}
            </p>
          )}
        </div>

        <DialogFooter className="flex flex-col sm:flex-row gap-2 border-t pt-4">
          <div className="flex gap-2 flex-1">
            <Button variant="outline" onClick={handleDownloadPdf}>
              <MaterialIcon name="download" size="sm" className="mr-2" />
              Download PDF
            </Button>
            <Button variant="outline" onClick={handlePrintPdf}>
              <MaterialIcon name="print" size="sm" className="mr-2" />
              Print
            </Button>
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
