/**
 * ItemBillingEventsSection - Shows billing events associated with an item
 *
 * Only visible to managers and above. Displays service event charges,
 * task charges, and other billing events for the item.
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { format } from 'date-fns';

interface BillingEvent {
  id: string;
  charge_type: string;
  description: string | null;
  quantity: number;
  unit_rate: number;
  total_amount: number | null;
  status: string;
  event_type: string;
  created_at: string;
}

interface ItemBillingEventsSectionProps {
  itemId: string;
  refreshKey?: number;
}

export function ItemBillingEventsSection({
  itemId,
  refreshKey = 0,
}: ItemBillingEventsSectionProps) {
  const { profile } = useAuth();
  const [events, setEvents] = useState<BillingEvent[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchEvents = useCallback(async () => {
    if (!profile?.tenant_id || !itemId) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await (supabase
        .from('billing_events') as any)
        .select('id, charge_type, description, quantity, unit_rate, total_amount, status, event_type, created_at')
        .eq('tenant_id', profile.tenant_id)
        .eq('item_id', itemId)
        .in('status', ['unbilled', 'invoiced', 'void'])
        .order('created_at', { ascending: false });

      if (error) {
        console.error('[ItemBillingEventsSection] Error fetching events:', error);
      }

      setEvents(data || []);
    } catch (error) {
      console.error('[ItemBillingEventsSection] Unexpected error:', error);
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, itemId]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents, refreshKey]);

  // Calculate totals
  const unbilledTotal = events
    .filter(e => e.status === 'unbilled')
    .reduce((sum, e) => sum + (e.total_amount || e.unit_rate * e.quantity), 0);

  const billedTotal = events
    .filter(e => e.status === 'invoiced')
    .reduce((sum, e) => sum + (e.total_amount || e.unit_rate * e.quantity), 0);

  const grandTotal = unbilledTotal + billedTotal;

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  // Get status badge
  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      unbilled: 'secondary',
      flagged: 'destructive',
      billed: 'default',
    };
    const labels: Record<string, string> = {
      unbilled: 'Unbilled',
      flagged: 'Flagged',
      billed: 'Billed',
    };
    return <Badge variant={variants[status] || 'outline'}>{labels[status] || status}</Badge>;
  };

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MaterialIcon name="receipt_long" size="sm" />
            Billing Events
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (events.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MaterialIcon name="receipt_long" size="sm" />
            Billing Events
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            No billing events for this item
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MaterialIcon name="receipt_long" size="sm" />
          Billing Events ({events.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Events List */}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {events.map((event) => (
            <div
              key={event.id}
              className="flex items-start justify-between py-2 border-b last:border-b-0 text-sm"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium truncate">{event.charge_type}</span>
                  {getStatusBadge(event.status)}
                </div>
                {event.description && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {event.description}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-0.5">
                  {format(new Date(event.created_at), 'MMM d, yyyy')}
                </p>
              </div>
              <span className="font-medium ml-2">
                {formatCurrency(event.total_amount || event.unit_rate * event.quantity)}
              </span>
            </div>
          ))}
        </div>

        {/* Totals */}
        <div className="border-t pt-3 space-y-1">
          {unbilledTotal > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Unbilled</span>
              <span className="font-medium">{formatCurrency(unbilledTotal)}</span>
            </div>
          )}
          {billedTotal > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Billed</span>
              <span className="font-medium">{formatCurrency(billedTotal)}</span>
            </div>
          )}
          <div className="flex justify-between pt-1">
            <span className="font-semibold">Total</span>
            <span className="text-lg font-bold text-primary">{formatCurrency(grandTotal)}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default ItemBillingEventsSection;
