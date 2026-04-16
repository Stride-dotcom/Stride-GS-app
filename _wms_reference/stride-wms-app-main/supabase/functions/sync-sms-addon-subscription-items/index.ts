import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-04-10",
  httpClient: Stripe.createFetchHttpClient(),
});

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-sms-billing-sync-token",
};

interface SyncRequest {
  tenant_id?: string | null;
  dry_run?: boolean;
  source?: string | null;
}

interface RoleRow {
  roles?: { name?: string | null } | null;
}

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toBoolean(value: unknown): boolean {
  return value === true;
}

function toNullableUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

function normalizeFirstMonthPolicy(): "prorate" | "full_month" {
  const policy = (Deno.env.get("SMS_MONTHLY_FIRST_MONTH_POLICY") || "prorate")
    .trim()
    .toLowerCase();
  return policy === "full_month" ? "full_month" : "prorate";
}

function normalizeDeactivationPolicy(): "prorate" | "no_proration" {
  const policy = (Deno.env.get("SMS_MONTHLY_DEACTIVATION_PRORATION") || "prorate")
    .trim()
    .toLowerCase();
  if (policy === "none" || policy === "no_proration" || policy === "off") {
    return "no_proration";
  }
  return "prorate";
}

function toProrationBehavior(
  policy: "prorate" | "full_month" | "no_proration",
): "create_prorations" | "none" {
  return policy === "prorate" ? "create_prorations" : "none";
}

function extractStripePriceId(item: Stripe.SubscriptionItem): string | null {
  const rawPrice = item.price;
  if (!rawPrice) return null;
  if (typeof rawPrice === "string") return rawPrice;
  return toNonEmptyString(rawPrice.id);
}

function isMissingSmsSyncColumnsError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as { code?: string }).code : "";
  const message =
    typeof error === "object" && error !== null ? String((error as { message?: string }).message || "") : "";
  const details =
    typeof error === "object" && error !== null ? String((error as { details?: string }).details || "") : "";
  const normalized = `${message} ${details}`.toLowerCase();
  if (code === "42703") return true;
  return (
    normalized.includes("stripe_subscription_item_id_sms_monthly") ||
    normalized.includes("stripe_subscription_item_id_sms_metered") ||
    normalized.includes("sms_subscription_items_synced_at") ||
    normalized.includes("sms_subscription_items_sync_error")
  );
}

async function setSmsSyncColumns(
  supabase: any,
  tenantId: string,
  values: {
    monthlyItemId: string | null;
    meteredItemId: string | null;
    perUserItemId?: string | null;
    error: string | null;
  },
): Promise<void> {
  const payload: Record<string, unknown> = {
    stripe_subscription_item_id_sms_monthly: values.monthlyItemId,
    stripe_subscription_item_id_sms_metered: values.meteredItemId,
    stripe_subscription_item_id_per_user: values.perUserItemId ?? null,
    sms_subscription_items_synced_at: new Date().toISOString(),
    sms_subscription_items_sync_error: values.error,
  };

  const { error } = await supabase.from("tenant_subscriptions").update(payload).eq("tenant_id", tenantId);
  if (!error) return;

  if (isMissingSmsSyncColumnsError(error)) {
    console.warn("SMS Stripe sync columns not present yet; skipping tenant_subscriptions sync-field update.");
    return;
  }

  throw new Error(error.message || "Failed to persist SMS subscription item sync fields.");
}

async function resolveActingTenantId(
  req: Request,
  requestedTenantId: string | null,
): Promise<{ ok: true; tenantId: string; mode: "job_token" | "authenticated" } | { ok: false; response: Response }> {
  const expectedJobToken = (Deno.env.get("SMS_BILLING_SYNC_JOB_TOKEN") || "").trim();
  const providedJobToken = (req.headers.get("x-sms-billing-sync-token") || "").trim();

  if (expectedJobToken && providedJobToken === expectedJobToken) {
    if (!requestedTenantId) {
      return {
        ok: false,
        response: jsonResponse(
          { ok: false, error: "tenant_id is required when using job-token SMS billing sync mode." },
          400,
        ),
      };
    }
    return { ok: true, tenantId: requestedTenantId, mode: "job_token" };
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, response: jsonResponse({ ok: false, error: "Unauthorized" }, 401) };
  }

  const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const token = authHeader.replace("Bearer ", "");
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(token);
  if (authError || !user) {
    return { ok: false, response: jsonResponse({ ok: false, error: "Unauthorized" }, 401) };
  }

  const { data: roleRows, error: roleError } = await authClient
    .from("user_roles")
    .select("roles:role_id(name)")
    .eq("user_id", user.id)
    .is("deleted_at", null);

  if (roleError) {
    return { ok: false, response: jsonResponse({ ok: false, error: roleError.message }, 500) };
  }

  const roleNames = (Array.isArray(roleRows) ? roleRows : [])
    .map((row) => (row as RoleRow)?.roles?.name ?? null)
    .map((name) => toNonEmptyString(name))
    .filter((name): name is string => Boolean(name));

  const isAdminDev = roleNames.includes("admin_dev");
  const canSync = isAdminDev || roleNames.includes("admin") || roleNames.includes("billing_manager");
  if (!canSync) {
    return {
      ok: false,
      response: jsonResponse(
        { ok: false, error: "Only admin_dev, admin, or billing_manager can sync SMS billing items." },
        403,
      ),
    };
  }

  const { data: userRow, error: userRowError } = await authClient
    .from("users")
    .select("tenant_id")
    .eq("id", user.id)
    .maybeSingle();
  if (userRowError || !userRow?.tenant_id) {
    return { ok: false, response: jsonResponse({ ok: false, error: "Unable to resolve user tenant." }, 400) };
  }

  const tenantId = isAdminDev && requestedTenantId ? requestedTenantId : String(userRow.tenant_id);
  return { ok: true, tenantId, mode: "authenticated" };
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  if (!STRIPE_SECRET_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ ok: false, error: "Required environment variables are not configured." }, 500);
  }

  const body = (await req.json().catch(() => ({}))) as SyncRequest;
  const requestedTenantId = toNullableUuid(body.tenant_id ?? null);
  const dryRun = toBoolean(body.dry_run);
  const source = toNonEmptyString(body.source) || "manual_sync";

  const actingTenantResolution = await resolveActingTenantId(req, requestedTenantId);
  if (!actingTenantResolution.ok) return actingTenantResolution.response;
  const tenantId = actingTenantResolution.tenantId;

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const firstMonthPolicy = normalizeFirstMonthPolicy();
    const deactivationPolicy = normalizeDeactivationPolicy();
    const monthlyAddProration = toProrationBehavior(firstMonthPolicy);
    const monthlyRemoveProration = toProrationBehavior(deactivationPolicy);

    const { data: billingOverride } = await (supabase as any)
      .from("tenant_billing_overrides")
      .select("is_comped, expires_at")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const isComped =
      billingOverride?.is_comped === true &&
      (!billingOverride?.expires_at || new Date(String(billingOverride.expires_at)).getTime() > Date.now());

    const { data: subscriptionRow, error: subscriptionError } = await supabase
      .from("tenant_subscriptions")
      .select(
        "tenant_id, plan_id, stripe_subscription_id, stripe_subscription_item_id_sms_monthly, stripe_subscription_item_id_sms_metered",
      )
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (subscriptionError) {
      throw new Error(subscriptionError.message || "Failed to load tenant subscription.");
    }

    const stripeSubscriptionId = toNonEmptyString(subscriptionRow?.stripe_subscription_id);
    if (!stripeSubscriptionId) {
      await setSmsSyncColumns(supabase, tenantId, {
        monthlyItemId: null,
        meteredItemId: null,
        error: "No stripe_subscription_id is linked to this tenant.",
      }).catch(() => undefined);

      return jsonResponse({
        ok: true,
        tenant_id: tenantId,
        mode: actingTenantResolution.mode,
        skipped: true,
        reason: "no_stripe_subscription_id",
      });
    }

    const planId = toNullableUuid(subscriptionRow?.plan_id ?? null);
    let planRow: Record<string, unknown> | null = null;

    if (planId) {
      const { data, error } = await supabase
        .from("saas_plans")
        .select(
          "id, name, stripe_price_id_per_user, stripe_price_id_sms_monthly_addon, stripe_price_id_sms_segment_metered",
        )
        .eq("id", planId)
        .maybeSingle();
      if (error) throw new Error(error.message || "Failed to load tenant plan.");
      planRow = (data as Record<string, unknown> | null) ?? null;
    }

    if (!planRow) {
      const { data, error } = await supabase
        .from("saas_plans")
        .select(
          "id, name, stripe_price_id_per_user, stripe_price_id_sms_monthly_addon, stripe_price_id_sms_segment_metered",
        )
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message || "Failed to load active SaaS plan.");
      planRow = (data as Record<string, unknown> | null) ?? null;
    }

    if (!planRow) {
      throw new Error("No SaaS plan is configured for this tenant.");
    }

    const smsMonthlyPriceId = toNonEmptyString(planRow.stripe_price_id_sms_monthly_addon);
    const smsMeteredPriceId = toNonEmptyString(planRow.stripe_price_id_sms_segment_metered);
    const perUserPriceId = toNonEmptyString(planRow.stripe_price_id_per_user);

    const { data: addonRow } = await supabase
      .from("tenant_sms_addon_activation")
      .select("is_active, activation_status")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const { data: senderRow } = await supabase
      .from("tenant_sms_sender_profiles")
      .select("provisioning_status")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const addonActive = addonRow?.is_active === true && addonRow?.activation_status === "active";
    const senderApproved = senderRow?.provisioning_status === "approved";
    const shouldBillSms = !isComped && addonActive && senderApproved;

    const stripeSubscription = await stripe.subscriptions.retrieve(stripeSubscriptionId, {
      expand: ["items.data.price"],
    });
    const items = Array.isArray(stripeSubscription.items?.data) ? stripeSubscription.items.data : [];

    const findItemByPrice = (priceId: string | null): Stripe.SubscriptionItem | null => {
      if (!priceId) return null;
      return items.find((item: any) => extractStripePriceId(item) === priceId) ?? null;
    };

    let monthlyItem = findItemByPrice(smsMonthlyPriceId);
    let meteredItem = findItemByPrice(smsMeteredPriceId);
    const perUserItem = findItemByPrice(perUserPriceId);

    const operations: string[] = [];

    if (shouldBillSms) {
      if (!smsMonthlyPriceId || !smsMeteredPriceId) {
        const missingMessage =
          "SMS Stripe price IDs are not configured on the active SaaS plan (need monthly + metered).";
        await setSmsSyncColumns(supabase, tenantId, {
          monthlyItemId: monthlyItem?.id ?? null,
          meteredItemId: meteredItem?.id ?? null,
          perUserItemId: perUserItem?.id ?? null,
          error: missingMessage,
        }).catch(() => undefined);

        return jsonResponse({
          ok: false,
          tenant_id: tenantId,
          error: missingMessage,
          should_bill_sms: true,
          addon_active: addonActive,
          sender_approved: senderApproved,
        }, 400);
      }

      if (!monthlyItem) {
        operations.push("add_sms_monthly_item");
        if (!dryRun) {
          monthlyItem = await stripe.subscriptionItems.create({
            subscription: stripeSubscriptionId,
            price: smsMonthlyPriceId,
            quantity: 1,
            proration_behavior: monthlyAddProration,
          });
        }
      } else if ((monthlyItem.quantity ?? 1) !== 1) {
        operations.push("normalize_sms_monthly_quantity");
        if (!dryRun) {
          await stripe.subscriptionItems.update(monthlyItem.id, {
            quantity: 1,
            proration_behavior: monthlyAddProration,
          });
        }
      }

      if (!meteredItem) {
        operations.push("add_sms_metered_item");
        if (!dryRun) {
          meteredItem = await stripe.subscriptionItems.create({
            subscription: stripeSubscriptionId,
            price: smsMeteredPriceId,
            quantity: 1,
            proration_behavior: "none",
          });
        }
      }
    } else {
      if (monthlyItem) {
        operations.push("remove_sms_monthly_item");
        if (!dryRun) {
          await stripe.subscriptionItems.del(monthlyItem.id, {
            proration_behavior: monthlyRemoveProration,
            clear_usage: false,
          });
        }
        monthlyItem = null;
      }

      if (meteredItem) {
        operations.push("remove_sms_metered_item");
        if (!dryRun) {
          await stripe.subscriptionItems.del(meteredItem.id, {
            proration_behavior: "none",
            clear_usage: false,
          });
        }
        meteredItem = null;
      }
    }

    await setSmsSyncColumns(supabase, tenantId, {
      monthlyItemId: monthlyItem?.id ?? null,
      meteredItemId: meteredItem?.id ?? null,
      perUserItemId: perUserItem?.id ?? null,
      error: null,
    });

    return jsonResponse({
      ok: true,
      tenant_id: tenantId,
      mode: actingTenantResolution.mode,
      source,
      dry_run: dryRun,
      first_month_policy: firstMonthPolicy,
      deactivation_policy: deactivationPolicy,
      should_bill_sms: shouldBillSms,
      is_comped: isComped,
      addon_active: addonActive,
      sender_approved: senderApproved,
      stripe_subscription_id: stripeSubscriptionId,
      sms_monthly_price_id: smsMonthlyPriceId,
      sms_metered_price_id: smsMeteredPriceId,
      sms_monthly_item_id: monthlyItem?.id ?? null,
      sms_metered_item_id: meteredItem?.id ?? null,
      operations,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown sync error";
    console.error("sync-sms-addon-subscription-items error:", message);
    return jsonResponse({ ok: false, error: message, tenant_id: tenantId }, 500);
  }
});
