/**
 * useTaskAddons — back-compat shim over useEntityAddons (v38.173.0).
 *
 * The task-only public.task_addons table was replaced by a polymorphic
 * public.addons table in 2026-05-04. This hook now delegates to
 * useEntityAddons('task', taskId, tenantId) and re-exports the legacy
 * TaskAddon / AddTaskAddonInput / UseTaskAddonsResult names so the
 * existing TaskDetailPanel call site keeps working without churn.
 *
 * New consumers should import useEntityAddons directly.
 */
import { useMemo } from 'react';
import {
  useEntityAddons,
  type EntityAddon,
  type AddEntityAddonInput,
  type UseEntityAddonsResult,
} from './useEntityAddons';

export type TaskAddon = EntityAddon;
export type AddTaskAddonInput = AddEntityAddonInput;
export type UseTaskAddonsResult = UseEntityAddonsResult;

export function useTaskAddons(
  taskId: string | null | undefined,
  tenantId: string | null | undefined,
): UseTaskAddonsResult {
  const result = useEntityAddons('task', taskId, tenantId);
  // Stable reference unless any of the underlying values change.
  return useMemo(() => result, [result]);
}
