import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useWarehouses } from '@/hooks/useWarehouses';
import { useWarehouseMaps } from '@/hooks/useWarehouseMaps';
import { useWarehouseZones } from '@/hooks/useWarehouseZones';
import { useWarehouseMapNodes } from '@/hooks/useWarehouseMapNodes';
import { useLocations } from '@/hooks/useLocations';
import { HelpTip } from '@/components/ui/help-tip';
import type { Database } from '@/integrations/supabase/types';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

type NodeDraft = {
  label: string;
  zone_id: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
};

const UNASSIGNED_ZONE_VALUE = '__unassigned__';
const STANDARD_GRID_SIZE = 20;

type DragMode = 'move' | 'resize_se';
type DragState = {
  nodeId: string;
  mode: DragMode;
  startPointer: { x: number; y: number };
  startNode: { x: number; y: number; width: number; height: number };
};

type SidebarSection = 'properties' | 'zones' | 'alias' | 'groups';

type ViewBox = { x: number; y: number; w: number; h: number };
type PanState = { startClient: { x: number; y: number }; startView: ViewBox };
type BoxSelectState = {
  start: { x: number; y: number };
  current: { x: number; y: number };
  append: boolean;
};

type WarehouseMapInsert = Database['public']['Tables']['warehouse_maps']['Insert'];
type WarehouseMapNodeInsert = Database['public']['Tables']['warehouse_map_nodes']['Insert'];
type WarehouseMapNodeRow = Database['public']['Tables']['warehouse_map_nodes']['Row'];
type LocationRow = Database['public']['Tables']['locations']['Row'];

type NodeClipboardItem = Pick<WarehouseMapNodeRow, 'x' | 'y' | 'width' | 'height' | 'label'> & { group_label?: string | null };
type NodeClipboard = {
  sourceMapId: string | null;
  items: NodeClipboardItem[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
};

type PreferencesMode = 'setup' | 'review' | 'editor';

export default function WarehouseMapBuilder() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile } = useAuth();
  const { warehouseId } = useParams<{ warehouseId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedMapIdParam = searchParams.get('mapId');

  const { warehouses } = useWarehouses();
  const warehouse = useMemo(
    () => warehouses.find((w) => w.id === warehouseId) || null,
    [warehouses, warehouseId]
  );

  const {
    maps,
    loading: mapsLoading,
    createMap,
    updateMap,
    deleteMap,
    setDefaultMap,
    getDefaultMap,
    refetch: refetchMaps,
  } = useWarehouseMaps(warehouseId);

  const { zones, createZone } = useWarehouseZones(warehouseId);
  const { locations, loading: locationsLoading, refetch: refetchLocations } = useLocations(warehouseId);

  const activeMap = useMemo(() => {
    if (selectedMapIdParam) {
      return maps.find((m) => m.id === selectedMapIdParam) || null;
    }
    return getDefaultMap();
  }, [getDefaultMap, maps, selectedMapIdParam]);

  const [mapDraft, setMapDraft] = useState<{ width: number; height: number; grid_size: number } | null>(null);
  const [mapSaving, setMapSaving] = useState(false);
  const [mapSaveError, setMapSaveError] = useState<string | null>(null);
  const [mapLastSavedAt, setMapLastSavedAt] = useState<number | null>(null);
  const mapSaveErrorToastRef = useRef(false);

  useEffect(() => {
    if (!activeMap) {
      setMapDraft(null);
      return;
    }
    setMapDraft({
      width: activeMap.width ?? 2000,
      height: activeMap.height ?? 1200,
      grid_size: activeMap.grid_size ?? STANDARD_GRID_SIZE,
    });
    setMapSaveError(null);
    mapSaveErrorToastRef.current = false;
    // We intentionally sync draft only when switching maps. Including `activeMap`
    // (object identity changes on refetch) would overwrite in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMap?.id]);

  // Self-heal: if maps exist but none is marked default, pick the most recently updated.
  useEffect(() => {
    if (!warehouseId) return;
    if (maps.length === 0) return;
    if (maps.some((m) => m.is_default)) return;
    if (selectedMapIdParam) return;

    void setDefaultMap(maps[0].id).catch((err) => {
      console.error('[WarehouseMapBuilder] failed to set default map', err);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maps, selectedMapIdParam, warehouseId]);

  const mapIdForNodes = activeMap?.id;
  const {
    nodes,
    loading: nodesLoading,
    createNode,
    updateNode,
    deleteNode,
    refetch: refetchNodes,
  } = useWarehouseMapNodes(mapIdForNodes);

  const zoneById = useMemo(() => new Map(zones.map((z) => [z.id, z])), [zones]);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(() => new Set());
  const selectedCount = selectedNodeIds.size;
  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );

  const [draft, setDraft] = useState<NodeDraft | null>(null);
  const zoneIdToNodeId = useMemo(() => {
    const m = new Map<string, string>();
    for (const n of nodes) {
      if (n.zone_id) m.set(n.zone_id, n.id);
    }
    return m;
  }, [nodes]);

  const [preferencesMode, setPreferencesMode] = useState<PreferencesMode>('setup');
  const [sidebarWidth, setSidebarWidth] = useState(460);
  const [resizingSidebar, setResizingSidebar] = useState(false);

  const [zoneSearch, setZoneSearch] = useState('');
  const [setupZoneQuery, setSetupZoneQuery] = useState('');
  const [setupLocationQuery, setSetupLocationQuery] = useState('');
  const [setupAliasQuery, setSetupAliasQuery] = useState('');
  const [setupGroupQuery, setSetupGroupQuery] = useState('');

  const [setupSelectedZoneIds, setSetupSelectedZoneIds] = useState<Set<string>>(() => new Set());
  const [setupSelectedLocationIds, setSetupSelectedLocationIds] = useState<Set<string>>(() => new Set());
  const [setupAliasTarget, setSetupAliasTarget] = useState('');
  const [setupGroupTarget, setSetupGroupTarget] = useState('');
  const [customAliasTarget, setCustomAliasTarget] = useState('');
  const [customGroupTarget, setCustomGroupTarget] = useState('');

  const [pendingLocationZoneUpdates, setPendingLocationZoneUpdates] = useState<Map<string, string | null>>(() => new Map());
  const [pendingNodeAliasUpdates, setPendingNodeAliasUpdates] = useState<Map<string, string | null>>(() => new Map());
  const [pendingNodeGroupUpdates, setPendingNodeGroupUpdates] = useState<Map<string, string | null>>(() => new Map());
  const [setupSaving, setSetupSaving] = useState(false);

  const filteredZones = useMemo(() => {
    const q = zoneSearch.trim().toLowerCase();
    if (!q) return zones;
    return zones.filter((z) => {
      const code = String(z.zone_code || '').toLowerCase();
      const desc = String(z.description || '').toLowerCase();
      return code.includes(q) || desc.includes(q);
    });
  }, [zoneSearch, zones]);

  const unplacedZones = useMemo(
    () => filteredZones.filter((z) => !zoneIdToNodeId.has(z.id)),
    [filteredZones, zoneIdToNodeId]
  );

  const placedZones = useMemo(
    () => filteredZones.filter((z) => zoneIdToNodeId.has(z.id)),
    [filteredZones, zoneIdToNodeId]
  );

  const groupBoxes = useMemo(() => {
    const byLabel = new Map<string, { minX: number; minY: number; maxX: number; maxY: number; count: number }>();

    for (const n of nodes) {
      const label = (n.group_label || '').trim();
      if (!label) continue;

      const x = n.id === selectedNodeId && draft ? draft.x : n.x;
      const y = n.id === selectedNodeId && draft ? draft.y : n.y;
      const w = n.id === selectedNodeId && draft ? draft.width : n.width;
      const h = n.id === selectedNodeId && draft ? draft.height : n.height;

      const existing = byLabel.get(label);
      if (!existing) {
        byLabel.set(label, { minX: x, minY: y, maxX: x + w, maxY: y + h, count: 1 });
      } else {
        existing.minX = Math.min(existing.minX, x);
        existing.minY = Math.min(existing.minY, y);
        existing.maxX = Math.max(existing.maxX, x + w);
        existing.maxY = Math.max(existing.maxY, y + h);
        existing.count += 1;
      }
    }

    return Array.from(byLabel.entries())
      .map(([label, box]) => ({ label, ...box }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [draft, nodes, selectedNodeId]);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const [sidebarSection, setSidebarSection] = useState<SidebarSection>('properties');
  const [inlineZoneCode, setInlineZoneCode] = useState('');
  const [inlineZoneDescription, setInlineZoneDescription] = useState('');
  const [inlineZoneSaving, setInlineZoneSaving] = useState(false);
  const [aliasDraft, setAliasDraft] = useState('');
  const [aliasSaving, setAliasSaving] = useState(false);
  const [groupLabelDraft, setGroupLabelDraft] = useState('');
  const [groupSaving, setGroupSaving] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [autoLabelEnabled, setAutoLabelEnabled] = useState(true);
  const [showGroupLabels, setShowGroupLabels] = useState(true);

  const [autoSaving, setAutoSaving] = useState(false);
  const [autoSaveError, setAutoSaveError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const autoSaveErrorToastRef = useRef(false);

  const [clipboard, setClipboard] = useState<NodeClipboard | null>(null);
  const [pasting, setPasting] = useState(false);
  const pasteCountRef = useRef(0);
  const lastPointerSvgRef = useRef<{ x: number; y: number } | null>(null);
  const sidebarResizeStartRef = useRef<{ x: number; width: number } | null>(null);

  useEffect(() => {
    if (!profile?.id) return;
    const saved = localStorage.getItem(`hmv.mapBuilder.sidebarSection.${profile.id}`);
    const savedMode = localStorage.getItem(`hmv.mapBuilder.preferencesMode.${profile.id}`);
    const savedSidebarWidth = localStorage.getItem(`hmv.mapBuilder.sidebarWidth.${profile.id}`);
    if (saved === 'properties' || saved === 'zones' || saved === 'alias' || saved === 'groups') {
      setSidebarSection(saved);
    }
    if (savedMode === 'setup' || savedMode === 'review' || savedMode === 'editor') {
      setPreferencesMode(savedMode);
    }
    if (savedSidebarWidth) {
      const parsed = Number(savedSidebarWidth);
      if (Number.isFinite(parsed)) {
        setSidebarWidth(Math.min(Math.max(parsed, 360), 900));
      }
    }
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    localStorage.setItem(`hmv.mapBuilder.sidebarSection.${profile.id}`, sidebarSection);
  }, [profile?.id, sidebarSection]);

  useEffect(() => {
    if (!profile?.id) return;
    localStorage.setItem(`hmv.mapBuilder.preferencesMode.${profile.id}`, preferencesMode);
  }, [preferencesMode, profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    localStorage.setItem(`hmv.mapBuilder.sidebarWidth.${profile.id}`, String(sidebarWidth));
  }, [profile?.id, sidebarWidth]);

  useEffect(() => {
    if (!profile?.id) return;
    const snap = localStorage.getItem(`hmv.mapBuilder.snapToGrid.${profile.id}`);
    const autoLabel = localStorage.getItem(`hmv.mapBuilder.autoLabelEnabled.${profile.id}`);
    const groups = localStorage.getItem(`hmv.mapBuilder.showGroupLabels.${profile.id}`);

    if (snap === 'false') setSnapToGrid(false);
    if (autoLabel === 'false') setAutoLabelEnabled(false);
    if (groups === 'false') setShowGroupLabels(false);
  }, [profile?.id]);

  useEffect(() => {
    if (!profile?.id) return;
    localStorage.setItem(`hmv.mapBuilder.snapToGrid.${profile.id}`, String(snapToGrid));
  }, [profile?.id, snapToGrid]);

  useEffect(() => {
    if (!profile?.id) return;
    localStorage.setItem(`hmv.mapBuilder.autoLabelEnabled.${profile.id}`, String(autoLabelEnabled));
  }, [profile?.id, autoLabelEnabled]);

  useEffect(() => {
    if (!profile?.id) return;
    localStorage.setItem(`hmv.mapBuilder.showGroupLabels.${profile.id}`, String(showGroupLabels));
  }, [profile?.id, showGroupLabels]);

  useEffect(() => {
    if (!selectedNode) {
      setDraft(null);
      return;
    }
    setDraft({
      label: selectedNode.label || '',
      zone_id: selectedNode.zone_id,
      x: selectedNode.x,
      y: selectedNode.y,
      width: selectedNode.width,
      height: selectedNode.height,
    });
  }, [selectedNode]);

  useEffect(() => {
    if (selectedNodeIds.size === 0) {
      setAliasDraft('');
      return;
    }

    const aliasValues = nodes
      .filter((n) => selectedNodeIds.has(n.id))
      .map((n) => (n.label?.trim() ? n.label.trim() : ''));
    if (aliasValues.length === 0) {
      setAliasDraft('');
      return;
    }
    const first = aliasValues[0];
    const allSame = aliasValues.every((v) => v === first);
    setAliasDraft(allSame ? first : '');
  }, [nodes, selectedNodeIds]);

  // Keep selection state valid if nodes are refetched/deleted.
  useEffect(() => {
    if (nodes.length === 0) {
      if (selectedNodeId || selectedNodeIds.size > 0) {
        setSelectedNodeId(null);
        setSelectedNodeIds(new Set());
      }
      return;
    }

    const valid = new Set(nodes.map((n) => n.id));
    const filtered = new Set(Array.from(selectedNodeIds).filter((id) => valid.has(id)));
    const nextActive =
      selectedNodeId && valid.has(selectedNodeId)
        ? selectedNodeId
        : filtered.size > 0
          ? filtered.values().next().value
          : null;

    if (filtered.size !== selectedNodeIds.size) {
      setSelectedNodeIds(filtered);
    }
    if (nextActive !== selectedNodeId) {
      setSelectedNodeId(nextActive);
    }
  }, [nodes, selectedNodeId, selectedNodeIds]);

  useEffect(() => {
    const validZoneIds = new Set(zones.map((z) => z.id));
    setSetupSelectedZoneIds((prev) => new Set(Array.from(prev).filter((id) => validZoneIds.has(id))));
  }, [zones]);

  useEffect(() => {
    const validLocationIds = new Set(locations.map((l) => l.id));
    setSetupSelectedLocationIds((prev) => new Set(Array.from(prev).filter((id) => validLocationIds.has(id))));
  }, [locations]);

  useEffect(() => {
    // Reset staged setup changes when switching maps to avoid accidental cross-map updates.
    setPendingNodeAliasUpdates(new Map());
    setPendingNodeGroupUpdates(new Map());
  }, [activeMap?.id]);

  const [createMapOpen, setCreateMapOpen] = useState(false);
  const [newMapName, setNewMapName] = useState('');
  const [creatingMap, setCreatingMap] = useState(false);
  const [createMapMakeDefault, setCreateMapMakeDefault] = useState(false);

  const [renameMapOpen, setRenameMapOpen] = useState(false);
  const [renameMapName, setRenameMapName] = useState('');
  const [renamingMap, setRenamingMap] = useState(false);

  const [duplicateMapOpen, setDuplicateMapOpen] = useState(false);
  const [duplicateMapName, setDuplicateMapName] = useState('');
  const [duplicatingMap, setDuplicatingMap] = useState(false);

  const [deleteMapOpen, setDeleteMapOpen] = useState(false);
  const [deletingMap, setDeletingMap] = useState(false);

  const handleCreateMap = async () => {
    if (!newMapName.trim()) {
      toast({ variant: 'destructive', title: 'Name required', description: 'Enter a map name.' });
      return;
    }

    try {
      setCreatingMap(true);
      const created = await createMap({ name: newMapName.trim(), makeDefault: createMapMakeDefault });
      setCreateMapOpen(false);
      setNewMapName('');
      setCreateMapMakeDefault(false);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('mapId', created.id);
        return next;
      });
      toast({ title: 'Map created', description: 'Map has been created.' });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Create failed', description: 'Failed to create map.' });
    } finally {
      setCreatingMap(false);
    }
  };

  const suggestDuplicateName = (sourceName: string) => {
    const existing = new Set(maps.map((m) => (m.name || '').trim().toLowerCase()).filter(Boolean));
    const base = `${sourceName} (Copy)`.trim();
    if (!existing.has(base.toLowerCase())) return base;
    for (let i = 2; i < 1000; i++) {
      const candidate = `${sourceName} (Copy ${i})`.trim();
      if (!existing.has(candidate.toLowerCase())) return candidate;
    }
    return `${sourceName} (Copy ${Date.now()})`;
  };

  const openRenameMap = () => {
    if (!activeMap) return;
    setRenameMapName(activeMap.name);
    setRenameMapOpen(true);
  };

  const openDuplicateMap = () => {
    if (!activeMap) return;
    setDuplicateMapName(suggestDuplicateName(activeMap.name));
    setDuplicateMapOpen(true);
  };

  const handleRenameMap = async () => {
    if (!activeMap) return;
    const nextName = renameMapName.trim();
    if (!nextName) {
      toast({ variant: 'destructive', title: 'Name required', description: 'Enter a map name.' });
      return;
    }

    try {
      setRenamingMap(true);
      await updateMap(activeMap.id, { name: nextName });
      setRenameMapOpen(false);
      toast({ title: 'Map renamed', description: 'Map name updated.' });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Rename failed', description: 'Failed to rename map.' });
    } finally {
      setRenamingMap(false);
    }
  };

  const handleDuplicateMap = async () => {
    if (!activeMap) return;
    if (!profile?.tenant_id || !warehouseId) {
      toast({ variant: 'destructive', title: 'Missing context', description: 'Missing tenant/warehouse context.' });
      return;
    }

    const nextName = duplicateMapName.trim();
    if (!nextName) {
      toast({ variant: 'destructive', title: 'Name required', description: 'Enter a map name for the duplicate.' });
      return;
    }

    if (drag) {
      toast({ variant: 'destructive', title: 'Finish editing', description: 'Finish dragging before duplicating the map.' });
      return;
    }

    try {
      setDuplicatingMap(true);

      // Best-effort: flush pending edits before duplication.
      await saveDraftRef.current({ silent: true });
      if (isMapDraftDirty) {
        await saveMapDraft({ silent: true });
      }
      const latestNodes = await refetchNodes();

      const width = mapDraft?.width ?? activeMap.width ?? 2000;
      const height = mapDraft?.height ?? activeMap.height ?? 1200;
      const persistedGrid = mapDraft?.grid_size ?? activeMap.grid_size ?? STANDARD_GRID_SIZE;

      const mapPayload: WarehouseMapInsert = {
        tenant_id: profile.tenant_id,
        warehouse_id: warehouseId,
        name: nextName,
        width,
        height,
        grid_size: persistedGrid,
        is_default: false, // DL-2026-02-18-008
        created_by: profile.id,
        updated_by: profile.id,
      };

      const { data: createdMap, error: createErr } = await supabase
        .from('warehouse_maps')
        .insert(mapPayload)
        .select()
        .single();
      if (createErr) throw createErr;

      try {
        const sourceNodes = latestNodes ?? nodes;
        const nodeRows: WarehouseMapNodeInsert[] = sourceNodes.map((n, idx) => ({
          warehouse_map_id: createdMap.id,
          zone_id: n.zone_id,
          x: n.x,
          y: n.y,
          width: n.width,
          height: n.height,
          label: n.label,
          group_label: (n as any).group_label ?? null,
          sort_order: n.sort_order ?? idx,
          created_by: profile.id,
          updated_by: profile.id,
        }));

        if (nodeRows.length > 0) {
          const { error: nodeErr } = await supabase.from('warehouse_map_nodes').insert(nodeRows);
          if (nodeErr) throw nodeErr;
        }
      } catch (nodeInsertErr) {
        // Best-effort cleanup: avoid leaving a blank duplicate if node cloning fails.
        await deleteMap(createdMap.id).catch(() => {});
        throw nodeInsertErr;
      }

      await refetchMaps();
      setDuplicateMapOpen(false);
      clearSelection();
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('mapId', createdMap.id);
        return next;
      });
      toast({ title: 'Map duplicated', description: 'Duplicate created (default map unchanged).' });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Duplicate failed', description: 'Failed to duplicate map.' });
    } finally {
      setDuplicatingMap(false);
    }
  };

  const handleDeleteMap = async () => {
    if (!activeMap) return;
    try {
      setDeletingMap(true);
      await deleteMap(activeMap.id);
      setDeleteMapOpen(false);
      clearSelection();
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('mapId');
        return next;
      });
      toast({ title: 'Map deleted', description: 'Map has been deleted.' });
    } catch (err: unknown) {
      console.error(err);
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : 'Failed to delete map.';
      toast({ variant: 'destructive', title: 'Delete failed', description: msg });
    } finally {
      setDeletingMap(false);
    }
  };

  const handleAddNode = async () => {
    if (!activeMap) return;
    try {
      const created = await createNode({
        x: 40,
        y: 40,
        width: 160,
        height: 100,
        label: null,
        zone_id: null,
        sort_order: nodes.length,
      });
      setSelectedNodeId(created.id);
      setSelectedNodeIds(new Set([created.id]));
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to add zone block.' });
    }
  };

  const copySelection = useCallback(() => {
    const ids = Array.from(selectedNodeIds);
    if (ids.length === 0) {
      toast({ title: 'Nothing selected', description: 'Select one or more blocks first.' });
      return;
    }

    const items: NodeClipboardItem[] = [];
    for (const id of ids) {
      const node = nodes.find((n) => n.id === id);
      if (!node) continue;
      const useDraft = id === selectedNodeId && draft;
      items.push({
        x: useDraft ? draft.x : node.x,
        y: useDraft ? draft.y : node.y,
        width: useDraft ? draft.width : node.width,
        height: useDraft ? draft.height : node.height,
        label: useDraft ? (draft.label?.trim() ? draft.label.trim() : null) : (node.label?.trim() ? node.label.trim() : null),
        group_label: (node as any).group_label?.trim() ? (node as any).group_label.trim() : null,
      });
    }

    if (items.length === 0) {
      toast({ title: 'Nothing copied', description: 'Selected blocks are no longer available.' });
      return;
    }

    const bounds = items.reduce(
      (acc, n) => ({
        minX: Math.min(acc.minX, n.x),
        minY: Math.min(acc.minY, n.y),
        maxX: Math.max(acc.maxX, n.x + n.width),
        maxY: Math.max(acc.maxY, n.y + n.height),
      }),
      { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: 0, maxY: 0 }
    );

    setClipboard({ sourceMapId: activeMap?.id ?? null, items, bounds });
    pasteCountRef.current = 0;
    toast({
      title: 'Copied',
      description: `Copied ${items.length} block${items.length === 1 ? '' : 's'}.`,
    });
  }, [activeMap?.id, draft, nodes, selectedNodeId, selectedNodeIds, toast]);

  const pasteClipboard = useCallback(async () => {
    if (!activeMap) return;
    if (!clipboard || clipboard.items.length === 0) {
      toast({ title: 'Nothing to paste', description: 'Copy one or more blocks first.' });
      return;
    }
    if (pasting) return;
    if (!profile?.id) return;

    // Best-effort: flush pending edits before switching selection.
    if (selectedNode && draft) {
      await saveDraftRef.current({ silent: true });
    }

    try {
      setPasting(true);
      const width = mapDraft?.width ?? activeMap.width ?? 2000;
      const height = mapDraft?.height ?? activeMap.height ?? 1200;
      const grid = STANDARD_GRID_SIZE;
      const step = snapToGrid ? grid : 10;

      pasteCountRef.current += 1;
      const delta = step * pasteCountRef.current;

      const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);
      const snap = (v: number) => (snapToGrid ? Math.round(v / grid) * grid : Math.round(v));

      const b = clipboard.bounds;
      const selectionW = Math.max(1, b.maxX - b.minX);
      const selectionH = Math.max(1, b.maxY - b.minY);

      const pointer = lastPointerSvgRef.current;
      const baseX = pointer ? pointer.x - selectionW / 2 : b.minX;
      const baseY = pointer ? pointer.y - selectionH / 2 : b.minY;

      const rows: WarehouseMapNodeInsert[] = clipboard.items.map((n, i) => {
        const relX = n.x - b.minX;
        const relY = n.y - b.minY;

        const rawX = baseX + relX + delta;
        const rawY = baseY + relY + delta;

        const x = clamp(snap(rawX), 0, Math.max(0, width - n.width));
        const y = clamp(snap(rawY), 0, Math.max(0, height - n.height));

        return {
          warehouse_map_id: activeMap.id,
          // Pasted blocks are intentionally unassigned due to (map_id, zone_id) uniqueness.
          zone_id: null,
          x,
          y,
          width: n.width,
          height: n.height,
          label: n.label,
          group_label: n.group_label,
          sort_order: (nodes.length ?? 0) + i,
          created_by: profile.id,
          updated_by: profile.id,
        };
      });

      const { data, error } = await supabase.from('warehouse_map_nodes').insert(rows).select();
      if (error) throw error;

      await refetchNodes();

      const ids = (data || []).map((r) => r.id);
      if (ids.length > 0) {
        setSelectedNodeIds(new Set(ids));
        setSelectedNodeId(ids[0]);
      }

      toast({
        title: 'Pasted',
        description: `Pasted ${rows.length} block${rows.length === 1 ? '' : 's'} (unassigned).`,
      });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Paste failed', description: 'Failed to paste blocks.' });
    } finally {
      setPasting(false);
    }
  }, [
    activeMap,
    clipboard,
    draft,
    mapDraft,
    nodes.length,
    pasting,
    profile?.id,
    refetchNodes,
    selectedNode,
    snapToGrid,
    toast,
  ]);

  // Duplicate selected block (Ctrl/Cmd + D), copy (Ctrl/Cmd + C), paste (Ctrl/Cmd + V)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;
      const key = String(e.key || '').toLowerCase();
      const isDuplicate = key === 'd';
      const isCopy = key === 'c';
      const isPaste = key === 'v';
      if (!isDuplicate && !isCopy && !isPaste) return;

      const activeEl = document.activeElement as HTMLElement | null;
      const isTyping =
        !!activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT' ||
          activeEl.isContentEditable);
      if (isTyping) return;

      if (isCopy) {
        if (selectedNodeIds.size === 0) return;
        e.preventDefault();
        e.stopPropagation();
        copySelection();
        return;
      }

      if (isPaste) {
        if (!clipboard || clipboard.items.length === 0) return;
        e.preventDefault();
        e.stopPropagation();
        void pasteClipboard();
        return;
      }

      // Duplicate
      if (!activeMap || !selectedNode || !draft) return;
      e.preventDefault();
      e.stopPropagation();

      const width = mapDraft?.width ?? activeMap.width ?? 2000;
      const height = mapDraft?.height ?? activeMap.height ?? 1200;
      const grid = STANDARD_GRID_SIZE;
      const offset = snapToGrid ? grid : 10;

      // Duplicates cannot keep zone_id due to (map_id, zone_id) uniqueness.
      void createNode({
        x: Math.min(draft.x + offset, Math.max(0, width - draft.width)),
        y: Math.min(draft.y + offset, Math.max(0, height - draft.height)),
        width: draft.width,
        height: draft.height,
        label: draft.label?.trim() ? draft.label.trim() : null,
        zone_id: null,
        sort_order: nodes.length,
      })
        .then((created) => {
          setSelectedNodeId(created.id);
          setSelectedNodeIds(new Set([created.id]));
          toast({ title: 'Duplicated', description: 'Block duplicated.' });
        })
        .catch((err) => {
          console.error(err);
          toast({ variant: 'destructive', title: 'Duplicate failed', description: 'Failed to duplicate block.' });
        });
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeMap,
    clipboard,
    copySelection,
    createNode,
    draft,
    mapDraft,
    nodes,
    pasteClipboard,
    pasting,
    profile?.id,
    refetchNodes,
    selectedNode,
    selectedNodeId,
    selectedNodeIds,
    snapToGrid,
    toast,
  ]);

  const isDraftDirty = useMemo(() => {
    if (!selectedNode || !draft) return false;
    const normalizedDraftLabel = draft.label?.trim() ? draft.label.trim() : null;
    const normalizedSelectedLabel = selectedNode.label?.trim() ? selectedNode.label.trim() : null;
    return (
      normalizedDraftLabel !== normalizedSelectedLabel ||
      draft.zone_id !== selectedNode.zone_id ||
      draft.x !== selectedNode.x ||
      draft.y !== selectedNode.y ||
      draft.width !== selectedNode.width ||
      draft.height !== selectedNode.height
    );
  }, [draft, selectedNode]);

  const saveDraft = async ({ silent }: { silent?: boolean } = {}) => {
    if (!selectedNode || !draft) return;
    if (!isDraftDirty) return;
    try {
      setAutoSaveError(null);
      setAutoSaving(true);
      await updateNode(selectedNode.id, {
        label: draft.label?.trim() ? draft.label.trim() : null,
        zone_id: draft.zone_id,
        x: draft.x,
        y: draft.y,
        width: draft.width,
        height: draft.height,
      });
      setLastSavedAt(Date.now());
      autoSaveErrorToastRef.current = false;
      if (!silent) {
        toast({ title: 'Saved', description: 'Block updated.' });
      }
    } catch (err) {
      console.error(err);
      setAutoSaveError('Autosave failed');
      if (!silent || !autoSaveErrorToastRef.current) {
        autoSaveErrorToastRef.current = true;
        toast({ variant: 'destructive', title: 'Save failed', description: 'Failed to update block.' });
      }
    } finally {
      setAutoSaving(false);
    }
  };

  const handleManualSave = () => {
    if (!selectedNode || !draft) return;
    if (!isDraftDirty) {
      toast({ title: 'Up to date', description: 'No changes to save.' });
      return;
    }
    void saveDraft();
  };

  const saveDraftRef = useRef(saveDraft);
  saveDraftRef.current = saveDraft;

  // Autosave node changes after 500ms idle.
  useEffect(() => {
    if (!selectedNode || !draft) return;
    if (!isDraftDirty) return;
    if (autoSaving) return;
    if (drag) return;

    const t = window.setTimeout(() => {
      void saveDraft({ silent: true });
    }, 500);

    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSaving, draft, drag, isDraftDirty, selectedNode?.id]);

  const clearSelection = () => {
    // Best-effort: flush pending edits before clearing selection.
    if (selectedNode && draft && isDraftDirty) {
      void saveDraftRef.current({ silent: true });
    }
    setSelectedNodeId(null);
    setSelectedNodeIds(new Set());
  };

  const selectSingleNode = (nodeId: string) => {
    // Best-effort: flush pending edits before switching active selection.
    if (selectedNodeId && selectedNodeId !== nodeId && selectedNode && draft && isDraftDirty) {
      void saveDraftRef.current({ silent: true });
    }
    setSelectedNodeId(nodeId);
    setSelectedNodeIds(new Set([nodeId]));
  };

  const toggleNodeSelected = (nodeId: string) => {
    setSelectedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }

      // Maintain an active selection id when possible.
      if (next.size === 0) {
        setSelectedNodeId(null);
      } else if (!selectedNodeId || !next.has(selectedNodeId)) {
        setSelectedNodeId(next.values().next().value || null);
      }

      return next;
    });
  };

  const setGroupLabelForSelection = async (nextGroupLabel: string | null) => {
    if (!mapIdForNodes) return;
    const ids = Array.from(selectedNodeIds);
    if (ids.length === 0) return;

    try {
      setGroupSaving(true);
      const normalized = nextGroupLabel?.trim() ? nextGroupLabel.trim() : null;

      const { error } = await supabase
        .from('warehouse_map_nodes')
        .update({
          group_label: normalized,
          updated_by: profile?.id ?? null,
        })
        .in('id', ids);

      if (error) throw error;

      await refetchNodes();
      toast({
        title: 'Zone group updated',
        description: normalized ? `Assigned zone group "${normalized}"` : 'Cleared zone group assignment',
      });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Update failed', description: 'Failed to update zone group labels.' });
    } finally {
      setGroupSaving(false);
    }
  };

  const setAliasForSelection = async (nextAlias: string | null) => {
    if (!mapIdForNodes) return;
    const ids = Array.from(selectedNodeIds);
    if (ids.length === 0) return;

    try {
      setAliasSaving(true);
      const normalized = nextAlias?.trim() ? nextAlias.trim() : null;

      // Best-effort: flush pending single-node draft before bulk update.
      await saveDraftRef.current({ silent: true });

      const { error } = await supabase
        .from('warehouse_map_nodes')
        .update({
          label: normalized,
          updated_by: profile?.id ?? null,
        })
        .in('id', ids);

      if (error) throw error;

      await refetchNodes();
      setAliasDraft(normalized ?? '');
      toast({
        title: 'Zone alias updated',
        description: normalized
          ? `Assigned zone alias "${normalized}" to ${ids.length} selection${ids.length === 1 ? '' : 's'}.`
          : 'Cleared zone alias from selection.',
      });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Update failed', description: 'Failed to update zone alias labels.' });
    } finally {
      setAliasSaving(false);
    }
  };

  const handleCreateZoneInline = async () => {
    const zoneCode = inlineZoneCode.trim().toUpperCase();
    if (!zoneCode) {
      toast({ variant: 'destructive', title: 'Zone code required', description: 'Enter a zone code like ZN-001.' });
      return;
    }

    try {
      setInlineZoneSaving(true);
      const maxSort = zones.reduce((max, z) => Math.max(max, z.sort_order ?? 0), 0);
      await createZone({
        zone_code: zoneCode,
        description: inlineZoneDescription.trim() ? inlineZoneDescription.trim() : null,
        sort_order: maxSort + 1,
      });
      setInlineZoneCode('');
      setInlineZoneDescription('');
      setZoneSearch(zoneCode);
      toast({ title: 'Zone created', description: `${zoneCode} is ready to place on the map.` });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Create failed', description: 'Failed to create zone.' });
    } finally {
      setInlineZoneSaving(false);
    }
  };

  const setupSelectedZoneId =
    setupSelectedZoneIds.size === 1 ? Array.from(setupSelectedZoneIds.values())[0] ?? null : null;
  const setupSelectedZoneCode = setupSelectedZoneId ? zoneById.get(setupSelectedZoneId)?.zone_code ?? null : null;

  const effectiveLocationZoneId = useCallback(
    (location: LocationRow) => pendingLocationZoneUpdates.get(location.id) ?? location.zone_id ?? null,
    [pendingLocationZoneUpdates]
  );

  const effectiveZoneAliasByZoneId = useMemo(() => {
    const byZone = new Map<string, string>();
    for (const n of nodes) {
      if (!n.zone_id) continue;
      const pending = pendingNodeAliasUpdates.get(n.id);
      const v = pending !== undefined ? pending : n.label;
      byZone.set(n.zone_id, v?.trim() ?? '');
    }
    return byZone;
  }, [nodes, pendingNodeAliasUpdates]);

  const effectiveZoneGroupByZoneId = useMemo(() => {
    const byZone = new Map<string, string>();
    for (const n of nodes) {
      if (!n.zone_id) continue;
      const pending = pendingNodeGroupUpdates.get(n.id);
      const v = pending !== undefined ? pending : n.group_label;
      byZone.set(n.zone_id, v?.trim() ?? '');
    }
    return byZone;
  }, [nodes, pendingNodeGroupUpdates]);

  const locationCountByZoneId = useMemo(() => {
    const m = new Map<string, number>();
    for (const loc of locations) {
      const zoneId = effectiveLocationZoneId(loc);
      if (!zoneId) continue;
      m.set(zoneId, (m.get(zoneId) || 0) + 1);
    }
    return m;
  }, [effectiveLocationZoneId, locations]);

  const setupFilteredZones = useMemo(() => {
    const q = setupZoneQuery.trim().toLowerCase();
    if (!q) return zones;
    return zones.filter((z) => {
      const code = (z.zone_code || '').toLowerCase();
      const desc = (z.description || '').toLowerCase();
      return code.includes(q) || desc.includes(q);
    });
  }, [setupZoneQuery, zones]);

  const setupFilteredLocations = useMemo(() => {
    const q = setupLocationQuery.trim().toLowerCase();
    if (!q) return locations;
    return locations.filter((loc) => {
      const code = (loc.code || '').toLowerCase();
      const name = (loc.name || '').toLowerCase();
      const zoneId = effectiveLocationZoneId(loc);
      const zoneCode = zoneId ? (zoneById.get(zoneId)?.zone_code || '').toLowerCase() : '';
      return code.includes(q) || name.includes(q) || zoneCode.includes(q);
    });
  }, [effectiveLocationZoneId, locations, setupLocationQuery, zoneById]);

  const aliasOptions = useMemo(() => {
    const options = new Set<string>();
    for (const n of nodes) {
      const v = (n.label || '').trim();
      if (v) options.add(v);
    }
    return Array.from(options).sort((a, b) => a.localeCompare(b));
  }, [nodes]);

  const groupOptions = useMemo(() => {
    const options = new Set<string>();
    for (const n of nodes) {
      const v = (n.group_label || '').trim();
      if (v) options.add(v);
    }
    return Array.from(options).sort((a, b) => a.localeCompare(b));
  }, [nodes]);

  const setupFilteredAliasOptions = useMemo(() => {
    const q = setupAliasQuery.trim().toLowerCase();
    if (!q) return aliasOptions;
    return aliasOptions.filter((v) => v.toLowerCase().includes(q));
  }, [aliasOptions, setupAliasQuery]);

  const setupFilteredGroupOptions = useMemo(() => {
    const q = setupGroupQuery.trim().toLowerCase();
    if (!q) return groupOptions;
    return groupOptions.filter((v) => v.toLowerCase().includes(q));
  }, [groupOptions, setupGroupQuery]);

  const hasStagedChanges =
    pendingLocationZoneUpdates.size > 0 || pendingNodeAliasUpdates.size > 0 || pendingNodeGroupUpdates.size > 0;

  const toggleSetupZone = (zoneId: string) => {
    setSetupSelectedZoneIds((prev) => {
      const next = new Set(prev);
      if (next.has(zoneId)) next.delete(zoneId);
      else next.add(zoneId);
      return next;
    });
  };

  const toggleSetupLocation = (locationId: string) => {
    setSetupSelectedLocationIds((prev) => {
      const next = new Set(prev);
      if (next.has(locationId)) next.delete(locationId);
      else next.add(locationId);
      return next;
    });
  };

  const stageLocationsToSelectedZone = () => {
    if (!setupSelectedZoneId) {
      toast({
        variant: 'destructive',
        title: 'Select one zone',
        description: 'Select exactly one zone before linking locations.',
      });
      return;
    }
    if (setupSelectedLocationIds.size === 0) {
      toast({ variant: 'destructive', title: 'No locations selected', description: 'Select locations first.' });
      return;
    }
    setPendingLocationZoneUpdates((prev) => {
      const next = new Map(prev);
      for (const id of setupSelectedLocationIds) next.set(id, setupSelectedZoneId);
      return next;
    });
    toast({
      title: 'Staged',
      description: `Staged ${setupSelectedLocationIds.size} location${setupSelectedLocationIds.size === 1 ? '' : 's'} for ${zoneById.get(setupSelectedZoneId)?.zone_code || 'selected zone'}.`,
    });
  };

  const stageZoneAlias = () => {
    if (!setupSelectedZoneId) {
      toast({
        variant: 'destructive',
        title: 'Select one zone',
        description: 'Select exactly one zone before setting zone alias.',
      });
      return;
    }
    const nodeId = zoneIdToNodeId.get(setupSelectedZoneId);
    if (!nodeId) {
      toast({
        variant: 'destructive',
        title: 'Zone not placed',
        description: 'Place this zone on the map before assigning a zone alias.',
      });
      return;
    }
    const nextAliasRaw = customAliasTarget.trim() || setupAliasTarget.trim();
    const nextAlias = nextAliasRaw ? nextAliasRaw : null;
    setPendingNodeAliasUpdates((prev) => new Map(prev).set(nodeId, nextAlias));
    toast({ title: 'Staged', description: nextAlias ? `Zone alias "${nextAlias}" staged.` : 'Zone alias clear staged.' });
  };

  const stageZoneGroup = () => {
    if (setupSelectedZoneIds.size === 0) {
      toast({ variant: 'destructive', title: 'No zones selected', description: 'Select one or more zones first.' });
      return;
    }
    const nextGroupRaw = customGroupTarget.trim() || setupGroupTarget.trim();
    const nextGroup = nextGroupRaw ? nextGroupRaw : null;

    let staged = 0;
    let skipped = 0;
    setPendingNodeGroupUpdates((prev) => {
      const next = new Map(prev);
      for (const zoneId of setupSelectedZoneIds) {
        const nodeId = zoneIdToNodeId.get(zoneId);
        if (!nodeId) {
          skipped += 1;
          continue;
        }
        next.set(nodeId, nextGroup);
        staged += 1;
      }
      return next;
    });

    if (staged === 0) {
      toast({
        variant: 'destructive',
        title: 'No placed zones selected',
        description: 'Selected zones must be placed on map to receive a zone group.',
      });
      return;
    }

    toast({
      title: 'Staged',
      description: `${staged} zone${staged === 1 ? '' : 's'} staged${skipped > 0 ? ` (${skipped} unplaced skipped)` : ''}.`,
    });
  };

  const clearStagedSetupChanges = () => {
    setPendingLocationZoneUpdates(new Map());
    setPendingNodeAliasUpdates(new Map());
    setPendingNodeGroupUpdates(new Map());
    toast({ title: 'Cleared', description: 'Staged changes cleared.' });
  };

  const saveStagedSetupChanges = async () => {
    if (!warehouseId) return;
    if (!hasStagedChanges) {
      toast({ title: 'Up to date', description: 'No staged setup changes to save.' });
      return;
    }

    try {
      setSetupSaving(true);

      const locationGroups = new Map<string, string[]>();
      for (const [locationId, zoneId] of pendingLocationZoneUpdates.entries()) {
        const key = zoneId ?? '__none__';
        const arr = locationGroups.get(key) || [];
        arr.push(locationId);
        locationGroups.set(key, arr);
      }
      for (const [key, ids] of locationGroups.entries()) {
        const payloadZoneId = key === '__none__' ? null : key;
        const { error } = await supabase
          .from('locations')
          .update({ zone_id: payloadZoneId })
          .eq('warehouse_id', warehouseId)
          .in('id', ids);
        if (error) throw error;
      }

      const aliasGroups = new Map<string, string[]>();
      for (const [nodeId, aliasValue] of pendingNodeAliasUpdates.entries()) {
        const key = aliasValue ?? '__none__';
        const arr = aliasGroups.get(key) || [];
        arr.push(nodeId);
        aliasGroups.set(key, arr);
      }
      for (const [key, ids] of aliasGroups.entries()) {
        const payloadAlias = key === '__none__' ? null : key;
        const { error } = await supabase
          .from('warehouse_map_nodes')
          .update({ label: payloadAlias, updated_by: profile?.id ?? null })
          .in('id', ids);
        if (error) throw error;
      }

      const groupGroups = new Map<string, string[]>();
      for (const [nodeId, groupValue] of pendingNodeGroupUpdates.entries()) {
        const key = groupValue ?? '__none__';
        const arr = groupGroups.get(key) || [];
        arr.push(nodeId);
        groupGroups.set(key, arr);
      }
      for (const [key, ids] of groupGroups.entries()) {
        const payloadGroup = key === '__none__' ? null : key;
        const { error } = await supabase
          .from('warehouse_map_nodes')
          .update({ group_label: payloadGroup, updated_by: profile?.id ?? null })
          .in('id', ids);
        if (error) throw error;
      }

      await Promise.all([refetchLocations(), refetchNodes()]);
      const locationCount = pendingLocationZoneUpdates.size;
      const aliasCount = pendingNodeAliasUpdates.size;
      const groupCount = pendingNodeGroupUpdates.size;
      setPendingLocationZoneUpdates(new Map());
      setPendingNodeAliasUpdates(new Map());
      setPendingNodeGroupUpdates(new Map());
      toast({
        title: 'Saved',
        description: `Saved setup changes (locations: ${locationCount}, zone aliases: ${aliasCount}, zone groups: ${groupCount}).`,
      });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Save failed', description: 'Failed to save staged setup changes.' });
    } finally {
      setSetupSaving(false);
    }
  };

  const reviewRows = useMemo(() => {
    return zones.map((z) => {
      const nodeId = zoneIdToNodeId.get(z.id) || null;
      const alias = effectiveZoneAliasByZoneId.get(z.id) || '';
      const group = effectiveZoneGroupByZoneId.get(z.id) || '';
      const locationCount = locationCountByZoneId.get(z.id) || 0;
      return {
        zoneId: z.id,
        zoneCode: z.zone_code,
        placed: !!nodeId,
        alias,
        group,
        locationCount,
      };
    });
  }, [effectiveZoneAliasByZoneId, effectiveZoneGroupByZoneId, locationCountByZoneId, zoneIdToNodeId, zones]);

  const reviewMetrics = useMemo(() => {
    const placedZones = reviewRows.filter((r) => r.placed).length;
    const aliasedZones = reviewRows.filter((r) => r.alias.trim().length > 0).length;
    const groupedZones = reviewRows.filter((r) => r.group.trim().length > 0).length;
    const zonesWithLocations = reviewRows.filter((r) => r.locationCount > 0).length;
    return {
      totalZones: reviewRows.length,
      placedZones,
      aliasedZones,
      groupedZones,
      zonesWithLocations,
    };
  }, [reviewRows]);

  const selectNodesByGroup = (groupLabel: string) => {
    const ids = nodes.filter((n) => ((n as any).group_label || '').trim() === groupLabel).map((n) => n.id);
    if (ids.length === 0) return;

    // Best-effort: flush pending edits before switching selections.
    if (selectedNode && draft && isDraftDirty) {
      void saveDraftRef.current({ silent: true });
    }

    setSelectedNodeIds(new Set(ids));
    setSelectedNodeId(ids[0]);
  };

  const handleSetDefault = async () => {
    if (!activeMap) return;
    try {
      await setDefaultMap(activeMap.id);
      toast({ title: 'Default map set', description: 'This map is now the default.' });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Error', description: 'Failed to set default map.' });
    }
  };

  const isMapDraftDirty = useMemo(() => {
    if (!activeMap || !mapDraft) return false;
    const width = activeMap.width ?? 2000;
    const height = activeMap.height ?? 1200;
    const grid = activeMap.grid_size ?? 20;
    return mapDraft.width !== width || mapDraft.height !== height || mapDraft.grid_size !== grid;
  }, [activeMap, mapDraft]);

  const saveMapDraft = async ({ silent }: { silent?: boolean } = {}) => {
    if (!activeMap || !mapDraft) return;
    try {
      setMapSaveError(null);
      setMapSaving(true);
      await updateMap(activeMap.id, {
        width: mapDraft.width,
        height: mapDraft.height,
        grid_size: mapDraft.grid_size,
      });
      setMapLastSavedAt(Date.now());
      mapSaveErrorToastRef.current = false;
      if (!silent) {
        toast({ title: 'Saved', description: 'Map settings updated.' });
      }
    } catch (err) {
      console.error(err);
      setMapSaveError('Autosave failed');
      if (!silent || !mapSaveErrorToastRef.current) {
        mapSaveErrorToastRef.current = true;
        toast({ variant: 'destructive', title: 'Save failed', description: 'Failed to update map settings.' });
      }
    } finally {
      setMapSaving(false);
    }
  };

  // Autosave map settings after 500ms idle.
  useEffect(() => {
    if (!activeMap || !mapDraft) return;
    if (!isMapDraftDirty) return;
    if (mapSaving) return;

    const t = window.setTimeout(() => {
      void saveMapDraft({ silent: true });
    }, 500);

    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMap?.id, isMapDraftDirty, mapDraft, mapSaving]);

  const mapWidth = mapDraft?.width ?? activeMap?.width ?? 2000;
  const mapHeight = mapDraft?.height ?? activeMap?.height ?? 1200;
  const gridSize = STANDARD_GRID_SIZE;

  const [view, setView] = useState<ViewBox>(() => ({ x: 0, y: 0, w: mapWidth, h: mapHeight }));
  const [pan, setPan] = useState<PanState | null>(null);
  const [boxSelect, setBoxSelect] = useState<BoxSelectState | null>(null);
  const suppressNextClickRef = useRef(false);

  // Reset viewport when switching maps or resizing map dimensions.
  useEffect(() => {
    setView({ x: 0, y: 0, w: mapWidth, h: mapHeight });
  }, [activeMap?.id, mapHeight, mapWidth]);

  const getSvgPoint = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  const clampView = (vb: ViewBox): ViewBox => {
    const minW = 200;
    const minH = 200;
    const w = Math.min(Math.max(vb.w, minW), mapWidth);
    const h = Math.min(Math.max(vb.h, minH), mapHeight);
    const x = Math.min(Math.max(vb.x, 0), Math.max(0, mapWidth - w));
    const y = Math.min(Math.max(vb.y, 0), Math.max(0, mapHeight - h));
    return { x, y, w, h };
  };

  const zoomAtClient = (clientX: number, clientY: number, factor: number) => {
    setView((prev) => {
      const p = getSvgPoint(clientX, clientY);
      const nextW = prev.w * factor;
      const nextH = prev.h * factor;
      const rx = prev.w > 0 ? (p.x - prev.x) / prev.w : 0.5;
      const ry = prev.h > 0 ? (p.y - prev.y) / prev.h : 0.5;
      const next: ViewBox = {
        x: p.x - rx * nextW,
        y: p.y - ry * nextH,
        w: nextW,
        h: nextH,
      };
      return clampView(next);
    });
  };

  const zoomBy = (factor: number) => {
    setView((prev) => {
      const cx = prev.x + prev.w / 2;
      const cy = prev.y + prev.h / 2;
      const nextW = prev.w * factor;
      const nextH = prev.h * factor;
      return clampView({
        x: cx - nextW / 2,
        y: cy - nextH / 2,
        w: nextW,
        h: nextH,
      });
    });
  };

  const resetView = () => {
    setView({ x: 0, y: 0, w: mapWidth, h: mapHeight });
  };

  const beginSidebarResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    sidebarResizeStartRef.current = { x: e.clientX, width: sidebarWidth };
    setResizingSidebar(true);
  };

  useEffect(() => {
    if (!resizingSidebar) return;

    const handleMove = (e: PointerEvent) => {
      const start = sidebarResizeStartRef.current;
      if (!start) return;
      const delta = start.x - e.clientX;
      const maxWidth = Math.max(420, Math.min(900, window.innerWidth - 420));
      const nextWidth = Math.min(Math.max(start.width + delta, 360), maxWidth);
      setSidebarWidth(nextWidth);
    };

    const handleUp = () => {
      setResizingSidebar(false);
      sidebarResizeStartRef.current = null;
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [resizingSidebar]);

  const beginDrag = (e: React.PointerEvent, node: { id: string; label: string | null; zone_id: string | null; x: number; y: number; width: number; height: number }, mode: DragMode) => {
    e.stopPropagation();
    e.preventDefault();

    selectSingleNode(node.id);
    setDraft({
      label: node.label || '',
      zone_id: node.zone_id,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    });

    const startPointer = getSvgPoint(e.clientX, e.clientY);
    setDrag({
      nodeId: node.id,
      mode,
      startPointer,
      startNode: { x: node.x, y: node.y, width: node.width, height: node.height },
    });
  };

  useEffect(() => {
    if (!drag) return;

    const snap = (v: number) => (snapToGrid ? Math.round(v / gridSize) * gridSize : Math.round(v));
    const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

    const handleMove = (e: PointerEvent) => {
      const p = getSvgPoint(e.clientX, e.clientY);
      const dx = p.x - drag.startPointer.x;
      const dy = p.y - drag.startPointer.y;

      setDraft((d) => {
        if (!d) return d;
        if (selectedNodeId !== drag.nodeId) return d;

        if (drag.mode === 'move') {
          const nextX = snap(drag.startNode.x + dx);
          const nextY = snap(drag.startNode.y + dy);
          const maxX = Math.max(0, mapWidth - drag.startNode.width);
          const maxY = Math.max(0, mapHeight - drag.startNode.height);
          return {
            ...d,
            x: clamp(nextX, 0, maxX),
            y: clamp(nextY, 0, maxY),
          };
        }

        // resize_se
        const nextW = snap(drag.startNode.width + dx);
        const nextH = snap(drag.startNode.height + dy);
        const maxW = Math.max(gridSize, mapWidth - drag.startNode.x);
        const maxH = Math.max(gridSize, mapHeight - drag.startNode.y);
        return {
          ...d,
          width: clamp(Math.max(nextW, gridSize), gridSize, maxW),
          height: clamp(Math.max(nextH, gridSize), gridSize, maxH),
        };
      });
    };

    const handleUp = () => {
      setDrag(null);
      // Save immediately on drag end; autosave will also catch any remaining changes.
      window.setTimeout(() => {
        void saveDraftRef.current({ silent: true });
      }, 0);
    };

    window.addEventListener('pointermove', handleMove, { passive: true });
    window.addEventListener('pointerup', handleUp, { passive: true });
    window.addEventListener('pointercancel', handleUp, { passive: true });

    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
  }, [drag, gridSize, mapHeight, mapWidth, selectedNodeId, snapToGrid]);

  // Background interactions: Alt+drag pan, drag box-select (Shift+drag adds).
  const boxSelectActive = !!boxSelect;
  useEffect(() => {
    if (!pan && !boxSelectActive) return;

    const handleMove = (e: PointerEvent) => {
      if (pan) {
        const svg = svgRef.current;
        const rect = svg?.getBoundingClientRect();
        if (rect && rect.width > 0 && rect.height > 0) {
          const scaleX = pan.startView.w / rect.width;
          const scaleY = pan.startView.h / rect.height;
          const dx = (e.clientX - pan.startClient.x) * scaleX;
          const dy = (e.clientY - pan.startClient.y) * scaleY;
          setView(clampView({
            x: pan.startView.x - dx,
            y: pan.startView.y - dy,
            w: pan.startView.w,
            h: pan.startView.h,
          }));
        }
      }

      if (boxSelectActive) {
        setBoxSelect((prev) => {
          if (!prev) return prev;
          const p = getSvgPoint(e.clientX, e.clientY);
          return { ...prev, current: p };
        });
      }
    };

    const finalizeBoxSelection = (box: BoxSelectState) => {
      const minX = Math.min(box.start.x, box.current.x);
      const maxX = Math.max(box.start.x, box.current.x);
      const minY = Math.min(box.start.y, box.current.y);
      const maxY = Math.max(box.start.y, box.current.y);
      const hits: string[] = [];

      for (const n of nodes) {
        const x = n.id === selectedNodeId && draft ? draft.x : n.x;
        const y = n.id === selectedNodeId && draft ? draft.y : n.y;
        const w = n.id === selectedNodeId && draft ? draft.width : n.width;
        const h = n.id === selectedNodeId && draft ? draft.height : n.height;

        const intersects =
          x < maxX &&
          x + w > minX &&
          y < maxY &&
          y + h > minY;
        if (intersects) hits.push(n.id);
      }

      // Best-effort: flush pending edits before switching selection.
      void saveDraftRef.current({ silent: true });

      if (hits.length === 0) {
        if (!box.append) {
          setSelectedNodeId(null);
          setSelectedNodeIds(new Set());
        }
        return;
      }

      if (box.append) {
        setSelectedNodeIds((prev) => {
          const next = new Set(prev);
          for (const id of hits) next.add(id);
          return next;
        });
        setSelectedNodeId((prev) => prev ?? hits[0]);
        return;
      }

      setSelectedNodeIds(new Set(hits));
      setSelectedNodeId(hits[0]);
    };

    const handleUp = () => {
      setPan(null);
      setBoxSelect((prev) => {
        if (prev) finalizeBoxSelection(prev);
        return null;
      });
    };

    window.addEventListener('pointermove', handleMove, { passive: true });
    window.addEventListener('pointerup', handleUp, { passive: true });
    window.addEventListener('pointercancel', handleUp, { passive: true });
    return () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxSelectActive, draft, mapHeight, mapWidth, nodes, pan, selectedNodeId]);

  const defaultNodeSize = { width: 160, height: 100 };

  const suggestNewNodePosition = (index: number) => {
    const padding = Math.max(gridSize * 2, 20);
    const stepX = Math.max(defaultNodeSize.width + gridSize * 2, 180);
    const stepY = Math.max(defaultNodeSize.height + gridSize * 2, 130);
    const maxCols = Math.max(1, Math.floor((mapWidth - padding) / stepX));
    const col = index % maxCols;
    const row = Math.floor(index / maxCols);
    const x = padding + col * stepX;
    const y = padding + row * stepY;

    return {
      x: Math.min(x, Math.max(0, mapWidth - defaultNodeSize.width)),
      y: Math.min(y, Math.max(0, mapHeight - defaultNodeSize.height)),
    };
  };

  const handlePlaceZoneOnMap = async (zoneId: string) => {
    if (!activeMap) return;
    if (zoneIdToNodeId.has(zoneId)) {
      toast({ title: 'Already placed', description: 'That zone already has a block on this map.' });
      return;
    }
    try {
      const { x, y } = suggestNewNodePosition(nodes.length);
      const created = await createNode({
        x,
        y,
        width: defaultNodeSize.width,
        height: defaultNodeSize.height,
        label: null,
        zone_id: zoneId,
        sort_order: nodes.length,
      });
      setSelectedNodeId(created.id);
      setSelectedNodeIds(new Set([created.id]));
      toast({ title: 'Placed', description: 'Zone block added to the map.' });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Place failed', description: 'Failed to place zone block.' });
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 pb-20">
        <div className="flex items-start justify-between gap-3">
          <PageHeader
            primaryText="Map"
            accentText="Builder"
            description={warehouse ? `${warehouse.name} (${warehouse.code})` : 'Build a warehouse map by placing zone blocks.'}
          />

          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button variant="outline" onClick={() => navigate(-1)}>
              <MaterialIcon name="arrow_back" size="sm" className="mr-2" />
              Back
            </Button>
            {warehouseId && (
              <Button variant="outline" asChild>
                <Link to={`/warehouses/${warehouseId}/zones`}>
                  <MaterialIcon name="grid_on" size="sm" className="mr-2" />
                  Zones
                </Link>
              </Button>
            )}
            {warehouseId && (
              <Button variant="outline" asChild>
                <Link to={`/warehouses/${warehouseId}/heatmap`}>
                  <MaterialIcon name="whatshot" size="sm" className="mr-2" />
                  Heat Map
                </Link>
              </Button>
            )}
            <Button variant="outline" onClick={() => setCreateMapOpen(true)}>
              <MaterialIcon name="add" size="sm" className="mr-2" />
              New Map
            </Button>
          </div>
        </div>

        {/* Map selector */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>Maps</CardTitle>
              <CardDescription className="flex items-center gap-2">
                <span>
                  {mapsLoading ? 'Loading…' : `${maps.length} map${maps.length === 1 ? '' : 's'}`}
                </span>
                {activeMap && (
                  <span
                    className={cn(
                      'text-xs flex items-center gap-1.5',
                      mapSaveError ? 'text-destructive' : 'text-muted-foreground'
                    )}
                    title={mapSaveError || undefined}
                  >
                    {mapSaving ? (
                      <>
                        <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                        Saving…
                      </>
                    ) : mapSaveError ? (
                      <>
                        <MaterialIcon name="error" size="sm" />
                        Autosave failed
                      </>
                    ) : isMapDraftDirty ? (
                      <>
                        <MaterialIcon name="edit" size="sm" />
                        Unsaved
                      </>
                    ) : mapLastSavedAt ? (
                      <>
                        <MaterialIcon name="check_circle" size="sm" />
                        Saved
                      </>
                    ) : null}
                  </span>
                )}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={activeMap?.id ?? ''}
                onValueChange={(v) => {
                  clearSelection();
                  setSearchParams((prev) => {
                    const next = new URLSearchParams(prev);
                    next.set('mapId', v);
                    return next;
                  });
                }}
              >
                <SelectTrigger className="w-[260px]">
                  <SelectValue placeholder="Select map" />
                </SelectTrigger>
                <SelectContent>
                  {maps.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}{m.is_default ? ' (Default)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {activeMap && !activeMap.is_default && (
                <Button variant="outline" onClick={handleSetDefault}>
                  Set Default
                </Button>
              )}

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-10 w-10" title="Map actions">
                    <MaterialIcon name="more_horiz" size="sm" />
                    <span className="sr-only">Map actions</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem disabled={!activeMap || duplicatingMap || renamingMap || deletingMap} onClick={openDuplicateMap}>
                    <MaterialIcon name="content_copy" size="sm" className="mr-2" />
                    Duplicate map
                  </DropdownMenuItem>
                  <DropdownMenuItem disabled={!activeMap || renamingMap || duplicatingMap || deletingMap} onClick={openRenameMap}>
                    <MaterialIcon name="edit" size="sm" className="mr-2" />
                    Rename map
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    disabled={!activeMap || deletingMap || duplicatingMap || renamingMap}
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleteMapOpen(true)}
                  >
                    <MaterialIcon name="delete" size="sm" className="mr-2" />
                    Delete map
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </CardHeader>
        </Card>

        {/* Empty state */}
        {!activeMap ? (
          <Card>
            <CardContent className="py-12 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <MaterialIcon name="map" />
              </div>
              <div className="font-medium">No map configured</div>
              <div className="text-sm text-muted-foreground mt-1">
                Create your first map to start placing zone blocks.
              </div>
              <div className="mt-4">
                <Button onClick={() => setCreateMapOpen(true)}>
                  <MaterialIcon name="add" size="sm" className="mr-2" />
                  Create Map
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="flex items-start gap-2">
            {/* Canvas */}
            <div className="min-w-0 flex-1">
            <Card>
              <CardHeader className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{activeMap.name}</CardTitle>
                  <CardDescription>
                    {nodesLoading ? 'Loading blocks…' : `${nodes.length} block${nodes.length === 1 ? '' : 's'}`}
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => zoomBy(1.25)}
                    title="Zoom out"
                  >
                    <MaterialIcon name="zoom_out" size="sm" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => zoomBy(0.8)}
                    title="Zoom in"
                  >
                    <MaterialIcon name="zoom_in" size="sm" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    onClick={resetView}
                    title="Reset view"
                  >
                    <MaterialIcon name="center_focus_strong" size="sm" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    onClick={copySelection}
                    disabled={selectedCount === 0}
                    title="Copy selection (Ctrl/Cmd+C)"
                  >
                    <MaterialIcon name="content_copy" size="sm" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    onClick={() => void pasteClipboard()}
                    disabled={!clipboard || pasting}
                    title="Paste (Ctrl/Cmd+V)"
                  >
                    {pasting ? (
                      <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                    ) : (
                      <MaterialIcon name="content_paste" size="sm" />
                    )}
                  </Button>
                  <Button
                    variant={snapToGrid ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => setSnapToGrid((v) => !v)}
                    title="Toggle snap-to-grid while dragging"
                  >
                    <MaterialIcon name="grid_on" size="sm" />
                    Snap
                  </Button>
                  <Button
                    variant={autoLabelEnabled ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => setAutoLabelEnabled((v) => !v)}
                    title="Toggle zone code labels (zone aliases still show)"
                  >
                    <MaterialIcon name="label" size="sm" />
                    Zone Labels
                  </Button>
                  <Button
                    variant={showGroupLabels ? 'secondary' : 'outline'}
                    size="sm"
                    onClick={() => setShowGroupLabels((v) => !v)}
                    title="Toggle zone group labels"
                  >
                    <MaterialIcon name="layers" size="sm" />
                    Zone Groups
                  </Button>
                  <Button variant="outline" onClick={handleAddNode}>
                    <MaterialIcon name="crop_square" size="sm" className="mr-2" />
                    Add Zone Block
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="w-full overflow-auto rounded border bg-background">
                  <svg
                    ref={svgRef}
                    viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
                    preserveAspectRatio="none"
                    className="h-[520px] w-full"
                    onPointerMove={(e) => {
                      lastPointerSvgRef.current = getSvgPoint(e.clientX, e.clientY);
                    }}
                    onClick={() => {
                      if (suppressNextClickRef.current) {
                        suppressNextClickRef.current = false;
                        return;
                      }
                      clearSelection();
                    }}
                    onPointerDown={(e) => {
                      // Background-only: nodes stopPropagation in their handlers.
                      if (e.button !== 0) return;
                      if (e.altKey) {
                        e.preventDefault();
                        suppressNextClickRef.current = true;
                        setPan({ startClient: { x: e.clientX, y: e.clientY }, startView: view });
                        return;
                      }
                      e.preventDefault();
                      suppressNextClickRef.current = true;
                      const p = getSvgPoint(e.clientX, e.clientY);
                      setBoxSelect({ start: p, current: p, append: e.shiftKey });
                    }}
                    onWheel={(e) => {
                      // Zoom with Ctrl/trackpad pinch (prevents accidental zoom while scrolling).
                      if (!e.ctrlKey && !e.metaKey) return;
                      e.preventDefault();
                      const factor = e.deltaY < 0 ? 0.9 : 1.1;
                      zoomAtClient(e.clientX, e.clientY, factor);
                    }}
                  >
                    <defs>
                      <pattern id="hmv-grid" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse">
                        <path
                          d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
                          fill="none"
                          stroke="rgba(148,163,184,0.35)"
                          strokeWidth="1"
                        />
                      </pattern>
                    </defs>
                    <rect x="0" y="0" width={mapWidth} height={mapHeight} fill="url(#hmv-grid)" />

                    {/* Group labels (computed from node group_label) */}
                    {showGroupLabels && groupBoxes.map((g) => (
                      <text
                        key={g.label}
                        x={g.minX}
                        y={Math.max(g.minY - 8, 18)}
                        fontSize="16"
                        fill="rgba(15,23,42,0.7)"
                        stroke="rgba(255,255,255,0.9)"
                        strokeWidth={3}
                        paintOrder="stroke"
                      >
                        {g.label}
                      </text>
                    ))}

                    {nodes.map((n) => {
                      const isActive = n.id === selectedNodeId;
                      const isSelected = selectedNodeIds.has(n.id);
                      const renderNode = isActive && draft
                        ? {
                            ...n,
                            x: draft.x,
                            y: draft.y,
                            width: draft.width,
                            height: draft.height,
                            zone_id: draft.zone_id,
                            label: draft.label?.trim() ? draft.label.trim() : null,
                          }
                        : n;

                      const zoneCode = renderNode.zone_id ? zoneById.get(renderNode.zone_id)?.zone_code : null;
                      const label = (autoLabelEnabled ? (renderNode.label || zoneCode || '') : (renderNode.label || '')).trim();

                      const nodeForDrag = {
                        id: renderNode.id,
                        label: renderNode.label,
                        zone_id: renderNode.zone_id,
                        x: renderNode.x,
                        y: renderNode.y,
                        width: renderNode.width,
                        height: renderNode.height,
                      };

                      return (
                        <g key={n.id} onClick={(e) => e.stopPropagation()}>
                          <rect
                            x={renderNode.x}
                            y={renderNode.y}
                            width={renderNode.width}
                            height={renderNode.height}
                            fill={isSelected ? 'rgba(59,130,246,0.10)' : 'rgba(15,23,42,0.03)'}
                            stroke={
                              isActive
                                ? 'rgba(59,130,246,0.9)'
                                : isSelected
                                  ? 'rgba(59,130,246,0.55)'
                                  : 'rgba(100,116,139,0.7)'
                            }
                            strokeWidth={isActive || isSelected ? 2 : 1}
                            className={cn(isActive && selectedCount === 1 ? 'cursor-move' : 'cursor-pointer')}
                            onPointerDown={(e) => {
                              if (e.shiftKey) {
                                e.stopPropagation();
                                e.preventDefault();
                                if (isActive && draft && isDraftDirty) {
                                  void saveDraftRef.current({ silent: true });
                                }
                                toggleNodeSelected(renderNode.id);
                                return;
                              }
                              beginDrag(e, nodeForDrag, 'move');
                            }}
                          />
                          {isActive && selectedCount === 1 && (
                            <rect
                              x={renderNode.x + renderNode.width - 12}
                              y={renderNode.y + renderNode.height - 12}
                              width={12}
                              height={12}
                              rx={2}
                              fill="rgba(59,130,246,0.9)"
                              stroke="rgba(255,255,255,0.9)"
                              strokeWidth={1}
                              className="cursor-nwse-resize"
                              onPointerDown={(e) => beginDrag(e, nodeForDrag, 'resize_se')}
                            />
                          )}
                          {label && (
                            <text
                              x={renderNode.x + 8}
                              y={renderNode.y + 18}
                              fontSize="14"
                              fill="rgba(15,23,42,0.75)"
                            >
                              {label}
                            </text>
                          )}
                        </g>
                      );
                    })}

                    {boxSelect && (
                      <rect
                        x={Math.min(boxSelect.start.x, boxSelect.current.x)}
                        y={Math.min(boxSelect.start.y, boxSelect.current.y)}
                        width={Math.abs(boxSelect.current.x - boxSelect.start.x)}
                        height={Math.abs(boxSelect.current.y - boxSelect.start.y)}
                        fill="rgba(59,130,246,0.12)"
                        stroke="rgba(59,130,246,0.7)"
                        strokeWidth={1}
                        pointerEvents="none"
                      />
                    )}
                  </svg>
                </div>
              </CardContent>
            </Card>
            </div>

            <div
              role="separator"
              aria-orientation="vertical"
              title="Drag to resize preferences panel"
              className={cn(
                'hidden lg:flex w-1 self-stretch rounded bg-border/80 hover:bg-primary/30 cursor-col-resize',
                resizingSidebar ? 'bg-primary/40' : ''
              )}
              onPointerDown={beginSidebarResize}
            />

            {/* Sidebar */}
            <div className="w-full lg:shrink-0" style={{ width: `min(${sidebarWidth}px, 70vw)` }}>
            <Card>
              <CardHeader className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">Preferences</CardTitle>
                    <CardDescription>
                      {preferencesMode === 'setup'
                        ? 'Bulk configure zone links, zone aliases, and zone groups.'
                        : preferencesMode === 'review'
                          ? 'Review setup coverage before publishing map changes.'
                          : selectedCount === 0
                            ? 'No blocks selected.'
                            : selectedCount === 1
                              ? '1 block selected.'
                              : `${selectedCount} blocks selected.`}
                    </CardDescription>
                  </div>
                  {preferencesMode === 'editor' && selectedCount === 1 && selectedNode && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleManualSave}
                        disabled={autoSaving || !draft}
                        title="Save selected block"
                      >
                        <MaterialIcon name="save" size="sm" className="mr-2" />
                        Save
                      </Button>
                      <div
                        className={cn(
                          'text-xs flex items-center gap-1.5',
                          autoSaveError ? 'text-destructive' : 'text-muted-foreground'
                        )}
                        title={autoSaveError || undefined}
                      >
                        {autoSaving ? (
                          <>
                            <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                            Saving…
                          </>
                        ) : autoSaveError ? (
                          <>
                            <MaterialIcon name="error" size="sm" />
                            Autosave failed
                          </>
                        ) : isDraftDirty ? (
                          <>
                            <MaterialIcon name="edit" size="sm" />
                            Unsaved
                          </>
                        ) : lastSavedAt ? (
                          <>
                            <MaterialIcon name="check_circle" size="sm" />
                            Saved
                          </>
                        ) : null}
                      </div>
                    </div>
                  )}
                  {preferencesMode === 'setup' && (
                    <div className="flex flex-col items-end gap-2">
                      <div className={cn('text-xs', hasStagedChanges ? 'text-amber-600' : 'text-muted-foreground')}>
                        {hasStagedChanges
                          ? `Staged: locations ${pendingLocationZoneUpdates.size}, aliases ${pendingNodeAliasUpdates.size}, groups ${pendingNodeGroupUpdates.size}`
                          : 'No staged changes'}
                      </div>
                      <Button
                        size="sm"
                        onClick={() => void saveStagedSetupChanges()}
                        disabled={setupSaving || !hasStagedChanges}
                      >
                        {setupSaving ? 'Saving…' : 'Save'}
                      </Button>
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant={preferencesMode === 'setup' ? 'secondary' : 'outline'}
                    onClick={() => setPreferencesMode('setup')}
                  >
                    Setup
                  </Button>
                  <Button
                    size="sm"
                    variant={preferencesMode === 'review' ? 'secondary' : 'outline'}
                    onClick={() => setPreferencesMode('review')}
                  >
                    Review Coverage
                  </Button>
                  <Button
                    size="sm"
                    variant={preferencesMode === 'editor' ? 'secondary' : 'outline'}
                    onClick={() => setPreferencesMode('editor')}
                  >
                    Box Editor
                  </Button>
                </div>

                {preferencesMode === 'editor' && (
                  <div className="flex items-center gap-2">
                    <Select value={sidebarSection} onValueChange={(v) => setSidebarSection(v as SidebarSection)}>
                      <SelectTrigger className="h-8 w-[180px] text-xs">
                        <SelectValue placeholder="Section" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="properties">Properties</SelectItem>
                        <SelectItem value="zones">Zones + Create</SelectItem>
                        <SelectItem value="alias">Zone Alias (Box Text)</SelectItem>
                        <SelectItem value="groups">Zone Groups</SelectItem>
                      </SelectContent>
                    </Select>
                    {selectedCount > 1 && (
                      <div className="text-xs text-muted-foreground">Shift+click to adjust selection</div>
                    )}
                  </div>
                )}

                <div className="rounded-md border bg-muted/30 p-2 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">Zone Alias</span> = text shown inside a single box.
                  {' '}
                  <span className="font-medium text-foreground">Zone Group</span> = shared tag for many boxes.
                  {' '}
                  <span className="font-medium text-foreground">Zone Labels</span> toggles zone codes when zone alias is blank.
                </div>
              </CardHeader>

              <CardContent>
                {preferencesMode === 'setup' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 gap-3 xl:grid-cols-4">
                      <div className="rounded-md border p-2 min-h-[220px] flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Zone</Label>
                          <HelpTip
                            tooltip="Filter and select one zone to link locations or assign zone alias. Select multiple zones to stage zone group assignment."
                            pageKey="warehouses.map_builder"
                            fieldKey="zone_selection"
                          />
                        </div>
                        <Input
                          className="h-8"
                          placeholder="Zone"
                          value={setupZoneQuery}
                          onChange={(e) => setSetupZoneQuery(e.target.value)}
                        />
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => setSetupSelectedZoneIds(new Set(setupFilteredZones.map((z) => z.id)))}
                          >
                            Select filtered
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => setSetupSelectedZoneIds(new Set())}
                          >
                            Clear
                          </Button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-auto space-y-1 pr-1">
                          {setupFilteredZones.map((z) => {
                            const checked = setupSelectedZoneIds.has(z.id);
                            return (
                              <label key={z.id} className="flex items-start gap-2 rounded border px-2 py-1 text-xs cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleSetupZone(z.id)}
                                  className="mt-0.5"
                                />
                                <span className="min-w-0">
                                  <span className="block font-mono truncate">{z.zone_code}</span>
                                  <span className="block text-muted-foreground truncate">
                                    {locationCountByZoneId.get(z.id) || 0} location{(locationCountByZoneId.get(z.id) || 0) === 1 ? '' : 's'}
                                    {' · '}
                                    alias: {effectiveZoneAliasByZoneId.get(z.id) || '—'}
                                    {' · '}
                                    group: {effectiveZoneGroupByZoneId.get(z.id) || '—'}
                                  </span>
                                </span>
                              </label>
                            );
                          })}
                          {setupFilteredZones.length === 0 && (
                            <div className="text-xs text-muted-foreground py-2">No zones match filter.</div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-md border p-2 min-h-[220px] flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Location</Label>
                          <HelpTip
                            tooltip="Type to filter locations (for example A1). Select filtered locations, then stage them into the selected zone."
                            pageKey="warehouses.map_builder"
                            fieldKey="location_staging"
                          />
                        </div>
                        <Input
                          className="h-8"
                          placeholder="Location"
                          value={setupLocationQuery}
                          onChange={(e) => setSetupLocationQuery(e.target.value)}
                        />
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => setSetupSelectedLocationIds(new Set(setupFilteredLocations.map((l) => l.id)))}
                            disabled={locationsLoading}
                          >
                            Select filtered
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => setSetupSelectedLocationIds(new Set())}
                          >
                            Clear
                          </Button>
                        </div>
                        <div className="min-h-0 flex-1 overflow-auto space-y-1 pr-1">
                          {setupFilteredLocations.map((loc) => {
                            const checked = setupSelectedLocationIds.has(loc.id);
                            const zoneId = effectiveLocationZoneId(loc);
                            const zoneCode = zoneId ? zoneById.get(zoneId)?.zone_code || 'Unknown' : 'Unassigned';
                            return (
                              <label key={loc.id} className="flex items-start gap-2 rounded border px-2 py-1 text-xs cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleSetupLocation(loc.id)}
                                  className="mt-0.5"
                                />
                                <span className="min-w-0">
                                  <span className="block font-mono truncate">{loc.code}</span>
                                  <span className="block text-muted-foreground truncate">{zoneCode}</span>
                                </span>
                              </label>
                            );
                          })}
                          {setupFilteredLocations.length === 0 && (
                            <div className="text-xs text-muted-foreground py-2">No locations match filter.</div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-md border p-2 min-h-[220px] flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Zone Alias</Label>
                          <HelpTip
                            tooltip="Zone alias is the text shown inside the zone block. Select one zone, then stage alias value and save."
                            pageKey="warehouses.map_builder"
                            fieldKey="zone_alias"
                          />
                        </div>
                        <Input
                          className="h-8"
                          placeholder="Zone Alias"
                          value={setupAliasQuery}
                          onChange={(e) => setSetupAliasQuery(e.target.value)}
                        />
                        <Input
                          className="h-8"
                          placeholder="Custom zone alias"
                          value={customAliasTarget}
                          onChange={(e) => setCustomAliasTarget(e.target.value)}
                        />
                        <div className="min-h-0 flex-1 overflow-auto space-y-1 pr-1">
                          {setupFilteredAliasOptions.map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => {
                                setSetupAliasTarget(opt);
                                setCustomAliasTarget('');
                              }}
                              className={cn(
                                'w-full text-left rounded border px-2 py-1 text-xs',
                                setupAliasTarget === opt && !customAliasTarget ? 'border-primary bg-primary/5' : ''
                              )}
                            >
                              {opt}
                            </button>
                          ))}
                          {setupFilteredAliasOptions.length === 0 && (
                            <div className="text-xs text-muted-foreground py-2">No existing aliases match filter.</div>
                          )}
                        </div>
                      </div>

                      <div className="rounded-md border p-2 min-h-[220px] flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <Label className="text-xs">Zone Group</Label>
                          <HelpTip
                            tooltip="Zone group is a shared tag across many zone blocks. Select one or more zones, choose group value, then stage and save."
                            pageKey="warehouses.map_builder"
                            fieldKey="zone_group"
                          />
                        </div>
                        <Input
                          className="h-8"
                          placeholder="Zone Group"
                          value={setupGroupQuery}
                          onChange={(e) => setSetupGroupQuery(e.target.value)}
                        />
                        <Input
                          className="h-8"
                          placeholder="Custom zone group"
                          value={customGroupTarget}
                          onChange={(e) => setCustomGroupTarget(e.target.value)}
                        />
                        <div className="min-h-0 flex-1 overflow-auto space-y-1 pr-1">
                          {setupFilteredGroupOptions.map((opt) => (
                            <button
                              key={opt}
                              type="button"
                              onClick={() => {
                                setSetupGroupTarget(opt);
                                setCustomGroupTarget('');
                              }}
                              className={cn(
                                'w-full text-left rounded border px-2 py-1 text-xs',
                                setupGroupTarget === opt && !customGroupTarget ? 'border-primary bg-primary/5' : ''
                              )}
                            >
                              {opt}
                            </button>
                          ))}
                          {setupFilteredGroupOptions.length === 0 && (
                            <div className="text-xs text-muted-foreground py-2">No existing zone groups match filter.</div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="rounded-md border p-2 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" onClick={stageLocationsToSelectedZone} disabled={setupSaving}>
                          Stage selected locations → {setupSelectedZoneCode || 'selected zone'}
                        </Button>
                        <Button size="sm" variant="outline" onClick={stageZoneAlias} disabled={setupSaving}>
                          Stage zone alias
                        </Button>
                        <Button size="sm" variant="outline" onClick={stageZoneGroup} disabled={setupSaving}>
                          Stage zone group
                        </Button>
                        <Button size="sm" variant="ghost" onClick={clearStagedSetupChanges} disabled={setupSaving || !hasStagedChanges}>
                          Clear staged
                        </Button>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Workflow: filter and select rows in each column, stage one or more configuration actions, then click Save.
                      </div>
                    </div>
                  </div>
                )}

                {preferencesMode === 'review' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="rounded-md border p-2"><span className="text-muted-foreground">Total zones:</span> {reviewMetrics.totalZones}</div>
                      <div className="rounded-md border p-2"><span className="text-muted-foreground">Placed:</span> {reviewMetrics.placedZones}</div>
                      <div className="rounded-md border p-2"><span className="text-muted-foreground">With zone alias:</span> {reviewMetrics.aliasedZones}</div>
                      <div className="rounded-md border p-2"><span className="text-muted-foreground">With zone group:</span> {reviewMetrics.groupedZones}</div>
                      <div className="rounded-md border p-2 col-span-2"><span className="text-muted-foreground">Zones with linked locations:</span> {reviewMetrics.zonesWithLocations}</div>
                    </div>

                    <div className="rounded-md border">
                      <div className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 px-2 py-1 text-[11px] font-medium border-b bg-muted/40">
                        <div>Zone</div>
                        <div>Placed</div>
                        <div>Zone Alias</div>
                        <div>Zone Group</div>
                        <div>Locations</div>
                      </div>
                      <div className="max-h-[340px] overflow-auto">
                        {reviewRows.map((r) => (
                          <div key={r.zoneId} className="grid grid-cols-[1fr_auto_auto_auto_auto] gap-2 px-2 py-1 text-xs border-b last:border-b-0">
                            <div className="font-mono">{r.zoneCode}</div>
                            <div>{r.placed ? 'Yes' : 'No'}</div>
                            <div className={cn(r.alias ? '' : 'text-muted-foreground')}>{r.alias || '—'}</div>
                            <div className={cn(r.group ? '' : 'text-muted-foreground')}>{r.group || '—'}</div>
                            <div>{r.locationCount}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {preferencesMode === 'editor' && (
                  <>
                {sidebarSection === 'properties' && (
                  <div className="space-y-4">
                    {selectedCount === 0 ? (
                      <div className="text-sm text-muted-foreground">
                        Select a zone block to edit geometry. Tip: drag on the canvas to highlight; Shift+drag adds to selection.
                      </div>
                    ) : selectedCount > 1 ? (
                      <div className="text-sm text-muted-foreground">
                        Geometry editing is only available for a single selection.
                      </div>
                    ) : !selectedNode || !draft ? (
                      <div className="text-sm text-muted-foreground">Loading selection…</div>
                    ) : (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label>X</Label>
                            <Input
                              type="number"
                              value={draft.x}
                              onChange={(e) => setDraft((d) => (d ? { ...d, x: Number(e.target.value) || 0 } : d))}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Y</Label>
                            <Input
                              type="number"
                              value={draft.y}
                              onChange={(e) => setDraft((d) => (d ? { ...d, y: Number(e.target.value) || 0 } : d))}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Width</Label>
                            <Input
                              type="number"
                              value={draft.width}
                              onChange={(e) => setDraft((d) => (d ? { ...d, width: Math.max(Number(e.target.value) || 0, 1) } : d))}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>Height</Label>
                            <Input
                              type="number"
                              value={draft.height}
                              onChange={(e) => setDraft((d) => (d ? { ...d, height: Math.max(Number(e.target.value) || 0, 1) } : d))}
                            />
                          </div>
                        </div>

                        <div className="flex items-center gap-2 pt-2">
                          <Button
                            onClick={handleManualSave}
                            className="flex-1"
                            disabled={autoSaving}
                          >
                            {autoSaving ? (
                              <>
                                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                                Saving…
                              </>
                            ) : (
                              'Save'
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            className="text-destructive"
                            onClick={async () => {
                              try {
                                await deleteNode(selectedNode.id);
                                clearSelection();
                                toast({ title: 'Deleted', description: 'Block removed.' });
                              } catch (err) {
                                console.error(err);
                                toast({ variant: 'destructive', title: 'Delete failed', description: 'Failed to delete block.' });
                              }
                            }}
                          >
                            Delete
                          </Button>
                        </div>

                        <div className="text-xs text-muted-foreground">
                          Tip: Ctrl/Cmd+C copies, Ctrl/Cmd+V pastes (unassigned), Ctrl/Cmd+D duplicates the active block (unassigned).
                        </div>
                      </>
                    )}
                  </div>
                )}

                {sidebarSection === 'zones' && (
                  <div className="space-y-4">
                    <div className="space-y-2 rounded-md border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Label>Create zone</Label>
                        <div className="text-xs text-muted-foreground">{zones.length} total</div>
                      </div>
                      <div className="grid grid-cols-1 gap-2">
                        <Input
                          value={inlineZoneCode}
                          onChange={(e) => setInlineZoneCode(e.target.value)}
                          placeholder="Zone code (e.g. ZN-006)"
                          disabled={inlineZoneSaving}
                        />
                        <Input
                          value={inlineZoneDescription}
                          onChange={(e) => setInlineZoneDescription(e.target.value)}
                          placeholder="Description (optional)"
                          disabled={inlineZoneSaving}
                        />
                        <Button onClick={() => void handleCreateZoneInline()} disabled={inlineZoneSaving}>
                          {inlineZoneSaving ? (
                            <>
                              <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                              Creating…
                            </>
                          ) : (
                            <>
                              <MaterialIcon name="add" size="sm" className="mr-2" />
                              Create Zone
                            </>
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>Search zones</Label>
                      <Input
                        value={zoneSearch}
                        onChange={(e) => setZoneSearch(e.target.value)}
                        placeholder="ZN-001, Overflow…"
                      />
                    </div>

                    {selectedCount === 1 && selectedNode && draft && (
                      <div className="space-y-2">
                        <Label>Selected block zone</Label>
                        <Select
                          value={draft.zone_id ?? UNASSIGNED_ZONE_VALUE}
                          onValueChange={(v) =>
                            setDraft((d) => (d ? { ...d, zone_id: v === UNASSIGNED_ZONE_VALUE ? null : v } : d))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Unassigned" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={UNASSIGNED_ZONE_VALUE}>Unassigned</SelectItem>
                            {zones.map((z) => {
                              const usedByNodeId = zoneIdToNodeId.get(z.id);
                              const disabled = !!usedByNodeId && usedByNodeId !== selectedNode.id;
                              return (
                                <SelectItem key={z.id} value={z.id} disabled={disabled}>
                                  {z.zone_code}{disabled ? ' (already placed)' : ''}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground">
                          One block per zone (you can unassign a zone to move it).
                        </p>
                      </div>
                    )}

                    {selectedCount > 1 && (
                      <div className="text-sm text-muted-foreground">
                        Select a single block to assign a Zone.
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Unplaced zones</Label>
                        <div className="text-xs text-muted-foreground">{unplacedZones.length}</div>
                      </div>
                      {unplacedZones.length === 0 ? (
                        <div className="text-sm text-muted-foreground">All zones are placed on this map.</div>
                      ) : (
                        <div className="max-h-56 overflow-auto space-y-1 pr-1">
                          {unplacedZones.slice(0, 60).map((z) => (
                            <div
                              key={z.id}
                              className="flex items-center justify-between gap-2 rounded border px-2 py-1.5"
                            >
                              <div className="min-w-0">
                                <div className="font-mono text-xs truncate">{z.zone_code}</div>
                                {z.description && (
                                  <div className="text-[11px] text-muted-foreground truncate">{z.description}</div>
                                )}
                              </div>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void handlePlaceZoneOnMap(z.id)}
                              >
                                Place
                              </Button>
                            </div>
                          ))}
                          {unplacedZones.length > 60 && (
                            <div className="text-xs text-muted-foreground py-1">
                              Showing first 60 — use search to find a specific zone.
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Placed zones</Label>
                        <div className="text-xs text-muted-foreground">{placedZones.length}</div>
                      </div>
                      {placedZones.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No zones placed yet.</div>
                      ) : (
                        <div className="max-h-40 overflow-auto space-y-1 pr-1">
                          {placedZones.slice(0, 40).map((z) => {
                            const nodeId = zoneIdToNodeId.get(z.id);
                            return (
                              <div
                                key={z.id}
                                className="flex items-center justify-between gap-2 rounded border px-2 py-1.5"
                              >
                                <div className="min-w-0">
                                  <div className="font-mono text-xs truncate">{z.zone_code}</div>
                                  {z.description && (
                                    <div className="text-[11px] text-muted-foreground truncate">{z.description}</div>
                                  )}
                                </div>
                                {nodeId && (
                                  <Button size="sm" variant="outline" onClick={() => selectSingleNode(nodeId)}>
                                    Select
                                  </Button>
                                )}
                              </div>
                            );
                          })}
                          {placedZones.length > 40 && (
                            <div className="text-xs text-muted-foreground py-1">
                              Showing first 40 — use search to find a specific zone.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {sidebarSection === 'alias' && (
                  <div className="space-y-4">
                    {selectedCount === 0 ? (
                      <div className="text-sm text-muted-foreground">
                        Select one or more zone blocks, then apply a zone alias to the selection.
                      </div>
                    ) : (
                      <>
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label>Zone Alias (optional)</Label>
                            <div className="text-xs text-muted-foreground">
                              {selectedCount} selected
                            </div>
                          </div>
                          <Input
                            value={aliasDraft}
                            onChange={(e) => setAliasDraft(e.target.value)}
                            placeholder="Shown inside selected zone block(s)"
                            disabled={aliasSaving}
                          />
                          <p className="text-xs text-muted-foreground">
                            Zone alias is per box. If zone alias is empty, the map falls back to the zone code when Zone Labels is enabled.
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button onClick={() => void setAliasForSelection(aliasDraft)} disabled={aliasSaving}>
                            {aliasSaving ? (
                              <>
                                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                                Applying…
                              </>
                            ) : (
                              'Apply to selection'
                            )}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void setAliasForSelection(null)}
                            disabled={aliasSaving}
                          >
                            Clear zone alias
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {sidebarSection === 'groups' && (
                  <div className="space-y-4">
                    <div className="text-xs text-muted-foreground">
                      Zone groups are user-defined collections (rows, sections, overflow, etc.). Drag to highlight boxes; use Shift+drag to add.
                    </div>

                    <div className="space-y-2">
                      <Label>Zone group label</Label>
                      <Input
                        value={groupLabelDraft}
                        onChange={(e) => setGroupLabelDraft(e.target.value)}
                        placeholder="Row A, Overflow, Dock…"
                      />
                      <div className="flex items-center gap-2">
                        <Button
                          onClick={() => void setGroupLabelForSelection(groupLabelDraft)}
                          disabled={selectedCount === 0 || groupSaving}
                        >
                          Apply to selection
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => void setGroupLabelForSelection(null)}
                          disabled={selectedCount === 0 || groupSaving}
                        >
                          Clear
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label>Existing zone groups</Label>
                        <div className="text-xs text-muted-foreground">{groupBoxes.length}</div>
                      </div>
                      {groupBoxes.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No zone groups yet.</div>
                      ) : (
                        <div className="max-h-56 overflow-auto space-y-1 pr-1">
                          {groupBoxes.map((g) => (
                            <div
                              key={g.label}
                              className="flex items-center justify-between gap-2 rounded border px-2 py-1.5"
                            >
                              <button
                                type="button"
                                className="min-w-0 text-left"
                                onClick={() => setGroupLabelDraft(g.label)}
                                title="Click to use this label"
                              >
                                <div className="text-sm font-medium truncate">{g.label}</div>
                                <div className="text-xs text-muted-foreground">
                                  {g.count} block{g.count === 1 ? '' : 's'}
                                </div>
                              </button>
                              <Button size="sm" variant="outline" onClick={() => selectNodesByGroup(g.label)}>
                                Select
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
                  </>
                )}
              </CardContent>
            </Card>
            </div>
          </div>
        )}
      </div>

      {/* Create map dialog */}
      <Dialog
        open={createMapOpen}
        onOpenChange={(open) => {
          setCreateMapOpen(open);
          if (!open) {
            setNewMapName('');
            setCreateMapMakeDefault(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Map</DialogTitle>
            <DialogDescription>
              Create a warehouse map template. The first map is automatically set as Default.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Map name *</Label>
            <Input value={newMapName} onChange={(e) => setNewMapName(e.target.value)} placeholder="Main Warehouse Layout" />
          </div>
          {maps.length > 0 && (
            <div className="flex items-center justify-between rounded border px-3 py-2">
              <div className="min-w-0 pr-3">
                <div className="text-sm font-medium">Make default</div>
                <div className="text-xs text-muted-foreground">Sets this map as the warehouse Default Map.</div>
              </div>
              <Switch
                checked={createMapMakeDefault}
                onCheckedChange={(v) => setCreateMapMakeDefault(!!v)}
                disabled={creatingMap}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateMapOpen(false)} disabled={creatingMap}>
              Cancel
            </Button>
            <Button onClick={handleCreateMap} disabled={creatingMap}>
              {creatingMap ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename map dialog */}
      <Dialog open={renameMapOpen} onOpenChange={setRenameMapOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Map</DialogTitle>
            <DialogDescription>Update the map template name.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Map name *</Label>
            <Input value={renameMapName} onChange={(e) => setRenameMapName(e.target.value)} placeholder="Main Warehouse Layout" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameMapOpen(false)} disabled={renamingMap}>
              Cancel
            </Button>
            <Button onClick={handleRenameMap} disabled={renamingMap}>
              {renamingMap ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate map dialog */}
      <Dialog open={duplicateMapOpen} onOpenChange={setDuplicateMapOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Duplicate Map</DialogTitle>
            <DialogDescription>
              Create a copy of this map (zone groups + zone aliases are copied). The warehouse Default Map will not change unless you set it manually.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>New map name *</Label>
            <Input value={duplicateMapName} onChange={(e) => setDuplicateMapName(e.target.value)} placeholder="Main Warehouse Layout (Copy)" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDuplicateMapOpen(false)} disabled={duplicatingMap}>
              Cancel
            </Button>
            <Button onClick={handleDuplicateMap} disabled={duplicatingMap || nodesLoading}>
              {duplicatingMap ? 'Duplicating…' : 'Duplicate'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete map confirm */}
      <AlertDialog open={deleteMapOpen} onOpenChange={setDeleteMapOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Map</AlertDialogTitle>
            <AlertDialogDescription>
              Delete <strong>{activeMap?.name}</strong>? This cannot be undone. If this map is the Default, you must set another map as Default before deleting (unless it is the last map).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingMap}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={deletingMap}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteMap}
            >
              {deletingMap ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DashboardLayout>
  );
}

