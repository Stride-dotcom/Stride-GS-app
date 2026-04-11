import { useState, useEffect, useCallback } from 'react';

/**
 * Persists sidebar nav item order per user to localStorage.
 * Key: stride_sidebar_{email}
 *
 * On load, reconciles saved order against current nav IDs:
 *  - Removes stale IDs no longer in the nav
 *  - Appends any new IDs not yet in saved order
 */
export function useSidebarOrder(userEmail: string | undefined, defaultIds: string[]) {
  const storageKey = userEmail ? `stride_sidebar_${userEmail}` : 'stride_sidebar_anon';

  const [orderedIds, setOrderedIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return defaultIds;
      const saved: string[] = JSON.parse(raw);
      // Filter out any IDs that no longer exist in the nav
      const valid = saved.filter(id => defaultIds.includes(id));
      // Append any new IDs not in the saved order
      const missing = defaultIds.filter(id => !valid.includes(id));
      return [...valid, ...missing];
    } catch {
      return defaultIds;
    }
  });

  // Re-reconcile when defaultIds change (e.g. role change / impersonation)
  useEffect(() => {
    setOrderedIds(prev => {
      const valid = prev.filter(id => defaultIds.includes(id));
      const missing = defaultIds.filter(id => !valid.includes(id));
      const next = [...valid, ...missing];
      // Only update if actually different
      if (next.length === prev.length && next.every((id, i) => id === prev[i])) return prev;
      return next;
    });
  }, [defaultIds.join(',')]);

  // Persist to localStorage whenever order changes
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(orderedIds));
    } catch { /* quota exceeded — ignore */ }
  }, [storageKey, orderedIds]);

  const reorder = useCallback((fromId: string, toId: string) => {
    setOrderedIds(prev => {
      const order = [...prev];
      const from = order.indexOf(fromId);
      const to = order.indexOf(toId);
      if (from === -1 || to === -1) return prev;
      order.splice(from, 1);
      order.splice(to, 0, fromId);
      return order;
    });
  }, []);

  return { orderedIds, reorder };
}
