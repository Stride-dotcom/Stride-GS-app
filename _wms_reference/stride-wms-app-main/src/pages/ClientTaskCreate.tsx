import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { ClientPortalLayout } from '@/components/client-portal/ClientPortalLayout';
import { useClientPortalContext, useClientItems } from '@/hooks/useClientPortal';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { queueSplitManualReviewAlert, queueSplitRequiredAlert } from '@/lib/alertQueue';
import { markdownToEmailHtml } from '@/lib/emailTemplates/brandedEmailBuilder';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

const TASK_TYPES = [
  'Delivery',
  'Pick Up',
  'Inspection',
  'Repair',
  'Assembly',
  'Disposal',
  'Custom',
] as const;

const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
] as const;

interface LocationState {
  itemIds?: string[];
  accountId?: string;
}

export default function ClientTaskCreate() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { portalUser, account, tenant, isLoading: contextLoading } = useClientPortalContext();
  const { data: allItems = [] } = useClientItems();

  const state = (location.state as LocationState) || {};
  const itemIds = state.itemIds || [];
  const accountId = state.accountId || portalUser?.account_id || '';

  const [taskType, setTaskType] = useState<string>('');
  const [priority, setPriority] = useState<string>('normal');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [requestedQtyByItemId, setRequestedQtyByItemId] = useState<Record<string, number>>({});
  const [clientPartialGroupedEnabled, setClientPartialGroupedEnabled] = useState(false);

  // Resolve item codes for the selected items
  const selectedItems = useMemo(() => {
    return (allItems as any[]).filter((item: any) => itemIds.includes(item.id));
  }, [allItems, itemIds]);

  const availableQtyById = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of selectedItems as any[]) {
      const qty = typeof item?.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : 1;
      if (typeof item?.id === 'string') map.set(item.id, qty);
    }
    return map;
  }, [selectedItems]);

  const getRequestedQty = (itemId: string): number => {
    const available = availableQtyById.get(itemId) ?? 1;
    const raw = requestedQtyByItemId[itemId];
    const qty = typeof raw === 'number' && Number.isFinite(raw) ? raw : available;
    return Math.max(1, Math.min(available, qty));
  };

  // Hydrate/clamp requested quantities for selected items
  useEffect(() => {
    if (selectedItems.length === 0) return;
    setRequestedQtyByItemId((prev) => {
      let changed = false;
      const next: Record<string, number> = { ...prev };
      for (const item of selectedItems as any[]) {
        const available = availableQtyById.get(item.id) ?? 1;
        const current = next[item.id];
        if (current == null) {
          next[item.id] = available;
          changed = true;
        } else {
          const clamped = Math.max(1, Math.min(available, current));
          if (clamped !== current) {
            next[item.id] = clamped;
            changed = true;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [availableQtyById, selectedItems]);

  // Load preference (best-effort; default = disabled/manual review)
  useEffect(() => {
    if (!portalUser?.tenant_id) return;
    const run = async () => {
      try {
        const { data, error } = await (supabase as any)
          .from('tenant_settings')
          .select('setting_value')
          .eq('tenant_id', portalUser.tenant_id)
          .eq('setting_key', 'client_partial_grouped_enabled')
          .maybeSingle();
        if (error) throw error;
        const v = data?.setting_value as unknown;
        if (typeof v === 'boolean') setClientPartialGroupedEnabled(v);
        else if (typeof v === 'string') setClientPartialGroupedEnabled(v.trim().toLowerCase() === 'true');
        else setClientPartialGroupedEnabled(false);
      } catch {
        // Safe default: disabled/manual review
        setClientPartialGroupedEnabled(false);
      }
    };
    void run();
  }, [portalUser?.tenant_id]);

  const hasPartialGroupedSelection = useMemo(() => {
    return (selectedItems as any[]).some((item: any) => {
      const available = availableQtyById.get(item.id) ?? 1;
      const requested = getRequestedQty(item.id);
      return available > 1 && requested < available;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableQtyById, selectedItems, requestedQtyByItemId]);

  const userName = portalUser?.first_name
    ? `${portalUser.first_name} ${portalUser.last_name || ''}`.trim()
    : portalUser?.email || 'User';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!taskType) {
      toast({
        variant: 'destructive',
        title: 'Validation Error',
        description: 'Please select a task type.',
      });
      return;
    }

    // Will Call is an outbound shipment (not a task) going forward.
    if (taskType === 'Will Call') {
      toast({
        title: 'Will Call moved to Outbound Shipments',
        description: 'Please create a Will Call using the Outbound Shipment form instead of Tasks.',
      });
      navigate('/client/shipments/outbound/new', { state: { itemIds, accountId } });
      return;
    }

    if (!portalUser?.tenant_id || !accountId) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Missing account or tenant information.',
      });
      return;
    }

    const splitCandidates = itemIds
      .map((itemId: string) => {
        const available = availableQtyById.get(itemId) ?? 1;
        const requested = getRequestedQty(itemId);
        return {
          item_id: itemId,
          available,
          requested,
          leftover: Math.max(0, available - requested),
        };
      })
      .filter((r) => r.available > 1 && r.requested < r.available);

    if (splitCandidates.length > 0) {
      if (!clientPartialGroupedEnabled) {
        const ok = window.confirm(
          `${tenant?.name || 'The warehouse team'} will review this request before processing.\n\n` +
            `This task includes a partial quantity from a grouped item.\n\n` +
            `Continue and submit as Pending review?`
        );
        if (!ok) return;
      } else {
        const ok = window.confirm(
          `This task includes a partial quantity from a grouped item.\n\n` +
            `The warehouse will create new labels and complete a Split task before starting this request.\n\n` +
            `Continue and submit?`
        );
        if (!ok) return;
      }
    }

    setSubmitting(true);

    try {
      // Build a descriptive title
      const itemCount = itemIds.length;
      const title = itemCount > 0
        ? `${taskType} - ${itemCount} item${itemCount !== 1 ? 's' : ''} (Client Request)`
        : `${taskType} (Client Request)`;

      const warehouseIds = Array.from(
        new Set((selectedItems as any[]).map((it: any) => it?.warehouse_id).filter(Boolean).map(String))
      );
      const derivedWarehouseId = warehouseIds.length === 1 ? warehouseIds[0] : null;

      // Insert the task
      const { data: task, error: taskError } = await (supabase
        .from('tasks') as any)
        .insert({
          tenant_id: portalUser.tenant_id,
          account_id: accountId,
          warehouse_id: derivedWarehouseId,
          related_item_id: itemIds.length === 1 ? itemIds[0] : null,
          task_type: taskType,
          title,
          description: description.trim() || null,
          priority,
          due_date: dueDate || null,
          status: 'pending',
          assigned_department: 'warehouse',
          metadata: {
            client_portal_request: true,
            requested_by_email: portalUser.email,
            requested_by_name: userName,
          },
        })
        .select()
        .single();

      if (taskError) {
        throw taskError;
      }

      // Link items to the task via task_items junction table
      if (itemIds.length > 0 && task) {
        const taskItems = itemIds.map((itemId: string) => ({
          task_id: task.id,
          item_id: itemId,
          quantity: getRequestedQty(itemId),
        }));

        const { error: itemsError } = await (supabase
          .from('task_items') as any)
          .insert(taskItems);

        if (itemsError) {
          console.error('Failed to link items to task:', itemsError);
          // Non-blocking: task was created successfully, just items failed to link
        }
      }

      // Grouped-item partial requests (client portal):
      // - if enabled: create blocking Split task(s) per item + alert internal
      // - if disabled: mark the origin task Pending review (manual) + alert internal
      if (task && splitCandidates.length > 0) {
        const requestNotes = description.trim() || null;

        if (clientPartialGroupedEnabled) {
          const splitTaskIds: string[] = [];
          const splitItemsForMeta: any[] = [];

          for (const c of splitCandidates) {
            const itemRow = (selectedItems as any[]).find((it: any) => it.id === c.item_id);
            const itemCode = itemRow?.item_code || c.item_id;
            const groupedQty = typeof itemRow?.quantity === 'number' && Number.isFinite(itemRow.quantity) ? itemRow.quantity : c.available;
            const keepQty = c.requested;
            const leftoverQty = groupedQty - keepQty;
            const itemWarehouseId = itemRow?.warehouse_id ? String(itemRow.warehouse_id) : (derivedWarehouseId || null);
            if (!itemWarehouseId) throw new Error('Missing warehouse for split task');

            // Idempotency: reuse existing split task if it already exists
            const { data: existingSplitTask } = await (supabase.from('tasks') as any)
              .select('id')
              .eq('tenant_id', portalUser.tenant_id)
              .eq('task_type', 'Split')
              .contains('metadata', {
                split_workflow: {
                  origin_entity_type: 'task',
                  origin_entity_id: task.id,
                  parent_item_id: c.item_id,
                },
              })
              .in('status', ['pending', 'in_progress'])
              .limit(1)
              .maybeSingle();

            let splitTaskId: string | null = existingSplitTask?.id || null;

            if (!splitTaskId) {
              const nowIso = new Date().toISOString();
              const splitTitle = title ? `Split - ${itemCode} (for ${title})` : `Split - ${itemCode}`;
              const splitDesc = [
                `Split required for grouped item ${itemCode}.`,
                `Keep qty on parent label: ${keepQty} (of ${groupedQty}).`,
                `Leftover qty to relabel: ${leftoverQty}.`,
                '',
                'Client note:',
                requestNotes || '(none)',
              ].join('\n');

              const { data: newSplitTask, error: splitErr } = await (supabase.from('tasks') as any)
                .insert({
                  tenant_id: portalUser.tenant_id,
                  account_id: accountId,
                  warehouse_id: itemWarehouseId,
                  related_item_id: c.item_id,
                  task_type: 'Split',
                  title: splitTitle,
                  description: splitDesc,
                  priority: 'urgent',
                  status: 'pending',
                  assigned_department: 'warehouse',
                  metadata: {
                    client_portal_request: true,
                    requested_by_email: portalUser.email,
                    requested_by_name: userName,
                    split_workflow: {
                      origin_entity_type: 'task',
                      origin_entity_id: task.id,
                      origin_entity_number: title,
                      parent_item_id: c.item_id,
                      parent_item_code: itemCode,
                      grouped_qty: groupedQty,
                      keep_qty: keepQty,
                      leftover_qty: leftoverQty,
                      requested_by_name: userName,
                      requested_by_email: portalUser.email,
                      request_notes: requestNotes,
                      created_at: nowIso,
                    },
                  },
                })
                .select('id')
                .single();

              if (splitErr) throw splitErr;
              splitTaskId = newSplitTask.id;

              const { error: linkErr } = await (supabase.from('task_items') as any).insert({
                task_id: splitTaskId,
                item_id: c.item_id,
                quantity: leftoverQty,
              });
              if (linkErr) throw linkErr;
            }

            if (splitTaskId) {
              splitTaskIds.push(splitTaskId);
              splitItemsForMeta.push({
                parent_item_id: c.item_id,
                parent_item_code: itemCode,
                grouped_qty: groupedQty,
                keep_qty: keepQty,
                leftover_qty: leftoverQty,
                split_task_id: splitTaskId,
              });
              void queueSplitRequiredAlert(portalUser.tenant_id, splitTaskId, itemCode);
            }
          }

          const existingMeta = task.metadata && typeof task.metadata === 'object' ? task.metadata : {};
          const { error: metaErr } = await (supabase.from('tasks') as any)
            .update({
              metadata: {
                ...(existingMeta as any),
                split_required: true,
                split_required_task_ids: splitTaskIds,
                split_required_items: splitItemsForMeta,
                split_required_created_at: new Date().toISOString(),
              },
            })
            .eq('id', task.id)
            .eq('tenant_id', portalUser.tenant_id);
          if (metaErr) console.warn('[ClientTaskCreate] split metadata update failed:', metaErr);
        } else {
          // Manual review flow: no split task, mark the job Pending review + alert internal staff
          const splitItemsForMeta = splitCandidates.map((c) => {
            const itemRow = (selectedItems as any[]).find((it: any) => it.id === c.item_id);
            const itemCode = itemRow?.item_code || c.item_id;
            return {
              parent_item_id: c.item_id,
              parent_item_code: itemCode,
              grouped_qty: c.available,
              keep_qty: c.requested,
              leftover_qty: c.leftover,
              request_notes: requestNotes,
              requested_by_name: userName,
              requested_by_email: portalUser.email,
            };
          });

          const first = splitItemsForMeta[0];
          const itemCode = first?.parent_item_code || first?.parent_item_id || splitCandidates[0]?.item_id;

          const reviewReason =
            splitItemsForMeta.length <= 1
              ? `Client requested ${first.keep_qty} of ${first.grouped_qty} units from grouped item ${itemCode}.`
              : `Client requested partial quantities from ${splitItemsForMeta.length} grouped items: ${splitItemsForMeta
                  .map((c) => `${c.parent_item_code} (${c.keep_qty} of ${c.grouped_qty})`)
                  .join('; ')}.`;

          const existingMeta = task.metadata && typeof task.metadata === 'object' ? task.metadata : {};
          const { error: metaErr } = await (supabase.from('tasks') as any)
            .update({
              metadata: {
                ...(existingMeta as any),
                pending_review: true,
                pending_review_reason: reviewReason,
                split_workflow: {
                  origin_entity_type: 'task',
                  origin_entity_id: task.id,
                  origin_entity_number: title,
                  ...(first as any),
                },
                split_workflow_items: splitItemsForMeta,
              },
            })
            .eq('id', task.id)
            .eq('tenant_id', portalUser.tenant_id);
          if (metaErr) console.warn('[ClientTaskCreate] pending review metadata update failed:', metaErr);

          const manualReviewBodyText = [
            'A client requested a partial quantity from one or more grouped items, but automated split tasks are disabled for this tenant.',
            'This task is marked Pending review.',
            ' ',
            'Requested grouped items:',
            ...splitItemsForMeta.map(
              (c) =>
                `- ${c.parent_item_code}: requested ${c.keep_qty} of ${c.grouped_qty} (leftover ${c.leftover_qty})`
            ),
            ' ',
            `Origin Job: Task ${title || task.id}`,
            requestNotes ? `Notes: ${requestNotes}` : '',
          ]
            .filter(Boolean)
            .join('\n');

          const manualReviewBodyHtml = `<div style="font-family: ui-sans-serif, system-ui; font-size: 14px;">${markdownToEmailHtml(manualReviewBodyText)}</div>`;

          void queueSplitManualReviewAlert(
            portalUser.tenant_id,
            'task',
            task.id,
            itemCode,
            manualReviewBodyText,
            manualReviewBodyHtml
          );
        }
      }

      toast({
        title: 'Task Submitted',
        description: splitCandidates.length > 0
          ? clientPartialGroupedEnabled
            ? 'Submitted. Waiting for warehouse split completion.'
            : 'Submitted as Pending review.'
          : 'Your task request has been submitted to the warehouse team.',
      });

      navigate('/client/items');
    } catch (error: any) {
      console.error('Error creating task:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to Submit Task',
        description: error?.message || 'An unexpected error occurred. Please try again.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (contextLoading) {
    return (
      <ClientPortalLayout>
        <div className="flex items-center justify-center h-64">
          <MaterialIcon name="progress_activity" size="xl" className="animate-spin text-muted-foreground" />
        </div>
      </ClientPortalLayout>
    );
  }

  return (
    <ClientPortalLayout
      accountName={account?.name}
      warehouseName={tenant?.name}
      userName={userName}
    >
      <div className="space-y-6 max-w-2xl mx-auto">
        {/* Page Header */}
        <div className="flex items-center gap-4">
          <Link to="/client/items">
            <Button variant="ghost" size="icon">
              <MaterialIcon name="arrow_back" size="sm" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Create Task Request</h1>
            <p className="text-muted-foreground">
              Submit a task for the warehouse team to complete
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit}>
          <Card>
            <CardHeader>
              <CardTitle>Task Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="flex items-start gap-2">
                  <MaterialIcon name="local_shipping" size="sm" className="mt-0.5 text-muted-foreground" />
                  <div className="space-y-1">
                    <p className="font-medium">Need a Will Call pickup?</p>
                    <p className="text-muted-foreground">
                      Will Calls are created as <span className="font-medium">Outbound Shipments</span> (not Tasks).
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => navigate('/client/shipments/outbound/new', { state: { itemIds, accountId } })}
                    >
                      Create Outbound Shipment
                    </Button>
                  </div>
                </div>
              </div>

              {/* Task Type */}
              <div className="space-y-2">
                <Label htmlFor="taskType">Task Type <span className="text-destructive">*</span></Label>
                <Select value={taskType} onValueChange={setTaskType}>
                  <SelectTrigger id="taskType">
                    <SelectValue placeholder="Select a task type" />
                  </SelectTrigger>
                  <SelectContent>
                    {TASK_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Priority */}
              <div className="space-y-2">
                <Label htmlFor="priority">Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger id="priority">
                    <SelectValue placeholder="Select priority" />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITIES.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description">Description / Notes</Label>
                <Textarea
                  id="description"
                  placeholder="Provide any additional details or instructions for the warehouse team..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={4}
                />
                {hasPartialGroupedSelection && (
                  <p className="text-xs text-muted-foreground">
                    If you need specific items from a grouped package/carton, add details here (e.g., matching set, serials, photos, etc.).
                  </p>
                )}
              </div>

              {/* Due Date */}
              <div className="space-y-2">
                <Label htmlFor="dueDate">Requested Due Date (optional)</Label>
                <Input
                  id="dueDate"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                />
              </div>

              {/* Selected Items Summary */}
              {itemIds.length > 0 && (
                <div className="space-y-2">
                  <Label>Selected Items ({itemIds.length})</Label>
                  <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
                    {selectedItems.length > 0 ? (
                      selectedItems.map((item: any) => (
                        <div
                          key={item.id}
                          className="px-3 py-2 text-sm flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <MaterialIcon name="inventory_2" size="sm" className="text-muted-foreground" />
                            <span className="font-medium">{item.item_code}</span>
                            {item.description && (
                              <span className="text-muted-foreground truncate">
                                - {item.description}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <Input
                              type="number"
                              min={1}
                              max={typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : 1}
                              step={1}
                              value={getRequestedQty(item.id)}
                              disabled={!(typeof item.quantity === 'number' && Number.isFinite(item.quantity) && item.quantity > 1)}
                              onChange={(e) => {
                                const available = typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : 1;
                                const raw = parseInt(e.target.value || '0', 10);
                                const next = Number.isFinite(raw) ? raw : 1;
                                const clamped = Math.max(1, Math.min(available, next));
                                setRequestedQtyByItemId((prev) => ({ ...prev, [item.id]: clamped }));
                              }}
                              className="h-8 w-20 text-right"
                              aria-label={`Requested quantity for ${item.item_code}`}
                            />
                            {typeof item.quantity === 'number' && item.quantity > 1 && (
                              <span className="text-xs text-muted-foreground">/ {item.quantity}</span>
                            )}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        {itemIds.length} item{itemIds.length !== 1 ? 's' : ''} selected
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t">
                <Link to="/client/items">
                  <Button type="button" variant="outline" disabled={submitting}>
                    Cancel
                  </Button>
                </Link>
                <Button type="submit" disabled={submitting || !taskType}>
                  {submitting ? (
                    <>
                      <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <MaterialIcon name="send" size="sm" className="mr-2" />
                      Submit Task
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      </div>
    </ClientPortalLayout>
  );
}
