import { useState, useEffect, useRef, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/ui/page-header';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useTasks, useTaskTypes, Task } from '@/hooks/useTasks';
import { useWarehouses } from '@/hooks/useWarehouses';
import { AccountSelect } from '@/components/ui/account-select';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/hooks/use-toast';
import { useSelectedWarehouse } from '@/contexts/WarehouseContext';
import { formatMinutesShort } from '@/lib/time/serviceTimeEstimate';
import { resolveActiveJobLabel } from '@/lib/time/resolveActiveJobLabel';
import { TaskDialog } from '@/components/tasks/TaskDialog';
import { UnableToCompleteDialog } from '@/components/tasks/UnableToCompleteDialog';
import { WillCallCompletionDialog } from '@/components/tasks/WillCallCompletionDialog';
import { TaskCompletionBlockedDialog } from '@/components/tasks/TaskCompletionBlockedDialog';
import { format } from 'date-fns';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { validateTaskCompletion, TaskCompletionValidationResult } from '@/lib/billing/taskCompletionValidation';
import { fetchTaskServiceLinesStatic } from '@/hooks/useTaskServiceLines';

// Status text classes for bold colored text without background
const getStatusTextClass = (status: string) => {
  switch (status) {
    case 'pending':
      return 'font-bold text-orange-500 dark:text-orange-400';
    case 'in_progress':
      return 'font-bold text-yellow-500 dark:text-yellow-400';
    case 'completed':
      return 'font-bold text-green-500 dark:text-green-400';
    case 'unable_to_complete':
      return 'font-bold text-red-500 dark:text-red-400';
    case 'cancelled':
      return 'font-bold text-gray-500 dark:text-gray-400';
    default:
      return '';
  }
};

const statusEmojis: Record<string, string> = {
  pending: '🕒',
  in_progress: '🔄',
  completed: '✅',
  unable_to_complete: '❌',
  cancelled: '🚫',
};

const statusLabels: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  unable_to_complete: 'Unable to Complete',
  cancelled: 'Cancelled',
};

const priorityColors: Record<string, string> = {
  normal: 'bg-slate-100 text-slate-800 dark:bg-slate-900/30 dark:text-slate-400',
  urgent: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
};

export default function Tasks() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { toast } = useToast();
  const { hasRole, isAdmin } = usePermissions();
  const { warehouses } = useWarehouses();
  const { selectedWarehouseId } = useSelectedWarehouse();
  const { taskTypes } = useTaskTypes();
  const [searchParams, setSearchParams] = useSearchParams();

  // Check if user is a technician (repair tech with limited access)
  const isTechnician = hasRole('technician') && !hasRole('warehouse_user') && !isAdmin;

  const [filters, setFilters] = useState(() => ({
    status: searchParams.get('status') || 'all',
    taskType: searchParams.get('type') || 'all',
    warehouseId: 'all',
    accountId: 'all',
  }));

  // If this tenant only has one warehouse, default the filter to it once.
  // (Keep the selector visible; user can still switch back to "All" if desired.)
  const didAutoDefaultWarehouseFilter = useRef(false);
  useEffect(() => {
    if (didAutoDefaultWarehouseFilter.current) return;
    if (warehouses.length !== 1) return;
    if (filters.warehouseId !== 'all') return;

    didAutoDefaultWarehouseFilter.current = true;
    setFilters((f) => ({ ...f, warehouseId: selectedWarehouseId || warehouses[0].id }));
  }, [warehouses, selectedWarehouseId, filters.warehouseId]);

  // Sync filters from URL params when they change (e.g. Dashboard tile click)
  // Also auto-open dialog when new=true param is present
  useEffect(() => {
    const urlStatus = searchParams.get('status');
    const urlType = searchParams.get('type');
    const isNew = searchParams.get('new') === 'true';

    if (urlStatus || urlType) {
      setFilters(f => ({
        ...f,
        status: urlStatus || f.status,
        taskType: urlType || f.taskType,
      }));
    }

    // Auto-open task creation dialog when new=true
    if (isNew && urlType) {
      setEditingTask(null);
      setPreSelectedTaskType(urlType);
      setDialogOpen(true);
      // Clear the 'new' param from URL to prevent re-opening on refresh
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('new');
      setSearchParams(newParams, { replace: true });
    }
  }, [searchParams]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<string>('due_date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [preSelectedTaskType, setPreSelectedTaskType] = useState<string | undefined>(undefined);
  const [unableToCompleteTask, setUnableToCompleteTask] = useState<Task | null>(null);
  const [willCallTask, setWillCallTask] = useState<Task | null>(null);
  const [willCallItems, setWillCallItems] = useState<Array<{ id: string; item_code: string; description: string | null }>>([]);
  const [completionBlockedOpen, setCompletionBlockedOpen] = useState(false);
  const [completionValidationResult, setCompletionValidationResult] = useState<TaskCompletionValidationResult | null>(null);

  const getDisplayStatus = (task: Task): { status: string; label: string } => {
    const baseLabel = statusLabels[task.status] || task.status;
    if (['completed', 'unable_to_complete', 'cancelled'].includes(task.status)) {
      return { status: task.status, label: baseLabel };
    }

    const meta = task.metadata && typeof task.metadata === 'object' ? task.metadata : null;
    const pendingReview = !!(meta && (meta as any).pending_review === true);
    if (pendingReview) {
      return { status: 'pending_review', label: 'Pending review' };
    }

    const splitRequired = !!(meta && (meta as any).split_required === true);
    if (splitRequired && task.task_type !== 'Split') {
      return { status: 'waiting_split', label: 'Waiting for split' };
    }

    return { status: task.status, label: baseLabel };
  };

  // Fetch ALL tasks for stable tile counts (no filters, but respect technician filter)
  const { tasks: allTasks } = useTasks({
    // Technicians only see their assigned tasks
    assignedTo: isTechnician ? profile?.id : undefined,
  });

  // Fetch filtered tasks for the table
  const {
    tasks,
    loading,
    isRefetching,
    refetch,
    startTaskDetailed,
    completeTask,
    markUnableToComplete,
    claimTask,
    updateTaskStatus,
    deleteTask,
    getTaskItems,
  } = useTasks({
    status: filters.status === 'all' ? undefined : filters.status,
    taskType: filters.taskType === 'all' ? undefined : filters.taskType,
    warehouseId: filters.warehouseId === 'all' ? undefined : filters.warehouseId,
    accountId: filters.accountId === 'all' ? undefined : filters.accountId,
    // Technicians only see their assigned tasks
    assignedTo: isTechnician ? profile?.id : undefined,
  });

  const taskTypeFilterOptions = useMemo(() => {
    const orderedTypes: string[] = [];
    const seenLower = new Set<string>();
    const addType = (name: string | null | undefined) => {
      const trimmed = typeof name === 'string' ? name.trim() : '';
      if (!trimmed) return;
      const lower = trimmed.toLowerCase();
      if (seenLower.has(lower)) return;
      seenLower.add(lower);
      orderedTypes.push(trimmed);
    };

    taskTypes.forEach((type) => addType(type.name));
    allTasks.forEach((task) => addType(task.task_type));
    // Keep Split visible in filters even when task_types doesn't have a row for it yet.
    addType('Split');

    return orderedTypes;
  }, [taskTypes, allTasks]);

  // Start-task switch confirmation (pause existing job)
  const [startSwitchOpen, setStartSwitchOpen] = useState(false);
  const [startSwitchTask, setStartSwitchTask] = useState<Task | null>(null);
  const [activeJobLabel, setActiveJobLabel] = useState<string | null>(null);
  const [startSwitchLoading, setStartSwitchLoading] = useState(false);

  const handleStartTaskClick = async (task: Task) => {
    if (!profile?.tenant_id) return;
    setStartSwitchLoading(true);
    try {
      const result = await startTaskDetailed(task.id, { pauseExisting: false });
      if (result.ok) {
        toast({ title: 'Task Started', description: 'Task is now in progress.' });
        return;
      }

      if (result.error_code === 'ACTIVE_TIMER_EXISTS') {
        setStartSwitchTask(task);
        setActiveJobLabel(await resolveActiveJobLabel(profile?.tenant_id, result.active_job_type, result.active_job_id));
        setStartSwitchOpen(true);
        return;
      }

      toast({
        variant: 'destructive',
        title: 'Error',
        description: result.error_message || 'Failed to start task',
      });
    } finally {
      setStartSwitchLoading(false);
    }
  };

  // Filter tasks locally for search (avoid refetch on search)
  const filteredTasks = tasks
    .filter(task =>
      task.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      task.task_type.toLowerCase().includes(searchQuery.toLowerCase())
    )
    .sort((a, b) => {
      // Special handling for due_date: nulls go to end when sorting asc (nearest first)
      if (sortField === 'due_date') {
        const aDate = a.due_date;
        const bDate = b.due_date;
        if (!aDate && !bDate) return 0;
        if (!aDate) return 1; // nulls at end
        if (!bDate) return -1;
        const cmp = aDate.localeCompare(bDate);
        return sortDirection === 'asc' ? cmp : -cmp;
      }

      let aVal: any = '';
      let bVal: any = '';
      switch (sortField) {
        case 'title': aVal = a.title; bVal = b.title; break;
        case 'task_type': aVal = a.task_type; bVal = b.task_type; break;
        case 'status': aVal = a.status; bVal = b.status; break;
        case 'priority': aVal = a.priority || ''; bVal = b.priority || ''; break;
        case 'assigned_to':
          aVal = a.assigned_user ? `${a.assigned_user.first_name} ${a.assigned_user.last_name}` : '';
          bVal = b.assigned_user ? `${b.assigned_user.first_name} ${b.assigned_user.last_name}` : '';
          break;
        default: aVal = a.created_at; bVal = b.created_at; break;
      }
      const cmp = String(aVal).localeCompare(String(bVal));
      return sortDirection === 'asc' ? cmp : -cmp;
    });

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const SortIndicator = ({ field }: { field: string }) => (
    sortField === field ? <span className="ml-1">{sortDirection === 'asc' ? '▲' : '▼'}</span> : null
  );

  // Use ALL tasks for stable tile counts (not affected by filters)
  const stats = {
    inQueue: allTasks.filter(t => t.status === 'pending').length,
    inProgress: allTasks.filter(t => t.status === 'in_progress').length,
    completed: allTasks.filter(t => t.status === 'completed').length,
    overdue: allTasks.filter(t =>
      t.status !== 'completed' &&
      t.status !== 'unable_to_complete' &&
      t.status !== 'cancelled' &&
      t.due_date &&
      new Date(t.due_date.substring(0, 10) + 'T12:00:00') < new Date()
    ).length,
  };

  const handleEdit = (task: Task) => {
    setEditingTask(task);
    setDialogOpen(true);
  };

  const handleCreate = (taskType?: string) => {
    setEditingTask(null);
    setPreSelectedTaskType(taskType);
    setDialogOpen(true);
  };

  const handleDialogSuccess = (createdTaskId?: string) => {
    setDialogOpen(false);
    setEditingTask(null);
    setPreSelectedTaskType(undefined);
    
    // Navigate to task detail if a new task was created
    if (createdTaskId) {
      navigate(`/tasks/${createdTaskId}`);
    } else {
      refetch();
    }
  };

  const handleUnableToComplete = async (note: string) => {
    if (!unableToCompleteTask) return false;
    const success = await markUnableToComplete(unableToCompleteTask.id, note);
    if (success) {
      setUnableToCompleteTask(null);
    }
    return success;
  };

  // Handle Will Call completion
  const handleCompleteClick = async (task: Task) => {
    // Phase 5B: Validate task completion requirements
    if (profile?.tenant_id) {
      const validationResult = await validateTaskCompletion(
        profile.tenant_id,
        task.id,
        task.task_type
      );

      if (!validationResult.canComplete) {
        // Show blocking dialog with validation issues
        setCompletionValidationResult(validationResult);
        setCompletionBlockedOpen(true);
        return;
      }

      // Phase 2: Validate at least 1 service line exists
      const serviceLineCount = (await fetchTaskServiceLinesStatic(task.id, profile.tenant_id)).length;
      if (serviceLineCount === 0) {
        toast({
          variant: 'destructive',
          title: 'Services Required',
          description: 'Open this task to add services before completing.',
        });
        // Navigate to task detail page where they can add services
        navigate(`/tasks/${task.id}`);
        return;
      }
    }

    if (task.task_type === 'Will Call') {
      // Fetch items for this task
      const items = await getTaskItems(task.id);
      setWillCallItems(items);
      setWillCallTask(task);
    } else {
      // Navigate to task detail for completion panel (service line qty/time confirmation)
      navigate(`/tasks/${task.id}`);
    }
  };

  const handleWillCallComplete = async (pickupName: string) => {
    if (!willCallTask) return false;
    const success = await completeTask(willCallTask.id, pickupName);
    if (success) {
      setWillCallTask(null);
      setWillCallItems([]);
    }
    return success;
  };

  // Only show full loading on initial load when there's no data yet
  const showInitialLoading = loading && tasks.length === 0;

  // Render action buttons based on task status
  const renderActionButtons = (task: Task) => {
    const buttons = [];

    if (task.status === 'pending') {
      buttons.push(
        <Button
          key="start"
          size="sm"
          variant="outline"
          onClick={() => handleStartTaskClick(task)}
          disabled={startSwitchLoading}
          className="h-7 px-2 text-xs"
        >
          <span className="mr-1">▶️</span>
          Start
        </Button>
      );
    }

    if (task.status === 'in_progress') {
      buttons.push(
        <Button
          key="complete"
          size="sm"
          variant="default"
          onClick={() => handleCompleteClick(task)}
          className="h-7 px-2 text-xs"
        >
          <span className="mr-1">✅</span>
          Complete
        </Button>,
        <Button
          key="unable"
          size="sm"
          variant="destructive"
          onClick={() => setUnableToCompleteTask(task)}
          className="h-7 px-2 text-xs"
        >
          <span className="mr-1">❌</span>
          Unable
        </Button>
      );
    }

    return buttons.length > 0 ? (
      <div className="flex gap-1">{buttons}</div>
    ) : null;
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <PageHeader
            primaryText={isTechnician ? "My" : "Operations"}
            accentText={isTechnician ? "Tasks" : "Queue"}
            description={isTechnician ? "View and complete your assigned tasks" : "Manage inspections, assemblies, repairs, and other tasks"}
          />
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={refetch}
              disabled={isRefetching}
              className="w-full sm:w-auto justify-center"
              title="Refresh tasks"
            >
              <MaterialIcon
                name={isRefetching ? "sync" : "refresh"}
                size="sm"
                className={isRefetching ? "mr-2 animate-spin" : "mr-2"}
              />
              Refresh
            </Button>

            {!isTechnician && (
              <Button onClick={() => handleCreate()} className="w-full sm:w-auto justify-center">
                <span className="mr-2">➕</span>
                Create Task
              </Button>
            )}
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setFilters(f => ({ ...f, status: 'pending' }))}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="emoji-tile emoji-tile-lg bg-card border border-border shadow-sm rounded-lg">
                  🕒
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.inQueue}</p>
                  <p className="text-sm text-muted-foreground">In Queue</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setFilters(f => ({ ...f, status: 'in_progress' }))}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="emoji-tile emoji-tile-lg bg-card border border-border shadow-sm rounded-lg">
                  🔄
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.inProgress}</p>
                  <p className="text-sm text-muted-foreground">In Progress</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={() => setFilters(f => ({ ...f, status: 'completed' }))}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="emoji-tile emoji-tile-lg bg-card border border-border shadow-sm rounded-lg">
                  ✅
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.completed}</p>
                  <p className="text-sm text-muted-foreground">Completed</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="cursor-pointer hover:shadow-md transition-shadow">
            <CardContent className="pt-6">
              <div className="flex items-center gap-4">
                <div className="emoji-tile emoji-tile-lg bg-card border border-border shadow-sm rounded-lg">
                  🚨
                </div>
                <div>
                  <p className="text-2xl font-bold">{stats.overdue}</p>
                  <p className="text-sm text-muted-foreground">Overdue</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-wrap sm:items-center">
          <div className="relative col-span-2 sm:flex-1 sm:max-w-sm">
            <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={filters.status} onValueChange={(value) => setFilters(f => ({ ...f, status: value }))}>
            <SelectTrigger className="w-full sm:w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="in_progress">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="unable_to_complete">Unable to Complete</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filters.taskType} onValueChange={(value) => setFilters(f => ({ ...f, taskType: value }))}>
            <SelectTrigger className="w-full sm:w-[150px]">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {taskTypeFilterOptions.map((taskTypeName) => (
                <SelectItem key={taskTypeName} value={taskTypeName}>{taskTypeName}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="col-span-2 sm:col-span-auto">
            <Select value={filters.warehouseId} onValueChange={(value) => setFilters(f => ({ ...f, warehouseId: value }))}>
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Warehouse" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Warehouses</SelectItem>
                {warehouses.map(wh => (
                  <SelectItem key={wh.id} value={wh.id}>{wh.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2 sm:col-span-auto">
            <AccountSelect
              value={filters.accountId === 'all' ? '' : filters.accountId}
              onChange={(value) => setFilters(f => ({ ...f, accountId: value || 'all' }))}
              placeholder="All Accounts"
              clearable
              className="w-full sm:w-[200px]"
            />
          </div>

          {/* Refresh moved to header to match Dashboard */}
        </div>

        {/* Tasks Table */}
        <Card className="relative">
          {/* Subtle loading overlay for refetching */}
          {isRefetching && (
            <div className="absolute inset-0 bg-background/50 flex items-center justify-center z-10 rounded-lg">
              <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
            </div>
          )}
          
          {showInitialLoading ? (
            <CardContent className="flex items-center justify-center h-48">
              <MaterialIcon name="progress_activity" size="xl" className="animate-spin text-muted-foreground" />
            </CardContent>
          ) : (
            <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort('title')}>
                    Task<SortIndicator field="title" />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort('task_type')}>
                    Type<SortIndicator field="task_type" />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort('status')}>
                    Status<SortIndicator field="status" />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort('priority')}>
                    Priority<SortIndicator field="priority" />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort('due_date')}>
                    Due Date<SortIndicator field="due_date" />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort('created_at')}>
                    Date Added<SortIndicator field="created_at" />
                  </TableHead>
                  <TableHead className="cursor-pointer select-none" onClick={() => handleSort('assigned_to')}>
                    Assigned To<SortIndicator field="assigned_to" />
                  </TableHead>
                  <TableHead>
                    Actual Time
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTasks.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-12">
                      <div className="flex flex-col items-center gap-2">
                        <div className="text-5xl opacity-30">📝</div>
                        <p className="text-muted-foreground font-medium">
                          {searchQuery || filters.status !== 'all' || filters.taskType !== 'all' || filters.warehouseId !== 'all'
                            ? 'No tasks match your filters'
                            : 'No tasks yet'}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {searchQuery || filters.status !== 'all' || filters.taskType !== 'all' || filters.warehouseId !== 'all'
                            ? 'Try adjusting your search or filter criteria'
                            : 'Click "Create Task" to get started'}
                        </p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredTasks.map((task) => (
                    <TableRow
                      key={task.id}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/tasks/${task.id}`)}
                    >
                      <TableCell className="font-medium">
                        {task.title}
                        {task.description && (
                          <p className="text-sm text-muted-foreground truncate max-w-[200px]">
                            {task.description}
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{task.task_type}</Badge>
                      </TableCell>
                      <TableCell>
                        {(() => {
                          const d = getDisplayStatus(task);
                          return <StatusIndicator status={d.status} label={d.label} size="sm" />;
                        })()}
                      </TableCell>
                      <TableCell>
                        <StatusIndicator
                          status={task.priority === 'urgent' ? 'failed' : 'in_progress'}
                          label={task.priority === 'urgent' ? 'Urgent' : 'Normal'}
                          size="sm"
                        />
                      </TableCell>
                      <TableCell>
                        {task.due_date ? (
                          <span className={
                            new Date(task.due_date.substring(0, 10) + 'T12:00:00') < new Date() &&
                            task.status !== 'completed' &&
                            task.status !== 'unable_to_complete'
                              ? 'text-red-600 font-medium'
                              : ''
                          }>
                            {format(new Date(task.due_date.substring(0, 10) + 'T12:00:00'), 'MMM d, yyyy')}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {task.created_at ? (
                          <span className="text-muted-foreground">
                            {format(new Date(task.created_at), 'MMM d, yyyy')}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {task.assigned_user ? (
                          <span>
                            {task.assigned_user.first_name} {task.assigned_user.last_name}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {task.duration_minutes != null && task.duration_minutes > 0 ? (
                          <span className="tabular-nums whitespace-nowrap">
                            {formatMinutesShort(task.duration_minutes)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            </CardContent>
          )}
        </Card>
      </div>

      <TaskDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        task={editingTask}
        preSelectedTaskType={preSelectedTaskType}
        onSuccess={handleDialogSuccess}
      />

      <UnableToCompleteDialog
        open={!!unableToCompleteTask}
        onOpenChange={(open) => !open && setUnableToCompleteTask(null)}
        taskTitle={unableToCompleteTask?.title || ''}
        onConfirm={handleUnableToComplete}
      />

      <WillCallCompletionDialog
        open={!!willCallTask}
        onOpenChange={(open) => {
          if (!open) {
            setWillCallTask(null);
            setWillCallItems([]);
          }
        }}
        taskTitle={willCallTask?.title || ''}
        items={willCallItems}
        onComplete={handleWillCallComplete}
      />

      <TaskCompletionBlockedDialog
        open={completionBlockedOpen}
        onOpenChange={setCompletionBlockedOpen}
        validationResult={completionValidationResult}
      />

      {/* Pause existing job confirmation */}
      <AlertDialog open={startSwitchOpen} onOpenChange={setStartSwitchOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause current job?</AlertDialogTitle>
            <AlertDialogDescription>
              It looks like you already have a job in progress{activeJobLabel ? ` (${activeJobLabel})` : ''}.
              Do you want to pause it and start this task?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setStartSwitchTask(null);
                setActiveJobLabel(null);
              }}
              disabled={startSwitchLoading}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async (e) => {
                e.preventDefault();
                if (!startSwitchTask) return;
                setStartSwitchLoading(true);
                try {
                  const result = await startTaskDetailed(startSwitchTask.id, { pauseExisting: true });
                  if (!result.ok) {
                    toast({
                      variant: 'destructive',
                      title: 'Unable to start task',
                      description: result.error_message || 'Failed to start task',
                    });
                    return;
                  }
                  toast({ title: 'Task Started', description: 'Paused your previous job and started this task.' });
                  setStartSwitchOpen(false);
                  setStartSwitchTask(null);
                  setActiveJobLabel(null);
                } finally {
                  setStartSwitchLoading(false);
                }
              }}
              disabled={startSwitchLoading}
            >
              Pause & Start
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
