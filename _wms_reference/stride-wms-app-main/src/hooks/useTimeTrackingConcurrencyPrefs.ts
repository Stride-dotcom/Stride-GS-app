import { useOrgPreferences } from '@/hooks/useOrgPreferences';

export type TimeTrackingConcurrencyPrefs = {
  allowConcurrentTasks: boolean;
  allowConcurrentShipments: boolean;
  allowConcurrentStocktakes: boolean;
};

export function useTimeTrackingConcurrencyPrefs() {
  const { preferences, loading, refetch } = useOrgPreferences();

  const prefs: TimeTrackingConcurrencyPrefs = {
    allowConcurrentTasks: preferences.time_tracking_allow_concurrent_tasks,
    allowConcurrentShipments: preferences.time_tracking_allow_concurrent_shipments,
    allowConcurrentStocktakes: preferences.time_tracking_allow_concurrent_stocktakes,
  };

  return { prefs, loading, refetch };
}
