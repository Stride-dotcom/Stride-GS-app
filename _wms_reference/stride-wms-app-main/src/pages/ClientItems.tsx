import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ClientPortalLayout } from '@/components/client-portal/ClientPortalLayout';
import { useClientPortalContext, useClientItems } from '@/hooks/useClientPortal';
import { useIsMobile } from '@/hooks/use-mobile';
import { formatDistanceToNow } from 'date-fns';

export default function ClientItems() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { portalUser, account, tenant } = useClientPortalContext();
  const { data: items = [], isLoading } = useClientItems();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [quoteRequestState, setQuoteRequestState] = useState<{
    loading: boolean;
    existingQuoteId: string | null;
    submitted: boolean;
    error: string | null;
  }>({ loading: false, existingQuoteId: null, submitted: false, error: null });
  const { toast } = useToast();

  const userName = portalUser?.first_name
    ? `${portalUser.first_name} ${portalUser.last_name || ''}`.trim()
    : portalUser?.email || 'User';

  // Filter items
  const filteredItems = items.filter((item: any) => {
    const matchesSearch =
      item.item_code?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.sidemarks?.sidemark_code?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'all' || item.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Get unique statuses
  const statuses = [...new Set(items.map((item: any) => item.status))].filter(Boolean);

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      available: 'default',
      in_transit: 'secondary',
      on_hold: 'secondary',
      damaged: 'destructive',
      pending_inspection: 'outline',
      released: 'outline',
    };
    return (
      <Badge variant={variants[status] || 'outline'}>
        {status?.replace(/_/g, ' ')}
      </Badge>
    );
  };

  const getConditionBadge = (condition: string) => {
    if (!condition) return null;
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      new: 'default',
      good: 'default',
      fair: 'secondary',
      damaged: 'destructive',
      poor: 'destructive',
    };
    return (
      <Badge variant={variants[condition] || 'outline'} className="text-xs">
        {condition}
      </Badge>
    );
  };

  // Check if item qualifies for repair quote request (damaged or poor condition)
  const canRequestRepairQuote = (item: any): boolean => {
    if (!item) return false;
    const damageConditions = ['damaged', 'poor'];
    return (
      damageConditions.includes(item.condition?.toLowerCase()) ||
      item.status?.toLowerCase() === 'damaged'
    );
  };

  // Check for existing open repair quote when item is selected
  const checkExistingQuote = useCallback(async (itemId: string) => {
    if (!tenant?.id) return;

    setQuoteRequestState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const { data, error } = await (supabase.rpc as any)('check_existing_repair_quote', {
        p_item_id: itemId,
        p_tenant_id: tenant.id
      });

      if (error) throw error;

      if (data?.exists) {
        setQuoteRequestState(prev => ({
          ...prev,
          loading: false,
          existingQuoteId: data.quote_id
        }));
      } else {
        setQuoteRequestState(prev => ({
          ...prev,
          loading: false,
          existingQuoteId: null
        }));
      }
    } catch (err) {
      console.error('Error checking existing quote:', err);
      setQuoteRequestState(prev => ({
        ...prev,
        loading: false,
        error: 'Failed to check quote status'
      }));
    }
  }, [tenant?.id]);

  // Request a new repair quote for the selected item
  const handleRequestRepairQuote = async () => {
    if (!selectedItem || !account?.id || !tenant?.id) return;

    setQuoteRequestState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const { data, error } = await (supabase.rpc as any)('create_client_repair_quote_request', {
        p_item_id: selectedItem.id,
        p_account_id: account.id,
        p_tenant_id: tenant.id,
        p_notes: `Client requested repair quote for item ${selectedItem.item_code}. Condition: ${selectedItem.condition || 'Not specified'}.`
      });

      if (error) throw error;

      if (data?.success) {
        setQuoteRequestState(prev => ({
          ...prev,
          loading: false,
          submitted: true
        }));
        toast({
          title: 'Quote Requested',
          description: 'Your repair quote request has been submitted. You will be notified when a quote is ready.'
        });
      } else {
        throw new Error(data?.error || 'Failed to create quote request');
      }
    } catch (err: any) {
      console.error('Error requesting repair quote:', err);
      const errorMessage = err.message?.includes('already exists')
        ? 'A repair quote already exists for this item'
        : 'Failed to submit quote request. Please try again.';
      setQuoteRequestState(prev => ({
        ...prev,
        loading: false,
        error: errorMessage
      }));
      toast({
        variant: 'destructive',
        title: 'Error',
        description: errorMessage
      });
    }
  };

  // Reset quote state when item selection changes
  const handleSelectItem = (item: any) => {
    setSelectedItem(item);
    setQuoteRequestState({ loading: false, existingQuoteId: null, submitted: false, error: null });
    if (item && canRequestRepairQuote(item)) {
      checkExistingQuote(item.id);
    }
  };

  // Multi-select helpers
  const toggleItemSelection = (itemId: string) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemId)) newSelected.delete(itemId);
    else newSelected.add(itemId);
    setSelectedItems(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedItems.size === filteredItems.length) {
      setSelectedItems(new Set());
    } else {
      setSelectedItems(new Set(filteredItems.map((item: any) => item.id)));
    }
  };

  const handleOutbound = () => {
    const firstItem = items.find((i: any) => selectedItems.has(i.id));
    navigate('/client/shipments/outbound/new', {
      state: {
        itemIds: Array.from(selectedItems),
        accountId: firstItem?.account_id || account?.id,
      },
    });
  };

  return (
    <ClientPortalLayout
      accountName={account?.name}
      warehouseName={tenant?.name}
      userName={userName}
    >
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">My Items</h1>
            <p className="text-muted-foreground">
              View and manage items stored in your account
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {selectedItems.size > 0 && (
              <>
                <span className="text-sm text-muted-foreground mr-1">
                  {selectedItems.size} selected
                </span>
                <Button variant="outline" size="sm" onClick={handleOutbound}>
                  <MaterialIcon name="local_shipping" size="sm" className="mr-1.5" />
                  Outbound
                </Button>
                <Button variant="outline" size="sm" onClick={() => navigate('/client/tasks/new', { state: { itemIds: Array.from(selectedItems), accountId: account?.id } })}>
                  <MaterialIcon name="assignment" size="sm" className="mr-1.5" />
                  Task
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setSelectedItems(new Set())}>
                  Clear
                </Button>
              </>
            )}
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Inventory</CardTitle>
            <CardDescription>
              {filteredItems.length} of {items.length} items
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div className="relative flex-1">
                <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by item code, description, or sidemark..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-48">
                  <MaterialIcon name="filter_list" size="sm" className="mr-2" />
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  {statuses.map((status) => (
                    <SelectItem key={status as string} value={status as string}>
                      {(status as string)?.replace(/_/g, ' ')}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Items List */}
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <MaterialIcon name="progress_activity" size="xl" className="animate-spin text-muted-foreground" />
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="text-center py-12">
                <MaterialIcon name="inventory_2" className="mx-auto text-muted-foreground opacity-50" style={{ fontSize: '48px' }} />
                <h3 className="mt-4 text-lg font-semibold">No items found</h3>
                <p className="text-muted-foreground">
                  {searchQuery || statusFilter !== 'all'
                    ? 'Try adjusting your search or filters'
                    : 'No items are currently stored in your account'}
                </p>
              </div>
            ) : isMobile ? (
              // Mobile view
              <div className="space-y-3">
                {filteredItems.map((item: any) => (
                  <div
                    key={item.id}
                    className={`border rounded-lg p-4 cursor-pointer hover:bg-muted/50 transition-colors ${selectedItems.has(item.id) ? 'bg-muted/30 border-primary/30' : ''}`}
                    onClick={() => handleSelectItem(item)}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-start gap-3">
                        <div onClick={(e) => e.stopPropagation()} className="pt-0.5">
                          <Checkbox
                            checked={selectedItems.has(item.id)}
                            onCheckedChange={() => toggleItemSelection(item.id)}
                          />
                        </div>
                        <div>
                          <p className="font-medium">{item.item_code}</p>
                          <p className="text-sm text-muted-foreground line-clamp-2">
                            {item.description || 'No description'}
                          </p>
                        </div>
                      </div>
                      {getStatusBadge(item.status)}
                    </div>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      {item.sidemarks?.sidemark_code && (
                        <span>Sidemark: {item.sidemarks.sidemark_code}</span>
                      )}
                      {item.current_location && (
                        <span className="flex items-center gap-1">
                          <MaterialIcon name="location_on" size="sm" />
                          {item.current_location}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              // Desktop view
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={filteredItems.length > 0 && selectedItems.size === filteredItems.length}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableHead>
                      <TableHead>Item Code</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Sidemark</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Condition</TableHead>
                      <TableHead>Added</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((item: any) => (
                      <TableRow
                        key={item.id}
                        className={`cursor-pointer hover:bg-muted/50 ${selectedItems.has(item.id) ? 'bg-muted/30' : ''}`}
                        onClick={() => handleSelectItem(item)}
                      >
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedItems.has(item.id)}
                            onCheckedChange={() => toggleItemSelection(item.id)}
                          />
                        </TableCell>
                        <TableCell className="font-medium">{item.item_code}</TableCell>
                        <TableCell className="max-w-xs truncate">
                          {item.description || '-'}
                        </TableCell>
                        <TableCell>
                          {item.sidemarks?.sidemark_code || '-'}
                        </TableCell>
                        <TableCell>{item.current_location || '-'}</TableCell>
                        <TableCell>{getStatusBadge(item.status)}</TableCell>
                        <TableCell>{getConditionBadge(item.condition)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDistanceToNow(new Date(item.created_at), { addSuffix: true })}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Item Detail Dialog */}
      <Dialog open={!!selectedItem} onOpenChange={() => setSelectedItem(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedItem?.item_code}</DialogTitle>
            <DialogDescription>Item details and photos</DialogDescription>
          </DialogHeader>

          {selectedItem && (
            <div className="space-y-6">
              {/* Basic Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Description</p>
                  <p className="font-medium">{selectedItem.description || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Category</p>
                  <p className="font-medium">{selectedItem.category || '-'}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <div className="mt-1">{getStatusBadge(selectedItem.status)}</div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Condition</p>
                  <div className="mt-1">
                    {getConditionBadge(selectedItem.condition) || '-'}
                  </div>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Location</p>
                  <p className="font-medium flex items-center gap-1">
                    <MaterialIcon name="location_on" size="sm" />
                    {selectedItem.current_location || 'Not assigned'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Sidemark</p>
                  <p className="font-medium">
                    {selectedItem.sidemarks?.sidemark_code || '-'}
                    {selectedItem.sidemarks?.sidemark_name && (
                      <span className="text-muted-foreground text-sm ml-1">
                        ({selectedItem.sidemarks.sidemark_name})
                      </span>
                    )}
                  </p>
                </div>
              </div>

              {/* Photos */}
              <div>
                <p className="text-sm text-muted-foreground mb-2">Photos</p>
                {selectedItem.photos && selectedItem.photos.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {selectedItem.photos.map((photo: string, index: number) => (
                      <a
                        key={index}
                        href={photo}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="aspect-square rounded-lg overflow-hidden border hover:ring-2 hover:ring-primary transition-all"
                      >
                        <img
                          src={photo}
                          alt={`Item photo ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                      </a>
                    ))}
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-32 bg-muted rounded-lg">
                    <div className="text-center text-muted-foreground">
                      <MaterialIcon name="image" size="xl" className="mx-auto mb-2 opacity-50" />
                      <p className="text-sm">No photos available</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Timeline placeholder */}
              <div>
                <p className="text-sm text-muted-foreground mb-2">Added to inventory</p>
                <p className="text-sm">
                  {formatDistanceToNow(new Date(selectedItem.created_at), { addSuffix: true })}
                </p>
              </div>

              {/* Repair Quote Request Section */}
              {canRequestRepairQuote(selectedItem) && (
                <>
                  <Separator />
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <MaterialIcon name="build" size="sm" className="text-amber-600" />
                      <p className="font-medium">Repair Services</p>
                    </div>

                    {quoteRequestState.submitted ? (
                      <Alert>
                        <MaterialIcon name="check_circle" size="sm" className="text-green-600" />
                        <AlertDescription>
                          Your repair quote request has been submitted. Our team will review and provide a quote soon.
                        </AlertDescription>
                      </Alert>
                    ) : quoteRequestState.existingQuoteId ? (
                      <Alert>
                        <MaterialIcon name="info" size="sm" className="text-blue-600" />
                        <AlertDescription>
                          A repair quote is already in progress for this item. You will be notified when it's ready for review.
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <>
                        <p className="text-sm text-muted-foreground">
                          This item appears to be damaged or in poor condition. Would you like to request a repair quote?
                        </p>
                        {quoteRequestState.error && (
                          <Alert variant="destructive">
                            <AlertDescription>{quoteRequestState.error}</AlertDescription>
                          </Alert>
                        )}
                        <Button
                          onClick={handleRequestRepairQuote}
                          disabled={quoteRequestState.loading}
                          className="w-full"
                        >
                          {quoteRequestState.loading ? (
                            <>
                              <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                              Submitting...
                            </>
                          ) : (
                            <>
                              <MaterialIcon name="build" size="sm" className="mr-2" />
                              Request Repair Quote
                            </>
                          )}
                        </Button>
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </ClientPortalLayout>
  );
}
