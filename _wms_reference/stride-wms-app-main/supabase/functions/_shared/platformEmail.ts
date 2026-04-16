export interface PlatformEmailDefaults {
  fromEmail: string;
  fromName: string;
  replyTo: string | null;
  fallbackSenderDomain: string | null;
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function isValidEmail(value: string | null | undefined): value is string {
  if (!value) return false;
  const trimmed = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/**
 * Resolve the platform-level default sender.
 *
 * Falls back to Edge Function env vars if the DB row doesn't exist yet or the
 * migration hasn't been applied.
 *
 * Expected DB schema:
 * - public.platform_email_settings (singleton id=1)
 */
export async function resolvePlatformEmailDefaults(serviceClient: any): Promise<PlatformEmailDefaults> {
  const fallbackFromEmail = Deno.env.get("FROM_EMAIL") || "onboarding@resend.dev";
  const fallbackFromName = Deno.env.get("FROM_NAME") || "Stride WMS";
  const fallbackReplyTo = Deno.env.get("REPLY_TO_EMAIL") || null;
  const fallbackSenderDomain = toNonEmptyString(Deno.env.get("FALLBACK_SENDER_DOMAIN"));

  try {
    const { data, error } = await serviceClient
      .from("platform_email_settings")
      .select("default_from_email, default_from_name, default_reply_to_email, fallback_sender_domain, is_active")
      .eq("id", 1)
      .maybeSingle();

    if (error || !data || data.is_active === false) {
      if (error) {
        console.warn("[platform-email] Failed to load platform_email_settings:", error.message);
      }
      return {
        fromEmail: fallbackFromEmail,
        fromName: fallbackFromName,
        replyTo: fallbackReplyTo,
        fallbackSenderDomain,
      };
    }

    return {
      fromEmail: toNonEmptyString(data.default_from_email) || fallbackFromEmail,
      fromName: toNonEmptyString(data.default_from_name) || fallbackFromName,
      replyTo: toNonEmptyString(data.default_reply_to_email) || fallbackReplyTo,
      fallbackSenderDomain: toNonEmptyString(data.fallback_sender_domain) || fallbackSenderDomain,
    };
  } catch (err) {
    console.warn("[platform-email] Unexpected error resolving platform defaults:", err);
    return {
      fromEmail: fallbackFromEmail,
      fromName: fallbackFromName,
      replyTo: fallbackReplyTo,
      fallbackSenderDomain,
    };
  }
}

