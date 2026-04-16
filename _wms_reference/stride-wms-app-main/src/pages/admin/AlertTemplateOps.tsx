import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { useToast } from "@/hooks/use-toast";
import { BackToDevConsoleButton } from "@/components/admin/BackToDevConsoleButton";
import { supabase } from "@/integrations/supabase/client";
import { useAdminDev } from "@/hooks/useAdminDev";
import { useAuth } from "@/contexts/AuthContext";
import { buildBrandedEmailHtml, replaceTokens } from "@/lib/emailTemplates/brandedEmailBuilder";
import { COMMUNICATION_VARIABLES } from "@/hooks/useCommunications";
import { getDefaultTemplate } from "@/lib/emailTemplates/defaultAlertTemplates";

type Channel = "email" | "sms" | "in_app";
type RolloutMode = "replace_all" | "layout_only" | "do_not_update";
type EditorMode = "platform" | "tenant";

interface TriggerRow {
  key: string;
  display_name: string;
  description?: string | null;
  module_group: string;
  audience: string;
  severity: string;
  is_legacy?: boolean;
}

interface PlatformTemplateRow {
  id: string;
  trigger_event: string;
  channel: Channel;
  subject_template: string | null;
  body_template: string;
  body_format: "text" | "html";
  editor_json: Record<string, unknown> | null;
  is_active: boolean;
  updated_at: string;
}

interface TenantAlertRow {
  id: string;
  trigger_event: string;
  name: string;
  is_enabled: boolean;
  channels: { email?: boolean; sms?: boolean; in_app?: boolean } | null;
}

interface WrapperRow {
  id: string;
  name: string;
  description: string | null;
  wrapper_html_template: string;
  is_active: boolean;
  updated_at: string;
}

interface RolloutRow {
  id: string;
  name: string;
  notes: string | null;
  scheduled_for: string;
  status: string;
  update_mode: RolloutMode;
  preserve_subject: boolean;
  preserve_body_text: boolean;
  allow_tenant_opt_out: boolean;
  is_security_critical: boolean;
  security_grace_hours: number;
  security_grace_until: string | null;
  include_triggers: string[] | null;
  wrapper_version_id: string | null;
  created_at: string;
  launched_at: string | null;
}

interface TenantPreviewInfo {
  companyName: string;
  logoUrl: string;
  companyEmail: string;
  companyAddress: string;
  portalBaseUrl: string;
  accentColor: string;
}

interface TemplateLibraryCoverageTrigger {
  trigger_event: string;
  display_name: string;
  module_group: string;
  is_legacy: boolean;
  missing_channels: Channel[];
  inactive_channels: Channel[];
  active_channel_count: number;
}

interface TemplateLibraryCoverage {
  generated_at: string;
  include_legacy: boolean;
  hidden_legacy_triggers: number;
  total_active_triggers: number;
  fully_covered_triggers: number;
  partial_or_missing_triggers: number;
  missing_template_pairs: number;
  missing_by_channel: Partial<Record<Channel, number>>;
  triggers: TemplateLibraryCoverageTrigger[];
}

function toLocalDateTimeInputValue(iso: string): string {
  const date = new Date(iso);
  const tzOffsetMs = date.getTimezoneOffset() * 60_000;
  const local = new Date(date.getTime() - tzOffsetMs);
  return local.toISOString().slice(0, 16);
}

function fromLocalDateTimeInputValue(localValue: string): string {
  return new Date(localValue).toISOString();
}

function isLikelyFullHtmlDoc(value: string): boolean {
  const trimmed = value.trim();
  return /^<!doctype/i.test(trimmed) || /^<html/i.test(trimmed);
}

export default function AlertTemplateOps() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const { isAdminDev, loading: adminDevLoading } = useAdminDev();

  const [loading, setLoading] = useState(true);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [savingWrapper, setSavingWrapper] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [notifying, setNotifying] = useState(false);
  const [syncingCatalog, setSyncingCatalog] = useState<"none" | "selected" | "all">("none");
  const [showLegacyTriggers, setShowLegacyTriggers] = useState(false);
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("platform");

  const [triggers, setTriggers] = useState<TriggerRow[]>([]);
  const [templates, setTemplates] = useState<PlatformTemplateRow[]>([]);
  const [wrappers, setWrappers] = useState<WrapperRow[]>([]);
  const [rollouts, setRollouts] = useState<RolloutRow[]>([]);
  const [tenantAlerts, setTenantAlerts] = useState<TenantAlertRow[]>([]);
  const [coverage, setCoverage] = useState<TemplateLibraryCoverage | null>(null);
  const [previewInfo, setPreviewInfo] = useState<TenantPreviewInfo>({
    companyName: "Your Company",
    logoUrl: "",
    companyEmail: "support@example.com",
    companyAddress: "",
    portalBaseUrl: "",
    accentColor: "#FD5A2A",
  });

  const [selectedTrigger, setSelectedTrigger] = useState("");
  const [selectedChannel, setSelectedChannel] = useState<Channel>("email");

  const [subjectTemplate, setSubjectTemplate] = useState("");
  const [bodyTemplate, setBodyTemplate] = useState("");
  const [bodyFormat, setBodyFormat] = useState<"text" | "html">("text");
  const [templateActive, setTemplateActive] = useState(true);
  const [heading, setHeading] = useState("");
  const [ctaEnabled, setCtaEnabled] = useState(false);
  const [ctaLabel, setCtaLabel] = useState("");
  const [ctaLink, setCtaLink] = useState("");

  const [selectedWrapperId, setSelectedWrapperId] = useState("");
  const [wrapperName, setWrapperName] = useState("");
  const [wrapperDescription, setWrapperDescription] = useState("");
  const [wrapperHtmlTemplate, setWrapperHtmlTemplate] = useState("");
  const [wrapperActive, setWrapperActive] = useState(false);

  const [rolloutName, setRolloutName] = useState("");
  const [rolloutNotes, setRolloutNotes] = useState("");
  const [rolloutScheduledFor, setRolloutScheduledFor] = useState(
    toLocalDateTimeInputValue(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()),
  );
  const [rolloutMode, setRolloutMode] = useState<RolloutMode>("layout_only");
  const [preserveSubject, setPreserveSubject] = useState(true);
  const [preserveBodyText, setPreserveBodyText] = useState(true);
  const [allowTenantOptOut, setAllowTenantOptOut] = useState(true);
  const [isSecurityCritical, setIsSecurityCritical] = useState(false);
  const [securityGraceHours, setSecurityGraceHours] = useState("72");
  const [includeTriggersCsv, setIncludeTriggersCsv] = useState("");
  const [rolloutWrapperId, setRolloutWrapperId] = useState("");
  const [selectedRolloutId, setSelectedRolloutId] = useState("");
  const [forceResetTenantId, setForceResetTenantId] = useState("");
  const [forceResetToken, setForceResetToken] = useState("");
  const [forceResetReason, setForceResetReason] = useState("");
  const [forceResetting, setForceResetting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const triggerRes = await supabase
        .from("communication_trigger_catalog")
        // Avoid selecting optional columns that may not exist on older DB states.
        .select("key, display_name, description, module_group, audience, severity")
        .eq("is_active", true)
        .order("module_group", { ascending: true })
        .order("display_name", { ascending: true });
      if (triggerRes.error) throw new Error(triggerRes.error.message);

      const triggerRows = (triggerRes.data || []) as TriggerRow[];
      setTriggers(triggerRows);

      const [platformTemplateRes, wrapperRes, rolloutRes, tenantAlertRes, tenantTemplateRes] = await Promise.all([
        (supabase as any)
          .from("platform_alert_template_library")
          .select("id, trigger_event, channel, subject_template, body_template, body_format, editor_json, is_active, updated_at")
          .order("trigger_event", { ascending: true })
          .order("channel", { ascending: true }),
        (supabase as any)
          .from("platform_email_wrapper_versions")
          .select("id, name, description, wrapper_html_template, is_active, updated_at")
          .order("is_active", { ascending: false })
          .order("updated_at", { ascending: false }),
        (supabase as any)
          .from("platform_template_rollouts")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(50),
        profile?.tenant_id
          ? supabase
              .from("communication_alerts")
              .select("id, trigger_event, name, is_enabled, channels")
              .eq("tenant_id", profile.tenant_id)
              .order("name", { ascending: true })
          : Promise.resolve({ data: [], error: null }),
        profile?.tenant_id
          ? supabase
              .from("communication_templates")
              .select("id, alert_id, channel, subject_template, body_template, body_format, editor_json, updated_at")
              .eq("tenant_id", profile.tenant_id)
          : Promise.resolve({ data: [], error: null }),
      ]);

      const tenantAlertRows = ((tenantAlertRes.data || []) as TenantAlertRow[]) || [];
      setTenantAlerts(tenantAlertRows);

      const platformTemplatesAvailable =
        !platformTemplateRes.error &&
        Array.isArray(platformTemplateRes.data);

      if (platformTemplatesAvailable) {
        setEditorMode("platform");
        setTemplates(((platformTemplateRes.data || []) as PlatformTemplateRow[]) || []);
        setWrappers(!wrapperRes.error ? (((wrapperRes.data || []) as WrapperRow[]) || []) : []);
        setRollouts(!rolloutRes.error ? (((rolloutRes.data || []) as RolloutRow[]) || []) : []);
      } else {
        setEditorMode("tenant");
        const triggerByAlertId = new Map<string, string>(
          tenantAlertRows.map((row) => [row.id, row.trigger_event]),
        );
        const tenantTemplates = ((tenantTemplateRes.data || []) as Array<{
          id: string;
          alert_id: string;
          channel: Channel;
          subject_template: string | null;
          body_template: string;
          body_format: "text" | "html";
          editor_json: Record<string, unknown> | null;
          updated_at: string;
        }>).flatMap((row) => {
          const triggerEvent = triggerByAlertId.get(row.alert_id);
          if (!triggerEvent) return [];
          return [{
            id: row.id,
            trigger_event: triggerEvent,
            channel: row.channel,
            subject_template: row.subject_template,
            body_template: row.body_template,
            body_format: row.body_format,
            editor_json: row.editor_json,
            is_active: true,
            updated_at: row.updated_at,
          } satisfies PlatformTemplateRow];
        });
        setTemplates(tenantTemplates);
        setWrappers([]);
        setRollouts([]);
      }

      if (!selectedTrigger && triggerRows.length > 0) {
        setSelectedTrigger(triggerRows[0].key);
      }
      if (!selectedRolloutId && !rolloutRes.error && rolloutRes.data && rolloutRes.data.length > 0) {
        setSelectedRolloutId(rolloutRes.data[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, selectedRolloutId, selectedTrigger]);

  const loadCoverage = useCallback(async () => {
    setCoverageLoading(true);
    try {
      const { data, error } = await (supabase as any).rpc("rpc_admin_get_platform_template_library_coverage", {
        p_include_legacy: showLegacyTriggers,
      });
      if (error) {
        // Keep page usable in environments where the RPC hasn't been applied yet.
        console.warn("[AlertTemplateOps] coverage RPC unavailable:", error.message);
        setCoverage(null);
        return;
      }
      setCoverage((data || null) as TemplateLibraryCoverage | null);
    } finally {
      setCoverageLoading(false);
    }
  }, [showLegacyTriggers]);

  const isLegacyTrigger = useCallback((trigger: TriggerRow) => {
    if (trigger.is_legacy) return true;
    if (trigger.display_name.toLowerCase().includes("(legacy)")) return true;
    return (trigger.description || "").toLowerCase().includes("legacy trigger");
  }, []);

  const visibleTriggers = useMemo(() => {
    if (showLegacyTriggers) return triggers;
    return triggers.filter((trigger) => !isLegacyTrigger(trigger));
  }, [showLegacyTriggers, triggers, isLegacyTrigger]);

  const hiddenLegacyTriggerCount = useMemo(() => {
    if (showLegacyTriggers) return 0;
    return triggers.filter((trigger) => isLegacyTrigger(trigger)).length;
  }, [showLegacyTriggers, triggers, isLegacyTrigger]);

  const coverageGapTriggers = useMemo(
    () =>
      (coverage?.triggers || []).filter(
        (t) => (t.missing_channels?.length || 0) > 0 || (t.inactive_channels?.length || 0) > 0,
      ),
    [coverage],
  );

  const loadPreviewInfo = useCallback(async () => {
    if (!profile?.tenant_id) return;
    const [{ data: company }, { data: brand }] = await Promise.all([
      supabase
        .from("tenant_company_settings")
        .select("company_name, logo_url, company_email, company_address, app_base_url")
        .eq("tenant_id", profile.tenant_id)
        .maybeSingle(),
      supabase
        .from("communication_brand_settings")
        .select("brand_primary_color")
        .eq("tenant_id", profile.tenant_id)
        .maybeSingle(),
    ]);

    setPreviewInfo({
      companyName: company?.company_name || "Your Company",
      logoUrl: company?.logo_url || "",
      companyEmail: company?.company_email || "support@example.com",
      companyAddress: company?.company_address || "",
      portalBaseUrl: company?.app_base_url || "",
      accentColor: brand?.brand_primary_color || "#FD5A2A",
    });
  }, [profile?.tenant_id]);

  useEffect(() => {
    if (!isAdminDev) return;
    void Promise.all([loadData(), loadPreviewInfo()]);
  }, [isAdminDev, loadData, loadPreviewInfo]);

  useEffect(() => {
    if (!isAdminDev) return;
    void loadCoverage();
  }, [isAdminDev, loadCoverage]);

  useEffect(() => {
    if (visibleTriggers.length === 0) {
      if (selectedTrigger) setSelectedTrigger("");
      return;
    }
    if (!selectedTrigger || !visibleTriggers.some((t) => t.key === selectedTrigger)) {
      setSelectedTrigger(visibleTriggers[0].key);
    }
  }, [visibleTriggers, selectedTrigger]);

  const selectedTemplate = useMemo(
    () =>
      templates.find((t) => t.trigger_event === selectedTrigger && t.channel === selectedChannel) || null,
    [templates, selectedTrigger, selectedChannel],
  );

  const tenantAlertByTrigger = useMemo(
    () => new Map(tenantAlerts.map((alert) => [alert.trigger_event, alert])),
    [tenantAlerts],
  );

  useEffect(() => {
    const trigger = triggers.find((t) => t.key === selectedTrigger);
    const triggerName = trigger?.display_name || "Notification";
    const defaults = getDefaultTemplate(selectedTrigger);

    if (!selectedTemplate) {
      setSubjectTemplate(defaults.subject || `[[tenant_name]]: ${triggerName}`);
      setBodyTemplate(
        selectedChannel === "sms"
          ? defaults.smsBody
          : selectedChannel === "in_app"
            ? defaults.inAppBody
            : defaults.body,
      );
      setBodyFormat("text");
      setTemplateActive(true);
      setHeading(defaults.heading || triggerName);
      setCtaEnabled(Boolean(defaults.ctaLabel));
      setCtaLabel(defaults.ctaLabel || "");
      setCtaLink(defaults.ctaLink || "");
      return;
    }

    setSubjectTemplate(selectedTemplate.subject_template || "");
    setBodyTemplate(selectedTemplate.body_template || "");
    setBodyFormat(selectedTemplate.body_format || "text");
    setTemplateActive(selectedTemplate.is_active);

    const editor = (selectedTemplate.editor_json || {}) as Record<string, unknown>;
    setHeading((editor.heading as string) || triggerName);
    setCtaEnabled(Boolean(editor.cta_enabled));
    setCtaLabel((editor.cta_label as string) || "");
    setCtaLink((editor.cta_link as string) || "");
  }, [selectedTemplate, selectedChannel, selectedTrigger, triggers]);

  const selectedWrapper = useMemo(
    () => wrappers.find((w) => w.id === selectedWrapperId) || null,
    [wrappers, selectedWrapperId],
  );

  useEffect(() => {
    if (!selectedWrapper) return;
    setWrapperName(selectedWrapper.name || "");
    setWrapperDescription(selectedWrapper.description || "");
    setWrapperHtmlTemplate(selectedWrapper.wrapper_html_template || "");
    setWrapperActive(selectedWrapper.is_active);
  }, [selectedWrapper]);

  useEffect(() => {
    if (isSecurityCritical) {
      setAllowTenantOptOut(false);
    }
  }, [isSecurityCritical]);

  const previewHtml = useMemo(() => {
    if (selectedChannel !== "email") {
      return `<html><body style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; padding: 16px;"><pre>${bodyTemplate.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</pre></body></html>`;
    }

    const sampleData: Record<string, string> = {};
    COMMUNICATION_VARIABLES.forEach((v) => {
      sampleData[v.key] = v.sample;
    });
    sampleData.tenant_name = previewInfo.companyName;
    sampleData.brand_logo_url = previewInfo.logoUrl;
    sampleData.brand_support_email = previewInfo.companyEmail;
    sampleData.tenant_company_address = previewInfo.companyAddress;
    sampleData.portal_base_url = previewInfo.portalBaseUrl;
    sampleData.brand_primary_color = previewInfo.accentColor;

    let raw = "";
    if (bodyFormat === "text") {
      raw = buildBrandedEmailHtml({
        heading: heading || "Notification",
        body: bodyTemplate || "",
        ctaEnabled,
        ctaLabel,
        ctaLink,
        accentColor: previewInfo.accentColor,
      });
    } else {
      raw = bodyTemplate || "";
      if (!isLikelyFullHtmlDoc(raw)) {
        raw = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;padding:16px;">${raw}</body></html>`;
      }
    }

    let resolved = replaceTokens(raw, sampleData);
    resolved = resolved.replace(/<img[^>]*src=["']\s*["'][^>]*\/?>/gi, "");
    return resolved;
  }, [
    selectedChannel,
    bodyTemplate,
    bodyFormat,
    heading,
    ctaEnabled,
    ctaLabel,
    ctaLink,
    previewInfo,
  ]);

  const handleSaveTemplate = async () => {
    if (!selectedTrigger) {
      toast({ variant: "destructive", title: "Select a trigger first" });
      return;
    }
    if (!bodyTemplate.trim()) {
      toast({ variant: "destructive", title: "Template body is required" });
      return;
    }

    setSavingTemplate(true);
    try {
      const editorJson =
        selectedChannel === "email"
          ? {
              heading,
              cta_enabled: ctaEnabled,
              cta_label: ctaLabel,
              cta_link: ctaLink,
            }
          : null;

      if (editorMode === "platform") {
        const { data, error } = await (supabase as any).rpc("rpc_admin_upsert_platform_alert_template", {
          p_trigger_event: selectedTrigger,
          p_channel: selectedChannel,
          p_subject_template: subjectTemplate || null,
          p_body_template: bodyTemplate,
          p_body_format: bodyFormat,
          p_editor_json: editorJson,
          p_is_active: templateActive,
        });
        if (error) throw new Error(error.message);

        toast({
          title: "Global template saved",
          description: `${selectedTrigger} (${selectedChannel}) updated.`,
        });

        const updated = data as PlatformTemplateRow;
        setTemplates((prev) => {
          const idx = prev.findIndex(
            (t) => t.trigger_event === updated.trigger_event && t.channel === updated.channel,
          );
          if (idx === -1) return [...prev, updated];
          const next = [...prev];
          next[idx] = updated;
          return next;
        });
        await loadCoverage();
      } else {
        const tenantAlert = tenantAlertByTrigger.get(selectedTrigger);
        if (!profile?.tenant_id) {
          throw new Error("A tenant context is required to edit live templates.");
        }
        if (!tenantAlert) {
          throw new Error("This alert is not provisioned for the current tenant yet. Use “Sync Selected Trigger” first.");
        }

        const payload = {
          tenant_id: profile.tenant_id,
          alert_id: tenantAlert.id,
          channel: selectedChannel,
          subject_template: selectedChannel === "sms" ? null : subjectTemplate || null,
          body_template: bodyTemplate,
          body_format: bodyFormat,
          editor_json: editorJson,
        };

        let updatedId = selectedTemplate?.id || "";
        if (selectedTemplate) {
          const { error } = await supabase
            .from("communication_templates")
            .update(payload)
            .eq("id", selectedTemplate.id);
          if (error) throw new Error(error.message);
        } else {
          const { data, error } = await supabase
            .from("communication_templates")
            .insert(payload)
            .select("id")
            .single();
          if (error) throw new Error(error.message);
          updatedId = data.id;
        }

        toast({
          title: "Live tenant template saved",
          description: `${selectedTrigger} (${selectedChannel}) updated for the current tenant.`,
        });

        setTemplates((prev) => {
          const updated: PlatformTemplateRow = {
            id: updatedId || selectedTemplate?.id || `${selectedTrigger}-${selectedChannel}`,
            trigger_event: selectedTrigger,
            channel: selectedChannel,
            subject_template: selectedChannel === "sms" ? null : subjectTemplate || null,
            body_template: bodyTemplate,
            body_format: bodyFormat,
            editor_json: editorJson,
            is_active: true,
            updated_at: new Date().toISOString(),
          };
          const idx = prev.findIndex(
            (t) => t.trigger_event === updated.trigger_event && t.channel === updated.channel,
          );
          if (idx === -1) return [...prev, updated];
          const next = [...prev];
          next[idx] = updated;
          return next;
        });
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to save template";
      toast({ variant: "destructive", title: "Save failed", description: message });
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleSaveWrapper = async () => {
    if (!wrapperHtmlTemplate.trim()) {
      toast({ variant: "destructive", title: "Wrapper HTML is required" });
      return;
    }
    if (!wrapperHtmlTemplate.includes("{{content}}")) {
      toast({
        variant: "destructive",
        title: "Invalid wrapper",
        description: "Wrapper must include {{content}} placeholder.",
      });
      return;
    }

    setSavingWrapper(true);
    try {
      const { data, error } = await (supabase as any).rpc("rpc_admin_upsert_platform_wrapper_version", {
        p_id: selectedWrapperId || null,
        p_name: wrapperName || null,
        p_description: wrapperDescription || null,
        p_wrapper_html_template: wrapperHtmlTemplate,
        p_is_active: wrapperActive,
      });
      if (error) throw new Error(error.message);

      const updated = data as WrapperRow;
      setSelectedWrapperId(updated.id);
      toast({ title: "Wrapper saved" });
      await loadData();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to save wrapper";
      toast({ variant: "destructive", title: "Save failed", description: message });
    } finally {
      setSavingWrapper(false);
    }
  };

  const handleActivateWrapper = async () => {
    if (!selectedWrapperId) {
      toast({ variant: "destructive", title: "Select a wrapper first" });
      return;
    }
    setSavingWrapper(true);
    try {
      const { error } = await (supabase as any).rpc("rpc_admin_activate_platform_wrapper_version", {
        p_id: selectedWrapperId,
      });
      if (error) throw new Error(error.message);
      toast({ title: "Wrapper activated" });
      await loadData();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to activate wrapper";
      toast({ variant: "destructive", title: "Activation failed", description: message });
    } finally {
      setSavingWrapper(false);
    }
  };

  const handleScheduleRollout = async () => {
    if (!rolloutName.trim()) {
      toast({ variant: "destructive", title: "Rollout name is required" });
      return;
    }
    if (!rolloutScheduledFor) {
      toast({ variant: "destructive", title: "Schedule time is required" });
      return;
    }

    const includeTriggers = includeTriggersCsv
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    const parsedGraceHours = Number.parseInt(securityGraceHours, 10);
    const graceHours = Number.isFinite(parsedGraceHours)
      ? Math.max(0, Math.min(8760, parsedGraceHours))
      : 72;

    setScheduling(true);
    try {
      const { data, error } = await (supabase as any).rpc("rpc_admin_schedule_template_rollout", {
        p_name: rolloutName.trim(),
        p_notes: rolloutNotes.trim() || null,
        p_scheduled_for: fromLocalDateTimeInputValue(rolloutScheduledFor),
        p_update_mode: rolloutMode,
        p_preserve_subject: preserveSubject,
        p_preserve_body_text: preserveBodyText,
        p_allow_tenant_opt_out: isSecurityCritical ? false : allowTenantOptOut,
        p_include_triggers: includeTriggers.length > 0 ? includeTriggers : null,
        p_wrapper_version_id: rolloutWrapperId || null,
        p_is_security_critical: isSecurityCritical,
        p_security_grace_hours: graceHours,
      });
      if (error) throw new Error(error.message);

      toast({ title: "Rollout scheduled" });
      const created = data as RolloutRow;
      setSelectedRolloutId(created.id);
      setRollouts((prev) => [created, ...prev]);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to schedule rollout";
      toast({ variant: "destructive", title: "Schedule failed", description: message });
    } finally {
      setScheduling(false);
    }
  };

  const selectedRollout = useMemo(
    () => rollouts.find((r) => r.id === selectedRolloutId) || null,
    [rollouts, selectedRolloutId],
  );

  const handleLaunchNow = async () => {
    if (!selectedRollout) {
      toast({ variant: "destructive", title: "Select a rollout first" });
      return;
    }
    setExecuting(true);
    try {
      const { data, error } = await (supabase as any).rpc("rpc_admin_execute_template_rollout", {
        p_rollout_id: selectedRollout.id,
      });
      if (error) throw new Error(error.message);

      const result = data as { inserted?: number; updated?: number; skipped?: number };
      toast({
        title: "Rollout executed",
        description: `Inserted: ${result.inserted || 0}, Updated: ${result.updated || 0}, Skipped: ${result.skipped || 0}`,
      });
      await loadData();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to execute rollout";
      toast({ variant: "destructive", title: "Execution failed", description: message });
    } finally {
      setExecuting(false);
    }
  };

  const handleNotifyTenantAdmins = async () => {
    if (!selectedRollout) {
      toast({ variant: "destructive", title: "Select a rollout first" });
      return;
    }
    setNotifying(true);
    try {
      const [{ data: recipients, error: recipientErr }, { data: inAppData, error: inAppErr }] =
        await Promise.all([
          (supabase as any).rpc("rpc_admin_list_rollout_notice_recipients", {
            p_rollout_id: selectedRollout.id,
          }),
          (supabase as any).rpc("rpc_admin_create_rollout_in_app_notifications", {
            p_rollout_id: selectedRollout.id,
          }),
        ]);
      if (recipientErr) throw new Error(recipientErr.message);
      if (inAppErr) throw new Error(inAppErr.message);

      const uniqueEmails = [
        ...new Set(
          ((recipients || []) as Array<{ email: string | null }>)
            .map((r) => (r.email || "").trim().toLowerCase())
            .filter(Boolean),
        ),
      ];

      if (uniqueEmails.length > 0) {
        const emailBodyText = [
          `A platform alert template rollout is scheduled.`,
          ``,
          `Rollout: ${selectedRollout.name}`,
          `Scheduled for: ${new Date(selectedRollout.scheduled_for).toLocaleString()}`,
          `Mode: ${selectedRollout.update_mode}`,
          `Subject preserved: ${selectedRollout.preserve_subject ? "Yes" : "No"}`,
          `Body text preserved: ${selectedRollout.preserve_body_text ? "Yes" : "No"}`,
          `Tenant opt-out allowed: ${selectedRollout.allow_tenant_opt_out ? "Yes" : "No"}`,
          `Security-critical: ${selectedRollout.is_security_critical ? "Yes" : "No"}`,
          selectedRollout.security_grace_until
            ? `Security grace deadline: ${new Date(selectedRollout.security_grace_until).toLocaleString()}`
            : "",
          ``,
          `Please review your alert templates in Settings > Alerts.`,
        ].join("\n");

        const emailHtml = buildBrandedEmailHtml({
          heading: "Scheduled Alert Template Update",
          body: emailBodyText,
          ctaEnabled: true,
          ctaLabel: "Open Alert Settings",
          ctaLink: previewInfo.portalBaseUrl || "#",
          accentColor: previewInfo.accentColor,
        });
        const tokenized = replaceTokens(emailHtml, {
          tenant_name: "Stride WMS",
          brand_logo_url: "",
          brand_support_email: "support@stridewms.com",
          tenant_company_address: "",
          portal_base_url: previewInfo.portalBaseUrl || "",
        });

        const { data: sendData, error: sendErr } = await supabase.functions.invoke("send-email", {
          body: {
            to: uniqueEmails,
            subject: `[Scheduled Update] ${selectedRollout.name}`,
            html: tokenized,
          },
        });
        if (sendErr) throw sendErr;
        if (!sendData?.ok) throw new Error(sendData?.error || "Email send failed");
      }

      const insertedInApp = (inAppData?.inserted as number | undefined) || 0;
      toast({
        title: "Tenant admin notices sent",
        description: `Emails: ${uniqueEmails.length}, In-app notifications: ${insertedInApp}`,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to notify tenant admins";
      toast({ variant: "destructive", title: "Notification failed", description: message });
    } finally {
      setNotifying(false);
    }
  };

  const handleSyncCatalogToTenants = async (scope: "selected" | "all") => {
    setSyncingCatalog(scope);
    try {
      const triggerKey = scope === "selected" ? selectedTrigger || null : null;
      const { data, error } = await (supabase as any).rpc("rpc_admin_sync_trigger_catalog_to_tenants", {
        p_trigger_key: triggerKey,
      });
      if (error) throw new Error(error.message);

      const result = data as {
        mode?: "single" | "all_active";
        result?: { alerts_created?: number; templates_created?: number };
        alerts_created?: number;
        templates_created?: number;
      };

      const alertsCreated =
        result.mode === "single"
          ? result.result?.alerts_created || 0
          : result.alerts_created || 0;
      const templatesCreated =
        result.mode === "single"
          ? result.result?.templates_created || 0
          : result.templates_created || 0;

      toast({
        title: scope === "selected" ? "Selected trigger synced" : "All active triggers synced",
        description: `Alerts created: ${alertsCreated}, templates created: ${templatesCreated}`,
      });

      await loadData();
      await loadCoverage();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to sync trigger catalog";
      toast({ variant: "destructive", title: "Catalog sync failed", description: message });
    } finally {
      setSyncingCatalog("none");
    }
  };

  const handleEmergencyForceReset = async () => {
    if (!forceResetTenantId.trim()) {
      toast({ variant: "destructive", title: "Tenant id is required" });
      return;
    }
    if (!forceResetToken.trim()) {
      toast({ variant: "destructive", title: "Override token is required" });
      return;
    }

    setForceResetting(true);
    try {
      const { data, error } = await (supabase as any).rpc("rpc_admin_force_reset_tenant_alert_templates", {
        p_tenant_id: forceResetTenantId.trim(),
        p_override_token: forceResetToken.trim(),
        p_reason: forceResetReason.trim() || null,
      });
      if (error) throw new Error(error.message);

      const summary = data as {
        deleted_alerts?: number;
        deleted_templates?: number;
        alerts_created?: number;
        templates_created?: number;
      };

      toast({
        title: "Emergency reset completed",
        description: `Deleted ${summary.deleted_alerts || 0} alerts / ${summary.deleted_templates || 0} templates. Recreated ${summary.alerts_created || 0} alerts / ${summary.templates_created || 0} templates.`,
      });

      await loadData();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to force reset tenant templates";
      toast({ variant: "destructive", title: "Emergency reset failed", description: message });
    } finally {
      setForceResetting(false);
    }
  };

  if (!adminDevLoading && !isAdminDev) {
    return <Navigate to="/" replace />;
  }

  return (
    <DashboardLayout>
      <div className="space-y-6 p-6">
        <PageHeader
          primaryText="Alert Template"
          accentText="Ops"
          description="admin_dev-only control center for global triggers, templates, wrappers, rollout scheduling, and tenant notices."
        />

        <div className="flex justify-start">
          <BackToDevConsoleButton />
        </div>

        <Alert>
          <MaterialIcon name="shield" size="sm" />
          <AlertDescription>
            This page is restricted to the <strong>admin_dev</strong> system role. Rollouts preserve tenant subject/body text by default and support tenant opt-out for non-critical updates.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MaterialIcon name="health_and_safety" size="md" />
                Template Library Coverage Health
              </CardTitle>
              <CardDescription>
                Verifies active catalog triggers have active platform templates for email, SMS, and in-app channels.
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void loadCoverage()}
              disabled={coverageLoading}
            >
              {coverageLoading ? (
                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
              ) : (
                <MaterialIcon name="refresh" size="sm" className="mr-2" />
              )}
              Refresh Coverage
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {coverage ? (
              <>
                <div className="grid gap-3 md:grid-cols-6">
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Active Triggers</div>
                    <div className="text-2xl font-semibold">{coverage.total_active_triggers}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Fully Covered</div>
                    <div className="text-2xl font-semibold text-emerald-600">{coverage.fully_covered_triggers}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Partial / Missing</div>
                    <div className="text-2xl font-semibold text-amber-600">{coverage.partial_or_missing_triggers}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Missing Email</div>
                    <div className="text-2xl font-semibold">{coverage.missing_by_channel?.email || 0}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Missing SMS</div>
                    <div className="text-2xl font-semibold">{coverage.missing_by_channel?.sms || 0}</div>
                  </div>
                  <div className="rounded-md border p-3">
                    <div className="text-xs text-muted-foreground">Missing In-App</div>
                    <div className="text-2xl font-semibold">{coverage.missing_by_channel?.in_app || 0}</div>
                  </div>
                </div>

                {!showLegacyTriggers && coverage.hidden_legacy_triggers > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Legacy triggers excluded from health totals: {coverage.hidden_legacy_triggers}
                  </div>
                )}

                {coverageGapTriggers.length === 0 ? (
                  <Alert>
                    <MaterialIcon name="check_circle" size="sm" className="text-emerald-600" />
                    <AlertDescription>
                      All active triggers currently have active template coverage across email, SMS, and in-app channels.
                    </AlertDescription>
                  </Alert>
                ) : (
                  <div className="space-y-2">
                    <div className="text-sm font-medium">Coverage gaps</div>
                    <div className="max-h-56 space-y-2 overflow-auto rounded-md border p-3">
                      {coverageGapTriggers.map((row) => (
                        <div key={row.trigger_event} className="rounded border p-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{row.display_name}</span>
                            <Badge variant="outline">{row.trigger_event}</Badge>
                            <Badge variant="secondary">{row.module_group}</Badge>
                            {row.is_legacy && <Badge variant="secondary">Legacy</Badge>}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs">
                            {(row.missing_channels || []).map((channel) => (
                              <Badge key={`${row.trigger_event}-missing-${channel}`} variant="destructive">
                                Missing {channel}
                              </Badge>
                            ))}
                            {(row.inactive_channels || []).map((channel) => (
                              <Badge key={`${row.trigger_event}-inactive-${channel}`} variant="outline">
                                Inactive {channel}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <Alert>
                <MaterialIcon name="info" size="sm" />
                <AlertDescription>
                  Coverage RPC is not available yet in this environment. Apply latest migrations and refresh.
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MaterialIcon name="edit_note" size="md" />
                Global Template Editor
              </CardTitle>
              <CardDescription>
                {editorMode === "platform"
                  ? "Edit platform-level defaults by trigger + channel before rollout."
                  : "Platform library is unavailable in this environment. Editing the current tenant’s live alert templates instead."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {editorMode === "tenant" && (
                <Alert>
                  <MaterialIcon name="info" size="sm" />
                  <AlertDescription>
                    You are editing <strong>live tenant templates</strong> for the currently signed-in tenant, not global platform defaults. Wrapper/rollout sections below may remain unavailable until the platform subsystem is restored.
                  </AlertDescription>
                </Alert>
              )}
              <Alert>
                <MaterialIcon name="sync" size="sm" />
                <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span>
                    Catalog sync provisions missing tenant alerts/templates (email, SMS, in-app) for new trigger keys without overwriting existing tenant templates.
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleSyncCatalogToTenants("selected")}
                      disabled={!selectedTrigger || syncingCatalog !== "none"}
                    >
                      {syncingCatalog === "selected" ? (
                        <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                      ) : (
                        <MaterialIcon name="sync" size="sm" className="mr-2" />
                      )}
                      Sync Selected Trigger
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleSyncCatalogToTenants("all")}
                      disabled={syncingCatalog !== "none"}
                    >
                      {syncingCatalog === "all" ? (
                        <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                      ) : (
                        <MaterialIcon name="sync_alt" size="sm" className="mr-2" />
                      )}
                      Sync All Active Triggers
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>

              <Alert className="border-destructive/40">
                <MaterialIcon name="warning" size="sm" className="text-destructive" />
                <AlertDescription className="space-y-3">
                  <div className="text-sm">
                    Emergency full reset (admin_dev override): deletes one tenant&apos;s alert/templates and rebuilds from active catalog defaults.
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Tenant ID (UUID)</Label>
                      <Input
                        value={forceResetTenantId}
                        onChange={(e) => setForceResetTenantId(e.target.value)}
                        placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Override token</Label>
                      <Input
                        value={forceResetToken}
                        onChange={(e) => setForceResetToken(e.target.value)}
                        placeholder="FORCE_RESET_ALERT_TEMPLATES_V1"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Reason (recommended)</Label>
                    <Input
                      value={forceResetReason}
                      onChange={(e) => setForceResetReason(e.target.value)}
                      placeholder="Emergency rollback / corruption recovery / etc."
                    />
                  </div>
                  <div className="flex justify-end">
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={handleEmergencyForceReset}
                      disabled={forceResetting}
                    >
                      {forceResetting ? (
                        <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                      ) : (
                        <MaterialIcon name="restart_alt" size="sm" className="mr-2" />
                      )}
                      Force Reset Tenant Templates
                    </Button>
                  </div>
                </AlertDescription>
              </Alert>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Trigger</Label>
                  <Select value={selectedTrigger} onValueChange={setSelectedTrigger}>
                    <SelectTrigger>
                      <SelectValue placeholder={loading ? "Loading triggers..." : "Select trigger"} />
                    </SelectTrigger>
                    <SelectContent>
                      {visibleTriggers.map((t) => (
                        <SelectItem key={t.key} value={t.key}>
                          {t.display_name} ({t.key})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center justify-between rounded-md border px-3 py-2">
                    <span className="text-xs text-muted-foreground">
                      Legacy triggers hidden by default
                      {hiddenLegacyTriggerCount > 0 ? ` (${hiddenLegacyTriggerCount} hidden)` : ""}.
                    </span>
                    <label className="inline-flex items-center gap-2 text-xs font-medium">
                      Show legacy
                      <Switch checked={showLegacyTriggers} onCheckedChange={setShowLegacyTriggers} />
                    </label>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Channel</Label>
                  <Select value={selectedChannel} onValueChange={(v) => setSelectedChannel(v as Channel)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="email">Email</SelectItem>
                      <SelectItem value="sms">SMS</SelectItem>
                      <SelectItem value="in_app">In-App</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Subject Template</Label>
                <Input value={subjectTemplate} onChange={(e) => setSubjectTemplate(e.target.value)} />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Body Format</Label>
                  <Select value={bodyFormat} onValueChange={(v) => setBodyFormat(v as "text" | "html")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="text">text</SelectItem>
                      <SelectItem value="html">html</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center justify-between gap-2 rounded-md border p-3 mt-6">
                  <div className="text-sm">
                    <div className="font-medium">Template Active</div>
                    <div className="text-xs text-muted-foreground">Controls rollout source eligibility</div>
                  </div>
                  <Switch checked={templateActive} onCheckedChange={setTemplateActive} />
                </div>
              </div>

              {selectedChannel === "email" && (
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-2 md:col-span-3">
                    <Label>Heading</Label>
                    <Input value={heading} onChange={(e) => setHeading(e.target.value)} />
                  </div>
                  <div className="flex items-center justify-between gap-2 rounded-md border p-3">
                    <span className="text-sm font-medium">CTA Enabled</span>
                    <Switch checked={ctaEnabled} onCheckedChange={setCtaEnabled} />
                  </div>
                  <div className="space-y-2">
                    <Label>CTA Label</Label>
                    <Input value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>CTA Link</Label>
                    <Input value={ctaLink} onChange={(e) => setCtaLink(e.target.value)} />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Body Template</Label>
                <Textarea
                  value={bodyTemplate}
                  onChange={(e) => setBodyTemplate(e.target.value)}
                  rows={11}
                  className="font-mono text-xs"
                />
              </div>

              <div className="flex justify-end">
                <Button onClick={handleSaveTemplate} disabled={savingTemplate || !selectedTrigger}>
                  {savingTemplate ? (
                    <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  ) : (
                    <MaterialIcon name="save" size="sm" className="mr-2" />
                  )}
                  Save Global Template
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MaterialIcon name="preview" size="md" />
                Email Render Preview
              </CardTitle>
              <CardDescription>
                Renders with sample token values and current Organization company info.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-3 flex flex-wrap gap-2">
                <Badge variant="secondary">Company: {previewInfo.companyName}</Badge>
                <Badge variant="outline">Accent: {previewInfo.accentColor}</Badge>
                <Badge variant="outline">{selectedChannel.toUpperCase()}</Badge>
              </div>
              <div className="h-[540px] overflow-hidden rounded-md border">
                <iframe title="Template Preview" srcDoc={previewHtml} className="h-full w-full border-0" sandbox="allow-same-origin" />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MaterialIcon name="web" size="md" />
                Wrapper Version Manager
              </CardTitle>
              <CardDescription>
                Create and activate global email wrapper designs. Must include {"{{content}}"}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {editorMode === "tenant" && (
                <Alert>
                  <MaterialIcon name="warning" size="sm" className="text-amber-600" />
                  <AlertDescription>
                    Wrapper management is disabled while the platform template subsystem is unavailable. Live tenant emails will still use the active send wrapper configured server-side.
                  </AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label>Existing Wrappers</Label>
                <Select value={selectedWrapperId} onValueChange={setSelectedWrapperId} disabled={editorMode === "tenant"}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select wrapper version" />
                  </SelectTrigger>
                  <SelectContent>
                    {wrappers.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name} {w.is_active ? "• active" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Wrapper Name</Label>
                  <Input value={wrapperName} onChange={(e) => setWrapperName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Description</Label>
                  <Input value={wrapperDescription} onChange={(e) => setWrapperDescription(e.target.value)} />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="text-sm">
                  <div className="font-medium">Set Active</div>
                  <div className="text-xs text-muted-foreground">Activates this wrapper globally for sends</div>
                </div>
                <Switch checked={wrapperActive} onCheckedChange={setWrapperActive} />
              </div>
              <div className="space-y-2">
                <Label>Wrapper HTML</Label>
                <Textarea
                  value={wrapperHtmlTemplate}
                  onChange={(e) => setWrapperHtmlTemplate(e.target.value)}
                  rows={12}
                  className="font-mono text-xs"
                  placeholder={"Use placeholders like {{content}}, {{heading}}, {{subject}}, {{accent_color}}, {{cta_section}}."}
                  disabled={editorMode === "tenant"}
                />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={handleActivateWrapper} disabled={savingWrapper || !selectedWrapperId || editorMode === "tenant"}>
                  Activate Selected
                </Button>
                <Button onClick={handleSaveWrapper} disabled={savingWrapper || editorMode === "tenant"}>
                  {savingWrapper ? (
                    <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  ) : (
                    <MaterialIcon name="save" size="sm" className="mr-2" />
                  )}
                  Save Wrapper
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MaterialIcon name="schedule" size="md" />
                Rollout Scheduling + Tenant Notices
              </CardTitle>
              <CardDescription>
                Schedule updates, execute launches, and notify tenant admins (email + in-app).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {editorMode === "tenant" && (
                <Alert>
                  <MaterialIcon name="warning" size="sm" className="text-amber-600" />
                  <AlertDescription>
                    Rollout scheduling is unavailable until the platform rollout tables are restored. Use the live tenant template editor above for immediate email copy changes.
                  </AlertDescription>
                </Alert>
              )}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Rollout Name</Label>
                  <Input value={rolloutName} onChange={(e) => setRolloutName(e.target.value)} placeholder="Q1 Alert Template Refresh" disabled={editorMode === "tenant"} />
                </div>
                <div className="space-y-2">
                  <Label>Scheduled For</Label>
                  <Input
                    type="datetime-local"
                    value={rolloutScheduledFor}
                    onChange={(e) => setRolloutScheduledFor(e.target.value)}
                    disabled={editorMode === "tenant"}
                  />
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Update Mode</Label>
                  <Select value={rolloutMode} onValueChange={(v) => setRolloutMode(v as RolloutMode)} disabled={editorMode === "tenant"}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="replace_all">replace_all</SelectItem>
                      <SelectItem value="layout_only">layout_only</SelectItem>
                      <SelectItem value="do_not_update">do_not_update</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Wrapper Version (optional)</Label>
                  <Select value={rolloutWrapperId} onValueChange={setRolloutWrapperId} disabled={editorMode === "tenant"}>
                    <SelectTrigger>
                      <SelectValue placeholder="Use current active wrapper" />
                    </SelectTrigger>
                    <SelectContent>
                      {wrappers.map((w) => (
                        <SelectItem key={w.id} value={w.id}>
                          {w.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>Include Triggers (comma-separated, optional)</Label>
                <Input
                  value={includeTriggersCsv}
                  onChange={(e) => setIncludeTriggersCsv(e.target.value)}
                  placeholder="shipment.received, task.assigned"
                  disabled={editorMode === "tenant"}
                />
              </div>

              <div className="space-y-2">
                <Label>Notes (optional)</Label>
                <Textarea value={rolloutNotes} onChange={(e) => setRolloutNotes(e.target.value)} rows={3} disabled={editorMode === "tenant"} />
              </div>

              <div className="grid gap-2">
                <div className="flex items-center justify-between rounded-md border p-3">
                  <span className="text-sm">Preserve Subject</span>
                  <Switch checked={preserveSubject} onCheckedChange={setPreserveSubject} disabled={editorMode === "tenant"} />
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <span className="text-sm">Preserve Body Text</span>
                  <Switch checked={preserveBodyText} onCheckedChange={setPreserveBodyText} disabled={editorMode === "tenant"} />
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <span className="text-sm">Allow Tenant Opt-Out (non-critical)</span>
                  <Switch
                    checked={allowTenantOptOut}
                    onCheckedChange={setAllowTenantOptOut}
                    disabled={isSecurityCritical || editorMode === "tenant"}
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div className="text-sm">
                    <div>Security-Critical Rollout</div>
                    <div className="text-xs text-muted-foreground">
                      Auto-forces replace_all after grace window and bypasses tenant opt-out.
                    </div>
                  </div>
                  <Switch checked={isSecurityCritical} onCheckedChange={setIsSecurityCritical} disabled={editorMode === "tenant"} />
                </div>
                <div className="grid gap-2 rounded-md border p-3">
                  <Label htmlFor="securityGraceHours" className="text-sm">
                    Security Grace Window (hours)
                  </Label>
                  <Input
                    id="securityGraceHours"
                    type="number"
                    min={0}
                    max={8760}
                    value={securityGraceHours}
                    onChange={(e) => setSecurityGraceHours(e.target.value)}
                    disabled={!isSecurityCritical || editorMode === "tenant"}
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={handleScheduleRollout} disabled={scheduling || editorMode === "tenant"}>
                  {scheduling ? (
                    <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  ) : (
                    <MaterialIcon name="event" size="sm" className="mr-2" />
                  )}
                  Schedule Launch
                </Button>
              </div>

              <div className="space-y-2 rounded-md border p-3">
                <Label>Recent Rollouts</Label>
                <Select value={selectedRolloutId} onValueChange={setSelectedRolloutId} disabled={editorMode === "tenant"}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select rollout" />
                  </SelectTrigger>
                  <SelectContent>
                    {rollouts.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.name} • {r.status} • {new Date(r.scheduled_for).toLocaleString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedRollout && (
                  <div className="grid gap-1 text-xs text-muted-foreground">
                    <div>Mode: {selectedRollout.update_mode}</div>
                    <div>Preserve subject/body: {selectedRollout.preserve_subject ? "Y" : "N"} / {selectedRollout.preserve_body_text ? "Y" : "N"}</div>
                    <div>Opt-out allowed: {selectedRollout.allow_tenant_opt_out ? "Yes" : "No"}</div>
                    <div>Security-critical: {selectedRollout.is_security_critical ? "Yes" : "No"}</div>
                    {selectedRollout.security_grace_until && (
                      <div>Security grace ends: {new Date(selectedRollout.security_grace_until).toLocaleString()}</div>
                    )}
                    <div>Status: {selectedRollout.status}</div>
                  </div>
                )}
                <div className="flex flex-wrap justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={handleNotifyTenantAdmins} disabled={notifying || !selectedRollout || editorMode === "tenant"}>
                    {notifying ? (
                      <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                    ) : (
                      <MaterialIcon name="campaign" size="sm" className="mr-2" />
                    )}
                    Notify Tenant Admins
                  </Button>
                  <Button onClick={handleLaunchNow} disabled={executing || !selectedRollout || editorMode === "tenant"}>
                    {executing ? (
                      <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                    ) : (
                      <MaterialIcon name="rocket_launch" size="sm" className="mr-2" />
                    )}
                    Launch Now
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
}

