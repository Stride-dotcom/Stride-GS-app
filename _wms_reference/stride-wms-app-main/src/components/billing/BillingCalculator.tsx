/**
 * BillingCalculator Component
 *
 * Displays real-time billing view combining:
 * 1. Preview of charges that WILL be created (based on current items/rates)
 * 2. Actual billing_events that already EXIST in the database
 *
 * This is a READ-ONLY view - use the page-level "Add Charge" button to add charges.
 *
 * Allows voiding of unbilled addon charges directly inline for immediate corrections.
 *
 * BUILD-38: Adds "Waive Charges" toggle with reason/notes modal, voiding of all
 * unbilled billing_events, and invoiced-lock.
 *
 * Uses shared logic from: src/lib/billing/billingCalculation.ts
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { PERMISSIONS, usePermissions } from '@/hooks/usePermissions';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import {
  calculateTaskBillingPreview,
  calculateShipmentBillingPreview,
  BillingPreview,
} from '@/lib/billing/billingCalculation';
import { formatMinutesShort } from '@/lib/time/serviceTimeEstimate';
import { estimateServiceMinutes } from '@/lib/time/serviceTimeEstimate';
import { getEffectiveRate } from '@/lib/billing/chargeTypeUtils';
import { logActivity, logBillingActivity } from '@/lib/activity/logActivity';
import { voidCharge, voidBillingEventWithMetadataMerge } from '@/services/billing';

// ============================================================================
// WAIVE REASONS
// ============================================================================

const WAIVE_REASONS = [
  'Customer Courtesy',
  'Damage Responsibility Dispute',
  'Internal Error',
  'Promotional Waiver',
  'Warranty Coverage',
  'Other',
] as const;

type WaiveReason = typeof WAIVE_REASONS[number];

// ============================================================================
// TYPES
// ============================================================================

interface ExistingBillingEvent {
  id: string;
  charge_type: string;
  description: string | null;
  quantity: number;
  unit_rate: number | null; // null for pending-rate billing events (Safety Billing)
  total_amount: number | null; // null when rate is pending
  event_type: string;
  status: string;
}

// Service line preview data for task billing
interface ServiceLinePreviewItem {
  chargeCode: string;
  chargeName: string;
  quantity: number;
  unitRate: number;
  totalAmount: number;
  hasError: boolean;
  estimatedMinutes?: number;
}

interface BillingCalculatorProps {
  // Context - provide ONE of these
  taskId?: string;
  shipmentId?: string;
  itemId?: string;
  accountId?: string;

  // Context details
  taskType?: string;
  taskTypeId?: string;
  shipmentDirection?: 'inbound' | 'outbound' | 'return';

  // Service line preview (NEW - takes precedence over legacy task billing preview)
  // When provided, displays these as "Pending Charges" instead of calculated preview
  serviceLinePreview?: ServiceLinePreviewItem[];

  // Refresh trigger
  refreshKey?: number;

  // Callback when charges change (e.g., after voiding)
  onChargesChange?: () => void;

  // Display options
  title?: string;
  compact?: boolean;
}

// ============================================================================
// COMPONENT
// ============================================================================

export function BillingCalculator({
  taskId,
  shipmentId,
  itemId,
  accountId,
  taskType,
  taskTypeId,
  shipmentDirection = 'inbound',
  serviceLinePreview,
  refreshKey = 0,
  onChargesChange,
  title = 'Billing Charges',
  compact = true,
}: BillingCalculatorProps) {
  const { profile } = useAuth();
  const { hasRole, hasPermission, isAdmin } = usePermissions();
  const { toast } = useToast();

  // State
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<BillingPreview | null>(null);
  const [existingEvents, setExistingEvents] = useState<ExistingBillingEvent[]>([]);
  const [serviceLineEstimates, setServiceLineEstimates] = useState<number[]>([]);

  // Void confirmation state
  const [voidingEventId, setVoidingEventId] = useState<string | null>(null);
  const [voidConfirmOpen, setVoidConfirmOpen] = useState(false);
  const [isVoiding, setIsVoiding] = useState(false);

  // BUILD-38: Waive charges state
  const [waiveCharges, setWaiveCharges] = useState(false);
  const [waiveReason, setWaiveReason] = useState<string | null>(null);
  const [waiveNotes, setWaiveNotes] = useState<string | null>(null);
  const [waiveModalOpen, setWaiveModalOpen] = useState(false);
  const [waiveModalReason, setWaiveModalReason] = useState<WaiveReason | ''>('');
  const [waiveModalNotes, setWaiveModalNotes] = useState('');
  const [waiveSaving, setWaiveSaving] = useState(false);
  const [waiveInvoicedLock, setWaiveInvoicedLock] = useState(false);

  // Permission check - only billing managers/admins can void manual (addon) charges
  // Use capabilities first (more reliable than role names), but keep role-name fallback.
  const canVoidCharges =
    isAdmin ||
    hasPermission(PERMISSIONS.BILLING_INVOICE) ||
    hasPermission(PERMISSIONS.BILLING_CREATE) ||
    hasRole('manager') ||
    hasRole('admin') ||
    hasRole('owner');

  // BUILD-38: Waive toggle permissions (admin/manager/billing_manager/admin_dev)
  const canWaiveCharges =
    isAdmin || hasRole('admin') || hasRole('manager') || hasRole('billing_manager') || hasRole('admin_dev');

  // Determine context
  const isTask = !!taskId;
  const isShipment = !!shipmentId && !taskId;
  const isItem = !!itemId && !taskId && !shipmentId;
  const isAccount = !!accountId && !taskId && !shipmentId && !itemId;

  // BUILD-38: Fetch task waive state + invoiced lock
  const fetchWaiveState = useCallback(async () => {
    if (!taskId || !profile?.tenant_id) return;

    try {
      // Fetch task waive fields
      const { data: taskData } = await (supabase
        .from('tasks') as any)
        .select('waive_charges, waived_at, waived_by, waive_reason, waive_notes, tenant_id')
        .eq('id', taskId)
        .single();

      if (taskData) {
        setWaiveCharges(taskData.waive_charges === true);
        setWaiveReason(taskData.waive_reason || null);
        setWaiveNotes(taskData.waive_notes || null);
      }

      // Check if any billing_event for this task is invoiced (locks toggle)
      const tenantId = taskData?.tenant_id || profile.tenant_id;
      const { data: invoicedEvents } = await (supabase
        .from('billing_events') as any)
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('task_id', taskId)
        .or('status.eq.invoiced,invoice_id.not.is.null')
        .limit(1);

      setWaiveInvoicedLock(!!invoicedEvents && invoicedEvents.length > 0);
    } catch (error) {
      console.error('[BillingCalculator] Error fetching waive state:', error);
    }
  }, [taskId, profile?.tenant_id]);

  // Fetch existing billing events from database
  const fetchExistingEvents = useCallback(async () => {
    if (!profile?.tenant_id) return;

    try {
      let query = (supabase.from('billing_events') as any)
        .select('id, charge_type, description, quantity, unit_rate, total_amount, event_type, status')
        .eq('tenant_id', profile.tenant_id)
        // Include void for audit integrity (reversals and voided charges should still be visible)
        .in('status', ['unbilled', 'invoiced', 'void']);

      // Filter by context
      if (shipmentId) {
        query = query.eq('shipment_id', shipmentId);
      } else if (taskId) {
        query = query.eq('task_id', taskId);
      } else if (itemId) {
        query = query.eq('item_id', itemId);
      } else if (accountId) {
        // For account-level, get charges without task/shipment/item
        query = query
          .eq('account_id', accountId)
          .is('task_id', null)
          .is('shipment_id', null)
          .is('item_id', null);
      } else {
        setExistingEvents([]);
        return;
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) {
        console.error('[BillingCalculator] Error fetching existing events:', error);
        setExistingEvents([]);
        return;
      }

      setExistingEvents(data || []);
    } catch (error) {
      console.error('[BillingCalculator] Unexpected error:', error);
      setExistingEvents([]);
    }
  }, [profile?.tenant_id, shipmentId, taskId, itemId, accountId]);

  // Calculate billing preview (what WILL be created)
  const calculatePreview = useCallback(async () => {
    if (!profile?.tenant_id) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Fetch existing events first
      await fetchExistingEvents();

      // BUILD-38: Fetch waive state for task context
      if (isTask && taskId) {
        await fetchWaiveState();
      }

      let result: BillingPreview;

      if (isTask && taskId && taskType) {
        // Fetch task type details to get category_id and check if manual rate required
        let categoryId: string | null = null;
        let effectiveServiceCode: string | null = null;
        let requiresManualRate = false;

        // Query by task_type_id (precise) if available, otherwise fall back to name
        let taskTypeQuery = (supabase.from('task_types') as any)
          .select('category_id, primary_service_code, default_service_code, requires_manual_rate');

        if (taskTypeId) {
          taskTypeQuery = taskTypeQuery.eq('id', taskTypeId);
        } else {
          taskTypeQuery = taskTypeQuery
            .eq('tenant_id', profile.tenant_id)
            .eq('name', taskType);
        }

        const { data: taskTypeData } = await taskTypeQuery.maybeSingle();

        if (taskTypeData) {
          categoryId = taskTypeData.category_id;
          // Check if this task type requires manual rate entry (Safety Billing)
          // Only use database flag - no hardcoded task type names
          requiresManualRate = taskTypeData.requires_manual_rate === true;

          // Use primary_service_code with default_service_code fallback
          if (!categoryId && !effectiveServiceCode) {
            effectiveServiceCode = taskTypeData.primary_service_code ||
                                   taskTypeData.default_service_code ||
                                   null;
          }
        }
        // If no task type found, effectiveServiceCode stays null (non-billable)

        // Non-billable: no category and no service code configured
        if (!categoryId && !effectiveServiceCode && !requiresManualRate) {
          result = {
            lineItems: [],
            subtotal: 0,
            hasErrors: false,
            serviceCode: '',
            serviceName: '',
            errorMessage: 'No primary service configured for this task type.',
          };
        } else if (requiresManualRate) {
          // SAFETY BILLING: For manual-rate task types, show rate required banner
          result = {
            lineItems: [],
            subtotal: 0,
            hasErrors: true,
            serviceCode: effectiveServiceCode || taskType,
            serviceName: `${taskType} (Rate Required)`,
            errorMessage: 'This task type requires a manually set rate. Rate will be set after task completion.',
          };
        } else {
          result = await calculateTaskBillingPreview(
            profile.tenant_id,
            taskId,
            taskType,
            effectiveServiceCode,
            null, // overrideQuantity - not used when serviceLinePreview is provided
            null, // overrideRate - not used when serviceLinePreview is provided
            categoryId  // Pass category_id for new billing model
          );
        }
      } else if (isShipment && shipmentId) {
        result = await calculateShipmentBillingPreview(
          profile.tenant_id,
          shipmentId,
          shipmentDirection
        );
      } else {
        // For item/account level, no preview - just show existing events
        result = {
          lineItems: [],
          subtotal: 0,
          hasErrors: false,
          serviceCode: '',
          serviceName: '',
        };
      }

      setPreview(result);
    } catch (error) {
      console.error('[BillingCalculator] Error calculating preview:', error);
      setPreview({
        lineItems: [],
        subtotal: 0,
        hasErrors: true,
        serviceCode: '',
        serviceName: '',
      });
    } finally {
      setLoading(false);
    }
  }, [
    profile?.tenant_id,
    isTask,
    isShipment,
    taskId,
    shipmentId,
    taskType,
    shipmentDirection,
    fetchExistingEvents,
    fetchWaiveState,
  ]);

  // Void a billing event
  const handleVoidCharge = async () => {
    if (!voidingEventId) return;

    // Guard: prevent voiding invoiced events (race condition safety)
    const targetEvent = existingEvents.find(e => e.id === voidingEventId);
    if (targetEvent?.status === 'invoiced') {
      toast({ title: 'Cannot void', description: 'Invoiced charges cannot be voided.', variant: 'destructive' });
      setVoidConfirmOpen(false);
      setVoidingEventId(null);
      return;
    }

    setIsVoiding(true);
    try {
      const result = await voidCharge(voidingEventId); // Only voids unbilled charges (guarded)

      if (!result.success) throw new Error('Failed to void charge');

      toast({
        title: 'Charge voided',
        description: 'The charge has been removed from billing.',
      });

      // Refresh the list
      await fetchExistingEvents();
      onChargesChange?.();
    } catch (error: any) {
      console.error('[BillingCalculator] Error voiding charge:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to void charge',
        variant: 'destructive',
      });
    } finally {
      setIsVoiding(false);
      setVoidConfirmOpen(false);
      setVoidingEventId(null);
    }
  };

  // Check if an event can be voided
  const canVoidEvent = (event: ExistingBillingEvent) => {
    // Can only void unbilled addon charges
    return canVoidCharges && event.status === 'unbilled' && event.event_type === 'addon';
  };

  // ========================================================================
  // BUILD-38: Waive Charges toggle handlers
  // ========================================================================

  const handleWaiveToggle = (checked: boolean) => {
    if (waiveInvoicedLock) return;
    if (checked) {
      // Toggle ON: open modal for reason/notes
      setWaiveModalReason('');
      setWaiveModalNotes('');
      setWaiveModalOpen(true);
    } else {
      // Toggle OFF: confirm and clear waive state
      handleWaiveOff();
    }
  };

  const handleWaiveOn = async () => {
    if (!taskId || !profile?.tenant_id || !profile?.id) return;
    if (!waiveModalReason) {
      toast({ variant: 'destructive', title: 'Reason required', description: 'Please select a waive reason.' });
      return;
    }
    if (waiveModalReason === 'Other' && !waiveModalNotes.trim()) {
      toast({ variant: 'destructive', title: 'Notes required', description: 'Please provide notes when reason is "Other".' });
      return;
    }

    setWaiveSaving(true);
    try {
      // Fetch task tenant_id for proper scoping
      const { data: taskRow } = await (supabase
        .from('tasks') as any)
        .select('tenant_id, account_id')
        .eq('id', taskId)
        .single();

      const tenantId = taskRow?.tenant_id || profile.tenant_id;

      // RE-CHECK invoiced state (race condition prevention)
      const { data: invoicedCheck } = await (supabase
        .from('billing_events') as any)
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('task_id', taskId)
        .or('status.eq.invoiced,invoice_id.not.is.null')
        .limit(1);

      if (invoicedCheck && invoicedCheck.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Cannot waive',
          description: 'Cannot waive — charges were invoiced while editing.',
        });
        setWaiveModalOpen(false);
        setWaiveSaving(false);
        // Refresh lock state
        setWaiveInvoicedLock(true);
        return;
      }

      // Persist waive ON to tasks (server-confirmed)
      const waiveData = {
        waive_charges: true,
        waived_at: new Date().toISOString(),
        waived_by: profile.id,
        waive_reason: waiveModalReason,
        waive_notes: waiveModalNotes.trim() || null,
      };

      const { error: updateError } = await (supabase
        .from('tasks') as any)
        .update(waiveData)
        .eq('id', taskId);

      if (updateError) throw updateError;

      // Immediately void ALL unbilled billing_events for this task (Phase 4C)
      const { data: unbilledEvents } = await (supabase
        .from('billing_events') as any)
        .select('id, metadata')
        .eq('tenant_id', tenantId)
        .eq('task_id', taskId)
        .eq('status', 'unbilled');

      if (unbilledEvents && unbilledEvents.length > 0) {
        for (const event of unbilledEvents) {
          await voidBillingEventWithMetadataMerge({
            eventId: event.id,
            metadataMerge: {
              void_reason: 'waived',
              waived_by: profile.id,
              waived_at: new Date().toISOString(),
              waive_reason: waiveModalReason,
              waive_notes: waiveModalNotes.trim() || null,
            },
          });
        }
      }

      // Update local state (server-confirmed)
      setWaiveCharges(true);
      setWaiveReason(waiveModalReason);
      setWaiveNotes(waiveModalNotes.trim() || null);
      setWaiveModalOpen(false);

      // Activity logging (fire-and-forget)
      logWaiveActivity(tenantId, taskId, taskRow?.account_id, 'billing_waived_on', 'Billing charges waived', {
        reason: waiveModalReason,
        notes: waiveModalNotes.trim() || null,
        previous_state: false,
        new_state: true,
        voided_count: unbilledEvents?.length || 0,
      });

      toast({
        title: 'Charges Waived',
        description: `All unbilled charges for this task have been voided.${unbilledEvents?.length ? ` (${unbilledEvents.length} voided)` : ''}`,
      });

      // Refresh events
      await fetchExistingEvents();
      onChargesChange?.();
    } catch (error: any) {
      console.error('[BillingCalculator] Error waiving charges:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to waive charges',
      });
    } finally {
      setWaiveSaving(false);
    }
  };

  const handleWaiveOff = async () => {
    if (!taskId || !profile?.tenant_id || !profile?.id) return;

    setWaiveSaving(true);
    try {
      const { data: taskRow } = await (supabase
        .from('tasks') as any)
        .select('tenant_id, account_id')
        .eq('id', taskId)
        .single();

      const tenantId = taskRow?.tenant_id || profile.tenant_id;

      // RE-CHECK invoiced state at save time
      const { data: invoicedCheck } = await (supabase
        .from('billing_events') as any)
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('task_id', taskId)
        .or('status.eq.invoiced,invoice_id.not.is.null')
        .limit(1);

      if (invoicedCheck && invoicedCheck.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Cannot remove waiver',
          description: 'Cannot remove waiver — charges were invoiced.',
        });
        setWaiveInvoicedLock(true);
        setWaiveSaving(false);
        return;
      }

      // Persist waive OFF to tasks
      const { error: updateError } = await (supabase
        .from('tasks') as any)
        .update({
          waive_charges: false,
          waived_at: null,
          waived_by: null,
          waive_reason: null,
          waive_notes: null,
        })
        .eq('id', taskId);

      if (updateError) throw updateError;

      const previousReason = waiveReason;
      const previousNotes = waiveNotes;

      // Update local state
      setWaiveCharges(false);
      setWaiveReason(null);
      setWaiveNotes(null);

      // Activity logging (fire-and-forget)
      logWaiveActivity(tenantId, taskId, taskRow?.account_id, 'billing_waived_off', 'Billing waiver removed', {
        reason: previousReason,
        notes: previousNotes,
        previous_state: true,
        new_state: false,
      });

      toast({
        title: 'Waiver Removed',
        description: 'Charges are no longer waived. Previously voided charges remain void.',
      });

      // Refresh
      await fetchExistingEvents();
      onChargesChange?.();
    } catch (error: any) {
      console.error('[BillingCalculator] Error removing waive:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to remove waiver',
      });
    } finally {
      setWaiveSaving(false);
    }
  };

  // Activity logging for waive events - fan-out to task, account, and item activities
  const logWaiveActivity = async (
    tenantId: string,
    tId: string,
    accountId: string | null,
    eventType: string,
    eventLabel: string,
    details: Record<string, unknown>,
  ) => {
    try {
      // Log to task_activity
      logActivity({
        entityType: 'task',
        tenantId,
        entityId: tId,
        actorUserId: profile?.id,
        eventType,
        eventLabel,
        details,
      });

      // Log to account_activity if task has an account
      if (accountId) {
        logActivity({
          entityType: 'account',
          tenantId,
          entityId: accountId,
          actorUserId: profile?.id,
          eventType,
          eventLabel,
          details: { ...details, task_id: tId },
        });
      }

      // Log to item_activity for every linked item via task_items
      const { data: taskItems } = await (supabase
        .from('task_items') as any)
        .select('item_id')
        .eq('task_id', tId);

      if (taskItems && taskItems.length > 0) {
        for (const ti of taskItems) {
          logActivity({
            entityType: 'item',
            tenantId,
            entityId: ti.item_id,
            actorUserId: profile?.id,
            eventType,
            eventLabel,
            details: { ...details, task_id: tId },
          });
        }
      }
    } catch (err) {
      console.error('[BillingCalculator] Activity logging error:', err);
      // Fire-and-forget: don't block the caller
    }
  };

  // Recalculate when dependencies change
  useEffect(() => {
    calculatePreview();
  }, [calculatePreview, refreshKey]);

  // Calculate totals - existing events from DB + preview
  // BUILD-38: When waived, filter out void events from total calculation
  const nonVoidEvents = existingEvents.filter(e => e.status !== 'void');
  const existingEventsTotal = waiveCharges ? 0 : nonVoidEvents.reduce((sum, e) => sum + (e.total_amount || (e.unit_rate || 0) * e.quantity), 0);

  // Calculate service line preview total when provided
  const serviceLinePreviewTotal = serviceLinePreview?.reduce((sum, item) => sum + item.totalAmount, 0) ?? 0;
  const hasServiceLinePreview = serviceLinePreview !== undefined;

  // Compute estimated minutes for serviceLinePreview (best-effort; only when prop is used)
  useEffect(() => {
    let cancelled = false;

    const compute = async () => {
      if (!profile?.tenant_id) return;
      if (!hasServiceLinePreview || !serviceLinePreview || serviceLinePreview.length === 0) {
        setServiceLineEstimates([]);
        return;
      }

      // If caller provided estimates, use those directly.
      const hasAnyProvided = serviceLinePreview.some(i => typeof i.estimatedMinutes === 'number');
      if (hasAnyProvided) {
        setServiceLineEstimates(serviceLinePreview.map(i => Math.round(i.estimatedMinutes || 0)));
        return;
      }

      try {
        const results: number[] = [];
        for (const item of serviceLinePreview) {
          if (!item || !item.chargeCode) {
            results.push(0);
            continue;
          }

          // Estimate should not be blocked by account-level billing disable settings,
          // so we look up pricing WITHOUT accountId.
          let unit = 'each';
          let serviceTimeMinutes = 0;
          try {
            const r = await getEffectiveRate({
              tenantId: profile.tenant_id,
              chargeCode: item.chargeCode,
            });
            unit = r.unit || 'each';
            serviceTimeMinutes = r.service_time_minutes || 0;
          } catch {
            // Missing pricing config => no estimate
            unit = 'each';
            serviceTimeMinutes = 0;
          }

          results.push(
            estimateServiceMinutes({
              serviceTimeMinutes,
              unit,
              quantity: item.quantity,
            }),
          );
        }

        if (!cancelled) setServiceLineEstimates(results);
      } catch (err) {
        console.warn('[BillingCalculator] Failed to compute service line estimates:', err);
        if (!cancelled) setServiceLineEstimates(serviceLinePreview.map(() => 0));
      }
    };

    compute();
    return () => {
      cancelled = true;
    };
  }, [profile?.tenant_id, hasServiceLinePreview, serviceLinePreview]);

  const serviceLinePreviewEstimatedMinutes = serviceLineEstimates.reduce((sum, m) => sum + (m || 0), 0);

  // Use serviceLinePreview total if provided, otherwise use calculated preview total
  const previewTotal = hasServiceLinePreview ? serviceLinePreviewTotal : (preview?.subtotal || 0);

  // Estimated time (preview only)
  const previewEstimatedMinutes = hasServiceLinePreview
    ? serviceLinePreviewEstimatedMinutes
    : (preview?.lineItems?.reduce((sum, li) => sum + (li.estimatedMinutes || 0), 0) ?? 0);

  // For shipments that are already received, don't show preview (events already exist)
  // For tasks, check if task_completion event exists
  // For items/accounts, never show preview
  const showPreview = isTask
    ? !existingEvents.some(e => e.event_type === 'task_completion')
    : (isShipment && existingEvents.filter(e =>
        e.event_type === 'receiving' || e.event_type === 'returns_processing'
      ).length === 0);

  // BUILD-38: When waived, grand total is $0
  const grandTotal = waiveCharges ? 0 : (existingEventsTotal + (showPreview ? previewTotal : 0));

  // Format currency
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  // Loading state
  if (loading) {
    return (
      <Card className={compact ? 'shadow-sm' : ''}>
        <CardHeader className={compact ? 'py-3 px-4' : ''}>
          <CardTitle className={compact ? 'text-sm font-medium flex items-center gap-2' : ''}>
            <MaterialIcon name="attach_money" size="sm" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className={compact ? 'px-4 pb-3' : ''}>
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card className={compact ? 'shadow-sm' : ''}>
        <CardHeader className={compact ? 'py-3 px-4' : ''}>
          <CardTitle className={compact ? 'text-sm font-medium flex items-center gap-2' : ''}>
            <MaterialIcon name="attach_money" size="sm" />
            {title}
            {/* BUILD-38: Charges Waived badge */}
            {waiveCharges && (
              <Badge variant="destructive" className="text-[10px] ml-2">
                Charges Waived
              </Badge>
            )}
            {!!previewEstimatedMinutes && (
              <Badge variant="secondary" className="text-[10px] ml-2">
                Est. {formatMinutesShort(previewEstimatedMinutes)}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className={compact ? 'px-4 pb-3 space-y-3' : 'space-y-4'}>

          {/* BUILD-38: Waive Charges Toggle — always visible for tasks when user has permission */}
          {isTask && taskId && canWaiveCharges && (
            <div className="flex items-center justify-between py-2 px-3 border rounded-lg bg-muted/30">
              <div className="flex items-center gap-2">
                <Label htmlFor="waive-toggle" className="text-sm font-medium cursor-pointer">
                  Waive Charges
                </Label>
                {!waiveCharges && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <MaterialIcon name="info" size="sm" className="text-muted-foreground cursor-help" />
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[280px]">
                        <p className="text-xs">
                          Removing waiver does not restore previously voided charges. Use Add Charge or re-complete after reopening.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
              <Switch
                id="waive-toggle"
                checked={waiveCharges}
                onCheckedChange={handleWaiveToggle}
                disabled={waiveInvoicedLock || waiveSaving}
              />
            </div>
          )}

          {/* BUILD-38: Invoiced lock notice */}
          {isTask && taskId && canWaiveCharges && waiveInvoicedLock && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <MaterialIcon name="lock" size="sm" />
              Waive toggle locked — charges have been invoiced.
            </p>
          )}

          {/* BUILD-38: Waive details display */}
          {waiveCharges && waiveReason && (
            <div className="p-3 border border-amber-300 bg-amber-50 dark:bg-amber-950/30 rounded-lg">
              <div className="flex items-start gap-2">
                <MaterialIcon name="money_off" size="sm" className="text-amber-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    Charges Waived
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                    Reason: {waiveReason}
                  </p>
                  {waiveNotes && (
                    <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                      Notes: {waiveNotes}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Service Line Preview (NEW - takes precedence over legacy preview) */}
          {showPreview && hasServiceLinePreview && serviceLinePreview.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <MaterialIcon name="schedule" size="sm" />
                Pending Charges (Preview)
              </p>
              {serviceLinePreview.map((item, idx) => (
                <div key={`${item.chargeCode}-${idx}`} className="flex items-center justify-between py-1.5 text-sm">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="truncate">{item.chargeName}</span>
                    <Badge variant="outline" className="text-xs shrink-0">{item.chargeCode}</Badge>
                    <span className="text-muted-foreground shrink-0">&times;{item.quantity}</span>
                    {(() => {
                      const est = serviceLineEstimates[idx] ?? Math.round(item.estimatedMinutes || 0);
                      return est > 0 ? (
                        <Badge variant="secondary" className="text-[10px] shrink-0">
                          Est. {formatMinutesShort(est)}
                        </Badge>
                      ) : null;
                    })()}
                    {item.hasError && (
                      <MaterialIcon name="warning" size="sm" className="text-amber-500 shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {item.hasError ? (
                      <span className="text-muted-foreground italic text-xs">No rate</span>
                    ) : (
                      <>
                        <span className="text-muted-foreground tabular-nums whitespace-nowrap">{formatCurrency(item.unitRate)}</span>
                        <span className="font-medium min-w-[70px] text-right tabular-nums whitespace-nowrap">{formatCurrency(item.totalAmount)}</span>
                      </>
                    )}
                  </div>
                </div>
              ))}
              {serviceLinePreview.some(item => item.hasError) && (
                <p className="text-xs text-amber-600 flex items-center gap-1 mt-2">
                  <MaterialIcon name="info" size="sm" />
                  Some services have no rate defined in Price List
                </p>
              )}
            </div>
          )}

          {/* Safety Billing: Rate Required Banner (only for legacy path without serviceLinePreview) */}
          {showPreview && !hasServiceLinePreview && preview && preview.errorMessage && preview.lineItems.length === 0 && (
            <div className="p-3 border border-amber-300 bg-amber-50 dark:bg-amber-950/30 rounded-lg">
              <div className="flex items-start gap-2">
                <MaterialIcon name="info" size="sm" className="text-amber-600 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                    {preview.serviceName}
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                    {preview.errorMessage}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Per-Item Billing Preview - Legacy (Shipments, non-service-line Tasks) */}
          {showPreview && !hasServiceLinePreview && preview && preview.lineItems.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <MaterialIcon name="schedule" size="sm" />
                Pending Charges (Preview)
              </p>
              {/* Group by class for cleaner display */}
              {(() => {
                const byClass = new Map<string | null, { qty: number; rate: number; total: number; hasError: boolean; estMinutes: number }>();
                preview.lineItems.forEach(item => {
                  const key = item.classCode;
                  const existing = byClass.get(key) || { qty: 0, rate: item.unitRate, total: 0, hasError: false, estMinutes: 0 };
                  existing.qty += item.quantity;
                  existing.total += item.totalAmount;
                  if (item.hasRateError) existing.hasError = true;
                  existing.estMinutes += item.estimatedMinutes || 0;
                  byClass.set(key, existing);
                });

                return Array.from(byClass.entries()).map(([classCode, data]) => (
                  <div key={classCode || 'default'} className="flex items-center justify-between py-1.5 text-sm">
                    <div className="flex items-center gap-2">
                      <span>{preview.serviceName}</span>
                      {classCode && (
                        <Badge variant="outline" className="text-xs">{classCode}</Badge>
                      )}
                      <span className="text-muted-foreground">&times;{data.qty}</span>
                      {data.estMinutes > 0 && (
                        <Badge variant="secondary" className="text-[10px]">
                          Est. {formatMinutesShort(data.estMinutes)}
                        </Badge>
                      )}
                      {data.hasError && (
                        <MaterialIcon name="warning" size="sm" className="text-amber-500" />
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground tabular-nums whitespace-nowrap">{formatCurrency(data.rate)}</span>
                      <span className="font-medium min-w-[70px] text-right tabular-nums whitespace-nowrap">{formatCurrency(data.total)}</span>
                    </div>
                  </div>
                ));
              })()}

              {preview.hasErrors && !preview.errorMessage && (
                <p className="text-xs text-amber-600 flex items-center gap-1 mt-2">
                  <MaterialIcon name="info" size="sm" />
                  Some items have no rate defined in Price List
                </p>
              )}
            </div>
          )}

          {/* Existing Billing Events from Database */}
          {existingEvents.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                <MaterialIcon name="receipt_long" size="sm" />
                Recorded Charges ({existingEvents.length})
              </p>
              {existingEvents.map((event) => {
                const hasMissingRate = event.unit_rate === null || event.unit_rate === undefined;
                return (
                  <div key={event.id} className={`flex items-center justify-between py-1.5 text-sm ${hasMissingRate ? 'bg-red-50 dark:bg-red-950/20 -mx-2 px-2 rounded' : event.status === 'void' ? 'opacity-50' : ''}`}>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate">{event.charge_type || event.description || '\u2014'}</span>
                        <Badge
                          variant={event.status === 'invoiced' ? 'default' : 'secondary'}
                          className="text-[10px] px-1"
                        >
                          {event.status}
                        </Badge>
                        {hasMissingRate && (
                          <Badge variant="destructive" className="text-[10px] px-1 animate-pulse">
                            RATE REQUIRED
                          </Badge>
                        )}
                        {event.event_type === 'addon' && (
                          <Badge variant="outline" className="text-[10px] px-1">
                            manual
                          </Badge>
                        )}
                      </div>
                      {event.description && (
                        <span className="text-xs text-muted-foreground truncate block">
                          {event.description}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {hasMissingRate ? (
                        <span className="text-red-600 font-medium text-xs whitespace-nowrap">Set rate to invoice</span>
                      ) : (
                        <span className={`font-medium tabular-nums whitespace-nowrap min-w-[70px] text-right${event.status === 'void' ? ' line-through' : ''}`}>
                          {formatCurrency(event.total_amount || (event.unit_rate || 0) * event.quantity)}
                        </span>
                      )}
                      {/* Void button - only for unbilled addon charges */}
                      {canVoidEvent(event) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-destructive hover:text-destructive hover:bg-destructive/10"
                          onClick={() => {
                            setVoidingEventId(event.id);
                            setVoidConfirmOpen(true);
                          }}
                          title="Void this charge"
                        >
                          <MaterialIcon name="close" size="sm" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Empty State - but don't show if we have Rate Required message or service line preview */}
          {existingEvents.length === 0 &&
            (!showPreview ||
              (hasServiceLinePreview && serviceLinePreview.length === 0) ||
              (!hasServiceLinePreview && (!preview || (preview.lineItems.length === 0 && !preview.errorMessage)))) &&
            !waiveCharges && (
            <div className="text-center py-4 text-sm text-muted-foreground">
              No billing charges yet
            </div>
          )}

          {/* Total */}
          <div className="flex items-center justify-between pt-3 border-t">
            <span className="text-sm font-semibold">Total</span>
            <span className={`text-lg font-bold tabular-nums whitespace-nowrap ${waiveCharges ? 'text-muted-foreground line-through' : 'text-primary'}`}>
              {formatCurrency(grandTotal)}
            </span>
          </div>

          {/* Breakdown */}
          {!waiveCharges && (existingEventsTotal > 0 || (showPreview && previewTotal > 0)) && (
            <div className="text-xs text-muted-foreground text-right space-x-2 tabular-nums whitespace-nowrap">
              {showPreview && previewTotal > 0 && <span>Preview: {formatCurrency(previewTotal)}</span>}
              {existingEventsTotal > 0 && <span>Recorded: {formatCurrency(existingEventsTotal)}</span>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Void Confirmation Dialog */}
      <AlertDialog open={voidConfirmOpen} onOpenChange={setVoidConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void this charge?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the charge from billing. The charge will be marked as void but kept for audit purposes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isVoiding}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleVoidCharge}
              disabled={isVoiding}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isVoiding ? 'Voiding...' : 'Void Charge'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* BUILD-38: Waive Charges Modal */}
      <Dialog open={waiveModalOpen} onOpenChange={(open) => { if (!waiveSaving) setWaiveModalOpen(open); }}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="money_off" size="md" className="text-amber-600" />
              Waive Charges
            </DialogTitle>
            <DialogDescription>
              All unbilled charges for this task will be voided. This action is logged for audit purposes.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="waive-reason">Reason *</Label>
              <Select
                value={waiveModalReason || '_none'}
                onValueChange={(val) => setWaiveModalReason(val === '_none' ? '' : val as WaiveReason)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a reason..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none" disabled>Select a reason...</SelectItem>
                  {WAIVE_REASONS.map((reason) => (
                    <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="waive-notes">
                Notes {waiveModalReason === 'Other' ? '*' : '(optional)'}
              </Label>
              <Textarea
                id="waive-notes"
                placeholder="Additional context for this waiver..."
                value={waiveModalNotes}
                onChange={(e) => setWaiveModalNotes(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setWaiveModalOpen(false)}
              disabled={waiveSaving}
            >
              Cancel
            </Button>
            <Button
              onClick={handleWaiveOn}
              disabled={waiveSaving || !waiveModalReason || (waiveModalReason === 'Other' && !waiveModalNotes.trim())}
              variant="destructive"
            >
              {waiveSaving && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
              Waive All Charges
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default BillingCalculator;
