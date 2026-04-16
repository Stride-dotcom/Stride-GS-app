import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-sms-metering-token",
};

interface MeteringRequest {
  tenant_id?: string | null;
  limit?: number;
}

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function parseLimit(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
      ? Number.parseInt(value, 10)
      : 5000;
  if (!Number.isFinite(parsed)) return 5000;
  return Math.min(Math.max(Math.floor(parsed), 1), 20000);
}

function toNullableUuid(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
    ? trimmed
    : null;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: "Supabase env vars are not configured" }, 500);
  }

  const providedJobToken =
    (req.headers.get("x-sms-metering-token") || "").trim();
  const expectedJobToken = (Deno.env.get("SMS_METERING_JOB_TOKEN") || "").trim();

  const body = (await req.json().catch(() => ({}))) as MeteringRequest;
  const tenantId = toNullableUuid(body.tenant_id ?? null);
  const limit = parseLimit(body.limit);

  const runViaJobToken = expectedJobToken.length > 0 && providedJobToken === expectedJobToken;

  if (!runViaJobToken) {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    }

    const authClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser(token);
    if (authError || !user) {
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    }

    const { data: isAdminDev, error: roleError } = await (authClient as any).rpc("user_is_admin_dev", {
      p_user_id: user.id,
    });
    if (roleError || isAdminDev !== true) {
      return jsonResponse({ ok: false, error: "Forbidden" }, 403);
    }
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await (serviceClient as any).rpc("rpc_admin_rollup_sms_usage_events", {
    p_tenant_id: tenantId,
    p_limit: limit,
  });
  if (error) {
    return jsonResponse({ ok: false, error: error.message || "Metering rollup failed." }, 500);
  }

  return jsonResponse({
    ok: true,
    mode: runViaJobToken ? "job_token" : "admin_dev",
    result: data,
  });
});
