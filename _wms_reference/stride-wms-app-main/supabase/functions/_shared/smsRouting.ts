export interface TenantSmsSendConfig {
  smsEnabled: boolean;
  accountSid: string | null;
  messagingServiceSid: string | null;
  fromPhone: string | null;
  senderProvisioningStatus: string | null;
  senderPhone: string | null;
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizePhoneE164(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const stripped = String(raw).trim();
  if (!stripped) return null;

  const digits = stripped.startsWith("+")
    ? stripped.slice(1).replace(/\D/g, "")
    : stripped.replace(/\D/g, "");

  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

function isMissingRelationError(error: unknown, relationName: string): boolean {
  const code = typeof error === "object" && error !== null ? (error as { code?: string }).code : "";
  const message =
    typeof error === "object" && error !== null ? String((error as { message?: string }).message || "") : "";
  const details =
    typeof error === "object" && error !== null ? String((error as { details?: string }).details || "") : "";
  const normalized = `${message} ${details}`.toLowerCase();
  return code === "42P01" || normalized.includes(`relation "${relationName.toLowerCase()}" does not exist`);
}

export async function loadTenantSmsSendConfig(
  serviceClient: any,
  tenantId: string,
): Promise<TenantSmsSendConfig> {
  const { data: settings, error: settingsError } = await serviceClient
    .from("tenant_company_settings")
    .select("sms_enabled, twilio_account_sid, twilio_messaging_service_sid, twilio_from_phone")
    .eq("tenant_id", tenantId)
    .single();

  if (settingsError || !settings) {
    throw new Error("Tenant SMS settings not found.");
  }

  let senderProvisioningStatus: string | null = null;
  let senderPhone: string | null = null;

  const { data: senderProfile, error: senderError } = await serviceClient
    .from("tenant_sms_sender_profiles")
    .select("provisioning_status, twilio_phone_number_e164")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (senderError && !isMissingRelationError(senderError, "tenant_sms_sender_profiles")) {
    throw new Error(senderError.message || "Failed to load tenant sender profile.");
  }

  if (senderProfile) {
    senderProvisioningStatus = toNonEmptyString(senderProfile.provisioning_status);
    senderPhone = normalizePhoneE164(toNonEmptyString(senderProfile.twilio_phone_number_e164));
  }

  const smsEnabled = settings.sms_enabled === true;
  const accountSidEnv = toNonEmptyString(Deno.env.get("TWILIO_ACCOUNT_SID"));
  const accountSidDb = toNonEmptyString(settings.twilio_account_sid);
  const accountSid = accountSidEnv || accountSidDb;
  const messagingServiceSid = toNonEmptyString(settings.twilio_messaging_service_sid);

  const configuredFromPhone = normalizePhoneE164(toNonEmptyString(settings.twilio_from_phone));
  const approvedSenderPhone = senderProvisioningStatus === "approved" ? senderPhone : null;
  const fromPhone = messagingServiceSid ? null : approvedSenderPhone || configuredFromPhone;

  return {
    smsEnabled,
    accountSid,
    messagingServiceSid,
    fromPhone,
    senderProvisioningStatus,
    senderPhone,
  };
}

export async function resolveTenantIdByInboundToPhone(
  serviceClient: any,
  toPhoneRaw: string | null | undefined,
): Promise<{ tenantId: string | null; source: "sender_profile" | "tenant_settings" | "none" }> {
  const toPhone = normalizePhoneE164(toPhoneRaw);
  if (!toPhone) {
    return { tenantId: null, source: "none" };
  }

  const { data: profileRow, error: profileError } = await serviceClient
    .from("tenant_sms_sender_profiles")
    .select("tenant_id")
    .eq("twilio_phone_number_e164", toPhone)
    .limit(1)
    .maybeSingle();

  if (!profileError && profileRow?.tenant_id) {
    return { tenantId: String(profileRow.tenant_id), source: "sender_profile" };
  }

  if (profileError && !isMissingRelationError(profileError, "tenant_sms_sender_profiles")) {
    throw new Error(profileError.message || "Failed to resolve tenant from sender profile.");
  }

  const { data: settingsRow, error: settingsError } = await serviceClient
    .from("tenant_company_settings")
    .select("tenant_id")
    .eq("twilio_from_phone", toPhone)
    .limit(1)
    .maybeSingle();

  if (settingsError) {
    throw new Error(settingsError.message || "Failed to resolve tenant from tenant settings.");
  }

  if (settingsRow?.tenant_id) {
    return { tenantId: String(settingsRow.tenant_id), source: "tenant_settings" };
  }

  return { tenantId: null, source: "none" };
}
