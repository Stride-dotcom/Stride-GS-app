import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { normalizePhoneE164, resolveTenantIdByInboundToPhone } from "../_shared/smsRouting.ts";

type SenderProvisioningStatus =
  | "requested"
  | "provisioning"
  | "pending_verification"
  | "approved"
  | "rejected"
  | "disabled";

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isValidUuid(value: string | null): boolean {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeProvisioningStatus(raw: string | null): SenderProvisioningStatus | null {
  if (!raw) return null;
  const value = raw.trim().toLowerCase();
  if (!value) return null;

  const directMap: Record<string, SenderProvisioningStatus> = {
    requested: "requested",
    provisioning: "provisioning",
    pending_verification: "pending_verification",
    approved: "approved",
    rejected: "rejected",
    disabled: "disabled",
  };
  if (directMap[value]) return directMap[value];

  const aliases: Array<[RegExp, SenderProvisioningStatus]> = [
    [/request|queued|received/, "requested"],
    [/provision|purchase|number_assigned|assigning/, "provisioning"],
    [/pending|review|submitted|verif/, "pending_verification"],
    [/approved|verified|active|complete|completed/, "approved"],
    [/reject|denied|failed|error/, "rejected"],
    [/disabled|deactivated|inactive/, "disabled"],
  ];

  for (const [pattern, mapped] of aliases) {
    if (pattern.test(value)) return mapped;
  }
  return null;
}

async function parseRequestPayload(req: Request): Promise<Record<string, unknown>> {
  const contentType = (req.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("application/json")) {
    return (await req.json().catch(() => ({}))) as Record<string, unknown>;
  }
  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const payload: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) {
      payload[key] = typeof value === "string" ? value : String(value);
    }
    return payload;
  }
  return (await req.json().catch(() => ({}))) as Record<string, unknown>;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200 });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: "Supabase env vars are not configured" }, 500);
  }

  const url = new URL(req.url);
  const expectedToken = (Deno.env.get("TWILIO_PROVISIONING_CALLBACK_TOKEN") || "").trim();
  const isProduction = isProductionEnvironment();

  const payload = await parseRequestPayload(req);
  const suppliedToken =
    (url.searchParams.get("token") || "").trim() ||
    toNonEmptyString(payload.token) ||
    toNonEmptyString(req.headers.get("x-twilio-provisioning-token"));

  if (expectedToken) {
    if (!suppliedToken || suppliedToken !== expectedToken) {
      return jsonResponse({ ok: false, error: "Unauthorized callback token" }, 401);
    }
  } else if (isProduction) {
    return jsonResponse(
      {
        ok: false,
        error:
          "TWILIO_PROVISIONING_CALLBACK_TOKEN must be configured in production before accepting callbacks.",
      },
      500,
    );
  }

  const rawStatus = toNonEmptyString(payload.status)
    || toNonEmptyString(payload.provisioning_status)
    || toNonEmptyString(payload.verification_status)
    || toNonEmptyString(payload.state);
  const normalizedStatus = normalizeProvisioningStatus(rawStatus);
  if (!normalizedStatus) {
    return jsonResponse(
      {
        ok: false,
        error: "Invalid or missing sender provisioning status.",
      },
      400,
    );
  }

  const twilioPhoneSid =
    toNonEmptyString(payload.twilio_phone_number_sid)
    || toNonEmptyString(payload.phone_number_sid)
    || toNonEmptyString(payload.phone_sid)
    || toNonEmptyString(payload.PhoneNumberSid);
  const twilioPhoneE164 = normalizePhoneE164(
    toNonEmptyString(payload.twilio_phone_number_e164)
      || toNonEmptyString(payload.phone_number_e164)
      || toNonEmptyString(payload.phone_number)
      || toNonEmptyString(payload.from_phone)
      || toNonEmptyString(payload.From),
  );
  const errorMessage =
    toNonEmptyString(payload.error)
    || toNonEmptyString(payload.error_message)
    || toNonEmptyString(payload.reason)
    || null;
  const note =
    toNonEmptyString(payload.note)
    || toNonEmptyString(payload.message)
    || null;

  let tenantId = toNonEmptyString(payload.tenant_id) || url.searchParams.get("tenant_id");
  if (!isValidUuid(tenantId)) tenantId = null;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  if (!tenantId && twilioPhoneSid) {
    const { data: senderRow } = await supabase
      .from("tenant_sms_sender_profiles")
      .select("tenant_id")
      .eq("twilio_phone_number_sid", twilioPhoneSid)
      .limit(1)
      .maybeSingle();
    tenantId = senderRow?.tenant_id ? String(senderRow.tenant_id) : null;
  }

  if (!tenantId && twilioPhoneE164) {
    const resolved = await resolveTenantIdByInboundToPhone(supabase, twilioPhoneE164);
    tenantId = resolved.tenantId;
  }

  if (!tenantId) {
    return jsonResponse(
      {
        ok: false,
        error: "Unable to resolve tenant for provisioning callback.",
        status: normalizedStatus,
      },
      400,
    );
  }

  const metadata = {
    source: "twilio-sender-provisioning-callback",
    raw_status: rawStatus,
    callback_payload: payload,
  };

  const { data, error } = await (supabase as any).rpc("rpc_system_set_sms_sender_status", {
    p_tenant_id: tenantId,
    p_status: normalizedStatus,
    p_twilio_phone_number_sid: twilioPhoneSid ?? null,
    p_twilio_phone_number_e164: twilioPhoneE164 ?? null,
    p_error: errorMessage,
    p_note: note,
    p_source: "twilio_sender_provisioning_callback",
    p_metadata: metadata,
  });

  if (error) {
    console.error("twilio-sender-provisioning-callback rpc error:", error.message);
    return jsonResponse({ ok: false, error: error.message || "Failed to update sender status." }, 500);
  }

  return jsonResponse({
    ok: true,
    tenant_id: tenantId,
    status: normalizedStatus,
    result: data,
  });
});
