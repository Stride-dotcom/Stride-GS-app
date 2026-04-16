import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

/**
 * sms-opt-in
 *
 * Public edge function (no auth required) for the SMS opt-in consent page.
 * Actions:
 *   1. get_tenant_info - Returns public tenant branding for the opt-in form
 *   2. opt_in - Records consent for a phone number
 *   3. opt_out - Records unsubscribe for a phone number
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const RESERVED_SUBDOMAINS = new Set([
  "www",
  "app",
  "preview",
  "preview--stridewms",
  "stridewms",
  "localhost",
  "__public__",
]);

type ConsentStatus = "opted_in" | "opted_out" | "pending";
type ConsentMethod = "text_keyword" | "web_form" | "verbal" | "admin_manual" | "imported";

interface PublicTenantInfo {
  company_name: string | null;
  company_email: string | null;
  company_phone: string | null;
  logo_url: string | null;
  sms_opt_in_message: string | null;
  sms_help_message: string | null;
  sms_stop_message: string | null;
  sms_privacy_policy_url: string | null;
  sms_terms_conditions_url: string | null;
}

function normalizePhone(raw: string): string {
  const stripped = raw.replace(/[\s\-()]/g, "");
  const digitsOnly = stripped.startsWith("+")
    ? "+" + stripped.slice(1).replace(/\D/g, "")
    : stripped.replace(/\D/g, "");

  // If just digits with no +, assume US number
  if (!digitsOnly.startsWith("+")) {
    if (digitsOnly.length === 10) return "+1" + digitsOnly;
    if (digitsOnly.length === 11 && digitsOnly.startsWith("1"))
      return "+" + digitsOnly;
    return "+" + digitsOnly;
  }
  return digitsOnly;
}

function normalizeHost(rawHost: string): string {
  return rawHost.trim().toLowerCase().split(":")[0];
}

function buildDefaultTenantInfo(): PublicTenantInfo {
  return {
    company_name: "StrideWMS",
    company_email: "support@stridewms.com",
    company_phone: null,
    logo_url: null,
    sms_opt_in_message:
      "You are subscribed to SMS notifications. Reply STOP at any time to opt out.",
    sms_help_message:
      "For help, reply HELP or contact support@stridewms.com.",
    sms_stop_message:
      "You have been unsubscribed from SMS notifications.",
    sms_privacy_policy_url: null,
    sms_terms_conditions_url: null,
  };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

async function resolveTenantIdFromHint(
  supabase: any,
  tenantHint: string
): Promise<string | null> {
  const normalized = tenantHint.trim().toLowerCase();
  if (!normalized) return null;

  if (isUuid(normalized)) return normalized;

  const subdomainCandidate = normalized.split(".")[0];
  if (!subdomainCandidate || RESERVED_SUBDOMAINS.has(subdomainCandidate)) return null;

  const { data, error } = await supabase
    .from("tenant_company_settings")
    .select("tenant_id")
    .ilike("app_subdomain", subdomainCandidate)
    .maybeSingle();

  if (error) {
    console.error("resolveTenantIdFromHint lookup error:", error.message);
    return null;
  }

  return data?.tenant_id ?? null;
}

function extractTenantSubdomain(rawHost: string): string | null {
  const host = normalizeHost(rawHost);
  if (!host || host === "localhost") return null;

  const labels = host.split(".").filter(Boolean);
  if (labels.length < 3) return null;

  const candidate = labels[0];
  if (!candidate || RESERVED_SUBDOMAINS.has(candidate)) return null;

  return candidate;
}

async function resolveTenantIdFromHost(
  supabase: any,
  rawHost: string
): Promise<string | null> {
  const subdomain = extractTenantSubdomain(rawHost);
  if (!subdomain) return null;

  const { data, error } = await supabase
    .from("tenant_company_settings")
    .select("tenant_id")
    .ilike("app_subdomain", subdomain)
    .maybeSingle();

  if (error) {
    console.error("resolveTenantIdFromHost lookup error:", error.message);
    return null;
  }

  return data?.tenant_id ?? null;
}

async function loadTenantInfo(
  supabase: any,
  tenantId: string,
  tenantName: string | null
): Promise<PublicTenantInfo> {
  const defaults = buildDefaultTenantInfo();
  const { data: settings } = await supabase
    .from("tenant_company_settings")
    .select(
      "company_name, company_email, company_phone, logo_url, sms_opt_in_message, sms_help_message, sms_stop_message, sms_privacy_policy_url, sms_terms_conditions_url"
    )
    .eq("tenant_id", tenantId)
    .maybeSingle();

  return {
    company_name: settings?.company_name || tenantName || defaults.company_name,
    company_email: settings?.company_email || defaults.company_email,
    company_phone: settings?.company_phone || defaults.company_phone,
    logo_url: settings?.logo_url || defaults.logo_url,
    sms_opt_in_message: settings?.sms_opt_in_message || defaults.sms_opt_in_message,
    sms_help_message: settings?.sms_help_message || defaults.sms_help_message,
    sms_stop_message: settings?.sms_stop_message || defaults.sms_stop_message,
    sms_privacy_policy_url:
      settings?.sms_privacy_policy_url || defaults.sms_privacy_policy_url,
    sms_terms_conditions_url:
      settings?.sms_terms_conditions_url || defaults.sms_terms_conditions_url,
  };
}

async function upsertGlobalConsent(
  supabase: any,
  args: {
    phoneNumber: string;
    status: ConsentStatus;
    method: ConsentMethod;
    source: string;
    tenantId: string | null;
    contactName: string | null;
    keyword: string | null;
  }
): Promise<{ id: string; already: boolean; previousStatus: string | null }> {
  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await supabase
    .from("global_sms_consent")
    .select("id, status")
    .eq("phone_number", args.phoneNumber)
    .maybeSingle();
  if (existingError) throw existingError;

  const payload: Record<string, unknown> = {
    phone_number: args.phoneNumber,
    status: args.status,
    consent_method: args.method,
    last_source: args.source,
    last_keyword: args.status === "opted_out" ? args.keyword || "STOP" : null,
    metadata: {
      contact_name: args.contactName,
      tenant_id: args.tenantId,
    },
  };

  if (args.status === "opted_in") {
    payload.opted_in_at = now;
  }
  if (args.status === "opted_out") {
    payload.opted_out_at = now;
  }

  let consentId: string;
  if (existing?.id) {
    const { data: updated, error: updateError } = await supabase
      .from("global_sms_consent")
      .update(payload)
      .eq("id", existing.id)
      .select("id")
      .single();
    if (updateError) throw updateError;
    consentId = String(updated.id);
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from("global_sms_consent")
      .insert(payload)
      .select("id")
      .single();
    if (insertError) throw insertError;
    consentId = String(inserted.id);
  }

  const previousStatus = existing?.status ? String(existing.status) : null;
  const already = previousStatus === args.status;

  if (!already || !previousStatus) {
    const logAction =
      !previousStatus
        ? "created"
        : args.status === "opted_in"
          ? "opt_in"
          : args.status === "opted_out"
            ? "opt_out"
            : "status_change";

    await supabase.from("global_sms_consent_log").insert({
      consent_id: consentId,
      phone_number: args.phoneNumber,
      action: logAction,
      method: args.method,
      keyword: args.status === "opted_out" ? args.keyword || "STOP" : null,
      previous_status: previousStatus,
      new_status: args.status,
      tenant_id: args.tenantId,
      source: args.source,
      metadata: {
        contact_name: args.contactName,
      },
    });
  }

  return { id: consentId, already, previousStatus };
}

async function upsertTenantConsent(
  supabase: any,
  args: {
    tenantId: string;
    phoneNumber: string;
    status: ConsentStatus;
    method: ConsentMethod;
    contactName: string | null;
    keyword: string | null;
    source: string;
  }
): Promise<{ already: boolean }> {
  const now = new Date().toISOString();
  const { data: existing, error: existingError } = await supabase
    .from("sms_consent")
    .select("id, status")
    .eq("tenant_id", args.tenantId)
    .eq("phone_number", args.phoneNumber)
    .maybeSingle();
  if (existingError) throw existingError;

  const payload: Record<string, unknown> = {
    tenant_id: args.tenantId,
    phone_number: args.phoneNumber,
    contact_name: args.contactName || null,
    status: args.status,
    consent_method: args.method,
    last_keyword: args.status === "opted_out" ? args.keyword || "STOP" : null,
  };
  if (args.status === "opted_in") payload.opted_in_at = now;
  if (args.status === "opted_out") payload.opted_out_at = now;

  let consentId: string;
  if (existing?.id) {
    const { data: updated, error: updateError } = await supabase
      .from("sms_consent")
      .update(payload)
      .eq("id", existing.id)
      .select("id")
      .single();
    if (updateError) throw updateError;
    consentId = String(updated.id);
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from("sms_consent")
      .insert(payload)
      .select("id")
      .single();
    if (insertError) throw insertError;
    consentId = String(inserted.id);
  }

  const previousStatus = existing?.status ? String(existing.status) : null;
  const already = previousStatus === args.status;

  if (!already || !previousStatus) {
    const logAction =
      !previousStatus
        ? "created"
        : args.status === "opted_in"
          ? "opt_in"
          : args.status === "opted_out"
            ? "opt_out"
            : "status_change";

    await supabase.from("sms_consent_log").insert({
      tenant_id: args.tenantId,
      consent_id: consentId,
      phone_number: args.phoneNumber,
      action: logAction,
      method: args.method,
      keyword: args.status === "opted_out" ? args.keyword || "STOP" : null,
      previous_status: previousStatus,
      new_status: args.status,
      actor_name: args.source,
    });
  }

  return { already };
}

async function syncTenantConsentsFromGlobal(
  supabase: any,
  phoneNumber: string,
  contactName: string | null,
  source: string
): Promise<number> {
  try {
    const { data, error } = await (supabase as any).rpc(
      "sync_tenant_sms_consent_from_global_phone",
      {
        p_phone_number: phoneNumber,
        p_contact_name: contactName,
        p_source: source,
      }
    );
    if (error) {
      console.error("sync_tenant_sms_consent_from_global_phone error:", error.message);
      return 0;
    }
    return Number(data?.synced_tenant_count || 0);
  } catch (error) {
    console.error("sync_tenant_sms_consent_from_global_phone failed:", error);
    return 0;
  }
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const action = body?.action;
    const tenantHint =
      (typeof body?.tenant_id === "string" && body.tenant_id.trim()) ||
      (typeof body?.tenant_slug === "string" && body.tenant_slug.trim()) ||
      (typeof body?.tenant_key === "string" && body.tenant_key.trim()) ||
      null;
    const requestedHost =
      typeof body?.host === "string" && body.host.trim() ? body.host.trim() : null;
    let resolvedTenantId: string | null = null;

    if (tenantHint) {
      resolvedTenantId = await resolveTenantIdFromHint(supabase, tenantHint);
    }

    if (!resolvedTenantId && requestedHost) {
      resolvedTenantId = await resolveTenantIdFromHost(supabase, requestedHost);
    }

    let tenant: { id: string; name: string; status: string } | null = null;
    if (resolvedTenantId) {
      const { data: tenantData } = await supabase
        .from("tenants")
        .select("id, name, status")
        .eq("id", resolvedTenantId)
        .maybeSingle();
      if (tenantData && tenantData.status === "active") {
        tenant = {
          id: String(tenantData.id),
          name: String(tenantData.name || "Tenant"),
          status: String(tenantData.status || "active"),
        };
      }
    }

    if (action === "get_tenant_info" || action === "resolve_tenant") {
      if (tenant) {
        const tenantInfo = await loadTenantInfo(supabase, tenant.id, tenant.name);
        return jsonResponse({
          tenant_id: tenant.id,
          tenant: tenantInfo,
          requires_tenant_context: false,
        });
      }

      return jsonResponse({
        // Keep a stable sentinel value so older public-page bundles
        // that require tenant_id can still proceed in phone-first mode.
        tenant_id: "__public__",
        tenant: buildDefaultTenantInfo(),
        requires_tenant_context: false,
        tenant_resolution_warning:
          "No tenant was resolved. The form will still work in public phone-first mode.",
      });
    }

    if (action === "opt_in" || action === "opt_out") {
      const { phone_number, contact_name } = body;
      if (!phone_number) {
        return jsonResponse({ error: "Phone number is required" }, 400);
      }

      const normalized = normalizePhone(phone_number);
      if (!/^\+\d{7,15}$/.test(normalized)) {
        return jsonResponse(
          { error: "Invalid phone number format. Please use a valid phone number." },
          400
        );
      }

      const nextStatus: ConsentStatus =
        action === "opt_in" ? "opted_in" : "opted_out";
      const source = tenant
        ? `public_sms_page:${tenant.id}`
        : "public_sms_page:global";
      const method: ConsentMethod = "web_form";
      const keyword = action === "opt_out" ? "STOP" : null;
      const contactName =
        typeof contact_name === "string" && contact_name.trim()
          ? contact_name.trim()
          : null;

      const globalResult = await upsertGlobalConsent(supabase, {
        phoneNumber: normalized,
        status: nextStatus,
        method,
        source,
        tenantId: tenant?.id || null,
        contactName,
        keyword,
      });

      let tenantAlready = false;
      if (tenant?.id) {
        const tenantResult = await upsertTenantConsent(supabase, {
          tenantId: tenant.id,
          phoneNumber: normalized,
          status: nextStatus,
          method,
          contactName,
          keyword,
          source,
        });
        tenantAlready = tenantResult.already;
      }

      const syncedTenantCount = await syncTenantConsentsFromGlobal(
        supabase,
        normalized,
        contactName,
        source
      );

      if (action === "opt_in") {
        const already = globalResult.already && (tenant ? tenantAlready : true);
        return jsonResponse({
          success: true,
          already_subscribed: already,
          message: already
            ? "This phone number is already subscribed to SMS notifications."
            : "Successfully subscribed to SMS notifications.",
          phone_number: normalized,
          tenant_id: tenant?.id || null,
          synced_tenant_count: syncedTenantCount,
        });
      }

      const already = globalResult.already && (tenant ? tenantAlready : true);
      return jsonResponse({
        success: true,
        already_unsubscribed: already,
        message: already
          ? "This phone number is already unsubscribed from SMS notifications."
          : "Successfully unsubscribed from SMS notifications.",
        phone_number: normalized,
        tenant_id: tenant?.id || null,
        synced_tenant_count: syncedTenantCount,
      });
    }

    return jsonResponse({ error: "Invalid action" }, 400);
  } catch (error: any) {
    console.error("sms-opt-in error:", error);
    return jsonResponse(
      { error: error.message || "An unexpected error occurred" },
      500
    );
  }
};

function jsonResponse(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

serve(handler);
