import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { useClaims, ClaimItem, PayoutMethod } from '@/hooks/useClaims';
import { useRepairQuoteWorkflow } from '@/hooks/useRepairQuotes';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useNavigate } from 'react-router-dom';
import { AddClaimItemDialog } from './AddClaimItemDialog';

interface ClaimItemsListProps {
  claimId: string;
  claimStatus: string;
  accountId?: string;
  sidemarkId?: string;
  onTotalsChange?: (totals: { requested: number; approved: number; deductible: number }) => void;
  onItemsChange?: () => void;
}

export function ClaimItemsList({ claimId, claimStatus, accountId, sidemarkId, onTotalsChange, onItemsChange }: ClaimItemsListProps) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { fetchClaimItems, updateClaimItem, removeClaimItem, calculateItemPayout, calculateClaimPayout } = useClaims();
  const { createWorkflowQuote } = useRepairQuoteWorkflow();
  const [items, setItems] = useState<ClaimItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addItemDialogOpen, setAddItemDialogOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    requested_amount: string;
    approved_amount: string;
    weight_lbs: string;
    repairable: string;
    repair_cost: string;
    use_repair_cost: boolean;
    payout_method: string;
  }>({
    requested_amount: '',
    approved_amount: '',
    weight_lbs: '',
    repairable: '',
    repair_cost: '',
    use_repair_cost: false,
    payout_method: '',
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<ClaimItem | null>(null);
  const [creatingQuote, setCreatingQuote] = useState(false);

  const loadItems = async () => {
    setLoading(true);
    const data = await fetchClaimItems(claimId);
    setItems(data);
    setLoading(false);

    // Calculate totals
    if (onTotalsChange && data.length > 0) {
      const totals = data.reduce(
        (acc, item) => ({
          requested: acc.requested + (item.requested_amount || 0),
          approved: acc.approved + (item.approved_amount || 0),
          deductible: acc.deductible + (item.deductible_applied || 0),
        }),
        { requested: 0, approved: 0, deductible: 0 }
      );
      onTotalsChange(totals);
    }
  };

  useEffect(() => {
    loadItems();
  }, [claimId]);

  const startEditing = (item: ClaimItem) => {
    setEditingItemId(item.id);
    setEditForm({
      requested_amount: item.requested_amount?.toString() || '',
      approved_amount: item.approved_amount?.toString() || '',
      weight_lbs: item.weight_lbs?.toString() || '',
      repairable: item.repairable === null ? '' : item.repairable ? 'yes' : 'no',
      repair_cost: item.repair_cost?.toString() || '',
      use_repair_cost: item.use_repair_cost || false,
      payout_method: item.payout_method || '',
    });
  };

  const cancelEditing = () => {
    setEditingItemId(null);
    setEditForm({
      requested_amount: '',
      approved_amount: '',
      weight_lbs: '',
      repairable: '',
      repair_cost: '',
      use_repair_cost: false,
      payout_method: '',
    });
  };

  const saveEditing = async () => {
    if (!editingItemId) return;

    const currentItem = items.find(i => i.id === editingItemId);
    const updates: Partial<ClaimItem> = {};

    if (editForm.requested_amount) {
      updates.requested_amount = parseFloat(editForm.requested_amount);
    }
    if (editForm.approved_amount) {
      updates.approved_amount = parseFloat(editForm.approved_amount);
    }
    if (editForm.weight_lbs) {
      updates.weight_lbs = parseFloat(editForm.weight_lbs);
    }
    if (editForm.repairable !== '' && editForm.repairable !== '_none') {
      updates.repairable = editForm.repairable === 'yes';
    }
    if (editForm.repair_cost) {
      updates.repair_cost = parseFloat(editForm.repair_cost);
    }
    if (editForm.payout_method && editForm.payout_method !== '_none') {
      updates.payout_method = editForm.payout_method as PayoutMethod;
    }

    // Handle repair determination
    updates.use_repair_cost = editForm.use_repair_cost;
    if (editForm.use_repair_cost && !currentItem?.use_repair_cost && profile?.id) {
      // Newly set - record who made the determination
      updates.determined_by = profile.id;
      updates.determined_at = new Date().toISOString();
    }

    const success = await updateClaimItem(editingItemId, updates);
    if (success) {
      cancelEditing();
      loadItems();
    }
  };

  const handleDelete = async () => {
    if (!itemToDelete) return;
    const success = await removeClaimItem(itemToDelete.id);
    if (success) {
      setDeleteDialogOpen(false);
      setItemToDelete(null);
      loadItems();
    }
  };

  // Create repair quote for a claim item
  const handleRequestRepairQuote = async (claimItem: ClaimItem) => {
    if (!claimItem.item_id || !accountId) return;

    setCreatingQuote(true);
    try {
      const quote = await createWorkflowQuote({
        item_id: claimItem.item_id,
        account_id: accountId,
        sidemark_id: sidemarkId,
      });

      if (quote) {
        // Link the repair quote to the claim item
        await supabase
          .from('claim_items')
          .update({ repair_quote_id: quote.id })
          .eq('id', claimItem.id);

        loadItems();
      }
    } finally {
      setCreatingQuote(false);
    }
  };

  const getCoverageLabel = (type: string | null) => {
    switch (type) {
      case 'standard': return 'Standard';
      case 'full_replacement_deductible': return 'Full w/ Ded';
      case 'full_replacement_no_deductible': return 'Full';
      case 'pending': return 'Pending';
      default: return 'None';
    }
  };

  const getCoverageBadgeVariant = (type: string | null): 'default' | 'secondary' | 'outline' | 'destructive' => {
    switch (type) {
      case 'full_replacement_no_deductible': return 'default';
      case 'full_replacement_deductible': return 'secondary';
      case 'standard': return 'outline';
      default: return 'destructive';
    }
  };

  const canEdit = ['initiated', 'under_review'].includes(claimStatus);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="inventory_2" size="md" />
            Claim Items
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="inventory_2" size="md" />
              Claim Items
            </CardTitle>
            {canEdit && (
              <Button size="sm" onClick={() => setAddItemDialogOpen(true)}>
                <MaterialIcon name="add" size="sm" className="mr-1" />
                Add Item
              </Button>
            )}
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground text-center py-4">
              No items linked to this claim. {canEdit && 'Click "Add Item" to add inventory or non-inventory items.'}
            </p>
          </CardContent>
        </Card>
        
        <AddClaimItemDialog
          open={addItemDialogOpen}
          onOpenChange={setAddItemDialogOpen}
          claimId={claimId}
          accountId={accountId}
          sidemarkId={sidemarkId}
          onSuccess={() => {
            loadItems();
            onItemsChange?.();
          }}
        />
      </>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="inventory_2" size="md" />
              Claim Items
              <Badge variant="secondary">{items.length}</Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              Items included in this claim with coverage and valuation details
            </CardDescription>
          </div>
          {canEdit && (
            <Button size="sm" onClick={() => setAddItemDialogOpen(true)}>
              <MaterialIcon name="add" size="sm" className="mr-1" />
              Add Item
            </Button>
          )}
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>Coverage</TableHead>
                  <TableHead>POP</TableHead>
                  <TableHead className="text-right">Valuation</TableHead>
                  <TableHead className="text-right">Max Payout</TableHead>
                  <TableHead className="text-right">Requested</TableHead>
                  <TableHead className="text-right">Approved</TableHead>
                  <TableHead>Repairable</TableHead>
                  <TableHead>Payout</TableHead>
                  {canEdit && <TableHead className="w-20">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item) => {
                  const maxPayout = calculateItemPayout(item);
                  const isEditing = editingItemId === item.id;

                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        {item.item ? (
                          <Link
                            to={`/inventory/${item.item.id}`}
                            className="text-primary hover:underline font-mono text-sm"
                          >
                            {item.item.item_code}
                          </Link>
                        ) : item.non_inventory_ref ? (
                          <span className="text-sm text-muted-foreground">
                            {item.non_inventory_ref}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getCoverageBadgeVariant(item.coverage_type)}>
                          {getCoverageLabel(item.coverage_type)}
                        </Badge>
                        {item.coverage_source === 'shipment' && (
                          <div className="text-xs text-muted-foreground mt-1">
                            via Shipment
                          </div>
                        )}
                      </TableCell>
                      {/* POP (Proof of Purchase) Column */}
                      <TableCell>
                        {item.pop_required ? (
                          <div className="space-y-1">
                            {item.pop_provided ? (
                              <Badge className="bg-green-600">
                                <MaterialIcon name="verified" className="h-3 w-3 mr-1" />
                                Provided
                              </Badge>
                            ) : (
                              <Badge variant="destructive">
                                <MaterialIcon name="pending" className="h-3 w-3 mr-1" />
                                Required
                              </Badge>
                            )}
                            {item.pop_value != null && item.pop_provided && (
                              <div className="text-xs text-muted-foreground">
                                ${item.pop_value.toLocaleString()}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-sm">N/A</span>
                        )}
                      </TableCell>
                      {/* Valuation Column */}
                      <TableCell className="text-right">
                        <div className="space-y-1">
                          <div className="text-xs uppercase text-muted-foreground">
                            {item.valuation_method || 'standard'}
                          </div>
                          {item.valuation_basis != null ? (
                            <div className="font-medium">${item.valuation_basis.toLocaleString()}</div>
                          ) : item.coverage_type === 'standard' ? (
                            item.weight_lbs != null ? (
                              <span className="flex items-center gap-1 justify-end">
                                <MaterialIcon name="scale" className="!text-[12px] text-muted-foreground" />
                                {item.weight_lbs} lbs
                              </span>
                            ) : (
                              <span className="text-yellow-600 dark:text-yellow-400 flex items-center gap-1 justify-end text-xs">
                                <MaterialIcon name="warning" className="!text-[12px]" />
                                Need weight
                              </span>
                            )
                          ) : item.declared_value != null ? (
                            <div>${item.declared_value.toLocaleString()}</div>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                          {item.prorated_cap != null && item.coverage_source === 'shipment' && (
                            <div className="text-xs text-muted-foreground">
                              Cap: ${item.prorated_cap.toLocaleString()}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        <span className={maxPayout.useRepairCost ? 'text-green-600' : ''}>
                          ${maxPayout.maxPayout.toFixed(2)}
                        </span>
                        {maxPayout.deductible > 0 && (
                          <span className="text-xs block">
                            (-${maxPayout.deductible} ded.)
                          </span>
                        )}
                        {maxPayout.useRepairCost && maxPayout.repairVsReplace && (
                          <span className="text-xs text-green-600 block">
                            (vs ${maxPayout.repairVsReplace.replacementCost.toFixed(0)} replace)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {isEditing ? (
                          <Input
                            type="number"
                            step="0.01"
                            value={editForm.requested_amount}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, requested_amount: e.target.value }))
                            }
                            className="w-24 h-8 text-right"
                          />
                        ) : item.requested_amount != null ? (
                          `$${item.requested_amount.toFixed(2)}`
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {isEditing ? (
                          <Input
                            type="number"
                            step="0.01"
                            value={editForm.approved_amount}
                            onChange={(e) =>
                              setEditForm((f) => ({ ...f, approved_amount: e.target.value }))
                            }
                            className="w-24 h-8 text-right"
                          />
                        ) : item.approved_amount != null ? (
                          <span className="text-green-600">
                            ${item.approved_amount.toFixed(2)}
                          </span>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <div className="space-y-2">
                            <Select
                              value={editForm.repairable || '_none'}
                              onValueChange={(v) =>
                                setEditForm((f) => ({ ...f, repairable: v === '_none' ? '' : v }))
                              }
                            >
                              <SelectTrigger className="w-20 h-8">
                                <SelectValue placeholder="-" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="_none">-</SelectItem>
                                <SelectItem value="yes">Yes</SelectItem>
                                <SelectItem value="no">No</SelectItem>
                              </SelectContent>
                            </Select>
                            {editForm.repairable === 'yes' && (
                              <div className="space-y-1.5">
                                <div className="flex items-center gap-1">
                                  <span className="text-xs text-muted-foreground">$</span>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    placeholder="Repair cost"
                                    value={editForm.repair_cost}
                                    onChange={(e) =>
                                      setEditForm((f) => ({ ...f, repair_cost: e.target.value }))
                                    }
                                    className="w-20 h-7 text-right text-xs"
                                  />
                                </div>
                                {editForm.repair_cost && (
                                  <div className="flex items-center gap-1.5">
                                    <Checkbox
                                      id={`repair-${item.id}`}
                                      checked={editForm.use_repair_cost}
                                      onCheckedChange={(checked) =>
                                        setEditForm((f) => ({ ...f, use_repair_cost: !!checked }))
                                      }
                                      className="h-3.5 w-3.5"
                                    />
                                    <label htmlFor={`repair-${item.id}`} className="text-xs text-muted-foreground cursor-pointer">
                                      Use repair cost
                                    </label>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ) : item.repairable === true ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="gap-1">
                                <MaterialIcon name="build" className="!text-[12px]" />
                                Yes
                              </Badge>
                              {item.repair_quote_id ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-6 px-2 text-xs"
                                  onClick={() => navigate('/repair-quotes')}
                                >
                                  <MaterialIcon name="open_in_new" className="!text-[12px] mr-1" />
                                  Quote
                                </Button>
                              ) : canEdit && item.item_id && accountId && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 px-2 text-xs"
                                  disabled={creatingQuote}
                                  onClick={() => handleRequestRepairQuote(item)}
                                >
                                  {creatingQuote ? (
                                    <MaterialIcon name="progress_activity" className="!text-[12px] animate-spin" />
                                  ) : (
                                    <>
                                      <MaterialIcon name="description" className="!text-[12px] mr-1" />
                                      Get Quote
                                    </>
                                  )}
                                </Button>
                              )}
                            </div>
                            {item.repair_cost != null && (
                              <div className="text-xs">
                                <span className="text-muted-foreground">Cost: </span>
                                <span className={item.use_repair_cost ? 'text-green-600 font-medium' : ''}>
                                  ${item.repair_cost.toFixed(2)}
                                </span>
                                {item.use_repair_cost && (
                                  <Badge variant="secondary" className="ml-1.5 text-[10px] py-0 px-1">
                                    <MaterialIcon name="swap_horiz" className="!text-[10px] mr-0.5" />
                                    Repair
                                  </Badge>
                                )}
                              </div>
                            )}
                          </div>
                        ) : item.repairable === false ? (
                          'No'
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      <TableCell>
                        {isEditing ? (
                          <Select
                            value={editForm.payout_method || '_none'}
                            onValueChange={(v) =>
                              setEditForm((f) => ({ ...f, payout_method: v === '_none' ? '' : v }))
                            }
                          >
                            <SelectTrigger className="w-24 h-8">
                              <SelectValue placeholder="-" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="_none">-</SelectItem>
                              <SelectItem value="credit">Credit</SelectItem>
                              <SelectItem value="check">Check</SelectItem>
                              <SelectItem value="repair_vendor_pay">Vendor</SelectItem>
                            </SelectContent>
                          </Select>
                        ) : item.payout_method ? (
                          <Badge variant="secondary" className="capitalize">
                            {item.payout_method.replace('_', ' ')}
                          </Badge>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      {canEdit && (
                        <TableCell>
                          {isEditing ? (
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={saveEditing}
                              >
                                <MaterialIcon name="save" size="sm" className="text-green-600" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={cancelEditing}
                              >
                                <MaterialIcon name="close" size="sm" />
                              </Button>
                            </div>
                          ) : (
                            <div className="flex gap-1">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                onClick={() => startEditing(item)}
                              >
                                <MaterialIcon name="edit" size="sm" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                                onClick={() => {
                                  setItemToDelete(item);
                                  setDeleteDialogOpen(true);
                                }}
                              >
                                <MaterialIcon name="delete" size="sm" />
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Totals Summary */}
          <div className="mt-4 pt-4 border-t">
            {(() => {
              const claimTotals = calculateClaimPayout(items);
              const hasStandardWithoutWeight = items.some(
                i => i.coverage_type === 'standard' && !i.weight_lbs
              );

              return (
                <div className="space-y-3">
                  {hasStandardWithoutWeight && (
                    <div className="flex items-start gap-2 text-sm text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-md">
                      <MaterialIcon name="warning" size="sm" className="mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="font-medium">Weight required for accurate payout</p>
                        <p className="text-xs mt-1 text-yellow-600/80 dark:text-yellow-400/80">
                          Some items with standard coverage ($0.72/lb) are missing weight.
                          Edit the item to add weight for accurate payout calculation.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap justify-end gap-x-8 gap-y-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Total Requested:</span>{' '}
                      <span className="font-medium">
                        ${items.reduce((sum, i) => sum + (i.requested_amount || 0), 0).toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Max Calculated:</span>{' '}
                      <span className="font-medium">
                        ${claimTotals.totalCalculatedPayout.toFixed(2)}
                      </span>
                    </div>
                    {claimTotals.deductibleApplied > 0 && (
                      <div>
                        <span className="text-muted-foreground">Deductible (per claim):</span>{' '}
                        <span className="font-medium text-red-600">
                          -${claimTotals.deductibleApplied.toFixed(2)}
                        </span>
                      </div>
                    )}
                    <div>
                      <span className="text-muted-foreground">Net Max Payout:</span>{' '}
                      <span className="font-bold">
                        ${claimTotals.netPayout.toFixed(2)}
                      </span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Total Approved:</span>{' '}
                      <span className="font-bold text-green-600">
                        ${items.reduce((sum, i) => sum + (i.approved_amount || 0), 0).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove Item from Claim</DialogTitle>
            <DialogDescription>
              Are you sure you want to remove{' '}
              <span className="font-mono">
                {itemToDelete?.item?.item_code || itemToDelete?.non_inventory_ref}
              </span>{' '}
              from this claim? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Item Dialog */}
      <AddClaimItemDialog
        open={addItemDialogOpen}
        onOpenChange={setAddItemDialogOpen}
        claimId={claimId}
        accountId={accountId}
        sidemarkId={sidemarkId}
        onSuccess={() => {
          loadItems();
          onItemsChange?.();
        }}
      />
    </>
  );
}
