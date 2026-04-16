/**
 * AccountPricingTab - Account-specific pricing adjustments management
 * Replaces the old non-functional pricing tab with account_service_settings integration
 */

import { useState, useMemo } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
import { useAccountPricing, AccountServiceSetting } from '@/hooks/useAccountPricing';
import { usePermissions } from '@/hooks/usePermissions';
import { CreateAdjustmentDialog } from './CreateAdjustmentDialog';
import { EditAdjustmentDialog } from './EditAdjustmentDialog';
import { AccountPricingHistoryDialog } from './AccountPricingHistoryDialog';
import { AccountPromoCodesSection } from './AccountPromoCodesSection';
import { AccountCoverageOverridesSection } from './AccountCoverageOverridesSection';
import { AddAccountChargeDialog } from './AddAccountChargeDialog';
import { AddCreditDialog } from '@/components/billing/AddCreditDialog';
import { cn } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/card';

interface AccountPricingTabProps {
  accountId: string;
  accountName: string;
}

export function AccountPricingTab({ accountId, accountName }: AccountPricingTabProps) {
  const { hasRole } = usePermissions();
  const canAddCredit = hasRole('admin') || hasRole('billing_manager');
  const {
    adjustments,
    availableServices,
    loading,
    saving,
    deleteAdjustment,
    deleteAdjustments,
    getExistingServiceKeys,
    refetch,
  } = useAccountPricing(accountId);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [chargeDialogOpen, setChargeDialogOpen] = useState(false);
  const [creditDialogOpen, setCreditDialogOpen] = useState(false);
  const [selectedAdjustment, setSelectedAdjustment] = useState<AccountServiceSetting | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; name: string } | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);

  // Toggle selection
  const toggleSelect = (id: string) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  // Select all / none
  const toggleSelectAll = () => {
    if (selectedIds.size === adjustments.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(adjustments.map((a) => a.id)));
    }
  };

  // Handle edit
  const handleEdit = (adjustment: AccountServiceSetting) => {
    setSelectedAdjustment(adjustment);
    setEditDialogOpen(true);
  };

  // Handle delete
  const handleDelete = async () => {
    if (!deleteConfirm) return;
    await deleteAdjustment(deleteConfirm.id);
    setDeleteConfirm(null);
  };

  // Handle bulk delete
  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    await deleteAdjustments(Array.from(selectedIds));
    setSelectedIds(new Set());
    setBulkDeleteConfirm(false);
  };

  // Format adjustment display
  const formatAdjustment = (adj: AccountServiceSetting): string => {
    if (adj.custom_percent_adjust !== null && adj.custom_percent_adjust !== 0) {
      const sign = adj.custom_percent_adjust >= 0 ? '+' : '';
      return `${sign}${adj.custom_percent_adjust.toFixed(1)}%`;
    }
    if (adj.custom_rate !== null) {
      const diff = adj.custom_rate - (adj.base_rate || 0);
      if (Math.abs(diff) < 0.01) {
        return `Override: $${adj.custom_rate.toFixed(2)}`;
      }
      const sign = diff >= 0 ? '+' : '';
      return `${sign}$${diff.toFixed(2)}`;
    }
    return '-';
  };

  // Get adjustment type badge
  const getAdjustmentBadge = (adj: AccountServiceSetting) => {
    if (adj.custom_percent_adjust !== null && adj.custom_percent_adjust !== 0) {
      return (
        <Badge variant="outline" className="gap-1">
          <MaterialIcon name="percent" className="h-3 w-3" />
          Percentage
        </Badge>
      );
    }
    const diff = (adj.custom_rate || 0) - (adj.base_rate || 0);
    if (Math.abs(diff) < 0.01) {
      return (
        <Badge variant="outline" className="gap-1">
          <MaterialIcon name="attach_money" className="h-3 w-3" />
          Override
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="gap-1">
        <MaterialIcon name="attach_money" className="h-3 w-3" />
        Fixed
      </Badge>
    );
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <MaterialIcon name="progress_activity" className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-medium">Pricing & Charges</h3>
          <p className="text-sm text-muted-foreground">
            Custom pricing and charges for {accountName}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setChargeDialogOpen(true)}>
            <MaterialIcon name="attach_money" size="sm" className="mr-1" />
            Add Charge
          </Button>
          {canAddCredit && (
            <Button type="button" variant="outline" size="sm" onClick={() => setCreditDialogOpen(true)}>
              <MaterialIcon name="money_off" size="sm" className="mr-1" />
              Add Credit
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={() => setHistoryDialogOpen(true)}>
            <MaterialIcon name="history" size="sm" className="mr-1" />
            History
          </Button>
          <Button type="button" size="sm" onClick={() => setCreateDialogOpen(true)}>
            <MaterialIcon name="add" size="sm" className="mr-1" />
            Adjustment
          </Button>
        </div>
      </div>

      {/* Bulk Actions */}
      {selectedIds.size > 0 && (
        <div className="flex items-center gap-4 p-3 bg-muted/50 rounded-lg">
          <span className="text-sm font-medium">
            {selectedIds.size} selected
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelectedIds(new Set())}
          >
            Clear Selection
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setBulkDeleteConfirm(true)}
          >
            <MaterialIcon name="delete" size="sm" className="mr-1" />
            Delete Selected
          </Button>
        </div>
      )}

      {/* Adjustments - Desktop Table / Mobile Cards */}
      {adjustments.length > 0 ? (
        <>
          {/* Desktop Table */}
          <div className="hidden md:block border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selectedIds.size === adjustments.length && adjustments.length > 0}
                      onCheckedChange={toggleSelectAll}
                    />
                  </TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Class</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Base Rate</TableHead>
                  <TableHead className="text-right">Adjustment</TableHead>
                  <TableHead className="text-right">Effective Rate</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {adjustments.map((adj) => (
                  <TableRow key={adj.id}>
                    <TableCell>
                      <Checkbox
                        checked={selectedIds.has(adj.id)}
                        onCheckedChange={() => toggleSelect(adj.id)}
                      />
                    </TableCell>
                    <TableCell>
                      <div>
                        <Badge variant="outline" className="font-mono">
                          {adj.service_code}
                        </Badge>
                        {adj.service_event && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {adj.service_event.service_name}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {adj.class_code ? (
                        <Badge variant="secondary">{adj.class_code}</Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>{getAdjustmentBadge(adj)}</TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      ${(adj.base_rate || 0).toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className={cn(
                          'font-mono',
                          (adj.effective_rate || 0) > (adj.base_rate || 0)
                            ? 'text-red-600'
                            : (adj.effective_rate || 0) < (adj.base_rate || 0)
                            ? 'text-green-600'
                            : ''
                        )}
                      >
                        {formatAdjustment(adj)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <MaterialIcon name="arrow_forward" className="h-3 w-3 text-muted-foreground" />
                        <span className="font-mono font-medium">
                          ${(adj.effective_rate || 0).toFixed(2)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => handleEdit(adj)}
                              >
                                <MaterialIcon name="edit" size="sm" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Edit</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() =>
                                  setDeleteConfirm({
                                    id: adj.id,
                                    name: `${adj.service_code}${adj.class_code ? ` (${adj.class_code})` : ''}`,
                                  })
                                }
                              >
                                <MaterialIcon name="delete" size="sm" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile Cards */}
          <div className="md:hidden space-y-3">
            {adjustments.map((adj) => (
              <Card key={adj.id} className="overflow-hidden">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <Checkbox
                        checked={selectedIds.has(adj.id)}
                        onCheckedChange={() => toggleSelect(adj.id)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-2">
                          <Badge variant="outline" className="font-mono">
                            {adj.service_code}
                          </Badge>
                          {adj.class_code && (
                            <Badge variant="secondary">{adj.class_code}</Badge>
                          )}
                          {getAdjustmentBadge(adj)}
                        </div>
                        {adj.service_event && (
                          <p className="text-sm text-muted-foreground truncate">
                            {adj.service_event.service_name}
                          </p>
                        )}
                        <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                          <div>
                            <p className="text-xs text-muted-foreground">Base</p>
                            <p className="font-mono">${(adj.base_rate || 0).toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Adj</p>
                            <p className={cn(
                              'font-mono',
                              (adj.effective_rate || 0) > (adj.base_rate || 0)
                                ? 'text-red-600'
                                : (adj.effective_rate || 0) < (adj.base_rate || 0)
                                ? 'text-green-600'
                                : ''
                            )}>
                              {formatAdjustment(adj)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs text-muted-foreground">Effective</p>
                            <p className="font-mono font-medium">${(adj.effective_rate || 0).toFixed(2)}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleEdit(adj)}
                      >
                        <MaterialIcon name="edit" size="sm" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() =>
                          setDeleteConfirm({
                            id: adj.id,
                            name: `${adj.service_code}${adj.class_code ? ` (${adj.class_code})` : ''}`,
                          })
                        }
                      >
                        <MaterialIcon name="delete" size="sm" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      ) : (
        <div className="text-center py-12 border rounded-lg bg-muted/20">
          <MaterialIcon name="info" className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No Adjustments Configured</h3>
          <p className="text-muted-foreground mb-4">
            This account uses the default price list. Create an adjustment to override specific service rates.
          </p>
          <Button type="button" onClick={() => setCreateDialogOpen(true)}>
            <MaterialIcon name="add" size="sm" className="mr-1" />
            Create First Adjustment
          </Button>
        </div>
      )}

      {/* Info Box */}
      <div className="rounded-md bg-muted/50 p-4 text-sm text-muted-foreground">
        <p className="font-medium mb-1">Pricing Priority</p>
        <p>
          When calculating charges for this account, adjustments here override the default price list.
          Percentage adjustments are applied to the base rate. Fixed adjustments add/subtract from the base.
          Override adjustments replace the base rate entirely.
        </p>
      </div>

      {/* Promo Codes Section */}
      <div className="pt-6 border-t mt-6">
        <AccountPromoCodesSection accountId={accountId} accountName={accountName} />
      </div>

      {/* Coverage Overrides Section */}
      <div className="pt-6 border-t mt-6">
        <AccountCoverageOverridesSection accountId={accountId} accountName={accountName} />
      </div>

      {/* Create Adjustment Dialog */}
      <CreateAdjustmentDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        accountId={accountId}
        availableServices={availableServices}
        existingServiceKeys={getExistingServiceKeys()}
        onSuccess={() => {
          setCreateDialogOpen(false);
          refetch();
        }}
      />

      {/* Edit Adjustment Dialog */}
      <EditAdjustmentDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        adjustment={selectedAdjustment}
        onSuccess={() => {
          setEditDialogOpen(false);
          setSelectedAdjustment(null);
          refetch();
        }}
      />

      {/* History Dialog */}
      <AccountPricingHistoryDialog
        open={historyDialogOpen}
        onOpenChange={setHistoryDialogOpen}
        accountId={accountId}
        accountName={accountName}
      />

      {/* Add Charge Dialog */}
      <AddAccountChargeDialog
        open={chargeDialogOpen}
        onOpenChange={setChargeDialogOpen}
        accountId={accountId}
        accountName={accountName}
        onSuccess={() => {
          setChargeDialogOpen(false);
        }}
      />

      {/* Add Credit Dialog - Admin Only */}
      <AddCreditDialog
        open={creditDialogOpen}
        onOpenChange={setCreditDialogOpen}
        accountId={accountId}
        accountName={accountName}
        onSuccess={() => {
          setCreditDialogOpen(false);
        }}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Pricing Adjustment?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove the price adjustment for <strong>{deleteConfirm?.name}</strong>?
              This will revert to the default rate for this service.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirmation */}
      <AlertDialog open={bulkDeleteConfirm} onOpenChange={setBulkDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Selected Adjustments?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove {selectedIds.size} pricing adjustment{selectedIds.size !== 1 ? 's' : ''}.
              These services will revert to their default rates.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleBulkDelete}
            >
              Delete {selectedIds.size} Adjustment{selectedIds.size !== 1 ? 's' : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
