import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useQuickBooks, BillingEventForSync, SyncResult } from '@/hooks/useQuickBooks';
import { useToast } from '@/hooks/use-toast';
import { Link } from 'react-router-dom';

interface PushToQuickBooksButtonProps {
  billingEvents: BillingEventForSync[];
  periodStart: string;
  periodEnd: string;
  disabled?: boolean;
  onSyncComplete?: (results: SyncResult[]) => void;
}

export function PushToQuickBooksButton({
  billingEvents,
  periodStart,
  periodEnd,
  disabled,
  onSyncComplete,
}: PushToQuickBooksButtonProps) {
  const { isConnected, connectionStatus, syncToQuickBooks, syncing } = useQuickBooks();
  const { toast } = useToast();
  const [showResultsDialog, setShowResultsDialog] = useState(false);
  const [syncResults, setSyncResults] = useState<SyncResult[]>([]);
  const [syncSummary, setSyncSummary] = useState<{
    totalAccounts: number;
    successCount: number;
    failedCount: number;
    totalInvoiced: number;
  } | null>(null);

  const handlePushToQuickBooks = async () => {
    if (!isConnected) {
      toast({
        title: 'QuickBooks Not Connected',
        description: 'Please connect to QuickBooks in Settings > Integrations first.',
        variant: 'destructive',
      });
      return;
    }

    if (billingEvents.length === 0) {
      toast({
        title: 'No Billing Events',
        description: 'There are no billing events to push to QuickBooks.',
        variant: 'destructive',
      });
      return;
    }

    const response = await syncToQuickBooks(billingEvents, periodStart, periodEnd);

    if (response.error) {
      toast({
        title: 'Sync Failed',
        description: response.error,
        variant: 'destructive',
      });
      return;
    }

    setSyncResults(response.results);
    setSyncSummary(response.summary);
    setShowResultsDialog(true);

    if (response.summary.failedCount === 0) {
      toast({
        title: 'Sync Complete',
        description: `Successfully created ${response.summary.successCount} invoice${
          response.summary.successCount !== 1 ? 's' : ''
        } in QuickBooks.`,
      });
    } else if (response.summary.successCount > 0) {
      toast({
        title: 'Sync Partially Complete',
        description: `Created ${response.summary.successCount} invoice${
          response.summary.successCount !== 1 ? 's' : ''
        }, ${response.summary.failedCount} failed.`,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Sync Failed',
        description: 'Failed to create any invoices in QuickBooks.',
        variant: 'destructive',
      });
    }

    onSyncComplete?.(response.results);
  };

  // Count unique accounts
  const uniqueAccounts = new Set(billingEvents.map((e) => e.account_id)).size;

  // Not connected state
  if (!isConnected) {
    return (
      <Button variant="outline" disabled>
        <MaterialIcon name="business" size="sm" className="mr-2" />
        QuickBooks Not Connected
      </Button>
    );
  }

  // Token expiring soon warning
  if (connectionStatus?.tokenExpiresSoon) {
    return (
      <Button
        variant="outline"
        onClick={handlePushToQuickBooks}
        disabled={disabled || syncing || billingEvents.length === 0}
      >
        {syncing ? (
          <>
            <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
            Syncing...
          </>
        ) : (
          <>
            <MaterialIcon name="warning" size="sm" className="mr-2 text-amber-500" />
            Push to QuickBooks
          </>
        )}
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={handlePushToQuickBooks}
        disabled={disabled || syncing || billingEvents.length === 0}
      >
        {syncing ? (
          <>
            <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
            Pushing to QuickBooks...
          </>
        ) : (
          <>
            <MaterialIcon name="send" size="sm" className="mr-2" />
            Push to QuickBooks
            {billingEvents.length > 0 && (
              <Badge variant="secondary" className="ml-2">
                {uniqueAccounts} account{uniqueAccounts !== 1 ? 's' : ''}
              </Badge>
            )}
          </>
        )}
      </Button>

      {/* Results Dialog */}
      <Dialog open={showResultsDialog} onOpenChange={setShowResultsDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="business" size="md" />
              QuickBooks Sync Results
            </DialogTitle>
            <DialogDescription>
              {syncSummary && (
                <span>
                  {syncSummary.successCount} of {syncSummary.totalAccounts} invoice
                  {syncSummary.totalAccounts !== 1 ? 's' : ''} created successfully
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="max-h-[400px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead>Invoice #</TableHead>
                  <TableHead className="text-right">Lines</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {syncResults.map((result, index) => (
                  <TableRow key={result.accountId || index}>
                    <TableCell className="font-medium">{result.accountName}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {result.qboInvoiceNumber || '-'}
                    </TableCell>
                    <TableCell className="text-right">{result.lineCount}</TableCell>
                    <TableCell className="text-right">
                      ${result.total.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell>
                      {result.success ? (
                        <div className="flex items-center gap-1 text-green-600">
                          <MaterialIcon name="check_circle" size="sm" />
                          <span className="text-sm">Created</span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-destructive">
                          <MaterialIcon name="cancel" size="sm" />
                          <span className="text-sm" title={result.error}>
                            Failed
                          </span>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>

          {syncSummary && syncSummary.failedCount > 0 && (
            <div className="p-3 border border-amber-200 bg-amber-50 rounded-lg text-sm text-amber-800 dark:bg-amber-950 dark:border-amber-800 dark:text-amber-200">
              <strong>Note:</strong> Some invoices failed to sync. Check the error details and try
              again, or manually create these invoices in QuickBooks.
            </div>
          )}

          {syncSummary && syncSummary.successCount > 0 && (
            <div className="p-3 border rounded-lg bg-muted/30 text-sm">
              <strong>Total Invoiced:</strong> $
              {syncSummary.totalInvoiced.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowResultsDialog(false)}>
              Close
            </Button>
            <Button asChild>
              <Link to="/settings?tab=integrations">View Sync History</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
