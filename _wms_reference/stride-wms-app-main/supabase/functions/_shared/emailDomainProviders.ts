export type EmailDomainProvider = "resend" | "postmark";

export interface DomainDnsRecord {
  record?: string;
  name: string;
  type: string;
  value: string;
  status?: string;
  ttl?: string;
  priority?: number;
}

export interface DomainSnapshot {
  provider: EmailDomainProvider;
  domainId: string;
  domain: string;
  status: string;
  verified: boolean;
  spfVerified: boolean;
  dkimVerified: boolean;
  records: DomainDnsRecord[];
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function normalizeProvider(value: unknown): EmailDomainProvider | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "resend" || normalized === "postmark") {
    return normalized;
  }
  return null;
}

function parseVerificationType(value: unknown): EmailDomainProvider | null {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized.includes("postmark")) return "postmark";
  if (normalized.includes("resend")) return "resend";
  return null;
}

function pickString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = toNonEmptyString(source[key]);
    if (value) return value;
  }
  return null;
}

function pickBoolean(source: Record<string, unknown>, keys: string[]): boolean | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "verified" || normalized === "success") return true;
      if (normalized === "false" || normalized === "pending") return false;
    }
  }
  return null;
}

function isVerifiedStatus(value: unknown): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "verified" || normalized === "success";
}

function parseJsonLoose(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return { message: raw };
  }
}

function parseErrorMessage(payload: unknown, fallback: string): string {
  const source = asRecord(payload);
  return (
    toNonEmptyString(source.message) ||
    toNonEmptyString(source.Message) ||
    toNonEmptyString(source.error) ||
    toNonEmptyString(source.Error) ||
    fallback
  );
}

function isAlreadyExistsError(status: number, payload: unknown): boolean {
  if (status === 409) return true;
  const message = parseErrorMessage(payload, "").toLowerCase();
  return message.includes("already exists") || message.includes("duplicate");
}

async function resendRequest(
  apiKey: string,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; payload: unknown }> {
  const response = await fetch(`https://api.resend.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const raw = await response.text().catch(() => "");
  return {
    ok: response.ok,
    status: response.status,
    payload: parseJsonLoose(raw),
  };
}

async function postmarkRequest(
  token: string,
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; payload: unknown }> {
  const response = await fetch(`https://api.postmarkapp.com${path}`, {
    method,
    headers: {
      "X-Postmark-Server-Token": token,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const raw = await response.text().catch(() => "");
  const payload = parseJsonLoose(raw);
  const payloadRecord = asRecord(payload);
  const hasApiError = Number(payloadRecord.ErrorCode || 0) !== 0;
  return {
    ok: response.ok && !hasApiError,
    status: response.status,
    payload,
  };
}

function mapResendSnapshot(domainData: unknown, fallbackDomain: string): DomainSnapshot {
  const source = asRecord(domainData);
  const domainId = toNonEmptyString(source.id) || "";
  const domain = toNonEmptyString(source.name) || fallbackDomain;
  const status = toNonEmptyString(source.status) || "pending";
  const rows = Array.isArray(source.records) ? (source.records as unknown[]) : [];

  const records: DomainDnsRecord[] = rows
    .map((row) => asRecord(row))
    .map((row) => ({
      record: toNonEmptyString(row.record) || toNonEmptyString(row.name) || undefined,
      name: toNonEmptyString(row.name) || "",
      type: toNonEmptyString(row.type) || "TXT",
      value: toNonEmptyString(row.value) || "",
      status: toNonEmptyString(row.status) || "pending",
      ttl: toNonEmptyString(row.ttl) || undefined,
      priority: typeof row.priority === "number" ? row.priority : undefined,
    }))
    .filter((row) => row.name && row.value);

  const spfVerified = records.some((record) => {
    const label = `${record.record || ""} ${record.type}`.toLowerCase();
    const value = (record.value || "").toLowerCase();
    return (label.includes("spf") || (record.type === "TXT" && value.includes("spf"))) && isVerifiedStatus(record.status);
  });
  const dkimVerified = records.some((record) => {
    const label = `${record.record || ""} ${record.name || ""}`.toLowerCase();
    return (label.includes("dkim") || label.includes("domainkey")) && isVerifiedStatus(record.status);
  });
  const verified = status.toLowerCase() === "verified" || (spfVerified && dkimVerified);

  return {
    provider: "resend",
    domainId,
    domain,
    status,
    verified,
    spfVerified,
    dkimVerified,
    records,
  };
}

function mapPostmarkSnapshot(domainData: unknown, fallbackDomain: string): DomainSnapshot {
  const source = asRecord(domainData);
  const domainId = String(source.ID || source.id || "").trim();
  const domain = pickString(source, ["Name", "name"]) || fallbackDomain;

  const dkimVerified = pickBoolean(source, ["DKIMVerified", "dkim_verified"]) ?? false;
  const returnPathVerified =
    pickBoolean(source, ["ReturnPathDomainVerified", "return_path_domain_verified", "ReturnPathVerified"]) ?? false;
  const spfVerified =
    pickBoolean(source, ["SPFVerified", "spf_verified"]) ??
    returnPathVerified;
  const verified = dkimVerified && (returnPathVerified || spfVerified);
  const status = verified ? "verified" : "pending";

  const dkimHost = pickString(source, ["DKIMPendingHost", "DKIMHost", "dkim_pending_host", "dkim_host"]);
  const dkimValue = pickString(source, ["DKIMPendingTextValue", "DKIMTextValue", "dkim_pending_text_value", "dkim_text_value"]);
  const returnPathHost = pickString(source, ["ReturnPathDomain", "return_path_domain"]);
  const returnPathValue =
    pickString(source, ["ReturnPathDomainCNAMEValue", "CNAMEValue", "return_path_domain_cname_value"]) || "pm.mtasv.net";
  const spfHost = pickString(source, ["SPFPendingHost", "SPFHost", "spf_pending_host", "spf_host"]);
  const spfValue = pickString(source, ["SPFPendingTextValue", "SPFTextValue", "spf_pending_text_value", "spf_text_value"]);

  const records: DomainDnsRecord[] = [];
  if (dkimHost && dkimValue) {
    records.push({
      record: "DKIM",
      name: dkimHost,
      type: "TXT",
      value: dkimValue,
      status: dkimVerified ? "verified" : "pending",
    });
  }
  if (returnPathHost) {
    records.push({
      record: "Return-Path",
      name: returnPathHost,
      type: "CNAME",
      value: returnPathValue,
      status: returnPathVerified ? "verified" : "pending",
    });
  }
  if (spfHost && spfValue) {
    records.push({
      record: "SPF",
      name: spfHost,
      type: "TXT",
      value: spfValue,
      status: spfVerified ? "verified" : "pending",
    });
  }

  return {
    provider: "postmark",
    domainId,
    domain,
    status,
    verified,
    spfVerified,
    dkimVerified,
    records,
  };
}

async function resolveProviderFromDb(serviceClient: any, tenantId: string): Promise<EmailDomainProvider | null> {
  const { data: brandRow } = await serviceClient
    .from("communication_brand_settings")
    .select("email_verification_type")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  const fromBrand = parseVerificationType(brandRow?.email_verification_type);
  if (fromBrand) return fromBrand;

  const { data: platformRow } = await serviceClient
    .from("platform_email_settings")
    .select("outbound_primary_provider")
    .eq("id", 1)
    .maybeSingle();

  return normalizeProvider(platformRow?.outbound_primary_provider);
}

export async function resolveEmailDomainProvider(
  serviceClient: any,
  tenantId: string,
  requestedProvider?: string | null,
): Promise<EmailDomainProvider> {
  const requested = normalizeProvider(requestedProvider);
  if (requested) return requested;

  try {
    const dbProvider = await resolveProviderFromDb(serviceClient, tenantId);
    if (dbProvider) return dbProvider;
  } catch {
    // Fall through to default.
  }

  return "postmark";
}

export function providerToVerificationType(provider: EmailDomainProvider): string {
  return `${provider}_domain`;
}

export function verificationTypeToProvider(value: unknown): EmailDomainProvider | null {
  return parseVerificationType(value);
}

export async function registerDomainWithProvider(
  provider: EmailDomainProvider,
  domain: string,
): Promise<DomainSnapshot> {
  if (provider === "resend") {
    const apiKey = toNonEmptyString(Deno.env.get("RESEND_API_KEY"));
    if (!apiKey) throw new Error("RESEND_API_KEY not configured");

    const created = await resendRequest(apiKey, "POST", "/domains", { name: domain });
    let domainId: string | null = toNonEmptyString(asRecord(created.payload).id);

    if (!created.ok) {
      if (!isAlreadyExistsError(created.status, created.payload)) {
        throw new Error(parseErrorMessage(created.payload, "Failed to register domain with Resend"));
      }

      const listed = await resendRequest(apiKey, "GET", "/domains");
      if (!listed.ok) {
        throw new Error(parseErrorMessage(listed.payload, "Failed to list Resend domains"));
      }
      const listRows = Array.isArray(asRecord(listed.payload).data) ? (asRecord(listed.payload).data as unknown[]) : [];
      const matched = listRows
        .map((row) => asRecord(row))
        .find((row) => toNonEmptyString(row.name)?.toLowerCase() === domain.toLowerCase());
      domainId = matched ? toNonEmptyString(matched.id) : null;
    }

    if (!domainId) {
      throw new Error("Unable to resolve Resend domain id");
    }

    const details = await resendRequest(apiKey, "GET", `/domains/${domainId}`);
    if (!details.ok) {
      throw new Error(parseErrorMessage(details.payload, "Failed to fetch Resend domain details"));
    }
    return mapResendSnapshot(details.payload, domain);
  }

  const token = toNonEmptyString(Deno.env.get("POSTMARK_SERVER_TOKEN"));
  if (!token) throw new Error("POSTMARK_SERVER_TOKEN not configured");

  const created = await postmarkRequest(token, "POST", "/domains", { Name: domain });
  let domainId = pickString(asRecord(created.payload), ["ID", "id"]);

  if (!created.ok) {
    if (!isAlreadyExistsError(created.status, created.payload)) {
      throw new Error(parseErrorMessage(created.payload, "Failed to register domain with Postmark"));
    }
    const listed = await postmarkRequest(token, "GET", "/domains");
    if (!listed.ok) {
      throw new Error(parseErrorMessage(listed.payload, "Failed to list Postmark domains"));
    }
    const listPayload = asRecord(listed.payload);
    const listRows = Array.isArray(listPayload.Domains)
      ? (listPayload.Domains as unknown[])
      : Array.isArray(listed.payload)
        ? (listed.payload as unknown[])
        : [];
    const matched = listRows
      .map((row) => asRecord(row))
      .find((row) => toNonEmptyString(row.Name || row.name)?.toLowerCase() === domain.toLowerCase());
    domainId = matched ? pickString(matched, ["ID", "id"]) : null;
  }

  if (!domainId) {
    throw new Error("Unable to resolve Postmark domain id");
  }

  const details = await postmarkRequest(token, "GET", `/domains/${domainId}`);
  if (!details.ok) {
    throw new Error(parseErrorMessage(details.payload, "Failed to fetch Postmark domain details"));
  }
  return mapPostmarkSnapshot(details.payload, domain);
}

export async function verifyDomainWithProvider(
  provider: EmailDomainProvider,
  domainId: string,
  fallbackDomain: string,
): Promise<DomainSnapshot> {
  if (provider === "resend") {
    const apiKey = toNonEmptyString(Deno.env.get("RESEND_API_KEY"));
    if (!apiKey) throw new Error("RESEND_API_KEY not configured");

    const verify = await resendRequest(apiKey, "POST", `/domains/${domainId}/verify`);
    if (!verify.ok && verify.status !== 409) {
      throw new Error(parseErrorMessage(verify.payload, "Failed to verify domain with Resend"));
    }

    const details = await resendRequest(apiKey, "GET", `/domains/${domainId}`);
    if (!details.ok) {
      throw new Error(parseErrorMessage(details.payload, "Failed to fetch Resend domain details"));
    }
    return mapResendSnapshot(details.payload, fallbackDomain);
  }

  const token = toNonEmptyString(Deno.env.get("POSTMARK_SERVER_TOKEN"));
  if (!token) throw new Error("POSTMARK_SERVER_TOKEN not configured");

  const endpoints = ["/verifyDKIM", "/verifyReturnPath", "/verifySPF"];
  for (const suffix of endpoints) {
    // Postmark has historically used PUT; keep POST fallback for compatibility.
    for (const method of ["PUT", "POST"] as const) {
      const verification = await postmarkRequest(token, method, `/domains/${domainId}${suffix}`);
      if (verification.ok) break;
      if (verification.status === 404 || verification.status === 405) {
        continue;
      }
      // Ignore soft verification failures (DNS not propagated yet) and continue.
      if (verification.status === 409 || verification.status === 422) {
        break;
      }
      break;
    }
  }

  const details = await postmarkRequest(token, "GET", `/domains/${domainId}`);
  if (!details.ok) {
    throw new Error(parseErrorMessage(details.payload, "Failed to fetch Postmark domain details"));
  }
  return mapPostmarkSnapshot(details.payload, fallbackDomain);
}

