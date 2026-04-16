/**
 * QuickBooks Online OAuth Handler
 *
 * Endpoints:
 * - GET /qbo-auth/connect - Initiates OAuth flow, returns redirect URL
 * - GET /qbo-auth/callback - Handles OAuth callback, stores tokens
 * - POST /qbo-auth/disconnect - Removes QBO connection
 * - GET /qbo-auth/status - Returns connection status
 */

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const QBO_CLIENT_ID = Deno.env.get("QBO_CLIENT_ID") || "";
const QBO_CLIENT_SECRET = Deno.env.get("QBO_CLIENT_SECRET") || "";
const QBO_REDIRECT_URI = Deno.env.get("QBO_REDIRECT_URI") || "";
const QBO_ENVIRONMENT = Deno.env.get("QBO_ENVIRONMENT") || "sandbox";
const APP_URL = Deno.env.get("APP_URL") || "";

const QBO_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const QBO_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/");
  const action = pathParts[pathParts.length - 1];

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth header (not required for callback)
    const authHeader = req.headers.get("Authorization");
    let userId: string | null = null;
    let tenantId: string | null = null;

    if (authHeader && action !== "callback") {
      const token = authHeader.replace("Bearer ", "");
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);

      if (authError || !user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      userId = user.id;

      // Get tenant_id from users table
      const { data: profile } = await supabase
        .from("users")
        .select("tenant_id")
        .eq("id", userId)
        .single();

      tenantId = profile?.tenant_id;

      if (!tenantId) {
        return new Response(JSON.stringify({ error: "No tenant found" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    switch (action) {
      case "connect": {
        // Validate QBO credentials are configured
        if (!QBO_CLIENT_ID || !QBO_REDIRECT_URI) {
          return new Response(JSON.stringify({
            error: "QuickBooks integration not configured. Please contact support."
          }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Generate OAuth URL with state parameter
        const state = btoa(JSON.stringify({ tenantId, userId }));
        const scope = "com.intuit.quickbooks.accounting";

        const authUrl = `${QBO_AUTH_URL}?` + new URLSearchParams({
          client_id: QBO_CLIENT_ID,
          redirect_uri: QBO_REDIRECT_URI,
          response_type: "code",
          scope,
          state,
        });

        return new Response(JSON.stringify({ authUrl }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "callback": {
        // Handle OAuth callback from QuickBooks
        const code = url.searchParams.get("code");
        const realmId = url.searchParams.get("realmId");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        // Handle error from QBO
        if (error) {
          console.error("QBO OAuth error:", error);
          return new Response(null, {
            status: 302,
            headers: {
              "Location": `${APP_URL}/settings?tab=integrations&qbo=error&message=${encodeURIComponent(error)}`,
            },
          });
        }

        if (!code || !realmId || !state) {
          return new Response("Missing required parameters", { status: 400 });
        }

        // Decode state to get tenant and user info
        let stateTenantId: string;
        let stateUserId: string;
        try {
          const decoded = JSON.parse(atob(state));
          stateTenantId = decoded.tenantId;
          stateUserId = decoded.userId;
        } catch {
          return new Response("Invalid state parameter", { status: 400 });
        }

        // Exchange authorization code for tokens
        const tokenResponse = await fetch(QBO_TOKEN_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": `Basic ${btoa(`${QBO_CLIENT_ID}:${QBO_CLIENT_SECRET}`)}`,
            "Accept": "application/json",
          },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: QBO_REDIRECT_URI,
          }),
        });

        const tokens = await tokenResponse.json();

        if (tokens.error) {
          console.error("Token exchange error:", tokens);
          return new Response(null, {
            status: 302,
            headers: {
              "Location": `${APP_URL}/settings?tab=integrations&qbo=error&message=${encodeURIComponent(tokens.error_description || tokens.error)}`,
            },
          });
        }

        // Calculate expiration times
        const now = new Date();
        const accessTokenExpiresAt = new Date(now.getTime() + (tokens.expires_in || 3600) * 1000);
        const refreshTokenExpiresAt = new Date(now.getTime() + (tokens.x_refresh_token_expires_in || 8726400) * 1000);

        // Get company info from QBO
        const qboApiBase = QBO_ENVIRONMENT === "production"
          ? "https://quickbooks.api.intuit.com"
          : "https://sandbox-quickbooks.api.intuit.com";

        let companyName = "QuickBooks Company";
        try {
          const companyResponse = await fetch(
            `${qboApiBase}/v3/company/${realmId}/companyinfo/${realmId}`,
            {
              headers: {
                "Authorization": `Bearer ${tokens.access_token}`,
                "Accept": "application/json",
              },
            }
          );
          const companyData = await companyResponse.json();
          companyName = companyData?.CompanyInfo?.CompanyName || companyName;
        } catch (err) {
          console.error("Error fetching company info:", err);
        }

        // Upsert QBO connection
        const { error: upsertError } = await supabase
          .from("qbo_connections")
          .upsert({
            tenant_id: stateTenantId,
            realm_id: realmId,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            access_token_expires_at: accessTokenExpiresAt.toISOString(),
            refresh_token_expires_at: refreshTokenExpiresAt.toISOString(),
            company_name: companyName,
            connected_by: stateUserId,
            connected_at: now.toISOString(),
            is_active: true,
            updated_at: now.toISOString(),
          }, {
            onConflict: "tenant_id",
          });

        if (upsertError) {
          console.error("Database upsert error:", upsertError);
          return new Response(null, {
            status: 302,
            headers: {
              "Location": `${APP_URL}/settings?tab=integrations&qbo=error&message=${encodeURIComponent("Failed to save connection")}`,
            },
          });
        }

        // Redirect back to app settings page with success
        return new Response(null, {
          status: 302,
          headers: {
            "Location": `${APP_URL}/settings?tab=integrations&qbo=connected`,
          },
        });
      }

      case "disconnect": {
        if (req.method !== "POST") {
          return new Response("Method not allowed", { status: 405 });
        }

        // Remove QBO connection
        const { error: deleteError } = await supabase
          .from("qbo_connections")
          .delete()
          .eq("tenant_id", tenantId);

        if (deleteError) {
          return new Response(JSON.stringify({ error: deleteError.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }

        // Also clear customer and item mappings
        await supabase.from("qbo_customer_map").delete().eq("tenant_id", tenantId);
        await supabase.from("qbo_item_map").delete().eq("tenant_id", tenantId);

        return new Response(JSON.stringify({ success: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "status": {
        // Get connection status
        const { data: connection } = await supabase
          .from("qbo_connections")
          .select("realm_id, company_name, connected_at, last_sync_at, is_active, access_token_expires_at, refresh_token_expires_at")
          .eq("tenant_id", tenantId)
          .single();

        const now = new Date();
        const tokenExpiresSoon = connection?.access_token_expires_at
          ? new Date(connection.access_token_expires_at) < new Date(now.getTime() + 5 * 60 * 1000)
          : false;
        const refreshTokenExpired = connection?.refresh_token_expires_at
          ? new Date(connection.refresh_token_expires_at) < now
          : false;

        return new Response(JSON.stringify({
          connected: !!connection?.is_active && !refreshTokenExpired,
          companyName: connection?.company_name,
          realmId: connection?.realm_id,
          connectedAt: connection?.connected_at,
          lastSyncAt: connection?.last_sync_at,
          tokenExpiresSoon,
          refreshTokenExpired,
        }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        return new Response("Not found", { status: 404 });
    }
  } catch (error) {
    console.error("QBO Auth Error:", error);
    return new Response(JSON.stringify({
      error: error instanceof Error ? error.message : "Unknown error"
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
