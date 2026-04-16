import { useState, useEffect, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { TenantCompanySettings } from '@/hooks/useTenantSettings';

interface TwilioSmsCardProps {
  settings: TenantCompanySettings | null;
  tenantId: string;
  onUpdate: (updates: Partial<TenantCompanySettings>) => Promise<boolean>;
}

/** Normalize phone to E.164: strip everything except digits and leading + */
function normalizePhone(raw: string): string {
  const stripped = raw.replace(/[\s\-()]/g, '');
  if (stripped.startsWith('+')) return '+' + stripped.slice(1).replace(/\D/g, '');
  return '+' + stripped.replace(/\D/g, '');
}

function validateAccountSid(sid: string): string | null {
  if (!sid) return null; // blank is ok when sms_enabled is false
  if (!sid.startsWith('AC')) return 'Must start with "AC"';
  if (sid.length !== 34) return 'Must be 34 characters (AC + 32 hex chars)';
  return null;
}

function validateMessagingServiceSid(sid: string): string | null {
  if (!sid) return null;
  if (!sid.startsWith('MG')) return 'Must start with "MG"';
  return null;
}

function validateE164(phone: string): string | null {
  if (!phone) return null;
  const cleaned = normalizePhone(phone);
  if (!/^\+\d{7,15}$/.test(cleaned)) return 'Must be E.164 format: +1XXXXXXXXXX';
  return null;
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withProtocol.replace(/\/+$/, '');
}

function isHttpsUrl(raw: string): boolean {
  if (!raw.trim()) return false;
  try {
    const parsed = new URL(normalizeUrl(raw));
    return parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function TwilioSmsCard({ settings, tenantId, onUpdate }: TwilioSmsCardProps) {
  const { toast } = useToast();

  // --- Local form state ---
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [accountSid, setAccountSid] = useState('');
  const [messagingServiceSid, setMessagingServiceSid] = useState('');
  const [fromPhone, setFromPhone] = useState('');
  const [senderName, setSenderName] = useState('');
  const [saving, setSaving] = useState(false);

  // --- Toll-free verification fields ---
  const [optInMessage, setOptInMessage] = useState('');
  const [helpMessage, setHelpMessage] = useState('');
  const [stopMessage, setStopMessage] = useState('');
  const [optInKeywords, setOptInKeywords] = useState('');
  const [privacyPolicyUrl, setPrivacyPolicyUrl] = useState('');
  const [termsConditionsUrl, setTermsConditionsUrl] = useState('');
  const [useCaseDescription, setUseCaseDescription] = useState('');
  const [sampleMessage, setSampleMessage] = useState('');
  const [estimatedMonthlyVolume, setEstimatedMonthlyVolume] = useState('');
  const [optInType, setOptInType] = useState('');
  const [useCaseCategories, setUseCaseCategories] = useState('');
  const [notificationEmail, setNotificationEmail] = useState('');
  const [proofOfConsentUrl, setProofOfConsentUrl] = useState('');
  const [additionalInfo, setAdditionalInfo] = useState('');
  const [verificationSaving, setVerificationSaving] = useState(false);
  const [verificationOpen, setVerificationOpen] = useState(false);

  // --- Test SMS state ---
  const [testPhone, setTestPhone] = useState('');
  const [testSending, setTestSending] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // --- Validation errors ---
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  const generatedOptInUrl = useMemo(() => {
    if (!tenantId) return '';
    const configuredBase = settings?.app_base_url ? normalizeUrl(settings.app_base_url) : '';
    const fallbackBase = typeof window !== 'undefined' ? normalizeUrl(window.location.origin) : '';
    const baseUrl = configuredBase || fallbackBase;
    return baseUrl ? `${baseUrl}/sms/opt-in?t=${encodeURIComponent(tenantId)}` : '';
  }, [settings?.app_base_url, tenantId]);

  const effectiveProofOfConsentUrl = proofOfConsentUrl.trim() || generatedOptInUrl;

  const readinessItems = useMemo(
    () => [
      { id: 'proof', label: 'Public opt-in workflow URL (HTTPS)', ready: isHttpsUrl(effectiveProofOfConsentUrl) },
      { id: 'privacy', label: 'Privacy policy URL (HTTPS)', ready: isHttpsUrl(privacyPolicyUrl) },
      { id: 'terms', label: 'Terms & conditions URL (HTTPS)', ready: isHttpsUrl(termsConditionsUrl) },
      { id: 'opt-in', label: 'Opt-in confirmation message', ready: Boolean(optInMessage.trim()) },
      { id: 'help', label: 'HELP response message', ready: Boolean(helpMessage.trim()) },
      { id: 'stop', label: 'STOP response message', ready: Boolean(stopMessage.trim()) },
      { id: 'sample', label: 'Sample outbound message', ready: Boolean(sampleMessage.trim()) },
      { id: 'use-case', label: 'Use case description', ready: Boolean(useCaseDescription.trim()) },
    ],
    [
      effectiveProofOfConsentUrl,
      privacyPolicyUrl,
      termsConditionsUrl,
      optInMessage,
      helpMessage,
      stopMessage,
      sampleMessage,
      useCaseDescription,
    ]
  );
  const readyCount = readinessItems.filter((item) => item.ready).length;
  const checklistComplete = readyCount === readinessItems.length;

  // Load from settings
  useEffect(() => {
    if (!settings) return;
    setSmsEnabled(settings.sms_enabled ?? false);
    setAccountSid(settings.twilio_account_sid || '');
    setMessagingServiceSid(settings.twilio_messaging_service_sid || '');
    setFromPhone(settings.twilio_from_phone || '');
    setSenderName(settings.sms_sender_name || '');
    // Toll-free verification fields
    setOptInMessage(settings.sms_opt_in_message || '');
    setHelpMessage(settings.sms_help_message || '');
    setStopMessage(settings.sms_stop_message || '');
    setOptInKeywords(settings.sms_opt_in_keywords || '');
    setPrivacyPolicyUrl(settings.sms_privacy_policy_url || '');
    setTermsConditionsUrl(settings.sms_terms_conditions_url || '');
    setUseCaseDescription(settings.sms_use_case_description || '');
    setSampleMessage(settings.sms_sample_message || '');
    setEstimatedMonthlyVolume(settings.sms_estimated_monthly_volume || '');
    setOptInType(settings.sms_opt_in_type || '');
    setUseCaseCategories(settings.sms_use_case_categories || '');
    setNotificationEmail(settings.sms_notification_email || '');
    setProofOfConsentUrl(settings.sms_proof_of_consent_url || '');
    setAdditionalInfo(settings.sms_additional_info || '');
  }, [settings]);

  // --- Validate on change ---
  const validate = (enabledOverride?: boolean): boolean => {
    const enabled = enabledOverride ?? smsEnabled;
    const errs: Record<string, string | null> = {};

    errs.accountSid = validateAccountSid(accountSid);
    errs.messagingServiceSid = validateMessagingServiceSid(messagingServiceSid);
    errs.fromPhone = validateE164(fromPhone);

    // When enabling, require Account SID + (Messaging Service SID OR From Phone)
    if (enabled) {
      if (!accountSid) errs.accountSid = 'Required when SMS is enabled';
      if (!messagingServiceSid && !fromPhone) {
        errs.messagingServiceSid = 'Provide Messaging Service SID or From Phone Number';
      }
    }

    setErrors(errs);
    return !Object.values(errs).some(Boolean);
  };

  const handleSave = async () => {
    if (!validate()) return;

    setSaving(true);
    try {
      const success = await onUpdate({
        sms_enabled: smsEnabled,
        twilio_account_sid: accountSid || null,
        twilio_messaging_service_sid: messagingServiceSid || null,
        twilio_from_phone: fromPhone ? normalizePhone(fromPhone) : null,
        sms_sender_name: senderName || null,
      });

      if (success) {
        toast({
          title: 'SMS Settings Saved',
          description: 'Twilio configuration has been updated.',
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleTestSms = async () => {
    const phoneErr = validateE164(testPhone);
    if (!testPhone || phoneErr) {
      setTestResult({ ok: false, message: phoneErr || 'Enter a phone number' });
      return;
    }

    setTestSending(true);
    setTestResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('send-sms-test', {
        body: { tenant_id: tenantId, to_phone: normalizePhone(testPhone) },
      });

      if (error) {
        setTestResult({ ok: false, message: error.message || 'Function invocation failed' });
        return;
      }

      if (data?.success) {
        setTestResult({ ok: true, message: `Test SMS sent (SID: ${data.sid || 'ok'})` });
      } else {
        setTestResult({ ok: false, message: data?.error || 'Unknown error from function' });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unexpected error';
      setTestResult({ ok: false, message: msg });
    } finally {
      setTestSending(false);
    }
  };

  const handleCopy = async (text: string, label: string) => {
    if (!text) {
      toast({ variant: 'destructive', title: 'Nothing to copy', description: `${label} is empty.` });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: 'Copied', description: `${label} copied to clipboard.` });
    } catch {
      toast({ variant: 'destructive', title: 'Copy Failed', description: 'Could not copy to clipboard.' });
    }
  };

  const handleSaveVerification = async () => {
    const missingRequired: string[] = [];
    if (!isHttpsUrl(effectiveProofOfConsentUrl)) missingRequired.push('Public opt-in workflow URL');
    if (!isHttpsUrl(privacyPolicyUrl)) missingRequired.push('Privacy policy URL');
    if (!isHttpsUrl(termsConditionsUrl)) missingRequired.push('Terms & conditions URL');
    if (!optInMessage.trim()) missingRequired.push('Opt-in confirmation message');
    if (!helpMessage.trim()) missingRequired.push('Help message');
    if (!stopMessage.trim()) missingRequired.push('Stop message');
    if (!useCaseDescription.trim()) missingRequired.push('Use case description');
    if (!sampleMessage.trim()) missingRequired.push('Sample message');

    if (missingRequired.length > 0) {
      toast({
        variant: 'destructive',
        title: 'Missing Twilio verification fields',
        description: `Complete: ${missingRequired.slice(0, 3).join(', ')}${missingRequired.length > 3 ? ', ...' : ''}`,
      });
      return;
    }

    setVerificationSaving(true);
    try {
      const success = await onUpdate({
        sms_opt_in_message: optInMessage || null,
        sms_help_message: helpMessage || null,
        sms_stop_message: stopMessage || null,
        sms_opt_in_keywords: optInKeywords || null,
        sms_privacy_policy_url: privacyPolicyUrl ? normalizeUrl(privacyPolicyUrl) : null,
        sms_terms_conditions_url: termsConditionsUrl ? normalizeUrl(termsConditionsUrl) : null,
        sms_use_case_description: useCaseDescription || null,
        sms_sample_message: sampleMessage || null,
        sms_estimated_monthly_volume: estimatedMonthlyVolume || null,
        sms_opt_in_type: optInType || null,
        sms_use_case_categories: useCaseCategories || null,
        sms_notification_email: notificationEmail || null,
        sms_proof_of_consent_url: normalizeUrl(effectiveProofOfConsentUrl),
        sms_additional_info: additionalInfo || null,
      });

      if (success) {
        if (!proofOfConsentUrl.trim() && effectiveProofOfConsentUrl) {
          setProofOfConsentUrl(normalizeUrl(effectiveProofOfConsentUrl));
        }
        toast({
          title: 'Verification Settings Saved',
          description: 'Toll-free verification fields have been updated.',
        });
      }
    } finally {
      setVerificationSaving(false);
    }
  };

  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MaterialIcon name="sms" size="md" />
          SMS Sender Configuration (Twilio)
        </CardTitle>
        <CardDescription>
          Configure SMS so alerts can be sent to phone numbers via Twilio.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Setup Instructions */}
        <Alert className="bg-muted/50 border-muted-foreground/20">
          <MaterialIcon name="info" size="sm" />
          <AlertDescription className="text-sm space-y-1">
            <p className="font-medium mb-1.5">Setup steps:</p>
            <ol className="list-decimal list-inside space-y-0.5 text-muted-foreground">
              <li>Create or log in to your <span className="font-medium text-foreground">Twilio</span> account</li>
              <li>Create a <span className="font-medium text-foreground">Messaging Service</span> (recommended) or buy a phone number</li>
              <li>Copy your <span className="font-medium text-foreground">Account SID</span> and paste it below</li>
              <li>Add <code className="text-xs bg-muted px-1 py-0.5 rounded">TWILIO_AUTH_TOKEN</code> as a <span className="font-medium text-foreground">Supabase secret</span> (never paste it here)</li>
              <li>Paste your <span className="font-medium text-foreground">Messaging Service SID</span> or <span className="font-medium text-foreground">From Phone Number</span></li>
              <li>Copy the <span className="font-medium text-foreground">Public Opt-In URL</span> into Twilio&apos;s proof-of-consent field</li>
              <li>Save, then use <span className="font-medium text-foreground">Send Test SMS</span> to verify</li>
            </ol>
          </AlertDescription>
        </Alert>

        <Separator />

        {/* Public Opt-In URL */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">Public Opt-In URL (for Twilio verification)</Label>
          <div className="flex flex-col sm:flex-row gap-2">
            <Input
              value={generatedOptInUrl}
              readOnly
              placeholder="Set Company Info > Portal URL to generate your public opt-in URL"
              className="font-mono text-xs"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => handleCopy(generatedOptInUrl, 'Public Opt-In URL')}
              disabled={!generatedOptInUrl}
              title="Copy Public Opt-In URL"
            >
              <MaterialIcon name="content_copy" size="sm" />
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => window.open(generatedOptInUrl, '_blank', 'noopener,noreferrer')}
              disabled={!generatedOptInUrl}
            >
              <MaterialIcon name="open_in_new" size="sm" className="mr-2" />
              Open
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => setProofOfConsentUrl(generatedOptInUrl)}
              disabled={!generatedOptInUrl}
            >
              Use as Proof of Consent URL
            </Button>
            {!settings?.app_base_url && (
              <p className="text-xs text-muted-foreground">
                Tip: set Company Info &gt; Portal URL to ensure this uses your production domain.
              </p>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            This route is public and is intentionally accessible without login for Twilio verification reviewers.
          </p>
        </div>

        <Separator />

        {/* Enable toggle */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">Enable SMS Sending</Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Turn on to allow alert templates to deliver via SMS
            </p>
          </div>
          <Switch
            checked={smsEnabled}
            onCheckedChange={(checked) => {
              setSmsEnabled(checked);
              if (checked) validate(true);
            }}
          />
        </div>

        <Separator />

        {/* Account SID */}
        <div className="space-y-1.5">
          <Label htmlFor="twilio-sid" className="text-sm">
            Twilio Account SID
          </Label>
          <Input
            id="twilio-sid"
            value={accountSid}
            onChange={(e) => setAccountSid(e.target.value.trim())}
            placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            className="font-mono text-sm"
          />
          {errors.accountSid && (
            <p className="text-xs text-destructive">{errors.accountSid}</p>
          )}
        </div>

        {/* Messaging Service SID */}
        <div className="space-y-1.5">
          <Label htmlFor="twilio-msg-sid" className="text-sm">
            Messaging Service SID
            <span className="text-xs text-muted-foreground ml-1">(preferred)</span>
          </Label>
          <Input
            id="twilio-msg-sid"
            value={messagingServiceSid}
            onChange={(e) => setMessagingServiceSid(e.target.value.trim())}
            placeholder="MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            className="font-mono text-sm"
          />
          {errors.messagingServiceSid && (
            <p className="text-xs text-destructive">{errors.messagingServiceSid}</p>
          )}
        </div>

        {/* From Phone */}
        <div className="space-y-1.5">
          <Label htmlFor="twilio-phone" className="text-sm">
            From Phone Number
            <span className="text-xs text-muted-foreground ml-1">(fallback if no Messaging Service)</span>
          </Label>
          <Input
            id="twilio-phone"
            value={fromPhone}
            onChange={(e) => setFromPhone(e.target.value)}
            placeholder="+12065551234"
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Use E.164 format. Example: +1XXXXXXXXXX
          </p>
          {errors.fromPhone && (
            <p className="text-xs text-destructive">{errors.fromPhone}</p>
          )}
        </div>

        {/* Sender name */}
        <div className="space-y-1.5">
          <Label htmlFor="sms-sender-name" className="text-sm">
            Sender Name
            <span className="text-xs text-muted-foreground ml-1">(optional, UI label only)</span>
          </Label>
          <Input
            id="sms-sender-name"
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            placeholder="Stride Logistics"
          />
        </div>

        {/* Save */}
        <div className="flex justify-end">
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <MaterialIcon name="save" size="sm" className="mr-2" />
                Save SMS Settings
              </>
            )}
          </Button>
        </div>

        <Separator />

        {/* Test SMS */}
        <div className="space-y-3">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <MaterialIcon name="send" size="sm" />
            Send Test SMS
          </h4>

          <div className="flex items-end gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="test-phone" className="text-xs text-muted-foreground">
                Test recipient phone (E.164)
              </Label>
              <Input
                id="test-phone"
                value={testPhone}
                onChange={(e) => setTestPhone(e.target.value)}
                placeholder="+12065559999"
                className="font-mono text-sm"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleTestSms}
              disabled={testSending || !testPhone}
            >
              {testSending ? (
                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
              ) : (
                <MaterialIcon name="send" size="sm" className="mr-2" />
              )}
              Send Test SMS
            </Button>
          </div>

          {testResult && (
            <p className={`text-xs ${testResult.ok ? 'text-green-600' : 'text-destructive'}`}>
              {testResult.message}
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            SMS will not send until <code className="bg-muted px-1 py-0.5 rounded">TWILIO_AUTH_TOKEN</code> is
            configured in Supabase secrets and the <code className="bg-muted px-1 py-0.5 rounded">send-sms-test</code> function is deployed.
          </p>
        </div>

        <Separator />

        {/* Toll-Free Verification Helper */}
        <Collapsible open={verificationOpen} onOpenChange={setVerificationOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between px-0 hover:bg-transparent">
              <div className="flex items-center gap-2">
                <MaterialIcon name="verified" size="md" className="text-blue-600" />
                <div className="text-left">
                  <h4 className="text-sm font-medium">Toll-Free Verification Settings</h4>
                  <p className="text-xs text-muted-foreground font-normal">
                    Configure and copy values for Twilio toll-free number verification
                  </p>
                </div>
              </div>
              <MaterialIcon
                name={verificationOpen ? 'expand_less' : 'expand_more'}
                size="sm"
                className="text-muted-foreground"
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-6 pt-4">
            <Alert className="bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900">
              <MaterialIcon name="info" size="sm" className="text-blue-600" />
              <AlertDescription className="text-sm text-blue-800 dark:text-blue-200">
                Fill in these fields, save, then use the copy buttons to paste each value into Twilio&apos;s
                toll-free verification form. This makes it easy to keep your verification info in one place.
              </AlertDescription>
            </Alert>

            <div className="border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h5 className="text-sm font-medium flex items-center gap-2">
                  <MaterialIcon name="checklist" size="sm" />
                  Twilio Verification Readiness
                </h5>
                <Badge variant={checklistComplete ? 'default' : 'secondary'}>
                  {readyCount}/{readinessItems.length} complete
                </Badge>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {readinessItems.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 text-xs">
                    <MaterialIcon
                      name={item.ready ? 'check_circle' : 'radio_button_unchecked'}
                      size="sm"
                      className={item.ready ? 'text-green-600' : 'text-muted-foreground'}
                    />
                    <span className={item.ready ? 'text-foreground' : 'text-muted-foreground'}>
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Section: Messaging Use Case */}
            <div className="space-y-4">
              <h5 className="text-sm font-medium flex items-center gap-2">
                <MaterialIcon name="chat" size="sm" />
                Messaging Use Case
              </h5>

              {/* Estimated Monthly Volume */}
              <CopyableField
                label="Estimated Monthly Volume"
                value={estimatedMonthlyVolume}
                onChange={setEstimatedMonthlyVolume}
                onCopy={handleCopy}
                placeholder="e.g. 1,000"
                hint="How many SMS messages you expect to send per month"
              />

              {/* Opt-In Type */}
              <CopyableField
                label="Opt-In Type"
                value={optInType}
                onChange={setOptInType}
                onCopy={handleCopy}
                placeholder="e.g. Via Text"
                hint="How recipients opt in: Via Text, Web Form, Verbal, etc."
              />

              {/* Use Case Categories */}
              <CopyableField
                label="Use Case Categories"
                value={useCaseCategories}
                onChange={setUseCaseCategories}
                onCopy={handleCopy}
                placeholder="e.g. Delivery Notifications, Account Notifications, Customer Care"
                hint="Comma-separated list of messaging categories"
              />

              {/* Proof of Consent URL */}
              <CopyableField
                label="Proof of Consent (Opt-In) URL"
                value={proofOfConsentUrl}
                onChange={setProofOfConsentUrl}
                onCopy={handleCopy}
                placeholder="https://yoursite.com/sms-opt-in"
                type="url"
                hint={
                  generatedOptInUrl
                    ? `Use your generated app URL: ${generatedOptInUrl}`
                    : 'URL where you collect SMS opt-in consent from recipients'
                }
              />

              {/* Use Case Description */}
              <CopyableTextarea
                label="Use Case Description"
                value={useCaseDescription}
                onChange={setUseCaseDescription}
                onCopy={handleCopy}
                placeholder="e.g. We send SMS notifications to warehouse clients about shipment arrivals, inventory updates, and order status changes."
                hint="Describe how and why you send SMS messages"
              />

              {/* Sample Message */}
              <CopyableTextarea
                label="Sample Message"
                value={sampleMessage}
                onChange={setSampleMessage}
                onCopy={handleCopy}
                placeholder="e.g. [Stride Logistics] Your shipment #12345 has arrived at our warehouse and is being processed. Reply STOP to opt out."
                hint="An example of a typical SMS you would send"
              />

              {/* Notification Email */}
              <CopyableField
                label="E-mail for Notifications"
                value={notificationEmail}
                onChange={setNotificationEmail}
                onCopy={handleCopy}
                placeholder="e.g. email@yourcompany.com"
                hint="Email to receive Twilio verification status updates"
              />

              {/* Additional Information */}
              <CopyableTextarea
                label="Additional Information"
                value={additionalInfo}
                onChange={setAdditionalInfo}
                onCopy={handleCopy}
                placeholder="Any additional context about your SMS program..."
                hint="Optional extra details for the Twilio verification team"
              />
            </div>

            <Separator />

            {/* Section: Compliance Messages */}
            <div className="space-y-4">
              <h5 className="text-sm font-medium flex items-center gap-2">
                <MaterialIcon name="shield" size="sm" />
                Compliance Messages
              </h5>

              {/* Opt-In Confirmation */}
              <CopyableTextarea
                label="Opt-In Confirmation Message"
                value={optInMessage}
                onChange={setOptInMessage}
                onCopy={handleCopy}
                placeholder="e.g. You've opted in to SMS alerts from [Company]. Msg frequency varies. Msg & data rates may apply. Reply HELP for help, STOP to cancel."
                hint="Sent to recipients when they opt in to SMS notifications"
                badge="Required"
              />

              {/* Help Message */}
              <CopyableTextarea
                label="Help Message Sample"
                value={helpMessage}
                onChange={setHelpMessage}
                onCopy={handleCopy}
                placeholder="e.g. [Company] SMS Alerts: For help, contact support@yourcompany.com or call (555) 123-4567. Msg & data rates may apply. Reply STOP to opt out."
                hint="Sent when a recipient texts HELP"
                badge="Required"
              />

              {/* Stop Message */}
              <CopyableTextarea
                label="Stop/Opt-Out Confirmation Message"
                value={stopMessage}
                onChange={setStopMessage}
                onCopy={handleCopy}
                placeholder="e.g. You've been unsubscribed from [Company] SMS alerts. You will no longer receive messages. Reply START to re-subscribe."
                hint="Sent when a recipient texts STOP"
                badge="Required"
              />

              {/* Opt-In Keywords */}
              <CopyableField
                label="Opt-In Keywords"
                value={optInKeywords}
                onChange={setOptInKeywords}
                onCopy={handleCopy}
                placeholder="YES, OK, ACCEPT, APPROVE"
                hint="Comma-separated keywords that trigger opt-in"
              />
            </div>

            <Separator />

            {/* Section: Legal Links */}
            <div className="space-y-4">
              <h5 className="text-sm font-medium flex items-center gap-2">
                <MaterialIcon name="gavel" size="sm" />
                Legal Links
              </h5>

              {/* Privacy Policy URL */}
              <CopyableField
                label="Privacy Policy URL"
                value={privacyPolicyUrl}
                onChange={setPrivacyPolicyUrl}
                onCopy={handleCopy}
                placeholder="https://yoursite.com/privacy"
                type="url"
                hint="URL to your company's privacy policy"
                badge="Required"
              />

              {/* Terms & Conditions URL */}
              <CopyableField
                label="Terms & Conditions URL"
                value={termsConditionsUrl}
                onChange={setTermsConditionsUrl}
                onCopy={handleCopy}
                placeholder="https://yoursite.com/terms"
                type="url"
                hint="URL to your company's terms and conditions"
                badge="Required"
              />
            </div>

            {/* Save Verification Settings */}
            <div className="flex justify-end pt-2">
              <Button type="button" onClick={handleSaveVerification} disabled={verificationSaving}>
                {verificationSaving ? (
                  <>
                    <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <MaterialIcon name="save" size="sm" className="mr-2" />
                    Save Verification Settings
                  </>
                )}
              </Button>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

/* ---------- Reusable copy-to-clipboard field components ---------- */

interface CopyableFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onCopy: (text: string, label: string) => void;
  placeholder?: string;
  hint?: string;
  badge?: string;
  type?: React.ComponentProps<typeof Input>['type'];
}

function CopyableField({ label, value, onChange, onCopy, placeholder, hint, badge, type }: CopyableFieldProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label className="text-sm">{label}</Label>
        {badge && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{badge}</Badge>}
      </div>
      <div className="flex gap-2">
        <Input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="text-sm flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          onClick={() => onCopy(value, label)}
          title={`Copy ${label}`}
        >
          <MaterialIcon name="content_copy" size="sm" />
        </Button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

interface CopyableTextareaProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onCopy: (text: string, label: string) => void;
  placeholder?: string;
  hint?: string;
  badge?: string;
}

function CopyableTextarea({ label, value, onChange, onCopy, placeholder, hint, badge }: CopyableTextareaProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <Label className="text-sm">{label}</Label>
        {badge && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{badge}</Badge>}
      </div>
      <div className="flex gap-2">
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="text-sm flex-1 min-h-[80px]"
          rows={3}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0 self-start mt-0"
          onClick={() => onCopy(value, label)}
          title={`Copy ${label}`}
        >
          <MaterialIcon name="content_copy" size="sm" />
        </Button>
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
