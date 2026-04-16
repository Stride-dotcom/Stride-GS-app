import { AlertTriangle } from "lucide-react";
import type { SubscriptionGateState } from "@/hooks/useSubscriptionGate";

interface SubscriptionBlockedBannerProps {
  gate: SubscriptionGateState;
}

export function SubscriptionBlockedBanner({ gate }: SubscriptionBlockedBannerProps) {
  if (gate.is_active && !gate.is_in_grace) return null;

  const graceDate = gate.grace_until
    ? new Date(gate.grace_until).toLocaleDateString()
    : null;

  return (
    <div className="bg-destructive/10 border border-destructive/30 rounded-md p-4 mb-4 flex items-start gap-3">
      <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
      <div className="text-sm">
        {gate.is_in_grace ? (
          <p>
            <span className="font-semibold">Payment issue detected.</span>{" "}
            Your subscription is in a grace period
            {graceDate ? ` until ${graceDate}` : ""}. Some features are limited.
            Please update your payment method to avoid service interruption.
          </p>
        ) : gate.is_restricted ? (
          <p>
            <span className="font-semibold">Subscription inactive.</span>{" "}
            Your subscription has expired or been canceled. Creating new shipments
            and receiving are temporarily unavailable. Please contact your
            administrator or renew your subscription.
          </p>
        ) : null}
      </div>
    </div>
  );
}
