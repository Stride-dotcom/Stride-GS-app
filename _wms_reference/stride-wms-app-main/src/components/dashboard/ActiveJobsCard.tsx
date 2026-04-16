import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNowStrict } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from '@/lib/utils';
import { minutesBetweenIso } from '@/lib/time/minutesBetweenIso';
import { formatMinutesShort } from '@/lib/time/serviceTimeEstimate';
import { resolveActiveJobLabel } from '@/lib/time/resolveActiveJobLabel';
import { useCountUp } from '@/hooks/useCountUp';

type IntervalRow = {
  job_type: string;
  job_id: string;
  user_id: string;
  started_at: string;
  ended_at: string | null;
  ended_reason: string | null;
};

type UserRow = { id: string; first_name: string | null; last_name: string | null };

type JobEntry = {
  state: 'active' | 'paused';
  jobType: string;
  jobId: string;
  label: string;
  startedAt?: string;
  pausedAt?: string;
  userIds: string[];
};

function jobKey(jobType: string, jobId: string) {
  return `${jobType}:${jobId}`;
}

function displayUserName(u: UserRow | undefined): string {
  if (!u) return 'Unknown';
  const first = (u.first_name || '').trim();
  const last = (u.last_name || '').trim();
  const full = `${first} ${last}`.trim();
  return full || 'Unknown';
}

function getJobUrl(jobType: string, jobId: string): string | null {
  if (!jobType || !jobId) return null;
  if (jobType === 'task') return `/tasks/${jobId}`;
  if (jobType === 'shipment') return `/shipments/${jobId}`;
  if (jobType === 'stocktake') return `/stocktakes/${jobId}/scan`;
  return null;
}

export function ActiveJobsCard(props: { className?: string }) {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<JobEntry[]>([]);
  const [usersById, setUsersById] = useState<Record<string, UserRow>>({});
  const [expanded, setExpanded] = useState(false);

  // Local ticker for live elapsed time labels
  const [nowTick, setNowTick] = useState<number>(() => Date.now());
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const hasActive = useMemo(() => entries.some(e => e.state === 'active'), [entries]);

  useEffect(() => {
    if (!hasActive) {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      return;
    }
    if (tickRef.current) return;
    tickRef.current = setInterval(() => setNowTick(Date.now()), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [hasActive]);

  const fetchActiveAndPaused = useCallback(async () => {
    if (!profile?.tenant_id) return;
    setLoading(true);
    try {
      const [activeRes, pausedRes] = await Promise.all([
        (supabase.from('job_time_intervals') as any)
          .select('job_type, job_id, user_id, started_at, ended_at, ended_reason')
          .eq('tenant_id', profile.tenant_id)
          .is('ended_at', null)
          .order('started_at', { ascending: false }),
        (supabase.from('job_time_intervals') as any)
          .select('job_type, job_id, user_id, started_at, ended_at, ended_reason')
          .eq('tenant_id', profile.tenant_id)
          .not('ended_at', 'is', null)
          .in('ended_reason', ['auto_pause', 'pause'])
          .order('ended_at', { ascending: false })
          .limit(80),
      ]);

      const activeIntervals = (activeRes?.data || []) as IntervalRow[];
      const pausedIntervals = (pausedRes?.data || []) as IntervalRow[];

      const activeByJob = new Map<string, { jobType: string; jobId: string; startedAtMin: string; userIds: Set<string> }>();
      for (const r of activeIntervals) {
        const key = jobKey(r.job_type, r.job_id);
        const existing = activeByJob.get(key);
        if (!existing) {
          activeByJob.set(key, { jobType: r.job_type, jobId: r.job_id, startedAtMin: r.started_at, userIds: new Set([r.user_id]) });
        } else {
          existing.userIds.add(r.user_id);
          if (new Date(r.started_at).getTime() < new Date(existing.startedAtMin).getTime()) {
            existing.startedAtMin = r.started_at;
          }
        }
      }

      const pausedByJob = new Map<string, { jobType: string; jobId: string; pausedAt: string; userId: string }>();
      for (const r of pausedIntervals) {
        if (!r.ended_at) continue;
        const key = jobKey(r.job_type, r.job_id);
        if (activeByJob.has(key)) continue;
        if (pausedByJob.has(key)) continue;
        pausedByJob.set(key, { jobType: r.job_type, jobId: r.job_id, pausedAt: r.ended_at, userId: r.user_id });
      }

      const pausedTaskIds = Array.from(pausedByJob.values()).filter(p => p.jobType === 'task').map(p => p.jobId);
      const pausedShipmentIds = Array.from(pausedByJob.values()).filter(p => p.jobType === 'shipment').map(p => p.jobId);
      const pausedStocktakeIds = Array.from(pausedByJob.values()).filter(p => p.jobType === 'stocktake').map(p => p.jobId);

      const [taskRows, shipmentRows, stocktakeRows] = await Promise.all([
        pausedTaskIds.length > 0
          ? (supabase.from('tasks') as any).select('id, status').eq('tenant_id', profile.tenant_id).in('id', pausedTaskIds)
          : Promise.resolve({ data: [] as any[] }),
        pausedShipmentIds.length > 0
          ? (supabase.from('shipments') as any).select('id, status, deleted_at').eq('tenant_id', profile.tenant_id).in('id', pausedShipmentIds)
          : Promise.resolve({ data: [] as any[] }),
        pausedStocktakeIds.length > 0
          ? (supabase.from('stocktakes') as any).select('id, status, deleted_at').eq('tenant_id', profile.tenant_id).in('id', pausedStocktakeIds)
          : Promise.resolve({ data: [] as any[] }),
      ]);

      const inProgressTaskIds = new Set<string>((taskRows.data || []).filter((t: any) => t.status === 'in_progress').map((t: any) => t.id));
      const inProgressShipmentIds = new Set<string>(
        (shipmentRows.data || []).filter((s: any) => !s.deleted_at).filter((s: any) => !['shipped', 'received', 'cancelled'].includes(String(s.status || '').toLowerCase())).map((s: any) => s.id)
      );
      const inProgressStocktakeIds = new Set<string>(
        (stocktakeRows.data || []).filter((st: any) => !st.deleted_at).filter((st: any) => String(st.status || '').toLowerCase() === 'active').map((st: any) => st.id)
      );

      const filteredPaused = Array.from(pausedByJob.values()).filter((p) => {
        if (p.jobType === 'task') return inProgressTaskIds.has(p.jobId);
        if (p.jobType === 'shipment') return inProgressShipmentIds.has(p.jobId);
        if (p.jobType === 'stocktake') return inProgressStocktakeIds.has(p.jobId);
        return false;
      });

      const keysToLabel = [
        ...Array.from(activeByJob.values()).map(a => ({ jobType: a.jobType, jobId: a.jobId })),
        ...filteredPaused.map(p => ({ jobType: p.jobType, jobId: p.jobId })),
      ];

      const labelPairs = await Promise.all(
        keysToLabel.map(async (j) => ({
          key: jobKey(j.jobType, j.jobId),
          label: await resolveActiveJobLabel(profile.tenant_id, j.jobType, j.jobId),
        }))
      );
      const labelByKey = new Map(labelPairs.map((p) => [p.key, p.label]));

      const userIds = new Set<string>();
      for (const a of activeByJob.values()) for (const uid of a.userIds) userIds.add(uid);
      for (const p of filteredPaused) userIds.add(p.userId);

      if (userIds.size > 0) {
        const { data: usersRows } = await (supabase.from('users') as any)
          .select('id, first_name, last_name')
          .in('id', Array.from(userIds));
        const map: Record<string, UserRow> = {};
        for (const u of usersRows || []) map[u.id] = u;
        setUsersById(map);
      } else {
        setUsersById({});
      }

      const nextEntries: JobEntry[] = [
        ...Array.from(activeByJob.values()).map((a) => ({
          state: 'active' as const,
          jobType: a.jobType,
          jobId: a.jobId,
          label: labelByKey.get(jobKey(a.jobType, a.jobId)) || `${a.jobType} job`,
          startedAt: a.startedAtMin,
          userIds: Array.from(a.userIds),
        })),
        ...filteredPaused.map((p) => ({
          state: 'paused' as const,
          jobType: p.jobType,
          jobId: p.jobId,
          label: labelByKey.get(jobKey(p.jobType, p.jobId)) || `${p.jobType} job`,
          pausedAt: p.pausedAt,
          userIds: [p.userId],
        })),
      ];

      nextEntries.sort((a, b) => {
        if (a.state !== b.state) return a.state === 'active' ? -1 : 1;
        const aTime = a.state === 'active' ? a.startedAt || '' : a.pausedAt || '';
        const bTime = b.state === 'active' ? b.startedAt || '' : b.pausedAt || '';
        return new Date(bTime).getTime() - new Date(aTime).getTime();
      });

      setEntries(nextEntries.slice(0, 20));
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id]);

  useEffect(() => { void fetchActiveAndPaused(); }, [fetchActiveAndPaused]);
  useEffect(() => {
    const id = setInterval(() => void fetchActiveAndPaused(), 15000);
    return () => clearInterval(id);
  }, [fetchActiveAndPaused]);

  const totalCount = entries.length;
  const activeCount = useMemo(() => entries.filter(e => e.state === 'active').length, [entries]);
  const animatedCount = useCountUp(totalCount, 600, 0);

  const totalElapsedMinutes = useMemo(() => {
    let total = 0;
    for (const e of entries) {
      if (e.state === 'active' && e.startedAt) {
        total += Math.round(minutesBetweenIso(e.startedAt, new Date(nowTick).toISOString()));
      }
    }
    return total;
  }, [entries, nowTick]);

  const timeStr = totalElapsedMinutes > 0 ? formatMinutesShort(totalElapsedMinutes) : '';

  return (
    <Card
      className={cn('hover:shadow-lg transition-shadow relative', props.className)}
      onClick={() => { if (expanded) setExpanded(false); }}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-[11px] font-semibold tracking-wide text-muted-foreground">
            ACTIVE JOBS
          </CardTitle>
          {activeCount > 0 && (
            <Badge className="bg-red-500 text-white text-[10px]">
              ⚠️ {activeCount}
            </Badge>
          )}
        </div>
        <div className="emoji-tile emoji-tile-lg rounded-lg bg-card border border-border shadow-sm">
          ⚡
        </div>
      </CardHeader>

      <CardContent>
        <div
          className="flex items-baseline gap-2 cursor-pointer hover:opacity-80 transition-opacity"
          onClick={(e) => {
            e.stopPropagation();
            void fetchActiveAndPaused();
          }}
          role="button"
        >
          <span className="text-3xl font-bold text-green-600 dark:text-green-400">
            {animatedCount}
          </span>
          {timeStr && totalCount > 0 && (
            <span className="text-sm text-muted-foreground">
              ⏱️ ~{timeStr}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">Active and paused jobs</p>

        {/* Expandable Items List */}
        {expanded && entries.length > 0 && (
          <div className="mt-4 border-t pt-3">
            <ScrollArea className="max-h-64">
              <div className="space-y-1">
                {entries.slice(0, 10).map((e) => {
                  const url = getJobUrl(e.jobType, e.jobId);
                  const users = e.userIds.map((id) => displayUserName(usersById[id]));
                  const elapsedMinutes =
                    e.state === 'active' && e.startedAt
                      ? Math.round(minutesBetweenIso(e.startedAt, new Date(nowTick).toISOString()))
                      : 0;

                    return (
                    <div
                      key={`${e.state}:${e.jobType}:${e.jobId}`}
                      className="min-h-[60px] py-2 px-2 rounded-md hover:bg-muted cursor-pointer"
                      onClick={(ev) => {
                        ev.stopPropagation();
                        if (url) navigate(url);
                      }}
                      role="button"
                    >
                      <span className="text-sm font-medium truncate block">{e.label}</span>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="text-xs text-muted-foreground truncate">
                          {users.length > 0 ? users.join(', ') : '—'}
                          {e.state === 'paused' && e.pausedAt
                            ? ` · paused ${formatDistanceToNowStrict(new Date(e.pausedAt), { addSuffix: true })}`
                            : null}
                        </span>
                        <span className="ml-auto flex items-center gap-1.5 shrink-0">
                          <Badge
                            variant={e.state === 'active' ? 'default' : 'outline'}
                            className={cn('text-[10px] whitespace-nowrap', e.state === 'active' && 'bg-green-600 hover:bg-green-600')}
                          >
                            {e.state === 'active' ? 'Active' : 'Paused'}
                          </Badge>
                          <span className="text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                            {e.state === 'active' ? formatMinutesShort(elapsedMinutes) : '—'}
                          </span>
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
            {entries.length > 10 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-xs mt-2"
                onClick={(e) => { e.stopPropagation(); navigate('/tasks'); }}
              >
                View all {totalCount} jobs
              </Button>
            )}
          </div>
        )}

        {expanded && entries.length === 0 && (
          <div className="mt-4 border-t pt-3 text-center text-sm text-muted-foreground">
            No active or paused jobs right now.
          </div>
        )}
      </CardContent>

      {/* Bottom-center expand/collapse button */}
      <div className="flex justify-center pb-2">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(!expanded);
          }}
        >
          <MaterialIcon
            name="expand_circle_down"
            size="sm"
            className={cn('transition-transform duration-200', expanded && 'rotate-180')}
          />
        </Button>
      </div>
    </Card>
  );
}
