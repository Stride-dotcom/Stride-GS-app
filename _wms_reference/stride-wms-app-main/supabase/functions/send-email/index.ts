import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { isValidEmail, resolvePlatformEmailDefaults, type PlatformEmailDefaults } from "../_shared/platformEmail.ts";
import { sendPlatformEmail, type EmailProvider } from "../_shared/emailProviders.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

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

function slugifyEmailLocalPart(value: string | null | undefined): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "tenant";
}

async function resolveTenantFallbackFromEmail(
  serviceClient: any,
  tenantId: string,
  platformDefaults: PlatformEmailDefaults
): Promise<string> {
  if (!platformDefaults.fallbackSenderDomain) {
    return platformDefaults.fromEmail;
  }

  const [{ data: tenantRow }, { data: companyRow }] = await Promise.all([
    serviceClient.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
    serviceClient
      .from("tenant_company_settings")
      .select("app_subdomain")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  const slug = slugifyEmailLocalPart(companyRow?.app_subdomain || tenantRow?.name || tenantId);
  return `${slug}@${platformDefaults.fallbackSenderDomain}`;
}

async function resolveTenantReplyToDefault(serviceClient: any, tenantId: string): Promise<string | null> {
  const { data: userRows } = await serviceClient
    .from("users")
    .select("id, email, status")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(100);

  const activeUsers = Array.isArray(userRows)
    ? userRows
        .filter((row: any) => ["active", "pending", "invited"].includes(String(row?.status ?? "")))
        .map((row: any) => ({
          id: String(row?.id ?? ""),
          email: String(row?.email ?? "").trim(),
        }))
        .filter((row: { id: string; email: string }) => row.id.length > 0 && isValidEmail(row.email))
    : [];

  if (activeUsers.length === 0) return null;

  const activeUserIds = activeUsers.map((row: { id: string }) => row.id);
  const { data: roleRows } = await serviceClient
    .from("user_roles")
    .select("user_id, role")
    .in("role", ["admin", "tenant_admin"])
    .in("user_id", activeUserIds);

  const adminUserIds = new Set(
    Array.isArray(roleRows)
      ? roleRows
          .map((row: any) => String(row?.user_id ?? ""))
          .filter((userId: string) => userId.length > 0)
      : []
  );

  const adminEmail =
    activeUsers.find((row: { id: string }) => adminUserIds.has(row.id))?.email || null;

  return adminEmail || activeUsers[0]?.email || null;
}

async function authenticateRequest(req: Request): Promise<{ userId: string; authHeader: string }> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("UNAUTHORIZED");
  }

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_ENV_MISSING");
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    throw new Error("UNAUTHORIZED");
  }

  return { userId: user.id, authHeader };
}

async function resolveSenderForTenant(
  serviceClient: any,
  platformDefaults: PlatformEmailDefaults,
  tenantId: string,
  userId: string
): Promise<{ fromEmail: string; fromName: string; replyTo?: string }> {
  // Verify user belongs to the tenant they are trying to send as
  const { data: userRow, error: userError } = await serviceClient
    .from("users")
    .select("tenant_id")
    .eq("id", userId)
    .maybeSingle();

  if (userError || !userRow?.tenant_id) {
    throw new Error("FORBIDDEN");
  }
  if (String(userRow.tenant_id) !== String(tenantId)) {
    throw new Error("FORBIDDEN");
  }

  const [{ data: brandSettings }, { data: companySettings }] = await Promise.all([
    serviceClient
      .from("communication_brand_settings")
      .select(
        "use_default_email, email_domain_verified, from_email, from_name, custom_email_domain, brand_support_email, reply_to_email"
      )
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    serviceClient
      .from("tenant_company_settings")
      .select("company_name, company_email")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  // Default sender unless tenant explicitly chose + verified a custom domain.
  let fromEmail = await resolveTenantFallbackFromEmail(serviceClient, tenantId, platformDefaults);
  let fromName = "";
  const wantsCustom = brandSettings?.use_default_email === false;
  const isVerified = brandSettings?.email_domain_verified === true;
  if (wantsCustom && isVerified) {
    fromEmail = String(
      brandSettings?.from_email ||
        brandSettings?.custom_email_domain ||
        fromEmail
    );
    fromName =
      String(brandSettings?.from_name || "").trim() ||
      String(companySettings?.company_name || "").trim() ||
      platformDefaults.fromName;
  }

  // Prefer explicit tenant reply-to. Otherwise fall back to tenant admin/owner email,
  // then company email, then platform default reply-to.
  let replyToCandidate: string | undefined = undefined;
  if (isValidEmail(brandSettings?.reply_to_email)) {
    replyToCandidate = brandSettings.reply_to_email;
  } else {
    const tenantUserFallback = await resolveTenantReplyToDefault(serviceClient, tenantId);
    replyToCandidate =
      tenantUserFallback ||
      (isValidEmail(companySettings?.company_email) ? companySettings.company_email : undefined) ||
      platformDefaults.replyTo ||
      undefined;
  }

  return replyToCandidate
    ? { fromEmail, fromName, replyTo: replyToCandidate }
    : { fromEmail, fromName };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  
  try {
    // Authenticate the request
    const { userId } = await authenticateRequest(req);

    const { to, subject, html, tenant_id, provider_override } = await req.json();
    
    if (!to || !subject || !html) {
      return jsonResponse({ ok: false, error: "Missing required fields: to, subject, html" }, 400);
    }
    
    const toList = Array.isArray(to) ? to : [to];
    const cleanedTo = toList
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter((v) => v.length > 0);

    if (cleanedTo.length === 0) {
      return jsonResponse({ ok: false, error: "Invalid to field" }, 400);
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return jsonResponse({ ok: false, error: "Supabase env vars are not configured" }, 500);
    }

    const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const platformDefaults = await resolvePlatformEmailDefaults(serviceClient);

    const sender =
      tenant_id && typeof tenant_id === "string" && tenant_id.trim().length > 0
        ? await resolveSenderForTenant(serviceClient, platformDefaults, tenant_id, userId)
        : {
          fromEmail: platformDefaults.fromEmail,
          fromName: platformDefaults.fromName,
          ...(platformDefaults.replyTo ? { replyTo: platformDefaults.replyTo } : {}),
        };

    const normalizedOverride =
      typeof provider_override === "string" ? provider_override.trim().toLowerCase() : "";
    const providerOverride: EmailProvider | null =
      normalizedOverride === "resend" || normalizedOverride === "postmark"
        ? (normalizedOverride as EmailProvider)
        : null;

    console.log(`Sending email to: ${cleanedTo.join(", ")}, subject: ${subject}`);

    const result = await sendPlatformEmail(serviceClient, {
      ...sender,
      to: cleanedTo,
      subject,
      html,
      forceProvider: providerOverride,
    });

    console.log("Email sent successfully:", result);

    return jsonResponse({
      ok: true,
      id: result?.id || null,
      provider: result.provider,
      fallback_used: result.fallbackUsed,
      attempted_providers: result.attemptedProviders,
    }, 200);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    
    if (message === "UNAUTHORIZED") {
      return jsonResponse({ ok: false, error: "Unauthorized" }, 401);
    }
    if (message === "FORBIDDEN") {
      return jsonResponse({ ok: false, error: "Forbidden" }, 403);
    }
    if (message === "SUPABASE_ENV_MISSING") {
      return jsonResponse({ ok: false, error: "Supabase env vars are not configured" }, 500);
    }

    console.error("send-email error:", message);
    
    return jsonResponse({ ok: false, error: message }, 500);
  }
});
