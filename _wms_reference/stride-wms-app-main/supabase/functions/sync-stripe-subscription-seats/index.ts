import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-04-10",
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toPositiveInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number.parseInt(value, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}

function isMissingSeatItemSnapshotColumnError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as { code?: string }).code : "";
  const message =
    typeof error === "object" && error !== null ? String((error as { message?: string }).message || "") : "";
  const details =
    typeof error === "object" && error !== null ? String((error as { details?: string }).details || "") : "";
  const normalized = `${message} ${details}`.toLowerCase();
  if (code === "42703") return true;
  return normalized.includes("stripe_subscription_item_id_per_user");
}

type RoleRow = { name?: unknown; is_system?: unknown } | null;

function normalizeRoleName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  if (!STRIPE_SECRET_KEY) {
    return jsonResponse({ ok: false, error: "Stripe secret key is not configured" }, 500);
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ ok: false, error: "Supabase env vars are not configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return jsonResponse({ ok: false, error: "Missing authorization header" }, 401);
  }

  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) {
    return jsonResponse({ ok: false, error: "Missing authorization token" }, 401);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    }

    const { data: roleRows, error: roleError } = await supabase
      .from("user_roles")
      .select("roles:role_id(name, is_system)")
      .eq("user_id", user.id)
      .is("deleted_at", null);

    if (roleError) {
      return jsonResponse({ ok: false, error: roleError.message }, 500);
    }

    const roleNames = (Array.isArray(roleRows) ? roleRows : [])
      .map((row: any) => (row?.roles ?? null) as RoleRow)
      .map((role) => normalizeRoleName(role?.name))
      .filter((name): name is string => Boolean(name));

    const canSyncSeats = roleNames.some((name) => ["admin", "admin_dev", "billing_manager"].includes(name));
    if (!canSyncSeats) {
      return jsonResponse({ ok: false, error: "Only admin, admin_dev, or billing_manager can sync billing seats" }, 403);
    }

    const { data: profileRow, error: profileError } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profileRow?.tenant_id) {
      return jsonResponse({ ok: false, error: "User tenant not found" }, 400);
    }

    const tenantId = profileRow.tenant_id as string;

    // If the tenant is comped, skip Stripe mutations (billing is intentionally bypassed).
    const { data: billingOverride, error: billingOverrideError } = await (supabase as any)
      .from("tenant_billing_overrides")
      .select("is_comped, expires_at")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (billingOverrideError) {
      return jsonResponse({ ok: false, error: billingOverrideError.message }, 500);
    }

    const isCompedTenant =
      billingOverride?.is_comped === true &&
      (!billingOverride?.expires_at || new Date(String(billingOverride.expires_at)).getTime() > Date.now());

    if (isCompedTenant) {
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: "comped_override_active",
      });
    }

    const { data: subscriptionRow, error: subscriptionError } = await supabase
      .from("tenant_subscriptions")
      .select("tenant_id, stripe_subscription_id, plan_id")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (subscriptionError) {
      return jsonResponse({ ok: false, error: subscriptionError.message }, 500);
    }

    const stripeSubscriptionId = subscriptionRow?.stripe_subscription_id ?? null;
    if (!stripeSubscriptionId) {
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: "no_stripe_subscription_id",
      });
    }

    // Resolve per-user price ID from the tenant's plan (preferred), else first active plan.
    const planId = subscriptionRow?.plan_id ?? null;
    let perUserPriceId: string | null = null;

    if (planId) {
      const { data: planRow, error: planError } = await supabase
        .from("saas_plans")
        .select("stripe_price_id_per_user")
        .eq("id", planId)
        .maybeSingle();
      if (planError) {
        return jsonResponse({ ok: false, error: planError.message }, 500);
      }
      perUserPriceId = typeof planRow?.stripe_price_id_per_user === "string" ? planRow.stripe_price_id_per_user : null;
    } else {
      const { data: planRow, error: planError } = await supabase
        .from("saas_plans")
        .select("stripe_price_id_per_user")
        .eq("is_active", true)
        .not("stripe_price_id_per_user", "is", null)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (planError) {
        return jsonResponse({ ok: false, error: planError.message }, 500);
      }
      perUserPriceId = typeof planRow?.stripe_price_id_per_user === "string" ? planRow.stripe_price_id_per_user : null;
    }

    if (!perUserPriceId) {
      // Plan does not have seat-based pricing configured; nothing to sync.
      return jsonResponse({
        ok: true,
        skipped: true,
        reason: "no_per_user_price_configured",
      });
    }

    const { data: seatCountRaw, error: seatCountError } = await (supabase as any).rpc(
      "rpc_get_tenant_billable_seat_count",
      {
        p_tenant_id: tenantId,
      }
    );

    if (seatCountError) {
      return jsonResponse({ ok: false, error: seatCountError.message }, 500);
    }

    const seatCount = toPositiveInt(seatCountRaw, 1);

    const subscription = await stripe.subscriptions.retrieve(String(stripeSubscriptionId), {
      expand: ["items.data.price"],
    });

    const items = Array.isArray(subscription.items?.data) ? subscription.items.data : [];
    const perUserItem = items.find((item: any) => {
      const anyItem = item as unknown as { price?: any };
      const priceId = typeof anyItem?.price === "string" ? anyItem.price : anyItem?.price?.id ?? null;
      return priceId === perUserPriceId;
    });

    let action: "noop" | "updated_quantity" | "added_item" = "noop";
    let previousQuantity: number | null = null;

    if (perUserItem) {
      previousQuantity = typeof perUserItem.quantity === "number" ? perUserItem.quantity : null;

      if (previousQuantity !== seatCount) {
        await stripe.subscriptionItems.update(perUserItem.id, {
          quantity: seatCount,
          proration_behavior: "create_prorations",
        });
        action = "updated_quantity";
      }
    } else {
      // Add a new per-user subscription item while preserving existing items.
      const updateItems: any[] = items.map((item: any) => ({
        id: item.id,
        quantity: typeof item.quantity === "number" ? item.quantity : 1,
      }));
      updateItems.push({
        price: perUserPriceId,
        quantity: seatCount,
      });

      await stripe.subscriptions.update(String(stripeSubscriptionId), {
        items: updateItems,
        proration_behavior: "create_prorations",
      });
      action = "added_item";
    }

    // Persist the computed count and per-user item snapshot for visibility.
    const { error: persistError } = await supabase
      .from("tenant_subscriptions")
      .update({
        billable_seat_count: seatCount,
        billable_seat_count_updated_at: new Date().toISOString(),
        stripe_subscription_item_id_per_user: perUserItem?.id ?? null,
      })
      .eq("tenant_id", tenantId);
    if (persistError && !isMissingSeatItemSnapshotColumnError(persistError)) {
      return jsonResponse({ ok: false, error: persistError.message }, 500);
    }

    return jsonResponse({
      ok: true,
      tenant_id: tenantId,
      stripe_subscription_id: stripeSubscriptionId,
      per_user_price_id: perUserPriceId,
      seat_count: seatCount,
      previous_quantity: previousQuantity,
      action,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("sync-stripe-subscription-seats error:", message);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});

