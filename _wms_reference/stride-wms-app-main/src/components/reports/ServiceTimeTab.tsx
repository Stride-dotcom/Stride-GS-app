import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { format } from 'date-fns';
import { formatMinutesShort } from '@/lib/time/serviceTimeEstimate';
import { minutesBetweenIso } from '@/lib/time/minutesBetweenIso';
import { useAccounts } from '@/hooks/useAccounts';
import { useWarehouses } from '@/hooks/useWarehouses';
import { useEmployeePay } from '@/hooks/useLaborSettings';
import ExcelJS from 'exceljs';
import { addJsonSheet, downloadWorkbook } from '@/lib/excelUtils';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { SearchableSelect, type SelectOption } from '@/components/ui/searchable-select';

type JobTypeFilter = 'all' | 'task' | 'shipment' | 'stocktake';
type SortField =
  | 'completed_at'
  | 'job_type'
  | 'estimated'
  | 'actual'
  | 'variance'
  | 'billed'
  | 'labor_cost'
  | 'margin';
type SortDirection = 'asc' | 'desc';
type ViewTab = 'overview' | 'jobs' | 'employees' | 'accounts' | 'warehouses';

type ServiceTimeMeta = {
  estimated_minutes?: number;
  estimated_snapshot_at?: string;
  actual_labor_minutes?: number;
  actual_cycle_minutes?: number;
  actual_snapshot_at?: string;
};

type ServiceTimeRow = {
  jobType: 'task' | 'shipment' | 'stocktake';
  jobId: string;
  label: string;
  completedAt: string | null;
  accountId: string | null;
  warehouseId: string | null;
  subType: string | null;
  estimatedMinutes: number | null;
  actualMinutes: number | null;
  varianceMinutes: number | null;
  billedAmount: number | null;
  laborCost: number | null;
  margin: number | null;
  url: string;
};

type UserInfo = {
  id: string;
  name: string;
  email: string | null;
};

type EmployeeSummaryRow = {
  userId: string;
  name: string;
  jobs: number;
  minutes: number;
  laborCost: number | null;
  billedShare: number | null;
  marginShare: number | null;
  avgMinutesPerJob: number | null;
};

type GroupSummaryRow = {
  id: string | null;
  name: string;
  jobs: number;
  estimatedMinutes: number;
  actualMinutes: number;
  billedTotal: number;
  billedKnownJobs: number;
  laborCostTotal: number;
  laborKnownJobs: number;
  marginTotal: number;
  marginKnownJobs: number;
  marginBilledTotal: number;
};

function computeGroupSummaryRows(opts: {
  rows: ServiceTimeRow[];
  getId: (row: ServiceTimeRow) => string | null;
  nameById: Map<string, string>;
  fallbackName: string;
  includeBillingTotals: boolean;
  includeLaborCost: boolean;
}): GroupSummaryRow[] {
  const { rows, getId, nameById, fallbackName, includeBillingTotals, includeLaborCost } = opts;
  const byId = new Map<string, GroupSummaryRow>();

  for (const r of rows) {
    const id = getId(r) || null;
    const key = id || '__unassigned__';
    const name = id ? (nameById.get(id) || fallbackName) : 'Unassigned';

    const cur = byId.get(key) || {
      id,
      name,
      jobs: 0,
      estimatedMinutes: 0,
      actualMinutes: 0,
      billedTotal: 0,
      billedKnownJobs: 0,
      laborCostTotal: 0,
      laborKnownJobs: 0,
      marginTotal: 0,
      marginKnownJobs: 0,
      marginBilledTotal: 0,
    };

    cur.jobs += 1;
    cur.estimatedMinutes += r.estimatedMinutes ?? 0;
    cur.actualMinutes += r.actualMinutes ?? 0;

    if (includeBillingTotals && r.billedAmount != null) {
      cur.billedTotal += r.billedAmount;
      cur.billedKnownJobs += 1;
    }

    if (includeLaborCost && r.laborCost != null) {
      cur.laborCostTotal += r.laborCost;
      cur.laborKnownJobs += 1;
    }

    if (includeBillingTotals && includeLaborCost && r.margin != null) {
      cur.marginTotal += r.margin;
      cur.marginKnownJobs += 1;
      cur.marginBilledTotal += r.billedAmount ?? 0;
    }

    byId.set(key, cur);
  }

  return Array.from(byId.values())
    .map((r) => ({
      ...r,
      estimatedMinutes: Math.round(r.estimatedMinutes),
      actualMinutes: Math.round(r.actualMinutes),
      billedTotal: Number(r.billedTotal.toFixed(2)),
      laborCostTotal: Number(r.laborCostTotal.toFixed(2)),
      marginTotal: Number(r.marginTotal.toFixed(2)),
      marginBilledTotal: Number(r.marginBilledTotal.toFixed(2)),
    }))
    .sort((a, b) => (b.actualMinutes || 0) - (a.actualMinutes || 0));
}

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

function formatDateTimeShort(iso: string) {
  try {
    return format(new Date(iso), 'MMM d, yyyy h:mm a');
  } catch {
    return iso;
  }
}

function formatUsd(value: number | null) {
  if (value == null || !Number.isFinite(value)) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function formatTooltipCurrency(value: unknown): string {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : Number(value);
  if (!Number.isFinite(n)) return '-';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function jobKey(jobType: string, jobId: string) {
  return `${jobType}:${jobId}`;
}

function displayNameFromUserRow(u: any): string {
  const first = String(u?.first_name || '').trim();
  const last = String(u?.last_name || '').trim();
  const name = `${first} ${last}`.trim();
  return name || (u?.email ? String(u.email) : 'Unknown');
}

function getHourlyRateFromPayRow(pay: any): number {
  if (!pay) return 0;
  const payType = String(pay.pay_type || '').toLowerCase();
  const payRate = typeof pay.pay_rate === 'number' && Number.isFinite(pay.pay_rate) ? pay.pay_rate : 0;
  const salaryEq = typeof pay.salary_hourly_equivalent === 'number' && Number.isFinite(pay.salary_hourly_equivalent)
    ? pay.salary_hourly_equivalent
    : null;

  if (payType === 'hourly') return payRate;
  // salary
  return salaryEq ?? (payRate > 0 ? payRate / 2080 : 0);
}

export function ServiceTimeTab() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { accounts } = useAccounts();
  const { warehouses } = useWarehouses();
  const { employeePay } = useEmployeePay();

  const [loading, setLoading] = useState(false);
  const [jobType, setJobType] = useState<JobTypeFilter>('all');
  const [includeBillingTotals, setIncludeBillingTotals] = useState(false);
  const [includeLaborCost, setIncludeLaborCost] = useState(false);
  const [activeTab, setActiveTab] = useState<ViewTab>('overview');

  const [accountFilter, setAccountFilter] = useState<string>('all');
  const [warehouseFilter, setWarehouseFilter] = useState<string>('all');
  const [employeeFilter, setEmployeeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [onlyWithEstimate, setOnlyWithEstimate] = useState(false);
  const [onlyWithActual, setOnlyWithActual] = useState(false);

  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return format(d, 'yyyy-MM-dd');
  });
  const [dateTo, setDateTo] = useState(() => format(new Date(), 'yyyy-MM-dd'));

  const [sortField, setSortField] = useState<SortField>('completed_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const [rows, setRows] = useState<ServiceTimeRow[]>([]);
  const [usersById, setUsersById] = useState<Record<string, UserInfo>>({});
  const [jobUserMinutes, setJobUserMinutes] = useState<Record<string, Record<string, number>>>({});
  const [jobUserMinutesLoaded, setJobUserMinutesLoaded] = useState(false);

  const accountNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of accounts || []) {
      map.set(a.id, a.account_name || a.account_code || 'Account');
    }
    return map;
  }, [accounts]);

  const accountOptions = useMemo<SelectOption[]>(() => {
    const opts: SelectOption[] = [{ value: 'all', label: 'All accounts' }];
    for (const a of accounts || []) {
      opts.push({
        value: a.id,
        label: a.account_name || a.account_code || 'Account',
      });
    }
    opts.sort((a, b) => {
      if (a.value === 'all') return -1;
      if (b.value === 'all') return 1;
      return a.label.localeCompare(b.label);
    });
    return opts;
  }, [accounts]);

  const warehouseNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const w of warehouses || []) {
      map.set(w.id, w.name || 'Warehouse');
    }
    return map;
  }, [warehouses]);

  const warehouseOptions = useMemo<SelectOption[]>(() => {
    const opts: SelectOption[] = [{ value: 'all', label: 'All warehouses' }];
    for (const w of warehouses || []) {
      opts.push({
        value: w.id,
        label: w.name || 'Warehouse',
      });
    }
    opts.sort((a, b) => {
      if (a.value === 'all') return -1;
      if (b.value === 'all') return 1;
      return a.label.localeCompare(b.label);
    });
    return opts;
  }, [warehouses]);

  const hourlyRateByUserId = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of employeePay || []) {
      const uid = String(p.user_id || '');
      if (!uid) continue;
      map.set(uid, getHourlyRateFromPayRow(p));
    }
    return map;
  }, [employeePay]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <MaterialIcon name="swap_vert" size="sm" className="opacity-50" />;
    return sortDirection === 'asc'
      ? <MaterialIcon name="arrow_upward" size="sm" />
      : <MaterialIcon name="arrow_downward" size="sm" />;
  };

  const fetchData = async () => {
    if (!profile?.tenant_id) return;
    setLoading(true);
    try {
      const startIso = `${dateFrom}T00:00:00`;
      const endIso = `${dateTo}T23:59:59`;

      const wantsTasks = jobType === 'all' || jobType === 'task';
      const wantsShipments = jobType === 'all' || jobType === 'shipment';
      const wantsStocktakes = jobType === 'all' || jobType === 'stocktake';

      const tasksPromise = wantsTasks
        ? (() => {
            let q = (supabase.from('tasks') as any)
              .select('id, title, task_type, completed_at, duration_minutes, account_id, warehouse_id, metadata')
              .eq('tenant_id', profile.tenant_id)
              .is('deleted_at', null)
              .gte('completed_at', startIso)
              .lte('completed_at', endIso);
            if (accountFilter !== 'all') q = q.eq('account_id', accountFilter);
            if (warehouseFilter !== 'all') q = q.eq('warehouse_id', warehouseFilter);
            return q;
          })()
        : Promise.resolve({ data: [] as any[], error: null as any });

      const shipmentsPromise = wantsShipments
        ? (() => {
            let q = (supabase.from('shipments') as any)
              .select('id, shipment_number, shipment_type, status, completed_at, received_at, account_id, warehouse_id, metadata')
              .eq('tenant_id', profile.tenant_id)
              .is('deleted_at', null)
              // inbound uses received_at, outbound uses completed_at
              .or(`and(completed_at.gte.${startIso},completed_at.lte.${endIso}),and(received_at.gte.${startIso},received_at.lte.${endIso})`);
            if (accountFilter !== 'all') q = q.eq('account_id', accountFilter);
            if (warehouseFilter !== 'all') q = q.eq('warehouse_id', warehouseFilter);
            return q;
          })()
        : Promise.resolve({ data: [] as any[], error: null as any });

      const stocktakesPromise = wantsStocktakes
        ? (() => {
            let q = (supabase.from('stocktakes') as any)
              .select('id, stocktake_number, name, status, closed_at, duration_minutes, account_id, warehouse_id, metadata')
              .eq('tenant_id', profile.tenant_id)
              .is('deleted_at', null)
              .gte('closed_at', startIso)
              .lte('closed_at', endIso);
            if (accountFilter !== 'all') q = q.eq('account_id', accountFilter);
            if (warehouseFilter !== 'all') q = q.eq('warehouse_id', warehouseFilter);
            return q;
          })()
        : Promise.resolve({ data: [] as any[], error: null as any });

      const [tasksRes, shipmentsRes, stocktakesRes] = await Promise.all([
        tasksPromise,
        shipmentsPromise,
        stocktakesPromise,
      ]);

      if (tasksRes.error) throw tasksRes.error;
      if (shipmentsRes.error) throw shipmentsRes.error;
      if (stocktakesRes.error) throw stocktakesRes.error;

      const next: ServiceTimeRow[] = [];

      for (const t of tasksRes.data || []) {
        const meta = normalizeMetaServiceTime(t.metadata);
        const est = safeNumber(meta?.estimated_minutes) ?? null;
        const actualFromMeta = safeNumber(meta?.actual_labor_minutes);
        const actualFromCol = safeNumber(t.duration_minutes);
        const actual = actualFromMeta ?? actualFromCol ?? null;
        const variance = est != null && actual != null ? Math.round(actual - est) : null;
        next.push({
          jobType: 'task',
          jobId: String(t.id),
          label: t.title || (t.task_type ? `${t.task_type} task` : 'Task'),
          completedAt: safeString(t.completed_at),
          accountId: t.account_id ? String(t.account_id) : null,
          warehouseId: t.warehouse_id ? String(t.warehouse_id) : null,
          subType: safeString(t.task_type),
          estimatedMinutes: est != null ? Math.round(est) : null,
          actualMinutes: actual != null ? Math.round(actual) : null,
          varianceMinutes: variance,
          billedAmount: null,
          laborCost: null,
          margin: null,
          url: `/tasks/${t.id}`,
        });
      }

      for (const s of shipmentsRes.data || []) {
        const meta = normalizeMetaServiceTime(s.metadata);
        const est = safeNumber(meta?.estimated_minutes) ?? null;
        const actual = safeNumber(meta?.actual_labor_minutes) ?? null;

        // Prefer snapshot timestamps, then completed_at/received_at
        const completedAt =
          safeString(meta?.actual_snapshot_at)
          ?? safeString(s.completed_at)
          ?? safeString(s.received_at);

        const variance = est != null && actual != null ? Math.round(actual - est) : null;
        next.push({
          jobType: 'shipment',
          jobId: String(s.id),
          label: s.shipment_number ? `Shipment ${s.shipment_number}` : 'Shipment',
          completedAt,
          accountId: s.account_id ? String(s.account_id) : null,
          warehouseId: s.warehouse_id ? String(s.warehouse_id) : null,
          subType: safeString(s.shipment_type),
          estimatedMinutes: est != null ? Math.round(est) : null,
          actualMinutes: actual != null ? Math.round(actual) : null,
          varianceMinutes: variance,
          billedAmount: null,
          laborCost: null,
          margin: null,
          url: `/shipments/${s.id}`,
        });
      }

      for (const st of stocktakesRes.data || []) {
        const meta = normalizeMetaServiceTime(st.metadata);
        const est = safeNumber(meta?.estimated_minutes) ?? null;
        const actualFromMeta = safeNumber(meta?.actual_labor_minutes);
        const actualFromCol = safeNumber(st.duration_minutes);
        const actual = actualFromMeta ?? actualFromCol ?? null;
        const completedAt =
          safeString(meta?.actual_snapshot_at)
          ?? safeString(st.closed_at);
        const variance = est != null && actual != null ? Math.round(actual - est) : null;
        next.push({
          jobType: 'stocktake',
          jobId: String(st.id),
          label: st.name || (st.stocktake_number ? `Stocktake ${st.stocktake_number}` : 'Stocktake'),
          completedAt,
          accountId: st.account_id ? String(st.account_id) : null,
          warehouseId: st.warehouse_id ? String(st.warehouse_id) : null,
          subType: null,
          estimatedMinutes: est != null ? Math.round(est) : null,
          actualMinutes: actual != null ? Math.round(actual) : null,
          varianceMinutes: variance,
          billedAmount: null,
          laborCost: null,
          margin: null,
          url: `/stocktakes/${st.id}/report`,
        });
      }

      let enrichedRows: ServiceTimeRow[] = next;

      // Attach billing totals (best-effort). We sum billing_events linked to a task/shipment
      // with occurred_at within the selected date range.
      if (includeBillingTotals) {
        const taskIds = enrichedRows.filter(r => r.jobType === 'task').map(r => r.jobId);
        const shipmentIds = enrichedRows.filter(r => r.jobType === 'shipment').map(r => r.jobId);

        const totalsByTask = new Map<string, number>();
        const totalsByShipment = new Map<string, number>();

        const addTotal = (map: Map<string, number>, id: string, amount: unknown) => {
          const n = typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
          map.set(id, (map.get(id) || 0) + n);
        };

        const idsChunkSize = 150;

        for (const batch of chunk(taskIds, idsChunkSize)) {
          const { data: billRows, error } = await (supabase.from('billing_events') as any)
            .select('task_id, total_amount, status, occurred_at')
            .eq('tenant_id', profile.tenant_id)
            .in('task_id', batch)
            .gte('occurred_at', startIso)
            .lte('occurred_at', endIso)
            .neq('status', 'void');
          if (error) throw error;
          for (const r of billRows || []) {
            if (!r?.task_id) continue;
            addTotal(totalsByTask, String(r.task_id), r.total_amount);
          }
        }

        for (const batch of chunk(shipmentIds, idsChunkSize)) {
          const { data: billRows, error } = await (supabase.from('billing_events') as any)
            .select('shipment_id, total_amount, status, occurred_at')
            .eq('tenant_id', profile.tenant_id)
            .in('shipment_id', batch)
            .gte('occurred_at', startIso)
            .lte('occurred_at', endIso)
            .neq('status', 'void');
          if (error) throw error;
          for (const r of billRows || []) {
            if (!r?.shipment_id) continue;
            addTotal(totalsByShipment, String(r.shipment_id), r.total_amount);
          }
        }

        enrichedRows = enrichedRows.map((r) => {
          if (r.jobType === 'task') return { ...r, billedAmount: totalsByTask.get(r.jobId) ?? 0 };
          if (r.jobType === 'shipment') return { ...r, billedAmount: totalsByShipment.get(r.jobId) ?? 0 };
          return r;
        });
      }

      // Labor cost + employee performance need per-user minutes from job_time_intervals.
      const needIntervals = includeLaborCost || activeTab === 'employees' || employeeFilter !== 'all';
      const nextJobUserMinutes: Record<string, Record<string, number>> = {};
      const nextUsers: Record<string, UserInfo> = {};

      if (needIntervals && profile?.tenant_id) {
        const completedAtByJobKey = new Map<string, string>();
        for (const r of enrichedRows) {
          if (r.completedAt) completedAtByJobKey.set(jobKey(r.jobType, r.jobId), r.completedAt);
        }

        const byKeyAdd = (jt: string, jid: string, uid: string, minutes: number) => {
          const key = jobKey(jt, jid);
          if (!nextJobUserMinutes[key]) nextJobUserMinutes[key] = {};
          nextJobUserMinutes[key][uid] = (nextJobUserMinutes[key][uid] || 0) + minutes;
        };

        const userIds = new Set<string>();

        const fetchIntervalsForType = async (type: 'task' | 'shipment' | 'stocktake', ids: string[]) => {
          if (ids.length === 0) return;
          const batchSize = 150;
          for (const batch of chunk(ids, batchSize)) {
            const { data: intervalRows, error } = await (supabase.from('job_time_intervals') as any)
              .select('job_type, job_id, user_id, started_at, ended_at')
              .eq('tenant_id', profile.tenant_id)
              .eq('job_type', type)
              .in('job_id', batch);
            if (error) throw error;

            for (const it of intervalRows || []) {
              const jt = String(it.job_type || '');
              const jid = String(it.job_id || '');
              const uid = String(it.user_id || '');
              if (!jt || !jid || !uid) continue;

              const fallbackEnd = completedAtByJobKey.get(jobKey(jt, jid)) || endIso;
              const end = it.ended_at || fallbackEnd;
              const mins = minutesBetweenIso(String(it.started_at), String(end));
              if (mins <= 0) continue;
              byKeyAdd(jt, jid, uid, mins);
              userIds.add(uid);
            }
          }
        };

        await Promise.all([
          fetchIntervalsForType('task', enrichedRows.filter(r => r.jobType === 'task').map(r => r.jobId)),
          fetchIntervalsForType('shipment', enrichedRows.filter(r => r.jobType === 'shipment').map(r => r.jobId)),
          fetchIntervalsForType('stocktake', enrichedRows.filter(r => r.jobType === 'stocktake').map(r => r.jobId)),
        ]);

        // Resolve user names (best-effort)
        if (userIds.size > 0) {
          const ids = Array.from(userIds);
          const { data: userRows } = await (supabase.from('users') as any)
            .select('id, first_name, last_name, email')
            .in('id', ids);

          for (const u of userRows || []) {
            const uid = String(u.id || '');
            if (!uid) continue;
            nextUsers[uid] = {
              id: uid,
              name: displayNameFromUserRow(u),
              email: u?.email ? String(u.email) : null,
            };
          }
        }
      }

      // Attach labor cost + margin if requested and we have per-user minutes
      if (needIntervals) {
        const costByJobKey = new Map<string, number>();

        for (const [key, byUser] of Object.entries(nextJobUserMinutes)) {
          let cost = 0;
          for (const [uid, mins] of Object.entries(byUser || {})) {
            const rate = hourlyRateByUserId.get(uid) ?? 0;
            cost += (mins / 60) * rate;
          }
          costByJobKey.set(key, cost);
        }

        enrichedRows = enrichedRows.map((r) => {
          const key = jobKey(r.jobType, r.jobId);
          const cost = costByJobKey.get(key);
          const laborCost = includeLaborCost && cost != null ? cost : null;
          const margin =
            includeLaborCost
            && includeBillingTotals
            && laborCost != null
            && r.billedAmount != null
              ? r.billedAmount - laborCost
              : null;
          return { ...r, laborCost, margin };
        });
      } else {
        enrichedRows = enrichedRows.map((r) => ({ ...r, laborCost: null, margin: null }));
      }

      setRows(enrichedRows);
      setJobUserMinutes(nextJobUserMinutes);
      setUsersById(nextUsers);
      setJobUserMinutesLoaded(needIntervals);
    } catch (err: any) {
      console.error('[ServiceTimeTab] fetch error:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err?.message || 'Failed to load service time report',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    profile?.tenant_id,
    jobType,
    dateFrom,
    dateTo,
    accountFilter,
    warehouseFilter,
    includeBillingTotals,
    includeLaborCost,
    employeeFilter,
  ]);

  // Lazy-load per-employee interval details when the user opens the Employees tab,
  // without forcing a full refetch every time they click between tabs.
  useEffect(() => {
    if (!profile?.tenant_id) return;
    if (activeTab !== 'employees') return;
    if (includeLaborCost) return; // already triggers fetch via deps above
    if (employeeFilter !== 'all') return; // already triggers fetch via deps above
    if (jobUserMinutesLoaded) return; // already loaded (even if empty)
    void fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, profile?.tenant_id, includeLaborCost, employeeFilter, jobUserMinutesLoaded]);

  const computed = useMemo(() => {
    const filtered = rows.filter((r) => {
      if (jobType !== 'all' && r.jobType !== jobType) return false;
      if (onlyWithEstimate && !((r.estimatedMinutes ?? 0) > 0)) return false;
      if (onlyWithActual && !((r.actualMinutes ?? 0) > 0)) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const hay = `${r.label} ${r.subType || ''} ${r.jobId}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (employeeFilter !== 'all') {
        const key = jobKey(r.jobType, r.jobId);
        const mins = jobUserMinutes[key]?.[employeeFilter] || 0;
        if (mins <= 0) return false;
      }
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      const dir = sortDirection === 'asc' ? 1 : -1;
      const getComparable = (row: ServiceTimeRow) => {
        switch (sortField) {
          case 'completed_at':
            return row.completedAt ? new Date(row.completedAt).getTime() : 0;
          case 'job_type':
            return row.jobType;
          case 'estimated':
            return row.estimatedMinutes ?? -1;
          case 'actual':
            return row.actualMinutes ?? -1;
          case 'variance':
            return row.varianceMinutes ?? -999999;
          case 'billed':
            return row.billedAmount ?? -1;
          case 'labor_cost':
            return row.laborCost ?? -1;
          case 'margin':
            return row.margin ?? -999999999;
        }
      };

      const av = getComparable(a) as any;
      const bv = getComparable(b) as any;

      if (typeof av === 'number' && typeof bv === 'number') return dir * (av - bv);
      return dir * String(av).localeCompare(String(bv));
    });

    const totalEstimated = sorted.reduce((sum, r) => sum + (r.estimatedMinutes ?? 0), 0);
    const totalActual = sorted.reduce((sum, r) => sum + (r.actualMinutes ?? 0), 0);
    const totalBilled = sorted.reduce((sum, r) => sum + (r.billedAmount ?? 0), 0);
    const totalLaborCost = sorted.reduce((sum, r) => sum + (r.laborCost ?? 0), 0);
    const totalMargin = sorted.reduce((sum, r) => sum + (r.margin ?? 0), 0);
    const withEstimate = sorted.filter(r => (r.estimatedMinutes ?? 0) > 0).length;
    const withActual = sorted.filter(r => (r.actualMinutes ?? 0) > 0).length;

    return {
      rows: sorted,
      total: sorted.length,
      totalEstimated,
      totalActual,
      totalBilled,
      totalLaborCost,
      totalMargin,
      withEstimate,
      withActual,
      delta: totalEstimated > 0 && totalActual > 0 ? Math.round(totalActual - totalEstimated) : null,
    };
  }, [
    rows,
    jobType,
    sortDirection,
    sortField,
    onlyWithEstimate,
    onlyWithActual,
    searchQuery,
    employeeFilter,
    jobUserMinutes,
  ]);

  const employeeOptions = useMemo(() => {
    const ids = new Set<string>();
    for (const byUser of Object.values(jobUserMinutes)) {
      for (const uid of Object.keys(byUser || {})) ids.add(uid);
    }
    return Array.from(ids)
      .map((id) => ({ id, name: usersById[id]?.name || id }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [jobUserMinutes, usersById]);

  const employeeSelectOptions = useMemo<SelectOption[]>(() => {
    const opts: SelectOption[] = [{ value: 'all', label: 'All employees' }];
    for (const u of employeeOptions) {
      opts.push({ value: u.id, label: u.name });
    }
    return opts;
  }, [employeeOptions]);

  const employeesComputed = useMemo(() => {
    const byUser: Record<string, { minutes: number; jobs: Set<string>; billedShare: number; laborCost: number }> = {};

    for (const r of computed.rows) {
      const key = jobKey(r.jobType, r.jobId);
      const perUser = jobUserMinutes[key] || {};
      const totalJobMinutes = Object.values(perUser).reduce((sum, m) => sum + (m || 0), 0) || 0;

      for (const [uid, mins] of Object.entries(perUser)) {
        if (!uid) continue;
        if (!byUser[uid]) {
          byUser[uid] = { minutes: 0, jobs: new Set<string>(), billedShare: 0, laborCost: 0 };
        }
        byUser[uid].minutes += mins || 0;
        byUser[uid].jobs.add(key);

        const rate = hourlyRateByUserId.get(uid) ?? 0;
        byUser[uid].laborCost += (mins / 60) * rate;

        if (includeBillingTotals && (r.billedAmount ?? 0) > 0 && totalJobMinutes > 0) {
          byUser[uid].billedShare += (r.billedAmount ?? 0) * ((mins || 0) / totalJobMinutes);
        }
      }
    }

    const rows: EmployeeSummaryRow[] = Object.entries(byUser).map(([uid, agg]) => {
      const jobs = agg.jobs.size;
      const minutes = Math.round(agg.minutes);
      const laborCost = includeLaborCost ? agg.laborCost : null;
      const billedShare = includeBillingTotals ? agg.billedShare : null;
      const marginShare =
        includeBillingTotals && includeLaborCost && laborCost != null && billedShare != null
          ? billedShare - laborCost
          : null;

      return {
        userId: uid,
        name: usersById[uid]?.name || uid,
        jobs,
        minutes,
        laborCost,
        billedShare,
        marginShare,
        avgMinutesPerJob: jobs > 0 ? Math.round(minutes / jobs) : null,
      };
    });

    rows.sort((a, b) => (b.minutes || 0) - (a.minutes || 0));

    const totalMinutes = rows.reduce((sum, r) => sum + (r.minutes || 0), 0);
    const totalLaborCost = rows.reduce((sum, r) => sum + (r.laborCost ?? 0), 0);
    const totalBilledShare = rows.reduce((sum, r) => sum + (r.billedShare ?? 0), 0);
    const totalMarginShare = rows.reduce((sum, r) => sum + (r.marginShare ?? 0), 0);

    return { rows, totalMinutes, totalLaborCost, totalBilledShare, totalMarginShare };
  }, [computed.rows, jobUserMinutes, usersById, includeBillingTotals, includeLaborCost, hourlyRateByUserId]);

  const typeBreakdowns = useMemo(() => {
    type Agg = { type: string; jobs: number; minutes: number; billed: number; labor: number; margin: number };
    const taskMap = new Map<string, Agg>();
    const shipmentMap = new Map<string, Agg>();

    const add = (map: Map<string, Agg>, type: string, mins: number, billed: number, labor: number, margin: number) => {
      const key = type || 'Unspecified';
      const cur = map.get(key) || { type: key, jobs: 0, minutes: 0, billed: 0, labor: 0, margin: 0 };
      cur.jobs += 1;
      cur.minutes += mins;
      cur.billed += billed;
      cur.labor += labor;
      cur.margin += margin;
      map.set(key, cur);
    };

    for (const r of computed.rows) {
      const key = jobKey(r.jobType, r.jobId);
      const perUser = jobUserMinutes[key] || {};
      const totalJobMinutesFromIntervals = Object.values(perUser).reduce((sum, m) => sum + (m || 0), 0) || 0;

      const minutesForBreakdown =
        employeeFilter !== 'all'
          ? (perUser[employeeFilter] || 0)
          : (totalJobMinutesFromIntervals || (r.actualMinutes ?? 0));

      if (minutesForBreakdown <= 0) continue;

      const type = r.subType || 'Unspecified';

      const billed =
        includeBillingTotals && r.billedAmount != null
          ? (employeeFilter !== 'all' && totalJobMinutesFromIntervals > 0
              ? r.billedAmount * (minutesForBreakdown / totalJobMinutesFromIntervals)
              : r.billedAmount)
          : 0;

      const labor =
        includeLaborCost
          ? (employeeFilter !== 'all'
              ? ((minutesForBreakdown / 60) * (hourlyRateByUserId.get(employeeFilter) ?? 0))
              : (r.laborCost ?? 0))
          : 0;

      const margin =
        includeBillingTotals && includeLaborCost
          ? billed - labor
          : 0;

      if (r.jobType === 'task') add(taskMap, type, minutesForBreakdown, billed, labor, margin);
      if (r.jobType === 'shipment') add(shipmentMap, type, minutesForBreakdown, billed, labor, margin);
    }

    const toSorted = (map: Map<string, Agg>) =>
      Array.from(map.values())
        .map((a) => ({
          ...a,
          minutes: Math.round(a.minutes),
          avgMinutes: a.jobs > 0 ? Math.round(a.minutes / a.jobs) : 0,
        }))
        .sort((a, b) => (b.minutes || 0) - (a.minutes || 0));

    return {
      taskTypes: toSorted(taskMap),
      shipmentTypes: toSorted(shipmentMap),
    };
  }, [
    computed.rows,
    jobUserMinutes,
    employeeFilter,
    includeBillingTotals,
    includeLaborCost,
    hourlyRateByUserId,
  ]);

  const overviewByJobType = useMemo(() => {
    const base: Record<string, { jobType: string; jobs: number; actual: number; estimated: number; billed: number; labor: number; margin: number }> = {};
    for (const r of computed.rows) {
      const jt = r.jobType;
      if (!base[jt]) base[jt] = { jobType: jt, jobs: 0, actual: 0, estimated: 0, billed: 0, labor: 0, margin: 0 };
      base[jt].jobs += 1;
      base[jt].actual += r.actualMinutes ?? 0;
      base[jt].estimated += r.estimatedMinutes ?? 0;
      base[jt].billed += r.billedAmount ?? 0;
      base[jt].labor += r.laborCost ?? 0;
      base[jt].margin += r.margin ?? 0;
    }
    return Object.values(base).sort((a, b) => a.jobType.localeCompare(b.jobType));
  }, [computed.rows]);

  const trendData = useMemo(() => {
    const byDay = new Map<string, { day: string; label: string; actual: number; estimated: number; jobs: number }>();

    for (const r of computed.rows) {
      if (!r.completedAt) continue;
      const dt = new Date(r.completedAt);
      if (Number.isNaN(dt.getTime())) continue;

      const day = format(dt, 'yyyy-MM-dd');
      const label = format(dt, 'MMM d');

      const current = byDay.get(day) || { day, label, actual: 0, estimated: 0, jobs: 0 };

      const key = jobKey(r.jobType, r.jobId);
      const perUser = jobUserMinutes[key] || {};
      const actualMinutes =
        employeeFilter !== 'all'
          ? (perUser[employeeFilter] || 0)
          : (r.actualMinutes ?? 0);

      current.actual += actualMinutes || 0;
      current.estimated += r.estimatedMinutes ?? 0;
      current.jobs += 1;
      byDay.set(day, current);
    }

    return Array.from(byDay.values())
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((d) => ({
        ...d,
        actual: Math.round(d.actual),
        estimated: Math.round(d.estimated),
      }));
  }, [computed.rows, employeeFilter, jobUserMinutes]);

  const accountsComputed = useMemo(() => {
    return {
      rows: computeGroupSummaryRows({
        rows: computed.rows,
        getId: (r) => r.accountId,
        nameById: accountNameById,
        fallbackName: 'Account',
        includeBillingTotals,
        includeLaborCost,
      }),
    };
  }, [computed.rows, accountNameById, includeBillingTotals, includeLaborCost]);

  const warehousesComputed = useMemo(() => {
    return {
      rows: computeGroupSummaryRows({
        rows: computed.rows,
        getId: (r) => r.warehouseId,
        nameById: warehouseNameById,
        fallbackName: 'Warehouse',
        includeBillingTotals,
        includeLaborCost,
      }),
    };
  }, [computed.rows, warehouseNameById, includeBillingTotals, includeLaborCost]);

  const exportXlsx = async () => {
    try {
      const wb = new ExcelJS.Workbook();

      addJsonSheet(wb, [{
        date_from: dateFrom,
        date_to: dateTo,
        job_type: jobType,
        jobs: computed.total,
        estimated_minutes: computed.totalEstimated,
        actual_minutes: computed.totalActual,
        billed_total_usd: includeBillingTotals ? computed.totalBilled : null,
        labor_cost_usd: includeLaborCost ? computed.totalLaborCost : null,
        margin_usd: includeBillingTotals && includeLaborCost ? computed.totalMargin : null,
      }], 'Summary');

      addJsonSheet(wb, computed.rows.map(r => ({
        job_type: r.jobType,
        sub_type: r.subType,
        label: r.label,
        completed_at: r.completedAt,
        account: r.accountId ? (accountNameById.get(r.accountId) || r.accountId) : null,
        warehouse: r.warehouseId ? (warehouseNameById.get(r.warehouseId) || r.warehouseId) : null,
        estimated_minutes: r.estimatedMinutes,
        actual_minutes: r.actualMinutes,
        variance_minutes: r.varianceMinutes,
        billed_usd: includeBillingTotals ? r.billedAmount : null,
        labor_cost_usd: includeLaborCost ? r.laborCost : null,
        margin_usd: includeBillingTotals && includeLaborCost ? r.margin : null,
        url: r.url,
      })), 'Jobs');

      addJsonSheet(wb, employeesComputed.rows.map(e => ({
        employee: e.name,
        jobs: e.jobs,
        minutes: e.minutes,
        avg_minutes_per_job: e.avgMinutesPerJob,
        labor_cost_usd: includeLaborCost ? e.laborCost : null,
        billed_share_usd: includeBillingTotals ? e.billedShare : null,
        margin_share_usd: includeBillingTotals && includeLaborCost ? e.marginShare : null,
      })), 'Employees');

      addJsonSheet(wb, accountsComputed.rows.map(a => ({
        account: a.name,
        jobs: a.jobs,
        estimated_minutes: a.estimatedMinutes,
        actual_minutes: a.actualMinutes,
        billed_total_usd: includeBillingTotals ? a.billedTotal : null,
        billed_known_jobs: includeBillingTotals ? a.billedKnownJobs : null,
        labor_cost_usd: includeLaborCost ? a.laborCostTotal : null,
        labor_known_jobs: includeLaborCost ? a.laborKnownJobs : null,
        margin_usd: includeBillingTotals && includeLaborCost ? a.marginTotal : null,
        margin_known_jobs: includeBillingTotals && includeLaborCost ? a.marginKnownJobs : null,
      })), 'Accounts');

      addJsonSheet(wb, warehousesComputed.rows.map(w => ({
        warehouse: w.name,
        jobs: w.jobs,
        estimated_minutes: w.estimatedMinutes,
        actual_minutes: w.actualMinutes,
        billed_total_usd: includeBillingTotals ? w.billedTotal : null,
        billed_known_jobs: includeBillingTotals ? w.billedKnownJobs : null,
        labor_cost_usd: includeLaborCost ? w.laborCostTotal : null,
        labor_known_jobs: includeLaborCost ? w.laborKnownJobs : null,
        margin_usd: includeBillingTotals && includeLaborCost ? w.marginTotal : null,
        margin_known_jobs: includeBillingTotals && includeLaborCost ? w.marginKnownJobs : null,
      })), 'Warehouses');

      const fileName = `service_time_${dateFrom}_to_${dateTo}.xlsx`;
      await downloadWorkbook(wb, fileName);
      toast({ title: 'Exported', description: fileName });
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Export failed',
        description: err?.message || 'Unable to export report',
      });
    }
  };

  const drillToAccount = (id: string | null) => {
    if (!id) return;
    setAccountFilter(id);
    setActiveTab('jobs');
  };

  const drillToWarehouse = (id: string | null) => {
    if (!id) return;
    setWarehouseFilter(id);
    setActiveTab('jobs');
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                <MaterialIcon name="schedule" size="sm" />
                Service Time
              </CardTitle>
              <CardDescription>
                Estimated vs actual time, labor cost, and billing totals for completed work.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={computed.rows.length === 0}>
                    <MaterialIcon name="download" size="sm" className="mr-2" />
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => void exportXlsx()}>
                    Export Excel (.xlsx)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
                <MaterialIcon name="refresh" size="sm" className={loading ? 'animate-spin mr-2' : 'mr-2'} />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-6">
            <div className="space-y-1.5">
              <Label>Date from</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Date to</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label>Job type</Label>
              <Select value={jobType} onValueChange={(v) => setJobType(v as JobTypeFilter)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="task">Tasks</SelectItem>
                  <SelectItem value="shipment">Shipments</SelectItem>
                  <SelectItem value="stocktake">Stocktakes</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Account</Label>
              <SearchableSelect
                options={accountOptions}
                value={accountFilter}
                onChange={setAccountFilter}
                placeholder="All accounts"
                searchPlaceholder="Search accounts..."
                emptyText="No accounts found."
                recentKey="service-time-account-filter"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Warehouse</Label>
              <SearchableSelect
                options={warehouseOptions}
                value={warehouseFilter}
                onChange={setWarehouseFilter}
                placeholder="All warehouses"
                searchPlaceholder="Search warehouses..."
                emptyText="No warehouses found."
                recentKey="service-time-warehouse-filter"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Employee</Label>
              <SearchableSelect
                options={employeeSelectOptions}
                value={employeeFilter}
                onChange={setEmployeeFilter}
                placeholder="All employees"
                searchPlaceholder="Search employees..."
                emptyText="No employees found."
                recentKey="service-time-employee-filter"
                disabled={employeeOptions.length === 0}
              />
            </div>

            <div className="md:col-span-3 space-y-1.5">
              <Label>Search</Label>
              <Input
                placeholder="Search jobs (title / shipment # / id)…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="md:col-span-3 flex items-end gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <Switch checked={includeBillingTotals} onCheckedChange={setIncludeBillingTotals} />
                <span className="text-sm text-muted-foreground">Billing totals</span>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={includeLaborCost} onCheckedChange={setIncludeLaborCost} />
                <span className="text-sm text-muted-foreground">Labor cost</span>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={onlyWithEstimate} onCheckedChange={setOnlyWithEstimate} />
                <span className="text-sm text-muted-foreground">Only w/ estimate</span>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={onlyWithActual} onCheckedChange={setOnlyWithActual} />
                <span className="text-sm text-muted-foreground">Only w/ actual</span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="tabular-nums">
              Jobs: {computed.total}
            </Badge>
            <Badge variant="secondary" className="tabular-nums">
              Est: {formatMinutesShort(computed.totalEstimated)}
            </Badge>
            <Badge variant="secondary" className="tabular-nums">
              Actual: {formatMinutesShort(computed.totalActual)}
            </Badge>
            {includeBillingTotals && (
              <Badge variant="secondary" className="tabular-nums">
                Billed: {formatUsd(computed.totalBilled)}
              </Badge>
            )}
            {includeLaborCost && (
              <Badge variant="secondary" className="tabular-nums">
                Labor: {formatUsd(computed.totalLaborCost)}
              </Badge>
            )}
            {includeBillingTotals && includeLaborCost && (
              <Badge variant="outline" className="tabular-nums">
                Margin: {formatUsd(computed.totalMargin)}
              </Badge>
            )}
            {computed.delta != null && (
              <Badge variant="outline" className="tabular-nums">
                Variance: {computed.delta >= 0 ? '+' : '-'}{formatMinutesShort(Math.abs(computed.delta))}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ViewTab)}>
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="overview" className="gap-2">
            <MaterialIcon name="insights" size="sm" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="jobs" className="gap-2">
            <MaterialIcon name="list" size="sm" />
            Jobs
          </TabsTrigger>
          <TabsTrigger value="accounts" className="gap-2">
            <MaterialIcon name="business" size="sm" />
            Accounts
          </TabsTrigger>
          <TabsTrigger value="warehouses" className="gap-2">
            <MaterialIcon name="warehouse" size="sm" />
            Warehouses
          </TabsTrigger>
          <TabsTrigger value="employees" className="gap-2">
            <MaterialIcon name="group" size="sm" />
            Employees
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Actual minutes by job type</CardTitle>
                <CardDescription>Totals for the selected filters</CardDescription>
              </CardHeader>
              <CardContent className="h-[280px]">
                {overviewByJobType.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={overviewByJobType}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="jobType" tickFormatter={(v) => String(v).toUpperCase()} />
                      <YAxis />
                      <Tooltip formatter={(v) => formatMinutesShort(Number(v) || 0)} />
                      <Bar dataKey="actual" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    No data
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {includeBillingTotals && includeLaborCost ? 'Billed vs labor cost' : 'Estimated vs actual'}
                </CardTitle>
                <CardDescription>Grouped by job type</CardDescription>
              </CardHeader>
              <CardContent className="h-[280px]">
                {overviewByJobType.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={overviewByJobType}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="jobType" tickFormatter={(v) => String(v).toUpperCase()} />
                      <YAxis />
                      <Tooltip
                        formatter={(v) => (
                          includeBillingTotals && includeLaborCost
                            ? formatTooltipCurrency(v)
                            : formatMinutesShort(Number(v) || 0)
                        )}
                      />
                      {includeBillingTotals && includeLaborCost ? (
                        <>
                          <Bar dataKey="billed" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="labor" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />
                        </>
                      ) : (
                        <>
                          <Bar dataKey="estimated" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="actual" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                        </>
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    No data
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">
                  Service time trend
                </CardTitle>
                <CardDescription>
                  {employeeFilter !== 'all'
                    ? 'Actual minutes worked by the selected employee (per day).'
                    : 'Daily totals (actual vs estimated).'}
                </CardDescription>
              </CardHeader>
              <CardContent className="h-[320px]">
                {trendData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trendData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="label" />
                      <YAxis />
                      <Tooltip formatter={(v) => formatMinutesShort(Number(v) || 0)} />
                      {employeeFilter === 'all' && (
                        <Bar dataKey="estimated" fill="hsl(var(--muted-foreground))" radius={[4, 4, 0, 0]} />
                      )}
                      <Bar dataKey="actual" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    No data
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="jobs" className="mt-4 space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Jobs</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead role="button" onClick={() => handleSort('job_type')} className="whitespace-nowrap">
                      Type <SortIcon field="job_type" />
                    </TableHead>
                    <TableHead>Job</TableHead>
                    <TableHead className="whitespace-nowrap">Account</TableHead>
                    <TableHead className="whitespace-nowrap">Warehouse</TableHead>
                    <TableHead role="button" onClick={() => handleSort('completed_at')} className="whitespace-nowrap">
                      Completed <SortIcon field="completed_at" />
                    </TableHead>
                    <TableHead role="button" onClick={() => handleSort('estimated')} className="whitespace-nowrap">
                      Est <SortIcon field="estimated" />
                    </TableHead>
                    <TableHead role="button" onClick={() => handleSort('actual')} className="whitespace-nowrap">
                      Actual <SortIcon field="actual" />
                    </TableHead>
                    <TableHead role="button" onClick={() => handleSort('variance')} className="whitespace-nowrap">
                      Variance <SortIcon field="variance" />
                    </TableHead>
                    {includeBillingTotals && (
                      <TableHead role="button" onClick={() => handleSort('billed')} className="whitespace-nowrap text-right">
                        Billed <SortIcon field="billed" />
                      </TableHead>
                    )}
                    {includeLaborCost && (
                      <TableHead role="button" onClick={() => handleSort('labor_cost')} className="whitespace-nowrap text-right">
                        Labor <SortIcon field="labor_cost" />
                      </TableHead>
                    )}
                    {includeBillingTotals && includeLaborCost && (
                      <TableHead role="button" onClick={() => handleSort('margin')} className="whitespace-nowrap text-right">
                        Margin <SortIcon field="margin" />
                      </TableHead>
                    )}
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {computed.rows.map((r) => (
                    <TableRow key={`${r.jobType}:${r.jobId}`} className="hover:bg-muted/40">
                      <TableCell className="capitalize">{r.jobType}</TableCell>
                      <TableCell className="min-w-0">
                        <div className="truncate font-medium">{r.label}</div>
                        {r.subType && (
                          <div className="truncate text-xs text-muted-foreground">
                            {r.subType}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.accountId ? (accountNameById.get(r.accountId) || '-') : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.warehouseId ? (warehouseNameById.get(r.warehouseId) || '-') : '-'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">
                        {r.completedAt ? formatDateTimeShort(r.completedAt) : '-'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {r.estimatedMinutes != null && r.estimatedMinutes > 0 ? formatMinutesShort(r.estimatedMinutes) : '-'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {r.actualMinutes != null && r.actualMinutes > 0 ? formatMinutesShort(r.actualMinutes) : '-'}
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {r.varianceMinutes != null ? (
                          <span className={r.varianceMinutes > 0 ? 'text-red-500' : r.varianceMinutes < 0 ? 'text-green-500' : ''}>
                            {r.varianceMinutes > 0 ? '+' : r.varianceMinutes < 0 ? '-' : ''}{formatMinutesShort(Math.abs(r.varianceMinutes))}
                          </span>
                        ) : (
                          '-'
                        )}
                      </TableCell>
                      {includeBillingTotals && (
                        <TableCell className="whitespace-nowrap tabular-nums text-right">
                          {formatUsd(r.billedAmount)}
                        </TableCell>
                      )}
                      {includeLaborCost && (
                        <TableCell className="whitespace-nowrap tabular-nums text-right">
                          {formatUsd(r.laborCost)}
                        </TableCell>
                      )}
                      {includeBillingTotals && includeLaborCost && (
                        <TableCell className="whitespace-nowrap tabular-nums text-right">
                          {formatUsd(r.margin)}
                        </TableCell>
                      )}
                      <TableCell className="text-right">
                        <Button variant="ghost" size="sm" onClick={() => navigate(r.url)}>
                          Open
                          <MaterialIcon name="chevron_right" size="sm" className="ml-1" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}

                  {computed.rows.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={
                          9
                          + (includeBillingTotals ? 1 : 0)
                          + (includeLaborCost ? 1 : 0)
                          + (includeBillingTotals && includeLaborCost ? 1 : 0)
                        }
                        className="text-center text-muted-foreground py-10"
                      >
                        {loading ? 'Loading…' : 'No jobs found for this date range.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accounts" className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top accounts (actual minutes)</CardTitle>
                <CardDescription>Sorted by total actual minutes</CardDescription>
              </CardHeader>
              <CardContent className="h-[280px]">
                {accountsComputed.rows.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={accountsComputed.rows.slice(0, 10)}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" hide />
                      <YAxis />
                      <Tooltip formatter={(v) => formatMinutesShort(Number(v) || 0)} />
                      <Bar dataKey="actualMinutes" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    No data
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top accounts (margin)</CardTitle>
                <CardDescription>
                  Enable Billing totals + Labor cost to compute margin
                </CardDescription>
              </CardHeader>
              <CardContent className="h-[280px]">
                {includeBillingTotals && includeLaborCost && accountsComputed.rows.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={[...accountsComputed.rows]
                        .filter((a) => a.marginKnownJobs > 0)
                        .sort((a, b) => (b.marginTotal || 0) - (a.marginTotal || 0))
                        .slice(0, 10)}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" hide />
                      <YAxis />
                      <Tooltip formatter={(v) => formatTooltipCurrency(v)} />
                      <Bar dataKey="marginTotal" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    {includeBillingTotals && includeLaborCost ? 'No margin data' : 'Enable toggles to view margin'}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Accounts</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead className="text-right">Jobs</TableHead>
                    <TableHead className="text-right">Est</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    {includeBillingTotals && <TableHead className="text-right">Billed</TableHead>}
                    {includeLaborCost && <TableHead className="text-right">Labor</TableHead>}
                    {includeBillingTotals && includeLaborCost && <TableHead className="text-right">Margin</TableHead>}
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accountsComputed.rows.map((a) => {
                    const marginPct =
                      includeBillingTotals
                      && includeLaborCost
                      && a.marginKnownJobs > 0
                      && a.marginBilledTotal > 0
                        ? (a.marginTotal / a.marginBilledTotal) * 100
                        : null;

                    return (
                      <TableRow key={a.id || 'unassigned'} className="hover:bg-muted/40">
                        <TableCell className="font-medium">{a.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{a.jobs}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {a.estimatedMinutes > 0 ? formatMinutesShort(a.estimatedMinutes) : '-'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {a.actualMinutes > 0 ? formatMinutesShort(a.actualMinutes) : '-'}
                        </TableCell>
                        {includeBillingTotals && (
                          <TableCell className="text-right tabular-nums">
                            <div>{formatUsd(a.billedTotal)}</div>
                            <div className="text-xs text-muted-foreground">
                              Known: {a.billedKnownJobs}/{a.jobs}
                            </div>
                          </TableCell>
                        )}
                        {includeLaborCost && (
                          <TableCell className="text-right tabular-nums">
                            <div>{formatUsd(a.laborCostTotal)}</div>
                            <div className="text-xs text-muted-foreground">
                              Known: {a.laborKnownJobs}/{a.jobs}
                            </div>
                          </TableCell>
                        )}
                        {includeBillingTotals && includeLaborCost && (
                          <TableCell className="text-right tabular-nums">
                            <div>{formatUsd(a.marginTotal)}</div>
                            <div className="text-xs text-muted-foreground">
                              {marginPct != null ? `${marginPct.toFixed(1)}%` : '—'} • Known: {a.marginKnownJobs}/{a.jobs}
                            </div>
                          </TableCell>
                        )}
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!a.id}
                            onClick={() => drillToAccount(a.id)}
                          >
                            View jobs
                            <MaterialIcon name="chevron_right" size="sm" className="ml-1" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {accountsComputed.rows.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={
                          5
                          + (includeBillingTotals ? 1 : 0)
                          + (includeLaborCost ? 1 : 0)
                          + (includeBillingTotals && includeLaborCost ? 1 : 0)
                        }
                        className="text-center text-muted-foreground py-10"
                      >
                        {loading ? 'Loading…' : 'No accounts found for this filter set.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="warehouses" className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top warehouses (actual minutes)</CardTitle>
                <CardDescription>Sorted by total actual minutes</CardDescription>
              </CardHeader>
              <CardContent className="h-[280px]">
                {warehousesComputed.rows.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={warehousesComputed.rows.slice(0, 10)}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" hide />
                      <YAxis />
                      <Tooltip formatter={(v) => formatMinutesShort(Number(v) || 0)} />
                      <Bar dataKey="actualMinutes" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    No data
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top warehouses (margin)</CardTitle>
                <CardDescription>
                  Enable Billing totals + Labor cost to compute margin
                </CardDescription>
              </CardHeader>
              <CardContent className="h-[280px]">
                {includeBillingTotals && includeLaborCost && warehousesComputed.rows.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={[...warehousesComputed.rows]
                        .filter((w) => w.marginKnownJobs > 0)
                        .sort((a, b) => (b.marginTotal || 0) - (a.marginTotal || 0))
                        .slice(0, 10)}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" hide />
                      <YAxis />
                      <Tooltip formatter={(v) => formatTooltipCurrency(v)} />
                      <Bar dataKey="marginTotal" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    {includeBillingTotals && includeLaborCost ? 'No margin data' : 'Enable toggles to view margin'}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Warehouses</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Warehouse</TableHead>
                    <TableHead className="text-right">Jobs</TableHead>
                    <TableHead className="text-right">Est</TableHead>
                    <TableHead className="text-right">Actual</TableHead>
                    {includeBillingTotals && <TableHead className="text-right">Billed</TableHead>}
                    {includeLaborCost && <TableHead className="text-right">Labor</TableHead>}
                    {includeBillingTotals && includeLaborCost && <TableHead className="text-right">Margin</TableHead>}
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {warehousesComputed.rows.map((w) => {
                    const marginPct =
                      includeBillingTotals
                      && includeLaborCost
                      && w.marginKnownJobs > 0
                      && w.marginBilledTotal > 0
                        ? (w.marginTotal / w.marginBilledTotal) * 100
                        : null;

                    return (
                      <TableRow key={w.id || 'unassigned'} className="hover:bg-muted/40">
                        <TableCell className="font-medium">{w.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{w.jobs}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {w.estimatedMinutes > 0 ? formatMinutesShort(w.estimatedMinutes) : '-'}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {w.actualMinutes > 0 ? formatMinutesShort(w.actualMinutes) : '-'}
                        </TableCell>
                        {includeBillingTotals && (
                          <TableCell className="text-right tabular-nums">
                            <div>{formatUsd(w.billedTotal)}</div>
                            <div className="text-xs text-muted-foreground">
                              Known: {w.billedKnownJobs}/{w.jobs}
                            </div>
                          </TableCell>
                        )}
                        {includeLaborCost && (
                          <TableCell className="text-right tabular-nums">
                            <div>{formatUsd(w.laborCostTotal)}</div>
                            <div className="text-xs text-muted-foreground">
                              Known: {w.laborKnownJobs}/{w.jobs}
                            </div>
                          </TableCell>
                        )}
                        {includeBillingTotals && includeLaborCost && (
                          <TableCell className="text-right tabular-nums">
                            <div>{formatUsd(w.marginTotal)}</div>
                            <div className="text-xs text-muted-foreground">
                              {marginPct != null ? `${marginPct.toFixed(1)}%` : '—'} • Known: {w.marginKnownJobs}/{w.jobs}
                            </div>
                          </TableCell>
                        )}
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={!w.id}
                            onClick={() => drillToWarehouse(w.id)}
                          >
                            View jobs
                            <MaterialIcon name="chevron_right" size="sm" className="ml-1" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {warehousesComputed.rows.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={
                          5
                          + (includeBillingTotals ? 1 : 0)
                          + (includeLaborCost ? 1 : 0)
                          + (includeBillingTotals && includeLaborCost ? 1 : 0)
                        }
                        className="text-center text-muted-foreground py-10"
                      >
                        {loading ? 'Loading…' : 'No warehouses found for this filter set.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="employees" className="mt-4 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Top employees (minutes)</CardTitle>
                <CardDescription>Based on job_time_intervals for filtered jobs</CardDescription>
              </CardHeader>
              <CardContent className="h-[280px]">
                {employeesComputed.rows.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={employeesComputed.rows.slice(0, 10)}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" hide />
                      <YAxis />
                      <Tooltip formatter={(v) => formatMinutesShort(Number(v) || 0)} />
                      <Bar dataKey="minutes" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground">
                    No interval data (enable Labor cost or select Employees after refresh)
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Summary</CardTitle>
                <CardDescription>Employee totals for the current filter set</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary" className="tabular-nums">
                    Minutes: {formatMinutesShort(employeesComputed.totalMinutes)}
                  </Badge>
                  {includeLaborCost && (
                    <Badge variant="secondary" className="tabular-nums">
                      Labor: {formatUsd(employeesComputed.totalLaborCost)}
                    </Badge>
                  )}
                  {includeBillingTotals && (
                    <Badge variant="secondary" className="tabular-nums">
                      Billed (share): {formatUsd(employeesComputed.totalBilledShare)}
                    </Badge>
                  )}
                  {includeBillingTotals && includeLaborCost && (
                    <Badge variant="outline" className="tabular-nums">
                      Margin (share): {formatUsd(employeesComputed.totalMarginShare)}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Billed share is prorated by minutes per job (approximation).
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Employees</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead className="text-right">Jobs</TableHead>
                    <TableHead className="text-right">Minutes</TableHead>
                    <TableHead className="text-right">Avg / Job</TableHead>
                    {includeLaborCost && <TableHead className="text-right">Labor</TableHead>}
                    {includeBillingTotals && <TableHead className="text-right">Billed (share)</TableHead>}
                    {includeBillingTotals && includeLaborCost && <TableHead className="text-right">Margin (share)</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employeesComputed.rows.map((e) => (
                    <TableRow key={e.userId} className="hover:bg-muted/40">
                      <TableCell className="font-medium">{e.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{e.jobs}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatMinutesShort(e.minutes)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {e.avgMinutesPerJob != null ? formatMinutesShort(e.avgMinutesPerJob) : '-'}
                      </TableCell>
                      {includeLaborCost && (
                        <TableCell className="text-right tabular-nums">{formatUsd(e.laborCost)}</TableCell>
                      )}
                      {includeBillingTotals && (
                        <TableCell className="text-right tabular-nums">{formatUsd(e.billedShare)}</TableCell>
                      )}
                      {includeBillingTotals && includeLaborCost && (
                        <TableCell className="text-right tabular-nums">{formatUsd(e.marginShare)}</TableCell>
                      )}
                    </TableRow>
                  ))}

                  {employeesComputed.rows.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={
                          4
                          + (includeLaborCost ? 1 : 0)
                          + (includeBillingTotals ? 1 : 0)
                          + (includeBillingTotals && includeLaborCost ? 1 : 0)
                        }
                        className="text-center text-muted-foreground py-10"
                      >
                        {loading ? 'Loading…' : 'No employee data for this filter set.'}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Task types</CardTitle>
                <CardDescription>
                  {employeeFilter !== 'all'
                    ? `Based on minutes worked by ${usersById[employeeFilter]?.name || 'selected employee'}.`
                    : 'Based on total minutes across all employees.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Jobs</TableHead>
                      <TableHead className="text-right">Minutes</TableHead>
                      <TableHead className="text-right">Avg / Job</TableHead>
                      {includeBillingTotals && <TableHead className="text-right">Billed</TableHead>}
                      {includeLaborCost && <TableHead className="text-right">Labor</TableHead>}
                      {includeBillingTotals && includeLaborCost && <TableHead className="text-right">Margin</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {typeBreakdowns.taskTypes.map((t) => (
                      <TableRow key={`task:${t.type}`} className="hover:bg-muted/40">
                        <TableCell className="font-medium">{t.type}</TableCell>
                        <TableCell className="text-right tabular-nums">{t.jobs}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMinutesShort(t.minutes)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMinutesShort(t.avgMinutes)}</TableCell>
                        {includeBillingTotals && (
                          <TableCell className="text-right tabular-nums">{formatUsd(t.billed)}</TableCell>
                        )}
                        {includeLaborCost && (
                          <TableCell className="text-right tabular-nums">{formatUsd(t.labor)}</TableCell>
                        )}
                        {includeBillingTotals && includeLaborCost && (
                          <TableCell className="text-right tabular-nums">{formatUsd(t.margin)}</TableCell>
                        )}
                      </TableRow>
                    ))}

                    {typeBreakdowns.taskTypes.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={
                            4
                            + (includeBillingTotals ? 1 : 0)
                            + (includeLaborCost ? 1 : 0)
                            + (includeBillingTotals && includeLaborCost ? 1 : 0)
                          }
                          className="text-center text-muted-foreground py-10"
                        >
                          No task data in this filter set.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Shipment types</CardTitle>
                <CardDescription>
                  {employeeFilter !== 'all'
                    ? `Based on minutes worked by ${usersById[employeeFilter]?.name || 'selected employee'}.`
                    : 'Based on total minutes across all employees.'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Type</TableHead>
                      <TableHead className="text-right">Jobs</TableHead>
                      <TableHead className="text-right">Minutes</TableHead>
                      <TableHead className="text-right">Avg / Job</TableHead>
                      {includeBillingTotals && <TableHead className="text-right">Billed</TableHead>}
                      {includeLaborCost && <TableHead className="text-right">Labor</TableHead>}
                      {includeBillingTotals && includeLaborCost && <TableHead className="text-right">Margin</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {typeBreakdowns.shipmentTypes.map((t) => (
                      <TableRow key={`shipment:${t.type}`} className="hover:bg-muted/40">
                        <TableCell className="font-medium">{t.type}</TableCell>
                        <TableCell className="text-right tabular-nums">{t.jobs}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMinutesShort(t.minutes)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatMinutesShort(t.avgMinutes)}</TableCell>
                        {includeBillingTotals && (
                          <TableCell className="text-right tabular-nums">{formatUsd(t.billed)}</TableCell>
                        )}
                        {includeLaborCost && (
                          <TableCell className="text-right tabular-nums">{formatUsd(t.labor)}</TableCell>
                        )}
                        {includeBillingTotals && includeLaborCost && (
                          <TableCell className="text-right tabular-nums">{formatUsd(t.margin)}</TableCell>
                        )}
                      </TableRow>
                    ))}

                    {typeBreakdowns.shipmentTypes.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={
                            4
                            + (includeBillingTotals ? 1 : 0)
                            + (includeLaborCost ? 1 : 0)
                            + (includeBillingTotals && includeLaborCost ? 1 : 0)
                          }
                          className="text-center text-muted-foreground py-10"
                        >
                          No shipment data in this filter set.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

