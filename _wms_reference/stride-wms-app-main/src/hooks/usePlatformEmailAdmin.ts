import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface PlatformEmailSettings {
  default_from_email: string;
  default_from_name: string | null;
  default_reply_to_email: string | null;
  fallback_sender_domain: string | null;
  is_active: boolean;
  outbound_primary_provider: "resend" | "postmark";
  outbound_fallback_provider: "none" | "resend" | "postmark";
  wrapper_html_template: string | null;
  updated_at: string | null;
}

interface SavePlatformEmailSettingsInput {
  defaultFromEmail: string;
  defaultFromName?: string | null;
  defaultReplyToEmail?: string | null;
  fallbackSenderDomain?: string | null;
  isActive?: boolean;
  outboundPrimaryProvider?: "resend" | "postmark";
  outboundFallbackProvider?: "none" | "resend" | "postmark";
  wrapperHtmlTemplate?: string | null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeRow(row: Record<string, unknown>): PlatformEmailSettings {
  const primaryProvider = String(row.outbound_primary_provider || "resend").toLowerCase();
  const fallbackProvider = String(row.outbound_fallback_provider || "none").toLowerCase();
  return {
    default_from_email: String(row.default_from_email ?? ""),
    default_from_name: toNullableString(row.default_from_name),
    default_reply_to_email: toNullableString(row.default_reply_to_email),
    fallback_sender_domain: toNullableString(row.fallback_sender_domain),
    is_active: toBoolean(row.is_active, true),
    outbound_primary_provider: primaryProvider === "postmark" ? "postmark" : "resend",
    outbound_fallback_provider:
      fallbackProvider === "resend" || fallbackProvider === "postmark" ? fallbackProvider : "none",
    wrapper_html_template: toNullableString(row.wrapper_html_template),
    updated_at: toNullableString(row.updated_at),
  };
}

function firstRow(data: unknown): Record<string, unknown> | null {
  if (!data) return null;
  if (Array.isArray(data)) {
    const first = data[0];
    return first && typeof first === "object" ? (first as Record<string, unknown>) : null;
  }
  return typeof data === "object" ? (data as Record<string, unknown>) : null;
}

export function usePlatformEmailAdmin() {
  const [settings, setSettings] = useState<PlatformEmailSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc("rpc_admin_get_platform_email_settings");
      if (error) throw new Error(error.message || "Failed to load platform email settings");
      const row = firstRow(data);
      setSettings(row ? normalizeRow(row) : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const saveSettings = useCallback(async (input: SavePlatformEmailSettingsInput) => {
    setSaving(true);
    try {
      let { data, error } = await (supabase as any).rpc("rpc_admin_set_platform_email_settings", {
        p_default_from_email: input.defaultFromEmail,
        p_default_from_name: input.defaultFromName ?? null,
        p_default_reply_to_email: input.defaultReplyToEmail ?? null,
        p_is_active: input.isActive ?? true,
        p_fallback_sender_domain: input.fallbackSenderDomain ?? null,
        p_wrapper_html_template: input.wrapperHtmlTemplate ?? null,
        p_outbound_primary_provider: input.outboundPrimaryProvider ?? "resend",
        p_outbound_fallback_provider: input.outboundFallbackProvider ?? "none",
      });

      // Backward compatibility:
      // 1) wrapper + fallback signature (6 args)
      // 2) fallback-only signature (5 args)
      // 3) legacy signature (4 args)
      if (
        error &&
        /p_outbound_primary_provider|p_outbound_fallback_provider|function .*rpc_admin_set_platform_email_settings/i.test(
          error.message || "",
        )
      ) {
        const wrapperAndFallback = await (supabase as any).rpc("rpc_admin_set_platform_email_settings", {
          p_default_from_email: input.defaultFromEmail,
          p_default_from_name: input.defaultFromName ?? null,
          p_default_reply_to_email: input.defaultReplyToEmail ?? null,
          p_is_active: input.isActive ?? true,
          p_fallback_sender_domain: input.fallbackSenderDomain ?? null,
          p_wrapper_html_template: input.wrapperHtmlTemplate ?? null,
        });
        data = wrapperAndFallback.data;
        error = wrapperAndFallback.error;
      }

      if (
        error &&
        /p_wrapper_html_template|function .*rpc_admin_set_platform_email_settings/i.test(error.message || "")
      ) {
        const fallbackOnly = await (supabase as any).rpc("rpc_admin_set_platform_email_settings", {
          p_default_from_email: input.defaultFromEmail,
          p_default_from_name: input.defaultFromName ?? null,
          p_default_reply_to_email: input.defaultReplyToEmail ?? null,
          p_is_active: input.isActive ?? true,
          p_fallback_sender_domain: input.fallbackSenderDomain ?? null,
        });
        data = fallbackOnly.data;
        error = fallbackOnly.error;
      }

      if (
        error &&
        /p_fallback_sender_domain|function .*rpc_admin_set_platform_email_settings/i.test(error.message || "")
      ) {
        const legacy = await (supabase as any).rpc("rpc_admin_set_platform_email_settings", {
          p_default_from_email: input.defaultFromEmail,
          p_default_from_name: input.defaultFromName ?? null,
          p_default_reply_to_email: input.defaultReplyToEmail ?? null,
          p_is_active: input.isActive ?? true,
        });
        data = legacy.data;
        error = legacy.error;
      }
      if (error) throw new Error(error.message || "Failed to save platform email settings");
      const row = firstRow(data);
      const normalized = row ? normalizeRow(row) : null;
      setSettings(normalized);
      return normalized;
    } finally {
      setSaving(false);
    }
  }, []);

  return {
    settings,
    loading,
    saving,
    refetch,
    saveSettings,
  };
}

