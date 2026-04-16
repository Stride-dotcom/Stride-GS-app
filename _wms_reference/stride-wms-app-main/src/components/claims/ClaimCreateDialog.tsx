import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useClaims, ClaimType, CLAIM_TYPE_LABELS } from '@/hooks/useClaims';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from '@/lib/utils';

interface ClaimCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Pre-filled context
  itemId?: string;
  shipmentId?: string;
  itemIds?: string[]; // For multi-select from inventory
  accountId?: string;
  sidemarkId?: string;
}

interface Account {
  id: string;
  account_name: string;
}

interface Sidemark {
  id: string;
  sidemark_name: string;
  account_id: string;
}

interface Item {
  id: string;
  item_code: string;
  description: string | null;
  account_id: string | null;
  sidemark_id: string | null;
  coverage_type: string | null;
  declared_value: number | null;
  weight_lbs: number | null;
  primary_photo_url: string | null;
}

interface Shipment {
  id: string;
  shipment_number: string;
  account_id: string | null;
  sidemark_id: string | null;
}

type ClaimContext = 'items' | 'shipment' | 'property';

export function ClaimCreateDialog({
  open,
  onOpenChange,
  itemId: initialItemId,
  shipmentId: initialShipmentId,
  itemIds: initialItemIds,
  accountId: initialAccountId,
  sidemarkId: initialSidemarkId,
}: ClaimCreateDialogProps) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { createClaim } = useClaims();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [context, setContext] = useState<ClaimContext>('items');

  // Reference data
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sidemarks, setSidemarks] = useState<Sidemark[]>([]);
  const [availableItems, setAvailableItems] = useState<Item[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  // Form state
  const [selectedAccountId, setSelectedAccountId] = useState<string>(initialAccountId || '');
  const [selectedSidemarkId, setSelectedSidemarkId] = useState<string>(initialSidemarkId || '');
  const [selectedItems, setSelectedItems] = useState<Item[]>([]);
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [itemSelectOpen, setItemSelectOpen] = useState(false);

  const [selectedShipmentId, setSelectedShipmentId] = useState<string>(initialShipmentId || '');
  const [shipmentSearch, setShipmentSearch] = useState('');
  const [searchedShipments, setSearchedShipments] = useState<Shipment[]>([]);

  // Property damage fields
  const [nonInventoryRef, setNonInventoryRef] = useState('');
  const [incidentLocation, setIncidentLocation] = useState('');
  const [incidentContactName, setIncidentContactName] = useState('');
  const [incidentContactPhone, setIncidentContactPhone] = useState('');
  const [incidentContactEmail, setIncidentContactEmail] = useState('');

  // Claim data
  const [claimType, setClaimType] = useState<ClaimType>('handling_damage');
  const [description, setDescription] = useState('');
  const [incidentDate, setIncidentDate] = useState('');

  useEffect(() => {
    if (open && profile?.tenant_id) {
      loadAccounts();
    }
  }, [open, profile?.tenant_id]);

  useEffect(() => {
    if (selectedAccountId) {
      loadSidemarks(selectedAccountId);
      loadItems();
    } else {
      setSidemarks([]);
      setAvailableItems([]);
    }
  }, [selectedAccountId]);

  useEffect(() => {
    if (selectedAccountId) {
      loadItems();
    }
  }, [selectedSidemarkId]);

  // Set initial context and items based on props
  useEffect(() => {
    if (open) {
      if (initialShipmentId) {
        setContext('shipment');
        setSelectedShipmentId(initialShipmentId);
      } else if (initialItemIds?.length || initialItemId) {
        setContext('items');
        // Load initial items
        const ids = initialItemIds?.length ? initialItemIds : (initialItemId ? [initialItemId] : []);
        if (ids.length > 0) {
          loadInitialItems(ids);
        }
      }
    }
  }, [open, initialItemId, initialShipmentId, initialItemIds]);

  const loadAccounts = async () => {
    const { data } = await supabase
      .from('accounts')
      .select('id, account_name')
      .eq('tenant_id', profile?.tenant_id)
      .eq('is_active', true)
      .order('account_name');
    setAccounts(data || []);
  };

  const loadSidemarks = async (accountId: string) => {
    const { data } = await supabase
      .from('sidemarks')
      .select('id, sidemark_name, account_id')
      .eq('account_id', accountId)
      .is('deleted_at', null)
      .order('sidemark_name');
    setSidemarks(data || []);
  };

  const loadItems = async () => {
    if (!selectedAccountId) return;
    setLoadingItems(true);

    let query = supabase
      .from('items')
      .select('id, item_code, description, account_id, sidemark_id, coverage_type, declared_value, weight_lbs, primary_photo_url')
      .eq('tenant_id', profile?.tenant_id)
      .eq('account_id', selectedAccountId)
      .is('deleted_at', null)
      .in('status', ['active', 'in_storage', 'received', 'pending_receipt'])
      .order('item_code')
      .limit(200);

    if (selectedSidemarkId) {
      query = query.eq('sidemark_id', selectedSidemarkId);
    }

    const { data } = await query;
    setAvailableItems((data || []) as Item[]);
    setLoadingItems(false);
  };

  const loadInitialItems = async (ids: string[]) => {
    const { data } = await supabase
      .from('items')
      .select('id, item_code, description, account_id, sidemark_id, coverage_type, declared_value, weight_lbs, primary_photo_url')
      .in('id', ids);

    if (data && data.length > 0) {
      setSelectedItems(data as Item[]);
      // Set account from first item if not already set
      if (!selectedAccountId && data[0].account_id) {
        setSelectedAccountId(data[0].account_id);
      }
    }
  };

  const searchShipments = async (query: string) => {
    if (!query || query.length < 2 || !profile?.tenant_id) {
      setSearchedShipments([]);
      return;
    }
    const { data, error } = await supabase
      .from('shipments')
      .select('id, shipment_number, account_id, sidemark_id')
      .eq('tenant_id', profile.tenant_id)
      .ilike('shipment_number', `%${query}%`)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Error searching shipments:', error);
      setSearchedShipments([]);
      return;
    }
    setSearchedShipments(data || []);
  };

  const handleShipmentSelect = (shipment: Shipment) => {
    setSelectedShipmentId(shipment.id);
    setShipmentSearch(shipment.shipment_number);
    if (shipment.account_id) setSelectedAccountId(shipment.account_id);
    if (shipment.sidemark_id) setSelectedSidemarkId(shipment.sidemark_id);
    setSearchedShipments([]);
  };

  const toggleItemSelection = (item: Item) => {
    setSelectedItems(prev => {
      const isSelected = prev.some(i => i.id === item.id);
      if (isSelected) {
        return prev.filter(i => i.id !== item.id);
      } else {
        return [...prev, item];
      }
    });
  };

  const removeSelectedItem = (itemId: string) => {
    setSelectedItems(prev => prev.filter(i => i.id !== itemId));
  };

  const filteredAvailableItems = useMemo(() => {
    if (!itemSearchQuery) return availableItems;
    const query = itemSearchQuery.toLowerCase();
    return availableItems.filter(
      item =>
        item.item_code.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query)
    );
  }, [availableItems, itemSearchQuery]);

  const handleSubmit = async () => {
    if (!description.trim()) return;
    if (context === 'items' && selectedItems.length === 0) {
      return;
    }
    if (context !== 'property' && !selectedAccountId) return;

    setIsSubmitting(true);
    try {
      // Determine claim category based on type
      const claimCategory = claimType === 'shipping_damage' ? 'shipping_damage' : 'liability';
      
      const claim = await createClaim({
        claim_type: claimType,
        claim_category: claimCategory,
        account_id: selectedAccountId,
        sidemark_id: selectedSidemarkId || null,
        shipment_id: context === 'shipment' ? selectedShipmentId : null,
        item_ids: context === 'items' ? selectedItems.map(i => i.id) : undefined,
        non_inventory_ref: context === 'property' ? nonInventoryRef : null,
        incident_location: context === 'property' ? incidentLocation : null,
        incident_contact_name: context === 'property' ? incidentContactName : null,
        incident_contact_phone: context === 'property' ? incidentContactPhone : null,
        incident_contact_email: context === 'property' ? incidentContactEmail : null,
        incident_date: incidentDate || null,
        description,
      });

      if (claim) {
        onOpenChange(false);
        navigate(`/claims/${claim.id}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setContext('items');
    setSelectedAccountId(initialAccountId || '');
    setSelectedSidemarkId(initialSidemarkId || '');
    setSelectedItems([]);
    setItemSearchQuery('');
    setSelectedShipmentId(initialShipmentId || '');
    setShipmentSearch('');
    setNonInventoryRef('');
    setIncidentLocation('');
    setIncidentContactName('');
    setIncidentContactPhone('');
    setIncidentContactEmail('');
    setClaimType('handling_damage');
    setDescription('');
    setIncidentDate('');
  };

  const getCoverageLabel = (type: string | null) => {
    switch (type) {
      case 'standard': return 'Standard ($0.72/lb)';
      case 'full_replacement_deductible': return 'Full w/ Deductible';
      case 'full_replacement_no_deductible': return 'Full Replacement';
      case 'pending': return 'Pending';
      default: return 'None';
    }
  };

  const getCoverageBadgeVariant = (type: string | null) => {
    switch (type) {
      case 'full_replacement_no_deductible': return 'default';
      case 'full_replacement_deductible': return 'secondary';
      case 'standard': return 'outline';
      case 'pending': return 'destructive';
      default: return 'destructive';
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) resetForm(); onOpenChange(o); }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>File New Claim</DialogTitle>
          <DialogDescription>
            Create a claim for damage, loss, or other incidents.
          </DialogDescription>
        </DialogHeader>

        <div className="pr-1">
          <div className="space-y-6 py-2">
            {/* Context Selector */}
            <div className="space-y-2">
              <Label>Claim Context</Label>
              <Tabs value={context} onValueChange={(v) => setContext(v as ClaimContext)}>
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="items" className="flex items-center gap-1">
                    <MaterialIcon name="inventory_2" size="sm" />
                    Items
                  </TabsTrigger>
                  <TabsTrigger value="shipment" className="flex items-center gap-1">
                    <MaterialIcon name="local_shipping" size="sm" />
                    Shipment
                  </TabsTrigger>
                  <TabsTrigger value="property" className="flex items-center gap-1">
                    <MaterialIcon name="location_on" size="sm" />
                    Property
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="items" className="space-y-4 mt-4">
                  {/* Account Selection */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Account *</Label>
                      <Select value={selectedAccountId} onValueChange={(v) => {
                        setSelectedAccountId(v);
                        setSelectedSidemarkId('');
                        setSelectedItems([]);
                      }}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select account" />
                        </SelectTrigger>
                        <SelectContent>
                          {accounts.map((acc) => (
                            <SelectItem key={acc.id} value={acc.id}>{acc.account_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Sidemark / Project (Optional)</Label>
                      <Select
                        value={selectedSidemarkId || '_all'}
                        onValueChange={(v) => setSelectedSidemarkId(v === '_all' ? '' : v)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Filter by sidemark" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="_all">All Sidemarks</SelectItem>
                          {sidemarks.map((sm) => (
                            <SelectItem key={sm.id} value={sm.id}>{sm.sidemark_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Item Multi-Select */}
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      Select Items *
                      {selectedItems.length > 0 && (
                        <Badge variant="secondary">{selectedItems.length} selected</Badge>
                      )}
                    </Label>

                    {!selectedAccountId ? (
                      <div className="text-sm text-muted-foreground border rounded-md p-4 text-center">
                        <MaterialIcon name="warning" size="md" className="mx-auto mb-2 text-muted-foreground" />
                        Select an account first to see available items
                      </div>
                    ) : (
                      <Popover open={itemSelectOpen} onOpenChange={setItemSelectOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            role="combobox"
                            aria-expanded={itemSelectOpen}
                            className="w-full justify-between"
                          >
                            <span className="truncate">
                              {selectedItems.length > 0
                                ? `${selectedItems.length} item${selectedItems.length > 1 ? 's' : ''} selected`
                                : 'Search and select items...'}
                            </span>
                            <MaterialIcon name="unfold_more" size="sm" className="ml-2 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[500px] p-0" align="start">
                          <Command shouldFilter={false}>
                            <CommandInput
                              placeholder="Search by item code or description..."
                              value={itemSearchQuery}
                              onValueChange={setItemSearchQuery}
                            />
                            <CommandList>
                              {loadingItems ? (
                                <div className="flex items-center justify-center py-6">
                                  <MaterialIcon name="progress_activity" size="md" className="animate-spin text-muted-foreground" />
                                </div>
                              ) : filteredAvailableItems.length === 0 ? (
                                <CommandEmpty>No items found.</CommandEmpty>
                              ) : (
                                <CommandGroup className="max-h-64 overflow-auto">
                                  {filteredAvailableItems.map((item) => {
                                    const isSelected = selectedItems.some(i => i.id === item.id);
                                    return (
                                      <CommandItem
                                        key={item.id}
                                        onSelect={() => toggleItemSelection(item)}
                                        className="flex items-center gap-2 cursor-pointer"
                                      >
                                        <Checkbox
                                          checked={isSelected}
                                          className="pointer-events-none"
                                        />
                                        <div className="flex-1 min-w-0">
                                          <div className="flex items-center gap-2">
                                            <span className="font-mono text-sm">{item.item_code}</span>
                                            <Badge variant={getCoverageBadgeVariant(item.coverage_type)} className="text-xs">
                                              {getCoverageLabel(item.coverage_type)}
                                            </Badge>
                                          </div>
                                          {item.description && (
                                            <p className="text-xs text-muted-foreground truncate">
                                              {item.description}
                                            </p>
                                          )}
                                        </div>
                                        {item.declared_value && (
                                          <span className="text-xs text-muted-foreground">
                                            ${item.declared_value.toLocaleString()}
                                          </span>
                                        )}
                                      </CommandItem>
                                    );
                                  })}
                                </CommandGroup>
                              )}
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                    )}

                    {/* Selected Items Display */}
                    {selectedItems.length > 0 && (
                      <div className="border rounded-md p-2 space-y-1 max-h-40 overflow-y-auto">
                        {selectedItems.map((item) => {
                          const needsWeight = item.coverage_type === 'standard' && !item.weight_lbs;
                          return (
                            <div
                              key={item.id}
                              className={cn(
                                "flex items-center justify-between gap-2 p-2 rounded text-sm",
                                needsWeight ? "bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800" : "bg-muted/50"
                              )}
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <Button
                                  type="button"
                                  variant="link"
                                  size="sm"
                                  className="h-auto p-0 font-mono text-sm"
                                  onClick={() => window.open(`/inventory/${item.id}?tab=coverage`, '_blank')}
                                  title="Open item coverage tab"
                                >
                                  {item.item_code}
                                </Button>
                                {item.description && (
                                  <span className="text-muted-foreground truncate">
                                    - {item.description.slice(0, 30)}
                                  </span>
                                )}
                                {needsWeight && (
                                  <span className="text-yellow-600 dark:text-yellow-400 text-xs flex items-center gap-1 whitespace-nowrap">
                                    <MaterialIcon name="warning" className="!text-[12px]" />
                                    Weight required
                                  </span>
                                )}
                                {item.coverage_type === 'standard' && item.weight_lbs && (
                                  <span className="text-muted-foreground text-xs whitespace-nowrap">
                                    {item.weight_lbs} lbs
                                  </span>
                                )}
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => removeSelectedItem(item.id)}
                                className="h-6 w-6 p-0 flex-shrink-0"
                              >
                                <MaterialIcon name="close" className="!text-[12px]" />
                              </Button>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Weight Warning */}
                    {selectedItems.some(i => i.coverage_type === 'standard' && !i.weight_lbs) && (
                      <div className="flex items-start gap-2 text-sm text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 p-3 rounded-md">
                        <MaterialIcon name="warning" size="sm" className="mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="font-medium">Weight required for standard coverage</p>
                          <p className="text-xs mt-1 text-yellow-600/80 dark:text-yellow-400/80">
                            The following items need weight recorded before claim value can be calculated:
                          </p>
                          <div className="flex flex-wrap gap-1 mt-2">
                            {selectedItems
                              .filter(i => i.coverage_type === 'standard' && !i.weight_lbs)
                              .map((item) => (
                                <Button
                                  key={item.id}
                                  type="button"
                                  variant="link"
                                  size="sm"
                                  className="h-auto p-0 text-yellow-700 dark:text-yellow-300 underline font-mono text-xs"
                                  onClick={() => {
                                    window.open(`/inventory/${item.id}?tab=coverage`, '_blank');
                                  }}
                                >
                                  {item.item_code}
                                </Button>
                              ))}
                          </div>
                          <p className="text-xs mt-2 text-yellow-600/60 dark:text-yellow-400/60">
                            Click an item code to open its coverage tab and enter weight.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                </TabsContent>

                <TabsContent value="shipment" className="space-y-4 mt-4">
                  <div className="space-y-2">
                    <Label>Search Shipment *</Label>
                    <Input
                      placeholder="Enter shipment number (e.g., SHP-000123)..."
                      value={shipmentSearch}
                      onChange={(e) => {
                        setShipmentSearch(e.target.value);
                        searchShipments(e.target.value);
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      Type at least 2 characters to search
                    </p>
                    {searchedShipments.length > 0 && (
                      <div className="border rounded-md max-h-40 overflow-y-auto">
                        {searchedShipments.map((shipment) => (
                          <div
                            key={shipment.id}
                            className={cn(
                              "p-2 hover:bg-muted cursor-pointer text-sm font-mono",
                              selectedShipmentId === shipment.id && "bg-primary/10"
                            )}
                            onClick={() => handleShipmentSelect(shipment)}
                          >
                            {shipment.shipment_number}
                          </div>
                        ))}
                      </div>
                    )}
                    {shipmentSearch.length >= 2 && searchedShipments.length === 0 && (
                      <div className="text-sm text-muted-foreground border rounded-md p-4 text-center">
                        No shipments found matching "{shipmentSearch}"
                      </div>
                    )}
                  </div>

                  {/* Selected Shipment Display */}
                  {selectedShipmentId && (
                    <div className="p-3 bg-primary/5 border border-primary/20 rounded-md">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <MaterialIcon name="local_shipping" size="sm" className="text-primary" />
                          <span className="font-mono font-medium">{shipmentSearch}</span>
                          <Badge variant="secondary">Selected</Badge>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedShipmentId('');
                            setShipmentSearch('');
                            setSearchedShipments([]);
                          }}
                        >
                          <MaterialIcon name="close" size="sm" />
                        </Button>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="property" className="space-y-4 mt-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Account</Label>
                      <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select account" />
                        </SelectTrigger>
                        <SelectContent>
                          {accounts.map((acc) => (
                            <SelectItem key={acc.id} value={acc.id}>{acc.account_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Reference ID</Label>
                      <Input
                        placeholder="e.g., NINV-000123"
                        value={nonInventoryRef}
                        onChange={(e) => setNonInventoryRef(e.target.value)}
                      />
                    </div>
                    <div className="col-span-2 space-y-2">
                      <Label>Incident Location</Label>
                      <Input
                        placeholder="Address or location"
                        value={incidentLocation}
                        onChange={(e) => setIncidentLocation(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Contact Name</Label>
                      <Input
                        value={incidentContactName}
                        onChange={(e) => setIncidentContactName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Contact Phone</Label>
                      <Input
                        value={incidentContactPhone}
                        onChange={(e) => setIncidentContactPhone(e.target.value)}
                      />
                    </div>
                    <div className="col-span-2 space-y-2">
                      <Label>Contact Email</Label>
                      <Input
                        type="email"
                        value={incidentContactEmail}
                        onChange={(e) => setIncidentContactEmail(e.target.value)}
                      />
                    </div>
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            {/* Claim Type */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Claim Type *</Label>
                <Select value={claimType} onValueChange={(v) => setClaimType(v as ClaimType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(CLAIM_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Incident Date</Label>
                <Input
                  type="date"
                  value={incidentDate}
                  onChange={(e) => setIncidentDate(e.target.value)}
                />
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label>Description *</Label>
              <Textarea
                placeholder="Describe the issue in detail..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="pt-4 border-t">
          <Button
            onClick={handleSubmit}
            disabled={
              isSubmitting ||
              !description.trim() ||
              (context === 'items' && selectedItems.length === 0) ||
              (context !== 'property' && !selectedAccountId)
            }
          >
            {isSubmitting && <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-2" />}
            File Claim
            {selectedItems.length > 1 && ` (${selectedItems.length} items)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
