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
import { CreateManifestData } from '@/hooks/useManifests';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from '@/lib/utils';

interface CreateManifestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: CreateManifestData) => Promise<void>;
}

export function CreateManifestDialog({
  open,
  onOpenChange,
  onSubmit,
}: CreateManifestDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [accountSearchOpen, setAccountSearchOpen] = useState(false);
  const [accountSearch, setAccountSearch] = useState('');
  const [formData, setFormData] = useState<CreateManifestData>({
    name: '',
    description: '',
    warehouse_id: '',
    location_ids: [],
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
        description: '',
        warehouse_id: '',
        location_ids: [],
        billable: false,
        include_accounts: [],
        scheduled_date: '',
        notes: '',
      });
      setAccountSearch('');
    }
  }, [open]);

  // Reset locations when warehouse changes
  useEffect(() => {
    setFormData(prev => ({ ...prev, location_ids: [] }));
  }, [formData.warehouse_id]);

  // Filtered accounts based on search
  const filteredAccounts = useMemo(() => {
    if (!accountSearch) return accounts;
    const search = accountSearch.toLowerCase();
    return accounts.filter(
      a => a.account_name.toLowerCase().includes(search) ||
           a.account_code?.toLowerCase().includes(search)
    );
  }, [accounts, accountSearch]);

  const handleSubmit = async () => {
    if (!formData.warehouse_id || !formData.name) return;

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
  const selectedAccounts = accounts.filter(a => formData.include_accounts?.includes(a.id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Create Manifest</DialogTitle>
          <DialogDescription>
            Create a new manifest with pre-defined items for targeted stocktake.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 pr-4 -mr-4">
          <div className="space-y-6 py-4">
            {/* Basic Info */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  placeholder="e.g., Q1 Pallet Check Zone A"
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

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Optional description of this manifest..."
                value={formData.description || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                rows={2}
              />
            </div>

            {/* Location Selection (Zone) */}
            {formData.warehouse_id && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="flex items-center gap-2">
                    <MaterialIcon name="location_on" size="sm" />
                    Zone (Locations)
                    {selectedLocationCount > 0 && (
                      <Badge variant="secondary" className="ml-2">
                        {selectedLocationCount} selected
                      </Badge>
                    )}
                  </Label>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={selectAllLocations}
                    >
                      Select All
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={clearAllLocations}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">
                  Select specific locations for this manifest. Leave empty to include all locations.
                </p>
                <ScrollArea className="h-40 border rounded-md p-2">
                  {activeLocations.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      No locations found in this warehouse
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {activeLocations.map((loc) => (
                        <div
                          key={loc.id}
                          className={cn(
                            'flex items-center gap-2 p-2 rounded-md border cursor-pointer transition-colors',
                            formData.location_ids?.includes(loc.id)
                              ? 'bg-primary/10 border-primary'
                              : 'hover:bg-accent'
                          )}
                          onClick={() => toggleLocation(loc.id)}
                        >
                          <Checkbox
                            checked={formData.location_ids?.includes(loc.id) || false}
                            onCheckedChange={() => toggleLocation(loc.id)}
                          />
                          <div className="text-sm truncate">
                            <span className="font-medium">{loc.code}</span>
                            {loc.name && (
                              <span className="text-muted-foreground ml-1">({loc.name})</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </div>
            )}

            {/* Billing Options */}
            <Accordion type="single" collapsible className="border rounded-lg">
              <AccordionItem value="billing" className="border-0">
                <AccordionTrigger className="px-4 hover:no-underline">
                  <div className="flex items-center gap-2">
                    <MaterialIcon name="attach_money" size="sm" />
                    Billing Options
                    {formData.billable && (
                      <Badge variant="secondary" className="bg-green-500/20 text-green-400">
                        Billable
                      </Badge>
                    )}
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 pb-4">
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <Label>Billable Manifest</Label>
                        <p className="text-sm text-muted-foreground">
                          Create billing events when manifest is completed
                        </p>
                      </div>
                      <Switch
                        checked={formData.billable || false}
                        onCheckedChange={(checked) =>
                          setFormData(prev => ({ ...prev, billable: checked }))
                        }
                      />
                    </div>

                    {formData.billable && (
                      <div className="space-y-3">
                        <Label>Bill Specific Accounts (Searchable Multi-Select)</Label>
                        <p className="text-sm text-muted-foreground">
                          Leave empty to bill all accounts with items on the manifest
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
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {/* Additional Options */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="scheduled_date">Scheduled Date</Label>
                <Input
                  id="scheduled_date"
                  type="date"
                  value={formData.scheduled_date || ''}
                  onChange={(e) => setFormData(prev => ({ ...prev, scheduled_date: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                placeholder="Additional notes..."
                value={formData.notes || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
                rows={2}
              />
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="pt-4 border-t">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!formData.warehouse_id || !formData.name || isSubmitting}
          >
            {isSubmitting && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
            Create Manifest
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
