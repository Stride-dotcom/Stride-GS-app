import { useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { EntityActivityFeed } from '@/components/activity/EntityActivityFeed';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useStocktakeScan, useStocktakeResults, ResultType } from '@/hooks/useStocktakes';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { formatMinutesShort } from '@/lib/time/serviceTimeEstimate';
import { JobTimerWidget } from '@/components/time/JobTimerWidget';
import { usePermissions } from '@/hooks/usePermissions';
import { ServiceTimeAdjustmentDialog } from '@/components/time/ServiceTimeAdjustmentDialog';
import { UnifiedNotesSection } from '@/components/notes/UnifiedNotesSection';

const resultConfig: Record<ResultType, {
  color: string;
  bgColor: string;
  iconName: string;
  label: string;
}> = {
  found_expected: {
    color: 'text-green-400',
    bgColor: 'bg-green-500/20 border-green-500/30',
    iconName: 'check_circle',
    label: 'Found',
  },
  found_wrong_location: {
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/20 border-yellow-500/30',
    iconName: 'warning',
    label: 'Wrong Location',
  },
  missing: {
    color: 'text-red-400',
    bgColor: 'bg-red-500/20 border-red-500/30',
    iconName: 'cancel',
    label: 'Missing',
  },
  found_unexpected: {
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/20 border-orange-500/30',
    iconName: 'error',
    label: 'Unexpected',
  },
  released_found: {
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/20 border-purple-500/30',
    iconName: 'help',
    label: 'Released Found',
  },
};

type SortField = 'result' | 'item_code' | 'expected_location' | 'scanned_location' | 'resolved';
type SortDirection = 'asc' | 'desc';

export default function StocktakeReport() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [resultFilter, setResultFilter] = useState<ResultType | 'all'>('all');
  const [resolvedFilter, setResolvedFilter] = useState<'all' | 'resolved' | 'unresolved'>('all');
  const [sortField, setSortField] = useState<SortField>('result');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [resolveDialog, setResolveDialog] = useState<{
    id: string;
    itemCode: string;
  } | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [adjustTimeOpen, setAdjustTimeOpen] = useState(false);

  const { hasRole } = usePermissions();
  const canAdjustServiceTime = hasRole('admin') || hasRole('manager') || hasRole('billing_manager');

  const { stocktake, stats, loading: stocktakeLoading, refetch: refetchStocktake } = useStocktakeScan(id || '');
  const { results, loading: resultsLoading, refetch, resolveResult } = useStocktakeResults(id || '');

  const loading = stocktakeLoading || resultsLoading;

  // Filter and sort results
  const filteredResults = useMemo(() => {
    let filtered = [...results];

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(r =>
        r.item_code.toLowerCase().includes(query) ||
        r.expected_location?.code?.toLowerCase().includes(query) ||
        r.scanned_location?.code?.toLowerCase().includes(query)
      );
    }

    // Result type filter
    if (resultFilter !== 'all') {
      filtered = filtered.filter(r => r.result === resultFilter);
    }

    // Resolved filter
    if (resolvedFilter === 'resolved') {
      filtered = filtered.filter(r => r.resolved);
    } else if (resolvedFilter === 'unresolved') {
      filtered = filtered.filter(r => !r.resolved);
    }

    // Sort
    filtered.sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (sortField) {
        case 'result':
          aVal = a.result;
          bVal = b.result;
          break;
        case 'item_code':
          aVal = a.item_code;
          bVal = b.item_code;
          break;
        case 'expected_location':
          aVal = a.expected_location?.code || '';
          bVal = b.expected_location?.code || '';
          break;
        case 'scanned_location':
          aVal = a.scanned_location?.code || '';
          bVal = b.scanned_location?.code || '';
          break;
        case 'resolved':
          aVal = a.resolved ? 1 : 0;
          bVal = b.resolved ? 1 : 0;
          break;
      }

      const compare = String(aVal).localeCompare(String(bVal));
      return sortDirection === 'asc' ? compare : -compare;
    });

    return filtered;
  }, [results, searchQuery, resultFilter, resolvedFilter, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <MaterialIcon name="swap_vert" size="sm" className="opacity-50" />;
    return sortDirection === 'asc' ? <MaterialIcon name="arrow_upward" size="sm" /> : <MaterialIcon name="arrow_downward" size="sm" />;
  };

  const handleResolve = async () => {
    if (!resolveDialog) return;
    await resolveResult(resolveDialog.id, resolutionNotes);
    setResolveDialog(null);
    setResolutionNotes('');
  };

  const exportCSV = () => {
    const headers = ['Result', 'Item Code', 'Expected Location', 'Scanned Location', 'Resolved', 'Resolution Notes'];
    const rows = filteredResults.map(r => [
      resultConfig[r.result]?.label || r.result,
      r.item_code,
      r.expected_location?.code || '-',
      r.scanned_location?.code || '-',
      r.resolved ? 'Yes' : 'No',
      r.resolution_notes || '',
    ]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stocktake-${stocktake?.stocktake_number || id}-report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Summary stats
  const summaryStats = useMemo(() => ({
    total: results.length,
    found: results.filter(r => r.result === 'found_expected').length,
    wrongLocation: results.filter(r => r.result === 'found_wrong_location').length,
    missing: results.filter(r => r.result === 'missing').length,
    unexpected: results.filter(r => r.result === 'found_unexpected').length,
    releasedFound: results.filter(r => r.result === 'released_found').length,
    resolved: results.filter(r => r.resolved).length,
    unresolved: results.filter(r => !r.resolved).length,
  }), [results]);

  if (loading || !stocktake) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <MaterialIcon name="progress_activity" className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/stocktakes')}>
            <MaterialIcon name="arrow_back" size="md" />
          </Button>
          <div className="flex-1">
            <h1 className="text-2xl font-bold">
              {stocktake.name || stocktake.stocktake_number} Report
            </h1>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>{stocktake.warehouse?.name}</span>
              {stocktake.closed_at && (
                <>
                  <span>·</span>
                  <span>Closed {format(new Date(stocktake.closed_at), 'MMM d, yyyy h:mm a')}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <JobTimerWidget
              jobType="stocktake"
              jobId={id}
              variant="inline"
              showControls={false}
            />
            {stocktake.duration_minutes != null && stocktake.duration_minutes > 0 && (
              <Badge variant="secondary" className="tabular-nums whitespace-nowrap">
                Actual {formatMinutesShort(stocktake.duration_minutes)}
              </Badge>
            )}
            {canAdjustServiceTime && (stocktake.duration_minutes != null && stocktake.duration_minutes > 0) && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAdjustTimeOpen(true)}
                title="Adjust actual service time (manager/admin)"
              >
                <MaterialIcon name="schedule" size="sm" className="mr-2" />
                Adjust Time
              </Button>
            )}
          </div>
          <Button variant="outline" onClick={exportCSV}>
            <MaterialIcon name="download" size="sm" className="mr-2" />
            Export CSV
          </Button>
        </div>

        <ServiceTimeAdjustmentDialog
          open={adjustTimeOpen}
          onOpenChange={setAdjustTimeOpen}
          jobType="stocktake"
          jobId={id}
          currentMinutes={stocktake.duration_minutes}
          onSaved={() => {
            refetchStocktake();
            refetch();
          }}
        />

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <MaterialIcon name="chat" size="sm" />
              Notes
            </CardTitle>
          </CardHeader>
          <CardContent>
            <UnifiedNotesSection
              entityType="stocktake"
              entityId={stocktake.id}
              entityNumber={stocktake.stocktake_number}
              embedded
              allowedNoteTypes={['internal', 'public']}
            />
          </CardContent>
        </Card>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Total Items</div>
              <div className="text-2xl font-bold">{summaryStats.total}</div>
            </CardContent>
          </Card>
          <Card className="bg-green-500/10 border-green-500/30">
            <CardContent className="p-4">
              <div className="text-sm text-green-400">Found</div>
              <div className="text-2xl font-bold text-green-400">{summaryStats.found}</div>
            </CardContent>
          </Card>
          <Card className="bg-yellow-500/10 border-yellow-500/30">
            <CardContent className="p-4">
              <div className="text-sm text-yellow-400">Wrong Loc</div>
              <div className="text-2xl font-bold text-yellow-400">{summaryStats.wrongLocation}</div>
            </CardContent>
          </Card>
          <Card className="bg-red-500/10 border-red-500/30">
            <CardContent className="p-4">
              <div className="text-sm text-red-400">Missing</div>
              <div className="text-2xl font-bold text-red-400">{summaryStats.missing}</div>
            </CardContent>
          </Card>
          <Card className="bg-orange-500/10 border-orange-500/30">
            <CardContent className="p-4">
              <div className="text-sm text-orange-400">Unexpected</div>
              <div className="text-2xl font-bold text-orange-400">{summaryStats.unexpected}</div>
            </CardContent>
          </Card>
          <Card className="bg-blue-500/10 border-blue-500/30">
            <CardContent className="p-4">
              <div className="text-sm text-blue-400">Resolved</div>
              <div className="text-2xl font-bold text-blue-400">{summaryStats.resolved}</div>
            </CardContent>
          </Card>
          <Card className="bg-gray-500/10 border-gray-500/30">
            <CardContent className="p-4">
              <div className="text-sm text-muted-foreground">Unresolved</div>
              <div className="text-2xl font-bold">{summaryStats.unresolved}</div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4 items-center">
              <div className="relative flex-1 min-w-[200px]">
                <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search items..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Select
                value={resultFilter}
                onValueChange={(v) => setResultFilter(v as ResultType | 'all')}
              >
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Result" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Results</SelectItem>
                  {Object.entries(resultConfig).map(([value, config]) => (
                    <SelectItem key={value} value={value}>{config.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={resolvedFilter}
                onValueChange={(v) => setResolvedFilter(v as 'all' | 'resolved' | 'unresolved')}
              >
                <SelectTrigger className="w-[160px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                  <SelectItem value="unresolved">Unresolved</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={refetch}>
                <MaterialIcon name="refresh" size="sm" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Results Table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-auto max-h-[calc(100vh-450px)]">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort('result')}>
                      <div className="flex items-center gap-2">
                        Result <SortIcon field="result" />
                      </div>
                    </TableHead>
                    <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort('item_code')}>
                      <div className="flex items-center gap-2">
                        Item Code <SortIcon field="item_code" />
                      </div>
                    </TableHead>
                    <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort('expected_location')}>
                      <div className="flex items-center gap-2">
                        Expected Location <SortIcon field="expected_location" />
                      </div>
                    </TableHead>
                    <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort('scanned_location')}>
                      <div className="flex items-center gap-2">
                        Scanned Location <SortIcon field="scanned_location" />
                      </div>
                    </TableHead>
                    <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort('resolved')}>
                      <div className="flex items-center gap-2">
                        Status <SortIcon field="resolved" />
                      </div>
                    </TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredResults.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        {results.length === 0 ? 'No results recorded' : 'No results match filters'}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredResults.map((result) => {
                      const config = resultConfig[result.result];
                      return (
                        <TableRow
                          key={result.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => result.item_id && navigate(`/inventory/${result.item_id}`)}
                        >
                          <TableCell>
                            <Badge className={cn('gap-1', config?.bgColor)}>
                              <MaterialIcon name={config?.iconName || 'inventory_2'} className="h-3 w-3" />
                              {config?.label || result.result}
                            </Badge>
                          </TableCell>
                          <TableCell className="font-mono font-medium">
                            {result.item_code}
                          </TableCell>
                          <TableCell className="font-mono">
                            {result.expected_location?.code || '-'}
                          </TableCell>
                          <TableCell className="font-mono">
                            {result.scanned_location?.code || (
                              <span className="text-muted-foreground">Not scanned</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {result.resolved ? (
                              <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                                Resolved
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-muted-foreground">
                                Unresolved
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()}>
                            {!result.resolved && result.result !== 'found_expected' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setResolveDialog({
                                  id: result.id,
                                  itemCode: result.item_code,
                                })}
                              >
                                Resolve
                              </Button>
                            )}
                            {result.resolved && result.resolution_notes && (
                              <span className="text-xs text-muted-foreground" title={result.resolution_notes}>
                                {result.resolution_notes.slice(0, 30)}
                                {result.resolution_notes.length > 30 ? '...' : ''}
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            {filteredResults.length > 0 && (
              <div className="p-3 border-t text-sm text-muted-foreground">
                Showing {filteredResults.length} of {results.length} results
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Resolve Dialog */}
      {/* Activity Feed */}
      <div className="mt-6">
        <EntityActivityFeed
          entityType="stocktake"
          entityId={id!}
          title="Activity"
          description="Timeline of changes to this stocktake"
        />
      </div>

      <Dialog open={!!resolveDialog} onOpenChange={() => setResolveDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve Variance</DialogTitle>
            <DialogDescription>
              Add resolution notes for item <strong>{resolveDialog?.itemCode}</strong>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Textarea
              placeholder="Enter resolution notes (e.g., 'Item relocated', 'Disposed', 'Found damaged')..."
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResolveDialog(null)}>
              Cancel
            </Button>
            <Button onClick={handleResolve} disabled={!resolutionNotes.trim()}>
              Mark Resolved
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
