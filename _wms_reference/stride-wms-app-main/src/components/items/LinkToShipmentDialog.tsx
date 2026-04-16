import { useState, useEffect } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { format } from 'date-fns';
import { logActivity } from '@/lib/activity/logActivity';

interface Shipment {
  id: string;
  shipment_number: string;
  shipment_type: string;
  status: string;
  created_at: string;
  account_name?: string;
}

interface LinkToShipmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  itemCode: string;
  onSuccess: () => void;
}

export function LinkToShipmentDialog({
  open,
  onOpenChange,
  itemId,
  itemCode,
  onSuccess,
}: LinkToShipmentDialogProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [linking, setLinking] = useState(false);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedShipmentId, setSelectedShipmentId] = useState<string | null>(null);

  useEffect(() => {
    if (open && profile?.tenant_id) {
      fetchShipments();
    }
  }, [open, profile?.tenant_id]);

  useEffect(() => {
    if (!open) {
      setSearchQuery('');
      setSelectedShipmentId(null);
    }
  }, [open]);

  const fetchShipments = async () => {
    setLoading(true);
    try {
      // Get shipments that are in draft, receiving, or scheduled status
      const { data, error } = await (supabase
        .from('shipments') as any)
        .select('id, shipment_number, shipment_type, status, created_at, account_name')
        .in('status', ['draft', 'receiving', 'scheduled', 'pending'])
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setShipments(data || []);
    } catch (error) {
      console.error('Error fetching shipments:', error);
      toast({
        title: 'Error',
        description: 'Failed to load shipments.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredShipments = shipments.filter(shipment => {
    if (!searchQuery.trim()) return true;
    const query = searchQuery.toLowerCase();
    return (
      shipment.shipment_number.toLowerCase().includes(query) ||
      shipment.shipment_type.toLowerCase().includes(query) ||
      shipment.account_name?.toLowerCase().includes(query)
    );
  });

  const handleLink = async () => {
    if (!selectedShipmentId || !profile?.tenant_id) return;

    setLinking(true);
    try {
      // Check if the item is already linked to this shipment
      const { data: existingLink } = await (supabase
        .from('shipment_items') as any)
        .select('id')
        .eq('shipment_id', selectedShipmentId)
        .eq('item_id', itemId)
        .single();

      if (existingLink) {
        toast({
          title: 'Already Linked',
          description: 'This item is already linked to the selected shipment.',
          variant: 'destructive',
        });
        setLinking(false);
        return;
      }

      // Create the link
      const { error } = await (supabase
        .from('shipment_items') as any)
        .insert({
          shipment_id: selectedShipmentId,
          item_id: itemId,
        });

      if (error) throw error;

      const selectedShipment = shipments.find(s => s.id === selectedShipmentId);

      // Activity logging (best-effort; never blocks UI)
      if (profile?.tenant_id) {
        const shipmentNumber = selectedShipment?.shipment_number || 'Unknown';
        void logActivity({
          entityType: 'item',
          tenantId: profile.tenant_id,
          entityId: itemId,
          actorUserId: profile.id,
          eventType: 'item_shipment_linked',
          eventLabel: `Linked to shipment ${shipmentNumber}`,
          details: {
            shipment_id: selectedShipmentId,
            shipment_number: shipmentNumber,
            shipment_type: selectedShipment?.shipment_type,
            shipment_status: selectedShipment?.status,
          },
        });

        void logActivity({
          entityType: 'shipment',
          tenantId: profile.tenant_id,
          entityId: selectedShipmentId,
          actorUserId: profile.id,
          eventType: 'item_added',
          eventLabel: `Item ${itemCode} linked`,
          details: {
            item_id: itemId,
            item_code: itemCode,
          },
        });
      }

      toast({
        title: 'Item Linked',
        description: `${itemCode} has been linked to ${selectedShipment?.shipment_number}.`,
      });

      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error linking item to shipment:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to link item to shipment.',
        variant: 'destructive',
      });
    } finally {
      setLinking(false);
    }
  };

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      draft: 'bg-gray-100 text-gray-800',
      pending: 'bg-yellow-100 text-yellow-800',
      scheduled: 'bg-blue-100 text-blue-800',
      receiving: 'bg-amber-100 text-amber-800',
    };
    return colors[status] || 'bg-gray-100 text-gray-800';
  };

  const getTypeColor = (type: string) => {
    return type === 'inbound' 
      ? 'bg-green-100 text-green-800' 
      : 'bg-purple-100 text-purple-800';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MaterialIcon name="link" size="md" />
            Link to Shipment
          </DialogTitle>
          <DialogDescription>
            Link {itemCode} to an existing shipment
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1">
          {/* Search */}
          <div className="relative">
            <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search shipments..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Shipment List */}
          <ScrollArea className="h-[300px] border rounded-lg">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
              </div>
            ) : filteredShipments.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-8">
                <MaterialIcon name="inventory_2" className="text-[48px] mb-2" />
                <p className="text-sm">No available shipments found</p>
                <p className="text-xs">Only draft, pending, scheduled, or receiving shipments can be linked</p>
              </div>
            ) : (
              <div className="p-2 space-y-2">
                {filteredShipments.map((shipment) => (
                  <div
                    key={shipment.id}
                    onClick={() => setSelectedShipmentId(shipment.id)}
                    className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                      selectedShipmentId === shipment.id
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted/50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {selectedShipmentId === shipment.id && (
                          <MaterialIcon name="check" size="sm" className="text-primary" />
                        )}
                        <span className="font-medium">{shipment.shipment_number}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge className={getTypeColor(shipment.shipment_type)}>
                          {shipment.shipment_type}
                        </Badge>
                        <Badge className={getStatusColor(shipment.status)}>
                          {shipment.status}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-1 text-sm text-muted-foreground">
                      <span>{shipment.account_name || 'No account'}</span>
                      <span>{format(new Date(shipment.created_at), 'MMM d, yyyy')}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        <DialogFooter className="pt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={linking}>
            Cancel
          </Button>
          <Button
            onClick={handleLink}
            disabled={linking || !selectedShipmentId}
          >
            {linking && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
            Link to Shipment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
