import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface HistoryEvent {
  id: string;
  type: 'status' | 'item' | 'billing' | 'billing_void' | 'assignment' | 'note' | 'created' | 'photo';
  title: string;
  description: string;
  timestamp: string;
  user?: string;
  metadata?: Record<string, any>;
}

interface TaskHistoryTabProps {
  taskId: string;
}

export function TaskHistoryTab({ taskId }: TaskHistoryTabProps) {
  const [events, setEvents] = useState<HistoryEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHistory();
  }, [taskId]);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const allEvents: HistoryEvent[] = [];

      // 1. Fetch task details
      const { data: task } = await supabase
        .from('tasks')
        .select(`
          id,
          title,
          task_type,
          status,
          priority,
          created_at,
          started_at,
          completed_at,
          creator:created_by(first_name, last_name),
          assignee:assigned_to(first_name, last_name)
        `)
        .eq('id', taskId)
        .single();

      if (task) {
        const t = task as any;
        // Task created event
        allEvents.push({
          id: 'created',
          type: 'created',
          title: 'Task Created',
          description: `${t.task_type} task "${t.title}" created`,
          timestamp: t.created_at,
          user: t.creator ? `${t.creator.first_name} ${t.creator.last_name}` : undefined,
          metadata: { priority: t.priority },
        });

        // Assignment event (if assigned)
        if (t.assignee) {
          allEvents.push({
            id: 'assigned',
            type: 'assignment',
            title: 'Task Assigned',
            description: `Assigned to ${t.assignee.first_name} ${t.assignee.last_name}`,
            timestamp: t.created_at, // Using created_at as we don't track assignment time separately
            metadata: { assignee: `${t.assignee.first_name} ${t.assignee.last_name}` },
          });
        }

        // Status change events
        if (t.started_at) {
          allEvents.push({
            id: 'started',
            type: 'status',
            title: 'Task Started',
            description: 'Task work has begun',
            timestamp: t.started_at,
          });
        }

        if (t.completed_at) {
          allEvents.push({
            id: 'completed',
            type: 'status',
            title: 'Task Completed',
            description: 'Task marked as completed',
            timestamp: t.completed_at,
          });
        }

        // Check status for cancelled (no cancelled_at column exists)
        if (t.status === 'cancelled') {
          allEvents.push({
            id: 'cancelled',
            type: 'status',
            title: 'Task Cancelled',
            description: 'Task was cancelled',
            timestamp: t.created_at, // Use created_at as fallback
          });
        }
      }

      // 2. Fetch task items
      const { data: taskItems } = await supabase
        .from('task_items')
        .select(`
          id,
          created_at,
          quantity,
          item:item_id(item_code, description)
        `)
        .eq('task_id', taskId)
        .order('created_at', { ascending: false });

      if (taskItems) {
        taskItems.forEach((ti: any) => {
          allEvents.push({
            id: `item-${ti.id}`,
            type: 'item',
            title: 'Item Added to Task',
            description: ti.item?.item_code
              ? `Item ${ti.item.item_code}${ti.quantity > 1 ? ` (qty: ${ti.quantity})` : ''}`
              : 'Item added',
            timestamp: ti.created_at,
            metadata: {
              itemCode: ti.item?.item_code,
              quantity: ti.quantity,
            },
          });
        });
      }

      // 3. Fetch billing events (including voided ones for audit)
      const { data: billingEvents } = await supabase
        .from('billing_events')
        .select('id, event_type, description, total_amount, status, created_at, updated_at')
        .eq('task_id', taskId)
        .order('created_at', { ascending: false });

      if (billingEvents) {
        billingEvents.forEach((b: any) => {
          const isVoid = b.status === 'void';
          allEvents.push({
            id: `billing-${b.id}`,
            type: isVoid ? 'billing_void' : 'billing',
            title: isVoid ? 'Billing Charge Voided' : 'Billing Event',
            description: isVoid 
              ? `VOIDED: ${b.description || b.event_type} - $${Math.abs(b.total_amount)?.toFixed(2) || '0.00'}`
              : `${b.description || b.event_type} - $${b.total_amount?.toFixed(2) || '0.00'}`,
            timestamp: isVoid && b.updated_at ? b.updated_at : b.created_at,
            metadata: { amount: b.total_amount, status: b.status },
          });
        });
      }

      // 4. Fetch task notes
      const { data: notes } = await supabase
        .from('task_notes')
        .select(`
          id,
          content,
          created_at,
          author:created_by(first_name, last_name)
        `)
        .eq('task_id', taskId)
        .order('created_at', { ascending: false });

      if (notes) {
        notes.forEach((n: any) => {
          allEvents.push({
            id: `note-${n.id}`,
            type: 'note',
            title: 'Note Added',
            description: n.content?.substring(0, 100) + (n.content?.length > 100 ? '...' : ''),
            timestamp: n.created_at,
            user: n.author ? `${n.author.first_name} ${n.author.last_name}` : undefined,
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
        .eq('entity_type', 'task')
        .eq('entity_id', taskId)
        .order('created_at', { ascending: false });

      if (photos) {
        photos.forEach((photo: any) => {
          allEvents.push({
            id: `photo-${photo.id}`,
            type: 'photo',
            title: 'Photo Added',
            description: 'Photo uploaded to task',
            timestamp: photo.created_at,
            user: photo.uploader ? `${photo.uploader.first_name} ${photo.uploader.last_name}` : undefined,
          });
        });
      }

      // Sort all events by timestamp (newest first)
      allEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
      setEvents(allEvents);
    } catch (error) {
      console.error('Error fetching task history:', error);
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
      case 'assignment':
        return <MaterialIcon name="person_add" size="sm" />;
      case 'billing':
        return <MaterialIcon name="attach_money" size="sm" />;
      case 'billing_void':
        return <MaterialIcon name="money_off" size="sm" />;
      case 'note':
        return <MaterialIcon name="sticky_note_2" size="sm" />;
      case 'photo':
        return <MaterialIcon name="photo_camera" size="sm" />;
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
      case 'assignment':
        return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200';
      case 'billing':
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200';
      case 'billing_void':
        return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
      case 'note':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
      case 'photo':
        return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200';
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
          <p className="text-muted-foreground">No history available for this task</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MaterialIcon name="history" size="md" />
          Task History
        </CardTitle>
        <CardDescription>
          Complete timeline of all events for this task
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
