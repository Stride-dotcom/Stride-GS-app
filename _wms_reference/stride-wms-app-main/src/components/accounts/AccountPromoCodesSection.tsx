/**
 * AccountPromoCodesSection - Manage promo codes assigned to an account
 */

import { useState } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { useAccountPromoCodes } from '@/hooks/useAccountPromoCodes';
import { format } from 'date-fns';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface AccountPromoCodesSectionProps {
  accountId: string;
  accountName: string;
}

export function AccountPromoCodesSection({ accountId, accountName }: AccountPromoCodesSectionProps) {
  const {
    assignedCodes,
    availableCodes,
    loading,
    assignPromoCode,
    removePromoCode,
  } = useAccountPromoCodes(accountId);

  const [selectedCodeToAdd, setSelectedCodeToAdd] = useState<string>('');
  const [adding, setAdding] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState<{ id: string; code: string } | null>(null);
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const handleAssign = async () => {
    if (!selectedCodeToAdd) return;
    setAdding(true);
    try {
      await assignPromoCode(selectedCodeToAdd);
      setSelectedCodeToAdd('');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async () => {
    if (!removeConfirm) return;
    await removePromoCode(removeConfirm.id);
    setRemoveConfirm(null);
  };

  const formatDiscount = (type: string, value: number) => {
    if (type === 'percentage') {
      return `${value}% off`;
    }
    return `$${value.toFixed(2)} off`;
  };

  const getStatusBadge = (code: any) => {
    if (!code.is_active) {
      return <Badge variant="secondary">Inactive</Badge>;
    }
    if (code.expiration_type === 'date' && code.expiration_date) {
      const expirationDate = new Date(code.expiration_date);
      if (expirationDate < new Date()) {
        return <Badge variant="destructive">Expired</Badge>;
      }
    }
    if (code.usage_limit_type === 'limited' && code.usage_limit && code.usage_count >= code.usage_limit) {
      return <Badge variant="outline">Limit Reached</Badge>;
    }
    return <Badge className="bg-green-500">Active</Badge>;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <MaterialIcon name="progress_activity" className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-medium">Promo Codes</h3>
          <p className="text-sm text-muted-foreground">
            Discount codes applied to billing for {accountName}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => setAddDialogOpen(true)}
          disabled={availableCodes.length === 0}
        >
          <MaterialIcon name="add" size="sm" className="mr-1" />
          Add Promo Code
        </Button>
      </div>

      {/* Assigned Codes Table */}
      {assignedCodes.length > 0 ? (
        <div className="border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Code</TableHead>
                <TableHead>Discount</TableHead>
                <TableHead>Applies To</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignedCodes.map((assigned) => (
                <TableRow key={assigned.id}>
                  <TableCell>
                    <span className="font-mono font-bold text-primary">
                      {assigned.promo_code.code}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">
                      {formatDiscount(assigned.promo_code.discount_type, assigned.promo_code.discount_value)}
                    </span>
                  </TableCell>
                  <TableCell>
                    {assigned.promo_code.service_scope === 'all' ? (
                      <span className="text-sm text-muted-foreground">All services</span>
                    ) : (
                      <span className="text-sm">
                        {assigned.promo_code.selected_services?.length || 0} services
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {assigned.promo_code.expiration_type === 'none' ? (
                      <span className="text-sm text-muted-foreground">Never</span>
                    ) : assigned.promo_code.expiration_date ? (
                      <span className="text-sm">
                        {format(new Date(assigned.promo_code.expiration_date), 'MMM d, yyyy')}
                      </span>
                    ) : (
                      '-'
                    )}
                  </TableCell>
                  <TableCell>
                    {getStatusBadge(assigned.promo_code)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive hover:text-destructive"
                      onClick={() => setRemoveConfirm({ id: assigned.id, code: assigned.promo_code.code })}
                    >
                      <MaterialIcon name="delete" size="sm" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="text-center py-8 border rounded-lg bg-muted/20">
          <MaterialIcon name="confirmation_number" className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <h3 className="text-base font-medium mb-1">No Promo Codes Assigned</h3>
          <p className="text-sm text-muted-foreground">
            {availableCodes.length > 0
              ? 'Assign a promo code above to apply discounts to this account\'s billing.'
              : 'No promo codes are available. Create promo codes in Billing > Promo Codes.'}
          </p>
        </div>
      )}

      {/* Info Box */}
      <div className="rounded-md bg-muted/50 p-4 text-sm text-muted-foreground">
        <p className="font-medium mb-1">How Promo Codes Work</p>
        <p>
          Promo codes assigned here will automatically apply discounts when billing events are created for this account.
          The best available discount is applied if multiple codes are eligible.
        </p>
      </div>

      {/* Remove Confirmation */}
      <AlertDialog open={!!removeConfirm} onOpenChange={() => setRemoveConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Promo Code?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove the promo code <strong>{removeConfirm?.code}</strong> from this account?
              Future billing events will not receive this discount.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleRemove}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Add Promo Code Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Add Promo Code</DialogTitle>
            <DialogDescription>
              Select a promo code to assign to {accountName}. The discount will be automatically applied to future billing events.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            {availableCodes.length > 0 ? (
              <>
                <div className="space-y-2">
                  <Label>Select Promo Code</Label>
                  <Select value={selectedCodeToAdd} onValueChange={setSelectedCodeToAdd}>
                    <SelectTrigger>
                      <SelectValue placeholder="Choose a promo code..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableCodes.map((code) => (
                        <SelectItem key={code.id} value={code.id}>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-primary">{code.code}</span>
                            <span className="text-muted-foreground">
                              ({formatDiscount(code.discount_type, code.discount_value)})
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {selectedCodeToAdd && (
                  <div className="bg-muted/50 rounded-lg p-4">
                    {(() => {
                      const selected = availableCodes.find(c => c.id === selectedCodeToAdd);
                      if (!selected) return null;
                      return (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Code</span>
                            <span className="font-mono font-bold text-primary">{selected.code}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Discount</span>
                            <span className="font-medium">
                              {formatDiscount(selected.discount_type, selected.discount_value)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground">Applies To</span>
                            <span className="text-sm">
                              {selected.service_scope === 'all' ? 'All services' : 'Selected services'}
                            </span>
                          </div>
                          {selected.expiration_type === 'date' && selected.expiration_date && (
                            <div className="flex items-center justify-between">
                              <span className="text-sm text-muted-foreground">Expires</span>
                              <span className="text-sm">
                                {format(new Date(selected.expiration_date), 'MMM d, yyyy')}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-6">
                <MaterialIcon name="confirmation_number" className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">
                  No promo codes available. Create promo codes in Billing &gt; Promo Codes.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                await handleAssign();
                setAddDialogOpen(false);
              }}
              disabled={!selectedCodeToAdd || adding}
            >
              {adding && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
              Assign Promo Code
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
