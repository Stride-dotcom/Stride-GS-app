import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { EntityActivityFeed } from '@/components/activity/EntityActivityFeed';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
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
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  RepairQuoteWorkflow,
  RepairQuoteItem,
  AuditLogEntry,
  useRepairQuoteWorkflow,
} from '@/hooks/useRepairQuotes';
import { useTechnicians } from '@/hooks/useTechnicians';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { format } from 'date-fns';
import { AccountSelect } from '@/components/ui/account-select';
import { UnifiedNotesSection } from '@/components/notes/UnifiedNotesSection';

// Status text classes for bold colored text
const getStatusTextClass = (status: string) => {
  switch (status) {
    case 'draft':
      return 'font-bold text-gray-500 dark:text-gray-400';
    case 'awaiting_assignment':
      return 'font-bold text-yellow-500 dark:text-yellow-400';
    case 'sent_to_tech':
      return 'font-bold text-blue-500 dark:text-blue-400';
    case 'tech_submitted':
      return 'font-bold text-purple-500 dark:text-purple-400';
    case 'tech_declined':
      return 'font-bold text-red-500 dark:text-red-400';
    case 'under_review':
      return 'font-bold text-orange-500 dark:text-orange-400';
    case 'sent_to_client':
      return 'font-bold text-indigo-500 dark:text-indigo-400';
    case 'accepted':
      return 'font-bold text-green-500 dark:text-green-400';
    case 'declined':
    case 'expired':
    case 'closed':
      return 'font-bold text-gray-500 dark:text-gray-400';
    default:
      return '';
  }
};

interface ItemWithDetails extends RepairQuoteItem {
  vendor?: string | null;
  location_code?: string | null;
  inspection_notes?: string | null;
  inspection_photos?: string[];
}

export default function RepairQuoteDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { toast } = useToast();
  const { activeTechnicians } = useTechnicians();

  const {
    assignTechnician,
    sendToTechnician,
    sendToClient,
    reviewQuote,
    closeQuote,
    getStatusInfo,
    refetch: refetchQuotes,
  } = useRepairQuoteWorkflow();

  const [quote, setQuote] = useState<RepairQuoteWorkflow | null>(null);
  const [quoteItems, setQuoteItems] = useState<ItemWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);

  // Office pricing state
  const [customerPrice, setCustomerPrice] = useState<string>('');
  const [internalCost, setInternalCost] = useState<string>('');
  const [pricingLocked, setPricingLocked] = useState<boolean>(false);
  const [savingPricing, setSavingPricing] = useState(false);

  // Add items dialog
  const [addItemsDialogOpen, setAddItemsDialogOpen] = useState(false);
  const [availableItems, setAvailableItems] = useState<any[]>([]);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [addingItems, setAddingItems] = useState(false);

  // Photo viewer state
  const [viewingPhotos, setViewingPhotos] = useState<string[]>([]);
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false);

  // Send email state
  const [sendingToClient, setSendingToClient] = useState(false);
  const [testEmailDialogOpen, setTestEmailDialogOpen] = useState(false);
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [sendingTestEmail, setSendingTestEmail] = useState(false);

  // Account editing state
  const [editingAccount, setEditingAccount] = useState(false);
  const [savingAccount, setSavingAccount] = useState(false);

  const fetchQuote = useCallback(async () => {
    if (!id || !profile?.tenant_id) return;

    try {
      setLoading(true);
      const { data, error } = await (supabase
        .from('repair_quotes') as any)
        .select(`
          *,
          technician:technicians(id, name, email, markup_percent, hourly_rate),
          account:accounts(id, name:account_name),
          sidemark:sidemarks(id, name:sidemark_name)
        `)
        .eq('id', id)
        .eq('tenant_id', profile.tenant_id)
        .single();

      if (error) throw error;

      const transformedQuote: RepairQuoteWorkflow = {
        ...data,
        status: data.status || 'draft',
        audit_log: data.audit_log || [],
      };

      setQuote(transformedQuote);
      setCustomerPrice(data.customer_price?.toString() || data.customer_total?.toString() || '');
      setInternalCost(data.internal_cost?.toString() || '');
      setPricingLocked(data.pricing_locked || false);
    } catch (error) {
      console.error('Error fetching quote:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load repair quote',
      });
    } finally {
      setLoading(false);
    }
  }, [id, profile?.tenant_id, toast]);

  const fetchQuoteItems = useCallback(async () => {
    if (!id) return;

    setLoadingItems(true);
    try {
      const { data, error } = await (supabase as any)
        .from('repair_quote_items')
        .select(`
          *,
          item:items(
            id, item_code, description, status, vendor,
            current_location_id,
            location:locations!items_current_location_id_fkey(code),
            inspection_photos
          )
        `)
        .eq('repair_quote_id', id);

      if (error) throw error;

      // Fetch photos for each item
      const itemsWithDetails = await Promise.all(
        (data || []).map(async (qi: any) => {
          // Get inspection photos from item_photos
          const { data: photos } = await supabase
            .from('item_photos')
            .select('photo_url, photo_tag')
            .eq('item_id', qi.item_id)
            .order('created_at', { ascending: false });

          // Get task photos if there's a source task
          let taskPhotos: string[] = [];
          if (quote?.source_task_id) {
            const { data: taskData } = await supabase
              .from('tasks')
              .select('metadata')
              .eq('id', quote.source_task_id)
              .single();

            const taskMetadata = taskData?.metadata as Record<string, unknown> | null;
            if (taskMetadata?.photos) {
              const photosArr = taskMetadata.photos as unknown[];
              taskPhotos = photosArr.map((p: any) => typeof p === 'string' ? p : p.url).filter(Boolean);
            }
          }

          const itemPhotos = (photos || []).map((p: any) => p.photo_url);
          const allPhotos = [...new Set([...itemPhotos, ...taskPhotos])];

          return {
            ...qi,
            vendor: qi.item?.vendor || null,
            location_code: qi.item?.location?.code || null,
            inspection_notes: qi.damage_description || null,
            inspection_photos: qi.damage_photos?.length > 0 ? qi.damage_photos : allPhotos,
          } as ItemWithDetails;
        })
      );

      setQuoteItems(itemsWithDetails);
    } catch (error) {
      console.error('Error loading quote items:', error);
    } finally {
      setLoadingItems(false);
    }
  }, [id, quote?.source_task_id]);

  useEffect(() => {
    fetchQuote();
  }, [fetchQuote]);

  useEffect(() => {
    if (quote) {
      fetchQuoteItems();
    }
  }, [quote, fetchQuoteItems]);

  const handleAssignTechnician = async (techId: string) => {
    if (!quote) return;
    await assignTechnician(quote.id, techId);
    fetchQuote();
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
      fetchQuote();
    }
  };

  const handleSendToClient = async () => {
    if (!quote) return;
    setSendingToClient(true);
    try {
      const token = await sendToClient(quote.id);
      if (token) {
        fetchQuote();
      }
    } finally {
      setSendingToClient(false);
    }
  };

  const handleSendTestEmail = async () => {
    if (!quote || !testEmailAddress) return;
    setSendingTestEmail(true);
    try {
      await sendToClient(quote.id, testEmailAddress);
      setTestEmailDialogOpen(false);
      setTestEmailAddress('');
    } finally {
      setSendingTestEmail(false);
    }
  };

  const handleReview = async () => {
    if (!quote) return;
    await reviewQuote(quote.id);
    fetchQuote();
  };

  const handleClose = async () => {
    if (!quote) return;
    await closeQuote(quote.id);
    navigate('/repair-quotes');
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
          customer_total: price,
          updated_at: new Date().toISOString(),
        })
        .eq('id', quote.id);

      if (error) throw error;

      toast({
        title: 'Pricing Saved',
        description: 'Office pricing has been updated',
      });
      fetchQuote();
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

  const handleAccountChange = async (newAccountId: string) => {
    if (!quote || !newAccountId) return;

    setSavingAccount(true);
    try {
      const { error } = await supabase
        .from('repair_quotes')
        .update({
          account_id: newAccountId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', quote.id);

      if (error) throw error;

      toast({
        title: 'Account Updated',
        description: 'Quote account has been updated. Items list will refresh.',
      });
      setEditingAccount(false);
      fetchQuote();
    } catch (error) {
      console.error('Error updating account:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update account',
      });
    } finally {
      setSavingAccount(false);
    }
  };

  // Add items functionality - fetch inventory items linked to the quote's account
  const fetchAvailableItems = async () => {
    if (!quote?.account_id || !profile?.tenant_id) return;

    try {
      // Fetch items that belong to the same account as the repair quote
      // Only show active/stored items (not released or disposed)
      const { data, error } = await supabase
        .from('items')
        .select(`
          id, item_code, description, vendor, status,
          location:locations!items_current_location_id_fkey(code)
        `)
        .eq('tenant_id', profile.tenant_id)
        .eq('account_id', quote.account_id)
        .in('status', ['active', 'stored', 'allocated', 'pending_receipt'])
        .is('deleted_at', null)
        .order('item_code');

      if (error) throw error;

      // Filter out items already in the quote
      const existingItemIds = new Set(quoteItems.map(qi => qi.item_id));
      const available = (data || []).filter(item => !existingItemIds.has(item.id));
      setAvailableItems(available);
    } catch (error) {
      console.error('Error fetching available items:', error);
    }
  };

  const handleOpenAddItems = () => {
    fetchAvailableItems();
    setSelectedItemIds(new Set());
    setSearchQuery('');
    setAddItemsDialogOpen(true);
  };

  const handleAddItems = async () => {
    if (!quote || !profile?.tenant_id || selectedItemIds.size === 0) return;

    setAddingItems(true);
    try {
      const selectedItems = availableItems.filter(item => selectedItemIds.has(item.id));
      const newQuoteItems = selectedItems.map(item => ({
        tenant_id: profile.tenant_id,
        repair_quote_id: quote.id,
        item_id: item.id,
        item_code: item.item_code,
        item_description: item.description,
      }));

      const { error } = await (supabase as any)
        .from('repair_quote_items')
        .insert(newQuoteItems);

      if (error) throw error;

      toast({
        title: 'Items Added',
        description: `Added ${selectedItemIds.size} item(s) to the quote`,
      });

      setAddItemsDialogOpen(false);
      fetchQuoteItems();
    } catch (error) {
      console.error('Error adding items:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to add items',
      });
    } finally {
      setAddingItems(false);
    }
  };

  const handleRemoveItem = async (itemId: string) => {
    if (!quote) return;

    try {
      const { error } = await (supabase as any)
        .from('repair_quote_items')
        .delete()
        .eq('repair_quote_id', quote.id)
        .eq('item_id', itemId);

      if (error) throw error;

      toast({
        title: 'Item Removed',
        description: 'Item has been removed from the quote',
      });
      fetchQuoteItems();
    } catch (error) {
      console.error('Error removing item:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to remove item',
      });
    }
  };

  const handleViewPhotos = (photos: string[]) => {
    setViewingPhotos(photos);
    setPhotoDialogOpen(true);
  };

  const filteredAvailableItems = availableItems.filter(item =>
    item.item_code?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.vendor?.toLowerCase().includes(searchQuery.toLowerCase())
  );

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

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  if (!quote) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <p className="text-muted-foreground">Repair quote not found</p>
          <Button variant="outline" onClick={() => navigate('/repair-quotes')}>
            <MaterialIcon name="arrow_back" size="sm" className="mr-2" />
            Back to Repair Quotes
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const statusInfo = getStatusInfo(quote.status || 'draft');

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate('/repair-quotes')}>
              <MaterialIcon name="arrow_back" size="md" />
            </Button>
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2">
                <MaterialIcon name="build" size="md" />
                Repair Quote
              </h1>
              <div className="flex items-center gap-2 sm:gap-3 mt-1 flex-wrap">
                <Badge variant="outline" className="text-xs">RQ-{quote.id.slice(0, 8).toUpperCase()}</Badge>
                <span className={getStatusTextClass(quote.status || 'draft')}>
                  {statusInfo.label.toUpperCase()}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm mt-1">
                {editingAccount ? (
                  <div className="flex items-center gap-2">
                    <AccountSelect
                      value={quote.account_id || ''}
                      onChange={handleAccountChange}
                      placeholder="Select account..."
                      disabled={savingAccount}
                      className="w-64"
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setEditingAccount(false)}
                      disabled={savingAccount}
                    >
                      <MaterialIcon name="close" size="sm" />
                    </Button>
                    {savingAccount && (
                      <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingAccount(true)}
                    className="text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                    title="Click to change account"
                  >
                    <span>{quote.account?.name || 'No account'}</span>
                    {quote.sidemark && <span> - {quote.sidemark.name}</span>}
                    <MaterialIcon name="edit" size="sm" className="ml-1 opacity-50" />
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2 self-start sm:self-center flex-wrap">
            {quote.technician && !['sent_to_tech', 'tech_submitted', 'tech_declined'].includes(quote.status || '') && (
              <Button onClick={handleSendToTech} size="sm">
                <MaterialIcon name="send" size="sm" className="mr-2" />
                Send to Technician
              </Button>
            )}
            {quote.status === 'tech_submitted' && (
              <Button onClick={handleReview} variant="secondary" size="sm">
                <MaterialIcon name="description" size="sm" className="mr-2" />
                Mark Under Review
              </Button>
            )}
            {canSendToClient() && (
              <Button onClick={handleSendToClient} size="sm" disabled={sendingToClient}>
                {sendingToClient ? (
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                ) : (
                  <MaterialIcon name="email" size="sm" className="mr-2" />
                )}
                Send to Client
              </Button>
            )}
            {/* DEV: Send Test Email Button */}
            <Button
              onClick={() => setTestEmailDialogOpen(true)}
              variant="outline"
              size="sm"
            >
              <MaterialIcon name="bug_report" size="sm" className="mr-2" />
              Send Test
            </Button>
            <Button onClick={handleClose} variant="outline" size="sm" className="text-destructive">
              <MaterialIcon name="close" size="sm" className="mr-2" />
              Close Quote
            </Button>
          </div>
        </div>

        {/* Status Banner - Draft/Awaiting Assignment */}
        {['draft', 'awaiting_assignment'].includes(quote.status || '') && (
          <Card className="border-yellow-500 dark:border-yellow-400 bg-yellow-50/50 dark:bg-yellow-950/20">
            <CardContent className="py-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-3 w-3 bg-yellow-500 rounded-full" />
                  <span className="font-medium">
                    {quote.status === 'draft' ? 'Quote is in draft' : 'Awaiting technician assignment'}
                  </span>
                </div>
                <div className="flex gap-2">
                  {!quote.technician && activeTechnicians.length > 0 && (
                    <Select onValueChange={handleAssignTechnician}>
                      <SelectTrigger className="w-48">
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
                  {!quote.technician && activeTechnicians.length === 0 && (
                    <p className="text-xs text-muted-foreground italic self-center">
                      No technicians available. Add them in Settings.
                    </p>
                  )}
                  {quote.technician && (
                    <Button size="sm" onClick={handleSendToTech}>
                      <MaterialIcon name="send" size="sm" className="mr-2" />
                      Send to Technician
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Status Banner - Sent to Tech */}
        {quote.status === 'sent_to_tech' && (
          <Card className="border-blue-500 dark:border-blue-400 bg-blue-50/50 dark:bg-blue-950/20">
            <CardContent className="py-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-3 w-3 bg-blue-500 rounded-full animate-pulse" />
                  <span className="font-medium">
                    Waiting for technician response
                  </span>
                  <span className="text-sm text-muted-foreground">
                    Sent to {quote.technician?.name}
                  </span>
                </div>
                {quote.expires_at && (
                  <span className="text-sm text-muted-foreground">
                    Expires: {format(new Date(quote.expires_at), 'MMM d, yyyy')}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Status Banner - Tech Submitted */}
        {quote.status === 'tech_submitted' && (
          <Card className="border-purple-500 dark:border-purple-400 bg-purple-50/50 dark:bg-purple-950/20">
            <CardContent className="py-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-3 w-3 bg-purple-500 rounded-full" />
                  <span className="font-medium">
                    Technician submitted quote - review and send to client
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={handleReview}>
                    <MaterialIcon name="description" size="sm" className="mr-2" />
                    Mark Under Review
                  </Button>
                  {canSendToClient() && (
                    <Button size="sm" onClick={handleSendToClient}>
                      <MaterialIcon name="open_in_new" size="sm" className="mr-2" />
                      Send to Client
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Status Banner - Under Review */}
        {quote.status === 'under_review' && (
          <Card className="border-orange-500 dark:border-orange-400 bg-orange-50/50 dark:bg-orange-950/20">
            <CardContent className="py-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-3 w-3 bg-orange-500 rounded-full animate-pulse" />
                  <span className="font-medium">Quote under review</span>
                </div>
                {canSendToClient() && (
                  <Button size="sm" onClick={handleSendToClient}>
                    <MaterialIcon name="open_in_new" size="sm" className="mr-2" />
                    Send to Client
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Status Banner - Sent to Client */}
        {quote.status === 'sent_to_client' && (
          <Card className="border-indigo-500 dark:border-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/20">
            <CardContent className="py-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-3 w-3 bg-indigo-500 rounded-full animate-pulse" />
                  <span className="font-medium">Waiting for client response</span>
                </div>
                {quote.expires_at && (
                  <span className="text-sm text-muted-foreground">
                    Expires: {format(new Date(quote.expires_at), 'MMM d, yyyy')}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Status Banner - Accepted */}
        {quote.status === 'accepted' && (
          <Card className="border-green-500 dark:border-green-400 bg-green-50/50 dark:bg-green-950/20">
            <CardContent className="py-4">
              <div className="flex items-center gap-3">
                <MaterialIcon name="check_circle" size="md" className="text-green-500" />
                <span className="font-medium">Quote accepted by client</span>
                {quote.client_responded_at && (
                  <span className="text-sm text-muted-foreground">
                    on {format(new Date(quote.client_responded_at), 'MMM d, yyyy')}
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Pricing Calculator - Upper Right */}
        <div className="flex justify-end">
          <div className="w-full lg:w-1/3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <MaterialIcon name="attach_money" size="sm" />
                  Quote Pricing
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Tech Quote Details (if submitted) */}
                {quote.tech_submitted_at && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground uppercase tracking-wide">Tech Quote</p>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Labor</span>
                        <span>{quote.tech_labor_hours || 0} hrs × {formatCurrency(quote.tech_labor_rate)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Materials</span>
                        <span>{formatCurrency(quote.tech_materials_cost)}</span>
                      </div>
                      <div className="flex justify-between font-medium">
                        <span>Tech Total</span>
                        <span>{formatCurrency(quote.tech_total)}</span>
                      </div>
                      {quote.markup_applied && (
                        <div className="flex justify-between text-xs text-muted-foreground">
                          <span>Markup</span>
                          <span>{quote.markup_applied}%</span>
                        </div>
                      )}
                    </div>
                    <Separator />
                  </div>
                )}

                {/* Customer Price */}
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <Label htmlFor="customerPrice" className="text-sm">Customer Price</Label>
                    {pricingLocked && (
                      <Badge variant="secondary" className="text-xs">
                        <MaterialIcon name="lock" size="sm" className="mr-1" />
                        Locked
                      </Badge>
                    )}
                  </div>
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
                      disabled={pricingLocked && !['under_review', 'tech_submitted'].includes(quote.status || '')}
                    />
                  </div>
                </div>

                {/* Total Display */}
                <div className="bg-muted rounded-lg p-3">
                  <div className="flex justify-between items-center">
                    <span className="font-medium">Total</span>
                    <span className="text-xl font-bold text-primary">
                      {customerPrice ? `$${parseFloat(customerPrice).toFixed(2)}` : '-'}
                    </span>
                  </div>
                </div>

                {/* Internal Cost */}
                <div className="space-y-2">
                  <Label htmlFor="internalCost" className="text-sm text-muted-foreground">
                    Internal Cost (Optional)
                  </Label>
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
                      disabled={pricingLocked && !['under_review', 'tech_submitted'].includes(quote.status || '')}
                    />
                  </div>
                </div>

                {/* Lock Switch and Save */}
                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="pricingLocked"
                      checked={pricingLocked}
                      onCheckedChange={setPricingLocked}
                      disabled={quote.status === 'accepted'}
                    />
                    <Label htmlFor="pricingLocked" className="text-xs">Lock pricing</Label>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleSavePricing}
                    disabled={savingPricing}
                  >
                    {savingPricing ? (
                      <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                    ) : (
                      'Save'
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left Column - Details */}
          <div className="lg:col-span-2 space-y-6">
            {/* Technician Info */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MaterialIcon name="person" size="sm" />
                  Technician
                </CardTitle>
              </CardHeader>
              <CardContent>
                {quote.technician ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{quote.technician.name}</span>
                      <Badge variant="outline">{quote.technician.markup_percent}% markup</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{quote.technician.email}</p>
                    {quote.technician.hourly_rate && (
                      <p className="text-sm text-muted-foreground">
                        Rate: {formatCurrency(quote.technician.hourly_rate)}/hr
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">No technician assigned</p>
                    {activeTechnicians.length > 0 ? (
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
                    ) : (
                      <p className="text-xs text-muted-foreground italic">
                        No technicians found. Add technicians in Settings → Technicians first.
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Items Table */}
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base flex items-center gap-2">
                  <MaterialIcon name="assignment" size="sm" />
                  Items ({quoteItems.length})
                </CardTitle>
                {!['accepted', 'closed', 'expired', 'declined'].includes(quote.status || '') && (
                  <Button variant="outline" size="sm" onClick={handleOpenAddItems}>
                    <MaterialIcon name="add" size="sm" className="mr-1" />
                    Add Items
                  </Button>
                )}
              </CardHeader>
              <CardContent className="p-0">
                {loadingItems ? (
                  <div className="flex items-center justify-center py-8">
                    <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
                  </div>
                ) : quoteItems.length === 0 ? (
                  <div className="text-center py-8">
                    <MaterialIcon name="inventory_2" size="xl" className="mx-auto text-muted-foreground mb-4" />
                    <p className="text-muted-foreground">No items in this quote</p>
                    <Button variant="outline" size="sm" className="mt-4" onClick={handleOpenAddItems}>
                      <MaterialIcon name="add" size="sm" className="mr-1" />
                      Add Items
                    </Button>
                  </div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item Code</TableHead>
                        <TableHead className="w-16">Qty</TableHead>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Location</TableHead>
                        <TableHead>Notes/Photos</TableHead>
                        <TableHead className="w-16"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {quoteItems.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell>
                            <Link
                              to={`/inventory/${item.item_id}`}
                              className="font-medium text-primary hover:underline"
                            >
                              {item.item?.item_code || item.item_code || item.item_id.slice(0, 8)}
                            </Link>
                          </TableCell>
                          <TableCell>1</TableCell>
                          <TableCell>{item.vendor || '-'}</TableCell>
                          <TableCell className="max-w-[200px] truncate">
                            {item.item?.description || item.item_description || '-'}
                          </TableCell>
                          <TableCell>{item.location_code || '-'}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {item.inspection_notes && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2"
                                  title={item.inspection_notes}
                                >
                                  <MaterialIcon name="comment" size="sm" className="text-amber-500" />
                                </Button>
                              )}
                              {item.inspection_photos && item.inspection_photos.length > 0 && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2"
                                  onClick={() => handleViewPhotos(item.inspection_photos!)}
                                >
                                  <MaterialIcon name="photo_camera" size="sm" className="text-blue-500" />
                                  <span className="ml-1 text-xs">{item.inspection_photos.length}</span>
                                </Button>
                              )}
                              {!item.inspection_notes && (!item.inspection_photos || item.inspection_photos.length === 0) && (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            {!['accepted', 'closed', 'expired', 'declined'].includes(quote.status || '') && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-destructive"
                                onClick={() => handleRemoveItem(item.item_id)}
                              >
                                <MaterialIcon name="close" size="sm" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            {/* Tech Notes */}
            {quote.tech_notes && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <MaterialIcon name="comment" size="sm" />
                    Technician Notes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {quote.tech_notes}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Notes */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MaterialIcon name="chat" size="sm" />
                  Notes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <UnifiedNotesSection
                  entityType="repair_quote"
                  entityId={quote.id}
                  embedded
                  allowedNoteTypes={['internal', 'public']}
                />
              </CardContent>
            </Card>

            {/* Source Task Link */}
            {quote.source_task_id && (
              <Card>
                <CardContent className="py-4">
                  <Link
                    to={`/tasks/${quote.source_task_id}`}
                    className="text-primary hover:underline flex items-center gap-2"
                  >
                    <MaterialIcon name="description" size="sm" />
                    View Source Task
                    <MaterialIcon name="open_in_new" size="sm" />
                  </Link>
                </CardContent>
              </Card>
            )}

            {/* History */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MaterialIcon name="history" size="sm" />
                  History ({(quote.audit_log || []).length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {(quote.audit_log || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No history recorded</p>
                ) : (
                  <div className="relative">
                    {/* Timeline line */}
                    <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

                    {/* Timeline items */}
                    <div className="space-y-4">
                      {[...(quote.audit_log || [])].reverse().map((entry: AuditLogEntry, index: number) => (
                        <div key={index} className="relative pl-10">
                          {/* Timeline dot */}
                          <div className="absolute left-0 w-8 h-8 rounded-full bg-background border-2 border-border flex items-center justify-center">
                            {getAuditIcon(entry.action)}
                          </div>

                          {/* Content */}
                          <div className="bg-muted/50 rounded-lg p-3">
                            <div className="flex items-center justify-between flex-wrap gap-2">
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
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Details Sidebar */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Account</span>
                  <span className="font-medium">{quote.account?.name || '-'}</span>
                </div>
                {quote.sidemark && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sidemark</span>
                    <span className="font-medium">{quote.sidemark.name}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Items</span>
                  <span className="font-medium">{quoteItems.length}</span>
                </div>
                {quote.expires_at && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Expires</span>
                    <span className="font-medium">
                      {format(new Date(quote.expires_at), 'MMM d, yyyy')}
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span className="font-medium">
                    {format(new Date(quote.created_at), 'MMM d, yyyy')}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Activity Feed */}
      <div className="mt-6">
        <EntityActivityFeed
          entityType="repair_quote"
          entityId={quote.id}
          title="Activity"
          description="Timeline of all changes to this repair quote"
        />
      </div>

      {/* Add Items Dialog */}
      <Dialog open={addItemsDialogOpen} onOpenChange={setAddItemsDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Add Items to Quote</DialogTitle>
            <DialogDescription>
              Select items from {quote.account?.name} to add to this repair quote.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 flex-1 overflow-hidden">
            <div className="relative">
              <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search items..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="border rounded-lg overflow-auto max-h-[400px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10"></TableHead>
                    <TableHead>Item Code</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Location</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAvailableItems.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        No available items found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAvailableItems.map((item) => (
                      <TableRow
                        key={item.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => {
                          const newSelected = new Set(selectedItemIds);
                          if (newSelected.has(item.id)) {
                            newSelected.delete(item.id);
                          } else {
                            newSelected.add(item.id);
                          }
                          setSelectedItemIds(newSelected);
                        }}
                      >
                        <TableCell>
                          <input
                            type="checkbox"
                            checked={selectedItemIds.has(item.id)}
                            onChange={() => {}}
                            className="w-4 h-4"
                          />
                        </TableCell>
                        <TableCell className="font-medium">{item.item_code}</TableCell>
                        <TableCell>{item.vendor || '-'}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{item.description || '-'}</TableCell>
                        <TableCell>{item.location?.code || '-'}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddItemsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddItems} disabled={selectedItemIds.size === 0 || addingItems}>
              {addingItems ? (
                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
              ) : null}
              Add {selectedItemIds.size} Item{selectedItemIds.size !== 1 ? 's' : ''}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Photo Viewer Dialog */}
      <Dialog open={photoDialogOpen} onOpenChange={setPhotoDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Inspection Photos</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-h-[60vh] overflow-auto">
            {viewingPhotos.map((photo, index) => (
              <a
                key={index}
                href={photo}
                target="_blank"
                rel="noopener noreferrer"
                className="aspect-square relative group"
              >
                <img
                  src={photo}
                  alt={`Photo ${index + 1}`}
                  className="w-full h-full object-cover rounded-lg border"
                />
                <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-lg flex items-center justify-center">
                  <MaterialIcon name="open_in_new" size="md" className="text-white" />
                </div>
              </a>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* DEV: Test Email Dialog */}
      <Dialog open={testEmailDialogOpen} onOpenChange={setTestEmailDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Send Test Email</DialogTitle>
            <DialogDescription>
              Send a test copy of this quote email to any email address.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="testEmail">Email Address</Label>
              <Input
                id="testEmail"
                type="email"
                placeholder="test@example.com"
                value={testEmailAddress}
                onChange={(e) => setTestEmailAddress(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestEmailDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSendTestEmail}
              disabled={!testEmailAddress || sendingTestEmail}
            >
              {sendingTestEmail ? (
                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
              ) : (
                <MaterialIcon name="send" size="sm" className="mr-2" />
              )}
              Send Test
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
