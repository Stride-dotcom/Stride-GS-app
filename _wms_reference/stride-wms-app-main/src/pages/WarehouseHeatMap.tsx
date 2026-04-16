import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { formatTime, getHeatFill } from '@/lib/heatMapUtils';
import { useWarehouses } from '@/hooks/useWarehouses';
import { useWarehouseMaps } from '@/hooks/useWarehouseMaps';
import { useWarehouseMapZoneCapacity } from '@/hooks/useWarehouseMapZoneCapacity';
import { useWarehouseMapLocationCapacity } from '@/hooks/useWarehouseMapLocationCapacity';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/hooks/use-toast';

export default function WarehouseHeatMap() {
  const navigate = useNavigate();
  const { warehouseId } = useParams<{ warehouseId: string }>();
  const { hasRole } = usePermissions();
  const canBuild = hasRole('admin') || hasRole('manager');
  const { toast } = useToast();

  const formatCuFt = (v: number | null) => {
    if (v === null || v === undefined) return '—';
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    return `${Math.round(n).toLocaleString()} cu ft`;
  };

  const { warehouses } = useWarehouses();
  const warehouse = useMemo(
    () => warehouses.find((w) => w.id === warehouseId) || null,
    [warehouses, warehouseId]
  );

  const { maps, loading: mapsLoading, getDefaultMap, setDefaultMap } = useWarehouseMaps(warehouseId);
  const defaultMap = getDefaultMap();

  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);

  const {
    rows: zoneRows,
    loading: zonesLoading,
    lastRefreshedAt: zonesRefreshedAt,
    refetch: refetchZones,
  } = useWarehouseMapZoneCapacity(defaultMap?.id);

  const {
    rows: locationRows,
    loading: locationsLoading,
    lastRefreshedAt: locationsRefreshedAt,
    refetch: refetchLocations,
  } = useWarehouseMapLocationCapacity(defaultMap?.id, selectedZoneId);

  const mapWidth = defaultMap?.width ?? 2000;
  const mapHeight = defaultMap?.height ?? 1200;
  const selectedZoneRow = useMemo(
    () => zoneRows.find((r) => r.zone_id && r.zone_id === selectedZoneId) || null,
    [selectedZoneId, zoneRows]
  );

  const [showOnlyAvailable, setShowOnlyAvailable] = useState(false);
  const selectedZoneLocations = useMemo(() => {
    if (!selectedZoneId) return [];
    const all = locationRows;
    const filtered = showOnlyAvailable
      ? all.filter((r) => r.utilization_pct !== null && r.utilization_pct < 80)
      : all;
    return [...filtered].sort((a, b) => {
      const ua = a.utilization_pct ?? -1;
      const ub = b.utilization_pct ?? -1;
      return ub - ua;
    });
  }, [locationRows, selectedZoneId, showOnlyAvailable]);

  const lastRefreshedAt = zonesRefreshedAt || locationsRefreshedAt;

  const handleRefresh = async () => {
    // Refresh zone-level colors; refresh drill-down only if a zone is selected.
    await refetchZones();
    if (selectedZoneId) {
      await refetchLocations();
    }
  };

  const missingDefault = !mapsLoading && maps.length > 0 && !defaultMap;
  const [settingDefault, setSettingDefault] = useState(false);

  const handleSetMostRecentAsDefault = async () => {
    if (!canBuild) return;
    if (settingDefault) return;
    if (maps.length === 0) return;

    try {
      setSettingDefault(true);
      await setDefaultMap(maps[0].id);
      toast({ title: 'Default map set', description: 'Heat map will now use the default map.' });
    } catch (err) {
      console.error(err);
      toast({ variant: 'destructive', title: 'Set default failed', description: 'Failed to set a default map.' });
    } finally {
      setSettingDefault(false);
    }
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 pb-20">
        <div className="flex items-start justify-between gap-3">
          <PageHeader
            primaryText="Heat"
            accentText="Map"
            description={warehouse ? `${warehouse.name} (${warehouse.code})` : 'Zone utilization overview'}
          />
          <div className="flex items-center gap-2 flex-wrap justify-end">
            <Button variant="outline" onClick={() => navigate(-1)}>
              <MaterialIcon name="arrow_back" size="sm" className="mr-2" />
              Back
            </Button>
            <Button variant="outline" onClick={handleRefresh} disabled={zonesLoading || locationsLoading}>
              <MaterialIcon
                name="refresh"
                size="sm"
                className={cn('mr-2', (zonesLoading || locationsLoading) && 'animate-spin')}
              />
              Refresh
            </Button>
          </div>
        </div>

        {/* Map selection rules */}
        {!defaultMap ? (
          <Card>
            <CardContent className="py-12 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <MaterialIcon name="map" />
              </div>
              <div className="font-medium">
                {missingDefault ? 'No default map set' : 'No map configured'}
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {missingDefault
                  ? 'A default map is required for the heat map viewer.'
                  : 'Create a map and set it as default to view the heat map.'}
              </div>
              {warehouseId && (
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  {canBuild && (
                    <Button asChild variant="outline">
                      <Link to={`/warehouses/${warehouseId}/map`}>
                        <MaterialIcon name="construction" size="sm" className="mr-2" />
                        Open Map Builder
                      </Link>
                    </Button>
                  )}
              {missingDefault && canBuild && maps.length > 0 && (
                    <Button onClick={handleSetMostRecentAsDefault} disabled={settingDefault}>
                      <MaterialIcon name="star" size="sm" className="mr-2" />
                      {settingDefault ? 'Setting default…' : 'Set most recent as default'}
                    </Button>
                  )}
                </div>
              )}
              {!canBuild && missingDefault && (
                <div className="mt-3 text-xs text-muted-foreground">
                  Ask a manager/admin to set a default map.
                </div>
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1fr_420px]">
            {/* Heat map canvas */}
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <div>
                  <CardTitle className="text-base">{defaultMap.name}</CardTitle>
                  <CardDescription>
                    Last refreshed: {formatTime(lastRefreshedAt)}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-xs text-muted-foreground">Legend</div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <LegendSwatch color="#22c55e" label="0–50%" />
                  <LegendSwatch color="#f59e0b" label="50–80%" />
                  <LegendSwatch color="#ef4444" label="80–100%" />
                  <LegendSwatch color="#7f1d1d" label=">100%" />
                  <LegendSwatch color="#e5e7eb" label="No capacity / tracking" />
                </div>

                <div className="w-full overflow-auto rounded border bg-background">
                  <svg
                    viewBox={`0 0 ${mapWidth} ${mapHeight}`}
                    className="min-h-[420px] w-[1000px]"
                    onClick={() => setSelectedZoneId(null)}
                  >
                    {zoneRows.map((r) => {
                      const clickable = !!r.zone_id;
                      const fill = getHeatFill(r.utilization_pct);
                      const stroke = r.zone_id === selectedZoneId ? '#2563eb' : 'rgba(100,116,139,0.8)';
                      const strokeWidth = r.zone_id === selectedZoneId ? 3 : 1;
                      const label = (r.zone_code || '').trim();

                      return (
                        <g
                          key={r.node_id}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (r.zone_id) setSelectedZoneId(r.zone_id);
                          }}
                          className={cn(clickable ? 'cursor-pointer' : 'cursor-default')}
                        >
                          <rect
                            x={r.x}
                            y={r.y}
                            width={r.width}
                            height={r.height}
                            fill={fill}
                            fillOpacity={0.8}
                            stroke={stroke}
                            strokeWidth={strokeWidth}
                          />
                          {label && (
                            <text
                              x={r.x + 8}
                              y={r.y + 18}
                              fontSize="14"
                              fill="rgba(15,23,42,0.85)"
                            >
                              {label}
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                </div>
              </CardContent>
            </Card>

            {/* Zone detail panel */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Zone details</CardTitle>
                <CardDescription>
                  {selectedZoneRow?.zone_code ? (
                    <>
                      {selectedZoneRow.zone_code} • {selectedZoneLocations.length} location{selectedZoneLocations.length === 1 ? '' : 's'}
                    </>
                  ) : (
                    'Select a zone on the map.'
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={showOnlyAvailable}
                      onCheckedChange={(v) => setShowOnlyAvailable(!!v)}
                      id="available-only"
                    />
                    <label htmlFor="available-only" className="text-sm">
                      Show only &lt; 80%
                    </label>
                  </div>
                  {selectedZoneRow && (
                    <div className="text-xs text-muted-foreground">
                      Zone utilization:{' '}
                      {selectedZoneRow.utilization_pct === null ? '—' : `${Number(selectedZoneRow.utilization_pct).toFixed(0)}%`}
                      {' • '}
                      {formatCuFt(selectedZoneRow.used_cu_ft)} used / {formatCuFt(selectedZoneRow.capacity_cu_ft)}
                    </div>
                  )}
                </div>

                {!selectedZoneRow ? (
                  <div className="text-sm text-muted-foreground">
                    Tap/click a zone block to see location-level capacity.
                  </div>
                ) : locationsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                    <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                    Loading locations…
                  </div>
                ) : selectedZoneLocations.length === 0 ? (
                  <div className="text-sm text-muted-foreground">
                    No locations are assigned to this zone.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedZoneLocations.map((loc) => (
                      <div
                        key={loc.location_id}
                        className="flex items-center justify-between rounded border px-3 py-2"
                      >
                        <div className="font-mono text-sm">{loc.location_code}</div>
                        <div className="text-right">
                          <div className="text-sm text-muted-foreground">
                            {loc.utilization_pct === null ? '—' : `${Number(loc.utilization_pct).toFixed(0)}%`}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {formatCuFt(loc.free_cu_ft)} free / {formatCuFt(loc.capacity_cu_ft)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block h-3 w-3 rounded-sm border" style={{ backgroundColor: color }} />
      <span>{label}</span>
    </div>
  );
}

