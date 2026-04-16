export interface PlatformInboundReplyConfig {
  provider: string;
  replyDomain: string | null;
  isActive: boolean;
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Reads platform inbound reply settings from the DB (if present).
 * Falls back to INBOUND_REPLY_DOMAIN env var for early bootstrap.
 */
export async function resolvePlatformInboundReplyConfig(serviceClient: any): Promise<PlatformInboundReplyConfig> {
  const envDomain = toNonEmptyString(Deno.env.get("INBOUND_REPLY_DOMAIN"));
  const envActive = String(Deno.env.get("INBOUND_REPLY_ENABLED") || "").toLowerCase() === "true";

  try {
    const { data, error } = await serviceClient
      .from("platform_inbound_email_settings")
      .select("provider, reply_domain, is_active")
      .eq("id", 1)
      .maybeSingle();

    if (error || !data) {
      return { provider: "mailgun", replyDomain: envDomain, isActive: envActive && Boolean(envDomain) };
    }

    const replyDomain = toNonEmptyString(data.reply_domain) || envDomain;
    const isActive = data.is_active === true && Boolean(replyDomain);
    return { provider: String(data.provider || "mailgun"), replyDomain, isActive };
  } catch {
    return { provider: "mailgun", replyDomain: envDomain, isActive: envActive && Boolean(envDomain) };
  }
}

/**
 * Returns the tenant's reply-to routing address (tenant_id@replyDomain) if:
 * - platform inbound reply routing is active, AND
 * - tenant has enabled forwarding + configured a destination inbox.
 */
export async function resolveTenantReplyToRoutingAddress(
  serviceClient: any,
  tenantId: string,
  platformConfig?: PlatformInboundReplyConfig,
): Promise<string | null> {
  const platform = platformConfig ?? await resolvePlatformInboundReplyConfig(serviceClient);
  if (!platform.isActive || !platform.replyDomain) return null;

  try {
    const { data, error } = await serviceClient
      .from("tenant_inbound_email_settings")
      .select("forward_to_email, is_enabled")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error || !data) return null;
    const enabled = data.is_enabled === true;
    const forwardTo = toNonEmptyString(data.forward_to_email);
    if (!enabled || !forwardTo) return null;

    return `${tenantId}@${platform.replyDomain}`;
  } catch {
    return null;
  }
}

