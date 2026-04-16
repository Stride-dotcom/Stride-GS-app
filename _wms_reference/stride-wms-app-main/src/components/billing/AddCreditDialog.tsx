import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { SaveButton } from '@/components/ui/SaveButton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { createCharge } from '@/services/billing';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';

const CREDIT_REASONS = [
  'Courtesy / Waived Fee',
  'Damage Claim / Insurance',
  'Customer Satisfaction / Make Good',
  'Sales Discount / Approved Exception',
  'Duplicate Charge Correction',
  'Internal / Training / QA',
  'Other',
] as const;

interface AddCreditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  accountName?: string;
  itemId?: string | null;
  itemCode?: string | null;
  taskId?: string | null;
  shipmentId?: string | null;
  sidemarkId?: string | null;
  classId?: string | null;
  onSuccess?: () => void;
}

export function AddCreditDialog({
  open,
  onOpenChange,
  accountId,
  accountName,
  itemId,
  itemCode,
  taskId,
  shipmentId,
  sidemarkId,
  classId,
  onSuccess,
}: AddCreditDialogProps) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const { hasRole } = usePermissions();

  // Admin or billing manager
  const isAdmin = hasRole('admin') || hasRole('billing_manager');

  const [loading, setLoading] = useState(false);
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setReason('');
      setAmount('');
      setNotes('');
    }
  }, [open]);

  // Determine context label
  const getContext = (): 'task' | 'shipment' | 'item' | 'account' => {
    if (taskId) return 'task';
    if (shipmentId) return 'shipment';
    if (itemId) return 'item';
    return 'account';
  };

  const handleSubmit = async () => {
    if (!profile?.tenant_id) {
      toast({
        title: 'Session error',
        description: 'Unable to determine your account. Please refresh and try again.',
        variant: 'destructive',
      });
      return;
    }

    if (!accountId) {
      toast({
        title: 'Account missing',
        description: 'An account is required to add credits.',
        variant: 'destructive',
      });
      return;
    }

    if (!reason) {
      toast({
        title: 'Reason required',
        description: 'Please select a credit reason.',
        variant: 'destructive',
      });
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast({
        title: 'Valid amount required',
        description: 'Please enter a valid positive amount.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const negativeAmount = -Math.abs(parsedAmount);
      const context = getContext();

      const metadata: Record<string, unknown> = {
        source: 'manual_credit',
        credit_reason: reason,
        credit_notes: notes.trim() || null,
        context,
        created_by_role: 'admin',
      };

      if (taskId) metadata.task_id = taskId;
      if (shipmentId) metadata.shipment_id = shipmentId;

      const result = await createCharge({
        tenantId: profile.tenant_id,
        accountId: accountId,
        chargeCode: 'CREDIT',
        eventType: 'addon',
        context: {
          type: 'manual',
          itemId: itemId || undefined,
          taskId: taskId || undefined,
          shipmentId: shipmentId || undefined,
        },
        description: `Credit \u2013 ${reason}`,
        quantity: 1,
        rateOverride: negativeAmount,
        sidemarkId: sidemarkId || null,
        classId: classId || null,
        userId: profile.id,
        metadata: metadata as Record<string, any>,
      });

      if (!result.success) {
        throw new Error(result.errorMessage || 'Failed to add credit.');
      }

      toast({
        title: 'Credit added',
        description: `Credit added \u2014 -$${Math.abs(parsedAmount).toFixed(2)}${accountName ? ` for ${accountName}` : ''}.`,
      });

      onSuccess?.();
      onOpenChange(false);
    } catch (error: unknown) {
      const message = error && typeof error === 'object' && 'message' in error
        ? String((error as { message: string }).message)
        : 'Failed to add credit.';
      toast({
        title: 'Error',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Don't render for non-admin users
  if (!isAdmin) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[475px]">
        <DialogHeader>
          <DialogTitle>Add Credit</DialogTitle>
          {accountName && (
            <DialogDescription>
              Adding credit to: {accountName}
              {itemCode && ` (Item: ${itemCode})`}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Reason Dropdown (Required) */}
          <div className="space-y-2">
            <Label>Reason *</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger>
                <SelectValue placeholder="Select a reason..." />
              </SelectTrigger>
              <SelectContent>
                {CREDIT_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Amount (Required, positive input) */}
          <div className="space-y-2">
            <Label htmlFor="credit_amount">Amount *</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id="credit_amount"
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="pl-7"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Enter as a positive number. It will be stored as a negative billing event.
            </p>
          </div>

          {/* Preview */}
          {amount && parseFloat(amount) > 0 && (
            <div className="flex items-center justify-between py-2 px-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-md">
              <span className="text-sm text-green-700 dark:text-green-300">Credit Amount</span>
              <span className="text-lg font-semibold text-green-700 dark:text-green-300">
                -${Math.abs(parseFloat(amount)).toFixed(2)}
              </span>
            </div>
          )}

          {/* Notes (Optional) */}
          <div className="space-y-2">
            <Label htmlFor="credit_notes">Notes (optional)</Label>
            <Textarea
              id="credit_notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional details about this credit..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <SaveButton
            onClick={handleSubmit}
            label="Add Credit"
            savingLabel="Adding..."
            savedLabel="Credit Added"
            icon="money_off"
            saveDisabled={loading}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
