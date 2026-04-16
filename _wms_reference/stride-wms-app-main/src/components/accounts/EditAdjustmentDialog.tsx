/**
 * EditAdjustmentDialog - Edit an existing pricing adjustment
 */

import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useAccountPricing, AccountServiceSetting } from '@/hooks/useAccountPricing';
import { cn } from '@/lib/utils';

interface EditAdjustmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  adjustment: AccountServiceSetting | null;
  onSuccess: () => void;
}

type AdjustmentType = 'fixed' | 'percentage' | 'override';

export function EditAdjustmentDialog({
  open,
  onOpenChange,
  adjustment,
  onSuccess,
}: EditAdjustmentDialogProps) {
  const { updateAdjustment, saving } = useAccountPricing(adjustment?.account_id || null);

  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>('percentage');
  const [adjustmentValue, setAdjustmentValue] = useState<string>('');
  const [notes, setNotes] = useState('');

  // Initialize form when adjustment changes
  useEffect(() => {
    if (adjustment) {
      // Determine current adjustment type and value
      if (adjustment.custom_percent_adjust !== null && adjustment.custom_percent_adjust !== 0) {
        setAdjustmentType('percentage');
        setAdjustmentValue(adjustment.custom_percent_adjust.toString());
      } else if (adjustment.custom_rate !== null) {
        const baseRate = adjustment.base_rate || 0;
        const diff = adjustment.custom_rate - baseRate;
        if (Math.abs(diff) < 0.01) {
          // It's effectively an override
          setAdjustmentType('override');
          setAdjustmentValue(adjustment.custom_rate.toFixed(2));
        } else {
          // Could be fixed or override - we'll default to treating as override for simplicity
          // since we can't definitively know if it was +$X or just set to $Y
          setAdjustmentType('override');
          setAdjustmentValue(adjustment.custom_rate.toFixed(2));
        }
      } else {
        setAdjustmentType('percentage');
        setAdjustmentValue('0');
      }
      setNotes(adjustment.notes || '');
    }
  }, [adjustment]);

  // Calculate preview
  const preview = useMemo(() => {
    if (!adjustment) return null;
    const baseRate = adjustment.base_rate || 0;
    const numValue = parseFloat(adjustmentValue) || 0;

    let effectiveRate = baseRate;
    switch (adjustmentType) {
      case 'fixed':
        effectiveRate = baseRate + numValue;
        break;
      case 'percentage':
        effectiveRate = baseRate * (1 + numValue / 100);
        break;
      case 'override':
        effectiveRate = numValue;
        break;
    }

    return {
      baseRate,
      effectiveRate: Math.max(0, effectiveRate),
    };
  }, [adjustment, adjustmentType, adjustmentValue]);

  // Handle save
  const handleSave = async () => {
    if (!adjustment) return;

    const numValue = parseFloat(adjustmentValue) || 0;
    const success = await updateAdjustment(adjustment.id, adjustmentType, numValue, notes);
    if (success) {
      onSuccess();
    }
  };

  if (!adjustment) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        className="max-w-md"
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Edit Pricing Adjustment</DialogTitle>
          <DialogDescription>
            Modify the pricing adjustment for this service.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Service Info (Read-only) */}
          <div className="space-y-2">
            <Label>Service</Label>
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="font-mono">
                  {adjustment.service_code}
                </Badge>
                {adjustment.class_code && (
                  <Badge variant="secondary">{adjustment.class_code}</Badge>
                )}
              </div>
              {adjustment.service_event && (
                <p className="text-sm text-muted-foreground mt-1">
                  {adjustment.service_event.service_name}
                </p>
              )}
              <p className="text-sm mt-2">
                Base Rate:{' '}
                <span className="font-mono font-medium">
                  ${(adjustment.base_rate || 0).toFixed(2)}
                </span>
              </p>
            </div>
          </div>

          {/* Adjustment Type */}
          <div className="space-y-2">
            <Label>Adjustment Type</Label>
            <Select
              value={adjustmentType}
              onValueChange={(v) => {
                setAdjustmentType(v as AdjustmentType);
                // Reset value when changing type
                if (v === 'override') {
                  setAdjustmentValue((adjustment.base_rate || 0).toFixed(2));
                } else {
                  setAdjustmentValue('0');
                }
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed">Fixed Amount (+/-)</SelectItem>
                <SelectItem value="percentage">Percentage (+/-)</SelectItem>
                <SelectItem value="override">Override Rate</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {adjustmentType === 'fixed' &&
                'Adds or subtracts a dollar amount from the base rate'}
              {adjustmentType === 'percentage' &&
                'Applies a percentage markup or discount to the base rate'}
              {adjustmentType === 'override' && 'Replaces the base rate entirely'}
            </p>
          </div>

          {/* Adjustment Value */}
          <div className="space-y-2">
            <Label>Adjustment Value</Label>
            <div className="relative">
              {adjustmentType !== 'percentage' && (
                <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
              )}
              <Input
                type="number"
                step={adjustmentType === 'percentage' ? '1' : '0.01'}
                value={adjustmentValue}
                onChange={(e) => setAdjustmentValue(e.target.value)}
                className={cn(adjustmentType !== 'percentage' && 'pl-7')}
                placeholder={
                  adjustmentType === 'percentage'
                    ? 'e.g., 10 for +10%, -10 for -10%'
                    : adjustmentType === 'fixed'
                    ? 'e.g., 5.00 or -2.50'
                    : 'e.g., 50.00'
                }
              />
              {adjustmentType === 'percentage' && (
                <span className="absolute right-3 top-2.5 text-muted-foreground">%</span>
              )}
            </div>
          </div>

          {/* Preview */}
          {preview && (
            <div className="p-3 bg-muted/30 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Effective Rate:</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-muted-foreground">
                    ${preview.baseRate.toFixed(2)}
                  </span>
                  <MaterialIcon name="arrow_forward" size="sm" className="text-muted-foreground" />
                  <span
                    className={cn(
                      'font-mono font-bold text-lg',
                      preview.effectiveRate > preview.baseRate
                        ? 'text-red-600'
                        : preview.effectiveRate < preview.baseRate
                        ? 'text-green-600'
                        : ''
                    )}
                  >
                    ${preview.effectiveRate.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes (Optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for this adjustment..."
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button onClick={handleSave} disabled={saving || !adjustmentValue}>
            {saving && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
