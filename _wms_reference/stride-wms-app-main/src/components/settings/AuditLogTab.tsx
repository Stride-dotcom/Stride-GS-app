import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { format } from 'date-fns';
import {
  useAuditLog,
  AuditLogEntry,
  getEntityTypeLabel,
  getActionColor,
  formatUserName,
  formatAuditSummary,
  formatChangesForDisplay,
} from '@/hooks/useAuditLog';

export function AuditLogTab() {
  const {
    entries,
    loading,
    hasMore,
    filters,
    updateFilters,
    loadMore,
    refetch,
  } = useAuditLog({ dateRange: 'last30' });

  const [searchInput, setSearchInput] = useState('');
  const [selectedEntry, setSelectedEntry] = useState<AuditLogEntry | null>(null);

  const handleSearch = () => {
    updateFilters({ search: searchInput || undefined });
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  const handleClearSearch = () => {
    setSearchInput('');
    updateFilters({ search: undefined });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-medium flex items-center gap-2">
            <MaterialIcon name="history" size="md" />
            Audit Log
          </h3>
          <p className="text-sm text-muted-foreground">
            Track changes to pricing, task types, and categories
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refetch}>
          <MaterialIcon name="refresh" size="sm" className="mr-2" />
          Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Entity Type Filter */}
            <div className="flex-1 max-w-xs">
              <Select
                value={filters.entityTable || 'all'}
                onValueChange={(value) =>
                  updateFilters({ entityTable: value === 'all' ? undefined : value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="All entity types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Entity Types</SelectItem>
                  <SelectItem value="service_events">Price List</SelectItem>
                  <SelectItem value="task_types">Task Types</SelectItem>
                  <SelectItem value="service_categories">Categories</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Date Range Filter */}
            <div className="flex-1 max-w-xs">
              <Select
                value={filters.dateRange || 'all'}
                onValueChange={(value) =>
                  updateFilters({ dateRange: value as any })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Date range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="last7">Last 7 days</SelectItem>
                  <SelectItem value="last30">Last 30 days</SelectItem>
                  <SelectItem value="last90">Last 90 days</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Search */}
            <div className="flex-1 flex gap-2">
              <Input
                placeholder="Search by code or name..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="max-w-xs"
              />
              <Button variant="outline" size="icon" onClick={handleSearch}>
                <MaterialIcon name="search" size="sm" />
              </Button>
              {filters.search && (
                <Button variant="ghost" size="icon" onClick={handleClearSearch}>
                  <MaterialIcon name="close" size="sm" />
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardContent className="pt-6">
          {loading && entries.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <MaterialIcon name="history" size="lg" className="mx-auto mb-4 opacity-50" />
              <p>No audit log entries found</p>
              <p className="text-sm mt-1">Changes to pricing and configuration will appear here</p>
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[160px]">Date/Time</TableHead>
                    <TableHead className="w-[120px]">User</TableHead>
                    <TableHead className="w-[100px]">Entity</TableHead>
                    <TableHead className="w-[80px]">Action</TableHead>
                    <TableHead>Summary</TableHead>
                    <TableHead className="w-[80px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-sm">
                        {format(new Date(entry.changed_at), 'MMM d, yyyy h:mm a')}
                      </TableCell>
                      <TableCell className="text-sm">
                        {formatUserName(entry.user)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {getEntityTypeLabel(entry.entity_table)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge className={`text-xs ${getActionColor(entry.action)}`}>
                          {entry.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm max-w-md truncate">
                        {formatAuditSummary(entry)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedEntry(entry)}
                        >
                          <MaterialIcon name="visibility" size="sm" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {/* Load More */}
              {hasMore && (
                <div className="flex justify-center mt-4">
                  <Button
                    variant="outline"
                    onClick={loadMore}
                    disabled={loading}
                  >
                    {loading ? (
                      <>
                        <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        <MaterialIcon name="expand_more" size="sm" className="mr-2" />
                        Load More
                      </>
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Detail Dialog */}
      <AuditDetailDialog
        entry={selectedEntry}
        open={!!selectedEntry}
        onOpenChange={(open) => !open && setSelectedEntry(null)}
      />
    </div>
  );
}

// ============================================================================
// DETAIL DIALOG
// ============================================================================

interface AuditDetailDialogProps {
  entry: AuditLogEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function AuditDetailDialog({ entry, open, onOpenChange }: AuditDetailDialogProps) {
  if (!entry) return null;

  const changesForDisplay = formatChangesForDisplay(entry.changes);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MaterialIcon name="history" />
            Audit Entry Details
          </DialogTitle>
          <DialogDescription>
            {format(new Date(entry.changed_at), 'MMMM d, yyyy h:mm:ss a')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Metadata */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">Entity Type:</span>
              <p className="font-medium">{getEntityTypeLabel(entry.entity_table)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Action:</span>
              <p>
                <Badge className={getActionColor(entry.action)}>{entry.action}</Badge>
              </p>
            </div>
            <div>
              <span className="text-muted-foreground">Changed By:</span>
              <p className="font-medium">{formatUserName(entry.user)}</p>
            </div>
            <div>
              <span className="text-muted-foreground">Entity:</span>
              <p className="font-medium">
                {entry.entity_code || entry.entity_name || entry.entity_id}
              </p>
            </div>
          </div>

          {/* Changes */}
          {entry.action === 'UPDATE' && changesForDisplay.length > 0 && (
            <div>
              <h4 className="text-sm font-medium mb-2">Changes</h4>
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-1/3">Field</TableHead>
                      <TableHead className="w-1/3">From</TableHead>
                      <TableHead className="w-1/3">To</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {changesForDisplay.map((change, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{change.field}</TableCell>
                        <TableCell className="text-muted-foreground">{change.from}</TableCell>
                        <TableCell className="text-green-600 dark:text-green-400">{change.to}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Snapshot for INSERT/DELETE */}
          {(entry.action === 'INSERT' || entry.action === 'DELETE') && entry.snapshot && (
            <div>
              <h4 className="text-sm font-medium mb-2">
                {entry.action === 'INSERT' ? 'Created Record' : 'Deleted Record'}
              </h4>
              <div className="bg-muted rounded-lg p-3 text-xs font-mono overflow-auto max-h-48">
                <pre>{JSON.stringify(entry.snapshot, null, 2)}</pre>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
