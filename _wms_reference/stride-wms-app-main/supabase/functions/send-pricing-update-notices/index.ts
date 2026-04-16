import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { resolvePlatformEmailDefaults } from "../_shared/platformEmail.ts";
import { sendPlatformEmail } from "../_shared/emailProviders.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NoticeRequestBody {
  pricing_version_id: string;
  notice_type: "upcoming" | "effective_today";
}

interface PricingVersionRow {
  id: string;
  effective_from: string;
  app_monthly_fee: number;
  sms_monthly_addon_fee: number;
  sms_segment_fee: number;
  notes: string | null;
}

interface CompanySettingsRow {
  tenant_id: string;
  company_name: string | null;
  company_email: string | null;
}

function jsonResponse(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function formatMoney(value: number): string {
  return `$${value.toFixed(4).replace(/\.?0+$/, "")}`;
}

function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;
  const first = trimmed.split(",")[0]?.trim();
  if (!first) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(first)) return null;
  return first;
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function authenticateAdminDev(req: Request, serviceClient: any) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("UNAUTHORIZED");
  }

  const token = authHeader.replace("Bearer ", "");
  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const {
    data: { user },
    error,
  } = await anonClient.auth.getUser(token);
  if (error || !user) {
    throw new Error("UNAUTHORIZED");
  }

  const { data: isAdminDev, error: roleError } = await (serviceClient as any).rpc("user_is_admin_dev", {
    p_user_id: user.id,
  });
  if (roleError) {
    console.error("user_is_admin_dev lookup error:", roleError.message);
    throw new Error("FORBIDDEN");
  }
  if (isAdminDev !== true) {
    throw new Error("FORBIDDEN");
  }

  return user.id;
}

function buildNoticeSubject(noticeType: "upcoming" | "effective_today", effectiveFrom: string): string {
  const effectiveLabel = new Date(effectiveFrom).toLocaleDateString();
  if (noticeType === "upcoming") {
    return `Upcoming StrideWMS pricing update effective ${effectiveLabel}`;
  }
  return `StrideWMS pricing update effective today (${effectiveLabel})`;
}

function buildNoticeHtml(
  companyName: string,
  noticeType: "upcoming" | "effective_today",
  pricing: PricingVersionRow
): string {
  const effectiveLabel = new Date(pricing.effective_from).toLocaleString();
  const leadCopy =
    noticeType === "upcoming"
      ? "We are notifying you in advance of an upcoming pricing update."
      : "This is a confirmation that updated pricing is now in effect.";

  return `
    <div style="font-family: Arial, sans-serif; max-width: 640px; margin: 0 auto; color: #111827;">
      <h2 style="margin-bottom: 8px;">StrideWMS Pricing Update</h2>
      <p style="margin-top: 0; color: #374151;">Hello ${companyName},</p>
      <p style="color: #374151;">${leadCopy}</p>
      <p style="color: #374151;"><strong>Effective:</strong> ${effectiveLabel}</p>

      <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
        <thead>
          <tr>
            <th style="text-align:left; border-bottom: 1px solid #E5E7EB; padding: 8px;">Rate</th>
            <th style="text-align:right; border-bottom: 1px solid #E5E7EB; padding: 8px;">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #F3F4F6;">App monthly subscription</td>
            <td style="padding: 8px; border-bottom: 1px solid #F3F4F6; text-align:right;">${formatMoney(
              pricing.app_monthly_fee
            )}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #F3F4F6;">SMS monthly add-on</td>
            <td style="padding: 8px; border-bottom: 1px solid #F3F4F6; text-align:right;">${formatMoney(
              pricing.sms_monthly_addon_fee
            )}</td>
          </tr>
          <tr>
            <td style="padding: 8px;">SMS per segment (inbound + outbound)</td>
            <td style="padding: 8px; text-align:right;">${formatMoney(pricing.sms_segment_fee)}</td>
          </tr>
        </tbody>
      </table>

      ${
        pricing.notes
          ? `<p style="color: #374151;"><strong>Additional notes:</strong> ${pricing.notes}</p>`
          : ""
      }

      <p style="color: #6B7280; font-size: 12px; margin-top: 20px;">
        This notice is sent to the billing contact email configured in your organization settings.
      </p>
    </div>
  `;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
    return jsonResponse({ ok: false, error: "Supabase env vars are not configured" }, 500);
  }
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  try {
    const userId = await authenticateAdminDev(req, serviceClient);
    const platformDefaults = await resolvePlatformEmailDefaults(serviceClient);
    const fromEmail = platformDefaults.fromEmail;
    const fromName = platformDefaults.fromName;
    const body = (await req.json()) as NoticeRequestBody;

    if (!body?.pricing_version_id) {
      return jsonResponse({ ok: false, error: "pricing_version_id is required" }, 400);
    }
    if (body.notice_type !== "upcoming" && body.notice_type !== "effective_today") {
      return jsonResponse({ ok: false, error: "notice_type must be upcoming or effective_today" }, 400);
    }

    const { data: pricingRow, error: pricingError } = await (serviceClient as any)
      .from("saas_pricing_versions")
      .select("*")
      .eq("id", body.pricing_version_id)
      .maybeSingle();

    if (pricingError) {
      return jsonResponse({ ok: false, error: pricingError.message }, 500);
    }
    if (!pricingRow) {
      return jsonResponse({ ok: false, error: "Pricing version not found" }, 404);
    }

    const pricing: PricingVersionRow = {
      id: String(pricingRow.id),
      effective_from: String(pricingRow.effective_from),
      app_monthly_fee: toNumber(pricingRow.app_monthly_fee),
      sms_monthly_addon_fee: toNumber(pricingRow.sms_monthly_addon_fee),
      sms_segment_fee: toNumber(pricingRow.sms_segment_fee),
      notes: typeof pricingRow.notes === "string" ? pricingRow.notes : null,
    };

    const { data: subscriptionRows, error: subscriptionsError } = await (serviceClient as any)
      .from("tenant_subscriptions")
      .select("tenant_id")
      .in("status", ["active", "past_due"]);

    if (subscriptionsError) {
      return jsonResponse({ ok: false, error: subscriptionsError.message }, 500);
    }

    const tenantIds = Array.from(
      new Set((Array.isArray(subscriptionRows) ? subscriptionRows : []).map((row) => row.tenant_id))
    ).filter(Boolean);

    const { data: overrideRows, error: overrideError } =
      tenantIds.length > 0
        ? await (serviceClient as any)
            .from("tenant_billing_overrides")
            .select("tenant_id, is_comped, expires_at")
            .in("tenant_id", tenantIds)
        : { data: [], error: null };
    if (overrideError) {
      return jsonResponse({ ok: false, error: overrideError.message }, 500);
    }

    const compedTenantIds = new Set<string>();
    for (const row of Array.isArray(overrideRows) ? overrideRows : []) {
      const isComped = row?.is_comped === true;
      const expiresAt = row?.expires_at ? new Date(String(row.expires_at)).getTime() : null;
      const isExpired = expiresAt !== null && Number.isFinite(expiresAt) && expiresAt <= Date.now();
      if (isComped && !isExpired && row?.tenant_id) {
        compedTenantIds.add(String(row.tenant_id));
      }
    }

    const billableTenantIds = tenantIds.filter((tenantId) => !compedTenantIds.has(tenantId));

    if (billableTenantIds.length === 0) {
      await (serviceClient as any).from("saas_pricing_notice_dispatches").insert({
        pricing_version_id: pricing.id,
        notice_type: body.notice_type,
        recipient_count: 0,
        sent_by: userId,
        metadata: {
          targeted_count: 0,
          excluded_comped_count: compedTenantIds.size,
          sent_count: 0,
          failed_count: 0,
        },
      });

      return jsonResponse({
        ok: true,
        recipient_count: 0,
        sent_count: 0,
        failed_count: 0,
      });
    }

    const { data: companyRows, error: companyError } = await (serviceClient as any)
      .from("tenant_company_settings")
      .select("tenant_id, company_name, company_email")
      .in("tenant_id", billableTenantIds);

    if (companyError) {
      return jsonResponse({ ok: false, error: companyError.message }, 500);
    }

    const recipientsByEmail = new Map<string, CompanySettingsRow>();
    for (const rawRow of Array.isArray(companyRows) ? companyRows : []) {
      const row = rawRow as CompanySettingsRow;
      const email = normalizeEmail(row.company_email);
      if (!email) continue;
      if (!recipientsByEmail.has(email)) {
        recipientsByEmail.set(email, row);
      }
    }

    const recipients = Array.from(recipientsByEmail.entries()).map(([email, row]) => ({
      email,
      companyName: row.company_name || "StrideWMS Customer",
    }));

    const subject = buildNoticeSubject(body.notice_type, pricing.effective_from);
    let sentCount = 0;
    const failures: Array<{ email: string; error: string }> = [];

    for (const recipient of recipients) {
      try {
        const html = buildNoticeHtml(recipient.companyName, body.notice_type, pricing);
        await sendPlatformEmail(serviceClient, {
          fromEmail,
          fromName,
          to: [recipient.email],
          subject,
          html,
          replyTo: platformDefaults.replyTo,
        });
        sentCount += 1;
      } catch (error: unknown) {
        failures.push({
          email: recipient.email,
          error: error instanceof Error ? error.message : "Unknown send error",
        });
      }
    }

    const failedCount = failures.length;

    await (serviceClient as any).from("saas_pricing_notice_dispatches").insert({
      pricing_version_id: pricing.id,
      notice_type: body.notice_type,
      recipient_count: sentCount,
      sent_by: userId,
      metadata: {
        targeted_count: recipients.length,
        excluded_comped_count: compedTenantIds.size,
        sent_count: sentCount,
        failed_count: failedCount,
        failures: failures.slice(0, 25),
      },
    });

    return jsonResponse({
      ok: true,
      recipient_count: recipients.length,
      sent_count: sentCount,
      failed_count: failedCount,
      failures: failures.slice(0, 10),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message === "UNAUTHORIZED") {
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    }
    if (message === "FORBIDDEN") {
      return jsonResponse({ ok: false, error: "Forbidden" }, 403);
    }
    console.error("send-pricing-update-notices error:", message);
    return jsonResponse({ ok: false, error: message }, 500);
  }
});

