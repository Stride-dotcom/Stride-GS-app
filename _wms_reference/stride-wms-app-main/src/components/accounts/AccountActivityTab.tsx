/**
 * AccountActivityTab - Full activity timeline for an account.
 *
 * Displays events from account_activity and related entity activity tables
 * (shipments, tasks, items). Includes filter chips, search, date range,
 * and "load more" pagination.
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import {
  useAccountActivity,
  type AccountActivityFilter,
  type UnifiedActivity,
} from '@/hooks/useAccountActivity';
import { format, formatDistanceToNow } from 'date-fns';
import { parseMessageWithLinks, type EntityMap } from '@/utils/parseEntityLinks';
import { useEntityMap } from '@/hooks/useEntityMap';
import { ActivityDetailsDisplay } from '@/components/activity/ActivityDetailsDisplay';

interface AccountActivityTabProps {
  accountId: string;
}

const FILTER_OPTIONS: { value: AccountActivityFilter; label: string; icon: string }[] = [
  { value: 'all', label: 'All', icon: 'list' },
  { value: 'billing', label: 'Billing', icon: 'attach_money' },
  { value: 'invoices', label: 'Invoices', icon: 'receipt' },
  { value: 'shipments', label: 'Shipments', icon: 'local_shipping' },
  { value: 'tasks', label: 'Tasks', icon: 'assignment' },
  { value: 'items', label: 'Items', icon: 'inventory_2' },
  { value: 'settings', label: 'Settings', icon: 'settings' },
];

function getEventIcon(eventType: string, source: string): string {
  if (source === 'shipment') {
    if (eventType.includes('received') || eventType.includes('scanned')) return 'qr_code_scanner';
    if (eventType.includes('status')) return 'local_shipping';
    return 'local_shipping';
  }
  if (source === 'task') {
    if (eventType.includes('completed')) return 'check_circle';
    if (eventType.includes('assigned')) return 'person';
    if (eventType.includes('started')) return 'play_arrow';
    return 'assignment';
  }
  if (source === 'item') {
    if (eventType.includes('moved') || eventType.includes('location')) return 'location_on';
    if (eventType.includes('note')) return 'sticky_note_2';
    if (eventType.includes('photo')) return 'photo_camera';
    if (eventType.includes('status')) return 'swap_horiz';
    return 'inventory_2';
  }
  // Account-level events
  if (eventType.includes('invoice')) return 'receipt';
  if (eventType.includes('invoiced') || eventType.includes('billing')) return 'receipt_long';
  if (eventType.includes('updated') || eventType.includes('edited')) return 'edit';
  if (eventType.includes('voided') || eventType.includes('uninvoiced')) return 'undo';
  if (eventType.includes('charge')) return 'attach_money';
  if (eventType.includes('status')) return 'swap_horiz';
  if (eventType.includes('setting') || eventType.includes('account_updated')) return 'settings';
  if (eventType.includes('created')) return 'add_circle';
  return 'history';
}

function getEventColor(eventType: string, source: string): string {
  if (source === 'shipment')
    return 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200';
  if (source === 'task')
    return 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200';
  if (source === 'item')
    return 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200';

  if (eventType.includes('invoiced') && !eventType.includes('uninvoiced'))
    return 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200';
  if (eventType.includes('uninvoiced') || eventType.includes('voided'))
    return 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
  if (eventType.includes('updated') || eventType.includes('edited'))
    return 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200';
  if (eventType.includes('completed'))
    return 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200';
  if (eventType.includes('charge') || eventType.includes('billing_charge'))
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200';
  if (eventType.includes('setting') || eventType.includes('account_updated'))
    return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200';
  return 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
}

function getSourceLabel(source: string): string {
  switch (source) {
    case 'shipment': return 'Shipment';
    case 'task': return 'Task';
    case 'item': return 'Item';
    default: return 'Account';
  }
}

function OpenEntityLink({ activity }: { activity: UnifiedActivity }) {
  if (activity.source === 'account') return null;

  const entityId = activity.entity_id;
  if (!entityId) return null;

  let href = '';
  let label = '';
  switch (activity.source) {
    case 'shipment':
      // Use scan redirect to land on the correct inbound/outbound detail screen.
      href = `/scan/shipment/${entityId}`;
      label = 'Open Shipment';
      break;
    case 'task':
      href = `/tasks/${entityId}`;
      label = 'Open Task';
      break;
    case 'item':
      href = `/inventory/${entityId}`;
      label = 'Open Item';
      break;
  }

  if (!href) return null;

  return (
    <Link
      to={href}
      className="inline-flex items-center gap-1 text-xs text-primary hover:underline mt-1"
      onClick={(e) => {
        e.stopPropagation();
      }}
    >
      <MaterialIcon name="open_in_new" className="text-[12px]" />
      {label}
    </Link>
  );
}

function ActivityRow({ activity, entityMap }: { activity: UnifiedActivity; entityMap?: EntityMap }) {
  return (
    <div className="relative flex gap-3 pl-10">
      {/* Timeline dot */}
      <div
        className={`absolute left-2 w-5 h-5 rounded-full flex items-center justify-center ${getEventColor(activity.event_type, activity.source)}`}
      >
        <MaterialIcon
          name={getEventIcon(activity.event_type, activity.source)}
          className="text-[12px]"
        />
      </div>

      {/* Event content */}
      <div className="flex-1 bg-muted/50 rounded-lg p-3 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-0.5">
          <span className="font-medium text-sm leading-tight">
            {parseMessageWithLinks(activity.event_label, entityMap, { variant: 'inline' })}
          </span>
          <Badge variant="outline" className="text-[10px] px-1 flex-shrink-0">
            {getSourceLabel(activity.source)}
          </Badge>
        </div>

        {/* Actor + time */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium">{activity.actor_name || 'System'}</span>
          <span>-</span>
          <span title={format(new Date(activity.created_at), 'MMM d, yyyy h:mm:ss a')}>
            {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
          </span>
        </div>

        {/* Entity link */}
        <OpenEntityLink activity={activity} />

        {/* Expandable details */}
        <ActivityDetailsDisplay details={activity.details} entityMap={entityMap} linkVariant="inline" />
      </div>
    </div>
  );
}

export function AccountActivityTab({ accountId }: AccountActivityTabProps) {
  const {
    activities,
    loading,
    loadingMore,
    filter,
    setFilter,
    search,
    setSearch,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    hasMore,
    loadMore,
  } = useAccountActivity(accountId);

  const [showDateRange, setShowDateRange] = useState(false);
  const entityMap = useEntityMap(activities);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-7 w-20" />
          ))}
        </div>
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex gap-4 pl-10">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {FILTER_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            variant={filter === opt.value ? 'default' : 'outline'}
            size="sm"
            className="h-7 text-xs px-2.5"
            onClick={() => setFilter(opt.value)}
          >
            <MaterialIcon name={opt.icon} className="text-[12px] mr-1" />
            {opt.label}
          </Button>
        ))}
      </div>

      {/* Search + date range toggle */}
      <div className="flex gap-2 items-center">
        <div className="relative flex-1">
          <MaterialIcon
            name="search"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[16px] text-muted-foreground"
          />
          <Input
            placeholder="Search activity..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>
        <Button
          variant={showDateRange ? 'default' : 'outline'}
          size="sm"
          className="h-8 text-xs"
          onClick={() => setShowDateRange(!showDateRange)}
        >
          <MaterialIcon name="date_range" className="text-[14px] mr-1" />
          Dates
        </Button>
      </div>

      {/* Date range inputs */}
      {showDateRange && (
        <div className="flex gap-2 items-center">
          <Input
            type="date"
            value={dateFrom || ''}
            onChange={(e) => setDateFrom(e.target.value || undefined)}
            className="h-8 text-xs flex-1"
            placeholder="From"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={dateTo || ''}
            onChange={(e) => setDateTo(e.target.value || undefined)}
            className="h-8 text-xs flex-1"
            placeholder="To"
          />
          {(dateFrom || dateTo) && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs px-2"
              onClick={() => {
                setDateFrom(undefined);
                setDateTo(undefined);
              }}
            >
              Clear
            </Button>
          )}
        </div>
      )}

      {/* Activity timeline */}
      {activities.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-32 text-center">
          <MaterialIcon name="timeline" className="text-[36px] text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            {filter === 'all' && !search
              ? 'No activity recorded yet'
              : `No matching ${filter === 'all' ? '' : filter + ' '}activity`}
          </p>
        </div>
      ) : (
        <ScrollArea className="h-[400px] pr-4">
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-border" />

            {/* Events */}
            <div className="space-y-3">
              {activities.map((activity) => (
                <ActivityRow key={activity.id} activity={activity} entityMap={entityMap} />
              ))}
            </div>

            {/* Load more */}
            {hasMore && (
              <div className="flex justify-center pt-4 pb-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="text-xs"
                >
                  {loadingMore ? (
                    <>
                      <MaterialIcon
                        name="progress_activity"
                        className="text-[14px] mr-1 animate-spin"
                      />
                      Loading...
                    </>
                  ) : (
                    <>
                      <MaterialIcon name="expand_more" className="text-[14px] mr-1" />
                      Load more
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </ScrollArea>
      )}

      {/* Count footer */}
      {activities.length > 0 && (
        <p className="text-xs text-muted-foreground text-center">
          Showing {activities.length} event{activities.length !== 1 ? 's' : ''}
          {hasMore ? ' (more available)' : ''}
        </p>
      )}
    </div>
  );
}
