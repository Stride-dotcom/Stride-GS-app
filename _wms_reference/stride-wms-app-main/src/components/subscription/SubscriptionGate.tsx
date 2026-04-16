import { createContext, useContext, type ReactNode } from "react";
import { useSubscriptionGate, type SubscriptionGateState } from "@/hooks/useSubscriptionGate";
import { SubscriptionBlockedBanner } from "./SubscriptionBlockedBanner";
import { useAuth } from "@/contexts/AuthContext";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const SubscriptionGateContext = createContext<SubscriptionGateState>({
  status: "none",
  is_active: true,
  is_in_grace: false,
  is_restricted: false,
  is_comped: false,
});

export function useSubscriptionGateContext() {
  return useContext(SubscriptionGateContext);
}

// ---------------------------------------------------------------------------
// Provider — wraps the app; provides gate state to children
// ---------------------------------------------------------------------------

export function SubscriptionGateProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { data } = useSubscriptionGate();

  const gate: SubscriptionGateState = data ?? {
    status: "none",
    is_active: true,
    is_in_grace: false,
    is_restricted: false,
    is_comped: false,
  };

  // Don't render gate context when not authenticated
  if (!session) {
    return <>{children}</>;
  }

  return (
    <SubscriptionGateContext.Provider value={gate}>
      {children}
    </SubscriptionGateContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Route wrapper — blocks gated routes when subscription is restricted
// ---------------------------------------------------------------------------

interface SubscriptionGatedRouteProps {
  children: ReactNode;
}

export function SubscriptionGatedRoute({ children }: SubscriptionGatedRouteProps) {
  const gate = useSubscriptionGateContext();

  if (gate.is_restricted) {
    return (
      <div className="p-6 max-w-2xl mx-auto mt-12">
        <SubscriptionBlockedBanner gate={gate} />
      </div>
    );
  }

  return (
    <>
      {gate.is_in_grace && (
        <div className="px-6 pt-4">
          <SubscriptionBlockedBanner gate={gate} />
        </div>
      )}
      {children}
    </>
  );
}
