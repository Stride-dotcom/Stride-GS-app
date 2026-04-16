import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { usePutAwayAssistantData, type PutAwayAssistantItem } from '@/hooks/usePutAwayAssistantData';
import { useLocations } from '@/hooks/useLocations';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useScanEngine } from '@/hooks/useScanEngine';
import { parseScanPayload } from '@/lib/scan/parseScanPayload';
import { isLikelyLocationCode as isLikelyLocationCodeUtil } from '@/lib/scan/isLikelyLocationCode';
import { lookupItemByScan } from '@/lib/scan/lookupItemByScan';
import { supabase } from '@/integrations/supabase/client';
import { type LocationSuggestion } from '@/hooks/useLocationSuggestions';
import { useStocktakeFreezeCheck } from '@/hooks/useStocktakes';
import { QRScanner } from '@/components/scan/QRScanner';
import { ScanModeIcon } from '@/components/scan/ScanModeIcon';
import { SOPValidationDialog, type SOPBlocker } from '@/components/common/SOPValidationDialog';
import { logItemActivity } from '@/lib/activity/logItemActivity';
import { hapticError, hapticLight, hapticMedium, hapticSuccess } from '@/lib/haptics';
import { playScanAudioFeedback } from '@/lib/scan/scanAudioFeedback';
import {
  buildPutAwayFallbackSuggestions,
  evaluateSpecialStorageCompliance,
} from '@/lib/capacity/capacityModule';

type SortField = 'received_at' | 'item_code' | 'current_location' | 'suggested';
type SortDirection = 'asc' | 'desc';

type ScannerOverlay = {
  reason: string;
  code?: string;
};

type SuggestionWithPreview = LocationSuggestion & {
  selectable: boolean;
  preview_available_cuft: number;
};

interface ScannedPutAwayItem extends PutAwayAssistantItem {
  current_location_name?: string | null;
}

interface PutAwayAssistantCardProps {
  context: 'dashboard' | 'shipments';
  className?: string;
}

function mapItemSize(item: PutAwayAssistantItem | undefined): number {
  const raw = Number(item?.size ?? 0);
  if (!Number.isFinite(raw) || raw < 0) return 0;
  return raw;
}

function formatTimeEstimate(minutes: number): string {
  if (minutes <= 0) return '';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function stableMapEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (a[key] !== b[key]) return false;
  }
  return true;
}

function sortRows(
  rows: PutAwayAssistantItem[],
  sortField: SortField,
  sortDirection: SortDirection,
  getSuggestedSortValue: (itemId: string) => string,
) {
  const dir = sortDirection === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    if (sortField === 'received_at') {
      const av = a.received_at ? new Date(a.received_at).getTime() : 0;
      const bv = b.received_at ? new Date(b.received_at).getTime() : 0;
      return (av - bv) * dir;
    }
    if (sortField === 'item_code') {
      return a.item_code.localeCompare(b.item_code, undefined, { sensitivity: 'base' }) * dir;
    }
    if (sortField === 'current_location') {
      return (a.current_location_code || '').localeCompare(b.current_location_code || '', undefined, {
        sensitivity: 'base',
      }) * dir;
    }
    return getSuggestedSortValue(a.id).localeCompare(getSuggestedSortValue(b.id), undefined, {
      sensitivity: 'base',
    }) * dir;
  });
}

function normalizeScannedCode(raw: string): string {
  return (raw || '').trim();
}

export function PutAwayAssistantCard({ context, className }: PutAwayAssistantCardProps) {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { toast } = useToast();
  const { checkFreeze } = useStocktakeFreezeCheck();

  const {
    selectedWarehouse,
    selectedWarehouseId,
    defaultReceivingLocationId,
    sourceLocationIds,
    sourceLocations,
    extraSourceLocations,
    canEditSources,
    savingSources,
    updateExtraSourceLocationIds,
    items,
    putAwayCount,
    putAwayUrgentCount,
    putAwayTimeEstimate,
    loading,
    refetch,
  } = usePutAwayAssistantData();

  const { locations, loading: locationsLoading } = useLocations(selectedWarehouseId || undefined);

  const [expanded, setExpanded] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [sortField, setSortField] = useState<SortField>('received_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const [sourceDialogOpen, setSourceDialogOpen] = useState(false);
  const [sourceSearch, setSourceSearch] = useState('');
  const [draftExtraSourceIds, setDraftExtraSourceIds] = useState<string[]>([]);

  const [suggestionsByItemId, setSuggestionsByItemId] = useState<Record<string, LocationSuggestion[]>>({});
  const [suggestionsLoadingByItemId, setSuggestionsLoadingByItemId] = useState<Record<string, boolean>>({});
  const [suggestionsErrorByItemId, setSuggestionsErrorByItemId] = useState<Record<string, string | null>>({});
  const suggestionReqSeqRef = useRef(0);

  const [selectedDestinationByItemId, setSelectedDestinationByItemId] = useState<Record<string, string>>({});
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerOverlay, setScannerOverlay] = useState<ScannerOverlay | null>(null);
  const [scannerItems, setScannerItems] = useState<ScannedPutAwayItem[]>([]);
  const [scannerDestination, setScannerDestination] = useState<{ id: string; code: string; name?: string | null } | null>(null);

  const [processingMove, setProcessingMove] = useState(false);

  const [sopDialogOpen, setSopDialogOpen] = useState(false);
  const [sopBlockers, setSopBlockers] = useState<SOPBlocker[]>([]);
  const [pendingOverrideExecution, setPendingOverrideExecution] = useState<{
    assignments: Record<string, string>;
    source: 'manual' | 'scanner';
  } | null>(null);

  const [useSwipeConfirm, setUseSwipeConfirm] = useState(true);

  // Inline swipe controls (mobile/tablet).
  const [manualSwipeProgress, setManualSwipeProgress] = useState(0);
  const [scannerSwipeProgress, setScannerSwipeProgress] = useState(0);
  const [isManualSwiping, setIsManualSwiping] = useState(false);
  const [isScannerSwiping, setIsScannerSwiping] = useState(false);
  const manualSwipeStartX = useRef(0);
  const scannerSwipeStartX = useRef(0);
  const manualSwipeRef = useRef<HTMLDivElement>(null);
  const scannerSwipeRef = useRef<HTMLDivElement>(null);

  const itemDetailsCacheRef = useRef<Record<string, ScannedPutAwayItem>>({});
  const itemDetailsBatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemDetailsBatchPendingIdsRef = useRef<Set<string>>(new Set());
  const itemDetailsBatchResolversRef = useRef<Record<string, Array<(item: ScannedPutAwayItem | null) => void>>>({});

  const defaultReceivingLocationCode = useMemo(() => {
    if (!defaultReceivingLocationId) return null;
    const loc = locations.find((l) => l.id === defaultReceivingLocationId);
    return loc?.code || null;
  }, [defaultReceivingLocationId, locations]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 1024px)');
    const apply = () => setUseSwipeConfirm(media.matches);
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    const timerRef = itemDetailsBatchTimerRef;
    const pendingIdsRef = itemDetailsBatchPendingIdsRef;
    const resolversRef = itemDetailsBatchResolversRef;
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const pendingResolvers = resolversRef.current;
      for (const itemId of Object.keys(pendingResolvers)) {
        for (const resolve of pendingResolvers[itemId]) {
          resolve(null);
        }
      }
      resolversRef.current = {};
      pendingIdsRef.current.clear();
    };
  }, []);

  const locationCodeById = useMemo(() => {
    const m = new Map<string, string>();
    for (const loc of locations) {
      m.set(loc.id, loc.code);
    }
    return m;
  }, [locations]);

  const sourceLocationsResolved = useMemo(() => {
    return sourceLocationIds.map((id) => {
      const loc = locations.find((l) => l.id === id);
      if (loc) {
        return { id: loc.id, code: loc.code, name: loc.name || null };
      }
      const fallback = sourceLocations.find((s) => s.id === id);
      return fallback || { id, code: 'Unknown', name: null };
    });
  }, [locations, sourceLocationIds, sourceLocations]);

  const extraSourceIds = useMemo(
    () => extraSourceLocations.map((l) => l.id).filter((id) => id !== defaultReceivingLocationId),
    [defaultReceivingLocationId, extraSourceLocations],
  );

  useEffect(() => {
    if (sourceDialogOpen) {
      setDraftExtraSourceIds(extraSourceIds);
    }
  }, [extraSourceIds, sourceDialogOpen]);

  const setSort = (next: SortField) => {
    if (sortField === next) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(next);
    setSortDirection(next === 'received_at' ? 'asc' : 'asc');
  };

  const getSuggestedSortValue = useCallback((itemId: string): string => {
    const selectedLocId = selectedDestinationByItemId[itemId];
    if (selectedLocId) {
      return locationCodeById.get(selectedLocId) || '';
    }
    const suggestions = suggestionsByItemId[itemId] || [];
    return suggestions[0]?.location_code || '';
  }, [locationCodeById, selectedDestinationByItemId, suggestionsByItemId]);

  const sortedItems = useMemo(() => {
    return sortRows(items, sortField, sortDirection, getSuggestedSortValue);
  }, [getSuggestedSortValue, items, sortDirection, sortField]);

  const visibleItems = useMemo(() => sortedItems, [sortedItems]);
  const visibleItemIdsKey = useMemo(
    () => visibleItems.map((item) => item.id).join(','),
    [visibleItems],
  );

  useEffect(() => {
    setExpandedRows((prev) => {
      const next: Record<string, boolean> = {};
      for (const row of visibleItems) {
        if (prev[row.id]) next[row.id] = true;
      }
      return next;
    });
  }, [visibleItems]);

  useEffect(() => {
    // Drop selections that are no longer in the list.
    const allowedIds = new Set(visibleItems.map((i) => i.id));
    setSelectedDestinationByItemId((prev) => {
      const next: Record<string, string> = {};
      for (const [itemId, locId] of Object.entries(prev)) {
        if (allowedIds.has(itemId)) next[itemId] = locId;
      }
      return next;
    });
  }, [visibleItems]);

  const buildSuggestionsByItemId = useCallback(async (itemIds: string[]) => {
    if (!profile?.tenant_id || !selectedWarehouseId) return {} as Record<string, LocationSuggestion[]>;
    const targetItemIds = Array.from(new Set(itemIds.filter(Boolean)));
    if (targetItemIds.length === 0) return {} as Record<string, LocationSuggestion[]>;
    const suggestionsByItem = await buildPutAwayFallbackSuggestions({
      tenantId: profile.tenant_id,
      warehouseId: selectedWarehouseId,
      itemIds: targetItemIds,
      topN: 3,
    });
    return suggestionsByItem as Record<string, LocationSuggestion[]>;
  }, [profile?.tenant_id, selectedWarehouseId]);

  const fetchSuggestionsForVisibleItems = useCallback(async () => {
    if (!profile?.tenant_id || !selectedWarehouseId) return;
    const targetIds = visibleItemIdsKey
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (targetIds.length === 0) return;

    const reqId = ++suggestionReqSeqRef.current;
    setSuggestionsLoadingByItemId((prev) => {
      const next = { ...prev };
      for (const id of targetIds) next[id] = true;
      return next;
    });

    let results: Array<{ itemId: string; suggestions: LocationSuggestion[]; error: string | null }> = [];
    try {
      const suggestionsByItemId = await buildSuggestionsByItemId(targetIds);
      results = targetIds.map((itemId) => ({
        itemId,
        suggestions: suggestionsByItemId[itemId] || [],
        error: null,
      }));
    } catch (error) {
      console.error('[PutAwayAssistant] suggestion build failed:', error);
      toast({ variant: 'destructive', title: 'Suggestions failed', description: 'Could not load location suggestions. They may appear empty.' });
      results = targetIds.map((itemId) => ({
        itemId,
        suggestions: [] as LocationSuggestion[],
        error: 'Suggestions unavailable',
      }));
    }

    if (reqId !== suggestionReqSeqRef.current) return;

    setSuggestionsByItemId((prev) => {
      const next = { ...prev };
      for (const row of results) next[row.itemId] = row.suggestions;
      return next;
    });
    setSuggestionsErrorByItemId((prev) => {
      const next = { ...prev };
      for (const row of results) next[row.itemId] = row.error;
      return next;
    });
    setSuggestionsLoadingByItemId((prev) => {
      const next = { ...prev };
      for (const row of results) next[row.itemId] = false;
      return next;
    });
  }, [buildSuggestionsByItemId, profile?.tenant_id, selectedWarehouseId, visibleItemIdsKey]);

  useEffect(() => {
    if (!visibleItemIdsKey) return;
    void fetchSuggestionsForVisibleItems();
  }, [fetchSuggestionsForVisibleItems, visibleItemIdsKey]);

  const visibleItemMap = useMemo(() => {
    const m = new Map<string, PutAwayAssistantItem>();
    for (const item of visibleItems) m.set(item.id, item);
    return m;
  }, [visibleItems]);

  const scannerItemMap = useMemo(() => {
    const m = new Map<string, ScannedPutAwayItem>();
    for (const item of scannerItems) m.set(item.id, item);
    return m;
  }, [scannerItems]);

  const effectiveSuggestionsResult = useMemo(() => {
    const raw: Record<string, LocationSuggestion[]> = {};
    for (const row of visibleItems) {
      raw[row.id] = suggestionsByItemId[row.id] || [];
    }

    let selected = { ...selectedDestinationByItemId };
    let nextPreview: Record<string, SuggestionWithPreview[]> = {};

    for (let guard = 0; guard < 8; guard++) {
      const reservedByLocation: Record<string, number> = {};
      for (const [itemId, locId] of Object.entries(selected)) {
        const item = visibleItemMap.get(itemId);
        if (!item) continue;
        reservedByLocation[locId] = (reservedByLocation[locId] || 0) + mapItemSize(item);
      }

      const computedPreview: Record<string, SuggestionWithPreview[]> = {};
      let changed = false;

      for (const row of visibleItems) {
        const itemVolume = mapItemSize(row);
        const suggestions = raw[row.id] || [];
        const previewRows = suggestions.map((s) => {
          const reservedOther = (reservedByLocation[s.location_id] || 0)
            - (selected[row.id] === s.location_id ? itemVolume : 0);
          const previewAvailable = Number(s.available_cuft || 0) - reservedOther;
          const selectable = previewAvailable + 0.00001 >= itemVolume;
          return {
            ...s,
            selectable,
            preview_available_cuft: previewAvailable,
          };
        });
        computedPreview[row.id] = previewRows;

        if (selected[row.id]) {
          const stillValid = previewRows.some(
            (p) => p.location_id === selected[row.id] && p.selectable,
          );
          if (!stillValid) {
            const { [row.id]: _removed, ...rest } = selected;
            selected = rest;
            changed = true;
          }
        }
      }

      nextPreview = computedPreview;
      if (!changed) break;
    }

    return {
      previewByItemId: nextPreview,
      sanitizedSelection: selected,
    };
  }, [selectedDestinationByItemId, suggestionsByItemId, visibleItemMap, visibleItems]);

  useEffect(() => {
    if (!stableMapEqual(selectedDestinationByItemId, effectiveSuggestionsResult.sanitizedSelection)) {
      setSelectedDestinationByItemId(effectiveSuggestionsResult.sanitizedSelection);
      toast({
        title: 'Selection updated',
        description: 'One or more suggested destinations no longer fit remaining capacity and were cleared.',
      });
    }
  }, [effectiveSuggestionsResult.sanitizedSelection, selectedDestinationByItemId, toast]);

  const canMoveManually = Object.keys(selectedDestinationByItemId).length > 0;
  const scannerReadyToConfirm = scannerItems.length > 0 && !!scannerDestination;

  const closeScanner = () => {
    setScannerOpen(false);
    setScannerOverlay(null);
  };

  const openScanner = () => {
    setExpanded(true);
    setScannerOpen(true);
  };

  const blockScanner = useCallback((reason: string, code?: string) => {
    hapticError();
    void playScanAudioFeedback('error');
    setScannerOverlay({ reason, code });
  }, []);

  const lookupLocationByScan = useCallback(async (input: string) => {
    const payload = parseScanPayload(input);
    if (!payload) return null;

    const rawCode = normalizeScannedCode(payload.code || payload.id || input);
    if (!rawCode) return null;

    const fromMemory = locations.find((l) => l.code.toLowerCase() === rawCode.toLowerCase());
    if (fromMemory) {
      return { id: fromMemory.id, code: fromMemory.code, name: fromMemory.name || null };
    }

    const escaped = rawCode.replace(/([\\%_])/g, '\\$1');
    const { data: dbLoc } = await (supabase.from('locations') as any)
      .select('id, code, name')
      .ilike('code', escaped)
      .is('deleted_at', null)
      .maybeSingle();
    if (!dbLoc) return null;

    return {
      id: dbLoc.id as string,
      code: dbLoc.code as string,
      name: (dbLoc.name as string | null) || null,
    };
  }, [locations]);

  const fetchScannedItemDetailsBatch = useCallback(async (itemIds: string[]) => {
    const uniqueItemIds = Array.from(new Set(itemIds.filter(Boolean)));
    const output: Record<string, ScannedPutAwayItem | null> = {};
    if (uniqueItemIds.length === 0) return output;

    const uncachedIds = uniqueItemIds.filter((itemId) => !itemDetailsCacheRef.current[itemId]);
    if (uncachedIds.length > 0) {
      const { data, error } = await supabase
        .from('items')
        .select(`
          id,
          item_code,
          description,
          current_location_id,
          received_at,
          size,
          location:locations!items_current_location_id_fkey(code, name)
        `)
        .in('id', uncachedIds)
        .is('deleted_at', null);

      if (error) {
        console.error('[PutAwayAssistant] Failed to load batched scanned item details:', error);
      } else {
        for (const row of data || []) {
          if (!row?.id) continue;
          const mapped: ScannedPutAwayItem = {
            id: row.id,
            item_code: row.item_code,
            description: row.description || null,
            current_location_id: row.current_location_id || null,
            current_location_code: row.location?.code || null,
            current_location_name: row.location?.name || null,
            received_at: row.received_at || null,
            size: row.size != null ? Number(row.size) : null,
          };
          itemDetailsCacheRef.current[row.id] = mapped;
        }
      }
    }

    for (const itemId of uniqueItemIds) {
      output[itemId] = itemDetailsCacheRef.current[itemId] || null;
    }
    return output;
  }, []);

  const flushScannedItemDetailsBatch = useCallback(async () => {
    const pendingIds = Array.from(itemDetailsBatchPendingIdsRef.current);
    itemDetailsBatchPendingIdsRef.current.clear();
    itemDetailsBatchTimerRef.current = null;
    if (pendingIds.length === 0) return;

    let byId: Record<string, ScannedPutAwayItem | null> = {};
    try {
      byId = await fetchScannedItemDetailsBatch(pendingIds);
    } catch (error) {
      console.error('[PutAwayAssistant] Failed batched scanner item flush:', error);
    }

    for (const itemId of pendingIds) {
      const resolvers = itemDetailsBatchResolversRef.current[itemId] || [];
      delete itemDetailsBatchResolversRef.current[itemId];
      const item = byId[itemId] || null;
      for (const resolve of resolvers) {
        resolve(item);
      }
    }
  }, [fetchScannedItemDetailsBatch]);

  const queueScannedItemDetailsLookup = useCallback((itemId: string): Promise<ScannedPutAwayItem | null> => {
    if (!itemId) return Promise.resolve(null);
    const cached = itemDetailsCacheRef.current[itemId];
    if (cached) return Promise.resolve(cached);

    return new Promise((resolve) => {
      const queue = itemDetailsBatchResolversRef.current[itemId] || [];
      queue.push(resolve);
      itemDetailsBatchResolversRef.current[itemId] = queue;
      itemDetailsBatchPendingIdsRef.current.add(itemId);

      if (!itemDetailsBatchTimerRef.current) {
        itemDetailsBatchTimerRef.current = setTimeout(() => {
          void flushScannedItemDetailsBatch();
        }, 120);
      }
    });
  }, [flushScannedItemDetailsBatch]);

  const lookupScannedItem = useCallback(async (input: string): Promise<ScannedPutAwayItem | null> => {
    const base = await lookupItemByScan(input, { tenantId: profile?.tenant_id });
    if (!base?.id) return null;
    return await queueScannedItemDetailsLookup(base.id);
  }, [profile?.tenant_id, queueScannedItemDetailsLookup]);

  const evaluateScannerDestinationCapacity = useCallback(async (locationId: string) => {
    if (scannerItems.length === 0) return { fits: true, available: 0, required: 0 };
    const required = scannerItems.reduce((sum, item) => sum + mapItemSize(item), 0);
    const { data: cache } = await (supabase.from('location_capacity_cache') as any)
      .select('available_cuft')
      .eq('location_id', locationId)
      .maybeSingle();
    let available = Number(cache?.available_cuft ?? NaN);
    if (!Number.isFinite(available)) {
      const { data: loc } = await (supabase.from('locations') as any)
        .select('capacity_cuft')
        .eq('id', locationId)
        .maybeSingle();
      available = Number(loc?.capacity_cuft ?? 0);
    }
    return {
      fits: required <= available + 0.00001,
      available,
      required,
    };
  }, [scannerItems]);

  const scannerEngine = useScanEngine({
    enabled: scannerOpen,
    dedupeMs: 250,
    isBlocked: () => !!scannerOverlay || processingMove,
    onScan: async (event) => {
      if (!scannerOpen) return;

      const looksLikeLocation =
        event.type === 'location' || isLikelyLocationCodeUtil(event.raw, locations);

      if (looksLikeLocation) {
        if (scannerItems.length === 0) {
          blockScanner('Scan one or more item codes first, then scan a destination location.', event.code);
          return;
        }

        const loc = await lookupLocationByScan(event.raw);
        if (!loc) {
          blockScanner('Location not found. Scan a valid location label.', event.code);
          return;
        }

        setScannerDestination(loc);
        hapticMedium();
        void playScanAudioFeedback('success');

        const capacity = await evaluateScannerDestinationCapacity(loc.id);
        if (!capacity.fits) {
          blockScanner(
            `Location ${loc.code} has ${capacity.available.toFixed(1)} cuft available; selected items require ${capacity.required.toFixed(1)} cuft.`,
          );
        }
        return;
      }

      if (event.type === 'container') {
        blockScanner('Wrong barcode type. Scan item barcodes and location labels only.', event.code);
        return;
      }

      const item = await lookupScannedItem(event.raw);
      if (!item) {
        blockScanner('Item not found. Scan a valid item barcode.', event.code);
        return;
      }

      if (!item.current_location_id || !sourceLocationIds.includes(item.current_location_id)) {
        const currentCode = item.current_location_code || 'unknown location';
        const primarySourceCode = defaultReceivingLocationCode || 'default receiving location';
        blockScanner(
          `${item.item_code} is at ${currentCode}, not ${primarySourceCode}. Put Away scanner only accepts items in configured source locations.`,
          item.item_code,
        );
        return;
      }

      setScannerItems((prev) => {
        if (prev.some((p) => p.id === item.id)) return prev;
        return [...prev, item];
      });
      // Keep destination assignment explicit: if user adds more items after scanning location,
      // they should re-scan destination for the full batch.
      setScannerDestination(null);
      hapticMedium();
      void playScanAudioFeedback('success');
    },
    onError: (_error, raw) => {
      blockScanner('Scan error. Try again.', raw);
    },
  });

  const toggleRowExpanded = (itemId: string) => {
    setExpandedRows((prev) => ({
      ...prev,
      [itemId]: !prev[itemId],
    }));
  };

  const toggleSuggestionSelection = (itemId: string, locationId: string) => {
    setSelectedDestinationByItemId((prev) => {
      if (prev[itemId] === locationId) {
        const { [itemId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [itemId]: locationId };
    });
    hapticLight();
  };

  const saveSources = async () => {
    const ok = await updateExtraSourceLocationIds(draftExtraSourceIds);
    if (!ok) {
      toast({
        variant: 'destructive',
        title: 'Save failed',
        description: 'Could not update Put Away source locations.',
      });
      return;
    }
    toast({
      title: 'Source locations updated',
      description: 'Put Away source locations were saved.',
    });
    setSourceDialogOpen(false);
  };

  const resolveAssignmentsToItems = useCallback(async (assignments: Record<string, string>) => {
    const entries = Object.entries(assignments).filter(([itemId, locId]) => !!itemId && !!locId);
    if (entries.length === 0) return [] as Array<{ item: ScannedPutAwayItem; toLocationId: string }>;

    const knownMap = new Map<string, ScannedPutAwayItem>();
    for (const row of visibleItems) {
      knownMap.set(row.id, {
        ...row,
        current_location_name: null,
      });
    }
    for (const row of scannerItems) {
      knownMap.set(row.id, row);
    }

    const missingIds = entries
      .map(([itemId]) => itemId)
      .filter((itemId) => !knownMap.has(itemId));

    if (missingIds.length > 0) {
      const { data } = await (supabase.from('items') as any)
        .select(`
          id,
          item_code,
          description,
          current_location_id,
          received_at,
          size,
          location:locations!items_current_location_id_fkey(code, name)
        `)
        .in('id', missingIds)
        .is('deleted_at', null);

      for (const row of data || []) {
        knownMap.set(row.id, {
          id: row.id,
          item_code: row.item_code,
          description: row.description || null,
          current_location_id: row.current_location_id || null,
          current_location_code: row.location?.code || null,
          current_location_name: row.location?.name || null,
          received_at: row.received_at || null,
          size: row.size != null ? Number(row.size) : null,
        });
      }
    }

    return entries
      .map(([itemId, toLocationId]) => {
        const item = knownMap.get(itemId);
        if (!item) return null;
        return { item, toLocationId };
      })
      .filter(Boolean) as Array<{ item: ScannedPutAwayItem; toLocationId: string }>;
  }, [scannerItems, visibleItems]);

  const executeAssignments = useCallback(async (
    assignments: Record<string, string>,
    source: 'manual' | 'scanner',
    overrideWarnings = false,
  ) => {
    if (!profile?.tenant_id || !profile?.id) return;
    const resolved = await resolveAssignmentsToItems(assignments);
    if (resolved.length === 0) return;

    setProcessingMove(true);
    try {
      const blockers: SOPBlocker[] = [];
      const warnings: SOPBlocker[] = [];

      // Enforce source-location membership at execution time.
      const executable = resolved.filter(({ item }) => {
        if (!item.current_location_id || !sourceLocationIds.includes(item.current_location_id)) {
          blockers.push({
            code: item.item_code,
            message: `${item.item_code} is no longer in a Put Away source location.`,
            severity: 'blocking',
          });
          return false;
        }
        return true;
      });

      const byDestination = new Map<string, ScannedPutAwayItem[]>();
      for (const row of executable) {
        const current = byDestination.get(row.toLocationId) || [];
        current.push(row.item);
        byDestination.set(row.toLocationId, current);
      }

      // SOP validation by destination group.
      for (const [destId, groupItems] of byDestination.entries()) {
        const { data: sopData, error } = await (supabase as any).rpc('validate_movement_event', {
          p_tenant_id: profile.tenant_id,
          p_item_ids: groupItems.map((i) => i.id),
          p_to_location_id: destId,
        });
        if (error) {
          blockers.push({
            code: locationCodeById.get(destId) || destId,
            message: 'Failed movement validation.',
            severity: 'blocking',
          });
          continue;
        }

        if (sopData?.ok === false && Array.isArray(sopData?.blockers)) {
          for (const blocker of sopData.blockers) {
            const normalized: SOPBlocker = {
              code: blocker?.code || 'RULE',
              message: blocker?.message || 'Movement blocked by SOP rule.',
              severity: (blocker?.severity === 'warning' ? 'warning' : 'blocking'),
            };
            if (normalized.severity === 'warning') warnings.push(normalized);
            else blockers.push(normalized);
          }
        }
      }

      for (const row of executable) {
        const freeze = await checkFreeze(row.item.id);
        if (freeze.isFrozen) {
          blockers.push({
            code: row.item.item_code,
            message: freeze.message || `Item is frozen by stocktake ${freeze.stocktakeNumber || ''}`,
            severity: 'blocking',
          });
        }
      }

      // Final server-side capacity checks.
      const destIds = [...byDestination.keys()];
      if (destIds.length > 0) {
        const { data: cacheRows } = await (supabase.from('location_capacity_cache') as any)
          .select('location_id, available_cuft')
          .in('location_id', destIds);

        const availableByLoc = new Map<string, number>();
        for (const row of cacheRows || []) {
          availableByLoc.set(row.location_id as string, Number(row.available_cuft || 0));
        }

        for (const [destId, groupItems] of byDestination.entries()) {
          const required = groupItems.reduce((sum, item) => sum + mapItemSize(item), 0);
          const available = availableByLoc.get(destId) ?? 0;
          if (required > available + 0.00001) {
            const locCode = locationCodeById.get(destId) || destId;
            warnings.push({
              code: locCode,
              message: `Location ${locCode} has ${available.toFixed(1)} cuft available; selected items require ${required.toFixed(1)} cuft.`,
              severity: 'warning',
            });
          }
        }
      }

      if (selectedWarehouseId) {
        for (const [destId, groupItems] of byDestination.entries()) {
          const compliance = await evaluateSpecialStorageCompliance({
            tenantId: profile.tenant_id,
            warehouseId: selectedWarehouseId,
            itemIds: groupItems.map((item) => item.id),
            destinationLocationId: destId,
          });
          if (!compliance.isCompliant) {
            const locCode = locationCodeById.get(destId) || destId;
            const missingFlags = compliance.missingFlags.join(', ');
            const message =
              `Location ${locCode} is not compliant for required storage flag(s): ${missingFlags}.`;
            if (canEditSources) {
              warnings.push({
                code: 'FLAG_MISMATCH',
                message,
                severity: 'warning',
              });
            } else {
              blockers.push({
                code: 'FLAG_MISMATCH',
                message: `${message} Manager override is required.`,
                severity: 'blocking',
              });
            }
          }
        }
      }

      if (blockers.length > 0) {
        setPendingOverrideExecution(null);
        setSopBlockers(blockers);
        setSopDialogOpen(true);
        hapticError();
        void playScanAudioFeedback('error');
        return;
      }

      if (warnings.length > 0 && !overrideWarnings) {
        if (source === 'scanner') {
          blockScanner(warnings[0].message);
        }
        setPendingOverrideExecution({ assignments, source });
        setSopBlockers(warnings);
        setSopDialogOpen(true);
        return;
      }

      const successIds: string[] = [];
      const failedIds: string[] = [];

      for (const row of executable) {
        const { item, toLocationId } = row;
        const toCode = locationCodeById.get(toLocationId) || 'Unknown';

        const { error: updateError } = await (supabase.from('items') as any)
          .update({ current_location_id: toLocationId })
          .eq('id', item.id);

        if (updateError) {
          failedIds.push(item.id);
          continue;
        }

        await (supabase.from('movements') as any).insert({
          item_id: item.id,
          to_location_id: toLocationId,
          action_type: 'move',
          moved_at: new Date().toISOString(),
        });

        logItemActivity({
          tenantId: profile.tenant_id,
          itemId: item.id,
          actorUserId: profile.id,
          eventType: 'item_moved',
          eventLabel: `Moved to ${toCode}`,
          details: {
            from_location_id: item.current_location_id,
            to_location_id: toLocationId,
            from_location_code: item.current_location_code,
            to_location_code: toCode,
            source,
          },
        });

        if (overrideWarnings && warnings.length > 0) {
          logItemActivity({
            tenantId: profile.tenant_id,
            itemId: item.id,
            actorUserId: profile.id,
            eventType: 'location_override',
            eventLabel: `Override: moved to ${toCode}`,
            details: {
              type: 'LOCATION_OVERRIDE',
              from_location_id: item.current_location_id,
              to_location_id: toLocationId,
              reasons: warnings.map((w) => w.code),
              source,
            },
          });
        }

        successIds.push(item.id);
      }

      if (successIds.length > 0) {
        hapticSuccess();
        void playScanAudioFeedback('success');
      } else {
        hapticError();
        void playScanAudioFeedback('error');
      }

      if (successIds.length > 0 && failedIds.length === 0) {
        toast({
          title: 'Move complete',
          description: `Moved ${successIds.length} item${successIds.length === 1 ? '' : 's'}.`,
        });
      } else if (successIds.length > 0 && failedIds.length > 0) {
        toast({
          variant: 'destructive',
          title: 'Partial move complete',
          description: `${successIds.length} moved, ${failedIds.length} failed. Failed items remain selected for retry.`,
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Move failed',
          description: 'No items were moved.',
        });
      }

      if (source === 'manual') {
        if (successIds.length > 0) {
          setSelectedDestinationByItemId((prev) => {
            const next = { ...prev };
            for (const id of successIds) delete next[id];
            return next;
          });
        }
      } else {
        if (successIds.length > 0) {
          setScannerItems((prev) => prev.filter((row) => !successIds.includes(row.id)));
        }
        // Auto-close scanner after successful move (requested behavior).
        if (successIds.length > 0) {
          closeScanner();
        }
      }

      await refetch();
      await fetchSuggestionsForVisibleItems();
    } catch (error) {
      console.error('[PutAwayAssistant] move execution failed:', error);
      hapticError();
      void playScanAudioFeedback('error');
      toast({
        variant: 'destructive',
        title: 'Move failed',
        description: 'Unable to complete move.',
      });
    } finally {
      setProcessingMove(false);
      setManualSwipeProgress(0);
      setScannerSwipeProgress(0);
    }
  }, [
    blockScanner,
    canEditSources,
    checkFreeze,
    fetchSuggestionsForVisibleItems,
    locationCodeById,
    profile?.id,
    profile?.tenant_id,
    refetch,
    resolveAssignmentsToItems,
    selectedWarehouseId,
    sourceLocationIds,
    toast,
  ]);

  const manualAssignments = selectedDestinationByItemId;
  const scannerAssignments = useMemo(() => {
    if (!scannerDestination) return {};
    const out: Record<string, string> = {};
    for (const item of scannerItems) {
      out[item.id] = scannerDestination.id;
    }
    return out;
  }, [scannerDestination, scannerItems]);

  const confirmManualMove = () => {
    void executeAssignments(manualAssignments, 'manual', false);
  };

  const confirmScannerMove = () => {
    void executeAssignments(scannerAssignments, 'scanner', false);
  };

  const handleOverrideContinue = () => {
    if (!pendingOverrideExecution) return;
    const pending = pendingOverrideExecution;
    setPendingOverrideExecution(null);
    void executeAssignments(pending.assignments, pending.source, true);
  };

  const viewCountInInventory = () => {
    if (!defaultReceivingLocationId) return;
    navigate(`/inventory?status=active&location_id=${encodeURIComponent(defaultReceivingLocationId)}`);
  };

  const viewAllInInventory = () => {
    if (sourceLocationIds.length === 0) return;
    navigate(`/inventory?status=active&location_ids=${encodeURIComponent(sourceLocationIds.join(','))}`);
  };

  const handleManualSwipeStart = (clientX: number) => {
    setIsManualSwiping(true);
    manualSwipeStartX.current = clientX;
  };
  const handleManualSwipeMove = (clientX: number) => {
    if (!isManualSwiping || !manualSwipeRef.current) return;
    const width = manualSwipeRef.current.offsetWidth;
    const distance = clientX - manualSwipeStartX.current;
    const progress = Math.min(Math.max(distance / Math.max(width - 80, 1), 0), 1);
    setManualSwipeProgress(progress);
  };
  const handleManualSwipeEnd = () => {
    if (manualSwipeProgress > 0.7 && !processingMove) {
      setManualSwipeProgress(1);
      setTimeout(confirmManualMove, 120);
    } else {
      setManualSwipeProgress(0);
    }
    setIsManualSwiping(false);
  };

  const handleScannerSwipeStart = (clientX: number) => {
    setIsScannerSwiping(true);
    scannerSwipeStartX.current = clientX;
  };
  const handleScannerSwipeMove = (clientX: number) => {
    if (!isScannerSwiping || !scannerSwipeRef.current) return;
    const width = scannerSwipeRef.current.offsetWidth;
    const distance = clientX - scannerSwipeStartX.current;
    const progress = Math.min(Math.max(distance / Math.max(width - 80, 1), 0), 1);
    setScannerSwipeProgress(progress);
  };
  const handleScannerSwipeEnd = () => {
    if (scannerSwipeProgress > 0.7 && !processingMove) {
      setScannerSwipeProgress(1);
      setTimeout(confirmScannerMove, 120);
    } else {
      setScannerSwipeProgress(0);
    }
    setIsScannerSwiping(false);
  };

  const sourcePickerLocations = useMemo(() => {
    const q = sourceSearch.trim().toLowerCase();
    const rows = locations.filter((loc) => loc.id !== defaultReceivingLocationId);
    if (!q) return rows;
    return rows.filter((loc) => {
      const code = loc.code?.toLowerCase() || '';
      const name = (loc.name || '').toLowerCase();
      return code.includes(q) || name.includes(q);
    });
  }, [defaultReceivingLocationId, locations, sourceSearch]);

  const shouldShowSetupWarning = !!selectedWarehouseId && !defaultReceivingLocationId;

  return (
    <>
      <Card data-context={context} className={cn('hover:shadow-lg transition-shadow', className)}>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <button
                type="button"
                onClick={() => setSourceDialogOpen(true)}
                className="inline-flex items-center gap-2 text-left"
                title="Configure Put Away source locations"
              >
                <CardTitle className="text-[11px] font-semibold tracking-wide text-muted-foreground">
                  PUT AWAY
                </CardTitle>
                <MaterialIcon name="tune" size="sm" className="text-muted-foreground" />
              </button>
              <div className="mt-1 flex items-center gap-2 flex-wrap">
                {putAwayUrgentCount > 0 && (
                  <Badge className="bg-red-500 text-white text-[10px]">
                    ⚠️ {putAwayUrgentCount} overdue
                  </Badge>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={openScanner}
              className={cn(
                'emoji-tile emoji-tile-lg rounded-lg bg-card border border-border shadow-sm cursor-pointer hover:shadow-md transition-shadow',
                scannerOpen && 'ring-2 ring-primary/40',
              )}
              title="Open inline scanner"
            >
              <ScanModeIcon mode="move" size={20} />
            </button>
          </div>
        </CardHeader>

        <CardContent className="space-y-3">
          {!selectedWarehouseId && (
            <Alert>
              <MaterialIcon name="warehouse" size="sm" />
              <AlertTitle>Select a warehouse</AlertTitle>
              <AlertDescription>
                Select a warehouse to use Put Away assistant.
              </AlertDescription>
            </Alert>
          )}

          {shouldShowSetupWarning && (
            <Alert>
              <MaterialIcon name="warning" size="sm" />
              <AlertTitle>Default receiving location is required</AlertTitle>
              <AlertDescription>
                Configure default receiving location for this warehouse in{' '}
                <Link to="/settings?tab=locations" className="underline font-medium">
                  Settings → Locations
                </Link>{' '}
                before using Put Away assistant.
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-baseline justify-between gap-2">
            <div className="flex items-baseline gap-2 min-w-0">
              <button
                type="button"
                className={cn(
                  'text-3xl font-bold text-purple-600 dark:text-purple-400 hover:opacity-80 transition-opacity',
                  (!defaultReceivingLocationId || loading) && 'cursor-not-allowed opacity-50',
                )}
                onClick={viewCountInInventory}
                disabled={!defaultReceivingLocationId || loading}
              >
                {loading ? '—' : putAwayCount}
              </button>
              {putAwayTimeEstimate > 0 && (
                <span className="text-sm text-muted-foreground ml-1">
                  ⏱️ ~{formatTimeEstimate(putAwayTimeEstimate)}
                </span>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="text-xs"
              onClick={viewAllInInventory}
              disabled={sourceLocationIds.length === 0}
            >
              View all in Inventory
            </Button>
          </div>

          {sourceLocationsResolved.length > 0 && (
            <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
              <span>Sources:</span>
              {sourceLocationsResolved.map((loc) => (
                <Badge key={loc.id} variant="outline" className="text-[10px]">
                  {loc.code}
                  {loc.id === defaultReceivingLocationId ? ' (default)' : ''}
                </Badge>
              ))}
            </div>
          )}

          {scannerOpen && (
            <div className="relative">
              <div className="fixed inset-0 z-30" onClick={closeScanner} />
              <div className="relative z-40 rounded-xl border p-2 bg-card shadow-lg" onClick={(e) => e.stopPropagation()}>
                <QRScanner
                  onScan={scannerEngine.onScan}
                  onError={(error) => console.error('[PutAwayAssistant] scanner error:', error)}
                  scanning={!processingMove}
                  paused={!!scannerOverlay || processingMove}
                  blockingOverlay={
                    scannerOverlay
                      ? {
                          open: true,
                          title: 'SCAN ERROR',
                          reason: scannerOverlay.reason,
                          code: scannerOverlay.code,
                          hint: 'Tap to dismiss',
                          dismissLabel: 'Dismiss / Continue Scanning',
                          onDismiss: () => setScannerOverlay(null),
                        }
                      : null
                  }
                />

                <div className="mt-2 rounded-md border p-2 bg-muted/20">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">Scanner batch</span>
                    {scannerDestination ? (
                      <Badge variant="secondary">Destination: {scannerDestination.code}</Badge>
                    ) : (
                      <span className="text-muted-foreground">Scan items, then one destination</span>
                    )}
                  </div>
                  <div className="mt-2 max-h-28 overflow-y-auto space-y-1">
                    {scannerItems.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No items scanned yet.</p>
                    ) : (
                      scannerItems.map((item) => (
                        <div key={item.id} className="text-xs font-mono flex items-center justify-between">
                          <span>{item.item_code}</span>
                          <span className="text-muted-foreground">{item.current_location_code || '—'}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {expanded && (
            <>
              <Separator />

              <div className="overflow-x-auto -mx-2 px-2">
                <div className="grid grid-cols-3 gap-3 px-2 text-[11px] font-semibold text-muted-foreground">
                  <button type="button" className="text-left hover:underline" onClick={() => setSort('item_code')}>
                    ITEM CODE
                  </button>
                  <button type="button" className="text-left hover:underline" onClick={() => setSort('current_location')}>
                    CURRENT LOCATION
                  </button>
                  <button type="button" className="text-left hover:underline" onClick={() => setSort('suggested')}>
                    SUGGESTED
                  </button>
                </div>
              </div>

              <ScrollArea className="max-h-[460px]">
                <div className="space-y-1">
                  {visibleItems.map((item) => {
                    const rowExpanded = !!expandedRows[item.id];
                    const suggestions = effectiveSuggestionsResult.previewByItemId[item.id] || [];
                    const top = suggestions[0];
                    const extra = suggestions.slice(1);
                    const selectedLoc = selectedDestinationByItemId[item.id];
                    const suggestionError = suggestionsErrorByItemId[item.id];
                    const suggestionLoading = suggestionsLoadingByItemId[item.id];

                    return (
                      <div key={item.id} className="rounded-md border border-border/70">
                        <div className="overflow-x-auto -mx-2 px-2">
                          <div
                            role="button"
                            className="grid grid-cols-3 gap-3 px-2 py-2 items-start hover:bg-muted/30"
                            onClick={() => toggleRowExpanded(item.id)}
                          >
                            <button
                              type="button"
                              className="text-left font-mono text-sm font-medium hover:underline truncate"
                              onClick={(e) => {
                                e.stopPropagation();
                                navigate(`/inventory/${item.id}`);
                              }}
                            >
                              {item.item_code}
                            </button>

                            <div className="text-sm font-mono truncate">
                              {item.current_location_code || '—'}
                            </div>

                            <div className="space-y-1">
                              {suggestionLoading && (
                                <p className="text-xs text-muted-foreground">Loading suggestions…</p>
                              )}
                              {!suggestionLoading && suggestionError && (
                                <p className="text-xs text-muted-foreground">Suggestions unavailable</p>
                              )}
                              {!suggestionLoading && !suggestionError && top ? (
                                <label
                                  className={cn(
                                    'inline-flex items-center gap-2 text-sm font-mono',
                                    top.selectable ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed',
                                  )}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <input
                                    type="radio"
                                    checked={selectedLoc === top.location_id}
                                    onChange={() => toggleSuggestionSelection(item.id, top.location_id)}
                                    disabled={!top.selectable}
                                  />
                                  <span>{top.location_code}</span>
                                </label>
                              ) : null}
                              {!suggestionLoading && !suggestionError && !top && (
                                <p className="text-xs text-muted-foreground">No suggested locations</p>
                              )}
                            </div>
                          </div>
                        </div>

                        {rowExpanded && !suggestionError && extra.length > 0 && (
                          <div className="border-t bg-muted/20">
                            {extra.map((s) => (
                              <div key={s.location_id} className="overflow-x-auto -mx-2 px-2">
                                <div className="grid grid-cols-3 gap-3 px-2 py-2 items-center">
                                  <div />
                                  <div className="text-xs font-mono text-muted-foreground">{item.current_location_code || '—'}</div>
                                  <label
                                    className={cn(
                                      'inline-flex items-center gap-2 text-sm font-mono',
                                      s.selectable ? 'cursor-pointer' : 'opacity-50 cursor-not-allowed',
                                    )}
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <input
                                      type="radio"
                                      checked={selectedLoc === s.location_id}
                                      onChange={() => toggleSuggestionSelection(item.id, s.location_id)}
                                      disabled={!s.selectable}
                                    />
                                    <span>{s.location_code}</span>
                                  </label>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {visibleItems.length === 0 && (
                    <div className="text-sm text-muted-foreground py-6 text-center">
                      No items currently need put away.
                    </div>
                  )}
                </div>
              </ScrollArea>
            </>
          )}

          {/* Scanner confirmation control */}
          {scannerReadyToConfirm && (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-2">
              <div className="text-xs mb-2">
                Ready to move <strong>{scannerItems.length}</strong> scanned item{scannerItems.length === 1 ? '' : 's'} to{' '}
                <strong>{scannerDestination?.code}</strong>.
              </div>
              {useSwipeConfirm ? (
                <div
                  ref={scannerSwipeRef}
                  className="relative h-12 rounded-full bg-muted overflow-hidden select-none"
                  onTouchStart={(e) => handleScannerSwipeStart(e.touches[0].clientX)}
                  onTouchMove={(e) => handleScannerSwipeMove(e.touches[0].clientX)}
                  onTouchEnd={handleScannerSwipeEnd}
                  onMouseDown={(e) => handleScannerSwipeStart(e.clientX)}
                  onMouseMove={(e) => handleScannerSwipeMove(e.clientX)}
                  onMouseUp={handleScannerSwipeEnd}
                  onMouseLeave={handleScannerSwipeEnd}
                >
                  <div className={cn('absolute inset-y-0 left-0 bg-primary/20', !isScannerSwiping && 'transition-all')} style={{ width: `${scannerSwipeProgress * 100}%` }} />
                  <div
                    className={cn('absolute left-1 top-1 h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center', !isScannerSwiping && 'transition-transform')}
                    style={{ transform: `translateX(${scannerSwipeProgress * Math.max((scannerSwipeRef.current?.offsetWidth || 280) - 48, 0)}px)` }}
                  >
                    {processingMove ? '⏳' : scannerSwipeProgress >= 1 ? '✅' : '➡️'}
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-sm font-medium text-muted-foreground">
                    Swipe to confirm scanner move
                  </div>
                </div>
              ) : (
                <Button className="w-full" onClick={confirmScannerMove} disabled={processingMove}>
                  {processingMove ? 'Moving…' : 'Confirm Move'}
                </Button>
              )}
            </div>
          )}

          {/* Manual confirmation control */}
          {canMoveManually && (
            <div className="rounded-md border border-primary/40 bg-primary/5 p-2">
              <div className="text-xs mb-2">
                {Object.keys(selectedDestinationByItemId).length} selected item{Object.keys(selectedDestinationByItemId).length === 1 ? '' : 's'} ready to move.
              </div>
              {useSwipeConfirm ? (
                <div
                  ref={manualSwipeRef}
                  className="relative h-12 rounded-full bg-muted overflow-hidden select-none"
                  onTouchStart={(e) => handleManualSwipeStart(e.touches[0].clientX)}
                  onTouchMove={(e) => handleManualSwipeMove(e.touches[0].clientX)}
                  onTouchEnd={handleManualSwipeEnd}
                  onMouseDown={(e) => handleManualSwipeStart(e.clientX)}
                  onMouseMove={(e) => handleManualSwipeMove(e.clientX)}
                  onMouseUp={handleManualSwipeEnd}
                  onMouseLeave={handleManualSwipeEnd}
                >
                  <div className={cn('absolute inset-y-0 left-0 bg-primary/20', !isManualSwiping && 'transition-all')} style={{ width: `${manualSwipeProgress * 100}%` }} />
                  <div
                    className={cn('absolute left-1 top-1 h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center', !isManualSwiping && 'transition-transform')}
                    style={{ transform: `translateX(${manualSwipeProgress * Math.max((manualSwipeRef.current?.offsetWidth || 280) - 48, 0)}px)` }}
                  >
                    {processingMove ? '⏳' : manualSwipeProgress >= 1 ? '✅' : '➡️'}
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-sm font-medium text-muted-foreground">
                    Swipe to confirm selected moves
                  </div>
                </div>
              ) : (
                <Button className="w-full" onClick={confirmManualMove} disabled={processingMove}>
                  {processingMove ? 'Moving…' : 'Confirm Move'}
                </Button>
              )}
            </div>
          )}
        </CardContent>
        <div className="flex justify-center pb-2">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((prev) => !prev);
            }}
          >
            <MaterialIcon
              name="expand_circle_down"
              size="sm"
              className={cn('transition-transform duration-200', expanded && 'rotate-180')}
            />
          </Button>
        </div>
      </Card>

      {/* Source location picker */}
      <Dialog open={sourceDialogOpen} onOpenChange={setSourceDialogOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Put Away source locations</DialogTitle>
            <DialogDescription>
              Default receiving location is always included. Add optional extra source locations per warehouse.
            </DialogDescription>
          </DialogHeader>

          {!selectedWarehouseId ? (
            <Alert>
              <MaterialIcon name="warehouse" size="sm" />
              <AlertTitle>Select a warehouse first</AlertTitle>
              <AlertDescription>
                Choose a warehouse to configure Put Away source locations.
              </AlertDescription>
            </Alert>
          ) : !defaultReceivingLocationId ? (
            <Alert>
              <MaterialIcon name="warning" size="sm" />
              <AlertTitle>Default receiving location is required</AlertTitle>
              <AlertDescription>
                Configure default receiving location in{' '}
                <Link to="/settings?tab=locations" className="underline">
                  Settings → Locations
                </Link>{' '}
                before adding extra source locations.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="space-y-3">
              <div className="text-sm">
                <span className="text-muted-foreground">Warehouse:</span>{' '}
                <span className="font-medium">{selectedWarehouse?.name || 'Selected warehouse'}</span>
              </div>

              <div className="rounded-md border p-2 bg-muted/20">
                <div className="text-xs text-muted-foreground mb-1">Default receiving (always included)</div>
                <Badge variant="secondary">{defaultReceivingLocationCode || 'Loading…'}</Badge>
              </div>

              <Input
                value={sourceSearch}
                onChange={(e) => setSourceSearch(e.target.value)}
                placeholder="Search location code or name…"
              />

              <ScrollArea className="h-[260px] rounded-md border">
                <div className="p-2 space-y-1">
                  {sourcePickerLocations.map((loc) => {
                    const checked = draftExtraSourceIds.includes(loc.id);
                    return (
                      <label
                        key={loc.id}
                        className={cn(
                          'flex items-center justify-between gap-2 rounded px-2 py-2',
                          canEditSources ? 'hover:bg-muted/40 cursor-pointer' : 'opacity-70',
                        )}
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-sm truncate">{loc.code}</div>
                          {loc.name && (
                            <div className="text-xs text-muted-foreground truncate">{loc.name}</div>
                          )}
                        </div>
                        <Checkbox
                          checked={checked}
                          disabled={!canEditSources}
                          onCheckedChange={(next) => {
                            if (!canEditSources) return;
                            setDraftExtraSourceIds((prev) => {
                              if (next) {
                                if (prev.includes(loc.id)) return prev;
                                return [...prev, loc.id];
                              }
                              return prev.filter((id) => id !== loc.id);
                            });
                          }}
                        />
                      </label>
                    );
                  })}
                  {sourcePickerLocations.length === 0 && (
                    <div className="text-sm text-muted-foreground py-6 text-center">
                      No locations found.
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          )}

          <DialogFooter>
            {!canEditSources && selectedWarehouseId ? (
              <p className="text-xs text-muted-foreground mr-auto">
                Read-only: only admin/manager roles can edit source locations.
              </p>
            ) : null}
            <Button variant="outline" onClick={() => setSourceDialogOpen(false)}>
              Close
            </Button>
            {canEditSources && selectedWarehouseId && defaultReceivingLocationId && (
              <Button onClick={saveSources} disabled={savingSources || locationsLoading}>
                {savingSources ? 'Saving…' : 'Save'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SOPValidationDialog
        open={sopDialogOpen}
        onOpenChange={setSopDialogOpen}
        blockers={sopBlockers}
        title="Move validation"
        description="Review blockers/warnings before moving selected items."
        onOverride={pendingOverrideExecution ? handleOverrideContinue : undefined}
        overrideLabel="Move Anyway"
      />
    </>
  );
}

