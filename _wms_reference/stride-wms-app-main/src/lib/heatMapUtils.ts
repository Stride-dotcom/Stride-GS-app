export function getHeatFill(utilizationPct: number | null): string {
  if (utilizationPct === null || !Number.isFinite(utilizationPct)) return '#e5e7eb'; // gray-200
  if (utilizationPct > 100) return '#7f1d1d'; // red-900
  if (utilizationPct >= 80) return '#ef4444'; // red-500
  if (utilizationPct >= 50) return '#f59e0b'; // amber-500
  return '#22c55e'; // green-500
}

export function formatTime(dt: Date | null): string {
  if (!dt) return '—';
  return dt.toLocaleString();
}

