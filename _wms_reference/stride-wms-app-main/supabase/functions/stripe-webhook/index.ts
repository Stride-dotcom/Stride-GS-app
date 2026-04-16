// =============================================================================
// Stripe Webhook Handler — Stride SaaS Phase 5 v3
// Server-to-server only. No CORS. No OPTIONS handler.
// =============================================================================

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-04-10",
  httpClient: Stripe.createFetchHttpClient(),
});

function getServiceClient() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mapStripeStatus(stripeStatus: string): string {
  switch (stripeStatus) {
    case "active":
    case "trialing":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
    case "unpaid":
    case "incomplete_expired":
      return "canceled";
    default:
      return stripeStatus;
  }
}

function toIsoFromUnix(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractPriceId(item: Stripe.SubscriptionItem): string | null {
  if (!item.price) return null;
  if (typeof item.price === "string") return item.price;
  return toNonEmptyString(item.price.id);
}

function isMissingSubscriptionItemColumnsError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as { code?: string }).code : "";
  const message =
    typeof error === "object" && error !== null ? String((error as { message?: string }).message || "") : "";
  const details =
    typeof error === "object" && error !== null ? String((error as { details?: string }).details || "") : "";
  const normalized = `${message} ${details}`.toLowerCase();
  if (code === "42703") return true;
  return (
    normalized.includes("stripe_subscription_item_id_per_user") ||
    normalized.includes("stripe_subscription_item_id_sms_monthly") ||
    normalized.includes("stripe_subscription_item_id_sms_metered")
  );
}

async function upsertSubscriptionItemSnapshots(
  supabase: ReturnType<typeof getServiceClient>,
  tenantId: string,
  subscription: Stripe.Subscription,
) {
  const { data: tenantSubscriptionRow, error: tenantSubscriptionError } = await supabase
    .from("tenant_subscriptions")
    .select("plan_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (tenantSubscriptionError) {
    console.error("upsertSubscriptionItemSnapshots tenant_subscriptions lookup error:", tenantSubscriptionError.message);
    return;
  }

  const planId = tenantSubscriptionRow?.plan_id ?? null;
  if (!planId) return;

  const { data: planRow, error: planError } = await supabase
    .from("saas_plans")
    .select("stripe_price_id_per_user, stripe_price_id_sms_monthly_addon, stripe_price_id_sms_segment_metered")
    .eq("id", planId)
    .maybeSingle();

  if (planError) {
    console.error("upsertSubscriptionItemSnapshots plan lookup error:", planError.message);
    return;
  }

  const perUserPriceId = toNonEmptyString(planRow?.stripe_price_id_per_user);
  const smsMonthlyPriceId = toNonEmptyString(planRow?.stripe_price_id_sms_monthly_addon);
  const smsMeteredPriceId = toNonEmptyString(planRow?.stripe_price_id_sms_segment_metered);

  const items = Array.isArray(subscription.items?.data) ? subscription.items.data : [];
  const itemByPriceId = (priceId: string | null): string | null => {
    if (!priceId) return null;
    return items.find((item: any) => extractPriceId(item) === priceId)?.id ?? null;
  };

  const payload = {
    stripe_subscription_item_id_per_user: itemByPriceId(perUserPriceId),
    stripe_subscription_item_id_sms_monthly: itemByPriceId(smsMonthlyPriceId),
    stripe_subscription_item_id_sms_metered: itemByPriceId(smsMeteredPriceId),
    sms_subscription_items_synced_at: new Date().toISOString(),
    sms_subscription_items_sync_error: null,
  };

  const { error: updateError } = await supabase
    .from("tenant_subscriptions")
    .update(payload)
    .eq("tenant_id", tenantId);

  if (!updateError) return;
  if (isMissingSubscriptionItemColumnsError(updateError)) {
    console.warn("subscription item snapshot columns not available yet; skipping snapshot persistence");
    return;
  }

  console.error("upsertSubscriptionItemSnapshots update error:", updateError.message);
}

async function tenantExists(
  supabase: ReturnType<typeof getServiceClient>,
  tenantId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("tenants")
    .select("id")
    .eq("id", tenantId)
    .maybeSingle();
  if (error) {
    console.error("tenantExists check error:", error.message);
    return false;
  }
  return data !== null;
}

async function resolveTenantByStripeMapping(
  supabase: ReturnType<typeof getServiceClient>,
  customerId: string | null,
  subscriptionId: string | null
): Promise<{ tenant_id: string; resolvedBy: "customer" | "subscription" } | null> {
  if (customerId) {
    const { data: byCustomer, error: customerLookupError } = await supabase
      .from("tenant_subscriptions")
      .select("tenant_id")
      .eq("stripe_customer_id", customerId)
      .maybeSingle();

    if (customerLookupError) {
      console.error("resolveTenantByStripeMapping customer lookup error:", customerLookupError.message);
    } else if (byCustomer?.tenant_id) {
      return { tenant_id: byCustomer.tenant_id, resolvedBy: "customer" };
    }
  }

  if (subscriptionId) {
    const { data: bySubscription, error: subscriptionLookupError } = await supabase
      .from("tenant_subscriptions")
      .select("tenant_id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();

    if (subscriptionLookupError) {
      console.error(
        "resolveTenantByStripeMapping subscription lookup error:",
        subscriptionLookupError.message
      );
    } else if (bySubscription?.tenant_id) {
      return { tenant_id: bySubscription.tenant_id, resolvedBy: "subscription" };
    }
  }

  return null;
}

async function upsertSubscriptionInvoiceSnapshot(
  supabase: ReturnType<typeof getServiceClient>,
  invoice: Stripe.Invoice
) {
  const anyInvoice = invoice as unknown as Record<string, any>;
  const customerId =
    typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id ?? null;
  const subscriptionId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id ?? null;

  const resolved = await resolveTenantByStripeMapping(supabase, customerId, subscriptionId);
  if (!resolved) {
    console.warn(
      `invoice snapshot upsert: no tenant found for customer=${customerId ?? "null"} subscription=${subscriptionId ?? "null"}, skipping`
    );
    return;
  }

  const firstLine = Array.isArray(invoice.lines?.data) && invoice.lines.data.length > 0
    ? (invoice.lines.data[0] as any)
    : null;
  const periodStart = toIsoFromUnix(anyInvoice.period_start ?? firstLine?.period?.start);
  const periodEnd = toIsoFromUnix(anyInvoice.period_end ?? firstLine?.period?.end);
  const dueDate = toIsoFromUnix(anyInvoice.due_date);
  const paidAt = toIsoFromUnix(anyInvoice.status_transitions?.paid_at);
  const createdAt = toIsoFromUnix(anyInvoice.created);

  const { error } = await supabase.rpc("rpc_upsert_subscription_invoice_from_stripe", {
    p_tenant_id: resolved.tenant_id,
    p_stripe_invoice_id: invoice.id,
    p_stripe_customer_id: customerId,
    p_stripe_subscription_id: subscriptionId,
    p_status: anyInvoice.status ?? "draft",
    p_currency: anyInvoice.currency ?? null,
    p_amount_due: Number(anyInvoice.amount_due ?? 0) / 100,
    p_amount_paid: Number(anyInvoice.amount_paid ?? 0) / 100,
    p_amount_remaining: Number(anyInvoice.amount_remaining ?? 0) / 100,
    p_hosted_invoice_url: anyInvoice.hosted_invoice_url ?? null,
    p_invoice_pdf: anyInvoice.invoice_pdf ?? null,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_due_date: dueDate,
    p_paid_at: paidAt,
    p_stripe_created_at: createdAt,
    p_metadata: anyInvoice.metadata ?? {},
  });

  if (error) {
    console.error("rpc_upsert_subscription_invoice_from_stripe error:", error.message);
  } else {
    console.log(`invoice snapshot upserted for tenant ${resolved.tenant_id} (${invoice.id})`);
  }
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleCheckoutCompleted(
  supabase: ReturnType<typeof getServiceClient>,
  event: Stripe.Event
) {
  const session = event.data.object as Stripe.Checkout.Session;
  const tenantId = session.metadata?.tenant_id;
  const planId = session.metadata?.plan_id ?? null;

  if (!tenantId) {
    console.warn("checkout.session.completed: no metadata.tenant_id, skipping");
    return;
  }

  const exists = await tenantExists(supabase, tenantId);
  if (!exists) {
    console.warn(`checkout.session.completed: tenant ${tenantId} not found, skipping`);
    return;
  }

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id ?? null;

  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id ?? null;

  const { error } = await supabase.rpc(
    "rpc_initialize_tenant_subscription_from_checkout",
    {
      p_tenant_id: tenantId,
      p_stripe_customer_id: customerId,
      p_stripe_subscription_id: subscriptionId,
      p_plan_id: planId,
    }
  );

  if (error) {
    console.error("rpc_initialize_tenant_subscription_from_checkout error:", error.message);
  } else {
    console.log(`checkout.session.completed: bootstrapped tenant ${tenantId}`);
  }

  if (subscriptionId) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
        expand: ["items.data.price"],
      });
      await upsertSubscriptionItemSnapshots(supabase, tenantId, subscription);
    } catch (snapshotError) {
      console.error(
        `checkout.session.completed: unable to snapshot subscription item IDs for tenant ${tenantId}:`,
        snapshotError instanceof Error ? snapshotError.message : snapshotError,
      );
    }
  }
}

async function handleInvoicePaid(
  supabase: ReturnType<typeof getServiceClient>,
  event: Stripe.Event
) {
  const invoice = event.data.object as Stripe.Invoice;
  const subscriptionId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id ?? null;

  if (!subscriptionId) {
    console.warn("invoice.paid: no subscription_id, skipping");
    return;
  }

  const { error } = await supabase.rpc("rpc_mark_payment_ok", {
    p_stripe_subscription_id: subscriptionId,
  });

  if (error) {
    console.error("rpc_mark_payment_ok error:", error.message);
  } else {
    console.log(`invoice.paid: marked ok for subscription ${subscriptionId}`);
  }

  await upsertSubscriptionInvoiceSnapshot(supabase, invoice);
}

async function handleInvoicePaymentFailed(
  supabase: ReturnType<typeof getServiceClient>,
  event: Stripe.Event
) {
  const invoice = event.data.object as Stripe.Invoice;
  const subscriptionId =
    typeof invoice.subscription === "string"
      ? invoice.subscription
      : invoice.subscription?.id ?? null;

  if (!subscriptionId) {
    console.warn("invoice.payment_failed: no subscription_id, skipping");
    return;
  }

  const { error } = await supabase.rpc("rpc_mark_payment_failed_and_start_grace", {
    p_stripe_subscription_id: subscriptionId,
  });

  if (error) {
    console.error("rpc_mark_payment_failed_and_start_grace error:", error.message);
  } else {
    console.log(`invoice.payment_failed: started grace for subscription ${subscriptionId}`);
  }

  await upsertSubscriptionInvoiceSnapshot(supabase, invoice);
}

async function handleInvoiceFinalized(
  supabase: ReturnType<typeof getServiceClient>,
  event: Stripe.Event
) {
  const invoice = event.data.object as Stripe.Invoice;
  await upsertSubscriptionInvoiceSnapshot(supabase, invoice);
}

async function handleInvoiceUpdated(
  supabase: ReturnType<typeof getServiceClient>,
  event: Stripe.Event
) {
  const invoice = event.data.object as Stripe.Invoice;
  await upsertSubscriptionInvoiceSnapshot(supabase, invoice);
}

async function handleSubscriptionUpdated(
  supabase: ReturnType<typeof getServiceClient>,
  event: Stripe.Event
) {
  const subscription = event.data.object as Stripe.Subscription;

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id ?? null;

  const resolved = await resolveTenantByStripeMapping(supabase, customerId, subscription.id);
  if (!resolved) {
    console.warn(
      `customer.subscription.updated: no tenant found for customer=${customerId ?? "null"} subscription=${subscription.id}, skipping`
    );
    return;
  }

  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  const { error } = await supabase.rpc(
    "rpc_upsert_tenant_subscription_from_stripe",
    {
      p_tenant_id: resolved.tenant_id,
      p_stripe_customer_id: customerId,
      p_stripe_subscription_id: subscription.id,
      p_status: mapStripeStatus(subscription.status),
      p_current_period_end: periodEnd,
      p_cancel_at_period_end: subscription.cancel_at_period_end ?? false,
    }
  );

  if (error) {
    console.error("rpc_upsert_tenant_subscription_from_stripe error:", error.message);
  } else {
    console.log(
      `customer.subscription.updated: upserted for tenant ${resolved.tenant_id} (resolved by ${resolved.resolvedBy})`
    );
  }

  await upsertSubscriptionItemSnapshots(supabase, resolved.tenant_id, subscription);
}

async function handleSubscriptionDeleted(
  supabase: ReturnType<typeof getServiceClient>,
  event: Stripe.Event
) {
  const subscription = event.data.object as Stripe.Subscription;

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id ?? null;

  const resolved = await resolveTenantByStripeMapping(supabase, customerId, subscription.id);
  if (!resolved) {
    console.warn(
      `customer.subscription.deleted: no tenant found for customer=${customerId ?? "null"} subscription=${subscription.id}, skipping`
    );
    return;
  }

  const { error } = await supabase.rpc(
    "rpc_upsert_tenant_subscription_from_stripe",
    {
      p_tenant_id: resolved.tenant_id,
      p_stripe_customer_id: customerId,
      p_stripe_subscription_id: subscription.id,
      p_status: "canceled",
      p_cancel_at_period_end: false,
    }
  );

  if (error) {
    console.error("rpc_upsert_tenant_subscription_from_stripe (deleted) error:", error.message);
  } else {
    console.log(
      `customer.subscription.deleted: set canceled for tenant ${resolved.tenant_id} (resolved by ${resolved.resolvedBy})`
    );
  }

  const { error: clearError } = await supabase
    .from("tenant_subscriptions")
    .update({
      stripe_subscription_item_id_per_user: null,
      stripe_subscription_item_id_sms_monthly: null,
      stripe_subscription_item_id_sms_metered: null,
      sms_subscription_items_synced_at: new Date().toISOString(),
      sms_subscription_items_sync_error: null,
    })
    .eq("tenant_id", resolved.tenant_id);

  if (clearError && !isMissingSubscriptionItemColumnsError(clearError)) {
    console.error("customer.subscription.deleted: failed to clear item snapshot columns:", clearError.message);
  }
}

// ---------------------------------------------------------------------------
// Main handler — NO CORS, server-to-server only
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  // Only accept POST
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature header", { status: 400 });
  }

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", (err as Error).message);
    return new Response("Webhook signature verification failed", { status: 400 });
  }

  const supabase = getServiceClient();

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(supabase, event);
        break;
      case "invoice.paid":
        await handleInvoicePaid(supabase, event);
        break;
      case "invoice.payment_failed":
        await handleInvoicePaymentFailed(supabase, event);
        break;
      case "invoice.finalized":
        await handleInvoiceFinalized(supabase, event);
        break;
      case "invoice.updated":
        await handleInvoiceUpdated(supabase, event);
        break;
      case "customer.subscription.updated":
        await handleSubscriptionUpdated(supabase, event);
        break;
      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(supabase, event);
        break;
      default:
        console.log(`Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error(`Error handling ${event.type}:`, (err as Error).message);
    // Always return 200 to prevent Stripe retries for handled events
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
