import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { BackToDevConsoleButton } from "@/components/admin/BackToDevConsoleButton";
import { ServiceConnectionBadge, ConnectionStatus } from "@/components/admin/ServiceConnectionBadge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface SubscriptionSnapshot {
  found: boolean;
  tenant_id: string;
  status: string;
  is_active: boolean;
  is_in_grace: boolean;
  is_restricted: boolean;
  is_comped: boolean;
  comp_expires_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  last_payment_failed_at: string | null;
  grace_until: string | null;
  updated_at: string | null;
  plan_name: string | null;
  stripe_product_id: string | null;
  stripe_price_id_base: string | null;
  stripe_price_id_per_user: string | null;
}

interface TenantOption {
  tenant_id: string;
  tenant_name: string;
  company_name: string | null;
  company_email: string | null;
  app_subdomain: string | null;
  subscription_status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
}

interface StripeHealthCheck {
  ok: boolean;
  status: "connected" | "not_configured" | "error";
  account_id: string | null;
  mode: "live" | "test" | null;
  checks: Array<{
    id: string;
    label: string;
    status: "ok" | "warn";
    detail: string;
  }>;
  error?: string;
}

function getSupabaseProjectRef(): string | null {
  const baseUrl = String((supabase as any)?.supabaseUrl || "").trim();
  const match = baseUrl.match(/^https:\/\/([^.]+)\.supabase\.co/i);
  return match?.[1] || null;
}

function toNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "N/A";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString();
}

function InfoLabel({ label, help }: { label: string; help: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button" className="inline-flex" aria-label={`${label} help`}>
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

export default function StripeOps() {
  const { toast } = useToast();
  const [tenantOptions, setTenantOptions] = useState<TenantOption[]>([]);
  const [tenantSearch, setTenantSearch] = useState("");
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [loadingTenants, setLoadingTenants] = useState(true);
  const [tenantLoadError, setTenantLoadError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<SubscriptionSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [loadingSnapshot, setLoadingSnapshot] = useState(true);
  const [health, setHealth] = useState<StripeHealthCheck | null>(null);
  const [loadingHealth, setLoadingHealth] = useState(true);

  const projectRef = getSupabaseProjectRef();
  const supabaseFunctionsSettingsUrl = projectRef
    ? `https://supabase.com/dashboard/project/${projectRef}/settings/functions`
    : "https://supabase.com/dashboard";
  const supabaseFunctionsUrl = projectRef
    ? `https://supabase.com/dashboard/project/${projectRef}/functions`
    : "https://supabase.com/dashboard";
  const supabaseEdgeLogsUrl = projectRef
    ? `https://supabase.com/dashboard/project/${projectRef}/logs/edge-logs`
    : "https://supabase.com/dashboard";
  const stripeApiKeysUrl = "https://dashboard.stripe.com/apikeys";
  const stripeWebhooksUrl = "https://dashboard.stripe.com/webhooks";
  const stripeLogsUrl = "https://dashboard.stripe.com/logs";
  const stripeDashboardUrl = "https://dashboard.stripe.com";
  const stripeWebhookEndpointUrl = String((supabase as any)?.supabaseUrl || "").trim()
    ? `${String((supabase as any)?.supabaseUrl || "").trim()}/functions/v1/stripe-webhook`
    : "/functions/v1/stripe-webhook";

  const copyExternalLink = async (url: string, label: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast({
        title: `${label} link copied`,
        description: "Paste this link into a fresh browser tab (outside embedded app views) if direct open is blocked.",
      });
    } catch {
      toast({
        variant: "destructive",
        title: `Could not copy ${label} link`,
        description: url,
      });
    }
  };

  const openExternalLink = (url: string, label: string) => {
    const popup = window.open(url, "_blank", "noopener,noreferrer");
    if (!popup) {
      void copyExternalLink(url, label);
      toast({
        variant: "destructive",
        title: "Browser blocked opening a new tab",
        description: "Use the copy-link button and open it manually in a new browser tab.",
      });
    }
  };

  const fetchTenantOptions = async () => {
    setLoadingTenants(true);
    setTenantLoadError(null);
    try {
      const { data, error } = await (supabase as any).rpc("rpc_admin_list_tenant_billing_overrides", {
        p_filter: "all",
      });
      if (error) throw error;
      const rows = (Array.isArray(data) ? data : []) as Array<Record<string, unknown>>;
      const mapped: TenantOption[] = rows.map((row) => ({
        tenant_id: String(row.tenant_id || ""),
        tenant_name: String(row.tenant_name || "Unnamed tenant"),
        company_name: toNullableString(row.company_name),
        company_email: toNullableString(row.company_email),
        app_subdomain: toNullableString(row.app_subdomain),
        subscription_status: String(row.subscription_status || "none"),
        stripe_customer_id: toNullableString(row.stripe_customer_id),
        stripe_subscription_id: toNullableString(row.stripe_subscription_id),
      }));
      setTenantOptions(mapped);
      setSelectedTenantId((prev) => {
        if (prev && mapped.some((row) => row.tenant_id === prev)) return prev;
        return mapped[0]?.tenant_id ?? "";
      });
    } catch (error: any) {
      setTenantOptions([]);
      setSelectedTenantId("");
      const message = error?.message || "Failed to load tenants for Stripe Ops.";
      setTenantLoadError(message);
    } finally {
      setLoadingTenants(false);
    }
  };

  const fetchSnapshot = async (tenantId: string) => {
    if (!tenantId) {
      setSnapshot(null);
      setSnapshotError("Select a tenant to inspect Stripe subscription data.");
      setLoadingSnapshot(false);
      return;
    }

    setLoadingSnapshot(true);
    setSnapshotError(null);
    try {
      const { data, error } = await (supabase as any).rpc("rpc_admin_get_tenant_stripe_ops_snapshot", {
        p_tenant_id: tenantId,
      });
      if (error) throw error;
      const row = (data ?? {}) as Record<string, unknown>;
      const mapped: SubscriptionSnapshot = {
        found: row.found !== false,
        tenant_id: String(row.tenant_id || tenantId),
        status: String(row.status || "none"),
        is_active: row.is_active === true,
        is_in_grace: row.is_in_grace === true,
        is_restricted: row.is_restricted === true,
        is_comped: row.is_comped === true,
        comp_expires_at: toNullableString(row.comp_expires_at),
        stripe_customer_id: toNullableString(row.stripe_customer_id),
        stripe_subscription_id: toNullableString(row.stripe_subscription_id),
        current_period_end: toNullableString(row.current_period_end),
        cancel_at_period_end: row.cancel_at_period_end === true,
        last_payment_failed_at: toNullableString(row.last_payment_failed_at),
        grace_until: toNullableString(row.grace_until),
        updated_at: toNullableString(row.updated_at),
        plan_name: toNullableString(row.plan_name),
        stripe_product_id: toNullableString(row.stripe_product_id),
        stripe_price_id_base: toNullableString(row.stripe_price_id_base),
        stripe_price_id_per_user: toNullableString(row.stripe_price_id_per_user),
      };
      setSnapshot(mapped);
    } catch (error: any) {
      setSnapshot(null);
      const rawMessage = String(error?.message || "Failed to load tenant Stripe snapshot.");
      const rpcSetupIssue = /rpc_admin_get_tenant_stripe_ops_snapshot|does not exist|permission denied/i.test(
        rawMessage
      );
      const friendlyMessage = rpcSetupIssue
        ? "Could not load tenant Stripe snapshot. Deploy latest DB migrations, then refresh."
        : "Could not load tenant Stripe snapshot right now. Please try again.";
      setSnapshotError(`${friendlyMessage} (${rawMessage})`);
    } finally {
      setLoadingSnapshot(false);
    }
  };

  const runHealthCheck = async () => {
    setLoadingHealth(true);
    try {
      const { data, error } = await supabase.functions.invoke("stripe-ops-health-check", {
        body: {},
      });
      if (error) throw error;
      setHealth((data as StripeHealthCheck) ?? null);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setHealth({
        ok: false,
        status: "error",
        account_id: null,
        mode: null,
        checks: [
          {
            id: "health_check",
            label: "Stripe health check",
            status: "warn",
            detail:
              "Could not check Stripe right now. Confirm stripe-ops-health-check is deployed and your account has admin_dev access.",
          },
        ],
        error: message,
      });
    } finally {
      setLoadingHealth(false);
    }
  };

  useEffect(() => {
    void fetchTenantOptions();
    void runHealthCheck();
  }, []);

  useEffect(() => {
    if (!selectedTenantId) {
      setSnapshot(null);
      setSnapshotError(loadingTenants ? null : "Select a tenant to inspect Stripe subscription data.");
      setLoadingSnapshot(false);
      return;
    }
    void fetchSnapshot(selectedTenantId);
  }, [selectedTenantId, loadingTenants]);

  const filteredTenantOptions = useMemo(() => {
    const search = tenantSearch.trim().toLowerCase();
    if (!search) return tenantOptions;
    return tenantOptions.filter((row) => {
      return (
        row.tenant_name.toLowerCase().includes(search) ||
        String(row.company_name || "").toLowerCase().includes(search) ||
        String(row.company_email || "").toLowerCase().includes(search) ||
        String(row.app_subdomain || "").toLowerCase().includes(search) ||
        row.tenant_id.toLowerCase().includes(search)
      );
    });
  }, [tenantOptions, tenantSearch]);

  const selectedTenant = useMemo(() => {
    return tenantOptions.find((row) => row.tenant_id === selectedTenantId) ?? null;
  }, [tenantOptions, selectedTenantId]);

  const customerDashboardUrl = useMemo(() => {
    if (!snapshot?.stripe_customer_id) return null;
    return `https://dashboard.stripe.com/customers/${snapshot.stripe_customer_id}`;
  }, [snapshot?.stripe_customer_id]);

  const subscriptionDashboardUrl = useMemo(() => {
    if (!snapshot?.stripe_subscription_id) return null;
    return `https://dashboard.stripe.com/subscriptions/${snapshot.stripe_subscription_id}`;
  }, [snapshot?.stripe_subscription_id]);

  const stripeLinked = useMemo(() => {
    return Boolean(
      health?.status === "connected" &&
        snapshot?.stripe_customer_id &&
        snapshot?.stripe_subscription_id
    );
  }, [health?.status, snapshot?.stripe_customer_id, snapshot?.stripe_subscription_id]);

  const planMappingReady = useMemo(() => {
    return Boolean(
      snapshot?.stripe_product_id &&
        snapshot?.stripe_price_id_base &&
        snapshot?.stripe_price_id_per_user
    );
  }, [
    snapshot?.stripe_product_id,
    snapshot?.stripe_price_id_base,
    snapshot?.stripe_price_id_per_user,
  ]);

  const stripeConnectionStatus: ConnectionStatus = loadingHealth
    ? "checking"
    : health?.status === "connected"
      ? "connected"
      : health?.status === "not_configured"
        ? "not_configured"
        : "disconnected";

  const stripeConnectionLabel = loadingHealth
    ? undefined
    : health?.status === "connected"
      ? "Stripe Connected"
      : health?.status === "not_configured"
        ? "Not Configured"
        : "Stripe Disconnected";

  return (
    <DashboardLayout>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <PageHeader
          primaryText="Stripe"
          accentText="Ops"
          description="Guided, non-technical Stripe setup and link status verification."
        />
        <ServiceConnectionBadge
          status={stripeConnectionStatus}
          label={stripeConnectionLabel}
          detail={health?.mode ? `(${health.mode} mode)` : undefined}
          onRecheck={() => void runHealthCheck()}
          loading={loadingHealth}
        />
      </div>

      <div className="space-y-6">
        <div className="flex flex-wrap justify-between gap-2">
          <BackToDevConsoleButton />
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/pricing-ops">
                <MaterialIcon name="tune" size="sm" className="mr-2" />
                Pricing Ops
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/admin/email-ops">
                <MaterialIcon name="mail" size="sm" className="mr-2" />
                Email Ops
              </Link>
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Tenant to Inspect</CardTitle>
            <CardDescription>
              Choose a tenant first. Both sections below are read-only diagnostics for the selected tenant.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {tenantLoadError && (
              <Alert variant="destructive">
                <MaterialIcon name="error" size="sm" />
                <AlertDescription>{tenantLoadError}</AlertDescription>
              </Alert>
            )}

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="stripe_tenant_search">Search tenant</Label>
                <Input
                  id="stripe_tenant_search"
                  value={tenantSearch}
                  onChange={(event) => setTenantSearch(event.target.value)}
                  placeholder="Name, email, subdomain, or tenant ID"
                />
              </div>
              <div className="space-y-2">
                <Label>Actions</Label>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={() => void fetchTenantOptions()}
                  disabled={loadingTenants}
                >
                  {loadingTenants ? (
                    <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  ) : (
                    <MaterialIcon name="refresh" size="sm" className="mr-2" />
                  )}
                  Refresh tenants
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Selected tenant</Label>
              <Select
                value={selectedTenantId}
                onValueChange={(value) => {
                  setSelectedTenantId(value);
                  setSnapshotError(null);
                }}
                disabled={loadingTenants || filteredTenantOptions.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={loadingTenants ? "Loading tenants..." : "Select tenant"} />
                </SelectTrigger>
                <SelectContent>
                  {filteredTenantOptions.map((row) => (
                    <SelectItem key={row.tenant_id} value={row.tenant_id}>
                      {row.tenant_name}
                      {row.app_subdomain ? ` (${row.app_subdomain})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedTenant && (
              <div className="rounded-md border bg-muted/20 p-3 text-sm">
                <p>
                  <span className="font-medium">Tenant:</span> {selectedTenant.tenant_name}
                </p>
                <p>
                  <span className="font-medium">Tenant ID:</span> {selectedTenant.tenant_id}
                </p>
                <p>
                  <span className="font-medium">Company email:</span>{" "}
                  {selectedTenant.company_email || "N/A"}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Stripe Link Status</CardTitle>
            <CardDescription>
              Confirm connection health after setup. If all three are green, Stripe is linked correctly.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loadingHealth ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                Checking Stripe connection…
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Badge variant={health?.status === "connected" ? "default" : "secondary"}>
                  {health?.status === "connected" ? "API Connected" : "API Not Connected"}
                </Badge>
                <Badge variant={planMappingReady ? "default" : "secondary"}>
                  {planMappingReady ? "Plan Mapping Ready" : "Plan Mapping Incomplete"}
                </Badge>
                <Badge variant={stripeLinked ? "default" : "secondary"}>
                  {stripeLinked ? "Tenant Linked" : "Tenant Link Pending"}
                </Badge>
              </div>
            )}

            {health?.account_id && (
              <p className="text-sm">
                <span className="font-medium">Connected Stripe account:</span> {health.account_id}{" "}
                <span className="text-muted-foreground">({health.mode || "unknown"} mode)</span>
              </p>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => void runHealthCheck()} disabled={loadingHealth}>
                <MaterialIcon name="refresh" size="sm" className="mr-2" />
                Recheck Stripe Link
              </Button>
              <Button variant="outline" size="sm" onClick={() => openExternalLink(stripeDashboardUrl, "Stripe dashboard")}>
                Open Stripe Dashboard
              </Button>
              <Button variant="outline" size="sm" onClick={() => void copyExternalLink(stripeDashboardUrl, "Stripe dashboard")}>
                Copy Dashboard Link
              </Button>
            </div>

            <p className="text-xs text-muted-foreground">
              If Stripe opens to a blocked page in your environment, use the copy-link buttons and paste into a fresh browser tab.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Guided Setup (Step-by-step)</CardTitle>
            <CardDescription>
              Follow these in order. This page is read-only for diagnostics and never stores Stripe keys in app DB fields.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <MaterialIcon name="info" size="sm" />
              <AlertDescription>
                This page intentionally avoids key input fields for security. Secrets are managed in Supabase project settings.
              </AlertDescription>
            </Alert>

            <div className="space-y-3">
              <div className="rounded-md border p-3">
                <InfoLabel
                  label="Step 1: Add Stripe secrets in Supabase"
                  help="Use Stripe + Supabase dashboards together: copy secrets from Stripe, then set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in Supabase Function Secrets."
                />
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
                  <li>Open <strong>Stripe API Keys</strong>, choose test/live mode, and copy the secret key.</li>
                  <li>Open <strong>Supabase Function Secrets</strong> and set <code>STRIPE_SECRET_KEY</code>.</li>
                  <li>From Stripe Webhooks, copy the webhook signing secret and set <code>STRIPE_WEBHOOK_SECRET</code>.</li>
                  <li>Save secrets, then return here and click <strong>Recheck Stripe Link</strong>.</li>
                </ol>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => openExternalLink(stripeApiKeysUrl, "Stripe API keys")}>
                    Open Stripe API Keys
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void copyExternalLink(stripeApiKeysUrl, "Stripe API keys")}>
                    Copy API Keys Link
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openExternalLink(supabaseFunctionsSettingsUrl, "Supabase Function Secrets")}>
                    Open Supabase Function Secrets
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void copyExternalLink(supabaseFunctionsSettingsUrl, "Supabase Function Secrets")}>
                    Copy Secrets Link
                  </Button>
                </div>
              </div>

              <div className="rounded-md border p-3">
                <InfoLabel
                  label="Step 2: Configure Stripe webhook endpoint"
                  help="Webhook events keep tenant_subscriptions in sync. Configure the endpoint and required events in Stripe, then verify delivery in Stripe logs."
                />
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
                  <li>Open <strong>Stripe Webhooks</strong> and create (or update) an endpoint.</li>
                  <li>Set endpoint URL to: <code>{stripeWebhookEndpointUrl}</code>.</li>
                  <li>Subscribe to events: <code>customer.subscription.updated</code>, <code>customer.subscription.deleted</code>, <code>invoice.paid</code>, <code>invoice.payment_failed</code>.</li>
                  <li>Send a test event and confirm 2xx response from <code>stripe-webhook</code>.</li>
                </ol>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => openExternalLink(stripeWebhooksUrl, "Stripe Webhooks")}>
                    Open Stripe Webhooks
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void copyExternalLink(stripeWebhooksUrl, "Stripe Webhooks")}>
                    Copy Webhooks Link
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openExternalLink(supabaseFunctionsUrl, "Supabase Functions")}>
                    Open Supabase Functions
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void copyExternalLink(supabaseFunctionsUrl, "Supabase Functions")}>
                    Copy Functions Link
                  </Button>
                </div>
              </div>

              <div className="rounded-md border p-3">
                <InfoLabel
                  label="Step 3: Confirm app plan mapping + link status"
                  help="Use selected-tenant diagnostics below to confirm the app can both read Stripe IDs and evaluate access status for that tenant."
                />
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => selectedTenantId && void fetchSnapshot(selectedTenantId)}
                    disabled={loadingSnapshot || !selectedTenantId}
                  >
                    Refresh selected tenant snapshot
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void runHealthCheck()} disabled={loadingHealth}>
                    Refresh Stripe connection check
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => openExternalLink(supabaseEdgeLogsUrl, "Supabase Edge Logs")}>
                Open Supabase Edge Logs
              </Button>
              <Button variant="outline" size="sm" onClick={() => void copyExternalLink(supabaseEdgeLogsUrl, "Supabase Edge Logs")}>
                Copy Edge Logs Link
              </Button>
              <Button variant="outline" size="sm" onClick={() => openExternalLink(stripeLogsUrl, "Stripe Logs")}>
                Open Stripe Logs
              </Button>
              <Button variant="outline" size="sm" onClick={() => void copyExternalLink(stripeLogsUrl, "Stripe Logs")}>
                Copy Stripe Logs Link
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Subscription Access Status</CardTitle>
            <CardDescription>
              Read-only gate decision for the selected tenant (what the app uses to allow or restrict usage).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {snapshotError && (
              <Alert variant="destructive">
                <MaterialIcon name="error" size="sm" />
                <AlertDescription>{snapshotError}</AlertDescription>
              </Alert>
            )}

            {loadingSnapshot ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                Loading selected tenant status...
              </div>
            ) : !snapshot ? (
              <p className="text-muted-foreground">Select a tenant to view subscription access status.</p>
            ) : (
              <>
                <p>
                  <span className="font-medium">tenant:</span>{" "}
                  {selectedTenant?.tenant_name || snapshot.tenant_id}
                </p>
                <p>
                  <span className="font-medium">status:</span> {snapshot.status}
                </p>
                <p>
                  <span className="font-medium">is_active:</span> {String(snapshot.is_active)}
                </p>
                <p>
                  <span className="font-medium">is_in_grace:</span> {String(snapshot.is_in_grace)}
                </p>
                <p>
                  <span className="font-medium">is_restricted:</span> {String(snapshot.is_restricted)}
                </p>
                <p>
                  <span className="font-medium">is_comped:</span> {String(snapshot.is_comped)}
                </p>
                <p>
                  <span className="font-medium">comp_expires_at:</span>{" "}
                  {formatDateTime(snapshot.comp_expires_at)}
                </p>
              </>
            )}

            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => selectedTenantId && void fetchSnapshot(selectedTenantId)}
                disabled={loadingSnapshot || !selectedTenantId}
              >
                Refresh selected tenant status
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Tenant subscription snapshot</CardTitle>
            <CardDescription>
              Raw Stripe-related fields from tenant_subscriptions for the selected tenant (read-only).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {snapshotError && (
              <Alert variant="destructive">
                <MaterialIcon name="error" size="sm" />
                <AlertDescription>{snapshotError}</AlertDescription>
              </Alert>
            )}

            {loadingSnapshot ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                Loading subscription snapshot...
              </div>
            ) : !snapshot ? (
              <p className="text-muted-foreground">
                Select a tenant to inspect subscription snapshot details.
              </p>
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <span className="font-medium">Status:</span>
                  <Badge variant="secondary">{snapshot.status}</Badge>
                </div>
                <p>
                  <span className="font-medium">Tenant:</span>{" "}
                  {selectedTenant?.tenant_name || snapshot.tenant_id}
                </p>
                <p>
                  <span className="font-medium">Plan:</span> {snapshot.plan_name ?? "N/A"}
                </p>
                <p>
                  <span className="font-medium">Tenant ID:</span> {snapshot.tenant_id}
                </p>
                <p>
                  <span className="font-medium">Stripe customer:</span> {snapshot.stripe_customer_id ?? "N/A"}
                </p>
                <p>
                  <span className="font-medium">Stripe subscription:</span>{" "}
                  {snapshot.stripe_subscription_id ?? "N/A"}
                </p>
                <p>
                  <span className="font-medium">Stripe product id:</span>{" "}
                  {snapshot.stripe_product_id ?? "N/A"}
                </p>
                <p>
                  <span className="font-medium">Stripe base price id:</span>{" "}
                  {snapshot.stripe_price_id_base ?? "N/A"}
                </p>
                <p>
                  <span className="font-medium">Stripe per-user price id:</span>{" "}
                  {snapshot.stripe_price_id_per_user ?? "N/A"}
                </p>
                <p>
                  <span className="font-medium">Current period end:</span>{" "}
                  {formatDateTime(snapshot.current_period_end)}
                </p>
                <p>
                  <span className="font-medium">Grace until:</span> {formatDateTime(snapshot.grace_until)}
                </p>
                <p>
                  <span className="font-medium">Cancel at period end:</span>{" "}
                  {String(snapshot.cancel_at_period_end === true)}
                </p>
                <p>
                  <span className="font-medium">Last payment failed at:</span>{" "}
                  {formatDateTime(snapshot.last_payment_failed_at)}
                </p>
                <p>
                  <span className="font-medium">Updated:</span> {formatDateTime(snapshot.updated_at)}
                </p>
              </>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => selectedTenantId && void fetchSnapshot(selectedTenantId)}
                disabled={loadingSnapshot || !selectedTenantId}
              >
                Refresh selected tenant snapshot
              </Button>
              {customerDashboardUrl ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => openExternalLink(customerDashboardUrl, "Stripe customer")}>
                    Open Stripe customer
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => void copyExternalLink(customerDashboardUrl, "Stripe customer")}>
                    Copy customer link
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  Open Stripe customer
                </Button>
              )}
              {subscriptionDashboardUrl ? (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openExternalLink(subscriptionDashboardUrl, "Stripe subscription")}
                  >
                    Open Stripe subscription
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void copyExternalLink(subscriptionDashboardUrl, "Stripe subscription")}
                  >
                    Copy subscription link
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" disabled>
                  Open Stripe subscription
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
}

