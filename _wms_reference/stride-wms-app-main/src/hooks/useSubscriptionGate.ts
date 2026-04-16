import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface SubscriptionGateState {
  status: string;
  is_active: boolean;
  is_in_grace: boolean;
  is_restricted: boolean;
  grace_until?: string;
  is_comped?: boolean;
  comp_expires_at?: string | null;
}

const DEFAULT_GATE: SubscriptionGateState = {
  status: "none",
  is_active: true,
  is_in_grace: false,
  is_restricted: false,
  is_comped: false,
};

/**
 * Global enforcement semantics (superseding Phase 5 route-level gating):
 * - past_due is blocked immediately
 * - restricted statuses remain blocked
 */
export function isSubscriptionAccessBlocked(gate?: SubscriptionGateState | null): boolean {
  if (!gate) return false;
  if (gate.is_comped) return false;
  if (gate.status === "past_due") return true;
  return gate.is_restricted || gate.status === "canceled" || gate.status === "inactive";
}

export function useSubscriptionGate() {
  const { session } = useAuth();

  return useQuery<SubscriptionGateState>({
    queryKey: ["subscription-gate"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("rpc_get_my_subscription_gate");
      if (error) {
        console.error("useSubscriptionGate error:", error.message);
        // Fail-open: if RPC fails, treat as active
        return DEFAULT_GATE;
      }
      return data as unknown as SubscriptionGateState;
    },
    enabled: !!session,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true,
  });
}
