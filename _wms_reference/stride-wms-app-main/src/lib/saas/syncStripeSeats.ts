import { supabase } from "@/integrations/supabase/client";

/**
 * Best-effort helper: seat billing sync must never block user admin flows.
 * If the tenant isn't subscribed yet (or seat pricing isn't configured), the function no-ops.
 */
export async function syncStripeSubscriptionSeatsBestEffort(reason: string): Promise<void> {
  try {
    const { error } = await supabase.functions.invoke("sync-stripe-subscription-seats", {
      body: { reason },
    });
    if (error) {
      console.warn("[seat-sync] sync-stripe-subscription-seats error:", error.message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[seat-sync] sync-stripe-subscription-seats invoke failed:", message);
  }
}

