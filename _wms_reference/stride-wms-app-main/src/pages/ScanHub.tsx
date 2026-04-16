import { useState, useRef, useCallback, useEffect } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useSidebar } from '@/contexts/SidebarContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useLocations } from '@/hooks/useLocations';
import { useStocktakeFreezeCheck } from '@/hooks/useStocktakes';
import { useServiceEvents, ServiceEventForScan } from '@/hooks/useServiceEvents';
import { usePermissions } from '@/hooks/usePermissions';
import { useAuth } from '@/contexts/AuthContext';
import { useOrgPreferences } from '@/hooks/useOrgPreferences';
import { QRScanner } from '@/components/scan/QRScanner';
import { ItemSearchOverlay, LocationSearchOverlay } from '@/components/scan/SearchOverlays';
import { useScanEngine } from '@/hooks/useScanEngine';
import { useItemOnlyScanMode } from '@/lib/scan/modes/useItemOnlyScanMode';
import { useItemToLocationScanMode } from '@/lib/scan/modes/useItemToLocationScanMode';
import { useLookupScanMode } from '@/lib/scan/modes/useLookupScanMode';
import { useOperationsScanMode } from '@/lib/scan/modes/useOperationsScanMode';
import {
  hapticLight,
  hapticMedium,
  hapticSuccess,
  hapticError,
} from '@/lib/haptics';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { logItemActivity } from '@/lib/activity/logItemActivity';
import { parseScanPayload } from '@/lib/scan/parseScanPayload';
import { isValidUuid } from '@/lib/utils';
import { isLikelyLocationCode as isLikelyLocationCodeUtil } from '@/lib/scan/isLikelyLocationCode';
import { lookupItemByScan } from '@/lib/scan/lookupItemByScan';
import { playScanAudioFeedback } from '@/lib/scan/scanAudioFeedback';
import { evaluateSpecialStorageCompliance } from '@/lib/capacity/capacityModule';
import { ScanModeIcon } from '@/components/scan/ScanModeIcon';
import { HelpButton } from '@/components/prompts';
import { SOPValidationDialog, SOPBlocker } from '@/components/common/SOPValidationDialog';
import { useLocationSuggestions, type LocationSuggestion } from '@/hooks/useLocationSuggestions';
import { SuggestionPanel } from '@/components/scanhub/SuggestionPanel';
import { CrossWarehouseBanner } from '@/components/scanhub/CrossWarehouseBanner';
import { OverrideConfirmModal, type OverrideReason } from '@/components/scanhub/OverrideConfirmModal';
import { useSelectedWarehouse } from '@/contexts/WarehouseContext';
import {
  AlertDialog,
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

interface ScannedItem {
  id: string;
  item_code: string;
  description: string | null;
  current_location_code: string | null;
  warehouse_name: string | null;
}

interface ServiceScannedItem extends ScannedItem {
  class_code: string | null;
  account_id: string | null;
  account_name: string | null;
  sidemark_id: string | null;
}

interface ScannedLocation {
  id: string;
  code: string;
  name: string | null;
  type?: string;
}

interface ScannedContainer {
  id: string;
  container_code: string;
  container_type: string | null;
  status: string;
  location_id: string | null;
  location_code: string | null;
}

type ScanMode = 'move' | 'batch' | 'lookup' | 'service' | 'container' | null;
type ScanPhase = 'idle' | 'scanning-item' | 'scanning-location' | 'confirm';

export default function ScanHub() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile } = useAuth();
  const { locations } = useLocations();
  const { preferences: orgPrefs } = useOrgPreferences();
  const { checkFreeze } = useStocktakeFreezeCheck();
  const { scanServiceEvents, getServiceRate, createBillingEvents, loading: serviceEventsLoading } = useServiceEvents();
  const { collapseSidebar } = useSidebar();
  const { hasRole } = usePermissions();
  const { selectedWarehouseId, warehouses: contextWarehouses } = useSelectedWarehouse();

  // Role-based visibility for billing features (managers and above)
  const canSeeBilling = hasRole('admin') || hasRole('manager') || hasRole('billing_manager');
  const canManagerOverride =
    hasRole('admin') || hasRole('manager') || hasRole('admin_dev');

  const [mode, setMode] = useState<ScanMode>(null);
  const [phase, setPhase] = useState<ScanPhase>('idle');
  const [processing, setProcessing] = useState(false);

  // Move mode state
  const [scannedItem, setScannedItem] = useState<ScannedItem | null>(null);
  const [targetLocation, setTargetLocation] = useState<ScannedLocation | null>(null);

  // Batch move state
  const [batchItems, setBatchItems] = useState<ScannedItem[]>([]);

  // Quarantine warning state
  const [quarantineWarningOpen, setQuarantineWarningOpen] = useState(false);
  const [quarantineItem, setQuarantineItem] = useState<ScannedItem | null>(null);
  const [quarantinePendingAction, setQuarantinePendingAction] = useState<(() => void) | null>(null);

  /**
   * Scan pipeline refs
   *
   * Camera scanners can emit multiple scans before React state updates flush.
   * We mirror key state in refs + queue scans to avoid stale `phase` causing
   * location scans to be handled as "scan item first".
   */
  const processingRef = useRef(false);
  const inFlightScanRef = useRef<string | null>(null);
  const scanQueueRef = useRef<string[]>([]);
  const modeRef = useRef<ScanMode>(mode);
  const phaseRef = useRef<ScanPhase>(phase);
  const scannedItemRef = useRef<ScannedItem | null>(scannedItem);
  const targetLocationRef = useRef<ScannedLocation | null>(targetLocation);
  const batchItemsRef = useRef<ScannedItem[]>(batchItems);
  const quarantineWarningOpenRef = useRef<boolean>(quarantineWarningOpen);
  const quarantineChargeCodeCacheRef = useRef<{
    tenantId: string | null;
    loaded: boolean;
    chargeCode: string | null;
  }>({ tenantId: null, loaded: false, chargeCode: null });
  const classCodeCacheRef = useRef<{
    tenantId: string | null;
    loaded: boolean;
    byId: Map<string, string | null>;
  }>({ tenantId: null, loaded: false, byId: new Map() });

  useEffect(() => {
    modeRef.current = mode;
    phaseRef.current = phase;
    scannedItemRef.current = scannedItem;
    targetLocationRef.current = targetLocation;
    batchItemsRef.current = batchItems;
    quarantineWarningOpenRef.current = quarantineWarningOpen;
  }, [mode, phase, scannedItem, targetLocation, batchItems, quarantineWarningOpen]);

  // Service mode starts with scanning first; ensure camera area is in view.
  useEffect(() => {
    if (mode !== 'service') return;
    requestAnimationFrame(() => {
      serviceScannerRef.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
      window.scrollTo({ top: 0, behavior: 'auto' });
    });
  }, [mode]);

  const setModeSafe = (next: ScanMode) => {
    modeRef.current = next;
    setMode(next);
  };

  const setPhaseSafe = (next: ScanPhase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const setScannedItemSafe = (next: ScannedItem | null) => {
    scannedItemRef.current = next;
    setScannedItem(next);
  };

  const setTargetLocationSafe = (next: ScannedLocation | null) => {
    targetLocationRef.current = next;
    setTargetLocation(next);
  };

  const setBatchItemsSafe = (next: ScannedItem[] | ((prev: ScannedItem[]) => ScannedItem[])) => {
    setBatchItems((prev) => {
      const computed = typeof next === 'function' ? (next as (p: ScannedItem[]) => ScannedItem[])(prev) : next;
      batchItemsRef.current = computed;
      return computed;
    });
  };

  const setQuarantineWarningOpenSafe = (next: boolean) => {
    quarantineWarningOpenRef.current = next;
    setQuarantineWarningOpen(next);
  };

  // Service event scan state
  const [serviceItems, setServiceItems] = useState<ServiceScannedItem[]>([]);
  const [selectedServices, setSelectedServices] = useState<ServiceEventForScan[]>([]);
  const serviceScannerRef = useRef<HTMLDivElement | null>(null);

  type ContainerScanUnitRow = {
    id: string;
    ic_code: string;
    status: string;
    class: string | null;
    added: boolean;
    message?: string;
  };

  type OperationsPackedItemRow = {
    id: string;
    item_code: string;
    added: boolean;
    message?: string;
  };

  // Container scan state (scan container, then scan inventory units into it)
  const [containerTarget, setContainerTarget] = useState<ScannedContainer | null>(null);
  const [containerScanValue, setContainerScanValue] = useState('');
  const [containerScannedUnits, setContainerScannedUnits] = useState<ContainerScanUnitRow[]>([]);
  const [containerPendingUnits, setContainerPendingUnits] = useState<Array<{
    id: string;
    ic_code: string;
    status: string;
    class: string | null;
    location_id: string;
    container_id: string | null;
  }>>([]);
  const containerScanInputRef = useRef<HTMLInputElement>(null);
  const containerTargetRef = useRef<ScannedContainer | null>(null);
  const containerScannedCodeSetRef = useRef<Set<string>>(new Set());
  const containerPendingUnitsRef = useRef<typeof containerPendingUnits>([]);
  const containerPendingCodeSetRef = useRef<Set<string>>(new Set());
  const [containerSessionScannedItems, setContainerSessionScannedItems] = useState<OperationsPackedItemRow[]>([]);
  const containerSessionScannedItemSetRef = useRef<Set<string>>(new Set());
  const operationsBlockRef = useRef<(reason: string, code?: string) => void>(() => {});

  const setContainerTargetSafe = (next: ScannedContainer | null) => {
    containerTargetRef.current = next;
    setContainerTarget(next);
  };

  const setContainerPendingUnitsSafe = (next: typeof containerPendingUnits | ((prev: typeof containerPendingUnits) => typeof containerPendingUnits)) => {
    setContainerPendingUnits((prev) => {
      const computed = typeof next === 'function' ? (next as any)(prev) : next;
      containerPendingUnitsRef.current = computed;
      return computed;
    });
  };

  // Search overlay state
  const [showItemSearch, setShowItemSearch] = useState(false);
  const [showLocationSearch, setShowLocationSearch] = useState(false);

  // SOP Validation state
  const [sopValidationOpen, setSopValidationOpen] = useState(false);
  const [sopBlockers, setSopBlockers] = useState<SOPBlocker[]>([]);

  // Location suggestions state
  const [suggestionsWarehouseId, setSuggestionsWarehouseId] = useState<string | undefined>();
  const [suggestionsWarning, setSuggestionsWarning] = useState<string | null>(null);

  // Cross-warehouse mismatch state
  const [crossWarehouseInfo, setCrossWarehouseInfo] = useState<{
    itemWarehouse: string;
    destWarehouse: string;
    isMixedBatch?: boolean;
  } | null>(null);

  // Override modal state
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);
  const [overrideBlockingReasons, setOverrideBlockingReasons] = useState<OverrideReason[]>([]);
  const [overrideAllReasons, setOverrideAllReasons] = useState<OverrideReason[]>([]);
  const [overrideResolve, setOverrideResolve] = useState<((confirmed: boolean) => void) | null>(null);

  // Swipe confirmation state
  const [swipeProgress, setSwipeProgress] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const swipeStartX = useRef(0);
  const swipeContainerRef = useRef<HTMLDivElement>(null);

  // Derive warehouse_id for suggestions.
  // Precedence: item-derived (authoritative) → selectedWarehouseId (fallback) → disabled.
  useEffect(() => {
    setSuggestionsWarning(null);

    if (mode === 'move' && scannedItem) {
      if (scannedItem.current_location_code) {
        const loc = locations.find(l => l.code === scannedItem.current_location_code);
        if (loc) {
          // Item warehouse is authoritative
          setSuggestionsWarehouseId(loc.warehouse_id);
          return;
        }
      }
      // Can't derive from item — fall back to shared selection
      if (selectedWarehouseId) {
        setSuggestionsWarehouseId(selectedWarehouseId);
        return;
      }
      setSuggestionsWarehouseId(undefined);
      return;
    }

    if (mode === 'batch' && batchItems.length > 0) {
      const warehouseIds = new Set<string>();
      for (const item of batchItems) {
        if (item.current_location_code) {
          const loc = locations.find(l => l.code === item.current_location_code);
          if (loc) warehouseIds.add(loc.warehouse_id);
        }
      }

      if (warehouseIds.size === 1) {
        setSuggestionsWarehouseId([...warehouseIds][0]);
        return;
      }

      if (warehouseIds.size > 1) {
        setSuggestionsWarning('Items span multiple warehouses. Suggestions unavailable \u2014 select a single-warehouse batch.');
        setSuggestionsWarehouseId(undefined);
        return;
      }

      // No items had a resolvable warehouse
      setSuggestionsWarehouseId(undefined);
      return;
    }

    // No items scanned yet — use shared selection if available
    if (selectedWarehouseId) {
      setSuggestionsWarehouseId(selectedWarehouseId);
    } else {
      setSuggestionsWarehouseId(undefined);
    }
  }, [scannedItem, batchItems, locations, mode, selectedWarehouseId]);

  // Location suggestions hook
  const suggestionsEnabled =
    (mode === 'move' && !!scannedItem) || (mode === 'batch' && batchItems.length > 0);

  const {
    suggestions,
    loading: suggestionsLoading,
    error: suggestionsError,
    refetch: refetchSuggestions,
  } = useLocationSuggestions({
    tenantId: profile?.tenant_id,
    warehouseId: suggestionsWarehouseId,
    mode: mode === 'batch' ? 'batch' : 'single',
    itemId: mode === 'move' ? scannedItem?.id : undefined,
    itemIds: mode === 'batch' ? batchItems.map(i => i.id) : undefined,
    enabled: suggestionsEnabled,
  });

  // Cross-warehouse mismatch detection
  useEffect(() => {
    if (!targetLocation) {
      setCrossWarehouseInfo(null);
      return;
    }

    const destLoc = locations.find(l => l.id === targetLocation.id);
    if (!destLoc?.warehouse_id) {
      setCrossWarehouseInfo(null);
      return;
    }

    // Determine item warehouse
    let itemWarehouseId: string | undefined;
    let itemWarehouseName: string | undefined;
    let isMixedBatch = false;

    if (mode === 'move' && scannedItem) {
      const itemLoc = locations.find(l => l.code === scannedItem.current_location_code);
      itemWarehouseId = itemLoc?.warehouse_id;
      itemWarehouseName = scannedItem.warehouse_name || undefined;
    } else if (mode === 'batch' && batchItems.length > 0) {
      const warehouseIds = new Set<string>();
      for (const item of batchItems) {
        if (item.current_location_code) {
          const loc = locations.find(l => l.code === item.current_location_code);
          if (loc) warehouseIds.add(loc.warehouse_id);
        }
      }
      if (warehouseIds.size === 1) {
        itemWarehouseId = [...warehouseIds][0];
      } else if (warehouseIds.size > 1) {
        isMixedBatch = true;
      }
    }

    if (isMixedBatch) {
      const destWh = contextWarehouses.find(w => w.id === destLoc.warehouse_id);
      setCrossWarehouseInfo({
        itemWarehouse: 'multiple warehouses',
        destWarehouse: destWh?.name || 'Unknown',
        isMixedBatch: true,
      });
      return;
    }

    if (itemWarehouseId && destLoc.warehouse_id !== itemWarehouseId) {
      const destWh = contextWarehouses.find(w => w.id === destLoc.warehouse_id);
      const itemWh = contextWarehouses.find(w => w.id === itemWarehouseId);
      setCrossWarehouseInfo({
        itemWarehouse: itemWarehouseName || itemWh?.name || 'Unknown',
        destWarehouse: destWh?.name || 'Unknown',
      });
    } else {
      setCrossWarehouseInfo(null);
    }
  }, [targetLocation, scannedItem, batchItems, locations, mode, contextWarehouses]);

  // Override modal helpers
  const openOverrideModalAndAwait = (
    blockingReasons: OverrideReason[],
    allReasons: OverrideReason[],
  ): Promise<boolean> => {
    return new Promise((resolve) => {
      setOverrideBlockingReasons(blockingReasons);
      setOverrideAllReasons(allReasons);
      setOverrideResolve(() => resolve);
      setOverrideModalOpen(true);
    });
  };

  const handleOverrideConfirm = () => {
    setOverrideModalOpen(false);
    if (overrideResolve) overrideResolve(true);
    setOverrideResolve(null);
  };

  const handleOverrideCancel = () => {
    setOverrideModalOpen(false);
    if (overrideResolve) overrideResolve(false);
    setOverrideResolve(null);
  };

  // Evaluate override reasons for a destination location
  const evaluateOverrideReasons = async (
    destLocationId: string,
    items: ScannedItem[],
  ): Promise<{
    allReasons: OverrideReason[];
    blockingReasons: OverrideReason[];
    requiredVolume: number;
    preUtilization: number;
    postUtilization: number;
    itemDataForAudit: Array<{ id: string; current_location_id: string | null }>;
  }> => {
    const allReasons: OverrideReason[] = [];
    const blockingReasons: OverrideReason[] = [];

    // Fetch item sizes and current location IDs
    const itemIds = items.map(i => i.id);
    const { data: itemData } = await (supabase as any)
      .from('items')
      .select('id, size, current_location_id')
      .in('id', itemIds);

    const requiredVolume = (itemData || []).reduce(
      (sum: number, i: { size: number | null }) => sum + (i.size || 0),
      0,
    );

    // Check if destination is in the suggestions
    const destSuggestion = suggestions.find((s: LocationSuggestion) => s.location_id === destLocationId);

    let destCapacity = 0;
    let destUsed = 0;
    let destAvailable = 0;
    let destUtilPct = 0;
    let destFlagCompliant = true;

    if (destSuggestion) {
      destCapacity = destSuggestion.capacity_cuft;
      destUsed = destSuggestion.used_cuft;
      destAvailable = destSuggestion.available_cuft;
      destUtilPct = destSuggestion.utilization_pct;
      destFlagCompliant = destSuggestion.flag_compliant;
    } else {
      // Strategy (b): Query location_capacity_cache + locations for non-suggested destination
      const { data: cacheData } = await (supabase as any)
        .from('location_capacity_cache')
        .select('used_cuft, available_cuft, utilization_pct')
        .eq('location_id', destLocationId)
        .maybeSingle();

      const { data: locData } = await (supabase
        .from('locations') as any)
        .select('capacity_cuft')
        .eq('id', destLocationId)
        .maybeSingle();

      destCapacity = locData?.capacity_cuft ? Number(locData.capacity_cuft) : 0;
      destUsed = cacheData?.used_cuft ? Number(cacheData.used_cuft) : 0;
      destAvailable = cacheData?.available_cuft != null ? Number(cacheData.available_cuft) : destCapacity;
      destUtilPct = cacheData?.utilization_pct ? Number(cacheData.utilization_pct) : 0;
    }

    const destinationWarehouseId =
      locations.find((location) => location.id === destLocationId)?.warehouse_id || null;
    const complianceWarehouseId = suggestionsWarehouseId || destinationWarehouseId || selectedWarehouseId;
    if (profile?.tenant_id && complianceWarehouseId) {
      try {
        const compliance = await evaluateSpecialStorageCompliance({
          tenantId: profile.tenant_id,
          warehouseId: complianceWarehouseId,
          itemIds: items.map((item) => item.id),
          destinationLocationId: destLocationId,
        });
        destFlagCompliant = compliance.isCompliant;
      } catch {
        // If compliance check fails, default to compliant (non-blocking)
        destFlagCompliant = true;
      }
    }

    // Compute predicted utilization
    if (destCapacity > 0) {
      const predictedUsed = destUsed + requiredVolume;
      const predictedUtil = predictedUsed / destCapacity;

      if (predictedUtil >= 0.90) {
        allReasons.push('OVER_UTILIZATION');
        blockingReasons.push('OVER_UTILIZATION');
      }

      if (requiredVolume > destAvailable) {
        allReasons.push('OVERFLOW');
        blockingReasons.push('OVERFLOW');
      }
    }

    if (!destFlagCompliant) {
      allReasons.push('FLAG_MISMATCH');
      blockingReasons.push('FLAG_MISMATCH');
    }

    // MIXED_SOURCE_BATCH (informational only)
    if (items.length > 1 && itemData) {
      const distinctLocations = new Set(
        (itemData as Array<{ current_location_id: string | null }>)
          .map(i => i.current_location_id)
          .filter(Boolean),
      );
      if (distinctLocations.size > 1) {
        allReasons.push('MIXED_SOURCE_BATCH');
      }
    }

    const postUtilization = destCapacity > 0
      ? (destUsed + requiredVolume) / destCapacity
      : 0;

    return {
      allReasons,
      blockingReasons,
      requiredVolume,
      preUtilization: destUtilPct,
      postUtilization,
      itemDataForAudit: (itemData || []).map((i: { id: string; current_location_id: string | null }) => ({
        id: i.id,
        current_location_id: i.current_location_id,
      })),
    };
  };

  const lookupItem = async (input: string): Promise<ScannedItem | null> => {
    return await lookupItemByScan(input, { tenantId: profile?.tenant_id });
  };

  const getQuarantineChargeCode = async (): Promise<string | null> => {
    const tenantId = profile?.tenant_id || null;
    if (!tenantId) return null;

    if (
      quarantineChargeCodeCacheRef.current.loaded &&
      quarantineChargeCodeCacheRef.current.tenantId === tenantId
    ) {
      return quarantineChargeCodeCacheRef.current.chargeCode;
    }

    const { data: quarantineFlag } = await (supabase
      .from('charge_types') as any)
      .select('charge_code')
      .eq('tenant_id', tenantId)
      .eq('add_flag', true)
      .eq('flag_is_indicator', true)
      .ilike('charge_name', '%quarantine%')
      .maybeSingle();

    quarantineChargeCodeCacheRef.current = {
      tenantId,
      loaded: true,
      chargeCode: quarantineFlag?.charge_code || null,
    };

    return quarantineChargeCodeCacheRef.current.chargeCode;
  };

  const resolveClassCode = async (classId: string | null | undefined): Promise<string | null> => {
    if (!classId) return null;

    const tenantId = profile?.tenant_id || null;
    if (classCodeCacheRef.current.tenantId !== tenantId) {
      classCodeCacheRef.current = {
        tenantId,
        loaded: false,
        byId: new Map(),
      };
    }

    if (classCodeCacheRef.current.byId.has(classId)) {
      return classCodeCacheRef.current.byId.get(classId) || null;
    }

    let query = (supabase as any)
      .from('classes')
      .select('id, code')
      .eq('id', classId)
      .maybeSingle();

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data, error } = await query;
    const resolved = !error && data?.code ? String(data.code) : null;
    classCodeCacheRef.current.byId.set(classId, resolved);
    classCodeCacheRef.current.loaded = true;
    return resolved;
  };

  // Extended lookup for service events - includes class, account, sidemark
  const lookupItemForService = async (input: string): Promise<ServiceScannedItem | null> => {
    const payload = parseScanPayload(input);
    if (!payload) return null;
    if (payload.type === 'location' || payload.type === 'container') return null;

    const raw = input.trim();
    const codeCandidate = (payload.code || payload.id || raw).trim();
    const idCandidate =
      (payload.type === 'item' && payload.id && isValidUuid(payload.id))
        ? payload.id
        : (codeCandidate && isValidUuid(codeCandidate))
          ? codeCandidate
          : null;

    // Fetch item columns + safe FK joins (account, location, warehouse).
    // NOTE: items.class_id has NO FK constraint to classes, so class is resolved separately.
    const buildServiceQuery = () => {
      let query = supabase
      .from('items')
      .select(`
        id,
        item_code,
        description,
        account_id,
        sidemark_id,
        class_id,
        account:accounts(account_name),
        location:locations!current_location_id(code),
        warehouse:warehouses(name)
      `)
      .is('deleted_at', null);

      if (profile?.tenant_id) {
        query = query.eq('tenant_id', profile.tenant_id);
      }

      return query;
    };

    const mapServiceRow = async (details: any): Promise<ServiceScannedItem> => ({
      id: details.id,
      item_code: details.item_code,
      description: details.description,
      current_location_code: (details.location as any)?.code || null,
      warehouse_name: (details.warehouse as any)?.name || null,
      class_code: await resolveClassCode(details.class_id || null),
      account_id: details.account_id || null,
      account_name: (details.account as any)?.account_name || null,
      sidemark_id: details.sidemark_id || null,
    });

    if (idCandidate) {
      const { data: byId, error: byIdError } = await buildServiceQuery()
        .eq('id', idCandidate)
        .maybeSingle();
      if (!byIdError && byId) {
        return await mapServiceRow(byId);
      }
    }

    if (!codeCandidate) return null;

    const normalizedCandidates = Array.from(
      new Set([
        codeCandidate,
        codeCandidate.replace(/[_\s]+/g, '-'),
      ]),
    )
      .map((c) => c.trim())
      .filter(Boolean);

    const exactCandidates = Array.from(
      new Set(
        normalizedCandidates
          .flatMap((c) => [c, c.toUpperCase()])
          .map((c) => c.trim())
          .filter(Boolean),
      ),
    );

    if (exactCandidates.length > 0) {
      const { data: byExact, error: byExactError } = await buildServiceQuery()
        .in('item_code', exactCandidates)
        .limit(1)
        .maybeSingle();
      if (!byExactError && byExact) {
        return await mapServiceRow(byExact);
      }
    }

    const escapedCaseInsensitive = codeCandidate.replace(/([\\%_])/g, '\\$1');
    const { data: byCaseInsensitive, error: byCaseInsensitiveError } = await buildServiceQuery()
      .ilike('item_code', escapedCaseInsensitive)
      .limit(1)
      .maybeSingle();

    if (!byCaseInsensitiveError && byCaseInsensitive) {
      return await mapServiceRow(byCaseInsensitive);
    }

    return null;
  };

  const lookupLocation = async (input: string): Promise<ScannedLocation | null> => {
    const payload = parseScanPayload(input);
    if (!payload) return null;

    // Check if it's a location QR with explicit type
    if (payload.type === 'location' && payload.id) {
      // The label generator stores the location CODE in the id field (not a UUID).
      // Try matching by code first (most common path for scanned location labels).
      const codeFromPayload = (payload.code || payload.id).trim();
      const locByCode = locations.find(l =>
        l.code.toLowerCase() === codeFromPayload.toLowerCase()
      );
      if (locByCode) {
        return { id: locByCode.id, code: locByCode.code, name: locByCode.name, type: locByCode.type };
      }

      // Try matching by UUID id (in case a future payload uses real UUIDs)
      const locById = locations.find(l => l.id === payload.id);
      if (locById) {
        return { id: locById.id, code: locById.code, name: locById.name, type: locById.type };
      }

      // Fallback: query DB by code first, then by id
      const escapedCode = codeFromPayload.replace(/([\\%_])/g, '\\$1');
      const { data: dbByCode } = await supabase
        .from('locations')
        .select('id, code, name, type')
        .ilike('code', escapedCode)
        .is('deleted_at', null)
        .maybeSingle();
      if (dbByCode) {
        return { id: dbByCode.id, code: dbByCode.code, name: dbByCode.name, type: dbByCode.type || undefined };
      }

      // Only try by UUID if it looks like one (avoid Postgres UUID parse errors)
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRegex.test(payload.id)) {
        const { data: dbById } = await supabase
          .from('locations')
          .select('id, code, name, type')
          .eq('id', payload.id)
          .is('deleted_at', null)
          .maybeSingle();
        if (dbById) {
          return { id: dbById.id, code: dbById.code, name: dbById.name, type: dbById.type || undefined };
        }
      }
    }
    
    // Try matching by code against in-memory locations (case-insensitive)
    const codeToMatch = (payload.code || input).trim();
    const loc = locations.find(l => 
      l.code.toLowerCase() === codeToMatch.toLowerCase()
    );
    if (loc) {
      return { id: loc.id, code: loc.code, name: loc.name, type: loc.type };
    }

    // Fallback: query DB by code if not found in memory
    // Escape LIKE wildcards so ILIKE behaves like a case-insensitive exact match.
    const escapedCodeToMatch = codeToMatch.replace(/([\\%_])/g, '\\$1');
    const { data: dbLoc } = await supabase
      .from('locations')
      .select('id, code, name, type')
      .ilike('code', escapedCodeToMatch)
      .is('deleted_at', null)
      .maybeSingle();
    if (dbLoc) {
      return { id: dbLoc.id, code: dbLoc.code, name: dbLoc.name, type: dbLoc.type || undefined };
    }

    return null;
  };

  /**
   * Quick synchronous check against the in-memory locations array.
   * Used to cheaply determine if a scanned value is likely a location code
   * before making any async DB calls.  Works for both QR JSON payloads and
   * plain-text 1D barcode scans.
   */
  const isLikelyLocationCode = (input: string): boolean => {
    return isLikelyLocationCodeUtil(input, locations);
  };

  const isLikelyContainerCode = (input: string): boolean => {
    const payload = parseScanPayload(input);
    if (!payload) return false;
    if (payload.type === 'container') return true;
    const codeToMatch = (payload.code || input).trim();
    if (!codeToMatch) return false;
    // Fast path: auto-generated codes
    if (/^CNT-[0-9]+$/i.test(codeToMatch)) return true;
    return false;
  };

  const lookupContainer = async (input: string): Promise<ScannedContainer | null> => {
    const payload = parseScanPayload(input);
    if (!payload) return null;

    const code = (payload.code || input).trim();

    // Prefer UUID when available (from QR payloads / deep links)
    if (payload.type === 'container' && payload.id && isValidUuid(payload.id)) {
      const { data, error } = await supabase
        .from('containers')
        .select(`
          id,
          container_code,
          container_type,
          status,
          location_id,
          location:locations!containers_location_id_fkey(code)
        `)
        .eq('id', payload.id)
        .is('deleted_at', null)
        .maybeSingle();
      if (error || !data) return null;
      return {
        id: data.id,
        container_code: (data as any).container_code,
        container_type: (data as any).container_type ?? null,
        status: (data as any).status,
        location_id: (data as any).location_id ?? null,
        location_code: (data as any).location?.code ? String((data as any).location.code) : null,
      };
    }

    // Fallback to matching by container_code (1D barcode scans, legacy)
    if (!code) return null;
    const { data, error } = await supabase
      .from('containers')
      .select(`
        id,
        container_code,
        container_type,
        status,
        location_id,
        location:locations!containers_location_id_fkey(code)
      `)
      .eq('container_code', code.toUpperCase())
      .is('deleted_at', null)
      .maybeSingle();
    if (error || !data) return null;
    return {
      id: data.id,
      container_code: (data as any).container_code,
      container_type: (data as any).container_type ?? null,
      status: (data as any).status,
      location_id: (data as any).location_id ?? null,
      location_code: (data as any).location?.code ? String((data as any).location.code) : null,
    };
  };

  const lookupInventoryUnit = async (input: string): Promise<{
    id: string;
    ic_code: string;
    status: string;
    class: string | null;
    location_id: string;
    container_id: string | null;
  } | null> => {
    const payload = parseScanPayload(input);
    if (!payload) return null;

    // Explicitly disallow item/location/container payloads; this flow expects inventory units.
    if (payload.type === 'item' || payload.type === 'location' || payload.type === 'container') {
      return null;
    }

    const code = (payload.code || input).trim();
    if (!code) return null;

    // UUID lookup (rare, but safe)
    if (isValidUuid(code)) {
      const { data, error } = await supabase
        .from('inventory_units')
        .select('id, ic_code, status, class, location_id, container_id')
        .eq('id', code)
        .maybeSingle();
      if (error || !data) return null;
      return data as any;
    }

    const normalized = code.toUpperCase();
    const { data, error } = await supabase
      .from('inventory_units')
      .select('id, ic_code, status, class, location_id, container_id')
      .eq('ic_code', normalized)
      .maybeSingle();
    if (error || !data) return null;
    return data as any;
  };

  // Check if an item has a quarantine flag
  const checkQuarantine = async (itemId: string): Promise<boolean> => {
    if (!profile?.tenant_id) return false;
    try {
      const quarantineChargeCode = await getQuarantineChargeCode();
      if (!quarantineChargeCode) return false;

      const { data: flag } = await (supabase
        .from('item_flags') as any)
        .select('id')
        .eq('item_id', itemId)
        .eq('service_code', quarantineChargeCode)
        .maybeSingle();

      return !!flag;
    } catch {
      return false;
    }
  };

  // Handle quarantine override - log to activity history
  const handleQuarantineOverride = () => {
    if (!quarantineItem || !profile?.tenant_id || !profile?.id) return;

    // Log the override
    logItemActivity({
      tenantId: profile.tenant_id,
      itemId: quarantineItem.id,
      actorUserId: profile.id,
      eventType: 'quarantine_override',
      eventLabel: `Quarantine warning overridden during scan (${mode} mode)`,
      details: { scan_mode: mode, item_code: quarantineItem.item_code },
    });

    // Execute the pending action
    if (quarantinePendingAction) {
      quarantinePendingAction();
    }

    setQuarantineWarningOpenSafe(false);
    setQuarantineItem(null);
    setQuarantinePendingAction(null);
  };

  // Dismiss quarantine warning (go back)
  const handleQuarantineDismiss = () => {
    setQuarantineWarningOpenSafe(false);
    setQuarantineItem(null);
    setQuarantinePendingAction(null);
  };

  // Standalone item -> location scanner mode (Move workflow).
  const moveScanMode = useItemToLocationScanMode<ScannedItem, ScannedLocation, ScannedContainer>({
    enabled: mode === 'move',
    processing,
    setProcessing,
    getPhase: () => phaseRef.current,
    hasSelectedItem: () => !!scannedItemRef.current,
    isGloballyBlocked: () => quarantineWarningOpenRef.current,
    lookupItem,
    lookupLocation,
    lookupContainer,
    isLikelyLocationCode,
    isLikelyContainerCode,
    onItemAccepted: (item) => {
      hapticMedium();
      void playScanAudioFeedback('success');
      setScannedItemSafe(item);
      setPhaseSafe('scanning-location');
      toast({
        title: `Found: ${item.item_code}`,
        description: 'Now scan the destination bay.',
      });
    },
    isItemBlocked: (item) => checkQuarantine(item.id),
    onItemBlocked: (item) => {
      hapticError();
      void playScanAudioFeedback('error');
      setQuarantineItem(item);
      setQuarantinePendingAction(() => () => {
        setScannedItemSafe(item);
        setPhaseSafe('scanning-location');
        toast({
          title: `Found: ${item.item_code}`,
          description: 'Now scan the destination bay.',
        });
      });
      setQuarantineWarningOpenSafe(true);
      scanQueueRef.current = [];
    },
    onLocationAccepted: (loc) => {
      hapticMedium();
      void playScanAudioFeedback('success');
      setTargetLocationSafe(loc);
      setPhaseSafe('confirm');
      scanQueueRef.current = [];
    },
    openContainerShortcut: async (container, activePhase) => {
      if (!orgPrefs.scan_shortcuts_open_container_enabled) return false;

      hapticMedium();
      void playScanAudioFeedback('success');
      const ok = window.confirm(
        `You scanned a container (${container.container_code}).\n\nOpen container details? (This will leave ${
          activePhase === 'scanning-location' ? 'location' : 'move'
        } scanning.)`,
      );
      if (ok) {
        navigate(`/containers/${container.id}`);
        return true;
      }
      return false;
    },
    onBlocked: () => {
      hapticError();
      void playScanAudioFeedback('error');
    },
    onUnexpectedError: (error, raw) => {
      console.error('[ScanHub] Move scan error:', error, { raw });
    },
  });

  // Standalone lookup scanner mode (item/location/container discovery).
  const lookupScanMode = useLookupScanMode({
    enabled: mode === 'lookup',
    processing,
    setProcessing,
    isGloballyBlocked: () => quarantineWarningOpenRef.current,
    lookupItem,
    lookupLocation,
    lookupContainer,
    isLikelyLocationCode,
    onFoundLocation: (loc) => {
      hapticMedium();
      void playScanAudioFeedback('success');
      navigate(`/locations/${loc.id}`);
    },
    onFoundItem: async (item) => {
      hapticMedium();
      void playScanAudioFeedback('success');

      const isQuarantined = await checkQuarantine(item.id);
      if (isQuarantined) {
        hapticError();
        void playScanAudioFeedback('error');
        setQuarantineItem({ ...item, description: null, current_location_code: null, warehouse_name: null });
        setQuarantinePendingAction(() => () => navigate(`/inventory/${item.id}`));
        return setQuarantineWarningOpenSafe(true);
      }

      navigate(`/inventory/${item.id}`);
    },
    onFoundContainer: (container) => {
      hapticMedium();
      void playScanAudioFeedback('success');
      toast({
        title: `Container: ${container.container_code}`,
        description: container.container_type ? `Type: ${container.container_type}` : 'Container found',
      });
      navigate(`/containers/${container.id}`);
    },
    onNotFound: () => {
      hapticError();
      void playScanAudioFeedback('error');
    },
    onUnexpectedError: (error, raw) => {
      console.error('[ScanHub] Lookup scan error:', error, { raw });
      hapticError();
      void playScanAudioFeedback('error');
    },
  });

  // Standalone item-only scanner mode for Service Event Scan.
  const serviceScanMode = useItemOnlyScanMode<ServiceScannedItem>({
    enabled: mode === 'service',
    processing,
    setProcessing,
    isGloballyBlocked: () => quarantineWarningOpenRef.current,
    lookupItem: lookupItemForService,
    isLikelyLocationCode,
    lookupLocationCode: async (raw) => {
      const loc = await lookupLocation(raw);
      return loc?.code || null;
    },
    isDuplicate: (item) => serviceItems.some((i) => i.id === item.id),
    addItem: (item) => {
      setServiceItems((prev) => [...prev, item]);
    },
    onItemAdded: (item) => {
      hapticLight();
      void playScanAudioFeedback('success');
      toast({
        title: `Added: ${item.item_code}`,
        description: item.class_code
          ? `Class: ${item.class_code}`
          : 'No class assigned - default rate will be used',
      });
    },
    onBlocked: () => {
      hapticError();
      void playScanAudioFeedback('error');
    },
    onUnexpectedError: (error, raw) => {
      console.error('[ScanHub] Service scan error:', error, { raw });
    },
  });

  const validateOperationalContainer = useCallback((container: ScannedContainer): string | null => {
    const code = container.container_code || 'this container';
    if (container.status !== 'active') {
      return container.status === 'closed'
        ? `Container ${code} is closed and cannot be used for scanning.`
        : `Container ${code} is archived and cannot be used for scanning.`;
    }
    if (!container.location_id) {
      return `Container ${code} has no location assigned. Assign a location before scanning items into it.`;
    }
    return null;
  }, []);

  const packItemsToContainer = useCallback(async (
    itemsToPack: ScannedItem[],
    container: ScannedContainer,
  ): Promise<{
    rows: OperationsPackedItemRow[];
    addedCount: number;
    failedCount: number;
    failedIds: Set<string>;
  }> => {
    const uniqueItems = Array.from(
      new Map(itemsToPack.map((item) => [item.id, item])).values(),
    );

    const rows: OperationsPackedItemRow[] = [];
    const failedIds = new Set<string>();
    let addedCount = 0;
    let failedCount = 0;

    if (uniqueItems.length === 0) {
      return { rows, addedCount, failedCount, failedIds };
    }
    if (!container.location_id) {
      for (const item of uniqueItems) {
        rows.push({
          id: item.id,
          item_code: item.item_code,
          added: false,
          message: 'Container has no location',
        });
        failedIds.add(item.id);
        failedCount += 1;
      }
      return { rows, addedCount, failedCount, failedIds };
    }

    let sourceQuery = (supabase.from('items') as any)
      .select('id, item_code, metadata, current_location_id')
      .in('id', uniqueItems.map((item) => item.id))
      .is('deleted_at', null);
    if (profile?.tenant_id) {
      sourceQuery = sourceQuery.eq('tenant_id', profile.tenant_id);
    }

    const { data: sourceRows, error: sourceError } = await sourceQuery;
    if (sourceError) throw sourceError;
    const sourceById = new Map<string, any>((sourceRows || []).map((row: any) => [String(row.id), row]));

    for (const item of uniqueItems) {
      const source = sourceById.get(item.id);
      if (!source) {
        rows.push({
          id: item.id,
          item_code: item.item_code,
          added: false,
          message: 'Item not available',
        });
        failedIds.add(item.id);
        failedCount += 1;
        continue;
      }

      const existingMetadata =
        source.metadata && typeof source.metadata === 'object' && !Array.isArray(source.metadata)
          ? (source.metadata as Record<string, any>)
          : {};

      if (existingMetadata.container_id === container.id) {
        rows.push({
          id: item.id,
          item_code: item.item_code,
          added: true,
          message: 'Already in container',
        });
        addedCount += 1;
        continue;
      }

      const nextMetadata = {
        ...existingMetadata,
        container_id: container.id,
        container_code: container.container_code,
      };

      let updateQuery = (supabase.from('items') as any)
        .update({
          current_location_id: container.location_id,
          current_location: container.container_code,
          metadata: nextMetadata,
        })
        .eq('id', item.id);
      if (profile?.tenant_id) {
        updateQuery = updateQuery.eq('tenant_id', profile.tenant_id);
      }

      const { error: updateError } = await updateQuery;
      if (updateError) {
        console.error('[ScanHub] Failed to pack item into container:', updateError, {
          item_id: item.id,
          container_id: container.id,
        });
        rows.push({
          id: item.id,
          item_code: item.item_code,
          added: false,
          message: updateError.message || 'Failed',
        });
        failedIds.add(item.id);
        failedCount += 1;
        continue;
      }

      // Keep movement audit behavior aligned with normal move flow.
      await (supabase.from('movements') as any).insert({
        item_id: item.id,
        to_location_id: container.location_id,
        action_type: 'move',
        moved_at: new Date().toISOString(),
        metadata: {
          container_id: container.id,
          container_code: container.container_code,
          source: 'operations_scanner',
        },
      });

      if (profile?.tenant_id) {
        logItemActivity({
          tenantId: profile.tenant_id,
          itemId: item.id,
          actorUserId: profile.id,
          eventType: 'item_moved',
          eventLabel: `Packed into ${container.container_code}`,
          details: {
            to_location: container.location_code,
            container_id: container.id,
            container_code: container.container_code,
          },
        });
      }

      rows.push({
        id: item.id,
        item_code: item.item_code,
        added: true,
      });
      addedCount += 1;
    }

    return { rows, addedCount, failedCount, failedIds };
  }, [profile?.id, profile?.tenant_id]);

  const moveContainerToLocation = useCallback(async (
    container: ScannedContainer,
    location: ScannedLocation,
  ): Promise<number> => {
    const { error: rpcError } = await supabase.rpc('rpc_move_container', {
      p_container_id: container.id,
      p_new_location_id: location.id,
    });
    if (rpcError) throw rpcError;

    // Also sync item-based container links for the operations scanner path.
    let linkedUpdate = (supabase.from('items') as any)
      .update({
        current_location_id: location.id,
        current_location: container.container_code,
      })
      .contains('metadata', { container_id: container.id })
      .is('deleted_at', null);
    if (profile?.tenant_id) {
      linkedUpdate = linkedUpdate.eq('tenant_id', profile.tenant_id);
    }
    const { data: updatedRows, error: linkedError } = await linkedUpdate.select('id');
    if (linkedError) {
      console.error('[ScanHub] Failed to sync item locations after container move:', linkedError, {
        container_id: container.id,
        location_id: location.id,
      });
      return 0;
    }
    return Array.isArray(updatedRows) ? updatedRows.length : 0;
  }, [profile?.tenant_id]);

  const operationsScanMode = useOperationsScanMode<ScannedItem, ScannedLocation, ScannedContainer>({
    enabled: mode === 'batch',
    processing,
    setProcessing,
    isGloballyBlocked: () => quarantineWarningOpenRef.current,
    lookupItem,
    lookupLocation,
    lookupContainer,
    isLikelyLocationCode,
    isLikelyContainerCode,
    validateContainer: validateOperationalContainer,
    getActiveContainer: () => containerTargetRef.current,
    getStagedCount: () => batchItemsRef.current.length,
    isDuplicateStagedItem: (item) => batchItemsRef.current.some((existing) => existing.id === item.id),
    isDuplicateActiveContainerItem: (item) => containerSessionScannedItemSetRef.current.has(item.id),
    onStageItem: async (item) => {
      const isQuarantined = await checkQuarantine(item.id);
      if (isQuarantined) {
        hapticError();
        void playScanAudioFeedback('error');
        setQuarantineItem(item);
        setQuarantinePendingAction(() => () => {
          setBatchItemsSafe((prev) => [...prev, item]);
          toast({
            title: `Added: ${item.item_code}`,
            description: `${batchItemsRef.current.length + 1} items in operations batch.`,
          });
        });
        setQuarantineWarningOpenSafe(true);
        scanQueueRef.current = [];
        return;
      }

      setBatchItemsSafe((prev) => [...prev, item]);
      hapticLight();
      void playScanAudioFeedback('success');
      toast({
        title: `Added: ${item.item_code}`,
        description: `${batchItemsRef.current.length + 1} items in operations batch.`,
      });
    },
    onPackItemToActiveContainer: async (item, container) => {
      const result = await packItemsToContainer([item], container);
      if (result.rows.length > 0) {
        setContainerSessionScannedItems((prev) => [...result.rows, ...prev].slice(0, 50));
      }

      const packed = result.rows.find((row) => row.id === item.id && row.added);
      if (packed) {
        containerSessionScannedItemSetRef.current.add(item.id);
        hapticSuccess();
        void playScanAudioFeedback('success');
        toast({
          title: 'Packed to container',
          description: `${item.item_code} → ${container.container_code}`,
        });
        return;
      }

      operationsBlockRef.current(
        `Failed to pack ${item.item_code} into ${container.container_code}. Review item status and location, then try again.`,
        item.item_code,
      );
    },
    onPackStagedItemsToContainer: async (container) => {
      const stagedItems = batchItemsRef.current;
      if (stagedItems.length === 0) {
        setContainerTargetSafe(container);
        setContainerSessionScannedItems([]);
        containerSessionScannedItemSetRef.current = new Set();
        hapticLight();
        void playScanAudioFeedback('success');
        toast({
          title: `Container session: ${container.container_code}`,
          description: 'Scan item labels to pack, or scan a location to move the container.',
        });
        return;
      }

      const ok = window.confirm(
        `Pack ${stagedItems.length} staged item(s) into ${container.container_code}?`,
      );
      if (!ok) return;

      const result = await packItemsToContainer(stagedItems, container);
      if (result.rows.length > 0) {
        setContainerSessionScannedItems((prev) => [...result.rows, ...prev].slice(0, 50));
      }
      for (const row of result.rows) {
        if (row.added) {
          containerSessionScannedItemSetRef.current.add(row.id);
        }
      }

      setContainerTargetSafe(container);
      setTargetLocationSafe(null);
      setPhaseSafe('scanning-item');
      setBatchItemsSafe((prev) => prev.filter((item) => result.failedIds.has(item.id)));

      if (result.addedCount > 0) {
        hapticSuccess();
        void playScanAudioFeedback('success');
      } else {
        hapticError();
        void playScanAudioFeedback('error');
      }

      toast({
        title: 'Batch packed to container',
        description: `Added ${result.addedCount} of ${stagedItems.length} item(s) to ${container.container_code}.`,
      });

      if (result.failedCount > 0) {
        const failedSample = result.rows.find((row) => !row.added)?.item_code || container.container_code;
        operationsBlockRef.current(
          `Some items could not be packed into ${container.container_code}. Review failed rows and rescan those labels.`,
          failedSample,
        );
      }
    },
    onMoveStagedItemsToLocation: async (location) => {
      setContainerTargetSafe(null);
      setTargetLocationSafe(location);
      setPhaseSafe('confirm');
      scanQueueRef.current = [];
      hapticMedium();
      void playScanAudioFeedback('success');
    },
    onMoveActiveContainerToLocation: async (location, container) => {
      const linkedCount = await moveContainerToLocation(container, location);
      setContainerTargetSafe({
        ...container,
        location_id: location.id,
        location_code: location.code,
      });
      hapticSuccess();
      void playScanAudioFeedback('success');
      toast({
        title: 'Container moved',
        description:
          linkedCount > 0
            ? `${container.container_code} moved to ${location.code}. Updated ${linkedCount} linked item(s).`
            : `${container.container_code} moved to ${location.code}.`,
      });
    },
    onStartContainerSession: async (container) => {
      setContainerTargetSafe(container);
      setContainerSessionScannedItems([]);
      containerSessionScannedItemSetRef.current = new Set();
      hapticMedium();
      void playScanAudioFeedback('success');
      toast({
        title: `Container session: ${container.container_code}`,
        description: 'Scan item labels to pack, or scan a location to move the container.',
      });
    },
    onSwitchContainerSession: async (nextContainer, currentContainer) => {
      const ok = window.confirm(
        `Switch active container?\n\nFrom: ${currentContainer.container_code}\nTo: ${nextContainer.container_code}\n\nThis clears the recent packed list.`,
      );
      if (!ok) return;

      setContainerTargetSafe(nextContainer);
      setContainerSessionScannedItems([]);
      containerSessionScannedItemSetRef.current = new Set();
      hapticLight();
      void playScanAudioFeedback('success');
      toast({
        title: `Container switched: ${nextContainer.container_code}`,
        description: 'Continue scanning item labels.',
      });
    },
    onBlocked: () => {
      hapticError();
      void playScanAudioFeedback('error');
    },
    onUnexpectedError: (error, raw) => {
      console.error('[ScanHub] Operations scan error:', error, { raw });
    },
  });

  useEffect(() => {
    operationsBlockRef.current = operationsScanMode.block;
  }, [operationsScanMode.block]);

  const containerScanEngine = useScanEngine({
    enabled: mode === 'container',
    isExternallyBusy: processing,
    setExternallyBusy: setProcessing,
    dedupeMs: 500,
    // Container scan mode accepts:
    // - container QR payloads (type=container)
    // - raw CNT-##### codes
    // - raw IC codes for inventory units
    allowedTypes: ['container', 'unknown'],
    onBlockedType: async (event) => {
      // Helpful messages for wrong scans
      if (event.type === 'location' || isLikelyLocationCode(event.raw)) {
        const loc = await lookupLocation(event.raw);
        const locCode = loc?.code || event.code;
        hapticError();
        void playScanAudioFeedback('error');
        toast({
          variant: 'destructive',
          title: 'Location Scanned',
          description: `"${locCode}" is a location. Scan a container label or an IC code.`,
        });
        return;
      }

      if (event.type === 'item') {
        hapticError();
        void playScanAudioFeedback('error');
        toast({
          variant: 'destructive',
          title: 'Item Scanned',
          description: 'This workflow moves inventory units into containers. Scan an IC unit code.',
        });
        return;
      }
    },
    onScan: async (event) => {
      const currentContainer = containerTargetRef.current;
      const pendingUnits = containerPendingUnitsRef.current || [];

      // Step 1: choose container OR scan units first (then container)
      if (!currentContainer) {
        // Reject location scans quickly (they come through as `unknown` for 1D location barcodes)
        if (isLikelyLocationCode(event.raw)) {
          const loc = await lookupLocation(event.raw);
          const locCode = loc?.code || event.code;
          hapticError();
          void playScanAudioFeedback('error');
          toast({
            variant: 'destructive',
            title: 'Location Scanned',
            description: `"${locCode}" is a location. Scan a container label or an IC unit code.`,
          });
          return;
        }

        const scanCode = (event.code || event.raw).trim();
        const looksLikeUnitCode = /^IC-[0-9]+$/i.test(scanCode);

        const handlePickedContainer = async (container: ScannedContainer) => {
          if (container.status !== 'active') {
            hapticError();
            void playScanAudioFeedback('error');
            toast({
              variant: 'destructive',
              title: container.status === 'closed' ? 'Container Closed' : 'Container Archived',
              description: `${container.container_code} is ${container.status}. Choose a different container.`,
            });
            return;
          }

          if (!container.location_id) {
            hapticError();
            void playScanAudioFeedback('error');
            toast({
              variant: 'destructive',
              title: 'Container has no location',
              description: 'Move/assign this container to a location before adding units.',
            });
            return;
          }

          // If units were scanned first, apply them now (item → container flow).
          if (pendingUnits.length > 0) {
            const needsMoveCount = pendingUnits.filter((u) => u.container_id && u.container_id !== container.id).length;
            let allowMoveFromOtherContainers = true;
            if (needsMoveCount > 0) {
              allowMoveFromOtherContainers = window.confirm(
                `${needsMoveCount} scanned unit(s) are already assigned to another container.\n\n` +
                  `Move them into ${container.container_code}?`
              );
            }

            const results: ContainerScanUnitRow[] = [];
            let okCount = 0;

            for (const u of pendingUnits) {
              const code = String(u.ic_code || '').trim();
              if (!code) continue;

              // Already in this container
              if (u.container_id === container.id) {
                results.push({ ...u, added: true, message: 'Already in container' } as any);
                containerScannedCodeSetRef.current.add(code);
                okCount += 1;
                continue;
              }

              // Skip units currently in a different container if user declined the move.
              if (u.container_id && u.container_id !== container.id && !allowMoveFromOtherContainers) {
                results.push({ ...u, added: false, message: 'Skipped (in another container)' } as any);
                continue;
              }

              try {
                const { error } = await supabase.rpc('rpc_add_unit_to_container', {
                  p_unit_id: u.id,
                  p_container_id: container.id,
                });
                if (error) throw error;
                results.push({ ...u, added: true } as any);
                containerScannedCodeSetRef.current.add(code);
                okCount += 1;
              } catch (err: any) {
                console.error('[ScanHub] add pending unit to container failed:', err, { unit_id: u.id, container_id: container.id });
                results.push({ ...u, added: false, message: err?.message || 'Failed' } as any);
                // Allow rescan if it failed
                containerPendingCodeSetRef.current.delete(code);
              }
            }

            // Clear pending list now that we attempted to apply it.
            setContainerPendingUnitsSafe([]);
            containerPendingCodeSetRef.current = new Set();

            // Set the active container after apply so users can keep scanning into it.
            setContainerTargetSafe(container);
            setContainerScannedUnits(results.reverse().slice(0, 50));
            setContainerScanValue('');
            setTimeout(() => containerScanInputRef.current?.focus(), 50);

            if (okCount > 0) {
              hapticSuccess();
              void playScanAudioFeedback('success');
            } else {
              hapticError();
              void playScanAudioFeedback('error');
            }

            toast({
              title: 'Packed to container',
              description: `Added ${okCount} of ${pendingUnits.length} unit(s) to ${container.container_code}.`,
            });
            return;
          }

          // No pending units: just select this container and proceed with container → items flow.
          setContainerTargetSafe(container);
          setContainerScannedUnits([]);
          containerScannedCodeSetRef.current = new Set();
          setContainerScanValue('');
          setTimeout(() => containerScanInputRef.current?.focus(), 50);

          hapticLight();
          void playScanAudioFeedback('success');
          toast({
            title: `Container: ${container.container_code}`,
            description: 'Now scan IC unit codes to add units into this container.',
          });
        };

        // For container scan mode, inventory units are system-generated IC-* codes.
        // Treat all other scans as container candidates (supports override codes like PALLET-001).
        if (!looksLikeUnitCode) {
          const container = await lookupContainer(event.raw);
          if (!container) {
            // If it's not a container, it might be a location label (ex: wrong scan / wrong warehouse).
            const loc = await lookupLocation(event.raw);
            if (loc) {
              const locCode = loc?.code || event.code;
              hapticError();
              void playScanAudioFeedback('error');
              toast({
                variant: 'destructive',
                title: 'Location Scanned',
                description: `"${locCode}" is a location. Scan a container label or an IC unit code.`,
              });
              return;
            }

            hapticError();
            void playScanAudioFeedback('error');
            toast({
              variant: 'destructive',
              title: 'Container Not Found',
              description: 'No container found with that code.',
            });
            return;
          }

          await handlePickedContainer(container);
          return;
        }

        // Otherwise, treat scan as an IC unit code and stage it until a container is scanned.
        const unit = await lookupInventoryUnit(event.raw);
        if (!unit) {
          // Fallback: allow legacy/override containers whose codes resemble unit codes.
          const container = await lookupContainer(event.raw);
          if (container) {
            await handlePickedContainer(container);
            return;
          }

          hapticError();
          void playScanAudioFeedback('error');
          toast({
            variant: 'destructive',
            title: 'Unit Not Found',
            description: 'Scan a valid container label or IC unit code.',
          });
          return;
        }

        const unitCode = String(unit.ic_code || '').trim();
        if (!unitCode) return;

        if (containerPendingCodeSetRef.current.has(unitCode)) {
          toast({
            title: 'Already scanned',
            description: `${unitCode} is already in the pending list.`,
          });
          return;
        }

        containerPendingCodeSetRef.current.add(unitCode);
        setContainerPendingUnitsSafe((prev) => [...prev, unit]);

        hapticLight();
        void playScanAudioFeedback('success');
        toast({
          title: `Staged: ${unitCode}`,
          description: `Now scan a container label to pack ${pendingUnits.length + 1} unit(s).`,
        });
        return;
      }

      // If the user scans a container while already in a container session, treat it as "switch container".
      if (isLikelyLocationCode(event.raw)) {
        const loc = await lookupLocation(event.raw);
        const locCode = loc?.code || event.code;
        hapticError();
        void playScanAudioFeedback('error');
        toast({
          variant: 'destructive',
          title: 'Location Scanned',
          description: `"${locCode}" is a location. Scan an IC unit code to add it to the container.`,
        });
        return;
      }

      const scanCode = (event.code || event.raw).trim();
      const looksLikeUnitCode = /^IC-[0-9]+$/i.test(scanCode);

      // In container mode, non-IC scans are treated as container codes (supports override codes).
      if (!looksLikeUnitCode) {
        const nextContainer = await lookupContainer(event.raw);
        if (!nextContainer) {
          // If it's not a container, it might be a location label from a different warehouse.
          const loc = await lookupLocation(event.raw);
          if (loc) {
            const locCode = loc?.code || event.code;
            hapticError();
            void playScanAudioFeedback('error');
            toast({
              variant: 'destructive',
              title: 'Location Scanned',
              description: `"${locCode}" is a location. Scan an IC unit code to add it to the container.`,
            });
            return;
          }

          hapticError();
          void playScanAudioFeedback('error');
          toast({
            variant: 'destructive',
            title: 'Container Not Found',
            description: 'No container found with that code.',
          });
          return;
        }

        if (nextContainer.id === currentContainer.id) {
          toast({
            title: 'Already selected',
            description: `${nextContainer.container_code} is already the active container.`,
          });
          return;
        }

        if (nextContainer.status !== 'active') {
          hapticError();
          void playScanAudioFeedback('error');
          toast({
            variant: 'destructive',
            title: nextContainer.status === 'closed' ? 'Container Closed' : 'Container Archived',
            description: `${nextContainer.container_code} is ${nextContainer.status}. Choose a different container.`,
          });
          return;
        }

        if (!nextContainer.location_id) {
          hapticError();
          void playScanAudioFeedback('error');
          toast({
            variant: 'destructive',
            title: 'Container has no location',
            description: 'Move/assign this container to a location before adding units.',
          });
          return;
        }

        const ok = window.confirm(
          `Switch active container?\n\n` +
            `From: ${currentContainer.container_code}\n` +
            `To: ${nextContainer.container_code}\n\n` +
            `This will clear the current scan list.`
        );
        if (!ok) return;

        setContainerTargetSafe(nextContainer);
        setContainerScannedUnits([]);
        containerScannedCodeSetRef.current = new Set();
        setContainerScanValue('');
        setTimeout(() => containerScanInputRef.current?.focus(), 50);
        hapticLight();
        void playScanAudioFeedback('success');
        toast({
          title: `Container: ${nextContainer.container_code}`,
          description: 'Now scan IC unit codes to add units into this container.',
        });
        return;
      }

      // Step 2: scan units
      if (!currentContainer.location_id) {
        hapticError();
        void playScanAudioFeedback('error');
        toast({
          variant: 'destructive',
          title: 'Container has no location',
          description: 'Move/assign this container to a location before adding units.',
        });
        return;
      }

      if (isLikelyLocationCode(event.raw)) {
        const loc = await lookupLocation(event.raw);
        const locCode = loc?.code || event.code;
        hapticError();
        void playScanAudioFeedback('error');
        toast({
          variant: 'destructive',
          title: 'Location Scanned',
          description: `"${locCode}" is a location. Scan an IC unit code to add it to the container.`,
        });
        return;
      }

      const unit = await lookupInventoryUnit(event.raw);
      if (!unit) {
        hapticError();
        void playScanAudioFeedback('error');
        toast({
          variant: 'destructive',
          title: 'Unit Not Found',
          description: 'No inventory unit found with that IC code.',
        });
        return;
      }

      const unitCode = String(unit.ic_code || '').trim();
      if (!unitCode) return;

      if (containerScannedCodeSetRef.current.has(unitCode)) {
        toast({
          title: 'Already scanned',
          description: `${unitCode} is already in the scan list.`,
        });
        return;
      }

      // Mark as seen immediately (prevents double-processing from scanner chatter).
      containerScannedCodeSetRef.current.add(unitCode);

      if (unit.container_id === currentContainer.id) {
        setContainerScannedUnits((prev) => [
          { ...unit, added: true, message: 'Already in container' } as any,
          ...prev,
        ].slice(0, 50));
        toast({
          title: 'Already in container',
          description: `${unitCode} is already in ${currentContainer.container_code}.`,
        });
        return;
      }

      if (unit.container_id && unit.container_id !== currentContainer.id) {
        const ok = window.confirm(
          `${unitCode} is currently assigned to another container.\n\nMove it into ${currentContainer.container_code}?`
        );
        if (!ok) {
          // Allow rescanning if they declined
          containerScannedCodeSetRef.current.delete(unitCode);
          return;
        }
      }

      try {
        const { error } = await supabase.rpc('rpc_add_unit_to_container', {
          p_unit_id: unit.id,
          p_container_id: currentContainer.id,
        });
        if (error) throw error;

        setContainerScannedUnits((prev) => [
          { ...unit, added: true } as any,
          ...prev,
        ].slice(0, 50));

        hapticSuccess();
        void playScanAudioFeedback('success');
        toast({
          title: 'Unit Added',
          description: `${unitCode} added to ${currentContainer.container_code}.`,
        });
      } catch (err: any) {
        console.error('[ScanHub] add unit to container failed:', err);
        setContainerScannedUnits((prev) => [
          { ...unit, added: false, message: err?.message || 'Failed' } as any,
          ...prev,
        ].slice(0, 50));
        hapticError();
        void playScanAudioFeedback('error');
        toast({
          variant: 'destructive',
          title: 'Add Failed',
          description: err?.message || 'Failed to add unit to container.',
        });
        // Allow rescan if it failed
        containerScannedCodeSetRef.current.delete(unitCode);
      }
    },
    onError: (error, raw) => {
      console.error('[ScanHub] Container scan error:', error, { raw });
      hapticError();
      void playScanAudioFeedback('error');
      toast({
        variant: 'destructive',
        title: 'Scan Error',
        description: 'Failed to process scan.',
      });
    },
  });

  const handleScanResult = (data: string) => {
    const input = data.trim();
    if (!input) return;
    if (quarantineWarningOpenRef.current) return;

    const enqueue = (value: string) => {
      const v = value.trim();
      if (!v) return;
      if (inFlightScanRef.current && v === inFlightScanRef.current) return;
      const q = scanQueueRef.current;
      const last = q.length > 0 ? q[q.length - 1] : null;
      if (last && v === last) return;
      if (q.length >= 3) return;
      q.push(v);
    };

    // If another operation is using the shared `processing` flag (e.g. executing a move),
    // ignore scans rather than interleaving actions.
    if (processing && !processingRef.current) {
      return;
    }

    if (processingRef.current) {
      enqueue(input);
      return;
    }

    processingRef.current = true;
    inFlightScanRef.current = input;
    setProcessing(true);

    const processNextQueuedScan = () => {
      const next = scanQueueRef.current.shift();
      if (!next) return;
      setTimeout(() => handleScanResult(next), 0);
    };

    void (async () => {
      try {
        const currentMode = modeRef.current;
        const currentPhase = phaseRef.current;

        if (currentMode === 'lookup') {
          const likelyLoc = isLikelyLocationCode(input);
          if (likelyLoc) {
            const loc = await lookupLocation(input);
            if (loc) {
              hapticMedium();
              void playScanAudioFeedback('success');
              toast({
                title: `Location: ${loc.code}`,
                description: loc.name || loc.type || 'Location found',
              });
              return;
            }
          }

          const item = await lookupItem(input);
          if (item) {
            hapticMedium();
            void playScanAudioFeedback('success');

            const isQuarantined = await checkQuarantine(item.id);
            if (isQuarantined) {
              hapticError();
              void playScanAudioFeedback('error');
              setQuarantineItem(item);
              setQuarantinePendingAction(() => () => navigate(`/inventory/${item.id}`));
              setQuarantineWarningOpenSafe(true);
              scanQueueRef.current = [];
              return;
            }

            navigate(`/inventory/${item.id}`);
            return;
          }

          const container = await lookupContainer(input);
          if (container) {
            hapticMedium();
            void playScanAudioFeedback('success');
            toast({
              title: `Container: ${container.container_code}`,
              description: container.container_type ? `Type: ${container.container_type}` : 'Container found',
            });
            navigate(`/containers/${container.id}`);
            return;
          }

          if (!likelyLoc) {
            const loc = await lookupLocation(input);
            if (loc) {
              hapticMedium();
              void playScanAudioFeedback('success');
              toast({
                title: `Location: ${loc.code}`,
                description: loc.name || loc.type || 'Location found',
              });
              return;
            }
          }

          hapticError();
          void playScanAudioFeedback('error');
          toast({
            variant: 'destructive',
            title: 'Not Found',
            description: 'No item or location found with that code.',
          });
          return;
        }

        if (currentMode === 'move') {
          const effectivePhase: ScanPhase =
            currentPhase === 'scanning-item' && !!scannedItemRef.current
              ? 'scanning-location'
              : currentPhase;

          if (effectivePhase === 'scanning-item') {
            const likelyLocation = isLikelyLocationCode(input);
            if (likelyLocation) {
              const loc = await lookupLocation(input);
              if (loc) {
                hapticError();
                void playScanAudioFeedback('error');
                toast({
                  variant: 'destructive',
                  title: 'Location Scanned',
                  description: `"${loc.code}" is a location. Please scan an item first, then scan the destination.`,
                });
                return;
              }
            }

            if (isLikelyContainerCode(input)) {
              const container = await lookupContainer(input);
              if (container) {
                if (orgPrefs.scan_shortcuts_open_container_enabled) {
                  hapticMedium();
                  void playScanAudioFeedback('success');
                  const ok = window.confirm(
                    `You scanned a container (${container.container_code}).\n\nOpen container details? (This will leave move scanning.)`
                  );
                  if (ok) {
                    navigate(`/containers/${container.id}`);
                    return;
                  }
                }

                hapticError();
                void playScanAudioFeedback('error');
                toast({
                  variant: 'destructive',
                  title: 'Container Scanned',
                  description: 'Scan an item first, then scan the destination location.',
                });
                return;
              }
            }

            const item = await lookupItem(input);
            if (item) {
              hapticMedium();
              void playScanAudioFeedback('success');

              const isQuarantined = await checkQuarantine(item.id);
              if (isQuarantined) {
                hapticError();
                void playScanAudioFeedback('error');
                setQuarantineItem(item);
                setQuarantinePendingAction(() => () => {
                  setScannedItemSafe(item);
                  setPhaseSafe('scanning-location');
                  toast({
                    title: `Found: ${item.item_code}`,
                    description: 'Now scan the destination bay.',
                  });
                });
                setQuarantineWarningOpenSafe(true);
                scanQueueRef.current = [];
                return;
              }

              setScannedItemSafe(item);
              setPhaseSafe('scanning-location');
              toast({
                title: `Found: ${item.item_code}`,
                description: 'Now scan the destination bay.',
              });
              return;
            }

            if (!likelyLocation) {
              const loc = await lookupLocation(input);
              if (loc) {
                hapticError();
                void playScanAudioFeedback('error');
                toast({
                  variant: 'destructive',
                  title: 'Location Scanned',
                  description: `"${loc.code}" is a location. Please scan an item first, then scan the destination.`,
                });
                return;
              }
            }

            hapticError();
            void playScanAudioFeedback('error');
            toast({
              variant: 'destructive',
              title: 'Not Found',
              description: 'No item or location found with that code.',
            });
            return;
          }

          if (effectivePhase === 'scanning-location') {
            const loc = await lookupLocation(input);
            if (loc) {
              hapticMedium();
              void playScanAudioFeedback('success');
              setTargetLocationSafe(loc);
              setPhaseSafe('confirm');
              scanQueueRef.current = [];
              return;
            }

            if (isLikelyContainerCode(input)) {
              const container = await lookupContainer(input);
              if (container) {
                if (orgPrefs.scan_shortcuts_open_container_enabled) {
                  hapticMedium();
                  void playScanAudioFeedback('success');
                  const ok = window.confirm(
                    `You scanned a container (${container.container_code}).\n\nOpen container details? (This will leave move scanning.)`
                  );
                  if (ok) {
                    navigate(`/containers/${container.id}`);
                    return;
                  }
                }

                hapticError();
                void playScanAudioFeedback('error');
                toast({
                  variant: 'destructive',
                  title: 'Container Scanned',
                  description: 'Scan a bay/location barcode to complete the move.',
                });
                return;
              }
            }

            const item = await lookupItem(input);
            hapticError();
            void playScanAudioFeedback('error');
            if (item) {
              toast({
                variant: 'destructive',
                title: 'Item Scanned',
                description: `"${item.item_code}" is an item, not a location. Scan a bay/location QR code to complete the move.`,
              });
            } else {
              toast({
                variant: 'destructive',
                title: 'Location Not Found',
                description: 'No location found with that code. Scan a valid bay/location barcode.',
              });
            }
            return;
          }
        }

        if (currentMode === 'batch') {
          const currentBatch = batchItemsRef.current;
          const likelyLocation = isLikelyLocationCode(input);

          if (likelyLocation) {
            const loc = await lookupLocation(input);
            if (loc) {
              if (currentBatch.length > 0) {
                hapticMedium();
                void playScanAudioFeedback('success');
                setTargetLocationSafe(loc);
                setPhaseSafe('confirm');
                scanQueueRef.current = [];
                return;
              }

              hapticError();
              void playScanAudioFeedback('error');
              toast({
                variant: 'destructive',
                title: 'Location Scanned',
                description: `"${loc.code}" is a location. Scan items first, then scan a location to move them.`,
              });
              return;
            }
          }

          if (isLikelyContainerCode(input)) {
            const container = await lookupContainer(input);
            if (container) {
              if (orgPrefs.scan_shortcuts_open_container_enabled) {
                hapticMedium();
                void playScanAudioFeedback('success');
                const ok = window.confirm(
                  `You scanned a container (${container.container_code}).\n\nOpen container details? (This will leave batch scanning.)`
                );
                if (ok) {
                  navigate(`/containers/${container.id}`);
                  return;
                }
              }

              hapticError();
              void playScanAudioFeedback('error');
              toast({
                variant: 'destructive',
                title: 'Container Scanned',
                description: 'Scan items first, then scan a location to move them.',
              });
              return;
            }
          }

          const item = await lookupItem(input);
          if (item) {
            if (!currentBatch.find(i => i.id === item.id)) {
              hapticLight();
              void playScanAudioFeedback('success');
              setBatchItemsSafe((prev) => [...prev, item]);
              toast({
                title: `Added: ${item.item_code}`,
                description: `${currentBatch.length + 1} items in batch. Scan location when ready.`,
              });
            } else {
              toast({
                title: 'Already in batch',
                description: `${item.item_code} is already added.`,
              });
            }
            return;
          }

          if (!likelyLocation) {
            const loc = await lookupLocation(input);
            if (loc) {
              if (currentBatch.length > 0) {
                hapticMedium();
                void playScanAudioFeedback('success');
                setTargetLocationSafe(loc);
                setPhaseSafe('confirm');
                scanQueueRef.current = [];
                return;
              }

              hapticError();
              void playScanAudioFeedback('error');
              toast({
                variant: 'destructive',
                title: 'Location Scanned',
                description: `"${loc.code}" is a location. Scan items first, then scan a location to move them.`,
              });
              return;
            }
          }

          hapticError();
          void playScanAudioFeedback('error');
          toast({
            variant: 'destructive',
            title: 'Not Found',
            description: 'No item or location found with that code.',
          });
          return;
        }

      } catch (error) {
        console.error('Scan error:', error);
        hapticError();
        void playScanAudioFeedback('error');
        toast({
          variant: 'destructive',
          title: 'Scan Error',
          description: 'Failed to process scan.',
        });
      }
    })().finally(() => {
      processingRef.current = false;
      inFlightScanRef.current = null;
      setProcessing(false);

      const m = modeRef.current;
      const p = phaseRef.current;
      const canContinue =
        m !== null && (p === 'scanning-item' || p === 'scanning-location') && !quarantineWarningOpenRef.current;

      if (canContinue) {
        processNextQueuedScan();
      } else {
        scanQueueRef.current = [];
      }
    });
  };

  // Handle manual item selection from search
  const handleItemSelect = async (item: { id: string; item_code: string; description: string | null; location_code: string | null; warehouse_name: string | null }) => {
    setShowItemSearch(false);
    hapticLight(); // Selection feedback
    scanQueueRef.current = [];
    
    const scannedItem: ScannedItem = {
      id: item.id,
      item_code: item.item_code,
      description: item.description,
      current_location_code: item.location_code,
      warehouse_name: item.warehouse_name,
    };

    if (mode === 'lookup') {
      navigate(`/inventory/${item.id}`);
      return;
    }

    if (mode === 'move') {
      setScannedItemSafe(scannedItem);
      setPhaseSafe('scanning-location');
      toast({
        title: `Selected: ${item.item_code}`,
        description: 'Now scan or select the destination bay.',
      });
    }

    if (mode === 'batch') {
      const activeContainer = containerTargetRef.current;
      if (activeContainer) {
        const result = await packItemsToContainer([scannedItem], activeContainer);
        if (result.rows.length > 0) {
          setContainerSessionScannedItems((prev) => [...result.rows, ...prev].slice(0, 50));
        }
        const packed = result.rows.find((row) => row.id === scannedItem.id && row.added);
        if (packed) {
          containerSessionScannedItemSetRef.current.add(scannedItem.id);
          hapticSuccess();
          void playScanAudioFeedback('success');
          toast({
            title: 'Packed to container',
            description: `${scannedItem.item_code} → ${activeContainer.container_code}`,
          });
        } else {
          operationsBlockRef.current(
            `Failed to pack ${scannedItem.item_code} into ${activeContainer.container_code}. Review item status and location, then try again.`,
            scannedItem.item_code,
          );
        }
        return;
      }

      const currentBatch = batchItemsRef.current;
      if (!currentBatch.find(i => i.id === item.id)) {
        setBatchItemsSafe(prev => [...prev, scannedItem]);
        toast({
          title: `Added: ${item.item_code}`,
          description: `${currentBatch.length + 1} items in batch.`,
        });
      } else {
        toast({
          title: 'Already in batch',
          description: `${item.item_code} is already added.`,
        });
      }
    }
  };

  // Handle manual location selection from search
  const handleLocationSelect = (loc: { id: string; code: string; name: string | null }) => {
    setShowLocationSearch(false);
    scanQueueRef.current = [];
    // Find full location data to get type
    const fullLoc = locations.find(l => l.id === loc.id);
    const selectedLoc: ScannedLocation = { ...loc, type: fullLoc?.type };

    if (mode === 'batch' && containerTargetRef.current) {
      const activeContainer = containerTargetRef.current;
      void (async () => {
        try {
          const linkedCount = await moveContainerToLocation(activeContainer, selectedLoc);
          setContainerTargetSafe({
            ...activeContainer,
            location_id: selectedLoc.id,
            location_code: selectedLoc.code,
          });
          hapticSuccess();
          void playScanAudioFeedback('success');
          toast({
            title: 'Container moved',
            description:
              linkedCount > 0
                ? `${activeContainer.container_code} moved to ${selectedLoc.code}. Updated ${linkedCount} linked item(s).`
                : `${activeContainer.container_code} moved to ${selectedLoc.code}.`,
          });
        } catch (error) {
          console.error('[ScanHub] Failed manual container move:', error);
          operationsBlockRef.current(
            `Failed to move container ${activeContainer.container_code} to ${selectedLoc.code}. Try scanning again.`,
            selectedLoc.code,
          );
        }
      })();
      return;
    }

    if (mode === 'batch' && batchItemsRef.current.length === 0) {
      hapticError();
      void playScanAudioFeedback('error');
      operationsBlockRef.current(
        `Scan one or more item labels or a container label before selecting destination ${selectedLoc.code}.`,
        selectedLoc.code,
      );
      return;
    }

    hapticMedium(); // Location selected
    setTargetLocationSafe(selectedLoc);
    setPhaseSafe('confirm');
  };

  const executeMove = async () => {
    if (!targetLocation) return;

    setProcessing(true);
    try {
      const items = mode === 'move' && scannedItem ? [scannedItem] : batchItems;
      const itemIds = items.map(i => i.id);

      // === Override evaluation gate ===
      let overrideResult: {
        allReasons: OverrideReason[];
        blockingReasons: OverrideReason[];
        requiredVolume: number;
        preUtilization: number;
        postUtilization: number;
        itemDataForAudit: Array<{ id: string; current_location_id: string | null }>;
      } | null = null;

      try {
        overrideResult = await evaluateOverrideReasons(targetLocation.id, items);
      } catch (evalErr) {
        // Override evaluation failures must NEVER block moves
        console.error('[ScanHub] Override evaluation failed (non-blocking):', evalErr);
      }

      if (overrideResult && overrideResult.blockingReasons.length > 0) {
        const hasFlagMismatch = overrideResult.blockingReasons.includes('FLAG_MISMATCH');
        if (hasFlagMismatch && !canManagerOverride) {
          hapticError();
          toast({
            variant: 'destructive',
            title: 'Move blocked',
            description: 'Destination is not compliant for required storage flags. Manager override is required.',
          });
          setProcessing(false);
          return;
        }
        const confirmed = await openOverrideModalAndAwait(
          overrideResult.blockingReasons,
          overrideResult.allReasons,
        );
        if (!confirmed) {
          setProcessing(false);
          return;
        }
      }
      // === End override evaluation gate ===

      // Call SOP validator RPC first
      const { data: validationResult, error: rpcError } = await (supabase as any).rpc(
        'validate_movement_event',
        { 
          p_item_ids: itemIds,
          p_destination_location_id: targetLocation.id
        }
      );

      if (rpcError) {
        console.error('Validation RPC error:', rpcError);
        hapticError();
        toast({
          variant: 'destructive',
          title: 'Validation Error',
          description: 'Failed to validate movement. Please try again.',
        });
        setProcessing(false);
        return;
      }

      const result = validationResult as { ok: boolean; blockers: SOPBlocker[] };
      const blockers = (result?.blockers || []).filter(
        (b: SOPBlocker) => b.severity === 'blocking' || !b.severity
      );

      if (!result?.ok && blockers.length > 0) {
        setSopBlockers(result.blockers);
        setSopValidationOpen(true);
        hapticError();
        setProcessing(false);
        return;
      }

      let successCount = 0;

      // Check for freeze moves on all items
      for (const item of items) {
        const freezeStatus = await checkFreeze(item.id);
        if (freezeStatus.isFrozen) {
          hapticError();
          toast({
            variant: 'destructive',
            title: 'Movement Blocked',
            description: freezeStatus.message || `Item is frozen by stocktake ${freezeStatus.stocktakeNumber}`,
          });
          setProcessing(false);
          return;
        }
      }

      for (const item of items) {
        const { error } = await (supabase.from('items') as any)
          .update({ current_location_id: targetLocation.id })
          .eq('id', item.id);

        if (!error) {
          await (supabase.from('movements') as any).insert({
            item_id: item.id,
            to_location_id: targetLocation.id,
            action_type: 'move',
            moved_at: new Date().toISOString(),
          });
          successCount++;
        }
      }

      hapticSuccess(); // Move completed successfully
      void playScanAudioFeedback('success');

      // Log activity per item
      if (profile?.tenant_id) {
        for (const item of items) {
          logItemActivity({
            tenantId: profile.tenant_id,
            itemId: item.id,
            actorUserId: profile.id,
            eventType: 'item_moved',
            eventLabel: `Moved to ${targetLocation.code}`,
            details: { from_location: item.current_location_code, to_location: targetLocation.code, to_location_id: targetLocation.id },
          });
        }
      }

      // Log override audit if an override was confirmed
      if (overrideResult && overrideResult.blockingReasons.length > 0 && profile?.tenant_id) {
        for (const item of items) {
          const itemAudit = overrideResult.itemDataForAudit.find(d => d.id === item.id);
          logItemActivity({
            tenantId: profile.tenant_id,
            itemId: item.id,
            actorUserId: profile.id,
            eventType: 'location_override',
            eventLabel: `Override: moved to ${targetLocation.code}`,
            details: {
              type: 'LOCATION_OVERRIDE',
              from_location_id: itemAudit?.current_location_id || null,
              to_location_id: targetLocation.id,
              reasons: overrideResult.allReasons,
              required_volume: overrideResult.requiredVolume,
              pre_utilization: overrideResult.preUtilization,
              post_utilization: overrideResult.postUtilization,
              metadata: {
                mode: mode === 'move' ? 'single' : 'batch',
                scanned_location_code: targetLocation.code,
                suggestions_present: suggestions.length > 0,
                overflow: suggestions.some(s => s.overflow),
              },
            },
          });
        }
      }

      // Show different toast for release locations
      if (targetLocation.type === 'release') {
        toast({
          title: 'Items Released',
          description: `Released ${successCount} item${successCount !== 1 ? 's' : ''} successfully`,
        });
      } else {
        toast({
          title: 'Move Complete',
          description: `Moved ${successCount} item${successCount !== 1 ? 's' : ''} to ${targetLocation.code}`,
        });
      }

      resetState();
    } catch (error) {
      console.error('Move error:', error);
      hapticError(); // Move failed
      void playScanAudioFeedback('error');
      toast({
        variant: 'destructive',
        title: 'Move Failed',
        description: 'Failed to move items.',
      });
    } finally {
      setProcessing(false);
    }
  };

  const resetState = () => {
    moveScanMode.reset();
    operationsScanMode.reset();
    lookupScanMode.reset();
    serviceScanMode.reset();
    containerScanEngine.reset();
    scanQueueRef.current = [];
    processingRef.current = false;
    inFlightScanRef.current = null;
    setProcessing(false);
    setModeSafe(null);
    setPhaseSafe('idle');
    setScannedItemSafe(null);
    setTargetLocationSafe(null);
    setBatchItemsSafe([]);
    setServiceItems([]);
    setSelectedServices([]);
    setContainerTargetSafe(null);
    setContainerScanValue('');
    setContainerScannedUnits([]);
    setContainerPendingUnitsSafe([]);
    setContainerSessionScannedItems([]);
    containerScannedCodeSetRef.current = new Set();
    containerPendingCodeSetRef.current = new Set();
    containerSessionScannedItemSetRef.current = new Set();
    setSwipeProgress(0);
    setShowItemSearch(false);
    setShowLocationSearch(false);
  };

  // Service Event Scan functions
  const addServiceEvent = (serviceCode: string) => {
    const service = scanServiceEvents.find(s => s.service_code === serviceCode);
    if (service && !selectedServices.find(s => s.service_code === serviceCode)) {
      hapticLight();
      setSelectedServices(prev => [...prev, service]);
    }
  };

  const removeServiceEvent = (serviceCode: string) => {
    setSelectedServices(prev => prev.filter(s => s.service_code !== serviceCode));
  };

  const removeServiceItem = (itemId: string) => {
    setServiceItems(prev => prev.filter(i => i.id !== itemId));
  };

  const saveServiceEvents = async () => {
    if (serviceItems.length === 0 || selectedServices.length === 0) {
      toast({
        variant: 'destructive',
        title: 'Cannot Save',
        description: 'Select at least one item and one service.',
      });
      return;
    }

    // Pre-validate: block if any class-based services selected for items without class
    const classBasedServiceCodes = selectedServices.filter(s => s.uses_class_pricing);
    if (classBasedServiceCodes.length > 0) {
      const itemsWithoutClass = serviceItems.filter(i => !i.class_code);
      if (itemsWithoutClass.length > 0) {
        hapticError();
        const itemCodes = itemsWithoutClass.map(i => i.item_code).join(', ');
        const serviceCodes = classBasedServiceCodes.map(s => s.service_name).join(', ');
        toast({
          variant: 'destructive',
          title: 'Item class required',
          description: `Cannot apply class-based service${classBasedServiceCodes.length > 1 ? 's' : ''} (${serviceCodes}) to item${itemsWithoutClass.length > 1 ? 's' : ''} without a class: ${itemCodes}. Assign a class or remove these items first.`,
        });
        return;
      }
    }

    setProcessing(true);

    try {
      const result = await createBillingEvents(
        serviceItems.map(item => ({
          id: item.id,
          item_code: item.item_code,
          class_code: item.class_code,
          account_id: item.account_id,
          account_name: item.account_name || undefined,
          sidemark_id: item.sidemark_id,
        })),
        selectedServices.map(s => s.service_code)
      );

      if (result.success) {
        hapticSuccess();
        void playScanAudioFeedback('success');
        resetState();
      } else {
        hapticError();
        void playScanAudioFeedback('error');
      }
    } catch (error) {
      console.error('Save error:', error);
      hapticError();
      void playScanAudioFeedback('error');
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to create billing events.',
      });
    } finally {
      setProcessing(false);
    }
  };

  // Handle item selection from search for service mode
  const handleServiceItemSelect = async (item: { id: string; item_code: string; description: string | null; location_code: string | null; warehouse_name: string | null }) => {
    setShowItemSearch(false);

    // Fetch full item data including class_code
    const fullItem = await lookupItemForService(item.item_code);
    if (fullItem) {
      if (!serviceItems.find(i => i.id === fullItem.id)) {
        hapticLight();
        setServiceItems(prev => [...prev, fullItem]);
        toast({
          title: `Added: ${fullItem.item_code}`,
          description: fullItem.class_code
            ? `Class: ${fullItem.class_code}`
            : 'No class assigned - default rate will be used',
        });
      } else {
        toast({
          title: 'Already added',
          description: `${fullItem.item_code} is already in the list.`,
        });
      }
    }
  };

  const selectMode = (selectedMode: ScanMode) => {
    hapticLight(); // Mode selection feedback
    moveScanMode.reset();
    operationsScanMode.reset();
    lookupScanMode.reset();
    serviceScanMode.reset();
    containerScanEngine.reset();
    scanQueueRef.current = [];
    processingRef.current = false;
    inFlightScanRef.current = null;
    setProcessing(false);
    setModeSafe(selectedMode);
    setPhaseSafe('scanning-item');
    setScannedItemSafe(null);
    setTargetLocationSafe(null);
    setBatchItemsSafe([]);
    setContainerTargetSafe(null);
    setContainerScanValue('');
    setContainerScannedUnits([]);
    setContainerPendingUnitsSafe([]);
    setContainerSessionScannedItems([]);
    containerScannedCodeSetRef.current = new Set();
    containerPendingCodeSetRef.current = new Set();
    containerSessionScannedItemSetRef.current = new Set();
    // Auto-collapse sidebar when entering scan mode
    collapseSidebar();
  };

  // Swipe handlers
  const handleSwipeStart = useCallback((clientX: number) => {
    setIsSwiping(true);
    swipeStartX.current = clientX;
  }, []);

  const handleSwipeMove = useCallback((clientX: number) => {
    if (!isSwiping || !swipeContainerRef.current) return;
    
    const containerWidth = swipeContainerRef.current.offsetWidth;
    const swipeDistance = clientX - swipeStartX.current;
    const progress = Math.min(Math.max(swipeDistance / (containerWidth - 80), 0), 1);
    setSwipeProgress(progress);
  }, [isSwiping]);

  const handleSwipeEnd = useCallback(() => {
    if (swipeProgress > 0.70) {
      setSwipeProgress(1);
      setTimeout(() => executeMove(), 100);
    } else {
      setSwipeProgress(0); // Spring back
    }
    setIsSwiping(false);
  }, [swipeProgress]);

  const handleTouchStart = (e: React.TouchEvent) => {
    handleSwipeStart(e.touches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    handleSwipeMove(e.touches[0].clientX);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    handleSwipeStart(e.clientX);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isSwiping) {
      handleSwipeMove(e.clientX);
    }
  };

  const handleMouseUp = () => {
    if (isSwiping) {
      handleSwipeEnd();
    }
  };

  // Prepare location data for search
  const locationData = locations.map(l => ({ id: l.id, code: l.code, name: l.name }));

  // Mode Selection Screen
  if (mode === null) {
    return (
      <DashboardLayout>
        <div className="space-y-6">
          <div className="flex items-start justify-between">
            <PageHeader
              primaryText="Scan"
              accentText="Hub"
              description="High-speed warehouse operations hub"
            />
            <HelpButton workflow="scan_hub" />
          </div>

          <div className="flex flex-col gap-6 w-full max-w-xl mx-auto">
            {/* Unified Move Card */}
            <button
              onClick={() => selectMode('batch')}
              className={cn(
                "group relative overflow-hidden flex items-center gap-6 p-6",
                "rounded-3xl bg-card border-2 border-transparent",
                "transition-all duration-300 text-left",
                "hover:border-primary hover:shadow-xl hover:shadow-primary/10"
              )}
            >
              {/* Large icon container */}
              <div className="w-24 h-28 rounded-3xl bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform duration-200">
                <ScanModeIcon mode="move" size={64} />
              </div>

              {/* Text on right */}
              <div className="flex flex-col items-start flex-1">
                <span className="text-2xl font-bold text-foreground">Move</span>
                <span className="text-sm text-muted-foreground mt-1">Items + locations + containers in one flow</span>
                <span className="flex items-center gap-2 text-primary text-xs font-semibold uppercase tracking-wide mt-3">
                  LAUNCH SCANNER
                  <MaterialIcon name="arrow_forward" size="sm" />
                </span>
              </div>
            </button>

            {/* Look Up Card */}
            <button
              onClick={() => selectMode('lookup')}
              className={cn(
                "group relative overflow-hidden flex items-center gap-6 p-6",
                "rounded-3xl bg-card border-2 border-transparent",
                "transition-all duration-300 text-left",
                "hover:border-emerald-500/50 hover:shadow-xl hover:shadow-emerald-500/10"
              )}
            >
              {/* Large icon container */}
              <div className="w-24 h-28 rounded-3xl bg-emerald-500/10 dark:bg-emerald-500/20 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform duration-200">
                <ScanModeIcon mode="lookup" size={64} />
              </div>

              {/* Text on right */}
              <div className="flex flex-col items-start flex-1">
                <span className="text-2xl font-bold text-foreground">Look Up</span>
                <span className="text-sm text-muted-foreground mt-1">Scan to view item details</span>
                <span className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 text-xs font-semibold uppercase tracking-wide mt-3">
                  LAUNCH SCANNER
                  <MaterialIcon name="arrow_forward" size="sm" />
                </span>
              </div>
            </button>

            {/* Service Event Scan Card */}
            <button
              onClick={() => selectMode('service')}
              className={cn(
                "group relative overflow-hidden flex items-center gap-6 p-6",
                "rounded-3xl bg-card border-2 border-transparent",
                "transition-all duration-300 text-left",
                "hover:border-amber-500/50 hover:shadow-xl hover:shadow-amber-500/10"
              )}
            >
              {/* Large icon container */}
              <div className="w-24 h-28 rounded-3xl bg-amber-500/10 dark:bg-amber-500/20 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform duration-200">
                <ScanModeIcon mode="service-event" size={64} />
              </div>

              {/* Text on right */}
              <div className="flex flex-col items-start flex-1">
                <span className="text-2xl font-bold text-foreground">Service Event</span>
                <span className="text-sm text-muted-foreground mt-1">Scan items, select services, create billing</span>
                <span className="flex items-center gap-2 text-amber-600 dark:text-amber-400 text-xs font-semibold uppercase tracking-wide mt-3">
                  LAUNCH SCANNER
                  <MaterialIcon name="arrow_forward" size="sm" />
                </span>
              </div>
            </button>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // Service Event Scan Screen
  if (mode === 'service') {
    const totalBillingEvents = serviceItems.length * selectedServices.length;

    // Calculate billing preview total
    let billingPreviewTotal = 0;
    let hasRateErrors = false;
    for (const item of serviceItems) {
      for (const service of selectedServices) {
        const rateInfo = getServiceRate(service.service_code, item.class_code);
        if (rateInfo.hasError) hasRateErrors = true;
        billingPreviewTotal += rateInfo.rate;
      }
    }

    return (
      <DashboardLayout>
        <div className="flex flex-col min-h-[70vh] px-4 pb-4">
          <button
            onClick={resetState}
            className="flex items-center gap-2 text-muted-foreground mb-4 hover:text-foreground transition-colors"
          >
            <MaterialIcon name="arrow_back" size="md" />
            Back
          </button>

          <div className="text-center mb-4">
            <h2 className="text-xl font-bold">Service Event Scan</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Scan items and select services to create billing events
            </p>
          </div>

          <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* LEFT: Items List */}
            <Card className="flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <span>📦</span>
                  Items ({serviceItems.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                {/* QR Scanner */}
                <div className="mb-4" ref={serviceScannerRef}>
                  <QRScanner
                    onScan={serviceScanMode.onScan}
                    onError={(error) => console.error('Scanner error:', error)}
                    // Keep camera open; scan engine blocks processing when needed.
                    scanning
                    paused={serviceScanMode.isOverlayBlocked || quarantineWarningOpen}
                    blockingOverlay={
                      serviceScanMode.overlay
                        ? {
                            open: true,
                            title: serviceScanMode.overlay.title,
                            reason: serviceScanMode.overlay.reason,
                            code: serviceScanMode.overlay.code,
                            hint: 'Tap to dismiss',
                            dismissLabel: 'Dismiss / Continue Scanning',
                            onDismiss: serviceScanMode.dismissOverlay,
                          }
                        : null
                    }
                  />
                </div>


                {/* Items List */}
                <div className="flex-1 overflow-auto max-h-64">
                  {serviceItems.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <div className="text-5xl mb-2 opacity-30">📦</div>
                      <p>No items scanned yet</p>
                      <p className="text-sm">Scan QR codes or search above</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {serviceItems.map((item) => {
                        const hasNoClass = !item.class_code;
                        return (
                          <div
                            key={item.id}
                            className={cn(
                              "flex items-center gap-3 p-3 rounded-lg border",
                              hasNoClass ? "border-warning/50 bg-warning/5" : "border-border"
                            )}
                          >
                            <span className="text-xl flex-shrink-0">📦</span>
                            <div className="flex-1 min-w-0">
                              <p className="font-mono font-medium text-sm truncate">{item.item_code}</p>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                {item.class_code ? (
                                  <Badge variant="secondary" className="text-xs">
                                    {item.class_code}
                                  </Badge>
                                ) : (
                                  <span className="flex items-center gap-1 text-warning">
                                    ⚠️ No class
                                  </span>
                                )}
                                {item.current_location_code && (
                                  <span>{item.current_location_code}</span>
                                )}
                              </div>
                            </div>
                            <button
                              onClick={() => removeServiceItem(item.id)}
                              className="text-destructive hover:bg-destructive/10 p-1 rounded"
                            >
                              <MaterialIcon name="close" size="sm" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* RIGHT: Services Selection */}
            <Card className="flex flex-col">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <span>💰</span>
                  Services ({selectedServices.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="flex-1 flex flex-col">
                {/* Service Dropdown */}
                <div className="mb-4">
                  <Select onValueChange={addServiceEvent}>
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder="Select a service (auto-add)..." />
                    </SelectTrigger>
                    <SelectContent>
                      {scanServiceEvents
                        .filter(s => !selectedServices.find(sel => sel.service_code === s.service_code))
                        .map((service) => (
                          <SelectItem key={service.service_code} value={service.service_code}>
                            <div className="flex items-center justify-between gap-4">
                              <span>{service.service_name}</span>
                              <span className="text-muted-foreground text-xs">
                                ${service.rate.toFixed(2)}/{service.billing_unit}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Selected Services List */}
                <div className="flex-1 overflow-auto max-h-64">
                  {selectedServices.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <div className="text-5xl mb-2 opacity-30">💰</div>
                      <p>No services selected</p>
                      <p className="text-sm">Select services from dropdown above</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {selectedServices.map((service) => (
                        <div
                          key={service.service_code}
                          className="flex items-center gap-3 p-3 rounded-lg border border-border"
                        >
                          <span className="text-xl text-success flex-shrink-0">⚡</span>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm truncate">{service.service_name}</p>
                            <p className="text-xs text-muted-foreground">
                              {service.uses_class_pricing ? (
                                <span className="text-info">Class-based pricing</span>
                              ) : (
                                <span>${service.rate.toFixed(2)} / {service.billing_unit}</span>
                              )}
                            </p>
                          </div>
                          <button
                            onClick={() => removeServiceEvent(service.service_code)}
                            className="text-destructive hover:bg-destructive/10 p-1 rounded"
                          >
                            <MaterialIcon name="close" size="sm" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Rate Preview for items without class */}
                {serviceItems.some(i => !i.class_code) && selectedServices.some(s => s.uses_class_pricing) && (
                  <div className="mt-4 p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
                    <div className="flex items-start gap-2">
                      <MaterialIcon name="error" size="sm" className="text-destructive flex-shrink-0 mt-0.5" />
                      <div className="text-sm">
                        <p className="font-medium text-destructive">Item class required</p>
                        <p className="text-muted-foreground">
                          Some items have no class assigned. Saving is blocked until these items are removed or a class is assigned.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Summary & Save */}
          <div className="mt-4 pt-4 border-t">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm text-muted-foreground">Billing events to create:</p>
                <p className="text-2xl font-bold">
                  {totalBillingEvents}
                  <span className="text-sm font-normal text-muted-foreground ml-2">
                    ({serviceItems.length} items × {selectedServices.length} services)
                  </span>
                </p>
              </div>
              {/* Billing Preview - Manager/Admin Only */}
              {canSeeBilling && billingPreviewTotal > 0 && (
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">Estimated Total</p>
                  <p className="text-2xl font-bold text-primary">
                    ${billingPreviewTotal.toFixed(2)}
                  </p>
                  {hasRateErrors && (
                    <p className="text-xs text-warning flex items-center gap-1 justify-end">
                      <span>⚠️</span> Some items missing class
                    </p>
                  )}
                </div>
              )}
            </div>

            <Button
              onClick={saveServiceEvents}
              disabled={serviceItems.length === 0 || selectedServices.length === 0 || processing}
              className="w-full h-14 text-lg"
              size="lg"
            >
              {processing ? (
                <>
                  <MaterialIcon name="progress_activity" size="md" className="mr-2 animate-spin" />
                  Creating Billing Events...
                </>
              ) : (
                <>
                  <span className="mr-2">💾</span>
                  Save Billing Events
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Item Search Overlay */}
        <ItemSearchOverlay
          open={showItemSearch}
          onClose={() => setShowItemSearch(false)}
          onSelect={handleServiceItemSelect}
          excludeIds={serviceItems.map(i => i.id)}
        />
      </DashboardLayout>
    );
  }

  // Container Scan Screen (scan container, then scan IC unit codes into it)
  if (mode === 'container') {
    const active = containerTarget;
    const addedCount = containerScannedUnits.filter((u) => u.added).length;
    const failedCount = containerScannedUnits.length - addedCount;
    const pendingCount = containerPendingUnits.length;

    const submitManualScan = () => {
      const v = containerScanValue.trim();
      if (!v) return;
      containerScanEngine.onScan(v);
      setContainerScanValue('');
    };

    const resetContainerSession = () => {
      setContainerTargetSafe(null);
      setContainerScannedUnits([]);
      setContainerPendingUnitsSafe([]);
      containerScannedCodeSetRef.current = new Set();
      containerPendingCodeSetRef.current = new Set();
      setContainerScanValue('');
      setTimeout(() => containerScanInputRef.current?.focus(), 50);
    };

    return (
      <DashboardLayout>
        <div className="flex flex-col min-h-[70vh] px-4 pb-4">
          <button
            onClick={resetState}
            className="flex items-center gap-2 text-muted-foreground mb-4 hover:text-foreground transition-colors"
          >
            <MaterialIcon name="arrow_back" size="md" />
            Back
          </button>

          <div className="text-center mb-4">
            <h2 className="text-xl font-bold">Scan to Container</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {active
                ? `Active container: ${active.container_code}`
                : 'Scan a container label to begin'}
            </p>
          </div>

          <div className="flex-1 flex flex-col items-center">
            <div className="w-full max-w-sm mb-4">
              <QRScanner
                onScan={containerScanEngine.onScan}
                onError={(error) => console.error('Scanner error:', error)}
                scanning={!processing}
              />
            </div>

            <Card className="w-full max-w-md">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                  <span>{active ? '📦' : '🏷️'}</span>
                  {active ? 'Scan Units' : pendingCount > 0 ? 'Scan Container' : 'Select Container'}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {active ? (
                  <>
                    <div className="rounded-xl border p-3 bg-muted/20">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-mono font-semibold truncate">{active.container_code}</div>
                          <div className="text-xs text-muted-foreground">
                            {active.container_type ? `Type: ${active.container_type}` : 'Type: —'}
                            {active.location_code ? ` • Location: ${active.location_code}` : ' • Location: —'}
                          </div>
                        </div>
                        <Badge variant="outline">{active.status}</Badge>
                      </div>

                      <div className="flex flex-wrap gap-2 mt-3">
                        <Button size="sm" variant="outline" onClick={() => navigate(`/containers/${active.id}`)}>
                          <MaterialIcon name="open_in_new" size="sm" className="mr-2" />
                          Open
                        </Button>
                        <Button size="sm" variant="outline" onClick={resetContainerSession}>
                          <MaterialIcon name="sync" size="sm" className="mr-2" />
                          Change
                        </Button>
                      </div>
                    </div>

                    {!active.location_id && (
                      <div className="rounded-md border border-amber-300 bg-amber-50/50 p-3 text-sm">
                        <div className="font-medium text-amber-900">Container has no location</div>
                        <div className="text-xs text-amber-900/80 mt-1">
                          Assign/move this container to a location before adding units.
                        </div>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Input
                        ref={containerScanInputRef}
                        placeholder="Scan or type IC code…"
                        value={containerScanValue}
                        onChange={(e) => setContainerScanValue(e.target.value.toUpperCase())}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            submitManualScan();
                          }
                        }}
                        disabled={processing || !active.location_id}
                        className="font-mono"
                        autoFocus
                      />
                      <Button
                        onClick={submitManualScan}
                        disabled={processing || !containerScanValue.trim() || !active.location_id}
                      >
                        <MaterialIcon name="add" size="sm" className="mr-2" />
                        Add
                      </Button>
                    </div>

                    {containerScannedUnits.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {addedCount} added • {failedCount} failed • showing last {Math.min(containerScannedUnits.length, 50)}
                      </div>
                    )}

                    {containerScannedUnits.length > 0 && (
                      <div className="rounded-md border max-h-[260px] overflow-auto">
                        <div className="divide-y">
                          {containerScannedUnits.map((u) => (
                            <div key={`${u.id}-${u.ic_code}`} className="px-3 py-2 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="font-mono text-sm font-medium truncate">{u.ic_code}</div>
                                {u.message && (
                                  <div className="text-xs text-muted-foreground truncate">{u.message}</div>
                                )}
                              </div>
                              <Badge className={u.added ? 'bg-green-600 text-white' : ''} variant={u.added ? 'default' : 'destructive'}>
                                {u.added ? 'Added' : 'Failed'}
                              </Badge>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="text-sm text-muted-foreground">
                      Scan unit IC codes first (optional), then scan the container label to pack them — or scan a container first and add units into it.
                    </div>
                    <div className="flex gap-2">
                      <Input
                        placeholder={pendingCount > 0 ? 'Scan container (CNT-#####)' : 'Scan container or IC code…'}
                        value={containerScanValue}
                        onChange={(e) => setContainerScanValue(e.target.value.toUpperCase())}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            submitManualScan();
                          }
                        }}
                        disabled={processing}
                        className="font-mono"
                        autoFocus
                      />
                      <Button onClick={submitManualScan} disabled={processing || !containerScanValue.trim()}>
                        <MaterialIcon name="check" size="sm" className="mr-2" />
                        Scan
                      </Button>
                    </div>

                    {pendingCount > 0 && (
                      <div className="rounded-md border p-3 bg-muted/10 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium">
                            Pending units: {pendingCount}
                          </div>
                          <Button variant="outline" size="sm" onClick={() => {
                            setContainerPendingUnitsSafe([]);
                            containerPendingCodeSetRef.current = new Set();
                          }}>
                            Clear
                          </Button>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Scan a container label next to pack these units.
                        </div>
                        <div className="max-h-[180px] overflow-auto rounded-md border bg-background">
                          <div className="divide-y">
                            {containerPendingUnits.slice(-20).reverse().map((u) => (
                              <div key={u.id} className="px-3 py-2 flex items-center justify-between gap-3">
                                <div className="font-mono text-sm font-medium truncate">{u.ic_code}</div>
                                {u.container_id ? (
                                  <Badge variant="outline" className="text-xs">In container</Badge>
                                ) : (
                                  <Badge variant="secondary" className="text-xs">Loose</Badge>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="text-xs text-muted-foreground">
                      Tip: print container labels from Containers / Location / Container detail pages.
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // Confirmation Screen with Swipe
  if (phase === 'confirm') {
    const items = mode === 'move' && scannedItem ? [scannedItem] : batchItems;
    
    return (
      <DashboardLayout>
        <div className="flex flex-col min-h-[70vh] px-4">
          <button
            onClick={resetState}
            className="flex items-center gap-2 text-muted-foreground mb-6 hover:text-foreground transition-colors"
          >
            <MaterialIcon name="arrow_back" size="md" />
            Cancel
          </button>

          <div className="flex-1 flex flex-col items-center justify-center">
            <div className="text-center mb-8">
              <div className="text-6xl mb-4">✅</div>
              <h2 className="text-2xl font-bold">Confirm Move</h2>
            </div>

            <Card className="w-full max-w-md mb-6">
              <CardContent className="pt-6">
                <div className="space-y-3">
                  {items.slice(0, 3).map((item) => (
                    <div key={item.id} className="flex items-center gap-3">
                      <span className="text-xl">📦</span>
                      <div>
                        <p className="font-medium">{item.item_code}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.current_location_code || 'No location'} → {targetLocation?.code}
                        </p>
                      </div>
                    </div>
                  ))}
                  {items.length > 3 && (
                    <p className="text-sm text-muted-foreground text-center">
                      +{items.length - 3} more items
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-center gap-4 mt-6 py-4 border-t">
                  <div className="text-center">
                    <p className="text-xs text-muted-foreground">Moving to</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xl text-primary">📍</span>
                      <span className="text-xl font-bold">{targetLocation?.code}</span>
                    </div>
                    {targetLocation?.name && (
                      <p className="text-sm text-muted-foreground">{targetLocation.name}</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Swipe to Confirm */}
            <div
              ref={swipeContainerRef}
              className="relative w-full max-w-md h-16 bg-muted rounded-full overflow-hidden cursor-pointer select-none"
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={handleSwipeEnd}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            >
              {/* Progress fill */}
              <div
                className={cn("absolute inset-y-0 left-0 bg-primary/20", !isSwiping && "transition-all duration-300")}
                style={{ width: `${swipeProgress * 100}%` }}
              />
              {/* Thumb */}
              <div
                className={cn(
                  "absolute inset-y-1 left-1 w-14 h-14 rounded-full bg-primary flex items-center justify-center shadow-lg",
                  !isSwiping && "transition-transform duration-300",
                  processing && "animate-pulse"
                )}
                style={{ transform: `translateX(${swipeProgress * (swipeContainerRef.current?.offsetWidth || 300 - 72)}px)` }}
              >
                {processing ? '⏳' : swipeProgress >= 1 ? '✅' : '➡️'}
              </div>
              {/* Label */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className={cn(
                  "text-muted-foreground font-medium transition-opacity",
                  swipeProgress > 0.2 && "opacity-0"
                )}>
                  Swipe to confirm ➡️
                </span>
              </div>
            </div>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // Scanning Screen with Camera + Manual Entry
  return (
    <DashboardLayout>
      <div className="flex flex-col min-h-[70vh] px-4 pb-4">
        <button
          onClick={resetState}
          className="flex items-center gap-2 text-muted-foreground mb-4 hover:text-foreground transition-colors"
        >
          <MaterialIcon name="arrow_back" size="md" />
          Back
        </button>

        {/* Title and instructions */}
        <div className="text-center mb-4 relative">
          {/* Help button for movement workflow */}
          {(mode === 'move' || mode === 'batch') && (
            <div className="absolute right-0 top-0">
              <HelpButton workflow="movement" />
            </div>
          )}
          <h2 className="text-xl font-bold">
            {mode === 'lookup' && 'Scan Item'}
            {mode === 'move' && phase === 'scanning-item' && 'Scan Item'}
            {mode === 'move' && phase === 'scanning-location' && 'Scan Location'}
            {mode === 'batch' && (containerTarget ? `Container Session: ${containerTarget.container_code}` : 'Operations Scan')}
          </h2>
          
          <p className="text-sm text-muted-foreground mt-1">
            {mode === 'lookup' && 'Point camera at QR code or search below'}
            {mode === 'move' && phase === 'scanning-item' && 'Scan the item or search below'}
            {mode === 'move' && phase === 'scanning-location' && 'Scan the bay or search below'}
            {mode === 'batch' && (containerTarget
              ? 'Scan item labels to pack, or scan a location to move this container'
              : 'Scan items then location to move, or scan a container to start a container session')}
          </p>
        </div>

        <div className="flex-1 flex flex-col items-center">
          {/* Camera Scanner - smaller to fit with manual entry */}
          <div className="w-full max-w-sm mb-4">
            <QRScanner
              onScan={
                mode === 'lookup'
                  ? lookupScanMode.onScan
                  : mode === 'move'
                    ? moveScanMode.onScan
                    : mode === 'batch'
                      ? operationsScanMode.onScan
                      : handleScanResult
              }
              onError={(error) => console.error('Scanner error:', error)}
              scanning={phase === 'scanning-item' || phase === 'scanning-location'}
              paused={
                quarantineWarningOpen ||
                (mode === 'lookup' && lookupScanMode.isOverlayBlocked) ||
                (mode === 'move' && moveScanMode.isOverlayBlocked) ||
                (mode === 'batch' && operationsScanMode.isOverlayBlocked)
              }
              blockingOverlay={
                mode === 'lookup' && lookupScanMode.overlay
                  ? {
                      open: true,
                      title: lookupScanMode.overlay.title,
                      reason: lookupScanMode.overlay.reason,
                      code: lookupScanMode.overlay.code,
                      hint: 'Tap to dismiss',
                      dismissLabel: 'Dismiss / Continue Scanning',
                      onDismiss: lookupScanMode.dismissOverlay,
                    }
                  : mode === 'move' && moveScanMode.overlay
                    ? {
                        open: true,
                        title: moveScanMode.overlay.title,
                        reason: moveScanMode.overlay.reason,
                        code: moveScanMode.overlay.code,
                        hint: 'Tap to dismiss',
                        dismissLabel: 'Dismiss / Continue Scanning',
                        onDismiss: moveScanMode.dismissOverlay,
                      }
                  : mode === 'batch' && operationsScanMode.overlay
                    ? {
                        open: true,
                        title: operationsScanMode.overlay.title,
                        reason: operationsScanMode.overlay.reason,
                        code: operationsScanMode.overlay.code,
                        hint: 'Tap to dismiss',
                        dismissLabel: 'Dismiss / Continue Scanning',
                        onDismiss: operationsScanMode.dismissOverlay,
                      }
                  : null
              }
            />
          </div>

          {/* Visual Verification Section - shows below scanner for Move/Batch modes */}
          {mode !== 'lookup' && (
            <Card className="w-full max-w-md mb-4">
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  {/* Item Field */}
                  <button
                    onClick={() => setShowItemSearch(true)}
                    className={cn(
                      "flex-1 flex items-center gap-2 p-3 rounded-xl border-2 transition-all",
                      scannedItem || (mode === 'batch' && batchItems.length > 0)
                        ? "border-primary bg-primary/5"
                        : "border-dashed border-muted-foreground/30 hover:border-muted-foreground/50"
                    )}
                  >
                    <span className="text-xl flex-shrink-0">📦</span>
                    <div className="flex-1 text-left min-w-0">
                      {mode === 'move' && scannedItem ? (
                        <>
                          <p className="font-mono font-bold text-sm truncate">{scannedItem.item_code}</p>
                          <p className="text-xs text-muted-foreground truncate">{scannedItem.current_location_code || 'No location'}</p>
                        </>
                      ) : mode === 'batch' && batchItems.length > 0 ? (
                        <>
                          <p className="font-bold text-sm">{batchItems.length} items</p>
                          <p className="text-xs text-muted-foreground">Tap to add more</p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm text-muted-foreground">Item</p>
                          <p className="text-xs text-muted-foreground/60">Tap to search</p>
                        </>
                      )}
                    </div>
                    {(scannedItem || (mode === 'batch' && batchItems.length > 0)) && (
                      <MaterialIcon name="check" size="sm" className="text-primary flex-shrink-0" />
                    )}
                  </button>

                  {/* Swap Button */}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-10 w-10 flex-shrink-0"
                    onClick={() => {
                      // Swap logic - clear item and start over with location
                      if (scannedItem && targetLocation) {
                        hapticLight();
                        scanQueueRef.current = [];
                        setScannedItemSafe(null);
                        setTargetLocationSafe(null);
                        setPhaseSafe('scanning-item');
                        toast({
                          title: 'Cleared',
                          description: 'Scan a new item and location.',
                        });
                      }
                    }}
                    disabled={!scannedItem && batchItems.length === 0}
                    title="Swap / Clear"
                  >
                    <MaterialIcon name="swap_horiz" size="sm" />
                  </Button>

                  {/* Location Field */}
                  <button
                    onClick={() => {
                      if ((scannedItem || batchItems.length > 0 || (mode === 'batch' && !!containerTarget))) {
                        setShowLocationSearch(true);
                      }
                    }}
                    disabled={!scannedItem && batchItems.length === 0 && !(mode === 'batch' && !!containerTarget)}
                    className={cn(
                      "flex-1 flex items-center gap-2 p-3 rounded-xl border-2 transition-all",
                      targetLocation
                        ? "border-primary bg-primary/5"
                        : scannedItem || batchItems.length > 0 || (mode === 'batch' && !!containerTarget)
                          ? "border-dashed border-primary/50 hover:border-primary animate-pulse"
                          : "border-dashed border-muted-foreground/30 opacity-50"
                    )}
                  >
                    <span className="text-xl flex-shrink-0">📍</span>
                    <div className="flex-1 text-left min-w-0">
                      {targetLocation ? (
                        <>
                          <p className="font-mono font-bold text-sm truncate">{targetLocation.code}</p>
                          <p className="text-xs text-muted-foreground truncate">{targetLocation.name || 'Location'}</p>
                        </>
                      ) : (
                        <>
                          <p className="text-sm text-muted-foreground">Location</p>
                          <p className="text-xs text-muted-foreground/60">
                            {mode === 'batch' && containerTarget
                              ? 'Tap to move active container'
                              : scannedItem || batchItems.length > 0
                                ? 'Tap to select'
                                : 'Scan item first'}
                          </p>
                        </>
                      )}
                    </div>
                    {targetLocation && (
                      <MaterialIcon name="check" size="sm" className="text-primary flex-shrink-0" />
                    )}
                  </button>
                </div>

                {/* Quick Proceed Button when both are filled */}
                {((scannedItem && targetLocation) || (batchItems.length > 0 && targetLocation)) && (
                  <Button
                    className="w-full mt-4"
                    onClick={() => {
                      scanQueueRef.current = [];
                      setPhaseSafe('confirm');
                    }}
                  >
                    <MaterialIcon name="check" size="sm" className="mr-2" />
                    Proceed to Confirm
                  </Button>
                )}
              </CardContent>
            </Card>
          )}

          {/* Cross-warehouse mismatch banner */}
          {crossWarehouseInfo && (
            <CrossWarehouseBanner
              itemWarehouse={crossWarehouseInfo.itemWarehouse}
              destWarehouse={crossWarehouseInfo.destWarehouse}
              isMixedBatch={crossWarehouseInfo.isMixedBatch}
            />
          )}

          {/* Location Suggestions Panel */}
          {(mode === 'move' || mode === 'batch') && suggestionsWarning && (
            <div className="w-full max-w-md mt-3 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 flex items-center gap-2">
              <MaterialIcon name="warning" size="sm" />
              {suggestionsWarning}
            </div>
          )}
          {(mode === 'move' || mode === 'batch') && suggestionsEnabled && !suggestionsWarning && (
            <SuggestionPanel
              suggestions={suggestions}
              loading={suggestionsLoading}
              error={suggestionsError}
              mode={mode === 'batch' ? 'batch' : 'single'}
              onRefresh={refetchSuggestions}
              matchChipLabel={scannedItem?.item_code ? 'SKU match' : 'Item match'}
            />
          )}

          {/* Processing indicator */}
          {processing && (
            <div className="flex items-center gap-2 text-primary mb-4">
              <MaterialIcon name="progress_activity" size="md" className="animate-spin" />
              <span>Processing...</span>
            </div>
          )}

          {/* Batch: location search button when items added */}
          {mode === 'batch' && batchItems.length > 0 && !containerTarget && (
            <div className="w-full max-w-md">
              <button
                onClick={() => setShowLocationSearch(true)}
                className="w-full flex items-center justify-center gap-3 p-4 bg-primary text-primary-foreground rounded-xl transition-colors"
              >
                <span>📍</span>
                <span className="font-medium">Select Destination Bay</span>
              </button>
            </div>
          )}

          {/* Active container session summary (operations scanner) */}
          {mode === 'batch' && containerTarget && (
            <Card className="w-full max-w-md mt-4">
              <CardContent className="py-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold truncate">{containerTarget.container_code}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {containerTarget.location_code ? `Location: ${containerTarget.location_code}` : 'No location'}
                    </p>
                  </div>
                  <Badge variant="outline">{containerTarget.status}</Badge>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => navigate(`/containers/${containerTarget.id}`)}>
                    <MaterialIcon name="open_in_new" size="sm" className="mr-2" />
                    Open Container
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setContainerTargetSafe(null);
                      setContainerSessionScannedItems([]);
                      containerSessionScannedItemSetRef.current = new Set();
                    }}
                  >
                    <MaterialIcon name="close" size="sm" className="mr-2" />
                    End Session
                  </Button>
                </div>

                {containerSessionScannedItems.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">
                      Recent packed scans ({containerSessionScannedItems.length})
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {containerSessionScannedItems.slice(0, 12).map((row) => (
                        <Badge
                          key={`${row.id}-${row.item_code}`}
                          variant={row.added ? 'secondary' : 'destructive'}
                          className="text-xs"
                        >
                          {row.item_code}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Scanned item indicator for move mode */}
          {mode === 'move' && scannedItem && phase === 'scanning-location' && (
            <Card className="w-full max-w-md mt-4">
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">📦</span>
                  <div className="flex-1">
                    <p className="font-bold">{scannedItem.item_code}</p>
                    <p className="text-sm text-muted-foreground">{scannedItem.description || 'No description'}</p>
                  </div>
                  <span className="text-xl text-muted-foreground">➡️</span>
                  <span className="text-2xl text-muted-foreground">📍</span>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Batch items list */}
          {mode === 'batch' && batchItems.length > 0 && (
            <Card className="w-full max-w-md mt-4">
              <CardContent className="py-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Batch: {batchItems.length} items</span>
                    {/* Add item button */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowItemSearch(true)}
                      className="h-7 w-7 p-0 rounded-full bg-primary/10 hover:bg-primary/20"
                    >
                      <MaterialIcon name="add" size="sm" className="text-primary" />
                    </Button>
                  </div>
                  <button
                    onClick={() => {
                      scanQueueRef.current = [];
                      setBatchItemsSafe([]);
                    }}
                    className="text-sm text-destructive hover:underline"
                  >
                    Clear All
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {batchItems.map((item) => (
                    <Badge key={item.id} variant="secondary" className="text-sm pl-2.5 pr-1 py-1 gap-1">
                      {item.item_code}
                      <button
                        onClick={() => {
                          scanQueueRef.current = [];
                          setBatchItemsSafe(prev => prev.filter(i => i.id !== item.id));
                        }}
                        className="ml-0.5 p-0.5 rounded-full hover:bg-destructive/20 hover:text-destructive transition-colors"
                      >
                        <MaterialIcon name="close" size="sm" />
                      </button>
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Search Overlays */}
      <ItemSearchOverlay
        open={showItemSearch}
        onClose={() => setShowItemSearch(false)}
        onSelect={handleItemSelect}
        excludeIds={mode === 'batch' ? batchItems.map(i => i.id) : []}
      />

      <LocationSearchOverlay
        open={showLocationSearch}
        onClose={() => setShowLocationSearch(false)}
        onSelect={handleLocationSelect}
        locations={locationData}
      />

      {/* SOP Validation Dialog */}
      <SOPValidationDialog
        open={sopValidationOpen}
        onOpenChange={setSopValidationOpen}
        blockers={sopBlockers}
      />

      {/* Override Confirmation Modal */}
      <OverrideConfirmModal
        open={overrideModalOpen}
        onOpenChange={(open) => { if (!open) handleOverrideCancel(); }}
        blockingReasons={overrideBlockingReasons}
        allReasons={overrideAllReasons}
        onConfirm={handleOverrideConfirm}
        onCancel={handleOverrideCancel}
      />

      {/* Quarantine Warning Dialog */}
      <AlertDialog open={quarantineWarningOpen} onOpenChange={handleQuarantineDismiss}>
        <AlertDialogContent className="border-red-300 dark:border-red-800">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <MaterialIcon name="warning" size="md" />
              Item Quarantined
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p className="text-base font-medium text-foreground">
                {quarantineItem?.item_code} is under quarantine due to reported damage.
              </p>
              <p>
                This item should not be moved, released, or processed until the issue is resolved.
                Proceeding will log an override in the activity history.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" onClick={handleQuarantineDismiss}>
              Go Back
            </Button>
            <Button variant="destructive" onClick={handleQuarantineOverride}>
              Override &amp; Continue
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}
