import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { estimateSmsSegments, recordSmsUsageEvent, toPositiveInteger } from "../_shared/smsMetering.ts";
import { normalizePhoneE164, resolveTenantIdByInboundToPhone } from "../_shared/smsRouting.ts";

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

function isMissingSmsUsageEventsRelation(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as { code?: string }).code : "";
  const message =
    typeof error === "object" && error !== null ? String((error as { message?: string }).message || "") : "";
  const details =
    typeof error === "object" && error !== null ? String((error as { details?: string }).details || "") : "";
  const normalized = `${message} ${details}`.toLowerCase();
  return code === "42P01" || normalized.includes('relation "sms_usage_events" does not exist');
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
  const expectedToken = (Deno.env.get("TWILIO_SMS_STATUS_CALLBACK_TOKEN") || "").trim();
  const isProduction = isProductionEnvironment();

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch (error) {
    console.error("twilio-sms-status-callback invalid payload:", error);
    return jsonResponse({ ok: false, error: "Invalid form payload" }, 400);
  }

  const suppliedToken =
    (url.searchParams.get("token") || "").trim() ||
    (String(formData.get("token") || "").trim());

  if (expectedToken) {
    if (!suppliedToken || suppliedToken !== expectedToken) {
      return jsonResponse({ ok: false, error: "Unauthorized callback token" }, 401);
    }
  } else if (isProduction) {
    return jsonResponse(
      {
        ok: false,
        error:
          "TWILIO_SMS_STATUS_CALLBACK_TOKEN must be configured in production before accepting Twilio callbacks.",
      },
      500,
    );
  }

  const messageSid = String(formData.get("MessageSid") || "").trim() || null;
  const accountSid = String(formData.get("AccountSid") || "").trim() || null;
  const messageStatus =
    String(formData.get("MessageStatus") || formData.get("SmsStatus") || "").trim() || "queued";
  const toPhone = normalizePhoneE164(String(formData.get("To") || ""));
  const fromPhone = normalizePhoneE164(String(formData.get("From") || ""));
  const numSegmentsRaw = formData.get("NumSegments");
  const errorCode = String(formData.get("ErrorCode") || "").trim() || null;
  const errorMessage = String(formData.get("ErrorMessage") || "").trim() || null;
  const bodyPreview = String(formData.get("Body") || "");
  const providedTenantId = (url.searchParams.get("tenant_id") || "").trim() || null;

  if (!messageSid) {
    return jsonResponse({ ok: true, skipped: "missing_message_sid" });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  let tenantId: string | null = providedTenantId;

  if (!tenantId) {
    const { data: existingEvent, error: existingEventError } = await supabase
      .from("sms_usage_events")
      .select("tenant_id")
      .eq("twilio_message_sid", messageSid)
      .maybeSingle();
    if (existingEventError && !isMissingSmsUsageEventsRelation(existingEventError)) {
      console.error("twilio-sms-status-callback existing-event lookup error:", existingEventError.message);
      return jsonResponse({ ok: false, error: "Unable to query existing SMS usage event." }, 500);
    }
    tenantId = existingEvent?.tenant_id ? String(existingEvent.tenant_id) : null;
  }

  if (!tenantId && fromPhone) {
    const resolved = await resolveTenantIdByInboundToPhone(supabase, fromPhone);
    tenantId = resolved.tenantId;
  }

  if (!tenantId) {
    console.warn(
      "twilio-sms-status-callback: unable to resolve tenant",
      JSON.stringify({ messageSid, fromPhone, toPhone, providedTenantId }),
    );
    return jsonResponse({ ok: true, skipped: "tenant_not_resolved" });
  }

  try {
    const segmentCount = toPositiveInteger(
      numSegmentsRaw,
      estimateSmsSegments(bodyPreview),
    );
    const segmentSource =
      numSegmentsRaw === null || numSegmentsRaw === undefined
        ? "estimated"
        : "twilio_callback";

    await recordSmsUsageEvent(supabase, {
      tenantId,
      direction: "outbound",
      twilioMessageSid: messageSid,
      twilioAccountSid: accountSid,
      fromPhone,
      toPhone,
      messageStatus,
      segmentCount,
      segmentCountSource: segmentSource,
      billable: true,
      metadata: {
        source: "twilio-sms-status-callback",
        error_code: errorCode,
        error_message: errorMessage,
      },
    });
  } catch (error) {
    console.error("twilio-sms-status-callback metering error:", error);
    return jsonResponse({ ok: false, error: "Failed to persist SMS usage status callback." }, 500);
  }

  return jsonResponse({ ok: true, sid: messageSid, status: messageStatus });
});
