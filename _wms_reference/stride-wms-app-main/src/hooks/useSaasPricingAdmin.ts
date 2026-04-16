import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface SaasPricingVersion {
  id: string;
  effective_from: string;
  app_monthly_fee: number;
  sms_monthly_addon_fee: number;
  sms_segment_fee: number;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SaasPricingNoticeDispatch {
  id: string;
  pricing_version_id: string;
  notice_type: "upcoming" | "effective_today";
  recipient_count: number;
  sent_by: string | null;
  sent_at: string;
  metadata: Record<string, unknown>;
}

export interface EffectiveSaasPricing {
  id: string | null;
  effective_from: string | null;
  app_monthly_fee: number;
  sms_monthly_addon_fee: number;
  sms_segment_fee: number;
  notes: string | null;
}

interface CreatePricingVersionInput {
  effectiveFrom: string;
  appMonthlyFee: number;
  smsMonthlyAddonFee: number;
  smsSegmentFee: number;
  notes?: string | null;
}

interface SendPricingNoticeInput {
  pricingVersionId: string;
  noticeType: "upcoming" | "effective_today";
}

const DEFAULT_EFFECTIVE_PRICING: EffectiveSaasPricing = {
  id: null,
  effective_from: null,
  app_monthly_fee: 0,
  sms_monthly_addon_fee: 0,
  sms_segment_fee: 0,
  notes: null,
};

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeEffectivePricing(payload: unknown): EffectiveSaasPricing {
  if (!payload || typeof payload !== "object") return DEFAULT_EFFECTIVE_PRICING;
  const source = payload as Record<string, unknown>;
  return {
    id: typeof source.id === "string" ? source.id : null,
    effective_from: typeof source.effective_from === "string" ? source.effective_from : null,
    app_monthly_fee: toNumber(source.app_monthly_fee),
    sms_monthly_addon_fee: toNumber(source.sms_monthly_addon_fee),
    sms_segment_fee: toNumber(source.sms_segment_fee),
    notes: typeof source.notes === "string" ? source.notes : null,
  };
}

function normalizePricingVersion(row: Record<string, unknown>): SaasPricingVersion {
  return {
    id: String(row.id),
    effective_from: String(row.effective_from),
    app_monthly_fee: toNumber(row.app_monthly_fee),
    sms_monthly_addon_fee: toNumber(row.sms_monthly_addon_fee),
    sms_segment_fee: toNumber(row.sms_segment_fee),
    notes: typeof row.notes === "string" ? row.notes : null,
    created_by: typeof row.created_by === "string" ? row.created_by : null,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

function normalizeNoticeDispatch(row: Record<string, unknown>): SaasPricingNoticeDispatch {
  return {
    id: String(row.id),
    pricing_version_id: String(row.pricing_version_id),
    notice_type:
      row.notice_type === "upcoming" || row.notice_type === "effective_today"
        ? row.notice_type
        : "upcoming",
    recipient_count: toNumber(row.recipient_count),
    sent_by: typeof row.sent_by === "string" ? row.sent_by : null,
    sent_at: String(row.sent_at ?? ""),
    metadata:
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {},
  };
}

export function useSaasPricingAdmin() {
  const { profile } = useAuth();
  const [versions, setVersions] = useState<SaasPricingVersion[]>([]);
  const [dispatches, setDispatches] = useState<SaasPricingNoticeDispatch[]>([]);
  const [effectivePricing, setEffectivePricing] = useState<EffectiveSaasPricing>(
    DEFAULT_EFFECTIVE_PRICING
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sendingNotice, setSendingNotice] = useState(false);

  const fetchPricingVersions = useCallback(async () => {
    const { data, error } = await (supabase as any)
      .from("saas_pricing_versions")
      .select("*")
      .order("effective_from", { ascending: false })
      .limit(200);

    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    setVersions(rows.map((row) => normalizePricingVersion(row as Record<string, unknown>)));
  }, []);

  const fetchDispatches = useCallback(async () => {
    const { data, error } = await (supabase as any)
      .from("saas_pricing_notice_dispatches")
      .select("*")
      .order("sent_at", { ascending: false })
      .limit(100);

    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    setDispatches(rows.map((row) => normalizeNoticeDispatch(row as Record<string, unknown>)));
  }, []);

  const fetchEffectivePricing = useCallback(async () => {
    const { data, error } = await (supabase as any).rpc("rpc_get_effective_saas_pricing", {
      p_at: new Date().toISOString(),
    });
    if (error) throw error;
    setEffectivePricing(normalizeEffectivePricing(data));
  }, []);

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([fetchPricingVersions(), fetchDispatches(), fetchEffectivePricing()]);
    } finally {
      setLoading(false);
    }
  }, [fetchDispatches, fetchEffectivePricing, fetchPricingVersions]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const createPricingVersion = useCallback(
    async (input: CreatePricingVersionInput) => {
      setSaving(true);
      try {
        const payload = {
          effective_from: input.effectiveFrom,
          app_monthly_fee: input.appMonthlyFee,
          sms_monthly_addon_fee: input.smsMonthlyAddonFee,
          sms_segment_fee: input.smsSegmentFee,
          notes: input.notes ?? null,
          created_by: profile?.id ?? null,
        };

        const { error } = await (supabase as any).from("saas_pricing_versions").insert(payload);
        if (error) throw error;
        await refetch();
      } finally {
        setSaving(false);
      }
    },
    [profile?.id, refetch]
  );

  const sendPricingNotice = useCallback(
    async (input: SendPricingNoticeInput) => {
      setSendingNotice(true);
      try {
        const { data, error } = await supabase.functions.invoke("send-pricing-update-notices", {
          body: {
            pricing_version_id: input.pricingVersionId,
            notice_type: input.noticeType,
          },
        });
        if (error) throw new Error(error.message);
        await refetch();
        return data as {
          ok: boolean;
          sent_count: number;
          failed_count: number;
          recipient_count: number;
        };
      } finally {
        setSendingNotice(false);
      }
    },
    [refetch]
  );

  const versionStatusById = useMemo(() => {
    const now = Date.now();
    const map: Record<string, "active" | "upcoming" | "historical"> = {};
    let activeMarked = false;

    for (const version of versions) {
      const when = new Date(version.effective_from).getTime();
      if (!activeMarked && Number.isFinite(when) && when <= now) {
        map[version.id] = "active";
        activeMarked = true;
      } else if (Number.isFinite(when) && when > now) {
        map[version.id] = "upcoming";
      } else {
        map[version.id] = "historical";
      }
    }

    return map;
  }, [versions]);

  return {
    versions,
    dispatches,
    effectivePricing,
    loading,
    saving,
    sendingNotice,
    createPricingVersion,
    sendPricingNotice,
    refetch,
    versionStatusById,
  };
}

