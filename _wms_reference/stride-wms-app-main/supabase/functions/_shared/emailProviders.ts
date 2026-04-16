export type EmailProvider = "resend" | "postmark";

export interface OutboundProviderConfig {
  primary: EmailProvider;
  fallback: EmailProvider | null;
}

export interface SendPlatformEmailInput {
  fromEmail: string;
  fromName: string;
  to: string[] | string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string | null;
  forceProvider?: EmailProvider | null;
}

export interface SendPlatformEmailResult {
  provider: EmailProvider;
  id: string | null;
  fallbackUsed: boolean;
  attemptedProviders: EmailProvider[];
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeProvider(value: unknown): EmailProvider | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "resend" || normalized === "postmark") return normalized;
  return null;
}

function normalizeFallback(value: unknown): EmailProvider | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "none") return null;
  return normalizeProvider(normalized);
}

function normalizedRecipients(value: string[] | string): string[] {
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((v) => String(v || "").trim())
    .filter((v) => v.length > 0);
}

function formatFrom(fromName: string, fromEmail: string): string {
  const safeName = String(fromName || "").trim() || "Stride WMS";
  return `${safeName} <${fromEmail}>`;
}

async function sendWithResend(params: {
  fromEmail: string;
  fromName: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string | null;
}): Promise<{ id: string | null }> {
  const apiKey = toNonEmptyString(Deno.env.get("RESEND_API_KEY"));
  if (!apiKey) {
    throw new Error("RESEND_API_KEY not configured");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: formatFrom(params.fromName, params.fromEmail),
      to: params.to,
      subject: params.subject,
      html: params.html,
      ...(params.text ? { text: params.text } : {}),
      ...(params.replyTo ? { reply_to: params.replyTo } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Resend API error (${response.status})`);
  }

  const data = await response.json().catch(() => null);
  return { id: toNonEmptyString(data?.id) };
}

async function sendWithPostmark(params: {
  fromEmail: string;
  fromName: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string | null;
}): Promise<{ id: string | null }> {
  const serverToken = toNonEmptyString(Deno.env.get("POSTMARK_SERVER_TOKEN"));
  if (!serverToken) {
    throw new Error("POSTMARK_SERVER_TOKEN not configured");
  }

  const messageStream = toNonEmptyString(Deno.env.get("POSTMARK_MESSAGE_STREAM"));
  const response = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers: {
      "X-Postmark-Server-Token": serverToken,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      From: formatFrom(params.fromName, params.fromEmail),
      To: params.to.join(","),
      Subject: params.subject,
      HtmlBody: params.html,
      ...(params.text ? { TextBody: params.text } : {}),
      ...(params.replyTo ? { ReplyTo: params.replyTo } : {}),
      ...(messageStream ? { MessageStream: messageStream } : {}),
    }),
  });

  const rawBody = await response.text().catch(() => "");
  const payload = (() => {
    try {
      return rawBody ? JSON.parse(rawBody) : null;
    } catch {
      return { Message: rawBody, ErrorCode: -1 };
    }
  })();

  if (!response.ok || Number(payload?.ErrorCode || 0) !== 0) {
    const message = toNonEmptyString(payload?.Message) || `Postmark API error (${response.status})`;
    throw new Error(message);
  }

  return { id: toNonEmptyString(payload?.MessageID) };
}

async function sendViaProvider(
  provider: EmailProvider,
  payload: {
    fromEmail: string;
    fromName: string;
    to: string[];
    subject: string;
    html: string;
    text?: string;
    replyTo?: string | null;
  },
): Promise<{ id: string | null }> {
  if (provider === "resend") {
    return sendWithResend(payload);
  }
  return sendWithPostmark(payload);
}

export async function resolveOutboundProviderConfig(serviceClient: any): Promise<OutboundProviderConfig> {
  const envPrimary = normalizeProvider(Deno.env.get("OUTBOUND_EMAIL_PRIMARY_PROVIDER")) || "resend";
  const envFallback = normalizeFallback(Deno.env.get("OUTBOUND_EMAIL_FALLBACK_PROVIDER"));

  try {
    const { data, error } = await serviceClient
      .from("platform_email_settings")
      .select("outbound_primary_provider, outbound_fallback_provider")
      .eq("id", 1)
      .maybeSingle();

    if (error || !data) {
      return { primary: envPrimary, fallback: envFallback };
    }

    const primary = normalizeProvider(data.outbound_primary_provider) || envPrimary;
    const rawDbFallback = String(data.outbound_fallback_provider || "").trim().toLowerCase();
    const fallback = rawDbFallback === "none" ? null : normalizeFallback(rawDbFallback) ?? envFallback;
    return {
      primary,
      fallback: fallback === primary ? null : fallback,
    };
  } catch {
    return { primary: envPrimary, fallback: envFallback };
  }
}

export async function sendPlatformEmail(
  serviceClient: any,
  input: SendPlatformEmailInput,
): Promise<SendPlatformEmailResult> {
  const recipients = normalizedRecipients(input.to);
  if (recipients.length === 0) {
    throw new Error("No recipients provided");
  }

  const forced = input.forceProvider || null;
  const config = forced
    ? { primary: forced, fallback: null as EmailProvider | null }
    : await resolveOutboundProviderConfig(serviceClient);

  const providerOrder: EmailProvider[] = [config.primary];
  if (config.fallback && config.fallback !== config.primary) {
    providerOrder.push(config.fallback);
  }

  const attemptedProviders: EmailProvider[] = [];
  const failures: string[] = [];

  for (let i = 0; i < providerOrder.length; i++) {
    const provider = providerOrder[i];
    attemptedProviders.push(provider);
    try {
      const sent = await sendViaProvider(provider, {
        fromEmail: input.fromEmail,
        fromName: input.fromName,
        to: recipients,
        subject: input.subject,
        html: input.html,
        text: input.text,
        replyTo: input.replyTo || null,
      });
      return {
        provider,
        id: sent.id,
        fallbackUsed: i > 0,
        attemptedProviders,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown provider error";
      failures.push(`${provider}: ${message}`);
    }
  }

  throw new Error(`All outbound providers failed (${failures.join(" | ")})`);
}

