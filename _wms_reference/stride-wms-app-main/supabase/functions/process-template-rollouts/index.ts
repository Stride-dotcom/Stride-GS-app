import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ProcessRolloutsRequest {
  limit?: number;
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing Supabase environment variables" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let limit = 25;
    if (req.method !== "GET") {
      const body = (await req.json().catch(() => ({}))) as ProcessRolloutsRequest;
      if (typeof body.limit === "number" && Number.isFinite(body.limit)) {
        limit = Math.max(1, Math.min(200, Math.floor(body.limit)));
      }
    } else {
      const parsed = Number(new URL(req.url).searchParams.get("limit"));
      if (Number.isFinite(parsed)) {
        limit = Math.max(1, Math.min(200, Math.floor(parsed)));
      }
    }

    const { data, error } = await supabase.rpc("rpc_process_due_template_rollouts", {
      p_limit: limit,
    });
    if (error) {
      throw new Error(error.message);
    }

    return new Response(
      JSON.stringify({ ok: true, ...data }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[process-template-rollouts] failed:", message);
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
