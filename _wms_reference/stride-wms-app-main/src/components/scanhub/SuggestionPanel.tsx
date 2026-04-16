import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import type { LocationSuggestion } from '@/hooks/useLocationSuggestions';

interface SuggestionPanelProps {
  suggestions: LocationSuggestion[];
  loading: boolean;
  error: string | null;
  mode: 'single' | 'batch';
  onRefresh?: () => void;
  matchChipLabel?: string;
}

export function SuggestionPanel({
  suggestions,
  loading,
  error,
  mode,
  onRefresh,
  matchChipLabel = 'Item match',
}: SuggestionPanelProps) {
  const isOverflow =
    suggestions.length > 0 && suggestions.every((s) => s.overflow);

  // ---- Loading skeleton ----
  if (loading) {
    return (
      <div className="w-full max-w-md space-y-2 mt-3">
        <p className="text-xs font-medium text-muted-foreground">
          Suggested Locations
        </p>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  // ---- Error state ----
  if (error) {
    return (
      <div className="w-full max-w-md mt-3">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{error}</p>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="text-xs text-primary hover:underline"
            >
              Refresh suggestions
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---- No suggestions ----
  if (suggestions.length === 0) return null;

  // ---- Suggestions list ----
  return (
    <div className="w-full max-w-md mt-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">
          Suggested Locations
        </p>
        {onRefresh && (
          <button
            onClick={onRefresh}
            className="text-xs text-primary hover:underline"
          >
            Refresh
          </button>
        )}
      </div>

      {/* Overflow banner */}
      {isOverflow && (
        <div className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg px-3 py-2 flex items-center gap-2">
          <MaterialIcon name="warning" size="sm" />
          {mode === 'batch'
            ? 'No single location fits this batch. Showing best available (may overflow).'
            : 'No locations under 90% capacity found. Showing best available.'}
        </div>
      )}

      {suggestions.map((s, index) => (
        <div
          key={s.location_id}
          className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono font-bold text-sm">
                {s.location_code}
              </span>
              {index === 0 && !s.overflow && (
                <Badge
                  variant="default"
                  className="text-[10px] px-1.5 py-0 bg-primary"
                >
                  Best fit
                </Badge>
              )}
            </div>

            <div className="text-xs text-muted-foreground mt-0.5">
              {s.available_cuft.toFixed(1)} cuft avail &middot;{' '}
              {(s.utilization_pct * 100).toFixed(0)}% used
            </div>

            <div className="flex flex-wrap gap-1 mt-1">
              {s.flag_compliant ? (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 border-green-500 text-green-600 dark:text-green-400"
                >
                  Compliant
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 border-red-500 text-red-600 dark:text-red-400"
                >
                  Mismatch
                </Badge>
              )}
              {s.account_cluster && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0"
                >
                  Account cluster
                </Badge>
              )}
              {s.sku_or_vendor_match && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0"
                >
                  {matchChipLabel}
                </Badge>
              )}
              {s.group_match && (
                <Badge
                  variant="outline"
                  className="text-[10px] px-1.5 py-0"
                >
                  Group match
                </Badge>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
