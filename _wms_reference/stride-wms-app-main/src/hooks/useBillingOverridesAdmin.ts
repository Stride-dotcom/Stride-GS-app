import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type BillingOverrideFilter = "all" | "comped" | "not_comped";

export interface TenantBillingOverrideProfile {
  tenant_id: string;
  tenant_name: string;
  company_name: string | null;
  company_email: string | null;
  app_subdomain: string | null;
  tenant_status: string;
  subscription_status: string;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  is_comped: boolean;
  comped_reason: string | null;
  comped_note: string | null;
  expires_at: string | null;
  comped_at: string | null;
  comped_by: string | null;
  removed_at: string | null;
  removed_by: string | null;
  override_updated_at: string | null;
}

export interface BillingOverrideLogEntry {
  id: string;
  tenant_id: string;
  event_type: string;
  actor_user_id: string | null;
  is_comped: boolean;
  reason: string | null;
  note: string | null;
  expires_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface SetBillingOverrideInput {
  tenantId: string;
  isComped: boolean;
  reason?: string | null;
  note?: string | null;
  expiresAt?: string | null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function toBoolean(value: unknown): boolean {
  return value === true;
}

function normalizeProfileRow(row: Record<string, unknown>): TenantBillingOverrideProfile {
  return {
    tenant_id: String(row.tenant_id),
    tenant_name: String(row.tenant_name ?? ""),
    company_name: toNullableString(row.company_name),
    company_email: toNullableString(row.company_email),
    app_subdomain: toNullableString(row.app_subdomain),
    tenant_status: String(row.tenant_status ?? "unknown"),
    subscription_status: String(row.subscription_status ?? "none"),
    stripe_subscription_id: toNullableString(row.stripe_subscription_id),
    stripe_customer_id: toNullableString(row.stripe_customer_id),
    is_comped: toBoolean(row.is_comped),
    comped_reason: toNullableString(row.comped_reason),
    comped_note: toNullableString(row.comped_note),
    expires_at: toNullableString(row.expires_at),
    comped_at: toNullableString(row.comped_at),
    comped_by: toNullableString(row.comped_by),
    removed_at: toNullableString(row.removed_at),
    removed_by: toNullableString(row.removed_by),
    override_updated_at: toNullableString(row.override_updated_at),
  };
}

function normalizeLogRow(row: Record<string, unknown>): BillingOverrideLogEntry {
  return {
    id: String(row.id),
    tenant_id: String(row.tenant_id),
    event_type: String(row.event_type ?? ""),
    actor_user_id: toNullableString(row.actor_user_id),
    is_comped: toBoolean(row.is_comped),
    reason: toNullableString(row.reason),
    note: toNullableString(row.note),
    expires_at: toNullableString(row.expires_at),
    metadata:
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {},
    created_at: String(row.created_at ?? ""),
  };
}

export function useBillingOverridesAdmin() {
  const [profiles, setProfiles] = useState<TenantBillingOverrideProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  const fetchProfiles = useCallback(async (filter: BillingOverrideFilter = "all") => {
    const { data, error } = await (supabase as any).rpc("rpc_admin_list_tenant_billing_overrides", {
      p_filter: filter,
    });
    if (error) throw new Error(error.message || "Failed to load billing override profiles");
    const rows = Array.isArray(data) ? data : [];
    setProfiles(rows.map((row) => normalizeProfileRow(row as Record<string, unknown>)));
  }, []);

  const refetch = useCallback(
    async (filter: BillingOverrideFilter = "all") => {
      setLoading(true);
      try {
        await fetchProfiles(filter);
      } finally {
        setLoading(false);
      }
    },
    [fetchProfiles]
  );

  useEffect(() => {
    void refetch("all");
  }, [refetch]);

  const setBillingOverride = useCallback(async (input: SetBillingOverrideInput) => {
    setUpdating(true);
    try {
      const { data, error } = await (supabase as any).rpc("rpc_admin_set_tenant_billing_override", {
        p_tenant_id: input.tenantId,
        p_is_comped: input.isComped,
        p_reason: input.reason ?? null,
        p_note: input.note ?? null,
        p_expires_at: input.expiresAt ?? null,
      });
      if (error) throw new Error(error.message || "Failed to update billing override");
      return data as Record<string, unknown>;
    } finally {
      setUpdating(false);
    }
  }, []);

  const fetchTenantLog = useCallback(async (tenantId: string, limit = 50) => {
    const { data, error } = await (supabase as any).rpc("rpc_admin_get_tenant_billing_override_log", {
      p_tenant_id: tenantId,
      p_limit: limit,
    });
    if (error) throw new Error(error.message || "Failed to load billing override history");
    const rows = Array.isArray(data) ? data : [];
    return rows.map((row) => normalizeLogRow(row as Record<string, unknown>));
  }, []);

  return {
    profiles,
    loading,
    updating,
    refetch,
    setBillingOverride,
    fetchTenantLog,
  };
}
