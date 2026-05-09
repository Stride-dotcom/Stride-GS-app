/**
 * FeatureFlagContext — App-level resolution of GAS→Supabase migration flags.
 *
 * Backs the per-function backend selector (`active_backend`) for the
 * migration. Every site in the React app that needs to decide "call GAS API
 * or call SB Edge Function?" calls `useFeatureFlag(key)` and gets back
 * `'gas' | 'supabase'` resolved against the user's primary tenant.
 *
 * Also exposes the full flag rows for the Settings → Migration tab (P1.6).
 *
 * Project context: stride-gs-app/MIGRATION_STATUS.md, decisions MIG-007
 * (three-layer verification — `feature_flags` is the routing source) and
 * MIG-009 (this file is part of the canonical living-doc surface).
 *
 * State source: public.feature_flags (Supabase). Schema seeded by P1.1
 * migration `migration_parity_substrate` with one row per migration
 * function at `active_backend='gas'`. Realtime publication is enabled so
 * a flag flip in one tab propagates to all open tabs without a refresh.
 *
 * ── Per-tenant scope semantics ──────────────────────────────────────────
 * `feature_flags.function_key` is the primary key — exactly one row per
 * function. The single row carries:
 *   active_backend  — the canary's backend ('gas' or 'supabase')
 *   tenant_scope    — text[] | NULL
 *
 * Resolution for a given (flag, callerTenantId):
 *   tenant_scope IS NULL                       → return active_backend (fleet-wide)
 *   tenant_scope contains callerTenantId       → return active_backend (in scope)
 *   tenant_scope set, callerTenantId NOT in it → return the OPPOSITE backend
 *
 * Workflow:
 *   1. New function ships at  {active_backend:'gas',      tenant_scope:null}
 *      → everyone routed through GAS.
 *   2. Canary one tenant      {active_backend:'supabase', tenant_scope:[X]}
 *      → tenant X routed through SB; everyone else through GAS (opposite).
 *   3. Expand cohort          {active_backend:'supabase', tenant_scope:[X,Y,Z]}
 *      → listed tenants on SB; rest on GAS.
 *   4. Fleet-wide cutover     {active_backend:'supabase', tenant_scope:null}
 *      → all on SB.
 *
 * Emergency global revert (MIG-003 master switch) sets every row to
 * {active_backend:'gas', tenant_scope:null} in one transaction.
 */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

// ─── Types ───────────────────────────────────────────────────────────────────

export type Backend = 'gas' | 'supabase';

export interface FeatureFlagRow {
  function_key: string;
  active_backend: Backend;
  shadow_backend: Backend | null;
  parity_enabled: boolean;
  tenant_scope: string[] | null;
  last_parity_check: string | null;
  mismatch_count_7d: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface FeatureFlagContextValue {
  /** Map from function_key → FeatureFlagRow. Null while initial load is in flight. */
  flagsByKey: Record<string, FeatureFlagRow> | null;
  /** True until the initial fetch resolves (success or fail). */
  loading: boolean;
  /** True if the initial fetch failed; in that case every resolveBackend()
   *  call falls back to 'gas' as the safe default. */
  error: boolean;
  /** Pure resolution — exposed so non-hook callers (e.g. event handlers
   *  inside a one-off effect) can resolve a backend without subscribing
   *  to context updates. The hook variants below subscribe properly. */
  resolveBackend: (key: string, callerTenantId: string | null) => Backend;
}

// ─── Row mapping ─────────────────────────────────────────────────────────────

function rowToFlag(r: Record<string, unknown>): FeatureFlagRow {
  return {
    function_key:      String(r.function_key || ''),
    active_backend:    (String(r.active_backend || 'gas') as Backend),
    shadow_backend:    r.shadow_backend ? (String(r.shadow_backend) as Backend) : null,
    parity_enabled:    Boolean(r.parity_enabled),
    tenant_scope:      Array.isArray(r.tenant_scope) ? (r.tenant_scope as string[]) : null,
    last_parity_check: r.last_parity_check ? String(r.last_parity_check) : null,
    mismatch_count_7d: Number(r.mismatch_count_7d || 0),
    notes:             r.notes ? String(r.notes) : null,
    created_at:        String(r.created_at || ''),
    updated_at:        String(r.updated_at || ''),
  };
}

function oppositeBackend(b: Backend): Backend {
  return b === 'gas' ? 'supabase' : 'gas';
}

// Pure resolution helper (exported for use by replay tooling that has a
// flag row in hand without going through React context).
export function resolveFlagBackend(
  flag: FeatureFlagRow | undefined,
  callerTenantId: string | null
): Backend {
  // If the flag isn't loaded yet (or doesn't exist for this key), default
  // to GAS — the safe pre-migration backend. A missing flag should never
  // accidentally route a caller to an SB handler that may not exist.
  if (!flag) return 'gas';
  // Fleet-wide rule.
  if (flag.tenant_scope === null) return flag.active_backend;
  // Scoped rule. callerTenantId must be supplied for scoped flags;
  // unauth'd / cross-tenant code paths default to the safe (gas) side.
  if (!callerTenantId) return 'gas';
  const inScope = flag.tenant_scope.includes(callerTenantId);
  return inScope ? flag.active_backend : oppositeBackend(flag.active_backend);
}

// ─── Context ─────────────────────────────────────────────────────────────────

const FeatureFlagContext = createContext<FeatureFlagContextValue | null>(null);

export function FeatureFlagProvider({ children }: { children: ReactNode }) {
  const [flagsByKey, setFlagsByKey] = useState<Record<string, FeatureFlagRow> | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<boolean>(false);

  // Initial load: every flag row in one round-trip.
  // RLS allows authenticated read on feature_flags, so this works as soon
  // as the user has a session. Anonymous loads return zero rows; the
  // resolveBackend fallback to 'gas' covers that case.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from('feature_flags')
        .select('*');
      if (cancelled) return;
      if (err) {
        // Silent: a Supabase outage at app startup shouldn't crash the
        // App layout. resolveBackend falls back to 'gas' (safe).
        setError(true);
        setLoading(false);
        return;
      }
      const map: Record<string, FeatureFlagRow> = {};
      for (const r of data || []) {
        const flag = rowToFlag(r as Record<string, unknown>);
        if (flag.function_key) map[flag.function_key] = flag;
      }
      setFlagsByKey(map);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Realtime: every UPDATE/INSERT/DELETE on feature_flags propagates to
  // all open tabs. Critical for the canary workflow — when the operator
  // flips a flag for tenant X in the Settings tab, every browser tab
  // (including theirs) routes the next call accordingly without a refresh.
  useEffect(() => {
    const channel = supabase
      .channel('feature_flags_app')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feature_flags' }, payload => {
        const evt = payload.eventType;
        if ((evt === 'INSERT' || evt === 'UPDATE') && payload.new) {
          const flag = rowToFlag(payload.new as Record<string, unknown>);
          if (!flag.function_key) return;
          setFlagsByKey(prev => ({ ...(prev || {}), [flag.function_key]: flag }));
        } else if (evt === 'DELETE' && payload.old) {
          const key = String((payload.old as Record<string, unknown>).function_key || '');
          if (!key) return;
          setFlagsByKey(prev => {
            if (!prev) return prev;
            const next = { ...prev };
            delete next[key];
            return next;
          });
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const resolveBackend = useMemo(() => {
    return (key: string, callerTenantId: string | null): Backend => {
      const flag = flagsByKey ? flagsByKey[key] : undefined;
      return resolveFlagBackend(flag, callerTenantId);
    };
  }, [flagsByKey]);

  const value = useMemo<FeatureFlagContextValue>(() => ({
    flagsByKey,
    loading,
    error,
    resolveBackend,
  }), [flagsByKey, loading, error, resolveBackend]);

  return <FeatureFlagContext.Provider value={value}>{children}</FeatureFlagContext.Provider>;
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

function useFeatureFlagContext(): FeatureFlagContextValue {
  const ctx = useContext(FeatureFlagContext);
  if (!ctx) throw new Error('useFeatureFlag* hooks must be used inside <FeatureFlagProvider>');
  return ctx;
}

/**
 * Resolve the active backend for a given migration function. Returns
 * `'gas'` until flags load. Callers should be safe with that default —
 * 'gas' is the pre-migration backend.
 *
 * Per-tenant scope is resolved against the authenticated user's
 * `clientSheetId` (primary tenant). Cross-tenant impersonation paths
 * (admin "login as") do NOT use the impersonated tenant for routing —
 * they use the impersonating user's primary tenant. This is intentional:
 * a function under canary should be exercised under the real user's
 * tenant, not arbitrary tenants the admin happens to be looking at.
 */
export function useFeatureFlag(key: string): Backend {
  const { resolveBackend } = useFeatureFlagContext();
  const { user } = useAuth();
  return resolveBackend(key, user?.clientSheetId || null);
}

/**
 * Full flag row for the given key, or `null` while loading / not found.
 * Used by the Settings → Migration UI (P1.6) to render mismatch counts,
 * shadow_backend state, parity_enabled, etc.
 */
export function useFeatureFlagRow(key: string): FeatureFlagRow | null {
  const { flagsByKey } = useFeatureFlagContext();
  if (!flagsByKey) return null;
  return flagsByKey[key] || null;
}

/**
 * Every flag row, sorted alphabetically by function_key. Used by the
 * Settings → Migration UI dashboard.
 */
export function useAllFeatureFlags(): FeatureFlagRow[] {
  const { flagsByKey } = useFeatureFlagContext();
  return useMemo(() => {
    if (!flagsByKey) return [];
    return Object.values(flagsByKey).sort((a, b) => a.function_key.localeCompare(b.function_key));
  }, [flagsByKey]);
}

/**
 * Loading state for any caller that wants to render a spinner while flags
 * resolve. Most caller sites won't need this — `useFeatureFlag` returns
 * 'gas' during load, which is usually the right default.
 */
export function useFeatureFlagLoading(): boolean {
  const { loading } = useFeatureFlagContext();
  return loading;
}
