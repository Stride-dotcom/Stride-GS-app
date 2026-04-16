import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// In-memory rate limiting cache (resets on function cold start)
const rateLimitCache = new Map<string, number>();
const RATE_LIMIT_MS = 60000; // 1 minute

// PII patterns to redact
const piiPatterns = [
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // emails
  /\b\d{3}-\d{2}-\d{4}\b/g, // SSN (XXX-XX-XXXX)
  /\b\d{9}\b/g, // SSN without dashes
  /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, // card numbers
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, // phone numbers
  /\b(?:\+1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, // US phone with country code
];

function sanitizeString(str: string): string {
  if (!str) return str;
  let sanitized = str;
  for (const pattern of piiPatterns) {
    sanitized = sanitized.replace(pattern, "[REDACTED]");
  }
  return sanitized;
}

function sanitizeObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return sanitizeString(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  if (typeof obj === "object") {
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      // Never store actual values for sensitive field names
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("password") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("token") ||
        lowerKey.includes("ssn") ||
        lowerKey.includes("card") ||
        lowerKey.includes("cvv") ||
        lowerKey.includes("pin")
      ) {
        sanitized[key] = "[REDACTED]";
      } else {
        sanitized[key] = sanitizeObject(value);
      }
    }
    return sanitized;
  }
  return obj;
}

function truncateString(str: string | undefined | null, maxLength: number): string | null {
  if (!str) return null;
  return str.length > maxLength ? str.substring(0, maxLength) + "...[truncated]" : str;
}

function determineSeverity(
  level: string,
  hasBlankScreen: boolean,
  errorMessage: string,
  httpStatus?: number
): "P0" | "P1" | "P2" {
  // P0: Crashes and blank screens
  if (hasBlankScreen) return "P0";
  if (errorMessage.toLowerCase().includes("crash")) return "P0";
  if (errorMessage.toLowerCase().includes("unhandled")) return "P0";
  
  // P1: Major errors (server errors, RLS denials)
  if (httpStatus && httpStatus >= 500) return "P1";
  if (httpStatus === 403 || httpStatus === 401) return "P1";
  if (level === "error") return "P1";
  
  // P2: Warnings and minor issues
  return "P2";
}

interface LogPayload {
  environment: "dev" | "prod";
  app_version?: string;
  user_id?: string;
  user_role?: string;
  account_id?: string;
  tenant_id?: string;
  route: string;
  component_name?: string;
  action_context?: string;
  level: "error" | "warning";
  error_message: string;
  stack_trace?: string;
  http_status?: number;
  supabase_error_code?: string;
  request_summary?: Record<string, unknown>;
  has_blank_screen?: boolean;
  fingerprint: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const payload: LogPayload = await req.json();

    // Validate required fields
    if (!payload.environment || !payload.route || !payload.level || !payload.error_message || !payload.fingerprint) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate enums
    if (!["dev", "prod"].includes(payload.environment)) {
      return new Response(
        JSON.stringify({ error: "Invalid environment" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!["error", "warning"].includes(payload.level)) {
      return new Response(
        JSON.stringify({ error: "Invalid level" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Rate limiting: 1 per fingerprint per minute per user
    const rateLimitKey = `${payload.fingerprint}:${payload.user_id || "anon"}`;
    const lastLogged = rateLimitCache.get(rateLimitKey);
    const now = Date.now();

    if (lastLogged && now - lastLogged < RATE_LIMIT_MS) {
      return new Response(
        JSON.stringify({ message: "Rate limited", skipped: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update rate limit cache
    rateLimitCache.set(rateLimitKey, now);

    // Clean up old cache entries (prevent memory leak)
    for (const [key, timestamp] of rateLimitCache.entries()) {
      if (now - timestamp > RATE_LIMIT_MS * 10) {
        rateLimitCache.delete(key);
      }
    }

    // Sanitize all string fields
    const sanitizedMessage = sanitizeString(payload.error_message);
    const sanitizedStack = truncateString(sanitizeString(payload.stack_trace || ""), 10000);
    const sanitizedComponent = sanitizeString(payload.component_name || "");
    const sanitizedAction = sanitizeString(payload.action_context || "");
    const sanitizedRequestSummary = payload.request_summary
      ? sanitizeObject(payload.request_summary)
      : null;

    // Determine severity
    const severity = determineSeverity(
      payload.level,
      payload.has_blank_screen || false,
      sanitizedMessage,
      payload.http_status
    );

    // Validate role if provided
    const validRoles = ["admin", "admin_dev", "manager", "warehouse", "technician", "client_user", "billing_manager"];
    const userRole = payload.user_role && validRoles.includes(payload.user_role)
      ? payload.user_role
      : null;

    // Create Supabase client with anon key (RLS policy allows inserts)
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    // Insert the issue
    const { error: insertError } = await supabase.from("app_issues").insert({
      environment: payload.environment,
      app_version: payload.app_version || null,
      user_id: payload.user_id || null,
      user_role: userRole,
      account_id: payload.account_id || null,
      tenant_id: payload.tenant_id || null,
      route: payload.route,
      component_name: sanitizedComponent || null,
      action_context: sanitizedAction || null,
      level: payload.level,
      error_message: truncateString(sanitizedMessage, 1000),
      stack_trace: sanitizedStack,
      http_status: payload.http_status || null,
      supabase_error_code: payload.supabase_error_code || null,
      request_summary: sanitizedRequestSummary,
      severity,
      fingerprint: payload.fingerprint,
      status: "new",
    });

    if (insertError) {
      console.error("Failed to insert app issue:", insertError);
      return new Response(
        JSON.stringify({ error: "Failed to log issue" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, severity }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Error processing log request:", err);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
