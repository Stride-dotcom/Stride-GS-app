import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  resolveEmailDomainProvider,
  verifyDomainWithProvider,
  providerToVerificationType,
  verificationTypeToProvider,
} from "../_shared/emailDomainProviders.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get tenant_id and resend_domain_id from user profile
    const { data: profile } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (!profile?.tenant_id) {
      return new Response(
        JSON.stringify({ error: "User has no tenant" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get current sender domain state from brand settings.
    const { data: brandSettings } = await supabase
      .from("communication_brand_settings")
      .select("resend_domain_id, custom_email_domain, from_email, email_verification_type")
      .eq("tenant_id", profile.tenant_id)
      .maybeSingle();

    if (!brandSettings?.resend_domain_id) {
      return new Response(
        JSON.stringify({ 
          error: "No domain registered. Please register your domain first.",
          verified: false,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const provider =
      verificationTypeToProvider(brandSettings.email_verification_type) ||
      (await resolveEmailDomainProvider(supabase, profile.tenant_id));
    const domainId = brandSettings.resend_domain_id;
    const fallbackDomainSource = String(brandSettings.custom_email_domain || brandSettings.from_email || "");
    const fallbackDomainParts = fallbackDomainSource.split("@");
    const fallbackDomain = fallbackDomainParts[fallbackDomainParts.length - 1] || "custom-domain";

    console.log(
      `[verify-email-domain] Verifying domain ${domainId} with ${provider} for tenant ${profile.tenant_id}`,
    );

    const snapshot = await verifyDomainWithProvider(provider, domainId, fallbackDomain);

    // Update the database with verification status
    const updatePayload: Record<string, unknown> = {
      email_domain_verified: snapshot.verified,
      spf_verified: snapshot.spfVerified,
      dkim_verified: snapshot.dkimVerified,
      email_verified_at: snapshot.verified ? new Date().toISOString() : null,
      resend_dns_records: snapshot.records,
      email_verification_type: providerToVerificationType(snapshot.provider),
    };

    // Keep from_email in sync with the wizard field if it hasn't been set yet.
    if (!brandSettings?.from_email && brandSettings?.custom_email_domain) {
      updatePayload.from_email = brandSettings.custom_email_domain;
    }

    await supabase
      .from("communication_brand_settings")
      .update(updatePayload)
      .eq("tenant_id", profile.tenant_id);

    const message = snapshot.verified
      ? "Domain verified successfully! Emails will now be sent from your custom domain."
      : `Domain verification pending. SPF: ${snapshot.spfVerified ? "✓" : "pending"}, DKIM: ${snapshot.dkimVerified ? "✓" : "pending"}. Please ensure DNS records are configured correctly.`;

    return new Response(
      JSON.stringify({
        provider: snapshot.provider,
        verified: snapshot.verified,
        status: snapshot.status,
        spf_verified: snapshot.spfVerified,
        dkim_verified: snapshot.dkimVerified,
        records: snapshot.records,
        message,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error in verify-email-domain function:", error);
    return new Response(
      JSON.stringify({ error: error.message, verified: false }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
