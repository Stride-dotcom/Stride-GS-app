import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useRepairQuoteWorkflow,
  RepairQuoteWorkflow,
} from '@/hooks/useRepairQuotes';
import { useTechnicians } from '@/hooks/useTechnicians';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  MobileDataCard,
  MobileDataCardHeader,
  MobileDataCardTitle,
  MobileDataCardDescription,
  MobileDataCardContent,
  MobileDataCardActions,
} from '@/components/ui/mobile-data-card';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

export function RepairQuotesContent() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { toast } = useToast();

  const {
    quotes,
    loading,
    refetch,
    assignTechnician,
    sendToTechnician,
    sendToClient,
    reviewQuote,
    closeQuote,
    getStatusInfo,
  } = useRepairQuoteWorkflow();

  const { activeTechnicians } = useTechnicians();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');

  // Filter quotes
  const filteredQuotes = quotes.filter(quote => {
    const matchesSearch =
      quote.technician?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      quote.account?.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      quote.id.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = statusFilter === 'all' || quote.status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  // Group quotes by status for tabs
  const pendingActionQuotes = quotes.filter(q =>
    ['awaiting_assignment', 'tech_submitted', 'tech_declined'].includes(q.status || '')
  );
  const activeQuotes = quotes.filter(q =>
    ['sent_to_tech', 'under_review', 'sent_to_client'].includes(q.status || '')
  );
  const completedQuotes = quotes.filter(q =>
    ['accepted', 'declined', 'expired', 'closed'].includes(q.status || '')
  );

  const handleViewQuote = (quote: RepairQuoteWorkflow) => {
    navigate(`/repair-quotes/${quote.id}`);
  };

  const handleSendToTech = async (quote: RepairQuoteWorkflow) => {
    const token = await sendToTechnician(quote.id);
    if (token) {
      const link = `${window.location.origin}/quote/tech?token=${token}`;
      await navigator.clipboard.writeText(link);
      toast({
        title: 'Link Copied',
        description: 'Quote link copied to clipboard. Send this to the technician.',
      });
    }
  };

  const handleSendToClient = async (quote: RepairQuoteWorkflow) => {
    const token = await sendToClient(quote.id);
    if (token) {
      const link = `${window.location.origin}/quote/review?token=${token}`;
      await navigator.clipboard.writeText(link);
      toast({
        title: 'Link Copied',
        description: 'Quote link copied to clipboard. Send this to the client.',
      });
    }
  };

  const handleAssignTechnician = async (quoteId: string, techId: string) => {
    await assignTechnician(quoteId, techId);
  };

  const formatCurrency = (amount: number | null) => {
    if (amount === null || amount === undefined) return '-';
    return `$${amount.toFixed(2)}`;
  };

  const renderQuoteRow = (quote: RepairQuoteWorkflow) => {
    const statusInfo = getStatusInfo(quote.status || 'draft');

    return (
      <TableRow
        key={quote.id}
        className="cursor-pointer hover:bg-muted/50"
        onClick={() => handleViewQuote(quote)}
      >
        <TableCell>
          <div className="space-y-1">
            <div className="font-medium">
              {quote.account?.name || 'No Account'}
            </div>
            {quote.sidemark && (
              <div className="text-xs text-muted-foreground">
                {quote.sidemark.name}
              </div>
            )}
          </div>
        </TableCell>
        <TableCell>
          {quote.technician ? (
            <div className="flex items-center gap-2">
              <MaterialIcon name="person" size="sm" className="text-muted-foreground" />
              <span>{quote.technician.name}</span>
            </div>
          ) : (
            <Select
              value=""
              onValueChange={(value) => handleAssignTechnician(quote.id, value)}
            >
              <SelectTrigger
                className="w-40"
                onClick={(e) => e.stopPropagation()}
              >
                <SelectValue placeholder="Assign tech..." />
              </SelectTrigger>
              <SelectContent>
                {activeTechnicians.map((tech) => (
                  <SelectItem key={tech.id} value={tech.id}>
                    {tech.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </TableCell>
        <TableCell>
          <Badge className={statusInfo.color}>
            {statusInfo.label}
          </Badge>
        </TableCell>
        <TableCell className="text-right">
          {formatCurrency(quote.tech_total)}
        </TableCell>
        <TableCell className="text-right font-medium">
          {formatCurrency(quote.customer_total)}
        </TableCell>
        <TableCell>
          {quote.expires_at && (
            <div className="flex items-center gap-1 text-sm text-muted-foreground">
              <MaterialIcon name="schedule" size="sm" />
              {format(new Date(quote.expires_at), 'MMM d')}
            </div>
          )}
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MaterialIcon name="more_horiz" size="sm" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleViewQuote(quote)}>
                <MaterialIcon name="visibility" size="sm" className="mr-2" />
                View Details
              </DropdownMenuItem>
              {quote.technician && !['sent_to_tech', 'tech_submitted'].includes(quote.status || '') && (
                <DropdownMenuItem onClick={() => handleSendToTech(quote)}>
                  <MaterialIcon name="send" size="sm" className="mr-2" />
                  Send to Technician
                </DropdownMenuItem>
              )}
              {quote.status === 'tech_submitted' && (
                <DropdownMenuItem onClick={() => reviewQuote(quote.id)}>
                  <MaterialIcon name="description" size="sm" className="mr-2" />
                  Mark Under Review
                </DropdownMenuItem>
              )}
              {['tech_submitted', 'under_review'].includes(quote.status || '') && quote.customer_total && (
                <DropdownMenuItem onClick={() => handleSendToClient(quote)}>
                  <MaterialIcon name="open_in_new" size="sm" className="mr-2" />
                  Send to Client
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => closeQuote(quote.id)}
              >
                <MaterialIcon name="close" size="sm" className="mr-2" />
                Close Quote
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
    );
  };

  const renderMobileCard = (quote: RepairQuoteWorkflow) => {
    const statusInfo = getStatusInfo(quote.status || 'draft');

    return (
      <MobileDataCard
        key={quote.id}
        onClick={() => handleViewQuote(quote)}
      >
        <MobileDataCardHeader>
          <div>
            <MobileDataCardTitle>
              {quote.account?.name || 'No Account'}
            </MobileDataCardTitle>
            <MobileDataCardDescription>
              {quote.technician?.name || 'No technician assigned'}
            </MobileDataCardDescription>
          </div>
          <Badge className={statusInfo.color}>
            {statusInfo.label}
          </Badge>
        </MobileDataCardHeader>
        <MobileDataCardContent>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Tech Quote:</span>
            <span>{formatCurrency(quote.tech_total)}</span>
          </div>
          <div className="flex justify-between text-sm font-medium">
            <span className="text-muted-foreground">Customer Total:</span>
            <span className="text-primary">{formatCurrency(quote.customer_total)}</span>
          </div>
        </MobileDataCardContent>
        <MobileDataCardActions>
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              handleViewQuote(quote);
            }}
          >
            <MaterialIcon name="more_horiz" size="sm" />
          </Button>
        </MobileDataCardActions>
      </MobileDataCard>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button onClick={refetch} variant="outline">
          <MaterialIcon name="refresh" size="sm" className="mr-2" />
          Refresh
        </Button>
      </div>

      <Tabs defaultValue="pending" className="space-y-4">
        <TabsList>
          <TabsTrigger value="pending" className="gap-2">
            Needs Action
            {pendingActionQuotes.length > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 w-5 p-0 justify-center">
                {pendingActionQuotes.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="active">
            Active ({activeQuotes.length})
          </TabsTrigger>
          <TabsTrigger value="completed">
            Completed ({completedQuotes.length})
          </TabsTrigger>
          <TabsTrigger value="all">
            All ({quotes.length})
          </TabsTrigger>
        </TabsList>

        {/* Search and Filters */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="relative flex-1">
                <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search quotes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="awaiting_assignment">Awaiting Assignment</SelectItem>
                  <SelectItem value="sent_to_tech">Sent to Tech</SelectItem>
                  <SelectItem value="tech_submitted">Tech Submitted</SelectItem>
                  <SelectItem value="tech_declined">Tech Declined</SelectItem>
                  <SelectItem value="under_review">Under Review</SelectItem>
                  <SelectItem value="sent_to_client">Sent to Client</SelectItem>
                  <SelectItem value="accepted">Accepted</SelectItem>
                  <SelectItem value="declined">Declined</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
        </Card>

        {/* Pending Action Tab */}
        <TabsContent value="pending" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MaterialIcon name="build" size="md" />
                Quotes Needing Action
              </CardTitle>
              <CardDescription>
                Quotes awaiting assignment, review, or response
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
                </div>
              ) : pendingActionQuotes.length === 0 ? (
                <div className="text-center py-12">
                  <MaterialIcon name="check_circle" size="xl" className="mx-auto text-green-500" />
                  <h3 className="mt-4 text-lg font-semibold">All Caught Up</h3>
                  <p className="text-muted-foreground">No quotes need attention right now</p>
                </div>
              ) : isMobile ? (
                <div className="space-y-3">
                  {pendingActionQuotes.map(renderMobileCard)}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead>Technician</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Tech Quote</TableHead>
                      <TableHead className="text-right">Customer Total</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pendingActionQuotes.map(renderQuoteRow)}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Active Tab */}
        <TabsContent value="active" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Active Quotes</CardTitle>
              <CardDescription>Quotes in progress</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
                </div>
              ) : activeQuotes.length === 0 ? (
                <div className="text-center py-12">
                  <MaterialIcon name="build" size="xl" className="mx-auto text-muted-foreground" />
                  <h3 className="mt-4 text-lg font-semibold">No Active Quotes</h3>
                  <p className="text-muted-foreground">No quotes currently in progress</p>
                </div>
              ) : isMobile ? (
                <div className="space-y-3">
                  {activeQuotes.map(renderMobileCard)}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead>Technician</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Tech Quote</TableHead>
                      <TableHead className="text-right">Customer Total</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {activeQuotes.map(renderQuoteRow)}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Completed Tab */}
        <TabsContent value="completed" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Completed Quotes</CardTitle>
              <CardDescription>Accepted, declined, expired, or closed quotes</CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
                </div>
              ) : completedQuotes.length === 0 ? (
                <div className="text-center py-12">
                  <MaterialIcon name="description" size="xl" className="mx-auto text-muted-foreground" />
                  <h3 className="mt-4 text-lg font-semibold">No Completed Quotes</h3>
                  <p className="text-muted-foreground">Completed quotes will appear here</p>
                </div>
              ) : isMobile ? (
                <div className="space-y-3">
                  {completedQuotes.map(renderMobileCard)}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead>Technician</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Tech Quote</TableHead>
                      <TableHead className="text-right">Customer Total</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {completedQuotes.map(renderQuoteRow)}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* All Quotes Tab */}
        <TabsContent value="all" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>All Quotes</CardTitle>
              <CardDescription>
                {filteredQuotes.length} quote{filteredQuotes.length !== 1 ? 's' : ''}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
                </div>
              ) : filteredQuotes.length === 0 ? (
                <div className="text-center py-12">
                  <MaterialIcon name="build" size="xl" className="mx-auto text-muted-foreground" />
                  <h3 className="mt-4 text-lg font-semibold">No Quotes Found</h3>
                  <p className="text-muted-foreground">
                    {searchQuery || statusFilter !== 'all'
                      ? 'Try adjusting your search or filters'
                      : 'Create a quote from a task to get started'}
                  </p>
                </div>
              ) : isMobile ? (
                <div className="space-y-3">
                  {filteredQuotes.map(renderMobileCard)}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead>Technician</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Tech Quote</TableHead>
                      <TableHead className="text-right">Customer Total</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredQuotes.map(renderQuoteRow)}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
