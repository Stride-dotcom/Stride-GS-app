/**
 * serviceTimeSnapshot.ts
 *
 * Helpers for storing an "Estimated Service Time" snapshot on a job record.
 * We snapshot on completion so historical reports aren't affected by later
 * Price List changes.
 */

import type { Json } from '@/integrations/supabase/types';

export type ServiceTimeSnapshotV1 = {
  estimated_minutes: number;
  estimated_snapshot_at: string; // ISO timestamp
  estimated_source: 'service_lines' | 'billing_preview' | 'unknown';
  estimated_version: 1;
  // Optional: only used when service lines exist (kept small)
  estimated_breakdown?: Array<{
    charge_code: string;
    unit: string;
    service_time_minutes: number;
    quantity: number;
    estimated_minutes: number;
  }>;
};

export type ServiceTimeActualSnapshotV1 = {
  actual_cycle_minutes: number;
  actual_labor_minutes: number;
  actual_snapshot_at: string; // ISO timestamp
  actual_version: 1;
};

export type ServiceTimeAdjustmentSnapshotV1 = {
  adjustment_version: 1;
  adjusted_at: string; // ISO timestamp
  adjusted_by: string; // user id
  adjusted_reason: string;
  adjusted_from_minutes: number;
  adjusted_to_minutes: number;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function mergeServiceTimeSnapshot(
  metadata: Json | null | undefined,
  snapshot: ServiceTimeSnapshotV1,
): Json {
  const metaObj: Record<string, unknown> = isPlainObject(metadata) ? { ...(metadata as any) } : {};
  const existingServiceTime: Record<string, unknown> = isPlainObject(metaObj.service_time)
    ? { ...(metaObj.service_time as any) }
    : {};

  return {
    ...metaObj,
    service_time: {
      ...existingServiceTime,
      ...snapshot,
    },
  } as unknown as Json;
}

export function mergeServiceTimeActualSnapshot(
  metadata: Json | null | undefined,
  snapshot: ServiceTimeActualSnapshotV1,
): Json {
  const metaObj: Record<string, unknown> = isPlainObject(metadata) ? { ...(metadata as any) } : {};
  const existingServiceTime: Record<string, unknown> = isPlainObject(metaObj.service_time)
    ? { ...(metaObj.service_time as any) }
    : {};

  return {
    ...metaObj,
    service_time: {
      ...existingServiceTime,
      ...snapshot,
    },
  } as unknown as Json;
}

export function mergeServiceTimeAdjustmentSnapshot(
  metadata: Json | null | undefined,
  snapshot: ServiceTimeAdjustmentSnapshotV1,
): Json {
  const metaObj: Record<string, unknown> = isPlainObject(metadata) ? { ...(metadata as any) } : {};
  const existingServiceTime: Record<string, unknown> = isPlainObject(metaObj.service_time)
    ? { ...(metaObj.service_time as any) }
    : {};

  return {
    ...metaObj,
    service_time: {
      ...existingServiceTime,
      ...snapshot,
    },
  } as unknown as Json;
}

