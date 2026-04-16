import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { useToast } from "@/hooks/use-toast";
import { useErrorTracking } from "@/hooks/useErrorTracking";
import { supabase } from "@/integrations/supabase/client";
import { usePlatformEmailAdmin } from "@/hooks/usePlatformEmailAdmin";
import { usePlatformInboundEmailAdmin } from "@/hooks/usePlatformInboundEmailAdmin";
import { BackToDevConsoleButton } from "@/components/admin/BackToDevConsoleButton";
import { ServiceConnectionBadge, ConnectionStatus } from "@/components/admin/ServiceConnectionBadge";

function isValidEmail(value: string): boolean {
  const trimmed = value.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function isValidDomain(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return /^[a-z0-9]+([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]+([a-z0-9-]*[a-z0-9])?)+$/.test(trimmed);
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((item): item is string => typeof item === "string");
      }
    } catch {
      return [];
    }
  }
  return [];
}

function getSupabaseProjectRef(): string | null {
  const baseUrl = String((supabase as any)?.supabaseUrl || "").trim();
  const match = baseUrl.match(/^https:\/\/([^.]+)\.supabase\.co/i);
  return match?.[1] || null;
}

interface ProviderHealthCheckRow {
  id: string;
  label: string;
  status: "ok" | "warn";
  detail: string;
}

type MigrationPreset = "start_migration" | "cutover" | "postmark_only";

type EmailOpsStatus =
  | "Ready"
  | "Pending (waiting on tenant DNS)"
  | "Action needed (set Reply-To inbox)"
  | "Warning (deliverability risk)"
  | "Error (misconfigured)";

type EmailOpsSenderType =
  | "Platform sender"
  | "Custom sender (verified)"
  | "Custom sender (pending)";

interface EmailOpsTenantRow {
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  company_email: string | null;
  reply_to_effective: string | null;
  use_default_email: boolean;
  custom_from_email: string | null;
  custom_email_domain: string | null;
  email_domain_verified: boolean;
  dkim_verified: boolean;
  spf_verified: boolean;
  dmarc_status: string | null;
  platform_sender_email: string | null;
  sender_type: EmailOpsSenderType;
  status: EmailOpsStatus;
  issue_badges: string[];
  warning_badges: string[];
  updated_at: string | null;
}

interface EmailCleanupLogRow {
  id: string;
  attempted_at: string | null;
  tenant_id: string;
  client_account: string | null;
  domain_name: string | null;
  resend_domain_id: string | null;
  status: string;
  error_message: string | null;
  attempts: number;
  metadata: Record<string, unknown> | null;
}

interface AlertSendLogRow {
  id: string;
  tenant_id: string;
  subject: string;
  status: string | null;
  created_at: string;
  sent_at: string | null;
  error_message: string | null;
  provider: "resend" | "postmark" | null;
  provider_message_id: string | null;
  fallback_used: boolean;
}

interface DirectEmailLogRow {
  id: string;
  tenant_id: string | null;
  recipient_email: string;
  subject: string;
  status: string;
  created_at: string | null;
  sent_at: string | null;
  error_message: string | null;
  email_type: string;
  provider: "resend" | "postmark" | "test_mode" | null;
  provider_message_id: string | null;
  fallback_used: boolean;
  resend_id: string | null;
}

function InfoLabel({ label, help }: { label: string; help: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" aria-label={`${label} help`}>
              <MaterialIcon name="info" size="sm" className="text-muted-foreground" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-left">
            <p className="text-xs leading-relaxed">{help}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

export default function EmailOps() {
  const { toast } = useToast();
  const { trackError, trackSupabaseError } = useErrorTracking("EmailOps");
  const { settings, loading, saving, saveSettings, refetch } = usePlatformEmailAdmin();
  const {
    settings: inboundSettings,
    loading: inboundLoading,
    saving: inboundSaving,
    saveSettings: saveInboundSettings,
    refetch: refetchInbound,
  } = usePlatformInboundEmailAdmin();

  const [defaultFromEmail, setDefaultFromEmail] = useState("");
  const [defaultReplyToEmail, setDefaultReplyToEmail] = useState("");
  const [fallbackSenderDomain, setFallbackSenderDomain] = useState("stridewms.com");
  const [wrapperHtmlTemplate, setWrapperHtmlTemplate] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [outboundPrimaryProvider, setOutboundPrimaryProvider] = useState<"resend" | "postmark">("resend");
  const [outboundFallbackProvider, setOutboundFallbackProvider] = useState<"none" | "resend" | "postmark">("none");

  const [testToEmail, setTestToEmail] = useState("");
  const [sendingTest, setSendingTest] = useState(false);
  const [testProviderOverride, setTestProviderOverride] = useState<"auto" | "resend" | "postmark">("auto");

  const [replyDomain, setReplyDomain] = useState("");
  const [replyRoutingActive, setReplyRoutingActive] = useState(false);
  const [inboundProvider, setInboundProvider] = useState<"mailgun" | "postmark">("mailgun");

  const [healthLoading, setHealthLoading] = useState(false);
  const [healthChecks, setHealthChecks] = useState<ProviderHealthCheckRow[]>([]);
  const [healthRecommendations, setHealthRecommendations] = useState<string[]>([]);
  const [presetSaving, setPresetSaving] = useState(false);

  const [sendLogsLoading, setSendLogsLoading] = useState(false);
  const [sendLogsError, setSendLogsError] = useState<string | null>(null);
  const [sendLogs, setSendLogs] = useState<AlertSendLogRow[]>([]);
  const [directLogsLoading, setDirectLogsLoading] = useState(false);
  const [directLogsError, setDirectLogsError] = useState<string | null>(null);
  const [directEmailLogs, setDirectEmailLogs] = useState<DirectEmailLogRow[]>([]);

  const [tenantSearch, setTenantSearch] = useState("");
  const [tenantRowsLoading, setTenantRowsLoading] = useState(false);
  const [tenantRowsError, setTenantRowsError] = useState<string | null>(null);
  const [tenantRows, setTenantRows] = useState<EmailOpsTenantRow[]>([]);
  const [tenantStatusFilter, setTenantStatusFilter] = useState<EmailOpsStatus | "all">("all");
  const [tenantSenderTypeFilter, setTenantSenderTypeFilter] = useState<EmailOpsSenderType | "all">("all");
  const [tenantSortKey, setTenantSortKey] = useState<"tenant_name" | "status" | "sender_type" | "updated_at">("tenant_name");
  const [tenantSortDirection, setTenantSortDirection] = useState<"asc" | "desc">("asc");

  const [cleanupIncludeSuccesses, setCleanupIncludeSuccesses] = useState(false);
  const [cleanupLogsLoading, setCleanupLogsLoading] = useState(false);
  const [cleanupLogsError, setCleanupLogsError] = useState<string | null>(null);
  const [cleanupLogs, setCleanupLogs] = useState<EmailCleanupLogRow[]>([]);

  const projectRef = getSupabaseProjectRef();
  const supabaseFunctionsSettingsUrl = projectRef
    ? `https://supabase.com/dashboard/project/${projectRef}/settings/functions`
    : "https://supabase.com/dashboard";
  const supabaseFunctionsUrl = projectRef
    ? `https://supabase.com/dashboard/project/${projectRef}/functions`
    : "https://supabase.com/dashboard";

  const trackEmailOpsFailure = (
    error: unknown,
    actionContext: string,
    table?: string,
    operation?: string,
  ) => {
    const asRecord = error as { message?: string; code?: string; details?: string; hint?: string } | null;
    if (asRecord?.message) {
      trackSupabaseError(
        {
          message: asRecord.message,
          code: asRecord.code,
          details: asRecord.details,
          hint: asRecord.hint,
        },
        actionContext,
        table,
        operation,
      );
      return;
    }
    trackError(error instanceof Error ? error : String(error), actionContext);
  };

  useEffect(() => {
    if (!settings) return;
    setDefaultFromEmail(settings.default_from_email || "");
    setDefaultReplyToEmail(settings.default_reply_to_email || "");
    setFallbackSenderDomain((settings.fallback_sender_domain || "stridewms.com").trim().toLowerCase());
    setWrapperHtmlTemplate(settings.wrapper_html_template || "");
    setIsActive(settings.is_active);
    setOutboundPrimaryProvider(settings.outbound_primary_provider || "resend");
    setOutboundFallbackProvider(settings.outbound_fallback_provider || "none");
  }, [settings]);

  useEffect(() => {
    if (!inboundSettings) return;
    setReplyDomain(inboundSettings.reply_domain || "");
    setReplyRoutingActive(inboundSettings.is_active);
    setInboundProvider(inboundSettings.provider || "mailgun");
  }, [inboundSettings]);

  useEffect(() => {
    if (outboundFallbackProvider !== "none" && outboundFallbackProvider === outboundPrimaryProvider) {
      setOutboundFallbackProvider("none");
    }
  }, [outboundPrimaryProvider, outboundFallbackProvider]);

  const hasUnsavedChanges = useMemo(() => {
    const s = settings;
    if (!s) {
      return (
        defaultFromEmail.trim().length > 0 ||
        defaultReplyToEmail.trim().length > 0 ||
        fallbackSenderDomain.trim().toLowerCase() !== "stridewms.com" ||
        wrapperHtmlTemplate.trim().length > 0 ||
        isActive !== true ||
        outboundPrimaryProvider !== "resend" ||
        outboundFallbackProvider !== "none"
      );
    }
    return (
      defaultFromEmail.trim() !== (s.default_from_email || "").trim() ||
      defaultReplyToEmail.trim() !== (s.default_reply_to_email || "").trim() ||
      fallbackSenderDomain.trim().toLowerCase() !== (s.fallback_sender_domain || "stridewms.com").trim().toLowerCase() ||
      wrapperHtmlTemplate.trim() !== (s.wrapper_html_template || "").trim() ||
      isActive !== s.is_active ||
      outboundPrimaryProvider !== (s.outbound_primary_provider || "resend") ||
      outboundFallbackProvider !== (s.outbound_fallback_provider || "none")
    );
  }, [
    defaultFromEmail,
    defaultReplyToEmail,
    fallbackSenderDomain,
    wrapperHtmlTemplate,
    isActive,
    outboundPrimaryProvider,
    outboundFallbackProvider,
    settings,
  ]);

  const runHealthCheck = async () => {
    setHealthLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("email-provider-health-check", { body: {} });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Health check failed");
      setHealthChecks(Array.isArray(data?.checks) ? (data.checks as ProviderHealthCheckRow[]) : []);
      setHealthRecommendations(Array.isArray(data?.recommendations) ? data.recommendations : []);
    } catch (error: any) {
      const rawMessage =
        error?.context?.body?.error ||
        error?.message ||
        "";
      const friendlyMessage =
        "Could not run provider health checks. Confirm email-provider-health-check is deployed and your account has admin_dev access.";
      const detail = rawMessage ? `${friendlyMessage} (${rawMessage})` : friendlyMessage;
      setHealthChecks([
        {
          id: "health_check_failed",
          label: "Provider health check failed",
          status: "warn",
          detail,
        },
      ]);
      setHealthRecommendations([]);
      toast({
        variant: "destructive",
        title: "Health check failed",
        description: detail,
      });
      trackEmailOpsFailure(error, "email_ops.run_health_check", "platform_email_settings", "select");
    } finally {
      setHealthLoading(false);
    }
  };

  const loadSendLogs = async () => {
    setSendLogsLoading(true);
    setSendLogsError(null);
    try {
      const providerSelect =
        "id, tenant_id, subject, status, created_at, sent_at, error_message, provider, provider_message_id, fallback_used";

      let { data, error } = await (supabase.from("alert_queue") as any)
        .select(providerSelect)
        .order("created_at", { ascending: false })
        .limit(25);

      // Backward compatibility for environments that have not applied provider fields yet.
      if (
        error &&
        /provider|provider_message_id|fallback_used|column/i.test(String(error.message || ""))
      ) {
        const legacy = await (supabase.from("alert_queue") as any)
          .select("id, tenant_id, subject, status, created_at, sent_at, error_message")
          .order("created_at", { ascending: false })
          .limit(25);
        data = legacy.data;
        error = legacy.error;
      }

      if (error) throw error;

      const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
      const mapped: AlertSendLogRow[] = rows.map((row) => {
        const providerRaw = String(row.provider || "").trim().toLowerCase();
        const provider =
          providerRaw === "resend" || providerRaw === "postmark"
            ? (providerRaw as "resend" | "postmark")
            : null;
        return {
          id: String(row.id || ""),
          tenant_id: String(row.tenant_id || ""),
          subject: String(row.subject || ""),
          status: typeof row.status === "string" ? row.status : null,
          created_at: String(row.created_at || ""),
          sent_at: typeof row.sent_at === "string" ? row.sent_at : null,
          error_message: typeof row.error_message === "string" ? row.error_message : null,
          provider,
          provider_message_id: typeof row.provider_message_id === "string" ? row.provider_message_id : null,
          fallback_used: row.fallback_used === true,
        };
      });

      setSendLogs(mapped);
    } catch (error: any) {
      setSendLogs([]);
      setSendLogsError(error?.message || "Failed to load send logs.");
      trackEmailOpsFailure(error, "email_ops.load_alert_send_logs", "alert_queue", "select");
    } finally {
      setSendLogsLoading(false);
    }
  };

  const loadDirectEmailLogs = async () => {
    setDirectLogsLoading(true);
    setDirectLogsError(null);
    try {
      const auditSelect =
        "id, tenant_id, recipient_email, subject, status, created_at, sent_at, error_message, email_type, provider, provider_message_id, fallback_used, resend_id";

      let { data, error } = await (supabase.from("email_logs") as any)
        .select(auditSelect)
        .order("created_at", { ascending: false })
        .limit(25);

      if (
        error &&
        /provider|provider_message_id|fallback_used|column/i.test(String(error.message || ""))
      ) {
        const legacy = await (supabase.from("email_logs") as any)
          .select("id, tenant_id, recipient_email, subject, status, created_at, sent_at, error_message, email_type, resend_id")
          .order("created_at", { ascending: false })
          .limit(25);
        data = legacy.data;
        error = legacy.error;
      }

      if (error) throw error;

      const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
      const mapped: DirectEmailLogRow[] = rows.map((row) => {
        const providerRaw = String(row.provider || "").trim().toLowerCase();
        const inferredProvider =
          providerRaw === "resend" || providerRaw === "postmark" || providerRaw === "test_mode"
            ? (providerRaw as "resend" | "postmark" | "test_mode")
            : String(row.resend_id || "") === "TEST_MODE"
              ? "test_mode"
              : row.resend_id
                ? "resend"
                : null;
        const providerMessageId =
          typeof row.provider_message_id === "string"
            ? row.provider_message_id
            : typeof row.resend_id === "string"
              ? row.resend_id
              : null;
        return {
          id: String(row.id || ""),
          tenant_id: typeof row.tenant_id === "string" ? row.tenant_id : null,
          recipient_email: String(row.recipient_email || ""),
          subject: String(row.subject || ""),
          status: String(row.status || ""),
          created_at: typeof row.created_at === "string" ? row.created_at : null,
          sent_at: typeof row.sent_at === "string" ? row.sent_at : null,
          error_message: typeof row.error_message === "string" ? row.error_message : null,
          email_type: String(row.email_type || ""),
          provider: inferredProvider,
          provider_message_id: providerMessageId,
          fallback_used: row.fallback_used === true,
          resend_id: typeof row.resend_id === "string" ? row.resend_id : null,
        };
      });

      setDirectEmailLogs(mapped);
    } catch (error: any) {
      setDirectEmailLogs([]);
      setDirectLogsError(error?.message || "Failed to load direct email logs.");
      trackEmailOpsFailure(error, "email_ops.load_direct_email_logs", "email_logs", "select");
    } finally {
      setDirectLogsLoading(false);
    }
  };

  const loadTenantRows = async (searchOverride?: string) => {
    const search = (searchOverride ?? tenantSearch).trim();
    setTenantRowsLoading(true);
    setTenantRowsError(null);
    try {
      const { data, error } = await (supabase as any).rpc("rpc_admin_list_email_ops_tenants", {
        p_search: search || null,
      });
      if (error) throw error;
      const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
      const mapped: EmailOpsTenantRow[] = rows.map((row) => ({
        tenant_id: String(row.tenant_id || ""),
        tenant_name: String(row.tenant_name || ""),
        tenant_slug: String(row.tenant_slug || ""),
        company_email: typeof row.company_email === "string" ? row.company_email : null,
        reply_to_effective: typeof row.reply_to_effective === "string" ? row.reply_to_effective : null,
        use_default_email: row.use_default_email === true,
        custom_from_email: typeof row.custom_from_email === "string" ? row.custom_from_email : null,
        custom_email_domain: typeof row.custom_email_domain === "string" ? row.custom_email_domain : null,
        email_domain_verified: row.email_domain_verified === true,
        dkim_verified: row.dkim_verified === true,
        spf_verified: row.spf_verified === true,
        dmarc_status: typeof row.dmarc_status === "string" ? row.dmarc_status : null,
        platform_sender_email: typeof row.platform_sender_email === "string" ? row.platform_sender_email : null,
        sender_type: (row.sender_type as EmailOpsSenderType) || "Platform sender",
        status: (row.status as EmailOpsStatus) || "Ready",
        issue_badges: parseStringArray(row.issue_badges),
        warning_badges: parseStringArray(row.warning_badges),
        updated_at: typeof row.updated_at === "string" ? row.updated_at : null,
      }));
      setTenantRows(mapped);
    } catch (error: any) {
      setTenantRows([]);
      const rawMessage = typeof error?.message === "string" ? error.message : "";
      const rpcSetupIssue = /rpc_admin_list_email_ops_tenants|does not exist|permission denied/i.test(rawMessage);
      const friendlyMessage = rpcSetupIssue
        ? "Could not load tenant sender status. Deploy the latest email ops DB migrations, then refresh."
        : "Could not load tenant sender status right now. Please try refresh again.";
      setTenantRowsError(rawMessage ? `${friendlyMessage} (${rawMessage})` : friendlyMessage);
      trackEmailOpsFailure(error, "email_ops.load_tenant_status_rows", undefined, "rpc");
    } finally {
      setTenantRowsLoading(false);
    }
  };

  const loadCleanupLogs = async (includeSuccesses = cleanupIncludeSuccesses) => {
    setCleanupLogsLoading(true);
    setCleanupLogsError(null);
    try {
      const { data, error } = await (supabase as any).rpc("rpc_admin_list_email_cleanup_logs", {
        p_include_successes: includeSuccesses,
        p_limit: 100,
        p_offset: 0,
      });
      if (error) throw error;
      const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
      const mapped: EmailCleanupLogRow[] = rows.map((row) => ({
        id: String(row.id || ""),
        attempted_at: typeof row.attempted_at === "string" ? row.attempted_at : null,
        tenant_id: String(row.tenant_id || ""),
        client_account: typeof row.client_account === "string" ? row.client_account : null,
        domain_name: typeof row.domain_name === "string" ? row.domain_name : null,
        resend_domain_id: typeof row.resend_domain_id === "string" ? row.resend_domain_id : null,
        status: String(row.status || ""),
        error_message: typeof row.error_message === "string" ? row.error_message : null,
        attempts: Number(row.attempts || 0),
        metadata:
          row.metadata && typeof row.metadata === "object"
            ? (row.metadata as Record<string, unknown>)
            : null,
      }));
      setCleanupLogs(mapped);
    } catch (error: any) {
      setCleanupLogs([]);
      const rawMessage = typeof error?.message === "string" ? error.message : "";
      const rpcSetupIssue = /rpc_admin_list_email_cleanup_logs|does not exist|permission denied/i.test(rawMessage);
      const friendlyMessage = rpcSetupIssue
        ? "Could not load cleanup logs. Deploy the latest email ops DB migrations, then refresh."
        : "Could not load cleanup logs right now. Please try refresh again.";
      setCleanupLogsError(rawMessage ? `${friendlyMessage} (${rawMessage})` : friendlyMessage);
      trackEmailOpsFailure(error, "email_ops.load_cleanup_logs", undefined, "rpc");
    } finally {
      setCleanupLogsLoading(false);
    }
  };

  const statusOptions: EmailOpsStatus[] = [
    "Ready",
    "Pending (waiting on tenant DNS)",
    "Action needed (set Reply-To inbox)",
    "Warning (deliverability risk)",
    "Error (misconfigured)",
  ];

  const senderTypeOptions: EmailOpsSenderType[] = [
    "Platform sender",
    "Custom sender (verified)",
    "Custom sender (pending)",
  ];

  const tenantSearchSuggestions = useMemo(() => {
    const suggestions = new Set<string>();
    tenantRows.forEach((row) => {
      if (row.tenant_name) suggestions.add(row.tenant_name);
      if (row.tenant_slug) suggestions.add(row.tenant_slug);
      if (row.company_email) suggestions.add(row.company_email);
    });
    return Array.from(suggestions).slice(0, 50);
  }, [tenantRows]);

  const filteredTenantRows = useMemo(() => {
    const search = tenantSearch.trim().toLowerCase();
    const filtered = tenantRows.filter((row) => {
      if (tenantStatusFilter !== "all" && row.status !== tenantStatusFilter) return false;
      if (tenantSenderTypeFilter !== "all" && row.sender_type !== tenantSenderTypeFilter) return false;
      if (!search) return true;
      return (
        row.tenant_name.toLowerCase().includes(search) ||
        row.tenant_slug.toLowerCase().includes(search) ||
        String(row.company_email || "").toLowerCase().includes(search) ||
        String(row.reply_to_effective || "").toLowerCase().includes(search)
      );
    });

    return filtered.sort((a, b) => {
      const direction = tenantSortDirection === "asc" ? 1 : -1;
      if (tenantSortKey === "updated_at") {
        const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return (aTime - bTime) * direction;
      }
      const aValue = String(a[tenantSortKey] || "").toLowerCase();
      const bValue = String(b[tenantSortKey] || "").toLowerCase();
      return aValue.localeCompare(bValue) * direction;
    });
  }, [tenantRows, tenantStatusFilter, tenantSenderTypeFilter, tenantSearch, tenantSortDirection, tenantSortKey]);

  const toggleTenantSort = (key: "tenant_name" | "status" | "sender_type" | "updated_at") => {
    if (tenantSortKey === key) {
      setTenantSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setTenantSortKey(key);
    setTenantSortDirection("asc");
  };

  const getTenantSortIcon = (key: "tenant_name" | "status" | "sender_type" | "updated_at") => {
    if (tenantSortKey !== key) return "unfold_more";
    return tenantSortDirection === "asc" ? "arrow_upward" : "arrow_downward";
  };

  useEffect(() => {
    void runHealthCheck();
    void loadSendLogs();
    void loadDirectEmailLogs();
    void loadTenantRows("");
    void loadCleanupLogs(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    if (!defaultFromEmail.trim()) {
      toast({ variant: "destructive", title: "From email required", description: "Enter a platform From email." });
      return;
    }
    if (!isValidEmail(defaultFromEmail)) {
      toast({ variant: "destructive", title: "Invalid From email", description: "Enter a valid email address." });
      return;
    }
    if (defaultReplyToEmail.trim() && !isValidEmail(defaultReplyToEmail)) {
      toast({ variant: "destructive", title: "Invalid Reply-To", description: "Enter a valid reply-to email (or leave blank)." });
      return;
    }
    if (outboundFallbackProvider !== "none" && outboundFallbackProvider === outboundPrimaryProvider) {
      toast({
        variant: "destructive",
        title: "Invalid fallback",
        description: "Fallback provider must be different from primary provider (or set to none).",
      });
      return;
    }
    if (wrapperHtmlTemplate.trim() && !wrapperHtmlTemplate.includes("{{content}}")) {
      toast({
        variant: "destructive",
        title: "Invalid wrapper template",
        description: 'Wrapper HTML must include the {{content}} placeholder.',
      });
      return;
    }

    const normalizedFallbackDomain = (fallbackSenderDomain.trim().toLowerCase() || "stridewms.com").trim();
    if (!isValidDomain(normalizedFallbackDomain)) {
      toast({
        variant: "destructive",
        title: "Invalid sender domain",
        description: "Enter a valid sender domain like stridewms.com.",
      });
      return;
    }

    try {
      await saveSettings({
        defaultFromEmail: defaultFromEmail.trim(),
        defaultFromName: null,
        defaultReplyToEmail: defaultReplyToEmail.trim() || null,
        fallbackSenderDomain: normalizedFallbackDomain,
        wrapperHtmlTemplate: wrapperHtmlTemplate.trim() || null,
        isActive,
        outboundPrimaryProvider,
        outboundFallbackProvider,
      });
      setFallbackSenderDomain(normalizedFallbackDomain);
      toast({
        title: "Platform sender saved",
        description: "Sender + provider routing updated.",
      });
      await refetch();
      await runHealthCheck();
      await loadTenantRows();
    } catch (error: unknown) {
      const typed = error as { message?: string; context?: { body?: { error?: string } } } | null;
      const message =
        typed?.context?.body?.error ||
        typed?.message ||
        "Failed to save platform email settings.";
      toast({ variant: "destructive", title: "Save failed", description: message });
      trackEmailOpsFailure(error, "email_ops.save_platform_settings", "platform_email_settings", "update");
    }
  };

  const applyMigrationPreset = async (preset: MigrationPreset) => {
    if (!defaultFromEmail.trim() || !isValidEmail(defaultFromEmail)) {
      toast({
        variant: "destructive",
        title: "Default sender required",
        description: "Set a valid platform From email before applying a migration preset.",
      });
      return;
    }
    if (defaultReplyToEmail.trim() && !isValidEmail(defaultReplyToEmail)) {
      toast({
        variant: "destructive",
        title: "Invalid Reply-To",
        description: "Enter a valid reply-to email (or clear it) before applying a preset.",
      });
      return;
    }
    if (wrapperHtmlTemplate.trim() && !wrapperHtmlTemplate.includes("{{content}}")) {
      toast({
        variant: "destructive",
        title: "Invalid wrapper template",
        description: 'Wrapper HTML must include the {{content}} placeholder.',
      });
      return;
    }

    const normalizedFallbackDomain = (fallbackSenderDomain.trim().toLowerCase() || "stridewms.com").trim();
    if (!isValidDomain(normalizedFallbackDomain)) {
      toast({
        variant: "destructive",
        title: "Invalid sender domain",
        description: "Enter a valid sender domain like stridewms.com.",
      });
      return;
    }

    const domain = replyDomain.trim().toLowerCase();
    if (replyRoutingActive && !domain) {
      toast({
        variant: "destructive",
        title: "Reply domain required",
        description: "Set a replies domain before applying a migration preset while inbound routing is enabled.",
      });
      return;
    }

    const presetConfig: Record<
      MigrationPreset,
      {
        primary: "resend" | "postmark";
        fallback: "none" | "resend" | "postmark";
        inbound: "mailgun" | "postmark";
        label: string;
      }
    > = {
      start_migration: {
        primary: "resend",
        fallback: "postmark",
        inbound: "postmark",
        label: "Start migration",
      },
      cutover: {
        primary: "postmark",
        fallback: "resend",
        inbound: "postmark",
        label: "Cutover",
      },
      postmark_only: {
        primary: "postmark",
        fallback: "none",
        inbound: "postmark",
        label: "Postmark only",
      },
    };

    const next = presetConfig[preset];
    setPresetSaving(true);
    try {
      await saveSettings({
        defaultFromEmail: defaultFromEmail.trim(),
        defaultFromName: null,
        defaultReplyToEmail: defaultReplyToEmail.trim() || null,
        fallbackSenderDomain: normalizedFallbackDomain,
        wrapperHtmlTemplate: wrapperHtmlTemplate.trim() || null,
        isActive,
        outboundPrimaryProvider: next.primary,
        outboundFallbackProvider: next.fallback,
      });

      await saveInboundSettings({
        provider: next.inbound,
        replyDomain: domain || null,
        isActive: replyRoutingActive,
      });

      setOutboundPrimaryProvider(next.primary);
      setOutboundFallbackProvider(next.fallback);
      setInboundProvider(next.inbound);
      setFallbackSenderDomain(normalizedFallbackDomain);

      toast({
        title: `Preset applied: ${next.label}`,
        description: `Primary=${next.primary}, fallback=${next.fallback}, inbound=${next.inbound}.`,
      });

      await Promise.all([refetch(), refetchInbound(), runHealthCheck(), loadSendLogs(), loadTenantRows()]);
    } catch (error: any) {
      const message =
        error?.context?.body?.error ||
        error?.message ||
        "Failed to apply migration preset.";
      toast({ variant: "destructive", title: "Preset failed", description: message });
      trackEmailOpsFailure(error, "email_ops.apply_migration_preset");
    } finally {
      setPresetSaving(false);
    }
  };

  const handleSendTest = async () => {
    if (!testToEmail.trim()) {
      toast({ variant: "destructive", title: "Recipient required", description: "Enter an email address to receive the test." });
      return;
    }
    if (!isValidEmail(testToEmail)) {
      toast({ variant: "destructive", title: "Invalid recipient", description: "Enter a valid recipient email." });
      return;
    }

    setSendingTest(true);
    try {
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px;">
          <h2 style="margin: 0 0 12px;">✅ Platform Email Sender Test</h2>
          <p style="margin: 0 0 8px;">If you received this, Stride's platform email sender is working.</p>
          <p style="margin: 0; color: #6b7280; font-size: 13px;">Sent at: ${new Date().toISOString()}</p>
        </div>
      `.trim();

      const { data, error } = await supabase.functions.invoke("send-email", {
        body: {
          to: testToEmail.trim(),
          subject: "[Test] Stride platform sender",
          html,
          ...(testProviderOverride !== "auto" ? { provider_override: testProviderOverride } : {}),
        },
      });

      if (error) throw error;
      if (!data?.ok) {
        throw new Error(data?.error || "Send failed");
      }

      toast({
        title: "Test email sent",
        description: `Sent to ${testToEmail.trim()} via ${data?.provider || "auto"}${data?.fallback_used ? " (fallback used)" : ""} (id: ${data?.id || "n/a"})`,
      });
    } catch (error: any) {
      const message =
        error?.context?.body?.error ||
        error?.message ||
        "Failed to send test email.";
      toast({ variant: "destructive", title: "Test send failed", description: message });
      trackEmailOpsFailure(error, "email_ops.send_test_email");
    } finally {
      setSendingTest(false);
    }
  };

  const webhookUrl = useMemo(() => {
    const base = String((supabase as any)?.supabaseUrl || "").trim();
    return base ? `${base}/functions/v1/inbound-email` : "/functions/v1/inbound-email";
  }, []);

  const platformSenderPreview = useMemo(() => {
    const domain = (fallbackSenderDomain.trim().toLowerCase() || "stridewms.com").trim();
    return `tenant-name@${domain}`;
  }, [fallbackSenderDomain]);

  const statusVariant = (status: EmailOpsStatus): "default" | "secondary" | "destructive" | "outline" => {
    if (status === "Ready") return "default";
    if (status === "Warning (deliverability risk)") return "outline";
    if (status === "Error (misconfigured)") return "destructive";
    return "secondary";
  };

  const handleSaveReplyRouting = async () => {
    const domain = replyDomain.trim().toLowerCase();
    if (replyRoutingActive && !domain) {
      toast({
        variant: "destructive",
        title: "Reply domain required",
        description: "Enter a replies subdomain (e.g. replies.stridewms.com) before enabling routing.",
      });
      return;
    }
    try {
      await saveInboundSettings({
        provider: inboundProvider,
        replyDomain: domain || null,
        isActive: replyRoutingActive,
      });
      toast({
        title: "Inbound reply routing saved",
        description: "Platform reply routing settings updated.",
      });
      await refetchInbound();
      await runHealthCheck();
      await loadTenantRows();
    } catch (error: unknown) {
      const typed = error as { message?: string; context?: { body?: { error?: string } } } | null;
      const message =
        typed?.context?.body?.error ||
        typed?.message ||
        "Failed to save inbound reply routing settings.";
      toast({ variant: "destructive", title: "Save failed", description: message });
      trackEmailOpsFailure(error, "email_ops.save_inbound_settings", "platform_inbound_email_settings", "update");
    }
  };

  const emailConnectionStatus: ConnectionStatus = healthLoading
    ? "checking"
    : healthChecks.length === 0
      ? "checking"
      : healthChecks.every((c) => c.status === "ok")
        ? "connected"
        : healthChecks.some((c) => c.id === "outbound_primary" && c.status === "warn")
          ? "not_configured"
          : "disconnected";

  const emailConnectionLabel = healthLoading || healthChecks.length === 0
    ? undefined
    : healthChecks.every((c) => c.status === "ok")
      ? "Providers Connected"
      : healthChecks.some((c) => c.id === "outbound_primary" && c.status === "warn")
        ? "Not Configured"
        : "Provider Issues";

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <PageHeader
            primaryText="Email"
            accentText="Ops"
            description="Admin-dev guided setup for outbound + inbound email, platform defaults, and tenant DNS status tracking."
          />
          <div className="flex flex-wrap items-start gap-2">
            <ServiceConnectionBadge
              status={emailConnectionStatus}
              label={emailConnectionLabel}
              onRecheck={runHealthCheck}
              loading={healthLoading}
            />
            <BackToDevConsoleButton />
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/pricing-ops">Pricing Ops</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/alert-template-ops">Template Ops</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/sms-sender-ops">SMS Sender Ops</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/billing-overrides-ops">Billing Overrides</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <a href={supabaseFunctionsSettingsUrl} target="_blank" rel="noreferrer">
                Supabase Function Secrets
              </a>
            </Button>
          </div>
        </div>

        <Alert>
          <MaterialIcon name="info" size="sm" />
          <AlertDescription>
            This config controls the <strong>platform default sender</strong>. Tenants can still send from their
            own domain after they verify DNS in their Organization settings. If a tenant does not set up a custom
            domain, their outbound sender is auto-generated as <code className="px-1 rounded bg-muted">tenant-name@your-domain</code>{" "}
            based on the platform sender domain below, and replies route to their tenant Reply-To inbox.
          </AlertDescription>
        </Alert>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="conversion_path" size="md" />
              Guided Setup Checklist (Non-technical)
            </CardTitle>
            <CardDescription>
              Follow these steps in order to connect providers, confirm health, and safely support tenant custom senders.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-md border p-3 space-y-2">
                <InfoLabel
                  label="Step 1: Add provider API keys"
                  help="In Supabase Function Secrets, add your email provider API keys (RESEND_API_KEY, POSTMARK_SERVER_TOKEN) plus inbound tokens. This app never asks for keys directly."
                />
                <Button variant="outline" size="sm" asChild>
                  <a href={supabaseFunctionsSettingsUrl} target="_blank" rel="noreferrer">
                    Open Function Secrets
                  </a>
                </Button>
              </div>

              <div className="rounded-md border p-3 space-y-2">
                <InfoLabel
                  label="Step 2: Configure sender + reply routing"
                  help="Set the platform sender defaults below. Tenants can then either use the platform sender or verify their own domain."
                />
                <p className="text-xs text-muted-foreground">
                  Save <strong>Platform Default Sender</strong> and <strong>Inbound Reply Forwarding</strong>.
                </p>
              </div>

              <div className="rounded-md border p-3 space-y-2">
                <InfoLabel
                  label="Step 3: Verify with health check + test send"
                  help="Run health checks and test sends to confirm provider keys, fallback behavior, and reply routing are all operational."
                />
                <Button variant="outline" size="sm" asChild>
                  <a href={supabaseFunctionsUrl} target="_blank" rel="noreferrer">
                    Open Edge Functions
                  </a>
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={runHealthCheck} disabled={healthLoading}>
                {healthLoading ? (
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                ) : (
                  <MaterialIcon name="health_and_safety" size="sm" className="mr-2" />
                )}
                Run Health Check
              </Button>
              <Badge variant="outline">Step 1: Configure secrets</Badge>
              <Badge variant="outline">Step 2: Set providers below</Badge>
              <Badge variant="outline">Step 3: Send test</Badge>
            </div>

            <div className="rounded-md border bg-muted/20 p-3 space-y-2">
              <p className="text-sm font-medium">One-click migration mode presets</p>
              <p className="text-xs text-muted-foreground">
                Applies outbound + inbound provider settings immediately using your current sender and reply-routing values.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => applyMigrationPreset("start_migration")}
                  disabled={presetSaving || saving || inboundSaving}
                >
                  {presetSaving && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
                  Start migration
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => applyMigrationPreset("cutover")}
                  disabled={presetSaving || saving || inboundSaving}
                >
                  {presetSaving && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
                  Cutover
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => applyMigrationPreset("postmark_only")}
                  disabled={presetSaving || saving || inboundSaving}
                >
                  {presetSaving && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
                  Postmark only
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {(healthChecks || []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No health results yet. Click <strong>Run Health Check</strong>. If it fails, verify function deploy
                  + provider secrets in Supabase.
                </p>
              ) : (
                healthChecks.map((check) => (
                  <div key={check.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
                    <div className="space-y-1">
                      <p className="text-sm font-medium">{check.label}</p>
                      <p className="text-xs text-muted-foreground">{check.detail}</p>
                    </div>
                    <Badge variant={check.status === "ok" ? "default" : "secondary"}>
                      {check.status === "ok" ? "Ready" : "Needs setup"}
                    </Badge>
                  </div>
                ))
              )}
            </div>

            {healthRecommendations.length > 0 && (
              <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                <p className="text-sm font-medium">Recommended next actions</p>
                <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
                  {healthRecommendations.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <CardTitle className="flex items-center gap-2">
                <MaterialIcon name="groups" size="md" />
                Tenant Sender Status
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadTenantRows()}
                disabled={tenantRowsLoading}
              >
                {tenantRowsLoading ? (
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                ) : (
                  <MaterialIcon name="refresh" size="sm" className="mr-2" />
                )}
                Refresh Tenant Status
              </Button>
            </div>
            <CardDescription>
              Track which tenants are using platform sender vs custom sender, plus setup blockers and deliverability warnings.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="tenant_search">Search tenant</Label>
                <Input
                  id="tenant_search"
                  list="tenant-search-options"
                  value={tenantSearch}
                  onChange={(e) => setTenantSearch(e.target.value)}
                  placeholder="Name, slug, or email"
                />
                <datalist id="tenant-search-options">
                  {tenantSearchSuggestions.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              </div>

              <div className="space-y-2">
                <Label>Status filter</Label>
                <Select
                  value={tenantStatusFilter}
                  onValueChange={(value: EmailOpsStatus | "all") => setTenantStatusFilter(value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All statuses" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    {statusOptions.map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Sender type filter</Label>
                <Select
                  value={tenantSenderTypeFilter}
                  onValueChange={(value: EmailOpsSenderType | "all") => setTenantSenderTypeFilter(value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All sender types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sender types</SelectItem>
                    {senderTypeOptions.map((type) => (
                      <SelectItem key={type} value={type}>
                        {type}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => void loadTenantRows()}>
                <MaterialIcon name="search" size="sm" className="mr-2" />
                Apply Search
              </Button>
            </div>

            {tenantRowsError && (
              <Alert variant="destructive">
                <MaterialIcon name="error" size="sm" />
                <AlertDescription>{tenantRowsError}</AlertDescription>
              </Alert>
            )}

            <div className="overflow-x-auto rounded-md border">
              <table className="min-w-[980px] w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="p-2 text-left">
                      <button type="button" onClick={() => toggleTenantSort("tenant_name")} className="inline-flex items-center gap-1 font-medium">
                        Tenant
                        <MaterialIcon name={getTenantSortIcon("tenant_name")} size="sm" />
                      </button>
                    </th>
                    <th className="p-2 text-left">
                      <button type="button" onClick={() => toggleTenantSort("status")} className="inline-flex items-center gap-1 font-medium">
                        Status
                        <MaterialIcon name={getTenantSortIcon("status")} size="sm" />
                      </button>
                    </th>
                    <th className="p-2 text-left">
                      <button type="button" onClick={() => toggleTenantSort("sender_type")} className="inline-flex items-center gap-1 font-medium">
                        Sender Type
                        <MaterialIcon name={getTenantSortIcon("sender_type")} size="sm" />
                      </button>
                    </th>
                    <th className="p-2 text-left">Platform Sender Email</th>
                    <th className="p-2 text-left">Reply-To Effective</th>
                    <th className="p-2 text-left">Issues / Warnings</th>
                    <th className="p-2 text-left">
                      <button type="button" onClick={() => toggleTenantSort("updated_at")} className="inline-flex items-center gap-1 font-medium">
                        Updated
                        <MaterialIcon name={getTenantSortIcon("updated_at")} size="sm" />
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {tenantRowsLoading ? (
                    <tr>
                      <td className="p-3 text-muted-foreground" colSpan={7}>
                        <div className="flex items-center gap-2">
                          <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                          Loading tenant sender statuses…
                        </div>
                      </td>
                    </tr>
                  ) : filteredTenantRows.length === 0 ? (
                    <tr>
                      <td className="p-3 text-muted-foreground" colSpan={7}>
                        No tenants matched the current filters.
                      </td>
                    </tr>
                  ) : (
                    filteredTenantRows.map((row) => (
                      <tr key={row.tenant_id} className="border-t align-top">
                        <td className="p-2">
                          <div className="font-medium">{row.tenant_name || "Unnamed tenant"}</div>
                          <div className="text-xs text-muted-foreground">{row.tenant_slug}</div>
                        </td>
                        <td className="p-2">
                          <Badge
                            variant={statusVariant(row.status)}
                            className={
                              row.status === "Warning (deliverability risk)"
                                ? "border-yellow-400 text-yellow-700"
                                : undefined
                            }
                          >
                            {row.status}
                          </Badge>
                        </td>
                        <td className="p-2">
                          <Badge variant="outline">{row.sender_type}</Badge>
                        </td>
                        <td className="p-2 break-all">{row.platform_sender_email || "Not configured"}</td>
                        <td className="p-2 break-all">{row.reply_to_effective || "Missing"}</td>
                        <td className="p-2">
                          <div className="flex flex-wrap gap-1">
                            {row.issue_badges.map((issue) => (
                              <Badge key={`${row.tenant_id}-${issue}`} variant="destructive">
                                {issue}
                              </Badge>
                            ))}
                            {row.warning_badges.map((warning) => (
                              <Badge
                                key={`${row.tenant_id}-${warning}`}
                                variant="outline"
                                className="border-yellow-400 text-yellow-700"
                              >
                                {warning}
                              </Badge>
                            ))}
                            {row.issue_badges.length === 0 && row.warning_badges.length === 0 && (
                              <span className="text-xs text-muted-foreground">No blockers</span>
                            )}
                          </div>
                        </td>
                        <td className="p-2 text-xs text-muted-foreground">
                          {row.updated_at ? new Date(row.updated_at).toLocaleString() : "n/a"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <CardTitle className="flex items-center gap-2">
                <MaterialIcon name="history" size="md" />
                Cleanup Logs
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadCleanupLogs()}
                disabled={cleanupLogsLoading}
              >
                {cleanupLogsLoading ? (
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                ) : (
                  <MaterialIcon name="refresh" size="sm" className="mr-2" />
                )}
                Refresh Cleanup Logs
              </Button>
            </div>
            <CardDescription>
              Domain cleanup jobs are best-effort. Failures are shown by default to speed troubleshooting.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="text-sm font-medium">Show successful cleanup attempts</p>
                <p className="text-xs text-muted-foreground">
                  Off by default so the table focuses on failures/action items.
                </p>
              </div>
              <Switch
                checked={cleanupIncludeSuccesses}
                onCheckedChange={(checked) => {
                  setCleanupIncludeSuccesses(checked);
                  void loadCleanupLogs(checked);
                }}
              />
            </div>

            {cleanupLogsError && (
              <Alert variant="destructive">
                <MaterialIcon name="error" size="sm" />
                <AlertDescription>{cleanupLogsError}</AlertDescription>
              </Alert>
            )}

            <div className="overflow-x-auto rounded-md border">
              <table className="min-w-[980px] w-full text-sm">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="p-2 text-left">Attempted</th>
                    <th className="p-2 text-left">Client Account</th>
                    <th className="p-2 text-left">Domain</th>
                    <th className="p-2 text-left">Status</th>
                    <th className="p-2 text-left">Attempts</th>
                    <th className="p-2 text-left">Troubleshooting</th>
                  </tr>
                </thead>
                <tbody>
                  {cleanupLogsLoading ? (
                    <tr>
                      <td className="p-3 text-muted-foreground" colSpan={6}>
                        <div className="flex items-center gap-2">
                          <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                          Loading cleanup logs…
                        </div>
                      </td>
                    </tr>
                  ) : cleanupLogs.length === 0 ? (
                    <tr>
                      <td className="p-3 text-muted-foreground" colSpan={6}>
                        No cleanup log entries found.
                      </td>
                    </tr>
                  ) : (
                    cleanupLogs.map((row) => (
                      <tr key={row.id} className="border-t align-top">
                        <td className="p-2 text-xs">{row.attempted_at ? new Date(row.attempted_at).toLocaleString() : "n/a"}</td>
                        <td className="p-2">
                          <div className="font-medium">{row.client_account || row.tenant_id}</div>
                          <div className="text-xs text-muted-foreground">{row.tenant_id}</div>
                        </td>
                        <td className="p-2 break-all">
                          <div>{row.domain_name || "n/a"}</div>
                          {row.resend_domain_id && (
                            <div className="text-xs text-muted-foreground break-all">
                              Resend ID: {row.resend_domain_id}
                            </div>
                          )}
                        </td>
                        <td className="p-2">
                          <Badge variant={row.status === "succeeded" ? "default" : "destructive"}>
                            {row.status}
                          </Badge>
                        </td>
                        <td className="p-2">{row.attempts}</td>
                        <td className="p-2 text-xs text-muted-foreground space-y-1">
                          {row.error_message ? (
                            <p className="text-destructive break-words">{row.error_message}</p>
                          ) : (
                            <p>No error message.</p>
                          )}
                          {row.metadata && (
                            <pre className="max-w-[360px] overflow-auto rounded bg-muted p-2 text-[10px] leading-relaxed">
                              {JSON.stringify(row.metadata, null, 2)}
                            </pre>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="alternate_email" size="md" />
              Platform Default Sender
            </CardTitle>
            <CardDescription>
              Used when a tenant chooses “Use default sender” (no custom DNS setup).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                Loading platform email settings…
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                  <div>
                    <div className="text-sm font-medium">Enabled</div>
                    <div className="text-xs text-muted-foreground">
                      If disabled, Edge Functions fall back to their environment defaults.
                    </div>
                  </div>
                  <Switch checked={isActive} onCheckedChange={setIsActive} />
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <InfoLabel
                      label="Default From Email"
                      help="Platform-level sender address used when tenant-specific fallback sender cannot be generated."
                    />
                    <Input
                      id="platform_from_email"
                      type="email"
                      placeholder="noreply@yourdomain.com"
                      value={defaultFromEmail}
                      onChange={(e) => setDefaultFromEmail(e.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <InfoLabel
                      label="Platform Sender Domain"
                      help="This domain generates per-tenant sender addresses automatically, like tenant-name@stridewms.com."
                    />
                    <Input
                      id="platform_sender_domain"
                      placeholder="stridewms.com"
                      value={fallbackSenderDomain}
                      onChange={(e) => setFallbackSenderDomain(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Auto-generated tenant sender preview: <code>{platformSenderPreview}</code>
                    </p>
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <InfoLabel
                      label="Default Reply-To (optional)"
                      help="When tenant Reply-To is missing, replies can route to this inbox. Tenant admin email is used as final fallback."
                    />
                    <Input
                      id="platform_reply_to"
                      type="email"
                      placeholder="support@yourdomain.com"
                      value={defaultReplyToEmail}
                      onChange={(e) => setDefaultReplyToEmail(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Replies will go here for tenant emails that use the platform sender unless overridden.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Outbound Primary Provider</Label>
                    <Select
                      value={outboundPrimaryProvider}
                      onValueChange={(value: "resend" | "postmark") => setOutboundPrimaryProvider(value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select primary provider" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="resend">Resend</SelectItem>
                        <SelectItem value="postmark">Postmark</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Outbound Fallback Provider</Label>
                    <Select
                      value={outboundFallbackProvider}
                      onValueChange={(value: "none" | "resend" | "postmark") => setOutboundFallbackProvider(value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select fallback provider" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        <SelectItem value="resend">Resend</SelectItem>
                        <SelectItem value="postmark">Postmark</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground">
                  Migration tip: start with <strong>Resend primary + Postmark fallback</strong>, then switch to{" "}
                  <strong>Postmark primary + Resend fallback</strong>, then disable fallback after stability.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="platform_wrapper_html">Global Email Wrapper HTML (optional override)</Label>
                  <Textarea
                    id="platform_wrapper_html"
                    value={wrapperHtmlTemplate}
                    onChange={(e) => setWrapperHtmlTemplate(e.target.value)}
                    rows={12}
                    placeholder={"Leave blank to use Stride default wrapper.\n\nRequired placeholder: {{content}}\nOptional placeholders: {{heading}}, {{subject}}, {{accent_color}}, {{cta_section}}, {{test_banner}}, {{preheader}}"}
                    className="font-mono text-xs"
                  />
                  <p className="text-xs text-muted-foreground">
                    Super admin override for the HTML shell used by branded emails. Keep{" "}
                    <code className="px-1 rounded bg-muted">{"{{content}}"}</code> so message body can render.
                    Brand tokens like <code className="px-1 rounded bg-muted">[[tenant_name]]</code> and{" "}
                    <code className="px-1 rounded bg-muted">[[brand_logo_url]]</code> are supported.
                  </p>
                </div>

                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button variant="outline" onClick={refetch} disabled={saving}>
                    <MaterialIcon name="refresh" size="sm" className="mr-2" />
                    Refresh
                  </Button>
                  <Button onClick={handleSave} disabled={saving || !hasUnsavedChanges}>
                    {saving ? (
                      <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                    ) : (
                      <MaterialIcon name="save" size="sm" className="mr-2" />
                    )}
                    Save Sender
                  </Button>
                </div>

                {settings?.updated_at && (
                  <p className="text-xs text-muted-foreground">
                    Last updated: {new Date(settings.updated_at).toLocaleString()}
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="mark_email_read" size="md" />
              Inbound Reply Forwarding (Forward-only)
            </CardTitle>
            <CardDescription>
              Configure the platform replies domain so tenants can receive replies at{" "}
              <code className="px-1 rounded bg-muted">&lt;tenant_id&gt;@&lt;reply_domain&gt;</code> which then forwards to a tenant-configured inbox.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {inboundLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                Loading inbound settings…
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-4 rounded-md border p-3">
                  <div>
                    <div className="text-sm font-medium">Enabled</div>
                    <div className="text-xs text-muted-foreground">
                      When enabled, outgoing emails can set Reply-To to the tenant routing address.
                    </div>
                  </div>
                  <Switch checked={replyRoutingActive} onCheckedChange={setReplyRoutingActive} />
                </div>

                <div className="space-y-2">
                  <Label>Inbound provider</Label>
                  <Select
                    value={inboundProvider}
                    onValueChange={(value: "mailgun" | "postmark") => setInboundProvider(value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select inbound provider" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mailgun">Mailgun</SelectItem>
                      <SelectItem value="postmark">Postmark</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Choose Postmark to run inbound + outbound in one platform.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="reply_domain">Replies domain (subdomain)</Label>
                  <Input
                    id="reply_domain"
                    placeholder="replies.stridewms.com"
                    value={replyDomain}
                    onChange={(e) => setReplyDomain(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Configure MX + inbound webhook for this subdomain in the selected provider.
                  </p>
                </div>

                <div className="rounded-md border p-3 bg-muted/30 space-y-2">
                  <div className="text-sm font-medium">Inbound webhook URL</div>
                  <code className="text-xs break-all block">{webhookUrl}</code>
                  <p className="text-xs text-muted-foreground">
                    Configure your inbound provider to POST inbound emails here.
                    {inboundProvider === "mailgun" ? (
                      <>
                        {" "}Set <code className="px-1 rounded bg-muted">MAILGUN_WEBHOOK_SIGNING_KEY</code> in Supabase secrets.
                      </>
                    ) : (
                      <>
                        {" "}Required in production: set <code className="px-1 rounded bg-muted">POSTMARK_INBOUND_WEBHOOK_TOKEN</code> and pass it as
                        <code className="px-1 rounded bg-muted">x-postmark-webhook-token</code> (or append{" "}
                        <code className="px-1 rounded bg-muted">?token=...</code> to your webhook URL).
                      </>
                    )}
                  </p>
                </div>

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={refetchInbound} disabled={inboundSaving}>
                    <MaterialIcon name="refresh" size="sm" className="mr-2" />
                    Refresh
                  </Button>
                  <Button onClick={handleSaveReplyRouting} disabled={inboundSaving}>
                    {inboundSaving ? (
                      <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                    ) : (
                      <MaterialIcon name="save" size="sm" className="mr-2" />
                    )}
                    Save Reply Routing
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="science" size="md" />
              Test Send (Platform Sender)
            </CardTitle>
            <CardDescription>
              Sends via the <code>send-email</code> Edge Function with no tenant context (platform default sender).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="test_to_email">Send test email to</Label>
              <Input
                id="test_to_email"
                type="email"
                placeholder="you@company.com"
                value={testToEmail}
                onChange={(e) => setTestToEmail(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Send test using</Label>
              <Select
                value={testProviderOverride}
                onValueChange={(value: "auto" | "resend" | "postmark") => setTestProviderOverride(value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select provider mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (primary/fallback)</SelectItem>
                  <SelectItem value="resend">Force Resend</SelectItem>
                  <SelectItem value="postmark">Force Postmark</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleSendTest} disabled={sendingTest}>
                {sendingTest ? (
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                ) : (
                  <MaterialIcon name="send" size="sm" className="mr-2" />
                )}
                Send Test
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="flex items-center gap-2">
                <MaterialIcon name="monitoring" size="md" />
                Recent Email Send Logs (Provider Audit)
              </CardTitle>
              <Button variant="outline" size="sm" onClick={loadSendLogs} disabled={sendLogsLoading}>
                {sendLogsLoading ? (
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                ) : (
                  <MaterialIcon name="refresh" size="sm" className="mr-2" />
                )}
                Refresh Logs
              </Button>
            </div>
            <CardDescription>
              Shows recent alert sends and which provider actually delivered each message.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {sendLogsLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                Loading send logs…
              </div>
            )}

            {!sendLogsLoading && sendLogsError && (
              <Alert variant="destructive">
                <MaterialIcon name="error" size="sm" />
                <AlertDescription>{sendLogsError}</AlertDescription>
              </Alert>
            )}

            {!sendLogsLoading && !sendLogsError && sendLogs.length === 0 && (
              <p className="text-sm text-muted-foreground">No send logs found yet.</p>
            )}

            {!sendLogsLoading && !sendLogsError && sendLogs.length > 0 && (
              <div className="space-y-2">
                {sendLogs.map((log) => (
                  <div key={log.id} className="rounded-md border p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          log.status === "sent"
                            ? "default"
                            : log.status === "failed"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {log.status || "unknown"}
                      </Badge>
                      <Badge variant="outline">
                        Provider: {log.provider ? log.provider.toUpperCase() : "N/A"}
                      </Badge>
                      {log.fallback_used && <Badge variant="secondary">Fallback used</Badge>}
                      <span className="text-xs text-muted-foreground ml-auto">
                        {new Date(log.sent_at || log.created_at).toLocaleString()}
                      </span>
                    </div>

                    <p className="text-sm font-medium break-words">{log.subject || "(no subject)"}</p>

                    <div className="grid gap-1 text-xs text-muted-foreground md:grid-cols-2">
                      <p className="break-all">
                        <span className="font-medium text-foreground">Tenant:</span> {log.tenant_id || "n/a"}
                      </p>
                      <p className="break-all">
                        <span className="font-medium text-foreground">Provider message id:</span>{" "}
                        {log.provider_message_id || "n/a"}
                      </p>
                      <p className="break-all md:col-span-2">
                        <span className="font-medium text-foreground">Alert queue id:</span> {log.id}
                      </p>
                      {log.error_message && (
                        <p className="text-destructive break-words md:col-span-2">
                          <span className="font-medium">Error:</span> {log.error_message}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle className="flex items-center gap-2">
                <MaterialIcon name="mail_lock" size="md" />
                Recent Direct Email Logs (send-email/emailService)
              </CardTitle>
              <Button variant="outline" size="sm" onClick={loadDirectEmailLogs} disabled={directLogsLoading}>
                {directLogsLoading ? (
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                ) : (
                  <MaterialIcon name="refresh" size="sm" className="mr-2" />
                )}
                Refresh Direct Logs
              </Button>
            </div>
            <CardDescription>
              Shows recent direct email sends and provider routing details, including fallback usage.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {directLogsLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                Loading direct email logs…
              </div>
            )}

            {!directLogsLoading && directLogsError && (
              <Alert variant="destructive">
                <MaterialIcon name="error" size="sm" />
                <AlertDescription>{directLogsError}</AlertDescription>
              </Alert>
            )}

            {!directLogsLoading && !directLogsError && directEmailLogs.length === 0 && (
              <p className="text-sm text-muted-foreground">No direct email logs found yet.</p>
            )}

            {!directLogsLoading && !directLogsError && directEmailLogs.length > 0 && (
              <div className="space-y-2">
                {directEmailLogs.map((log) => (
                  <div key={log.id} className="rounded-md border p-3 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant={
                          log.status === "sent"
                            ? "default"
                            : log.status === "failed"
                              ? "destructive"
                              : "secondary"
                        }
                      >
                        {log.status || "unknown"}
                      </Badge>
                      <Badge variant="outline">
                        Provider: {log.provider ? log.provider.toUpperCase() : "N/A"}
                      </Badge>
                      {log.fallback_used && <Badge variant="secondary">Fallback used</Badge>}
                      <span className="text-xs text-muted-foreground ml-auto">
                        {new Date(log.sent_at || log.created_at || Date.now()).toLocaleString()}
                      </span>
                    </div>

                    <p className="text-sm font-medium break-words">{log.subject || "(no subject)"}</p>

                    <div className="grid gap-1 text-xs text-muted-foreground md:grid-cols-2">
                      <p className="break-all">
                        <span className="font-medium text-foreground">Type:</span> {log.email_type || "n/a"}
                      </p>
                      <p className="break-all">
                        <span className="font-medium text-foreground">Recipient:</span> {log.recipient_email || "n/a"}
                      </p>
                      <p className="break-all">
                        <span className="font-medium text-foreground">Tenant:</span> {log.tenant_id || "n/a"}
                      </p>
                      <p className="break-all">
                        <span className="font-medium text-foreground">Provider message id:</span>{" "}
                        {log.provider_message_id || "n/a"}
                      </p>
                      <p className="break-all md:col-span-2">
                        <span className="font-medium text-foreground">Email log id:</span> {log.id}
                      </p>
                      {log.error_message && (
                        <p className="text-destructive break-words md:col-span-2">
                          <span className="font-medium">Error:</span> {log.error_message}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

