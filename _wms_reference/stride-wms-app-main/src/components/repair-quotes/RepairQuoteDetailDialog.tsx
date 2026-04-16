import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
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
  RepairQuoteWorkflow,
  RepairQuoteItem,
  AuditLogEntry,
  useRepairQuoteWorkflow,
} from '@/hooks/useRepairQuotes';
import { useTechnicians } from '@/hooks/useTechnicians';
import { supabase } from '@/integrations/supabase/client';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { UnifiedNotesSection } from '@/components/notes/UnifiedNotesSection';

interface RepairQuoteDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quote: RepairQuoteWorkflow | null;
  onRefresh: () => void;
}

export function RepairQuoteDetailDialog({
  open,
  onOpenChange,
  quote,
  onRefresh,
}: RepairQuoteDetailDialogProps) {
  const { toast } = useToast();
  const { activeTechnicians } = useTechnicians();
  const {
    assignTechnician,
    sendToTechnician,
    sendToClient,
    reviewQuote,
    closeQuote,
    getStatusInfo,
  } = useRepairQuoteWorkflow();

  const [quoteItems, setQuoteItems] = useState<RepairQuoteItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);

  // Office pricing state
  const [customerPrice, setCustomerPrice] = useState<string>('');
  const [internalCost, setInternalCost] = useState<string>('');
  const [pricingLocked, setPricingLocked] = useState<boolean>(false);
  const [savingPricing, setSavingPricing] = useState(false);

  // Load quote items and pricing when dialog opens
  useEffect(() => {
    if (open && quote) {
      loadQuoteItems();
      // Initialize pricing fields from quote
      setCustomerPrice(quote.customer_price?.toString() || quote.customer_total?.toString() || '');
      setInternalCost(quote.internal_cost?.toString() || '');
      setPricingLocked(quote.pricing_locked || false);
    }
  }, [open, quote?.id]);

  const loadQuoteItems = async () => {
    if (!quote) return;

    setLoadingItems(true);
    try {
      const { data, error } = await (supabase as any)
        .from('repair_quote_items')
        .select(`
          *,
          item:items(id, item_code, description, status)
        `)
        .eq('repair_quote_id', quote.id);

      if (error) throw error;

      // Fetch photos for each item
      const itemsWithPhotos = await Promise.all(
        (data || []).map(async (qi: any) => {
          const { data: photos } = await supabase
            .from('item_photos')
            .select('photo_url')
            .eq('item_id', qi.item_id)
            .order('created_at', { ascending: false })
            .limit(5);

          return {
            ...qi,
            damage_photos: qi.damage_photos?.length > 0
              ? qi.damage_photos
              : (photos || []).map((p: any) => p.photo_url),
          } as RepairQuoteItem;
        })
      );

      setQuoteItems(itemsWithPhotos);
    } catch (error) {
      console.error('Error loading quote items:', error);
    } finally {
      setLoadingItems(false);
    }
  };

  const handleAssignTechnician = async (techId: string) => {
    if (!quote) return;
    await assignTechnician(quote.id, techId);
    onRefresh();
  };

  const handleSendToTech = async () => {
    if (!quote) return;
    const token = await sendToTechnician(quote.id);
    if (token) {
      const link = `${window.location.origin}/quote/tech?token=${token}`;
      await navigator.clipboard.writeText(link);
      toast({
        title: 'Link Copied',
        description: 'Quote link copied to clipboard.',
      });
      onRefresh();
    }
  };

  const handleSendToClient = async () => {
    if (!quote) return;
    const token = await sendToClient(quote.id);
    if (token) {
      const link = `${window.location.origin}/quote/review?token=${token}`;
      await navigator.clipboard.writeText(link);
      toast({
        title: 'Link Copied',
        description: 'Quote link copied to clipboard.',
      });
      onRefresh();
    }
  };

  const handleReview = async () => {
    if (!quote) return;
    await reviewQuote(quote.id);
    onRefresh();
  };

  const handleClose = async () => {
    if (!quote) return;
    await closeQuote(quote.id);
    onOpenChange(false);
    onRefresh();
  };

  const handleSavePricing = async () => {
    if (!quote) return;

    const price = parseFloat(customerPrice);
    if (isNaN(price) || price <= 0) {
      toast({
        variant: 'destructive',
        title: 'Invalid Price',
        description: 'Please enter a valid customer price greater than 0',
      });
      return;
    }

    setSavingPricing(true);
    try {
      const { error } = await supabase
        .from('repair_quotes')
        .update({
          customer_price: price,
          internal_cost: internalCost ? parseFloat(internalCost) : null,
          pricing_locked: pricingLocked,
          customer_total: price, // Also update customer_total to match
          updated_at: new Date().toISOString(),
        })
        .eq('id', quote.id);

      if (error) throw error;

      toast({
        title: 'Pricing Saved',
        description: 'Office pricing has been updated',
      });
      onRefresh();
    } catch (error) {
      console.error('Error saving pricing:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to save pricing',
      });
    } finally {
      setSavingPricing(false);
    }
  };

  const canSendToClient = () => {
    const price = parseFloat(customerPrice);
    return !isNaN(price) && price > 0 && ['tech_submitted', 'under_review'].includes(quote?.status || '');
  };

  const formatCurrency = (amount: number | null) => {
    if (amount === null || amount === undefined) return '-';
    return `$${amount.toFixed(2)}`;
  };

  const getAuditIcon = (action: string) => {
    switch (action) {
      case 'created':
        return <MaterialIcon name="description" size="sm" className="text-blue-500" />;
      case 'technician_assigned':
        return <MaterialIcon name="person" size="sm" className="text-purple-500" />;
      case 'sent_to_tech':
        return <MaterialIcon name="send" size="sm" className="text-blue-500" />;
      case 'tech_submitted':
        return <MaterialIcon name="check_circle" size="sm" className="text-green-500" />;
      case 'tech_declined':
        return <MaterialIcon name="cancel" size="sm" className="text-red-500" />;
      case 'under_review':
        return <MaterialIcon name="warning" size="sm" className="text-orange-500" />;
      case 'sent_to_client':
        return <MaterialIcon name="open_in_new" size="sm" className="text-indigo-500" />;
      case 'accepted':
        return <MaterialIcon name="check_circle" size="sm" className="text-green-500" />;
      case 'declined':
        return <MaterialIcon name="cancel" size="sm" className="text-red-500" />;
      case 'closed':
        return <MaterialIcon name="close" size="sm" className="text-gray-500" />;
      default:
        return <MaterialIcon name="history" size="sm" className="text-gray-500" />;
    }
  };

  const formatAuditAction = (action: string) => {
    const actionMap: Record<string, string> = {
      created: 'Quote Created',
      technician_assigned: 'Technician Assigned',
      sent_to_tech: 'Sent to Technician',
      tech_submitted: 'Tech Submitted Quote',
      tech_declined: 'Tech Declined Job',
      under_review: 'Marked Under Review',
      sent_to_client: 'Sent to Client',
      accepted: 'Client Accepted',
      declined: 'Client Declined',
      closed: 'Quote Closed',
    };
    return actionMap[action] || action;
  };

  if (!quote) return null;

  const statusInfo = getStatusInfo(quote.status || 'draft');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2">
                <MaterialIcon name="build" size="md" />
                Repair Quote
              </DialogTitle>
              <DialogDescription>
                {quote.account?.name || 'Unknown Account'}
                {quote.sidemark && ` - ${quote.sidemark.name}`}
              </DialogDescription>
            </div>
            <Badge className={statusInfo.color}>{statusInfo.label}</Badge>
          </div>
        </DialogHeader>

        <Tabs defaultValue="details" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="items">
              Items ({quoteItems.length})
            </TabsTrigger>
            <TabsTrigger value="history">
              History ({(quote.audit_log || []).length})
            </TabsTrigger>
          </TabsList>

          <ScrollArea className="flex-1 pr-4">
            {/* Details Tab */}
            <TabsContent value="details" className="mt-4 space-y-6">
              {/* Quote Summary */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Technician</p>
                  {quote.technician ? (
                    <div className="flex items-center gap-2">
                      <MaterialIcon name="person" size="sm" />
                      <span className="font-medium">{quote.technician.name}</span>
                      <span className="text-sm text-muted-foreground">
                        ({quote.technician.markup_percent}% markup)
                      </span>
                    </div>
                  ) : (
                    <Select onValueChange={handleAssignTechnician}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Assign technician..." />
                      </SelectTrigger>
                      <SelectContent>
                        {activeTechnicians.map((tech) => (
                          <SelectItem key={tech.id} value={tech.id}>
                            {tech.name} ({tech.markup_percent}% markup)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">Expires</p>
                  <div className="flex items-center gap-2">
                    <MaterialIcon name="schedule" size="sm" />
                    <span className="font-medium">
                      {quote.expires_at
                        ? format(new Date(quote.expires_at), 'MMM d, yyyy h:mm a')
                        : 'Not set'}
                    </span>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Pricing Section */}
              {quote.tech_submitted_at && (
                <div className="space-y-4">
                  <h4 className="font-medium">Tech Quote Details</h4>
                  <div className="bg-muted rounded-lg p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <p className="text-muted-foreground">Labor Hours</p>
                        <p className="font-medium">{quote.tech_labor_hours || 0} hrs</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Labor Rate</p>
                        <p className="font-medium">{formatCurrency(quote.tech_labor_rate)}/hr</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Materials</p>
                        <p className="font-medium">{formatCurrency(quote.tech_materials_cost)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Tech Total</p>
                        <p className="font-medium">{formatCurrency(quote.tech_total)}</p>
                      </div>
                    </div>
                    <Separator />
                    <div className="flex justify-between items-center">
                      <div>
                        <p className="text-muted-foreground text-sm">
                          Markup Applied: {quote.markup_applied || 0}%
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-muted-foreground">Auto-calculated Total</p>
                        <p className="text-xl font-bold text-muted-foreground">
                          {formatCurrency(quote.customer_total)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {quote.tech_notes && (
                    <div className="bg-muted/50 rounded-lg p-4">
                      <p className="text-sm font-medium mb-1">Technician Notes</p>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                        {quote.tech_notes}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Office Pricing Section */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium flex items-center gap-2">
                    <MaterialIcon name="attach_money" size="sm" />
                    Office Pricing
                  </h4>
                  {pricingLocked && (
                    <Badge variant="secondary" className="flex items-center gap-1">
                      <MaterialIcon name="lock" size="sm" />
                      Locked
                    </Badge>
                  )}
                </div>
                <div className="bg-blue-50 dark:bg-blue-950/20 rounded-lg p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="customerPrice">Customer Price *</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                        <Input
                          id="customerPrice"
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={customerPrice}
                          onChange={(e) => setCustomerPrice(e.target.value)}
                          className="pl-7"
                          disabled={pricingLocked && quote.status !== 'under_review'}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Final price shown to client
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="internalCost">Internal Cost (Optional)</Label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                        <Input
                          id="internalCost"
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="0.00"
                          value={internalCost}
                          onChange={(e) => setInternalCost(e.target.value)}
                          className="pl-7"
                          disabled={pricingLocked && quote.status !== 'under_review'}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        For internal tracking only
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <UnifiedNotesSection
                      entityType="repair_quote"
                      entityId={quote.id}
                      embedded
                      allowedNoteTypes={['internal', 'public']}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Switch
                        id="pricingLocked"
                        checked={pricingLocked}
                        onCheckedChange={setPricingLocked}
                        disabled={quote.status === 'accepted'}
                      />
                      <Label htmlFor="pricingLocked" className="text-sm">
                        Lock pricing (prevents further edits)
                      </Label>
                    </div>
                    <Button
                      onClick={handleSavePricing}
                      disabled={savingPricing || (pricingLocked && !['under_review', 'tech_submitted'].includes(quote.status || ''))}
                    >
                      {savingPricing ? (
                        <>
                          <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <MaterialIcon name="save" size="sm" className="mr-2" />
                          Save Pricing
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Source Task Link */}
              {quote.source_task_id && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">Source Task</p>
                  <Link
                    to={`/tasks/${quote.source_task_id}`}
                    className="text-primary hover:underline flex items-center gap-1"
                    onClick={() => onOpenChange(false)}
                  >
                    <MaterialIcon name="description" size="sm" />
                    View Task
                    <MaterialIcon name="open_in_new" size="sm" className="text-xs" />
                  </Link>
                </div>
              )}

              {/* Actions */}
              <Separator />
              <div className="flex flex-wrap gap-2">
                {quote.technician && !['sent_to_tech', 'tech_submitted', 'tech_declined'].includes(quote.status || '') && (
                  <Button onClick={handleSendToTech}>
                    <MaterialIcon name="send" size="sm" className="mr-2" />
                    Send to Technician
                  </Button>
                )}

                {quote.status === 'tech_submitted' && (
                  <Button onClick={handleReview} variant="secondary">
                    <MaterialIcon name="description" size="sm" className="mr-2" />
                    Mark Under Review
                  </Button>
                )}

                {canSendToClient() && (
                  <Button onClick={handleSendToClient}>
                    <MaterialIcon name="open_in_new" size="sm" className="mr-2" />
                    Send to Client
                  </Button>
                )}

                <Button onClick={handleClose} variant="outline" className="text-destructive">
                  <MaterialIcon name="close" size="sm" className="mr-2" />
                  Close Quote
                </Button>
              </div>
            </TabsContent>

            {/* Items Tab */}
            <TabsContent value="items" className="mt-4 space-y-4">
              {loadingItems ? (
                <div className="flex items-center justify-center py-8">
                  <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
                </div>
              ) : quoteItems.length === 0 ? (
                <div className="text-center py-8">
                  <MaterialIcon name="inventory_2" size="xl" className="mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No items in this quote</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {quoteItems.map((item) => (
                    <div key={item.id} className="border rounded-lg p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <Link
                            to={`/inventory/${item.item_id}`}
                            className="font-medium hover:underline flex items-center gap-1"
                            onClick={() => onOpenChange(false)}
                          >
                            {item.item?.item_code || item.item_code}
                            <MaterialIcon name="open_in_new" size="sm" className="text-xs" />
                          </Link>
                          <p className="text-sm text-muted-foreground">
                            {item.item?.description || item.item_description || 'No description'}
                          </p>
                        </div>
                        {item.item?.status && (
                          <Badge variant="outline" className="capitalize">
                            {item.item.status.replace('_', ' ')}
                          </Badge>
                        )}
                      </div>

                      {item.damage_description && (
                        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded p-3">
                          <p className="text-sm text-amber-800 dark:text-amber-200">
                            {item.damage_description}
                          </p>
                        </div>
                      )}

                      {item.damage_photos && item.damage_photos.length > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
                            <MaterialIcon name="image" size="sm" className="text-xs" />
                            Photos ({item.damage_photos.length})
                          </p>
                          <div className="flex gap-2 overflow-x-auto pb-2">
                            {item.damage_photos.map((photo, i) => (
                              <a
                                key={i}
                                href={photo}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="shrink-0"
                              >
                                <img
                                  src={photo}
                                  alt={`Photo ${i + 1}`}
                                  className="h-16 w-16 object-cover rounded border hover:opacity-80 transition-opacity"
                                />
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      {(item.allocated_tech_amount || item.allocated_customer_amount) && (
                        <div className="flex gap-4 text-sm">
                          <div>
                            <span className="text-muted-foreground">Tech: </span>
                            <span className="font-medium">
                              {formatCurrency(item.allocated_tech_amount)}
                            </span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Customer: </span>
                            <span className="font-medium">
                              {formatCurrency(item.allocated_customer_amount)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            {/* History Tab */}
            <TabsContent value="history" className="mt-4">
              <div className="space-y-4">
                {(quote.audit_log || []).length === 0 ? (
                  <div className="text-center py-8">
                    <MaterialIcon name="history" size="xl" className="mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No history recorded</p>
                  </div>
                ) : (
                  <div className="relative">
                    {/* Timeline line */}
                    <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

                    {/* Timeline items */}
                    <div className="space-y-4">
                      {[...(quote.audit_log || [])].reverse().map((entry, index) => (
                        <div key={index} className="relative pl-10">
                          {/* Timeline dot */}
                          <div className="absolute left-0 w-8 h-8 rounded-full bg-background border-2 border-border flex items-center justify-center">
                            {getAuditIcon(entry.action)}
                          </div>

                          {/* Content */}
                          <div className="bg-muted/50 rounded-lg p-3">
                            <div className="flex items-center justify-between">
                              <p className="font-medium text-sm">
                                {formatAuditAction(entry.action)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {format(new Date(entry.at), 'MMM d, yyyy h:mm a')}
                              </p>
                            </div>
                            {entry.by_name && (
                              <p className="text-sm text-muted-foreground">
                                By: {entry.by_name}
                              </p>
                            )}
                            {entry.details && Object.keys(entry.details).length > 0 && (
                              <div className="mt-2 text-xs text-muted-foreground">
                                {entry.details.source_task_id && (
                                  <Link
                                    to={`/tasks/${entry.details.source_task_id}`}
                                    className="text-primary hover:underline"
                                    onClick={() => onOpenChange(false)}
                                  >
                                    View Source Task
                                  </Link>
                                )}
                                {entry.details.technician_name && (
                                  <p>Technician: {entry.details.technician_name}</p>
                                )}
                                {entry.details.tech_total && (
                                  <p>Quote: ${entry.details.tech_total.toFixed(2)}</p>
                                )}
                                {entry.details.reason && (
                                  <p>Reason: {entry.details.reason}</p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>
          </ScrollArea>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
