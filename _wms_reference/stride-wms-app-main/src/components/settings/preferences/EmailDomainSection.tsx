import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { MaterialIcon } from "@/components/ui/MaterialIcon";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface DnsRecord {
  name: string;
  type: string;
  value: string;
  record?: string;
  status?: string;
  priority?: number;
}

const AI_DNS_HELP_PROMPT = `You are my DNS setup assistant for enabling branded email sending in a SaaS app.

Goal:
- I want app emails to send from my company email address (for example: alerts@mycompany.com).
- The app uses Resend for sending.
- I need simple, non-technical step-by-step instructions for my exact provider.

Please guide me with this workflow:
1) Ask me these questions one at a time:
   - What is my full "From" email address?
   - Who is my domain registrar / DNS host (GoDaddy, Cloudflare, Namecheap, Google, Squarespace, etc.)?
   - Do I have access to DNS records for this domain?
   - Which records does the app currently show me to add (TXT/CNAME/MX, host/name, value, priority)?
2) After I answer, provide:
   - Exact click-by-click instructions for my provider UI
   - Exactly what to paste into each DNS field
   - Warnings about common mistakes (wrong host, proxied records, missing priority, duplicate SPF)
   - Expected propagation timing
3) Then give me a "verification checklist" I can follow inside the app.
4) Keep language simple (middle-school level), avoid jargon, and explain any technical term in one sentence.
5) If anything is unclear, ask follow-up questions before giving final instructions.

When I paste DNS records, validate them and tell me if anything looks wrong before I save them.`;

function isValidEmail(value: string): boolean {
  const trimmed = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function toNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeDnsRecords(value: unknown): DnsRecord[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const row = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : null;
      if (!row) return null;
      const name = toNonEmptyString(row.name);
      const type = toNonEmptyString(row.type);
      const valueText = toNonEmptyString(row.value);
      if (!name || !type || !valueText) return null;
      return {
        name,
        type,
        value: valueText,
        record: toNonEmptyString(row.record) || undefined,
        status: toNonEmptyString(row.status) || undefined,
        priority: typeof row.priority === "number" ? row.priority : undefined,
      } satisfies DnsRecord;
    })
    .filter((row) => Boolean(row));
}

function extractDomainFromEmail(email: string): string | null {
  if (!isValidEmail(email)) return null;
  const domain = email.split("@")[1]?.trim().toLowerCase();
  return domain || null;
}

function InfoLabel({ htmlFor, label, help }: { htmlFor?: string; label: string; help: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
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

export function EmailDomainSection() {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const [useCustomSender, setUseCustomSender] = useState(false);
  const [customFromEmail, setCustomFromEmail] = useState("");
  const [replyToEmail, setReplyToEmail] = useState("");
  const [customEmailDomain, setCustomEmailDomain] = useState<string | null>(null);
  const [resendDomainId, setResendDomainId] = useState<string | null>(null);
  const [dnsRecords, setDnsRecords] = useState<DnsRecord[]>([]);
  const [emailDomainVerified, setEmailDomainVerified] = useState(false);
  const [dkimVerified, setDkimVerified] = useState(false);
  const [spfVerified, setSpfVerified] = useState(false);
  const [dmarcStatus, setDmarcStatus] = useState<string>("missing");

  const [platformSenderEmail, setPlatformSenderEmail] = useState<string | null>(null);
  const [fallbackSenderDomain, setFallbackSenderDomain] = useState<string | null>(null);
  const [tenantSlug, setTenantSlug] = useState<string | null>(null);

  const [disableConfirmOpen, setDisableConfirmOpen] = useState(false);

  const fetchState = useCallback(async () => {
    if (!profile?.tenant_id) return;
    setLoading(true);
    try {
      const [{ data: brandRow, error: brandError }, { data: defaultsData, error: defaultsError }] = await Promise.all([
        (supabase as any)
          .from("communication_brand_settings")
          .select(
            "use_default_email, from_email, custom_email_domain, reply_to_email, resend_domain_id, resend_dns_records, email_domain_verified, dkim_verified, spf_verified, dmarc_status"
          )
          .eq("tenant_id", profile.tenant_id)
          .maybeSingle(),
        (supabase as any).rpc("rpc_get_my_email_sender_defaults"),
      ]);

      if (brandError) throw brandError;
      if (defaultsError) throw defaultsError;

      const brand = brandRow && typeof brandRow === "object" ? (brandRow as Record<string, unknown>) : null;
      const senderDefaults =
        defaultsData && typeof defaultsData === "object"
          ? (defaultsData as Record<string, unknown>)
          : null;

      const fromEmail = toNonEmptyString(brand?.from_email) || "";
      const domainFromEmail = extractDomainFromEmail(fromEmail);

      setUseCustomSender(brand?.use_default_email === false);
      setCustomFromEmail(fromEmail);
      setReplyToEmail(toNonEmptyString(brand?.reply_to_email) || "");
      setCustomEmailDomain(toNonEmptyString(brand?.custom_email_domain) || domainFromEmail);
      setResendDomainId(toNonEmptyString(brand?.resend_domain_id));
      setDnsRecords(normalizeDnsRecords(brand?.resend_dns_records));
      setEmailDomainVerified(Boolean(brand?.email_domain_verified));
      setDkimVerified(Boolean(brand?.dkim_verified));
      setSpfVerified(Boolean(brand?.spf_verified));
      setDmarcStatus(toNonEmptyString(brand?.dmarc_status) || "missing");

      setPlatformSenderEmail(toNonEmptyString(senderDefaults?.platform_sender_email));
      setFallbackSenderDomain(toNonEmptyString(senderDefaults?.fallback_sender_domain));
      setTenantSlug(toNonEmptyString(senderDefaults?.tenant_slug));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to load email sender settings.";
      toast({
        variant: "destructive",
        title: "Failed to load email settings",
        description: message,
      });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, toast]);

  useEffect(() => {
    void fetchState();
  }, [fetchState]);

  const customWarnings = useMemo(() => {
    if (!useCustomSender) return [] as string[];
    const warnings: string[] = [];
    if (!dkimVerified) warnings.push("DKIM not verified");
    if (!spfVerified) warnings.push("SPF not verified");
    if (dmarcStatus === "missing") warnings.push("DMARC missing");
    if (dmarcStatus === "monitoring") warnings.push("DMARC monitoring only (p=none)");
    return warnings;
  }, [useCustomSender, dkimVerified, spfVerified, dmarcStatus]);

  const customIssues = useMemo(() => {
    if (!useCustomSender) return [] as string[];
    const issues: string[] = [];
    if (!isValidEmail(customFromEmail)) issues.push("Enter a valid From email address.");
    if (!emailDomainVerified) issues.push("Custom domain still needs DNS verification.");
    if (replyToEmail.trim() && !isValidEmail(replyToEmail)) {
      issues.push("Reply-To inbox is invalid.");
    }
    return issues;
  }, [useCustomSender, customFromEmail, emailDomainVerified, replyToEmail]);

  const hasExistingCustomConfig = useMemo(
    () =>
      Boolean(customFromEmail.trim()) ||
      Boolean(customEmailDomain) ||
      Boolean(resendDomainId) ||
      dnsRecords.length > 0 ||
      emailDomainVerified,
    [customFromEmail, customEmailDomain, resendDomainId, dnsRecords.length, emailDomainVerified]
  );

  const saveBaseSettings = useCallback(
    async (clearCustom: boolean) => {
      if (!profile?.tenant_id) return;
      const normalizedReplyTo = toNonEmptyString(replyToEmail);
      if (normalizedReplyTo && !isValidEmail(normalizedReplyTo)) {
        throw new Error("Please provide a valid Reply-To / inbound inbox.");
      }

      const normalizedFrom = toNonEmptyString(customFromEmail)?.toLowerCase() || null;
      const normalizedDomain = extractDomainFromEmail(normalizedFrom || "");

      if (!clearCustom && !normalizedFrom) {
        throw new Error("Please provide a valid From email address.");
      }

      const payload: Record<string, unknown> = {
        tenant_id: profile.tenant_id,
        use_default_email: clearCustom ? true : false,
        reply_to_email: normalizedReplyTo,
      };

      if (clearCustom) {
        payload.from_email = null;
        payload.custom_email_domain = null;
        payload.resend_domain_id = null;
        payload.resend_dns_records = null;
        payload.email_domain_verified = false;
        payload.dkim_verified = false;
        payload.spf_verified = false;
        payload.dmarc_status = "missing";
      } else {
        payload.from_email = normalizedFrom;
        payload.custom_email_domain = normalizedDomain;
      }

      const { error } = await (supabase as any)
        .from("communication_brand_settings")
        .upsert(payload, { onConflict: "tenant_id" });

      if (error) throw error;
    },
    [profile?.tenant_id, replyToEmail, customFromEmail]
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveBaseSettings(!useCustomSender);
      toast({
        title: "Email sender settings saved",
        description: useCustomSender
          ? "Custom sender settings were saved."
          : "Platform sender mode is active for your tenant.",
      });
      await fetchState();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to save email sender settings.";
      toast({
        variant: "destructive",
        title: "Save failed",
        description: message,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleToggleCustomSender = (nextChecked: boolean) => {
    if (nextChecked) {
      setUseCustomSender(true);
      return;
    }
    if (hasExistingCustomConfig) {
      setDisableConfirmOpen(true);
      return;
    }
    setUseCustomSender(false);
  };

  const handleConfirmDisableCustomSender = async () => {
    const previousDomain = customEmailDomain || extractDomainFromEmail(customFromEmail);
    const previousDomainId = resendDomainId;

    setDisableConfirmOpen(false);
    setSaving(true);
    try {
      await saveBaseSettings(true);
      setUseCustomSender(false);
      setCustomFromEmail("");
      setCustomEmailDomain(null);
      setResendDomainId(null);
      setDnsRecords([]);
      setEmailDomainVerified(false);
      setDkimVerified(false);
      setSpfVerified(false);
      setDmarcStatus("missing");

      toast({
        title: "Switched to platform sender",
        description: "Custom sender fields were cleared and platform mode is now active.",
      });

      if (previousDomainId || previousDomain) {
        try {
          const { data, error } = await (supabase as any).rpc("rpc_request_my_email_domain_cleanup", {
            p_resend_domain_id: previousDomainId || null,
            p_domain_name: previousDomain || null,
          });
          if (error) throw error;
          if (!data?.queued) {
            toast({
              variant: "destructive",
              title: "Cleanup queue warning",
              description:
                "Switched to platform sender, but cleanup was not queued automatically. Admin can review cleanup logs.",
            });
          }
        } catch {
          toast({
            variant: "destructive",
            title: "Cleanup queue warning",
            description:
              "Switched to platform sender, but domain cleanup queueing failed. This does not block sending.",
          });
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to switch to platform sender.";
      toast({
        variant: "destructive",
        title: "Switch failed",
        description: message,
      });
    } finally {
      setSaving(false);
      await fetchState();
    }
  };

  const handleRegisterDomain = async () => {
    const domain = extractDomainFromEmail(customFromEmail);
    if (!domain) {
      toast({
        variant: "destructive",
        title: "From email required",
        description: "Enter a valid From email (for example: alerts@yourcompany.com).",
      });
      return;
    }

    setRegistering(true);
    try {
      await saveBaseSettings(false);
      const { data, error } = await supabase.functions.invoke("register-email-domain", {
        body: { domain },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Domain registration failed.");

      setCustomEmailDomain(domain);
      setResendDomainId(toNonEmptyString(data.domain_id));
      setDnsRecords(normalizeDnsRecords(data.records));
      setEmailDomainVerified(data.status === "verified");
      toast({
        title: data.status === "verified" ? "Domain already verified" : "Domain registered",
        description:
          data.status === "verified"
            ? "Your custom sender is already verified and ready."
            : "Add the DNS records below, then click Verify DNS.",
      });
      await fetchState();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to register your domain.";
      toast({
        variant: "destructive",
        title: "Domain registration failed",
        description: message,
      });
    } finally {
      setRegistering(false);
    }
  };

  const handleVerifyDomain = async () => {
    if (!resendDomainId) {
      toast({
        variant: "destructive",
        title: "Register domain first",
        description: "Register your domain first so DNS records can be verified.",
      });
      return;
    }
    setVerifying(true);
    try {
      const { data, error } = await supabase.functions.invoke("verify-email-domain", {
        body: {},
      });
      if (error) throw error;
      if (data?.records) {
        setDnsRecords(normalizeDnsRecords(data.records));
      }
      setEmailDomainVerified(Boolean(data?.verified));
      setDkimVerified(Boolean(data?.dkim_verified));
      setSpfVerified(Boolean(data?.spf_verified));

      toast({
        title: data?.verified ? "Domain verified" : "Verification pending",
        description: data?.verified
          ? "Your custom sender is now active."
          : "DNS may still be propagating. Try again in a few minutes.",
      });
      await fetchState();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to verify DNS records.";
      toast({
        variant: "destructive",
        title: "Verification failed",
        description: message,
      });
    } finally {
      setVerifying(false);
    }
  };

  const handleCopyAiPrompt = async () => {
    try {
      await navigator.clipboard.writeText(AI_DNS_HELP_PROMPT);
      toast({ title: "Prompt copied", description: "Paste it into ChatGPT to get guided DNS help." });
    } catch {
      toast({
        variant: "destructive",
        title: "Copy failed",
        description: "Please copy the prompt text manually.",
      });
    }
  };

  const senderStatusLabel = useMemo(() => {
    if (!useCustomSender) return "Platform sender active";
    if (emailDomainVerified) return "Custom sender verified";
    return "Custom sender pending DNS";
  }, [useCustomSender, emailDomainVerified]);

  if (loading) {
    return (
      <Card>
        <CardContent className="flex h-32 items-center justify-center">
          <MaterialIcon name="progress_activity" size="md" className="animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MaterialIcon name="mail" size="md" />
          Email Sender Setup
          <Badge variant="outline" className="ml-1">
            {senderStatusLabel}
          </Badge>
        </CardTitle>
        <CardDescription>
          One-page setup for outgoing sender + Reply-To inbox. If you do not use a custom sender, app emails are sent from the platform sender and replies route to your Reply-To inbox.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-md border p-4 space-y-3">
          <div className="flex items-start gap-3">
            <Checkbox
              id="custom-sender-toggle"
              checked={useCustomSender}
              onCheckedChange={(checked) => handleToggleCustomSender(checked === true)}
              disabled={saving}
            />
            <div className="space-y-1">
              <Label htmlFor="custom-sender-toggle" className="text-sm font-medium">
                Send emails from my company domain
              </Label>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button type="button" className="inline-flex ml-1 align-middle" aria-label="Custom sender help">
                      <MaterialIcon name="info" size="sm" className="text-muted-foreground" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-left">
                    <p className="text-xs leading-relaxed">
                      Turn this on if you want customers to see your company email as the sender. You will need to add DNS records to verify your domain.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <p className="text-xs text-muted-foreground">
                Turn on to use your own From email (requires DNS setup). Turn off to use platform sender mode.
              </p>
            </div>
          </div>
        </div>

        {!useCustomSender && (
          <Alert>
            <MaterialIcon name="info" size="sm" />
            <AlertDescription>
              Outbound emails will be sent from{" "}
              <strong>{platformSenderEmail || "platform sender (not configured yet)"}</strong>.
              {tenantSlug && fallbackSenderDomain ? (
                <>
                  {" "}
                  This is generated as <code>{`${tenantSlug}@${fallbackSenderDomain}`}</code>.
                </>
              ) : null}{" "}
              Set a Reply-To inbox below so customers can reply.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <InfoLabel
              htmlFor="reply-to-email"
              label="Reply-To / inbound email"
              help="Where customer replies should go. If this is blank, Stride falls back to your tenant admin login email when possible."
            />
            <Input
              id="reply-to-email"
              type="email"
              value={replyToEmail}
              onChange={(e) => setReplyToEmail(e.target.value)}
              placeholder="support@yourcompany.com"
            />
          </div>

          <div className="space-y-2">
            <InfoLabel
              htmlFor="platform-preview"
              label="Platform sender preview"
              help="This is the sender used whenever custom domain mode is off."
            />
            <Input id="platform-preview" value={platformSenderEmail || "Not configured"} readOnly />
          </div>
        </div>

        {useCustomSender && (
          <div className="space-y-5 rounded-md border p-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <InfoLabel
                  htmlFor="custom-from-email"
                  label="From email address"
                  help="Enter the full sender address you want customers to see (for example: alerts@yourcompany.com)."
                />
                <Input
                  id="custom-from-email"
                  type="email"
                  value={customFromEmail}
                  onChange={(e) => {
                    setCustomFromEmail(e.target.value);
                    setCustomEmailDomain(extractDomainFromEmail(e.target.value));
                  }}
                  placeholder="alerts@yourcompany.com"
                />
              </div>

              <div className="space-y-2">
                <InfoLabel
                  htmlFor="custom-domain"
                  label="Detected domain"
                  help="Domain extracted from your From email. This is the domain that will be registered and verified."
                />
                <Input id="custom-domain" value={customEmailDomain || "Enter From email first"} readOnly />
              </div>
            </div>

            <div className="flex flex-wrap gap-2 justify-end">
              <Button variant="outline" onClick={() => void fetchState()} disabled={saving || registering || verifying}>
                <MaterialIcon name="refresh" size="sm" className="mr-2" />
                Refresh
              </Button>
              <Button
                variant="outline"
                onClick={() => void handleRegisterDomain()}
                disabled={registering || saving || !isValidEmail(customFromEmail)}
              >
                {registering ? (
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                ) : (
                  <MaterialIcon name="dns" size="sm" className="mr-2" />
                )}
                Register domain
              </Button>
              <Button onClick={() => void handleVerifyDomain()} disabled={verifying || !resendDomainId}>
                {verifying ? (
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                ) : (
                  <MaterialIcon name="verified_user" size="sm" className="mr-2" />
                )}
                Verify DNS
              </Button>
            </div>

            {customIssues.length > 0 && (
              <Alert className="border-red-200 bg-red-50">
                <MaterialIcon name="error" size="sm" className="text-red-700" />
                <AlertDescription className="text-red-800">
                  <ul className="list-disc pl-4 space-y-1">
                    {customIssues.map((issue) => (
                      <li key={issue}>{issue}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {customWarnings.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {customWarnings.map((warning) => (
                  <Badge key={warning} variant="secondary" className="bg-amber-100 text-amber-800">
                    {warning}
                  </Badge>
                ))}
              </div>
            )}

            <div className="space-y-3">
              <div className="text-sm font-medium">DNS records to add</div>
              {dnsRecords.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Register domain to load DNS records.
                </p>
              ) : (
                <div className="space-y-2">
                  {dnsRecords.map((record, index) => (
                    <div key={`${record.name}-${record.type}-${index}`} className="rounded-md border p-3 text-xs space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{record.record || record.type}</Badge>
                        {record.status ? (
                          <Badge variant={record.status === "verified" ? "default" : "secondary"}>
                            {record.status}
                          </Badge>
                        ) : null}
                      </div>
                      <div>
                        <span className="font-medium">Name:</span> <code>{record.name}</code>
                      </div>
                      <div>
                        <span className="font-medium">Value:</span> <code className="break-all">{record.value}</code>
                      </div>
                      {typeof record.priority === "number" ? (
                        <div>
                          <span className="font-medium">Priority:</span> {record.priority}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <InfoLabel
                htmlFor="ai-dns-help"
                label="AI DNS setup helper prompt"
                help="Copy this prompt into ChatGPT. It will ask follow-up questions and provide provider-specific DNS steps."
              />
              <Textarea id="ai-dns-help" value={AI_DNS_HELP_PROMPT} readOnly rows={10} className="font-mono text-xs" />
              <div className="flex justify-end">
                <Button variant="outline" onClick={() => void handleCopyAiPrompt()}>
                  <MaterialIcon name="content_copy" size="sm" className="mr-2" />
                  Copy prompt
                </Button>
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => void fetchState()} disabled={saving || registering || verifying}>
            <MaterialIcon name="refresh" size="sm" className="mr-2" />
            Reload
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || registering || verifying}>
            {saving ? (
              <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
            ) : (
              <MaterialIcon name="save" size="sm" className="mr-2" />
            )}
            Save email setup
          </Button>
        </div>
      </CardContent>

      <AlertDialog open={disableConfirmOpen} onOpenChange={setDisableConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to platform sender?</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear your custom sender settings and move your tenant to platform sender mode immediately.
              We will also queue custom-domain cleanup for the nightly cleanup worker.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleConfirmDisableCustomSender()}>
              Switch and clear custom fields
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

