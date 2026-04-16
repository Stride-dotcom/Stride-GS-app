import { useState, useEffect, useMemo } from 'react';
import { getRoleDisplayName } from '@/lib/roles';
import { format, startOfMonth, endOfMonth, subMonths, parseISO, startOfWeek } from 'date-fns';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWarehouses } from '@/hooks/useWarehouses';
import { useLaborSettings } from '@/hooks/useLaborSettings';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { SearchableSelect, type SelectOption } from '@/components/ui/searchable-select';
import { jsonToWorkbook, downloadWorkbook } from '@/lib/excelUtils';

interface WorkInterval {
  id: string;
  job_type: string;
  job_id: string;
  job_subtype: string | null;
  job_label: string | null;
  user_id: string;
  warehouse_id: string | null;
  ended_at: string | null;
  duration_minutes: number | null;
}

interface EmployeePayData {
  user_id: string;
  pay_type: string;
  pay_rate: number;
  salary_hourly_equivalent: number | null;
  overtime_eligible: boolean;
  primary_warehouse_id: string | null;
}

interface UserInfo {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
}

interface RoleInfo {
  user_id: string;
  role_name: string;
}

interface WarehouseRoleSummary {
  warehouse_id: string;
  warehouse_name: string;
  role: string;
  total_hours: number;
  regular_hours: number;
  overtime_hours: number;
  labor_cost: number;
  jobs_completed: number;
}

interface EmployeeSummary {
  user_id: string;
  name: string;
  roles: string[];
  total_hours: number;
  regular_hours: number;
  overtime_hours: number;
  total_cost: number;
  jobs_completed: number;
}

interface WorkTypeSummary {
  work_type: string;
  hours: number;
  cost: number;
  jobs: number;
}

export function LaborCostsTab() {
  const { profile } = useAuth();
  const { warehouses } = useWarehouses();
  const { settings: laborSettings, loading: laborSettingsLoading } = useLaborSettings();
  
  const [loading, setLoading] = useState(true);
  const [intervals, setIntervals] = useState<WorkInterval[]>([]);
  const [employeePay, setEmployeePay] = useState<EmployeePayData[]>([]);
  const [users, setUsers] = useState<UserInfo[]>([]);
  const [userRoles, setUserRoles] = useState<RoleInfo[]>([]);
  
  // Filters
  const [dateFrom, setDateFrom] = useState(() => format(startOfMonth(subMonths(new Date(), 1)), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(() => format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [selectedWarehouse, setSelectedWarehouse] = useState<string>('all');
  const [selectedRole, setSelectedRole] = useState<string>('all');
  const [selectedJobType, setSelectedJobType] = useState<string>('all');
  const [selectedSubtype, setSelectedSubtype] = useState<string>('all');
  const [selectedEmployee, setSelectedEmployee] = useState<string>('all');

  useEffect(() => {
    if (profile?.tenant_id) {
      fetchData();
    }
  }, [profile?.tenant_id, dateFrom, dateTo]);

  const fetchData = async () => {
    if (!profile?.tenant_id) return;
    setLoading(true);

    try {
      const startIso = `${dateFrom}T00:00:00`;
      const endIso = `${dateTo}T23:59:59`;

      // Fetch time intervals (source of truth for labor time)
      const { data: intervalData, error: intervalError } = await (supabase
        .from('job_time_intervals_report_v1') as any)
        .select('id, job_type, job_id, job_subtype, job_label, user_id, warehouse_id, ended_at, duration_minutes')
        .eq('tenant_id', profile.tenant_id)
        .not('ended_at', 'is', null)
        .gte('ended_at', startIso)
        .lte('ended_at', endIso);

      if (intervalError) throw intervalError;

      // Fetch employee pay data
      const { data: payData } = await supabase
        .from('employee_pay')
        .select('user_id, pay_type, pay_rate, salary_hourly_equivalent, overtime_eligible, primary_warehouse_id')
        .eq('tenant_id', profile.tenant_id);

      // Fetch users
      const { data: usersData } = await supabase
        .from('users')
        .select('id, first_name, last_name, email')
        .eq('tenant_id', profile.tenant_id)
        .is('deleted_at', null);

      // Fetch user roles
      const { data: rolesData } = await supabase
        .from('user_roles')
        .select('user_id, roles:role_id(name)')
        .is('deleted_at', null);

      setIntervals((intervalData || []) as WorkInterval[]);
      setEmployeePay((payData || []) as EmployeePayData[]);
      setUsers((usersData || []) as UserInfo[]);
      
      // Transform roles data
      const transformedRoles = (rolesData || []).map((r: any) => ({
        user_id: r.user_id,
        role_name: r.roles?.name || 'unknown',
      }));
      setUserRoles(transformedRoles);
    } catch (error) {
      console.error('Error fetching labor data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Helper to get user name
  const getUserName = (userId: string) => {
    const user = users.find(u => u.id === userId);
    if (!user) return 'Unknown';
    return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email;
  };

  // Get unique roles for filter
  const uniqueRoles = useMemo(() => {
    const roles = new Set(userRoles.map(r => r.role_name));
    return Array.from(roles).sort();
  }, [userRoles]);

  const roleOptions = useMemo<SelectOption[]>(() => {
    const opts: SelectOption[] = [{ value: 'all', label: 'All roles' }];
    for (const role of uniqueRoles) {
      opts.push({ value: role, label: role.replace(/_/g, ' ') });
    }
    return [
      opts[0],
      ...opts.slice(1).sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [uniqueRoles]);

  const uniqueJobTypes = useMemo(() => {
    const types = new Set((intervals || []).map((i) => i.job_type).filter(Boolean));
    return Array.from(types).sort();
  }, [intervals]);

  const jobTypeOptions = useMemo<SelectOption[]>(() => {
    const opts: SelectOption[] = [{ value: 'all', label: 'All job types' }];
    for (const type of uniqueJobTypes) {
      opts.push({ value: type, label: type.replace(/_/g, ' ') });
    }
    return [
      opts[0],
      ...opts.slice(1).sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [uniqueJobTypes]);

  const uniqueSubtypes = useMemo(() => {
    const types = new Set((intervals || []).map((i) => i.job_subtype).filter(Boolean) as string[]);
    return Array.from(types).sort();
  }, [intervals]);

  const subtypeOptions = useMemo<SelectOption[]>(() => {
    const opts: SelectOption[] = [
      { value: 'all', label: 'All subtypes' },
      { value: '__none__', label: 'Unspecified' },
    ];
    for (const type of uniqueSubtypes) {
      opts.push({ value: type, label: type.replace(/_/g, ' ') });
    }
    return [
      opts[0],
      opts[1],
      ...opts.slice(2).sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [uniqueSubtypes]);

  const warehouseOptions = useMemo<SelectOption[]>(() => {
    const opts: SelectOption[] = [{ value: 'all', label: 'All warehouses' }];
    for (const wh of warehouses) {
      opts.push({ value: wh.id, label: wh.name || 'Warehouse' });
    }
    return [
      opts[0],
      ...opts.slice(1).sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [warehouses]);

  const employeeOptions = useMemo<SelectOption[]>(() => {
    const opts: SelectOption[] = [{ value: 'all', label: 'All employees' }];
    for (const u of users) {
      opts.push({ value: u.id, label: getUserName(u.id) });
    }
    // Keep "All" on top; sort the rest
    return [
      opts[0],
      ...opts.slice(1).sort((a, b) => a.label.localeCompare(b.label)),
    ];
  }, [users]);

  // Helper to get user roles
  const getUserRoles = (userId: string) => {
    return userRoles.filter(r => r.user_id === userId).map(r => r.role_name);
  };

  // Helper to get employee pay
  const getEmployeePay = (userId: string) => {
    return employeePay.find(p => p.user_id === userId);
  };

  // Helper to get warehouse name
  const getWarehouseName = (warehouseId: string | null) => {
    if (!warehouseId) return 'Unassigned';
    const wh = warehouses.find(w => w.id === warehouseId);
    return wh?.name || 'Unknown';
  };

  // Calculate hourly rate for an employee
  const getHourlyRate = (userId: string) => {
    const pay = getEmployeePay(userId);
    if (!pay) return 0;
    
    if (pay.pay_type === 'hourly') {
      return pay.pay_rate;
    } else {
      // Salary - use salary_hourly_equivalent or calculate from annual / 2080
      return pay.salary_hourly_equivalent || (pay.pay_rate / 2080);
    }
  };

  const filteredIntervals = useMemo(() => {
    return (intervals || []).filter((i) => {
      const mins = typeof i.duration_minutes === 'number' ? i.duration_minutes : Number(i.duration_minutes);
      if (!Number.isFinite(mins) || mins <= 0) return false;
      if (!i.user_id) return false;

      if (selectedWarehouse !== 'all' && i.warehouse_id !== selectedWarehouse) return false;
      if (selectedEmployee !== 'all' && i.user_id !== selectedEmployee) return false;
      if (selectedJobType !== 'all' && i.job_type !== selectedJobType) return false;

      if (selectedSubtype !== 'all') {
        if (selectedSubtype === '__none__') {
          if (i.job_subtype) return false;
        } else if (i.job_subtype !== selectedSubtype) {
          return false;
        }
      }

      if (selectedRole !== 'all') {
        const roles = getUserRoles(i.user_id);
        if (!roles.includes(selectedRole)) return false;
      }

      return true;
    });
  }, [intervals, selectedWarehouse, selectedEmployee, selectedRole, selectedJobType, selectedSubtype, userRoles]);

  // Calculate overtime for each employee based on weekly hours (simplified proportional allocation)
  const calculateOvertimeByEmployee = useMemo(() => {
    const result: Record<string, { regular: number; overtime: number }> = {};
    const standardWeeklyMinutes = (laborSettings?.standard_workweek_hours || 40) * 60;

    const employeeWeeklyMinutes: Record<string, Record<string, number>> = {};

    intervals.forEach((it) => {
      const mins = typeof it.duration_minutes === 'number' ? it.duration_minutes : Number(it.duration_minutes);
      if (!Number.isFinite(mins) || mins <= 0) return;

      const userId = it.user_id;
      const pay = getEmployeePay(userId);
      if (!pay?.overtime_eligible) return;

      const dt = it.ended_at ? parseISO(it.ended_at) : new Date();
      const weekStart = format(startOfWeek(dt, { weekStartsOn: 0 }), 'yyyy-MM-dd');

      if (!employeeWeeklyMinutes[userId]) employeeWeeklyMinutes[userId] = {};
      employeeWeeklyMinutes[userId][weekStart] = (employeeWeeklyMinutes[userId][weekStart] || 0) + mins;
    });

    Object.entries(employeeWeeklyMinutes).forEach(([userId, weeks]) => {
      let totalRegular = 0;
      let totalOvertime = 0;

      Object.values(weeks).forEach((weekMinutes) => {
        if (weekMinutes > standardWeeklyMinutes) {
          totalRegular += standardWeeklyMinutes;
          totalOvertime += weekMinutes - standardWeeklyMinutes;
        } else {
          totalRegular += weekMinutes;
        }
      });

      result[userId] = { regular: totalRegular, overtime: totalOvertime };
    });

    return result;
  }, [intervals, employeePay, laborSettings]);

  // Calculate warehouse + role summary
  const warehouseRoleSummary = useMemo((): WarehouseRoleSummary[] => {
    const summaryMap: Record<string, WarehouseRoleSummary & { _jobKeys: Set<string> }> = {};
    const overtimeMultiplier = laborSettings?.overtime_multiplier || 1.5;

    filteredIntervals.forEach((it) => {
      const mins = typeof it.duration_minutes === 'number' ? it.duration_minutes : Number(it.duration_minutes);
      if (!Number.isFinite(mins) || mins <= 0) return;

      const userId = it.user_id;
      const warehouseId = it.warehouse_id || 'unassigned';
      const roles = getUserRoles(userId);
      const role = roles[0] || 'unknown';
      const key = `${warehouseId}-${role}`;

      if (!summaryMap[key]) {
        summaryMap[key] = {
          warehouse_id: warehouseId,
          warehouse_name: getWarehouseName(it.warehouse_id),
          role,
          total_hours: 0,
          regular_hours: 0,
          overtime_hours: 0,
          labor_cost: 0,
          jobs_completed: 0, // assigned after aggregation
          _jobKeys: new Set<string>(),
        };
      }

      const jobKey = `${it.job_type}:${it.job_id}`;
      summaryMap[key]._jobKeys.add(jobKey);

      const hours = mins / 60;
      const hourlyRate = getHourlyRate(userId);
      const overtimeData = calculateOvertimeByEmployee[userId];

      let regularHours = hours;
      let overtimeHours = 0;
      if (overtimeData && overtimeData.overtime > 0) {
        const totalEmployeeMinutes = overtimeData.regular + overtimeData.overtime;
        const overtimeRatio = totalEmployeeMinutes > 0 ? overtimeData.overtime / totalEmployeeMinutes : 0;
        overtimeHours = hours * overtimeRatio;
        regularHours = hours - overtimeHours;
      }

      const cost = (regularHours * hourlyRate) + (overtimeHours * hourlyRate * overtimeMultiplier);

      summaryMap[key].total_hours += hours;
      summaryMap[key].regular_hours += regularHours;
      summaryMap[key].overtime_hours += overtimeHours;
      summaryMap[key].labor_cost += cost;
    });

    return Object.values(summaryMap)
      .map((r) => {
        const { _jobKeys, ...rest } = r;
        return { ...rest, jobs_completed: _jobKeys.size };
      })
      .sort((a, b) => {
        if (a.warehouse_name !== b.warehouse_name) return a.warehouse_name.localeCompare(b.warehouse_name);
        return a.role.localeCompare(b.role);
      });
  }, [filteredIntervals, laborSettings, calculateOvertimeByEmployee, userRoles, warehouses, employeePay]);

  // Calculate employee summary
  const employeeSummary = useMemo((): EmployeeSummary[] => {
    const summaryMap: Record<string, EmployeeSummary & { _jobKeys: Set<string> }> = {};
    const overtimeMultiplier = laborSettings?.overtime_multiplier || 1.5;

    filteredIntervals.forEach((it) => {
      const mins = typeof it.duration_minutes === 'number' ? it.duration_minutes : Number(it.duration_minutes);
      if (!Number.isFinite(mins) || mins <= 0) return;

      const userId = it.user_id;
      if (!summaryMap[userId]) {
        summaryMap[userId] = {
          user_id: userId,
          name: getUserName(userId),
          roles: getUserRoles(userId),
          total_hours: 0,
          regular_hours: 0,
          overtime_hours: 0,
          total_cost: 0,
          jobs_completed: 0,
          _jobKeys: new Set<string>(),
        };
      }

      summaryMap[userId]._jobKeys.add(`${it.job_type}:${it.job_id}`);

      const hours = mins / 60;
      const hourlyRate = getHourlyRate(userId);
      const overtimeData = calculateOvertimeByEmployee[userId];

      let regularHours = hours;
      let overtimeHours = 0;
      if (overtimeData && overtimeData.overtime > 0) {
        const totalEmployeeMinutes = overtimeData.regular + overtimeData.overtime;
        const overtimeRatio = totalEmployeeMinutes > 0 ? overtimeData.overtime / totalEmployeeMinutes : 0;
        overtimeHours = hours * overtimeRatio;
        regularHours = hours - overtimeHours;
      }

      const cost = (regularHours * hourlyRate) + (overtimeHours * hourlyRate * overtimeMultiplier);

      summaryMap[userId].total_hours += hours;
      summaryMap[userId].regular_hours += regularHours;
      summaryMap[userId].overtime_hours += overtimeHours;
      summaryMap[userId].total_cost += cost;
    });

    return Object.values(summaryMap)
      .map((r) => {
        const { _jobKeys, ...rest } = r;
        return { ...rest, jobs_completed: _jobKeys.size };
      })
      .sort((a, b) => b.total_cost - a.total_cost);
  }, [filteredIntervals, laborSettings, calculateOvertimeByEmployee, userRoles, users, employeePay]);

  const workTypeSummary = useMemo((): WorkTypeSummary[] => {
    const summaryMap: Record<string, WorkTypeSummary & { _jobKeys: Set<string> }> = {};
    const overtimeMultiplier = laborSettings?.overtime_multiplier || 1.5;

    filteredIntervals.forEach((it) => {
      const mins = typeof it.duration_minutes === 'number' ? it.duration_minutes : Number(it.duration_minutes);
      if (!Number.isFinite(mins) || mins <= 0) return;

      const subtype = it.job_subtype ? it.job_subtype.replace(/_/g, ' ') : 'unspecified';
      const label = `${it.job_type.replace(/_/g, ' ')} • ${subtype}`;

      if (!summaryMap[label]) {
        summaryMap[label] = { work_type: label, hours: 0, cost: 0, jobs: 0, _jobKeys: new Set<string>() };
      }

      summaryMap[label]._jobKeys.add(`${it.job_type}:${it.job_id}`);

      const hours = mins / 60;
      let cost = 0;

      const hourlyRate = getHourlyRate(it.user_id);
      const overtimeData = calculateOvertimeByEmployee[it.user_id];

      let regularHours = hours;
      let overtimeHours = 0;
      if (overtimeData && overtimeData.overtime > 0) {
        const totalEmployeeMinutes = overtimeData.regular + overtimeData.overtime;
        const overtimeRatio = totalEmployeeMinutes > 0 ? overtimeData.overtime / totalEmployeeMinutes : 0;
        overtimeHours = hours * overtimeRatio;
        regularHours = hours - overtimeHours;
      }

      cost = (regularHours * hourlyRate) + (overtimeHours * hourlyRate * overtimeMultiplier);

      summaryMap[label].hours += hours;
      summaryMap[label].cost += cost;
    });

    return Object.values(summaryMap)
      .map((r) => {
        const { _jobKeys, ...rest } = r;
        return { ...rest, jobs: _jobKeys.size };
      })
      .sort((a, b) => b.cost - a.cost);
  }, [filteredIntervals, laborSettings, calculateOvertimeByEmployee, employeePay]);

  // Totals
  const totals = useMemo(() => {
    return {
      hours: warehouseRoleSummary.reduce((sum, row) => sum + row.total_hours, 0),
      cost: warehouseRoleSummary.reduce((sum, row) => sum + row.labor_cost, 0),
      jobs: new Set(filteredIntervals.map((it) => `${it.job_type}:${it.job_id}`)).size,
      employees: new Set(filteredIntervals.map((it) => it.user_id)).size,
    };
  }, [warehouseRoleSummary, filteredIntervals]);

  // CSV export functions
  const exportWarehouseRoleCSV = () => {
    const headers = ['Warehouse', 'Role', 'Total Hours', 'Regular Hours', 'Overtime Hours', 'Labor Cost', 'Jobs Completed'];
    const rows = warehouseRoleSummary.map(row => [
      row.warehouse_name,
      row.role,
      row.total_hours.toFixed(2),
      row.regular_hours.toFixed(2),
      row.overtime_hours.toFixed(2),
      row.labor_cost.toFixed(2),
      row.jobs_completed.toString(),
    ]);
    downloadCSV(headers, rows, 'labor-costs-by-warehouse-role.csv');
  };

  const exportEmployeeCSV = () => {
    const headers = ['Employee', 'Roles', 'Total Hours', 'Regular Hours', 'Overtime Hours', 'Total Cost', 'Jobs Completed'];
    const rows = employeeSummary.map(row => [
      row.name,
      row.roles.join(', '),
      row.total_hours.toFixed(2),
      row.regular_hours.toFixed(2),
      row.overtime_hours.toFixed(2),
      row.total_cost.toFixed(2),
      row.jobs_completed.toString(),
    ]);
    downloadCSV(headers, rows, 'labor-costs-by-employee.csv');
  };

  const exportWorkTypeCSV = () => {
    const headers = ['Work Type', 'Hours', 'Cost', 'Jobs'];
    const rows = workTypeSummary.map(row => [
      row.work_type,
      row.hours.toFixed(2),
      row.cost.toFixed(2),
      row.jobs.toString(),
    ]);
    downloadCSV(headers, rows, 'labor-costs-by-work-type.csv');
  };

  const exportWarehouseRoleXlsx = async () => {
    const { workbook } = jsonToWorkbook(
      warehouseRoleSummary.map((row) => ({
        warehouse: row.warehouse_name,
        role: row.role,
        total_hours: Number(row.total_hours.toFixed(2)),
        regular_hours: Number(row.regular_hours.toFixed(2)),
        overtime_hours: Number(row.overtime_hours.toFixed(2)),
        labor_cost_usd: Number(row.labor_cost.toFixed(2)),
        jobs_completed: row.jobs_completed,
      })),
      'Warehouse & Role'
    );
    await downloadWorkbook(workbook, `labor_costs_${dateFrom}_to_${dateTo}_warehouse_role.xlsx`);
  };

  const exportEmployeeXlsx = async () => {
    const { workbook } = jsonToWorkbook(
      employeeSummary.map((row) => ({
        employee: row.name,
        roles: row.roles.join(', '),
        total_hours: Number(row.total_hours.toFixed(2)),
        regular_hours: Number(row.regular_hours.toFixed(2)),
        overtime_hours: Number(row.overtime_hours.toFixed(2)),
        total_cost_usd: Number(row.total_cost.toFixed(2)),
        jobs_completed: row.jobs_completed,
      })),
      'Employees'
    );
    await downloadWorkbook(workbook, `labor_costs_${dateFrom}_to_${dateTo}_employees.xlsx`);
  };

  const exportWorkTypeXlsx = async () => {
    const { workbook } = jsonToWorkbook(
      workTypeSummary.map((row) => ({
        work_type: row.work_type,
        hours: Number(row.hours.toFixed(2)),
        cost_usd: Number(row.cost.toFixed(2)),
        jobs: row.jobs,
      })),
      'Work Types'
    );
    await downloadWorkbook(workbook, `labor_costs_${dateFrom}_to_${dateTo}_work_types.xlsx`);
  };

  const downloadCSV = (headers: string[], rows: string[][], filename: string) => {
    const csvContent = [headers.join(','), ...rows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  };

  if (loading || laborSettingsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Hours</CardTitle>
            <MaterialIcon name="schedule" size="sm" className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.hours.toFixed(1)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Labor Cost</CardTitle>
            <MaterialIcon name="attach_money" size="sm" className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totals.cost.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Jobs Completed</CardTitle>
            <MaterialIcon name="business" size="sm" className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.jobs}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Employees</CardTitle>
            <MaterialIcon name="group" size="sm" className="text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totals.employees}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-7">
            <div className="space-y-2">
              <Label>From Date</Label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>To Date</Label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Warehouse</Label>
              <SearchableSelect
                options={warehouseOptions}
                value={selectedWarehouse}
                onChange={setSelectedWarehouse}
                placeholder="All warehouses"
                searchPlaceholder="Search warehouses..."
                emptyText="No warehouses found."
                recentKey="labor-costs-warehouse-filter"
              />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <SearchableSelect
                options={roleOptions}
                value={selectedRole}
                onChange={setSelectedRole}
                placeholder="All roles"
                searchPlaceholder="Search roles..."
                emptyText="No roles found."
                recentKey="labor-costs-role-filter"
              />
            </div>
            <div className="space-y-2">
              <Label>Job Type</Label>
              <SearchableSelect
                options={jobTypeOptions}
                value={selectedJobType}
                onChange={setSelectedJobType}
                placeholder="All job types"
                searchPlaceholder="Search job types..."
                emptyText="No job types found."
                recentKey="labor-costs-job-type-filter"
              />
            </div>
            <div className="space-y-2">
              <Label>Subtype</Label>
              <SearchableSelect
                options={subtypeOptions}
                value={selectedSubtype}
                onChange={setSelectedSubtype}
                placeholder="All subtypes"
                searchPlaceholder="Search subtypes..."
                emptyText="No subtypes found."
                recentKey="labor-costs-subtype-filter"
              />
            </div>
            <div className="space-y-2">
              <Label>Employee</Label>
              <SearchableSelect
                options={employeeOptions}
                value={selectedEmployee}
                onChange={setSelectedEmployee}
                placeholder="All employees"
                searchPlaceholder="Search employees..."
                emptyText="No employees found."
                recentKey="labor-costs-employee-filter"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Data Tables */}
      <Tabs defaultValue="warehouse-role">
        <TabsList>
          <TabsTrigger value="warehouse-role">By Warehouse & Role</TabsTrigger>
          <TabsTrigger value="employee">By Employee</TabsTrigger>
          <TabsTrigger value="work-type">By Work Type</TabsTrigger>
        </TabsList>

        <TabsContent value="warehouse-role" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Labor Costs by Warehouse & Role</CardTitle>
                <CardDescription>Summary grouped by warehouse and employee role</CardDescription>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <MaterialIcon name="download" size="sm" className="mr-2" />
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={exportWarehouseRoleCSV}>Export CSV</DropdownMenuItem>
                  <DropdownMenuItem onClick={exportWarehouseRoleXlsx}>Export Excel (.xlsx)</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Warehouse</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="text-right">Total Hours</TableHead>
                    <TableHead className="text-right">Regular Hours</TableHead>
                    <TableHead className="text-right">Overtime Hours</TableHead>
                    <TableHead className="text-right">Labor Cost</TableHead>
                    <TableHead className="text-right">Jobs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {warehouseRoleSummary.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No data available for the selected filters
                      </TableCell>
                    </TableRow>
                  ) : (
                    warehouseRoleSummary.map((row, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-medium">{row.warehouse_name}</TableCell>
                        <TableCell>{getRoleDisplayName(row.role)}</TableCell>
                        <TableCell className="text-right">{row.total_hours.toFixed(1)}</TableCell>
                        <TableCell className="text-right">{row.regular_hours.toFixed(1)}</TableCell>
                        <TableCell className="text-right">{row.overtime_hours.toFixed(1)}</TableCell>
                        <TableCell className="text-right">${row.labor_cost.toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.jobs_completed}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="employee" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Labor Costs by Employee</CardTitle>
                <CardDescription>Individual employee labor breakdown</CardDescription>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <MaterialIcon name="download" size="sm" className="mr-2" />
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={exportEmployeeCSV}>Export CSV</DropdownMenuItem>
                  <DropdownMenuItem onClick={exportEmployeeXlsx}>Export Excel (.xlsx)</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Roles</TableHead>
                    <TableHead className="text-right">Jobs</TableHead>
                    <TableHead className="text-right">Total Hours</TableHead>
                    <TableHead className="text-right">Regular Hours</TableHead>
                    <TableHead className="text-right">Overtime Hours</TableHead>
                    <TableHead className="text-right">Total Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {employeeSummary.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        No data available for the selected filters
                      </TableCell>
                    </TableRow>
                  ) : (
                    employeeSummary.map((row) => (
                      <TableRow key={row.user_id}>
                        <TableCell className="font-medium">{row.name}</TableCell>
                        <TableCell>{row.roles.map(getRoleDisplayName).join(', ')}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.jobs_completed}</TableCell>
                        <TableCell className="text-right">{row.total_hours.toFixed(1)}</TableCell>
                        <TableCell className="text-right">{row.regular_hours.toFixed(1)}</TableCell>
                        <TableCell className="text-right">{row.overtime_hours.toFixed(1)}</TableCell>
                        <TableCell className="text-right">${row.total_cost.toFixed(2)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="work-type" className="mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>Labor Costs by Work Type</CardTitle>
                <CardDescription>Hours and costs by job type + subtype</CardDescription>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <MaterialIcon name="download" size="sm" className="mr-2" />
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={exportWorkTypeCSV}>Export CSV</DropdownMenuItem>
                  <DropdownMenuItem onClick={exportWorkTypeXlsx}>Export Excel (.xlsx)</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Work Type</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Jobs</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workTypeSummary.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        No data available for the selected filters
                      </TableCell>
                    </TableRow>
                  ) : (
                    workTypeSummary.map((row) => (
                      <TableRow key={row.work_type}>
                        <TableCell className="font-medium">{row.work_type}</TableCell>
                        <TableCell className="text-right">{row.hours.toFixed(1)}</TableCell>
                        <TableCell className="text-right">${row.cost.toFixed(2)}</TableCell>
                        <TableCell className="text-right tabular-nums">{row.jobs}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
