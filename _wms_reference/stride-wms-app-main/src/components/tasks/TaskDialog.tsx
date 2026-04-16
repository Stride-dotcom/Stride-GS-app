import { useState, useEffect, useMemo, useRef, type CSSProperties } from 'react';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useTaskTypes, useDueDateRules, Task } from '@/hooks/useTasks';
import { useWarehouses } from '@/hooks/useWarehouses';
import { useUsers } from '@/hooks/useUsers';
import { format } from 'date-fns';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { SaveButton } from '@/components/ui/SaveButton';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { queueSplitRequiredAlert } from '@/lib/alertQueue';

interface TaskDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task?: Task | null;
  selectedItemIds?: string[];
  preSelectedTaskType?: string;
  onSuccess: (createdTaskId?: string) => void;
}

interface Account {
  id: string;
  account_name: string;
}

interface InventoryItem {
  id: string;
  item_code: string;
  quantity?: number | null;
  description: string | null;
  vendor: string | null;
  sidemark: string | null;
  client_account: string | null;
  account_id: string | null;
  warehouse_id: string | null;
}

export function TaskDialog({
  open,
  onOpenChange,
  task,
  selectedItemIds = [],
  preSelectedTaskType,
  onSuccess,
}: TaskDialogProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { taskTypes, createTaskType } = useTaskTypes();
  const { getDueDateForTaskType } = useDueDateRules();
  const { warehouses } = useWarehouses();
  const { users: rawUsers } = useUsers();

  // Deduplicate users by ID to prevent duplicate entries in the Assign To dropdown
  const users = useMemo(() => {
    const seen = new Set<string>();
    return rawUsers.filter(u => {
      if (seen.has(u.id)) return false;
      seen.add(u.id);
      return true;
    });
  }, [rawUsers]);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedItems, setSelectedItems] = useState<InventoryItem[]>([]);
  const [requestedQtyByItemId, setRequestedQtyByItemId] = useState<Record<string, number>>({});
  const [showNewTaskType, setShowNewTaskType] = useState(false);
  const [newTaskTypeName, setNewTaskTypeName] = useState('');
  
  // For item search when creating from tasks menu
  const [accountItems, setAccountItems] = useState<InventoryItem[]>([]);
  const [itemSearchQuery, setItemSearchQuery] = useState('');
  const [loadingItems, setLoadingItems] = useState(false);
  const [itemDropdownOpen, setItemDropdownOpen] = useState(false);
  const itemSearchAnchorRef = useRef<HTMLDivElement | null>(null);
  const [itemDropdownWidth, setItemDropdownWidth] = useState<number | undefined>(undefined);
  const [validationDialogOpen, setValidationDialogOpen] = useState(false);
  const [validationMessage, setValidationMessage] = useState('');

  const [formData, setFormData] = useState({
    description: '',
    task_type: '',
    task_type_id: null as string | null,
    priority: 'normal',
    due_date: null as Date | null,
    assigned_to: 'unassigned',
    assigned_department: '',
    warehouse_id: 'none',
    account_id: 'none',
    bill_to: 'account' as 'account' | 'customer' | 'no_charge',
    bill_to_customer_name: '',
    bill_to_customer_email: '',
  });

  // Check if we're creating from inventory (items pre-selected)
  const isFromInventory = selectedItemIds.length > 0;

  // Some task types are system-managed and should not be created manually.
  const NON_CREATABLE_TASK_TYPES = useMemo(() => new Set(['Will Call', 'Split']), []);

  const selectableTaskTypes = useMemo(() => {
    // If we're editing an existing task, keep its type available for display/editing.
    if (task) {
      return taskTypes.filter(
        (t) => !NON_CREATABLE_TASK_TYPES.has(t.name) || t.name === task.task_type
      );
    }
    return taskTypes.filter((t) => !NON_CREATABLE_TASK_TYPES.has(t.name));
  }, [task, taskTypes, NON_CREATABLE_TASK_TYPES]);

  useEffect(() => {
    if (open) {
      fetchAccounts();
      if (selectedItemIds.length > 0) {
        fetchSelectedItems();
      }
    }
  }, [open, selectedItemIds]);

  // Track if the dialog has been initialized for this open session
  const initializedRef = useRef(false);

  // Initialize form only when dialog opens or task changes - NOT on every getDueDateForTaskType change
  useEffect(() => {
    if (!open) {
      initializedRef.current = false;
      setItemDropdownOpen(false);
      return;
    }

    // Only initialize once per dialog open
    if (initializedRef.current && !task) {
      return;
    }

    if (task) {
      setFormData({
        description: task.description || '',
        task_type: task.task_type,
        task_type_id: task.task_type_id || null,
        priority: task.priority || 'normal',
        due_date: task.due_date ? new Date(task.due_date.substring(0, 10) + 'T12:00:00') : null,
        assigned_to: task.assigned_to || 'unassigned',
        assigned_department: task.assigned_department || '',
        warehouse_id: task.warehouse_id || 'none',
        account_id: task.account_id || 'none',
        bill_to: ((task as any).bill_to as 'account' | 'customer' | 'no_charge') || 'account',
        bill_to_customer_name: (task as any).bill_to_customer_name || '',
        bill_to_customer_email: (task as any).bill_to_customer_email || '',
      });
    } else {
      // Reset form and apply preSelectedTaskType if provided
      const initialTaskType = preSelectedTaskType || '';
      const isSystemManagedType = initialTaskType === 'Will Call' || initialTaskType === 'Split';
      const safeInitialTaskType = isSystemManagedType ? '' : initialTaskType;
      const dueDate = safeInitialTaskType ? getDueDateForTaskType(safeInitialTaskType) : null;

      setFormData({
        description: '',
        task_type: safeInitialTaskType,
        task_type_id: null,
        priority: 'normal',
        due_date: dueDate,
        assigned_to: 'unassigned',
        assigned_department: '',
        warehouse_id: 'none',
        account_id: 'none',
        bill_to: 'account',
        bill_to_customer_name: '',
        bill_to_customer_email: '',
      });
      if (initialTaskType === 'Will Call') {
        toast({
          title: 'Will Call moved to Outbound Shipments',
          description: 'Create Will Calls via Shipments → Outbound (not Tasks).',
        });
      }
      if (initialTaskType === 'Split') {
        toast({
          title: 'Split tasks are auto-created',
          description: 'Selecting a partial grouped quantity creates the Split task automatically.',
        });
      }
      setSelectedItems([]);
      setAccountItems([]);
      setItemSearchQuery('');
      setItemDropdownOpen(false);
    }

    initializedRef.current = true;
  }, [task, open, preSelectedTaskType]);

  // Resolve task_type_id when preSelectedTaskType is set or form opens with a task_type but no task_type_id
  useEffect(() => {
    if (!open || !formData.task_type || formData.task_type_id) return;

    const matchedType = taskTypes.find(tt => tt.name === formData.task_type);
    if (!matchedType) return;

    setFormData(prev => ({
      ...prev,
      task_type_id: matchedType.id,
    }));
  }, [open, formData.task_type, formData.task_type_id, taskTypes]);

  // Auto-populate account and warehouse when items are selected from inventory
  useEffect(() => {
    if (selectedItems.length > 0) {
      // Auto-populate account directly from item's account_id
      if (formData.account_id === 'none') {
        const firstItemAccountId = selectedItems[0]?.account_id;
        if (firstItemAccountId) {
          setFormData(prev => ({ ...prev, account_id: firstItemAccountId }));
        }
      }
      // Auto-populate warehouse from items
      const firstItemWarehouse = selectedItems[0]?.warehouse_id;
      if (firstItemWarehouse) {
        setFormData(prev => ({ ...prev, warehouse_id: firstItemWarehouse }));
      }
    }
  }, [selectedItems]);

  // Auto-populate warehouse from user's primary warehouse assignment when creating a new task
  useEffect(() => {
    if (!open || task || selectedItems.length > 0 || formData.warehouse_id !== 'none') return;
    if (!profile?.id || !profile?.tenant_id || warehouses.length === 0) return;

    // If there's only one warehouse, use it
    if (warehouses.length === 1) {
      setFormData(prev => ({ ...prev, warehouse_id: warehouses[0].id }));
      return;
    }

    // Otherwise fetch user's primary warehouse from employee_pay
    const fetchUserWarehouse = async () => {
      const { data } = await (supabase
        .from('employee_pay') as any)
        .select('primary_warehouse_id')
        .eq('user_id', profile.id)
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle();

      if (data?.primary_warehouse_id) {
        setFormData(prev =>
          prev.warehouse_id === 'none'
            ? { ...prev, warehouse_id: data.primary_warehouse_id }
            : prev
        );
      }
    };
    fetchUserWarehouse();
  }, [open, task, selectedItems.length, formData.warehouse_id, profile?.id, profile?.tenant_id, warehouses]);

  // Validation: Check for multiple accounts/warehouses
  const hasMultipleAccounts = (() => {
    const accounts = new Set(selectedItems.map(i => i.client_account).filter(Boolean));
    return accounts.size > 1;
  })();

  const hasMultipleWarehouses = (() => {
    const warehouses = new Set(selectedItems.map(i => i.warehouse_id).filter(Boolean));
    return warehouses.size > 1;
  })();

  // Fetch items when account is selected (only when creating from tasks menu)
  useEffect(() => {
    if (!isFromInventory && formData.account_id && formData.account_id !== 'none') {
      fetchAccountItems(formData.account_id);
    } else if (!isFromInventory) {
      setAccountItems([]);
      setItemDropdownOpen(false);
    }
  }, [formData.account_id, isFromInventory]);

  // Keep popover width synced to the anchor input (mobile Safari can be picky about CSS var sizing without a Trigger)
  useEffect(() => {
    if (!itemDropdownOpen) return;

    const updateWidth = () => {
      const width = itemSearchAnchorRef.current?.getBoundingClientRect().width;
      if (width && Number.isFinite(width)) setItemDropdownWidth(width);
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [itemDropdownOpen]);

  const fetchAccounts = async () => {
    const { data } = await supabase
      .from('accounts')
      .select('id, account_name')
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('account_name');

    setAccounts(data || []);
  };

  const fetchSelectedItems = async () => {
    if (selectedItemIds.length === 0) return;

    const { data } = await (supabase
      .from('items') as any)
      .select('id, item_code, quantity, description, vendor, sidemark, client_account, account_id, warehouse_id')
      .in('id', selectedItemIds);

    setSelectedItems(data || []);
  };

  const fetchAccountItems = async (accountId: string) => {
    setLoadingItems(true);
    try {
      const { data, error } = await (supabase
        .from('items') as any)
        .select('id, item_code, quantity, description, vendor, sidemark, client_account, account_id, warehouse_id')
        .eq('account_id', accountId)
        .neq('status', 'released')
        .neq('status', 'disposed')
        .is('deleted_at', null)
        .order('item_code');

      if (error) throw error;

      setAccountItems(data || []);
    } catch (error: any) {
      console.error('Error fetching account items:', error);
      toast({
        variant: 'destructive',
        title: 'Could not load items',
        description: error?.message || 'Please try again.',
      });
    } finally {
      setLoadingItems(false);
    }
  };

  const handleTaskTypeChange = (value: string) => {
    if (value === 'new') {
      setShowNewTaskType(true);
      setNewTaskTypeName('');
      // Prevent accidentally saving with a previously-selected type while in "new type" mode.
      setFormData((prev) => ({ ...prev, task_type: '', task_type_id: null }));
      return;
    }
    if (value === 'Will Call') {
      toast({
        title: 'Will Call moved to Outbound Shipments',
        description: 'Create Will Calls via Shipments → Outbound (not Tasks).',
      });
      return;
    }
    if (value === 'Split') {
      toast({
        title: 'Split tasks are auto-created',
        description: 'Selecting a partial grouped quantity creates the Split task automatically.',
      });
      return;
    }

    // Resolve task_type_id from the selected task type
    const matchedType = taskTypes.find(tt => tt.name === value);

    setFormData(prev => ({
      ...prev,
      task_type: value,
      task_type_id: matchedType?.id || null,
      due_date: getDueDateForTaskType(value),
    }));
  };

  const handleCreateTaskType = async () => {
    if (!newTaskTypeName.trim()) return;
    const normalizedTaskTypeName = newTaskTypeName.trim().toLowerCase();
    if (normalizedTaskTypeName === 'will call' || normalizedTaskTypeName === 'split') {
      toast({
        variant: 'destructive',
        title: 'Not allowed',
        description: normalizedTaskTypeName === 'will call'
          ? 'Will Call is now handled as an Outbound Shipment (not a Task type).'
          : 'Split tasks are system-managed and created automatically from partial grouped quantities.',
      });
      return;
    }

    const newType = await createTaskType(newTaskTypeName);
    if (newType) {
      setFormData(prev => ({
        ...prev,
        task_type: newType.name,
        task_type_id: newType.id,
        due_date: getDueDateForTaskType(newType.name),
      }));
      setShowNewTaskType(false);
      setNewTaskTypeName('');
    }
  };

  const handleAccountChange = (value: string) => {
    setFormData(prev => ({ ...prev, account_id: value }));
    // Clear selected items when account changes (only when not from inventory)
    if (!isFromInventory) {
      setSelectedItems([]);
      setRequestedQtyByItemId({});
      setItemSearchQuery('');
      setItemDropdownOpen(false);
    }
  };

  const getAvailableQty = (item: InventoryItem | null | undefined): number => {
    const q = item?.quantity;
    return typeof q === 'number' && Number.isFinite(q) ? q : 1;
  };

  const getRequestedQty = (itemId: string, available: number): number => {
    const raw = requestedQtyByItemId[itemId];
    const qty = typeof raw === 'number' && Number.isFinite(raw) ? raw : available;
    return Math.max(1, Math.min(available, qty));
  };

  const toggleItemSelection = (item: InventoryItem) => {
    const exists = selectedItems.some((i) => i.id === item.id);
    setSelectedItems(prev => {
      if (exists) return prev.filter(i => i.id !== item.id);
      return [...prev, item];
    });
    setRequestedQtyByItemId((prev) => {
      const next = { ...prev };
      if (exists) {
        delete next[item.id];
      } else if (next[item.id] == null) {
        next[item.id] = getAvailableQty(item);
      }
      return next;
    });
  };

  // Hydrate/clamp requested quantities when selected items change (including pre-selected)
  useEffect(() => {
    if (selectedItems.length === 0) return;
    setRequestedQtyByItemId((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const item of selectedItems) {
        const available = getAvailableQty(item);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedItems]);

  // Filter items based on search query
  const filteredItems = useMemo(() => {
    if (!itemSearchQuery.trim()) return accountItems;
    
    const query = itemSearchQuery.toLowerCase();
    return accountItems.filter(item => 
      item.item_code?.toLowerCase().includes(query) ||
      item.description?.toLowerCase().includes(query) ||
      item.vendor?.toLowerCase().includes(query) ||
      item.sidemark?.toLowerCase().includes(query) ||
      item.client_account?.toLowerCase().includes(query)
    );
  }, [accountItems, itemSearchQuery]);

  const groupedQtyItems = useMemo(
    () => selectedItems.filter((item) => getAvailableQty(item) > 1),
    [selectedItems]
  );

  // Generate title from task type and items
  const generateTitle = () => {
    const itemCount = selectedItems.length || selectedItemIds.length;
    if (formData.task_type && itemCount > 0) {
      return `${formData.task_type} - ${itemCount} item${itemCount > 1 ? 's' : ''}`;
    }
    return formData.task_type || 'New Task';
  };

  // Map task types to inventory status fields
  const getInventoryStatusField = (taskType: string): string | null => {
    const mapping: Record<string, string> = {
      'Assembly': 'assembly_status',
      'Inspection': 'inspection_status',
      'Repair': 'repair_status',
    };
    return mapping[taskType] || null;
  };

  // Update inventory status for items
  const updateInventoryStatus = async (itemIds: string[], taskType: string, status: string) => {
    const statusField = getInventoryStatusField(taskType);
    if (!statusField || itemIds.length === 0) return;

    try {
      const updateData: Record<string, string> = {};
      updateData[statusField] = status;

      await (supabase
        .from('items') as any)
        .update(updateData)
        .in('id', itemIds);
    } catch (error) {
      console.error('Error updating inventory status:', error);
    }
  };

  // Task types that require one task per item
  const SINGLE_ITEM_TASK_TYPES = ['Assembly', 'Inspection'];

  const handleSubmit = async () => {
    if (!profile?.tenant_id || !formData.task_type) return;

    try {
      // Collect all item IDs
      const allItemIds = isFromInventory
        ? selectedItemIds
        : selectedItems.map(i => i.id);

      // Fetch authoritative item quantities (avoid relying on possibly-stale dialog state)
      const itemById = new Map<string, any>();
      if (allItemIds.length > 0) {
        const { data: itemRows, error: itemRowsError } = await (supabase
          .from('items') as any)
          .select('id, item_code, quantity, warehouse_id, account_id')
          .in('id', allItemIds);

        if (itemRowsError) throw itemRowsError;
        for (const row of itemRows || []) {
          if (row?.id) itemById.set(String(row.id), row);
        }
      }

      const getGroupedQty = (itemId: string): number => {
        const row = itemById.get(itemId);
        const q = row?.quantity;
        return typeof q === 'number' && Number.isFinite(q) ? q : 1;
      };

      const getItemCode = (itemId: string): string => {
        const row = itemById.get(itemId);
        const code = row?.item_code;
        return typeof code === 'string' && code.trim() ? code : itemId;
      };

      const getItemWarehouseId = (itemId: string): string | null => {
        const row = itemById.get(itemId);
        const wid = row?.warehouse_id;
        return typeof wid === 'string' ? wid : null;
      };

      const getItemAccountId = (itemId: string): string | null => {
        const row = itemById.get(itemId);
        const aid = row?.account_id;
        return typeof aid === 'string' ? aid : null;
      };

      const requestedQtyMap = new Map<string, number>();
      for (const itemId of allItemIds) {
        const available = getGroupedQty(itemId);
        requestedQtyMap.set(itemId, getRequestedQty(itemId, available));
      }

      const computeSplitCandidates = (itemIds: string[]) => {
        return itemIds
          .map((itemId) => {
            const groupedQty = getGroupedQty(itemId);
            const keepQty = requestedQtyMap.get(itemId) ?? 1;
            const leftoverQty = Math.max(0, groupedQty - keepQty);
            return {
              itemId,
              itemCode: getItemCode(itemId),
              groupedQty,
              keepQty,
              leftoverQty,
              warehouseId: getItemWarehouseId(itemId),
              accountId: getItemAccountId(itemId),
            };
          })
          .filter((c) => c.groupedQty > 1 && c.keepQty < c.groupedQty);
      };

      const createSplitTasksAndBlockOriginTask = async (args: {
        originTaskId: string;
        originTaskTitle: string;
        originWarehouseId: string | null;
        originAccountId: string | null;
        originItemIds: string[];
      }): Promise<{ splitTaskIds: string[] }> => {
        const candidates = computeSplitCandidates(args.originItemIds);
        if (candidates.length === 0) return { splitTaskIds: [] };

        const nowIso = new Date().toISOString();
        const requestNotes = formData.description?.trim() ? formData.description.trim() : null;
        const splitTaskIds: string[] = [];
        const splitItemsForMeta: any[] = [];

        for (const c of candidates) {
          // Idempotency: if a split task already exists for this origin task + item, reuse it.
          const { data: existingSplitTask } = await (supabase.from('tasks') as any)
            .select('id')
            .eq('tenant_id', profile.tenant_id)
            .eq('task_type', 'Split')
            .contains('metadata', {
              split_workflow: {
                origin_entity_type: 'task',
                origin_entity_id: args.originTaskId,
                parent_item_id: c.itemId,
              },
            })
            .in('status', ['pending', 'in_progress'])
            .limit(1)
            .maybeSingle();

          let splitTaskId: string | null = existingSplitTask?.id || null;

          if (!splitTaskId) {
            const title = args.originTaskTitle
              ? `Split - ${c.itemCode} (for ${args.originTaskTitle})`
              : `Split - ${c.itemCode}`;

            const description = [
              `Split required for grouped item ${c.itemCode}.`,
              `Keep qty on parent label: ${c.keepQty} (of ${c.groupedQty}).`,
              `Leftover qty to relabel: ${c.leftoverQty}.`,
              '',
              'Instructions:',
              `- Scan the parent item code (${c.itemCode}) before splitting.`,
              `- Parent quantity will be set to ${c.keepQty}.`,
              `- Leftover items will get NEW child labels and should be placed in the default receiving location (unless overridden).`,
              '- Print and attach ALL new labels, then scan each new child label to confirm application.',
              requestNotes ? ' ' : '',
              requestNotes ? `Notes:\n${requestNotes}` : '',
            ]
              .filter(Boolean)
              .join('\n');

            const splitWarehouseId = args.originWarehouseId || c.warehouseId;
            const splitAccountId = args.originAccountId || c.accountId;

            const { data: newTask, error: taskErr } = await (supabase.from('tasks') as any)
              .insert({
                tenant_id: profile.tenant_id,
                account_id: splitAccountId,
                warehouse_id: splitWarehouseId,
                related_item_id: c.itemId,
                task_type: 'Split',
                title,
                description,
                priority: 'urgent',
                status: 'pending',
                assigned_department: 'warehouse',
                metadata: {
                  split_workflow: {
                    origin_entity_type: 'task',
                    origin_entity_id: args.originTaskId,
                    origin_entity_number: args.originTaskTitle,
                    parent_item_id: c.itemId,
                    parent_item_code: c.itemCode,
                    grouped_qty: c.groupedQty,
                    keep_qty: c.keepQty,
                    leftover_qty: c.leftoverQty,
                    requested_by_user_id: profile.id,
                    // Internal users: do NOT set requested_by_email (prevents client completion emails)
                    requested_by_name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Internal user',
                    requested_by_email: null,
                    request_notes: requestNotes,
                    created_at: nowIso,
                  },
                },
              })
              .select('id')
              .single();

            if (taskErr) throw taskErr;
            splitTaskId = newTask.id;

            const { error: linkErr } = await (supabase.from('task_items') as any).insert({
              task_id: splitTaskId,
              item_id: c.itemId,
              quantity: c.leftoverQty,
            });
            if (linkErr) throw linkErr;

            // Notify office/warehouse (email + optional in-app configured by tenant)
            void queueSplitRequiredAlert(profile.tenant_id, splitTaskId, c.itemCode);
          }

          if (splitTaskId) {
            splitTaskIds.push(splitTaskId);
            splitItemsForMeta.push({
              parent_item_id: c.itemId,
              parent_item_code: c.itemCode,
              grouped_qty: c.groupedQty,
              keep_qty: c.keepQty,
              leftover_qty: c.leftoverQty,
              split_task_id: splitTaskId,
            });
          }
        }

        // Mark origin task as blocked by split-required tasks (merge metadata)
        const { data: originRow, error: originErr } = await (supabase.from('tasks') as any)
          .select('metadata')
          .eq('id', args.originTaskId)
          .maybeSingle();
        if (originErr) throw originErr;

        const existingMeta =
          originRow?.metadata && typeof originRow.metadata === 'object' ? originRow.metadata : {};
        const existingIds: string[] = Array.isArray((existingMeta as any).split_required_task_ids)
          ? (existingMeta as any).split_required_task_ids.map(String)
          : [];

        const nextIds = Array.from(new Set([...existingIds, ...splitTaskIds]));

        const nextMeta: any = {
          ...(existingMeta as any),
          split_required: true,
          split_required_task_ids: nextIds,
          split_required_items: splitItemsForMeta,
          split_required_created_at: nowIso,
        };

        const { error: metaErr } = await (supabase.from('tasks') as any)
          .update({ metadata: nextMeta })
          .eq('id', args.originTaskId);
        if (metaErr) throw metaErr;

        return { splitTaskIds: nextIds };
      };

      // Check if this is a single-item task type with multiple items
      const isSingleItemTaskType = SINGLE_ITEM_TASK_TYPES.includes(formData.task_type);
      const hasMultipleItems = allItemIds.length > 1;

      if (isSingleItemTaskType && hasMultipleItems && !task) {
        // Create one task per item
        const tasksToCreate = allItemIds.map((itemId, index) => ({
          tenant_id: profile.tenant_id,
          title: `${formData.task_type} - Item ${index + 1}`,
          description: formData.description || null,
          task_type: formData.task_type,
          task_type_id: formData.task_type_id,
          priority: formData.priority,
          due_date: formData.due_date ? format(formData.due_date, 'yyyy-MM-dd') + 'T12:00:00' : null,
          assigned_to: formData.assigned_to === 'unassigned' ? null : formData.assigned_to || null,
          assigned_department: formData.assigned_department || null,
          warehouse_id: formData.warehouse_id === 'none' ? null : formData.warehouse_id || null,
          account_id: formData.account_id === 'none' ? null : formData.account_id || null,
          related_item_id: itemId,
          status: 'pending',
          bill_to: formData.bill_to,
          bill_to_customer_name:
            formData.bill_to === 'customer' ? formData.bill_to_customer_name : null,
          bill_to_customer_email:
            formData.bill_to === 'customer' ? formData.bill_to_customer_email : null,
        }));

        // Insert all tasks
        const { data: newTasks, error: tasksError } = await (supabase
          .from('tasks') as any)
          .insert(tasksToCreate)
          .select();

        if (tasksError) throw tasksError;

        // Create task_items linking each task to its single item
        if (newTasks && newTasks.length > 0) {
          const taskItems = newTasks.map((t: any, index: number) => {
            const itemId = (t?.related_item_id as string | null) || allItemIds[index];
            const available = getGroupedQty(itemId);
            const requested = requestedQtyMap.get(itemId) ?? getRequestedQty(itemId, available);
            return {
              task_id: t.id,
              item_id: itemId,
              quantity: requested,
            };
          });

          const { error: taskItemsError } = await (supabase
            .from('task_items') as any)
            .insert(taskItems);

          if (taskItemsError) throw taskItemsError;

          // Update inventory status to pending for all items
          await updateInventoryStatus(allItemIds, formData.task_type, 'pending');
        }

        // Split-required workflow (internal users): create Split task(s) per origin task if needed
        let anySplit = false;
        for (const t of newTasks || []) {
          const itemId = (t?.related_item_id as string | null) || null;
          if (!itemId) continue;
          const result = await createSplitTasksAndBlockOriginTask({
            originTaskId: t.id,
            originTaskTitle: t.title || `${formData.task_type} task`,
            originWarehouseId: t.warehouse_id ?? (formData.warehouse_id === 'none' ? null : formData.warehouse_id || null),
            originAccountId: t.account_id ?? (formData.account_id === 'none' ? null : formData.account_id || null),
            originItemIds: [itemId],
          });
          if (result.splitTaskIds.length > 0) anySplit = true;
        }

        toast({
          title: `${allItemIds.length} Tasks Created`,
          description: anySplit
            ? `Created one ${formData.task_type} task per item. Some tasks are waiting for a warehouse Split.`
            : `Created one ${formData.task_type} task per item.`,
        });

        // For multiple tasks, navigate to first one
        onSuccess(newTasks?.[0]?.id);
        onOpenChange(false);
        return;
      } else {
        // Original logic: create single task with all items
        const taskData = {
          tenant_id: profile.tenant_id,
          title: generateTitle(),
          description: formData.description || null,
          task_type: formData.task_type,
          task_type_id: formData.task_type_id,
          priority: formData.priority,
          due_date: formData.due_date ? format(formData.due_date, 'yyyy-MM-dd') + 'T12:00:00' : null,
          assigned_to: formData.assigned_to === 'unassigned' ? null : formData.assigned_to || null,
          assigned_department: formData.assigned_department || null,
          warehouse_id: formData.warehouse_id === 'none' ? null : formData.warehouse_id || null,
          account_id: formData.account_id === 'none' ? null : formData.account_id || null,
          status: task ? task.status : 'pending',
          bill_to: formData.bill_to,
          bill_to_customer_name:
            formData.bill_to === 'customer' ? formData.bill_to_customer_name : null,
          bill_to_customer_email:
            formData.bill_to === 'customer' ? formData.bill_to_customer_email : null,
        };

        if (task) {
          const { error } = await (supabase
            .from('tasks') as any)
            .update(taskData)
            .eq('id', task.id);

          if (error) throw error;

          toast({
            title: 'Task Updated',
            description: 'Your changes were saved.',
          });
        } else {
          const { data: newTask, error } = await (supabase
            .from('tasks') as any)
            .insert(taskData)
            .select()
            .single();

          if (error) throw error;

          // Add task items
          if (allItemIds.length > 0 && newTask) {
            const taskItems = allItemIds.map((itemId) => {
              const available = getGroupedQty(itemId);
              const requested = requestedQtyMap.get(itemId) ?? getRequestedQty(itemId, available);
              return {
                task_id: newTask.id,
                item_id: itemId,
                quantity: requested,
              };
            });

            const { error: taskItemsError } = await (supabase
              .from('task_items') as any)
              .insert(taskItems);

            if (taskItemsError) throw taskItemsError;

            // Update inventory status to pending
            await updateInventoryStatus(allItemIds, formData.task_type, 'pending');
          }

          // Split-required workflow (internal users): create blocking Split task(s) when a partial qty is requested from a grouped item
          const splitResult = await createSplitTasksAndBlockOriginTask({
            originTaskId: newTask.id,
            originTaskTitle: newTask.title || generateTitle(),
            originWarehouseId: newTask.warehouse_id ?? (formData.warehouse_id === 'none' ? null : formData.warehouse_id || null),
            originAccountId: newTask.account_id ?? (formData.account_id === 'none' ? null : formData.account_id || null),
            originItemIds: allItemIds,
          });

          toast({
            title: 'Task Created',
            description: splitResult.splitTaskIds.length > 0
              ? 'Task created. Waiting for warehouse Split completion.'
              : 'Your task is now in the queue.',
          });

          // Pass the new task ID to navigate to it
          onSuccess(newTask?.id);
          onOpenChange(false);
          return;
        }
      }

      // For updates (editing), just call onSuccess without ID
      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error saving task:', error);
      toast({
        variant: 'destructive',
        title: 'Could not save task',
        description: error?.message || 'Please try again.',
      });
      throw error;
    }
  };

  const removeItem = (itemId: string) => {
    setSelectedItems(prev => prev.filter(item => item.id !== itemId));
    setRequestedQtyByItemId((prev) => {
      if (prev[itemId] == null) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[90dvh] overflow-hidden"
        // Ensure the DialogBody is the only scroll container (nested scroll areas are unreliable on iOS Safari)
        style={{ overflowY: 'hidden' }}
      >
        <DialogHeader>
          <DialogTitle>{task ? 'Edit Task' : 'Create Task'}</DialogTitle>
          <DialogDescription>
            {task
              ? 'Update task details'
              : isFromInventory
              ? `Create a task for ${selectedItemIds.length} selected item(s)`
              : 'Create a new task'}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="space-y-4 py-1">
            {/* Task Type */}
            <div className="space-y-2">
              <Label>Task Type *</Label>
              {showNewTaskType ? (
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    value={newTaskTypeName}
                    onChange={(e) => setNewTaskTypeName(e.target.value)}
                    placeholder="New task type name"
                    className="sm:flex-1"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleCreateTaskType();
                      }
                    }}
                  />
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:w-auto">
                    <Button
                      type="button"
                      onClick={handleCreateTaskType}
                      size="sm"
                      className="w-full justify-center"
                      disabled={!newTaskTypeName.trim()}
                    >
                      <MaterialIcon name="add" size="sm" className="mr-1" />
                      Add
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full justify-center"
                      onClick={() => {
                        setNewTaskTypeName('');
                        setShowNewTaskType(false);
                      }}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
              ) : (
                <Select value={formData.task_type} onValueChange={handleTaskTypeChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select task type" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectableTaskTypes.map(type => {
                      const displayName = type.name === type.name.toUpperCase() && type.name.length > 1
                        ? type.name.charAt(0).toUpperCase() + type.name.slice(1).toLowerCase()
                        : type.name;
                      return (
                        <SelectItem key={type.id} value={type.name}>
                          {displayName}
                        </SelectItem>
                      );
                    })}
                    <SelectItem value="new">
                      <span className="flex items-center gap-2">
                        <MaterialIcon name="add" size="sm" />
                        Add New Type
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* Description - placed before conditional Account/Items sections to prevent
                React reconciliation from resetting this field when those sections appear/disappear */}
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Task description"
                rows={3}
              />
            </div>

            {/* Account - shown when creating from tasks menu (optional) */}
            {!isFromInventory && (
              <div className="space-y-2">
                <Label>Account</Label>
                <Select
                  value={formData.account_id}
                  onValueChange={handleAccountChange}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select account (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No account</SelectItem>
                    {accounts.map(acc => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.account_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Item Search and Selection - shown when account is selected */}
            {!isFromInventory && formData.account_id !== 'none' && (
              <div className="space-y-3">
                <Label className="flex items-center gap-2">
                  Select Items
                  {selectedItems.length > 0 && (
                    <Badge variant="secondary">{selectedItems.length} selected</Badge>
                  )}
                </Label>
                <Popover open={itemDropdownOpen} onOpenChange={setItemDropdownOpen}>
                  <PopoverAnchor asChild>
                    <div
                      ref={itemSearchAnchorRef}
                      className="relative"
                      data-item-search-anchor
                    >
                      <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search by item code, description, vendor, sidemark..."
                        value={itemSearchQuery}
                        onChange={(e) => {
                          setItemSearchQuery(e.target.value);
                          if (!itemDropdownOpen) setItemDropdownOpen(true);
                        }}
                        onFocus={() => setItemDropdownOpen(true)}
                        onClick={() => setItemDropdownOpen(true)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') {
                            setItemDropdownOpen(false);
                          }
                          if ((e.key === 'ArrowDown' || e.key === 'Enter') && !itemDropdownOpen) {
                            e.preventDefault();
                            setItemDropdownOpen(true);
                          }
                        }}
                        className="pl-9"
                      />
                    </div>
                  </PopoverAnchor>
                  <PopoverContent
                    className="p-0 bg-popover border shadow-md"
                    align="start"
                    sideOffset={4}
                    style={{ width: itemDropdownWidth, zIndex: 100 }}
                    onOpenAutoFocus={(e) => e.preventDefault()}
                    onInteractOutside={(e) => {
                      // Allow clicking inside the anchor input without closing
                      const target = e.target as HTMLElement;
                      if (target.closest('[data-item-search-anchor]')) {
                        e.preventDefault();
                      }
                    }}
                  >
                    <div
                      className="max-h-[min(18rem,50vh)] overflow-y-auto overflow-x-hidden overscroll-contain touch-pan-y pr-1"
                      style={{ WebkitOverflowScrolling: 'touch' } as CSSProperties}
                    >
                      {loadingItems ? (
                        <div className="flex items-center justify-center py-4">
                          <MaterialIcon name="progress_activity" size="md" className="animate-spin text-muted-foreground" />
                        </div>
                      ) : filteredItems.length > 0 ? (
                        filteredItems.map(item => {
                          const isSelected = selectedItems.some(i => i.id === item.id);
                          return (
                            <button
                              key={item.id}
                              type="button"
                              className={cn(
                                "w-full flex items-center gap-3 p-2 text-left border-b last:border-b-0",
                                "hover:bg-muted/50",
                                isSelected && "bg-muted/30"
                              )}
                              onClick={() => toggleItemSelection(item)}
                            >
                              <Checkbox checked={isSelected} className="pointer-events-none" />
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm">{item.item_code}</div>
                                <div className="text-xs text-muted-foreground truncate">
                                  {[item.description, item.vendor, item.sidemark]
                                    .filter(Boolean)
                                    .join(' • ')}
                                </div>
                              </div>
                            </button>
                          );
                        })
                      ) : accountItems.length === 0 ? (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          No items found for this account
                        </p>
                      ) : (
                        <p className="text-sm text-muted-foreground text-center py-4">
                          No items match your search
                        </p>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            )}

            {/* Selected Items Display */}
            {selectedItems.length > 0 && (
              <div className="space-y-2">
                <Label>Selected Items ({selectedItems.length})</Label>
                <div className="flex flex-wrap gap-2">
                  {selectedItems.map(item => (
                    <Badge key={item.id} variant="secondary" className="flex items-center gap-1">
                      {item.item_code}
                      {!isFromInventory && (
                        <button onClick={() => removeItem(item.id)}>
                          <MaterialIcon name="close" className="h-3 w-3" />
                        </button>
                      )}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Quantity selection (grouped items only) */}
            {groupedQtyItems.length > 0 && (
              <div className="space-y-2">
                <Label>Requested Quantities</Label>
                <div className="space-y-2">
                  {groupedQtyItems.map((item) => {
                    const available = getAvailableQty(item);
                    const requested = getRequestedQty(item.id, available);
                    return (
                      <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border p-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{item.item_code}</div>
                          <div className="text-xs text-muted-foreground">
                            Grouped qty: {available}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Input
                            type="number"
                            min={1}
                            max={available}
                            step={1}
                            value={requested}
                            disabled={available <= 1}
                            onChange={(e) => {
                              const raw = parseInt(e.target.value || '0', 10);
                              const next = Number.isFinite(raw) ? raw : 1;
                              const clamped = Math.max(1, Math.min(available, next));
                              setRequestedQtyByItemId((prev) => ({ ...prev, [item.id]: clamped }));
                            }}
                            className="h-8 w-20 text-right"
                            aria-label={`Requested quantity for ${item.item_code}`}
                          />
                          <span className="text-xs text-muted-foreground">/ {available}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  Quantity adjustment is available only for grouped items (qty &gt; 1). Requesting a partial quantity will create a blocking <span className="font-medium">Split</span> task.
                </p>
              </div>
            )}

            {/* Bill To */}
            <div className="space-y-2">
              <Label>Bill To</Label>
              <Select
                value={formData.bill_to}
                onValueChange={(value: 'account' | 'customer' | 'no_charge') => 
                  setFormData(prev => ({ ...prev, bill_to: value }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="account">Account</SelectItem>
                  <SelectItem value="customer">Customer (Different Billing)</SelectItem>
                  <SelectItem value="no_charge">No Charge</SelectItem>
                </SelectContent>
              </Select>
              {formData.bill_to === 'no_charge' && (
                <p className="text-xs text-muted-foreground">
                  Selecting "No Charge" will void all charges for this task.
                </p>
              )}
            </div>

            {/* Customer Billing Info - only show when bill_to is customer */}
            {formData.bill_to === 'customer' && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="bill_to_customer_name">Customer Name</Label>
                  <Input
                    id="bill_to_customer_name"
                    value={formData.bill_to_customer_name}
                    onChange={(e) => setFormData(prev => ({ ...prev, bill_to_customer_name: e.target.value }))}
                    placeholder="Customer name for billing"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bill_to_customer_email">Customer Email</Label>
                  <Input
                    id="bill_to_customer_email"
                    type="email"
                    value={formData.bill_to_customer_email}
                    onChange={(e) => setFormData(prev => ({ ...prev, bill_to_customer_email: e.target.value }))}
                    placeholder="customer@email.com"
                  />
                </div>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              {/* Priority */}
              <div className="space-y-2">
                <Label>Priority</Label>
                <Select
                  value={formData.priority}
                  onValueChange={(value) => {
                    if (value === 'urgent') {
                      setFormData(prev => ({
                        ...prev,
                        priority: value,
                        due_date: new Date()
                      }));
                      toast({
                        title: 'Due date set to today',
                        description: 'Urgent priority automatically sets the due date to today.',
                      });
                    } else {
                      setFormData(prev => ({ ...prev, priority: value }));
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="normal">Normal</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Due Date */}
              <div className="space-y-2">
                <Label>Due Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        'w-full justify-start text-left font-normal',
                        !formData.due_date && 'text-muted-foreground'
                      )}
                    >
                      <MaterialIcon name="calendar_today" size="sm" className="mr-2" />
                      {formData.due_date ? format(formData.due_date, 'PPP') : 'Pick a date'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={formData.due_date || undefined}
                      onSelect={(date) => setFormData(prev => ({ ...prev, due_date: date || null }))}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              {/* Assign To */}
              <div className="space-y-2">
                <Label>Assign To</Label>
                <Select
                  value={formData.assigned_to}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, assigned_to: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select user" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {users.map(user => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.first_name} {user.last_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Warehouse - read-only when items selected, editable dropdown otherwise */}
              {selectedItems.length > 0 && formData.warehouse_id !== 'none' ? (
                <div className="space-y-2">
                  <Label>Warehouse</Label>
                  <div className="text-sm text-muted-foreground px-3 py-2 bg-muted rounded-md">
                    {warehouses.find(wh => wh.id === formData.warehouse_id)?.name || 'Auto-assigned from items'}
                  </div>
                </div>
              ) : selectedItems.length === 0 && (
                <div className="space-y-2">
                  <Label>Warehouse</Label>
                  <Select
                    value={formData.warehouse_id}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, warehouse_id: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select warehouse" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {warehouses.map(wh => (
                        <SelectItem key={wh.id} value={wh.id}>
                          {wh.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Account - only show when creating from inventory (auto-populated) */}
            {isFromInventory && (
              <div className="space-y-2">
                <Label>Account</Label>
                <Select
                  value={formData.account_id}
                  onValueChange={(value) => setFormData(prev => ({ ...prev, account_id: value }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {accounts.map(acc => (
                      <SelectItem key={acc.id} value={acc.id}>
                        {acc.account_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <SaveButton
            onClick={handleSubmit}
            label={task ? 'Update Task' : 'Create Task'}
            savingLabel={task ? 'Updating...' : 'Creating...'}
            savedLabel={task ? 'Updated' : 'Created'}
            saveDisabled={!formData.task_type}
          />
        </DialogFooter>
      </DialogContent>

      {/* Validation Error Dialog */}
      <AlertDialog open={validationDialogOpen} onOpenChange={setValidationDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <MaterialIcon name="warning" size="md" className="text-destructive" />
              Cannot Create Task
            </AlertDialogTitle>
            <AlertDialogDescription>
              {validationMessage}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setValidationDialogOpen(false)}>
              OK
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
