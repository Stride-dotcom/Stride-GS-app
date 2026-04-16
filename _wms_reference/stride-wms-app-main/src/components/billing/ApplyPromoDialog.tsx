/**
 * ApplyPromoDialog - Apply a promo code to an existing billing event
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { applyPromoToEvent, removePromoFromEvent } from '@/lib/billing/promoCodeUtils';

interface PromoCode {
  id: string;
  code: string;
  discount_type: 'percentage' | 'flat_rate';
  discount_value: number;
  expiration_type: 'none' | 'date';
  expiration_date: string | null;
  service_scope: 'all' | 'selected';
  is_active: boolean;
}

interface BillingEvent {
  id: string;
  account_id: string;
  charge_type: string;
  description: string | null;
  total_amount: number;
  metadata?: {
    promo_discount?: {
      promo_code: string;
      discount_amount: number;
      original_amount: number;
    };
  };
}

interface ApplyPromoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  billingEvent: BillingEvent | null;
  onSuccess?: () => void;
}

export function ApplyPromoDialog({
  open,
  onOpenChange,
  billingEvent,
  onSuccess,
}: ApplyPromoDialogProps) {
  const { toast } = useToast();
  const { profile } = useAuth();

  const [promoCodes, setPromoCodes] = useState<PromoCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedPromoId, setSelectedPromoId] = useState<string>('');
  const [applying, setApplying] = useState(false);
  const [removing, setRemoving] = useState(false);

  const hasExistingPromo = !!billingEvent?.metadata?.promo_discount;

  // Fetch available promo codes
  useEffect(() => {
    if (open && profile?.tenant_id) {
      fetchPromoCodes();
    }
  }, [open, profile?.tenant_id]);

  const fetchPromoCodes = async () => {
    if (!profile?.tenant_id) return;

    setLoading(true);
    try {
      const { data, error } = await (supabase
        .from('promo_codes') as any)
        .select('id, code, discount_type, discount_value, expiration_type, expiration_date, service_scope, is_active')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .is('deleted_at', null)
        .order('code');

      if (error) throw error;
      setPromoCodes(data || []);
    } catch (error) {
      console.error('Error fetching promo codes:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!selectedPromoId || !billingEvent || !profile?.tenant_id) return;

    setApplying(true);
    try {
      const result = await applyPromoToEvent(
        profile.tenant_id,
        billingEvent.id,
        selectedPromoId,
        profile.id
      );

      if (result.success) {
        toast({
          title: 'Promo code applied',
          description: result.discount
            ? `Saved $${result.discount.discount_amount.toFixed(2)}`
            : 'Discount applied',
        });
        onOpenChange(false);
        onSuccess?.();
      } else {
        toast({
          variant: 'destructive',
          title: 'Could not apply promo code',
          description: result.error,
        });
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message,
      });
    } finally {
      setApplying(false);
    }
  };

  const handleRemove = async () => {
    if (!billingEvent) return;

    setRemoving(true);
    try {
      const result = await removePromoFromEvent(billingEvent.id);

      if (result.success) {
        toast({ title: 'Promo code removed' });
        onOpenChange(false);
        onSuccess?.();
      } else {
        toast({
          variant: 'destructive',
          title: 'Could not remove promo code',
          description: result.error,
        });
      }
    } catch (error: any) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message,
      });
    } finally {
      setRemoving(false);
    }
  };

  const formatDiscount = (type: string, value: number) => {
    if (type === 'percentage') {
      return `${value}% off`;
    }
    return `$${value.toFixed(2)} off`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MaterialIcon name="confirmation_number" size="md" />
            {hasExistingPromo ? 'Manage Promo Code' : 'Apply Promo Code'}
          </DialogTitle>
          <DialogDescription>
            {hasExistingPromo
              ? 'This billing event already has a promo code applied.'
              : 'Apply a promo code discount to this billing event.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Current promo info */}
          {hasExistingPromo && billingEvent?.metadata?.promo_discount && (
            <div className="p-4 bg-green-500/10 rounded-lg border border-green-500/20">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-green-700 dark:text-green-400">
                    Current Promo Code
                  </p>
                  <p className="text-lg font-mono font-bold">
                    {billingEvent.metadata.promo_discount.promo_code}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Discount</p>
                  <p className="text-lg font-bold text-green-600">
                    -${billingEvent.metadata.promo_discount.discount_amount.toFixed(2)}
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 w-full"
                onClick={handleRemove}
                disabled={removing}
              >
                {removing ? (
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                ) : (
                  <MaterialIcon name="delete" size="sm" className="mr-2" />
                )}
                Remove Promo Code
              </Button>
            </div>
          )}

          {/* Select promo code (only if no existing promo) */}
          {!hasExistingPromo && (
            <>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <MaterialIcon name="progress_activity" className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : promoCodes.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <MaterialIcon name="confirmation_number" className="h-8 w-8 mx-auto mb-2" />
                  <p>No active promo codes available</p>
                </div>
              ) : (
                <div className="space-y-3">
                  <Select value={selectedPromoId} onValueChange={setSelectedPromoId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a promo code..." />
                    </SelectTrigger>
                    <SelectContent>
                      {promoCodes.map((pc) => (
                        <SelectItem key={pc.id} value={pc.id}>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold">{pc.code}</span>
                            <Badge variant="outline" className="text-xs">
                              {formatDiscount(pc.discount_type, pc.discount_value)}
                            </Badge>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {selectedPromoId && (
                    <div className="p-3 bg-muted rounded-lg text-sm">
                      {(() => {
                        const selected = promoCodes.find(p => p.id === selectedPromoId);
                        if (!selected) return null;
                        return (
                          <div className="space-y-1">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Discount:</span>
                              <span className="font-medium">
                                {formatDiscount(selected.discount_type, selected.discount_value)}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Applies to:</span>
                              <span>
                                {selected.service_scope === 'all' ? 'All services' : 'Selected services'}
                              </span>
                            </div>
                            {selected.expiration_type === 'date' && selected.expiration_date && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Expires:</span>
                                <span>
                                  {new Date(selected.expiration_date).toLocaleDateString()}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          {!hasExistingPromo && (
            <Button
              onClick={handleApply}
              disabled={!selectedPromoId || applying}
            >
              {applying && (
                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
              )}
              Apply Promo Code
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
