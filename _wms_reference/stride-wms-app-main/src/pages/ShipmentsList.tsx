import { useState, useEffect, useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MobileDataCard } from '@/components/ui/mobile-data-card';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { AddShipmentDialog } from '@/components/shipments/AddShipmentDialog';
import { OutboundContent } from '@/components/shipments/OutboundContent';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { CoverageBadge, COVERAGE_LABELS, type CoverageType } from '@/components/coverage/CoverageSelector';
import { format } from 'date-fns';

// ============================================
// TYPES
// ============================================

interface Shipment {
  id: string;
  shipment_number: string;
  shipment_type: string;
  inbound_kind?: string | null;
  status: string;
  carrier: string | null;
  tracking_number: string | null;
  expected_arrival_date: string | null;
  received_at: string | null;
  shipped_at: string | null;
  completed_at?: string | null;
  release_type: string | null;
  outbound_type_name: string | null;
  created_at: string;
  account_name: string | null;
  warehouse_name: string | null;
  coverage_type: string | null;
}

type TabValue = 'incoming' | 'outbound' | 'received' | 'released';

// ============================================
// COMPONENT
// ============================================

const TAB_VALUES = ['incoming', 'outbound', 'received', 'released'] as const;

const TAB_CONFIG: Record<TabValue, { route: string }> = {
  incoming: { route: '/shipments/incoming' },
  outbound: { route: '/shipments/outbound' },
  received: { route: '/shipments/received' },
  released: { route: '/shipments/released' },
};

export default function ShipmentsList() {
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();
  const isMobile = useIsMobile();

  // State
  const [loading, setLoading] = useState(true);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [carrierFilter, setCarrierFilter] = useState<string>('all');
  const [addShipmentDialogOpen, setAddShipmentDialogOpen] = useState(false);

  const deriveTabFromRoute = (): TabValue => {
    const last = location.pathname.split('/').pop();
    if (last && TAB_VALUES.includes(last as TabValue)) return last as TabValue;
    return 'incoming';
  };

  const [activeTab, setActiveTab] = useState<TabValue>(() => deriveTabFromRoute());

  useEffect(() => {
    setActiveTab(deriveTabFromRoute());
    setStatusFilter('all');
    setAccountFilter('all');
    setCarrierFilter('all');
    setSearchQuery('');
  }, [location.pathname]);

  // ------------------------------------------
  // Fetch shipments based on active tab
  // ------------------------------------------
  useEffect(() => {
    if (!profile?.tenant_id) return;
    // OutboundContent handles its own data fetching
    if (activeTab === 'outbound') {
      setShipments([]);
      setLoading(false);
      return;
    }

    const fetchShipments = async () => {
      setLoading(true);
      try {
        let query = supabase
          .from('shipments')
          .select(`
            id,
            shipment_number,
            shipment_type,
            inbound_kind,
            status,
            carrier,
            tracking_number,
            expected_arrival_date,
            received_at,
            shipped_at,
            completed_at,
            release_type,
            coverage_type,
            created_at,
            accounts:account_id(account_name, account_code),
            warehouses:warehouse_id(name),
            outbound_type:outbound_types(name)
          `)
          .eq('tenant_id', profile.tenant_id)
          .is('deleted_at', null);

        // Apply tab-specific filters (using valid DB statuses only)
        switch (activeTab) {
          case 'incoming':
            query = query
              .eq('shipment_type', 'inbound')
              .in('status', ['expected', 'in_progress', 'receiving']);
            break;
          case 'received':
            query = query
              .eq('shipment_type', 'inbound')
              .eq('inbound_kind', 'dock_intake')
              .in('status', ['received']);
            break;
          case 'released':
            query = query
              .eq('shipment_type', 'outbound')
              .in('status', ['released', 'shipped', 'completed']);
            break;
        }

        // Default ordering per Hub/list decisions:
        // - Received: newest received first
        // - Released: newest completed first
        // - Else: newest created first
        if (activeTab === 'received') {
          query = query.order('received_at', { ascending: false }).order('created_at', { ascending: false });
        } else if (activeTab === 'released') {
          query = query.order('completed_at', { ascending: false }).order('created_at', { ascending: false });
        } else {
          query = query.order('created_at', { ascending: false });
        }

        const { data, error } = await query;

        if (error) {
          console.error('[ShipmentsList] fetch failed:', error);
          return;
        }

        // Transform data to flatten nested objects
        const transformedData: Shipment[] = (data || []).map((s: any) => ({
          id: s.id,
          shipment_number: s.shipment_number,
          shipment_type: s.shipment_type,
          inbound_kind: s.inbound_kind || null,
          status: s.status,
          carrier: s.carrier,
          tracking_number: s.tracking_number,
          expected_arrival_date: s.expected_arrival_date,
          received_at: s.received_at,
          shipped_at: s.shipped_at,
          completed_at: s.completed_at,
          release_type: s.release_type,
          outbound_type_name: s.outbound_type?.name || null,
          created_at: s.created_at,
          account_name: s.accounts?.account_name || null,
          warehouse_name: s.warehouses?.name || null,
          coverage_type: s.coverage_type || null,
        }));

        setShipments(transformedData);
      } catch (err) {
        console.error('[ShipmentsList] fetchShipments exception:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchShipments();
  }, [profile?.tenant_id, activeTab]);

  // Update URL when tab changes
  const handleTabChange = (tab: string) => {
    const next = tab as TabValue;
    setActiveTab(next);
    setStatusFilter('all');
    setAccountFilter('all');
    setCarrierFilter('all');
    setSearchQuery('');
    navigate(TAB_CONFIG[next].route);
  };

  // ------------------------------------------
  // Filter shipments
  // ------------------------------------------
  const filteredShipments = useMemo(() => {
    return shipments.filter(shipment => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          shipment.shipment_number.toLowerCase().includes(query) ||
          shipment.account_name?.toLowerCase().includes(query) ||
          shipment.carrier?.toLowerCase().includes(query) ||
          shipment.tracking_number?.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      // Status filter
      if (statusFilter !== 'all' && shipment.status !== statusFilter) {
        return false;
      }

      // Account filter
      if (accountFilter !== 'all' && shipment.account_name !== accountFilter) {
        return false;
      }

      // Carrier filter
      if (carrierFilter !== 'all' && shipment.carrier !== carrierFilter) {
        return false;
      }

      return true;
    });
  }, [shipments, searchQuery, statusFilter, accountFilter, carrierFilter]);

  // Get unique values for filters
  const uniqueStatuses = useMemo(() => {
    return [...new Set(shipments.map(s => s.status))];
  }, [shipments]);

  const uniqueAccounts = useMemo(() => {
    return [...new Set(shipments.map(s => s.account_name).filter(Boolean))] as string[];
  }, [shipments]);

  const uniqueCarriers = useMemo(() => {
    return [...new Set(shipments.map(s => s.carrier).filter(Boolean))] as string[];
  }, [shipments]);

  // ------------------------------------------
  // Status badge helper
  // ------------------------------------------
  const shipmentStatusLabels: Record<string, string> = {
    pending: 'Pending',
    shipped: 'Shipped',
    expected: 'Expected',
    in_progress: 'In Progress',
    receiving: 'In Progress',
    received: 'Received',
    released: 'Released',
    completed: 'Completed',
    cancelled: 'Cancelled',
  };

  // ------------------------------------------
  // Tab content renderer
  // ------------------------------------------
  const renderTabContent = () => {
    if (loading) {
      return (
        <div className="flex items-center justify-center h-48">
          <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
        </div>
      );
    }

    if (filteredShipments.length === 0) {
      return (
        <div className="text-center py-12">
          <MaterialIcon name="inventory_2" size="xl" className="mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No shipments found</h3>
          <p className="text-muted-foreground mb-4">
            {searchQuery || statusFilter !== 'all'
              ? 'Try adjusting your filters'
              : 'Create a new shipment to get started'}
          </p>
          <Button onClick={() => setAddShipmentDialogOpen(true)}>
            <MaterialIcon name="add" size="sm" className="mr-2" />
            Add Shipment
          </Button>
        </div>
      );
    }

    if (isMobile) {
      return (
        <div className="space-y-4 p-4">
          {filteredShipments.map((shipment) => (
            <MobileDataCard
              key={shipment.id}
              onClick={() => navigate(`/shipments/${shipment.id}`)}
            >
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium">{shipment.shipment_number}</div>
                  <div className="text-sm text-muted-foreground">{shipment.account_name || 'No account'}</div>
                </div>
                <div className="flex gap-1">
                  <StatusIndicator status={shipment.status} label={shipmentStatusLabels[shipment.status]} size="sm" />
                  {shipment.outbound_type_name && (
                    <Badge variant="outline">{shipment.outbound_type_name}</Badge>
                  )}
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Carrier: </span>
                  {shipment.carrier || '-'}
                </div>
                <div>
                  <span className="text-muted-foreground">Tracking: </span>
                  {shipment.tracking_number || '-'}
                </div>
                <div className="col-span-2">
                  <span className="text-muted-foreground">
                    {activeTab === 'received' ? 'Received: ' : activeTab === 'released' ? 'Shipped: ' : 'Expected: '}
                  </span>
                  {activeTab === 'received' && shipment.received_at
                    ? format(new Date(shipment.received_at), 'MMM d, yyyy')
                    : activeTab === 'released' && shipment.completed_at
                      ? format(new Date(shipment.completed_at), 'MMM d, yyyy')
                      : shipment.expected_arrival_date
                        ? format(new Date(shipment.expected_arrival_date), 'MMM d, yyyy')
                        : '-'}
                </div>
              </div>
            </MobileDataCard>
          ))}
        </div>
      );
    }

    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Shipment #</TableHead>
            <TableHead>Account</TableHead>
            {activeTab === 'outbound' && <TableHead>Type</TableHead>}
            {activeTab !== 'outbound' && <TableHead>Carrier</TableHead>}
            {activeTab !== 'outbound' && <TableHead>Tracking</TableHead>}
            <TableHead>
              {activeTab === 'received' ? 'Received' :
               activeTab === 'released' ? 'Shipped' : 'Expected'}
            </TableHead>
            {activeTab !== 'outbound' && <TableHead>Coverage</TableHead>}
            <TableHead>Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filteredShipments.map((shipment) => (
            <TableRow
              key={shipment.id}
              className="cursor-pointer hover:bg-muted/50"
              onClick={() => navigate(`/shipments/${shipment.id}`)}
            >
              <TableCell className="font-medium">{shipment.shipment_number}</TableCell>
              <TableCell>{shipment.account_name || '-'}</TableCell>
              {activeTab === 'outbound' && (
                <TableCell>
                  {shipment.outbound_type_name ? (
                    <Badge variant="outline">{shipment.outbound_type_name}</Badge>
                  ) : '-'}
                </TableCell>
              )}
              {activeTab !== 'outbound' && <TableCell>{shipment.carrier || '-'}</TableCell>}
              {activeTab !== 'outbound' && <TableCell>{shipment.tracking_number || '-'}</TableCell>}
              <TableCell>
                {activeTab === 'received' && shipment.received_at
                  ? format(new Date(shipment.received_at), 'MMM d, yyyy')
                  : activeTab === 'released' && shipment.completed_at
                    ? format(new Date(shipment.completed_at), 'MMM d, yyyy')
                    : shipment.expected_arrival_date
                      ? format(new Date(shipment.expected_arrival_date), 'MMM d, yyyy')
                      : '-'}
              </TableCell>
              {activeTab !== 'outbound' && (
                <TableCell>
                  {shipment.coverage_type ? (
                    <CoverageBadge coverageType={shipment.coverage_type as CoverageType} />
                  ) : (
                    <span className="text-xs text-muted-foreground">None</span>
                  )}
                </TableCell>
              )}
              <TableCell><StatusIndicator status={shipment.status} label={shipmentStatusLabels[shipment.status]} size="sm" /></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };

  // ------------------------------------------
  // Render
  // ------------------------------------------
  const getCreateButton = () => {
    return (
      <Button onClick={() => setAddShipmentDialogOpen(true)}>
        <MaterialIcon name="add" size="sm" className="sm:mr-2" />
        <span className="hidden sm:inline">Add Shipment</span>
        <span className="sm:hidden">Add</span>
      </Button>
    );
  };

  return (
    <DashboardLayout>
      <div className="flex justify-between items-center mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <MaterialIcon name="arrow_back" size="md" />
          </Button>
          <PageHeader
            primaryText="Shipments"
            accentText="Management"
            description="Manage inbound and outbound shipments"
          />
        </div>
        {getCreateButton()}
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
          <TabsTrigger value="incoming" className="gap-2">
            <MaterialIcon name="move_to_inbox" size="sm" />
            <span className="hidden sm:inline">Incoming</span>
          </TabsTrigger>
          <TabsTrigger value="outbound" className="gap-2">
            <MaterialIcon name="outbox" size="sm" />
            <span className="hidden sm:inline">Outbound</span>
          </TabsTrigger>
          <TabsTrigger value="received" className="gap-2">
            <MaterialIcon name="check_circle" size="sm" />
            <span className="hidden sm:inline">Received</span>
          </TabsTrigger>
          <TabsTrigger value="released" className="gap-2">
            <MaterialIcon name="inventory_2" size="sm" />
            <span className="hidden sm:inline">Released</span>
          </TabsTrigger>
        </TabsList>

        {/* Filters — outbound tab uses its own component */}
        {activeTab !== 'outbound' && (
          <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-row sm:flex-wrap sm:items-center">
            {/* Search is always available (received/released are search + default sort only) */}
            <div className="relative col-span-2 sm:flex-1 sm:min-w-[260px]">
              <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search shipments..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
              />
            </div>

            {/* Incoming tab keeps additional filters; received/released are simplified */}
            {activeTab === 'incoming' && (
              <>
                <div className="col-span-1 sm:col-span-auto">
                  <Select value={accountFilter} onValueChange={setAccountFilter}>
                    <SelectTrigger className="w-full sm:w-44">
                      <SelectValue placeholder="All accounts" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All accounts</SelectItem>
                      {uniqueAccounts.map(account => (
                        <SelectItem key={account} value={account}>{account}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-1 sm:col-span-auto">
                  <Select value={carrierFilter} onValueChange={setCarrierFilter}>
                    <SelectTrigger className="w-full sm:w-36">
                      <SelectValue placeholder="All carriers" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All carriers</SelectItem>
                      {uniqueCarriers.map(carrier => (
                        <SelectItem key={carrier} value={carrier}>{carrier}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 sm:col-span-auto">
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full sm:w-36">
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      {uniqueStatuses.map(status => (
                        <SelectItem key={status} value={status}>{status}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}
          </div>
        )}

        {/* Tab Content */}
        {activeTab === 'outbound' ? (
          <OutboundContent />
        ) : (
          <Card>
            <CardContent className="p-0 sm:p-6">
              {renderTabContent()}
            </CardContent>
          </Card>
        )}
      </Tabs>

      {/* Add Shipment Dialog */}
      <AddShipmentDialog
        open={addShipmentDialogOpen}
        onOpenChange={setAddShipmentDialogOpen}
      />
    </DashboardLayout>
  );
}
