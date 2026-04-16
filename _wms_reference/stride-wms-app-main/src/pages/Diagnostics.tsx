import { useState } from 'react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/ui/page-header';
import { useAppIssues, GroupedIssue, IssueFilters } from '@/hooks/useAppIssues';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { formatDistanceToNow, format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { BackToDevConsoleButton } from '@/components/admin/BackToDevConsoleButton';

const ALL_VALUE = '__all__';

export default function Diagnostics() {
  const { toast } = useToast();
  const [filters, setFilters] = useState<IssueFilters>({});
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);

  const { groupedIssues, loading, error, refetch, updateStatus } = useAppIssues(filters);

  const toggleGroup = (fingerprint: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(fingerprint)) {
        next.delete(fingerprint);
      } else {
        next.add(fingerprint);
      }
      return next;
    });
  };

  const handleStatusChange = async (fingerprint: string, status: 'new' | 'acknowledged' | 'fixed' | 'ignored') => {
    const success = await updateStatus(fingerprint, status);
    if (success) {
      toast({
        title: 'Status Updated',
        description: `Marked as ${status}`,
      });
    } else {
      toast({
        title: 'Error',
        description: 'Failed to update status',
        variant: 'destructive',
      });
    }
  };

  const getSeverityBadge = (severity: 'P0' | 'P1' | 'P2') => {
    const config = {
      P0: { variant: 'destructive' as const, icon: 'error', label: 'P0 Critical' },
      P1: { variant: 'default' as const, icon: 'warning', label: 'P1 Major' },
      P2: { variant: 'secondary' as const, icon: 'info', label: 'P2 Minor' },
    };
    const { variant, icon, label } = config[severity];
    return (
      <Badge variant={variant} className="gap-1">
        <MaterialIcon name={icon} size="sm" />
        {label}
      </Badge>
    );
  };

  const getLevelBadge = (level: 'error' | 'warning') => {
    if (level === 'error') {
      return <Badge variant="destructive">Error</Badge>;
    }
    return <Badge variant="warning">Warning</Badge>;
  };

  const getStatusBadge = (status: string) => {
    const config: Record<string, { variant: 'default' | 'warning' | 'success' | 'secondary'; label: string }> = {
      new: { variant: 'default', label: 'New' },
      acknowledged: { variant: 'warning', label: 'Acknowledged' },
      fixed: { variant: 'success', label: 'Fixed' },
      ignored: { variant: 'secondary', label: 'Ignored' },
    };
    const { variant, label } = config[status] || config.new;
    return <Badge variant={variant}>{label}</Badge>;
  };

  const stats = {
    total: groupedIssues.length,
    p0: groupedIssues.filter((g) => g.severity === 'P0').length,
    p1: groupedIssues.filter((g) => g.severity === 'P1').length,
    new: groupedIssues.filter((g) => g.status === 'new').length,
  };

  return (
    <DashboardLayout>
      <div className="mb-4">
        <BackToDevConsoleButton />
      </div>
      <PageHeader
        primaryText="Error"
        accentText="Diagnostics"
        description="Monitor and manage application errors and warnings"
      />

      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Issues
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Critical (P0)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive">{stats.p0}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Major (P1)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-500">{stats.p1}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              New Issues
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-500">{stats.new}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowFilters(!showFilters)}
          className="gap-2"
        >
          <MaterialIcon name="filter_list" size="sm" />
          Filters
          {Object.keys(filters).length > 0 && (
            <Badge variant="secondary" className="ml-1">
              {Object.keys(filters).length}
            </Badge>
          )}
        </Button>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2">
          <MaterialIcon name="refresh" size="sm" className={cn(loading && 'animate-spin')} />
          Refresh
        </Button>
        {Object.keys(filters).length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setFilters({})}>
            Clear Filters
          </Button>
        )}
      </div>

      {showFilters && (
        <Card className="mb-4">
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              <div className="space-y-2">
                <Label>Environment</Label>
                <Select
                  value={filters.environment || ALL_VALUE}
                  onValueChange={(v) =>
                    setFilters((f) => ({ ...f, environment: v === ALL_VALUE ? undefined : v as 'dev' | 'prod' }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_VALUE}>All</SelectItem>
                    <SelectItem value="dev">Dev</SelectItem>
                    <SelectItem value="prod">Prod</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Level</Label>
                <Select
                  value={filters.level || ALL_VALUE}
                  onValueChange={(v) =>
                    setFilters((f) => ({ ...f, level: v === ALL_VALUE ? undefined : v as 'error' | 'warning' }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_VALUE}>All</SelectItem>
                    <SelectItem value="error">Error</SelectItem>
                    <SelectItem value="warning">Warning</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Severity</Label>
                <Select
                  value={filters.severity || ALL_VALUE}
                  onValueChange={(v) =>
                    setFilters((f) => ({ ...f, severity: v === ALL_VALUE ? undefined : v as 'P0' | 'P1' | 'P2' }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_VALUE}>All</SelectItem>
                    <SelectItem value="P0">P0 Critical</SelectItem>
                    <SelectItem value="P1">P1 Major</SelectItem>
                    <SelectItem value="P2">P2 Minor</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Status</Label>
                <Select
                  value={filters.status || ALL_VALUE}
                  onValueChange={(v) =>
                    setFilters((f) => ({
                      ...f,
                      status: v === ALL_VALUE ? undefined : v as 'new' | 'acknowledged' | 'fixed' | 'ignored',
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_VALUE}>All</SelectItem>
                    <SelectItem value="new">New</SelectItem>
                    <SelectItem value="acknowledged">Acknowledged</SelectItem>
                    <SelectItem value="fixed">Fixed</SelectItem>
                    <SelectItem value="ignored">Ignored</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Role</Label>
                <Select
                  value={filters.role || ALL_VALUE}
                  onValueChange={(v) =>
                    setFilters((f) => ({ ...f, role: v === ALL_VALUE ? undefined : v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_VALUE}>All</SelectItem>
                      <SelectItem value="admin_dev">Admin Dev</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="billing_manager">Billing Manager</SelectItem>
                    <SelectItem value="manager">Manager</SelectItem>
                    <SelectItem value="warehouse">Warehouse</SelectItem>
                    <SelectItem value="technician">Technician</SelectItem>
                    <SelectItem value="client_user">Client</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Route Contains</Label>
                <Input
                  placeholder="/shipments"
                  value={filters.routeContains || ''}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      routeContains: e.target.value || undefined,
                    }))
                  }
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error State */}
      {error && (
        <Card className="border-destructive mb-4">
          <CardContent className="pt-4">
            <p className="text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {/* Issues Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead className="w-16">Count</TableHead>
                <TableHead className="w-32">Last Seen</TableHead>
                <TableHead>Message</TableHead>
                <TableHead className="w-40">Routes</TableHead>
                <TableHead className="w-32">Roles</TableHead>
                <TableHead className="w-24">Level</TableHead>
                <TableHead className="w-28">Severity</TableHead>
                <TableHead className="w-28">Status</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && groupedIssues.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8">
                    <MaterialIcon name="refresh" size="lg" className="animate-spin mx-auto mb-2 text-muted-foreground" />
                    <p className="text-muted-foreground">Loading issues...</p>
                  </TableCell>
                </TableRow>
              ) : groupedIssues.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="text-center py-8">
                    <MaterialIcon name="bug_report" size="lg" className="mx-auto mb-2 text-muted-foreground" />
                    <p className="text-muted-foreground">No issues found</p>
                    <p className="text-sm text-muted-foreground">
                      Issues will appear here when errors or warnings are captured
                    </p>
                  </TableCell>
                </TableRow>
              ) : (
                groupedIssues.map((group) => (
                  <IssueGroupRow
                    key={group.fingerprint}
                    group={group}
                    expanded={expandedGroups.has(group.fingerprint)}
                    onToggle={() => toggleGroup(group.fingerprint)}
                    onStatusChange={handleStatusChange}
                    getSeverityBadge={getSeverityBadge}
                    getLevelBadge={getLevelBadge}
                    getStatusBadge={getStatusBadge}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </DashboardLayout>
  );
}

interface IssueGroupRowProps {
  group: GroupedIssue;
  expanded: boolean;
  onToggle: () => void;
  onStatusChange: (fingerprint: string, status: 'new' | 'acknowledged' | 'fixed' | 'ignored') => void;
  getSeverityBadge: (severity: 'P0' | 'P1' | 'P2') => React.ReactNode;
  getLevelBadge: (level: 'error' | 'warning') => React.ReactNode;
  getStatusBadge: (status: string) => React.ReactNode;
}

function IssueGroupRow({
  group,
  expanded,
  onToggle,
  onStatusChange,
  getSeverityBadge,
  getLevelBadge,
  getStatusBadge,
}: IssueGroupRowProps) {
  const { toast } = useToast();
  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={onToggle}>
        <TableCell>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={(e) => { e.stopPropagation(); onToggle(); }}>
            {expanded ? (
              <MaterialIcon name="expand_more" size="sm" />
            ) : (
              <MaterialIcon name="chevron_right" size="sm" />
            )}
          </Button>
        </TableCell>
        <TableCell>
          <Badge variant="outline">{group.count}</Badge>
        </TableCell>
        <TableCell className="text-sm text-muted-foreground">
          {formatDistanceToNow(new Date(group.last_seen), { addSuffix: true })}
        </TableCell>
        <TableCell>
          <div className="max-w-md">
            <p className="truncate font-mono text-sm">{group.error_message}</p>
            {group.component_name && (
              <p className="text-xs text-muted-foreground">
                Component: {group.component_name}
              </p>
            )}
          </div>
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {group.affected_routes.slice(0, 2).map((route) => (
              <Badge key={route} variant="outline" className="text-xs">
                {route}
              </Badge>
            ))}
            {group.affected_routes.length > 2 && (
              <Badge variant="outline" className="text-xs">
                +{group.affected_routes.length - 2}
              </Badge>
            )}
          </div>
        </TableCell>
        <TableCell>
          <div className="flex flex-wrap gap-1">
            {group.affected_roles.map((role) => (
              <Badge key={role} variant="secondary" className="text-xs capitalize">
                {role.replace('_', ' ')}
              </Badge>
            ))}
          </div>
        </TableCell>
        <TableCell>{getLevelBadge(group.level)}</TableCell>
        <TableCell>{getSeverityBadge(group.severity)}</TableCell>
        <TableCell>{getStatusBadge(group.status)}</TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MaterialIcon name="more_horiz" size="sm" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onStatusChange(group.fingerprint, 'acknowledged')}>
                <MaterialIcon name="visibility" size="sm" className="mr-2" />
                Acknowledge
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onStatusChange(group.fingerprint, 'fixed')}>
                <MaterialIcon name="check_circle" size="sm" className="mr-2" />
                Mark Fixed
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onStatusChange(group.fingerprint, 'ignored')}>
                <MaterialIcon name="cancel" size="sm" className="mr-2" />
                Ignore
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className="bg-muted/30">
          <TableCell colSpan={10} className="p-4">
            <div className="space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="font-medium">Full Error Message</h4>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      navigator.clipboard.writeText(group.error_message);
                      toast({
                        title: 'Copied',
                        description: 'Error message copied to clipboard',
                      });
                    }}
                    className="h-7 gap-1"
                  >
                    <MaterialIcon name="content_copy" size="sm" />
                    Copy
                  </Button>
                </div>
                <pre className="bg-background p-3 rounded-md text-sm overflow-x-auto">
                  {group.error_message}
                </pre>
              </div>

              {group.issues[0]?.stack_trace && (
                <div>
                  <h4 className="font-medium mb-2">Stack Trace</h4>
                  <pre className="bg-background p-3 rounded-md text-xs overflow-x-auto max-h-48">
                    {group.issues[0].stack_trace}
                  </pre>
                </div>
              )}

              <div>
                <h4 className="font-medium mb-2">
                  Occurrences ({group.issues.length})
                </h4>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {group.issues.slice(0, 20).map((issue) => (
                    <div
                      key={issue.id}
                      className="bg-background p-3 rounded-md text-sm flex items-center gap-4"
                    >
                      <span className="text-muted-foreground whitespace-nowrap">
                        {format(new Date(issue.created_at), 'MMM d, HH:mm:ss')}
                      </span>
                      <Badge variant="outline" className="whitespace-nowrap">
                        {issue.route}
                      </Badge>
                      {issue.user_role && (
                        <Badge variant="secondary" className="capitalize whitespace-nowrap">
                          {issue.user_role.replace('_', ' ')}
                        </Badge>
                      )}
                      {issue.action_context && (
                        <span className="text-muted-foreground truncate">
                          Action: {issue.action_context}
                        </span>
                      )}
                      {issue.http_status && (
                        <Badge
                          variant={issue.http_status >= 500 ? 'destructive' : 'outline'}
                        >
                          HTTP {issue.http_status}
                        </Badge>
                      )}
                      {issue.supabase_error_code && (
                        <Badge variant="outline">
                          {issue.supabase_error_code}
                        </Badge>
                      )}
                    </div>
                  ))}
                  {group.issues.length > 20 && (
                    <p className="text-sm text-muted-foreground text-center py-2">
                      +{group.issues.length - 20} more occurrences
                    </p>
                  )}
                </div>
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}
