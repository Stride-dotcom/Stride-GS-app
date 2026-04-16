import { Fragment, useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
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
import { AutocompleteInput } from '@/components/ui/autocomplete-input';
import { SidemarkSelect } from '@/components/ui/sidemark-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useClasses } from '@/hooks/useClasses';
import { useServiceEvents } from '@/hooks/useServiceEvents';
import { useLocations } from '@/hooks/useLocations';
import { useUnidentifiedAccount } from '@/hooks/useUnidentifiedAccount';
import { useFieldSuggestions } from '@/hooks/useFieldSuggestions';
import { AutosaveIndicator } from '@/components/receiving/AutosaveIndicator';
import type { AutosaveStatus } from '@/hooks/useReceivingAutosave';
import { MATCHING_DISCREPANCY_CODES, SHIPMENT_EXCEPTION_CODE_META, type ShipmentExceptionCode } from '@/hooks/useShipmentExceptions';
import { supabase } from '@/integrations/supabase/client';
import { logActivity } from '@/lib/activity/logActivity';
import { queueUnidentifiedIntakeCompletedAlert } from '@/lib/alertQueue';
import { BUILTIN_ITEM_EXCEPTION_FLAGS } from '@/lib/items/builtinItemExceptionFlags';
import { calculateShipmentBillingPreview } from '@/lib/billing/billingCalculation';
import { mergeServiceTimeSnapshot, mergeServiceTimeActualSnapshot } from '@/lib/time/serviceTimeSnapshot';
import { minutesBetweenIso } from '@/lib/time/minutesBetweenIso';
import { promptResumePausedTask } from '@/lib/time/promptResumePausedTask';
import { timerEndJob } from '@/lib/time/timerClient';
import { AddFromManifestSelector } from './AddFromManifestSelector';
import { ShipmentExceptionBadge } from '@/components/shipments/ShipmentExceptionBadge';
import { JobTimerWidget } from '@/components/time/JobTimerWidget';
import { useSelectedWarehouse } from '@/contexts/WarehouseContext';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface ReceivedItem {
  id: string;
  shipment_item_id?: string;
  item_id?: string | null;
  item_code: string;
  location_id?: string | null;
  description: string;
  expected_quantity: number;
  received_quantity: number;
  vendor: string;
  sidemark_id?: string | null;
  sidemark: string;
  room: string;
  class_id: string | null;
  flags: string[];
  sourceType: 'manual' | 'manifest';
  sourceShipmentItemId?: string;
  allocationId?: string;
  packages: number; // 0 = no container, 1 = single, 2+ = multi-package
}

const ARRIVAL_NO_ID_FLAG = 'ARRIVAL_NO_ID';

type Stage2ColumnKey = 'code' | 'qty' | 'location' | 'vendor' | 'description' | 'class' | 'sidemark' | 'room';

const STAGE2_COLUMNS: Array<{ key: Stage2ColumnKey; label: string; headClassName?: string }> = [
  { key: 'code', label: 'Item Code', headClassName: 'min-w-[100px] max-w-[130px]' },
  { key: 'qty', label: 'Qty', headClassName: 'w-16 text-right' },
  { key: 'location', label: 'Location', headClassName: 'min-w-[100px] max-w-[140px]' },
  { key: 'vendor', label: 'Vendor', headClassName: 'min-w-[100px] max-w-[140px]' },
  { key: 'description', label: 'Description', headClassName: 'min-w-[130px]' },
  { key: 'class', label: 'Class', headClassName: 'min-w-[100px] max-w-[140px]' },
  { key: 'sidemark', label: 'Side Mark', headClassName: 'min-w-[90px] max-w-[130px]' },
  { key: 'room', label: 'Room', headClassName: 'min-w-[80px] max-w-[120px]' },
];

const DEFAULT_STAGE2_COLUMN_ORDER: Stage2ColumnKey[] = STAGE2_COLUMNS.map((c) => c.key);

function isShipmentNotesSchemaCacheError(err: unknown): boolean {
  const message =
    typeof err === 'string'
      ? err
      : (err as { message?: string; details?: string } | null)?.message ||
        (err as { details?: string } | null)?.details ||
        '';
  const lower = message.toLowerCase();
  return lower.includes('shipment_notes') && (
    lower.includes('schema cache') ||
    lower.includes('could not find table') ||
    lower.includes('does not exist')
  );
}

function SortableStage2ColumnRow({
  columnKey,
  label,
  visible,
  onToggleVisible,
}: {
  columnKey: Stage2ColumnKey;
  label: string;
  visible: boolean;
  onToggleVisible: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: columnKey,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 rounded-md border px-2 py-1.5 bg-background"
    >
      <button
        type="button"
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
      >
        <MaterialIcon name="drag_indicator" size="sm" />
      </button>

      <Checkbox
        checked={visible}
        onCheckedChange={onToggleVisible}
        className="h-4 w-4"
        aria-label={visible ? `Hide ${label}` : `Show ${label}`}
      />

      <div className="flex-1 min-w-0">
        <div className="text-sm truncate">{label}</div>
      </div>
    </div>
  );
}

export interface ItemMatchingParams {
  itemDescription: string | null;
  itemVendor: string | null;
  itemSku?: string | null;
}

interface Stage2DetailedReceivingProps {
  shipmentId: string;
  shipmentNumber: string;
  shipment: {
    account_id: string | null;
    warehouse_id: string | null;
    signed_pieces: number | null;
    received_pieces: number | null;
    vendor_name: string | null;
    sidemark_id: string | null;
    shipment_exception_type?: string | null;
  };
  /** Optional live Dock Count (from Stage 1 edits while Stage 2 is open) */
  dockCount?: number | null;
  onComplete: () => void;
  onRefresh: () => void;
  /** Called when item details change to refine matching panel candidates */
  onItemMatchingParamsChange?: (params: ItemMatchingParams) => void;
  /** Called whenever Stage 2 row count changes (Entry Count) */
  onEntryCountChange?: (count: number) => void;
  onOpenExceptions?: () => void;
  /** Navigate to Notes tab (used for exception-note enforcement). */
  onOpenNotes?: () => void;
  /** Bump Stage 1 BillingCalculator refresh (preview updates as items autosave). */
  onBillingRefresh?: () => void;
  /** Render in read-only mode (view-only). */
  readOnly?: boolean;
  /** Show the Stage 2 completion flow/button. */
  showCompleteButton?: boolean;
  /** When true, suppress the header card (parent provides its own header/status). */
  hideHeader?: boolean;
}

export function Stage2DetailedReceiving({
  shipmentId,
  shipmentNumber,
  shipment,
  dockCount: dockCountOverride,
  onComplete,
  onRefresh,
  onItemMatchingParamsChange,
  onEntryCountChange,
  onOpenExceptions,
  onOpenNotes,
  onBillingRefresh,
  readOnly = false,
  showCompleteButton = true,
  hideHeader = false,
}: Stage2DetailedReceivingProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { isAdmin } = usePermissions();
  const { ensureUnidentifiedAccount } = useUnidentifiedAccount();
  const { selectedWarehouseId } = useSelectedWarehouse();
  const canEdit = !readOnly;

  // Items
  const [items, setItems] = useState<ReceivedItem[]>([]);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const entryCount = items.length;
  const dockCount = dockCountOverride ?? shipment.received_pieces ?? null;
  const { classes, loading: classesLoading } = useClasses();
  const { flagServiceEvents, loading: flagServicesLoading } = useServiceEvents();
  const { locations: allLocations } = useLocations(shipment.warehouse_id || undefined);
  const { suggestions: vendorSuggestions, addOrUpdateSuggestion: addVendorSuggestion } = useFieldSuggestions('vendor');
  const { suggestions: descriptionSuggestions, addOrUpdateSuggestion: addDescriptionSuggestion } = useFieldSuggestions('description');
  const { suggestions: roomSuggestions, addOrUpdateSuggestion: addRoomSuggestion } = useFieldSuggestions('room');

  // Receiving location for item records finalized on Stage 2 completion.
  // We auto-resolve this early (so it's set while entering items), but allow manual override.
  const [receivingLocationId, setReceivingLocationId] = useState<string | null>(null);
  const userOverrodeReceivingLocationRef = useRef(false);
  const [needsReceivingLocation, setNeedsReceivingLocation] = useState(false);

  // Table columns: show/hide + reorder (local UI only)
  const [columnOrder, setColumnOrder] = useState<Stage2ColumnKey[]>(DEFAULT_STAGE2_COLUMN_ORDER);
  const [hiddenColumns, setHiddenColumns] = useState<Stage2ColumnKey[]>([]);
  const visibleColumns = useMemo(
    () => columnOrder.filter((k) => !hiddenColumns.includes(k)),
    [columnOrder, hiddenColumns]
  );
  const [columnsPopoverOpen, setColumnsPopoverOpen] = useState(false);
  const [draftColumnOrder, setDraftColumnOrder] = useState<Stage2ColumnKey[]>(DEFAULT_STAGE2_COLUMN_ORDER);
  const [draftHiddenColumns, setDraftHiddenColumns] = useState<Stage2ColumnKey[]>([]);
  const vendorSuggestionOptions = useMemo(
    () => vendorSuggestions.map((s) => ({ value: s.value })),
    [vendorSuggestions]
  );
  const descriptionSuggestionOptions = useMemo(
    () => descriptionSuggestions.map((s) => ({ value: s.value })),
    [descriptionSuggestions]
  );
  const roomSuggestionOptions = useMemo(
    () => roomSuggestions.map((s) => ({ value: s.value })),
    [roomSuggestions]
  );

  useEffect(() => {
    if (!columnsPopoverOpen) return;
    setDraftColumnOrder(columnOrder);
    setDraftHiddenColumns(hiddenColumns);
  }, [columnsPopoverOpen, columnOrder, hiddenColumns]);

  const columnSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleColumnDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setDraftColumnOrder((items) => {
      const oldIndex = items.indexOf(active.id as Stage2ColumnKey);
      const newIndex = items.indexOf(over.id as Stage2ColumnKey);
      if (oldIndex === -1 || newIndex === -1) return items;
      return arrayMove(items, oldIndex, newIndex);
    });
  };

  const toggleDraftColumnVisible = (key: Stage2ColumnKey) => {
    setDraftHiddenColumns((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleColumnsPopoverOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setColumnsPopoverOpen(true);
      return;
    }
    // Closing: persist draft settings into the table.
    setColumnOrder(draftColumnOrder);
    setHiddenColumns(draftHiddenColumns);
    setColumnsPopoverOpen(false);
  };

  const handleResetColumns = () => {
    setDraftColumnOrder(DEFAULT_STAGE2_COLUMN_ORDER);
    setDraftHiddenColumns([]);
  };

  // Emit Entry Count (row count) for Stage 1 display.
  useEffect(() => {
    onEntryCountChange?.(entryCount);
  }, [entryCount, onEntryCountChange]);

  // Resolve default receiving location as soon as Stage 2 loads so item entry begins with a location set.
  useEffect(() => {
    let cancelled = false;

    const resolve = async () => {
      const effectiveWarehouseId = shipment.warehouse_id || selectedWarehouseId;
      // receivingLocationId will be set by this effect once resolved
      if (!effectiveWarehouseId) return;
      // If the user manually chose a location, don't overwrite their choice.
      if (userOverrodeReceivingLocationRef.current) return;

      try {
        const { data: locResult } = await supabase.rpc('rpc_resolve_receiving_location', {
          p_warehouse_id: effectiveWarehouseId,
          p_account_id: shipment.account_id || undefined,
        });
        if (cancelled) return;
        const loc = locResult as any;
        if (loc?.ok && loc.location_id) {
          setReceivingLocationId(loc.location_id as string);
          setNeedsReceivingLocation(false);
        }
      } catch (err) {
        console.warn('[Stage2] Failed to resolve receiving location via RPC:', err);
        // Non-blocking: user can choose manually.
      }
    };

    void resolve();
    return () => {
      cancelled = true;
    };
  }, [shipment.warehouse_id, shipment.account_id, selectedWarehouseId]);

  // Emit item-level matching params whenever items change
  useEffect(() => {
    if (!onItemMatchingParamsChange) return;

    // Aggregate unique descriptions and vendors from current items for matching refinement
    const descriptions = items
      .map((i) => i.description.trim())
      .filter((d) => d.length >= 2);
    const vendors = items
      .map((i) => i.vendor.trim())
      .filter((v) => v.length >= 2);
    const skus = items
      .map((i) => i.item_code.trim())
      .filter((v) => v.length >= 2);

    // Use the most recently entered (last) non-empty value for each — that's what the user is actively typing
    const lastDescription = descriptions.length > 0 ? descriptions[descriptions.length - 1] : null;
    const lastVendor = vendors.length > 0 ? vendors[vendors.length - 1] : null;
    const lastSku = skus.length > 0 ? skus[skus.length - 1] : null;

    onItemMatchingParamsChange({
      itemDescription: lastDescription,
      itemVendor: lastVendor,
      itemSku: lastSku,
    });
  }, [items, onItemMatchingParamsChange]);

  // Manifest selector
  const [showManifestSelector, setShowManifestSelector] = useState(false);
  const [showMatchingPanel, setShowMatchingPanel] = useState(false);

  // Admin override
  const [showAdminOverride, setShowAdminOverride] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');

  // Container placement prompt
  const [containerPromptItemId, setContainerPromptItemId] = useState<string | null>(null);
  const [containerPromptQty, setContainerPromptQty] = useState(0);
  const [customContainerCount, setCustomContainerCount] = useState(2);

  // Completing
  const [completing, setCompleting] = useState(false);
  const [showCompleteDialog, setShowCompleteDialog] = useState(false);

  // Autosave Stage 2 item rows into shipment_items so:
  // - rows persist across tab switches / refresh
  // - Stage 1 BillingCalculator preview updates as items are entered
  const [autosaveStatus, setAutosaveStatus] = useState<AutosaveStatus>('idle');
  const lastSavedToastAtRef = useRef<number>(0);
  const autosaveIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const billingRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowSaveInFlightRef = useRef<Record<string, boolean>>({});
  const rowResaveQueuedRef = useRef<Record<string, boolean>>({});
  const rowLatestQueuedSnapshotRef = useRef<Record<string, ReceivedItem | undefined>>({});
  const rowPersistedShipmentItemIdRef = useRef<Record<string, string>>({});
  const itemsRef = useRef<ReceivedItem[]>([]);

  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // If the Stage 2 receiving location changes, keep any draft items (created for this intake)
  // aligned so location is set as soon as entry begins (and can be overridden at the Stage 2 level).
  useEffect(() => {
    if (!profile?.tenant_id) return;
    if (!receivingLocationId) return;

    const ids = itemsRef.current
      .map((r) => r.item_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    if (ids.length === 0) return;

    void (async () => {
      try {
        await (supabase.from('items') as any)
          .update({ current_location_id: receivingLocationId })
          .eq('tenant_id', profile.tenant_id)
          .eq('receiving_shipment_id', shipmentId)
          .eq('status', 'pending')
          .is('current_location_id', null)
          .in('id', ids);
      } catch {
        // Non-blocking
      }
    })();
  }, [receivingLocationId, profile?.tenant_id, shipmentId]);

  useEffect(() => {
    return () => {
      if (autosaveIdleTimerRef.current) clearTimeout(autosaveIdleTimerRef.current);
      if (billingRefreshTimerRef.current) clearTimeout(billingRefreshTimerRef.current);
    };
  }, []);

  // Load existing shipment items
  useEffect(() => {
    loadExistingItems();
  }, [shipmentId]);

  const itemProvisionInFlightRef = useRef<Record<string, boolean>>({});

  const provisionItemForRow = useCallback(async (row: ReceivedItem) => {
    if (!profile?.tenant_id || !profile?.id) return;
    if (!canEdit) return;
    if (row.item_id) return;
    if (itemProvisionInFlightRef.current[row.id]) return;
    itemProvisionInFlightRef.current[row.id] = true;

    try {
      const effectiveWarehouseId = shipment.warehouse_id || selectedWarehouseId;

      // If we can't resolve a warehouse yet, still pre-generate an ITM code (best-effort).
      // We'll attempt the actual items insert once a warehouse is available.
      if (!effectiveWarehouseId) {
        console.warn('[Stage2] provisionItemForRow: no warehouse available yet for row', row.id);
        if (!row.item_code) {
          try {
            const { data: code, error: codeErr } = await supabase.rpc('generate_item_code', {
              p_tenant_id: profile.tenant_id,
            });
            if (!codeErr && code) {
              setItems((prev) => prev.map((i) => (i.id === row.id ? { ...i, item_code: String(code) } : i)));
            }
          } catch {
            // Non-blocking
          }
        }
        return;
      }

      const { data: created, error: createErr } = await (supabase.from('items') as any)
        .insert({
          tenant_id: profile.tenant_id,
          warehouse_id: effectiveWarehouseId,
          account_id: shipment.account_id || null,
          current_location_id: receivingLocationId || null,
          // If pre-generated, keep it stable; otherwise allow DB trigger to assign.
          item_code: row.item_code || null,
          quantity: Number.isFinite(row.received_quantity) && row.received_quantity > 0 ? row.received_quantity : 1,
          vendor: row.vendor.trim() || null,
          description: row.description.trim() || null,
          sidemark: row.sidemark.trim() || null,
          room: row.room.trim() || null,
          class_id: row.class_id || null,
          status: 'pending',
          receiving_shipment_id: shipmentId,
        })
        .select('id, item_code')
        .single();

      if (createErr) throw createErr;

      setItems((prev) =>
        prev.map((i) =>
          i.id === row.id
            ? {
                ...i,
                item_id: created.id as string,
                item_code: (created.item_code as string) || i.item_code,
              }
            : i
        )
      );

      // If the shipment_item is already persisted, link it immediately.
      const maybeShipmentItemId =
        row.shipment_item_id || rowPersistedShipmentItemIdRef.current[row.id] || null;
      if (maybeShipmentItemId) {
        await (supabase.from('shipment_items') as any)
          .update({ item_id: created.id })
          .eq('id', maybeShipmentItemId);
      }
    } catch (err: any) {
      console.warn('[Stage2] failed to provision item record for row:', err);
    } finally {
      itemProvisionInFlightRef.current[row.id] = false;
    }
  }, [
    profile?.tenant_id,
    profile?.id,
    canEdit,
    shipment.warehouse_id,
    selectedWarehouseId,
    shipment.account_id,
    receivingLocationId,
    shipmentId,
  ]);

  // Retry any "code-only" rows once we have a warehouse selection.
  useEffect(() => {
    const effectiveWarehouseId = shipment.warehouse_id || selectedWarehouseId;
    if (!effectiveWarehouseId) return;

    const pending = items.filter((r) => !r.item_id);
    for (const row of pending) {
      void provisionItemForRow(row);
    }
  }, [shipment.warehouse_id, selectedWarehouseId, items, provisionItemForRow]);

  const loadExistingItems = async () => {
    if (!shipmentId) return;

    const { data, error } = await (supabase as any)
      .from('shipment_items')
      .select(`
        id,
        item_id,
        expected_description,
        expected_quantity,
        actual_quantity,
        expected_vendor,
        expected_sidemark,
        expected_class_id,
        room,
        flags,
        item:item_id(item_code, current_location_id)
      `)
      .eq('shipment_id', shipmentId)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[Stage2] load items error:', error);
      return;
    }

    if (data && data.length > 0) {
      const mapped: ReceivedItem[] = data.map((row: any) => ({
        id: row.id,
        shipment_item_id: row.id,
        item_id: row.item_id ?? null,
        item_code: (row.item?.item_code as string | null) ?? '',
        location_id: (row.item?.current_location_id as string | null) ?? null,
        description: row.expected_description || '',
        expected_quantity: row.expected_quantity || 0,
        received_quantity: row.actual_quantity || row.expected_quantity || 0,
        vendor: row.expected_vendor || '',
        sidemark_id: null,
        sidemark: row.expected_sidemark || '',
        room: row.room || '',
        class_id: row.expected_class_id || null,
        flags: Array.isArray(row.flags) ? row.flags.filter((f: unknown) => typeof f === 'string') : [],
        sourceType: 'manifest' as const,
        packages: 0,
      }));
      setItems(mapped);
    }
  };

  // Add manual item
  const addManualItem = () => {
    if (!canEdit) return;
    const rowId = crypto.randomUUID();
    const newItem: ReceivedItem = {
      id: rowId,
      item_id: null,
      item_code: '',
      location_id: receivingLocationId || null,
      description: '',
      expected_quantity: 0,
      received_quantity: 1,
      vendor: shipment.vendor_name || '',
      sidemark_id: null,
      sidemark: '',
      room: '',
      class_id: null,
      flags: [],
      sourceType: 'manual',
      packages: 0,
    };
    setItems(prev => [...prev, newItem]);
    // Auto-provision an Item Code (and item record) immediately.
    void provisionItemForRow(newItem);
  };

  // Add from manifest
  const handleAddFromManifest = (manifestItems: any[]) => {
    if (!canEdit) return;
    const newItems: ReceivedItem[] = manifestItems.map((item) => {
      const rowId = crypto.randomUUID();
      return ({
      id: rowId,
      shipment_item_id: undefined,
      item_id: null,
      item_code: '',
      location_id: receivingLocationId || null,
      description: item.expected_description || '',
      expected_quantity: item.expected_quantity || 0,
      received_quantity: item.expected_quantity || 0,
      vendor: item.expected_vendor || '',
      sidemark_id: null,
      sidemark: item.expected_sidemark || '',
      room: item.room || '',
      class_id: item.expected_class_id || null,
      flags: [],
      sourceType: 'manifest' as const,
      sourceShipmentItemId: item.id,
      packages: 0,
    });
    });
    setItems((prev) => [...prev, ...newItems]);
    // Auto-provision item codes for new rows (best-effort).
    for (const row of newItems) {
      void provisionItemForRow(row);
    }
  };

  // Update item field
  const updateItem = (id: string, field: keyof ReceivedItem, value: unknown) => {
    if (!canEdit) return;
    setItems(prev => {
      const updated = prev.map(i => (i.id === id ? { ...i, [field]: value } : i));
      if (field === 'received_quantity') {
        // Show container placement prompt when qty > 1
        const qty = value as number;
        if (qty > 1) {
          setContainerPromptItemId(id);
          setContainerPromptQty(qty);
          setCustomContainerCount(Math.min(qty, 2));
        }
      }
      return updated;
    });
  };

  const bumpBillingPreview = useCallback(() => {
    if (!onBillingRefresh) return;
    if (billingRefreshTimerRef.current) return;
    billingRefreshTimerRef.current = setTimeout(() => {
      billingRefreshTimerRef.current = null;
      onBillingRefresh();
    }, 150);
  }, [onBillingRefresh]);

  const isRowMeaningful = useCallback((row: ReceivedItem): boolean => {
    const hasQty = Number(row.received_quantity) > 0;
    const hasFlags = Array.isArray(row.flags) && row.flags.length > 0;
    const hasText = Boolean(
      row.vendor.trim() ||
        row.description.trim() ||
        row.sidemark.trim() ||
        row.room.trim()
    );
    const hasClass = Boolean(row.class_id);
    const hasLocation = Boolean(row.location_id);
    return hasQty || hasFlags || hasText || hasClass || hasLocation;
  }, []);

  const syncItemRecordForRow = useCallback(async (row: ReceivedItem) => {
    if (!profile?.tenant_id) return;
    if (!row.item_id) return;

    try {
      const rowLocationId = row.location_id || receivingLocationId || null;
      await (supabase.from('items') as any)
        .update({
          account_id: shipment.account_id || null,
          current_location_id: rowLocationId,
          quantity: Number.isFinite(row.received_quantity) && row.received_quantity > 0 ? row.received_quantity : 1,
          vendor: row.vendor.trim() || null,
          description: row.description.trim() || null,
          sidemark: row.sidemark.trim() || null,
          room: row.room.trim() || null,
          class_id: row.class_id || null,
        })
        .eq('tenant_id', profile.tenant_id)
        .eq('id', row.item_id)
        .eq('receiving_shipment_id', shipmentId);
    } catch {
      // Non-blocking
    }
  }, [profile?.tenant_id, shipment.account_id, receivingLocationId, shipmentId]);

  const upsertShipmentItemRow = useCallback(async (row: ReceivedItem) => {
    if (!shipmentId || !profile?.id) return;
    if (!canEdit) return;
    if (!isRowMeaningful(row)) return;

    // Avoid insert/update races on repeated blur events.
    if (rowSaveInFlightRef.current[row.id]) {
      rowResaveQueuedRef.current[row.id] = true;
      rowLatestQueuedSnapshotRef.current[row.id] = row;
      return;
    }

    rowSaveInFlightRef.current[row.id] = true;
    setAutosaveStatus('saving');

    const payload: Record<string, unknown> = {
      expected_description: row.description.trim() || null,
      expected_vendor: row.vendor.trim() || null,
      expected_sidemark: row.sidemark.trim() || null,
      expected_class_id: row.class_id || null,
      room: row.room.trim() || null,
      expected_quantity: row.expected_quantity && row.expected_quantity > 0 ? row.expected_quantity : 1,
      actual_quantity: Number.isFinite(row.received_quantity) ? row.received_quantity : 0,
      flags: row.flags,
    };
    if (row.item_id) {
      payload.item_id = row.item_id;
    }

    try {
      if (row.shipment_item_id) {
        const { error } = await (supabase.from('shipment_items') as any)
          .update(payload)
          .eq('id', row.shipment_item_id);

        if (error) throw error;
        rowPersistedShipmentItemIdRef.current[row.id] = row.shipment_item_id;
      } else {
        const { data, error } = await (supabase.from('shipment_items') as any)
          .insert({ shipment_id: shipmentId, ...payload })
          .select('id')
          .single();

        if (error) throw error;

        const newId = (data as any)?.id as string | undefined;
        if (newId) {
          rowPersistedShipmentItemIdRef.current[row.id] = newId;
          setItems((prev) => prev.map((i) => (i.id === row.id ? { ...i, shipment_item_id: newId } : i)));
        }
      }

      // Keep the linked Item record in sync with Stage 2 entry fields (best-effort).
      await syncItemRecordForRow(row);

      bumpBillingPreview();
      setAutosaveStatus('saved');
      // UX: clear green "saved" confirmation (throttled to avoid toast spam during rapid entry).
      const now = Date.now();
      if (now - lastSavedToastAtRef.current > 8000) {
        lastSavedToastAtRef.current = now;
        toast({
          type: 'success',
          title: 'Shipment saved',
          description: 'Stage 2 changes have been saved.',
        });
      }
      if (autosaveIdleTimerRef.current) clearTimeout(autosaveIdleTimerRef.current);
      autosaveIdleTimerRef.current = setTimeout(() => setAutosaveStatus('idle'), 1200);
    } catch (err: any) {
      console.error('[Stage2] item autosave error:', err);
      setAutosaveStatus('error');
      // Keep this lightweight (no spam): a single toast is okay; persistent error state is also visible.
      toast({
        variant: 'destructive',
        title: 'Autosave Failed',
        description: err?.message || 'Failed to save item row. Please try again.',
      });
    } finally {
      rowSaveInFlightRef.current[row.id] = false;

      // If changes came in while we were saving, write the newest snapshot once more.
      if (rowResaveQueuedRef.current[row.id]) {
        rowResaveQueuedRef.current[row.id] = false;
        const queued = rowLatestQueuedSnapshotRef.current[row.id];
        rowLatestQueuedSnapshotRef.current[row.id] = undefined;
        const latest = queued ?? itemsRef.current.find((i) => i.id === row.id);
        if (latest) {
          const persistedId = rowPersistedShipmentItemIdRef.current[row.id];
          const rowToSave =
            latest.shipment_item_id || !persistedId
              ? latest
              : { ...latest, shipment_item_id: persistedId };
          void upsertShipmentItemRow(rowToSave);
        }
      }
    }
  }, [shipmentId, profile?.id, canEdit, isRowMeaningful, syncItemRecordForRow, bumpBillingPreview, toast]);

  const persistItemRowWithSuggestion = useCallback((
    rowId: string,
    field?: 'vendor' | 'description' | 'room',
    suggest?: (value: string) => Promise<void> | void,
  ) => {
    const latest = itemsRef.current.find((i) => i.id === rowId);
    if (!latest) return;
    void upsertShipmentItemRow(latest);
    if (suggest && field) {
      const nextValue = String(latest[field] || '').trim();
      if (nextValue) {
        void suggest(nextValue);
      }
    }
  }, [upsertShipmentItemRow]);

  const handleSidemarkSelect = useCallback(async (row: ReceivedItem, sidemarkId: string) => {
    if (!canEdit) return;

    const trimmedId = sidemarkId.trim();
    if (!trimmedId) {
      const clearedRow: ReceivedItem = {
        ...row,
        sidemark_id: null,
        sidemark: '',
      };
      setItems((prev) => prev.map((i) => (i.id === row.id ? clearedRow : i)));
      await upsertShipmentItemRow(clearedRow);
      return;
    }

    let sidemarkName = '';
    try {
      const { data } = await supabase
        .from('sidemarks')
        .select('sidemark_name')
        .eq('id', trimmedId)
        .maybeSingle();
      sidemarkName = (data?.sidemark_name || '').trim();
    } catch {
      // Non-blocking; we'll still persist id intent via display text fallback below.
    }

    const updatedRow: ReceivedItem = {
      ...row,
      sidemark_id: trimmedId,
      sidemark: sidemarkName || row.sidemark || '',
    };
    setItems((prev) => prev.map((i) => (i.id === row.id ? updatedRow : i)));
    await upsertShipmentItemRow(updatedRow);
  }, [canEdit, upsertShipmentItemRow]);

  const duplicateItem = (id: string) => {
    if (!canEdit) return;
    const newRowId = crypto.randomUUID();
    let copyRow: ReceivedItem | null = null;
    setItems((prev) => {
      const source = prev.find((row) => row.id === id);
      if (!source) return prev;

      const copy: ReceivedItem = {
        ...source,
        id: newRowId,
        shipment_item_id: undefined,
        item_id: null,
        item_code: '',
        sidemark_id: null,
        sourceType: 'manual',
        sourceShipmentItemId: undefined,
        allocationId: undefined,
      };
      copyRow = copy;
      return [...prev, copy];
    });
    if (copyRow) {
      void provisionItemForRow(copyRow);
    } else {
      // Best-effort: the state update above should always set this.
      void provisionItemForRow({
        id: newRowId,
        item_id: null,
        item_code: '',
        location_id: receivingLocationId || null,
        description: '',
        expected_quantity: 0,
        received_quantity: 1,
        vendor: '',
        sidemark_id: null,
        sidemark: '',
        room: '',
        class_id: null,
        flags: [],
        sourceType: 'manual',
        packages: 0,
      });
    }
  };

  const toggleRowExpanded = (id: string) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleItemFlag = (id: string, serviceCode: string) => {
    if (!canEdit) return;
    let nextRow: ReceivedItem | null = null;
    setItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;
        const nextFlags = new Set(item.flags);
        if (nextFlags.has(serviceCode)) {
          nextFlags.delete(serviceCode);
        } else {
          nextFlags.add(serviceCode);
        }
        nextRow = { ...item, flags: Array.from(nextFlags) };
        return nextRow;
      })
    );

    if (nextRow) {
      void upsertShipmentItemRow(nextRow);
    }
  };

  // Container placement handlers
  const applyContainerChoice = (itemId: string, packages: number) => {
    setItems(prev => prev.map(i => (i.id === itemId ? { ...i, packages } : i)));
    setContainerPromptItemId(null);
  };

  // Remove item (allocation-aware)
  const removeItem = async (item: ReceivedItem) => {
    if (!canEdit || !showCompleteButton) return;

    // Prevent in-flight autosave from re-saving a row after user deletes it.
    delete rowResaveQueuedRef.current[item.id];
    delete rowLatestQueuedSnapshotRef.current[item.id];
    delete rowPersistedShipmentItemIdRef.current[item.id];

    // If sourced from allocation, reverse via deallocation RPC
    if (item.allocationId) {
      try {
        const { error } = await supabase.rpc('rpc_deallocate_manifest_item', {
          p_allocation_id: item.allocationId,
        });
        if (error) throw error;
      } catch (err: any) {
        console.error('[Stage2] deallocation error:', err);
        toast({
          variant: 'destructive',
          title: 'Deallocation Failed',
          description: err?.message || 'Failed to reverse allocation',
        });
        return;
      }
    }

    // If it's a persisted shipment_item, delete it
    if (item.shipment_item_id) {
      await (supabase as any)
        .from('shipment_items')
        .delete()
        .eq('id', item.shipment_item_id);
    }

    // If we provisioned a draft Item record for this intake, archive it as well (best-effort).
    if (item.item_id && profile?.tenant_id) {
      try {
        await (supabase.from('items') as any)
          .update({ deleted_at: new Date().toISOString() })
          .eq('tenant_id', profile.tenant_id)
          .eq('id', item.item_id)
          .eq('receiving_shipment_id', shipmentId)
          .eq('status', 'pending');
      } catch {
        // Non-blocking
      }
    }

    // Log audit
    if (profile?.tenant_id && profile?.id) {
      logActivity({
        entityType: 'shipment',
        tenantId: profile.tenant_id,
        entityId: shipmentId,
        actorUserId: profile.id,
        eventType: 'receiving_item_removed',
        eventLabel: 'Item removed during receiving',
        details: {
          description: item.description,
          quantity: item.received_quantity,
          source: item.sourceType,
          allocationReversed: !!item.allocationId,
        },
      });
    }

    setItems(prev => {
      const updated = prev.filter(i => i.id !== item.id);
      return updated;
    });
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });

    toast({ title: 'Removed', description: 'Item removed from receiving.' });
  };

  // Validate before completion
  const validateCompletion = (): string[] => {
    const errors: string[] = [];
    const dock = Number(dockCount) || 0;
    if (dock <= 0) {
      errors.push('Dock Count must be greater than 0 (set in Stage 1)');
    }
    if (items.length === 0 && !isAdmin) {
      errors.push('At least 1 item line is required (admin can override)');
    }
    // Check all items have description and quantity
    for (const item of items) {
      if (!item.description.trim()) {
        errors.push('All items must have a description');
        break;
      }
      if (item.received_quantity <= 0) {
        errors.push('All items must have a quantity > 0');
        break;
      }
    }
    return errors;
  };

  // Handle complete button
  const handleCompleteClick = async () => {
    if (!canEdit || !showCompleteButton) return;
    const errors = validateCompletion();

    // Allow admin override if only issue is no items
    if (items.length === 0 && isAdmin && errors.length === 0) {
      setShowAdminOverride(true);
      return;
    }

    if (errors.length > 0) {
      toast({
        variant: 'destructive',
        title: 'Cannot Complete',
        description: errors.join('. '),
      });
      return;
    }

    // Enforce exception notes (all open exception chips should have a client-visible exception note).
    // Exclude auto-matching discrepancy codes (manifest vs expected mismatches) per intake Q&A.
    if (profile?.tenant_id) {
      try {
        const { data: openExRows, error: openExErr } = await (supabase as any)
          .from('shipment_exceptions')
          .select('code, note')
          .eq('tenant_id', profile.tenant_id)
          .eq('shipment_id', shipmentId)
          .eq('status', 'open');

        if (openExErr) throw openExErr;

        const openExceptionCodes = ((openExRows || []) as Array<{ code: ShipmentExceptionCode; note: string | null }>)
          .map((r) => r.code)
          .filter((code) => !MATCHING_DISCREPANCY_CODES.has(code));

        if (openExceptionCodes.length > 0) {
          // Pull exception notes from shipment_notes (preferred) + shipment_exceptions.note (legacy denormalized)
          const codesWithNotes = new Set<ShipmentExceptionCode>();

          for (const row of (openExRows || []) as Array<{ code: ShipmentExceptionCode; note: string | null }>) {
            if (!MATCHING_DISCREPANCY_CODES.has(row.code) && (row.note || '').trim()) {
              codesWithNotes.add(row.code);
            }
          }

          const { data: noteRows, error: notesErr } = await (supabase as any)
            .from('shipment_notes')
            .select('exception_code, note')
            .eq('tenant_id', profile.tenant_id)
            .eq('shipment_id', shipmentId)
            .eq('note_type', 'exception')
            .is('deleted_at', null)
            .in('exception_code', openExceptionCodes);

          if (notesErr) throw notesErr;

          for (const n of (noteRows || []) as Array<{ exception_code: ShipmentExceptionCode | null; note: string | null }>) {
            const code = n.exception_code;
            if (!code) continue;
            if ((n.note || '').trim()) codesWithNotes.add(code);
          }

          const missing = openExceptionCodes.filter((c) => !codesWithNotes.has(c));
          if (missing.length > 0) {
            toast({
              variant: 'destructive',
              title: 'Exception Notes Required',
              description: `Add a client-visible exception note for: ${missing
                .map((c) => SHIPMENT_EXCEPTION_CODE_META[c]?.label || c)
                .join(', ')}.`,
            });
            onOpenNotes?.();
            return;
          }
        }
      } catch (err: any) {
        console.warn('[Stage2] exception note enforcement check failed:', err);
        // Fail open (do not block receiving completion if we can't validate).
      }
    }

    // Stage 2 mismatch gating (Dock vs Entry): allow proceed only if corrected OR has exception+note.
    if (profile?.tenant_id) {
      const dock = Number(dockCount) || 0;
      const entry = Number(entryCount) || 0;
      const mismatch = dock > 0 && entry > 0 && dock !== entry;

      if (mismatch) {
        const requiredCode: ShipmentExceptionCode = entry > dock ? 'OVERAGE' : 'SHORTAGE';

        try {
          // Ensure any in-focus exception textarea persists its note before we validate against DB.
          if (typeof document !== 'undefined') {
            (document.activeElement as HTMLElement | null)?.blur?.();
          }

          // Ensure the required exception chip exists (Stage 2 mismatch is not live-synced)
          const { data: existingChip } = await (supabase as any)
            .from('shipment_exceptions')
            .select('id, note')
            .eq('tenant_id', profile.tenant_id)
            .eq('shipment_id', shipmentId)
            .eq('status', 'open')
            .eq('code', requiredCode)
            .maybeSingle();

          if (!existingChip) {
            await (supabase as any)
              .from('shipment_exceptions')
              .insert({
                tenant_id: profile.tenant_id,
                shipment_id: shipmentId,
                code: requiredCode,
                note: null,
                status: 'open',
                created_by: profile.id ?? null,
              });
          }

          const fetchAnyNote = async () => {
            // Prefer shipment_notes exception-type notes (Notes tab), but allow legacy shipment_exceptions.note too.
            const { data: noteRows, error: noteErr } = await (supabase as any)
              .from('shipment_notes')
              .select('note')
              .eq('tenant_id', profile.tenant_id)
              .eq('shipment_id', shipmentId)
              .eq('note_type', 'exception')
              .eq('exception_code', requiredCode)
              .is('deleted_at', null)
              .order('created_at', { ascending: false })
              .limit(1);
            if (noteErr && !isShipmentNotesSchemaCacheError(noteErr)) throw noteErr;

            const noteFromNotes = (((noteRows?.[0]?.note as string | null) ?? '') as string).trim();
            if (noteFromNotes) return noteFromNotes;

            const { data: exRows, error: exErr } = await (supabase as any)
              .from('shipment_exceptions')
              .select('note')
              .eq('tenant_id', profile.tenant_id)
              .eq('shipment_id', shipmentId)
              .eq('status', 'open')
              .eq('code', requiredCode)
              .limit(1);
            if (exErr) throw exErr;
            return (((exRows?.[0]?.note as string | null) ?? '') as string).trim();
          };

          // If the user just typed a note and clicked Complete, the save can still be in-flight; retry once.
          let note = await fetchAnyNote();
          if (!note) {
            await new Promise((resolve) => setTimeout(resolve, 400));
            note = await fetchAnyNote();
          }
          if (!note) {
            toast({
              variant: 'destructive',
              title: 'Counts Mismatch',
              description: `Dock Count (${dock}) and Entry Count (${entry}) do not match. Fix the counts or add a ${SHIPMENT_EXCEPTION_CODE_META[requiredCode].label} exception note in Notes.`,
            });
            onOpenNotes?.();
            return;
          }
        } catch (err: any) {
          console.error('[Stage2] mismatch check error:', err);
          toast({
            variant: 'destructive',
            title: 'Could not validate mismatch',
            description: err?.message || 'Failed to validate Dock vs Entry mismatch. Try again.',
          });
          return;
        }
      }
    }

    setNeedsReceivingLocation(false);
    setShowCompleteDialog(true);
  };

  // Complete receiving
  const handleComplete = async (adminOverride: boolean = false) => {
    if (!profile?.tenant_id || !profile?.id) return;
    setCompleting(true);

    try {
      const completedAt = new Date().toISOString();
      let autoApplyArrivalNoIdFlag = true;
      let unidentifiedAccountId: string | null = null;

      try {
        const { data: prefs } = await (supabase as any)
          .from('tenant_preferences')
          .select('auto_apply_arrival_no_id_flag')
          .eq('tenant_id', profile.tenant_id)
          .maybeSingle();

        if (prefs?.auto_apply_arrival_no_id_flag === false) {
          autoApplyArrivalNoIdFlag = false;
        }
      } catch (prefErr) {
        console.warn('[Stage2] failed to read auto_apply_arrival_no_id_flag:', prefErr);
      }

      unidentifiedAccountId = await ensureUnidentifiedAccount(profile.tenant_id);

      let effectiveShipmentAccountId = shipment.account_id;
      if (!effectiveShipmentAccountId && unidentifiedAccountId) {
        const { error: assignAccountErr } = await supabase
          .from('shipments')
          .update({ account_id: unidentifiedAccountId } as any)
          .eq('id', shipmentId);

        if (assignAccountErr) {
          console.warn('[Stage2] could not assign unidentified account to shipment:', assignAccountErr);
        } else {
          effectiveShipmentAccountId = unidentifiedAccountId;
        }
      }

      const isUnidentifiedShipment =
        !!unidentifiedAccountId && effectiveShipmentAccountId === unidentifiedAccountId;
      const isExceptionHoldShipment =
        shipment.shipment_exception_type === 'MIS_SHIP' ||
        shipment.shipment_exception_type === 'RETURN_TO_SENDER';

      // Prefer the location selected up-front during item entry (Stage 2 header).
      let effectiveReceivingLocationId: string | null = receivingLocationId;

      // If not set yet, try to resolve once more right before completion.
      if (!effectiveReceivingLocationId) {
        try {
          const effectiveWarehouseId = shipment.warehouse_id || selectedWarehouseId;
          if (effectiveWarehouseId) {
            const { data: locResult } = await supabase.rpc('rpc_resolve_receiving_location', {
              p_warehouse_id: effectiveWarehouseId,
              p_account_id: effectiveShipmentAccountId || undefined,
            });
            const loc = locResult as any;
            if (loc?.ok && loc.location_id) {
              effectiveReceivingLocationId = loc.location_id as string;
              setReceivingLocationId(loc.location_id as string);
            }
          }
        } catch {
          console.warn('[Stage2] could not resolve receiving location');
        }
      }

      if (!effectiveReceivingLocationId) {
        setNeedsReceivingLocation(true);
        toast({
          variant: 'destructive',
          title: 'No Receiving Location',
          description: 'Please select a receiving location before completing.',
        });
        setCompleting(false);
        return;
      }

      // Create/update shipment items in item-code mode.
      const touchedShipmentItemIds: string[] = [];
      const touchedItemIds: string[] = [];
      let skippedLegacyContainerPackagingRows = 0;
      const effectiveWarehouseIdForItems =
        shipment.warehouse_id ||
        selectedWarehouseId ||
        (effectiveReceivingLocationId
          ? allLocations.find((l) => l.id === effectiveReceivingLocationId)?.warehouse_id
          : null);
      for (const item of items) {
        const effectiveItemLocationId = item.location_id || effectiveReceivingLocationId;

        // Ensure an Item exists with an ITM code for each row (best-effort).
        // This aligns Dock Intake Stage 2 with the rest of the app where items have ITM-###-#### codes.
        let effectiveItemId: string | null = item.item_id || null;
        if (!effectiveItemId && profile?.tenant_id && effectiveWarehouseIdForItems) {
          try {
            const { data: createdItem, error: createItemErr } = await (supabase.from('items') as any)
              .insert({
                tenant_id: profile.tenant_id,
                warehouse_id: effectiveWarehouseIdForItems,
                account_id: effectiveShipmentAccountId || null,
                current_location_id: effectiveItemLocationId,
                item_code: item.item_code || null,
                quantity: Number.isFinite(item.received_quantity) && item.received_quantity > 0 ? item.received_quantity : 1,
                vendor: item.vendor.trim() || null,
                description: item.description.trim() || null,
                sidemark: item.sidemark.trim() || null,
                room: item.room.trim() || null,
                class_id: item.class_id || null,
                status: 'active',
                receiving_shipment_id: shipmentId,
                received_at: completedAt,
              })
              .select('id, item_code')
              .single();

            if (createItemErr) throw createItemErr;
            effectiveItemId = (createdItem as any)?.id ?? null;

            if (effectiveItemId) {
              touchedItemIds.push(effectiveItemId);
              setItems((prev) =>
                prev.map((r) =>
                  r.id === item.id
                    ? {
                        ...r,
                        item_id: effectiveItemId,
                        item_code: (createdItem as any)?.item_code || r.item_code,
                      }
                    : r
                )
              );
            }
          } catch (err) {
            console.warn('[Stage2] failed to create item record on completion:', err);
          }
        } else if (effectiveItemId) {
          touchedItemIds.push(effectiveItemId);
        }

        if (effectiveItemId && profile?.tenant_id) {
          await (supabase.from('items') as any)
            .update({
              account_id: effectiveShipmentAccountId || null,
              current_location_id: effectiveItemLocationId,
              quantity: Number.isFinite(item.received_quantity) && item.received_quantity > 0 ? item.received_quantity : 1,
              vendor: item.vendor.trim() || null,
              description: item.description.trim() || null,
              sidemark: item.sidemark.trim() || null,
              room: item.room.trim() || null,
              class_id: item.class_id || null,
              received_at: completedAt,
              status: 'active',
            })
            .eq('tenant_id', profile.tenant_id)
            .eq('id', effectiveItemId);
        }

        // Create or update shipment_item
        let shipmentItemId = item.shipment_item_id;
        if (!shipmentItemId) {
          const { data: si, error: siErr } = await (supabase as any)
            .from('shipment_items')
            .insert({
              shipment_id: shipmentId,
              item_id: effectiveItemId,
              expected_description: item.description,
              expected_quantity: item.expected_quantity,
              actual_quantity: item.received_quantity,
              expected_vendor: item.vendor || null,
              expected_sidemark: item.sidemark || null,
              expected_class_id: item.class_id || null,
              room: item.room || null,
              flags: item.flags,
              status: 'received',
              received_at: new Date().toISOString(),
            })
            .select('id')
            .single();

          if (siErr) {
            console.error('[Stage2] create shipment_item error:', siErr);
            continue;
          }
          shipmentItemId = si.id;
        } else {
          // Update existing
          await (supabase as any)
            .from('shipment_items')
            .update({
              item_id: effectiveItemId,
              expected_description: item.description || null,
              expected_vendor: item.vendor || null,
              expected_sidemark: item.sidemark || null,
              expected_class_id: item.class_id || null,
              room: item.room || null,
              flags: item.flags,
              actual_quantity: item.received_quantity,
              status: 'received',
              received_at: new Date().toISOString(),
            })
            .eq('id', shipmentItemId);
        }

        if (shipmentItemId) {
          touchedShipmentItemIds.push(shipmentItemId);
        }

        const qty = item.received_quantity;
        if (item.packages > 0 && qty > 1) {
          // Item-code mode: package count is captured for receiving context,
          // but auto-creating legacy unit/container links is intentionally disabled.
          skippedLegacyContainerPackagingRows += 1;
        }
      }

      // ── Auto-create Inspection / Assembly tasks (mirrors useReceivingSession logic) ──
      if (touchedItemIds.length > 0 && profile?.tenant_id && effectiveShipmentAccountId) {
        try {
          // Fetch account-level auto-task preferences
          const { data: acctPrefs } = await supabase
            .from('accounts')
            .select('auto_inspection_on_receiving, auto_assembly_on_receiving')
            .eq('id', effectiveShipmentAccountId)
            .single();

          // Fetch tenant-level preferences
          const { data: tenantPrefs } = await (supabase as any)
            .from('tenant_preferences')
            .select('should_create_inspections, auto_assembly_on_receiving')
            .eq('tenant_id', profile.tenant_id)
            .maybeSingle();

          const shouldCreateInspections =
            tenantPrefs?.should_create_inspections || acctPrefs?.auto_inspection_on_receiving;
          const shouldCreateAssembly =
            tenantPrefs?.auto_assembly_on_receiving || acctPrefs?.auto_assembly_on_receiving;

          if (shouldCreateInspections || shouldCreateAssembly) {
            const uniqueItemIds = [...new Set(touchedItemIds)];
            const effectiveWh =
              shipment.warehouse_id || selectedWarehouseId || effectiveWarehouseIdForItems;

            for (const itemId of uniqueItemIds) {
              const itemRow = items.find((i) => i.item_id === itemId);
              const itemDesc = itemRow?.description || 'Item';

              if (shouldCreateInspections) {
                const { data: taskData } = await supabase
                  .from('tasks')
                  .insert({
                    tenant_id: profile.tenant_id,
                    title: `Inspect: ${itemDesc}`,
                    task_type: 'Inspection',
                    status: 'pending',
                    priority: 'normal',
                    account_id: effectiveShipmentAccountId,
                    warehouse_id: effectiveWh,
                  } as any)
                  .select('id')
                  .single();

                if (taskData) {
                  await supabase.from('task_items').insert({
                    task_id: taskData.id,
                    item_id: itemId,
                  } as any);
                }
              }

              if (shouldCreateAssembly) {
                const { data: assemblyTaskData } = await supabase
                  .from('tasks')
                  .insert({
                    tenant_id: profile.tenant_id,
                    title: `Assemble: ${itemDesc}`,
                    task_type: 'Assembly',
                    status: 'pending',
                    priority: 'normal',
                    account_id: effectiveShipmentAccountId,
                    warehouse_id: effectiveWh,
                  } as any)
                  .select('id')
                  .single();

                if (assemblyTaskData) {
                  await supabase.from('task_items').insert({
                    task_id: assemblyTaskData.id,
                    item_id: itemId,
                  } as any);

                  await (supabase.from('items') as any)
                    .update({ assembly_status: 'pending' })
                    .eq('id', itemId);
                }
              }
            }
          }
        } catch (autoTaskErr) {
          console.warn('[Stage2] Auto-task creation error (non-blocking):', autoTaskErr);
        }
      }

      // tag touched items with exception-hold metadata so no context is lost.
      if (isExceptionHoldShipment && touchedItemIds.length > 0) {
        const uniqueTouchedItemIds = [...new Set(touchedItemIds)];
        try {
          const { data: touchedRows, error: touchedErr } = await (supabase.from('items') as any)
            .select('id, metadata')
            .eq('tenant_id', profile.tenant_id)
            .in('id', uniqueTouchedItemIds)
            .is('deleted_at', null);
          if (touchedErr) throw touchedErr;

          for (const row of touchedRows || []) {
            const existingMeta =
              row?.metadata && typeof row.metadata === 'object' ? row.metadata : {};
            const nextMeta = {
              ...(existingMeta as any),
              exception_hold: true,
              shipment_exception_type: shipment.shipment_exception_type,
              exception_hold_source: 'shipment',
              exception_hold_updated_at: completedAt,
            };

            const { error: holdErr } = await (supabase.from('items') as any)
              .update({ metadata: nextMeta })
              .eq('tenant_id', profile.tenant_id)
              .eq('id', row.id);
            if (holdErr) {
              console.warn('[Stage2] failed to tag item exception_hold metadata:', holdErr);
            }
          }
        } catch (tagErr) {
          console.warn('[Stage2] failed to apply item exception hold metadata:', tagErr);
        }
      }

      if (skippedLegacyContainerPackagingRows > 0) {
        toast({
          title: 'Item-code mode active',
          description:
            `${skippedLegacyContainerPackagingRows} row(s) requested package/container auto-linking, ` +
            'but receiving now stays item-code-only (no legacy unit packaging).',
        });
      }

      let autoFlaggedItemCount = 0;
      if (autoApplyArrivalNoIdFlag && isUnidentifiedShipment && touchedShipmentItemIds.length > 0) {
        const uniqueShipmentItemIds = [...new Set(touchedShipmentItemIds)];

        const { data: shipmentItemRows, error: shipmentItemsErr } = await (supabase as any)
          .from('shipment_items')
          .select('id, flags')
          .in('id', uniqueShipmentItemIds);

        if (shipmentItemsErr) {
          console.error('[Stage2] failed to load shipment item flags:', shipmentItemsErr);
        } else {
          for (const row of (shipmentItemRows || []) as Array<{ id: string; flags: string[] | null }>) {
            const existingFlags = Array.isArray(row.flags)
              ? row.flags.filter((flag) => typeof flag === 'string')
              : [];

            if (existingFlags.includes(ARRIVAL_NO_ID_FLAG)) {
              continue;
            }

            const { error: updateFlagErr } = await (supabase as any)
              .from('shipment_items')
              .update({ flags: [...existingFlags, ARRIVAL_NO_ID_FLAG] })
              .eq('id', row.id);

            if (updateFlagErr) {
              console.error('[Stage2] failed to apply ARRIVAL_NO_ID flag:', updateFlagErr);
              continue;
            }

            autoFlaggedItemCount += 1;
          }
        }
      }

      // Log admin override if used
      if (adminOverride) {
        logActivity({
          entityType: 'shipment',
          tenantId: profile.tenant_id,
          entityId: shipmentId,
          actorUserId: profile.id,
          eventType: 'receiving_admin_override',
          eventLabel: 'Admin override: completed receiving without items',
          details: { reason: overrideReason },
        });
      }

      // Update shipment to closed
      const { error: closeErr } = await supabase
        .from('shipments')
        .update({
          inbound_status: 'closed',
          // User-facing shipment lifecycle: Stage 2 completion == received.
          status: 'received',
          received_at: completedAt,
        } as any)
        .eq('id', shipmentId);

      if (closeErr) throw closeErr;

      // Promote any draft items created during Stage 2 entry to Active (best-effort).
      // This assigns Received timestamps + ensures they land in the receiving location.
      try {
        if (profile?.tenant_id) {
          await (supabase.from('items') as any)
            .update({
              status: 'active',
              account_id: effectiveShipmentAccountId || null,
              received_at: completedAt,
            })
            .eq('tenant_id', profile.tenant_id)
            .eq('receiving_shipment_id', shipmentId)
            .eq('status', 'pending');
        }
      } catch {
        // Non-blocking
      }

      // Stop Stage 2 timer interval (best-effort)
      try {
        await timerEndJob({
          tenantId: profile?.tenant_id,
          userId: profile?.id,
          jobType: 'shipment',
          jobId: shipmentId,
          reason: 'complete',
        });
      } catch (timerErr) {
        console.warn('[Stage2] Failed to end timer interval:', timerErr);
      }

      // Snapshot estimated + actual minutes for reporting/display (best-effort)
      try {
        // Actual labor minutes: sum intervals for this shipment
        const { data: rows } = await (supabase
          .from('job_time_intervals') as any)
          .select('started_at, ended_at')
          .eq('tenant_id', profile.tenant_id)
          .eq('job_type', 'shipment')
          .eq('job_id', shipmentId);

        const laborMinutes = Math.round(
          (rows || []).reduce((sum: number, r: any) => {
            const start = r.started_at as string;
            const end = (r.ended_at as string | null) || completedAt;
            return sum + minutesBetweenIso(start, end);
          }, 0)
        );

        // Estimated minutes from billing preview (uses pricing_rules.service_time_minutes)
        const preview = await calculateShipmentBillingPreview(profile.tenant_id, shipmentId, 'inbound');
        const estimatedMinutes = (preview?.lineItems || []).reduce((sum, li) => sum + (li.estimatedMinutes || 0), 0);

        const { data: shipmentRow } = await supabase
          .from('shipments')
          .select('metadata')
          .eq('id', shipmentId)
          .maybeSingle();

        let merged: any = shipmentRow?.metadata ?? null;
        merged = mergeServiceTimeSnapshot(merged, {
          estimated_minutes: Math.round(estimatedMinutes),
          estimated_snapshot_at: completedAt,
          estimated_source: 'billing_preview',
          estimated_version: 1,
        });
        merged = mergeServiceTimeActualSnapshot(merged, {
          actual_cycle_minutes: laborMinutes,
          actual_labor_minutes: laborMinutes,
          actual_snapshot_at: completedAt,
          actual_version: 1,
        });

        await supabase
          .from('shipments')
          .update({ metadata: merged })
          .eq('id', shipmentId);
      } catch (snapshotErr) {
        console.warn('[Stage2] Failed to snapshot service time:', snapshotErr);
      }

      // Assign receiving location as safety net
      try {
        const hasPerRowLocationOverride = items.some(
          (row) => !!row.location_id && row.location_id !== effectiveReceivingLocationId
        );
        if (!hasPerRowLocationOverride) {
          await supabase.rpc('rpc_assign_receiving_location_for_shipment', {
            p_shipment_id: shipmentId,
            p_note: 'Auto-assigned on Stage 2 completion',
          });
        }
      } catch {
        // Non-blocking
      }

      // Log completion
      logActivity({
        entityType: 'shipment',
        tenantId: profile.tenant_id,
        entityId: shipmentId,
        actorUserId: profile.id,
        eventType: 'receiving_completed',
        eventLabel: 'Receiving completed (Stage 2)',
        details: {
          dock_count: dockCount ?? null,
          entry_count: entryCount,
          items_count: items.length,
        },
      });

      if (isUnidentifiedShipment && autoApplyArrivalNoIdFlag && autoFlaggedItemCount > 0) {
        try {
          await queueUnidentifiedIntakeCompletedAlert(
            profile.tenant_id,
            shipmentId,
            shipmentNumber,
            autoFlaggedItemCount
          );
        } catch (alertErr) {
          // Alerting should not block receiving completion.
          console.warn('[Stage2] failed to queue unidentified intake alert:', alertErr);
        }
      }

      toast({
        title: 'Receiving Complete',
        description:
          autoFlaggedItemCount > 0
            ? `Shipment closed. ${autoFlaggedItemCount} item(s) auto-flagged ARRIVAL_NO_ID.`
            : 'Shipment has been received and closed.',
      });
      setShowCompleteDialog(false);
      setShowAdminOverride(false);
      promptResumePausedTask();
      onComplete();
    } catch (err: any) {
      console.error('[Stage2] complete error:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err?.message || 'Failed to complete receiving',
      });
    } finally {
      setCompleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header — hidden when parent provides its own layout */}
      {!hideHeader && (
        <Card className="border-primary">
          <CardHeader className="pb-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MaterialIcon name="inventory_2" size="md" className="text-primary" />
                  Stage 2 — Detailed Receiving
                  <Badge variant="outline">{shipmentNumber}</Badge>
                  <ShipmentExceptionBadge
                    shipmentId={shipmentId}
                    onClick={onOpenExceptions}
                  />
                </CardTitle>
                <CardDescription className="mt-1">
                  Receive items, finalize item_code records, and verify quantities.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 flex-wrap justify-end">
                <JobTimerWidget
                  jobType="shipment"
                  jobId={shipmentId}
                  variant="inline"
                  showControls={false}
                />
                <Badge variant="secondary" className="text-sm">
                  Carrier: {shipment.signed_pieces ?? '-'}
                </Badge>
                <Badge variant="secondary" className="text-sm">
                  Dock: {dockCount ?? '-'}
                </Badge>
                <Badge variant={entryCount > 0 ? 'default' : 'outline'} className="text-sm">
                  Entry: {entryCount}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid gap-2">
              <Label className="text-xs font-medium text-muted-foreground">
                Receiving Location
              </Label>
              <Select
                value={receivingLocationId || ''}
                onValueChange={(val) => {
                  userOverrodeReceivingLocationRef.current = true;
                  setReceivingLocationId(val || null);
                  setNeedsReceivingLocation(false);
                }}
                disabled={!canEdit || completing}
              >
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Select receiving location..." />
                </SelectTrigger>
                <SelectContent>
                  {allLocations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.code} — {loc.name || loc.location_type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Defaults to your warehouse/account receiving location. You can override it for this intake.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Items Table */}
      <Card>
        <CardHeader>
          {/* When header is hidden, show receiving location in items card */}
          {hideHeader && (
            <div className="grid gap-2 mb-4">
              <div className="flex items-center gap-2 mb-1">
                <Badge variant="outline" className="text-xs gap-1">
                  <MaterialIcon name="inventory_2" size="sm" className="text-primary" />
                  Stage 2
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  Carrier: {shipment.signed_pieces ?? '-'}
                </Badge>
                <Badge variant="secondary" className="text-xs">
                  Dock: {dockCount ?? '-'}
                </Badge>
                <Badge variant={entryCount > 0 ? 'default' : 'outline'} className="text-xs">
                  Entry: {entryCount}
                </Badge>
                <JobTimerWidget
                  jobType="shipment"
                  jobId={shipmentId}
                  variant="inline"
                  showControls={false}
                />
              </div>
              <Label className="text-xs font-medium text-muted-foreground">
                Receiving Location
              </Label>
              <Select
                value={receivingLocationId || ''}
                onValueChange={(val) => {
                  userOverrodeReceivingLocationRef.current = true;
                  setReceivingLocationId(val || null);
                  setNeedsReceivingLocation(false);
                }}
                disabled={!canEdit || completing}
              >
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Select receiving location..." />
                </SelectTrigger>
                <SelectContent>
                  {allLocations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.code} — {loc.name || loc.location_type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <MaterialIcon name="list_alt" size="sm" />
              Items ({items.length})
            </CardTitle>
            <div className="flex flex-col items-end gap-1">
              <AutosaveIndicator status={autosaveStatus} />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowManifestSelector(true)} disabled={!canEdit}>
                  <MaterialIcon name="content_paste_go" size="sm" className="mr-1" />
                  Add From Manifest
                </Button>
                <Button variant="outline" size="sm" onClick={addManualItem} disabled={!canEdit}>
                  <MaterialIcon name="add" size="sm" className="mr-1" />
                  Add Item
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MaterialIcon name="inventory_2" size="xl" className="mb-2 opacity-30" />
              <p>No items added yet.</p>
              <p className="text-sm mt-1">Add items from a linked manifest or enter manually.</p>
              <div className="flex gap-2 justify-center mt-4">
                <Button variant="outline" onClick={() => setShowManifestSelector(true)} disabled={!canEdit}>
                  <MaterialIcon name="content_paste_go" size="sm" className="mr-1" />
                  Add From Manifest
                </Button>
                <Button variant="outline" onClick={addManualItem} disabled={!canEdit}>
                  <MaterialIcon name="add" size="sm" className="mr-1" />
                  Add Item
                </Button>
              </div>
            </div>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {visibleColumns.map((key) => {
                      const def = STAGE2_COLUMNS.find((c) => c.key === key);
                      return (
                        <TableHead key={key} className={def?.headClassName}>
                          {def?.label ?? key}
                        </TableHead>
                      );
                    })}
                    <TableHead className="min-w-[100px]">
                      <div className="flex items-center justify-between gap-2">
                        <span>Actions</span>
                        <Popover open={columnsPopoverOpen} onOpenChange={handleColumnsPopoverOpenChange}>
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              title="Filter & reorder columns"
                              aria-label="Filter & reorder columns"
                            >
                              <MaterialIcon name="view_column" size="sm" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent align="end" className="w-[320px] p-3">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate">Columns</div>
                                <div className="text-xs text-muted-foreground truncate">
                                  Show/hide and drag to reorder
                                </div>
                              </div>
                              <Button type="button" variant="ghost" size="sm" onClick={handleResetColumns}>
                                <MaterialIcon name="restart_alt" size="sm" className="mr-1" />
                                Reset
                              </Button>
                            </div>
                            <Separator className="my-2" />
                            <ScrollArea className="h-[280px] pr-2">
                              <DndContext
                                sensors={columnSensors}
                                collisionDetection={closestCenter}
                                onDragEnd={handleColumnDragEnd}
                              >
                                <SortableContext items={draftColumnOrder} strategy={verticalListSortingStrategy}>
                                  <div className="space-y-2">
                                    {draftColumnOrder.map((colKey) => {
                                      const label = STAGE2_COLUMNS.find((c) => c.key === colKey)?.label ?? colKey;
                                      const visible = !draftHiddenColumns.includes(colKey);
                                      return (
                                        <SortableStage2ColumnRow
                                          key={colKey}
                                          columnKey={colKey}
                                          label={label}
                                          visible={visible}
                                          onToggleVisible={() => toggleDraftColumnVisible(colKey)}
                                        />
                                      );
                                    })}
                                  </div>
                                </SortableContext>
                              </DndContext>
                            </ScrollArea>
                          </PopoverContent>
                        </Popover>
                      </div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <Fragment key={item.id}>
                      <TableRow>
                        {visibleColumns.map((colKey) => {
                          switch (colKey) {
                            case 'code':
                              return (
                                <TableCell key={`${item.id}-code`}>
                                  {item.item_code ? (
                                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-medium">
                                      {item.item_code}
                                    </code>
                                  ) : (
                                    <span className="text-xs text-muted-foreground">
                                      —
                                    </span>
                                  )}
                                </TableCell>
                              );
                            case 'qty':
                              return (
                                <TableCell key={`${item.id}-qty`} className="text-right">
                                  <Input
                                    type="number"
                                    min={0}
                                    value={item.received_quantity}
                                    onChange={(e) => updateItem(item.id, 'received_quantity', parseInt(e.target.value) || 0)}
                                    onBlur={(e) => {
                                      const qty = parseInt(e.currentTarget.value) || 0;
                                      void upsertShipmentItemRow({ ...item, received_quantity: qty });
                                    }}
                                    className="w-20 h-9 text-right ml-auto"
                                    disabled={!canEdit}
                                  />
                                </TableCell>
                              );
                            case 'location': {
                              const currentLocId = item.location_id || receivingLocationId || '';
                              const currentLoc = allLocations.find(l => l.id === currentLocId);
                              const currentLocDisplay = currentLoc ? currentLoc.code : '';
                              return (
                                <TableCell key={`${item.id}-location`}>
                                  <AutocompleteInput
                                    value={currentLocDisplay}
                                    suggestions={allLocations.map(loc => ({
                                      value: loc.code,
                                      label: `${loc.code} — ${loc.name || loc.location_type}`,
                                    }))}
                                    onChange={(value) => {
                                      const matched = allLocations.find(l => l.code === value);
                                      // AutocompleteInput emits on every keystroke; only persist once a real location is selected.
                                      if (!matched) return;
                                      const nextLocation = matched.id;
                                      updateItem(item.id, 'location_id', nextLocation);
                                      const nextRow = { ...item, location_id: nextLocation };
                                      void upsertShipmentItemRow(nextRow);
                                    }}
                                    placeholder="Search location..."
                                    disabled={!canEdit}
                                    className="h-9"
                                  />
                                </TableCell>
                              );
                            }
                            case 'vendor':
                              return (
                                <TableCell key={`${item.id}-vendor`}>
                                  <AutocompleteInput
                                    value={item.vendor}
                                    suggestions={vendorSuggestionOptions}
                                    onChange={(value) => updateItem(item.id, 'vendor', value)}
                                    onBlur={() => persistItemRowWithSuggestion(item.id, 'vendor', addVendorSuggestion)}
                                    placeholder="Vendor"
                                    className="h-9"
                                    disabled={!canEdit}
                                  />
                                </TableCell>
                              );
                            case 'description':
                              return (
                                <TableCell key={`${item.id}-description`}>
                                  <AutocompleteInput
                                    value={item.description}
                                    suggestions={descriptionSuggestionOptions}
                                    onChange={(value) => updateItem(item.id, 'description', value)}
                                    onBlur={() => persistItemRowWithSuggestion(item.id, 'description', addDescriptionSuggestion)}
                                    placeholder="Description"
                                    className="h-9"
                                    disabled={!canEdit}
                                  />
                                </TableCell>
                              );
                            case 'class':
                              return (
                                <TableCell key={`${item.id}-class`}>
                                  <Select
                                    value={item.class_id || '__none__'}
                                    onValueChange={(value) => {
                                      const next = value === '__none__' ? null : value;
                                      updateItem(item.id, 'class_id', next);
                                      void upsertShipmentItemRow({ ...item, class_id: next });
                                    }}
                                    disabled={!canEdit}
                                  >
                                    <SelectTrigger className="h-9">
                                      <SelectValue placeholder={classesLoading ? 'Loading...' : 'Select class'} />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="__none__">No class</SelectItem>
                                      {classes.map((cls) => (
                                        <SelectItem key={cls.id} value={cls.id}>
                                          {cls.code} - {cls.name}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                </TableCell>
                              );
                            case 'sidemark':
                              return (
                                <TableCell key={`${item.id}-sidemark`}>
                                  <SidemarkSelect
                                    accountId={shipment.account_id}
                                    value={item.sidemark_id || null}
                                    onChange={(value) => {
                                      void handleSidemarkSelect(item, value);
                                    }}
                                    placeholder={item.sidemark || 'Select sidemark...'}
                                    className="h-9 min-h-9 text-sm"
                                    disabled={!canEdit}
                                    clearable
                                    allowCreate
                                  />
                                </TableCell>
                              );
                            case 'room':
                              return (
                                <TableCell key={`${item.id}-room`}>
                                  <AutocompleteInput
                                    value={item.room}
                                    suggestions={roomSuggestionOptions}
                                    onChange={(value) => updateItem(item.id, 'room', value)}
                                    onBlur={() => persistItemRowWithSuggestion(item.id, 'room', addRoomSuggestion)}
                                    placeholder="Room"
                                    className="h-9"
                                    disabled={!canEdit}
                                  />
                                </TableCell>
                              );
                          }
                        })}
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            <Badge variant="outline" className="text-xs">
                              <MaterialIcon name="flag" size="sm" className="mr-1" />
                              {item.flags.length}
                            </Badge>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => toggleRowExpanded(item.id)}
                              className="h-8 w-8 p-0"
                              title="Flags"
                            >
                              <MaterialIcon
                                name={expandedRows.has(item.id) ? 'expand_less' : 'expand_more'}
                                size="sm"
                              />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => duplicateItem(item.id)}
                              className="h-8 w-8 p-0"
                              title="Duplicate item"
                              disabled={!canEdit}
                            >
                              <MaterialIcon name="content_copy" size="sm" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeItem(item)}
                              className="h-8 w-8 p-0 text-red-500 hover:text-red-700"
                              title="Remove item"
                              disabled={!canEdit || !showCompleteButton}
                            >
                              <MaterialIcon name="delete" size="sm" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                      {expandedRows.has(item.id) && (
                        <TableRow className="bg-muted/30">
                          <TableCell colSpan={visibleColumns.length + 1}>
                            <div className="space-y-3 py-2">
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>
                                  Source: {item.sourceType}
                                  {item.expected_quantity > 0 ? ` · Expected Qty: ${item.expected_quantity}` : ''}
                                </span>
                                <span>Flag tray</span>
                              </div>
                              <div className="space-y-4">
                                {/* Built-in item exceptions */}
                                <div className="space-y-2">
                                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                    <MaterialIcon name="verified" size="sm" />
                                    Item exceptions (built-in)
                                  </div>
                                  <div className="flex flex-wrap gap-x-5 gap-y-2">
                                    {BUILTIN_ITEM_EXCEPTION_FLAGS.map((f) => {
                                      const checked = item.flags.includes(f.code);
                                      return (
                                        <label
                                          key={`${item.id}-${f.code}`}
                                          className="flex items-center gap-2 text-sm cursor-pointer"
                                          title={f.description}
                                        >
                                          <Checkbox
                                            checked={checked}
                                            onCheckedChange={() => toggleItemFlag(item.id, f.code)}
                                            disabled={!canEdit}
                                          />
                                          <span>{f.label}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                </div>

                                {/* Pricing/service flags */}
                                <div className="space-y-2">
                                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                    <MaterialIcon name="tune" size="sm" />
                                    Service flags (from Pricing)
                                  </div>
                                  {flagServicesLoading ? (
                                    <div className="text-sm text-muted-foreground">Loading flags…</div>
                                  ) : flagServiceEvents.length === 0 ? (
                                    <div className="text-sm text-muted-foreground">No service flags configured.</div>
                                  ) : (
                                    <div className="flex flex-wrap gap-x-5 gap-y-2">
                                      {flagServiceEvents.map((flag) => {
                                        const checked = item.flags.includes(flag.service_code);
                                        return (
                                          <label
                                            key={`${item.id}-${flag.service_code}`}
                                            className="flex items-center gap-2 text-sm cursor-pointer"
                                            title={flag.notes || undefined}
                                          >
                                            <Checkbox
                                              checked={checked}
                                              onCheckedChange={() => toggleItemFlag(item.id, flag.service_code)}
                                              disabled={!canEdit}
                                            />
                                            <span>{flag.service_name}</span>
                                          </label>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Complete Button */}
      {showCompleteButton ? (
        <div className="flex flex-col sm:flex-row gap-3 justify-end">
          <Button
            size="lg"
            onClick={() => void handleCompleteClick()}
            disabled={completing || !canEdit}
            className="gap-2"
          >
            {completing ? (
              <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
            ) : (
              <MaterialIcon name="check_circle" size="sm" />
            )}
            Complete Receiving
          </Button>
        </div>
      ) : null}

      {/* Full-screen manifest selector */}
      <AddFromManifestSelector
        shipmentId={shipmentId}
        accountId={shipment.account_id}
        open={showManifestSelector}
        onClose={() => setShowManifestSelector(false)}
        onAdd={handleAddFromManifest}
        onOpenMatchingPanel={() => {
          setShowManifestSelector(false);
          setShowMatchingPanel(true);
        }}
      />

      {/* Complete Confirmation Dialog */}
      {showCompleteButton ? (
        <Dialog open={showCompleteDialog} onOpenChange={setShowCompleteDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Complete Receiving?</DialogTitle>
              <DialogDescription>
                This will close the shipment and finalize item records for all received entries.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="flex justify-between text-sm">
                <span>Carrier count:</span>
                <span className="font-medium">{shipment.signed_pieces ?? '-'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Dock Count:</span>
                <span className="font-medium">{dockCount ?? '-'}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Entry Count:</span>
                <span className="font-medium">{entryCount}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Items:</span>
                <span className="font-medium">{items.length}</span>
              </div>
              {typeof dockCount === 'number' && dockCount > 0 && entryCount > 0 && entryCount !== dockCount && (
                <div className="p-2 bg-amber-50 border border-amber-200 rounded-md text-sm text-amber-800">
                  <MaterialIcon name="warning" size="sm" className="inline mr-1" />
                  Dock Count and Entry Count are different.
                </div>
              )}
              {needsReceivingLocation ? (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Receiving Location</Label>
                    <Select
                      value={receivingLocationId || ''}
                      onValueChange={(val) => {
                        userOverrodeReceivingLocationRef.current = true;
                        setReceivingLocationId(val || null);
                        setNeedsReceivingLocation(false);
                      }}
                      disabled={!canEdit || completing}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select location..." />
                      </SelectTrigger>
                      <SelectContent>
                        {allLocations.map((loc) => (
                          <SelectItem key={loc.id} value={loc.id}>
                            {loc.code} — {loc.name || loc.location_type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      Choose where received items will be placed. Configure a default receiving location in warehouse settings to skip this step.
                    </p>
                  </div>
                </>
              ) : null}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowCompleteDialog(false)} disabled={completing}>
                Cancel
              </Button>
              <Button onClick={() => handleComplete(false)} disabled={completing || !canEdit}>
                {completing ? (
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                ) : (
                  <MaterialIcon name="check_circle" size="sm" className="mr-2" />
                )}
                Complete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {/* Container Placement Dialog */}
      <Dialog
        open={!!containerPromptItemId}
        onOpenChange={(open) => { if (!open) setContainerPromptItemId(null); }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="package_2" size="sm" />
              Container Placement
            </DialogTitle>
            <DialogDescription>
              You're receiving {containerPromptQty} units. How should they be containerized?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Button
              variant="outline"
              className="w-full justify-start gap-3 h-auto py-3"
              onClick={() => containerPromptItemId && applyContainerChoice(containerPromptItemId, 1)}
            >
              <MaterialIcon name="inbox" size="sm" className="text-primary" />
              <div className="text-left">
                <div className="font-medium">All in 1 container</div>
                <div className="text-xs text-muted-foreground">
                  {containerPromptQty} units grouped in a single container
                </div>
              </div>
            </Button>
            <Button
              variant="outline"
              className="w-full justify-start gap-3 h-auto py-3"
              onClick={() => containerPromptItemId && applyContainerChoice(containerPromptItemId, containerPromptQty)}
            >
              <MaterialIcon name="grid_view" size="sm" className="text-primary" />
              <div className="text-left">
                <div className="font-medium">{containerPromptQty} separate containers</div>
                <div className="text-xs text-muted-foreground">
                  1 unit per container
                </div>
              </div>
            </Button>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                className="flex-1 justify-start gap-3 h-auto py-3"
                onClick={() => containerPromptItemId && applyContainerChoice(containerPromptItemId, customContainerCount)}
              >
                <MaterialIcon name="tune" size="sm" className="text-primary" />
                <div className="text-left">
                  <div className="font-medium">Custom</div>
                  <div className="text-xs text-muted-foreground">Split across containers</div>
                </div>
              </Button>
              <Input
                type="number"
                min={2}
                max={containerPromptQty}
                value={customContainerCount}
                onChange={(e) => setCustomContainerCount(Math.max(2, Math.min(containerPromptQty, parseInt(e.target.value) || 2)))}
                className="w-20 h-10"
              />
            </div>
            <Separator />
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 h-auto py-3 text-muted-foreground"
              onClick={() => containerPromptItemId && applyContainerChoice(containerPromptItemId, 0)}
            >
              <MaterialIcon name="close" size="sm" />
              <div className="text-left">
                <div className="font-medium">No containers</div>
                <div className="text-xs text-muted-foreground">Units stored individually without containers</div>
              </div>
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Admin Override Dialog */}
      <Dialog open={showAdminOverride} onOpenChange={setShowAdminOverride}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="admin_panel_settings" size="sm" />
              Admin Override
            </DialogTitle>
            <DialogDescription>
              Completing without any items requires admin authorization and a reason.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Override Reason <span className="text-red-500">*</span></Label>
              <Textarea
                placeholder="Explain why receiving is being completed without items..."
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdminOverride(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => handleComplete(true)}
              disabled={!overrideReason.trim() || completing}
            >
              {completing ? (
                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
              ) : (
                <MaterialIcon name="admin_panel_settings" size="sm" className="mr-2" />
              )}
              Override & Complete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
