import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface HistoryEvent {
  id: string;
  type: 'status' | 'item' | 'receiving' | 'billing' | 'photo' | 'note' | 'created' | 'audit';
  title: string;
  description: string;
  timestamp: string;
  user?: string;
  metadata?: Record<string, any>;
}

interface ShipmentHistoryTabProps {
  shipmentId: string;
}

export function ShipmentHistoryTab({ shipmentId }: ShipmentHistoryTabProps) {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHistory();
  }, [shipmentId]);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const allEvents: HistoryEvent[] = [];

      // 1. Fetch shipment details for creation event
      const { data: shipment } = await supabase
        .from('shipments')
        .select(`
          id,
          shipment_number,
          status,
          shipment_type,
          created_at,
          received_at,
          completed_at,
          creator:created_by(first_name, last_name)
        `)
        .eq('id', shipmentId)
        .single();

      if (shipment) {
        // Shipment created event
        allEvents.push({
          id: 'created',
          type: 'created',
          title: 'Shipment Created',
          description: `${(shipment as any).shipment_type?.replace('_', ' ')} shipment ${(shipment as any).shipment_number} created`,
          timestamp: (shipment as any).created_at,
          user: (shipment as any).creator ? `${(shipment as any).creator.first_name} ${(shipment as any).creator.last_name}` : undefined,
        });

        // Status change events
        if ((shipment as any).received_at) {
          allEvents.push({
            id: 'received',
            type: 'status',
            title: 'Receiving Completed',
            description: 'Shipment marked as received',
            timestamp: (shipment as any).received_at,
          });
        }

        if ((shipment as any).completed_at) {
          allEvents.push({
            id: 'completed',
            type: 'status',
            title: 'Shipment Completed',
            description: 'Shipment marked as completed',
            timestamp: (shipment as any).completed_at,
          });
        }

        // Check status for cancelled (no cancelled_at column exists)
        if ((shipment as any).status === 'cancelled') {
          allEvents.push({
            id: 'cancelled',
            type: 'status',
            title: 'Shipment Cancelled',
            description: 'Shipment was cancelled',
            timestamp: (shipment as any).created_at, // Use created_at as fallback
          });
        }
      }

      // 2. Fetch shipment items
      const { data: shipmentItems } = await supabase
        .from('shipment_items')
        .select(`
          id,
          created_at,
          status,
          expected_quantity,
          actual_quantity,
          item:item_id(item_code)
        `)
        .eq('shipment_id', shipmentId)
        .order('created_at', { ascending: false });

      if (shipmentItems) {
        shipmentItems.forEach((si: any) => {
          allEvents.push({
            id: `item-${si.id}`,
            type: 'item',
            title: 'Item Added',
            description: si.item?.item_code
              ? `Item ${si.item.item_code} added to shipment`
              : `Expected ${si.expected_quantity || 1} item(s) added`,
            timestamp: si.created_at,
            metadata: {
              itemCode: si.item?.item_code,
              expectedQty: si.expected_quantity,
              actualQty: si.actual_quantity,
            },
          });
        });
      }

      // 3. Fetch receiving sessions
      const { data: sessions } = await supabase
        .from('receiving_sessions')
        .select(`
          id,
          started_at,
          finished_at,
          user:started_by(first_name, last_name)
        `)
        .eq('shipment_id', shipmentId)
        .order('started_at', { ascending: false });

      if (sessions) {
        sessions.forEach((session: any) => {
          allEvents.push({
            id: `session-start-${session.id}`,
            type: 'receiving',
            title: 'Receiving Started',
            description: 'Receiving session started',
            timestamp: session.started_at,
            user: session.user ? `${session.user.first_name} ${session.user.last_name}` : undefined,
          });

          if (session.finished_at) {
            allEvents.push({
              id: `session-end-${session.id}`,
              type: 'receiving',
              title: 'Receiving Session Completed',
              description: 'Receiving session finished',
              timestamp: session.finished_at,
              user: session.user ? `${session.user.first_name} ${session.user.last_name}` : undefined,
            });
          }
        });
      }

      // 4. Fetch billing events
      const { data: billingEvents } = await supabase
        .from('billing_events')
        .select('id, event_type, description, total_amount, created_at')
        .eq('shipment_id', shipmentId)
        .order('created_at', { ascending: false });

      if (billingEvents) {
        billingEvents.forEach((b: any) => {
          allEvents.push({
            id: `billing-${b.id}`,
            type: 'billing',
            title: 'Billing Event',
            description: `${b.description || b.event_type} - $${b.total_amount?.toFixed(2) || '0.00'}`,
            timestamp: b.created_at,
            metadata: { amount: b.total_amount },
          });
        });
      }

      // 5. Fetch photos (using 'as any' because 'photos' table may not be in typed schema)
      const { data: photos } = await (supabase as any)
        .from('photos')
        .select(`
          id,
          created_at,
          uploader:uploaded_by(first_name, last_name)
        `)
        .eq('entity_type', 'shipment')
        .eq('entity_id', shipmentId)
        .order('created_at', { ascending: false });

      if (photos) {
        photos.forEach((photo: any) => {
          allEvents.push({
            id: `photo-${photo.id}`,
            type: 'photo',
            title: 'Photo Added',
            description: 'Photo uploaded to shipment',
            timestamp: photo.created_at,
            user: photo.uploader ? `${photo.uploader.first_name} ${photo.uploader.last_name}` : undefined,
          });
        });
      }

      // 6. Fetch audit log entries for scans and partial releases
      const { data: auditEntries } = await (supabase as any)
        .from('admin_audit_log')
        .select(`
          id,
          action,
          changes_json,
          created_at,
          actor:actor_id(first_name, last_name)
        `)
        .eq('entity_type', 'shipment')
        .eq('entity_id', shipmentId)
        .order('created_at', { ascending: false });

      if (auditEntries) {
        auditEntries.forEach((entry: any) => {
          const actionLabel = String(entry.action || 'Audit Event');
          
          // Format description based on action type
          let detail = '';
          if (entry.action === 'account_reassigned') {
            const fromName = entry.changes_json?.previous_account_name || 'Unknown';
            const toName = entry.changes_json?.new_account_name || 'Unknown';
            detail = `Account changed from "${fromName}" to "${toName}"`;
          } else if (entry.action === 'status_changed') {
            const prevStatus = entry.changes_json?.previous_status || 'unknown';
            const newStatus = entry.changes_json?.new_status || 'unknown';
            const actionNote = entry.changes_json?.action || '';
            detail = actionNote || `Status changed from ${prevStatus} to ${newStatus}`;
          } else {
            detail = entry.changes_json?.message
              || entry.changes_json?.note
              || entry.changes_json?.scan_value
              || 'Shipment activity recorded';
          }
          
          allEvents.push({
            id: `audit-${entry.id}`,
            type: 'audit',
            title: actionLabel.replace(/_/g, ' ').toUpperCase(),
            description: detail,
            timestamp: entry.created_at,
            user: entry.actor ? `${entry.actor.first_name} ${entry.actor.last_name}` : undefined,
            metadata: entry.changes_json || undefined,
          });
        });
      }

      // Sort all events by timestamp (newest first)
      allEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setEvents(allEvents);
    } catch (error) {
      console.error('Error fetching shipment history:', error);
    } finally {
      setLoading(false);
    }
  };

  const getEventIcon = (type: HistoryEvent['type']) => {
    switch (type) {
      case 'created':
        return <MaterialIcon name="add_circle" size="sm" />;
      case 'status':
        return <MaterialIcon name="swap_horiz" size="sm" />;
      case 'item':
        return <MaterialIcon name="inventory_2" size="sm" />;
      case 'receiving':
        return <MaterialIcon name="assignment_turned_in" size="sm" />;
      case 'billing':
        return <MaterialIcon name="attach_money" size="sm" />;
      case 'photo':
        return <MaterialIcon name="photo_camera" size="sm" />;
      case 'note':
        return <MaterialIcon name="sticky_note_2" size="sm" />;
      case 'audit':
        return <MaterialIcon name="history" size="sm" />;
      default:
        return <MaterialIcon name="history" size="sm" />;
    }
  };

  const getEventColor = (type: HistoryEvent['type']) => {
    switch (type) {
      case 'created':
        return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
      case 'status':
        return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
      case 'item':
        return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
      case 'receiving':
        return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
      case 'billing':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200';
      case 'photo':
        return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200';
      case 'note':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'audit':
        return 'bg-slate-100 text-slate-800 dark:bg-slate-900 dark:text-slate-200';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-48">
          <MaterialIcon name="progress_activity" className="text-[32px] animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (events.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center h-48 text-center">
          <MaterialIcon name="history" className="text-[48px] text-muted-foreground mb-4" />
          <p className="text-muted-foreground">No history available for this shipment</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MaterialIcon name="history" size="md" />
          Shipment History
        </CardTitle>
        <CardDescription>
          Complete timeline of all events for this shipment
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[400px] pr-4">
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />

            {/* Events */}
            <div className="space-y-4">
              {events.map((event) => (
                <div key={event.id} className="relative flex gap-4 pl-10">
                  {/* Timeline dot */}
                  <div className={`absolute left-2 w-5 h-5 rounded-full flex items-center justify-center ${getEventColor(event.type)}`}>
                    {getEventIcon(event.type)}
                  </div>

                  {/* Event content */}
                  <div className="flex-1 bg-muted/50 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span className="font-medium text-sm">{event.title}</span>
                      <Badge variant="outline" className="text-xs">
                        {event.type}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{event.description}</p>
                    <div className="flex items-center justify-between mt-1">
                      <p className="text-xs text-muted-foreground">
                        {format(new Date(event.timestamp), 'MMM d, yyyy h:mm a')}
                      </p>
                      {event.user && (
                        <p className="text-xs text-muted-foreground flex items-center gap-1">
                          <MaterialIcon name="person" className="text-[12px]" />
                          {event.user}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
