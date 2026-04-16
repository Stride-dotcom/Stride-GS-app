import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  resolveEmailDomainProvider,
  registerDomainWithProvider,
  providerToVerificationType,
} from "../_shared/emailDomainProviders.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface RegisterRequest {
  domain: string;
  provider?: "resend" | "postmark" | "auto";
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, "");
}

function isValidDomain(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(value);
}

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

    // Get tenant_id from user profile
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

    const { domain, provider: providerRequest }: RegisterRequest = await req.json();
    const normalizedDomain = normalizeDomain(domain || "");

    if (!normalizedDomain) {
      return new Response(
        JSON.stringify({ error: "Domain is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!isValidDomain(normalizedDomain)) {
      return new Response(
        JSON.stringify({ error: "Invalid domain format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const requestedProvider =
      typeof providerRequest === "string" && providerRequest.trim().toLowerCase() !== "auto"
        ? providerRequest
        : null;

    const provider = await resolveEmailDomainProvider(
      supabase,
      profile.tenant_id,
      requestedProvider,
    );

    console.log(
      `[register-email-domain] Registering ${normalizedDomain} with ${provider} for tenant ${profile.tenant_id}`,
    );

    const snapshot = await registerDomainWithProvider(provider, normalizedDomain);
    const providerLabel = snapshot.provider === "postmark" ? "Postmark" : "Resend";

    await supabase
      .from("communication_brand_settings")
      .upsert({
        tenant_id: profile.tenant_id,
        resend_domain_id: snapshot.domainId,
        resend_dns_records: snapshot.records,
        email_domain_verified: snapshot.verified,
        spf_verified: snapshot.spfVerified,
        dkim_verified: snapshot.dkimVerified,
        email_verified_at: snapshot.verified ? new Date().toISOString() : null,
        email_verification_type: providerToVerificationType(snapshot.provider),
      }, {
        onConflict: "tenant_id",
      });

    return new Response(
      JSON.stringify({
        success: true,
        provider: snapshot.provider,
        domain_id: snapshot.domainId,
        status: snapshot.status,
        verified: snapshot.verified,
        spf_verified: snapshot.spfVerified,
        dkim_verified: snapshot.dkimVerified,
        records: snapshot.records,
        message: snapshot.verified
          ? `Domain is already verified in ${providerLabel}.`
          : `Domain registered with ${providerLabel}. Add DNS records, then click Verify.`,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error in register-email-domain function:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
