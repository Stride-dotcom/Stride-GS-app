import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  MobileDataCard,
  MobileDataCardHeader,
  MobileDataCardTitle,
  MobileDataCardDescription,
  MobileDataCardContent,
} from '@/components/ui/mobile-data-card';
import { useClaims, ClaimStatus, ClaimType, CLAIM_TYPE_LABELS, CLAIM_STATUS_LABELS } from '@/hooks/useClaims';
import { ClaimCreateDialog } from '@/components/claims/ClaimCreateDialog';
import { ClaimsDashboard } from '@/components/claims/ClaimsDashboard';
import { ClaimsSOP } from '@/components/claims/ClaimsSOP';
import { useIsMobile } from '@/hooks/use-mobile';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { format } from 'date-fns';
import { SLA_STATUS_LABELS, type SLAStatus } from '@/hooks/useClaimSLA';

// SLA Badge component
function SLABadge({ status }: { status: SLAStatus | null | undefined }) {
  if (!status) return null;
  return (
    <StatusIndicator status={status} label={SLA_STATUS_LABELS[status]} size="sm" />
  );
}

export default function Claims() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { profile } = useAuth();

  // Get initial tab from URL or default to dashboard
  const initialTab = searchParams.get('tab') || 'dashboard';
  const [activeTab, setActiveTab] = useState(initialTab);

  const [statusFilter, setStatusFilter] = useState<ClaimStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<ClaimType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const isMobile = useIsMobile();
  const { claims, loading, refetch } = useClaims({
    status: statusFilter === 'all' ? undefined : statusFilter,
    claimType: typeFilter === 'all' ? undefined : typeFilter,
  });

  // Check if user is admin (for SOP/Settings visibility)
  const { isAdmin } = usePermissions();

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  const handleNavigateToList = (filter?: string) => {
    setActiveTab('list');
    setSearchParams({ tab: 'list' });

    // Apply filter if specified
    if (filter === 'needs_review') {
      setStatusFilter('under_review');
    } else if (filter === 'overdue' || filter === 'paused') {
      // Would need SLA filter - for now just show all
      setStatusFilter('all');
    } else if (filter === 'shipping_damage') {
      setTypeFilter('shipping_damage');
    }
  };

  const filteredClaims = claims.filter(claim => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      claim.claim_number.toLowerCase().includes(query) ||
      claim.description.toLowerCase().includes(query) ||
      claim.account?.account_name?.toLowerCase().includes(query) ||
      claim.item?.item_code?.toLowerCase().includes(query)
    );
  });

  const handleRowClick = (claimId: string) => {
    navigate(`/claims/${claimId}`);
  };

  const getStatusBadge = (status: string) => (
    <StatusIndicator
      status={status}
      label={CLAIM_STATUS_LABELS[status as ClaimStatus] || status}
      size="sm"
    />
  );

  return (
    <DashboardLayout>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="text-foreground">Manage</span>{" "}
            <span className="text-primary">Claims</span>
          </h1>
          <p className="text-muted-foreground">Track and manage damage, loss, and incident claims</p>
        </div>
        <Button onClick={() => setCreateDialogOpen(true)} className="w-full sm:w-auto justify-center">
          <MaterialIcon name="add" size="sm" className="mr-2" />
          New Claim
        </Button>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-flex">
          <TabsTrigger value="dashboard" className="flex items-center gap-2">
            <MaterialIcon name="dashboard" size="sm" />
            <span className="hidden sm:inline">Dashboard</span>
          </TabsTrigger>
          <TabsTrigger value="list" className="flex items-center gap-2">
            <MaterialIcon name="list" size="sm" />
            <span className="hidden sm:inline">Claims</span>
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="sop" className="flex items-center gap-2">
              <MaterialIcon name="menu_book" size="sm" />
              <span className="hidden sm:inline">SOP</span>
            </TabsTrigger>
          )}
          {isAdmin && (
            <TabsTrigger value="settings" className="flex items-center gap-2">
              <MaterialIcon name="settings" size="sm" />
              <span className="hidden sm:inline">Settings</span>
            </TabsTrigger>
          )}
        </TabsList>

        {/* Dashboard Tab */}
        <TabsContent value="dashboard">
          <ClaimsDashboard onNavigateToList={handleNavigateToList} />
        </TabsContent>

        {/* Claims List Tab */}
        <TabsContent value="list">
          {/* Filters */}
          <Card className="mb-6">
            <CardContent className="p-4">
              <div className="grid grid-cols-2 gap-3 md:flex md:flex-row md:flex-wrap md:items-center">
                <div className="relative col-span-2 md:flex-1 md:min-w-[260px]">
                  <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search claims..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
                <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ClaimStatus | 'all')}>
                  <SelectTrigger className="w-full md:w-[180px]">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {Object.entries(CLAIM_STATUS_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as ClaimType | 'all')}>
                  <SelectTrigger className="w-full md:w-[180px]">
                    <SelectValue placeholder="Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {Object.entries(CLAIM_TYPE_LABELS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  className="col-span-2 md:col-span-auto w-full md:w-auto justify-center"
                  onClick={() => refetch()}
                >
                  <MaterialIcon name="refresh" size="sm" className="mr-2 md:mr-0" />
                  <span className="md:hidden">Refresh</span>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Claims List */}
          <Card>
            <CardContent className="p-0">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <MaterialIcon name="progress_activity" size="xl" className="animate-spin text-muted-foreground" />
                </div>
              ) : filteredClaims.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  No claims found
                </div>
              ) : isMobile ? (
                <div className="divide-y divide-border">
                  {filteredClaims.map((claim) => (
                    <MobileDataCard
                      key={claim.id}
                      onClick={() => handleRowClick(claim.id)}
                    >
                      <MobileDataCardHeader>
                        <MobileDataCardTitle>{claim.claim_number}</MobileDataCardTitle>
                        <div className="flex items-center gap-2">
                          {getStatusBadge(claim.status)}
                          <SLABadge status={claim.sla_status as SLAStatus} />
                        </div>
                      </MobileDataCardHeader>
                      <MobileDataCardDescription>{claim.description}</MobileDataCardDescription>
                      <MobileDataCardContent>
                        <div className="grid grid-cols-2 gap-2 text-muted-foreground">
                          <div><span className="font-medium">Type:</span> {CLAIM_TYPE_LABELS[claim.claim_type as ClaimType] || claim.claim_type}</div>
                          <div><span className="font-medium">Account:</span> {claim.account?.account_name || '-'}</div>
                          <div><span className="font-medium">Item:</span> {claim.item?.item_code || '-'}</div>
                          <div><span className="font-medium">Amount:</span> {claim.approved_payout_amount ? `$${claim.approved_payout_amount.toFixed(2)}` : '-'}</div>
                          <div><span className="font-medium">Filed:</span> {claim.created_at ? format(new Date(claim.created_at), 'MMM d, yyyy') : '-'}</div>
                        </div>
                      </MobileDataCardContent>
                    </MobileDataCard>
                  ))}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Claim #</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead>Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>SLA</TableHead>
                      <TableHead>Filed</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredClaims.map((claim) => (
                      <TableRow
                        key={claim.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleRowClick(claim.id)}
                      >
                        <TableCell className="font-mono">{claim.claim_number}</TableCell>
                        <TableCell>{CLAIM_TYPE_LABELS[claim.claim_type as ClaimType] || claim.claim_type}</TableCell>
                        <TableCell>{claim.account?.account_name || '-'}</TableCell>
                        <TableCell className="font-mono">{claim.item?.item_code || '-'}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{claim.description}</TableCell>
                        <TableCell>{claim.approved_payout_amount ? `$${claim.approved_payout_amount.toFixed(2)}` : '-'}</TableCell>
                        <TableCell>{getStatusBadge(claim.status)}</TableCell>
                        <TableCell>
                          <SLABadge status={claim.sla_status as SLAStatus} />
                        </TableCell>
                        <TableCell>{claim.created_at ? format(new Date(claim.created_at), 'MMM d, yyyy') : '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* SOP Tab (Admin Only) */}
        {isAdmin && (
          <TabsContent value="sop">
            <ClaimsSOP />
          </TabsContent>
        )}

        {/* Settings Tab (Admin Only) */}
        {isAdmin && (
          <TabsContent value="settings">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <MaterialIcon name="settings" size="lg" className="text-primary" />
                  <div>
                    <h3 className="text-lg font-semibold">Claims Settings</h3>
                    <p className="text-sm text-muted-foreground">
                      Configure claims processing, SLA timers, and templates
                    </p>
                  </div>
                </div>
                <Button onClick={() => navigate('/settings?tab=claims')}>
                  <MaterialIcon name="open_in_new" size="sm" className="mr-2" />
                  Open Claims Settings
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Create Claim Dialog */}
      <ClaimCreateDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />
    </DashboardLayout>
  );
}
