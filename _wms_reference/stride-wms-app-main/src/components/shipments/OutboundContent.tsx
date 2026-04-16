import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { ShipmentNumberBadge } from '@/components/shipments/ShipmentNumberBadge';
import { AutocompleteSearchInput, type AutocompleteSuggestion } from '@/components/ui/autocomplete-search';
import { format } from 'date-fns';

interface OutboundShipment {
  id: string;
  shipment_number: string;
  status: string;
  metadata?: Record<string, unknown> | null;
  carrier: string | null;
  tracking_number: string | null;
  expected_arrival_date: string | null;
  shipped_at: string | null;
  release_type: string | null;
  notes: string | null;
  driver_name: string | null;
  po_number: string | null;
  released_to: string | null;
  release_to_name: string | null;
  release_to_email: string | null;
  release_to_phone: string | null;
  destination_name: string | null;
  origin_name: string | null;
  scheduled_date: string | null;
  completed_at: string | null;
  outbound_type_name: string | null;
  created_at: string;
  account_name: string | null;
  account_code: string | null;
  warehouse_name: string | null;
  shipment_exception_type: string | null;
}

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  expected: 'Expected',
  in_progress: 'In Progress',
  released: 'Released',
  shipped: 'Shipped',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

export function OutboundContent() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isMobile = useIsMobile();

  const [loading, setLoading] = useState(true);
  const [shipments, setShipments] = useState<OutboundShipment[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');

  type SortField = 'shipment_number' | 'account_name' | 'outbound_type_name' | 'status' | 'created_at';
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  const getDisplayStatus = useCallback((shipment: OutboundShipment): { status: string; label: string } => {
    const baseLabel = statusLabels[shipment.status] || shipment.status;

    // For terminal states, trust the primary status.
    if (['released', 'shipped', 'completed', 'cancelled'].includes(shipment.status)) {
      return { status: shipment.status, label: baseLabel };
    }

    const meta = shipment.metadata && typeof shipment.metadata === 'object' ? shipment.metadata : null;
    const pendingReview = !!(meta && (meta as any).pending_review === true);
    if (pendingReview) {
      return { status: 'pending_review', label: 'Pending review' };
    }

    const splitRequired = !!(meta && (meta as any).split_required === true);
    if (splitRequired) {
      return { status: 'waiting_split', label: 'Waiting for split' };
    }

    return { status: shipment.status, label: baseLabel };
  }, []);

  useEffect(() => {
    if (!profile?.tenant_id) return;

    const fetchShipments = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('shipments')
          .select(`
            id,
            shipment_number,
            status,
            metadata,
            carrier,
            tracking_number,
            expected_arrival_date,
            shipped_at,
            release_type,
            created_at,
            shipment_exception_type,
            notes,
            driver_name,
            po_number,
            released_to,
            release_to_name,
            release_to_email,
            release_to_phone,
            destination_name,
            origin_name,
            scheduled_date,
            completed_at,
            accounts:account_id(account_name, account_code),
            outbound_type:outbound_types(name),
            warehouses:warehouse_id(name)
          `)
          .eq('tenant_id', profile.tenant_id)
          .eq('shipment_type', 'outbound')
          .is('deleted_at', null)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('[OutboundContent] fetch failed:', error);
          return;
        }

        const transformed: OutboundShipment[] = (data || []).map((s: any) => ({
          id: s.id,
          shipment_number: s.shipment_number,
          status: s.status,
          metadata: (s.metadata && typeof s.metadata === 'object') ? s.metadata : null,
          carrier: s.carrier,
          tracking_number: s.tracking_number,
          expected_arrival_date: s.expected_arrival_date,
          shipped_at: s.shipped_at,
          release_type: s.release_type,
          notes: s.notes,
          driver_name: s.driver_name,
          po_number: s.po_number,
          released_to: s.released_to,
          release_to_name: s.release_to_name,
          release_to_email: s.release_to_email,
          release_to_phone: s.release_to_phone,
          destination_name: s.destination_name,
          origin_name: s.origin_name,
          scheduled_date: s.scheduled_date,
          completed_at: s.completed_at,
          outbound_type_name: s.outbound_type?.name || null,
          created_at: s.created_at,
          account_name: s.accounts?.account_name || null,
          account_code: s.accounts?.account_code || null,
          warehouse_name: s.warehouses?.name || null,
          shipment_exception_type: s.shipment_exception_type || null,
        }));

        setShipments(transformed);
      } catch (err) {
        console.error('[OutboundContent] exception:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchShipments();
  }, [profile?.tenant_id]);

  const filteredShipments = useMemo(() => {
    return shipments.filter(shipment => {
      if (searchQuery) {
        const query = searchQuery.trim().toLowerCase();
        const statusLabel = getDisplayStatus(shipment).label.toLowerCase();

        const matchesAnyField =
          statusLabel.includes(query) ||
          Object.values(shipment).some((val) => {
            if (val == null) return false;
            if (typeof val === 'string') return val.toLowerCase().includes(query);
            if (typeof val === 'number') return String(val).includes(query);
            if (typeof val === 'boolean') return (val ? 'true' : 'false').includes(query);
            return false;
          });

        if (!matchesAnyField) return false;
      }
      if (statusFilter !== 'all' && shipment.status !== statusFilter) return false;
      if (accountFilter !== 'all' && shipment.account_name !== accountFilter) return false;
      return true;
    });
  }, [shipments, searchQuery, statusFilter, accountFilter, getDisplayStatus]);

  const uniqueStatuses = useMemo(() => [...new Set(shipments.map(s => s.status))], [shipments]);
  const uniqueAccounts = useMemo(() => [...new Set(shipments.map(s => s.account_name).filter(Boolean))] as string[], [shipments]);

  const searchSuggestions: AutocompleteSuggestion[] = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 1) return [];

    const out: AutocompleteSuggestion[] = [];
    const seen = new Set<string>();
    const add = (value: string | null | undefined, prefix: string) => {
      if (!value) return;
      const v = String(value).trim();
      if (!v) return;
      if (!v.toLowerCase().includes(q)) return;
      if (seen.has(v)) return;
      seen.add(v);
      out.push({ value: v, label: `${prefix}: ${v}` });
    };

    for (const s of shipments.slice(0, 250)) {
      add(s.shipment_number, 'Shipment');
      add(s.account_name, 'Account');
      add(s.account_code, 'Account Code');
      add(s.tracking_number, 'Tracking');
      add(s.po_number, 'PO');
      add(s.carrier, 'Carrier');
      add(s.outbound_type_name, 'Type');
      add(getDisplayStatus(s).label, 'Status');
    }

    return out;
  }, [searchQuery, shipments, getDisplayStatus]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedShipments = useMemo(() => {
    const dir = sortDirection === 'asc' ? 1 : -1;
    const compareString = (a: string | null | undefined, b: string | null | undefined) =>
      (a || '').localeCompare(b || '', undefined, { numeric: true, sensitivity: 'base' });

    return [...filteredShipments].sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'shipment_number':
          cmp = compareString(a.shipment_number, b.shipment_number);
          break;
        case 'account_name':
          cmp = compareString(a.account_name, b.account_name);
          break;
        case 'outbound_type_name':
          cmp = compareString(a.outbound_type_name, b.outbound_type_name);
          break;
        case 'status':
          cmp = compareString(getDisplayStatus(a).label, getDisplayStatus(b).label);
          break;
        case 'created_at':
        default:
          cmp = compareString(a.created_at, b.created_at);
          break;
      }
      return cmp * dir;
    });
  }, [filteredShipments, sortField, sortDirection, getDisplayStatus]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-row sm:flex-wrap sm:items-center">
        <div className="col-span-2 sm:flex-1 sm:min-w-[260px]">
          <AutocompleteSearchInput
            placeholder="Search outbound..."
            value={searchQuery}
            onValueChange={setSearchQuery}
            suggestions={searchSuggestions}
          />
        </div>
        <div className="col-span-1 sm:col-span-auto">
          <Select value={accountFilter} onValueChange={setAccountFilter}>
            <SelectTrigger className="w-full sm:w-44">
              <SelectValue placeholder="All accounts" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All accounts</SelectItem>
              {uniqueAccounts.map(a => (
                <SelectItem key={a} value={a}>{a}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-1 sm:col-span-auto">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-full sm:w-36">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {uniqueStatuses.map(s => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {sortedShipments.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <MaterialIcon name="outbox" size="xl" className="mb-2 opacity-40" />
          <p>No outbound shipments found.</p>
        </div>
      ) : (
        <>
          {/* Mobile cards */}
          {isMobile ? (
            <div className="space-y-3">
              {sortedShipments.map((shipment) => (
                <Card
                  key={shipment.id}
                  className="cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => navigate(`/shipments/${shipment.id}`)}
                >
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <ShipmentNumberBadge
                        shipmentNumber={shipment.shipment_number}
                        exceptionType={shipment.shipment_exception_type}
                      />
                      {(() => {
                        const d = getDisplayStatus(shipment);
                        return <StatusIndicator status={d.status} label={d.label} size="sm" />;
                      })()}
                    </div>
                    <div className="text-sm text-muted-foreground">{shipment.account_name || 'No account'}</div>
                    <div className="text-xs text-muted-foreground">
                      {shipment.outbound_type_name || '-'} / {shipment.shipped_at ? format(new Date(shipment.shipped_at), 'MMM d, yyyy') : '-'}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort('shipment_number')}>
                      Shipment #
                      {sortField === 'shipment_number' && <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort('account_name')}>
                      Account
                      {sortField === 'account_name' && <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort('outbound_type_name')}>
                      Type
                      {sortField === 'outbound_type_name' && <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort('status')}>
                      Status
                      {sortField === 'status' && <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                    </TableHead>
                    <TableHead className="cursor-pointer select-none" onClick={() => handleSort('created_at')}>
                      Created
                      {sortField === 'created_at' && <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span>}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedShipments.map((shipment) => (
                    <TableRow
                      key={shipment.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/shipments/${shipment.id}`)}
                    >
                      <TableCell>
                        <ShipmentNumberBadge shipmentNumber={shipment.shipment_number} exceptionType={shipment.shipment_exception_type} />
                      </TableCell>
                      <TableCell>{shipment.account_name || '-'}</TableCell>
                      <TableCell>
                        {shipment.outbound_type_name ? (
                          <Badge variant="outline">{shipment.outbound_type_name}</Badge>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const d = getDisplayStatus(shipment);
                          return <StatusIndicator status={d.status} label={d.label} size="sm" />;
                        })()}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {format(new Date(shipment.created_at), 'MMM d, yyyy')}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
