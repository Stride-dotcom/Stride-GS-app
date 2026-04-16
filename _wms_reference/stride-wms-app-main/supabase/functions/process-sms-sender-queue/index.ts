import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type QueueWorkerStep = "requested_to_provisioning" | "provisioning_to_pending_verification";

interface QueueWorkerRequest {
  step?: QueueWorkerStep;
  limit?: number;
  note?: string;
}

interface SenderQueueRow {
  tenant_id: string;
  provisioning_status: string;
  twilio_phone_number_sid: string | null;
  twilio_phone_number_e164: string | null;
}

interface QueueWorkerResult {
  ok: boolean;
  step: QueueWorkerStep;
  from_status: string;
  to_status: string;
  attempted: number;
  transitioned: number;
  failed: number;
  failures: Array<{ tenant_id: string; error: string }>;
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
      : 20;
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(Math.max(parsed, 1), 200);
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return jsonResponse({ ok: false, error: "Supabase env vars are not configured" }, 500);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
  }

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  try {
    const token = authHeader.replace("Bearer ", "");
    const {
      data: { user },
      error: userError,
    } = await client.auth.getUser(token);
    if (userError || !user) {
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    }

    const { data: isAdminDev, error: roleError } = await (client as any).rpc("user_is_admin_dev", {
      p_user_id: user.id,
    });
    if (roleError || isAdminDev !== true) {
      return jsonResponse({ ok: false, error: "Forbidden" }, 403);
    }

    const body = (await req.json().catch(() => ({}))) as QueueWorkerRequest;
    const step: QueueWorkerStep =
      body.step === "provisioning_to_pending_verification"
        ? "provisioning_to_pending_verification"
        : "requested_to_provisioning";
    const limit = parseLimit(body.limit);
    const note = typeof body.note === "string" ? body.note.trim() : "";

    const fromStatus = step === "requested_to_provisioning" ? "requested" : "provisioning";
    const toStatus =
      step === "requested_to_provisioning" ? "provisioning" : "pending_verification";

    const { data: queueRows, error: queueError } = await (client as any).rpc(
      "rpc_admin_list_sms_sender_profiles",
      {
        p_status: fromStatus,
      }
    );

    if (queueError) {
      return jsonResponse({ ok: false, error: queueError.message }, 500);
    }

    const rows = (Array.isArray(queueRows) ? queueRows : []) as SenderQueueRow[];
    const targets = rows.slice(0, limit);
    const failures: Array<{ tenant_id: string; error: string }> = [];
    let transitioned = 0;

    for (const row of targets) {
      const statusNote =
        note ||
        `Queue worker transition ${fromStatus} -> ${toStatus} at ${new Date().toISOString()}`;

      const { error } = await (client as any).rpc("rpc_admin_set_sms_sender_status", {
        p_tenant_id: row.tenant_id,
        p_status: toStatus,
        p_twilio_phone_number_sid: row.twilio_phone_number_sid,
        p_twilio_phone_number_e164: row.twilio_phone_number_e164,
        p_error: null,
        p_note: statusNote,
      });

      if (error) {
        failures.push({
          tenant_id: row.tenant_id,
          error: error.message || "Unknown transition error",
        });
      } else {
        transitioned += 1;
      }
    }

    const result: QueueWorkerResult = {
      ok: true,
      step,
      from_status: fromStatus,
      to_status: toStatus,
      attempted: targets.length,
      transitioned,
      failed: failures.length,
      failures,
    };

    return jsonResponse(result as unknown as Record<string, unknown>);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("process-sms-sender-queue error:", message);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});

