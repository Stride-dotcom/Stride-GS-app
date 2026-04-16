import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { isValidEmail, resolvePlatformEmailDefaults } from "../_shared/platformEmail.ts";
import { resolveTenantReplyToRoutingAddress } from "../_shared/inboundReplyRouting.ts";
import { sendPlatformEmail, type EmailProvider } from "../_shared/emailProviders.ts";
import { renderBrandedEmail, resolvePlatformEmailWrapperTemplate } from "../_shared/emailBranding.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface TestEmailRequest {
  to_email: string;
  subject: string;
  body_html: string;
  body_format?: "html" | "text";
  from_name?: string;
  from_email?: string;
  tenant_id: string;
  provider_override?: "resend" | "postmark" | "auto";
}

async function authenticateAndAuthorize(req: Request, tenant_id: string) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("UNAUTHORIZED");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const token = authHeader.replace("Bearer ", "");
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) {
    throw new Error("UNAUTHORIZED");
  }

  const userId = user.id;

  // Verify tenant membership using service role
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, supabaseServiceKey);

  const { data: userData, error: userError } = await adminClient
    .from("users")
    .select("tenant_id")
    .eq("id", userId)
    .single();

  if (userError || !userData || userData.tenant_id !== tenant_id) {
    throw new Error("FORBIDDEN");
  }

  return { userId, adminClient };
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const {
      to_email,
      subject,
      body_html,
      body_format,
      from_name,
      from_email,
      tenant_id,
      provider_override,
    }: TestEmailRequest = await req.json();

    // Authenticate and verify tenant membership
    const { adminClient: supabase } = await authenticateAndAuthorize(req, tenant_id);

    // Fetch brand settings for wrapping
    const { data: brandSettings } = await supabase
      .from('communication_brand_settings')
      .select('*')
      .eq('tenant_id', tenant_id)
      .single();

    const { data: companySettings } = await supabase
      .from('tenant_company_settings')
      .select('company_name, logo_url, company_email, company_address, app_base_url')
      .eq('tenant_id', tenant_id)
      .maybeSingle();

    const { data: tenant } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', tenant_id)
      .single();

    // Source logo strictly from Organization > Company Info (tenant_company_settings.logo_url)
    const logoUrl = companySettings?.logo_url || '';
    const companyName = companySettings?.company_name || tenant?.name || 'Stride Warehouse';
    const primaryColor = brandSettings?.brand_primary_color || '#FD5A2A';
    const platformDefaults = await resolvePlatformEmailDefaults(supabase);
    const platformWrapperHtml = await resolvePlatformEmailWrapperTemplate(supabase);

    const rendered = renderBrandedEmail({
      subject: subject || "Test Email",
      bodyTemplate: body_html || "",
      bodyFormat: body_format,
      accentColor: primaryColor,
      wrapperHtmlTemplate: platformWrapperHtml,
      includeTestBanner: true,
    });

    const brandTokens: Record<string, string> = {
      tenant_name: companyName,
      brand_logo_url: logoUrl,
      brand_support_email: brandSettings?.brand_support_email || companySettings?.company_email || platformDefaults.replyTo || "",
      tenant_company_address: companySettings?.company_address || "",
      portal_base_url: brandSettings?.portal_base_url || companySettings?.app_base_url || "",
      brand_primary_color: primaryColor,
    };

    let wrappedHtml = rendered.html;
    for (const [key, value] of Object.entries(brandTokens)) {
      wrappedHtml = wrappedHtml
        .replace(new RegExp(`\\[\\[${key}\\]\\]`, "g"), value || "")
        .replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value || "");
    }

    const senderName =
      from_name ||
      brandSettings?.from_name ||
      companyName ||
      platformDefaults.fromName;

    let senderEmail = from_email;
    if (!senderEmail) {
      const wantsCustom = brandSettings?.use_default_email === false;
      const isVerified = brandSettings?.email_domain_verified === true;
      if (wantsCustom && isVerified && (brandSettings?.from_email || brandSettings?.custom_email_domain)) {
        senderEmail = brandSettings?.from_email || brandSettings?.custom_email_domain;
      } else {
        senderEmail = platformDefaults.fromEmail;
      }
    }

    const routingReplyTo = await resolveTenantReplyToRoutingAddress(supabase, tenant_id);
    const supportEmail = (brandSettings?.brand_support_email || "").trim();
    const replyTo = routingReplyTo || (isValidEmail(supportEmail) ? supportEmail : platformDefaults.replyTo);

    console.log("Sending test email to:", to_email, "from:", senderEmail);

    const normalizedOverride = typeof provider_override === "string" ? provider_override.trim().toLowerCase() : "";
    const forceProvider: EmailProvider | null =
      normalizedOverride === "resend" || normalizedOverride === "postmark"
        ? (normalizedOverride as EmailProvider)
        : null;

    const emailResponse = await sendPlatformEmail(supabase, {
      fromEmail: senderEmail || "",
      fromName: senderName,
      to: [to_email],
      subject: `[TEST] ${subject || "Test Email"}`,
      html: wrappedHtml,
      text: rendered.text,
      replyTo,
      forceProvider,
    });

    console.log("Test email sent:", emailResponse);

    return new Response(
      JSON.stringify({
        success: true,
        data: emailResponse,
        provider: emailResponse.provider,
        provider_message_id: emailResponse.id,
        fallback_used: emailResponse.fallbackUsed,
        attempted_providers: emailResponse.attemptedProviders,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    if (error.message === "UNAUTHORIZED") {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
    if (error.message === "FORBIDDEN") {
      return new Response(
        JSON.stringify({ error: "Forbidden: tenant mismatch" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }
    console.error("Error sending test email:", error);
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
