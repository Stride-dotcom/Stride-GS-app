/**
 * serviceTimeEstimate.ts
 *
 * Shared helpers for computing "Estimated Service Time" from pricing config.
 *
 * Decision log (Q57/Q58):
 * - Treat `service_time_minutes` as "minutes per billing unit".
 * - If the pricing unit is `per_task`, the multiplier is always 1.
 * - For all other units (per_item / each / per_hour / etc.), multiply by the line quantity.
 */

export function estimateServiceMinutes(params: {
  serviceTimeMinutes?: number | null;
  unit?: string | null;
  quantity?: number | null;
}): number {
  const rawMinutes = params.serviceTimeMinutes ?? 0;
  if (!Number.isFinite(rawMinutes) || rawMinutes <= 0) return 0;

  const unit = (params.unit ?? '').toLowerCase();

  // Per-task services are always "one per job" for estimates.
  if (unit === 'per_task') return Math.round(rawMinutes);

  const rawQty = params.quantity ?? 1;
  const qty = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;
  return Math.round(rawMinutes * qty);
}

export function formatMinutesShort(totalMinutes: number): string {
  const mins = Number.isFinite(totalMinutes) ? Math.round(totalMinutes) : 0;
  if (mins <= 0) return '0m';

  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours <= 0) return `${rem}m`;
  if (rem <= 0) return `${hours}h`;
  return `${hours}h ${rem}m`;
}

