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

  const twilioAccountSid = (Deno.env.get("TWILIO_ACCOUNT_SID") || "").trim();
  const twilioAuthToken = (Deno.env.get("TWILIO_AUTH_TOKEN") || "").trim();

  const checks: Array<{ id: string; label: string; status: "ok" | "warn"; detail: string }> = [];

  checks.push({
    id: "twilio_account_sid",
    label: "Twilio Account SID",
    status: twilioAccountSid ? "ok" : "warn",
    detail: twilioAccountSid ? "TWILIO_ACCOUNT_SID is configured." : "TWILIO_ACCOUNT_SID is missing.",
  });
  checks.push({
    id: "twilio_auth_token",
    label: "Twilio Auth Token",
    status: twilioAuthToken ? "ok" : "warn",
    detail: twilioAuthToken
      ? "TWILIO_AUTH_TOKEN is configured."
      : "TWILIO_AUTH_TOKEN is missing.",
  });

  if (!twilioAccountSid || !twilioAuthToken) {
    return jsonResponse({
      ok: true,
      status: "not_configured",
      account_sid: null,
      account_name: null,
      checks,
    });
  }

  try {
    const credentials = btoa(`${twilioAccountSid}:${twilioAuthToken}`);
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}.json`,
      {
        method: "GET",
        headers: { Authorization: `Basic ${credentials}` },
      },
    );

    if (!response.ok) {
      const errorBody = await response.text();
      checks.push({
        id: "twilio_api_call",
        label: "Twilio API connection",
        status: "warn",
        detail: `API returned ${response.status}: ${errorBody.slice(0, 200)}`,
      });
      return jsonResponse({
        ok: true,
        status: "error",
        account_sid: twilioAccountSid,
        account_name: null,
        checks,
        error: `Twilio API returned ${response.status}`,
      });
    }

    const account = await response.json();
    checks.push({
      id: "twilio_api_call",
      label: "Twilio API connection",
      status: "ok",
      detail: "Twilio API connection succeeded.",
    });

    return jsonResponse({
      ok: true,
      status: "connected",
      account_sid: account.sid || twilioAccountSid,
      account_name: account.friendly_name || null,
      checks,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to connect to Twilio API.";
    checks.push({
      id: "twilio_api_call",
      label: "Twilio API connection",
      status: "warn",
      detail: message,
    });

    return jsonResponse({
      ok: true,
      status: "error",
      account_sid: twilioAccountSid,
      account_name: null,
      checks,
      error: message,
    });
  }
});
