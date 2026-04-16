import { useEffect, useState, useRef, useMemo, type ReactNode } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { TaskDialog } from '@/components/tasks/TaskDialog';
import { InventoryImportDialog } from '@/components/settings/InventoryImportDialog';
import { QuickReleaseDialog } from '@/components/inventory/QuickReleaseDialog';
import { PrintLabelsDialog } from '@/components/inventory/PrintLabelsDialog';
import { ClaimCreateDialog } from '@/components/claims/ClaimCreateDialog';
import { CreateManifestFromItemsDialog } from '@/components/inventory/CreateManifestFromItemsDialog';
import { AddItemDialog } from '@/components/inventory/AddItemDialog';
import { useWarehouses } from '@/hooks/useWarehouses';
import { useLocations } from '@/hooks/useLocations';
import { ItemLabelData } from '@/lib/labelGenerator';
import { useIsMobile } from '@/hooks/use-mobile';
import { format } from 'date-fns';
import { jsonToWorkbook, downloadWorkbook } from '@/lib/excelUtils';
import { ItemPreviewCard } from '@/components/items/ItemPreviewCard';
import { ItemColumnsPopover } from '@/components/items/ItemColumnsPopover';
import { ReassignAccountDialog } from '@/components/common/ReassignAccountDialog';
import { InlineEditableCell } from '@/components/inventory/InlineEditableCell';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useTenantPreferences } from '@/hooks/useTenantPreferences';
import { useItemDisplaySettingsForUser } from '@/hooks/useItemDisplaySettingsForUser';
import {
  type BuiltinItemColumnKey,
  type ItemColumnKey,
  getColumnLabel,
  getDefaultViewId,
  getViewById,
  getVisibleColumnsForView,
  parseCustomFieldColumnKey,
} from '@/lib/items/itemDisplaySettings';
import { formatItemSize } from '@/lib/items/formatItemSize';
import {
  MobileDataCard,
  MobileDataCardHeader,
  MobileDataCardTitle,
  MobileDataCardDescription,
  MobileDataCardContent,
} from '@/components/ui/mobile-data-card';
import { MultiSelect } from '@/components/ui/multi-select';
import { AccountSelect } from '@/components/ui/account-select';

interface Item {
  id: string;
  item_code: string;
  sku: string | null;
  description: string | null;
  status: string;
  quantity: number;
  size: number | null;
  size_unit: string | null;
  client_account: string | null;
  sidemark: string | null;
  vendor: string | null;
  room: string | null;
  location_id: string | null;
  location_code: string | null;
  location_name: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  account_id: string | null;
  received_at: string | null;
  primary_photo_url: string | null;
  metadata?: Record<string, unknown> | null;
  has_indicator_flags?: boolean;
}

type SortField =
  | 'item_code'
  | 'sku'
  | 'vendor'
  | 'description'
  | 'quantity'
  | 'size'
  | 'location_code'
  | 'client_account'
  | 'sidemark'
  | 'room'
  | 'received_at';
type SortDirection = 'asc' | 'desc' | null;

export default function Inventory() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());

  // Clear selection when filters change so hidden items can't remain selected
  useEffect(() => {
    setSelectedItems(new Set());
  }, [searchQuery, statusFilter, selectedLocationIds, selectedAccountId]);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [preSelectedTaskType, setPreSelectedTaskType] = useState<string>('');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [printLabelsDialogOpen, setPrintLabelsDialogOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [validationDialogOpen, setValidationDialogOpen] = useState(false);
  const [validationMessage, setValidationMessage] = useState('');
  const [releaseDialogOpen, setReleaseDialogOpen] = useState(false);
  const [claimDialogOpen, setClaimDialogOpen] = useState(false);
  const [manifestDialogOpen, setManifestDialogOpen] = useState(false);
  const [addItemDialogOpen, setAddItemDialogOpen] = useState(false);
  const [reassignDialogOpen, setReassignDialogOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const { warehouses } = useWarehouses();
  const { locations } = useLocations();
  const { toast } = useToast();
  const { profile } = useAuth();
  const { preferences } = useTenantPreferences();
  const showWarehouseInLocation = preferences?.show_warehouse_in_location ?? true;

  const locationOptions = useMemo(() => {
    return (locations || []).map((l) => ({
      value: l.id,
      label: `${l.code}${l.name ? ` (${l.name})` : ''}`,
    }));
  }, [locations]);

  const {
    settings: itemDisplaySettings,
    tenantSettings: tenantItemDisplaySettings,
    defaultViewId: defaultItemViewId,
    loading: itemDisplayLoading,
    saving: itemDisplaySaving,
    saveSettings: saveItemDisplaySettings,
  } = useItemDisplaySettingsForUser();
  const [activeViewId, setActiveViewId] = useState<string>('');

  useEffect(() => {
    if (!activeViewId && defaultItemViewId) {
      setActiveViewId(defaultItemViewId);
    }
  }, [defaultItemViewId, activeViewId]);

  const activeView = useMemo(() => {
    return (
      getViewById(itemDisplaySettings, activeViewId) ||
      getViewById(itemDisplaySettings, defaultItemViewId) ||
      itemDisplaySettings.views[0]
    );
  }, [itemDisplaySettings, activeViewId, defaultItemViewId]);

  const visibleColumns = useMemo(() => (activeView ? getVisibleColumnsForView(activeView) : []), [activeView]);

  // Compute unique suggestions for inline editing autocomplete
  const vendorSuggestions = useMemo(() => {
    const set = new Set<string>();
    items.forEach(item => { if (item.vendor) set.add(item.vendor); });
    return Array.from(set).sort();
  }, [items]);

  const descriptionSuggestions = useMemo(() => {
    const set = new Set<string>();
    items.forEach(item => { if (item.description) set.add(item.description); });
    return Array.from(set).sort();
  }, [items]);

  const sidemarkSuggestions = useMemo(() => {
    const set = new Set<string>();
    items.forEach(item => { if (item.sidemark) set.add(item.sidemark); });
    return Array.from(set).sort();
  }, [items]);

  const roomSuggestions = useMemo(() => {
    const set = new Set<string>();
    items.forEach(item => { if (item.room) set.add(item.room); });
    return Array.from(set).sort();
  }, [items]);

  // Handle inline field updates
  const handleInlineUpdate = async (
    itemId: string,
    field: 'quantity' | 'vendor' | 'sku' | 'description' | 'sidemark' | 'room',
    value: string
  ) => {
    // Convert to appropriate type for database
    const dbValue = field === 'quantity' ? parseInt(value, 10) || 0 : value;

    // Reject negative quantities
    if (field === 'quantity' && typeof dbValue === 'number' && dbValue < 0) {
      toast({ title: 'Invalid quantity', description: 'Quantity cannot be negative', variant: 'destructive' });
      return;
    }

    const { error } = await supabase
      .from('items')
      .update({ [field]: dbValue })
      .eq('id', itemId);
    if (error) {
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
      throw error;
    }
    // Update local state
    setItems(prev => prev.map(item =>
      item.id === itemId
        ? { ...item, [field]: field === 'quantity' ? (parseInt(value, 10) || 0) : value }
        : item
    ));
  };

  useEffect(() => {
    fetchItems();
  }, []);

  useEffect(() => {
    const statusParam = (searchParams.get('status') || '').trim();
    if (statusParam) {
      setStatusFilter(statusParam);
    }

    const rawLocationIds = (searchParams.get('location_ids') || '').trim();
    const rawSingleLocation = (searchParams.get('location_id') || searchParams.get('location') || '').trim();

    const rawValues = rawLocationIds
      ? rawLocationIds.split(',').map((v) => v.trim()).filter(Boolean)
      : rawSingleLocation
        ? [rawSingleLocation]
        : [];

    if (rawValues.length === 0) return;

    const resolved = rawValues.map((value) => {
      const byId = locations.find((l) => l.id === value);
      if (byId) return byId.id;
      const byCode = locations.find((l) => l.code.toLowerCase() === value.toLowerCase());
      if (byCode) return byCode.id;
      return value;
    });

    setSelectedLocationIds(Array.from(new Set(resolved)));
  }, [locations, searchParams]);

  const fetchItems = async () => {
    try {
      // Fetch from items table with proper joins to get account name
      const { data, error } = await (supabase
        .from('items') as any)
        .select(`
          id, item_code, sku, description, status, quantity, size, size_unit, client_account, sidemark, vendor, room, metadata,
          current_location_id, account_id, received_at, primary_photo_url, warehouse_id,
          location:locations!items_current_location_id_fkey(id, code, name),
          warehouse:warehouses!items_warehouse_id_fkey(id, name),
          account:accounts!items_account_id_fkey(id, account_name)
        `)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(500);

      if (error) throw error;

      // Transform data to match expected Item interface
      const transformedData: Item[] = (data || []).map((item: any) => ({
        id: item.id,
        item_code: item.item_code,
        sku: item.sku ?? null,
        description: item.description,
        status: item.status,
        quantity: item.quantity,
        size: item.size ?? null,
        size_unit: item.size_unit ?? null,
        // Use account name from joined accounts table, fallback to client_account text field
        client_account: item.account?.account_name || item.client_account,
        sidemark: item.sidemark,
        vendor: item.vendor,
        room: item.room,
        location_id: item.current_location_id,
        location_code: item.location?.code || null,
        location_name: item.location?.name || null,
        warehouse_id: item.warehouse_id,
        warehouse_name: item.warehouse?.name || null,
        account_id: item.account_id,
        received_at: item.received_at,
        primary_photo_url: item.primary_photo_url,
        metadata: item.metadata ?? null,
      }));

      // Batch-fetch indicator flags for displayed items
      const itemIds = transformedData.map(i => i.id);
      let flaggedItemIds = new Set<string>();
      if (itemIds.length > 0) {
        try {
          const { data: flagData } = await (supabase.from('item_flags') as any)
            .select('item_id')
            .in('item_id', itemIds);
          if (flagData) {
            flaggedItemIds = new Set<string>(flagData.map((f: any) => f.item_id));
          }
        } catch {
          // item_flags table may not exist yet — ignore gracefully
        }
      }

      setItems(transformedData.map(item => ({
        ...item,
        has_indicator_flags: flaggedItemIds.has(item.id),
      })));
    } catch (error) {
      console.error('Error fetching items:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredAndSortedItems = useMemo(() => {
    let result = items.filter((item) => {
      // Enhanced search - includes vendor, sidemark, description, item_code, SKU, client_account
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = !searchQuery ||
        item.item_code.toLowerCase().includes(searchLower) ||
        item.sku?.toLowerCase().includes(searchLower) ||
        item.description?.toLowerCase().includes(searchLower) ||
        item.client_account?.toLowerCase().includes(searchLower) ||
        item.sidemark?.toLowerCase().includes(searchLower) ||
        item.vendor?.toLowerCase().includes(searchLower) ||
        item.location_code?.toLowerCase().includes(searchLower) ||
        item.location_name?.toLowerCase().includes(searchLower);

      // Status filter
      let matchesStatus = true;
      if (statusFilter === 'active') {
        matchesStatus = item.status !== 'released' && item.status !== 'disposed';
      } else if (statusFilter !== 'all') {
        matchesStatus = item.status === statusFilter;
      }

      const matchesLocation =
        selectedLocationIds.length === 0 ||
        (!!item.location_id && selectedLocationIds.includes(item.location_id));

      const matchesAccount =
        !selectedAccountId ||
        item.account_id === selectedAccountId;

      return matchesSearch && matchesStatus && matchesLocation && matchesAccount;
    });

    // Sort
    if (sortField && sortDirection) {
      result = [...result].sort((a, b) => {
        const aVal = a[sortField] ?? '';
        const bVal = b[sortField] ?? '';
        const comparison = String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
        return sortDirection === 'asc' ? comparison : -comparison;
      });
    }

    return result;
  }, [items, searchQuery, statusFilter, selectedLocationIds, selectedAccountId, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      if (sortDirection === 'asc') setSortDirection('desc');
      else if (sortDirection === 'desc') { setSortField(null); setSortDirection(null); }
      else setSortDirection('asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return null;
    return <MaterialIcon name={sortDirection === 'asc' ? 'expand_less' : 'expand_more'} size="sm" />;
  };

  type ColumnDef = {
    sortField?: SortField;
    headClassName?: string;
    cellClassName?: string;
    /** Stops row navigation click when interacting with cell content */
    stopPropagation?: boolean;
    /** Renders the body cell content */
    renderCell: (item: Item) => ReactNode;
    /** Header label container class (for align) */
    headLabelClassName?: string;
  };

  const customFieldDefsByKey = useMemo(() => {
    const map = new Map<string, { type: string }>();
    itemDisplaySettings.custom_fields.forEach((f) => {
      map.set(f.key, { type: f.type });
    });
    return map;
  }, [itemDisplaySettings.custom_fields]);

  const getCustomFieldValue = (item: Item, fieldKey: string): string | number | null => {
    const meta = item.metadata;
    if (!meta || typeof meta !== 'object') return null;
    const custom = (meta as any).custom_fields;
    if (!custom || typeof custom !== 'object') return null;
    const val = (custom as any)[fieldKey];
    if (val === undefined || val === null || val === '') return null;
    if (typeof val === 'string' || typeof val === 'number') return val;
    if (typeof val === 'boolean') return val ? 'Yes' : 'No';
    return String(val);
  };

  const customFieldSaveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const saveCustomFieldValue = async (itemId: string, fieldKey: string, rawValue: string): Promise<void> => {
    const timerKey = `${itemId}:${fieldKey}`;

    // Clear any pending save for this item+field
    if (customFieldSaveTimers.current[timerKey]) {
      clearTimeout(customFieldSaveTimers.current[timerKey]);
    }

    return new Promise<void>((resolve, reject) => {
      customFieldSaveTimers.current[timerKey] = setTimeout(async () => {
        delete customFieldSaveTimers.current[timerKey];
        try {
          const item = items.find((i) => i.id === itemId);
          const existingMeta = (item?.metadata && typeof item.metadata === 'object') ? (item.metadata as Record<string, unknown>) : {};

          const existingCustom =
            (existingMeta as any).custom_fields && typeof (existingMeta as any).custom_fields === 'object'
              ? { ...(existingMeta as any).custom_fields }
              : {};

          const fieldType = customFieldDefsByKey.get(fieldKey)?.type || 'text';
          const trimmed = rawValue.trim();

          let nextValue: unknown = trimmed;
          if (!trimmed) {
            nextValue = null;
          } else if (fieldType === 'number') {
            const n = Number(trimmed);
            nextValue = Number.isFinite(n) ? n : null;
          } else if (fieldType === 'checkbox') {
            const normalized = trimmed.toLowerCase();
            nextValue = ['true', 'yes', 'y', '1', 'checked'].includes(normalized);
          }

          if (nextValue === null) {
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

          const { error } = await (supabase.from('items') as any)
            .update({ metadata: nextMeta })
            .eq('id', itemId);

          if (error) {
            toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
            reject(error);
            return;
          }

          setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, metadata: nextMeta } : i)));
          resolve();
        } catch (err) {
          reject(err);
        }
      }, 300);
    });
  };

  const builtinColumnDefs: Record<BuiltinItemColumnKey, ColumnDef> = {
    photo: {
      headClassName: 'w-12',
      stopPropagation: true,
      renderCell: (item) => (
        <ItemPreviewCard itemId={item.id}>
          {item.primary_photo_url ? (
            <img src={item.primary_photo_url} alt={item.item_code} className="h-8 w-8 rounded object-cover cursor-pointer" />
          ) : (
            <div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-sm">📦</div>
          )}
        </ItemPreviewCard>
      ),
    },
    item_code: {
      sortField: 'item_code',
      renderCell: (item) => (
        <ItemPreviewCard itemId={item.id}>
          <span
            className="text-primary hover:underline cursor-pointer inline-flex items-center gap-1"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/inventory/${item.id}`);
            }}
          >
            {item.has_indicator_flags && <span title="Has indicator flags">{'\u26A0\uFE0F'}</span>}
            {item.item_code}
          </span>
        </ItemPreviewCard>
      ),
      cellClassName: 'font-medium',
    },
    sku: {
      sortField: 'sku',
      stopPropagation: true,
      renderCell: (item) => (
        <InlineEditableCell
          value={item.sku}
          onSave={(val) => handleInlineUpdate(item.id, 'sku', val)}
          placeholder="-"
          showEditIcon={false}
        />
      ),
    },
    quantity: {
      sortField: 'quantity',
      headClassName: 'text-right',
      headLabelClassName: 'flex items-center justify-end gap-1',
      cellClassName: 'text-right',
      stopPropagation: true,
      renderCell: (item) => (
        <InlineEditableCell
          value={item.quantity}
          type="number"
          onSave={(val) => handleInlineUpdate(item.id, 'quantity', val)}
          placeholder="0"
          align="right"
          showEditIcon={false}
        />
      ),
    },
    size: {
      sortField: 'size',
      headClassName: 'text-right',
      headLabelClassName: 'flex items-center justify-end gap-1',
      cellClassName: 'text-right tabular-nums',
      renderCell: (item) => <span className="text-sm">{formatItemSize(item.size, item.size_unit)}</span>,
    },
    vendor: {
      sortField: 'vendor',
      stopPropagation: true,
      renderCell: (item) => (
        <InlineEditableCell
          value={item.vendor}
          suggestions={vendorSuggestions}
          onSave={(val) => handleInlineUpdate(item.id, 'vendor', val)}
          placeholder="-"
          showEditIcon={false}
        />
      ),
    },
    description: {
      sortField: 'description',
      stopPropagation: true,
      renderCell: (item) => (
        <InlineEditableCell
          value={item.description}
          suggestions={descriptionSuggestions}
          onSave={(val) => handleInlineUpdate(item.id, 'description', val)}
          placeholder="-"
          className="max-w-[200px]"
          showEditIcon={false}
        />
      ),
    },
    location: {
      sortField: 'location_code',
      renderCell: (item) =>
        item.location_code ? (
          <span className="text-sm">
            {item.location_code}
            {showWarehouseInLocation && item.warehouse_name && <span className="text-muted-foreground ml-1">({item.warehouse_name})</span>}
          </span>
        ) : (
          '-'
        ),
    },
    client_account: {
      sortField: 'client_account',
      renderCell: (item) => item.client_account || '-',
    },
    sidemark: {
      sortField: 'sidemark',
      stopPropagation: true,
      renderCell: (item) => (
        <InlineEditableCell
          value={item.sidemark}
          suggestions={sidemarkSuggestions}
          onSave={(val) => handleInlineUpdate(item.id, 'sidemark', val)}
          placeholder="-"
          showEditIcon={false}
        />
      ),
    },
    room: {
      sortField: 'room',
      stopPropagation: true,
      renderCell: (item) => (
        <InlineEditableCell
          value={item.room}
          suggestions={roomSuggestions}
          onSave={(val) => handleInlineUpdate(item.id, 'room', val)}
          placeholder="-"
          showEditIcon={false}
        />
      ),
    },
    class: {
      sortField: undefined,
      renderCell: (item) => (item as any).class_name || '-',
    },
    received_date: {
      sortField: 'received_at',
      renderCell: (item) =>
        item.received_at ? format(new Date(item.received_at), 'MMM d, yyyy') : '-',
    },
  };

  const getColumnDef = (key: ItemColumnKey): ColumnDef => {
    const cfKey = parseCustomFieldColumnKey(key);
    if (cfKey) {
      const fieldType = customFieldDefsByKey.get(cfKey)?.type || 'text';
      return {
        stopPropagation: true,
        sortField: undefined,
        renderCell: (item) => (
          <InlineEditableCell
            value={getCustomFieldValue(item, cfKey)}
            type={fieldType === 'number' ? 'number' : 'text'}
            onSave={(val) => saveCustomFieldValue(item.id, cfKey, val)}
            placeholder="-"
            showEditIcon={false}
          />
        ),
      };
    }

    return builtinColumnDefs[key as BuiltinItemColumnKey];
  };

  const renderTableHead = (key: ItemColumnKey) => {
    const def = getColumnDef(key);
    const isSortable = !!def.sortField;

    const labelWrapClass =
      def.headLabelClassName || (def.headClassName?.includes('text-right') ? 'flex items-center justify-end gap-1' : 'flex items-center gap-1');

    return (
      <TableHead
        key={key}
        className={[
          def.headClassName,
          isSortable ? 'cursor-pointer hover:bg-muted/50' : null,
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={isSortable ? () => handleSort(def.sortField as SortField) : undefined}
      >
        <div className={labelWrapClass}>
          {getColumnLabel(itemDisplaySettings, key)}
          {def.sortField && <SortIcon field={def.sortField} />}
        </div>
      </TableHead>
    );
  };

  const renderTableCell = (key: ItemColumnKey, item: Item) => {
    const def = getColumnDef(key);
    return (
      <TableCell
        key={key}
        className={def.cellClassName}
        onClick={
          def.stopPropagation
            ? (e) => {
                e.stopPropagation();
              }
            : undefined
        }
      >
        {def.renderCell(item)}
      </TableCell>
    );
  };

  const toggleItemSelection = (itemId: string) => {
    // Only allow toggling visible (filtered) items
    const visibleIds = new Set(filteredAndSortedItems.map(i => i.id));
    if (!visibleIds.has(itemId)) return;
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemId)) newSelected.delete(itemId);
    else newSelected.add(itemId);
    setSelectedItems(newSelected);
  };

  const toggleSelectAll = () => {
    if (selectedItems.size === filteredAndSortedItems.length) setSelectedItems(new Set());
    else setSelectedItems(new Set(filteredAndSortedItems.map(item => item.id)));
  };

  const getSelectedItemsData = () => items.filter(item => selectedItems.has(item.id)).map(item => ({
    id: item.id, item_code: item.item_code, description: item.description, quantity: item.quantity, client_account: item.client_account, account_id: item.account_id, warehouse_id: item.warehouse_id,
  }));

  const getSelectedItemsAccounts = () => new Set(items.filter(item => selectedItems.has(item.id)).map(item => item.client_account).filter(Boolean));
  const getSelectedItemsWarehouses = () => new Set(items.filter(item => selectedItems.has(item.id)).map(item => item.warehouse_id).filter(Boolean));
  const hasMultipleAccounts = getSelectedItemsAccounts().size > 1;
  const hasMultipleWarehouses = getSelectedItemsWarehouses().size > 1;

  const getSelectedItemsForLabels = (): ItemLabelData[] => items.filter(item => selectedItems.has(item.id)).map(item => ({
    id: item.id,
    itemCode: item.item_code,
    sku: item.sku || '',
    description: item.description || '',
    vendor: item.vendor || '',
    account: item.client_account || '',
    sidemark: item.sidemark || '',
    room: item.room || '',
    warehouseName: item.warehouse_name || '',
    locationCode: item.location_code || '',
  }));

  const handleExportExcel = async () => {
    const selectedData = items.filter(item => selectedItems.has(item.id)).map(item => ({
      'Item Code': item.item_code,
      'SKU': item.sku || '',
      'Vendor': item.vendor || '',
      'Description': item.description || '',
      'Qty': item.quantity,
      'Location': item.location_code || '',
      'Client': item.client_account || '',
      'Sidemark': item.sidemark || '',
      'Room': item.room || '',
    }));
    const { workbook } = jsonToWorkbook(selectedData, 'Inventory');
    await downloadWorkbook(workbook, `inventory-export-${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
  };

  const handleTaskSuccess = (createdTaskId?: string) => { 
    setSelectedItems(new Set()); 
    setPreSelectedTaskType(''); 
    if (createdTaskId) {
      navigate(`/tasks/${createdTaskId}`);
    } else {
      fetchItems(); 
    }
  };
  const handleReleaseSuccess = () => { setSelectedItems(new Set()); fetchItems(); };
  const handleImportClick = () => { fileInputRef.current?.click(); };
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) { setImportFile(file); setImportDialogOpen(true); } e.target.value = ''; };
  const handleImportSuccess = () => { setImportDialogOpen(false); setImportFile(null); fetchItems(); };

  return (
    <DashboardLayout>
      <input type="file" ref={fileInputRef} onChange={handleFileChange} accept=".xlsx,.xls,.csv" className="hidden" />
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <PageHeader primaryText="Inventory" accentText="" description="Manage and track all items in your warehouse" />
          <div className="flex items-center gap-2 flex-wrap">
            {selectedItems.size > 0 && (
              <>
                <Button variant="outline" onClick={() => { if (hasMultipleAccounts) { setValidationMessage('Cannot create a task for items from different accounts.'); setValidationDialogOpen(true); return; } if (hasMultipleWarehouses) { setValidationMessage('Cannot create a task for items in different warehouses.'); setValidationDialogOpen(true); return; } setTaskDialogOpen(true); }}><MaterialIcon name="assignment" size="sm" className="mr-2" />Task ({selectedItems.size})</Button>
                <Button variant="outline" onClick={() => { if (hasMultipleAccounts) { setValidationMessage('Cannot create an outbound shipment for items from different accounts.'); setValidationDialogOpen(true); return; } const firstItem = items.find(i => selectedItems.has(i.id)); navigate('/shipments/outbound/new', { state: { itemIds: Array.from(selectedItems), accountId: firstItem?.account_id } }); }}><MaterialIcon name="local_shipping" size="sm" className="mr-2" />Outbound</Button>
                <Button variant="outline" onClick={() => { if (hasMultipleAccounts) { setValidationMessage('Cannot create a disposal for items from different accounts.'); setValidationDialogOpen(true); return; } setPreSelectedTaskType('Disposal'); setTaskDialogOpen(true); }}><MaterialIcon name="delete" size="sm" className="mr-2" />Dispose</Button>
                <Button variant="outline" onClick={() => { if (hasMultipleAccounts) { setValidationMessage('Cannot create a claim for items from different accounts.'); setValidationDialogOpen(true); return; } setClaimDialogOpen(true); }}><MaterialIcon name="report_problem" size="sm" className="mr-2" />Claim</Button>
                <Button variant="outline" onClick={() => setManifestDialogOpen(true)}><MaterialIcon name="list_alt" size="sm" className="mr-2" />Manifest</Button>
                <Button variant="outline" onClick={() => setReassignDialogOpen(true)}><MaterialIcon name="swap_horiz" size="sm" className="mr-2" />Reassign</Button>
                <Button variant="outline" onClick={() => setPrintLabelsDialogOpen(true)}><MaterialIcon name="print" size="sm" className="mr-2" />Print</Button>
                <Button variant="outline" onClick={handleExportExcel}><MaterialIcon name="download" size="sm" className="mr-2" />Export</Button>
                <Button variant="default" onClick={() => setReleaseDialogOpen(true)}><MaterialIcon name="package_2" size="sm" className="mr-2" />Release</Button>
              </>
            )}
            <Button variant="secondary" onClick={handleImportClick}><MaterialIcon name="upload" size="sm" className="mr-2" />Import</Button>
            <Button onClick={() => setAddItemDialogOpen(true)}><MaterialIcon name="add_box" size="sm" className="mr-2" />Add Item</Button>
          </div>
        </div>

        <Card>
          <CardHeader><CardTitle>Items</CardTitle><CardDescription>{filteredAndSortedItems.length} items found{selectedItems.size > 0 && ` • ${selectedItems.size} selected`}</CardDescription></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:flex sm:flex-row sm:flex-wrap sm:items-center mb-6">
              <div className="relative col-span-2 sm:flex-1">
                <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search item code, SKU, description, vendor, sidemark, client..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-9" />
              </div>
              <div className="col-span-2 sm:col-span-auto sm:w-64">
                <MultiSelect
                  options={locationOptions}
                  selected={selectedLocationIds}
                  onChange={setSelectedLocationIds}
                  placeholder="All locations"
                  emptyMessage="No locations found."
                />
              </div>
              <div className="col-span-1 sm:col-span-auto sm:w-52">
                <AccountSelect
                  value={selectedAccountId || null}
                  onChange={(v) => setSelectedAccountId(v)}
                  placeholder="All accounts"
                  clearable
                  className="w-full"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="released">Released</SelectItem>
                  <SelectItem value="disposed">Disposed</SelectItem>
                </SelectContent>
              </Select>
              <div className="col-span-2 flex w-full gap-2 sm:col-span-auto sm:w-auto">
                {/* Hide the "Default" view selector when there's only one view */}
                {itemDisplaySettings.views.length > 1 && (
                  <Select
                    value={activeViewId || defaultItemViewId || 'default'}
                    onValueChange={setActiveViewId}
                    disabled={itemDisplayLoading || itemDisplaySettings.views.length === 0}
                  >
                    <SelectTrigger className="flex-1 sm:w-44">
                      <div className="flex items-center gap-2">
                        <MaterialIcon name="view_list" size="sm" className="text-muted-foreground" />
                        <SelectValue placeholder="View" />
                      </div>
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
                )}

                <ItemColumnsPopover
                  settings={itemDisplaySettings}
                  baseSettings={tenantItemDisplaySettings}
                  viewId={activeViewId || defaultItemViewId || 'default'}
                  disabled={itemDisplayLoading || itemDisplaySaving || itemDisplaySettings.views.length === 0}
                  onSave={saveItemDisplaySettings}
                />
              </div>
            </div>

            {loading ? (<div className="flex items-center justify-center h-48"><MaterialIcon name="progress_activity" size="xl" className="animate-spin text-muted-foreground" /></div>
            ) : filteredAndSortedItems.length === 0 ? (<div className="text-center py-12"><MaterialIcon name="inventory_2" size="xl" className="mx-auto text-muted-foreground" /><h3 className="mt-4 text-lg font-semibold">No items found</h3><p className="text-muted-foreground">{searchQuery || statusFilter !== 'all' ? 'Try adjusting your search or filters' : 'Get started by adding your first item'}</p></div>
            ) : isMobile ? (
              <div className="space-y-3">
                {filteredAndSortedItems.map((item) => (
                  <MobileDataCard
                    key={item.id}
                    onClick={() => navigate(`/inventory/${item.id}`)}
                    selected={selectedItems.has(item.id)}
                  >
                    <MobileDataCardHeader>
                      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selectedItems.has(item.id)}
                          onCheckedChange={() => toggleItemSelection(item.id)}
                          className="h-5 w-5"
                        />
                        <div className="flex-1 min-w-0">
                          <MobileDataCardTitle>
                            {item.has_indicator_flags && <span>{'\u26A0\uFE0F'} </span>}
                            {item.item_code}
                          </MobileDataCardTitle>
                          <MobileDataCardDescription className="truncate">{item.description || '-'}</MobileDataCardDescription>
                        </div>
                      </div>
                    </MobileDataCardHeader>
                    <MobileDataCardContent>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Qty:</span>
                          <span className="font-medium">{item.quantity}</span>
                        </div>
                        {visibleColumns.includes('size') && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Size:</span>
                            <span className="truncate ml-1">{formatItemSize(item.size, item.size_unit)}</span>
                          </div>
                        )}
                        {visibleColumns.includes('sku') && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">SKU:</span>
                            <span className="truncate ml-1">{item.sku || '-'}</span>
                          </div>
                        )}
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Vendor:</span>
                          <span className="truncate ml-1">{item.vendor || '-'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Account:</span>
                          <span className="truncate ml-1">{item.client_account || '-'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Sidemark:</span>
                          <span className="truncate ml-1">{item.sidemark || '-'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Room:</span>
                          <span className="truncate ml-1">{item.room || '-'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Location:</span>
                          <span className="truncate ml-1">{item.location_code || '-'}</span>
                        </div>
                      </div>
                    </MobileDataCardContent>
                  </MobileDataCard>
                ))}
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="w-10"><Checkbox checked={selectedItems.size === filteredAndSortedItems.length && filteredAndSortedItems.length > 0} onCheckedChange={toggleSelectAll} className="h-3.5 w-3.5" /></TableHead>
                    {visibleColumns.map(renderTableHead)}
                  </TableRow></TableHeader>
                  <TableBody>{filteredAndSortedItems.map((item) => (
                    <TableRow key={item.id} className={`cursor-pointer hover:bg-muted/50 ${selectedItems.has(item.id) ? 'bg-muted/30' : ''}`} onClick={() => navigate(`/inventory/${item.id}`)}>
                      <TableCell onClick={(e) => e.stopPropagation()}><Checkbox checked={selectedItems.has(item.id)} onCheckedChange={() => toggleItemSelection(item.id)} className="h-3.5 w-3.5" /></TableCell>
                      {visibleColumns.map((key) => renderTableCell(key, item))}
                    </TableRow>
                  ))}</TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <TaskDialog open={taskDialogOpen} onOpenChange={(open) => { setTaskDialogOpen(open); if (!open) setPreSelectedTaskType(''); }} selectedItemIds={Array.from(selectedItems)} preSelectedTaskType={preSelectedTaskType} onSuccess={handleTaskSuccess} />
      <InventoryImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        file={importFile}
        warehouses={warehouses}
        locations={locations}
        itemDisplaySettings={itemDisplaySettings}
        itemDisplayViewId={activeViewId || defaultItemViewId || 'default'}
        onSuccess={handleImportSuccess}
      />
      <PrintLabelsDialog open={printLabelsDialogOpen} onOpenChange={setPrintLabelsDialogOpen} items={getSelectedItemsForLabels()} />
      <QuickReleaseDialog open={releaseDialogOpen} onOpenChange={setReleaseDialogOpen} selectedItems={getSelectedItemsData()} onSuccess={handleReleaseSuccess} />
      <ClaimCreateDialog open={claimDialogOpen} onOpenChange={(open) => { setClaimDialogOpen(open); if (!open) setSelectedItems(new Set()); }} itemIds={Array.from(selectedItems)} />
      <CreateManifestFromItemsDialog
        open={manifestDialogOpen}
        onOpenChange={(open) => { setManifestDialogOpen(open); if (!open) setSelectedItems(new Set()); }}
        selectedItems={getSelectedItemsData()}
        onSuccess={() => { setSelectedItems(new Set()); fetchItems(); }}
      />
      <AddItemDialog
        open={addItemDialogOpen}
        onOpenChange={setAddItemDialogOpen}
        onSuccess={fetchItems}
      />
      <ReassignAccountDialog
        open={reassignDialogOpen}
        onOpenChange={(open) => { setReassignDialogOpen(open); if (!open) setSelectedItems(new Set()); }}
        entityType="items"
        entityIds={Array.from(selectedItems)}
        onSuccess={() => { setSelectedItems(new Set()); fetchItems(); }}
      />
      <AlertDialog open={validationDialogOpen} onOpenChange={setValidationDialogOpen}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle className="flex items-center gap-2"><MaterialIcon name="warning" size="md" className="text-destructive" />Cannot Proceed</AlertDialogTitle><AlertDialogDescription>{validationMessage}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogAction onClick={() => setValidationDialogOpen(false)}>OK</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </DashboardLayout>
  );
}
