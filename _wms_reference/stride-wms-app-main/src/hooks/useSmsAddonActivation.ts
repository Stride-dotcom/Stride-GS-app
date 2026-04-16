import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface SmsAddonActivationState {
  is_active: boolean;
  activation_status: string;
  terms_version: string | null;
  terms_accepted_at: string | null;
  terms_accepted_by: string | null;
  ip_address: string | null;
  user_agent: string | null;
  acceptance_source: string | null;
  activated_at: string | null;
  updated_at: string | null;
}

interface ActivateSmsAddonInput {
  termsVersion: string;
  acceptanceSource?: string;
}

interface DeactivateSmsAddonInput {
  reason?: string;
  acceptanceSource?: string;
}

const DEFAULT_SMS_ADDON_ACTIVATION: SmsAddonActivationState = {
  is_active: false,
  activation_status: "not_activated",
  terms_version: null,
  terms_accepted_at: null,
  terms_accepted_by: null,
  ip_address: null,
  user_agent: null,
  acceptance_source: null,
  activated_at: null,
  updated_at: null,
};

const SMS_ADDON_QUERY_KEY = ["sms-addon-activation"] as const;

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeActivationPayload(payload: unknown): SmsAddonActivationState {
  if (!payload || typeof payload !== "object") {
    return DEFAULT_SMS_ADDON_ACTIVATION;
  }

  const source = payload as Record<string, unknown>;

  return {
    is_active: source.is_active === true,
    activation_status:
      typeof source.activation_status === "string"
        ? source.activation_status
        : DEFAULT_SMS_ADDON_ACTIVATION.activation_status,
    terms_version: toNullableString(source.terms_version),
    terms_accepted_at: toNullableString(source.terms_accepted_at),
    terms_accepted_by: toNullableString(source.terms_accepted_by),
    ip_address: toNullableString(source.ip_address),
    user_agent: toNullableString(source.user_agent),
    acceptance_source: toNullableString(source.acceptance_source),
    activated_at: toNullableString(source.activated_at),
    updated_at: toNullableString(source.updated_at),
  };
}

export function useSmsAddonActivation() {
  const queryClient = useQueryClient();
  const { session } = useAuth();

  const query = useQuery<SmsAddonActivationState>({
    queryKey: SMS_ADDON_QUERY_KEY,
    enabled: !!session,
    staleTime: 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("rpc_get_my_sms_addon_activation");
      if (error) {
        console.error("useSmsAddonActivation error:", error.message);
        return DEFAULT_SMS_ADDON_ACTIVATION;
      }
      return normalizeActivationPayload(data);
    },
  });

  const syncSmsBillingItemsBestEffort = async (source: string) => {
    try {
      const { data, error } = await supabase.functions.invoke("sync-sms-addon-subscription-items", {
        body: {
          source,
        },
      });
      if (error) {
        console.warn("sync-sms-addon-subscription-items invoke error:", error.message);
        return;
      }
      if (data && (data as Record<string, unknown>).ok === false) {
        console.warn(
          "sync-sms-addon-subscription-items returned non-ok response:",
          (data as Record<string, unknown>).error ?? data,
        );
      }
    } catch (error) {
      console.warn("sync-sms-addon-subscription-items best-effort sync failed:", error);
    }
  };

  const activationMutation = useMutation<SmsAddonActivationState, Error, ActivateSmsAddonInput>({
    mutationFn: async ({ termsVersion, acceptanceSource }) => {
      const { data, error } = await (supabase as any).rpc("rpc_activate_sms_addon", {
        p_terms_version: termsVersion,
        p_acceptance_source: acceptanceSource ?? "settings_sms_activation_card",
      });

      if (error) {
        throw new Error(error.message || "Failed to activate SMS add-on");
      }

      await syncSmsBillingItemsBestEffort("activate_sms_addon");

      return normalizeActivationPayload(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SMS_ADDON_QUERY_KEY });
    },
  });

  const deactivationMutation = useMutation<SmsAddonActivationState, Error, DeactivateSmsAddonInput>({
    mutationFn: async ({ reason, acceptanceSource }) => {
      const { data, error } = await (supabase as any).rpc("rpc_deactivate_sms_addon", {
        p_reason: reason ?? "self_service",
        p_acceptance_source: acceptanceSource ?? "settings_sms_activation_card",
      });

      if (error) {
        throw new Error(error.message || "Failed to deactivate SMS add-on");
      }

      await syncSmsBillingItemsBestEffort("deactivate_sms_addon");

      return normalizeActivationPayload(data);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: SMS_ADDON_QUERY_KEY });
    },
  });

  return {
    ...query,
    activateSmsAddon: activationMutation.mutateAsync,
    isActivating: activationMutation.isPending,
    deactivateSmsAddon: deactivationMutation.mutateAsync,
    isDeactivating: deactivationMutation.isPending,
  };
}
