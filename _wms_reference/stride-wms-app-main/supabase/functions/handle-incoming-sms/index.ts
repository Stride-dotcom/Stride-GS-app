import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { estimateSmsSegments, recordSmsUsageEvent, toPositiveInteger } from "../_shared/smsMetering.ts";
import { normalizePhoneE164, resolveTenantIdByInboundToPhone } from "../_shared/smsRouting.ts";

/**
 * handle-incoming-sms
 *
 * Twilio webhook handler for inbound SMS messages.
 *
 * Twilio's built-in Opt-Out Management handles STOP/HELP/START keywords
 * automatically before they reach this webhook. This function only receives
 * non-keyword messages (actual replies from recipients).
 *
 * Non-keyword messages are routed to the in-app messaging system so
 * office staff can see SMS replies in their Messages inbox.
 *
 * Setup:
 * 1. Deploy this function to Supabase
 * 2. In Twilio Console -> Phone Numbers -> your number -> Messaging -> "A MESSAGE COMES IN"
 *    set the webhook URL to: https://lxkstlsfxocaswqwlmed.supabase.co/functions/v1/handle-incoming-sms
 * 3. Twilio Opt-Out Management handles STOP/HELP/START — no need to handle here
 */

const handler = async (req: Request): Promise<Response> => {
  // Twilio sends POST with application/x-www-form-urlencoded
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse Twilio webhook payload (form-encoded)
    const formData = await req.formData();
    const fromRaw = formData.get("From") as string; // E.164 phone number
    const from = normalizePhoneE164(fromRaw);
    const messageBody = (formData.get("Body") as string || "").trim();
    const toRaw = formData.get("To") as string; // Our Twilio number
    const to = normalizePhoneE164(toRaw);
    const messageSid = (formData.get("MessageSid") as string) || null;
    const accountSid = (formData.get("AccountSid") as string) || null;
    const messageStatus = (formData.get("SmsStatus") as string) || "received";
    const numSegmentsRaw = formData.get("NumSegments");

    if (!from || !to || !messageBody) {
      return twimlResponse("");
    }

    const tenantResolution = await resolveTenantIdByInboundToPhone(supabase, to);
    if (!tenantResolution.tenantId) {
      console.log("No tenant found for Twilio number:", to);
      return twimlResponse("");
    }

    try {
      const segmentCount = toPositiveInteger(
        numSegmentsRaw,
        estimateSmsSegments(messageBody),
      );
      const segmentSource =
        numSegmentsRaw === null || numSegmentsRaw === undefined
          ? "estimated"
          : "twilio_callback";

      await recordSmsUsageEvent(supabase, {
        tenantId: tenantResolution.tenantId,
        direction: "inbound",
        twilioMessageSid: messageSid,
        twilioAccountSid: accountSid,
        fromPhone: from,
        toPhone: to,
        messageStatus,
        segmentCount,
        segmentCountSource: segmentSource,
        billable: true,
        metadata: {
          source: "handle-incoming-sms",
          tenant_resolution_source: tenantResolution.source,
        },
      });
    } catch (meteringError) {
      console.error("Unable to record inbound SMS usage event:", meteringError);
    }

    // Route the SMS reply into the in-app messaging system
    await routeSmsReplyToMessages(supabase, tenantResolution.tenantId, from, messageBody);

    return twimlResponse("");
  } catch (error) {
    console.error("Error handling incoming SMS:", error);
    // Return empty TwiML on error so Twilio doesn't retry
    return twimlResponse("");
  }
};

/**
 * Route an inbound SMS reply into the in-app messaging system.
 * Creates a system message and notifies tenant admin users so they
 * see SMS replies in the Messages page and bell icon notifications.
 */
async function routeSmsReplyToMessages(
  supabase: any,
  tenantId: string,
  fromPhone: string,
  messageBody: string
): Promise<void> {
  try {
    const normalizePhone = (v: string | null | undefined): string =>
      String(v || '').replace(/[^\d+]/g, '');

    const threadKey = `sms:${fromPhone}`;

    // Look up consent + account context
    const { data: consent } = await supabase
      .from("sms_consent")
      .select("contact_name, account_id")
      .eq("tenant_id", tenantId)
      .eq("phone_number", fromPhone)
      .maybeSingle();

    const accountId = consent?.account_id || null;
    let accountName: string | null = null;
    let recipientSourceField: string | null = null;
    let senderLabel = fromPhone;

    if (accountId) {
      const { data: account } = await supabase
        .from("accounts")
        .select("account_name, primary_contact_phone, billing_contact_phone")
        .eq("id", accountId)
        .eq("tenant_id", tenantId)
        .maybeSingle();

      accountName = account?.account_name || null;
      const normalizedFrom = normalizePhone(fromPhone);
      const isPrimary = normalizePhone(account?.primary_contact_phone) === normalizedFrom;
      const isBilling = normalizePhone(account?.billing_contact_phone) === normalizedFrom;

      if (isPrimary) {
        recipientSourceField = "Primary Contact";
      } else if (isBilling) {
        recipientSourceField = "Billing Contact";
      } else if (consent?.contact_name) {
        recipientSourceField = consent.contact_name;
      }

      // Preferred label order:
      // 1) Account_Name — Primary Contact (or detected source field)
      // 2) Account_Name — SMS Contact
      // 3) phone number only
      if (accountName && recipientSourceField) {
        senderLabel = `${accountName} — ${recipientSourceField}`;
      } else if (accountName) {
        senderLabel = `${accountName} — SMS Contact`;
      }
    }

    // Link inbound reply to latest outbound SMS context in this phone thread.
    const { data: latestOutbound } = await supabase
      .from("messages")
      .select("id, metadata, created_at")
      .eq("tenant_id", tenantId)
      .eq("metadata->>source", "sms_outbound")
      .eq("metadata->>to_phone", fromPhone)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Resolve users who can see customer SMS replies:
    // manager, admin, billing_manager
    const { data: roleRows } = await supabase
      .from("roles")
      .select("id, name")
      .eq("tenant_id", tenantId)
      .in("name", ["manager", "admin", "billing_manager"])
      .is("deleted_at", null);

    const roleIds = (roleRows || []).map((r: any) => r.id);
    if (roleIds.length === 0) {
      console.log("No manager/admin/billing_manager roles found for tenant", tenantId);
      return;
    }

    const { data: userRoleRows } = await supabase
      .from("user_roles")
      .select("user_id")
      .in("role_id", roleIds)
      .is("deleted_at", null);

    const userIds = [...new Set((userRoleRows || []).map((r: any) => r.user_id).filter(Boolean))];
    if (userIds.length === 0) {
      console.log("No manager/admin/billing_manager users found for tenant", tenantId);
      return;
    }

    const { data: recipientUsers } = await supabase
      .from("users")
      .select("id")
      .eq("tenant_id", tenantId)
      .in("id", userIds)
      .is("deleted_at", null)
      .limit(50);

    if (!recipientUsers || recipientUsers.length === 0) {
      console.log("No eligible recipient users found for tenant", tenantId);
      return;
    }

    // messages.sender_id is required: use one eligible recipient as synthetic sender.
    const systemSenderId = recipientUsers[0].id;

    // Create the message
    const { data: message, error: msgError } = await supabase
      .from("messages")
      .insert({
        tenant_id: tenantId,
        sender_id: systemSenderId,
        subject: `SMS from ${senderLabel}`,
        body: messageBody,
        message_type: "system",
        priority: "normal",
        metadata: {
          source: "sms_reply",
          from_phone: fromPhone,
          thread_key: threadKey,
          reply_to_message_id: latestOutbound?.id || null,
          contact_name: consent?.contact_name || null,
          contact_label: senderLabel,
          account_id: accountId,
          account_name: accountName,
          recipient_source_field: recipientSourceField,
          latest_outbound_context: latestOutbound?.metadata || null,
        },
      })
      .select("id")
      .single();

    if (msgError) {
      console.error("Error creating SMS reply message:", msgError);
      return;
    }

    // Create message_recipients for all allowed inbox roles
    const recipientInserts = recipientUsers.map((user: { id: string }) => ({
      message_id: message.id,
      recipient_type: "user",
      recipient_id: user.id,
      user_id: user.id,
    }));

    await supabase.from("message_recipients").insert(recipientInserts);

    // Create in_app_notifications for recipients (bell icon + Messages page)
    const notifInserts = recipientUsers.map((user: { id: string }) => ({
      tenant_id: tenantId,
      user_id: user.id,
      title: `SMS Reply from ${senderLabel}`,
      body: messageBody.length > 100
        ? messageBody.substring(0, 100) + "..."
        : messageBody,
      category: "message",
      priority: "normal",
      icon: "sms",
      action_url: "/messages?inbox=messages",
      related_entity_type: "sms_reply",
    }));

    await supabase.from("in_app_notifications").insert(notifInserts);

    console.log(
      `SMS reply from ${fromPhone} routed to ${recipientUsers.length} user(s) for tenant ${tenantId}`
    );
  } catch (error) {
    console.error("Error routing SMS reply to messages:", error);
  }
}

/** Return a TwiML XML response */
function twimlResponse(message: string): Response {
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${escapeXml(message)}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

serve(handler);
