import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface PlatformInboundEmailSettings {
  provider: "mailgun" | "postmark";
  reply_domain: string | null;
  is_active: boolean;
  updated_at: string | null;
}

interface SavePlatformInboundEmailSettingsInput {
  provider: "mailgun" | "postmark";
  replyDomain: string | null;
  isActive: boolean;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function firstRow(data: unknown): Record<string, unknown> | null {
  if (!data) return null;
  if (Array.isArray(data)) {
    const first = data[0];
    return first && typeof first === "object" ? (first as Record<string, unknown>) : null;
  }
  return typeof data === "object" ? (data as Record<string, unknown>) : null;
}

function normalizeRow(row: Record<string, unknown>): PlatformInboundEmailSettings {
  const provider = String(row.provider || "mailgun").toLowerCase();
  return {
    provider: provider === "postmark" ? "postmark" : "mailgun",
    reply_domain: toNullableString(row.reply_domain),
    is_active: toBoolean(row.is_active, false),
    updated_at: toNullableString(row.updated_at),
  };
}

export function usePlatformInboundEmailAdmin() {
  const [settings, setSettings] = useState<PlatformInboundEmailSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc("rpc_admin_get_platform_inbound_email_settings");
      if (error) throw new Error(error.message || "Failed to load inbound email settings");
      const row = firstRow(data);
      setSettings(row ? normalizeRow(row) : null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const saveSettings = useCallback(async (input: SavePlatformInboundEmailSettingsInput) => {
    setSaving(true);
    try {
      let { data, error } = await (supabase as any).rpc("rpc_admin_set_platform_inbound_email_settings", {
        p_provider: input.provider,
        p_reply_domain: input.replyDomain,
        p_is_active: input.isActive,
      });

      if (
        error &&
        /p_provider|function .*rpc_admin_set_platform_inbound_email_settings/i.test(error.message || "")
      ) {
        const legacy = await (supabase as any).rpc("rpc_admin_set_platform_inbound_email_settings", {
          p_reply_domain: input.replyDomain,
          p_is_active: input.isActive,
        });
        data = legacy.data;
        error = legacy.error;
      }

      if (error) throw new Error(error.message || "Failed to save inbound email settings");
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

