import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { loadTenantSmsSendConfig, normalizePhoneE164 } from "../_shared/smsRouting.ts";
import {
  estimateSmsSegments,
  recordSmsUsageEvent,
  toPositiveInteger,
} from "../_shared/smsMetering.ts";

/**
 * send-sms
 *
 * Sends an SMS message via Twilio. Used by the in-app Messages page
 * when replying to SMS conversations.
 *
 * Requires: TWILIO_AUTH_TOKEN as a Supabase secret.
 * Reads Account SID and From Phone/Messaging Service SID from tenant settings.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface SendSmsRequest {
  tenant_id: string;
  to_phone: string;
  body: string;
}

function buildStatusCallbackUrl(tenantId: string): string | null {
  const configuredBase = (Deno.env.get("TWILIO_SMS_STATUS_CALLBACK_URL") || "").trim();
  const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").trim();
  const callbackToken = (Deno.env.get("TWILIO_SMS_STATUS_CALLBACK_TOKEN") || "").trim();

  const fallbackBase = supabaseUrl
    ? `${supabaseUrl}/functions/v1/twilio-sms-status-callback`
    : "";
  const baseTemplate = configuredBase || fallbackBase;
  if (!baseTemplate) return null;

  const withTenantToken = baseTemplate.replaceAll("{tenant_id}", encodeURIComponent(tenantId));

  try {
    const url = new URL(withTenantToken);
    if (!url.searchParams.has("tenant_id")) {
      url.searchParams.set("tenant_id", tenantId);
    }
    if (callbackToken && !url.searchParams.has("token")) {
      url.searchParams.set("token", callbackToken);
    }
    return url.toString();
  } catch {
    return null;
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Authenticate the caller
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabaseAuth = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
    const userId = user.id;

    const twilioAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    if (!twilioAuthToken) {
      throw new Error("TWILIO_AUTH_TOKEN not configured in Supabase secrets.");
    }

    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { tenant_id, to_phone, body: messageBody }: SendSmsRequest =
      await req.json();

    if (!tenant_id || !to_phone || !messageBody) {
      throw new Error("Missing required fields: tenant_id, to_phone, body");
    }

    // Verify the caller belongs to the specified tenant
    const { data: userProfile, error: profileError } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", userId)
      .single();

    if (profileError || !userProfile || userProfile.tenant_id !== tenant_id) {
      return new Response(
        JSON.stringify({ error: "Forbidden: Cannot send SMS for other tenants" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const smsConfig = await loadTenantSmsSendConfig(supabase, tenant_id);

    if (!smsConfig.smsEnabled) {
      throw new Error("SMS is not enabled for this organization.");
    }

    const accountSid = smsConfig.accountSid;
    if (!accountSid) {
      throw new Error(
        "Twilio Account SID not configured. Configure TWILIO_ACCOUNT_SID secret or tenant fallback settings."
      );
    }

    if (!smsConfig.messagingServiceSid && !smsConfig.fromPhone) {
      throw new Error(
        "No SMS sender is configured for this tenant. Assign a platform sender or configure a fallback From phone."
      );
    }

    const cleanPhone = normalizePhoneE164(to_phone);
    if (!cleanPhone) {
      throw new Error("Invalid destination phone number.");
    }

    // Check opt-out status
    const { data: globalConsent } = await supabase
      .from("global_sms_consent")
      .select("status")
      .eq("phone_number", cleanPhone)
      .maybeSingle();

    if (globalConsent?.status === "opted_out") {
      throw new Error(
        `Cannot send SMS to ${cleanPhone} - recipient has globally opted out.`
      );
    }

    const { data: consent } = await supabase
      .from("sms_consent")
      .select("status")
      .eq("tenant_id", tenant_id)
      .eq("phone_number", cleanPhone)
      .maybeSingle();

    if (consent?.status === "opted_out") {
      throw new Error(
        `Cannot send SMS to ${cleanPhone} - recipient has opted out.`
      );
    }

    // Build Twilio API request
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const formData = new URLSearchParams();
    formData.append("To", cleanPhone);
    formData.append("Body", messageBody);

    // Use Messaging Service SID if available, otherwise tenant/platform sender number.
    if (smsConfig.messagingServiceSid) {
      formData.append(
        "MessagingServiceSid",
        smsConfig.messagingServiceSid
      );
    } else {
      formData.append("From", smsConfig.fromPhone!);
    }

    const statusCallbackUrl = buildStatusCallbackUrl(tenant_id);
    if (statusCallbackUrl) {
      formData.append("StatusCallback", statusCallbackUrl);
    }

    const twilioResponse = await fetch(twilioUrl, {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + btoa(`${accountSid}:${twilioAuthToken}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: formData.toString(),
    });

    const twilioData = await twilioResponse.json();

    if (!twilioResponse.ok) {
      console.error("Twilio error:", twilioData);

      if (
        twilioData.code === 21610 ||
        (twilioData.message && twilioData.message.includes("unsubscribed"))
      ) {
        throw new Error(
          "This number has been unsubscribed via Twilio. The recipient must text START to re-subscribe."
        );
      }

      throw new Error(twilioData.message || "Failed to send SMS via Twilio");
    }

    console.log("SMS sent:", twilioData.sid, "to:", cleanPhone);

    try {
      const twilioSegments = twilioData?.num_segments;
      const segmentCount = toPositiveInteger(
        twilioSegments,
        estimateSmsSegments(messageBody),
      );
      const segmentSource =
        twilioSegments === undefined || twilioSegments === null
          ? "estimated"
          : "twilio_api";

      await recordSmsUsageEvent(supabase, {
        tenantId: tenant_id,
        direction: "outbound",
        twilioMessageSid: twilioData?.sid ?? null,
        twilioAccountSid: accountSid,
        fromPhone: normalizePhoneE164(twilioData?.from ?? smsConfig.fromPhone),
        toPhone: cleanPhone,
        messageStatus: twilioData?.status ?? "queued",
        segmentCount,
        segmentCountSource: segmentSource,
        billable: true,
        occurredAt: twilioData?.date_created ?? null,
        metadata: {
          source: "send-sms",
          channel: "messages_reply",
          sender_provisioning_status: smsConfig.senderProvisioningStatus,
        },
      });
    } catch (meteringError) {
      console.error("Unable to record outbound SMS usage event:", meteringError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        sid: twilioData.sid,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error sending SMS:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
