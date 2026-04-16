import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import {
  queueTaskCreatedAlert,
  queueTaskAssignedAlert,
  queueTaskCompletedAlert,
  queueTaskUnableToCompleteAlert,
  queueInspectionCompletedAlert,
  queueBillingEventAlert,
} from '@/lib/alertQueue';
import { logItemActivity } from '@/lib/activity/logItemActivity';
import { createCharges, type CreateChargeParams } from '@/services/billing';
import { calculateTaskBillingPreview, getRateFromPriceList } from '@/lib/billing/billingCalculation';
import { BILLING_DISABLED_ERROR, getEffectiveRate } from '@/lib/billing/chargeTypeUtils';
import { fetchTaskServiceLinesStatic, isServiceLineRow } from '@/hooks/useTaskServiceLines';
import type { CompletionLineValues } from '@/components/tasks/TaskCompletionPanel';
import { estimateServiceMinutes } from '@/lib/time/serviceTimeEstimate';
import {
  mergeServiceTimeSnapshot,
  mergeServiceTimeActualSnapshot,
  type ServiceTimeSnapshotV1,
  type ServiceTimeActualSnapshotV1,
} from '@/lib/time/serviceTimeSnapshot';
import { minutesBetweenIso } from '@/lib/time/minutesBetweenIso';
import { timerEndJob, timerStartJob } from '@/lib/time/timerClient';

type TimerRpcResult = {
  ok: boolean;
  already_active?: boolean;
  started_interval_id?: string | null;
  paused_interval_id?: string | null;
  paused_job_type?: string | null;
  paused_job_id?: string | null;
  error_code?: string | null;
  error_message?: string | null;
  active_interval_id?: string | null;
  active_job_type?: string | null;
  active_job_id?: string | null;
};

export interface Task {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  task_type: string;
  task_type_id: string | null;
  status: string;
  metadata?: Record<string, unknown> | null;
  priority: string | null;
  due_date: string | null;
  assigned_to: string | null;
  assigned_department: string | null;
  warehouse_id: string | null;
  account_id: string | null;
  related_item_id: string | null;
  parent_task_id: string | null;
  duration_minutes: number | null;
  completed_at: string | null;
  completed_by: string | null;
  billing_status: string | null;
  unable_to_complete_note: string | null;
  created_at: string;
  updated_at: string;
  // Joined data
  assigned_user?: {
    id: string;
    first_name: string | null;
    last_name: string | null;
  };
  warehouse?: {
    id: string;
    name: string;
  };
  account?: {
    id: string;
    account_name: string;
  };
  subtasks?: Subtask[];
  task_items?: TaskItem[];
}

export interface Subtask {
  id: string;
  task_id: string;
  title: string;
  description: string | null;
  is_completed: boolean;
  completed_at: string | null;
  sort_order: number;
}

export interface TaskItem {
  id: string;
  task_id: string;
  item_id: string;
  quantity: number | null;
  item?: {
    id: string;
    item_code: string;
    description: string | null;
  };
}

export interface TaskType {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  color: string;
  icon: string;
  sort_order: number;
}

export interface DueDateRule {
  id: string;
  tenant_id: string;
  account_id: string | null;
  task_type: string;
  days_from_creation: number;
  is_active: boolean;
}

// Map task types to inventory status fields
const TASK_TYPE_TO_STATUS_FIELD: Record<string, string> = {
  'Assembly': 'assembly_status',
  'Inspection': 'inspection_status',
  'Repair': 'repair_status',
};

// Map task status to inventory status values
const TASK_STATUS_TO_INVENTORY_STATUS: Record<string, string> = {
  'pending': 'pending',
  'in_progress': 'in_progress',
  'completed': 'completed',
  'unable_to_complete': 'unable_to_complete',
};

// Task types that require special completion handling
const SPECIAL_TASK_TYPES = {
  WILL_CALL: 'Will Call',
  DISPOSAL: 'Disposal',
};

export function useTasks(filters?: {
  status?: string;
  taskType?: string;
  warehouseId?: string;
  assignedTo?: string;
  accountId?: string;
}) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRefetching, setIsRefetching] = useState(false);

  // Memoize filter values to prevent unnecessary refetches
  const filterStatus = filters?.status;
  const filterTaskType = filters?.taskType;
  const filterWarehouseId = filters?.warehouseId;
  const filterAssignedTo = filters?.assignedTo;
  const filterAccountId = filters?.accountId;

  const fetchTasks = useCallback(async (showLoading = true) => {
    if (!profile?.tenant_id) return;

    try {
      // Only show full loading on initial load, use refetching for subsequent
      if (showLoading && tasks.length === 0) {
        setLoading(true);
      } else {
        setIsRefetching(true);
      }

      let query = (supabase
        .from('tasks') as any)
        .select(`
          *,
          assigned_user:users!tasks_assigned_to_fkey(id, first_name, last_name),
          warehouse:warehouses(id, name),
          account:accounts(id, account_name)
        `)
        .eq('tenant_id', profile.tenant_id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      if (filterStatus && filterStatus !== 'all') {
        query = query.eq('status', filterStatus);
      }
      if (filterTaskType && filterTaskType !== 'all') {
        query = query.ilike('task_type', filterTaskType);
      }
      if (filterWarehouseId && filterWarehouseId !== 'all') {
        query = query.eq('warehouse_id', filterWarehouseId);
      }
      if (filterAssignedTo && filterAssignedTo !== 'all') {
        query = query.eq('assigned_to', filterAssignedTo);
      }
      if (filterAccountId && filterAccountId !== 'all') {
        query = query.eq('account_id', filterAccountId);
      }

      const { data, error } = await query;

      if (error) {
        // Ignore AbortError - happens during rapid navigation
        if (error.message?.includes('AbortError') || error.message?.includes('aborted')) {
          console.debug('[useTasks] Request aborted (expected during navigation)');
          return;
        }
        throw error;
      }
      setTasks(data || []);
    } catch (error: any) {
      // Ignore AbortError - happens during rapid navigation
      if (error?.message?.includes('AbortError') || error?.message?.includes('aborted')) {
        console.debug('[useTasks] Request aborted (expected during navigation)');
        return;
      }
      console.error('Error fetching tasks:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load tasks',
      });
    } finally {
      setLoading(false);
      setIsRefetching(false);
    }
  }, [profile?.tenant_id, filterStatus, filterTaskType, filterWarehouseId, filterAssignedTo, filterAccountId, toast, tasks.length]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Helper to update inventory status for task items
  const updateInventoryStatus = async (taskId: string, taskType: string, status: string) => {
    const statusField = TASK_TYPE_TO_STATUS_FIELD[taskType];
    if (!statusField) return; // Task type doesn't map to an inventory status

    const inventoryStatus = TASK_STATUS_TO_INVENTORY_STATUS[status];
    if (!inventoryStatus) return;

    try {
      // Get task items
      const { data: taskItems } = await (supabase
        .from('task_items') as any)
        .select('item_id')
        .eq('task_id', taskId);

      if (!taskItems || taskItems.length === 0) return;

      const itemIds = taskItems.map((ti: any) => ti.item_id);

      // Update items with the new status
      const updateData: Record<string, string> = {};
      updateData[statusField] = inventoryStatus;

      await (supabase
        .from('items') as any)
        .update(updateData)
        .in('id', itemIds);
    } catch (error) {
      console.error('Error updating inventory status:', error);
    }
  };

  // Helper to clear damage and quarantine flags when repair task is completed
  const clearDamageAndQuarantine = async (taskId: string) => {
    if (!profile?.tenant_id || !profile?.id) return;

    try {
      // Get task items
      const { data: taskItems } = await (supabase
        .from('task_items') as any)
        .select('item_id')
        .eq('task_id', taskId);

      if (!taskItems || taskItems.length === 0) return;

      const itemIds = taskItems.map((ti: any) => ti.item_id);

      // Clear has_damage on all items
      await (supabase
        .from('items') as any)
        .update({ has_damage: false })
        .in('id', itemIds);

      // Remove quarantine indicator flags from all items
      // Look up the quarantine flag charge type
      const { data: quarantineFlag } = await (supabase
        .from('charge_types') as any)
        .select('charge_code')
        .eq('tenant_id', profile.tenant_id)
        .eq('add_flag', true)
        .eq('flag_is_indicator', true)
        .ilike('charge_name', '%quarantine%')
        .maybeSingle();

      if (quarantineFlag) {
        await (supabase
          .from('item_flags') as any)
          .delete()
          .in('item_id', itemIds)
          .eq('service_code', quarantineFlag.charge_code);

        // Log quarantine removal per item
        for (const itemId of itemIds) {
          logItemActivity({
            tenantId: profile.tenant_id,
            itemId,
            actorUserId: profile.id,
            eventType: 'indicator_removed',
            eventLabel: 'Quarantine removed (repair completed)',
            details: { service_code: quarantineFlag.charge_code, reason: 'repair_completed', automated: true },
          });
        }
      }

      // Log damage cleared per item
      for (const itemId of itemIds) {
        logItemActivity({
          tenantId: profile.tenant_id,
          itemId,
          actorUserId: profile.id,
          eventType: 'damage_cleared',
          eventLabel: 'Damage cleared (repair completed)',
          details: { task_id: taskId, automated: true },
        });
      }
    } catch (error) {
      console.error('Error clearing damage and quarantine:', error);
      // Non-blocking - don't fail the task completion
    }
  };

  // Helper to create billing events for task completion
  const createTaskBillingEvents = async (
    taskId: string,
    taskType: string,
    accountId: string | null
  ) => {
    if (!profile?.tenant_id || !profile?.id) return;

    try {
      // First, fetch the task to check for billing config (including waive state)
      const { data: taskData } = await (supabase
        .from('tasks') as any)
        .select('billing_rate, billing_rate_locked, title, metadata, task_type_id, waive_charges, tenant_id')
        .eq('id', taskId)
        .single();

      // BUILD-38: If task has waive_charges=true, skip primary billing event creation
      if (taskData?.waive_charges === true) {
        return;
      }

      // BUILD-38: DUPLICATE SAFETY — check for existing billing_event for this tenant+task
      // with status IN ('unbilled','invoiced') regardless of charge_type
      const tenantId = taskData?.tenant_id || profile.tenant_id;
      const { data: existingPrimary } = await (supabase
        .from('billing_events') as any)
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('task_id', taskId)
        .eq('event_type', 'task_completion')
        .in('status', ['unbilled', 'invoiced'])
        .limit(1);

      if (existingPrimary && existingPrimary.length > 0) {
        // Already has a primary billing event — do not create another
        return;
      }

      // Check if task type requires manual rate entry (Safety Billing)
      // Only use the database flag — no hardcoded task type name checks
      const { data: taskTypeData } = await (supabase
        .from('task_types') as any)
        .select('requires_manual_rate')
        .eq('tenant_id', profile.tenant_id)
        .eq('name', taskType)
        .maybeSingle();

      const isManualRateTaskType = taskTypeData?.requires_manual_rate === true;

      const hasManualRate = taskData?.billing_rate_locked && taskData?.billing_rate !== null;
      const manualRate = taskData?.billing_rate;

      // Get service code for this task type via primary_service_code (with default_service_code fallback)
      let serviceCode: string | null = null;
      if (taskData?.task_type_id) {
        const { data: taskTypeRow } = await (supabase
          .from('task_types') as any)
          .select('primary_service_code, default_service_code')
          .eq('id', taskData.task_type_id)
          .maybeSingle();
        serviceCode = taskTypeRow?.primary_service_code || taskTypeRow?.default_service_code || null;
      }

      // If no service code found, task type is non-billable — skip billing
      if (!serviceCode) {
        return;
      }

      // Check if this service uses task-level billing (billing_unit === 'Task')
      const serviceInfo = await getRateFromPriceList(profile.tenant_id, serviceCode, null, accountId);
      const isTaskLevelBilling = serviceInfo.billingUnit === 'Task';

      // Fetch all classes to map class_id to code
      const { data: allClasses } = await supabase
        .from('classes')
        .select('id, code')
        .eq('tenant_id', profile.tenant_id);
      const classMap = new Map((allClasses || []).map((c: any) => [c.id, c.code]));

      // Get task items with item details including class_id and account info
      const { data: taskItems } = await (supabase
        .from('task_items') as any)
        .select(`
          item_id,
          quantity,
          items:item_id(id, class_id, sidemark_id, account_id, item_code, account:accounts(account_name))
        `)
        .eq('task_id', taskId);

      if (!taskItems || taskItems.length === 0) return;

      // Build charge params for billing gateway
      const chargeParams: CreateChargeParams[] = [];
      const alertsToQueue: Array<{
        serviceName: string;
        itemCode: string;
        accountName: string;
        amount: number;
        description: string;
      }> = [];

      if (isTaskLevelBilling && hasManualRate) {
        // For other task-level billing with manual rate
        const firstItem = taskItems[0]?.items;
        const taskAccountId = accountId || firstItem?.account_id;

        if (taskAccountId) {
          const itemCodes = taskItems
            .map((ti: any) => ti.items?.item_code)
            .filter(Boolean);
          const itemCodesStr = itemCodes.join(', ');
          const description = `${taskType}: ${taskData?.title || itemCodesStr}`;

          chargeParams.push({
            tenantId: profile.tenant_id,
            accountId: taskAccountId,
            chargeCode: serviceCode,
            eventType: 'task_completion',
            context: { type: 'task', taskId },
            description,
            quantity: 1,
            rateOverride: manualRate,
            sidemarkId: firstItem?.sidemark_id || null,
            classId: null,
            userId: profile.id,
            metadata: {
              task_type: taskType,
              billing_unit: 'Task',
              manual_rate: true,
              task_item_codes: itemCodes, // Store item codes for display in reports
            },
            hasRateError: false,
            rateErrorMessage: null,
          });
        }
      } else {
        // Item-level billing: create event per item
        for (const taskItem of taskItems) {
          const item = taskItem.items;
          if (!item) continue;

          const itemAccountId = accountId || item.account_id;
          if (!itemAccountId) continue;

          // Get the item's class code for rate lookup
          const classCode = item.class_id ? classMap.get(item.class_id) : null;

          // Use manual rate if set, otherwise lookup from Price List
          let unitRate: number;
          let rateResult: any;

          if (hasManualRate) {
            unitRate = manualRate;
            rateResult = { serviceName: serviceCode, alertRule: 'none', hasError: false };
          } else {
            rateResult = await getRateFromPriceList(
              profile.tenant_id,
              serviceCode,
              classCode,
              itemAccountId
            );
            unitRate = rateResult.rate;
          }

          const quantity = taskItem.quantity || 1;
          const totalAmount = quantity * unitRate;
          const description = `${taskType}: ${item.item_code}`;

          chargeParams.push({
            tenantId: profile.tenant_id,
            accountId: itemAccountId,
            chargeCode: serviceCode,
            eventType: 'task_completion',
            context: { type: 'task', taskId, itemId: item.id },
            description,
            quantity,
            rateOverride: unitRate,
            sidemarkId: item.sidemark_id || null,
            classId: item.class_id || null,
            userId: profile.id,
            metadata: {
              task_type: taskType,
              class_code: classCode,
              manual_rate: hasManualRate,
            },
            hasRateError: hasManualRate ? false : rateResult.hasError,
            rateErrorMessage: hasManualRate ? null : rateResult.errorMessage,
          });

          // Track alerts to queue for services with email_office alert rule
          if (rateResult.alertRule === 'email_office') {
            alertsToQueue.push({
              serviceName: rateResult.serviceName,
              itemCode: item.item_code,
              accountName: item.account?.account_name || 'Unknown Account',
              amount: totalAmount,
              description,
            });
          }
        }
      }

      if (chargeParams.length > 0) {
        const results = await createCharges(chargeParams);

        // Queue alerts for services with email_office alert rule
        for (let i = 0; i < alertsToQueue.length && i < results.length; i++) {
          const alertInfo = alertsToQueue[i];
          const chargeResult = results[i];
          if (chargeResult?.billingEventId) {
            await queueBillingEventAlert(
              profile.tenant_id,
              chargeResult.billingEventId,
              alertInfo.serviceName,
              alertInfo.itemCode,
              alertInfo.accountName,
              alertInfo.amount,
              alertInfo.description
            );
          }
        }
      }
    } catch (error: any) {
      if (error?.message === BILLING_DISABLED_ERROR) {
        console.warn(`[useTasks] Billing disabled for service on this account, skipping billing events`);
        toast({ variant: 'destructive', title: 'Billing Disabled', description: BILLING_DISABLED_ERROR });
      } else {
        console.error('Error creating task billing events:', error);
      }
      // Don't throw - billing event creation shouldn't block task completion
    }
  };

  // Helper to convert task custom charges to billing events on completion
  const convertTaskCustomChargesToBillingEvents = async (
    taskId: string,
    accountId: string | null
  ) => {
    if (!profile?.tenant_id || !profile?.id) return;

    try {
      // Get task custom charges
      const { data: customCharges } = await (supabase
        .from('task_custom_charges') as any)
        .select('*')
        .eq('task_id', taskId);

      if (!customCharges || customCharges.length === 0) return;

      // Filter out service lines — those are handled by createServiceLineBillingEvents
      const regularCharges = customCharges.filter((c: any) => !isServiceLineRow(c));
      if (regularCharges.length === 0) return;

      // Get task items to link charges to items if possible
      const { data: taskItems } = await (supabase
        .from('task_items') as any)
        .select('item_id, items:item_id(sidemark_id)')
        .eq('task_id', taskId)
        .limit(1);

      const firstItem = taskItems?.[0];
      const sidemarkId = firstItem?.items?.sidemark_id || null;
      const itemId = firstItem?.item_id || null;

      // Build charge params for each custom charge (excluding service lines)
      const chargeParams: CreateChargeParams[] = regularCharges.map((charge: any) => ({
        tenantId: profile.tenant_id,
        accountId: accountId as string,
        chargeCode: charge.charge_type || 'addon',
        eventType: 'addon' as const,
        context: { type: 'task' as const, taskId, itemId: itemId || undefined },
        description: charge.charge_description || charge.charge_name,
        quantity: 1,
        rateOverride: charge.charge_amount,
        sidemarkId: sidemarkId,
        userId: profile.id,
        metadata: {
          custom_charge_id: charge.id,
          template_id: charge.template_id,
        },
      }));

      if (chargeParams.length > 0) {
        await createCharges(chargeParams);
      }
    } catch (error) {
      console.error('Error converting custom charges to billing events:', error);
      // Don't throw - shouldn't block task completion
    }
  };

  const createTask = async (taskData: Partial<Task>, itemIds?: string[]) => {
    if (!profile?.tenant_id) return null;

    try {
      const { data: task, error } = await (supabase
        .from('tasks') as any)
        .insert({
          ...taskData,
          tenant_id: profile.tenant_id,
          status: 'pending', // New tasks start as pending
        })
        .select()
        .single();

      if (error) {
        console.error('[createTask] Insert failed:', error);
        toast({
          variant: 'destructive',
          title: 'Failed to create task',
          description: error.message || 'Database error while creating task',
        });
        return null;
      }

      // Add task items if provided
      if (itemIds && itemIds.length > 0 && task) {
        const taskItems = itemIds.map(itemId => ({
          task_id: task.id,
          item_id: itemId,
        }));

        const { error: itemsError } = await (supabase.from('task_items') as any).insert(taskItems);
        if (itemsError) {
          console.error('[createTask] Failed to add task items:', itemsError);
        }

        // Update inventory status to pending
        await updateInventoryStatus(task.id, taskData.task_type || '', 'pending');
      }

      toast({
        title: 'Task Created',
        description: `Task has been created and added to queue.`,
      });

      // Log activity per linked item
      if (task && itemIds && itemIds.length > 0) {
        for (const itemId of itemIds) {
          logItemActivity({
            tenantId: profile.tenant_id,
            itemId,
            actorUserId: profile.id,
            eventType: 'task_assigned',
            eventLabel: `${taskData.task_type || 'General'} task created: ${task.title || ''}`,
            details: { task_id: task.id, task_type: taskData.task_type, title: task.title },
          });
        }
      }

      // Queue task.created alert
      if (task) {
        await queueTaskCreatedAlert(profile.tenant_id, task.id, taskData.task_type || 'General');
      }

      fetchTasks();
      return task;
    } catch (error: any) {
      console.error('[createTask] Exception:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to create task',
        description: error?.message || 'An unexpected error occurred',
      });
      return null;
    }
  };

  const updateTask = async (taskId: string, updates: Partial<Task>) => {
    try {
      const { error } = await (supabase
        .from('tasks') as any)
        .update(updates)
        .eq('id', taskId);

      if (error) throw error;

      toast({
        title: 'Task Updated',
        description: 'Task has been updated.',
      });

      fetchTasks();
      return true;
    } catch (error) {
      console.error('Error updating task:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update task',
      });
      return false;
    }
  };

  const startTaskDetailed = async (
    taskId: string,
    options?: { pauseExisting?: boolean },
  ): Promise<TimerRpcResult> => {
    if (!profile?.id || !profile?.tenant_id) {
      return { ok: false, error_code: 'NOT_AUTHENTICATED', error_message: 'Not authenticated' };
    }

    // Get task info first
    const { data: taskData, error: taskFetchError } = await (supabase
      .from('tasks') as any)
      .select('task_type, started_at, metadata, assigned_to')
      .eq('tenant_id', profile.tenant_id)
      .eq('id', taskId)
      .single();

    if (taskFetchError || !taskData) {
      return {
        ok: false,
        error_code: 'TASK_FETCH_FAILED',
        error_message: taskFetchError?.message || 'Failed to load task',
      };
    }

    // Block starting origin tasks that are waiting on one or more Split tasks.
    // (Split tasks themselves are allowed to start.)
    if (taskData?.task_type !== 'Split') {
      const meta = taskData?.metadata && typeof taskData.metadata === 'object' ? taskData.metadata : null;
      const metaSplitRequired = !!(meta && (meta as any).split_required === true);
      const metaSplitTaskIds: string[] = metaSplitRequired && Array.isArray((meta as any).split_required_task_ids)
        ? (meta as any).split_required_task_ids.map(String)
        : [];

      const { data: linkedSplitTasks, error: linkedErr } = await (supabase
        .from('tasks') as any)
        .select('id')
        .eq('tenant_id', profile.tenant_id)
        .eq('task_type', 'Split')
        .contains('metadata', {
          split_workflow: {
            origin_entity_type: 'task',
            origin_entity_id: taskId,
          },
        })
        .in('status', ['pending', 'in_progress']);

      if (linkedErr) {
        return {
          ok: false,
          error_code: 'SPLIT_CHECK_FAILED',
          error_message: linkedErr.message || 'Failed to check Split tasks',
        };
      }

      const linkedIds = (linkedSplitTasks || []).map((t: any) => String(t.id));
      let metaPendingIds: string[] = [];
      if (metaSplitTaskIds.length > 0) {
        const { data: metaPendingTasks, error: metaPendingErr } = await (supabase
          .from('tasks') as any)
          .select('id')
          .eq('tenant_id', profile.tenant_id)
          .in('id', metaSplitTaskIds)
          .in('status', ['pending', 'in_progress']);

        if (metaPendingErr) {
          return {
            ok: false,
            error_code: 'SPLIT_CHECK_FAILED',
            error_message: metaPendingErr.message || 'Failed to check Split tasks',
          };
        }

        metaPendingIds = (metaPendingTasks || []).map((t: any) => String(t.id));
      }

      const totalIds = Array.from(new Set([...metaPendingIds, ...linkedIds]));

      if (totalIds.length > 0) {
        return {
          ok: false,
          error_code: 'SPLIT_REQUIRED',
          error_message: `This task is blocked until ${totalIds.length} Split task(s) are completed.`,
        };
      }
    }

    // Start timer interval first (so we don't mark a task in-progress without a timer).
    // Supports offline fallback (queues interval locally and syncs later).
    const startResult = (await timerStartJob({
      tenantId: profile.tenant_id,
      userId: profile.id,
      jobType: 'task',
      jobId: taskId,
      pauseExisting: options?.pauseExisting ?? false,
    })) as unknown as TimerRpcResult;
    if (!startResult.ok) return startResult;

    try {
      const nowIso = new Date().toISOString();
      const taskUpdates: any = {
        status: 'in_progress',
        // Explicitly preserve the original assignment — do NOT overwrite with the
        // logged-in user.  If the task was unassigned, keep it unassigned.
        assigned_to: taskData.assigned_to ?? null,
      };
      if (!taskData?.started_at) {
        taskUpdates.started_at = nowIso;
        taskUpdates.started_by = profile.id;
      }

      // Manual review workflow: allow start, but clear the "Pending review" marker.
      // (Used when client partial-from-grouped is disabled and staff chooses to proceed.)
      try {
        const meta = taskData?.metadata && typeof taskData.metadata === 'object' ? taskData.metadata : null;
        if (meta && (meta as any).pending_review === true) {
          const nextMeta: any = { ...(meta as any) };
          delete nextMeta.pending_review;
          delete nextMeta.pending_review_reason;
          delete nextMeta.split_workflow;
          taskUpdates.metadata = nextMeta;
        }
      } catch {
        // optional
      }

      const { error: updateError } = await (supabase
        .from('tasks') as any)
        .update(taskUpdates)
        .eq('tenant_id', profile.tenant_id)
        .eq('id', taskId);

      if (updateError) {
        // If we started the timer offline, allow the workflow to continue even though we
        // can't persist task status changes yet. Status will update once back online.
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          return startResult;
        }

        // Best-effort rollback: end the interval we just started
        try {
          await timerEndJob({
            tenantId: profile.tenant_id,
            userId: profile.id,
            jobType: 'task',
            jobId: taskId,
            reason: 'rollback',
          });
        } catch {
          // ignore
        }
        return {
          ok: false,
          error_code: 'TASK_UPDATE_FAILED',
          error_message: updateError.message || 'Failed to update task',
        };
      }

      // Update inventory status
      await updateInventoryStatus(taskId, taskData.task_type, 'in_progress');

      // Log activity for linked items
      {
        const { data: taskItems } = await (supabase.from('task_items') as any)
          .select('item_id').eq('task_id', taskId);
        if (taskItems) {
          for (const ti of taskItems) {
            logItemActivity({
              tenantId: profile.tenant_id,
              itemId: ti.item_id,
              actorUserId: profile.id,
              eventType: 'task_started',
              eventLabel: `${taskData.task_type} task started`,
              details: { task_id: taskId, task_type: taskData.task_type },
            });
          }
        }
      }

      // Queue task.assigned alert (task started = assigned to current user)
      await queueTaskAssignedAlert(profile.tenant_id, taskId, taskData.task_type);

      fetchTasks();
      return startResult;
    } catch (error: any) {
      console.error('[startTaskDetailed] Error:', error);
      // Don't roll back interval here — task may have started successfully already.
      return {
        ok: false,
        error_code: 'START_TASK_FAILED',
        error_message: error?.message || 'Failed to start task',
      };
    }
  };
  // -------------------------------------------------------------------------
  // Estimated Service Time snapshot (for historical reporting)
  // -------------------------------------------------------------------------
  const computeTaskServiceTimeSnapshot = async (params: {
    taskId: string;
    taskType: string;
    taskTypeId: string | null;
    completionValues?: CompletionLineValues[];
    snapshotAt: string;
  }): Promise<ServiceTimeSnapshotV1 | null> => {
    if (!profile?.tenant_id) return null;

    try {
      // Prefer explicit completionValues (most accurate); otherwise use stored service lines.
      const hasCompletionValues = (params.completionValues?.length || 0) > 0;
      const storedLines = hasCompletionValues
        ? []
        : await fetchTaskServiceLinesStatic(params.taskId, profile.tenant_id);

      const lines: Array<{
        charge_code: string;
        input_mode: string;
        qty: number;
        minutes: number;
      }> = hasCompletionValues
        ? (params.completionValues || []).map(v => ({
            charge_code: v.charge_code,
            input_mode: v.input_mode,
            qty: v.qty || 0,
            minutes: v.minutes || 0,
          }))
        : storedLines.map(l => ({
            charge_code: l.charge_code,
            input_mode: l.input_mode,
            qty: l.qty || 0,
            minutes: l.minutes || 0,
          }));

      // Source A: service lines (small count; safe to store breakdown)
      if (lines.length > 0) {
        // Match existing billing behavior: pick first task item's class for class-based services.
        let classCode: string | null = null;
        try {
          const { data: firstTaskItem } = await (supabase
            .from('task_items') as any)
            .select('item_id, items:item_id(class_id)')
            .eq('task_id', params.taskId)
            .limit(1)
            .maybeSingle();

          const classId = firstTaskItem?.items?.class_id || null;
          if (classId) {
            const { data: cls } = await supabase
              .from('classes')
              .select('code')
              .eq('tenant_id', profile.tenant_id)
              .eq('id', classId)
              .maybeSingle();
            classCode = cls?.code || null;
          }
        } catch {
          // Best-effort
        }

        const cache = new Map<string, { unit: string; service_time_minutes: number }>();
        let totalMinutes = 0;
        const breakdown: ServiceTimeSnapshotV1['estimated_breakdown'] = [];

        for (const line of lines) {
          const quantity = line.input_mode === 'time'
            ? (line.minutes / 60) // matches billing quantity conversion (minutes -> hours)
            : line.qty;
          if (!Number.isFinite(quantity) || quantity <= 0) continue;

          const cacheKey = `${line.charge_code}::${classCode || ''}`;
          let unit = 'each';
          let serviceTimeMinutes = 0;

          const cached = cache.get(cacheKey);
          if (cached) {
            unit = cached.unit;
            serviceTimeMinutes = cached.service_time_minutes;
          } else {
            try {
              const rate = await getEffectiveRate({
                tenantId: profile.tenant_id,
                chargeCode: line.charge_code,
                // Estimate snapshots should not be blocked by account-level billing disable/adjustments.
                classCode: classCode || undefined,
              });
              unit = rate.unit || 'each';
              serviceTimeMinutes = rate.service_time_minutes || 0;
              cache.set(cacheKey, { unit, service_time_minutes: serviceTimeMinutes });
            } catch (err) {
              // Best-effort: if this service isn't configured, treat as 0 minutes and continue.
              console.warn('[useTasks] Estimate rate lookup failed:', { charge_code: line.charge_code, err });
              unit = 'each';
              serviceTimeMinutes = 0;
              cache.set(cacheKey, { unit, service_time_minutes: serviceTimeMinutes });
            }
          }

          const estimatedMinutes = estimateServiceMinutes({
            serviceTimeMinutes,
            unit,
            quantity,
          });
          totalMinutes += estimatedMinutes;

          if (breakdown && breakdown.length < 25) {
            breakdown.push({
              charge_code: line.charge_code,
              unit,
              service_time_minutes: serviceTimeMinutes,
              quantity,
              estimated_minutes: estimatedMinutes,
            });
          }
        }

        return {
          estimated_minutes: Math.round(totalMinutes),
          estimated_snapshot_at: params.snapshotAt,
          estimated_source: 'service_lines',
          estimated_version: 1,
          ...(breakdown && breakdown.length > 0 ? { estimated_breakdown: breakdown } : {}),
        };
      }

      // Source B: billing preview (primary service / category-based; no breakdown stored)
      if (!params.taskTypeId) {
        return {
          estimated_minutes: 0,
          estimated_snapshot_at: params.snapshotAt,
          estimated_source: 'unknown',
          estimated_version: 1,
        };
      }

      const { data: taskTypeData } = await (supabase
        .from('task_types') as any)
        .select('category_id, primary_service_code, default_service_code, requires_manual_rate')
        .eq('id', params.taskTypeId)
        .maybeSingle();

      if (taskTypeData?.requires_manual_rate === true) {
        return {
          estimated_minutes: 0,
          estimated_snapshot_at: params.snapshotAt,
          estimated_source: 'unknown',
          estimated_version: 1,
        };
      }

      const categoryId: string | null = taskTypeData?.category_id || null;
      const effectiveServiceCode: string | null =
        taskTypeData?.primary_service_code || taskTypeData?.default_service_code || null;

      if (!categoryId && !effectiveServiceCode) {
        return {
          estimated_minutes: 0,
          estimated_snapshot_at: params.snapshotAt,
          estimated_source: 'unknown',
          estimated_version: 1,
        };
      }

      const preview = await calculateTaskBillingPreview(
        profile.tenant_id,
        params.taskId,
        params.taskType,
        effectiveServiceCode,
        null,
        null,
        categoryId,
      );

      const totalMinutes = (preview?.lineItems || []).reduce(
        (sum, li) => sum + (li.estimatedMinutes || 0),
        0,
      );

      return {
        estimated_minutes: Math.round(totalMinutes),
        estimated_snapshot_at: params.snapshotAt,
        estimated_source: 'billing_preview',
        estimated_version: 1,
      };
    } catch (error) {
      console.warn('[useTasks] computeTaskServiceTimeSnapshot error:', error);
      return null;
    }
  };

  const computeTaskActualTimeSnapshot = async (params: {
    taskId: string;
    snapshotAt: string;
  }): Promise<ServiceTimeActualSnapshotV1 | null> => {
    if (!profile?.tenant_id || !profile?.id) return null;

    try {
      // End any active interval for THIS user + task (idempotent)
      try {
        await timerEndJob({
          tenantId: profile.tenant_id,
          userId: profile.id,
          jobType: 'task',
          jobId: params.taskId,
          reason: 'complete',
        });
      } catch (endErr) {
        // Best-effort — still compute from what we have
        console.warn('[useTasks] Failed to end active task timer on completion:', endErr);
      }

      // Sum labor minutes across all users for this job.
      // For phase 1 (single-user default) this equals cycle time as well.
      const { data: rows, error } = await (supabase
        .from('job_time_intervals') as any)
        .select('started_at, ended_at')
        .eq('tenant_id', profile.tenant_id)
        .eq('job_type', 'task')
        .eq('job_id', params.taskId);

      if (error) throw error;

      const endFallbackIso = params.snapshotAt;
      const labor = (rows || []).reduce((sum: number, r: any) => {
        const start = r.started_at as string;
        const end = (r.ended_at as string | null) || endFallbackIso;
        return sum + minutesBetweenIso(start, end);
      }, 0);

      const laborMinutes = Math.round(labor);
      const cycleMinutes = laborMinutes;

      return {
        actual_cycle_minutes: cycleMinutes,
        actual_labor_minutes: laborMinutes,
        actual_snapshot_at: params.snapshotAt,
        actual_version: 1,
      };
    } catch (error) {
      console.warn('[useTasks] computeTaskActualTimeSnapshot error:', error);
      return null;
    }
  };

  const completeTask = async (taskId: string, pickupName?: string) => {
    if (!profile?.id) return false;

    try {
      // Get task info first
      const { data: taskData } = await (supabase
        .from('tasks') as any)
        .select('task_type, task_type_id, metadata')
        .eq('id', taskId)
        .single();

      if (!taskData) {
        throw new Error('Task not found');
      }

      const completedAt = new Date().toISOString();

      // Guard: Will Call completion requires pickup name (avoid ending timers if missing)
      if (taskData.task_type === SPECIAL_TASK_TYPES.WILL_CALL && !pickupName) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Pickup name is required for Will Call completion',
        });
        return false;
      }

      // Snapshot estimated service time on completion (best-effort; must not block completion)
      let completedMetadata: any | undefined = undefined;
      try {
        const snapshot = await computeTaskServiceTimeSnapshot({
          taskId,
          taskType: taskData.task_type,
          taskTypeId: taskData.task_type_id || null,
          completionValues: undefined,
          snapshotAt: completedAt,
        });
        if (snapshot) {
          completedMetadata = mergeServiceTimeSnapshot(taskData.metadata ?? null, snapshot);
        }
      } catch (err) {
        console.warn('[useTasks] Failed to snapshot estimated service time (completeTask):', err);
      }

      // Snapshot actual service time on completion (best-effort)
      let actualSnapshot: ServiceTimeActualSnapshotV1 | null = null;
      try {
        actualSnapshot = await computeTaskActualTimeSnapshot({ taskId, snapshotAt: completedAt });
        if (actualSnapshot) {
          completedMetadata = mergeServiceTimeActualSnapshot(
            completedMetadata ?? taskData.metadata ?? null,
            actualSnapshot,
          );
        }
      } catch (err) {
        console.warn('[useTasks] Failed to snapshot actual service time (completeTask):', err);
      }

      // Handle Will Call completion - requires pickup name
      if (taskData.task_type === SPECIAL_TASK_TYPES.WILL_CALL) {
        // Update task with pickup info
        const willCallUpdates: any = {
            status: 'completed',
            completed_at: completedAt,
            completed_by: profile.id,
            billing_charge_date: completedAt,
            pickup_name: pickupName,
            pickup_completed_at: completedAt,
            ended_at: completedAt,
            ended_by: profile.id,
          };
        if (actualSnapshot) {
          willCallUpdates.duration_minutes = actualSnapshot.actual_labor_minutes;
        }
        if (completedMetadata !== undefined) {
          willCallUpdates.metadata = completedMetadata;
        }

        const { error: taskError } = await (supabase
          .from('tasks') as any)
          .update(willCallUpdates)
          .eq('id', taskId);

        if (taskError) throw taskError;

        // Get task items and update them to 'released' status
        const { data: taskItems } = await (supabase
          .from('task_items') as any)
          .select('item_id')
          .eq('task_id', taskId);

        if (taskItems && taskItems.length > 0) {
          const itemIds = taskItems.map((ti: any) => ti.item_id);
          await (supabase
            .from('items') as any)
            .update({ status: 'released' })
            .in('id', itemIds);
        }

        toast({
          title: 'Will Call Completed',
          description: `Items released to ${pickupName}.`,
        });

        // Log task completion per item
        if (taskItems) {
          for (const ti of taskItems) {
            logItemActivity({
              tenantId: profile.tenant_id,
              itemId: ti.item_id,
              actorUserId: profile.id,
              eventType: 'task_completed',
              eventLabel: `Will Call completed (released to ${pickupName})`,
              details: { task_id: taskId, task_type: 'Will Call', pickup_name: pickupName },
            });
          }
        }

        // Queue task.completed alert
        await queueTaskCompletedAlert(profile.tenant_id, taskId, 'Will Call');

        fetchTasks();
        return true;
      }

      // Handle Disposal completion
      if (taskData.task_type === SPECIAL_TASK_TYPES.DISPOSAL) {
        // Update task
        const disposalUpdates: any = {
            status: 'completed',
            completed_at: completedAt,
            completed_by: profile.id,
            billing_charge_date: completedAt,
            ended_at: completedAt,
            ended_by: profile.id,
          };
        if (actualSnapshot) {
          disposalUpdates.duration_minutes = actualSnapshot.actual_labor_minutes;
        }
        if (completedMetadata !== undefined) {
          disposalUpdates.metadata = completedMetadata;
        }

        const { error: taskError } = await (supabase
          .from('tasks') as any)
          .update(disposalUpdates)
          .eq('id', taskId);

        if (taskError) throw taskError;

        // Get task items and update them to 'disposed' status with deleted_at
        const { data: taskItems } = await (supabase
          .from('task_items') as any)
          .select('item_id')
          .eq('task_id', taskId);

        if (taskItems && taskItems.length > 0) {
          const itemIds = taskItems.map((ti: any) => ti.item_id);
          await (supabase
            .from('items') as any)
            .update({ 
              status: 'disposed',
              deleted_at: new Date().toISOString(),
            })
            .in('id', itemIds);
        }

        toast({
          title: 'Disposal Completed',
          description: 'Items have been marked as disposed.',
        });

        // Log task completion per item
        if (taskItems) {
          for (const ti of taskItems) {
            logItemActivity({
              tenantId: profile.tenant_id,
              itemId: ti.item_id,
              actorUserId: profile.id,
              eventType: 'task_completed',
              eventLabel: 'Disposal task completed (item disposed)',
              details: { task_id: taskId, task_type: 'Disposal' },
            });
          }
        }

        // Queue task.completed alert
        await queueTaskCompletedAlert(profile.tenant_id, taskId, 'Disposal');

        fetchTasks();
        return true;
      }

      // Normal task completion for other task types
      const normalUpdates: any = {
          status: 'completed',
          completed_at: completedAt,
          completed_by: profile.id,
          billing_charge_date: completedAt,
          ended_at: completedAt,
          ended_by: profile.id,
        };
      if (actualSnapshot) {
        normalUpdates.duration_minutes = actualSnapshot.actual_labor_minutes;
      }
      if (completedMetadata !== undefined) {
        normalUpdates.metadata = completedMetadata;
      }

      const { error } = await (supabase
        .from('tasks') as any)
        .update(normalUpdates)
        .eq('id', taskId);

      if (error) throw error;

      // Update inventory status
      await updateInventoryStatus(taskId, taskData.task_type, 'completed');

      // For Repair tasks: clear damage and quarantine flags on items
      if (taskData.task_type === 'Repair') {
        await clearDamageAndQuarantine(taskId);
      }

      // Get task account_id for billing
      const { data: taskFullData } = await (supabase
        .from('tasks') as any)
        .select('account_id')
        .eq('id', taskId)
        .single();

      // Create billing events for task completion
      await createTaskBillingEvents(taskId, taskData.task_type, taskFullData?.account_id);

      // Also convert any task custom charges to billing events
      await convertTaskCustomChargesToBillingEvents(taskId, taskFullData?.account_id);

      // Log task completion per linked item
      {
        const { data: taskItemsForLog } = await (supabase.from('task_items') as any)
          .select('item_id').eq('task_id', taskId);
        if (taskItemsForLog) {
          for (const ti of taskItemsForLog) {
            logItemActivity({
              tenantId: profile.tenant_id,
              itemId: ti.item_id,
              actorUserId: profile.id,
              eventType: 'task_completed',
              eventLabel: `${taskData.task_type} task completed`,
              details: { task_id: taskId, task_type: taskData.task_type },
            });
          }
        }
      }

      toast({
        title: 'Task Completed',
        description: 'Task has been marked as completed.',
      });

      // Queue task.completed alert
      await queueTaskCompletedAlert(profile.tenant_id, taskId, taskData.task_type);

      // For Inspection tasks, also queue a specific inspection completed alert
      if (taskData.task_type === 'Inspection') {
        // Get first item from task for the alert
        const { data: firstTaskItem } = await (supabase
          .from('task_items') as any)
          .select(`
            item_id,
            items:item_id(item_code, has_damage, account_id, accounts!items_account_id_fkey(alerts_contact_email, primary_contact_email))
          `)
          .eq('task_id', taskId)
          .limit(1)
          .maybeSingle();
        
        if (firstTaskItem?.items) {
          const accountEmail = (firstTaskItem.items.accounts as any)?.alerts_contact_email || 
                               (firstTaskItem.items.accounts as any)?.primary_contact_email || undefined;
          await queueInspectionCompletedAlert(
            profile.tenant_id,
            taskId,
            firstTaskItem.items.item_code || 'Unknown',
            firstTaskItem.items.has_damage || false,
            accountEmail
          );
        }
      }

      fetchTasks();
      return true;
    } catch (error) {
      console.error('Error completing task:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to complete task',
      });
      return false;
    }
  };

  // Get task items for a specific task (used for Will Call dialog)
  const getTaskItems = async (taskId: string) => {
    try {
      const { data: taskItems } = await (supabase
        .from('task_items') as any)
        .select(`
          item_id,
          items:item_id(id, item_code, description)
        `)
        .eq('task_id', taskId);

      if (!taskItems) return [];

      return taskItems.map((ti: any) => ({
        id: ti.items?.id || ti.item_id,
        item_code: ti.items?.item_code || 'Unknown',
        description: ti.items?.description || null,
      }));
    } catch (error) {
      console.error('Error fetching task items:', error);
      return [];
    }
  };

  const markUnableToComplete = async (taskId: string, note: string) => {
    if (!profile?.id) return false;

    try {
      // Get task info first
      const { data: taskData } = await (supabase
        .from('tasks') as any)
        .select('task_type, title')
        .eq('id', taskId)
        .single();

      const { error } = await (supabase
        .from('tasks') as any)
        .update({
          status: 'unable_to_complete',
          unable_to_complete_note: note,
          completed_at: new Date().toISOString(),
          completed_by: profile.id,
        })
        .eq('id', taskId);

      if (error) throw error;

      // Update inventory status
      if (taskData) {
        await updateInventoryStatus(taskId, taskData.task_type, 'unable_to_complete');
      }

      toast({
        title: 'Task Marked',
        description: 'Task has been marked as unable to complete.',
      });

      const taskTitle = taskData?.title || `${taskData?.task_type || 'Task'} ${taskId.slice(0, 8)}`;
      await queueTaskUnableToCompleteAlert(
        profile.tenant_id,
        taskId,
        taskTitle,
        note
      );

      fetchTasks();
      return true;
    } catch (error) {
      console.error('Error marking task unable to complete:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update task',
      });
      return false;
    }
  };

  const claimTask = async (taskId: string) => {
    if (!profile?.id) return false;

    try {
      const { error } = await (supabase
        .from('tasks') as any)
        .update({
          assigned_to: profile.id,
        })
        .eq('id', taskId);

      if (error) throw error;

      toast({
        title: 'Task Claimed',
        description: 'You have been assigned to this task.',
      });

      fetchTasks();
      return true;
    } catch (error) {
      console.error('Error claiming task:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to claim task',
      });
      return false;
    }
  };

  const updateTaskStatus = async (taskId: string, status: string) => {
    try {
      // Get task info first
      const { data: taskData, error: fetchError } = await (supabase
        .from('tasks') as any)
        .select('task_type')
        .eq('id', taskId)
        .single();

      if (fetchError) {
        console.error('[updateTaskStatus] Failed to fetch task:', fetchError);
        toast({
          variant: 'destructive',
          title: 'Failed to update status',
          description: fetchError.message || 'Could not find task',
        });
        return false;
      }

      const updates: any = { status };

      if (status === 'completed') {
        updates.completed_at = new Date().toISOString();
        updates.completed_by = profile?.id;
        updates.billing_charge_date = new Date().toISOString();
      }

      const { error } = await (supabase
        .from('tasks') as any)
        .update(updates)
        .eq('id', taskId);

      if (error) {
        console.error('[updateTaskStatus] Update failed:', error);
        toast({
          variant: 'destructive',
          title: 'Failed to update status',
          description: error.message || 'Database error while updating task',
        });
        return false;
      }

      // Update inventory status
      if (taskData) {
        await updateInventoryStatus(taskId, taskData.task_type, status);
      }

      // If completing, create billing events
      if (status === 'completed' && taskData) {
        // Get task account_id for billing
        const { data: taskFullData } = await (supabase
          .from('tasks') as any)
          .select('account_id')
          .eq('id', taskId)
          .single();

        // Create billing events for task completion
        await createTaskBillingEvents(taskId, taskData.task_type, taskFullData?.account_id);

        // Also convert any task custom charges to billing events
        await convertTaskCustomChargesToBillingEvents(taskId, taskFullData?.account_id);
      }

      toast({
        title: 'Status Updated',
        description: `Task status changed to ${status.replace('_', ' ')}.`,
      });

      fetchTasks();
      return true;
    } catch (error: any) {
      console.error('[updateTaskStatus] Exception:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to update status',
        description: error?.message || 'An unexpected error occurred',
      });
      return false;
    }
  };

  const deleteTask = async (taskId: string) => {
    try {
      const { error } = await (supabase
        .from('tasks') as any)
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', taskId);

      if (error) {
        console.error('[deleteTask] Delete failed:', error);
        toast({
          variant: 'destructive',
          title: 'Failed to delete task',
          description: error.message || 'Database error while deleting task',
        });
        return false;
      }

      toast({
        title: 'Task Deleted',
        description: 'Task has been deleted.',
      });

      fetchTasks();
      return true;
    } catch (error: any) {
      console.error('[deleteTask] Exception:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to delete task',
        description: error?.message || 'An unexpected error occurred',
      });
      return false;
    }
  };

  // Generate billing events for a task (can be used for already-completed tasks)
  const generateBillingEventsForTask = async (taskId: string) => {
    if (!profile?.tenant_id) return false;

    try {
      // Get task info
      const { data: taskData, error: taskError } = await (supabase
        .from('tasks') as any)
        .select('task_type, account_id')
        .eq('id', taskId)
        .single();

      if (taskError || !taskData) {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to fetch task data',
        });
        return false;
      }

      // Check if billing events already exist for this task
      const { data: existingEvents } = await (supabase
        .from('billing_events') as any)
        .select('id')
        .eq('task_id', taskId)
        .eq('event_type', 'task_completion')
        .limit(1);

      if (existingEvents && existingEvents.length > 0) {
        toast({
          title: 'Already Generated',
          description: 'Billing events already exist for this task.',
        });
        return true;
      }

      // Create billing events
      await createTaskBillingEvents(taskId, taskData.task_type, taskData.account_id);

      toast({
        title: 'Billing Generated',
        description: 'Billing events have been created for this task.',
      });

      return true;
    } catch (error) {
      console.error('Error generating billing events:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to generate billing events',
      });
      return false;
    }
  };

  // =========================================================================
  // SERVICE-LINE BASED BILLING (Phase 2)
  // =========================================================================

  /**
   * Create billing events from service lines (task_custom_charges with is_service_line flag).
   * Each service line becomes a billing event with rate looked up from the pricing system.
   */
  const createServiceLineBillingEvents = async (
    taskId: string,
    taskType: string,
    accountId: string | null,
    completionValues: CompletionLineValues[],
  ) => {
    if (!profile?.tenant_id || !profile?.id || !accountId) return;

    try {
      // Fetch all classes to map class_id to code
      const { data: allClasses } = await supabase
        .from('classes')
        .select('id, code')
        .eq('tenant_id', profile.tenant_id);
      const classMap = new Map((allClasses || []).map((c: any) => [c.id, c.code]));

      // Get task items for sidemark/class info
      const { data: taskItems } = await (supabase
        .from('task_items') as any)
        .select(`
          item_id,
          items:item_id(id, class_id, sidemark_id, account_id, item_code)
        `)
        .eq('task_id', taskId);

      const firstItem = taskItems?.[0]?.items;
      const sidemarkId = firstItem?.sidemark_id || null;
      const classCode = firstItem?.class_id ? classMap.get(firstItem.class_id) : null;

      const chargeParams: CreateChargeParams[] = [];

      for (const lineVal of completionValues) {
        const quantity = lineVal.input_mode === 'time'
          ? (lineVal.minutes / 60) // Convert minutes to hours for time-based
          : lineVal.qty;

        if (quantity <= 0) continue;

        // Look up rate for this charge code
        let unitRate = 0;
        let hasRateError = false;
        let rateErrorMessage: string | null = null;

        try {
          const rateResult = await getEffectiveRate({
            tenantId: profile.tenant_id,
            chargeCode: lineVal.charge_code,
            accountId,
            classCode,
          });
          unitRate = rateResult.effective_rate;
          hasRateError = rateResult.has_error;
          rateErrorMessage = rateResult.error_message;
        } catch (rateError: any) {
          if (rateError?.message === BILLING_DISABLED_ERROR) {
            // Skip this service — billing disabled for account
            continue;
          }
          // Rate lookup failed — create with error flag
          hasRateError = true;
          rateErrorMessage = rateError?.message || 'Rate lookup failed';
        }

        const description = `${lineVal.charge_name}: ${taskType}`;

        chargeParams.push({
          tenantId: profile.tenant_id,
          accountId: accountId as string,
          chargeCode: lineVal.charge_code,
          eventType: 'task_completion',
          context: { type: 'task', taskId, itemId: firstItem?.id || undefined },
          description,
          quantity,
          rateOverride: unitRate,
          sidemarkId: sidemarkId,
          classId: firstItem?.class_id || null,
          userId: profile.id,
          metadata: {
            task_type: taskType,
            service_line_id: lineVal.lineId,
            charge_type_id: lineVal.charge_type_id,
            input_mode: lineVal.input_mode,
            minutes: lineVal.minutes,
          },
          hasRateError,
          rateErrorMessage,
        });
      }

      if (chargeParams.length > 0) {
        await createCharges(chargeParams);
      }
    } catch (error: any) {
      console.error('[createServiceLineBillingEvents] Error:', error);
      // Don't throw — billing shouldn't block task completion
    }
  };

  /**
   * Complete a task using service lines (Phase 2 flow).
   * Called from TaskCompletionPanel after user confirms qty/time values.
   */
  const completeTaskWithServices = async (
    taskId: string,
    completionValues: CompletionLineValues[],
  ): Promise<boolean> => {
    if (!profile?.id || !profile?.tenant_id) return false;

    try {
      // Get task info
      const { data: taskData } = await (supabase
        .from('tasks') as any)
        .select('task_type, account_id, task_type_id, metadata')
        .eq('id', taskId)
        .single();

      if (!taskData) {
        throw new Error('Task not found');
      }

      const taskType = taskData.task_type;
      const accountId = taskData.account_id;
      const completedAt = new Date().toISOString();

      // Snapshot estimated service time on completion (best-effort; must not block completion)
      let completedMetadata: any | undefined = undefined;
      try {
        const snapshot = await computeTaskServiceTimeSnapshot({
          taskId,
          taskType,
          taskTypeId: taskData.task_type_id || null,
          completionValues,
          snapshotAt: completedAt,
        });
        if (snapshot) {
          completedMetadata = mergeServiceTimeSnapshot(taskData.metadata ?? null, snapshot);
        }
      } catch (err) {
        console.warn('[useTasks] Failed to snapshot estimated service time (completeTaskWithServices):', err);
      }

      // Snapshot actual service time on completion (best-effort)
      let actualSnapshot: ServiceTimeActualSnapshotV1 | null = null;
      try {
        actualSnapshot = await computeTaskActualTimeSnapshot({ taskId, snapshotAt: completedAt });
        if (actualSnapshot) {
          completedMetadata = mergeServiceTimeActualSnapshot(
            completedMetadata ?? taskData.metadata ?? null,
            actualSnapshot,
          );
        }
      } catch (err) {
        console.warn('[useTasks] Failed to snapshot actual service time (completeTaskWithServices):', err);
      }

      // Handle Will Call special completion
      if (taskType === SPECIAL_TASK_TYPES.WILL_CALL) {
        // Will Call still needs pickup name — delegate to standard completeTask
        return false;
      }

      // Handle Disposal special completion
      if (taskType === SPECIAL_TASK_TYPES.DISPOSAL) {
        const disposalUpdates: any = {
            status: 'completed',
            completed_at: completedAt,
            completed_by: profile.id,
            billing_charge_date: completedAt,
            ended_at: completedAt,
            ended_by: profile.id,
          };
        if (actualSnapshot) {
          disposalUpdates.duration_minutes = actualSnapshot.actual_labor_minutes;
        }
        if (completedMetadata !== undefined) {
          disposalUpdates.metadata = completedMetadata;
        }

        const { error: taskError } = await (supabase
          .from('tasks') as any)
          .update(disposalUpdates)
          .eq('id', taskId);

        if (taskError) throw taskError;

        const { data: taskItems } = await (supabase
          .from('task_items') as any)
          .select('item_id')
          .eq('task_id', taskId);

        if (taskItems && taskItems.length > 0) {
          const itemIds = taskItems.map((ti: any) => ti.item_id);
          await (supabase
            .from('items') as any)
            .update({
              status: 'disposed',
              deleted_at: new Date().toISOString(),
            })
            .in('id', itemIds);
        }

        // Still create service line billing events for disposal
        if (completionValues.length > 0) {
          await createServiceLineBillingEvents(taskId, taskType, accountId, completionValues);
        }
        await convertTaskCustomChargesToBillingEvents(taskId, accountId);

        toast({
          title: 'Disposal Completed',
          description: 'Items have been marked as disposed.',
        });

        await queueTaskCompletedAlert(profile.tenant_id, taskId, 'Disposal');
        fetchTasks();
        return true;
      }

      // Normal task completion
      const completionUpdates: any = {
          status: 'completed',
          completed_at: completedAt,
          completed_by: profile.id,
          billing_charge_date: completedAt,
          ended_at: completedAt,
          ended_by: profile.id,
        };
      if (actualSnapshot) {
        completionUpdates.duration_minutes = actualSnapshot.actual_labor_minutes;
      }
      if (completedMetadata !== undefined) {
        completionUpdates.metadata = completedMetadata;
      }

      const { error } = await (supabase
        .from('tasks') as any)
        .update(completionUpdates)
        .eq('id', taskId);

      if (error) throw error;

      // Update inventory status
      await updateInventoryStatus(taskId, taskType, 'completed');

      // For Repair tasks: clear damage and quarantine flags on items
      if (taskType === 'Repair') {
        await clearDamageAndQuarantine(taskId);
      }

      // BUILD-38: Check waive_charges before creating billing events
      const { data: waiveCheck } = await (supabase
        .from('tasks') as any)
        .select('waive_charges')
        .eq('id', taskId)
        .single();

      if (waiveCheck?.waive_charges !== true) {
        // Create billing events from service lines
        if (completionValues.length > 0) {
          await createServiceLineBillingEvents(taskId, taskType, accountId, completionValues);
        } else {
          // Fallback to legacy billing (primary_service_code) if no service lines
          await createTaskBillingEvents(taskId, taskType, accountId);
        }

        // Convert remaining custom charges
        await convertTaskCustomChargesToBillingEvents(taskId, accountId);
      }

      // Log task completion per linked item
      {
        const { data: taskItemsForLog } = await (supabase.from('task_items') as any)
          .select('item_id').eq('task_id', taskId);
        if (taskItemsForLog) {
          for (const ti of taskItemsForLog) {
            logItemActivity({
              tenantId: profile.tenant_id,
              itemId: ti.item_id,
              actorUserId: profile.id,
              eventType: 'task_completed',
              eventLabel: `${taskType} task completed`,
              details: { task_id: taskId, task_type: taskType },
            });
          }
        }
      }

      toast({
        title: 'Task Completed',
        description: 'Task has been marked as completed.',
      });

      // Queue alerts
      await queueTaskCompletedAlert(profile.tenant_id, taskId, taskType);

      if (taskType === 'Inspection') {
        const { data: firstTaskItem } = await (supabase
          .from('task_items') as any)
          .select(`
            item_id,
            items:item_id(item_code, has_damage, account_id, accounts!items_account_id_fkey(alerts_contact_email, primary_contact_email))
          `)
          .eq('task_id', taskId)
          .limit(1)
          .maybeSingle();

        if (firstTaskItem?.items) {
          const accountEmail = (firstTaskItem.items.accounts as any)?.alerts_contact_email ||
                               (firstTaskItem.items.accounts as any)?.primary_contact_email || undefined;
          await queueInspectionCompletedAlert(
            profile.tenant_id,
            taskId,
            firstTaskItem.items.item_code || 'Unknown',
            firstTaskItem.items.has_damage || false,
            accountEmail
          );
        }
      }

      fetchTasks();
      return true;
    } catch (error) {
      console.error('Error completing task with services:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to complete task',
      });
      return false;
    }
  };

  /**
   * Check if a task has service lines (for validation before completion).
   */
  const getTaskServiceLineCount = async (taskId: string): Promise<number> => {
    if (!profile?.tenant_id) return 0;
    const lines = await fetchTaskServiceLinesStatic(taskId, profile.tenant_id);
    return lines.length;
  };

  return {
    tasks,
    loading,
    isRefetching,
    refetch: () => fetchTasks(false),
    createTask,
    updateTask,
    startTaskDetailed,
    completeTask,
    completeTaskWithServices,
    getTaskServiceLineCount,
    markUnableToComplete,
    claimTask,
    updateTaskStatus,
    deleteTask,
    getTaskItems,
    generateBillingEventsForTask,
  };
}

export function useTaskTypes() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [loading, setLoading] = useState(true);

  const defaultTypes = [
    { name: 'Inspection', is_system: true },
    { name: 'Assembly', is_system: true },
    { name: 'Repair', is_system: true },
    { name: 'Disposal', is_system: true, completion_action: 'dispose' },
    { name: 'Other', is_system: true },
  ];

  const fetchTaskTypes = useCallback(async () => {
    if (!profile?.tenant_id) return;

    try {
      setLoading(true);
      const { data, error } = await (supabase
        .from('task_types') as any)
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .order('sort_order');

      if (error) throw error;

      // If no task types exist, create defaults
      if (!data || data.length === 0) {
        const defaultData = defaultTypes.map(t => ({
          ...t,
          tenant_id: profile.tenant_id,
          is_active: true,
          color: '#6366f1',
        }));

        await (supabase.from('task_types') as any).insert(defaultData);
        fetchTaskTypes();
        return;
      }

      setTaskTypes(data);
    } catch (error) {
      console.error('Error fetching task types:', error);
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id]);

  useEffect(() => {
    fetchTaskTypes();
  }, [fetchTaskTypes]);

  const createTaskType = async (name: string, description?: string) => {
    if (!profile?.tenant_id) return null;

    // Normalize to Title Case for consistency (e.g. "UNPACK" → "Unpack")
    const normalizedName = name.trim().split(/\s+/).map(
      w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    ).join(' ');

    try {
      const { data, error } = await (supabase
        .from('task_types') as any)
        .insert({
          tenant_id: profile.tenant_id,
          name: normalizedName,
          description,
          is_system: false,
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Task Type Created',
        description: `"${normalizedName}" has been added.`,
      });

      fetchTaskTypes();
      return data;
    } catch (error) {
      console.error('Error creating task type:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to create task type',
      });
      return null;
    }
  };

  return {
    taskTypes,
    loading,
    refetch: fetchTaskTypes,
    createTaskType,
  };
}

export function useDueDateRules(accountId?: string) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [rules, setRules] = useState<DueDateRule[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRules = useCallback(async () => {
    if (!profile?.tenant_id) return;

    try {
      setLoading(true);
      let query = (supabase
        .from('due_date_rules') as any)
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true);

      if (accountId) {
        query = query.or(`account_id.eq.${accountId},account_id.is.null`);
      } else {
        query = query.is('account_id', null);
      }

      const { data, error } = await query;

      if (error) throw error;
      setRules(data || []);
    } catch (error) {
      console.error('Error fetching due date rules:', error);
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, accountId]);

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  const getDueDateForTaskType = useCallback((taskType: string): Date => {
    const rule = rules.find(r => r.task_type === taskType);
    const days = rule?.days_from_creation || 3; // Default 3 days
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + days);
    return dueDate;
  }, [rules]);

  const saveRule = async (taskType: string, days: number, forAccountId?: string) => {
    if (!profile?.tenant_id) return false;

    try {
      // Upsert rule
      const { error } = await (supabase
        .from('due_date_rules') as any)
        .upsert({
          tenant_id: profile.tenant_id,
          account_id: forAccountId || null,
          task_type: taskType,
          days_from_creation: days,
          is_active: true,
        }, {
          onConflict: 'tenant_id,account_id,task_type',
        });

      if (error) throw error;

      toast({
        title: 'Rule Saved',
        description: `Due date rule for ${taskType} has been updated.`,
      });

      fetchRules();
      return true;
    } catch (error) {
      console.error('Error saving due date rule:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to save due date rule',
      });
      return false;
    }
  };

  return {
    rules,
    loading,
    refetch: fetchRules,
    getDueDateForTaskType,
    saveRule,
  };
}

export function useSubtasks(taskId: string) {
  const { toast } = useToast();
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchSubtasks = useCallback(async () => {
    if (!taskId) return;

    try {
      setLoading(true);
      const { data, error } = await (supabase
        .from('subtasks') as any)
        .select('*')
        .eq('task_id', taskId)
        .order('sort_order');

      if (error) throw error;
      setSubtasks(data || []);
    } catch (error) {
      console.error('Error fetching subtasks:', error);
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchSubtasks();
  }, [fetchSubtasks]);

  const addSubtask = async (title: string, description?: string) => {
    try {
      const { error } = await (supabase
        .from('subtasks') as any)
        .insert({
          task_id: taskId,
          title,
          description,
          sort_order: subtasks.length,
        });

      if (error) throw error;

      fetchSubtasks();
      return true;
    } catch (error) {
      console.error('Error adding subtask:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to add subtask',
      });
      return false;
    }
  };

  const toggleSubtask = async (subtaskId: string, isCompleted: boolean) => {
    try {
      const { error } = await (supabase
        .from('subtasks') as any)
        .update({
          is_completed: isCompleted,
          completed_at: isCompleted ? new Date().toISOString() : null,
        })
        .eq('id', subtaskId);

      if (error) throw error;

      fetchSubtasks();
      return true;
    } catch (error) {
      console.error('Error toggling subtask:', error);
      return false;
    }
  };

  const deleteSubtask = async (subtaskId: string) => {
    try {
      const { error } = await (supabase
        .from('subtasks') as any)
        .delete()
        .eq('id', subtaskId);

      if (error) throw error;

      fetchSubtasks();
      return true;
    } catch (error) {
      console.error('Error deleting subtask:', error);
      return false;
    }
  };

  return {
    subtasks,
    loading,
    refetch: fetchSubtasks,
    addSubtask,
    toggleSubtask,
    deleteSubtask,
  };
}
