import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

interface MarkPaidDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: {
    id: string;
    invoice_number: string;
    total_amount: number;
    paid_amount: number | null;
    accounts?: { account_name: string };
  };
  onSuccess: () => void;
}

export function MarkPaidDialog({ open, onOpenChange, invoice, onSuccess }: MarkPaidDialogProps) {
  const { profile } = useAuth();
  const { toast } = useToast();

  const amountDue = Number(invoice.total_amount || 0) - Number(invoice.paid_amount || 0);

  const [paidAmount, setPaidAmount] = useState(amountDue.toFixed(2));
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState('check');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const numericAmount = parseFloat(paidAmount) || 0;
  const isPartialPayment = numericAmount < amountDue;
  const remainingBalance = amountDue - numericAmount;

  const handleSave = async () => {
    if (!profile?.id) return;

    setSaving(true);

    try {
      const previouslyPaid = Number(invoice.paid_amount || 0);
      const newTotalPaid = previouslyPaid + numericAmount;
      const invoiceTotal = Number(invoice.total_amount || 0);

      const isFullyPaid = newTotalPaid >= invoiceTotal;
      const newStatus = isFullyPaid ? 'paid' : 'sent';
      const paymentStatus = isFullyPaid ? 'paid' : 'partial';

      const { error } = await (supabase
        .from('invoices') as any)
        .update({
          status: newStatus,
          payment_status: paymentStatus,
          paid_amount: newTotalPaid,
          paid_date: paymentDate,
          payment_method: paymentMethod || null,
          payment_reference: paymentReference || null,
          payment_notes: paymentNotes || null,
          marked_paid_at: new Date().toISOString(),
          marked_paid_by: profile.id,
        })
        .eq('id', invoice.id);

      if (error) throw error;

      toast({
        title: isFullyPaid ? 'Invoice marked as paid' : 'Partial payment recorded',
        description: isFullyPaid
          ? `Invoice fully paid ($${newTotalPaid.toFixed(2)})`
          : `$${numericAmount.toFixed(2)} recorded. Remaining: $${(invoiceTotal - newTotalPaid).toFixed(2)}`,
      });

      onSuccess();
    } catch (err) {
      console.error('Error recording payment:', err);
      toast({
        title: 'Error recording payment',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Mark Invoice Paid</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="bg-muted/50 rounded-lg p-4">
            <p className="text-sm text-muted-foreground">Invoice</p>
            <p className="font-mono font-semibold">{invoice.invoice_number}</p>
            <p className="text-sm text-muted-foreground mt-1">Account</p>
            <p className="font-medium">{invoice.accounts?.account_name}</p>
            <p className="text-sm text-muted-foreground mt-1">Amount Due</p>
            <p className="text-lg font-bold">${amountDue.toFixed(2)}</p>
          </div>

          <div className="space-y-2">
            <Label>Payment Amount *</Label>
            <Input
              type="number"
              step="0.01"
              value={paidAmount}
              onChange={(e) => setPaidAmount(e.target.value)}
            />
            {isPartialPayment && numericAmount > 0 && (
              <p className="text-sm text-orange-600">
                Partial payment - Remaining balance: ${remainingBalance.toFixed(2)}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Payment Date *</Label>
            <Input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label>Payment Method</Label>
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="check">Check</SelectItem>
                <SelectItem value="ach">ACH</SelectItem>
                <SelectItem value="wire">Wire Transfer</SelectItem>
                <SelectItem value="credit_card">Credit Card</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Reference # (check number, transaction ID, etc.)</Label>
            <Input
              value={paymentReference}
              onChange={(e) => setPaymentReference(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={paymentNotes}
              onChange={(e) => setPaymentNotes(e.target.value)}
              placeholder="Optional notes about this payment"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSave} disabled={saving || numericAmount <= 0}>
            {saving ? (
              <>
                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Mark as Paid'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
