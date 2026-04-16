import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { resolveActiveJobLabel } from '@/lib/time/resolveActiveJobLabel';
import { useItemDisplaySettingsForUser } from '@/hooks/useItemDisplaySettingsForUser';
import {
  type BuiltinItemColumnKey,
  type ItemColumnKey,
  getColumnLabel,
  getViewById,
  getVisibleColumnsForView,
  parseCustomFieldColumnKey,
} from '@/lib/items/itemDisplaySettings';
import { formatItemSize } from '@/lib/items/formatItemSize';
import { TaskDialog } from '@/components/tasks/TaskDialog';
import { UnableToCompleteDialog } from '@/components/tasks/UnableToCompleteDialog';
import { ItemPreviewCard } from '@/components/items/ItemPreviewCard';
import { ItemColumnsPopover } from '@/components/items/ItemColumnsPopover';
import { PhotoScannerButton } from '@/components/common/PhotoScannerButton';
import { PhotoUploadButton } from '@/components/common/PhotoUploadButton';
import { TaggablePhotoGrid, TaggablePhoto, getPhotoUrls } from '@/components/common/TaggablePhotoGrid';
import { AddAddonDialog } from '@/components/billing/AddAddonDialog';
import { AddCreditDialog } from '@/components/billing/AddCreditDialog';
import { BillingCalculator } from '@/components/billing/BillingCalculator';
import { useTechnicians } from '@/hooks/useTechnicians';
import { useRepairQuoteWorkflow } from '@/hooks/useRepairQuotes';
import { usePermissions } from '@/hooks/usePermissions';
import { useTasks } from '@/hooks/useTasks';
import { useJobTimer } from '@/hooks/useJobTimer';
import { JobTimerWidgetFromState } from '@/components/time/JobTimerWidget';
import { ServiceTimeAdjustmentDialog } from '@/components/time/ServiceTimeAdjustmentDialog';
import { format } from 'date-fns';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { StatusBar } from '@/components/receiving/StatusBar';
import { ScanDocumentButton } from '@/components/scanner/ScanDocumentButton';
import { DocumentUploadButton } from '@/components/scanner/DocumentUploadButton';
import { DocumentList } from '@/components/scanner/DocumentList';
import { TaskHistoryTab } from '@/components/tasks/TaskHistoryTab';
import { EntityActivityFeed } from '@/components/activity/EntityActivityFeed';
import { UnifiedNotesSection } from '@/components/notes/UnifiedNotesSection';
import { TaskCompletionBlockedDialog } from '@/components/tasks/TaskCompletionBlockedDialog';
import { SplitTaskPanel } from '@/components/tasks/SplitTaskPanel';
import { HelpButton } from '@/components/prompts';
import { PromptWorkflow } from '@/types/guidedPrompts';
import { validateTaskCompletion, TaskCompletionValidationResult } from '@/lib/billing/taskCompletionValidation';
import { logItemActivity } from '@/lib/activity/logItemActivity';
import { useLocations } from '@/hooks/useLocations';
import { InlineEditableCell } from '@/components/inventory/InlineEditableCell';
import { resolveLocationIdByCode } from '@/lib/locations/resolveLocationIdByCode';
import { logActivity } from '@/lib/activity/logActivity';
import { queueRepairUnableToCompleteAlert, queueTaskUnableToCompleteAlert } from '@/lib/alertQueue';
import { resolveRepairTaskTypeId, fetchRepairTaskTypeDetails } from '@/lib/tasks/resolveRepairTaskType';
import { updateBillingEventFields } from '@/services/billing';
import { formatMinutesShort } from '@/lib/time/serviceTimeEstimate';
import { timerStartJob } from '@/lib/time/timerClient';

interface TaskDetail {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  task_type: string;
  task_type_id: string;
  status: string;
  priority: string | null;
  due_date: string | null;
  assigned_to: string | null;
  warehouse_id: string | null;
  account_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_minutes: number | null;
  completed_at: string | null;
  completed_by: string | null;
  unable_to_complete_note: string | null;
  task_notes: string | null;
  inspection_status: string | null;
  metadata: Record<string, any> | null;
  created_at: string;
  updated_at: string;
  // Billing rate fields
  billing_rate: number | null;
  billing_rate_locked: boolean | null;
  billing_rate_set_by: string | null;
  billing_rate_set_at: string | null;
  assigned_user?: { id: string; first_name: string | null; last_name: string | null };
  warehouse?: { id: string; name: string };
  account?: { id: string; account_name: string };
  override_user?: { first_name: string | null; last_name: string | null };
}

interface TaskItemRow {
  id: string;
  item_id: string;
  quantity: number | null;
  item?: {
    id: string;
    item_code: string;
    quantity?: number | null;
    sku: string | null;
    size: number | null;
    size_unit: string | null;
    description: string | null;
    vendor: string | null;
    inspection_status: string | null;
    current_location_id: string | null;
    location?: { code: string } | null;
    account?: { account_name: string } | null;
    sidemark: string | null;
    room?: string | null;
    primary_photo_url?: string | null;
    metadata?: Record<string, unknown> | null;
  } | null;
}

interface RelatedOpenTask {
  id: string;
  title: string;
  task_type: string;
  status: string;
  priority: string | null;
  due_date: string | null;
  created_at: string;
  shared_item_ids: string[];
  shared_item_codes: string[];
}

export default function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { toast } = useToast();

  // Tenant-managed item list views (systemwide)
  const {
    settings: itemDisplaySettings,
    tenantSettings: tenantItemDisplaySettings,
    defaultViewId: defaultItemViewId,
    loading: itemDisplayLoading,
    saving: itemDisplaySaving,
    saveSettings: saveItemDisplaySettings,
  } = useItemDisplaySettingsForUser();
  const [activeItemViewId, setActiveItemViewId] = useState<string>('');

  useEffect(() => {
    if (!activeItemViewId && defaultItemViewId) {
      setActiveItemViewId(defaultItemViewId);
    }
  }, [defaultItemViewId, activeItemViewId]);

  const activeItemView = useMemo(() => {
    return (
      getViewById(itemDisplaySettings, activeItemViewId) ||
      getViewById(itemDisplaySettings, defaultItemViewId) ||
      itemDisplaySettings.views[0]
    );
  }, [itemDisplaySettings, activeItemViewId, defaultItemViewId]);

  const itemVisibleColumns = useMemo(
    () => (activeItemView ? getVisibleColumnsForView(activeItemView) : []),
    [activeItemView]
  );

  const [task, setTask] = useState<TaskDetail | null>(null);
  const [taskItems, setTaskItems] = useState<TaskItemRow[]>([]);
  const [relatedOpenTasks, setRelatedOpenTasks] = useState<RelatedOpenTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [unableDialogOpen, setUnableDialogOpen] = useState(false);
  const [addAddonDialogOpen, setAddAddonDialogOpen] = useState(false);
  const [addCreditDialogOpen, setAddCreditDialogOpen] = useState(false);
  const [photos, setPhotos] = useState<(string | TaggablePhoto)[]>([]);
  const [actionLoading, setActionLoading] = useState(false);
  const [quoteDialogOpen, setQuoteDialogOpen] = useState(false);
  const [selectedTechnicianId, setSelectedTechnicianId] = useState<string>('');
  const [creatingQuote, setCreatingQuote] = useState(false);
  const [billingRefreshKey, setBillingRefreshKey] = useState(0);
  const [docRefetchKey, setDocRefetchKey] = useState(0);
  const [completionBlockedOpen, setCompletionBlockedOpen] = useState(false);
  const [completionValidationResult, setCompletionValidationResult] = useState<TaskCompletionValidationResult | null>(null);

  // Add Item to task state
  const [addItemSearchQuery, setAddItemSearchQuery] = useState('');
  const [addItemSearchResults, setAddItemSearchResults] = useState<Array<{ id: string; item_code: string; description: string | null }>>([]);
  const [addItemSearching, setAddItemSearching] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);

  // Ref for the Items section (used by "Go to Items tab" link)
  const itemsSectionRef = useRef<HTMLDivElement>(null);

  // SOP validation gate state
  const [validationOpen, setValidationOpen] = useState(false);
  const [validationBlockers, setValidationBlockers] = useState<{ code: string; message: string; severity: string }[]>([]);

  // Set Task Rate modal state (Safety Billing)
  const [setRateDialogOpen, setSetRateDialogOpen] = useState(false);
  const [pendingRateBillingEvents, setPendingRateBillingEvents] = useState<Array<{
    id: string;
    charge_type: string;
    quantity: number | null;
    description: string | null;
    item_id: string | null;
    metadata: { task_item_codes?: string[] } | null;
  }>>([]);
  const [rateAmount, setRateAmount] = useState<string>('');
  const [rateNotes, setRateNotes] = useState<string>('');
  const [savingRate, setSavingRate] = useState(false);


  const { activeTechnicians } = useTechnicians();
  const { createWorkflowQuote, sendToTechnician } = useRepairQuoteWorkflow();
  const { hasRole } = usePermissions();
  const { completeTaskWithServices, startTaskDetailed } = useTasks();

  const taskTimer = useJobTimer('task', id);
  const taskWarehouseId = task?.warehouse_id || undefined;
  const { locations } = useLocations(taskWarehouseId);
  const locationSuggestions = useMemo(
    () => Array.from(new Set(locations.map((l) => l.code).filter(Boolean) as string[])),
    [locations]
  );

  // Start-task switch confirmation (pause existing job)
  const [startSwitchOpen, setStartSwitchOpen] = useState(false);
  const [startSwitchActiveLabel, setStartSwitchActiveLabel] = useState<string | null>(null);
  const [startSwitchLoading, setStartSwitchLoading] = useState(false);

  // After completing a job, prompt to resume a paused task (auto-paused by starting another job)
  const [resumePromptOpen, setResumePromptOpen] = useState(false);
  const [pausedResumeTasks, setPausedResumeTasks] = useState<Array<{ id: string; title: string; task_type: string }>>([]);
  const [selectedResumeTaskId, setSelectedResumeTaskId] = useState<string>('');
  const [resumeLoading, setResumeLoading] = useState(false);

  const [adjustTimeOpen, setAdjustTimeOpen] = useState(false);

  const loadPausedTasksForResume = useCallback(async (excludeTaskId?: string) => {
    if (!profile?.tenant_id || !profile?.id) return [];

    // If user already has an active timer, don't prompt
    const { data: activeAny } = await (supabase
      .from('job_time_intervals') as any)
      .select('id')
      .eq('tenant_id', profile.tenant_id)
      .eq('user_id', profile.id)
      .is('ended_at', null)
      .limit(1);
    if (activeAny && activeAny.length > 0) return [];

    const { data: pausedIntervals } = await (supabase
      .from('job_time_intervals') as any)
      .select('job_id, ended_at')
      .eq('tenant_id', profile.tenant_id)
      .eq('user_id', profile.id)
      .eq('job_type', 'task')
      .eq('ended_reason', 'auto_pause')
      .not('ended_at', 'is', null)
      .order('ended_at', { ascending: false })
      .limit(10);

    const orderedIds: string[] = [];
    const seen = new Set<string>();
    for (const row of pausedIntervals || []) {
      const tid = row.job_id as string | undefined;
      if (!tid || seen.has(tid)) continue;
      if (excludeTaskId && tid === excludeTaskId) continue;
      seen.add(tid);
      orderedIds.push(tid);
    }

    if (orderedIds.length === 0) return [];

    const { data: taskRows } = await (supabase
      .from('tasks') as any)
      .select('id, title, task_type, status, assigned_to')
      .eq('tenant_id', profile.tenant_id)
      .in('id', orderedIds);

    const byId = new Map<string, any>((taskRows || []).map((t: any) => [t.id, t]));

    return orderedIds
      .map(id => byId.get(id))
      .filter(Boolean)
      .filter((t: any) => t.status === 'in_progress' && t.assigned_to === profile.id)
      .slice(0, 5)
      .map((t: any) => ({
        id: t.id,
        title: t.title || `${t.task_type} task`,
        task_type: t.task_type,
      })) as Array<{ id: string; title: string; task_type: string }>;
  }, [profile?.tenant_id, profile?.id]);

  const maybePromptResumePausedTask = useCallback(async (excludeTaskId?: string) => {
    const paused = await loadPausedTasksForResume(excludeTaskId);
    if (paused.length === 0) return;
    setPausedResumeTasks(paused);
    setSelectedResumeTaskId(paused[0]?.id || '');
    setResumePromptOpen(true);
  }, [loadPausedTasksForResume]);

  // Only managers and admins can see billing
  const canSeeBilling = hasRole('admin') || hasRole('manager') || hasRole('billing_manager') || hasRole('admin_dev');
  const canAdjustServiceTime = hasRole('admin') || hasRole('manager') || hasRole('billing_manager');
  // Only admins and billing managers can add credits
  const canAddCredit = hasRole('admin') || hasRole('billing_manager');

  const fetchTask = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const { data, error } = await (supabase
        .from('tasks') as any)
        .select(`
          *,
          assigned_user:users!tasks_assigned_to_fkey(id, first_name, last_name),
          warehouse:warehouses(id, name),
          account:accounts(id, account_name)
        `)
        .eq('id', id)
        .single();

      if (error) throw error;
      setTask(data);
      setPhotos(data.metadata?.photos || []);
    } catch (error) {
      console.error('Error fetching task:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to load task' });
    } finally {
      setLoading(false);
    }
  }, [id, toast]);

  const fetchTaskItems = useCallback(async () => {
    if (!id) return;
    try {
      const loadRelatedOpenTasks = async (
        itemRows: Array<{ id: string; item_code?: string | null }>
      ) => {
        if (!id || itemRows.length === 0) {
          setRelatedOpenTasks([]);
          return;
        }

        const itemIds = itemRows.map((row) => row.id);
        const itemCodeById = Object.fromEntries(
          itemRows.map((row) => [row.id, row.item_code || 'Linked item'])
        );

        const { data: relatedTaskLinks, error: relatedTaskLinksError } = await (supabase
          .from('task_items') as any)
          .select('task_id, item_id')
          .in('item_id', itemIds);

        if (relatedTaskLinksError) {
          console.error('Error fetching related task links:', relatedTaskLinksError);
          setRelatedOpenTasks([]);
          return;
        }

        const openSiblingLinks = (relatedTaskLinks || []).filter(
          (link: any) => link.task_id && link.task_id !== id
        );

        if (openSiblingLinks.length === 0) {
          setRelatedOpenTasks([]);
          return;
        }

        const siblingTaskIds = Array.from(
          new Set(openSiblingLinks.map((link: any) => link.task_id as string))
        );

        let siblingTasksQuery = (supabase.from('tasks') as any)
          .select('id, title, task_type, status, priority, due_date, created_at')
          .in('id', siblingTaskIds)
          .in('status', ['pending', 'in_progress'])
          .is('deleted_at', null);

        if (profile?.tenant_id) {
          siblingTasksQuery = siblingTasksQuery.eq('tenant_id', profile.tenant_id);
        }

        const { data: siblingTasks, error: siblingTasksError } = await siblingTasksQuery;

        if (siblingTasksError) {
          console.error('Error fetching related open tasks:', siblingTasksError);
          setRelatedOpenTasks([]);
          return;
        }

        const sharedItemIdsByTaskId = (openSiblingLinks as any[]).reduce<Record<string, string[]>>((acc, link: any) => {
          const taskId = String(link.task_id);
          const itemId = String(link.item_id);
          if (!acc[taskId]) acc[taskId] = [];
          acc[taskId].push(itemId);
          return acc;
        }, {});

        const priorityRank: Record<string, number> = {
          urgent: 0,
          high: 1,
          medium: 2,
          normal: 3,
          low: 4,
        };
        const statusRank: Record<string, number> = {
          in_progress: 0,
          pending: 1,
        };

        const mappedTasks: RelatedOpenTask[] = (siblingTasks || []).map((siblingTask: any) => {
          const sharedItemIds = Array.from(
            new Set(sharedItemIdsByTaskId[String(siblingTask.id)] || [])
          );
          const sharedItemCodes = sharedItemIds.map((itemId: string) => itemCodeById[itemId] || 'Linked item');

          return {
            ...siblingTask,
            shared_item_ids: sharedItemIds,
            shared_item_codes: sharedItemCodes,
          };
        });

        mappedTasks.sort((a, b) => {
          const statusDiff = (statusRank[a.status] ?? 99) - (statusRank[b.status] ?? 99);
          if (statusDiff !== 0) return statusDiff;

          const priorityDiff =
            (priorityRank[a.priority || ''] ?? 99) - (priorityRank[b.priority || ''] ?? 99);
          if (priorityDiff !== 0) return priorityDiff;

          if (a.due_date && b.due_date) {
            const dueDiff = new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
            if (dueDiff !== 0) return dueDiff;
          } else if (a.due_date) {
            return -1;
          } else if (b.due_date) {
            return 1;
          }

          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
        });

        setRelatedOpenTasks(mappedTasks);
      };

      // First get task_items for this task
      const { data: taskItemsData, error: taskItemsError } = await (supabase
        .from('task_items') as any)
        .select('id, item_id, quantity')
        .eq('task_id', id);

      if (taskItemsError) {
        console.error('Error fetching task_items:', taskItemsError);
        return;
      }

      if (!taskItemsData || taskItemsData.length === 0) {
        setTaskItems([]);
        setRelatedOpenTasks([]);
        return;
      }

      // Deduplicate task_items by item_id (keep the first occurrence)
      const seenItemIds = new Set<string>();
      const uniqueTaskItems = taskItemsData.filter((ti: any) => {
        if (!ti.item_id || seenItemIds.has(ti.item_id)) {
          return false;
        }
        seenItemIds.add(ti.item_id);
        return true;
      });

      // Get the item IDs
      const itemIds = uniqueTaskItems.map((ti: any) => ti.item_id).filter(Boolean);

      if (itemIds.length === 0) {
        setTaskItems(uniqueTaskItems.map((ti: any) => ({ ...ti, item: null })));
        setRelatedOpenTasks([]);
        return;
      }

      // Fetch items with their details
      const { data: items, error: itemsError } = await (supabase
        .from('items') as any)
        .select(`
          id, item_code, quantity, sku, size, size_unit, description, vendor, sidemark, room, primary_photo_url, metadata, inspection_status,
          current_location_id,
          location:locations!items_current_location_id_fkey(code),
          account:accounts!items_account_id_fkey(account_name)
        `)
        .in('id', itemIds);

      if (itemsError) {
        console.error('Error fetching items:', itemsError);
        // Still return task items without item details
        setTaskItems(uniqueTaskItems.map((ti: any) => ({ ...ti, item: null })));
        await loadRelatedOpenTasks(uniqueTaskItems.map((ti: any) => ({ id: ti.item_id, item_code: null })));
        return;
      }

      // Map items to task_items
      const itemMap = Object.fromEntries((items || []).map((i: any) => [i.id, i]));
      setTaskItems(uniqueTaskItems.map((ti: any) => ({
        ...ti,
        item: itemMap[ti.item_id] || null,
      })));
      await loadRelatedOpenTasks(
        (items || []).map((item: any) => ({
          id: item.id,
          item_code: item.item_code,
        }))
      );
      // Trigger billing recalculation
      setBillingRefreshKey(prev => prev + 1);
    } catch (error) {
      console.error('Error fetching task items:', error);
      setRelatedOpenTasks([]);
    }
  }, [id, profile?.tenant_id]);

  // Search items to add to the task
  const searchItemsForTask = useCallback(async (query: string) => {
    if (!query.trim() || !profile?.tenant_id) {
      setAddItemSearchResults([]);
      return;
    }
    setAddItemSearching(true);
    try {
      const { data } = await (supabase
        .from('items') as any)
        .select('id, item_code, description')
        .eq('tenant_id', profile.tenant_id)
        .neq('status', 'released')
        .neq('status', 'disposed')
        .is('deleted_at', null)
        .ilike('item_code', `%${query.trim()}%`)
        .order('item_code')
        .limit(10);
      setAddItemSearchResults(data || []);
    } catch (error) {
      console.error('Error searching items:', error);
    } finally {
      setAddItemSearching(false);
    }
  }, [profile?.tenant_id]);

  // Add an item to this task
  const handleAddItemToTask = useCallback(async (itemId: string) => {
    if (!id || !profile?.tenant_id) return;

    // Check if item is already linked
    if (taskItems.some(ti => ti.item_id === itemId)) {
      toast({ title: 'Item already added', description: 'This item is already linked to this task.' });
      return;
    }

    try {
      const { error } = await (supabase
        .from('task_items') as any)
        .insert({ task_id: id, item_id: itemId, quantity: 1 });

      if (error) throw error;

      toast({ title: 'Item Added', description: 'Item has been linked to this task.' });
      setAddItemSearchQuery('');
      setAddItemSearchResults([]);
      setAddItemOpen(false);
      fetchTaskItems();
    } catch (error: any) {
      console.error('Error adding item to task:', error);
      toast({ variant: 'destructive', title: 'Error', description: error?.message || 'Failed to add item.' });
    }
  }, [id, profile?.tenant_id, taskItems, fetchTaskItems, toast]);

  // Fetch pending-rate billing events for this task (Safety Billing)
  const fetchPendingRateBillingEvents = useCallback(async () => {
    if (!id || !profile?.tenant_id) return;
    try {
      const { data, error } = await (supabase
        .from('billing_events') as any)
        .select('id, charge_type, quantity, description, item_id, metadata')
        .eq('tenant_id', profile.tenant_id)
        .eq('task_id', id)
        .eq('status', 'unbilled')
        .is('unit_rate', null);

      if (error) {
        console.error('Error fetching pending-rate billing events:', error);
        setPendingRateBillingEvents([]);
        return;
      }

      setPendingRateBillingEvents(data || []);
    } catch (error) {
      console.error('Error fetching pending-rate billing events:', error);
      setPendingRateBillingEvents([]);
    }
  }, [id, profile?.tenant_id]);

  // Save the rate for pending billing events
  const handleSaveRate = async () => {
    if (!rateAmount || pendingRateBillingEvents.length === 0) return;

    const rate = parseFloat(rateAmount);
    if (isNaN(rate) || rate < 0) {
      toast({ variant: 'destructive', title: 'Invalid Rate', description: 'Please enter a valid positive number' });
      return;
    }

    setSavingRate(true);
    try {
      // Update all pending-rate billing events for this task
      const eventIds = pendingRateBillingEvents.map(e => e.id);

      for (const event of pendingRateBillingEvents) {
        const quantity = event.quantity || 1;
        const totalAmount = rate * quantity;

        // Update the billing event with the new rate
        const updateData: any = {
          unit_rate: rate,
          total_amount: totalAmount,
          has_rate_error: false,
          rate_error_message: null,
        };

        // Update description to remove RATE REQUIRED prefix
        if (event.description?.startsWith('RATE REQUIRED – ')) {
          updateData.description = event.description.replace('RATE REQUIRED – ', '');
        }

        // Add notes to metadata if provided
        if (rateNotes) {
          updateData.metadata = {
            ...(event.metadata || {}),
            rate_notes: rateNotes,
            rate_set_at: new Date().toISOString(),
          };
        }

        const result = await updateBillingEventFields({ eventId: event.id, patch: updateData });

        if (!result.success) throw new Error(result.error);
      }

      toast({
        title: 'Rate Set Successfully',
        description: `Updated ${eventIds.length} billing line${eventIds.length !== 1 ? 's' : ''} with rate $${rate.toFixed(2)}`,
      });

      // Close dialog and refresh
      setSetRateDialogOpen(false);
      setRateAmount('');
      setRateNotes('');
      setPendingRateBillingEvents([]);
      setBillingRefreshKey(prev => prev + 1);
      fetchPendingRateBillingEvents();
    } catch (error: any) {
      console.error('Error saving rate:', error);
      toast({ variant: 'destructive', title: 'Error', description: error.message || 'Failed to save rate' });
    } finally {
      setSavingRate(false);
    }
  };

  useEffect(() => {
    fetchTask();
    fetchTaskItems();
  }, [fetchTask, fetchTaskItems]);

  // Fetch pending-rate events when task loads and is completed (for Safety Billing)
  useEffect(() => {
    if (task?.status === 'completed') {
      fetchPendingRateBillingEvents();
    }
  }, [task?.status, fetchPendingRateBillingEvents]);

  const handleStartTask = async () => {
    if (!id || !profile?.id || !profile?.tenant_id) return;
    setActionLoading(true);
    try {
      const result = await startTaskDetailed(id, { pauseExisting: false });
      if (result.ok) {
        toast({ title: 'Task Started', description: 'Task is now in progress.' });
        fetchTask();
        taskTimer.refetch();
        return;
      }

      if (result.error_code === 'ACTIVE_TIMER_EXISTS') {
        setStartSwitchActiveLabel(
          await resolveActiveJobLabel(profile?.tenant_id, result.active_job_type, result.active_job_id),
        );
        setStartSwitchOpen(true);
        return;
      }

      if (result.error_code === 'SPLIT_REQUIRED') {
        toast({
          variant: 'destructive',
          title: 'Split required',
          description: result.error_message || 'This task is blocked until the required Split task is completed.',
        });
        return;
      }

      toast({
        variant: 'destructive',
        title: 'Error',
        description: result.error_message || 'Failed to start task',
      });
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to start task' });
    } finally {
      setActionLoading(false);
    }
  };

  const handleCompleteTask = async () => {
    if (!id || !profile?.id || !task || !profile?.tenant_id) {
      toast({ variant: 'destructive', title: 'Cannot complete', description: 'Missing task or session data. Please refresh and try again.' });
      return;
    }

    // Split tasks have a dedicated workflow (print + scan child labels) and must not
    // use the generic completion flow (which can generate billing events).
    if (task.task_type === 'Split') {
      toast({
        variant: 'destructive',
        title: 'Use Split Workflow',
        description: 'Complete this task from the Split Workflow panel (print + scan new labels).',
      });
      return;
    }

    // Inspection tasks require all items to have pass/fail status
    if (task.task_type === 'Inspection' && taskItems.length > 0) {
      const uninspectedItems = taskItems.filter(
        ti => !ti.item?.inspection_status || (ti.item.inspection_status !== 'pass' && ti.item.inspection_status !== 'fail')
      );
      if (uninspectedItems.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Inspection Incomplete',
          description: `All items must be marked Pass or Fail before completing. ${uninspectedItems.length} item${uninspectedItems.length !== 1 ? 's' : ''} remaining.`,
        });
        return;
      }
    }

    setActionLoading(true);
    try {
      // Phase 5B: Validate task completion requirements (client-side)
      const phase5bValidation = await validateTaskCompletion(
        profile.tenant_id,
        id,
        task.task_type
      );

      if (!phase5bValidation.canComplete) {
        // Show blocking dialog with validation issues
        setCompletionValidationResult(phase5bValidation);
        setCompletionBlockedOpen(true);
        setActionLoading(false);
        return;
      }

      // SOP Hard Gate: Call RPC to validate task completion
      const { data: sopValidationResult, error: rpcError } = await supabase.rpc('validate_task_completion', {
        p_task_id: id,
      });

      if (rpcError) {
        console.error('SOP validation RPC error:', rpcError);
        toast({
          variant: 'destructive',
          title: 'Validation Error',
          description: 'Failed to validate task requirements. Please try again.',
        });
        setActionLoading(false);
        return;
      }

      // Cast to expected shape
      const result = sopValidationResult as { ok: boolean; blockers: { code: string; message: string; severity: string }[]; task_type: string } | null;

      // Filter blockers to only include those with severity "blocking" (or all if no severity field)
      const blockers = (result?.blockers || []).filter(
        (b) => b.severity === 'blocking' || !b.severity
      );

      if (!result?.ok && blockers.length > 0) {
        // Block completion and show modal
        setValidationBlockers(blockers);
        setValidationOpen(true);
        setActionLoading(false);
        return;
      }

      // All validations passed — complete with primary_service_code billing
      try {
        const success = await completeTaskWithServices(id, []);
        if (success) {
          await Promise.all([fetchTask(), fetchTaskItems()]);
          await maybePromptResumePausedTask(id);
        } else {
          toast({
            variant: 'destructive',
            title: 'Completion failed',
            description: 'Task could not be completed. Please check task configuration and try again.',
          });
        }
      } finally {
        setActionLoading(false);
      }
    } catch (error) {
      console.error('Error completing task:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to complete task' });
      setActionLoading(false);
    }
  };

  const handleUnableToComplete = async (note: string) => {
    if (!id || !profile?.id || !profile?.tenant_id) return false;
    try {
      const { error } = await (supabase.from('tasks') as any)
        .update({
          status: 'unable_to_complete',
          unable_to_complete_note: note,
          completed_at: new Date().toISOString(),
          completed_by: profile.id,
        })
        .eq('id', id);
      if (error) throw error;

      // Activity logs (task + linked items)
      void logActivity({
        entityType: 'task',
        tenantId: profile.tenant_id,
        entityId: id,
        actorUserId: profile.id,
        eventType: 'task_unable',
        eventLabel: 'Task marked unable to complete',
        details: { note },
      });

      for (const ti of taskItems) {
        if (!ti.item_id) continue;
        logItemActivity({
          tenantId: profile.tenant_id,
          itemId: ti.item_id,
          actorUserId: profile.id,
          eventType: 'task_unable',
          eventLabel: `Task marked unable to complete: ${task?.task_type || 'Task'}`,
          details: { task_id: id, task_type: task?.task_type || null, note },
        });
      }

      // For Repair tasks: send unrepairable item alert (damage/quarantine remain)
      if (task?.task_type === 'Repair') {
        const itemCodes = taskItems
          .map(ti => ti.item?.item_code)
          .filter(Boolean) as string[];

        await queueRepairUnableToCompleteAlert(
          profile.tenant_id,
          id,
          itemCodes.length > 0 ? itemCodes : ['Unknown'],
          note,
          task.account?.account_name
        );
      }

      // Alert queuing is non-blocking — don't let it prevent task completion
      void queueTaskUnableToCompleteAlert(
        profile.tenant_id,
        id,
        task?.title || `Task ${id.slice(0, 8)}`,
        note
      ).catch(alertErr => console.warn('[TaskDetail] alert queue error:', alertErr));

      toast({ title: 'Task Marked', description: 'Task marked as unable to complete.' });
      setUnableDialogOpen(false);
      fetchTask();
      return true;
    } catch (error: any) {
      console.error('[TaskDetail] Unable to complete error:', error);
      toast({ variant: 'destructive', title: 'Error', description: error?.message || 'Failed to update task' });
      return false;
    }
  };

  // Handle individual item inspection result
  const handleItemInspectionResult = async (itemId: string, result: 'pass' | 'fail') => {
    try {
      // Update inspection_status; if fail, also set has_damage
      const updateData: Record<string, any> = { inspection_status: result };
      if (result === 'fail') {
        updateData.has_damage = true;
      } else if (result === 'pass') {
        // Passing clears any previous damage flag set by inspection
        updateData.has_damage = false;
      }

      const { error } = await (supabase.from('items') as any)
        .update(updateData)
        .eq('id', itemId);
      if (error) throw error;

      // Update local state
      setTaskItems(prev => prev.map(ti =>
        ti.item_id === itemId
          ? { ...ti, item: ti.item ? { ...ti.item, inspection_status: result } : ti.item }
          : ti
      ));

      toast({ title: `Item ${result === 'pass' ? 'Passed' : 'Failed'}` });

      // If item failed inspection, trigger auto-repair and auto-quarantine automations
      if (result === 'fail' && task?.account_id && profile?.tenant_id) {
        triggerDamageAutomations(itemId, task.account_id);
      }

      // Refresh task items to get updated data
      fetchTaskItems();
    } catch (error) {
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to save inspection result' });
    }
  };

  // Trigger auto-repair and auto-quarantine automations when item fails inspection
  const triggerDamageAutomations = async (itemId: string, accountId: string) => {
    if (!profile?.tenant_id || !task) return;

    try {
      // Fetch account automation settings
      const { data: account } = await (supabase
        .from('accounts') as any)
        .select('auto_repair_on_damage, auto_quarantine_damaged_items')
        .eq('id', accountId)
        .single();

      // Fetch tenant preferences for auto_repair_on_damage
      const { data: tenantPreferences } = await (supabase
        .from('tenant_preferences') as any)
        .select('auto_repair_on_damage')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle();

      const shouldCreateRepair = tenantPreferences?.auto_repair_on_damage || account?.auto_repair_on_damage;
      const shouldQuarantine = account?.auto_quarantine_damaged_items;

      // Get item info for task creation
      const { data: itemData } = await (supabase
        .from('items') as any)
        .select('item_code, description')
        .eq('id', itemId)
        .single();

      // Auto Repair on Damage: create a Repair task
      if (shouldCreateRepair && itemData) {
        // Copy inspection photos and notes to the repair task
        const inspectionPhotos = photos || [];
        let inspectionNotes = task.task_notes || '';
        try {
          const { data: latestInternalNote } = await (supabase
            .from('notes') as any)
            .select('note')
            .eq('tenant_id', profile.tenant_id)
            .eq('source_entity_type', 'task')
            .eq('source_entity_id', task.id)
            .eq('note_type', 'internal')
            .is('deleted_at', null)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (latestInternalNote?.note) {
            inspectionNotes = latestInternalNote.note;
          }
        } catch {
          // Fall back to legacy task.task_notes value.
        }

        // Resolve repair task type with precedence (account → org → fallback)
        const repairTaskTypeId = await resolveRepairTaskTypeId({
          tenantId: profile.tenant_id,
          accountId,
          purpose: 'damage',
        });

        if (!repairTaskTypeId) {
          console.warn('[triggerDamageAutomations] No repair task type available; skipping repair task creation');
          toast({
            title: 'Damage Detected',
            description: 'Could not create repair task (no repair type configured)',
          });
          return;
        }

        // Fetch the resolved task type details
        const repairType = await fetchRepairTaskTypeDetails(repairTaskTypeId);
        if (!repairType) {
          console.error(`[triggerDamageAutomations] Task type ${repairTaskTypeId} not found after resolution`);
          return;
        }

        const { data: repairTask } = await (supabase
          .from('tasks') as any)
          .insert({
            tenant_id: profile.tenant_id,
            title: `Repair: ${itemData.description || itemData.item_code}`,
            description: inspectionNotes ? `Inspection Notes:\n${inspectionNotes}` : null,
            task_type: repairType.name,
            task_type_id: repairType.id,
            status: 'pending',
            priority: 'urgent',
            account_id: accountId,
            warehouse_id: task.warehouse_id,
            parent_task_id: task.id,
            metadata: inspectionPhotos.length > 0 ? { photos: inspectionPhotos } : null,
          })
          .select('id')
          .single();

        if (repairTask) {
          // Link item to repair task
          await (supabase
            .from('task_items') as any)
            .insert({
              task_id: repairTask.id,
              item_id: itemId,
            });

          // Update item's repair_status
          await (supabase
            .from('items') as any)
            .update({ repair_status: 'pending' })
            .eq('id', itemId);

          toast({
            title: 'Repair Task Created',
            description: `Auto-repair task created for ${itemData.item_code}`,
            navigateTo: `/tasks/${repairTask.id}`,
          });
        }
      }

      // Auto Quarantine Damaged Items: apply quarantine indicator flag
      if (shouldQuarantine) {
        await applyQuarantineFlag(itemId, itemData?.item_code || 'Unknown');
      }
    } catch (error) {
      console.error('Error triggering damage automations:', error);
      // Don't block the inspection result - automations are best-effort
    }
  };

  // Apply quarantine indicator flag to an item
  const applyQuarantineFlag = async (itemId: string, itemCode: string) => {
    if (!profile?.tenant_id) return;

    try {
      // Look up the Quarantine flag charge type
      const { data: quarantineFlag } = await (supabase
        .from('charge_types') as any)
        .select('id, charge_code')
        .eq('tenant_id', profile.tenant_id)
        .eq('add_flag', true)
        .eq('flag_is_indicator', true)
        .ilike('charge_name', '%quarantine%')
        .maybeSingle();

      if (!quarantineFlag) {
        // No quarantine flag configured in the system - skip silently
        console.warn('No Quarantine indicator flag found in charge_types. Skipping auto-quarantine.');
        return;
      }

      // Check if already applied
      const { data: existing } = await (supabase
        .from('item_flags') as any)
        .select('id')
        .eq('item_id', itemId)
        .eq('service_code', quarantineFlag.charge_code)
        .maybeSingle();

      if (existing) return; // Already quarantined

      // Apply the flag
      await (supabase
        .from('item_flags') as any)
        .insert({
          tenant_id: profile.tenant_id,
          item_id: itemId,
          charge_type_id: quarantineFlag.id,
          service_code: quarantineFlag.charge_code,
          created_by: profile.id,
        });

      // Log activity
      logItemActivity({
        tenantId: profile.tenant_id,
        itemId,
        actorUserId: profile.id,
        eventType: 'indicator_applied',
        eventLabel: 'Quarantine applied (auto - inspection failed)',
        details: { service_code: quarantineFlag.charge_code, reason: 'inspection_failed', automated: true },
      });

      toast({
        title: 'Item Quarantined',
        description: `${itemCode} has been quarantined due to failed inspection`,
        variant: 'destructive',
      });
    } catch (error) {
      console.error('Error applying quarantine flag:', error);
    }
  };

  // Handler for TaggablePhotoGrid - saves with metadata
  const handlePhotosChange = async (newPhotos: TaggablePhoto[]) => {
    const previousPhotos = photos;
    setPhotos(newPhotos);
    if (!id || !task) return;
    try {
      // Merge with existing metadata, storing photos in metadata.photos
      const updatedMetadata = { ...(task.metadata || {}), photos: newPhotos };
      const { error } = await (supabase.from('tasks') as any)
        .update({ metadata: updatedMetadata })
        .eq('id', id);

      if (error) throw error;
      // Update local task state with new metadata
      setTask(prev => prev ? { ...prev, metadata: updatedMetadata } : prev);
    } catch (error) {
      console.error('Error saving photos:', error);
      // Revert on error
      setPhotos(previousPhotos);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to save photos. Please try again.',
      });
      // Refetch to ensure state is consistent with DB
      await fetchTask();
    }
  };

  // Handler for PhotoScanner/Upload - converts URLs to TaggablePhoto format
  const handlePhotoUrlsAdded = async (urls: string[]) => {
    const newTaggablePhotos: TaggablePhoto[] = urls.map(url => ({
      url,
      isPrimary: false,
      needsAttention: false,
      isRepair: false,
    }));

    // Keep existing photos (with their tags), add new ones
    const existingUrls = getPhotoUrls(photos);
    const trulyNewPhotos = newTaggablePhotos.filter(p => !existingUrls.includes(p.url));

    if (trulyNewPhotos.length === 0) return;

    // Merge existing (normalized) with new
    const normalizedExisting: TaggablePhoto[] = photos.map(p =>
      typeof p === 'string'
        ? { url: p, isPrimary: false, needsAttention: false, isRepair: false }
        : p
    );
    const allPhotos = [...normalizedExisting, ...trulyNewPhotos];

    const previousPhotos = photos;
    setPhotos(allPhotos);

    if (!id || !task) return;
    try {
      // Merge with existing metadata, storing photos in metadata.photos
      const updatedMetadata = { ...(task.metadata || {}), photos: allPhotos };
      const { error } = await (supabase.from('tasks') as any)
        .update({ metadata: updatedMetadata })
        .eq('id', id);

      if (error) throw error;

      // Update local task state with new metadata
      setTask(prev => prev ? { ...prev, metadata: updatedMetadata } : prev);

      toast({
        title: 'Photos saved',
        description: `${trulyNewPhotos.length} photo(s) added.`,
      });
    } catch (error) {
      console.error('Error saving photos:', error);
      setPhotos(previousPhotos);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to save photos. Please try again.',
      });
      await fetchTask();
    }
  };

  const handleEditSuccess = () => {
    setEditDialogOpen(false);
    fetchTask();
    fetchTaskItems();
  };

  const handleCreateQuote = async () => {
    if (!task || taskItems.length === 0) return;

    setCreatingQuote(true);
    try {
      // Get the first item's account and sidemark info
      const firstItem = taskItems[0];
      if (!firstItem?.item) {
        toast({ variant: 'destructive', title: 'Error', description: 'No item data available' });
        return;
      }

      // Fetch account and sidemark from first item
      const { data: itemData } = await supabase
        .from('items')
        .select('account_id, sidemark_id')
        .eq('id', firstItem.item_id)
        .single();

      if (!itemData?.account_id) {
        toast({ variant: 'destructive', title: 'Error', description: 'Item must have an account' });
        return;
      }

      // Create the quote
      const quote = await createWorkflowQuote({
        item_id: firstItem.item_id,
        account_id: itemData.account_id,
        sidemark_id: itemData.sidemark_id || undefined,
        source_task_id: task.id,
        technician_id: selectedTechnicianId || undefined,
        item_ids: taskItems.slice(1).map(ti => ti.item_id), // Additional items
      });

      if (quote) {
        // If technician was selected, automatically send to them
        if (selectedTechnicianId) {
          const token = await sendToTechnician(quote.id);
          if (token) {
            const link = `${window.location.origin}/quote/tech?token=${token}`;
            await navigator.clipboard.writeText(link);
            toast({
              title: 'Quote Created & Link Copied',
              description: 'The technician quote link has been copied to your clipboard.',
            });
          }
        } else {
          toast({
            title: 'Quote Created',
            description: 'Repair quote created. Assign a technician from the Repair Quotes page.',
          });
        }

        setQuoteDialogOpen(false);
        setSelectedTechnicianId('');
        navigate('/repair-quotes');
      }
    } catch (error) {
      console.error('Error creating quote:', error);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to create repair quote' });
    } finally {
      setCreatingQuote(false);
    }
  };

  // Check if task can have a quote requested
  const canRequestQuote = task && taskItems.length > 0 && !['completed', 'unable_to_complete'].includes(task.status);

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-64">
          <MaterialIcon name="progress_activity" size="xl" className="animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  if (!task) {
    return (
      <DashboardLayout>
        <div className="flex flex-col items-center justify-center h-64 gap-4">
          <p className="text-muted-foreground">Task not found</p>
          <Button variant="outline" onClick={() => navigate('/tasks')}>
            <MaterialIcon name="arrow_back" size="sm" className="mr-2" />
            Back to Tasks
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const notesLabel = `${task.task_type} Notes`;
  const statusBarStatus =
    task.status === 'in_progress' ||
    task.status === 'completed' ||
    task.status === 'unable_to_complete' ||
    task.status === 'cancelled'
      ? task.status
      : 'pending';
  const statusBarActions = (() => {
    if (task.status === 'pending') {
      return (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setUnableDialogOpen(true)}
            disabled={actionLoading}
          >
            <MaterialIcon name="cancel" size="sm" className="mr-2" />
            Cancel
          </Button>
          <Button size="sm" onClick={handleStartTask} disabled={actionLoading}>
            <MaterialIcon name="play_arrow" size="sm" className="mr-2" />
            Start {task.task_type}
          </Button>
        </>
      );
    }

    if (task.status === 'in_progress') {
      return (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setUnableDialogOpen(true)}
            disabled={actionLoading}
          >
            <MaterialIcon name="cancel" size="sm" className="mr-2" />
            Cancel
          </Button>
          <JobTimerWidgetFromState
            timer={taskTimer}
            jobType="task"
            jobId={id}
            variant="inline"
            showControls
            showTime={false}
            showStatus={false}
          />
          <Button size="sm" onClick={handleCompleteTask} disabled={actionLoading}>
            <MaterialIcon name="check" size="sm" className="mr-2" />
            Finish {task.task_type}
          </Button>
        </>
      );
    }

    return null;
  })();
  const showSecondaryActions =
    !!canRequestQuote ||
    (Boolean(task.account_id) && (canSeeBilling || canAddCredit));
  const relatedTaskChips = relatedOpenTasks.length > 0 ? (
    <>
      {statusBarActions ? <span className="hidden sm:inline text-current/35">|</span> : null}
      <span className="text-xs font-semibold uppercase tracking-wide opacity-80">
        {relatedOpenTasks.length === 1 ? 'Other open task' : 'Other open tasks'}
      </span>
      {relatedOpenTasks.map((relatedTask) => {
        const sharedLabel =
          relatedTask.shared_item_codes.length === 1
            ? relatedTask.shared_item_codes[0]
            : `${relatedTask.shared_item_codes.length} items`;

        return (
          <Button
            key={relatedTask.id}
            variant="outline"
            size="sm"
            className="border-current/25 bg-background/60 hover:bg-background/85"
            onClick={() => navigate(`/tasks/${relatedTask.id}`)}
            title={`${relatedTask.title} (${relatedTask.status.replace('_', ' ')})`}
          >
            <MaterialIcon
              name={relatedTask.status === 'in_progress' ? 'play_circle' : 'assignment'}
              size="sm"
              className="mr-2"
            />
            {relatedTask.task_type} · {sharedLabel}
          </Button>
        );
      })}
    </>
  ) : null;

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <MaterialIcon name="arrow_back" size="md" />
            </Button>
            <div>
              <h1 className="text-xl sm:text-2xl font-semibold">{task.title}</h1>
              <div className="flex items-center gap-2 sm:gap-3 mt-1 flex-wrap">
                <Badge variant="outline" className="text-xs">TSK-{task.id.slice(0, 8).toUpperCase()}</Badge>
                {task.priority ? (
                  <Badge variant={task.priority === 'urgent' ? 'destructive' : 'secondary'} className="text-xs capitalize">
                    {task.priority}
                  </Badge>
                ) : null}
              </div>
            </div>
          </div>
          <div className="flex gap-2 self-start sm:self-center">
            {task.status === 'pending' && (
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={() => setDeleteDialogOpen(true)}
              >
                <MaterialIcon name="delete" size="md" />
              </Button>
            )}
            <Button variant="outline" onClick={() => setEditDialogOpen(true)}>
              <MaterialIcon name="edit" size="sm" className="mr-2" />
              Edit Task
            </Button>
            {/* Help button - workflow based on task type */}
            <HelpButton
              workflow={
                task.task_type === 'Inspection' ? 'inspection' :
                task.task_type === 'Assembly' ? 'assembly' :
                task.task_type === 'Repair' ? 'repair' : 'inspection'
              }
            />
          </div>
        </div>

        <StatusBar
          type="task"
          statusKey={statusBarStatus as any}
          contextLabel={`Task · ${task.task_type}`}
        >
          {statusBarActions}
          {relatedTaskChips}
        </StatusBar>

        {/* Secondary actions */}
        {showSecondaryActions && (
          <div className="flex flex-wrap gap-2">
            {canRequestQuote && (
              <Button
                variant="secondary"
                onClick={() => setQuoteDialogOpen(true)}
                disabled={actionLoading}
              >
                <MaterialIcon name="build" size="sm" className="mr-2" />
                Request Repair Quote
              </Button>
            )}
            {task.account_id && canSeeBilling && (
              <Button
                variant="secondary"
                onClick={() => setAddAddonDialogOpen(true)}
              >
                <MaterialIcon name="attach_money" size="sm" className="mr-2" />
                Add Charge
              </Button>
            )}
            {task.account_id && canAddCredit && (
              <Button
                variant="secondary"
                onClick={() => setAddCreditDialogOpen(true)}
              >
                <MaterialIcon name="money_off" size="sm" className="mr-2" />
                Add Credit
              </Button>
            )}
          </div>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left Column - Details */}
          <div className="lg:col-span-2 space-y-6 min-w-0">
            {/* Split/manual-review workflow banners (origin tasks) */}
            {(() => {
              if (!task || task.task_type === 'Split') return null;
              const meta = task.metadata && typeof task.metadata === 'object' ? task.metadata : null;
              const pendingReview = !!(meta && (meta as any).pending_review === true);
              const pendingReviewReason = pendingReview ? String((meta as any).pending_review_reason || '') : '';
              const splitRequired = !!(meta && (meta as any).split_required === true);
              const splitTaskIds: string[] = splitRequired && Array.isArray((meta as any).split_required_task_ids)
                ? (meta as any).split_required_task_ids.map(String)
                : [];

              if (!pendingReview && !splitRequired) return null;

              return (
                <Card className="border-amber-200 bg-amber-50/40 dark:bg-amber-900/10">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center gap-2">
                      <MaterialIcon name={pendingReview ? 'search' : 'call_split'} size="sm" />
                      {pendingReview ? 'Pending review' : 'Waiting for split'}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 text-sm text-muted-foreground space-y-2">
                    {pendingReview && (
                      <div className="space-y-1">
                        <div className="font-medium text-amber-800 dark:text-amber-200">
                          This task request requires manual review.
                        </div>
                        {pendingReviewReason && (
                          <div className="text-xs">
                            Reason: {pendingReviewReason}
                          </div>
                        )}
                        <div className="text-xs">
                          Starting the task will clear the Pending review marker.
                        </div>
                      </div>
                    )}
                    {splitRequired && (
                      <div className="space-y-1">
                        <div className="font-medium text-amber-800 dark:text-amber-200">
                          Split required before starting.
                        </div>
                        <div className="text-xs">
                          This task is blocked until the required Split task(s) are completed.
                        </div>
                        {splitTaskIds.length > 0 && (
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => navigate(`/tasks/${splitTaskIds[0]}`)}
                            >
                              Open split task
                            </Button>
                            {splitTaskIds.length > 1 && (
                              <span className="text-xs text-muted-foreground">
                                +{splitTaskIds.length - 1} more
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

            {/* Split workflow (special task type) */}
            {task.task_type === 'Split' && (
              <SplitTaskPanel
                taskId={task.id}
                task={task as any}
                taskItems={taskItems as any}
                onRefetch={() => {
                  void fetchTask();
                  void fetchTaskItems();
                }}
              />
            )}

            {/* Service Time Summary (Estimated vs Actual) */}
            {(() => {
              const st = (task.metadata as any)?.service_time as any | undefined;
              const estimatedMinutes = typeof st?.estimated_minutes === 'number' ? st.estimated_minutes : null;
              const actualLaborMinutesFromMeta = typeof st?.actual_labor_minutes === 'number' ? st.actual_labor_minutes : null;
              const actualCycleMinutesFromMeta = typeof st?.actual_cycle_minutes === 'number' ? st.actual_cycle_minutes : null;

              const actualLaborMinutes =
                task.status === 'in_progress'
                  ? taskTimer.laborMinutes
                  : (actualLaborMinutesFromMeta ?? task.duration_minutes ?? null);

              const actualCycleMinutes =
                task.status === 'in_progress'
                  ? taskTimer.cycleMinutes
                  : (actualCycleMinutesFromMeta ?? null);

              const show =
                (estimatedMinutes != null && estimatedMinutes > 0) ||
                (actualLaborMinutes != null && actualLaborMinutes > 0) ||
                task.status === 'in_progress';

              if (!show) return null;

              return (
                <>
                  <Card>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-base flex items-center gap-2">
                          <MaterialIcon name="schedule" size="sm" />
                          Service Time
                        </CardTitle>
                        {canAdjustServiceTime && task.status !== 'in_progress' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => setAdjustTimeOpen(true)}
                          >
                            Adjust
                          </Button>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {estimatedMinutes != null && estimatedMinutes > 0 && (
                          <Badge variant="secondary" className="text-xs">
                            Est: {formatMinutesShort(estimatedMinutes)}
                          </Badge>
                        )}
                        {actualLaborMinutes != null && actualLaborMinutes > 0 && (
                          <Badge variant="outline" className="text-xs">
                            Actual: {formatMinutesShort(actualLaborMinutes)}
                          </Badge>
                        )}
                        {actualCycleMinutes != null &&
                          actualLaborMinutes != null &&
                          actualCycleMinutes > 0 &&
                          actualCycleMinutes !== actualLaborMinutes && (
                            <Badge variant="outline" className="text-xs">
                              Cycle: {formatMinutesShort(actualCycleMinutes)}
                            </Badge>
                          )}
                        {task.status === 'in_progress' && !taskTimer.isActiveForMe && taskTimer.isPausedForMe && (
                          <Badge variant="outline" className="text-xs">
                            Paused
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  <ServiceTimeAdjustmentDialog
                    open={adjustTimeOpen}
                    onOpenChange={setAdjustTimeOpen}
                    jobType="task"
                    jobId={id}
                    currentMinutes={actualLaborMinutes ?? null}
                    onSaved={() => {
                      fetchTask();
                    }}
                  />
                </>
              );
            })()}

            {/* Task Details (metadata + description) */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MaterialIcon name="description" size="sm" />
                  Task Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="flex items-center gap-2">
                    <MaterialIcon name="person" size="sm" className="text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Assigned To</p>
                      <p className="text-sm font-medium">
                        {task.assigned_user
                          ? `${task.assigned_user.first_name} ${task.assigned_user.last_name}`
                          : 'Unassigned'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <MaterialIcon name="calendar_today" size="sm" className="text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Due Date</p>
                      <p className={`text-sm font-medium ${
                        task.due_date && new Date(task.due_date.substring(0, 10) + 'T12:00:00') < new Date() &&
                        task.status !== 'completed' && task.status !== 'unable_to_complete'
                          ? 'text-red-600' : ''
                      }`}>
                        {task.due_date ? format(new Date(task.due_date.substring(0, 10) + 'T12:00:00'), 'MMM d, yyyy') : 'No due date'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <MaterialIcon name="warehouse" size="sm" className="text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Warehouse</p>
                      <p className="text-sm font-medium">{task.warehouse?.name || 'Not set'}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <MaterialIcon name="business" size="sm" className="text-muted-foreground" />
                    <div>
                      <p className="text-xs text-muted-foreground">Account</p>
                      <p className="text-sm font-medium">{task.account?.account_name || 'Not set'}</p>
                    </div>
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Task Description</p>
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {task.description?.trim() || 'No task description added.'}
                  </p>
                </div>

                <div className="border-t pt-3 space-y-1 text-xs text-muted-foreground">
                  <p>Created: {format(new Date(task.created_at), 'MMM d, yyyy h:mm a')}</p>
                  {task.completed_at && (
                    <p>Completed: {format(new Date(task.completed_at), 'MMM d, yyyy h:mm a')}</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Inspection Summary */}
            {task.task_type === 'Inspection' && taskItems.length > 0 && (() => {
              const passedCount = taskItems.filter(ti => ti.item?.inspection_status === 'pass').length;
              const failedCount = taskItems.filter(ti => ti.item?.inspection_status === 'fail').length;
              const pendingCount = taskItems.filter(ti => !ti.item?.inspection_status).length;
              return (
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-4">
                      <span className="text-sm font-medium">Inspection Summary:</span>
                      <div className="flex items-center gap-2">
                        {passedCount > 0 && <StatusIndicator status="pass" label={`${passedCount} Passed`} size="sm" />}
                        {failedCount > 0 && <StatusIndicator status="fail" label={`${failedCount} Failed`} size="sm" />}
                        {pendingCount > 0 && <StatusIndicator status="pending" label={`${pendingCount} Pending`} size="sm" />}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })()}

            {/* Mobile-only Billing Calculator — shown early for easier access */}
            {canSeeBilling && task.account_id && (
              <div className="lg:hidden">
                <BillingCalculator
                  taskId={task.id}
                  taskType={task.task_type}
                  taskTypeId={task.task_type_id}
                  refreshKey={billingRefreshKey}
                  title="Billing Calculator"
                />
              </div>
            )}

            {/* Items Section */}
            <div ref={itemsSectionRef}>
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <MaterialIcon name="inventory_2" size="sm" />
                      Items ({taskItems.length})
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      {taskItems.length > 0 && (
                        <div className="w-full sm:w-56">
                          <Select
                            value={activeItemViewId || defaultItemViewId || 'default'}
                            onValueChange={setActiveItemViewId}
                            disabled={itemDisplayLoading || itemDisplaySettings.views.length === 0}
                          >
                            <SelectTrigger className="h-10 flex-1">
                              <SelectValue placeholder="View" />
                            </SelectTrigger>
                            <SelectContent>
                              {itemDisplaySettings.views.map((v) => (
                                <SelectItem key={v.id} value={v.id}>
                                  {v.name}
                                  {v.is_default ? ' (default)' : ''}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      {(task.status === 'pending' || task.status === 'in_progress') && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAddItemOpen(!addItemOpen)}
                        >
                          <MaterialIcon name="add" size="sm" className="mr-1" />
                          Add Item
                        </Button>
                      )}
                    </div>
                  </div>
                  {/* Inline Add Item search */}
                  {addItemOpen && (
                    <div className="mt-3 space-y-2">
                      <div className="flex gap-2">
                        <Input
                          placeholder="Search by item code..."
                          value={addItemSearchQuery}
                          onChange={(e) => {
                            setAddItemSearchQuery(e.target.value);
                            searchItemsForTask(e.target.value);
                          }}
                          className="flex-1"
                          autoFocus
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setAddItemOpen(false);
                            setAddItemSearchQuery('');
                            setAddItemSearchResults([]);
                          }}
                        >
                          <MaterialIcon name="close" size="sm" />
                        </Button>
                      </div>
                      {addItemSearching && (
                        <p className="text-xs text-muted-foreground">Searching...</p>
                      )}
                      {addItemSearchResults.length > 0 && (
                        <div className="border rounded-md max-h-48 overflow-y-auto">
                          {addItemSearchResults.map((item) => {
                            const alreadyAdded = taskItems.some(ti => ti.item_id === item.id);
                            return (
                              <button
                                key={item.id}
                                type="button"
                                className="w-full text-left px-3 py-2 hover:bg-muted/50 flex items-center justify-between text-sm border-b last:border-b-0 disabled:opacity-50"
                                onClick={() => handleAddItemToTask(item.id)}
                                disabled={alreadyAdded}
                              >
                                <div>
                                  <span className="font-medium">{item.item_code}</span>
                                  {item.description && (
                                    <span className="text-muted-foreground ml-2 truncate">{item.description}</span>
                                  )}
                                </div>
                                {alreadyAdded && (
                                  <span className="text-xs text-muted-foreground">Added</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}
                      {addItemSearchQuery.trim() && !addItemSearching && addItemSearchResults.length === 0 && (
                        <p className="text-xs text-muted-foreground">No items found matching "{addItemSearchQuery}"</p>
                      )}
                    </div>
                  )}
                </CardHeader>
              {taskItems.length > 0 && (
                <CardContent className="p-0 overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {itemVisibleColumns.map((col) => (
                          <TableHead key={col}>{getColumnLabel(itemDisplaySettings, col)}</TableHead>
                        ))}
                        {task.task_type === 'Inspection' && (
                          <>
                            <TableHead className="text-center">Pass</TableHead>
                            <TableHead className="text-center">Fail</TableHead>
                          </>
                        )}
                        <TableHead className="w-8">
                          <div className="flex justify-end">
                            <ItemColumnsPopover
                              settings={itemDisplaySettings}
                              baseSettings={tenantItemDisplaySettings}
                              viewId={activeItemViewId || defaultItemViewId || 'default'}
                              disabled={itemDisplayLoading || itemDisplaySaving || itemDisplaySettings.views.length === 0}
                              onSave={saveItemDisplaySettings}
                              compact
                            />
                          </div>
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {taskItems.map((ti) => (
                        <TableRow
                          key={ti.id}
                          className={task.task_type !== 'Inspection' ? "cursor-pointer hover:bg-muted/50" : "hover:bg-muted/50"}
                          onClick={() => task.task_type !== 'Inspection' && ti.item?.id && navigate(`/inventory/${ti.item.id}`)}
                        >
                          {itemVisibleColumns.map((col) => {
                            const cfKey = parseCustomFieldColumnKey(col);
                            const item = ti.item;

                            if (cfKey) {
                              const meta = item?.metadata;
                              const custom = meta && typeof meta === 'object' ? (meta as any).custom_fields : null;
                              const raw = custom && typeof custom === 'object' ? (custom as any)[cfKey] : null;
                              const display = raw === null || raw === undefined || raw === '' ? '-' : String(raw);
                              return <TableCell key={col} className="max-w-[180px] truncate">{display}</TableCell>;
                            }

                            switch (col as BuiltinItemColumnKey) {
                              case 'photo': {
                                const node = item?.primary_photo_url ? (
                                  <img
                                    src={item.primary_photo_url}
                                    alt={item.item_code}
                                    className="h-8 w-8 rounded object-cover"
                                  />
                                ) : (
                                  <div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-sm">📦</div>
                                );
                                return (
                                  <TableCell key={col} onClick={(e) => e.stopPropagation()}>
                                    {item?.id ? <ItemPreviewCard itemId={item.id}>{node}</ItemPreviewCard> : node}
                                  </TableCell>
                                );
                              }
                              case 'item_code':
                                return (
                                  <TableCell
                                    key={col}
                                    className="font-medium text-primary cursor-pointer"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      item?.id && navigate(`/inventory/${item.id}`);
                                    }}
                                  >
                                    {item?.item_code || ti.item_id.slice(0, 8)}
                                  </TableCell>
                                );
                              case 'sku':
                                return <TableCell key={col}>{item?.sku || '-'}</TableCell>;
                              case 'quantity':
                                return <TableCell key={col}>{ti.quantity || 1}</TableCell>;
                              case 'size':
                                return <TableCell key={col} className="text-right tabular-nums">{formatItemSize(item?.size, item?.size_unit)}</TableCell>;
                              case 'vendor':
                                return <TableCell key={col}>{item?.vendor || '-'}</TableCell>;
                              case 'description':
                                return <TableCell key={col} className="max-w-[200px] truncate">{item?.description || '-'}</TableCell>;
                              case 'location':
                                return (
                                  <TableCell key={col}>
                                    <InlineEditableCell
                                      value={(item as any)?.location?.code || ''}
                                      suggestions={locationSuggestions}
                                      onSave={async (newValue) => {
                                        if (!item) return;
                                        const resolvedLocationId = resolveLocationIdByCode({
                                          locations,
                                          code: newValue,
                                          warehouseId: taskWarehouseId,
                                        });
                                        if (!resolvedLocationId) {
                                          toast({ variant: 'destructive', title: 'Error', description: 'Select a valid location code' });
                                          return;
                                        }
                                        if (item.current_location_id === resolvedLocationId) {
                                          return;
                                        }
                                        const { error } = await supabase
                                          .from('items')
                                          .update({ current_location_id: resolvedLocationId })
                                          .eq('id', item.id);
                                        if (error) {
                                          toast({ variant: 'destructive', title: 'Error', description: 'Failed to update location' });
                                          throw error;
                                        }
                                        // Update local state
                                        setTaskItems(prev => prev.map(t =>
                                          t.item_id === item.id
                                            ? { ...t, item: { ...t.item!, current_location_id: resolvedLocationId, location: { code: newValue.trim() } } as any }
                                            : t
                                        ));
                                        toast({ title: 'Location Updated' });
                                      }}
                                      placeholder="-"
                                    />
                                  </TableCell>
                                );
                              case 'client_account':
                                return <TableCell key={col}>{(item as any)?.account?.account_name || '-'}</TableCell>;
                              case 'sidemark':
                                return <TableCell key={col}>{item?.sidemark || '-'}</TableCell>;
                              case 'room':
                                return <TableCell key={col}>{item?.room || '-'}</TableCell>;
                              case 'received_date':
                                return <TableCell key={col}>{(item as any)?.received_at ? format(new Date((item as any).received_at), 'MMM d, yyyy') : '-'}</TableCell>;
                              default:
                                return <TableCell key={col}>-</TableCell>;
                            }
                          })}

                          {task.task_type === 'Inspection' && (
                            <>
                              <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                                {ti.item?.inspection_status === 'pass' ? (
                                  <StatusIndicator status="pass" label="PASSED" size="sm" />
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-green-500/30 text-green-600 dark:text-green-400 hover:bg-green-500/10 h-7 px-2"
                                    onClick={() => ti.item_id && handleItemInspectionResult(ti.item_id, 'pass')}
                                    disabled={task.status !== 'in_progress'}
                                  >
                                    <MaterialIcon name="check_circle" size="sm" />
                                  </Button>
                                )}
                              </TableCell>
                              <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                                {ti.item?.inspection_status === 'fail' ? (
                                  <StatusIndicator status="fail" label="FAILED" size="sm" />
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="border-red-500/30 text-red-600 dark:text-red-400 hover:bg-red-500/10 h-7 px-2"
                                    onClick={() => ti.item_id && handleItemInspectionResult(ti.item_id, 'fail')}
                                    disabled={task.status !== 'in_progress'}
                                  >
                                    <MaterialIcon name="close" size="sm" />
                                  </Button>
                                )}
                              </TableCell>
                            </>
                          )}
                          <TableCell />
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              )}
              {taskItems.length === 0 && !addItemOpen && (
                <CardContent>
                  <div className="text-center py-6 text-muted-foreground">
                    <MaterialIcon name="inventory_2" size="lg" className="mx-auto mb-2 opacity-40" />
                    <p className="text-sm">No items attached to this task.</p>
                    {(task.status === 'pending' || task.status === 'in_progress') && (
                      <Button
                        variant="link"
                        size="sm"
                        className="mt-2"
                        onClick={() => setAddItemOpen(true)}
                      >
                        Add items to get started
                      </Button>
                    )}
                  </div>
                </CardContent>
              )}
              </Card>
            </div>

            {/* Task Notes */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MaterialIcon name="comment" size="sm" />
                  {notesLabel}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <UnifiedNotesSection
                  entityType="task"
                  entityId={task.id}
                  title={notesLabel}
                  embedded
                  allowedNoteTypes={['internal', 'public']}
                />
              </CardContent>
            </Card>

            {/* Photos */}
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base flex items-center gap-2">
                  <MaterialIcon name="photo_camera" size="sm" />
                  Photos ({photos.length})
                </CardTitle>
                <div className="flex gap-2">
                  <PhotoScannerButton
                    entityType="task"
                    entityId={task.id}
                    tenantId={task.tenant_id}
                    existingPhotos={getPhotoUrls(photos)}
                    maxPhotos={20}
                    onPhotosSaved={handlePhotoUrlsAdded}
                    size="sm"
                    label="Take Photos"
                    showCount={false}
                  />
                  <PhotoUploadButton
                    entityType="task"
                    entityId={task.id}
                    tenantId={task.tenant_id}
                    existingPhotos={getPhotoUrls(photos)}
                    maxPhotos={20}
                    onPhotosSaved={handlePhotoUrlsAdded}
                    size="sm"
                  />
                </div>
              </CardHeader>
              <CardContent>
                {photos.length > 0 ? (
                  <TaggablePhotoGrid
                    photos={photos}
                    onPhotosChange={handlePhotosChange}
                    enableTagging={true}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No photos yet. Tap "Take Photos" to capture.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Documents */}
            <Card>
              <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-base flex items-center gap-2">
                  <MaterialIcon name="qr_code_scanner" size="sm" />
                  Documents
                </CardTitle>
                <div className="flex gap-2">
                  <ScanDocumentButton
                    context={{ type: 'task', taskId: task.id, title: task.title }}
                    onSuccess={() => {
                      setDocRefetchKey(prev => prev + 1);
                    }}
                    label="Scan"
                    size="sm"
                    directToCamera
                  />
                  <DocumentUploadButton
                    context={{ type: 'task', taskId: task.id, title: task.title }}
                    onSuccess={() => {
                      setDocRefetchKey(prev => prev + 1);
                    }}
                    size="sm"
                  />
                </div>
              </CardHeader>
              <CardContent>
                <DocumentList
                  contextType="task"
                  contextId={task.id}
                  refetchKey={docRefetchKey}
                />
              </CardContent>
            </Card>

            {task.status === 'unable_to_complete' && task.unable_to_complete_note && (
              <Card className="border-red-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base text-destructive">Unable to Complete</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm">{task.unable_to_complete_note}</p>
                </CardContent>
              </Card>
            )}

            {/* Task Activity */}
            <EntityActivityFeed entityType="task" entityId={task.id} title="Activity" description="Billing and operational activity for this task" />

            {/* Task History */}
            <TaskHistoryTab taskId={task.id} />
          </div>

          {/* Right Column - Billing & Utilities */}
          <div className="space-y-6 min-w-0">
            {/* Safety Billing: Set Task Rate Card - Shows when there are pending-rate billing events */}
            {canSeeBilling && task.status === 'completed' && pendingRateBillingEvents.length > 0 && (
              <Card className="border-red-300 bg-red-50 dark:bg-red-950/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-red-800 dark:text-red-200 flex items-center gap-2">
                    <MaterialIcon name="warning" size="sm" className="text-red-600" />
                    Rate Required
                  </CardTitle>
                  <CardDescription className="text-red-700 dark:text-red-300">
                    This task has {pendingRateBillingEvents.length} billing line{pendingRateBillingEvents.length !== 1 ? 's' : ''} without a rate set.
                    Set the rate before invoicing.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0">
                  <Button
                    onClick={() => setSetRateDialogOpen(true)}
                    className="w-full"
                    variant="destructive"
                  >
                    <MaterialIcon name="attach_money" size="sm" className="mr-2" />
                    Set Task Rate
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Billing Charges - Manager/Admin Only (desktop only, mobile shown earlier) */}
            {canSeeBilling && task.account_id && (
              <div className="hidden lg:block">
                <BillingCalculator
                  taskId={task.id}
                  taskType={task.task_type}
                  taskTypeId={task.task_type_id}
                  refreshKey={billingRefreshKey}
                  title="Billing Calculator"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Dialog */}
      <TaskDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        task={task as any}
        onSuccess={handleEditSuccess}
      />

      {/* Unable to Complete Dialog */}
      <UnableToCompleteDialog
        open={unableDialogOpen}
        onOpenChange={setUnableDialogOpen}
        taskTitle={task.title}
        onConfirm={handleUnableToComplete}
      />

      {/* Request Quote Dialog */}
      <Dialog open={quoteDialogOpen} onOpenChange={setQuoteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="build" size="md" />
              Request Repair Quote
            </DialogTitle>
            <DialogDescription>
              Create a repair quote for the {taskItems.length} item{taskItems.length !== 1 ? 's' : ''} in this task.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Items to Quote</Label>
              <div className="bg-muted rounded-lg p-3 max-h-32 overflow-y-auto space-y-1">
                {taskItems.map((ti) => (
                  <div key={ti.id} className="text-sm flex justify-between">
                    <span className="font-medium">{ti.item?.item_code || 'Unknown'}</span>
                    <span className="text-muted-foreground truncate ml-2">
                      {ti.item?.description || '-'}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="technician">Assign Technician (optional)</Label>
              <Select
                value={selectedTechnicianId || '_none'}
                onValueChange={(val) => setSelectedTechnicianId(val === '_none' ? '' : val)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a technician..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">No technician (assign later)</SelectItem>
                  {activeTechnicians.map((tech) => (
                    <SelectItem key={tech.id} value={tech.id}>
                      {tech.name} ({tech.markup_percent}% markup)
                      {tech.hourly_rate && ` - $${tech.hourly_rate}/hr`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {selectedTechnicianId
                  ? 'A quote link will be created and copied to your clipboard.'
                  : 'You can assign a technician later from the Repair Quotes page.'}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setQuoteDialogOpen(false)}
              disabled={creatingQuote}
            >
              Cancel
            </Button>
            <Button onClick={handleCreateQuote} disabled={creatingQuote}>
              {creatingQuote && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
              Create Quote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Charge Dialog */}
      {task.account_id && (
        <AddAddonDialog
          open={addAddonDialogOpen}
          onOpenChange={setAddAddonDialogOpen}
          accountId={task.account_id}
          accountName={task.account?.account_name}
          taskId={task.id}
          onSuccess={fetchTask}
        />
      )}

      {/* Add Credit Dialog - Admin Only */}
      {task.account_id && (
        <AddCreditDialog
          open={addCreditDialogOpen}
          onOpenChange={setAddCreditDialogOpen}
          accountId={task.account_id}
          accountName={task.account?.account_name}
          taskId={task.id}
          onSuccess={() => {
            fetchTask();
            setBillingRefreshKey(prev => prev + 1);
          }}
        />
      )}

      {/* Task Completion Blocked Dialog (Phase 5B) */}
      <TaskCompletionBlockedDialog
        open={completionBlockedOpen}
        onOpenChange={setCompletionBlockedOpen}
        validationResult={completionValidationResult}
        onGoToItems={() => {
          // Scroll to Items section and open the Add Item search
          setTimeout(() => {
            itemsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            setAddItemOpen(true);
          }, 100);
        }}
      />

      {/* Pause existing job confirmation */}
      <AlertDialog open={startSwitchOpen} onOpenChange={setStartSwitchOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Pause current job?</AlertDialogTitle>
            <AlertDialogDescription>
              It looks like you already have a job in progress{startSwitchActiveLabel ? ` (${startSwitchActiveLabel})` : ''}.
              Do you want to pause it and start this task?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => setStartSwitchActiveLabel(null)}
              disabled={startSwitchLoading}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={async (e) => {
                e.preventDefault();
                if (!id) return;
                setStartSwitchLoading(true);
                try {
                  const result = await startTaskDetailed(id, { pauseExisting: true });
                  if (!result.ok) {
                    if (result.error_code === 'SPLIT_REQUIRED') {
                      toast({
                        variant: 'destructive',
                        title: 'Split required',
                        description: result.error_message || 'This task is blocked until the required Split task is completed.',
                      });
                      return;
                    }
                    toast({
                      variant: 'destructive',
                      title: 'Unable to start task',
                      description: result.error_message || 'Failed to start task',
                    });
                    return;
                  }
                  toast({ title: 'Task Started', description: 'Paused your previous job and started this task.' });
                  setStartSwitchOpen(false);
                  setStartSwitchActiveLabel(null);
                  fetchTask();
                  taskTimer.refetch();
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

      {/* Resume paused task prompt */}
      <Dialog open={resumePromptOpen} onOpenChange={setResumePromptOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="play_circle" size="md" />
              Resume paused task?
            </DialogTitle>
            <DialogDescription>
              You still have a task paused from switching jobs. Resume it now?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Paused task</Label>
              <Select value={selectedResumeTaskId} onValueChange={setSelectedResumeTaskId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a task to resume" />
                </SelectTrigger>
                <SelectContent>
                  {pausedResumeTasks.map(t => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setResumePromptOpen(false)}
              disabled={resumeLoading}
            >
              Not now
            </Button>
            <Button
              onClick={async () => {
                if (!profile?.tenant_id || !selectedResumeTaskId) return;
                setResumeLoading(true);
                try {
                  const result = await timerStartJob({
                    tenantId: profile.tenant_id,
                    userId: profile.id,
                    jobType: 'task',
                    jobId: selectedResumeTaskId,
                    pauseExisting: false,
                  });
                  if (!result.ok) {
                    toast({
                      variant: 'destructive',
                      title: 'Unable to resume',
                      description: result.error_message || 'Failed to resume task',
                    });
                    return;
                  }
                  const resumed = pausedResumeTasks.find(t => t.id === selectedResumeTaskId);
                  toast({
                    title: 'Resumed',
                    description: resumed ? `Resumed "${resumed.title}".` : 'Task timer resumed.',
                  });
                  setResumePromptOpen(false);
                  navigate(`/tasks/${selectedResumeTaskId}`);
                } catch (err: any) {
                  toast({
                    variant: 'destructive',
                    title: 'Unable to resume',
                    description: err?.message || 'Failed to resume task',
                  });
                } finally {
                  setResumeLoading(false);
                }
              }}
              disabled={resumeLoading || !selectedResumeTaskId}
            >
              Resume
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* SOP Validation Blockers Modal */}
      <Dialog open={validationOpen} onOpenChange={setValidationOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <MaterialIcon name="block" size="md" />
              Can't Complete Task Yet
            </DialogTitle>
            <DialogDescription>
              Fix the items below, then try again.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4">
            <div className="space-y-2">
              {validationBlockers.map((blocker, index) => (
                <div
                  key={`${blocker.code}-${index}`}
                  className="flex items-start gap-3 p-3 border rounded-lg bg-muted/50"
                >
                  <MaterialIcon name="error" size="sm" className="text-destructive mt-0.5 shrink-0" />
                  <span className="text-sm">{blocker.message}</span>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setValidationOpen(false)}>
              OK
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Set Task Rate Dialog (Safety Billing) */}
      <Dialog open={setRateDialogOpen} onOpenChange={setSetRateDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="attach_money" size="md" className="text-primary" />
              Set Task Rate
            </DialogTitle>
            <DialogDescription>
              Set the billing rate for this {task?.task_type} task.
              This will update {pendingRateBillingEvents.length} pending billing line{pendingRateBillingEvents.length !== 1 ? 's' : ''}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Linked Items Display */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Linked Items</Label>
              {taskItems.length > 0 ? (
                <div className="bg-muted rounded-lg p-3 max-h-32 overflow-y-auto space-y-1">
                  {taskItems.map((ti) => (
                    <div key={ti.id} className="text-sm flex justify-between items-center">
                      <span className="font-mono font-medium">{ti.item?.item_code || 'Unknown'}</span>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span className="truncate max-w-[150px]">{ti.item?.description || '-'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="bg-muted rounded-lg p-3 text-sm text-muted-foreground text-center">
                  No linked items
                </div>
              )}
            </div>

            {/* Rate Input */}
            <div className="space-y-2">
              <Label htmlFor="rate_amount">Rate Amount *</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                <Input
                  id="rate_amount"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={rateAmount}
                  onChange={(e) => setRateAmount(e.target.value)}
                  className="pl-7"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                This rate will be applied to all {pendingRateBillingEvents.length} billing line{pendingRateBillingEvents.length !== 1 ? 's' : ''} for this task.
              </p>
            </div>

            {/* Billing Preview */}
            {rateAmount && parseFloat(rateAmount) > 0 && (
              <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 rounded-lg p-3">
                <p className="text-sm font-medium text-blue-800 dark:text-blue-200">Billing Preview</p>
                {pendingRateBillingEvents.map((event, idx) => {
                  const qty = event.quantity || 1;
                  const total = parseFloat(rateAmount) * qty;
                  return (
                    <div key={event.id} className="flex justify-between text-sm mt-1 text-blue-700 dark:text-blue-300">
                      <span className="truncate mr-2">{event.charge_type || '\u2014'} × {qty}</span>
                      <span className="font-medium tabular-nums whitespace-nowrap">${total.toFixed(2)}</span>
                    </div>
                  );
                })}
                <div className="border-t border-blue-200 mt-2 pt-2 flex justify-between font-medium text-blue-800 dark:text-blue-200">
                  <span>Total</span>
                  <span className="tabular-nums whitespace-nowrap">
                    ${pendingRateBillingEvents.reduce((sum, e) => sum + parseFloat(rateAmount) * (e.quantity || 1), 0).toFixed(2)}
                  </span>
                </div>
              </div>
            )}

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="rate_notes">Notes (optional)</Label>
              <Textarea
                id="rate_notes"
                placeholder="Add any notes about this rate..."
                value={rateNotes}
                onChange={(e) => setRateNotes(e.target.value)}
                rows={2}
              />
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => navigate('/reports?tab=billing')}
              className="sm:mr-auto"
            >
              <MaterialIcon name="open_in_new" size="sm" className="mr-2" />
              View in Billing Report
            </Button>
            <Button
              variant="outline"
              onClick={() => setSetRateDialogOpen(false)}
              disabled={savingRate}
            >
              Cancel
            </Button>
            <Button
              onClick={handleSaveRate}
              disabled={savingRate || !rateAmount || parseFloat(rateAmount) <= 0}
            >
              {savingRate && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
              Save Rate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete task confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the task from all lists. This action cannot be easily undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                const { error } = await (supabase as any)
                  .from('tasks')
                  .update({ deleted_at: new Date().toISOString() })
                  .eq('id', task?.id);
                if (error) {
                  toast({ variant: 'destructive', title: 'Error', description: 'Failed to delete task' });
                } else {
                  toast({ title: 'Deleted', description: 'Task has been removed.' });
                  navigate('/tasks');
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
