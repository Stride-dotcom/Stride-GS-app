/**
 * useEntityCompleters — resolves who completed (or cancelled / released)
 * a set of entities by reading entity_audit_log.
 *
 * Backs the "Assigned" column in list views (Tasks, Repairs, Dashboard) so
 * staff/admin can audit who actually did the work, not just who was on the
 * hook for it. When the task is still Open / In Progress, the column keeps
 * showing the assignee; once terminal, it surfaces the doer.
 *
 * Action priority per entity (latest wins):
 *   • task    → 'complete' | 'cancel'
 *   • repair  → 'complete' | 'cancel'
 *   • will_call → 'release'
 *
 * Refetches on entityEvents for the same entity type so a fresh completion
 * surfaces without a page reload.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '../lib/supabase';
import { entityEvents } from '../lib/entityEvents';

export interface CompleterRecord {
  /** Email of the user who performed the terminal action. */
  performedBy: string;
  /** ISO timestamp of the action. */
  performedAt: string;
  /** The audit action that landed the entity in its terminal state. */
  action: string;
}

/** entity_type → ordered list of terminal-state actions to look for. */
const TERMINAL_ACTIONS: Record<string, string[]> = {
  task:      ['complete', 'cancel'],
  repair:    ['complete', 'cancel'],
  will_call: ['release'],
};

export function useEntityCompleters(
  entityType: keyof typeof TERMINAL_ACTIONS | string,
  entityIds: string[],
): { completerMap: Map<string, CompleterRecord>; loading: boolean } {
  const [completerMap, setCompleterMap] = useState<Map<string, CompleterRecord>>(new Map());
  const [loading, setLoading] = useState(false);

  // Stable key — entityIds is recomputed every render in some pages, but the
  // contents change far less often. Sort + join so an in-place reorder of
  // the same IDs doesn't refetch.
  const idsKey = useMemo(() => {
    const filtered = entityIds.filter(Boolean);
    return filtered.slice().sort().join('|');
  }, [entityIds]);

  const fetchMap = useCallback(async () => {
    const actions = TERMINAL_ACTIONS[entityType];
    if (!actions || !idsKey) {
      setCompleterMap(new Map());
      return;
    }
    const ids = idsKey.split('|').filter(Boolean);
    if (ids.length === 0) {
      setCompleterMap(new Map());
      return;
    }
    setLoading(true);
    // Single query — IN-list keyed on entity_id, ordered desc so the first
    // hit per (entity_id) below is the most recent action. Supabase / PG
    // happily handle a few thousand IDs in an IN clause.
    const { data, error } = await supabase
      .from('entity_audit_log')
      .select('entity_id, action, performed_by, performed_at')
      .eq('entity_type', entityType)
      .in('action', actions)
      .in('entity_id', ids)
      .order('performed_at', { ascending: false });
    if (error) {
      console.warn('[useEntityCompleters] fetch failed:', error.message);
      setLoading(false);
      return;
    }
    const m = new Map<string, CompleterRecord>();
    for (const row of (data ?? []) as Array<{
      entity_id: string; action: string; performed_by: string | null; performed_at: string | null;
    }>) {
      if (m.has(row.entity_id)) continue; // already have the most-recent
      if (!row.performed_by || !row.performed_at) continue;
      m.set(row.entity_id, {
        performedBy: row.performed_by,
        performedAt: row.performed_at,
        action: row.action,
      });
    }
    setCompleterMap(m);
    setLoading(false);
  }, [entityType, idsKey]);

  useEffect(() => { void fetchMap(); }, [fetchMap]);

  // Refresh when a relevant entity changes — covers a fresh complete /
  // cancel landing while the page is open.
  useEffect(() => {
    return entityEvents.subscribe((type) => {
      if (type === entityType) void fetchMap();
    });
  }, [entityType, fetchMap]);

  return { completerMap, loading };
}

/** Strip the domain from an email so the column doesn't wrap and the
 *  human-readable part is visible at the default column width. */
export function shortEmail(email: string | null | undefined): string {
  if (!email) return '';
  const at = email.indexOf('@');
  return at > 0 ? email.slice(0, at) : email;
}
