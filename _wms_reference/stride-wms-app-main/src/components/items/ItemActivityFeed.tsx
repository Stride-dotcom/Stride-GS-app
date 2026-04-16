/**
 * ItemActivityFeed - Unified activity timeline for an item.
 * Shows all logged events from item_activity with filters, actor name, and time.
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useItemActivity } from '@/hooks/useItemActivity';
import { format, formatDistanceToNow } from 'date-fns';
import { parseMessageWithLinks } from '@/utils/parseEntityLinks';
import { useEntityMap } from '@/hooks/useEntityMap';
import { ActivityDetailsDisplay } from '@/components/activity/ActivityDetailsDisplay';
import { useMemo, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface ItemActivityFeedProps {
  itemId: string;
}

type ItemActivityFilterCategory =
  | 'all'
  | 'movements'
  | 'tasks'
  | 'shipments'
  | 'notes'
  | 'billing'
  | 'photos_docs'
  | 'status_account'
  | 'repair';

const FILTER_OPTIONS: { value: ItemActivityFilterCategory; label: string; icon: string }[] = [
  { value: 'all', label: 'All', icon: 'list' },
  { value: 'movements', label: 'Movements', icon: 'location_on' },
  { value: 'tasks', label: 'Tasks', icon: 'assignment' },
  { value: 'shipments', label: 'Shipments', icon: 'local_shipping' },
  { value: 'notes', label: 'Notes', icon: 'sticky_note_2' },
  { value: 'billing', label: 'Billing', icon: 'attach_money' },
  { value: 'photos_docs', label: 'Photos & Docs', icon: 'photo_library' },
  { value: 'status_account', label: 'Status/Account', icon: 'tune' },
  { value: 'repair', label: 'Repair', icon: 'handyman' },
];

function matchesCategory(eventType: string, category: Exclude<ItemActivityFilterCategory, 'all'>): boolean {
  switch (category) {
    case 'movements':
      return (
        eventType === 'item_moved' ||
        eventType === 'item_location_changed' ||
        eventType === 'location_override' ||
        eventType === 'quarantine_override'
      );
    case 'tasks':
      return eventType.startsWith('task_');
    case 'shipments':
      return (
        eventType.startsWith('item_shipment_') ||
        eventType.startsWith('item_manifest_') ||
        eventType.includes('received_in_shipment') ||
        eventType.includes('released_in_shipment')
      );
    case 'notes':
      return eventType.startsWith('item_note_');
    case 'billing':
      return (
        eventType.startsWith('billing_') ||
        eventType === 'billing_charge_added' ||
        eventType.startsWith('item_flag_') ||
        eventType.startsWith('indicator_') ||
        eventType === 'flag_alert_sent' ||
        eventType === 'item_scan_charge_applied'
      );
    case 'photos_docs':
      return (
        eventType.startsWith('item_photo_') ||
        eventType.startsWith('item_document_') ||
        eventType.startsWith('document_') ||
        eventType.includes('document')
      );
    case 'status_account':
      return (
        eventType.startsWith('item_status_') ||
        eventType.startsWith('item_account_') ||
        eventType.startsWith('item_class_') ||
        eventType === 'item_field_updated' ||
        eventType === 'item_custom_field_updated' ||
        eventType === 'inventory_count_recorded' ||
        eventType === 'damage_cleared' ||
        eventType === 'item_coverage_changed'
      );
    case 'repair':
      return (
        eventType.startsWith('item_repair_quote_') ||
        eventType.startsWith('repair_quote_') ||
        eventType.startsWith('item_repair_')
      );
  }
}

function getEventIcon(eventType: string): string {
  if (eventType.startsWith('item_flag')) return 'flag';
  if (eventType.startsWith('item_scan') || eventType.startsWith('billing')) return 'attach_money';
  if (eventType.startsWith('item_note')) return 'sticky_note_2';
  if (eventType.startsWith('item_photo')) return 'photo_camera';
  if (
    eventType.startsWith('item_document') ||
    eventType.startsWith('document_') ||
    eventType.includes('document')
  ) {
    return 'description';
  }
  if (
    eventType.startsWith('item_shipment') ||
    eventType.startsWith('item_manifest') ||
    eventType.includes('received_in_shipment') ||
    eventType.includes('released_in_shipment')
  ) {
    return 'local_shipping';
  }
  if (
    eventType.startsWith('item_repair_quote') ||
    eventType.startsWith('repair_quote') ||
    eventType.startsWith('item_repair_')
  ) {
    return 'handyman';
  }
  if (eventType.startsWith('item_coverage') || eventType.includes('coverage')) return 'verified_user';
  if (eventType.startsWith('item_status')) return 'swap_horiz';
  if (eventType.startsWith('item_account')) return 'business';
  if (eventType.startsWith('item_class')) return 'category';
  if (eventType.startsWith('item_moved') || eventType.startsWith('item_location')) return 'location_on';
  if (eventType.startsWith('item_field') || eventType.startsWith('item_custom_field')) return 'edit';
  if (eventType.startsWith('task_')) return 'assignment';
  if (eventType.startsWith('inventory_count')) return 'inventory';
  if (eventType.startsWith('indicator')) return 'warning';
  if (eventType.startsWith('flag_alert')) return 'notifications';
  return 'history';
}

function getEventColor(eventType: string): string {
  if (eventType.includes('flag_applied') || eventType.includes('billing_event_created') || eventType.includes('scan_charge'))
    return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
  if (eventType.includes('flag_removed') || eventType.includes('voided'))
    return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
  if (eventType.includes('moved') || eventType.includes('location'))
    return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200';
  if (eventType.startsWith('task_'))
    return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
  if (eventType.includes('note'))
    return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200';
  if (eventType.includes('photo') || eventType.includes('document'))
    return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
  if (
    eventType.includes('shipment') ||
    eventType.includes('manifest') ||
    eventType.includes('received_in_shipment') ||
    eventType.includes('released_in_shipment')
  ) {
    return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
  }
  if (eventType.includes('repair_quote') || eventType.startsWith('item_repair_')) {
    return 'bg-rose-100 text-rose-800 dark:bg-rose-900 dark:text-rose-200';
  }
  if (eventType.includes('coverage')) {
    return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200';
  }
  if (eventType.includes('status') || eventType.includes('account') || eventType.includes('class') || eventType.includes('field'))
    return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200';
  if (eventType.includes('billing_charge_added'))
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200';
  if (eventType.includes('indicator'))
    return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200';
  return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
}

function getEventCategory(eventType: string): string {
  if (matchesCategory(eventType, 'movements')) return 'movements';
  if (matchesCategory(eventType, 'tasks')) return 'tasks';
  if (matchesCategory(eventType, 'shipments')) return 'shipments';
  if (matchesCategory(eventType, 'notes')) return 'notes';
  if (matchesCategory(eventType, 'billing')) return 'billing';
  if (matchesCategory(eventType, 'photos_docs')) return 'photos & docs';
  if (matchesCategory(eventType, 'status_account')) return 'status/account';
  if (matchesCategory(eventType, 'repair')) return 'repair';
  return 'update';
}

export function ItemActivityFeed({ itemId }: ItemActivityFeedProps) {
  const { activities, loading } = useItemActivity(itemId);
  const [selectedCategories, setSelectedCategories] = useState<ItemActivityFilterCategory[]>(['all']);

  const filteredActivities = useMemo(() => {
    if (selectedCategories.includes('all')) return activities;
    const selected = selectedCategories.filter((c) => c !== 'all') as Array<Exclude<ItemActivityFilterCategory, 'all'>>;
    return activities.filter((a) => selected.some((cat) => matchesCategory(a.event_type, cat)));
  }, [activities, selectedCategories]);

  const entityMap = useEntityMap(filteredActivities, '[ItemActivityFeed] entity resolution failed:');

  const activeFilterCount = selectedCategories.filter((c) => c !== 'all').length;

  const toggleCategory = (cat: ItemActivityFilterCategory, nextChecked: boolean) => {
    setSelectedCategories((prev) => {
      // All is a special state
      if (cat === 'all') return ['all'];

      const withoutAll = prev.filter((c) => c !== 'all');
      const has = withoutAll.includes(cat);
      const next = nextChecked
        ? (has ? withoutAll : [...withoutAll, cat])
        : withoutAll.filter((c) => c !== cat);

      return next.length === 0 ? ['all'] : next;
    });
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="timeline" size="md" />
            Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-4 pl-10">
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="timeline" size="md" />
              Activity
            </CardTitle>
            <CardDescription>
              Complete timeline of all changes to this item
            </CardDescription>
          </div>

          {/* Filter button */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="relative h-9 w-9 flex-shrink-0" aria-label="Filter activity">
                <MaterialIcon name="filter_list" size="sm" />
                {activeFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-medium bg-primary text-primary-foreground rounded-full">
                    {activeFilterCount}
                  </span>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[220px]">
              <DropdownMenuLabel>Filter</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {FILTER_OPTIONS.map((opt) => (
                <DropdownMenuCheckboxItem
                  key={opt.value}
                  checked={selectedCategories.includes(opt.value)}
                  onCheckedChange={(checked) => toggleCategory(opt.value, !!checked)}
                >
                  <div className="flex items-center gap-2">
                    <MaterialIcon name={opt.icon} size="sm" className="text-muted-foreground" />
                    <span>{opt.label}</span>
                  </div>
                </DropdownMenuCheckboxItem>
              ))}
              <DropdownMenuSeparator />
              <Button
                type="button"
                variant="ghost"
                className="w-full justify-start h-8 px-2 text-sm"
                onClick={() => setSelectedCategories(['all'])}
              >
                <MaterialIcon name="restart_alt" size="sm" className="mr-2 text-muted-foreground" />
                Reset
              </Button>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>

      <CardContent>
        {filteredActivities.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-center">
            <MaterialIcon name="timeline" className="text-[36px] text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">
              {selectedCategories.includes('all')
                ? 'No activity recorded yet'
                : 'No matching activity for the selected filters'}
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[450px] pr-4">
            <div className="relative">
              {/* Timeline line */}
              <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />

              {/* Events */}
              <div className="space-y-3">
                {filteredActivities.map((activity) => (
                  <div key={activity.id} className="relative flex gap-3 pl-10">
                    {/* Timeline dot */}
                    <div className={`absolute left-2 w-5 h-5 rounded-full flex items-center justify-center ${getEventColor(activity.event_type)}`}>
                      <MaterialIcon name={getEventIcon(activity.event_type)} className="text-[12px]" />
                    </div>

                    {/* Event content */}
                    <div className="flex-1 bg-muted/50 rounded-lg p-3 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-0.5">
                        <span className="font-medium text-sm leading-tight">
                          {parseMessageWithLinks(activity.event_label, entityMap, { variant: 'inline' })}
                        </span>
                        <Badge variant="outline" className="text-[10px] px-1 flex-shrink-0">
                          {getEventCategory(activity.event_type)}
                        </Badge>
                      </div>

                      {/* Actor + time */}
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        {activity.actor_name && (
                          <>
                            <span className="font-medium">{activity.actor_name}</span>
                            <span>-</span>
                          </>
                        )}
                        <span title={format(new Date(activity.created_at), 'MMM d, yyyy h:mm:ss a')}>
                          {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                        </span>
                      </div>

                      {/* Expandable details */}
                      <ActivityDetailsDisplay details={activity.details} entityMap={entityMap} linkVariant="inline" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
