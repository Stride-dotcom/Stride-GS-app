import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";

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

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ ok: false, error: "Supabase env vars are not configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error: userErr } = await anonClient.auth.getUser(token);
  if (userErr || !user) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }
  const userId = user.id;

  const { data: isAdminDev, error: roleErr } = await (serviceClient as any).rpc("user_is_admin_dev", {
    p_user_id: userId,
  });
  if (roleErr || isAdminDev !== true) {
    return jsonResponse({ ok: false, error: "Forbidden" }, 403);
  }

  const stripeSecret = (Deno.env.get("STRIPE_SECRET_KEY") || "").trim();
  const webhookSecret = (Deno.env.get("STRIPE_WEBHOOK_SECRET") || "").trim();

  const checks: Array<{ id: string; label: string; status: "ok" | "warn"; detail: string }> = [];

  checks.push({
    id: "stripe_secret",
    label: "Stripe secret key",
    status: stripeSecret ? "ok" : "warn",
    detail: stripeSecret ? "STRIPE_SECRET_KEY is configured." : "STRIPE_SECRET_KEY is missing.",
  });
  checks.push({
    id: "stripe_webhook_secret",
    label: "Stripe webhook secret",
    status: webhookSecret ? "ok" : "warn",
    detail: webhookSecret
      ? "STRIPE_WEBHOOK_SECRET is configured."
      : "STRIPE_WEBHOOK_SECRET is missing.",
  });

  if (!stripeSecret) {
    return jsonResponse({
      ok: true,
      status: "not_configured",
      account_id: null,
      mode: null,
      checks,
    });
  }

  try {
    const stripe = new Stripe(stripeSecret, {
      apiVersion: "2024-04-10",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const account = await stripe.accounts.retrieve();
    checks.push({
      id: "stripe_api_call",
      label: "Stripe API connection",
      status: "ok",
      detail: "Stripe API connection succeeded.",
    });

    return jsonResponse({
      ok: true,
      status: "connected",
      account_id: account.id || null,
      mode: account.livemode ? "live" : "test",
      checks,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to connect to Stripe API.";
    checks.push({
      id: "stripe_api_call",
      label: "Stripe API connection",
      status: "warn",
      detail: message,
    });

    return jsonResponse({
      ok: true,
      status: "error",
      account_id: null,
      mode: null,
      checks,
      error: message,
    });
  }
});

