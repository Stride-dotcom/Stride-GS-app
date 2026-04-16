/**
 * ShipmentCoverageDialog - Apply/remove coverage via server-side RPCs
 * Option A: Shipment-level coverage type, per-item billing via RPCs only.
 * No client-side billing event creation.
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { queueCoverageAppliedAlert, queueCoveragePendingDeclaredValueAlert } from '@/lib/alertQueue';

type PaidCoverageType = 'full_replacement_no_deductible' | 'full_replacement_deductible';

interface ShipmentCoverageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shipmentId: string;
  accountId: string | null;
  shipmentNumber: string;
  itemCount: number;
  currentCoverageType?: string | null;
  onSuccess?: () => void;
}

const COVERAGE_LABELS: Record<string, string> = {
  full_replacement_no_deductible: 'Full Replacement (No Deductible)',
  full_replacement_deductible: 'Full Replacement (With Deductible)',
};

export function ShipmentCoverageDialog({
  open,
  onOpenChange,
  shipmentId,
  accountId,
  shipmentNumber,
  itemCount,
  currentCoverageType,
  onSuccess,
}: ShipmentCoverageDialogProps) {
  const { profile } = useAuth();
  const { toast } = useToast();

  const isPaidTier = currentCoverageType === 'full_replacement_no_deductible' ||
    currentCoverageType === 'full_replacement_deductible';

  const [coverageType, setCoverageType] = useState<PaidCoverageType>('full_replacement_no_deductible');
  const [saving, setSaving] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'apply' | 'remove'>('apply');
  const [previewData, setPreviewData] = useState<{
    predicted_new_total: number;
    current_existing_net: number;
    predicted_delta: number;
  } | null>(null);

  // Coverage rates for display
  const [rates, setRates] = useState({
    rate_full_replacement_no_deductible: 0.0188,
    rate_full_replacement_deductible: 0.0142,
    deductible_amount: 300,
  });

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setCoverageType(
        isPaidTier ? (currentCoverageType as PaidCoverageType) : 'full_replacement_no_deductible'
      );
      setPreviewData(null);
    }
  }, [open, currentCoverageType, isPaidTier]);

  // Fetch rates via RPC
  useEffect(() => {
    async function fetchRates() {
      if (!open || !accountId) return;
      try {
        const { data, error } = await supabase.rpc('rpc_get_effective_coverage_rates', {
          p_account_id: accountId,
        });
        if (!error && data) {
          const d = data as Record<string, number>;
          setRates({
            rate_full_replacement_no_deductible: d.rate_full_replacement_no_deductible ?? 0.0188,
            rate_full_replacement_deductible: d.rate_full_replacement_deductible ?? 0.0142,
            deductible_amount: d.deductible_amount ?? 300,
          });
        }
      } catch {
        // Use defaults
      }
    }
    fetchRates();
  }, [open, accountId]);

  const getRate = (): number => {
    return coverageType === 'full_replacement_no_deductible'
      ? rates.rate_full_replacement_no_deductible
      : rates.rate_full_replacement_deductible;
  };

  const handleApply = async () => {
    // If there's existing coverage billing, show preview first
    if (isPaidTier || currentCoverageType) {
      try {
        const { data, error } = await supabase.rpc('rpc_preview_shipment_coverage_change', {
          p_shipment_id: shipmentId,
          p_new_type: coverageType,
        });
        if (!error && data) {
          const preview = data as Record<string, number>;
          if (preview.current_existing_net !== 0 || preview.predicted_delta !== 0) {
            setPreviewData({
              predicted_new_total: preview.predicted_new_total,
              current_existing_net: preview.current_existing_net,
              predicted_delta: preview.predicted_delta,
            });
            setConfirmAction('apply');
            setShowConfirmDialog(true);
            return;
          }
        }
      } catch {
        // If preview fails, proceed without it
      }
    }

    await executeApply();
  };

  const executeApply = async () => {
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('rpc_apply_shipment_coverage', {
        p_shipment_id: shipmentId,
        p_coverage_type: coverageType,
      });

      if (error) throw error;

      const result = data as Record<string, number | string | boolean>;
      const pendingCount = (result?.pending_count as number) || 0;

      toast({
        title: 'Coverage Applied',
        description: pendingCount > 0
          ? `Coverage applied. ${pendingCount} item(s) need declared values entered.`
          : `Coverage applied to ${itemCount} items.`,
      });

      if (profile?.tenant_id) {
        queueCoverageAppliedAlert(
          profile.tenant_id,
          shipmentId,
          shipmentNumber,
          coverageType,
          itemCount
        ).catch(() => {});
        if (pendingCount > 0) {
          queueCoveragePendingDeclaredValueAlert(
            profile.tenant_id,
            shipmentId,
            shipmentNumber,
            pendingCount
          ).catch(() => {});
        }
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to apply coverage';
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setSaving(false);
      setShowConfirmDialog(false);
      setPreviewData(null);
    }
  };

  const handleRemove = async () => {
    // Preview the removal
    try {
      const { data, error } = await supabase.rpc('rpc_preview_shipment_coverage_change', {
        p_shipment_id: shipmentId,
        p_new_type: null,
      });
      if (!error && data) {
        const preview = data as Record<string, number>;
        if (preview.current_existing_net !== 0) {
          setPreviewData({
            predicted_new_total: 0,
            current_existing_net: preview.current_existing_net,
            predicted_delta: -preview.current_existing_net,
          });
          setConfirmAction('remove');
          setShowConfirmDialog(true);
          return;
        }
      }
    } catch {
      // Proceed without preview
    }
    await executeRemove();
  };

  const executeRemove = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc('rpc_remove_shipment_coverage', {
        p_shipment_id: shipmentId,
      });

      if (error) throw error;

      toast({ title: 'Coverage Removed', description: 'Coverage has been removed from this shipment.' });
      onOpenChange(false);
      onSuccess?.();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to remove coverage';
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setSaving(false);
      setShowConfirmDialog(false);
      setPreviewData(null);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="verified_user" className="h-5 w-5 text-blue-600" />
              {isPaidTier ? 'Manage Coverage' : 'Add Coverage'}
            </DialogTitle>
            <DialogDescription>
              {isPaidTier
                ? `Manage coverage for shipment ${shipmentNumber}.`
                : `Apply valuation coverage to shipment ${shipmentNumber} and its items.`}
            </DialogDescription>
          </DialogHeader>

          <DialogBody>
            <div className="space-y-4 py-4">
              {/* Coverage Type Selector — paid tiers only */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Coverage Type</label>
                <Select
                  value={coverageType}
                  onValueChange={(v) => setCoverageType(v as PaidCoverageType)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="full_replacement_no_deductible">
                      <div className="flex flex-col">
                        <span>Full Replacement (No Deductible)</span>
                        <span className="text-xs text-muted-foreground">
                          {(rates.rate_full_replacement_no_deductible * 100).toFixed(2)}% of declared value
                        </span>
                      </div>
                    </SelectItem>
                    <SelectItem value="full_replacement_deductible">
                      <div className="flex flex-col">
                        <span>Full Replacement (${rates.deductible_amount} Deductible)</span>
                        <span className="text-xs text-muted-foreground">
                          {(rates.rate_full_replacement_deductible * 100).toFixed(2)}% of declared value
                        </span>
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Info box */}
              <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
                <h4 className="font-medium text-blue-900">How it works</h4>
                <ul className="text-sm text-blue-700 list-disc pl-4 space-y-1">
                  <li>Coverage type applies to the entire shipment</li>
                  <li>Each item's premium is calculated from its individual declared value</li>
                  <li>Items without declared values will be marked "Pending"</li>
                </ul>
                <div className="flex items-center gap-2 text-sm text-blue-800 pt-1">
                  <span>Coverage Rate:</span>
                  <Badge variant="outline" className="font-mono">
                    {(getRate() * 100).toFixed(2)}%
                  </Badge>
                </div>
              </div>
            </div>
          </DialogBody>

          <DialogFooter className="flex gap-2">
            {isPaidTier && (
              <Button
                variant="destructive"
                onClick={handleRemove}
                disabled={saving}
                className="mr-auto"
              >
                Remove Coverage
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleApply} disabled={saving}>
              {saving ? (
                <>
                  <MaterialIcon name="progress_activity" className="h-4 w-4 mr-2 animate-spin" />
                  Applying...
                </>
              ) : (
                <>
                  <MaterialIcon name="verified_user" className="h-4 w-4 mr-2" />
                  {isPaidTier ? 'Update Coverage' : 'Apply Coverage'}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Billing impact confirmation dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Coverage Change</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                {previewData && (
                  <div className="p-3 bg-muted rounded-md space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span>Current billing net:</span>
                      <span className="font-mono">${previewData.current_existing_net.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>New predicted total:</span>
                      <span className="font-mono">${previewData.predicted_new_total.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between font-medium border-t pt-1">
                      <span>{previewData.predicted_delta >= 0 ? 'Additional charge:' : 'Credit to account:'}</span>
                      <span className={`font-mono ${previewData.predicted_delta < 0 ? 'text-green-600' : 'text-orange-600'}`}>
                        ${Math.abs(previewData.predicted_delta).toFixed(2)}
                      </span>
                    </div>
                  </div>
                )}
                <p>Do you want to proceed with this coverage change?</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmAction === 'remove') {
                  executeRemove();
                } else {
                  executeApply();
                }
              }}
            >
              Confirm Change
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
