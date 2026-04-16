import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
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
import { QRScanner } from '@/components/scan/QRScanner';
import { useStocktakeScan, ScanResult } from '@/hooks/useStocktakes';
import { useLocations } from '@/hooks/useLocations';
import { useLocationToItemsScanMode } from '@/lib/scan/modes/useLocationToItemsScanMode';
import { useItemDisplaySettingsForUser } from '@/hooks/useItemDisplaySettingsForUser';
import { useOrgPreferences } from '@/hooks/useOrgPreferences';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import {
  hapticLight,
  hapticMedium,
  hapticSuccess,
  hapticError,
} from '@/lib/haptics';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn, isValidUuid } from '@/lib/utils';
import { parseScanPayload } from '@/lib/scan/parseScanPayload';
import { isLikelyLocationCode as isLikelyLocationCodeUtil } from '@/lib/scan/isLikelyLocationCode';
import { lookupItemByScan } from '@/lib/scan/lookupItemByScan';
import { ItemColumnsPopover } from '@/components/items/ItemColumnsPopover';
import { ItemPreviewCard } from '@/components/items/ItemPreviewCard';
import { formatItemSize } from '@/lib/items/formatItemSize';
import { format } from 'date-fns';
import { EntityActivityFeed } from '@/components/activity/EntityActivityFeed';
import { JobTimerWidget } from '@/components/time/JobTimerWidget';
import {
  type BuiltinItemColumnKey,
  type ItemColumnKey,
  getColumnLabel,
  getViewById,
  getVisibleColumnsForView,
  parseCustomFieldColumnKey,
} from '@/lib/items/itemDisplaySettings';

const scanResultConfig: Record<ScanResult, {
  color: string;
  bgColor: string;
  iconName: string;
  label: string;
  audio?: 'success' | 'warning' | 'error';
}> = {
  expected: {
    color: 'text-green-400',
    bgColor: 'bg-green-500/20 border-green-500/30',
    iconName: 'check_circle',
    label: 'Found',
    audio: 'success',
  },
  wrong_location: {
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/20 border-yellow-500/30',
    iconName: 'warning',
    label: 'Wrong Location',
    audio: 'warning',
  },
  unexpected: {
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/20 border-orange-500/30',
    iconName: 'error',
    label: 'Unexpected',
    audio: 'warning',
  },
  released_conflict: {
    color: 'text-red-400',
    bgColor: 'bg-red-500/20 border-red-500/30',
    iconName: 'cancel',
    label: 'Released',
    audio: 'error',
  },
  duplicate: {
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/20 border-gray-500/30',
    iconName: 'refresh',
    label: 'Duplicate',
    audio: 'warning',
  },
  not_found: {
    color: 'text-red-400',
    bgColor: 'bg-red-500/20 border-red-500/30',
    iconName: 'cancel',
    label: 'Not Found',
    audio: 'error',
  },
};

interface LastScanResult {
  itemCode: string;
  result: ScanResult;
  message: string;
  autoFixed: boolean;
}

interface ScannedItemDetails {
  scan_id: string;
  scan_result: ScanResult;
  item_id: string | null;
  item_code: string;
  sku: string | null;
  quantity: number | null;
  size: number | null;
  size_unit: string | null;
  vendor: string | null;
  description: string | null;
  location_code: string | null;
  account_name: string | null;
  sidemark: string | null;
  room: string | null;
  primary_photo_url: string | null;
  metadata: Record<string, unknown> | null;
  scanned_at: string;
  auto_fix_applied: boolean;
}

type SortField = 'scan_result' | 'item_code' | 'vendor' | 'description' | 'location_code' | 'account_name' | 'sidemark' | 'scanned_at';
type SortDirection = 'asc' | 'desc';

export default function StocktakeScanView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [activeLocationId, setActiveLocationId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [lastScan, setLastScan] = useState<LastScanResult | null>(null);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [manualItemCode, setManualItemCode] = useState('');
  const [viewMode, setViewMode] = useState<'scan' | 'list'>('scan');
  const [scannedItemDetails, setScannedItemDetails] = useState<ScannedItemDetails[]>([]);

  // Sorting state
  const [sortField, setSortField] = useState<SortField>('scanned_at');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Filter state
  const [filters, setFilters] = useState({
    search: '',
    result: 'all',
    location: 'all',
    account: 'all',
  });
  const [showFilters, setShowFilters] = useState(false);

  const lastScanTimeoutRef = useRef<NodeJS.Timeout>();

  const {
    stocktake,
    expectedItems,
    scans,
    stats,
    loading,
    recordScan,
    refetch,
  } = useStocktakeScan(id || '');

  const { preferences: orgPrefs } = useOrgPreferences();
  const [legacyContainerUnitLinksEnabled, setLegacyContainerUnitLinksEnabled] = useState(false);

  // Item list view (tenant-managed)
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

  const stocktakeVisibleColumns = useMemo(
    () => (activeItemView ? getVisibleColumnsForView(activeItemView) : []),
    [activeItemView]
  );

  const { locations } = useLocations(stocktake?.warehouse_id);

  // Filter locations to only those in the stocktake
  const stocktakeLocations = stocktake?.location_ids
    ? locations.filter(l => (stocktake.location_ids as string[]).includes(l.id))
    : locations;

  // Fetch detailed item info for scanned items
  useEffect(() => {
    const fetchScannedItemDetails = async () => {
      if (scans.length === 0) {
        setScannedItemDetails([]);
        return;
      }

      const itemIds = scans.map(s => s.item_id).filter(Boolean) as string[];
      if (itemIds.length === 0) {
        setScannedItemDetails(scans.map(s => ({
          scan_id: s.id,
          scan_result: s.scan_result as ScanResult,
          item_id: s.item_id,
          item_code: s.item_code || 'Unknown',
          sku: null,
          quantity: null,
          size: null,
          size_unit: null,
          vendor: null,
          description: null,
          location_code: s.scanned_location?.code || null,
          account_name: null,
          sidemark: null,
          room: null,
          primary_photo_url: null,
          metadata: null,
          scanned_at: s.scanned_at,
          auto_fix_applied: s.auto_fix_applied,
        })));
        return;
      }

      const { data: items } = await supabase
        .from('items')
        .select(`
          id,
          item_code,
          sku,
          quantity,
          size,
          size_unit,
          vendor,
          description,
          sidemark,
          room,
          primary_photo_url,
          metadata,
          current_location_id,
          account:accounts!items_account_id_fkey(account_name)
        `)
        .in('id', itemIds);

      const itemMap = new Map(items?.map(i => [i.id, i]) || []);

      const details = scans.map(s => {
        const item = s.item_id ? itemMap.get(s.item_id) : null;
        return {
          scan_id: s.id,
          scan_result: s.scan_result as ScanResult,
          item_id: s.item_id,
          item_code: s.item_code || item?.item_code || 'Unknown',
          sku: (item as any)?.sku || null,
          quantity: (item as any)?.quantity ?? null,
          size: (item as any)?.size ?? null,
          size_unit: (item as any)?.size_unit ?? null,
          vendor: item?.vendor || null,
          description: item?.description || null,
          location_code: s.scanned_location?.code || null,
          account_name: (item?.account as any)?.account_name || null,
          sidemark: item?.sidemark || null,
          room: (item as any)?.room || null,
          primary_photo_url: (item as any)?.primary_photo_url || null,
          metadata: (item as any)?.metadata || null,
          scanned_at: s.scanned_at,
          auto_fix_applied: s.auto_fix_applied,
        };
      });

      setScannedItemDetails(details);
    };

    fetchScannedItemDetails();
  }, [scans]);

  // Auto-select first location if none selected
  useEffect(() => {
    if (!activeLocationId && stocktakeLocations.length > 0) {
      setActiveLocationId(stocktakeLocations[0].id);
    }
  }, [activeLocationId, stocktakeLocations]);

  useEffect(() => {
    if (!profile?.tenant_id) return;
    let cancelled = false;

    const loadLegacyContainerUnitMode = async () => {
      try {
        const { data } = await (supabase.from('tenant_settings') as any)
          .select('setting_value')
          .eq('tenant_id', profile.tenant_id)
          .eq('setting_key', 'receiving_legacy_inventory_units_enabled')
          .maybeSingle();
        const raw = data?.setting_value;
        const enabled =
          typeof raw === 'boolean'
            ? raw
            : typeof raw === 'string'
              ? raw.trim().toLowerCase() === 'true'
              : false;
        if (!cancelled) setLegacyContainerUnitLinksEnabled(enabled);
      } catch {
        if (!cancelled) setLegacyContainerUnitLinksEnabled(false);
      }
    };

    void loadLegacyContainerUnitMode();
    return () => {
      cancelled = true;
    };
  }, [profile?.tenant_id]);

  // Clear last scan after delay
  useEffect(() => {
    if (lastScan) {
      lastScanTimeoutRef.current = setTimeout(() => {
        setLastScan(null);
      }, 5000);
    }
    return () => {
      if (lastScanTimeoutRef.current) {
        clearTimeout(lastScanTimeoutRef.current);
      }
    };
  }, [lastScan]);

  // Get unique values for filters
  const uniqueResults = useMemo(() => {
    const results = new Set(scannedItemDetails.map(s => s.scan_result));
    return Array.from(results);
  }, [scannedItemDetails]);

  const uniqueLocations = useMemo(() => {
    const locs = new Set(scannedItemDetails.map(s => s.location_code).filter(Boolean));
    return Array.from(locs) as string[];
  }, [scannedItemDetails]);

  const uniqueAccounts = useMemo(() => {
    const accts = new Set(scannedItemDetails.map(s => s.account_name).filter(Boolean));
    return Array.from(accts) as string[];
  }, [scannedItemDetails]);

  // Filter and sort items
  const filteredAndSortedItems = useMemo(() => {
    let filtered = [...scannedItemDetails];

    // Apply search filter
    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filtered = filtered.filter(item =>
        item.item_code.toLowerCase().includes(searchLower) ||
        item.vendor?.toLowerCase().includes(searchLower) ||
        item.description?.toLowerCase().includes(searchLower) ||
        item.sidemark?.toLowerCase().includes(searchLower)
      );
    }

    // Apply result filter
    if (filters.result !== 'all') {
      filtered = filtered.filter(item => item.scan_result === filters.result);
    }

    // Apply location filter
    if (filters.location !== 'all') {
      filtered = filtered.filter(item => item.location_code === filters.location);
    }

    // Apply account filter
    if (filters.account !== 'all') {
      filtered = filtered.filter(item => item.account_name === filters.account);
    }

    // Sort
    filtered.sort((a, b) => {
      let aVal = a[sortField];
      let bVal = b[sortField];

      // Handle nulls
      if (aVal === null) aVal = '';
      if (bVal === null) bVal = '';

      // Convert to string for comparison
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();

      if (sortDirection === 'asc') {
        return aStr.localeCompare(bStr);
      } else {
        return bStr.localeCompare(aStr);
      }
    });

    return filtered;
  }, [scannedItemDetails, filters, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <MaterialIcon name="swap_vert" size="sm" className="opacity-50" />;
    return sortDirection === 'asc' ? <MaterialIcon name="arrow_upward" size="sm" /> : <MaterialIcon name="arrow_downward" size="sm" />;
  };

  const lookupItem = async (input: string) => {
    const data = await lookupItemByScan(input, { tenantId: stocktake?.tenant_id });
    if (!data) return null;
    return { id: data.id, item_code: data.item_code };
  };

  const lookupLocation = async (input: string): Promise<{ id: string; code: string } | null> => {
    const payload = parseScanPayload(input);
    if (!payload) return null;

    const code = (payload.code || payload.id || input).trim();
    if (!code) return null;

    const inMemory = locations.find((l) => l.code.toLowerCase() === code.toLowerCase());
    if (inMemory) {
      return { id: inMemory.id, code: inMemory.code };
    }

    if (payload.id && isValidUuid(payload.id)) {
      const { data: byId } = await supabase
        .from('locations')
        .select('id, code')
        .eq('id', payload.id)
        .is('deleted_at', null)
        .maybeSingle();
      if (byId) return { id: byId.id, code: byId.code };
    }

    const escaped = code.replace(/([\\%_])/g, '\\$1');
    const { data: byCode } = await supabase
      .from('locations')
      .select('id, code')
      .ilike('code', escaped)
      .is('deleted_at', null)
      .maybeSingle();
    if (byCode) {
      return { id: byCode.id, code: byCode.code };
    }

    return null;
  };

  const isLikelyLocationCode = useCallback((input: string): boolean => {
    return isLikelyLocationCodeUtil(input, locations);
  }, [locations]);
  const lookupContainer = async (input: string): Promise<{ id: string; container_code: string } | null> => {
    const payload = parseScanPayload(input);
    const raw = input.trim();
    if (!payload || !raw) return null;

    const code = (payload.code || payload.id || raw).trim();
    const escapeIlikeExact = (value: string) => value.replace(/([\\%_])/g, '\\$1');

    // Prefer UUID lookup if present
    if (payload.id && isValidUuid(payload.id)) {
      const { data } = await supabase
        .from('containers')
        .select('id, container_code')
        .eq('id', payload.id)
        .is('deleted_at', null)
        .maybeSingle();
      if (data) return { id: data.id, container_code: data.container_code };
    }

    if (!code) return null;

    // Fallback by container_code (case-insensitive exact match)
    const { data } = await supabase
      .from('containers')
      .select('id, container_code')
      .ilike('container_code', escapeIlikeExact(code))
      .is('deleted_at', null)
      .maybeSingle();

    return data ? { id: data.id, container_code: data.container_code } : null;
  };

  const processContainerScanShortcut = async (
    input: string,
    blockScan: (reason: string, code?: string) => void,
  ): Promise<boolean> => {
    if (!orgPrefs.scan_shortcuts_open_container_enabled || !activeLocationId) return false;

    const scannedContainer = await lookupContainer(input);
    if (!scannedContainer) return false;

    const activeLocationCode = locations.find((l) => l.id === activeLocationId)?.code || 'selected location';

    const uniqueByItemId = new Map<string, { id: string; item_code: string }>();
    // Item-code-first lookup: resolve item links directly from item metadata.
    try {
      const [{ data: metaByContainerId }, { data: metaByContainerCode }] = await Promise.all([
        (supabase.from('items') as any)
          .select('id, item_code')
          .is('deleted_at', null)
          .contains('metadata', { container_id: scannedContainer.id })
          .limit(500),
        (supabase.from('items') as any)
          .select('id, item_code')
          .is('deleted_at', null)
          .contains('metadata', { container_code: scannedContainer.container_code })
          .limit(500),
      ]);

      for (const row of ([...(metaByContainerId || []), ...(metaByContainerCode || [])] as any[])) {
        const itemId = typeof row?.id === 'string' ? row.id : '';
        const itemCode = typeof row?.item_code === 'string' ? row.item_code : '';
        if (!itemId || !itemCode) continue;
        uniqueByItemId.set(itemId, { id: itemId, item_code: itemCode });
      }
    } catch (metaErr) {
      console.warn('[StocktakeScanView] item metadata container lookup failed:', metaErr);
    }

    // Legacy fallback path: only enabled when tenant setting explicitly allows unit links.
    if (uniqueByItemId.size === 0 && legacyContainerUnitLinksEnabled) {
      const { data: unitRows, error: unitErr } = await supabase
        .from('inventory_units')
        .select('shipment_item_id')
        .eq('container_id', scannedContainer.id);

      if (unitErr) {
        console.error('[StocktakeScanView] container unit lookup failed:', unitErr);
        const message = `Failed to read contents of container ${scannedContainer.container_code}.`;
        setLastScan({
          itemCode: scannedContainer.container_code,
          result: 'not_found',
          message,
          autoFixed: false,
        });
        hapticError();
        blockScan('CONTAINER SCAN FAILED', scannedContainer.container_code);
        return true;
      }

      const shipmentItemIds = Array.from(
        new Set(
          (unitRows || [])
            .map((u) => u.shipment_item_id)
            .filter((v): v is string => typeof v === 'string' && v.length > 0)
        )
      );

      if (shipmentItemIds.length > 0) {
        const { data: shipmentItems, error: shipmentItemsErr } = await supabase
          .from('shipment_items')
          .select('id, item_id')
          .in('id', shipmentItemIds);

        if (shipmentItemsErr) {
          console.error('[StocktakeScanView] shipment_items lookup failed:', shipmentItemsErr);
          const message = `Failed to resolve container items for ${scannedContainer.container_code}.`;
          setLastScan({
            itemCode: scannedContainer.container_code,
            result: 'not_found',
            message,
            autoFixed: false,
          });
          hapticError();
          blockScan('CONTAINER SCAN FAILED', scannedContainer.container_code);
          return true;
        }

        const itemIds = Array.from(
          new Set(
            (shipmentItems || [])
              .map((si) => si.item_id)
              .filter((v): v is string => typeof v === 'string' && v.length > 0)
          )
        );

        if (itemIds.length > 0) {
          const { data: containerItems, error: itemsErr } = await supabase
            .from('items')
            .select('id, item_code')
            .in('id', itemIds)
            .is('deleted_at', null);

          if (itemsErr) {
            console.error('[StocktakeScanView] item lookup failed:', itemsErr);
            const message = `Failed to load item records for ${scannedContainer.container_code}.`;
            setLastScan({
              itemCode: scannedContainer.container_code,
              result: 'not_found',
              message,
              autoFixed: false,
            });
            hapticError();
            blockScan('CONTAINER SCAN FAILED', scannedContainer.container_code);
            return true;
          }

          for (const row of (containerItems || []) as any[]) {
            const itemId = typeof row?.id === 'string' ? row.id : '';
            const itemCode = typeof row?.item_code === 'string' ? row.item_code : '';
            if (!itemId || !itemCode) continue;
            uniqueByItemId.set(itemId, { id: itemId, item_code: itemCode });
          }
        }
      }
    }

    const uniqueItems = Array.from(uniqueByItemId.values());

    if (uniqueItems.length === 0) {
      const noLinkReason = legacyContainerUnitLinksEnabled
        ? `No linked stocktake items were found from this container.`
        : `Container item shortcuts are in item-code mode and this container has no item metadata links.`;
      const openDetails = window.confirm(
        `Scanned container ${scannedContainer.container_code}.\n\n` +
          `${noLinkReason}\n\nOpen container details instead?`
      );
      if (openDetails) {
        navigate(`/containers/${scannedContainer.id}`);
      } else {
        setLastScan({
          itemCode: scannedContainer.container_code,
          result: 'duplicate',
          message: 'Container scan ignored.',
          autoFixed: false,
        });
      }
      return true;
    }

    const processOk = window.confirm(
      `Scanned container ${scannedContainer.container_code}.\n\n` +
        `Scan ${uniqueItems.length} item(s) from this container at location ${activeLocationCode}?\n\n` +
        `Press Cancel to open container details instead.`
    );
    if (!processOk) {
      const openDetails = window.confirm('Open container details?');
      if (openDetails) {
        navigate(`/containers/${scannedContainer.id}`);
      } else {
        setLastScan({
          itemCode: scannedContainer.container_code,
          result: 'duplicate',
          message: 'Container scan ignored.',
          autoFixed: false,
        });
      }
      return true;
    }

    const counts: Record<ScanResult, number> = {
      expected: 0,
      unexpected: 0,
      wrong_location: 0,
      released_conflict: 0,
      duplicate: 0,
      not_found: 0,
    };
    let autoFixedCount = 0;

    for (const item of uniqueItems) {
      try {
        const result = await recordScan(activeLocationId, item.id, item.item_code);
        if (result.result && counts[result.result] !== undefined) {
          counts[result.result] += 1;
        }
        if (result.autoFixed) autoFixedCount += 1;
      } catch (err) {
        console.error('[StocktakeScanView] bulk container scan item failed:', err, { item_id: item.id });
        counts.not_found += 1;
      }
    }

    const parts = [
      counts.expected ? `${counts.expected} expected` : null,
      counts.wrong_location ? `${counts.wrong_location} wrong location` : null,
      counts.unexpected ? `${counts.unexpected} unexpected` : null,
      counts.duplicate ? `${counts.duplicate} duplicate` : null,
      counts.released_conflict ? `${counts.released_conflict} released conflict` : null,
      counts.not_found ? `${counts.not_found} not accepted` : null,
      autoFixedCount ? `${autoFixedCount} auto-fixed` : null,
    ].filter(Boolean);

    const summary = parts.length > 0
      ? `Container ${scannedContainer.container_code}: ${parts.join(', ')}.`
      : `Container ${scannedContainer.container_code} processed.`;

    if (counts.released_conflict > 0 || counts.not_found > 0) {
      hapticError();
      blockScan('CONTAINER SCAN HAD ISSUES', scannedContainer.container_code);
    } else if (counts.unexpected > 0 || counts.wrong_location > 0 || counts.duplicate > 0) {
      hapticMedium();
    } else {
      hapticSuccess();
    }

    const resultForBanner: ScanResult =
      counts.expected > 0
        ? 'expected'
        : counts.wrong_location > 0
          ? 'wrong_location'
          : counts.unexpected > 0
            ? 'unexpected'
            : counts.duplicate > 0
              ? 'duplicate'
              : counts.released_conflict > 0
                ? 'released_conflict'
                : 'not_found';

    setLastScan({
      itemCode: scannedContainer.container_code,
      result: resultForBanner,
      message: summary,
      autoFixed: autoFixedCount > 0,
    });

    // Ensure scan list/stats reflect final state after batch processing.
    await refetch();
    return true;
  };

  const stocktakeScanMode = useLocationToItemsScanMode<
    { id: string; item_code: string },
    { id: string; code: string }
  >({
    enabled: viewMode === 'scan',
    processing,
    setProcessing,
    isGloballyBlocked: () => !activeLocationId || !id,
    lookupItem,
    lookupLocation,
    isLikelyLocationCode,
    onBeforeItemLookup: async (event, controls) => {
      if (!orgPrefs.scan_shortcuts_open_container_enabled) return false;
      return await processContainerScanShortcut(event.raw, controls.block);
    },
    onLocationScanned: async (location) => {
      if (orgPrefs.scan_shortcuts_open_location_enabled) {
        const ok = window.confirm(
          `Scanned location ${location.code}.\n\nOpen location details? (This will leave stocktake scanning.)`
        );
        if (ok) {
          navigate(`/locations/${location.id}`);
          return true;
        }
      }

      hapticError();
      setLastScan({
        itemCode: location.code,
        result: 'not_found',
        message: 'This is a location barcode. Scan an item QR/barcode for this stocktake.',
        autoFixed: false,
      });
      return false;
    },
    onLocationNotFound: async (code) => {
      hapticError();
      setLastScan({
        itemCode: code,
        result: 'not_found',
        message: 'Location not found in system.',
        autoFixed: false,
      });
      return false;
    },
    onItemNotFound: async (code) => {
      hapticError();
      setLastScan({
        itemCode: code,
        result: 'not_found',
        message: 'Item not found in system',
        autoFixed: false,
      });
      return false;
    },
    onItemScanned: async (item, _event, controls) => {
      if (!activeLocationId) return;

      const result = await recordScan(activeLocationId, item.id, item.item_code);

      switch (result.result) {
        case 'expected':
          hapticSuccess();
          break;
        case 'wrong_location':
        case 'unexpected':
        case 'duplicate':
          hapticMedium();
          break;
        case 'released_conflict':
        case 'not_found':
          hapticError();
          break;
      }

      if (result.result === 'released_conflict' || result.result === 'not_found') {
        controls.block(
          result.result === 'released_conflict' ? 'RELEASED ITEM' : 'SCAN NOT ACCEPTED',
          item.item_code,
        );
      }

      setLastScan({
        itemCode: item.item_code,
        result: result.result,
        message: result.message || 'Scan recorded',
        autoFixed: result.autoFixed || false,
      });
    },
    onUnexpectedError: (error, raw) => {
      console.error('[StocktakeScanView] Scan error:', error, { raw });
      hapticError();
      setLastScan({
        itemCode: raw.trim(),
        result: 'not_found',
        message: 'Scan failed',
        autoFixed: false,
      });
    },
  });

  const handleManualSubmit = async () => {
    if (!manualItemCode.trim()) return;
    stocktakeScanMode.onScan(manualItemCode.trim());
    setManualItemCode('');
    setShowManualEntry(false);
  };

  const clearFilters = () => {
    setFilters({
      search: '',
      result: 'all',
      location: 'all',
      account: 'all',
    });
  };

  const hasActiveFilters = filters.search || filters.result !== 'all' || filters.location !== 'all' || filters.account !== 'all';

  if (loading || !stocktake) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[50vh]">
          <MaterialIcon name="progress_activity" className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </DashboardLayout>
    );
  }

  if (stocktake.status !== 'active') {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <MaterialIcon name="warning" className="h-12 w-12 mx-auto mb-4 text-yellow-500" />
          <h2 className="text-xl font-bold mb-2">Stocktake Not Active</h2>
          <p className="text-muted-foreground mb-4">
            This stocktake is {stocktake.status}. Cannot scan items.
          </p>
          <Button onClick={() => navigate('/stocktakes')}>Back to Stocktakes</Button>
        </div>
      </DashboardLayout>
    );
  }

  const progress = stats
    ? Math.round((stats.unique_items_scanned / (stats.expected_item_count || 1)) * 100)
    : 0;

  const lastScanIconName = lastScan ? scanResultConfig[lastScan.result]?.iconName || 'inventory_2' : 'inventory_2';

  return (
    <DashboardLayout>
      <div className="flex flex-col min-h-[80vh]">
        {/* Header */}
        <div className="flex items-center gap-4 mb-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/stocktakes')}>
            <MaterialIcon name="arrow_back" size="md" />
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold flex items-center gap-2">
              {stocktake.name || stocktake.stocktake_number}
              {stocktake.freeze_moves && (
                <MaterialIcon name="lock" size="sm" className="text-yellow-500" />
              )}
              {stocktake.allow_location_auto_fix && (
                <MaterialIcon name="build" size="sm" className="text-blue-500" />
              )}
            </h1>
            <p className="text-sm text-muted-foreground">
              {stocktake.warehouse?.name}
            </p>
          </div>
          <div className="flex gap-2 items-center flex-wrap justify-end">
            <JobTimerWidget
              jobType="stocktake"
              jobId={id}
              variant="inline"
              showControls
            />
            <Button
              variant={viewMode === 'scan' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('scan')}
            >
              <MaterialIcon name="document_scanner" size="sm" className="mr-1" />
              Scan
            </Button>
            <Button
              variant={viewMode === 'list' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setViewMode('list')}
            >
              <MaterialIcon name="list" size="sm" className="mr-1" />
              List
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate(`/stocktakes/${id}/report`)}
            >
              <MaterialIcon name="bar_chart" size="sm" className="mr-1" />
              Report
            </Button>
          </div>
        </div>

        {/* Progress */}
        <Card className="mb-4">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Progress</span>
              <span className="text-sm text-muted-foreground">
                {stats?.unique_items_scanned || 0} / {stats?.expected_item_count || 0} items
              </span>
            </div>
            <Progress value={progress} className="h-2" />
            <div className="flex gap-4 mt-3 text-xs">
              <span className="text-green-400">
                {stats?.found_expected || 0} found
              </span>
              <span className="text-yellow-400">
                {stats?.found_wrong_location || 0} wrong loc
              </span>
              <span className="text-orange-400">
                {stats?.found_unexpected || 0} unexpected
              </span>
              <span className="text-muted-foreground">
                {stats?.not_yet_scanned || 0} remaining
              </span>
            </div>
          </CardContent>
        </Card>

        {viewMode === 'scan' ? (
          /* SCAN VIEW */
          <div className="flex-1 flex flex-col">
            {/* Active Location Indicator */}
            <div className="mb-4">
              <label className="text-sm font-medium mb-2 block">
                Currently Scanning Location
              </label>
              <div className="flex gap-2 overflow-x-auto pb-2">
                {stocktakeLocations.map((location) => (
                  <button
                    key={location.id}
                    onClick={() => {
                      hapticLight();
                      setActiveLocationId(location.id);
                    }}
                    className={cn(
                      'px-4 py-3 rounded-xl border-2 transition-all flex-shrink-0',
                      activeLocationId === location.id
                        ? 'bg-primary text-primary-foreground border-primary shadow-lg shadow-primary/30'
                        : 'bg-card border-border hover:border-primary/50'
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <MaterialIcon name="location_on" size="md" />
                      <span className="font-mono font-bold">{location.code}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Last Scan Result */}
            {lastScan && (
              <div
                className={cn(
                  'mb-4 p-4 rounded-xl border-2 animate-in slide-in-from-top duration-300',
                  scanResultConfig[lastScan.result]?.bgColor
                )}
              >
                <div className="flex items-center gap-3">
                  <MaterialIcon name={lastScanIconName} className="h-8 w-8" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-lg">{lastScan.itemCode}</span>
                      <Badge className={scanResultConfig[lastScan.result]?.bgColor}>
                        {scanResultConfig[lastScan.result]?.label}
                      </Badge>
                      {lastScan.autoFixed && (
                        <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30">
                          Auto-fixed
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm opacity-80">{lastScan.message}</p>
                  </div>
                </div>
              </div>
            )}

            {/* QR Scanner */}
            <div className="flex-1 max-w-md mx-auto w-full">
              <QRScanner
                onScan={stocktakeScanMode.onScan}
                onError={(error) => console.error('Scanner error:', error)}
                // Keep camera open; scan engine handles busy/queueing.
                scanning
                paused={stocktakeScanMode.isOverlayBlocked}
                blockingOverlay={
                  stocktakeScanMode.overlay
                    ? {
                        open: true,
                        title: stocktakeScanMode.overlay.title,
                        reason: stocktakeScanMode.overlay.reason,
                        code: stocktakeScanMode.overlay.code,
                        hint: 'Tap to dismiss',
                        dismissLabel: 'Dismiss / Continue Scanning',
                        onDismiss: stocktakeScanMode.dismissOverlay,
                      }
                    : null
                }
              />
            </div>

            {/* Processing Indicator */}
            {processing && (
              <div className="flex items-center justify-center gap-2 py-4 text-primary">
                <MaterialIcon name="progress_activity" size="md" className="animate-spin" />
                <span>Processing...</span>
              </div>
            )}

            {/* Manual Entry */}
            <div className="mt-4">
              {showManualEntry ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={manualItemCode}
                    onChange={(e) => setManualItemCode(e.target.value.toUpperCase())}
                    onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
                    placeholder="Enter item code..."
                    autoCapitalize="none"
                    className="flex-1 px-4 py-3 rounded-xl bg-muted border border-border focus:border-primary focus:outline-none font-mono"
                    autoFocus
                  />
                  <Button onClick={handleManualSubmit} disabled={!manualItemCode.trim()}>
                    Scan
                  </Button>
                  <Button variant="outline" onClick={() => setShowManualEntry(false)}>
                    Cancel
                  </Button>
                </div>
              ) : (
                <button
                  onClick={() => setShowManualEntry(true)}
                  className="w-full flex items-center justify-center gap-3 p-4 bg-muted hover:bg-muted/80 rounded-xl transition-colors"
                >
                  <MaterialIcon name="keyboard" size="md" />
                  <span className="font-medium">Enter Item Code Manually</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          /* LIST VIEW */
          <div className="flex-1 flex flex-col">
            {/* Filters */}
            <Card className="mb-4">
              <CardContent className="p-4">
                <div className="flex flex-wrap gap-4 items-center">
                  <div className="relative flex-1 min-w-[200px]">
                    <MaterialIcon name="search" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search items..."
                      value={filters.search}
                      onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                      className="pl-10"
                    />
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowFilters(!showFilters)}
                    className={cn(hasActiveFilters && 'border-primary text-primary')}
                  >
                    <MaterialIcon name="filter_list" size="sm" className="mr-1" />
                    Filters
                    {hasActiveFilters && <Badge variant="secondary" className="ml-2">Active</Badge>}
                  </Button>

                  {hasActiveFilters && (
                    <Button variant="ghost" size="sm" onClick={clearFilters}>
                      <MaterialIcon name="close" size="sm" className="mr-1" />
                      Clear
                    </Button>
                  )}

                  <div className="flex items-center gap-2">
                    <Select
                      value={activeItemViewId || defaultItemViewId || 'default'}
                      onValueChange={setActiveItemViewId}
                      disabled={itemDisplayLoading || itemDisplaySettings.views.length === 0}
                    >
                      <SelectTrigger className="w-[140px] sm:w-[180px] h-10">
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

                    <ItemColumnsPopover
                      settings={itemDisplaySettings}
                      baseSettings={tenantItemDisplaySettings}
                      viewId={activeItemViewId || defaultItemViewId || 'default'}
                      disabled={itemDisplayLoading || itemDisplaySaving || itemDisplaySettings.views.length === 0}
                      onSave={saveItemDisplaySettings}
                    />
                  </div>

                  <Button variant="outline" size="icon" onClick={refetch}>
                    <MaterialIcon name="refresh" size="sm" />
                  </Button>
                </div>

                {showFilters && (
                  <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t">
                    <Select
                      value={filters.result}
                      onValueChange={(v) => setFilters(prev => ({ ...prev, result: v }))}
                    >
                      <SelectTrigger className="w-[160px]">
                        <SelectValue placeholder="Result" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Results</SelectItem>
                        {uniqueResults.map(r => (
                          <SelectItem key={r} value={r}>
                            {scanResultConfig[r]?.label || r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={filters.location}
                      onValueChange={(v) => setFilters(prev => ({ ...prev, location: v }))}
                    >
                      <SelectTrigger className="w-[160px]">
                        <SelectValue placeholder="Location" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Locations</SelectItem>
                        {uniqueLocations.map(l => (
                          <SelectItem key={l} value={l}>{l}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={filters.account}
                      onValueChange={(v) => setFilters(prev => ({ ...prev, account: v }))}
                    >
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Account" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Accounts</SelectItem>
                        {uniqueAccounts.map(a => (
                          <SelectItem key={a} value={a}>{a}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Items Table */}
            <Card className="flex-1">
              <CardContent className="p-0">
                <div className="overflow-auto max-h-[calc(100vh-400px)]">
                  <Table>
                    <TableHeader className="sticky top-0 bg-card z-10">
                      <TableRow>
                        <TableHead className="cursor-pointer hover:bg-muted/50" onClick={() => handleSort('scan_result')}>
                          <div className="flex items-center gap-2">
                            Result <SortIcon field="scan_result" />
                          </div>
                        </TableHead>
                        {stocktakeVisibleColumns.map((col) => {
                          const sortFieldForCol = (() => {
                            const cfKey = parseCustomFieldColumnKey(col);
                            if (cfKey) return null;
                            switch (col as BuiltinItemColumnKey) {
                              case 'item_code': return 'item_code' as const;
                              case 'vendor': return 'vendor' as const;
                              case 'description': return 'description' as const;
                              case 'location': return 'location_code' as const;
                              case 'client_account': return 'account_name' as const;
                              case 'sidemark': return 'sidemark' as const;
                              default: return null;
                            }
                          })();

                          const clickable = !!sortFieldForCol;
                          return (
                            <TableHead
                              key={col}
                              className={clickable ? 'cursor-pointer hover:bg-muted/50' : undefined}
                              onClick={clickable ? () => handleSort(sortFieldForCol!) : undefined}
                            >
                              <div className={col === 'quantity' || col === 'size' ? 'flex items-center justify-end gap-2' : 'flex items-center gap-2'}>
                                {getColumnLabel(itemDisplaySettings, col)}
                                {clickable && <SortIcon field={sortFieldForCol!} />}
                              </div>
                            </TableHead>
                          );
                        })}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredAndSortedItems.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={1 + stocktakeVisibleColumns.length} className="text-center py-8 text-muted-foreground">
                            {scannedItemDetails.length === 0 ? 'No items scanned yet' : 'No items match filters'}
                          </TableCell>
                        </TableRow>
                      ) : (
                        filteredAndSortedItems.map((item) => {
                          const config = scanResultConfig[item.scan_result];
                          return (
                            <TableRow
                              key={item.scan_id}
                              className="cursor-pointer hover:bg-muted/50"
                              onClick={() => item.item_id && navigate(`/inventory/${item.item_id}`)}
                            >
                              <TableCell>
                                <Badge className={cn('gap-1', config?.bgColor)}>
                                  <MaterialIcon name={config?.iconName || 'inventory_2'} className="h-3 w-3" />
                                  {config?.label || item.scan_result}
                                </Badge>
                                {item.auto_fix_applied && (
                                  <Badge variant="outline" className="ml-1 text-xs">
                                    Fixed
                                  </Badge>
                                )}
                              </TableCell>
                              {stocktakeVisibleColumns.map((col) => {
                                const cfKey = parseCustomFieldColumnKey(col);
                                if (cfKey) {
                                  const meta = item.metadata;
                                  const custom = meta && typeof meta === 'object' ? (meta as any).custom_fields : null;
                                  const raw = custom && typeof custom === 'object' ? (custom as any)[cfKey] : null;
                                  const display = raw === null || raw === undefined || raw === '' ? '-' : String(raw);
                                  return <TableCell key={col} className="max-w-[180px] truncate text-muted-foreground">{display}</TableCell>;
                                }

                                switch (col as BuiltinItemColumnKey) {
                                  case 'photo': {
                                    const url = item.primary_photo_url || null;
                                    const node = url ? (
                                      <img src={url} alt={item.item_code} className="h-8 w-8 rounded object-cover" />
                                    ) : (
                                      <div className="h-8 w-8 rounded bg-muted flex items-center justify-center text-sm">📦</div>
                                    );
                                    return (
                                      <TableCell key={col} className="w-12" onClick={(e) => e.stopPropagation()}>
                                        {item.item_id ? <ItemPreviewCard itemId={item.item_id}>{node}</ItemPreviewCard> : node}
                                      </TableCell>
                                    );
                                  }
                                  case 'item_code':
                                    return <TableCell key={col} className="font-mono font-medium">{item.item_code}</TableCell>;
                                  case 'sku':
                                    return <TableCell key={col} className="text-muted-foreground">{item.sku || '-'}</TableCell>;
                                  case 'quantity':
                                    return <TableCell key={col} className="text-right tabular-nums text-muted-foreground">{item.quantity ?? '-'}</TableCell>;
                                  case 'size':
                                    return <TableCell key={col} className="text-right tabular-nums text-muted-foreground">{formatItemSize(item.size, item.size_unit)}</TableCell>;
                                  case 'vendor':
                                    return <TableCell key={col} className="text-muted-foreground">{item.vendor || '-'}</TableCell>;
                                  case 'description':
                                    return <TableCell key={col} className="max-w-[200px] truncate text-muted-foreground">{item.description || '-'}</TableCell>;
                                  case 'location':
                                    return <TableCell key={col} className="font-mono">{item.location_code || '-'}</TableCell>;
                                  case 'client_account':
                                    return <TableCell key={col} className="text-muted-foreground">{item.account_name || '-'}</TableCell>;
                                  case 'sidemark':
                                    return <TableCell key={col} className="text-muted-foreground">{item.sidemark || '-'}</TableCell>;
                                  case 'room':
                                    return <TableCell key={col} className="text-muted-foreground">{item.room || '-'}</TableCell>;
                                  case 'received_date':
                                    return <TableCell key={col} className="text-muted-foreground">{(item as any).received_at ? format(new Date((item as any).received_at), 'MMM d, yyyy') : '-'}</TableCell>;
                                  default:
                                    return <TableCell key={col}>-</TableCell>;
                                }
                              })}
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
                {filteredAndSortedItems.length > 0 && (
                  <div className="p-3 border-t text-sm text-muted-foreground">
                    Showing {filteredAndSortedItems.length} of {scannedItemDetails.length} scanned items
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Activity */}
        {id && (
          <div className="mt-6">
            <EntityActivityFeed
              entityType="stocktake"
              entityId={id}
              title="Activity"
              description="Timeline of all scans, lifecycle changes, and variance resolution for this stocktake"
            />
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
