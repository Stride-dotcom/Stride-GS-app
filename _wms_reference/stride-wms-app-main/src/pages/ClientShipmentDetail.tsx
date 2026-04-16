import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Navigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useClientPortalContext } from '@/hooks/useClientPortal';
import { isValidUuid } from '@/lib/utils';
import { ClientPortalLayout } from '@/components/client-portal/ClientPortalLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Skeleton } from '@/components/ui/skeleton';
import { TaggablePhotoGrid, TaggablePhoto, getPhotoUrls } from '@/components/common/TaggablePhotoGrid';
import { DocumentList } from '@/components/scanner';
import { ShipmentNotesSection } from '@/components/shipments/ShipmentNotesSection';
import { CoverageBadge, COVERAGE_LABELS, type CoverageType } from '@/components/coverage/CoverageSelector';
import { format } from 'date-fns';

// ============================================
// TYPES
// ============================================

interface ShipmentDetail {
  id: string;
  shipment_number: string;
  shipment_type: string;
  status: string;
  metadata?: Record<string, unknown> | null;
  scheduled_date: string | null;
  origin_name: string | null;
  destination_name: string | null;
  total_items: number | null;
  tracking_number: string | null;
  po_number: string | null;
  carrier: string | null;
  coverage_type: string | null;
  receiving_photos: (string | TaggablePhoto)[] | null;
  release_photos: (string | TaggablePhoto)[] | null;
  created_at: string;
  account_id: string | null;
}

interface ShipmentItemData {
  id: string;
  status: string;
  item: {
    id: string;
    item_code: string;
    description: string | null;
    status: string;
    condition: string | null;
    category: string | null;
    coverage_type: string | null;
    declared_value: number | null;
  } | null;
}

// ============================================
// HELPERS
// ============================================

const shipmentTypeLabels: Record<string, string> = {
  incoming: 'Incoming',
  outbound: 'Outbound',
  return: 'Return',
};

const shipmentStatusLabels: Record<string, string> = {
  expected: 'Expected',
  pending: 'Pending',
  receiving: 'In Progress',
  in_progress: 'In Progress',
  received: 'Received',
  partial: 'Partial',
  released: 'Released',
  shipped: 'Shipped',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const getDisplayStatus = (
  shipment: ShipmentDetail
): {
  status: string;
  label: string;
  pendingReview: boolean;
  waitingSplit: boolean;
  pendingReviewReason: string;
} => {
  const baseLabel = shipmentStatusLabels[shipment.status] || shipment.status;
  const terminal = ['released', 'shipped', 'completed', 'cancelled'].includes(shipment.status);
  if (terminal) {
    return {
      status: shipment.status,
      label: baseLabel,
      pendingReview: false,
      waitingSplit: false,
      pendingReviewReason: '',
    };
  }

  const meta = shipment.metadata && typeof shipment.metadata === 'object' ? shipment.metadata : null;
  const pendingReview = !!(meta && (meta as any).pending_review === true);
  const waitingSplit = !!(meta && (meta as any).split_required === true);
  const pendingReviewReason = pendingReview ? String((meta as any).pending_review_reason || '') : '';

  if (pendingReview) {
    return {
      status: 'pending_review',
      label: 'Pending review',
      pendingReview,
      waitingSplit: false,
      pendingReviewReason,
    };
  }

  if (waitingSplit) {
    return {
      status: 'waiting_split',
      label: 'Waiting for split',
      pendingReview: false,
      waitingSplit,
      pendingReviewReason: '',
    };
  }

  return {
    status: shipment.status,
    label: baseLabel,
    pendingReview: false,
    waitingSplit: false,
    pendingReviewReason: '',
  };
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

// ============================================
// COMPONENT
// ============================================

export default function ClientShipmentDetail() {
  const { id } = useParams<{ id: string }>();

  // Render-time UUID guard
  if (!id || !isValidUuid(id)) {
    return <Navigate to="/client/shipments" replace />;
  }

  const navigate = useNavigate();
  const { portalUser, account, tenant, isLoading: contextLoading } = useClientPortalContext();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shipment, setShipment] = useState<ShipmentDetail | null>(null);
  const [items, setItems] = useState<ShipmentItemData[]>([]);

  const userName = portalUser?.first_name
    ? `${portalUser.first_name} ${portalUser.last_name || ''}`.trim()
    : portalUser?.email || 'User';

  // ------------------------------------------
  // Fetch shipment data
  // ------------------------------------------
  const fetchShipment = useCallback(async () => {
    if (!portalUser?.account_id) return;

    try {
      setLoading(true);
      setError(null);

      // Fetch shipment header
      const { data: shipmentData, error: shipmentError } = await supabase
        .from('shipments')
        .select(`
          id,
          shipment_number,
          shipment_type,
          status,
          metadata,
          scheduled_date,
          origin_name,
          destination_name,
          total_items,
          tracking_number,
          po_number,
          carrier,
          coverage_type,
          receiving_photos,
          release_photos,
          created_at,
          account_id
        `)
        .eq('id', id)
        .eq('account_id', portalUser.account_id)
        .is('deleted_at', null)
        .single();

      if (shipmentError) {
        setError('Shipment not found or you do not have access.');
        return;
      }

      if (!shipmentData) {
        setError('Shipment not found.');
        return;
      }

      // Verify account ownership
      if (shipmentData.account_id !== portalUser.account_id) {
        setError('You do not have access to this shipment.');
        return;
      }

      setShipment(shipmentData as unknown as ShipmentDetail);

      // Fetch shipment items (limited client view - no pricing)
      const { data: itemsData } = await (supabase
        .from('shipment_items') as any)
        .select(`
          id,
          status,
          item:items(
            id,
            item_code,
            description,
            status,
            condition,
            category,
            coverage_type,
            declared_value
          )
        `)
        .eq('shipment_id', id)
        .order('created_at');

      setItems((itemsData || []) as ShipmentItemData[]);
    } catch (err) {
      setError('Failed to load shipment details.');
    } finally {
      setLoading(false);
    }
  }, [id, portalUser?.account_id]);

  useEffect(() => {
    if (!contextLoading && portalUser?.account_id) {
      fetchShipment();
    }
  }, [contextLoading, portalUser?.account_id, fetchShipment]);

  // ------------------------------------------
  // Loading state
  // ------------------------------------------
  if (contextLoading || loading) {
    return (
      <ClientPortalLayout accountName={account?.name} warehouseName={tenant?.name} userName={userName}>
        <div className="space-y-6">
          <div className="flex items-center gap-4">
            <Skeleton className="h-10 w-10 rounded" />
            <div className="space-y-2">
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
          <Skeleton className="h-48" />
          <Skeleton className="h-64" />
        </div>
      </ClientPortalLayout>
    );
  }

  // ------------------------------------------
  // Error state
  // ------------------------------------------
  if (error || !shipment) {
    return (
      <ClientPortalLayout accountName={account?.name} warehouseName={tenant?.name} userName={userName}>
        <div className="space-y-6">
          <Button variant="ghost" onClick={() => navigate('/client/shipments')} className="gap-2">
            <MaterialIcon name="arrow_back" size="md" />
            Back to Shipments
          </Button>
          <Card>
            <CardContent className="py-12 text-center">
              <MaterialIcon
                name="error_outline"
                className="mx-auto text-muted-foreground mb-4"
                style={{ fontSize: '48px' }}
              />
              <h3 className="text-lg font-medium mb-2">Unable to Load Shipment</h3>
              <p className="text-muted-foreground mb-4">
                {error || 'The shipment could not be found.'}
              </p>
              <Button variant="outline" onClick={() => navigate('/client/shipments')}>
                Return to Shipments
              </Button>
            </CardContent>
          </Card>
        </div>
      </ClientPortalLayout>
    );
  }

  // ------------------------------------------
  // Derived data
  // ------------------------------------------
  const hasPhotos =
    (shipment.receiving_photos && shipment.receiving_photos.length > 0) ||
    (shipment.release_photos && shipment.release_photos.length > 0);

  const receivingPhotoUrls = shipment.receiving_photos
    ? getPhotoUrls(shipment.receiving_photos as (string | TaggablePhoto)[])
    : [];

  const releasePhotoUrls = shipment.release_photos
    ? getPhotoUrls(shipment.release_photos as (string | TaggablePhoto)[])
    : [];
  const displayStatus = getDisplayStatus(shipment);

  // ------------------------------------------
  // Render
  // ------------------------------------------
  return (
    <ClientPortalLayout accountName={account?.name} warehouseName={tenant?.name} userName={userName}>
      <div className="space-y-6">
        {/* Back Button and Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/client/shipments')}>
            <MaterialIcon name="arrow_back" size="md" />
          </Button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold">{shipment.shipment_number}</h1>
              <StatusIndicator status={displayStatus.status} label={displayStatus.label} size="sm" />
              {displayStatus.pendingReview && (
                <span title="Pending review" className="text-amber-600">
                  <MaterialIcon name="search" size="sm" />
                </span>
              )}
              {getTypeBadge(shipment.shipment_type)}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Created {format(new Date(shipment.created_at), 'MMMM d, yyyy')}
            </p>
          </div>
        </div>

        {displayStatus.pendingReview && (
          <Card className="border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20">
            <CardContent className="py-3">
              <div className="text-sm font-medium text-amber-900 dark:text-amber-100 flex items-center gap-2">
                <MaterialIcon name="search" size="sm" />
                Pending review
              </div>
              <p className="text-sm text-amber-900 dark:text-amber-100 mt-1 whitespace-pre-wrap">
                {displayStatus.pendingReviewReason || 'Your request is pending manual review by the warehouse team.'}
              </p>
            </CardContent>
          </Card>
        )}

        {!displayStatus.pendingReview && displayStatus.waitingSplit && (
          <Card className="border-blue-300 bg-blue-50 dark:border-blue-700 dark:bg-blue-900/20">
            <CardContent className="py-3">
              <div className="text-sm font-medium text-blue-900 dark:text-blue-100 flex items-center gap-2">
                <MaterialIcon name="call_split" size="sm" />
                Waiting for split
              </div>
              <p className="text-sm text-blue-900 dark:text-blue-100 mt-1">
                The warehouse is completing required split and relabel work before this shipment can start.
              </p>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-6 md:grid-cols-3">
          {/* Main Content */}
          <div className="md:col-span-2 space-y-6">
            {/* Shipment Info */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MaterialIcon name="local_shipping" size="md" />
                  Shipment Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  {shipment.scheduled_date && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-1">Scheduled Date</h4>
                      <p className="flex items-center gap-2">
                        <MaterialIcon name="event" size="sm" className="text-muted-foreground" />
                        {format(new Date(shipment.scheduled_date), 'MMMM d, yyyy')}
                      </p>
                    </div>
                  )}

                  {shipment.carrier && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-1">Carrier</h4>
                      <p>{shipment.carrier}</p>
                    </div>
                  )}

                  {shipment.tracking_number && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-1">Tracking Number</h4>
                      <p className="font-mono text-sm">{shipment.tracking_number}</p>
                    </div>
                  )}

                  {shipment.po_number && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-1">Reference / PO Number</h4>
                      <p>{shipment.po_number}</p>
                    </div>
                  )}

                  {shipment.origin_name && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-1">Origin</h4>
                      <p className="flex items-center gap-2">
                        <MaterialIcon name="flight_takeoff" size="sm" className="text-muted-foreground" />
                        {shipment.origin_name}
                      </p>
                    </div>
                  )}

                  {shipment.destination_name && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-1">Destination</h4>
                      <p className="flex items-center gap-2">
                        <MaterialIcon name="flight_land" size="sm" className="text-muted-foreground" />
                        {shipment.destination_name}
                      </p>
                    </div>
                  )}
                </div>

              </CardContent>
            </Card>

            {/* Notes (Public + Exception) */}
            <ShipmentNotesSection shipmentId={id} isClientUser />

            {/* Items */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MaterialIcon name="inventory_2" size="md" />
                  Items ({items.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                {items.length === 0 ? (
                  <p className="text-center text-muted-foreground py-8">
                    No items on this shipment yet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {items.map((si) => (
                      <div
                        key={si.id}
                        className="flex items-center justify-between p-3 bg-muted/50 rounded-lg"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-10 w-10 bg-muted rounded flex items-center justify-center flex-shrink-0">
                            <MaterialIcon name="inventory_2" size="md" className="text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium truncate">
                              {si.item?.item_code || 'Pending'}
                            </p>
                            <p className="text-sm text-muted-foreground truncate">
                              {si.item?.description || 'No description'}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0 ml-2">
                          {si.item?.declared_value != null && si.item.declared_value > 0 && (
                            <Badge variant="outline" className="text-xs font-mono">
                              ${si.item.declared_value.toLocaleString()}
                            </Badge>
                          )}
                          {si.item?.coverage_type && si.item.coverage_type !== 'standard' && (
                            <CoverageBadge coverageType={si.item.coverage_type as CoverageType} />
                          )}
                          {si.item?.condition && (
                            <Badge variant="outline" className="text-xs">
                              {si.item.condition}
                            </Badge>
                          )}
                          {si.item?.category && (
                            <Badge variant="secondary" className="text-xs hidden sm:inline-flex">
                              {si.item.category}
                            </Badge>
                          )}
                          <StatusIndicator
                            status={si.item?.status || si.status || 'pending'}
                            size="sm"
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Photos */}
            {hasPhotos && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MaterialIcon name="photo_library" size="md" />
                    Photos
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6">
                  {receivingPhotoUrls.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-3">
                        Receiving Photos ({receivingPhotoUrls.length})
                      </h4>
                      <TaggablePhotoGrid
                        photos={shipment.receiving_photos as (string | TaggablePhoto)[]}
                        readonly
                        enableTagging={false}
                      />
                    </div>
                  )}
                  {receivingPhotoUrls.length > 0 && releasePhotoUrls.length > 0 && (
                    <Separator />
                  )}
                  {releasePhotoUrls.length > 0 && (
                    <div>
                      <h4 className="text-sm font-medium text-muted-foreground mb-3">
                        Release Photos ({releasePhotoUrls.length})
                      </h4>
                      <TaggablePhotoGrid
                        photos={shipment.release_photos as (string | TaggablePhoto)[]}
                        readonly
                        enableTagging={false}
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Documents */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <MaterialIcon name="description" size="md" />
                  Documents
                </CardTitle>
              </CardHeader>
              <CardContent>
                <DocumentList
                  contextType="shipment"
                  contextId={shipment.id}
                  canDelete={false}
                />
              </CardContent>
            </Card>
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Summary Card */}
            <Card>
              <CardHeader>
                <CardTitle>Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <StatusIndicator status={shipment.status} size="sm" />
                </div>
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Type</span>
                  <span>{shipmentTypeLabels[shipment.shipment_type] || shipment.shipment_type}</span>
                </div>
                {shipment.coverage_type && (
                  <>
                    <Separator />
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Coverage</span>
                      <CoverageBadge coverageType={shipment.coverage_type as CoverageType} />
                    </div>
                  </>
                )}
                {shipment.total_items != null && (
                  <>
                    <Separator />
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Items</span>
                      <span className="font-medium">{shipment.total_items}</span>
                    </div>
                  </>
                )}
                {shipment.scheduled_date && (
                  <>
                    <Separator />
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Scheduled</span>
                      <span>{format(new Date(shipment.scheduled_date), 'MMM d, yyyy')}</span>
                    </div>
                  </>
                )}
                <Separator />
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span>{format(new Date(shipment.created_at), 'MMM d, yyyy')}</span>
                </div>
              </CardContent>
            </Card>

            {/* Tracking Info Card */}
            {(shipment.carrier || shipment.tracking_number) && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MaterialIcon name="local_shipping" size="md" />
                    Tracking
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {shipment.carrier && (
                    <div>
                      <span className="text-muted-foreground block mb-1">Carrier</span>
                      <span className="font-medium">{shipment.carrier}</span>
                    </div>
                  )}
                  {shipment.tracking_number && (
                    <div>
                      <span className="text-muted-foreground block mb-1">Tracking #</span>
                      <span className="font-mono text-xs break-all">{shipment.tracking_number}</span>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </ClientPortalLayout>
  );
}
