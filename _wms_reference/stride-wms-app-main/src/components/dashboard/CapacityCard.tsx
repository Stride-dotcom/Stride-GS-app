import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useAuth } from '@/contexts/AuthContext';
import { fetchWarehouseCapacitySummary } from '@/lib/capacity/capacityModule';

interface CapacityCardProps {
  warehouseId?: string;
}

interface CapacityData {
  measuredCount: number;
  totalCount: number;
  totalUsed: number;
  totalCapacity: number;
  utilization: number;
}

export function CapacityCard({ warehouseId }: CapacityCardProps) {
  const { profile } = useAuth();
  const [data, setData] = useState<CapacityData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();

    if (!profile?.tenant_id || !warehouseId) {
      setLoading(false);
      setData(null);
      return;
    }

    const fetchCapacity = async () => {
      try {
        setLoading(true);

        const summary = await fetchWarehouseCapacitySummary({
          tenantId: profile.tenant_id!,
          warehouseId,
        });
        if (controller.signal.aborted) return;
        setData(summary);
      } catch (err) {
        if (controller.signal.aborted) return;
        console.error('[CapacityCard] Error:', err);
        setData(null);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    fetchCapacity();
    const interval = setInterval(fetchCapacity, 60_000);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [profile?.tenant_id, warehouseId]);

  // ---- No warehouse selected ----
  if (!warehouseId) {
    return (
      <Card className="min-h-[180px]">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pr-10">
          <CardTitle className="text-[11px] font-semibold tracking-wide text-muted-foreground">
            WAREHOUSE CAPACITY
          </CardTitle>
          <div className="emoji-tile emoji-tile-lg rounded-lg bg-card border border-border shadow-sm">
            📐
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Select a warehouse to view capacity
          </p>
        </CardContent>
      </Card>
    );
  }

  // ---- Loading ----
  if (loading) {
    return (
      <Card className="min-h-[180px]">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pr-10">
          <CardTitle className="text-[11px] font-semibold tracking-wide text-muted-foreground">
            WAREHOUSE CAPACITY
          </CardTitle>
          <div className="emoji-tile emoji-tile-lg rounded-lg bg-card border border-border shadow-sm">
            📐
          </div>
        </CardHeader>
        <CardContent>
          <div className="h-16 flex items-center justify-center">
            <MaterialIcon
              name="progress_activity"
              size="md"
              className="animate-spin text-muted-foreground"
            />
          </div>
        </CardContent>
      </Card>
    );
  }

  // ---- Empty / not configured ----
  if (!data || data.totalCapacity === 0) {
    return (
      <Card className="min-h-[180px]">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pr-10">
          <CardTitle className="text-[11px] font-semibold tracking-wide text-muted-foreground">
            WAREHOUSE CAPACITY
          </CardTitle>
          <div className="emoji-tile emoji-tile-lg rounded-lg bg-card border border-border shadow-sm">
            📐
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Capacity not configured
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {data
              ? `${data.measuredCount} of ${data.totalCount} bays measured`
              : 'No location data'}
          </p>
        </CardContent>
      </Card>
    );
  }

  // ---- Data available ----
  const utilPct = (data.utilization * 100).toFixed(0);
  const utilColor =
    data.utilization >= 0.9
      ? 'text-red-600 dark:text-red-400'
      : data.utilization >= 0.7
        ? 'text-amber-600 dark:text-amber-400'
        : 'text-green-600 dark:text-green-400';

  const barColor =
    data.utilization >= 0.9
      ? 'bg-red-500'
      : data.utilization >= 0.7
        ? 'bg-amber-500'
        : 'bg-green-500';

  return (
    <Card className="min-h-[180px] hover:shadow-lg transition-shadow">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2 pr-10">
        <CardTitle className="text-[11px] font-semibold tracking-wide text-muted-foreground">
          WAREHOUSE CAPACITY
        </CardTitle>
        <div className="emoji-tile emoji-tile-lg rounded-lg bg-card border border-border shadow-sm">
          📐
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className={`text-3xl font-bold ${utilColor}`}>{utilPct}%</span>
          <span className="text-sm text-muted-foreground">utilized</span>
        </div>

        {/* Utilization bar */}
        <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{
              width: `${Math.min(data.utilization * 100, 100)}%`,
            }}
          />
        </div>

        <div className="flex justify-between text-xs text-muted-foreground mt-2">
          <span>
            {data.totalUsed.toFixed(0)} / {data.totalCapacity.toFixed(0)} cuft
          </span>
          <span>
            {data.measuredCount} of {data.totalCount} bays measured
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
