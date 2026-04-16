import { useEffect, useMemo, useState } from 'react';
import { format, subDays } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { formatMinutesShort } from '@/lib/time/serviceTimeEstimate';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

type JobType = 'task' | 'shipment' | 'stocktake';

type ServiceTimeMeta = {
  estimated_minutes?: number;
  actual_labor_minutes?: number;
  actual_snapshot_at?: string;
};

function safeNumber(value: unknown): number | null {
  if (typeof value !== 'number') return null;
  if (!Number.isFinite(value)) return null;
  return value;
}

function safeString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  return s ? s : null;
}

function normalizeMetaServiceTime(metadata: any): ServiceTimeMeta | null {
  const st = metadata?.service_time;
  if (!st || typeof st !== 'object') return null;
  return st as ServiceTimeMeta;
}

function labelForJobType(type: JobType): string {
  if (type === 'task') return 'Tasks';
  if (type === 'shipment') return 'Shipments';
  return 'Stocktakes';
}

export function ServiceTimeSnapshotCard(props: { onOpenReport?: () => void }) {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [rangeDays, setRangeDays] = useState<'7' | '30' | '90'>('30');
  const [loading, setLoading] = useState(false);

  const [summary, setSummary] = useState<{
    jobs: number;
    totalEstimated: number;
    totalActual: number;
    withEstimate: number;
    withActual: number;
    byType: { jobType: string; actualMinutes: number }[];
  }>({
    jobs: 0,
    totalEstimated: 0,
    totalActual: 0,
    withEstimate: 0,
    withActual: 0,
    byType: [],
  });

  const dateWindow = useMemo(() => {
    const days = Number(rangeDays);
    const to = new Date();
    const from = subDays(to, Math.max(1, days));
    return {
      fromDate: format(from, 'yyyy-MM-dd'),
      toDate: format(to, 'yyyy-MM-dd'),
    };
  }, [rangeDays]);

  useEffect(() => {
    if (!profile?.tenant_id) return;

    let cancelled = false;

    const run = async () => {
      setLoading(true);
      try {
        const startIso = `${dateWindow.fromDate}T00:00:00`;
        const endIso = `${dateWindow.toDate}T23:59:59`;
        const startMs = Date.parse(`${startIso}Z`);
        const endMs = Date.parse(`${endIso}Z`);
        const isInWindow = (iso: string | null) => {
          if (!iso) return false;
          const ms = Date.parse(iso);
          return Number.isFinite(ms) && ms >= startMs && ms <= endMs;
        };

        const tasksPromise = (supabase.from('tasks') as any)
          .select('id, completed_at, duration_minutes, metadata')
          .eq('tenant_id', profile.tenant_id)
          .is('deleted_at', null)
          .gte('completed_at', startIso)
          .lte('completed_at', endIso);

        const shipmentsPromise = (supabase.from('shipments') as any)
          .select('id, completed_at, received_at, metadata')
          .eq('tenant_id', profile.tenant_id)
          .is('deleted_at', null)
          // inbound uses received_at, outbound uses completed_at
          .or(
            `and(completed_at.gte.${startIso},completed_at.lte.${endIso}),and(received_at.gte.${startIso},received_at.lte.${endIso})`
          );

        const stocktakesPromise = (supabase.from('stocktakes') as any)
          .select('id, completed_at, closed_at, duration_minutes, metadata')
          .eq('tenant_id', profile.tenant_id)
          .is('deleted_at', null)
          .or(`and(completed_at.gte.${startIso},completed_at.lte.${endIso}),and(closed_at.gte.${startIso},closed_at.lte.${endIso})`);

        const [tasksRes, shipmentsRes, stocktakesRes] = await Promise.all([
          tasksPromise,
          shipmentsPromise,
          stocktakesPromise,
        ]);

        if (tasksRes.error) throw tasksRes.error;
        if (shipmentsRes.error) throw shipmentsRes.error;
        if (stocktakesRes.error) throw stocktakesRes.error;

        let jobs = 0;
        let totalEstimated = 0;
        let totalActual = 0;
        let withEstimate = 0;
        let withActual = 0;

        const byType: Record<JobType, number> = {
          task: 0,
          shipment: 0,
          stocktake: 0,
        };

        for (const t of tasksRes.data || []) {
          jobs += 1;
          const meta = normalizeMetaServiceTime(t.metadata);
          const est = safeNumber(meta?.estimated_minutes) ?? 0;
          const actual = safeNumber(meta?.actual_labor_minutes) ?? safeNumber(t.duration_minutes) ?? 0;
          if (est > 0) withEstimate += 1;
          if (actual > 0) withActual += 1;
          totalEstimated += est;
          totalActual += actual;
          byType.task += actual;
        }

        for (const s of shipmentsRes.data || []) {
          const meta = normalizeMetaServiceTime(s.metadata);
          const snapshotAt = safeString(meta?.actual_snapshot_at);
          const completedAtCol = safeString(s.completed_at);
          const receivedAtCol = safeString(s.received_at);
          const completedAt = isInWindow(snapshotAt)
            ? snapshotAt
            : isInWindow(completedAtCol)
              ? completedAtCol
              : isInWindow(receivedAtCol)
                ? receivedAtCol
                : null;
          if (!completedAt) continue;

          jobs += 1;
          const est = safeNumber(meta?.estimated_minutes) ?? 0;
          const actual = safeNumber(meta?.actual_labor_minutes) ?? 0;
          if (est > 0) withEstimate += 1;
          if (actual > 0) withActual += 1;
          totalEstimated += est;
          totalActual += actual;
          byType.shipment += actual;
        }

        for (const st of stocktakesRes.data || []) {
          const meta = normalizeMetaServiceTime(st.metadata);
          const snapshotAt = safeString(meta?.actual_snapshot_at);
          const closedAtCol = safeString(st.closed_at);
          const completedAtCol = safeString(st.completed_at);
          const completedAt = isInWindow(snapshotAt)
            ? snapshotAt
            : isInWindow(closedAtCol)
              ? closedAtCol
              : isInWindow(completedAtCol)
                ? completedAtCol
                : null;
          if (!completedAt) continue;

          jobs += 1;
          const est = safeNumber(meta?.estimated_minutes) ?? 0;
          const actual = safeNumber(meta?.actual_labor_minutes) ?? safeNumber(st.duration_minutes) ?? 0;
          if (est > 0) withEstimate += 1;
          if (actual > 0) withActual += 1;
          totalEstimated += est;
          totalActual += actual;
          byType.stocktake += actual;
        }

        if (cancelled) return;
        setSummary({
          jobs,
          totalEstimated: Math.round(totalEstimated),
          totalActual: Math.round(totalActual),
          withEstimate,
          withActual,
          byType: (Object.entries(byType) as [JobType, number][])
            .map(([jt, mins]) => ({ jobType: labelForJobType(jt), actualMinutes: Math.round(mins) }))
            .filter((r) => r.actualMinutes > 0),
        });
      } catch (err: any) {
        if (cancelled) return;
        console.error('[ServiceTimeSnapshotCard] fetch error:', err);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: err?.message || 'Failed to load service time snapshot',
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [profile?.tenant_id, dateWindow.fromDate, dateWindow.toDate, toast]);

  const variance = useMemo(() => {
    if (summary.totalEstimated <= 0 || summary.totalActual <= 0) return null;
    return Math.round(summary.totalActual - summary.totalEstimated);
  }, [summary.totalActual, summary.totalEstimated]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="schedule" size="sm" />
              Service Time Snapshot
            </CardTitle>
            <CardDescription>
              Last {rangeDays} days • quick view (open the report for details)
            </CardDescription>
          </div>

          <div className="flex items-center gap-2">
            <Select value={rangeDays} onValueChange={(v) => setRangeDays(v as any)}>
              <SelectTrigger className="w-[120px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="7">7 days</SelectItem>
                <SelectItem value="30">30 days</SelectItem>
                <SelectItem value="90">90 days</SelectItem>
              </SelectContent>
            </Select>

            <Button variant="outline" size="sm" onClick={props.onOpenReport} disabled={!props.onOpenReport}>
              Open report
              <MaterialIcon name="chevron_right" size="sm" className="ml-1" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="tabular-nums">
            Jobs: {summary.jobs}
          </Badge>
          <Badge variant="secondary" className="tabular-nums">
            Est: {formatMinutesShort(summary.totalEstimated)}
          </Badge>
          <Badge variant="secondary" className="tabular-nums">
            Actual: {formatMinutesShort(summary.totalActual)}
          </Badge>
          {variance != null && (
            <Badge variant="outline" className="tabular-nums">
              Variance: {variance >= 0 ? '+' : '-'}{formatMinutesShort(Math.abs(variance))}
            </Badge>
          )}
          <Badge variant="outline" className="tabular-nums">
            With est: {summary.withEstimate}
          </Badge>
          <Badge variant="outline" className="tabular-nums">
            With actual: {summary.withActual}
          </Badge>
          {loading && (
            <Badge variant="outline" className="tabular-nums">
              <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
              Loading
            </Badge>
          )}
        </div>

        <div className="h-[220px]">
          {summary.byType.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={summary.byType}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="jobType" />
                <YAxis />
                <Tooltip formatter={(v) => formatMinutesShort(Number(v) || 0)} />
                <Bar dataKey="actualMinutes" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              No service time data for this window
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

