/**
 * ClaimsDashboard Component
 * Displays KPIs, trends, SLA performance, AI performance, and operational queues
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useClaimInsights } from '@/hooks/useClaimInsights';
import { formatDistanceToNow } from 'date-fns';

interface KPICardProps {
  title: string;
  value: string | number;
  icon: string;
  description?: string;
  trend?: 'up' | 'down' | 'neutral';
  color?: 'default' | 'green' | 'red' | 'blue' | 'purple';
}

function KPICard({ title, value, icon, description, trend, color = 'default' }: KPICardProps) {
  const colorClasses = {
    default: 'text-foreground',
    green: 'text-green-600',
    red: 'text-red-600',
    blue: 'text-blue-600',
    purple: 'text-purple-600',
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <MaterialIcon name={icon} size="md" className="text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className={`text-2xl font-bold ${colorClasses[color]}`}>{value}</div>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </CardContent>
    </Card>
  );
}

function QueueCard({
  title,
  count,
  icon,
  variant,
  onClick,
}: {
  title: string;
  count: number;
  icon: string;
  variant: 'warning' | 'danger' | 'info' | 'muted';
  onClick?: () => void;
}) {
  const variantClasses = {
    warning: 'border-yellow-200 bg-yellow-50 dark:bg-yellow-900/10',
    danger: 'border-red-200 bg-red-50 dark:bg-red-900/10',
    info: 'border-blue-200 bg-blue-50 dark:bg-blue-900/10',
    muted: 'border-gray-200 bg-gray-50 dark:bg-gray-900/10',
  };

  const iconClasses = {
    warning: 'text-yellow-600',
    danger: 'text-red-600',
    info: 'text-blue-600',
    muted: 'text-gray-600',
  };

  return (
    <Card
      className={`cursor-pointer hover:shadow-md transition-shadow ${variantClasses[variant]}`}
      onClick={onClick}
    >
      <CardContent className="pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MaterialIcon name={icon} size="lg" className={iconClasses[variant]} />
            <div>
              <p className="text-sm font-medium">{title}</p>
              <p className="text-2xl font-bold">{count}</p>
            </div>
          </div>
          <MaterialIcon name="chevron_right" size="md" className="text-muted-foreground" />
        </div>
      </CardContent>
    </Card>
  );
}

interface ClaimsDashboardProps {
  onNavigateToList?: (filter?: string) => void;
}

export function ClaimsDashboard({ onNavigateToList }: ClaimsDashboardProps) {
  const { loading, kpis, trends, slaPerformance, aiPerformance, queues } = useClaimInsights(30);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(8)].map((_, i) => (
            <Skeleton key={i} className="h-[120px]" />
          ))}
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          <Skeleton className="h-[300px]" />
          <Skeleton className="h-[300px]" />
        </div>
      </div>
    );
  }

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Last 30 Days</h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <KPICard
            title="Claims Opened"
            value={kpis.claimsOpened}
            icon="description"
            color="blue"
          />
          <KPICard
            title="Claims Closed"
            value={kpis.claimsClosed}
            icon="check_circle"
            color="green"
          />
          <KPICard
            title="Total Payouts"
            value={formatCurrency(kpis.totalPayouts)}
            icon="payments"
          />
          <KPICard
            title="Avg Payout"
            value={formatCurrency(kpis.averagePayout)}
            icon="trending_up"
          />
          <KPICard
            title="Auto-Approved"
            value={kpis.autoApprovedClaims}
            icon="bolt"
            color="purple"
            description="Claims processed automatically"
          />
          <KPICard
            title="Shipping Damage"
            value={kpis.shippingDamageClaims}
            icon="local_shipping"
            description="Assistance claims"
          />
          <KPICard
            title="Assistance Fees"
            value={formatCurrency(kpis.assistanceFeesBilled)}
            icon="receipt"
            color="green"
          />
          <KPICard
            title="SLA On-Time"
            value={`${slaPerformance.onTimePercent.toFixed(0)}%`}
            icon="schedule"
            color={slaPerformance.onTimePercent >= 90 ? 'green' : slaPerformance.onTimePercent >= 70 ? 'default' : 'red'}
          />
        </div>
      </div>

      {/* Operational Queues */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Operational Queues</h3>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <QueueCard
            title="Needs Review"
            count={queues.needingReview}
            icon="rate_review"
            variant={queues.needingReview > 10 ? 'warning' : 'info'}
            onClick={() => onNavigateToList?.('needs_review')}
          />
          <QueueCard
            title="Overdue"
            count={queues.overdue}
            icon="warning"
            variant={queues.overdue > 0 ? 'danger' : 'muted'}
            onClick={() => onNavigateToList?.('overdue')}
          />
          <QueueCard
            title="Paused (Awaiting Docs)"
            count={queues.paused}
            icon="pause_circle"
            variant={queues.paused > 5 ? 'warning' : 'muted'}
            onClick={() => onNavigateToList?.('paused')}
          />
          <QueueCard
            title="Shipping Damage Pending"
            count={queues.shippingDamagePending}
            icon="inventory"
            variant="info"
            onClick={() => onNavigateToList?.('shipping_damage')}
          />
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* SLA Performance */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="timer" size="md" />
              SLA Performance
            </CardTitle>
            <CardDescription>Service level agreement metrics</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">On-Time Rate</span>
              <Badge
                variant="outline"
                className={
                  slaPerformance.onTimePercent >= 90
                    ? 'border-green-500 text-green-700'
                    : slaPerformance.onTimePercent >= 70
                    ? 'border-yellow-500 text-yellow-700'
                    : 'border-red-500 text-red-700'
                }
              >
                {slaPerformance.onTimePercent.toFixed(1)}%
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Overdue Rate</span>
              <Badge
                variant="outline"
                className={
                  slaPerformance.overduePercent <= 5
                    ? 'border-green-500 text-green-700'
                    : slaPerformance.overduePercent <= 15
                    ? 'border-yellow-500 text-yellow-700'
                    : 'border-red-500 text-red-700'
                }
              >
                {slaPerformance.overduePercent.toFixed(1)}%
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total Paused Time</span>
              <span className="text-sm font-medium">
                {Math.round(slaPerformance.totalPausedMinutes / 60)} hours
              </span>
            </div>

            {/* SLA Progress Bar */}
            <div className="pt-2">
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>On Track / Due Soon</span>
                <span>Overdue</span>
              </div>
              <div className="h-3 bg-muted rounded-full overflow-hidden flex">
                <div
                  className="bg-green-500 transition-all"
                  style={{ width: `${slaPerformance.onTimePercent}%` }}
                />
                <div
                  className="bg-red-500 transition-all"
                  style={{ width: `${slaPerformance.overduePercent}%` }}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* AI/System Performance (Internal) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="analytics" size="md" />
              System Performance
            </CardTitle>
            <CardDescription>Automated decision metrics (internal)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Acceptance Rate</span>
              <Badge variant="outline" className="border-green-500 text-green-700">
                {aiPerformance.acceptanceRate.toFixed(1)}%
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Override Rate</span>
              <Badge
                variant="outline"
                className={
                  aiPerformance.overrideRate <= 10
                    ? 'border-green-500 text-green-700'
                    : 'border-yellow-500 text-yellow-700'
                }
              >
                {aiPerformance.overrideRate.toFixed(1)}%
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Avg Delta (Override)</span>
              <span className="text-sm font-medium">
                {formatCurrency(aiPerformance.averageDelta)}
              </span>
            </div>

            {aiPerformance.topOverrideReasons.length > 0 && (
              <div className="pt-2">
                <span className="text-sm text-muted-foreground block mb-2">Top Override Reasons</span>
                <div className="space-y-1">
                  {aiPerformance.topOverrideReasons.slice(0, 3).map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between text-sm">
                      <span className="capitalize">{item.reason.replace(/_/g, ' ')}</span>
                      <Badge variant="secondary">{item.count}</Badge>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Weekly Trends */}
      {trends.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="show_chart" size="md" />
              Weekly Trends
            </CardTitle>
            <CardDescription>Claims activity over time</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-3 font-medium text-muted-foreground">Week</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Opened</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Payouts</th>
                    <th className="text-right py-2 px-3 font-medium text-muted-foreground">Auto-Approved</th>
                  </tr>
                </thead>
                <tbody>
                  {trends.map((trend, idx) => (
                    <tr key={idx} className="border-b last:border-0">
                      <td className="py-2 px-3">{trend.week}</td>
                      <td className="py-2 px-3 text-right">{trend.claimsOpened}</td>
                      <td className="py-2 px-3 text-right">{formatCurrency(trend.payouts)}</td>
                      <td className="py-2 px-3 text-right">{trend.autoApprovals}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
