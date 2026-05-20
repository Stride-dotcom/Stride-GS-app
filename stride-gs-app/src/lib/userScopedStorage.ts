/**
 * userScopedStorage — helpers for localStorage keys namespaced by user identity.
 *
 * During impersonation, AuthContext exposes `user = impersonatedUser ?? realUser`,
 * so any localStorage key that should isolate per-identity must include
 * `user.email` in the key. Without that, an admin's saved view bleeds into
 * the impersonated client's view on the same browser (and vice versa).
 *
 * `userScopedKey()` produces the namespaced key. `migrateLegacyKey()` is a
 * one-shot copier from a legacy unkeyed entry into the user-namespaced
 * slot, run the first time the hook/component mounts under a known
 * identity — admins keep their current selection without having to
 * re-pick it after the rollout.
 *
 * Both functions are safe to call repeatedly; subsequent invocations
 * find no legacy entry and become no-ops.
 */

/**
 * Build the user-namespaced storage key. When userEmail is undefined
 * (auth still loading, or no session) the caller gets back the legacy
 * unkeyed prefix so first-paint reads still work — the rehydrate effect
 * will swap to the namespaced key once auth resolves.
 *
 * @param prefix  — the page/feature-specific key prefix (e.g.
 *                  'stride_filter_claims_status' or
 *                  'stride_client_filter_inventory')
 * @param userEmail — auth's `user.email` (impersonated email during
 *                    impersonation; admin's email otherwise)
 */
export function userScopedKey(prefix: string, userEmail: string | undefined): string {
  if (!userEmail) return prefix;
  return `${prefix}_${userEmail}`;
}

/**
 * One-shot migration: if the legacy unkeyed `prefix` still has a value
 * but the user-namespaced key doesn't, copy it over and delete the
 * legacy entry. Returns silently when userEmail is undefined (caller
 * should re-invoke once auth resolves).
 *
 * Idempotent — second call finds the legacy slot empty and no-ops, so
 * safe to call from both a `useState` initializer (first paint) and a
 * follow-up `useEffect` (when auth populates after first paint).
 */
export function migrateLegacyKey(prefix: string, userEmail: string | undefined): void {
  if (!userEmail) return;
  try {
    const newKey = userScopedKey(prefix, userEmail);
    if (prefix === newKey) return;
    const legacyValue = localStorage.getItem(prefix);
    if (legacyValue === null) return;
    if (localStorage.getItem(newKey) !== null) {
      // User already has a namespaced value — legacy is just stale.
      localStorage.removeItem(prefix);
      return;
    }
    localStorage.setItem(newKey, legacyValue);
    localStorage.removeItem(prefix);
  } catch {
    /* localStorage best-effort — ignore quota / sandboxed contexts */
  }
}
