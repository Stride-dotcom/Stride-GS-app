import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { ColorPicker } from '@/components/ui/color-picker';
import { ResizableSplit } from '@/components/ui/resizable-split';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CommunicationAlert,
  CommunicationTemplate,
  CommunicationBrandSettings,
  TenantCompanyInfo,
  COMMUNICATION_VARIABLES,
} from '@/hooks/useCommunications';
import { EmailPreviewModal, EmailLivePreview } from './EmailPreviewModal';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useToast } from '@/hooks/use-toast';
import { useSmsAddonActivation } from '@/hooks/useSmsAddonActivation';
import {
  isLegacyHtmlTemplate,
  migrateLegacyHtmlToPlainText,
  normalizeTokenFormat,
} from '@/lib/emailTemplates/brandedEmailBuilder';

// Link-type tokens for CTA button link dropdown
const LINK_TOKENS = COMMUNICATION_VARIABLES.filter(
  (v) => v.key.endsWith('_link') || v.key.endsWith('_url')
);

// Font size options
const FONT_SIZES = [10, 12, 14, 16, 18, 20, 24, 28, 32];

const COMMON_EMAIL_DOMAIN_TYPOS: Record<string, string> = {
  'gamil.com': 'gmail.com',
  'gmai.com': 'gmail.com',
  'gmial.com': 'gmail.com',
  'gmal.com': 'gmail.com',
  'hotnail.com': 'hotmail.com',
  'hotmial.com': 'hotmail.com',
  'outlok.com': 'outlook.com',
  'yaho.com': 'yahoo.com',
  'icloud.con': 'icloud.com',
  'gmail.con': 'gmail.com',
};

function splitRecipientEntries(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isRecipientToken(entry: string): boolean {
  return /^\[\[[a-zA-Z0-9_.-]+\]\]$/.test(entry);
}

function getPossibleEmailTypos(value: string): Array<{ entered: string; suggestion: string }> {
  const warnings: Array<{ entered: string; suggestion: string }> = [];
  for (const entry of splitRecipientEntries(value)) {
    if (isRecipientToken(entry)) continue;
    const atIdx = entry.indexOf('@');
    if (atIdx <= 0 || atIdx === entry.length - 1) continue;
    const domain = entry.slice(atIdx + 1).toLowerCase();
    const suggestion = COMMON_EMAIL_DOMAIN_TYPOS[domain];
    if (suggestion) {
      warnings.push({ entered: domain, suggestion });
    }
  }
  return warnings;
}

function getInvalidSmsRecipientEntries(value: string): string[] {
  const invalid: string[] = [];
  for (const entry of splitRecipientEntries(value)) {
    if (isRecipientToken(entry)) continue;
    if (!/^\+[1-9]\d{1,14}$/.test(entry)) {
      invalid.push(entry);
    }
  }
  return invalid;
}

type Channel = 'email' | 'sms';

interface AlertTemplateEditorProps {
  alerts: CommunicationAlert[];
  templates: CommunicationTemplate[];
  brandSettings: CommunicationBrandSettings | null;
  tenantCompanyInfo?: TenantCompanyInfo;
  onUpdateAlert: (id: string, updates: Partial<CommunicationAlert>) => Promise<boolean>;
  onUpdateTemplate: (id: string, updates: Partial<CommunicationTemplate>) => Promise<boolean>;
  onCreateTemplate: (alertId: string, channel: 'email' | 'sms', alertName: string, triggerEvent?: string) => Promise<CommunicationTemplate | null>;
  onUpdateBrandSettings: (updates: Partial<CommunicationBrandSettings>) => Promise<boolean>;
  onBack: () => void;
  selectedAlertId?: string;
}

export function AlertTemplateEditor({
  alerts,
  templates,
  brandSettings,
  tenantCompanyInfo,
  onUpdateAlert,
  onUpdateTemplate,
  onCreateTemplate,
  onUpdateBrandSettings,
  onBack,
  selectedAlertId,
}: AlertTemplateEditorProps) {
  const { toast } = useToast();
  const { data: smsAddonState } = useSmsAddonActivation();
  const smsAddonActive = smsAddonState?.is_active === true;
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  // --- Core selection state ---
  const [alertId, setAlertId] = useState(selectedAlertId || alerts[0]?.id || '');
  const [channel, setChannel] = useState<Channel>('email');
  const [showPreview, setShowPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [lastFocusedField, setLastFocusedField] = useState<string>('body');

  // --- Per-channel email state ---
  const [emailRecipients, setEmailRecipients] = useState('');
  const [subject, setSubject] = useState('');
  const [heading, setHeading] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailCtaEnabled, setEmailCtaEnabled] = useState(false);
  const [emailCtaLabel, setEmailCtaLabel] = useState('');
  const [emailCtaLink, setEmailCtaLink] = useState('');

  // --- Brand color (editable in editor, saved to brand settings) ---
  const [accentColor, setAccentColor] = useState(brandSettings?.brand_primary_color || '#FD5A2A');

  // --- Per-channel SMS state ---
  const [smsRecipients, setSmsRecipients] = useState('');
  const [smsBody, setSmsBody] = useState('');
  const [smsCtaEnabled, setSmsCtaEnabled] = useState(false);
  const [smsCtaLabel, setSmsCtaLabel] = useState('');
  const [smsCtaLink, setSmsCtaLink] = useState('');

  // --- Refs for cursor insertion ---
  const emailBodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLInputElement>(null);
  const emailRecipientsRef = useRef<HTMLInputElement>(null);
  const smsBodyRef = useRef<HTMLTextAreaElement>(null);
  const smsRecipientsRef = useRef<HTMLInputElement>(null);

  // --- Derived data ---
  const selectedAlert = alerts.find((a) => a.id === alertId) || null;
  const emailTemplate = templates.find((t) => t.alert_id === alertId && t.channel === 'email') || null;
  const smsTemplate = templates.find((t) => t.alert_id === alertId && t.channel === 'sms') || null;

  // Available channels based on alert config
  const availableChannels = useMemo(() => {
    const channels: { value: Channel; label: string; disabled?: boolean }[] = [];
    if (selectedAlert?.channels.email) channels.push({ value: 'email', label: 'Email' });
    if (selectedAlert?.channels.sms) {
      channels.push({
        value: 'sms',
        label: smsAddonActive ? 'SMS' : 'SMS (locked: activate SMS add-on)',
        disabled: !smsAddonActive,
      });
    }
    return channels;
  }, [selectedAlert?.channels.email, selectedAlert?.channels.sms, smsAddonActive]);

  // --- Auto-select first available channel when alert or channels change ---
  useEffect(() => {
    const hasCurrentEditableChannel = availableChannels.some((c) => c.value === channel && !c.disabled);
    if (hasCurrentEditableChannel) return;
    const fallback = availableChannels.find((c) => !c.disabled);
    if (fallback) {
      setChannel(fallback.value);
    }
  }, [availableChannels, channel]);

  // --- Auto-create missing templates for enabled channels ---
  const autoCreateAttempted = useRef<string>('');
  useEffect(() => {
    if (!selectedAlert) return;
    if (autoCreateAttempted.current === selectedAlert.id) return;

    const needsEmail = selectedAlert.channels.email && !emailTemplate;
    const needsSms = selectedAlert.channels.sms && !smsTemplate;

    if (needsEmail || needsSms) {
      autoCreateAttempted.current = selectedAlert.id;
      const create = async () => {
        if (needsEmail) {
          await onCreateTemplate(selectedAlert.id, 'email', selectedAlert.name, selectedAlert.trigger_event);
        }
        if (needsSms) {
          await onCreateTemplate(selectedAlert.id, 'sms', selectedAlert.name, selectedAlert.trigger_event);
        }
      };
      create();
    }
  }, [selectedAlert, emailTemplate, smsTemplate, onCreateTemplate]);

  // Reset auto-create guard when switching alerts
  useEffect(() => {
    autoCreateAttempted.current = '';
  }, [alertId]);

  // --- Sync accent color from brand settings ---
  useEffect(() => {
    if (brandSettings?.brand_primary_color) {
      setAccentColor(brandSettings.brand_primary_color);
    }
  }, [brandSettings?.brand_primary_color]);

  // --- Load template data when alert changes ---
  useEffect(() => {
    if (!selectedAlert) return;

    // Load email data
    if (emailTemplate) {
      const rawBody = emailTemplate.body_template || '';
      const ed = emailTemplate.editor_json as Record<string, unknown> | null;
      const rawSubject = emailTemplate.subject_template || '';

      // Detect legacy full HTML templates and auto-migrate to plain text
      if (isLegacyHtmlTemplate(rawBody)) {
        const migrated = migrateLegacyHtmlToPlainText(rawBody);
        setSubject(normalizeTokenFormat(rawSubject) || migrated.subject);
        setEmailBody(migrated.body);
        setHeading(migrated.heading);
        setEmailCtaEnabled(!!migrated.ctaLabel);
        setEmailCtaLabel(migrated.ctaLabel);
        setEmailCtaLink(migrated.ctaLink);
        setEmailRecipients((ed?.recipients as string) || '');
      } else {
        setSubject(normalizeTokenFormat(rawSubject));
        setEmailBody(normalizeTokenFormat(rawBody));
        setEmailRecipients((ed?.recipients as string) || '');
        setHeading((ed?.heading as string) || '');
        setEmailCtaEnabled(!!(ed?.cta_enabled));
        setEmailCtaLabel((ed?.cta_label as string) || '');
        setEmailCtaLink((ed?.cta_link as string) || '');
      }
    } else {
      setSubject('');
      setEmailBody('');
      setEmailRecipients('');
      setHeading('');
      setEmailCtaEnabled(false);
      setEmailCtaLabel('');
      setEmailCtaLink('');
    }

    // Load SMS data
    if (smsTemplate) {
      setSmsBody(smsTemplate.body_template || '');
      const ed = smsTemplate.editor_json as Record<string, unknown> | null;
      setSmsRecipients((ed?.recipients as string) || '');
      setSmsCtaEnabled(!!(ed?.sms_cta_enabled));
      setSmsCtaLabel((ed?.sms_cta_label as string) || '');
      setSmsCtaLink((ed?.sms_cta_link as string) || '');
    } else {
      setSmsBody('');
      setSmsRecipients('');
      setSmsCtaEnabled(false);
      setSmsCtaLabel('');
      setSmsCtaLink('');
    }
  }, [alertId, selectedAlert, emailTemplate, smsTemplate]);

  // --- Save handler ---
  const handleSave = async () => {
    if (!selectedAlert) return;

    if (selectedAlert.channels.sms && invalidSmsRecipients.length > 0) {
      toast({
        variant: 'destructive',
        title: 'Invalid SMS recipient format',
        description: `Use E.164 format (+15551234567). Invalid entries: ${invalidSmsRecipients.slice(0, 3).join(', ')}`,
      });
      return;
    }

    setIsSaving(true);

    try {
      // Save email template if channel is enabled and template exists
      if (emailTemplate && selectedAlert.channels.email) {
        await onUpdateTemplate(emailTemplate.id, {
          subject_template: subject,
          body_template: emailBody,
          body_format: 'text' as const,
          editor_json: {
            recipients: emailRecipients,
            heading,
            cta_enabled: emailCtaEnabled,
            cta_label: emailCtaLabel,
            cta_link: emailCtaLink,
          } as Record<string, unknown>,
        });
      }

      // Save SMS template if channel is enabled and template exists
      if (smsTemplate && selectedAlert.channels.sms && smsAddonActive) {
        await onUpdateTemplate(smsTemplate.id, {
          body_template: smsBody,
          editor_json: {
            recipients: smsRecipients,
            sms_cta_enabled: smsCtaEnabled,
            sms_cta_label: smsCtaLabel,
            sms_cta_link: smsCtaLink,
          } as Record<string, unknown>,
        });
      }

      // Save accent color to brand settings if changed
      if (accentColor !== brandSettings?.brand_primary_color) {
        await onUpdateBrandSettings({ brand_primary_color: accentColor });
      }
    } catch {
      // Errors handled by hook toast
    } finally {
      setIsSaving(false);
    }
  };

  // --- Token insertion at cursor ---
  const insertToken = useCallback(
    (tokenKey: string) => {
      const token = `[[${tokenKey}]]`;

      const insertAtCursor = (
        ref: React.RefObject<HTMLTextAreaElement | HTMLInputElement | null>,
        value: string,
        setter: (val: string) => void
      ) => {
        const el = ref.current;
        if (!el) {
          setter(value + token);
          return;
        }
        const start = el.selectionStart ?? value.length;
        const end = el.selectionEnd ?? value.length;
        const newVal = value.substring(0, start) + token + value.substring(end);
        setter(newVal);
        requestAnimationFrame(() => {
          el.selectionStart = el.selectionEnd = start + token.length;
          el.focus();
        });
      };

      if (channel === 'sms') {
        if (lastFocusedField === 'smsRecipients') {
          insertAtCursor(smsRecipientsRef, smsRecipients, setSmsRecipients);
        } else {
          insertAtCursor(smsBodyRef, smsBody, setSmsBody);
        }
      } else {
        // Email
        if (lastFocusedField === 'subject') {
          insertAtCursor(subjectRef, subject, setSubject);
        } else if (lastFocusedField === 'emailRecipients') {
          insertAtCursor(emailRecipientsRef, emailRecipients, setEmailRecipients);
        } else if (lastFocusedField === 'heading') {
          insertAtCursor(headingRef, heading, setHeading);
        } else {
          insertAtCursor(emailBodyRef, emailBody, setEmailBody);
        }
      }
    },
    [channel, lastFocusedField, emailBody, subject, heading, emailRecipients, smsBody, smsRecipients]
  );

  const editableChannels = availableChannels.filter((c) => !c.disabled);
  const noChannelsEnabled = editableChannels.length === 0;
  const emailRecipientTypos = useMemo(
    () => getPossibleEmailTypos(emailRecipients),
    [emailRecipients]
  );
  const invalidSmsRecipients = useMemo(
    () => getInvalidSmsRecipientEntries(smsRecipients),
    [smsRecipients]
  );

  // --- Editor Form (left pane on desktop, full page on mobile) ---
  const editorForm = (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-6 space-y-6">
        {/* TOP ROW: Alert Trigger + Template Type */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Alert Trigger</Label>
            <Select value={alertId} onValueChange={setAlertId}>
              <SelectTrigger>
                <SelectValue placeholder="Select alert" />
              </SelectTrigger>
              <SelectContent>
                {alerts.map((alert) => (
                  <SelectItem key={alert.id} value={alert.id}>
                    {alert.key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Template Type</Label>
            {noChannelsEnabled ? (
              <div className="flex items-center h-10 px-3 rounded-md border border-dashed text-sm text-muted-foreground">
                No channels enabled
              </div>
            ) : (
              <Select value={channel} onValueChange={(v) => setChannel(v as Channel)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableChannels.map((ch) => (
                      <SelectItem key={ch.value} value={ch.value} disabled={ch.disabled}>
                      {ch.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
        </div>

        {/* Tokens Dropdown + Insert */}
        {!noChannelsEnabled && (
          <>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Tokens</Label>
              <TokenInsertRow onInsert={insertToken} />
              <p className="text-xs text-muted-foreground">
                Click into a field first, then insert a token.
              </p>
            </div>

            <Separator />
          </>
        )}

        {/* No channels message */}
        {noChannelsEnabled && (
          <div className="text-center py-12 text-muted-foreground space-y-2">
            <MaterialIcon name="notifications_off" size="lg" className="mx-auto opacity-40" />
            <p className="text-sm">
              Enable at least one editable channel. SMS templates remain visible but locked until SMS add-on is active.
            </p>
          </div>
        )}

        {/* ================================================ */}
        {/* EMAIL CHANNEL                                     */}
        {/* ================================================ */}
        {!noChannelsEnabled && channel === 'email' && (
          <>
            {/* Recipients */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Recipients (comma-separated emails and/or tokens)
              </Label>
              <Input
                ref={emailRecipientsRef}
                value={emailRecipients}
                onChange={(e) => setEmailRecipients(e.target.value)}
                onFocus={() => setLastFocusedField('emailRecipients')}
                placeholder="[[account_contact_email]], warehouse@company.com"
              />
              {emailRecipientTypos.length > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Possible typo: {emailRecipientTypos[0].entered} (did you mean {emailRecipientTypos[0].suggestion}?)
                </p>
              )}
            </div>

            {/* Subject */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Subject</Label>
              <Input
                ref={subjectRef}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                onFocus={() => setLastFocusedField('subject')}
                placeholder="[[tenant_name]]: Shipment Received [[shipment_number]]"
              />
            </div>

            {/* Heading */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Heading</Label>
              <Input
                ref={headingRef}
                value={heading}
                onChange={(e) => setHeading(e.target.value)}
                onFocus={() => setLastFocusedField('heading')}
                placeholder="Shipment Received"
                className="text-lg font-bold"
              />
              <p className="text-xs text-muted-foreground">
                Displays as large bold text at the top of the email.
              </p>
            </div>

            {/* Body */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Body</Label>
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => wrapSelection(emailBodyRef, '**', '**', emailBody, setEmailBody)}
                >
                  Bold
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => wrapSelection(emailBodyRef, '*', '*', emailBody, setEmailBody)}
                >
                  Italic
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    wrapSelection(emailBodyRef, '[', '](url)', emailBody, setEmailBody)
                  }
                >
                  Link
                </Button>
                <FontSizeDropdown
                  onSelect={(size) =>
                    wrapSelection(
                      emailBodyRef,
                      `{size:${size}px}`,
                      '{/size}',
                      emailBody,
                      setEmailBody
                    )
                  }
                />
              </div>
              <Textarea
                ref={emailBodyRef}
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                onFocus={() => setLastFocusedField('body')}
                className="min-h-[200px] text-sm"
                style={{ resize: 'vertical', fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                placeholder="Enter your email body text here. Use tokens like [[account_name]] and formatting like **bold**."
              />
            </div>

            {/* Optional CTA Button */}
            <div className="space-y-3">
              <h3 className="font-bold text-base">Optional CTA Button</h3>
              <p className="text-xs text-muted-foreground">Enable only if needed.</p>
              <Separator />

              <div className="flex items-center gap-3">
                <Switch checked={emailCtaEnabled} onCheckedChange={setEmailCtaEnabled} />
                <span className="text-sm">Enable CTA button</span>
              </div>

              {emailCtaEnabled && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Button Label</Label>
                    <Input
                      value={emailCtaLabel}
                      onChange={(e) => setEmailCtaLabel(e.target.value)}
                      placeholder="e.g. View Shipment"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Button Link</Label>
                    <Select value={emailCtaLink} onValueChange={setEmailCtaLink}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a link token" />
                      </SelectTrigger>
                      <SelectContent>
                        {LINK_TOKENS.map((token) => (
                          <SelectItem key={token.key} value={`[[${token.key}]]`}>
                            [[{token.key}]]
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>

            {/* Brand Accent Color */}
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-base">Brand Accent Color</h3>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="rounded-full w-5 h-5 flex items-center justify-center bg-muted text-muted-foreground hover:bg-muted/80"
                            aria-label="Help"
                          >
                            <MaterialIcon name="info" size="sm" className="text-[14px]" />
                          </button>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="text-sm">Logo is pulled automatically from Organization settings. Color is an optional override for the email header bar and CTA button.</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <Separator />
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Accent Color</Label>
                <ColorPicker
                  value={accentColor}
                  onChange={setAccentColor}
                />
              </div>
            </div>

            {/* Preview button (mobile only) */}
            {!isDesktop && (
              <div>
                <Button variant="outline" onClick={() => setShowPreview(true)}>
                  <MaterialIcon name="visibility" size="sm" className="mr-2" />
                  Preview
                </Button>
              </div>
            )}
          </>
        )}

        {/* ================================================ */}
        {/* SMS CHANNEL                                       */}
        {/* ================================================ */}
        {!noChannelsEnabled && channel === 'sms' && (
          <>
            {/* Recipients */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Recipients (comma-separated phone numbers and/or tokens)
              </Label>
              <Input
                ref={smsRecipientsRef}
                value={smsRecipients}
                onChange={(e) => setSmsRecipients(e.target.value)}
                onFocus={() => setLastFocusedField('smsRecipients')}
                placeholder="[[account_contact_phone]], +1-555-000-0000"
              />
              <p className="text-xs text-muted-foreground">
                Use E.164 phone format (+15551234567). Separate multiple numbers with commas.
              </p>
              {invalidSmsRecipients.length > 0 && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Invalid number format detected. Use E.164 (example: +15551234567).
                </p>
              )}
            </div>

            {/* SMS Body */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">SMS Body</Label>
              <Textarea
                ref={smsBodyRef}
                value={smsBody}
                onChange={(e) => setSmsBody(e.target.value)}
                onFocus={() => setLastFocusedField('smsBody')}
                className="min-h-[200px] text-sm"
                style={{ resize: 'vertical', fontFamily: "'Plus Jakarta Sans', sans-serif" }}
                placeholder="Enter SMS message..."
              />
              <p className="text-xs text-muted-foreground">
                {smsBody.length} characters &middot; ~{Math.ceil(smsBody.length / 160) || 1} SMS segment{Math.ceil(smsBody.length / 160) !== 1 ? 's' : ''}
              </p>
            </div>

            {/* Optional SMS CTA */}
            <div className="space-y-3">
              <h3 className="font-bold text-base">Optional CTA Link</h3>
              <p className="text-xs text-muted-foreground">
                When enabled, a link line is appended to the SMS at send time.
              </p>
              <Separator />

              <div className="flex items-center gap-3">
                <Switch checked={smsCtaEnabled} onCheckedChange={setSmsCtaEnabled} />
                <span className="text-sm">Enable CTA link</span>
              </div>

              {smsCtaEnabled && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Label (optional)</Label>
                    <Input
                      value={smsCtaLabel}
                      onChange={(e) => setSmsCtaLabel(e.target.value)}
                      placeholder="e.g. View details"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Link</Label>
                    <Select value={smsCtaLink} onValueChange={setSmsCtaLink}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a link token" />
                      </SelectTrigger>
                      <SelectContent>
                        {LINK_TOKENS.map((token) => (
                          <SelectItem key={token.key} value={`[[${token.key}]]`}>
                            [[{token.key}]]
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Live preview of what will be appended */}
                  <div className="rounded-md border border-dashed p-3 bg-muted/30 text-xs font-mono text-muted-foreground">
                    Appended at send:{' '}
                    <span className="text-foreground">
                      {smsCtaLabel ? `${smsCtaLabel}: ` : ''}
                      {smsCtaLink || '(select link)'}
                    </span>
                  </div>
                </>
              )}
            </div>
          </>
        )}

        {/* Footer Actions */}
        {!noChannelsEnabled && (
          <div className="flex items-center justify-end gap-3 pt-4 pb-8">
            <Button variant="outline" onClick={onBack}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  // --- Desktop: side-by-side with live preview ---
  if (isDesktop && !noChannelsEnabled && channel === 'email') {
    return (
      <div className="flex flex-col h-full">
        {/* Page Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b bg-card flex-shrink-0">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={onBack}>
              <MaterialIcon name="arrow_back" size="md" />
            </Button>
            <div>
              <h1 className="text-xl font-bold">Alert Template Editor</h1>
              <p className="text-sm text-muted-foreground">
                Configure recipients, subject, body, tokens, and optional CTA.
              </p>
            </div>
          </div>
        </div>

        {/* Side-by-side layout */}
        <ResizableSplit
          left={editorForm}
          right={
            <EmailLivePreview
              subject={subject}
              heading={heading}
              body={emailBody}
              ctaEnabled={emailCtaEnabled}
              ctaLabel={emailCtaLabel}
              ctaLink={emailCtaLink}
              tenantCompanyInfo={tenantCompanyInfo}
              accentColor={accentColor}
            />
          }
          defaultLeftPercent={50}
          minLeftPercent={35}
          maxLeftPercent={65}
          className="flex-1"
        />

        {/* Email Preview Modal (mobile fallback) */}
        {showPreview && (
          <EmailPreviewModal
            open={showPreview}
            onOpenChange={setShowPreview}
            subject={subject}
            heading={heading}
            body={emailBody}
            ctaEnabled={emailCtaEnabled}
            ctaLabel={emailCtaLabel}
            ctaLink={emailCtaLink}
            tenantCompanyInfo={tenantCompanyInfo}
            accentColor={accentColor}
          />
        )}
      </div>
    );
  }

  // --- Mobile / SMS: single-column layout ---
  return (
    <div className="flex flex-col h-full">
      {/* Page Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b bg-card flex-shrink-0">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <MaterialIcon name="arrow_back" size="md" />
          </Button>
          <div>
            <h1 className="text-xl font-bold">Alert Template Editor</h1>
            <p className="text-sm text-muted-foreground">
              Configure recipients, subject, body, tokens, and optional CTA.
            </p>
          </div>
        </div>
      </div>

      {editorForm}

      {/* Email Preview Modal (mobile) */}
      {showPreview && (
        <EmailPreviewModal
          open={showPreview}
          onOpenChange={setShowPreview}
          subject={subject}
          heading={heading}
          body={emailBody}
          ctaEnabled={emailCtaEnabled}
          ctaLabel={emailCtaLabel}
          ctaLink={emailCtaLink}
          tenantCompanyInfo={tenantCompanyInfo}
          accentColor={accentColor}
        />
      )}
    </div>
  );
}

// ---------- Token Insert Dropdown ----------

function TokenInsertRow({ onInsert }: { onInsert: (key: string) => void }) {
  const [selectedToken, setSelectedToken] = useState('');

  const groups = useMemo(
    () =>
      COMMUNICATION_VARIABLES.reduce<Record<string, typeof COMMUNICATION_VARIABLES>>((acc, v) => {
        if (!acc[v.group]) acc[v.group] = [];
        acc[v.group].push(v);
        return acc;
      }, {}),
    []
  );

  const handleInsert = () => {
    if (selectedToken) {
      onInsert(selectedToken);
      setSelectedToken('');
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Select value={selectedToken} onValueChange={setSelectedToken}>
        <SelectTrigger className="flex-1">
          <SelectValue placeholder="Select token..." />
        </SelectTrigger>
        <SelectContent className="max-h-[300px]">
          {Object.entries(groups).map(([group, vars]) => (
            <div key={group}>
              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                {group}
              </div>
              {vars.map((v) => (
                <SelectItem key={v.key} value={v.key}>
                  [[{v.key}]] &mdash; {v.label}
                </SelectItem>
              ))}
            </div>
          ))}
        </SelectContent>
      </Select>
      <Button onClick={handleInsert} disabled={!selectedToken}>
        Insert
      </Button>
    </div>
  );
}

// ---------- Font Size Dropdown ----------

function FontSizeDropdown({ onSelect }: { onSelect: (size: number) => void }) {
  return (
    <Select onValueChange={(v) => onSelect(Number(v))}>
      <SelectTrigger className="w-[100px]">
        <SelectValue placeholder="Size" />
      </SelectTrigger>
      <SelectContent>
        {FONT_SIZES.map((size) => (
          <SelectItem key={size} value={String(size)}>
            {size}px
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------- Wrap-selection helper for bold/italic/link/size ----------

function wrapSelection(
  ref: React.RefObject<HTMLTextAreaElement | null>,
  before: string,
  after: string,
  value: string,
  setter: (val: string) => void
) {
  const el = ref.current;
  if (!el) return;
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  const selected = value.substring(start, end);
  const inner = selected || 'text';
  const newVal = value.substring(0, start) + before + inner + after + value.substring(end);
  setter(newVal);
  requestAnimationFrame(() => {
    const newCursor = start + before.length + inner.length + after.length;
    el.selectionStart = el.selectionEnd = newCursor;
    el.focus();
  });
}
