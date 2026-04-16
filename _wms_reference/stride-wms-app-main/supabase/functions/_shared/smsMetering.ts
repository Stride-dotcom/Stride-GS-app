export type SmsDirection = "inbound" | "outbound";
export type SmsSegmentSource = "estimated" | "twilio_api" | "twilio_callback";

export interface SmsUsageEventInput {
  tenantId: string;
  direction: SmsDirection;
  twilioMessageSid?: string | null;
  twilioAccountSid?: string | null;
  fromPhone?: string | null;
  toPhone?: string | null;
  messageStatus?: string | null;
  segmentCount: number;
  segmentCountSource: SmsSegmentSource;
  billable?: boolean;
  occurredAt?: string | null;
  metadata?: Record<string, unknown>;
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function toPositiveInteger(value: unknown, fallback = 1): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
      ? Number.parseInt(value, 10)
      : Number.NaN;

  if (!Number.isFinite(parsed)) return Math.max(0, fallback);
  return Math.max(0, Math.floor(parsed));
}

function isGsm7Bit(text: string): boolean {
  const gsm7Chars =
    "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ " +
    "!\"#¤%&'()*+,-./0123456789:;<=>?" +
    "¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§" +
    "¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€";
  for (const ch of text) {
    if (!gsm7Chars.includes(ch)) return false;
  }
  return true;
}

export function estimateSmsSegments(body: string | null | undefined): number {
  const text = String(body || "");
  if (!text) return 1;

  const gsm7 = isGsm7Bit(text);
  const length = text.length;
  if (gsm7) {
    return length <= 160 ? 1 : Math.ceil(length / 153);
  }
  return length <= 70 ? 1 : Math.ceil(length / 67);
}

function isMissingSmsUsageSchemaError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as { code?: string }).code : "";
  const message =
    typeof error === "object" && error !== null ? String((error as { message?: string }).message || "") : "";
  const details =
    typeof error === "object" && error !== null ? String((error as { details?: string }).details || "") : "";
  const normalized = `${message} ${details}`.toLowerCase();

  if (code === "42P01" || code === "42703") return true;
  return (
    normalized.includes('relation "sms_usage_events" does not exist') ||
    normalized.includes("sms_usage_events") && normalized.includes("does not exist")
  );
}

function coerceIsoTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

export async function recordSmsUsageEvent(serviceClient: any, input: SmsUsageEventInput): Promise<void> {
  const twilioMessageSid = toNonEmptyString(input.twilioMessageSid);
  const billable = input.billable !== false;
  const segmentCount = Math.max(0, toPositiveInteger(input.segmentCount, 1));
  const occurredAt = coerceIsoTimestamp(input.occurredAt);

  const payload: Record<string, unknown> = {
    tenant_id: input.tenantId,
    direction: input.direction,
    provider: "twilio",
    twilio_message_sid: twilioMessageSid,
    twilio_account_sid: toNonEmptyString(input.twilioAccountSid),
    from_phone: toNonEmptyString(input.fromPhone),
    to_phone: toNonEmptyString(input.toPhone),
    message_status: toNonEmptyString(input.messageStatus),
    segment_count: segmentCount,
    segment_count_source: input.segmentCountSource,
    billable,
    metadata: input.metadata || {},
  };
  if (occurredAt) {
    payload.occurred_at = occurredAt;
  }

  try {
    if (!twilioMessageSid) {
      const { error: insertError } = await serviceClient.from("sms_usage_events").insert(payload);
      if (insertError) throw insertError;
      return;
    }

    const { data: existing, error: existingError } = await serviceClient
      .from("sms_usage_events")
      .select(
        "id, segment_count, segment_count_source, billable, aggregated_at, needs_reconciliation, metadata",
      )
      .eq("twilio_message_sid", twilioMessageSid)
      .maybeSingle();

    if (existingError && !isMissingSmsUsageSchemaError(existingError)) {
      throw existingError;
    }

    if (existing) {
      const previousSegmentCount = toPositiveInteger(existing.segment_count, 0);
      const previousSource = toNonEmptyString(existing.segment_count_source) || "estimated";
      const previousBillable = existing.billable === true;
      const previouslyAggregated = Boolean(existing.aggregated_at);
      const priorNeedsReconciliation = existing.needs_reconciliation === true;
      const existingMetadata =
        existing.metadata && typeof existing.metadata === "object"
          ? (existing.metadata as Record<string, unknown>)
          : {};

      const changedForBilling =
        previousSegmentCount !== segmentCount ||
        previousSource !== input.segmentCountSource ||
        previousBillable !== billable;

      payload.needs_reconciliation =
        priorNeedsReconciliation || (previouslyAggregated && changedForBilling);
      payload.metadata = { ...existingMetadata, ...(input.metadata || {}) };
    }

    const { error: upsertError } = await serviceClient
      .from("sms_usage_events")
      .upsert(payload, { onConflict: "twilio_message_sid" });
    if (upsertError) throw upsertError;
  } catch (error) {
    if (isMissingSmsUsageSchemaError(error)) {
      console.warn("SMS metering schema is not available yet; skipping usage event write.");
      return;
    }
    throw error;
  }
}
