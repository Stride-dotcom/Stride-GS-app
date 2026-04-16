import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface SmsSenderProfileState {
  tenant_id: string | null;
  sender_type: string;
  provisioning_status: string;
  twilio_phone_number_sid: string | null;
  twilio_phone_number_e164: string | null;
  requested_at: string | null;
  verification_submitted_at: string | null;
  verification_approved_at: string | null;
  verification_rejected_at: string | null;
  billing_start_at: string | null;
  last_error: string | null;
  updated_at: string | null;
}

interface RequestProvisioningInput {
  requestSource?: string;
}

const DEFAULT_SENDER_PROFILE: SmsSenderProfileState = {
  tenant_id: null,
  sender_type: "toll_free",
  provisioning_status: "not_requested",
  twilio_phone_number_sid: null,
  twilio_phone_number_e164: null,
  requested_at: null,
  verification_submitted_at: null,
  verification_approved_at: null,
  verification_rejected_at: null,
  billing_start_at: null,
  last_error: null,
  updated_at: null,
};

const SMS_SENDER_PROFILE_QUERY_KEY = ["sms-sender-profile"] as const;

function buildDefaultSenderProfile(tenantId: string | null): SmsSenderProfileState {
  return {
    ...DEFAULT_SENDER_PROFILE,
    tenant_id: tenantId,
  };
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeSenderProfilePayload(
  payload: unknown,
  tenantId: string | null = null
): SmsSenderProfileState {
  if (!payload || typeof payload !== "object") {
    return buildDefaultSenderProfile(tenantId);
  }

  const source = payload as Record<string, unknown>;

  return {
    tenant_id: toNullableString(source.tenant_id) ?? tenantId,
    sender_type:
      typeof source.sender_type === "string"
        ? source.sender_type
        : DEFAULT_SENDER_PROFILE.sender_type,
    provisioning_status:
      typeof source.provisioning_status === "string"
        ? source.provisioning_status
        : DEFAULT_SENDER_PROFILE.provisioning_status,
    twilio_phone_number_sid: toNullableString(source.twilio_phone_number_sid),
    twilio_phone_number_e164: toNullableString(source.twilio_phone_number_e164),
    requested_at: toNullableString(source.requested_at),
    verification_submitted_at: toNullableString(source.verification_submitted_at),
    verification_approved_at: toNullableString(source.verification_approved_at),
    verification_rejected_at: toNullableString(source.verification_rejected_at),
    billing_start_at: toNullableString(source.billing_start_at),
    last_error: toNullableString(source.last_error),
    updated_at: toNullableString(source.updated_at),
  };
}

function isMissingRpcError(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const message = String(error.message || "").toLowerCase();
  const code = String(error.code || "").toUpperCase();
  return (
    code === "PGRST202" ||
    message.includes("schema cache") ||
    (message.includes("could not find the function") &&
      (message.includes("rpc_get_my_sms_sender_profile") ||
        message.includes("rpc_request_sms_sender_provisioning")))
  );
}

async function fetchSenderProfileFallback(tenantId: string | null): Promise<SmsSenderProfileState> {
  if (!tenantId) return buildDefaultSenderProfile(null);

  try {
    const { data, error } = await (supabase as any)
      .from("tenant_sms_sender_profiles")
      .select(
        "tenant_id, sender_type, provisioning_status, twilio_phone_number_sid, twilio_phone_number_e164, requested_at, verification_submitted_at, verification_approved_at, verification_rejected_at, billing_start_at, last_error, updated_at"
      )
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (error || !data) return buildDefaultSenderProfile(tenantId);
    return normalizeSenderProfilePayload(data, tenantId);
  } catch {
    return buildDefaultSenderProfile(tenantId);
  }
}

export function useSmsSenderProvisioning() {
  const queryClient = useQueryClient();
  const { session, profile } = useAuth();
  const tenantId = profile?.tenant_id ?? null;
  const queryKey = [...SMS_SENDER_PROFILE_QUERY_KEY, tenantId] as const;

  const query = useQuery<SmsSenderProfileState>({
    queryKey,
    enabled: !!session,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("rpc_get_my_sms_sender_profile");
      if (error) {
        if (isMissingRpcError(error)) {
          // Backward compatibility for environments where RPC deploy lags.
          return fetchSenderProfileFallback(tenantId);
        }
        return buildDefaultSenderProfile(tenantId);
      }
      return normalizeSenderProfilePayload(data, tenantId);
    },
  });

  const requestMutation = useMutation<SmsSenderProfileState, Error, RequestProvisioningInput>({
    mutationFn: async ({ requestSource }) => {
      const { data, error } = await (supabase as any).rpc("rpc_request_sms_sender_provisioning", {
        p_sender_type: "toll_free",
        p_request_source: requestSource ?? "settings_sms_activation_card",
      });

      if (error) {
        if (isMissingRpcError(error)) {
          throw new Error(
            "SMS sender provisioning backend is not deployed in this environment yet. Please run Supabase Deploy and retry."
          );
        }
        throw new Error(error.message || "Failed to request sender provisioning");
      }

      return normalizeSenderProfilePayload(data, tenantId);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    ...query,
    requestProvisioning: requestMutation.mutateAsync,
    isRequestingProvisioning: requestMutation.isPending,
  };
}

