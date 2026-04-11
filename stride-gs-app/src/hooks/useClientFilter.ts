/**
 * useClientFilter — Returns the clientSheetId filter for data hooks.
 *
 * Multi-client users (v33): returns undefined (server scopes via accessibleClientSheetIds)
 * Single-client users: returns their own clientSheetId (server-side isolated)
 * Staff/admin: returns undefined (see all clients)
 */
import { useAuth } from '../contexts/AuthContext';

export function useClientFilter(): string | undefined {
  const { user } = useAuth();
  if (!user) return undefined;
  if (user.role === 'client') {
    // Multi-client or parent users pass no filter — server scopes to their accessible accounts
    if (user.isParent || user.accessibleClientSheetIds.length > 1) return undefined;
    return user.clientSheetId ?? undefined;
  }
  return undefined;
}
