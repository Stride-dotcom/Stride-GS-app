import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Demo tenant ID for admin-dev user (required for app to function)
const DEMO_TENANT_ID = "00000000-0000-0000-0000-000000000001";

type DevRole =
  | "admin_dev"
  | "admin"
  | "manager"
  | "warehouse"
  | "technician"
  | "client_user"
  | "billing_manager";

const DEV_LOGIN_CONFIG: Record<
  DevRole,
  { email: string; password: string; firstName: string; lastName: string; systemRole: boolean }
> = {
  admin_dev: {
    email: "admin-dev@dev.local",
    password: "devquick123!",
    firstName: "Admin",
    lastName: "Dev",
    systemRole: true,
  },
  admin: {
    email: "admin@dev.local",
    password: "devquick123!",
    firstName: "Admin",
    lastName: "Tenant",
    systemRole: false,
  },
  manager: {
    email: "manager@dev.local",
    password: "devquick123!",
    firstName: "Manager",
    lastName: "Demo",
    systemRole: false,
  },
  warehouse: {
    email: "warehouse@dev.local",
    password: "devquick123!",
    firstName: "Warehouse",
    lastName: "Demo",
    systemRole: false,
  },
  technician: {
    email: "technician@dev.local",
    password: "devquick123!",
    firstName: "Tech",
    lastName: "Demo",
    systemRole: false,
  },
  client_user: {
    email: "client@dev.local",
    password: "devquick123!",
    firstName: "Client",
    lastName: "Demo",
    systemRole: false,
  },
  billing_manager: {
    email: "billing@dev.local",
    password: "devquick123!",
    firstName: "Billing",
    lastName: "Manager",
    systemRole: false,
  },
};

/**
 * Edge function to provision and sign in a dev quick-login user.
 *
 * This function:
 * 1. Only works in development mode (VITE_ENABLE_DEV_QUICK_LOGIN=true)
 * 2. Creates role-specific dev users if they don't exist
 * 3. Assigns the requested role in the demo tenant (or admin_dev system role)
 * 4. Returns session credentials for the user
 *
 * SECURITY: This function should NEVER be enabled in production.
 */
const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // SECURITY: Block in production environments
    const environment = Deno.env.get("ENVIRONMENT") || Deno.env.get("APP_ENV") || "";
    if (environment.toLowerCase() === "production" || environment.toLowerCase() === "prod") {
      console.warn("dev-admin-login blocked: production environment detected");
      return new Response(
        JSON.stringify({ error: "Not available" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // Check if dev mode is enabled
    const devModeEnabled = Deno.env.get("VITE_ENABLE_DEV_QUICK_LOGIN") === "true" ||
                           Deno.env.get("DEV_MODE") === "true";

    if (!devModeEnabled) {
      return new Response(
        JSON.stringify({ error: "Not available" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    let requestedRole: DevRole = "admin_dev";
    if (req.method !== "GET") {
      try {
        const rawBody = await req.text();
        if (rawBody) {
          const parsed = JSON.parse(rawBody);
          const roleFromBody = String(parsed?.role || "").trim() as DevRole;
          if (roleFromBody && roleFromBody in DEV_LOGIN_CONFIG) {
            requestedRole = roleFromBody;
          }
        }
      } catch {
        // Ignore malformed body and fall back to admin_dev.
      }
    }

    const cfg = DEV_LOGIN_CONFIG[requestedRole];
    if (!cfg) {
      return new Response(
        JSON.stringify({ error: `Unsupported dev role: ${requestedRole}`, success: false }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing");
    }

    // Create admin client with service role
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Step 1: Check if user exists
    const { data: existingUsers, error: listError } = await adminClient.auth.admin.listUsers();

    if (listError) {
      throw new Error(`Failed to list users: ${listError.message}`);
    }

    let userId: string;
    const existingUser = existingUsers.users.find((u) => u.email === cfg.email);

    if (existingUser) {
      userId = existingUser.id;
      console.log(`Found existing dev user for role ${requestedRole}: ${userId}`);

      // Reset password to the expected dev password so signInWithPassword works
      const { error: pwError } = await adminClient.auth.admin.updateUserById(userId, {
        password: cfg.password,
      });
      if (pwError) {
        console.warn(`Could not reset dev user password: ${pwError.message}`);
      }
      
      // Ensure profile exists for existing user (might be missing due to previous RLS issues)
      const { error: profileError } = await adminClient
        .from('users')
        .upsert({
          id: userId,
          email: cfg.email,
          password_hash: 'supabase_auth_managed',
          first_name: cfg.firstName,
          last_name: cfg.lastName,
          status: 'active',
          tenant_id: DEMO_TENANT_ID,
        }, {
          onConflict: 'id',
        });

      if (profileError) {
        console.warn(`Note: Could not ensure user profile: ${profileError.message}`);
      } else {
        console.log(`Ensured user profile exists for ${userId}`);
      }
    } else {
      // Step 2: Create the user if doesn't exist
      const { data: newUser, error: createError } = await adminClient.auth.admin.createUser({
        email: cfg.email,
        password: cfg.password,
        email_confirm: true, // Auto-confirm email
        user_metadata: {
          first_name: cfg.firstName,
          last_name: cfg.lastName,
        },
      });

      if (createError) {
        throw new Error(`Failed to create user: ${createError.message}`);
      }

      userId = newUser.user.id;
      console.log(`Created new dev user for role ${requestedRole}: ${userId}`);

      // Create user profile in users table with demo tenant
      const { error: profileError } = await adminClient
        .from('users')
        .upsert({
          id: userId,
          email: cfg.email,
          password_hash: 'supabase_auth_managed',
          first_name: cfg.firstName,
          last_name: cfg.lastName,
          status: 'active',
          tenant_id: DEMO_TENANT_ID, // Use demo tenant for app access
        }, {
          onConflict: 'id',
        });

      if (profileError) {
        console.warn(`Note: Could not create user profile: ${profileError.message}`);
        // Don't fail - user profile might be created by trigger
      } else {
        console.log(`Created user profile for ${userId} with tenant ${DEMO_TENANT_ID}`);
      }
    }

    // Step 3: Ensure requested role is assigned
    let roleId: string | null = null;
    if (!cfg.systemRole) {
      // Best-effort seed for tenant roles if missing in this environment.
      try { await adminClient.rpc("seed_standard_roles", { p_tenant_id: DEMO_TENANT_ID }); } catch (_) { /* best-effort */ }
    }

    const roleQuery = adminClient
      .from("roles")
      .select("id")
      .eq("name", requestedRole)
      .is("deleted_at", null)
      .limit(1);

    const { data: roleData, error: roleError } = cfg.systemRole
      ? await roleQuery.eq("is_system", true).maybeSingle()
      : await roleQuery.eq("tenant_id", DEMO_TENANT_ID).maybeSingle();

    if (roleError || !roleData?.id) {
      throw new Error(`Role not found for quick login: ${requestedRole}`);
    }
    roleId = roleData.id;

    // Check if user already has the role
    const { data: existingRole } = await adminClient
      .from('user_roles')
      .select('id, deleted_at')
      .eq('user_id', userId)
      .eq('role_id', roleId)
      .maybeSingle();

    if (!existingRole) {
      // Assign requested role
      const { error: assignError } = await adminClient
        .from('user_roles')
        .insert({
          user_id: userId,
          role_id: roleId,
        });

      if (assignError) {
        console.warn(`Note: Could not assign role: ${assignError.message}`);
        // Don't fail - might be RLS issue but user can still sign in
      } else {
        console.log(`Assigned ${requestedRole} role to user ${userId}`);
      }
    } else if (existingRole.deleted_at) {
      const { error: undeleteRoleError } = await adminClient
        .from("user_roles")
        .update({ deleted_at: null })
        .eq("id", existingRole.id);
      if (undeleteRoleError) {
        console.warn(`Note: Could not reactivate existing role assignment: ${undeleteRoleError.message}`);
      }
    }

    // Step 4: Sign in the user and return session
    const { data: signInData, error: signInError } = await adminClient.auth.signInWithPassword({
      email: cfg.email,
      password: cfg.password,
    });

    if (signInError) {
      throw new Error(`Failed to sign in: ${signInError.message}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        role: requestedRole,
        session: signInData.session,
        user: {
          id: signInData.user?.id,
          email: signInData.user?.email,
        },
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("Error in dev-admin-login:", error);
    return new Response(
      JSON.stringify({
        error: "An internal error occurred",
        success: false,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
};

serve(handler);
