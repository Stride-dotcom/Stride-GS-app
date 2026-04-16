import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

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

function boolStatus(ok: boolean): "ok" | "warn" {
  return ok ? "ok" : "warn";
}

function isProductionEnvironment(): boolean {
  const candidates = [
    Deno.env.get("APP_ENV"),
    Deno.env.get("ENVIRONMENT"),
    Deno.env.get("NODE_ENV"),
    Deno.env.get("SUPABASE_ENV"),
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .filter((value) => value.length > 0);

  return candidates.includes("prod") || candidates.includes("production");
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
  const token = authHeader.replace("Bearer ", "");

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: userData, error: userErr } = await anonClient.auth.getUser(token);
  if (userErr || !userData?.user) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }

  const { data: isAdminDev, error: roleErr } = await (serviceClient as any).rpc("user_is_admin_dev", {
    p_user_id: userData.user.id,
  });
  if (roleErr || isAdminDev !== true) {
    return jsonResponse({ ok: false, error: "Forbidden" }, 403);
  }

  const [{ data: outboundSettings }, { data: inboundSettings }] = await Promise.all([
    serviceClient
      .from("platform_email_settings")
      .select("default_from_email, is_active, outbound_primary_provider, outbound_fallback_provider")
      .eq("id", 1)
      .maybeSingle(),
    serviceClient
      .from("platform_inbound_email_settings")
      .select("provider, reply_domain, is_active")
      .eq("id", 1)
      .maybeSingle(),
  ]);

  const outboundPrimary = String(outboundSettings?.outbound_primary_provider || "resend").toLowerCase();
  const outboundFallback = String(outboundSettings?.outbound_fallback_provider || "none").toLowerCase();
  const outboundEnabled = outboundSettings?.is_active === true;

  const inboundProvider = String(inboundSettings?.provider || "mailgun").toLowerCase();
  const inboundEnabled = inboundSettings?.is_active === true;
  const replyDomain = typeof inboundSettings?.reply_domain === "string" ? inboundSettings.reply_domain : null;

  const resendConfigured = Boolean((Deno.env.get("RESEND_API_KEY") || "").trim());
  const postmarkConfigured = Boolean((Deno.env.get("POSTMARK_SERVER_TOKEN") || "").trim());
  const mailgunConfigured = Boolean(
    (Deno.env.get("MAILGUN_WEBHOOK_SIGNING_KEY") || Deno.env.get("MAILGUN_API_KEY") || "").trim(),
  );
  const postmarkInboundTokenConfigured = Boolean((Deno.env.get("POSTMARK_INBOUND_WEBHOOK_TOKEN") || "").trim());
  const isProduction = isProductionEnvironment();

  const primaryReady =
    outboundPrimary === "postmark" ? postmarkConfigured : resendConfigured;

  const fallbackReady =
    outboundFallback === "none"
      ? true
      : outboundFallback === "postmark"
        ? postmarkConfigured
        : resendConfigured;

  const inboundReady =
    inboundProvider === "postmark" ? true : mailgunConfigured;

  const postmarkTokenRequired = inboundProvider === "postmark" && isProduction;
  const postmarkTokenReady = postmarkTokenRequired ? postmarkInboundTokenConfigured : true;

  const checks = [
    {
      id: "outbound_primary",
      label: `Outbound primary provider (${outboundPrimary})`,
      status: boolStatus(primaryReady),
      detail: primaryReady
        ? "Primary provider credentials are configured."
        : `Missing credentials for ${outboundPrimary}.`,
    },
    {
      id: "outbound_fallback",
      label: `Outbound fallback provider (${outboundFallback})`,
      status: boolStatus(fallbackReady),
      detail:
        outboundFallback === "none"
          ? "No fallback configured."
          : fallbackReady
            ? "Fallback credentials are configured."
            : `Missing credentials for fallback provider ${outboundFallback}.`,
    },
    {
      id: "platform_sender",
      label: "Platform default sender",
      status: boolStatus(Boolean(outboundSettings?.default_from_email) && outboundEnabled),
      detail:
        outboundEnabled && outboundSettings?.default_from_email
          ? `Sender active: ${outboundSettings.default_from_email}`
          : "Set default sender + enable it in Email Ops.",
    },
    {
      id: "inbound_provider",
      label: `Inbound provider (${inboundProvider})`,
      status: boolStatus(inboundReady),
      detail:
        inboundProvider === "postmark"
          ? "Postmark inbound selected."
          : inboundReady
            ? "Mailgun signing key configured."
            : "Missing MAILGUN_WEBHOOK_SIGNING_KEY.",
    },
    {
      id: "inbound_domain",
      label: "Replies domain",
      status: boolStatus(Boolean(replyDomain) && inboundEnabled),
      detail:
        replyDomain && inboundEnabled
          ? `Inbound enabled for ${replyDomain}`
          : "Set replies subdomain and enable inbound routing.",
    },
    {
      id: "postmark_inbound_token",
      label: "Postmark inbound webhook token",
      status: boolStatus(postmarkTokenReady),
      detail: postmarkInboundTokenConfigured
        ? "Webhook token configured."
        : postmarkTokenRequired
          ? "Required in production when inbound provider is Postmark."
          : "Optional in non-production; recommended for parity with production security.",
    },
  ];

  const recommendations: string[] = [];
  if (!primaryReady) {
    recommendations.push(`Add credentials for primary provider: ${outboundPrimary}.`);
  }
  if (!fallbackReady && outboundFallback !== "none") {
    recommendations.push(`Add credentials for fallback provider: ${outboundFallback}.`);
  }
  if (!outboundEnabled) {
    recommendations.push("Enable platform outbound sender in Email Ops.");
  }
  if (!inboundEnabled || !replyDomain) {
    recommendations.push("Configure and enable inbound replies domain in Email Ops.");
  }
  if (inboundProvider === "mailgun" && !mailgunConfigured) {
    recommendations.push("Set MAILGUN_WEBHOOK_SIGNING_KEY for Mailgun inbound verification.");
  }
  if (inboundProvider === "postmark" && !postmarkInboundTokenConfigured) {
    recommendations.push(
      postmarkTokenRequired
        ? "Set POSTMARK_INBOUND_WEBHOOK_TOKEN (required in production) and send it via x-postmark-webhook-token or ?token=... ."
        : "Set POSTMARK_INBOUND_WEBHOOK_TOKEN and append ?token=... to webhook URL.",
    );
  }

  return jsonResponse({
    ok: true,
    checks,
    recommendations,
    summary: {
      outbound_primary_provider: outboundPrimary,
      outbound_fallback_provider: outboundFallback,
      inbound_provider: inboundProvider,
      inbound_reply_domain: replyDomain,
      outbound_enabled: outboundEnabled,
      inbound_enabled: inboundEnabled,
      postmark_inbound_token_required: postmarkTokenRequired,
    },
  });
});

