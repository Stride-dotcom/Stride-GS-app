import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const APP_URL = Deno.env.get("APP_URL") ?? "";

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

function resolveReturnUrl(req: Request): string {
  const configuredOrigin = APP_URL.trim().replace(/\/+$/, "");
  if (configuredOrigin) {
    return `${configuredOrigin}/subscription/update-payment`;
  }

  const origin = (req.headers.get("origin") ?? "").trim().replace(/\/+$/, "");
  if (origin.startsWith("http://") || origin.startsWith("https://")) {
    return `${origin}/subscription/update-payment`;
  }

  return "http://localhost:5173/subscription/update-payment";
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  try {
    if (!STRIPE_SECRET_KEY) {
      return jsonResponse({ ok: false, error: "Stripe secret key is not configured" }, 500);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ ok: false, error: "Missing authorization header" }, 401);
    }

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    }

    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError || !profile?.tenant_id) {
      return jsonResponse({ ok: false, error: "User tenant not found" }, 400);
    }

    const { data: billingOverride, error: billingOverrideError } = await (supabase as any)
      .from("tenant_billing_overrides")
      .select("is_comped, expires_at")
      .eq("tenant_id", profile.tenant_id)
      .maybeSingle();
    if (billingOverrideError) {
      return jsonResponse({ ok: false, error: billingOverrideError.message }, 500);
    }

    const isCompedTenant =
      billingOverride?.is_comped === true &&
      (!billingOverride?.expires_at ||
        new Date(String(billingOverride.expires_at)).getTime() > Date.now());
    if (isCompedTenant) {
      return jsonResponse(
        {
          ok: false,
          error:
            "This tenant is currently marked as comped. Stripe portal access is disabled while the comped override is active.",
        },
        409
      );
    }

    const { data: subscriptionRow, error: subscriptionError } = await supabase
      .from("tenant_subscriptions")
      .select("stripe_customer_id, stripe_subscription_id")
      .eq("tenant_id", profile.tenant_id)
      .maybeSingle();

    if (subscriptionError) {
      return jsonResponse({ ok: false, error: subscriptionError.message }, 500);
    }

    let stripeCustomerId = subscriptionRow?.stripe_customer_id ?? null;

    if (!stripeCustomerId && subscriptionRow?.stripe_subscription_id) {
      const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionRow.stripe_subscription_id);
      if (typeof stripeSubscription.customer === "string") {
        stripeCustomerId = stripeSubscription.customer;
      } else {
        stripeCustomerId = stripeSubscription.customer?.id ?? null;
      }
    }

    if (!stripeCustomerId) {
      return jsonResponse(
        {
          ok: false,
          error:
            "No Stripe customer is linked for this tenant yet. Complete checkout setup before opening portal.",
        },
        400
      );
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: resolveReturnUrl(req),
    });

    return jsonResponse({ ok: true, url: portalSession.url });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("create-stripe-portal-session error:", message);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});

