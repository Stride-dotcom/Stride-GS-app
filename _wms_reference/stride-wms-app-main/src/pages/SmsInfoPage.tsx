import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, BellOff, BellRing, MessageSquare } from "lucide-react";
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { supabase } from "@/integrations/supabase/client";

const sections = [
  {
    title: 'Program Description',
    content:
      'StrideWMS sends SMS notifications on behalf of warehouse operators to their clients and contacts. Messages include shipment status updates (received, released, in-transit), inventory alerts, account notifications, task updates, and claim status changes.',
  },
  {
    title: 'Who Sends These Messages',
    content:
      'Messages are sent by StrideWMS, a warehouse management platform, on behalf of third-party logistics (3PL) warehouse operators who use our system to manage client communications.',
  },
  {
    title: 'Message Frequency',
    content:
      'Message frequency varies based on warehouse activity. You may receive messages when shipments are received or released, when inventory changes occur, or when action is required on your account. Typical users receive 1–10 messages per week.',
  },
  {
    title: 'Message & Data Rates',
    content:
      'Message and data rates may apply. Please contact your wireless carrier for details about your messaging plan.',
  },
  {
    title: 'How to Opt In',
    content:
      'You may opt in to receive SMS notifications through a web-based form provided by your warehouse operator. By providing your phone number and checking the consent box, you agree to receive text messages from StrideWMS on behalf of your warehouse provider. Consent to receive text messages is not a condition of any purchase or service.',
  },
  {
    title: 'How to Opt Out',
    content:
      'You can opt out at any time by replying STOP to any message you receive from us. After opting out, you will receive one final confirmation message and will no longer receive SMS notifications. You can also contact your warehouse operator directly to remove your number from their notification list.',
  },
  {
    title: 'How to Get Help',
    content:
      'For help, reply HELP to any message you receive, or contact your warehouse operator directly. You can also reach StrideWMS support at support@stridewms.com.',
  },
  {
    title: 'Privacy Policy',
    content:
      'We respect your privacy. Phone numbers collected for SMS notifications are used solely for the purpose of sending warehouse-related alerts. We do not sell, rent, or share your phone number with third parties for marketing purposes. For our full privacy policy, please visit our website or contact support.',
  },
  {
    title: 'Terms & Conditions',
    content:
      'By opting in to SMS notifications, you agree to receive automated text messages related to your warehouse account. These messages are transactional and operational in nature. Standard messaging rates apply. You may opt out at any time by replying STOP.',
  },
  {
    title: 'Carrier Disclaimer',
    content:
      'Carriers are not liable for delayed or undelivered messages. Message delivery is subject to your wireless carrier\'s network availability and coverage area.',
  },
  {
    title: 'Supported Carriers',
    content:
      'SMS notifications are supported on all major US carriers including AT&T, Verizon, T-Mobile, Sprint, and many regional carriers.',
  },
];

export default function SmsInfoPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tenantHint = searchParams.get("t") || searchParams.get("tenant");
  const [manualTenantHint, setManualTenantHint] = useState(tenantHint || "");
  const [resolvedTenantId, setResolvedTenantId] = useState<string | null>(tenantHint);
  const [resolvedTenantName, setResolvedTenantName] = useState<string | null>(null);
  const [resolvingTenant, setResolvingTenant] = useState(false);
  const [tenantResolveError, setTenantResolveError] = useState<string | null>(null);

  useEffect(() => {
    setManualTenantHint(tenantHint || "");
  }, [tenantHint]);

  useEffect(() => {
    let cancelled = false;

    const resolveTenant = async () => {
      setResolvingTenant(true);
      setTenantResolveError(null);

      try {
        const host =
          typeof window !== "undefined" ? window.location.hostname : undefined;
        const { data, error } = await supabase.functions.invoke("sms-opt-in", {
          body: {
            action: "get_tenant_info",
            tenant_id: tenantHint,
            host,
          },
        });

        if (cancelled) return;

        if (error) {
          setResolvedTenantId(tenantHint || null);
          setResolvedTenantName(null);
          setTenantResolveError(
            "Unable to verify tenant context for SMS links. Add ?t=<tenant-subdomain-or-id> to this URL."
          );
          return;
        }

        if (data?.tenant_id) {
          setResolvedTenantId(String(data.tenant_id));
          setResolvedTenantName(
            typeof data?.tenant?.company_name === "string"
              ? data.tenant.company_name
              : null
          );
          setTenantResolveError(null);
          return;
        }

        setResolvedTenantId(null);
        setResolvedTenantName(null);
        setTenantResolveError(typeof data?.error === "string" ? data.error : null);
      } catch {
        if (cancelled) return;
        setResolvedTenantId(tenantHint || null);
        setResolvedTenantName(null);
        setTenantResolveError(
          "Unable to verify tenant context. Enter your tenant code below to continue."
        );
      } finally {
        if (!cancelled) {
          setResolvingTenant(false);
        }
      }
    };

    void resolveTenant();

    return () => {
      cancelled = true;
    };
  }, [tenantHint]);

  const withTenantQuery = useMemo(() => {
    return (path: string): string =>
      resolvedTenantId ? `${path}?t=${encodeURIComponent(resolvedTenantId)}` : path;
  }, [resolvedTenantId]);

  const applyTenantHint = () => {
    const next = manualTenantHint.trim();
    if (!next) return;
    setSearchParams({ t: next });
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link to="/welcome">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-1 h-4 w-4" /> Back
            </Button>
          </Link>
          <span className="text-xl font-bold tracking-tight text-primary">StrideWMS</span>
          <Link to="/auth">
            <Button size="sm">Sign In</Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="py-16 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <MessageSquare className="h-12 w-12 text-primary mx-auto mb-4" />
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">
            SMS Notification Program
          </h1>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Information about our text message notification program, including how to opt in,
            opt out, and your rights as a message recipient.
          </p>
        </div>
      </section>

      <section className="pb-10 px-6">
        <div className="max-w-3xl mx-auto grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-border/60 bg-card p-6">
            <div className="flex items-center gap-2 mb-2">
              <BellRing className="h-5 w-5 text-primary" />
              <h2 className="font-semibold text-lg">Opt In to SMS</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Start receiving shipment, inventory, and account-related SMS updates.
            </p>
            <Button asChild className="w-full">
              <Link to={withTenantQuery("/sms/opt-in")}>
                Go to Opt-In Form
              </Link>
            </Button>
          </div>

          <div className="rounded-2xl border border-border/60 bg-card p-6">
            <div className="flex items-center gap-2 mb-2">
              <BellOff className="h-5 w-5 text-primary" />
              <h2 className="font-semibold text-lg">Opt Out of SMS</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              Stop receiving SMS updates for your phone number at any time.
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link to={withTenantQuery("/sms/opt-out")}>
                Go to Opt-Out Form
              </Link>
            </Button>
          </div>
        </div>

        <div className="max-w-3xl mx-auto mt-4 space-y-3">
          {resolvedTenantId && (
            <Alert>
              <MaterialIcon name="check_circle" size="sm" />
              <AlertDescription>
                SMS links are ready for{" "}
                <strong>{resolvedTenantName || "this tenant"}</strong>.
              </AlertDescription>
            </Alert>
          )}

          {!resolvedTenantId && (
            <>
              <Alert>
                <MaterialIcon name="info" size="sm" />
                <AlertDescription>
                  Public phone-first mode is active. You can still opt in/out without tenant context.
                  {tenantResolveError ? ` (${tenantResolveError})` : ""}
                </AlertDescription>
              </Alert>
              <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
                <Label htmlFor="tenant_hint">
                  Optional tenant code (for tenant-branded SMS pages)
                </Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="tenant_hint"
                    value={manualTenantHint}
                    onChange={(event) => setManualTenantHint(event.target.value)}
                    placeholder="e.g. acme-warehouse or tenant UUID"
                  />
                  <Button onClick={applyTenantHint} disabled={resolvingTenant || !manualTenantHint.trim()}>
                    {resolvingTenant ? "Resolving..." : "Use Tenant Branding"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Tenant context is optional here. If provided, the opt pages show tenant-specific branding/messages.
                </p>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Content */}
      <section className="pb-20 px-6">
        <div className="max-w-3xl mx-auto space-y-8">
          {sections.map((s) => (
            <div key={s.title} className="rounded-2xl border border-border/50 bg-card p-6">
              <h2 className="font-semibold text-lg mb-3">{s.title}</h2>
              <p className="text-sm text-muted-foreground leading-relaxed">{s.content}</p>
            </div>
          ))}

          {/* Quick Reference */}
          <div className="rounded-2xl border-2 border-primary/20 bg-primary/5 p-6">
            <h2 className="font-semibold text-lg mb-4">Quick Reference</h2>
            <div className="grid sm:grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-medium">To opt out:</span>
                <p className="text-muted-foreground">Reply <strong>STOP</strong> to any message</p>
              </div>
              <div>
                <span className="font-medium">To get help:</span>
                <p className="text-muted-foreground">Reply <strong>HELP</strong> to any message</p>
              </div>
              <div>
                <span className="font-medium">Support email:</span>
                <p className="text-muted-foreground">support@stridewms.com</p>
              </div>
              <div>
                <span className="font-medium">Message rates:</span>
                <p className="text-muted-foreground">Standard rates may apply</p>
              </div>
              <div>
                <span className="font-medium">Web opt-out form:</span>
                <p className="text-muted-foreground">
                  <Link to={withTenantQuery("/sms/opt-out")} className="text-primary underline">
                    /sms/opt-out
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border/50 py-8 px-6">
        <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-muted-foreground">
          <span>&copy; {new Date().getFullYear()} StrideWMS. All rights reserved.</span>
          <div className="flex gap-6">
            <Link to="/welcome" className="hover:text-foreground transition-colors">Home</Link>
            <Link to="/auth" className="hover:text-foreground transition-colors">Sign In</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
