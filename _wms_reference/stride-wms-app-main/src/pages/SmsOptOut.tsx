import { useState, useEffect } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";

interface TenantInfo {
  company_name: string | null;
  company_email: string | null;
  company_phone: string | null;
  logo_url: string | null;
  sms_help_message: string | null;
}

function getDefaultTenantInfo(): TenantInfo {
  return {
    company_name: "StrideWMS",
    company_email: "support@stridewms.com",
    company_phone: null,
    logo_url: null,
    sms_help_message: "For help, reply HELP or contact support@stridewms.com.",
  };
}

function normalizePhone(raw: string): string {
  const stripped = raw.replace(/[\s\-()]/g, "");
  if (stripped.startsWith("+")) return "+" + stripped.slice(1).replace(/\D/g, "");
  return "+" + stripped.replace(/\D/g, "");
}

function withTenantQuery(path: string, tenantId: string | null): string {
  if (!tenantId) return path;
  return `${path}?t=${encodeURIComponent(tenantId)}`;
}

export default function SmsOptOut() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { tenantId: tenantIdFromPath } = useParams<{ tenantId: string }>();
  const tenantIdFromUrl = tenantIdFromPath || searchParams.get("t");

  const [tenantInfo, setTenantInfo] = useState<TenantInfo | null>(null);
  const [resolvedTenantId, setResolvedTenantId] = useState<string | null>(tenantIdFromUrl);
  const [tenantHintInput, setTenantHintInput] = useState(tenantIdFromUrl || "");
  const [needsTenantContext, setNeedsTenantContext] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setTenantHintInput(tenantIdFromUrl || "");
  }, [tenantIdFromUrl]);

  useEffect(() => {
    const fetchTenantInfo = async () => {
      try {
        setResolvedTenantId(tenantIdFromUrl);
        setTenantInfo(null);
        setError(null);
        setNeedsTenantContext(false);
        setLoading(true);
        setSuccess(false);
        setSubmitError(null);

        const host = typeof window !== "undefined" ? window.location.hostname : undefined;
        const { data, error: fnError } = await supabase.functions.invoke("sms-opt-in", {
          body: {
            action: "get_tenant_info",
            tenant_id: tenantIdFromUrl,
            host,
          },
        });

        if (fnError) throw fnError;
        if (data?.requires_tenant_context) {
          setTenantInfo(getDefaultTenantInfo());
          setResolvedTenantId(null);
          setNeedsTenantContext(true);
          return;
        }
        if (data?.error) throw new Error(data.error);
        if (!data?.tenant_id || !data?.tenant) {
          setTenantInfo(getDefaultTenantInfo());
          setResolvedTenantId(null);
          setNeedsTenantContext(true);
          return;
        }

        setResolvedTenantId(data.tenant_id);
        setTenantInfo(data.tenant);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unable to load page.";
        if (/tenant context|organization not found|tenant/i.test(msg)) {
          setTenantInfo(getDefaultTenantInfo());
          setResolvedTenantId(null);
          setNeedsTenantContext(true);
          setError(null);
        } else {
          setError(msg);
        }
      } finally {
        setLoading(false);
      }
    };

    void fetchTenantInfo();
  }, [tenantIdFromUrl]);

  const handleSubmit = async () => {
    const tenantId = tenantIdFromUrl || resolvedTenantId;
    if (!phone.trim() || !confirmed) {
      return;
    }

    const normalizedPhone = normalizePhone(phone.trim());
    if (!/^\+\d{7,15}$/.test(normalizedPhone)) {
      setSubmitError("Please enter a valid phone number in international format.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("sms-opt-in", {
        body: {
          action: "opt_out",
          tenant_id: tenantId || null,
          phone_number: normalizedPhone,
          contact_name: name.trim() || null,
        },
      });

      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      setSuccess(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to submit. Please try again.";
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center gap-4">
              <MaterialIcon name="progress_activity" size="xl" className="animate-spin text-primary" />
              <p className="text-muted-foreground">Loading...</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !tenantInfo) {
    const handleTenantResolve = () => {
      const next = tenantHintInput.trim();
      if (!next) return;
      setSearchParams({ t: next });
    };

    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <MaterialIcon name="error" size="md" />
              Unable to Load
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">
              {error || "This opt-out page could not be loaded. Check your tenant subdomain or URL and try again."}
            </p>

            {needsTenantContext && (
              <div className="mt-4 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="tenant_hint">Tenant code</Label>
                  <Input
                    id="tenant_hint"
                    value={tenantHintInput}
                    onChange={(e) => setTenantHintInput(e.target.value)}
                    placeholder="e.g. acme-warehouse or tenant UUID"
                  />
                  <p className="text-xs text-muted-foreground">
                    This keeps the opt-out page public while attaching tenant context via URL.
                  </p>
                </div>
                <Button onClick={handleTenantResolve} disabled={!tenantHintInput.trim()}>
                  Reload Opt-Out Form
                </Button>
                <Button variant="outline" asChild>
                  <Link to="/sms">Back to SMS Info</Link>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const companyName = tenantInfo.company_name || "our company";
  const tenantContext = tenantIdFromUrl || resolvedTenantId;

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            {tenantInfo.logo_url && (
              <div className="flex justify-center mb-4">
                <img src={tenantInfo.logo_url} alt={companyName} className="h-12 object-contain" />
              </div>
            )}
            <div className="flex justify-center mb-4">
              <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                <MaterialIcon name="check_circle" size="xl" className="text-green-600" />
              </div>
            </div>
            <CardTitle>You're Unsubscribed</CardTitle>
            <CardDescription>
              Your number has been removed from SMS notifications for {companyName}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground space-y-2">
              <p>You will no longer receive SMS notifications from this sender.</p>
              <p>You can re-subscribe any time using the opt-in page below.</p>
            </div>
            <Button asChild className="w-full">
              <Link to={withTenantQuery("/sms/opt-in", tenantContext)}>
                <MaterialIcon name="sms" size="sm" className="mr-2" />
                Re-Subscribe (Opt In)
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          {tenantInfo.logo_url && (
            <div className="flex justify-center mb-4">
              <img src={tenantInfo.logo_url} alt={companyName} className="h-12 object-contain" />
            </div>
          )}
          <div className="flex justify-center mb-2">
            <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
              <MaterialIcon name="do_not_disturb_on" size="lg" className="text-primary" />
            </div>
          </div>
          <CardTitle>Opt Out of SMS Notifications</CardTitle>
          <CardDescription>Stop receiving SMS notifications from {companyName}</CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {needsTenantContext && (
            <Alert>
              <MaterialIcon name="info" size="sm" />
              <AlertDescription>
                Public phone-first mode: this form works without tenant context.
                {tenantHintInput ? " Tenant branding will be applied if resolvable." : ""}
              </AlertDescription>
            </Alert>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" asChild>
              <Link to={withTenantQuery("/sms/opt-in", tenantContext)}>Opt In</Link>
            </Button>
            <Button variant="default" disabled>
              Opt Out
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone">Phone Number</Label>
            <Input
              id="phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 (555) 123-4567"
              className="font-mono"
              type="tel"
            />
            <p className="text-xs text-muted-foreground">
              Enter the mobile number currently receiving messages.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="name">Name (optional)</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
            />
          </div>

          <div className="bg-muted/50 rounded-lg p-4 text-sm text-muted-foreground space-y-2">
            <p>
              Submitting this form removes your number from SMS notifications from {companyName}.
            </p>
            <p>
              You can also opt out any time by replying <strong>STOP</strong> to any message.
            </p>
            {tenantInfo.company_email && <p>Support: {tenantInfo.company_email}</p>}
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id="confirm"
              checked={confirmed}
              onCheckedChange={(checked) => setConfirmed(checked === true)}
              className="mt-0.5"
            />
            <label htmlFor="confirm" className="text-sm leading-snug cursor-pointer">
              I confirm that I want to stop receiving SMS notifications for this number.
            </label>
          </div>

          {submitError && (
            <Alert variant="destructive">
              <MaterialIcon name="error" size="sm" />
              <AlertDescription>{submitError}</AlertDescription>
            </Alert>
          )}

          <Button
            variant="destructive"
            className="w-full"
            onClick={handleSubmit}
            disabled={submitting || !phone.trim() || !confirmed}
          >
            {submitting ? (
              <>
                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                Submitting...
              </>
            ) : (
              <>
                <MaterialIcon name="block" size="sm" className="mr-2" />
                Unsubscribe from SMS
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
