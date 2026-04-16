import { useClientPortalContext } from '@/hooks/useClientPortal';
import { useAuth } from '@/contexts/AuthContext';
import { AIClientBot } from './AIClientBot';
import { AITenantBot } from './AITenantBot';

/**
 * Conditionally renders the appropriate AI bot based on user type:
 * - Client portal users see AIClientBot (friendly, client-safe)
 * - Internal users (admin, warehouse_user) see AITenantBot (operational)
 */
export function AIBotSwitch() {
  const { profile } = useAuth();
  const { isClientPortalUser, isLoading } = useClientPortalContext();

  // Don't render anything while loading or if no profile
  if (isLoading || !profile) {
    return null;
  }

  // Client portal users get the client bot
  if (isClientPortalUser) {
    return <AIClientBot />;
  }

  // Internal users get the tenant/ops bot
  return <AITenantBot />;
}
