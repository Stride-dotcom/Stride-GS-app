import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type CreateDocumentBody = {
  context_type: string;
  context_id: string | null;
  file_name: string;
  storage_key: string;
  file_size?: number | null;
  page_count?: number | null;
  mime_type?: string | null;
  ocr_text?: string | null;
  ocr_pages?: unknown | null;
  ocr_status?: string | null;
  label?: string | null;
  notes?: string | null;
  is_sensitive?: boolean | null;
  /**
   * Optional: soft-delete (archive) an existing document after inserting this one.
   * Used for "overwrite latest" behaviors like auto-generated receiving PDFs.
   *
   * SECURITY: replacement is constrained to the same context + tenant and requires
   * either (a) the storage_key matches the shipment.metadata.receiving_pdf_key, or
   * (b) the caller is admin/manager.
   */
  replace_storage_key?: string | null;
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
        JSON.stringify({ ok: false, error: "No authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const body: CreateDocumentBody = await req.json();
    if (!body?.context_type || !body?.file_name || !body?.storage_key) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Resolve tenant from the authenticated user
    const { data: profile, error: profileError } = await supabase
      .from("users")
      .select("tenant_id")
      .eq("id", user.id)
      .single();

    if (profileError || !profile?.tenant_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "User has no tenant" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Optional: resolve the user's role for authorization checks below.
    // (Not required for the most common "replace current receiving_pdf_key" flow.)
    let userRole: string | null = null;
    try {
      const { data: roleData, error: roleError } = await supabase.rpc("get_user_role", { _user_id: user.id });
      if (!roleError && typeof roleData === "string") {
        userRole = roleData;
      }
    } catch {
      // Ignore: older DBs may not have get_user_role yet.
    }

    // Optional: validate archive/replace inputs BEFORE insert so we don't create orphan records
    // if we later return an error response.
    const replaceKey = typeof body.replace_storage_key === "string" ? body.replace_storage_key.trim() : "";
    if (replaceKey) {
      // Replacement is only supported for shipment-scoped documents with a context_id.
      if (body.context_type !== "shipment" || !body.context_id) {
        return new Response(
          JSON.stringify({ ok: false, error: "replace_storage_key is only supported for shipment context" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // Confirm the shipment belongs to the caller's tenant and (for non-admins) that the key matches metadata.
      const { data: shipment, error: shipmentError } = await supabase
        .from("shipments")
        .select("id, tenant_id, metadata")
        .eq("id", body.context_id)
        .single();

      if (shipmentError || !shipment) {
        return new Response(
          JSON.stringify({ ok: false, error: "Invalid shipment context for replacement" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      if (shipment.tenant_id !== profile.tenant_id) {
        return new Response(
          JSON.stringify({ ok: false, error: "Shipment tenant mismatch" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      const meta = (shipment.metadata || {}) as Record<string, unknown>;
      const currentReceivingKey = typeof meta.receiving_pdf_key === "string" ? meta.receiving_pdf_key : null;
      const isPrivileged = userRole === "admin" || userRole === "manager";

      if (!isPrivileged && currentReceivingKey !== replaceKey) {
        return new Response(
          JSON.stringify({ ok: false, error: "Not authorized to replace this document" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    // Insert document record using service role (bypasses RLS)
    // We DO NOT trust tenant_id/created_by coming from the client.
    const { data: doc, error: insertError } = await supabase
      .from("documents")
      .insert({
        tenant_id: profile.tenant_id,
        created_by: user.id,
        context_type: body.context_type,
        context_id: body.context_id ?? null,
        file_name: body.file_name,
        storage_key: body.storage_key,
        file_size: body.file_size ?? null,
        page_count: body.page_count ?? null,
        mime_type: body.mime_type ?? null,
        ocr_text: body.ocr_text ?? null,
        ocr_pages: body.ocr_pages ?? null,
        ocr_status: body.ocr_status ?? null,
        label: body.label ?? null,
        notes: body.notes ?? null,
        is_sensitive: body.is_sensitive ?? false,
      })
      .select("id, tenant_id, storage_key")
      .single();

    if (insertError || !doc) {
      console.error("create-document insert failed", insertError);
      return new Response(
        JSON.stringify({ ok: false, error: insertError?.message || "Failed to create document" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Optional archive/replace step (post-insert so we never hide the prior doc if insert fails)
    if (replaceKey) {
      // Soft delete ONLY the specified storage_key within the same shipment context.
      // Keep the storage object intact for audit access via Activity links.
      try {
        const nowIso = new Date().toISOString();
        await supabase
          .from("documents")
          .update({ deleted_at: nowIso })
          .eq("tenant_id", profile.tenant_id)
          .eq("context_type", body.context_type)
          .eq("context_id", body.context_id)
          .eq("storage_key", replaceKey)
          .neq("id", doc.id)
          .is("deleted_at", null);

        // Also archive any other previous "Receiving Document - ..." rows for this shipment context.
        // This cleans up legacy duplicates created before overwrite support existed.
        if (typeof body.label === "string" && body.label.startsWith("Receiving Document -")) {
          await supabase
            .from("documents")
            .update({ deleted_at: nowIso })
            .eq("tenant_id", profile.tenant_id)
            .eq("context_type", body.context_type)
            .eq("context_id", body.context_id)
            .eq("label", body.label)
            .neq("id", doc.id)
            .is("deleted_at", null);
        }
      } catch (archiveErr) {
        // Archive failure should not block document creation.
        console.error("create-document archive failed", archiveErr);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, document: doc }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("create-document error", message);
    return new Response(
      JSON.stringify({ ok: false, error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
