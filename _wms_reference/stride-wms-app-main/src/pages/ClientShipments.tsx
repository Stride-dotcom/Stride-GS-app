import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ClientPortalLayout } from '@/components/client-portal/ClientPortalLayout';
import { useClientPortalContext, useClientShipments } from '@/hooks/useClientPortal';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useIsMobile } from '@/hooks/use-mobile';
import { format, formatDistanceToNow } from 'date-fns';

type StatusFilter = 'all' | 'incoming' | 'outbound' | 'received' | 'released';

const statusFilters: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'incoming', label: 'Incoming' },
  { value: 'outbound', label: 'Outbound' },
  { value: 'received', label: 'Received' },
  { value: 'released', label: 'Released' },
];

const shipmentTypeLabels: Record<string, string> = {
  incoming: 'Incoming',
  outbound: 'Outbound',
  return: 'Return',
};

const getTypeBadge = (type: string) => {
  const variants: Record<string, 'default' | 'secondary' | 'outline'> = {
    incoming: 'default',
    outbound: 'secondary',
    return: 'outline',
  };
  return (
    <Badge variant={variants[type] || 'outline'}>
      {shipmentTypeLabels[type] || type?.replace(/_/g, ' ')}
    </Badge>
  );
};

export default function ClientShipments() {
  const isMobile = useIsMobile();
  const { portalUser, account, tenant, isLoading: contextLoading } = useClientPortalContext();
  const { data: shipments = [], isLoading } = useClientShipments();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<StatusFilter>('all');

  const userName = portalUser?.first_name
    ? `${portalUser.first_name} ${portalUser.last_name || ''}`.trim()
    : portalUser?.email || 'User';

  // Filter shipments
  const filteredShipments = shipments.filter((shipment: any) => {
    const query = searchQuery.toLowerCase();
    const matchesSearch =
      !searchQuery ||
      shipment.shipment_number?.toLowerCase().includes(query) ||
      shipment.origin_name?.toLowerCase().includes(query) ||
      shipment.destination_name?.toLowerCase().includes(query);

    let matchesFilter = true;
    if (activeFilter === 'incoming') {
      matchesFilter = shipment.shipment_type === 'incoming';
    } else if (activeFilter === 'outbound') {
      matchesFilter = shipment.shipment_type === 'outbound';
    } else if (activeFilter === 'received') {
      matchesFilter = shipment.status === 'received';
    } else if (activeFilter === 'released') {
      matchesFilter = shipment.status === 'released';
    }

    return matchesSearch && matchesFilter;
  });

  const getDisplayStatus = (shipment: any): { status: string; label?: string; pendingReview: boolean; waitingSplit: boolean } => {
    const meta = shipment?.metadata && typeof shipment.metadata === 'object' ? shipment.metadata : null;
    const pendingReview = !!(meta && (meta as any).pending_review === true);
    const waitingSplit = !!(meta && (meta as any).split_required === true);
    if (pendingReview) return { status: 'pending_review', label: 'Pending review', pendingReview, waitingSplit: false };
    if (waitingSplit) return { status: 'pending', label: 'Waiting for split', pendingReview: false, waitingSplit };
    return { status: shipment.status || 'pending', pendingReview: false, waitingSplit: false };
  };

  if (contextLoading) {
    return (
      <ClientPortalLayout>
        <div className="flex items-center justify-center h-64">
          <MaterialIcon name="progress_activity" size="xl" className="animate-spin text-muted-foreground" />
        </div>
      </ClientPortalLayout>
    );
  }

  return (
    <ClientPortalLayout
      accountName={account?.name}
      warehouseName={tenant?.name}
      userName={userName}
    >
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Shipments</h1>
            <p className="text-muted-foreground">
              Track your incoming and outgoing shipments
            </p>
          </div>
          <Link to="/client/shipments/new">
            <Button>
              <MaterialIcon name="add" size="sm" className="mr-2" />
              New Shipment
            </Button>
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Shipment History</CardTitle>
            <CardDescription>
              {filteredShipments.length} of {shipments.length} shipments
            </CardDescription>
          </CardHeader>
          <CardContent>
            {/* Search */}
            <div className="flex flex-col gap-4 mb-6">
              <div className="relative flex-1">
                <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by shipment number, origin, or destination..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              {/* Status Filter Tabs */}
              <div className="flex flex-wrap gap-2">
                {statusFilters.map((filter) => (
                  <Button
                    key={filter.value}
                    variant={activeFilter === filter.value ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setActiveFilter(filter.value)}
                  >
                    {filter.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Shipments List */}
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <MaterialIcon name="progress_activity" size="xl" className="animate-spin text-muted-foreground" />
              </div>
            ) : filteredShipments.length === 0 ? (
              <div className="text-center py-12">
                <MaterialIcon name="local_shipping" className="mx-auto text-muted-foreground opacity-50" style={{ fontSize: '48px' }} />
                <h3 className="mt-4 text-lg font-semibold">No shipments found</h3>
                <p className="text-muted-foreground">
                  {searchQuery || activeFilter !== 'all'
                    ? 'Try adjusting your search or filters'
                    : 'No shipments have been created for your account yet'}
                </p>
              </div>
            ) : isMobile ? (
              // Mobile view - cards
              <div className="space-y-3">
                {filteredShipments.map((shipment: any) => (
                  <Link
                    key={shipment.id}
                    to={`/client/shipments/${shipment.id}`}
                    className="block"
                  >
                    <div className="border rounded-lg p-4 cursor-pointer hover:bg-muted/50 transition-colors">
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <p className="font-medium flex items-center gap-2">
                            {shipment.shipment_number}
                            {getDisplayStatus(shipment).pendingReview && (
                              <span title="Pending review" className="text-amber-600">
                                <MaterialIcon name="search" size="sm" />
                              </span>
                            )}
                          </p>
                          <div className="flex items-center gap-2 mt-1">
                            {getTypeBadge(shipment.shipment_type)}
                          </div>
                        </div>
                        {(() => {
                          const ds = getDisplayStatus(shipment);
                          return (
                            <StatusIndicator status={ds.status} label={ds.label} size="sm" />
                          );
                        })()}
                      </div>
                      <div className="flex flex-col gap-1 text-sm text-muted-foreground mt-3">
                        {(shipment.origin_name || shipment.destination_name) && (
                          <span className="flex items-center gap-1">
                            <MaterialIcon name="location_on" size="sm" />
                            {shipment.shipment_type === 'incoming'
                              ? `From: ${shipment.origin_name || 'TBD'}`
                              : `To: ${shipment.destination_name || 'TBD'}`}
                          </span>
                        )}
                        <div className="flex items-center gap-4 text-xs">
                          {shipment.scheduled_date && (
                            <span className="flex items-center gap-1">
                              <MaterialIcon name="event" size="sm" />
                              {format(new Date(shipment.scheduled_date), 'MMM d, yyyy')}
                            </span>
                          )}
                          {shipment.total_items != null && (
                            <span className="flex items-center gap-1">
                              <MaterialIcon name="inventory_2" size="sm" />
                              {shipment.total_items} item{shipment.total_items !== 1 ? 's' : ''}
                            </span>
                          )}
                          <span>
                            {formatDistanceToNow(new Date(shipment.created_at), { addSuffix: true })}
                          </span>
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              // Desktop view - table
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Shipment #</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Scheduled Date</TableHead>
                      <TableHead>Origin / Destination</TableHead>
                      <TableHead>Items</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredShipments.map((shipment: any) => (
                      <TableRow
                        key={shipment.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => {
                          window.location.href = `/client/shipments/${shipment.id}`;
                        }}
                      >
                        <TableCell className="font-medium">
                          <Link
                            to={`/client/shipments/${shipment.id}`}
                            className="hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span className="inline-flex items-center gap-2">
                              {shipment.shipment_number}
                              {getDisplayStatus(shipment).pendingReview && (
                                <span title="Pending review" className="text-amber-600">
                                  <MaterialIcon name="search" size="sm" />
                                </span>
                              )}
                            </span>
                          </Link>
                        </TableCell>
                        <TableCell>{getTypeBadge(shipment.shipment_type)}</TableCell>
                        <TableCell>
                          {(() => {
                            const ds = getDisplayStatus(shipment);
                            return <StatusIndicator status={ds.status} label={ds.label} size="sm" />;
                          })()}
                        </TableCell>
                        <TableCell>
                          {shipment.scheduled_date
                            ? format(new Date(shipment.scheduled_date), 'MMM d, yyyy')
                            : '-'}
                        </TableCell>
                        <TableCell className="max-w-xs truncate">
                          {shipment.shipment_type === 'incoming'
                            ? shipment.origin_name || '-'
                            : shipment.destination_name || '-'}
                        </TableCell>
                        <TableCell>{shipment.total_items ?? '-'}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatDistanceToNow(new Date(shipment.created_at), { addSuffix: true })}
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
    </ClientPortalLayout>
  );
}
