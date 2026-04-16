import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { useWarehouses } from '@/hooks/useWarehouses';
import { useLocations } from '@/hooks/useLocations';
import { useAccounts } from '@/hooks/useAccounts';
import { CreateStocktakeData } from '@/hooks/useStocktakes';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from '@/lib/utils';

interface CreateStocktakeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateStocktakeData) => Promise<void>;
}

export function CreateStocktakeDialog({
  open,
  onOpenChange,
  onSubmit,
}: CreateStocktakeDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [accountSearchOpen, setAccountSearchOpen] = useState(false);
  const [accountSearch, setAccountSearch] = useState('');
  const [formData, setFormData] = useState<CreateStocktakeData>({
    name: '',
    warehouse_id: '',
    location_ids: [],
    freeze_moves: true,
    allow_location_auto_fix: false,
    billable: false,
    include_accounts: [],
    scheduled_date: '',
    notes: '',
  });

  const { warehouses } = useWarehouses();
  const { locations } = useLocations(formData.warehouse_id || undefined);
  const { accounts } = useAccounts();

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setFormData({
        name: '',
        warehouse_id: '',
        location_ids: [],
        freeze_moves: true,
        allow_location_auto_fix: false,
        billable: false,
        include_accounts: [],
        scheduled_date: '',
        notes: '',
      });
      setAccountSearch('');
    }
  }, [open]);

  // Filtered accounts based on search
  const filteredAccounts = useMemo(() => {
    if (!accountSearch) return accounts;
    const search = accountSearch.toLowerCase();
    return accounts.filter(
      a => a.account_name.toLowerCase().includes(search) ||
           a.account_code?.toLowerCase().includes(search)
    );
  }, [accounts, accountSearch]);

  // Reset locations when warehouse changes
  useEffect(() => {
    setFormData(prev => ({ ...prev, location_ids: [] }));
  }, [formData.warehouse_id]);

  const handleSubmit = async () => {
    if (!formData.warehouse_id) return;

    setIsSubmitting(true);
    try {
      await onSubmit({
        ...formData,
        location_ids: formData.location_ids?.length ? formData.location_ids : undefined,
        include_accounts: formData.include_accounts?.length ? formData.include_accounts : undefined,
        scheduled_date: formData.scheduled_date || undefined,
        notes: formData.notes || undefined,
      });
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleLocation = (locationId: string) => {
    setFormData(prev => ({
      ...prev,
      location_ids: prev.location_ids?.includes(locationId)
        ? prev.location_ids.filter(id => id !== locationId)
        : [...(prev.location_ids || []), locationId],
    }));
  };

  const toggleAccount = (accountId: string) => {
    setFormData(prev => ({
      ...prev,
      include_accounts: prev.include_accounts?.includes(accountId)
        ? prev.include_accounts.filter(id => id !== accountId)
        : [...(prev.include_accounts || []), accountId],
    }));
  };

  const removeAccount = (accountId: string) => {
    setFormData(prev => ({
      ...prev,
      include_accounts: prev.include_accounts?.filter(id => id !== accountId) || [],
    }));
  };

  const selectedAccounts = accounts.filter(a => formData.include_accounts?.includes(a.id));

  const selectAllLocations = () => {
    setFormData(prev => ({
      ...prev,
      location_ids: locations.map(l => l.id),
    }));
  };

  const clearAllLocations = () => {
    setFormData(prev => ({
      ...prev,
      location_ids: [],
    }));
  };

  const activeLocations = locations.filter(l => l.is_active !== false);
  const selectedLocationCount = formData.location_ids?.length || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Create Stocktake</DialogTitle>
          <DialogDescription>
            Set up a new cycle count for selected warehouse locations.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4 -mr-4">
          <div className="space-y-6 py-4">
            {/* Basic Info */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Name (Optional)</Label>
                <Input
                  id="name"
                  placeholder="e.g., January Zone A Count"
                  value={formData.name || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="warehouse">Warehouse *</Label>
                <Select
                  value={formData.warehouse_id}
                  onValueChange={(v) => setFormData(prev => ({ ...prev, warehouse_id: v }))}
                >
                  <SelectTrigger id="warehouse">
                    <SelectValue placeholder="Select warehouse" />
                  </SelectTrigger>
                  <SelectContent>
                    {warehouses.map((wh) => (
                      <SelectItem key={wh.id} value={wh.id}>
                        {wh.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Location Selection */}
            {formData.warehouse_id && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2">
                    <MaterialIcon name="location_on" size="sm" />
                    Locations
                    {selectedLocationCount > 0 && (
                      <Badge variant="secondary">{selectedLocationCount} selected</Badge>
                    )}
                  </Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={selectAllLocations}
                    >
                      Select All
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={clearAllLocations}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  {selectedLocationCount === 0
                    ? 'Leave empty to count entire warehouse'
                    : `${selectedLocationCount} location${selectedLocationCount !== 1 ? 's' : ''} selected`}
                </p>
                <div className="border rounded-lg p-3 max-h-48 overflow-y-auto">
                  {activeLocations.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No active locations in this warehouse
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {activeLocations.map((location) => {
                        const isSelected = formData.location_ids?.includes(location.id);
                        return (
                          <button
                            key={location.id}
                            type="button"
                            onClick={() => toggleLocation(location.id)}
                            className={cn(
                              'flex items-center gap-2 p-2 rounded-md text-left text-sm transition-colors',
                              isSelected
                                ? 'bg-primary/20 border border-primary'
                                : 'bg-muted/50 border border-transparent hover:bg-muted'
                            )}
                          >
                            <Checkbox checked={isSelected} className="pointer-events-none" />
                            <span className="font-mono truncate">{location.code}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Options */}
            <Accordion type="single" collapsible defaultValue="options">
              <AccordionItem value="options">
                <AccordionTrigger className="text-sm font-medium">
                  Options & Settings
                </AccordionTrigger>
                <AccordionContent>
                  <div className="space-y-4 pt-2">
                    {/* Freeze Moves */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-start gap-3">
                        <MaterialIcon name="lock" size="md" className="text-muted-foreground mt-0.5" />
                        <div>
                          <Label htmlFor="freeze-moves" className="cursor-pointer">
                            Freeze Moves
                          </Label>
                          <p className="text-sm text-muted-foreground">
                            Block all item movements in selected locations until count is complete
                          </p>
                        </div>
                      </div>
                      <Switch
                        id="freeze-moves"
                        checked={formData.freeze_moves}
                        onCheckedChange={(checked) =>
                          setFormData(prev => ({ ...prev, freeze_moves: checked }))
                        }
                      />
                    </div>

                    {/* Auto-Fix Location */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-start gap-3">
                        <MaterialIcon name="build" size="md" className="text-muted-foreground mt-0.5" />
                        <div>
                          <Label htmlFor="auto-fix" className="cursor-pointer">
                            Auto-Fix Locations
                          </Label>
                          <p className="text-sm text-muted-foreground">
                            Automatically update item location when found at different location
                          </p>
                        </div>
                      </div>
                      <Switch
                        id="auto-fix"
                        checked={formData.allow_location_auto_fix}
                        onCheckedChange={(checked) =>
                          setFormData(prev => ({ ...prev, allow_location_auto_fix: checked }))
                        }
                      />
                    </div>

                    {/* Billable */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-start gap-3">
                        <MaterialIcon name="attach_money" size="md" className="text-muted-foreground mt-0.5" />
                        <div>
                          <Label htmlFor="billable" className="cursor-pointer">
                            Billable
                          </Label>
                          <p className="text-sm text-muted-foreground">
                            Create billing events for scanned items when stocktake is closed
                          </p>
                        </div>
                      </div>
                      <Switch
                        id="billable"
                        checked={formData.billable}
                        onCheckedChange={(checked) =>
                          setFormData(prev => ({ ...prev, billable: checked }))
                        }
                      />
                    </div>

                    {/* Account Selection (for billing) - Searchable Multi-Select */}
                    {formData.billable && (
                      <div className="space-y-3 pl-8">
                        <Label>Bill Specific Accounts (Searchable Multi-Select)</Label>
                        <p className="text-sm text-muted-foreground">
                          Leave empty to bill all accounts with items in selected locations
                        </p>

                        {/* Selected accounts display */}
                        {selectedAccounts.length > 0 && (
                          <div className="flex flex-wrap gap-2 mb-2">
                            {selectedAccounts.map((account) => (
                              <Badge
                                key={account.id}
                                variant="secondary"
                                className="flex items-center gap-1"
                              >
                                {account.account_name}
                                <MaterialIcon
                                  name="close"
                                  className="h-3 w-3 cursor-pointer hover:text-destructive"
                                  onClick={() => removeAccount(account.id)}
                                />
                              </Badge>
                            ))}
                          </div>
                        )}

                        {/* Searchable account selector */}
                        <Popover open={accountSearchOpen} onOpenChange={setAccountSearchOpen}>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              role="combobox"
                              aria-expanded={accountSearchOpen}
                              className="w-full justify-between"
                            >
                              <span className="flex items-center gap-2">
                                <MaterialIcon name="search" size="sm" />
                                Search and select accounts...
                              </span>
                              <MaterialIcon name="unfold_more" size="sm" className="ml-2 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className="w-[400px] p-0" align="start">
                            <Command>
                              <CommandInput
                                placeholder="Search accounts..."
                                value={accountSearch}
                                onValueChange={setAccountSearch}
                              />
                              <CommandList>
                                <CommandEmpty>No accounts found.</CommandEmpty>
                                <CommandGroup>
                                  {filteredAccounts.map((account) => (
                                    <CommandItem
                                      key={account.id}
                                      value={account.id}
                                      onSelect={() => {
                                        toggleAccount(account.id);
                                      }}
                                    >
                                      <div className="flex items-center gap-2 flex-1">
                                        <Checkbox
                                          checked={formData.include_accounts?.includes(account.id) || false}
                                        />
                                        <div>
                                          <div className="font-medium">{account.account_name}</div>
                                          {account.account_code && (
                                            <div className="text-xs text-muted-foreground">
                                              {account.account_code}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      {formData.include_accounts?.includes(account.id) && (
                                        <MaterialIcon name="check_circle" size="sm" className="text-primary" />
                                      )}
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      </div>
                    )}

                    {/* Scheduled Date */}
                    <div className="space-y-2">
                      <Label htmlFor="scheduled-date">Scheduled Date (Optional)</Label>
                      <Input
                        id="scheduled-date"
                        type="date"
                        value={formData.scheduled_date || ''}
                        onChange={(e) =>
                          setFormData(prev => ({ ...prev, scheduled_date: e.target.value }))
                        }
                      />
                    </div>

                    {/* Notes */}
                    <div className="space-y-2">
                      <Label htmlFor="notes">Notes (Optional)</Label>
                      <Textarea
                        id="notes"
                        placeholder="Any additional notes..."
                        value={formData.notes || ''}
                        onChange={(e) =>
                          setFormData(prev => ({ ...prev, notes: e.target.value }))
                        }
                        rows={2}
                      />
                    </div>
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {/* Summary */}
            {formData.warehouse_id && (
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <p className="text-sm font-medium">Summary</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li className="flex items-center gap-2">
                    <MaterialIcon name="check_circle" size="sm" className="text-green-500" />
                    Warehouse: {warehouses.find(w => w.id === formData.warehouse_id)?.name}
                  </li>
                  <li className="flex items-center gap-2">
                    <MaterialIcon name="check_circle" size="sm" className="text-green-500" />
                    Locations: {selectedLocationCount === 0 ? 'Entire warehouse' : `${selectedLocationCount} selected`}
                  </li>
                  <li className="flex items-center gap-2">
                    {formData.freeze_moves ? (
                      <MaterialIcon name="lock" size="sm" className="text-yellow-500" />
                    ) : (
                      <MaterialIcon name="close" size="sm" className="text-muted-foreground" />
                    )}
                    Freeze moves: {formData.freeze_moves ? 'Yes' : 'No'}
                  </li>
                  <li className="flex items-center gap-2">
                    {formData.allow_location_auto_fix ? (
                      <MaterialIcon name="build" size="sm" className="text-blue-500" />
                    ) : (
                      <MaterialIcon name="close" size="sm" className="text-muted-foreground" />
                    )}
                    Auto-fix: {formData.allow_location_auto_fix ? 'Yes' : 'No'}
                  </li>
                  <li className="flex items-center gap-2">
                    {formData.billable ? (
                      <MaterialIcon name="attach_money" size="sm" className="text-green-500" />
                    ) : (
                      <MaterialIcon name="close" size="sm" className="text-muted-foreground" />
                    )}
                    Billable: {formData.billable ? 'Yes' : 'No'}
                  </li>
                </ul>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isSubmitting || !formData.warehouse_id}
          >
            {isSubmitting && <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-2" />}
            Create Stocktake
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
