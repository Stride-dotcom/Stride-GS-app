import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from '@/lib/utils';
import { formatTime, getHeatFill } from '@/lib/heatMapUtils';
import { useWarehouseMaps } from '@/hooks/useWarehouseMaps';
import { useWarehouseMapZoneCapacity } from '@/hooks/useWarehouseMapZoneCapacity';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/hooks/use-toast';

export function HeatMapHeroTile({ warehouseId, className }: { warehouseId: string; className?: string }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { hasRole } = usePermissions();
  const canView =
    hasRole('admin') ||
    hasRole('admin_dev') ||
    hasRole('manager') ||
    hasRole('warehouse');
  const canBuild = hasRole('admin') || hasRole('admin_dev') || hasRole('manager');

  const { maps, loading: mapsLoading, getDefaultMap, setDefaultMap } = useWarehouseMaps(warehouseId);
  const defaultMap = getDefaultMap();
  const [settingDefault, setSettingDefault] = useState(false);

  const {
    rows,
    loading,
    lastRefreshedAt,
    refetch,
  } = useWarehouseMapZoneCapacity(defaultMap?.id);

  const stats = useMemo(() => {
    const warning = rows.filter((r) => r.state === 'WARNING').length;
    const critical = rows.filter((r) => r.state === 'CRITICAL').length;
    const tracked = rows.filter((r) => r.utilization_pct != null);
    const avg =
      tracked.length > 0
        ? tracked.reduce((sum, r) => sum + Number(r.utilization_pct || 0), 0) / tracked.length
        : null;

    return { warning, critical, avg };
  }, [rows]);

  const configured = !!defaultMap;

  const mapWidth = defaultMap?.width ?? 2000;
  const mapHeight = defaultMap?.height ?? 1200;

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
    <Card
      className={cn(
        'relative overflow-hidden transition-shadow',
        configured ? 'cursor-pointer hover:shadow-lg' : 'cursor-default',
        className,
        !canView && 'opacity-60'
      )}
      onClick={() => {
        if (!configured) return;
        navigate(`/warehouses/${warehouseId}/heatmap`);
      }}
      role={configured ? 'button' : undefined}
      tabIndex={configured ? 0 : undefined}
      onKeyDown={
        configured
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                navigate(`/warehouses/${warehouseId}/heatmap`);
              }
            }
          : undefined
      }
      data-testid="dashboard-heatmap-hero"
    >
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div>
          <CardTitle className="text-[11px] font-semibold tracking-wide text-muted-foreground">
            HEAT MAP (PREVIEW)
          </CardTitle>
          <CardDescription className="text-xs">
            {configured ? `Last refreshed: ${formatTime(lastRefreshedAt)}` : mapsLoading ? 'Loading…' : 'Not configured'}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          {!canView ? (
            <Badge variant="outline" className="text-xs">
              No access
            </Badge>
          ) : !configured && maps.length > 0 ? (
            <Badge variant="outline" className="text-xs">
              No default map
            </Badge>
          ) : !configured ? (
            <Badge variant="outline" className="text-xs">
              No maps
            </Badge>
          ) : null}
          {stats.warning > 0 && (
            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
              Warning: {stats.warning}
            </Badge>
          )}
          {stats.critical > 0 && (
            <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
              Critical: {stats.critical}
            </Badge>
          )}
          {stats.avg != null && (
            <Badge variant="outline" className="text-xs">
              Avg: {stats.avg.toFixed(0)}%
            </Badge>
          )}
          {configured && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={(e) => {
                e.stopPropagation();
                refetch();
              }}
              disabled={loading}
              title="Refresh"
            >
              <MaterialIcon name="refresh" size="sm" className={cn(loading && 'animate-spin')} />
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {configured ? (
          <div className="h-[420px] w-full bg-background">
            <svg viewBox={`0 0 ${mapWidth} ${mapHeight}`} className="h-full w-full">
              {rows.map((r) => {
                const fill = getHeatFill(r.utilization_pct);
                return (
                  <rect
                    key={r.node_id}
                    x={r.x}
                    y={r.y}
                    width={r.width}
                    height={r.height}
                    fill={fill}
                    fillOpacity={0.85}
                    stroke="rgba(100,116,139,0.7)"
                    strokeWidth={1}
                  />
                );
              })}
            </svg>
          </div>
        ) : (
          <div className="p-4 space-y-3">
            <div className="text-sm text-muted-foreground">
              {canView
                ? maps.length === 0
                  ? 'No map exists for this warehouse yet.'
                  : 'A default map is required to render the heat map.'
                : 'Heat map is not available for your role.'}
            </div>
            {canBuild && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/warehouses/${warehouseId}/map`);
                  }}
                >
                  <MaterialIcon name="construction" size="sm" className="mr-2" />
                  Open Map Builder
                </Button>
                {maps.length > 0 && (
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleSetMostRecentAsDefault();
                    }}
                    disabled={settingDefault}
                  >
                    <MaterialIcon name="star" size="sm" className="mr-2" />
                    {settingDefault ? 'Setting default…' : 'Set most recent as default'}
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

