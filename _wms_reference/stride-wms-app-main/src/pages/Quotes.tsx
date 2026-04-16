import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useQuotes } from '@/hooks/useQuotes';
import { useAccounts } from '@/hooks/useAccounts';
import { Quote, QuoteStatus, QUOTE_STATUS_CONFIG } from '@/lib/quotes/types';
import { formatCurrency } from '@/lib/quotes/calculator';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { RepairQuotesTab } from '@/components/repair-quotes/RepairQuotesTab';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { cn } from '@/lib/utils';

export default function Quotes() {
  const navigate = useNavigate();
  const { quotes, loading, fetchQuotes, voidQuote, duplicateQuote } = useQuotes();
  const { accounts } = useAccounts();

  // Tab navigation
  const [activeTab, setActiveTab] = useState<'quotes' | 'repair-quotes'>('quotes');

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [accountFilter, setAccountFilter] = useState<string>('all');

  // Dialogs
  const [voidDialogOpen, setVoidDialogOpen] = useState(false);
  const [voidQuoteId, setVoidQuoteId] = useState<string | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [duplicateDialogOpen, setDuplicateDialogOpen] = useState(false);
  const [duplicateQuoteId, setDuplicateQuoteId] = useState<string | null>(null);
  const [duplicateAccountId, setDuplicateAccountId] = useState<string>('');

  useEffect(() => {
    fetchQuotes();
  }, [fetchQuotes]);

  // Filter quotes
  const filteredQuotes = useMemo(() => {
    return quotes.filter((quote) => {
      // Search filter
      if (searchTerm) {
        const search = searchTerm.toLowerCase();
        const matchesSearch =
          quote.quote_number.toLowerCase().includes(search) ||
          quote.account?.account_name?.toLowerCase().includes(search) ||
          quote.notes?.toLowerCase().includes(search);
        if (!matchesSearch) return false;
      }

      // Status filter
      if (statusFilter !== 'all' && quote.status !== statusFilter) {
        return false;
      }

      // Account filter
      if (accountFilter !== 'all' && quote.account_id !== accountFilter) {
        return false;
      }

      return true;
    });
  }, [quotes, searchTerm, statusFilter, accountFilter]);

  // Summary stats
  const stats = useMemo(() => {
    const draft = quotes.filter((q) => q.status === 'draft').length;
    const sent = quotes.filter((q) => q.status === 'sent').length;
    const accepted = quotes.filter((q) => q.status === 'accepted').length;
    const totalValue = quotes
      .filter((q) => q.status === 'accepted')
      .reduce((sum, q) => sum + (q.grand_total || 0), 0);
    return { draft, sent, accepted, totalValue };
  }, [quotes]);

  const handleVoid = async () => {
    if (!voidQuoteId || !voidReason.trim()) return;
    await voidQuote(voidQuoteId, voidReason);
    setVoidDialogOpen(false);
    setVoidQuoteId(null);
    setVoidReason('');
    fetchQuotes();
  };

  const handleDuplicate = async () => {
    if (!duplicateQuoteId) return;
    const newQuote = await duplicateQuote(duplicateQuoteId, duplicateAccountId || undefined);
    setDuplicateDialogOpen(false);
    setDuplicateQuoteId(null);
    setDuplicateAccountId('');
    if (newQuote) {
      navigate(`/quotes/${newQuote.id}`);
    }
  };

  const getStatusBadge = (status: QuoteStatus) => {
    const config = QUOTE_STATUS_CONFIG[status];
    return <StatusIndicator status={status} label={config.label} size="sm" />;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageHeader
          primaryText="Quote"
          accentText="Management"
          description="Create, manage, and track customer quotes"
        />

        {/* Tab Navigation */}
        <div className="flex gap-1 border-b mb-6">
          <button
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              activeTab === 'quotes'
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setActiveTab('quotes')}
          >
            Quotes
          </button>
          <button
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              activeTab === 'repair-quotes'
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
            onClick={() => setActiveTab('repair-quotes')}
          >
            Repair Quotes
          </button>
        </div>

        {activeTab === 'quotes' && (<>
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-card border border-border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Draft Quotes</CardTitle>
              <span className="text-xl opacity-50">📝</span>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.draft}</div>
            </CardContent>
          </Card>
          <Card className="bg-card border border-border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Sent Quotes</CardTitle>
              <span className="text-xl opacity-50">➡️</span>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.sent}</div>
            </CardContent>
          </Card>
          <Card className="bg-card border border-border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Accepted</CardTitle>
              <span className="text-xl opacity-50">✅</span>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.accepted}</div>
            </CardContent>
          </Card>
          <Card className="bg-card border border-border shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Accepted Value</CardTitle>
              <span className="text-xl opacity-50">💲</span>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{formatCurrency(stats.totalValue)}</div>
            </CardContent>
          </Card>
        </div>

        {/* Filters and Actions */}
        <Card>
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 gap-3 md:flex md:flex-row md:flex-wrap md:items-center md:justify-between">
              <div className="relative col-span-2 md:flex-1 md:min-w-[260px]">
                  <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search quotes..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                  />
              </div>

              <div className="col-span-1 md:col-span-auto">
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-full md:w-[150px]">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="sent">Sent</SelectItem>
                    <SelectItem value="accepted">Accepted</SelectItem>
                    <SelectItem value="declined">Declined</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                    <SelectItem value="void">Void</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-1 md:col-span-auto">
                <Select value={accountFilter} onValueChange={setAccountFilter}>
                  <SelectTrigger className="w-full md:w-[220px]">
                    <SelectValue placeholder="Account" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Accounts</SelectItem>
                    {accounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.account_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="col-span-2 md:col-span-auto md:ml-auto">
                <div className="grid grid-cols-2 gap-2 md:flex md:gap-2">
                  <Button variant="outline" size="sm" className="w-full justify-center" onClick={() => fetchQuotes()}>
                  <MaterialIcon name="refresh" size="sm" className="mr-2" />
                  Refresh
                </Button>
                  <Button onClick={() => navigate('/quotes/new')} className="w-full justify-center">
                  <MaterialIcon name="add" size="sm" className="mr-2" />
                  New Quote
                </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quotes Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="table_chart" size="md" />
              Quotes ({filteredQuotes.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <MaterialIcon name="progress_activity" size="xl" className="animate-spin text-muted-foreground" />
              </div>
            ) : filteredQuotes.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                {quotes.length === 0
                  ? 'No quotes yet. Create your first quote!'
                  : 'No quotes match your filters.'}
              </div>
            ) : (
              <ScrollArea className="h-[500px]">
                <div className="border rounded-lg overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-muted sticky top-0">
                      <tr>
                        <th className="text-left p-3 border-b font-medium">Quote #</th>
                        <th className="text-left p-3 border-b font-medium">Account</th>
                        <th className="text-left p-3 border-b font-medium">Status</th>
                        <th className="text-right p-3 border-b font-medium">Total</th>
                        <th className="text-left p-3 border-b font-medium">Expires</th>
                        <th className="text-left p-3 border-b font-medium">Created</th>
                        <th className="w-16 p-3 border-b"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredQuotes.map((quote) => (
                        <tr
                          key={quote.id}
                          className="border-b hover:bg-muted/50 cursor-pointer"
                          onClick={() => navigate(`/quotes/${quote.id}`)}
                        >
                          <td className="p-3 font-mono font-medium">{quote.quote_number}</td>
                          <td className="p-3">
                            <div className="flex items-center gap-2">
                              <MaterialIcon name="business" size="sm" className="text-muted-foreground" />
                              {quote.account?.account_name || '-'}
                            </div>
                          </td>
                          <td className="p-3">{getStatusBadge(quote.status)}</td>
                          <td className="p-3 text-right font-semibold">
                            {formatCurrency(quote.grand_total || 0, quote.currency)}
                          </td>
                          <td className="p-3">
                            {quote.expiration_date ? (
                              <div className="flex items-center gap-1 text-muted-foreground">
                                <MaterialIcon name="calendar_today" size="sm" />
                                {new Date(quote.expiration_date).toLocaleDateString()}
                              </div>
                            ) : (
                              '-'
                            )}
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {new Date(quote.created_at).toLocaleDateString()}
                          </td>
                          <td className="p-3" onClick={(e) => e.stopPropagation()}>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon">
                                  <MaterialIcon name="more_vert" size="sm" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => navigate(`/quotes/${quote.id}`)}>
                                  <MaterialIcon name="visibility" size="sm" className="mr-2" />
                                  View
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  onClick={() => {
                                    setDuplicateQuoteId(quote.id);
                                    setDuplicateAccountId(quote.account_id);
                                    setDuplicateDialogOpen(true);
                                  }}
                                >
                                  <MaterialIcon name="content_copy" size="sm" className="mr-2" />
                                  Duplicate
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => {
                                    setVoidQuoteId(quote.id);
                                    setVoidDialogOpen(true);
                                  }}
                                  className="text-destructive"
                                >
                                  <MaterialIcon name="delete" size="sm" className="mr-2" />
                                  Void
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
        </>)}

        {activeTab === 'repair-quotes' && (
          <RepairQuotesTab />
        )}
      </div>

      {/* Void Dialog */}
      <Dialog open={voidDialogOpen} onOpenChange={setVoidDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void Quote</DialogTitle>
            <DialogDescription>
              This action cannot be undone. Please provide a reason for voiding this quote.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="void-reason">Reason *</Label>
              <Textarea
                id="void-reason"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Enter reason for voiding..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVoidDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleVoid} disabled={!voidReason.trim()}>
              Void Quote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate Dialog */}
      <Dialog open={duplicateDialogOpen} onOpenChange={(open) => { setDuplicateDialogOpen(open); if (!open) { setDuplicateAccountId(''); setDuplicateQuoteId(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Duplicate Quote</DialogTitle>
            <DialogDescription>
              Create a copy of this quote. You can optionally select a different account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="duplicate-account">Account</Label>
              <Select value={duplicateAccountId} onValueChange={setDuplicateAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="Keep same account" />
                </SelectTrigger>
                <SelectContent>
                  {accounts.map((account) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.account_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleDuplicate}>
              <MaterialIcon name="content_copy" size="sm" className="mr-2" />
              Duplicate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
