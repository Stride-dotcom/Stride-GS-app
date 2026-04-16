import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Navigate, useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { AutocompleteInput } from '@/components/ui/autocomplete-input';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { useFieldSuggestions } from '@/hooks/useFieldSuggestions';
import { useAccountSidemarks } from '@/hooks/useAccountSidemarks';
import { useAccountRoomSuggestions } from '@/hooks/useAccountRoomSuggestions';
import { Tabs, TabsContent, ScrollableTabsList, TabsTrigger } from '@/components/ui/tabs';
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
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { isValidUuid, cn } from '@/lib/utils';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { TaskDialog } from '@/components/tasks/TaskDialog';
import { ItemFlagsSection } from '@/components/items/ItemFlagsSection';
import { ItemBillingEventsSection } from '@/components/items/ItemBillingEventsSection';
import { ItemNotesSection } from '@/components/items/ItemNotesSection';
import { ItemLineageHistorySection } from '@/components/items/ItemLineageHistorySection';
import { usePermissions } from '@/hooks/usePermissions';
import { useItemDisplaySettings } from '@/hooks/useItemDisplaySettings';
import { RepairQuoteSection } from '@/components/items/RepairQuoteSection';
import { ItemPhotoGallery } from '@/components/items/ItemPhotoGallery';
import { ItemActivityFeed } from '@/components/items/ItemActivityFeed';
import { ItemEditDialog } from '@/components/items/ItemEditDialog';
import { useItemPhotos } from '@/hooks/useItemPhotos';
import { useItemNotes } from '@/hooks/useItemNotes';
import { useDocuments } from '@/hooks/useDocuments';
import { PrintLabelsDialog } from '@/components/inventory/PrintLabelsDialog';
import { AddBillingChargeDialog } from '@/components/items/AddBillingChargeDialog';
import { AddCreditDialog } from '@/components/billing/AddCreditDialog';
import { LinkToShipmentDialog } from '@/components/items/LinkToShipmentDialog';
import { CoverageSelector } from '@/components/coverage/CoverageSelector';
import { ClaimCreateDialog } from '@/components/claims/ClaimCreateDialog';
import { ItemLabelData } from '@/lib/labelGenerator';
import { ScanDocumentButton, DocumentList } from '@/components/scanner';
import { format } from 'date-fns';
import { formatItemSize } from '@/lib/items/formatItemSize';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { QuickReleaseDialog } from '@/components/inventory/QuickReleaseDialog';
import { ReassignAccountDialog } from '@/components/common/ReassignAccountDialog';
import { logItemActivity } from '@/lib/activity/logItemActivity';
import { queueSplitRequiredAlert } from '@/lib/alertQueue';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

interface ReceivingShipment {
  id: string;
  shipment_number: string;
  shipment_type: string;
  status: string;
  received_at: string | null;
}

interface ItemDetail {
  id: string;
  item_code: string;
  description: string | null;
  sku: string | null;
  status: string;
  quantity: number;
  client_account: string | null;
  sidemark: string | null;
  sidemark_id: string | null;
  account_id: string | null;
  vendor: string | null;
  size: number | null;
  size_unit: string | null;
  room: string | null;
  link: string | null;
  item_type_id: string | null;
  class_id: string | null;
  received_at: string | null;
  created_at: string;
  assembly_status: string | null;
  inspection_status: string | null;
  repair_status: string | null;
  photo_urls: string[] | null;
  inspection_photos: string[] | null;
  repair_photos: string[] | null;
  primary_photo_url: string | null;
  // Coverage fields
  coverage_type: string | null;
  declared_value: number | null;
  weight_lbs: number | null;
  metadata: Record<string, unknown> | null;
  // Receiving shipment
  receiving_shipment_id: string | null;
  receiving_shipment?: ReceivingShipment | null;
  // Flags
  is_overweight: boolean;
  is_oversize: boolean;
  is_unstackable: boolean;
  is_crated: boolean;
  needs_repair: boolean;
  needs_inspection: boolean;
  needs_warehouse_assembly: boolean;
  notify_dispatch: boolean;
  has_damage: boolean;
  // Relations
  location?: { id: string; code: string; name: string | null } | null;
  warehouse?: { id: string; name: string } | null;
  item_type?: { id: string; name: string } | null;
  class?: { id: string; code: string; name: string } | null;
  account?: { id: string; account_name: string; account_code: string } | null;
}

interface Movement {
  id: string;
  action_type: string;
  moved_at: string;
  note: string | null;
  from_location?: { code: string } | null;
  to_location?: { code: string } | null;
}

interface ItemTask {
  id: string;
  title: string;
  task_type: string;
  status: string;
  priority: string;
  due_date: string | null;
  created_at: string;
}

// Resolves non-UUID item_code params to UUID and redirects
function ItemCodeResolver({ itemCode }: { itemCode: string }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const lookup = async () => {
      if (!profile?.tenant_id) return;

      const { data, error: fetchError } = await supabase
        .from('items')
        .select('id')
        .eq('item_code', itemCode)
        .eq('tenant_id', profile.tenant_id)
        .is('deleted_at', null)
        .maybeSingle();

      if (fetchError || !data) {
        setError('Item not found');
        toast({
          variant: 'destructive',
          title: 'Item Not Found',
          description: `No item found with code "${itemCode}".`,
        });
        setTimeout(() => navigate('/inventory', { replace: true }), 2000);
        return;
      }

      navigate(`/inventory/${data.id}`, { replace: true });
    };
    lookup();
  }, [itemCode, profile?.tenant_id, navigate, toast]);

  return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        {error ? (
          <>
            <p className="text-destructive font-medium">{error}</p>
            <p className="text-muted-foreground text-sm">Redirecting to inventory...</p>
          </>
        ) : (
          <p className="text-muted-foreground">Looking up item...</p>
        )}
      </div>
    </DashboardLayout>
  );
}

export default function ItemDetail() {
  const { id } = useParams<{ id: string }>();

  // ============================================
  // RENDER-TIME GUARDS - execute before any hooks
  // ============================================
  if (!id) {
    return <Navigate to="/inventory" replace />;
  }

  // If param is not a UUID, try to resolve it as an item_code
  if (!isValidUuid(id)) {
    return <ItemCodeResolver itemCode={id} />;
  }

  // Now we know id is a valid UUID - safe to use hooks
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { profile } = useAuth();

  // Tab state - initialize from URL param if provided
  const initialTab = searchParams.get('tab') || 'details';
  const validTabs = ['details', 'photos', 'documents', 'notes', 'coverage', 'activity', 'repair'];
  const [activeTab, setActiveTab] = useState(validTabs.includes(initialTab) ? initialTab : 'details');

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  const [item, setItem] = useState<ItemDetail | null>(null);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [tasks, setTasks] = useState<ItemTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [accountSettings, setAccountSettings] = useState<{
    default_item_notes: string | null;
    highlight_item_notes: boolean;
  } | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [selectedTaskType, setSelectedTaskType] = useState<string>('');
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  const [billingChargeDialogOpen, setBillingChargeDialogOpen] = useState(false);
  const [addCreditDialogOpen, setAddCreditDialogOpen] = useState(false);
  const [linkShipmentDialogOpen, setLinkShipmentDialogOpen] = useState(false);
  const [claimDialogOpen, setClaimDialogOpen] = useState(false);
  const [reassignDialogOpen, setReassignDialogOpen] = useState(false);
  const [billingRefreshKey, setBillingRefreshKey] = useState(0);
  const [activeIndicatorFlags, setActiveIndicatorFlags] = useState<Array<{ code: string; name: string }>>([]);

  // Split (grouped item) action from Item Detail
  const [splitDialogOpen, setSplitDialogOpen] = useState(false);
  const [splitLeftoverQty, setSplitLeftoverQty] = useState<number>(1);
  const [splitRequestNotes, setSplitRequestNotes] = useState<string>('');
  const [splitCreating, setSplitCreating] = useState(false);

  // Inline edit state for autocomplete fields
  const [editVendor, setEditVendor] = useState('');
  const [editSku, setEditSku] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editSidemark, setEditSidemark] = useState('');
  const [editRoom, setEditRoom] = useState('');

  // Check if user is a client (simplified check)
  const isClientUser = false; // Will be determined by role system

  // Permission checks
  const { hasRole } = usePermissions();
  const canSeeBilling = hasRole('admin') || hasRole('manager') || hasRole('billing_manager');
  const canAddCredit = hasRole('admin') || hasRole('billing_manager');

  // Get counts for tab indicators
  const { allPhotos: photoList } = useItemPhotos(id);
  const { notes: notesList } = useItemNotes(id);
  const { documents: docsList } = useDocuments({ contextType: 'item', contextId: id });

  const photoCount = photoList.length;
  const notesCount = notesList.length;
  const docsCount = docsList.length;

  // Field suggestions for autocomplete
  const { suggestions: vendorSuggestions, addOrUpdateSuggestion: addVendorSuggestion } = useFieldSuggestions('vendor');
  const { suggestions: skuSuggestions, addOrUpdateSuggestion: addSkuSuggestion } = useFieldSuggestions('sku');
  const { suggestions: descriptionSuggestions, addOrUpdateSuggestion: addDescSuggestion } = useFieldSuggestions('description');
  const { sidemarks } = useAccountSidemarks(item?.account_id);
  const { rooms } = useAccountRoomSuggestions(item?.account_id);

  // Tenant-managed custom item fields + views
  const { settings: itemDisplaySettings } = useItemDisplaySettings();
  const customFieldsForDetail = itemDisplaySettings.custom_fields.filter((f) => f.enabled && f.show_on_detail);
  const [customFieldDraft, setCustomFieldDraft] = useState<Record<string, unknown>>({});

  // Sync draft values from item.metadata.custom_fields
  useEffect(() => {
    if (!item) return;
    const meta = item.metadata;
    const custom = meta && typeof meta === 'object' ? (meta as any).custom_fields : null;
    const base: Record<string, unknown> = (custom && typeof custom === 'object') ? { ...(custom as any) } : {};
    setCustomFieldDraft(base);
  }, [item?.id, item?.metadata]);

  const saveCustomField = async (fieldKey: string, rawValue: unknown) => {
    if (!item) return false;

    const existingMeta = item.metadata && typeof item.metadata === 'object' ? (item.metadata as Record<string, unknown>) : {};
    const existingCustom =
      (existingMeta as any).custom_fields && typeof (existingMeta as any).custom_fields === 'object'
        ? { ...(existingMeta as any).custom_fields }
        : {};

    const prevValue = (existingCustom as any)[fieldKey] ?? null;

    const def = itemDisplaySettings.custom_fields.find((f) => f.key === fieldKey);

    // Normalize: empty strings clear the value; coerce numbers/checkboxes
    let nextValue: unknown = rawValue;
    if (def?.type === 'checkbox') {
      if (typeof nextValue === 'string') {
        const normalized = nextValue.trim().toLowerCase();
        nextValue = ['true', 'yes', 'y', '1', 'checked'].includes(normalized);
      } else {
        nextValue = !!nextValue;
      }
    } else if (def?.type === 'number') {
      if (typeof nextValue === 'string') {
        const trimmed = nextValue.trim();
        if (!trimmed) nextValue = null;
        else {
          const n = Number(trimmed);
          nextValue = Number.isFinite(n) ? n : null;
        }
      } else if (typeof nextValue === 'number') {
        nextValue = Number.isFinite(nextValue) ? nextValue : null;
      } else if (nextValue === null || nextValue === undefined) {
        nextValue = null;
      } else {
        nextValue = null;
      }
    } else {
      if (typeof nextValue === 'string') {
        const trimmed = nextValue.trim();
        nextValue = trimmed ? trimmed : null;
      }
    }

    // No-op short-circuit to avoid extra writes.
    if (nextValue === prevValue) return true;

    if (nextValue === null || nextValue === undefined) {
      delete (existingCustom as any)[fieldKey];
    } else {
      (existingCustom as any)[fieldKey] = nextValue;
    }

    const nextMeta: Record<string, unknown> = { ...(existingMeta as any) };
    if (Object.keys(existingCustom).length > 0) {
      (nextMeta as any).custom_fields = existingCustom;
    } else {
      delete (nextMeta as any).custom_fields;
    }

    try {
      const { error } = await (supabase.from('items') as any)
        .update({ metadata: nextMeta })
        .eq('id', item.id);

      if (error) throw error;

      if (profile?.tenant_id && nextValue !== prevValue) {
        logItemActivity({
          tenantId: profile.tenant_id,
          itemId: item.id,
          actorUserId: profile.id,
          eventType: 'item_custom_field_updated',
          eventLabel: `${def?.label || fieldKey} updated`,
          details: { field_key: fieldKey, label: def?.label, from: prevValue, to: nextValue ?? null },
        });
      }

      setItem({ ...item, metadata: nextMeta });
      return true;
    } catch (err: any) {
      console.error('Error updating custom field:', err);
      toast({ title: 'Error', description: err?.message || 'Failed to update custom field', variant: 'destructive' });
      return false;
    }
  };

  // Fetch active indicator flags for this item
  const fetchIndicatorFlags = async () => {
    try {
      const { data, error } = await (supabase
        .from('item_flags') as any)
        .select('service_code, charge_types:charge_type_id(charge_name)')
        .eq('item_id', id);

      if (error) {
        // Table may not exist yet
        if (error.code !== '42P01') {
          console.error('[ItemDetail] Error fetching indicator flags:', error);
        }
        return;
      }

      setActiveIndicatorFlags(
        (data || []).map((f: any) => ({
          code: f.service_code,
          name: f.charge_types?.charge_name || f.service_code,
        }))
      );
    } catch (err) {
      // Silently handle - indicator flags are non-critical UI enhancement
    }
  };

  // Fetch data on mount (id is guaranteed valid UUID at this point)
  useEffect(() => {
    fetchItem();
    fetchMovements();
    fetchTasks();
    fetchIndicatorFlags();
  }, [id]);

  // Sync local edit state when item changes
  useEffect(() => {
    if (item) {
      setEditVendor(item.vendor || '');
      setEditSku(item.sku || '');
      setEditDescription(item.description || '');
      setEditSidemark(item.sidemark || '');
      setEditRoom(item.room || '');
    }
  }, [item?.vendor, item?.sku, item?.description, item?.sidemark, item?.room]);

  // Fetch account settings when item is loaded
  useEffect(() => {
    if (item?.account_id) {
      const fetchAccountSettings = async () => {
        const { data } = await (supabase.from('accounts') as any)
          .select('default_item_notes, highlight_item_notes')
          .eq('id', item.account_id)
          .single();
        if (data) {
          setAccountSettings(data);
        }
      };
      fetchAccountSettings();
    }
  }, [item?.account_id]);

  const fetchItem = async () => {
    try {
      // First fetch: item with joined relations
      const { data, error } = await (supabase.from('items') as any)
        .select(`
          *,
          locations!items_current_location_id_fkey(id, code, name),
          warehouses(id, name),
          item_types(id, name),
          accounts:account_id(id, account_name, account_code)
        `)
        .eq('id', id)
        .single();

      if (error) throw error;

      // Fetch class separately (FK may not be in PostgREST schema cache)
      let itemClass: { id: string; code: string; name: string; min_cubic_feet?: number | null; max_cubic_feet?: number | null } | null = null;
      if (data.class_id) {
        const { data: classData } = await (supabase.from('classes') as any)
          .select('id, code, name, min_cubic_feet, max_cubic_feet')
          .eq('id', data.class_id)
          .single();

        if (classData) {
          itemClass = classData;
        }
      }

      // If item has a receiving_shipment_id, fetch the shipment details
      let receivingShipment: ReceivingShipment | null = null;
      if (data.receiving_shipment_id) {
        const { data: shipmentData } = await (supabase.from('shipments') as any)
          .select('id, shipment_number, shipment_type, status, received_at')
          .eq('id', data.receiving_shipment_id)
          .single();

        if (shipmentData) {
          receivingShipment = shipmentData;
        }
      }

      // Derive class size (use min_cubic_feet as the single size value when min===max)
      const classSize = itemClass?.min_cubic_feet ?? null;
      // If item has no size but class provides one, auto-populate
      const shouldAutoFillSize = classSize !== null && (data.size === null || data.size === undefined);
      const effectiveSize = shouldAutoFillSize ? classSize : data.size;
      const effectiveSizeUnit = shouldAutoFillSize ? 'cu_ft' : data.size_unit;

      setItem({
        ...data,
        sku: data.sku ?? null,
        metadata: data.metadata ?? null,
        location: data.locations,
        warehouse: data.warehouses,
        item_type: data.item_types,
        class: itemClass,
        account: data.accounts,
        receiving_shipment: receivingShipment,
        room: data.room || null,
        link: data.link || null,
        photo_urls: data.photo_urls || [],
        inspection_photos: data.inspection_photos || [],
        repair_photos: data.repair_photos || [],
        coverage_type: data.coverage_type || null,
        declared_value: data.declared_value || null,
        weight_lbs: data.weight_lbs || null,
        size: effectiveSize ?? null,
        size_unit: effectiveSizeUnit || null,
      });

      // Persist auto-filled size to DB
      if (shouldAutoFillSize) {
        await (supabase.from('items') as any)
          .update({ size: classSize, size_unit: 'cu_ft', updated_at: new Date().toISOString() })
          .eq('id', data.id);
      }
    } catch (error) {
      console.error('Error fetching item:', error);
      toast({
        title: 'Error',
        description: 'Failed to load item details.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const fetchMovements = async () => {
    try {
      const { data } = await (supabase.from('movements') as any)
        .select(`
          id,
          action_type,
          moved_at,
          note,
          from_location:from_location_id(code),
          to_location:to_location_id(code)
        `)
        .eq('item_id', id)
        .order('moved_at', { ascending: false })
        .limit(20);

      setMovements(data || []);
    } catch (error) {
      console.error('Error fetching movements:', error);
    }
  };

  const fetchTasks = async () => {
    try {
      const { data: taskItems } = await (supabase.from('task_items') as any)
        .select('task_id')
        .eq('item_id', id);

      if (!taskItems || taskItems.length === 0) {
        setTasks([]);
        return;
      }

      const taskIds = taskItems.map((ti: any) => ti.task_id);

      const { data } = await (supabase.from('tasks') as any)
        .select('id, title, task_type, status, priority, due_date, created_at')
        .in('id', taskIds)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });

      setTasks(data || []);
    } catch (error) {
      console.error('Error fetching tasks:', error);
    }
  };

  const handleFlagsChange = async () => {
    if (item) {
      // Refetch item to get updated status values from database
      await fetchItem();
      // Refresh billing events section so new flag charges appear immediately
      setBillingRefreshKey(prev => prev + 1);
      // Refresh indicator flag badges in header
      await fetchIndicatorFlags();
    }
  };

  const openTaskMenu = (taskType: string) => {
    // Check for existing open tasks of this type
    const openTasks = tasks.filter(
      t => t.task_type === taskType && 
      !['completed', 'cancelled', 'unable_to_complete'].includes(t.status)
    );

    if (openTasks.length === 1) {
      // Navigate to the existing task
      navigate(`/tasks/${openTasks[0].id}`);
    } else if (openTasks.length > 1) {
      // Show list - for now just navigate to tasks filtered
      navigate(`/tasks?type=${taskType}`);
    } else {
      // Create new task
      setSelectedTaskType(taskType);
      setTaskDialogOpen(true);
    }
  };

  useEffect(() => {
    if (!splitDialogOpen || !item) return;
    const grouped = typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : 1;
    const maxLeftover = Math.max(1, grouped - 1);
    // Default: keep 1 on the parent label.
    setSplitLeftoverQty(maxLeftover);
    setSplitRequestNotes('');
  }, [splitDialogOpen, item?.id]);

  const handleCreateSplitTaskFromItem = async () => {
    if (!profile?.tenant_id || !profile?.id || !item) return;

    const groupedQty = typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : 1;
    if (groupedQty <= 1) {
      toast({ variant: 'destructive', title: 'Not grouped', description: 'This item does not have a grouped quantity.' });
      return;
    }

    const rawLeftover = Number.isFinite(splitLeftoverQty) ? Math.floor(splitLeftoverQty) : 1;
    const leftoverQty = Math.max(1, Math.min(groupedQty - 1, rawLeftover));
    const keepQty = groupedQty - leftoverQty;

    if (keepQty < 1) {
      toast({
        variant: 'destructive',
        title: 'Invalid split quantity',
        description: 'Keep quantity must be at least 1.',
      });
      return;
    }

    setSplitCreating(true);
    try {
      // Idempotency: if any Split task is already open for this item, reuse it.
      const { data: existingSplitTask, error: existingErr } = await (supabase.from('tasks') as any)
        .select('id')
        .eq('tenant_id', profile.tenant_id)
        .eq('task_type', 'Split')
        .contains('metadata', { split_workflow: { parent_item_id: item.id } })
        .in('status', ['pending', 'in_progress'])
        .limit(1)
        .maybeSingle();
      if (existingErr) throw existingErr;

      if (existingSplitTask?.id) {
        toast({
          title: 'Split task already exists',
          description: 'Opening the existing Split task.',
        });
        setSplitDialogOpen(false);
        navigate(`/tasks/${existingSplitTask.id}`);
        return;
      }

      const nowIso = new Date().toISOString();
      const notes = splitRequestNotes.trim() || null;

      const title = `Split - ${item.item_code}`;
      const description = [
        'Split requested from Item Detail.',
        `Keep qty on parent label: ${keepQty} (of ${groupedQty}).`,
        `Leftover qty to relabel: ${leftoverQty}.`,
        notes ? ' ' : '',
        notes ? `Notes:\n${notes}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const { data: newTask, error: taskErr } = await (supabase.from('tasks') as any)
        .insert({
          tenant_id: profile.tenant_id,
          account_id: item.account_id,
          warehouse_id: item.warehouse?.id ?? null,
          related_item_id: item.id,
          task_type: 'Split',
          title,
          description,
          priority: 'urgent',
          status: 'pending',
          assigned_department: 'warehouse',
          metadata: {
            split_workflow: {
              parent_item_id: item.id,
              parent_item_code: item.item_code,
              grouped_qty: groupedQty,
              keep_qty: keepQty,
              leftover_qty: leftoverQty,
              requested_by_user_id: profile.id,
              requested_by_name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || 'Internal user',
              requested_by_email: null,
              request_notes: notes,
              created_at: nowIso,
            },
          },
        })
        .select('id')
        .single();

      if (taskErr) throw taskErr;

      const { error: linkErr } = await (supabase.from('task_items') as any).insert({
        task_id: newTask.id,
        item_id: item.id,
        quantity: leftoverQty,
      });
      if (linkErr) throw linkErr;

      // Notify office/warehouse (email + in-app are tenant-configurable)
      void queueSplitRequiredAlert(profile.tenant_id, newTask.id, item.item_code);

      toast({
        title: 'Split task created',
        description: 'A warehouse split is required before this grouped item can be partially used/shipped.',
      });
      setSplitDialogOpen(false);
      navigate(`/tasks/${newTask.id}`);
    } catch (err: any) {
      console.error('[ItemDetail] create split task error:', err);
      toast({
        variant: 'destructive',
        title: 'Could not create Split task',
        description: err?.message || 'Please try again.',
      });
    } finally {
      setSplitCreating(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      active: 'default',
      released: 'outline',
      disposed: 'destructive',
    };
    return <Badge variant={variants[status] || 'default'}>{status.replace('_', ' ')}</Badge>;
  };

  const getSubStatusBadge = (status: string | null, type: string) => {
    if (!status) return null;
    const colors: Record<string, string> = {
      pending: 'bg-yellow-100 text-yellow-800',
      in_progress: 'bg-blue-100 text-blue-800',
      completed: 'bg-green-100 text-green-800',
    };
    return (
      <Badge className={colors[status] || 'bg-gray-100 text-gray-800'}>
        {type}: {status.replace('_', ' ')}
      </Badge>
    );
  };

  const handleSidemarkSave = async (newValue: string): Promise<boolean> => {
    if (!item) return false;
    try {
      const { error } = await (supabase.from('items') as any)
        .update({ sidemark: newValue || null })
        .eq('id', item.id);
      
      if (error) throw error;
      if (profile?.tenant_id && (newValue || null) !== (item.sidemark || null)) {
        logItemActivity({
          tenantId: profile.tenant_id,
          itemId: item.id,
          actorUserId: profile.id,
          eventType: 'item_field_updated',
          eventLabel: `Sidemark updated`,
          details: { field: 'sidemark', from: item.sidemark, to: newValue || null },
        });
      }
      setItem({ ...item, sidemark: newValue || null });
      toast({ title: 'Sidemark updated' });
      return true;
    } catch (error) {
      console.error('Error updating sidemark:', error);
      toast({ title: 'Error', description: 'Failed to update sidemark', variant: 'destructive' });
      return false;
    }
  };

  const handleRoomSave = async (newValue: string): Promise<boolean> => {
    if (!item) return false;
    try {
      const { error } = await (supabase.from('items') as any)
        .update({ room: newValue || null })
        .eq('id', item.id);

      if (error) throw error;
      if (profile?.tenant_id && (newValue || null) !== (item.room || null)) {
        logItemActivity({
          tenantId: profile.tenant_id,
          itemId: item.id,
          actorUserId: profile.id,
          eventType: 'item_field_updated',
          eventLabel: `Room updated`,
          details: { field: 'room', from: item.room, to: newValue || null },
        });
      }
      setItem({ ...item, room: newValue || null });
      toast({ title: 'Room updated' });
      return true;
    } catch (error) {
      console.error('Error updating room:', error);
      toast({ title: 'Error', description: 'Failed to update room', variant: 'destructive' });
      return false;
    }
  };

  const handleVendorSave = async (newValue: string): Promise<boolean> => {
    if (!item) return false;
    try {
      const { error } = await (supabase.from('items') as any)
        .update({ vendor: newValue || null })
        .eq('id', item.id);

      if (error) throw error;
      if (profile?.tenant_id && (newValue || null) !== (item.vendor || null)) {
        logItemActivity({
          tenantId: profile.tenant_id,
          itemId: item.id,
          actorUserId: profile.id,
          eventType: 'item_field_updated',
          eventLabel: `Vendor updated`,
          details: { field: 'vendor', from: item.vendor, to: newValue || null },
        });
      }
      setItem({ ...item, vendor: newValue || null });
      if (newValue) addVendorSuggestion(newValue);
      return true;
    } catch (error) {
      console.error('Error updating vendor:', error);
      toast({ title: 'Error', description: 'Failed to update vendor', variant: 'destructive' });
      return false;
    }
  };

  const handleSkuSave = async (newValue: string): Promise<boolean> => {
    if (!item) return false;
    try {
      const { error } = await (supabase.from('items') as any)
        .update({ sku: newValue || null })
        .eq('id', item.id);

      if (error) throw error;
      if (profile?.tenant_id && (newValue || null) !== (item.sku || null)) {
        logItemActivity({
          tenantId: profile.tenant_id,
          itemId: item.id,
          actorUserId: profile.id,
          eventType: 'item_field_updated',
          eventLabel: `SKU updated`,
          details: { field: 'sku', from: item.sku, to: newValue || null },
        });
      }
      setItem({ ...item, sku: newValue || null });
      if (newValue) addSkuSuggestion(newValue);
      return true;
    } catch (error) {
      console.error('Error updating sku:', error);
      toast({ title: 'Error', description: 'Failed to update SKU', variant: 'destructive' });
      return false;
    }
  };

  const handleDescriptionSave = async (newValue: string): Promise<boolean> => {
    if (!item) return false;
    try {
      const { error } = await (supabase.from('items') as any)
        .update({ description: newValue || null })
        .eq('id', item.id);

      if (error) throw error;
      if (profile?.tenant_id && (newValue || null) !== (item.description || null)) {
        logItemActivity({
          tenantId: profile.tenant_id,
          itemId: item.id,
          actorUserId: profile.id,
          eventType: 'item_field_updated',
          eventLabel: `Description updated`,
          details: { field: 'description', from: item.description, to: newValue || null },
        });
      }
      setItem({ ...item, description: newValue || null });
      if (newValue) addDescSuggestion(newValue);
      return true;
    } catch (error) {
      console.error('Error updating description:', error);
      toast({ title: 'Error', description: 'Failed to update description', variant: 'destructive' });
      return false;
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center h-[50vh]">
          <MaterialIcon name="progress_activity" size="xl" className="animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  if (!item) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <div className="text-5xl mb-4 opacity-50">📦</div>
          <h3 className="mt-4 text-lg font-semibold">Item not found</h3>
          <Button variant="link" onClick={() => navigate('/inventory')}>
            Back to Inventory
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  const itemMeta = item.metadata && typeof item.metadata === 'object'
    ? (item.metadata as Record<string, unknown>)
    : null;
  const isSplitChildItem = Boolean(
    itemMeta && typeof itemMeta.split_parent_item_id === 'string' && itemMeta.split_parent_item_id.trim().length > 0
  );
  const splitTaskLinked = Boolean(
    itemMeta && typeof itemMeta.split_task_id === 'string' && itemMeta.split_task_id.trim().length > 0
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <MaterialIcon name="arrow_back" size="md" />
            </Button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{item.item_code}</h1>
                {getStatusBadge(item.status)}
              </div>

              {/* Secondary status chips (keep tidy: horizontal scroll instead of wrapping into a tall block) */}
              <div className="mt-2 flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-thin">
                {/* Repair Status */}
                {item.repair_status === 'completed' && (
                  <Badge variant="success">Repaired</Badge>
                )}
                {item.repair_status === 'in_progress' && (
                  <Badge variant="warning">Repair In Progress</Badge>
                )}
                {(item.needs_repair && !item.repair_status) || item.repair_status === 'pending' ? (
                  <Badge variant="destructive">Needs Repair</Badge>
                ) : null}

                {/* Coverage Badge */}
                {item.coverage_type && item.coverage_type !== 'standard' && item.coverage_type !== 'pending' && (
                  <Badge variant="info">
                    <MaterialIcon name="verified_user" size="sm" />
                    {item.coverage_type === 'full_replacement_no_deductible' || item.coverage_type === 'full_no_deductible'
                      ? 'Full Coverage'
                      : item.coverage_type === 'full_replacement_deductible' || item.coverage_type === 'full_deductible'
                      ? `Full Coverage ($${item.declared_value?.toLocaleString() || '0'})`
                      : 'Covered'}
                  </Badge>
                )}
                {item.coverage_type === 'pending' && (
                  <Badge variant="warning">
                    <MaterialIcon name="schedule" size="sm" />
                    Coverage Pending
                  </Badge>
                )}

                {/* Active Indicator Flags — one label per indicator, dynamic service name */}
                {activeIndicatorFlags.map((flag) => (
                  <Badge key={flag.code} variant="warning" className="shrink-0">
                    <MaterialIcon name="warning" size="sm" />
                    {flag.name}
                  </Badge>
                ))}
                {isSplitChildItem && (
                  <Badge variant="outline" className="shrink-0">
                    <MaterialIcon name="account_tree" size="sm" />
                    Split Child
                  </Badge>
                )}
                {splitTaskLinked && (
                  <Badge variant="outline" className="shrink-0">
                    <MaterialIcon name="call_split" size="sm" />
                    Split Linked
                  </Badge>
                )}
              </div>
            </div>
          </div>
          
          <div className="w-full sm:w-auto">
            <div
              className={cn(
                "grid gap-2 w-full sm:flex sm:items-center sm:justify-end sm:w-auto",
                (!isClientUser && item.quantity > 1 && item.status !== 'released' && item.status !== 'disposed' && item.status === 'active')
                  ? 'grid-cols-3'
                  : (!isClientUser && ((item.quantity > 1 && item.status !== 'released' && item.status !== 'disposed') || item.status === 'active'))
                    ? 'grid-cols-2'
                    : 'grid-cols-1',
              )}
            >
              {/* Consolidated Actions Menu (Tasks + Item actions) */}
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full sm:w-auto justify-start">
                    <span className="mr-2">🧰</span>
                    Actions
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  sideOffset={8}
                  // Glass + constrained height so long menus remain usable on mobile
                  className="w-[min(20rem,calc(100vw-1.5rem))] bg-popover/90 backdrop-blur-xl"
                  onPointerDownOutside={(e) => {
                    // On mobile/tablet, keep the menu open so the user can scroll/peek at the page
                    // behind it while deciding what to select.
                    if (typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches) {
                      e.preventDefault();
                    }
                  }}
                >
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Create Task</div>
                  <DropdownMenuItem onClick={() => openTaskMenu('Inspection')}>
                    🔍 Inspection
                    {tasks.filter(t => t.task_type === 'Inspection' && t.status !== 'completed').length > 0 && (
                      <Badge variant="secondary" className="ml-auto">
                        {tasks.filter(t => t.task_type === 'Inspection' && t.status !== 'completed').length}
                      </Badge>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openTaskMenu('Assembly')}>
                    🔧 Assembly
                    {tasks.filter(t => t.task_type === 'Assembly' && t.status !== 'completed').length > 0 && (
                      <Badge variant="secondary" className="ml-auto">
                        {tasks.filter(t => t.task_type === 'Assembly' && t.status !== 'completed').length}
                      </Badge>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openTaskMenu('Repair')}>
                    🔨 Repair
                    {tasks.filter(t => t.task_type === 'Repair' && t.status !== 'completed').length > 0 && (
                      <Badge variant="secondary" className="ml-auto">
                        {tasks.filter(t => t.task_type === 'Repair' && t.status !== 'completed').length}
                      </Badge>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openTaskMenu('Disposal')}>
                    🗑️ Disposal
                    {tasks.filter(t => t.task_type === 'Disposal' && t.status !== 'completed').length > 0 && (
                      <Badge variant="secondary" className="ml-auto">
                        {tasks.filter(t => t.task_type === 'Disposal' && t.status !== 'completed').length}
                      </Badge>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => openTaskMenu('Split')}>
                    ✂️ Split
                    {tasks.filter(t => t.task_type === 'Split' && t.status !== 'completed').length > 0 && (
                      <Badge variant="secondary" className="ml-auto">
                        {tasks.filter(t => t.task_type === 'Split' && t.status !== 'completed').length}
                      </Badge>
                    )}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => {
                    setSelectedTaskType('');
                    setTaskDialogOpen(true);
                  }}>
                    ➕ Other Task Type
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Warehouse</div>
                  <DropdownMenuItem onClick={() => navigate('/', { state: { putAwayItemId: item.id } })}>
                    <MaterialIcon name="inventory" size="sm" className="mr-2" />
                    Put Away
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => navigate('/', { state: { putAwayItemId: item.id } })}>
                    <MaterialIcon name="move_item" size="sm" className="mr-2" />
                    Move
                  </DropdownMenuItem>

                  <DropdownMenuSeparator />
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Shipments</div>
                  <DropdownMenuItem onClick={() => navigate('/shipments/outbound/new', { state: { itemIds: [item.id], accountId: item.account_id } })}>
                    🚚 Create Outbound
                  </DropdownMenuItem>

                  {/* Staff-only item actions */}
                  {!isClientUser && (
                    <>
                      {item.status === 'active' && (
                        <DropdownMenuItem onClick={() => setReleaseDialogOpen(true)}>
                          📤 Release
                        </DropdownMenuItem>
                      )}

                      <DropdownMenuSeparator />
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">Item</div>
                      <DropdownMenuItem onClick={() => setPrintDialogOpen(true)}>
                        🖨️ Print 4x6 Label
                      </DropdownMenuItem>
                      {item.quantity > 1 && item.status !== 'released' && item.status !== 'disposed' && (
                        <DropdownMenuItem onClick={() => setSplitDialogOpen(true)}>
                          <MaterialIcon name="call_split" size="sm" className="mr-2" />
                          Split / Relabel
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => setBillingChargeDialogOpen(true)}>
                        💰 Add Charge
                      </DropdownMenuItem>
                      {canAddCredit && (
                        <DropdownMenuItem onClick={() => setAddCreditDialogOpen(true)}>
                          💸 Add Credit
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onClick={() => setReassignDialogOpen(true)}>
                        <MaterialIcon name="swap_horiz" size="sm" className="mr-2" />
                        Reassign Account
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setClaimDialogOpen(true)}>
                        ⚠️ File Claim
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setEditDialogOpen(true)}>
                        ✏️ Edit Item
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Split Button - Only show for grouped items */}
              {!isClientUser && item.quantity > 1 && item.status !== 'released' && item.status !== 'disposed' && (
                <Button
                  variant="outline"
                  onClick={() => setSplitDialogOpen(true)}
                  className="w-full sm:w-auto justify-center"
                >
                  <MaterialIcon name="call_split" size="sm" className="mr-2" />
                  Split
                </Button>
              )}

              {/* Release Button - Only show for active items */}
              {!isClientUser && item.status === 'active' && (
                <Button
                  variant="default"
                  onClick={() => setReleaseDialogOpen(true)}
                  className="w-full sm:w-auto justify-center"
                >
                  <span className="mr-2">📤</span>
                  Release
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Status Badges Row - Removed per UI update */}

        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          {/* Mobile: use a single section dropdown instead of an overflowing tab row */}
          <div className="sm:hidden">
            <Select value={activeTab} onValueChange={handleTabChange}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Section" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="details">📋 Details</SelectItem>
                <SelectItem value="photos">📷 Photos{photoCount > 0 ? ` (${photoCount})` : ''}</SelectItem>
                <SelectItem value="documents">📄 Docs{docsCount > 0 ? ` (${docsCount})` : ''}</SelectItem>
                <SelectItem value="notes">💬 Notes{notesCount > 0 ? ` (${notesCount})` : ''}</SelectItem>
                {!isClientUser && <SelectItem value="coverage">🛡️ Coverage</SelectItem>}
                {!isClientUser && <SelectItem value="activity">📊 Activity</SelectItem>}
                {item.needs_repair && <SelectItem value="repair">🔧 Repair</SelectItem>}
              </SelectContent>
            </Select>
          </div>

          {/* Desktop/tablet: scrollable tab bar (prevents overflow) */}
          <div className="hidden sm:block">
            <ScrollableTabsList activeValue={activeTab}>
              <TabsTrigger value="details">📋 Details</TabsTrigger>
              <TabsTrigger value="photos" className="relative">
                📷 Photos
                {photoCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-medium bg-red-500 text-white rounded-full">
                    {photoCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="documents" className="relative">
                📄 Docs
                {docsCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-medium bg-red-500 text-white rounded-full">
                    {docsCount}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="notes" className="relative">
                💬 Notes
                {notesCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-medium bg-red-500 text-white rounded-full">
                    {notesCount}
                  </span>
                )}
              </TabsTrigger>
              {!isClientUser && <TabsTrigger value="coverage">🛡️ Coverage</TabsTrigger>}
              {!isClientUser && <TabsTrigger value="activity">📊 Activity</TabsTrigger>}
              {item.needs_repair && <TabsTrigger value="repair">🔧 Repair</TabsTrigger>}
            </ScrollableTabsList>
          </div>

          <TabsContent value="details" className="space-y-6 mt-6">
            {/* Account Default Notes - Full width above details, only show if highlight enabled AND notes not blank */}
            {accountSettings?.highlight_item_notes && accountSettings?.default_item_notes?.trim() && (
              <Card className="bg-orange-50 dark:bg-orange-900/20 border-4 border-orange-500 dark:border-orange-400">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <span className="text-orange-600 dark:text-orange-400">⚠️</span>
                    Account Notes
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm whitespace-pre-wrap font-bold text-orange-700 dark:text-orange-300">{accountSettings.default_item_notes}</p>
                </CardContent>
              </Card>
            )}

            <ItemLineageHistorySection
              itemId={item.id}
              itemCode={item.item_code}
              itemCreatedAt={item.created_at}
              metadata={item.metadata}
              isClientUser={isClientUser}
              canSeeBilling={canSeeBilling}
            />

            <div className="grid gap-6 md:grid-cols-2">
              {/* Details Card */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <div className="emoji-tile emoji-tile-md bg-muted dark:bg-slate-700 rounded-lg">📦</div>
                    Item Details
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {/* Status - prominent with badge */}
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Status</span>
                      <div className="mt-1">
                        {getStatusBadge(item.status)}
                      </div>
                    </div>
                    {/* Class */}
                    <div>
                      <span className="text-muted-foreground">Class</span>
                      <p className="font-medium">
                        {item.class ? `${item.class.code} - ${item.class.name}` : '-'}
                      </p>
                    </div>
                    {/* Quantity */}
                    <div>
                      <span className="text-muted-foreground">Quantity</span>
                      <p className="font-medium">{item.quantity}</p>
                    </div>
                    {/* Vendor - inline editable with autocomplete */}
                    <div>
                      <span className="text-muted-foreground">Vendor</span>
                      {isClientUser ? (
                        <p className="font-medium">{item.vendor || '-'}</p>
                      ) : (
                        <AutocompleteInput
                          value={editVendor}
                          onChange={setEditVendor}
                          onBlur={() => {
                            if (editVendor !== (item.vendor || '')) {
                              handleVendorSave(editVendor);
                            }
                          }}
                          suggestions={vendorSuggestions.map(s => ({ value: s.value }))}
                          placeholder="Add vendor"
                          className="h-7 mt-1 text-sm border-transparent bg-transparent hover:bg-muted/50 focus:bg-background focus:border-input"
                        />
                      )}
                    </div>
                    {/* SKU */}
                    <div>
                      <span className="text-muted-foreground">SKU</span>
                      {isClientUser ? (
                        <p className="font-medium">{item.sku || '-'}</p>
                      ) : (
                        <AutocompleteInput
                          value={editSku}
                          onChange={setEditSku}
                          onBlur={() => {
                            if (editSku !== (item.sku || '')) {
                              handleSkuSave(editSku);
                            }
                          }}
                          suggestions={skuSuggestions.map(s => ({ value: s.value }))}
                          placeholder="Add SKU"
                          className="h-7 mt-1 text-sm border-transparent bg-transparent hover:bg-muted/50 focus:bg-background focus:border-input"
                        />
                      )}
                    </div>
                    {/* Description - inline editable with autocomplete */}
                    <div>
                      <span className="text-muted-foreground">Description</span>
                      {isClientUser ? (
                        <p className="font-medium">{item.description || '-'}</p>
                      ) : (
                        <AutocompleteInput
                          value={editDescription}
                          onChange={setEditDescription}
                          onBlur={() => {
                            if (editDescription !== (item.description || '')) {
                              handleDescriptionSave(editDescription);
                            }
                          }}
                          suggestions={descriptionSuggestions.map(s => ({ value: s.value }))}
                          placeholder="Add description"
                          className="h-7 mt-1 text-sm border-transparent bg-transparent hover:bg-muted/50 focus:bg-background focus:border-input"
                        />
                      )}
                    </div>
                    {/* Custom fields */}
                    {customFieldsForDetail.length > 0 && (
                      <div className="col-span-2 pt-2">
                        <Separator className="my-2" />
                        <div className="text-xs font-medium text-muted-foreground mb-2">Custom Fields</div>
                        <div className="grid grid-cols-2 gap-4">
                          {customFieldsForDetail.map((f) => {
                            const raw = (customFieldDraft as any)[f.key];
                            const stringVal = raw === null || raw === undefined ? '' : String(raw);
                            const dateVal = stringVal && stringVal.includes('T') ? stringVal.slice(0, 10) : stringVal;
                            const checked = raw === true || raw === 'true' || raw === 1 || raw === '1';

                            return (
                              <div key={f.id} className="space-y-1">
                                <span className="text-muted-foreground">{f.label}</span>
                                {isClientUser ? (
                                  <p className="font-medium">{stringVal || '-'}</p>
                                ) : f.type === 'select' ? (
                                  <Select
                                    value={stringVal || '__none__'}
                                    onValueChange={(val) => {
                                      const next = val === '__none__' ? '' : val;
                                      setCustomFieldDraft((prev) => ({ ...prev, [f.key]: next }));
                                      void saveCustomField(f.key, next);
                                    }}
                                  >
                                    <SelectTrigger className="h-8">
                                      <SelectValue placeholder="Select…" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__none__">-</SelectItem>
                                      {(f.options || []).map((opt) => (
                                        <SelectItem key={opt} value={opt}>
                                          {opt}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                ) : f.type === 'checkbox' ? (
                                  <div className="h-8 flex items-center">
                                    <Switch
                                      checked={checked}
                                      onCheckedChange={(val) => {
                                        setCustomFieldDraft((prev) => ({ ...prev, [f.key]: val }));
                                        void saveCustomField(f.key, val);
                                      }}
                                    />
                                  </div>
                                ) : (
                                  <Input
                                    value={f.type === 'date' ? dateVal : stringVal}
                                    type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                                    onChange={(e) => setCustomFieldDraft((prev) => ({ ...prev, [f.key]: e.target.value }))}
                                    onBlur={(e) => {
                                      void saveCustomField(f.key, e.target.value);
                                    }}
                                    placeholder="-"
                                    className="h-7 mt-1 text-sm"
                                  />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {/* Account */}
                    <div>
                      <span className="text-muted-foreground">Account</span>
                      <p className="text-base font-semibold leading-tight">{item.account?.account_name || '-'}</p>
                    </div>
                    {/* Sidemark - inline editable with autocomplete */}
                    <div>
                      <span className="text-muted-foreground">Sidemark</span>
                      {isClientUser ? (
                        <p className="font-medium">{item.sidemark || '-'}</p>
                      ) : (
                        <AutocompleteInput
                          value={editSidemark}
                          onChange={setEditSidemark}
                          onBlur={() => {
                            if (editSidemark !== (item.sidemark || '')) {
                              handleSidemarkSave(editSidemark);
                            }
                          }}
                          suggestions={sidemarks.map(s => ({ value: s.sidemark }))}
                          placeholder="Add sidemark"
                          className="h-7 mt-1 text-sm border-transparent bg-transparent hover:bg-muted/50 focus:bg-background focus:border-input"
                        />
                      )}
                    </div>
                    {/* Room - inline editable with autocomplete */}
                    <div>
                      <span className="text-muted-foreground">Room</span>
                      {isClientUser ? (
                        <p className="font-medium">{item.room || '-'}</p>
                      ) : (
                        <AutocompleteInput
                          value={editRoom}
                          onChange={setEditRoom}
                          onBlur={() => {
                            if (editRoom !== (item.room || '')) {
                              handleRoomSave(editRoom);
                            }
                          }}
                          suggestions={rooms.map(r => ({ value: r.room }))}
                          placeholder="Add room"
                          className="h-7 mt-1 text-sm border-transparent bg-transparent hover:bg-muted/50 focus:bg-background focus:border-input"
                        />
                      )}
                    </div>
                    {/* Size */}
                    <div>
                      <span className="text-muted-foreground">Size</span>
                      <p className="font-medium">
                        {formatItemSize(item.size, item.size_unit)}
                      </p>
                    </div>
                    {item.link && (
                      <div className="col-span-2">
                        <span className="text-muted-foreground">Link</span>
                        <p className="font-medium">
                          <a
                            href={item.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline flex items-center gap-1"
                          >
                            {item.link.length > 40 ? item.link.substring(0, 40) + '...' : item.link}
                            <MaterialIcon name="open_in_new" size="sm" />
                          </a>
                        </p>
                      </div>
                    )}
                  </div>

                  <Separator />

                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Warehouse</span>
                      <p className="font-medium">{item.warehouse?.name || '-'}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Location</span>
                      <p className="font-medium flex items-center gap-1">
                        📍 {item.location?.code || item.location?.name || '-'}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Received</span>
                      <p className="font-medium">
                        {item.received_at
                          ? format(new Date(item.received_at), 'MMM d, yyyy')
                          : '-'}
                      </p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Created</span>
                      <p className="font-medium">
                        {format(new Date(item.created_at), 'MMM d, yyyy')}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Flags Card - Dynamic flags from pricing_flags table */}
              <ItemFlagsSection
                itemId={item.id}
                accountId={item.account_id || undefined}
                onFlagsChange={handleFlagsChange}
                isClientUser={isClientUser}
              />

              {/* Billing Events - Manager/Admin Only */}
              {canSeeBilling && (
                <ItemBillingEventsSection itemId={item.id} refreshKey={billingRefreshKey} />
              )}
            </div>

            {/* Inbound History - Original inbound shipment */}
            {item.receiving_shipment && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <span>🚚</span>
                    Inbound History
                  </CardTitle>
                  <CardDescription>
                    The inbound shipment this item was received on
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div
                    className="flex items-center justify-between p-3 border rounded-lg bg-muted/30 cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => navigate(`/shipments/${item.receiving_shipment!.id}`)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        navigate(`/shipments/${item.receiving_shipment!.id}`);
                      }
                    }}
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <StatusIndicator status="inbound" label="Inbound" size="sm" />
                        <span className="font-medium text-lg">{item.receiving_shipment.shipment_number}</span>
                      </div>
                      <StatusIndicator status={item.receiving_shipment.status} size="sm" />
                      {item.receiving_shipment.received_at && (
                        <span className="text-sm text-muted-foreground">
                          Received: {format(new Date(item.receiving_shipment.received_at), 'MMM d, yyyy')}
                        </span>
                      )}
                    </div>
                    <MaterialIcon name="open_in_new" size="sm" className="text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Tasks Card */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span>📝</span>
                  Tasks ({tasks.length})
                </CardTitle>
                <CardDescription>Tasks associated with this item</CardDescription>
              </CardHeader>
              <CardContent>
                {tasks.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">No tasks for this item</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Task</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Priority</TableHead>
                        <TableHead>Due Date</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {tasks.map((task) => (
                        <TableRow
                          key={task.id}
                          className="cursor-pointer hover:bg-muted/50"
                          onClick={() => navigate(`/tasks/${task.id}`)}
                        >
                          <TableCell className="font-medium">{task.title}</TableCell>
                          <TableCell>{task.task_type}</TableCell>
                          <TableCell>
                            <span className={
                              task.status === 'pending' ? 'font-bold text-orange-500 dark:text-orange-400' :
                              task.status === 'in_progress' ? 'font-bold text-yellow-500 dark:text-yellow-400' :
                              task.status === 'completed' ? 'font-bold text-green-500 dark:text-green-400' :
                              task.status === 'unable_to_complete' ? 'font-bold text-red-500 dark:text-red-400' :
                              'font-bold text-gray-500 dark:text-gray-400'
                            }>
                              {task.status.replace('_', ' ').toUpperCase()}
                            </span>
                          </TableCell>
                          <TableCell>
                            {task.priority === 'urgent' ? (
                              <span className="font-bold text-red-500 dark:text-red-400">URGENT</span>
                            ) : (
                              <span className="font-bold text-blue-500 dark:text-blue-400">NORMAL</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {task.due_date
                              ? format(new Date(task.due_date.substring(0, 10) + 'T12:00:00'), 'MMM d, yyyy')
                              : '-'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="photos" className="mt-6">
            <ItemPhotoGallery itemId={item.id} isClientUser={isClientUser} />
          </TabsContent>

          <TabsContent value="documents" className="mt-6">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <span>📄</span>
                    Documents
                  </CardTitle>
                  <CardDescription>
                    Scanned documents and files for this item
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <DocumentList
                  contextType="item"
                  contextId={item.id}
                  showSearch
                  canDelete={!isClientUser}
                />
                {/* Action button - centered at bottom */}
                {!isClientUser && (
                  <div className="flex justify-center mt-6 pt-4 border-t">
                    <ScanDocumentButton
                      context={{ type: 'item', itemId: item.id, description: item.description || undefined }}
                      onSuccess={() => {
                        toast({ title: 'Document saved' });
                      }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="notes" className="mt-6">
            <ItemNotesSection itemId={item.id} isClientUser={isClientUser} />
          </TabsContent>

          {!isClientUser && (
            <TabsContent value="coverage" className="mt-6">
              <CoverageSelector
                itemId={item.id}
                accountId={item.account_id}
                sidemarkId={item.sidemark_id}
                classId={item.class_id}
                currentCoverage={item.coverage_type as any}
                currentDeclaredValue={item.declared_value}
                currentWeight={item.weight_lbs}
                onUpdate={() => fetchItem()}
              />
            </TabsContent>
          )}

          {!isClientUser && (
            <TabsContent value="activity" className="mt-6">
              <ItemActivityFeed itemId={item.id} />
            </TabsContent>
          )}

          {item.needs_repair && (
            <TabsContent value="repair" className="mt-6">
              <RepairQuoteSection itemId={item.id} canApprove={!isClientUser} />
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* Split (grouped item) dialog */}
      <Dialog
        open={splitDialogOpen}
        onOpenChange={(open) => {
          if (splitCreating) return;
          setSplitDialogOpen(open);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="call_split" size="sm" />
              Split / Relabel
            </DialogTitle>
            <DialogDescription>
              Create a warehouse Split task for this grouped item. The parent label quantity will be reduced and new child labels will be created for the leftover units.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4">
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              <div className="font-medium">{item.item_code}</div>
              <div className="text-muted-foreground">Grouped quantity: {item.quantity}</div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Split qty (new labels)</div>
              <Input
                type="number"
                min={1}
                max={Math.max(1, (item.quantity || 1) - 1)}
                step={1}
                value={splitLeftoverQty}
                onChange={(e) => {
                  const grouped = typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? item.quantity : 1;
                  const raw = parseInt(e.target.value || '0', 10);
                  const next = Number.isFinite(raw) ? raw : 1;
                  const clamped = Math.max(1, Math.min(Math.max(1, grouped - 1), next));
                  setSplitLeftoverQty(clamped);
                }}
              />
              <p className="text-xs text-muted-foreground">
                Keep qty on parent: {Math.max(1, (item.quantity || 1) - Math.max(1, Math.min((item.quantity || 1) - 1, splitLeftoverQty)))} / {item.quantity}
              </p>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium">Notes (optional)</div>
              <Textarea
                value={splitRequestNotes}
                onChange={(e) => setSplitRequestNotes(e.target.value)}
                placeholder="Add any handling notes for the warehouse team…"
                rows={3}
              />
            </div>
          </DialogBody>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSplitDialogOpen(false)} disabled={splitCreating}>
              Cancel
            </Button>
            <Button onClick={handleCreateSplitTaskFromItem} disabled={splitCreating}>
              {splitCreating ? 'Creating…' : 'Create Split Task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TaskDialog
        open={taskDialogOpen}
        onOpenChange={setTaskDialogOpen}
        selectedItemIds={[item.id]}
        preSelectedTaskType={selectedTaskType}
        onSuccess={() => {
          setTaskDialogOpen(false);
          fetchTasks();
        }}
      />

      <ItemEditDialog
        open={editDialogOpen}
        onOpenChange={setEditDialogOpen}
        item={item}
        onSuccess={fetchItem}
      />

      <PrintLabelsDialog
        open={printDialogOpen}
        onOpenChange={setPrintDialogOpen}
        items={item ? [{
          id: item.id,
          itemCode: item.item_code,
          sku: item.sku || '',
          description: item.description || '',
          vendor: item.vendor || '',
          account: item.account?.account_name || '',
          sidemark: item.sidemark || '',
          room: item.room || '',
          warehouseName: item.warehouse?.name || '',
          locationCode: item.location?.code || '',
        }] : []}
      />

      <QuickReleaseDialog
        open={releaseDialogOpen}
        onOpenChange={setReleaseDialogOpen}
        selectedItems={item ? [{
          id: item.id,
          item_code: item.item_code,
          description: item.description,
          quantity: item.quantity,
          warehouse_id: item.warehouse?.id,
        }] : []}
        onSuccess={() => {
          setReleaseDialogOpen(false);
          fetchItem();
        }}
      />

      <AddBillingChargeDialog
        open={billingChargeDialogOpen}
        onOpenChange={setBillingChargeDialogOpen}
        itemId={item?.id || ''}
        itemCode={item?.item_code || ''}
        accountId={item?.account_id || null}
        sidemarkId={item?.sidemark_id || null}
        classId={item?.class_id || null}
        onSuccess={() => {
          setBillingChargeDialogOpen(false);
          setBillingRefreshKey(prev => prev + 1);
        }}
      />

      {/* Add Credit Dialog - Admin Only */}
      {item?.account_id && (
        <AddCreditDialog
          open={addCreditDialogOpen}
          onOpenChange={setAddCreditDialogOpen}
          accountId={item.account_id}
          accountName={item.account?.account_name}
          itemId={item.id}
          itemCode={item.item_code}
          sidemarkId={item.sidemark_id}
          classId={item.class_id}
          onSuccess={() => {
            setAddCreditDialogOpen(false);
            setBillingRefreshKey(prev => prev + 1);
          }}
        />
      )}

      <LinkToShipmentDialog
        open={linkShipmentDialogOpen}
        onOpenChange={setLinkShipmentDialogOpen}
        itemId={item?.id || ''}
        itemCode={item?.item_code || ''}
        onSuccess={() => {
          setLinkShipmentDialogOpen(false);
        }}
      />

      {item && (
        <ClaimCreateDialog
          open={claimDialogOpen}
          onOpenChange={setClaimDialogOpen}
          itemId={item.id}
          accountId={item.account_id || undefined}
          sidemarkId={item.sidemark_id || undefined}
        />
      )}

      {item && (
        <ReassignAccountDialog
          open={reassignDialogOpen}
          onOpenChange={setReassignDialogOpen}
          entityType="item"
          entityIds={[item.id]}
          currentAccountId={item.account_id}
          currentAccountName={item.account?.account_name}
          onSuccess={fetchItem}
        />
      )}
    </DashboardLayout>
  );
}
