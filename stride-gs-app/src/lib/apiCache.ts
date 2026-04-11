/**
 * Global API cache with localStorage persistence.
 *
 * Two-tier strategy:
 *   1. In-memory Map — fastest, cleared on page reload
 *   2. localStorage — survives reload, enables instant page paint
 *
 * cacheGet checks memory first, then localStorage. Data from localStorage
 * is promoted back into memory for subsequent reads. The caller (useApiData)
 * still triggers a background refresh — this just eliminates the loading
 * spinner on revisit.
 */

interface CacheEntry<T = unknown> {
  data: T;
  timestamp: number;
}

const store = new Map<string, CacheEntry>();

const LS_PREFIX = 'stride_cache_';

/** Default TTL: 5 minutes */
const DEFAULT_TTL = 5 * 60 * 1000;

/** localStorage TTL: 30 minutes — stale is OK, we refresh in background */
const LS_TTL = 30 * 60 * 1000;

function lsKey(key: string): string { return LS_PREFIX + key; }

function lsWrite(key: string, entry: CacheEntry): void {
  try {
    localStorage.setItem(lsKey(key), JSON.stringify(entry));
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

function lsRead<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = localStorage.getItem(lsKey(key));
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry<T>;
  } catch {
    return null;
  }
}

function lsRemove(key: string): void {
  try { localStorage.removeItem(lsKey(key)); } catch { /* */ }
}

export function cacheGet<T>(key: string, ttl = DEFAULT_TTL): T | null {
  // Tier 1: in-memory
  const entry = store.get(key);
  if (entry) {
    if (Date.now() - entry.timestamp > ttl) {
      store.delete(key);
    } else {
      return entry.data as T;
    }
  }

  // Tier 2: localStorage (uses longer TTL)
  const ls = lsRead<T>(key);
  if (ls) {
    if (Date.now() - ls.timestamp > LS_TTL) {
      lsRemove(key);
      return null;
    }
    // Promote to memory
    store.set(key, ls);
    return ls.data;
  }

  return null;
}

export function cacheSet<T>(key: string, data: T): void {
  const entry: CacheEntry = { data, timestamp: Date.now() };
  store.set(key, entry);
  lsWrite(key, entry);
}

/** Invalidate a specific cache key */
export function cacheDelete(key: string): void {
  store.delete(key);
  lsRemove(key);
}

/** Invalidate all cache entries matching a prefix (e.g., "inventory" clears all inventory caches) */
export function cacheInvalidatePrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) { store.delete(key); lsRemove(key); }
  }
  // Also clear matching localStorage entries
  try {
    const lsPrefix = LS_PREFIX + prefix;
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(lsPrefix)) localStorage.removeItem(k);
    }
  } catch { /* */ }
}

/** Clear all cached data (e.g., after a write operation) */
export function cacheClearAll(): void {
  store.clear();
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) localStorage.removeItem(k);
    }
  } catch { /* */ }
}

/** Get cache stats for debugging */
export function cacheStats(): { size: number; keys: string[] } {
  return { size: store.size, keys: [...store.keys()] };
}
