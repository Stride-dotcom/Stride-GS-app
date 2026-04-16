import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { HelpTip } from '@/components/ui/help-tip';
import { ShipmentNumberBadge } from '@/components/shipments/ShipmentNumberBadge';
import { ShipmentExceptionBadge } from '@/components/shipments/ShipmentExceptionBadge';
import { useIncomingShipments, type InboundKind, type IncomingShipment } from '@/hooks/useIncomingShipments';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type TabValue = 'manifests' | 'expected' | 'dock_intakes';

type SortDirection = 'asc' | 'desc';
type SortState<K extends string> = { key: K; direction: SortDirection };

type ManifestSortKey =
  | 'shipment_number'
  | 'account_name'
  | 'vendor_name'
  | 'eta'
  | 'expected_pieces'
  | 'open_items_count'
  | 'inbound_status'
  | 'created_at';

type ExpectedSortKey =
  | 'shipment_number'
  | 'account_name'
  | 'vendor_name'
  | 'eta'
  | 'expected_pieces'
  | 'open_items_count'
  | 'inbound_status'
  | 'created_at';

type DockIntakeSortKey =
  | 'shipment_number'
  | 'account_name'
  | 'vendor_name'
  | 'signed_pieces'
  | 'inbound_status'
  | 'created_at';

function defaultSortDirectionForKey(key: string): SortDirection {
  switch (key) {
    case 'created_at':
    case 'expected_pieces':
    case 'open_items_count':
    case 'signed_pieces':
      return 'desc';
    default:
      return 'asc';
  }
}

function nextSortState<K extends string>(current: SortState<K>, key: K): SortState<K> {
  if (current.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { key, direction: defaultSortDirectionForKey(key) };
}

function toTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function compareText(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
}

function compareNumber(a: number, b: number): number {
  return a - b;
}

function compareNullable<T>(
  a: T | null | undefined,
  b: T | null | undefined,
  compareNonNull: (a: T, b: T) => number,
  direction: SortDirection
): number {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1; // nulls always last
  if (bNull) return -1;
  const res = compareNonNull(a as T, b as T);
  return direction === 'asc' ? res : -res;
}

function sortManifestShipments(shipments: IncomingShipment[], sort: SortState<ManifestSortKey>) {
  const dir = sort.direction;
  return shipments.slice().sort((a, b) => {
    let res = 0;
    switch (sort.key) {
      case 'shipment_number':
        res = compareNullable(a.shipment_number, b.shipment_number, compareText, dir);
        break;
      case 'account_name':
        res = compareNullable(a.account_name, b.account_name, compareText, dir);
        break;
      case 'vendor_name':
        res = compareNullable(a.vendor_name, b.vendor_name, compareText, dir);
        break;
      case 'eta': {
        const aEta = toTime(a.eta_start) ?? toTime(a.eta_end);
        const bEta = toTime(b.eta_start) ?? toTime(b.eta_end);
        res = compareNullable(aEta, bEta, compareNumber, dir);
        break;
      }
      case 'expected_pieces':
        res = compareNullable(a.expected_pieces, b.expected_pieces, compareNumber, dir);
        break;
      case 'open_items_count':
        res = compareNullable(a.open_items_count, b.open_items_count, compareNumber, dir);
        break;
      case 'inbound_status':
        res = compareNullable(a.inbound_status, b.inbound_status, compareText, dir);
        break;
      case 'created_at':
        res = compareNullable(toTime(a.created_at), toTime(b.created_at), compareNumber, dir);
        break;
    }
    if (res !== 0) return res;
    // Stable tie-breaker: shipment number ascending
    return compareNullable(a.shipment_number, b.shipment_number, compareText, 'asc');
  });
}

function sortExpectedShipments(shipments: IncomingShipment[], sort: SortState<ExpectedSortKey>) {
  const dir = sort.direction;
  return shipments.slice().sort((a, b) => {
    let res = 0;
    switch (sort.key) {
      case 'shipment_number':
        res = compareNullable(a.shipment_number, b.shipment_number, compareText, dir);
        break;
      case 'account_name':
        res = compareNullable(a.account_name, b.account_name, compareText, dir);
        break;
      case 'vendor_name':
        res = compareNullable(a.vendor_name, b.vendor_name, compareText, dir);
        break;
      case 'eta': {
        const aStart = toTime(a.eta_start);
        const bStart = toTime(b.eta_start);
        res = compareNullable(aStart ?? toTime(a.eta_end), bStart ?? toTime(b.eta_end), compareNumber, dir);
        if (res !== 0) break;
        // Secondary: end of window
        res = compareNullable(toTime(a.eta_end), toTime(b.eta_end), compareNumber, dir);
        break;
      }
      case 'expected_pieces':
        res = compareNullable(a.expected_pieces, b.expected_pieces, compareNumber, dir);
        break;
      case 'open_items_count':
        res = compareNullable(a.open_items_count, b.open_items_count, compareNumber, dir);
        break;
      case 'inbound_status':
        res = compareNullable(a.inbound_status, b.inbound_status, compareText, dir);
        break;
      case 'created_at':
        res = compareNullable(toTime(a.created_at), toTime(b.created_at), compareNumber, dir);
        break;
    }
    if (res !== 0) return res;
    return compareNullable(a.shipment_number, b.shipment_number, compareText, 'asc');
  });
}

function sortDockIntakeShipments(shipments: IncomingShipment[], sort: SortState<DockIntakeSortKey>) {
  const dir = sort.direction;
  return shipments.slice().sort((a, b) => {
    let res = 0;
    switch (sort.key) {
      case 'shipment_number':
        res = compareNullable(a.shipment_number, b.shipment_number, compareText, dir);
        break;
      case 'account_name':
        res = compareNullable(a.account_name, b.account_name, compareText, dir);
        break;
      case 'vendor_name':
        res = compareNullable(a.vendor_name, b.vendor_name, compareText, dir);
        break;
      case 'signed_pieces':
        res = compareNullable(a.signed_pieces, b.signed_pieces, compareNumber, dir);
        break;
      case 'inbound_status':
        res = compareNullable(a.inbound_status, b.inbound_status, compareText, dir);
        break;
      case 'created_at':
        res = compareNullable(toTime(a.created_at), toTime(b.created_at), compareNumber, dir);
        break;
    }
    if (res !== 0) return res;
    return compareNullable(a.shipment_number, b.shipment_number, compareText, 'asc');
  });
}

function SortHeaderButton<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  align = 'left',
}: {
  label: string;
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  align?: 'left' | 'right';
}) {
  const isActive = sort.key === sortKey;
  const icon = !isActive
    ? 'unfold_more'
    : sort.direction === 'asc'
      ? 'arrow_upward'
      : 'arrow_downward';

  return (
    <button
      type="button"
      onClick={() => onSort(sortKey)}
      className={[
        'inline-flex w-full items-center gap-1 select-none',
        align === 'right' ? 'justify-end' : 'justify-start',
        'hover:text-foreground',
      ].join(' ')}
    >
      <span>{label}</span>
      <MaterialIcon
        name={icon}
        size="sm"
        className={!isActive ? 'opacity-40' : 'opacity-80'}
      />
    </button>
  );
}

const TAB_TO_KIND: Record<TabValue, InboundKind> = {
  manifests: 'manifest',
  expected: 'expected',
  dock_intakes: 'dock_intake',
};

const MANIFEST_STATUSES = ['all', 'draft', 'submitted', 'partially_allocated', 'fully_allocated', 'completed'];
const EXPECTED_STATUSES = ['all', 'open', 'partially_received', 'completed', 'cancelled'];
const DOCK_INTAKE_STATUSES = ['all', 'draft', 'stage1_complete', 'receiving', 'matched', 'completed'];

function statusBadgeVariant(status: string | null | undefined): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (!status) return 'outline';
  switch (status) {
    case 'completed':
    case 'fully_allocated':
    case 'matched':
      return 'default';
    case 'partially_allocated':
    case 'partially_received':
    case 'submitted':
    case 'open':
    case 'receiving':
    case 'stage1_complete':
      return 'secondary';
    case 'cancelled':
      return 'destructive';
    default:
      return 'outline';
  }
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '-';
  return new Date(dateStr).toLocaleDateString();
}

function formatStatus(status: string | null | undefined): string {
  if (!status) return 'draft';
  return status.replace(/_/g, ' ');
}

/* -- Manifest List -- */
function ManifestList({
  shipments,
  loading,
  onRowClick,
  sort,
  onSortChange,
}: {
  shipments: IncomingShipment[];
  loading: boolean;
  onRowClick: (id: string) => void;
  sort: SortState<ManifestSortKey>;
  onSortChange: (key: ManifestSortKey) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-primary" />
      </div>
    );
  }

  if (shipments.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <MaterialIcon name="list_alt" size="xl" className="mb-2 opacity-40" />
        <p>No manifests found.</p>
      </div>
    );
  }

  return (
    <>
      {/* Mobile stacked cards */}
      <div className="md:hidden space-y-3">
        {shipments.map((s) => (
          <Card key={s.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => onRowClick(s.id)}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <ShipmentNumberBadge shipmentNumber={s.shipment_number} exceptionType={s.shipment_exception_type} />
                  <ShipmentExceptionBadge shipmentId={s.id} count={s.exception_count} />
                </div>
                <Badge variant={statusBadgeVariant(s.inbound_status)}>
                  {formatStatus(s.inbound_status)}
                </Badge>
              </div>
              <div className="text-sm text-muted-foreground">{s.account_name || '-'}</div>
              <div className="text-xs text-muted-foreground">
                {s.expected_pieces ?? '-'} pcs / {s.open_items_count ?? '-'} items
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {/* Desktop table */}
      <div className="hidden md:block rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead aria-sort={sort.key === 'shipment_number' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                <SortHeaderButton label="Manifest #" sortKey="shipment_number" sort={sort} onSort={onSortChange} />
              </TableHead>
              <TableHead aria-sort={sort.key === 'account_name' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                <SortHeaderButton label="Account" sortKey="account_name" sort={sort} onSort={onSortChange} />
              </TableHead>
              <TableHead aria-sort={sort.key === 'vendor_name' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                <SortHeaderButton label="Vendor" sortKey="vendor_name" sort={sort} onSort={onSortChange} />
              </TableHead>
              <TableHead aria-sort={sort.key === 'eta' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                <SortHeaderButton label="ETA" sortKey="eta" sort={sort} onSort={onSortChange} />
              </TableHead>
              <TableHead className="text-right" aria-sort={sort.key === 'expected_pieces' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                <SortHeaderButton label="Pieces" sortKey="expected_pieces" sort={sort} onSort={onSortChange} align="right" />
              </TableHead>
              <TableHead className="text-right" aria-sort={sort.key === 'open_items_count' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                <SortHeaderButton label="Items" sortKey="open_items_count" sort={sort} onSort={onSortChange} align="right" />
              </TableHead>
              <TableHead aria-sort={sort.key === 'inbound_status' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                <SortHeaderButton label="Status" sortKey="inbound_status" sort={sort} onSort={onSortChange} />
              </TableHead>
              <TableHead aria-sort={sort.key === 'created_at' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                <SortHeaderButton label="Created" sortKey="created_at" sort={sort} onSort={onSortChange} />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shipments.map((s) => (
              <TableRow
                key={s.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => onRowClick(s.id)}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <ShipmentNumberBadge shipmentNumber={s.shipment_number} exceptionType={s.shipment_exception_type} />
                    <ShipmentExceptionBadge shipmentId={s.id} count={s.exception_count} />
                  </div>
                </TableCell>
                <TableCell>{s.account_name || '-'}</TableCell>
                <TableCell>{s.vendor_name || '-'}</TableCell>
                <TableCell>{formatDate(s.eta_start)}</TableCell>
                <TableCell className="text-right">{s.expected_pieces ?? '-'}</TableCell>
                <TableCell className="text-right text-muted-foreground">
                  {s.open_items_count ?? '-'}
                </TableCell>
                <TableCell>
                  <Badge variant={statusBadgeVariant(s.inbound_status)}>
                    {formatStatus(s.inbound_status)}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatDate(s.created_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

/* -- Expected Shipments List -- */
function ExpectedList({
  shipments,
  loading,
  onRowClick,
  sort,
  onSortChange,
}: {
  shipments: IncomingShipment[];
  loading: boolean;
  onRowClick: (id: string) => void;
  sort: SortState<ExpectedSortKey>;
  onSortChange: (key: ExpectedSortKey) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-primary" />
      </div>
    );
  }

  if (shipments.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <MaterialIcon name="schedule" size="xl" className="mb-2 opacity-40" />
        <p>No expected shipments found.</p>
      </div>
    );
  }

  return (
    <>
      {/* Mobile stacked cards */}
      <div className="md:hidden space-y-3">
        {shipments.map((s) => (
          <Card key={s.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => onRowClick(s.id)}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <ShipmentNumberBadge shipmentNumber={s.shipment_number} exceptionType={s.shipment_exception_type} />
                  <ShipmentExceptionBadge shipmentId={s.id} count={s.exception_count} />
                </div>
                <Badge variant={statusBadgeVariant(s.inbound_status)}>
                  {formatStatus(s.inbound_status)}
                </Badge>
              </div>
              <div className="text-sm text-muted-foreground">{s.account_name || 'Unassigned'}</div>
              <div className="text-xs text-muted-foreground">
                {s.expected_pieces ?? '-'} expected pcs
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {/* Desktop table */}
      <div className="hidden md:block rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead aria-sort={sort.key === 'shipment_number' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                <SortHeaderButton label="Expected #" sortKey="shipment_number" sort={sort} onSort={onSortChange} />
              </TableHead>
              <TableHead aria-sort={sort.key === 'account_name' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                <SortHeaderButton label="Account" sortKey="account_name" sort={sort} onSort={onSortChange} />
              </TableHead>
              <TableHead aria-sort={sort.key === 'vendor_name' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                <SortHeaderButton label="Vendor" sortKey="vendor_name" sort={sort} onSort={onSortChange} />
              </TableHead>
              <TableHead className="text-right" aria-sort={sort.key === 'expected_pieces' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                <SortHeaderButton label="Expected Pieces" sortKey="expected_pieces" sort={sort} onSort={onSortChange} align="right" />
              </TableHead>
              <TableHead aria-sort={sort.key === 'inbound_status' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                <SortHeaderButton label="Status" sortKey="inbound_status" sort={sort} onSort={onSortChange} />
              </TableHead>
              <TableHead aria-sort={sort.key === 'eta' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                <SortHeaderButton label="ETA" sortKey="eta" sort={sort} onSort={onSortChange} />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shipments.map((s) => (
              <TableRow
                key={s.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => onRowClick(s.id)}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <ShipmentNumberBadge shipmentNumber={s.shipment_number} exceptionType={s.shipment_exception_type} />
                    <ShipmentExceptionBadge shipmentId={s.id} count={s.exception_count} />
                  </div>
                </TableCell>
                <TableCell>
                  {s.account_name || (
                    <span className="text-muted-foreground italic">Unassigned</span>
                  )}
                </TableCell>
                <TableCell>{s.vendor_name || '-'}</TableCell>
                <TableCell className="text-right">{s.expected_pieces ?? '-'}</TableCell>
                <TableCell>
                  <Badge variant={statusBadgeVariant(s.inbound_status)}>
                    {formatStatus(s.inbound_status)}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatDate(s.eta_start)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

/* -- Dock Intakes List -- */
function DockIntakeList({
  shipments,
  loading,
  onRowClick,
  sort,
  onSortChange,
}: {
  shipments: IncomingShipment[];
  loading: boolean;
  onRowClick: (id: string) => void;
  sort: SortState<DockIntakeSortKey>;
  onSortChange: (key: DockIntakeSortKey) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-primary" />
      </div>
    );
  }

  if (shipments.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <MaterialIcon name="local_shipping" size="xl" className="mb-2 opacity-40" />
        <p>No dock intakes found.</p>
      </div>
    );
  }

  return (
    <>
      {/* Mobile stacked cards */}
      <div className="md:hidden space-y-3">
        {shipments.map((s) => (
          <Card key={s.id} className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => onRowClick(s.id)}>
            <CardContent className="p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <ShipmentNumberBadge shipmentNumber={s.shipment_number} exceptionType={s.shipment_exception_type} />
                  <ShipmentExceptionBadge shipmentId={s.id} count={s.exception_count} />
                </div>
                <Badge variant={statusBadgeVariant(s.inbound_status)}>
                  {formatStatus(s.inbound_status)}
                </Badge>
              </div>
              <div className="text-sm text-muted-foreground">{s.account_name || 'Unassigned'}</div>
              <div className="text-xs text-muted-foreground">
                {s.signed_pieces ?? '-'} signed pcs
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
      {/* Desktop table */}
      <div className="hidden md:block rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead aria-sort={sort.key === 'shipment_number' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                <SortHeaderButton label="Intake #" sortKey="shipment_number" sort={sort} onSort={onSortChange} />
              </TableHead>
              <TableHead aria-sort={sort.key === 'account_name' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                <SortHeaderButton label="Account" sortKey="account_name" sort={sort} onSort={onSortChange} />
              </TableHead>
              <TableHead aria-sort={sort.key === 'vendor_name' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                <SortHeaderButton label="Vendor" sortKey="vendor_name" sort={sort} onSort={onSortChange} />
              </TableHead>
              <TableHead className="text-right" aria-sort={sort.key === 'signed_pieces' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                <SortHeaderButton label="Signed Pieces" sortKey="signed_pieces" sort={sort} onSort={onSortChange} align="right" />
              </TableHead>
              <TableHead aria-sort={sort.key === 'inbound_status' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                <SortHeaderButton label="Status" sortKey="inbound_status" sort={sort} onSort={onSortChange} />
              </TableHead>
              <TableHead aria-sort={sort.key === 'created_at' ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
                <SortHeaderButton label="Arrived" sortKey="created_at" sort={sort} onSort={onSortChange} />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shipments.map((s) => (
              <TableRow
                key={s.id}
                className="cursor-pointer hover:bg-muted/50"
                onClick={() => onRowClick(s.id)}
              >
                <TableCell>
                  <div className="flex items-center gap-2">
                    <ShipmentNumberBadge shipmentNumber={s.shipment_number} exceptionType={s.shipment_exception_type} />
                    <ShipmentExceptionBadge shipmentId={s.id} count={s.exception_count} />
                  </div>
                </TableCell>
                <TableCell>
                  {s.account_name || (
                    <span className="text-muted-foreground italic">Unassigned</span>
                  )}
                </TableCell>
                <TableCell>{s.vendor_name || '-'}</TableCell>
                <TableCell className="text-right">{s.signed_pieces ?? '-'}</TableCell>
                <TableCell>
                  <Badge variant={statusBadgeVariant(s.inbound_status)}>
                    {formatStatus(s.inbound_status)}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-sm">
                  {formatDate(s.created_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}

/* -- Main IncomingContent component -- */
interface IncomingContentProps {
  initialSubTab?: 'manifests' | 'expected' | 'intakes';
  onStartDockIntake?: () => void;
}

export function IncomingContent({ initialSubTab, onStartDockIntake }: IncomingContentProps) {
  const navigate = useNavigate();
  const mapInitialTab = (): TabValue => {
    if (initialSubTab === 'intakes') return 'dock_intakes';
    if (initialSubTab === 'expected') return 'expected';
    if (initialSubTab === 'manifests') return 'manifests';
    // Default inbound landing: Dock Intakes (most common operational workflow)
    return 'dock_intakes';
  };

  const [activeTab, setActiveTab] = useState<TabValue>(mapInitialTab);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const [sortByTab, setSortByTab] = useState<{
    manifests: SortState<ManifestSortKey>;
    expected: SortState<ExpectedSortKey>;
    dock_intakes: SortState<DockIntakeSortKey>;
  }>({
    manifests: { key: 'created_at', direction: 'desc' },
    expected: { key: 'created_at', direction: 'desc' },
    dock_intakes: { key: 'created_at', direction: 'desc' },
  });

  // Keep active tab aligned with parent-provided sub-tab.
  useEffect(() => {
    if (initialSubTab) {
      setActiveTab(mapInitialTab());
    }
  }, [initialSubTab]);

  // Debounce inbound list search so we don't spam Supabase on each keystroke.
  useEffect(() => {
    if (search === '') {
      setDebouncedSearch('');
      return;
    }
    const timeout = setTimeout(() => {
      setDebouncedSearch(search);
    }, 200);

    return () => clearTimeout(timeout);
  }, [search]);

  const currentKind = TAB_TO_KIND[activeTab];

  const { shipments, loading } = useIncomingShipments({
    inbound_kind: currentKind,
    search: debouncedSearch || undefined,
    status: statusFilter !== 'all' ? statusFilter : undefined,
  });

  const sortedShipments = useMemo(() => {
    switch (activeTab) {
      case 'manifests':
        return sortManifestShipments(shipments, sortByTab.manifests);
      case 'expected':
        return sortExpectedShipments(shipments, sortByTab.expected);
      case 'dock_intakes':
        return sortDockIntakeShipments(shipments, sortByTab.dock_intakes);
      default:
        return shipments;
    }
  }, [shipments, activeTab, sortByTab]);

  const handleManifestSort = (key: ManifestSortKey) => {
    setSortByTab((prev) => ({ ...prev, manifests: nextSortState(prev.manifests, key) }));
  };
  const handleExpectedSort = (key: ExpectedSortKey) => {
    setSortByTab((prev) => ({ ...prev, expected: nextSortState(prev.expected, key) }));
  };
  const handleDockIntakeSort = (key: DockIntakeSortKey) => {
    setSortByTab((prev) => ({ ...prev, dock_intakes: nextSortState(prev.dock_intakes, key) }));
  };

  const statusOptions = useMemo(() => {
    switch (activeTab) {
      case 'manifests':
        return MANIFEST_STATUSES;
      case 'expected':
        return EXPECTED_STATUSES;
      case 'dock_intakes':
        return DOCK_INTAKE_STATUSES;
    }
  }, [activeTab]);

  const handleTabChange = (val: string) => {
    setActiveTab(val as TabValue);
    setStatusFilter('all');
    setSearch('');
    setDebouncedSearch('');
  };

  const { profile } = useAuth();
  const { toast } = useToast();

  const handleManifestRowClick = (id: string) => navigate(`/incoming/manifest/${id}`);
  const handleExpectedRowClick = (id: string) => navigate(`/incoming/expected/${id}`);
  const handleDockIntakeRowClick = (id: string) => navigate(`/incoming/dock-intake/${id}`);

  const handleCreateDockIntake = async (): Promise<boolean> => {
    if (!profile?.tenant_id) return false;
    try {
      setCreating(true);

      // Insert with exact PF-1 payload (no account_id)
      const { data, error } = await (supabase as any)
        .from('shipments')
        .insert({
          tenant_id: profile.tenant_id,
          shipment_type: 'inbound',
          status: 'expected',
          inbound_kind: 'dock_intake',
          inbound_status: 'draft',
          created_by: profile.id,
        })
        .select('id')
        .single();

      if (error) throw error;
      navigate(`/incoming/dock-intake/${data.id}`);
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create record';
      toast({
        variant: 'destructive',
        title: 'Error',
        description: message,
      });
      return false;
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        {/* Prevent awkward wrapping on mobile: use shorter labels */}
        <TabsList className="w-full grid grid-cols-3 h-auto gap-1">
          <TabsTrigger value="manifests" className="gap-2">
            <MaterialIcon name="list_alt" size="sm" />
            <span className="hidden sm:inline">Manifests</span>
            <span className="sm:hidden">Manifests</span>
          </TabsTrigger>
          <TabsTrigger value="expected" className="gap-2">
            <MaterialIcon name="schedule" size="sm" />
            <span className="hidden sm:inline">Expected Shipments</span>
            <span className="sm:hidden">Expected</span>
          </TabsTrigger>
          <TabsTrigger value="dock_intakes" className="gap-2">
            <MaterialIcon name="local_shipping" size="sm" />
            <span className="hidden sm:inline">Dock Intakes</span>
            <span className="sm:hidden">Intakes</span>
          </TabsTrigger>
        </TabsList>

        {/* Shared toolbar */}
        <Card className="mt-4">
          <CardContent className="pt-4 relative">
            <HelpTip
              tooltip="Filter and search inbound shipments. Click a row to view details, allocate items, or manage references."
              pageKey="incoming.list"
              fieldKey="filters_toolbar"
              className="absolute right-3 top-3"
            />

            {(() => {
              const showCta = activeTab === 'manifests' || activeTab === 'expected';
              return (
                <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-row sm:items-center">
                  <div className="relative col-span-2 sm:flex-1 w-full sm:max-w-xs">
                <MaterialIcon
                  name="search"
                  size="sm"
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  placeholder="Search #, account, vendor, notes, refs..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8"
                />
              </div>

                  <div
                    className={cn(
                      showCta ? 'col-span-1' : 'col-span-2',
                      'sm:col-span-auto',
                    )}
                  >
                    <Select value={statusFilter} onValueChange={setStatusFilter}>
                      <SelectTrigger className="w-full sm:w-[180px]">
                        <SelectValue placeholder="All statuses" />
                      </SelectTrigger>
                      <SelectContent>
                        {statusOptions.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s === 'all' ? 'All statuses' : s.replace(/_/g, ' ')}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {activeTab === 'manifests' && (
                    <div className="col-span-1 sm:ml-auto">
                      <Button
                        size="sm"
                        className="w-full sm:w-auto justify-center"
                        onClick={() => {
                          navigate('/incoming/manifest/new');
                        }}
                        disabled={creating}
                      >
                        <MaterialIcon name="add" size="sm" className="mr-1" />
                        New Manifest
                      </Button>
                    </div>
                  )}
                  {activeTab === 'expected' && (
                    <div className="col-span-1 sm:ml-auto">
                      <Button
                        size="sm"
                        className="w-full sm:w-auto justify-center"
                        onClick={() => {
                          navigate('/incoming/expected/new');
                        }}
                        disabled={creating}
                      >
                        <MaterialIcon name="add" size="sm" className="mr-1 hidden sm:inline" />
                        <span className="hidden sm:inline">New Expected Shipment</span>
                        <span className="sm:hidden">+ Expected</span>
                      </Button>
                    </div>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>

        <TabsContent value="manifests" className="mt-4">
          <ManifestList
            shipments={activeTab === 'manifests' ? sortedShipments : []}
            loading={loading}
            onRowClick={handleManifestRowClick}
            sort={sortByTab.manifests}
            onSortChange={handleManifestSort}
          />
        </TabsContent>

        <TabsContent value="expected" className="mt-4 space-y-6">
          <div>
            <h3 className="font-medium text-sm text-muted-foreground mb-3">All Expected Shipments</h3>
            <ExpectedList
              shipments={activeTab === 'expected' ? sortedShipments : []}
              loading={loading}
              onRowClick={handleExpectedRowClick}
              sort={sortByTab.expected}
              onSortChange={handleExpectedSort}
            />
          </div>
        </TabsContent>

        <TabsContent value="dock_intakes" className="mt-4 space-y-6">
          {/* All dock intakes (including closed) */}
          <div>
            <h3 className="font-medium text-sm text-muted-foreground mb-3">All Dock Intakes</h3>
            <DockIntakeList
              shipments={activeTab === 'dock_intakes' ? sortedShipments : []}
              loading={loading}
              onRowClick={handleDockIntakeRowClick}
              sort={sortByTab.dock_intakes}
              onSortChange={handleDockIntakeSort}
            />
          </div>
        </TabsContent>
      </Tabs>

    </div>
  );
}
