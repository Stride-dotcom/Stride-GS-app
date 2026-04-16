import { Link } from 'react-router-dom';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { ClientPortalLayout } from '@/components/client-portal/ClientPortalLayout';
import {
  useClientPortalContext,
  useClientDashboardStats,
  useClientShipments,
  useClientQuotes,
} from '@/hooks/useClientPortal';
import { formatDistanceToNow, format } from 'date-fns';

export default function ClientDashboard() {
  const { portalUser, account, tenant, isLoading: contextLoading } = useClientPortalContext();
  const { data: stats, isLoading: statsLoading } = useClientDashboardStats();
  const { data: shipments = [], isLoading: shipmentsLoading } = useClientShipments();
  const { data: quotes = [], isLoading: quotesLoading } = useClientQuotes();

  const userName = portalUser?.first_name
    ? `${portalUser.first_name} ${portalUser.last_name || ''}`.trim()
    : portalUser?.email || 'User';

  const pendingQuotes = quotes.filter((q: any) => q.status === 'sent_to_client');
  const isLoading = contextLoading || statsLoading;

  if (contextLoading) {
    return (
      <ClientPortalLayout>
        <div className="flex items-center justify-center h-64">
          <MaterialIcon name="progress_activity" size="xl" className="animate-spin text-muted-foreground" />
        </div>
      </ClientPortalLayout>
    );
  }

  return (
    <ClientPortalLayout
      accountName={account?.name}
      warehouseName={tenant?.name}
      userName={userName}
    >
      <div className="space-y-6">
        {/* Welcome Header */}
        <div>
          <h1 className="text-2xl font-bold">
            Welcome back, {portalUser?.first_name || 'there'}
          </h1>
          <p className="text-muted-foreground">
            Here's an overview of your account at {tenant?.name || 'the warehouse'}.
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Items</CardTitle>
              <MaterialIcon name="inventory_2" size="sm" className="text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoading ? <MaterialIcon name="progress_activity" size="lg" className="animate-spin" /> : stats?.totalItems || 0}
              </div>
              <p className="text-xs text-muted-foreground">Items in your account</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">In Storage</CardTitle>
              <MaterialIcon name="archive" size="sm" className="text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoading ? <MaterialIcon name="progress_activity" size="lg" className="animate-spin" /> : stats?.inStorage || 0}
              </div>
              <p className="text-xs text-muted-foreground">Available items</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Pending Quotes</CardTitle>
              <MaterialIcon name="description" size="sm" className="text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoading ? (
                  <MaterialIcon name="progress_activity" size="lg" className="animate-spin" />
                ) : (
                  <span className={stats?.pendingQuotes ? 'text-amber-600' : ''}>
                    {stats?.pendingQuotes || 0}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">Awaiting your review</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Recent Shipments</CardTitle>
              <MaterialIcon name="local_shipping" size="sm" className="text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {isLoading ? (
                  <MaterialIcon name="progress_activity" size="lg" className="animate-spin" />
                ) : (
                  stats?.recentShipments || 0
                )}
              </div>
              <p className="text-xs text-muted-foreground">Last 30 days</p>
            </CardContent>
          </Card>
        </div>

        {/* Pending Quotes Alert */}
        {pendingQuotes.length > 0 && (
          <Card className="border-amber-200 bg-amber-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-amber-800">
                <MaterialIcon name="schedule" size="md" />
                {pendingQuotes.length} Quote{pendingQuotes.length !== 1 ? 's' : ''} Awaiting Your
                Response
              </CardTitle>
              <CardDescription className="text-amber-700">
                Please review and respond to the following repair quotes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {pendingQuotes.slice(0, 3).map((quote: any) => (
                  <div
                    key={quote.id}
                    className="flex items-center justify-between bg-white rounded-lg p-3 border border-amber-200"
                  >
                    <div>
                      <p className="font-medium">{quote.quote_number}</p>
                      <p className="text-sm text-muted-foreground">
                        {quote.repair_quote_items?.length || 0} item
                        {quote.repair_quote_items?.length !== 1 ? 's' : ''}
                        {quote.customer_total && (
                          <span className="ml-2 font-medium text-foreground">
                            ${Number(quote.customer_total).toFixed(2)}
                          </span>
                        )}
                      </p>
                    </div>
                    <Link to={`/client/quotes?id=${quote.id}`}>
                      <Button size="sm" variant="outline">
                        Review
                        <MaterialIcon name="arrow_forward" size="sm" className="ml-2" />
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>
              {pendingQuotes.length > 3 && (
                <Link to="/client/quotes" className="block mt-3">
                  <Button variant="link" className="px-0 text-amber-700">
                    View all {pendingQuotes.length} pending quotes
                    <MaterialIcon name="arrow_forward" size="sm" className="ml-1" />
                  </Button>
                </Link>
              )}
            </CardContent>
          </Card>
        )}

        {/* Recent Activity */}
        <div className="grid gap-6 md:grid-cols-2">
          {/* Recent Shipments */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Recent Shipments</CardTitle>
                <CardDescription>Your latest incoming and outgoing shipments</CardDescription>
              </div>
              <Link to="/client/shipments">
                <Button variant="ghost" size="sm">
                  View All
                  <MaterialIcon name="arrow_forward" size="sm" className="ml-1" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {shipmentsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
                </div>
              ) : shipments.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <MaterialIcon name="local_shipping" size="xl" className="mx-auto mb-2 opacity-50" />
                  <p>No recent shipments</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {shipments.slice(0, 5).map((shipment: any) => (
                    <div
                      key={shipment.id}
                      className="flex items-center justify-between py-2 border-b last:border-0"
                    >
                      <div>
                        <p className="font-medium">{shipment.shipment_number}</p>
                        <p className="text-sm text-muted-foreground">
                          {shipment.shipment_type === 'incoming' ? 'From' : 'To'}:{' '}
                          {shipment.shipment_type === 'incoming'
                            ? shipment.origin_name
                            : shipment.destination_name || 'TBD'}
                        </p>
                      </div>
                      <div className="text-right">
                        <StatusIndicator status={shipment.status || 'pending'} size="sm" />
                        <p className="text-xs text-muted-foreground mt-1">
                          {formatDistanceToNow(new Date(shipment.created_at), { addSuffix: true })}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Quotes */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Repair Quotes</CardTitle>
                <CardDescription>Recent quotes and their status</CardDescription>
              </div>
              <Link to="/client/quotes">
                <Button variant="ghost" size="sm">
                  View All
                  <MaterialIcon name="arrow_forward" size="sm" className="ml-1" />
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {quotesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
                </div>
              ) : quotes.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <MaterialIcon name="description" size="xl" className="mx-auto mb-2 opacity-50" />
                  <p>No quotes yet</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {quotes.slice(0, 5).map((quote: any) => (
                    <div
                      key={quote.id}
                      className="flex items-center justify-between py-2 border-b last:border-0"
                    >
                      <div>
                        <p className="font-medium">{quote.quote_number}</p>
                        <p className="text-sm text-muted-foreground">
                          {quote.repair_quote_items?.length || 0} item
                          {quote.repair_quote_items?.length !== 1 ? 's' : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <StatusIndicator
                          status={quote.status || 'draft'}
                          label={quote.status === 'sent_to_client' ? 'Pending Review' : undefined}
                          size="sm"
                        />
                        {quote.customer_total && (
                          <p className="text-sm font-medium mt-1">
                            ${Number(quote.customer_total).toFixed(2)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Link to="/client/items">
                <Button variant="outline" className="w-full justify-start h-auto py-4">
                  <MaterialIcon name="inventory_2" size="md" className="mr-3" />
                  <div className="text-left">
                    <p className="font-medium">View My Items</p>
                    <p className="text-xs text-muted-foreground">
                      See all items in storage
                    </p>
                  </div>
                </Button>
              </Link>
              <Link to="/client/quotes">
                <Button variant="outline" className="w-full justify-start h-auto py-4">
                  <MaterialIcon name="description" size="md" className="mr-3" />
                  <div className="text-left">
                    <p className="font-medium">Review Quotes</p>
                    <p className="text-xs text-muted-foreground">
                      Manage repair quotes
                    </p>
                  </div>
                </Button>
              </Link>
              <Link to="/client/claims">
                <Button variant="outline" className="w-full justify-start h-auto py-4">
                  <MaterialIcon name="shield" size="md" className="mr-3" />
                  <div className="text-left">
                    <p className="font-medium">My Claims</p>
                    <p className="text-xs text-muted-foreground">
                      View and file claims
                    </p>
                  </div>
                </Button>
              </Link>
              <Button variant="outline" className="w-full justify-start h-auto py-4" disabled>
                <MaterialIcon name="local_shipping" size="md" className="mr-3" />
                <div className="text-left">
                  <p className="font-medium">Request Delivery</p>
                  <p className="text-xs text-muted-foreground">Coming soon</p>
                </div>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </ClientPortalLayout>
  );
}
