import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useQuickBooks, SyncLogEntry } from '@/hooks/useQuickBooks';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow, format } from 'date-fns';

export function IntegrationsSettingsTab() {
  const {
    connectionStatus,
    isConnected,
    loading,
    error,
    checkConnection,
    connect,
    disconnect,
    fetchSyncHistory,
  } = useQuickBooks();

  const { toast } = useToast();
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [syncHistory, setSyncHistory] = useState<SyncLogEntry[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Fetch sync history when connected
  useEffect(() => {
    if (isConnected) {
      loadSyncHistory();
    }
  }, [isConnected]);

  const loadSyncHistory = async () => {
    setLoadingHistory(true);
    try {
      const history = await fetchSyncHistory({ limit: 10 });
      setSyncHistory(history);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const authUrl = await connect();
      if (authUrl) {
        // Open QuickBooks OAuth in a popup
        window.open(authUrl, 'qbo-oauth', 'width=600,height=700');
        toast({
          title: 'QuickBooks Authorization',
          description: 'Please complete the authorization in the popup window.',
        });
      }
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const success = await disconnect();
      if (success) {
        setSyncHistory([]);
        toast({
          title: 'Disconnected',
          description: 'QuickBooks has been disconnected successfully.',
        });
      } else {
        toast({
          title: 'Error',
          description: 'Failed to disconnect from QuickBooks.',
          variant: 'destructive',
        });
      }
    } finally {
      setDisconnecting(false);
    }
  };

  const handleRefreshStatus = async () => {
    await checkConnection();
    if (isConnected) {
      await loadSyncHistory();
    }
    toast({
      title: 'Status Refreshed',
      description: 'Connection status has been updated.',
    });
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="power" size="md" />
            Integrations
          </CardTitle>
          <CardDescription>Loading integration settings...</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* QuickBooks Online Integration */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MaterialIcon name="apartment" size="md" />
                QuickBooks Online
              </CardTitle>
              <CardDescription>
                Push billing reports to QuickBooks Online as invoices
              </CardDescription>
            </div>
            <Button variant="ghost" size="icon" onClick={handleRefreshStatus}>
              <MaterialIcon name="refresh" size="sm" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Connection Status */}
          <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/30">
            <div className="flex items-center gap-3">
              {isConnected ? (
                <MaterialIcon name="check_circle" size="lg" className="text-green-500" />
              ) : connectionStatus?.refreshTokenExpired ? (
                <MaterialIcon name="warning" size="lg" className="text-amber-500" />
              ) : (
                <MaterialIcon name="cancel" size="lg" className="text-muted-foreground" />
              )}
              <div>
                <div className="font-medium">
                  {isConnected
                    ? connectionStatus?.companyName || 'Connected'
                    : connectionStatus?.refreshTokenExpired
                    ? 'Connection Expired'
                    : 'Not Connected'}
                </div>
                <div className="text-sm text-muted-foreground">
                  {isConnected && connectionStatus?.connectedAt
                    ? `Connected ${formatDistanceToNow(new Date(connectionStatus.connectedAt), { addSuffix: true })}`
                    : connectionStatus?.refreshTokenExpired
                    ? 'Please reconnect to continue syncing'
                    : 'Connect to push invoices to QuickBooks'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isConnected ? (
                <>
                  {connectionStatus?.tokenExpiresSoon && (
                    <Badge variant="outline" className="text-amber-600 border-amber-300">
                      Token expiring soon
                    </Badge>
                  )}
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" disabled={disconnecting}>
                        {disconnecting ? (
                          <>
                            <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                            Disconnecting...
                          </>
                        ) : (
                          'Disconnect'
                        )}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Disconnect QuickBooks?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will remove the connection to QuickBooks Online. You'll need to
                          reconnect and remap your accounts and services to continue syncing
                          invoices.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDisconnect}>
                          Disconnect
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </>
              ) : (
                <Button onClick={handleConnect} disabled={connecting}>
                  {connecting ? (
                    <>
                      <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                      Connecting...
                    </>
                  ) : (
                    <>
                      <MaterialIcon name="open_in_new" size="sm" className="mr-2" />
                      Connect to QuickBooks
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>

          {/* Connection Details */}
          {isConnected && connectionStatus && (
            <>
              <Separator />
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Company ID</div>
                  <div className="font-mono text-sm">{connectionStatus.realmId}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-muted-foreground">Last Sync</div>
                  <div className="text-sm">
                    {connectionStatus.lastSyncAt
                      ? formatDistanceToNow(new Date(connectionStatus.lastSyncAt), {
                          addSuffix: true,
                        })
                      : 'Never'}
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Error Display */}
          {error && (
            <div className="p-3 border border-destructive/50 bg-destructive/10 rounded-lg text-destructive text-sm">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Sync History */}
      {isConnected && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="history" size="md" />
              Sync History
            </CardTitle>
            <CardDescription>
              Recent invoice syncs to QuickBooks Online
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingHistory ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : syncHistory.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No sync history yet. Push a billing report to QuickBooks to see it here.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Period</TableHead>
                    <TableHead>Invoice #</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Synced</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {syncHistory.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-medium">
                        {entry.account_name || 'Unknown Account'}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {entry.period_start && entry.period_end
                          ? `${format(new Date(entry.period_start), 'MM/dd')} - ${format(
                              new Date(entry.period_end),
                              'MM/dd/yy'
                            )}`
                          : '-'}
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {entry.qbo_invoice_number || '-'}
                      </TableCell>
                      <TableCell className="text-right">
                        {entry.total_amount != null
                          ? `$${entry.total_amount.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                            })}`
                          : '-'}
                      </TableCell>
                      <TableCell>
                        {entry.status === 'success' ? (
                          <Badge variant="outline" className="text-green-600 border-green-300">
                            Success
                          </Badge>
                        ) : entry.status === 'failed' ? (
                          <Badge variant="destructive">Failed</Badge>
                        ) : (
                          <Badge variant="secondary">{entry.status}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {entry.synced_at
                          ? formatDistanceToNow(new Date(entry.synced_at), { addSuffix: true })
                          : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* Help Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">About QuickBooks Integration</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            The QuickBooks Online integration allows you to push billing reports directly to your
            QuickBooks account as invoices.
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>One invoice is created per account in the billing report</li>
            <li>
              Stride accounts are automatically mapped to QuickBooks customers (created if they
              don't exist)
            </li>
            <li>Service types are mapped to QuickBooks items/products</li>
            <li>All syncs are logged for auditing purposes</li>
          </ul>
          <p className="pt-2">
            <strong>Note:</strong> This is a one-way sync from Stride to QuickBooks. Changes made in
            QuickBooks will not be reflected back in Stride.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
