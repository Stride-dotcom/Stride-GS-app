import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { HelpTip } from '@/components/ui/help-tip';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { SaveButton } from '@/components/ui/SaveButton';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { useTenantSettings } from '@/hooks/useTenantSettings';
import { useCommunications } from '@/hooks/useCommunications';
import { OrganizationLogoUpload } from './OrganizationLogoUpload';
import { DueDateRulesSettingsTab } from './DueDateRulesSettingsTab';
import { PreferencesContent } from './preferences/PreferencesContent';
import { LegalLinksSection } from './preferences/LegalLinksSection';
import { EmailDomainSection } from './preferences/EmailDomainSection';
import { SmsAddonActivationCard } from './SmsAddonActivationCard';
import { SmsConsentPanel } from './SmsConsentPanel';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const organizationSchema = z.object({
  // Company Info
  company_name: z.string().optional(),
  company_email: z.string().email().optional().or(z.literal('')),
  company_phone: z.string().optional(),
  company_website: z.string().optional(),
  company_address: z.string().optional(),
  // Office Alerts
  office_alert_emails: z.string().optional().refine(
    (val) => {
      if (!val || val.trim() === '') return true;
      const emails = val.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
      return emails.length > 0 && emails.every(e => EMAIL_REGEX.test(e));
    },
    { message: 'Enter one or more valid emails separated by commas' }
  ),
  // Remit to Address (separate fields)
  remit_address_line1: z.string().optional(),
  remit_address_line2: z.string().optional(),
  remit_city: z.string().optional(),
  remit_state: z.string().optional(),
  remit_zip: z.string().optional(),
  // App Settings
  app_base_url: z.string().optional(),
  app_subdomain: z.string().optional(),
  // Email Settings
  email_signature_enabled: z.boolean().optional(),
  email_signature_custom_text: z.string().optional(),
});

type OrganizationFormData = z.infer<typeof organizationSchema>;

interface TenantInfo {
  id: string;
  name: string;
  status: string;
}

const ORG_SUB_TABS = ['company', 'address', 'preferences', 'due-dates'] as const;

export function OrganizationSettingsTab() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const subtabParam = searchParams.get('subtab') || 'company';
  const orgSubTab = (ORG_SUB_TABS as readonly string[]).includes(subtabParam) ? subtabParam : 'company';

  const handleOrgSubTabChange = (tab: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('subtab', tab);
    setSearchParams(next, { replace: true });
  };

  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const {
    settings: tenantSettings,
    loading: tenantSettingsLoading,
    uploading: logoUploading,
    uploadLogo,
    removeLogo,
    updateSettings,
  } = useTenantSettings();
  const {
    brandSettings,
    updateBrandSettings,
    loading: brandLoading,
  } = useCommunications();
  const [accentColor, setAccentColor] = useState(brandSettings?.brand_primary_color || '#FD5A2A');

  const form = useForm<OrganizationFormData>({
    resolver: zodResolver(organizationSchema),
    defaultValues: {
      company_name: '',
      company_email: '',
      company_phone: '',
      company_website: '',
      company_address: '',
      office_alert_emails: '',
      remit_address_line1: '',
      remit_address_line2: '',
      remit_city: '',
      remit_state: '',
      remit_zip: '',
      app_base_url: '',
      app_subdomain: '',
      email_signature_enabled: true,
      email_signature_custom_text: '',
    },
  });

  useEffect(() => {
    if (profile?.tenant_id) {
      fetchTenantData();
    }
  }, [profile?.tenant_id]);

  useEffect(() => {
    if (brandSettings?.brand_primary_color) {
      setAccentColor(brandSettings.brand_primary_color);
    }
  }, [brandSettings?.brand_primary_color]);

  useEffect(() => {
    if (tenantSettings) {
      form.reset({
        company_name: tenantSettings.company_name || '',
        company_email: tenantSettings.company_email || '',
        company_phone: tenantSettings.company_phone || '',
        company_website: tenantSettings.company_website || '',
        company_address: tenantSettings.company_address || '',
        office_alert_emails: tenantSettings.office_alert_emails || '',
        remit_address_line1: tenantSettings.remit_address_line1 || '',
        remit_address_line2: tenantSettings.remit_address_line2 || '',
        remit_city: tenantSettings.remit_city || '',
        remit_state: tenantSettings.remit_state || '',
        remit_zip: tenantSettings.remit_zip || '',
        app_base_url: tenantSettings.app_base_url || '',
        app_subdomain: tenantSettings.app_subdomain || '',
        email_signature_enabled: tenantSettings.email_signature_enabled ?? true,
        email_signature_custom_text: tenantSettings.email_signature_custom_text || '',
      });
    }
  }, [tenantSettings]);

  const fetchTenantData = async () => {
    if (!profile?.tenant_id) return;

    try {
      const { data: tenantData } = await supabase
        .from('tenants')
        .select('id, name, status')
        .eq('id', profile.tenant_id)
        .single();

      if (tenantData) setTenant(tenantData);
    } catch (error) {
      console.error('Error fetching tenant data:', error);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (data: OrganizationFormData) => {
    // Normalize office_alert_emails: trim, lowercase, dedupe
    const normalizedOfficeEmails = data.office_alert_emails
      ? [...new Set(
          data.office_alert_emails
            .split(',')
            .map(e => e.trim().toLowerCase())
            .filter(e => EMAIL_REGEX.test(e))
        )].join(', ')
      : null;

    const success = await updateSettings({
      company_name: data.company_name || null,
      company_email: data.company_email || null,
      company_phone: data.company_phone || null,
      company_website: data.company_website || null,
      company_address: data.company_address || null,
      office_alert_emails: normalizedOfficeEmails || null,
      remit_address_line1: data.remit_address_line1 || null,
      remit_address_line2: data.remit_address_line2 || null,
      remit_city: data.remit_city || null,
      remit_state: data.remit_state || null,
      remit_zip: data.remit_zip || null,
      app_base_url: data.app_base_url || null,
      app_subdomain: data.app_subdomain || null,
      email_signature_enabled: data.email_signature_enabled ?? true,
      email_signature_custom_text: data.email_signature_custom_text || null,
    });

    if (!success) throw new Error('Failed to save settings');

    // Sync brand accent color if changed
    if (accentColor !== brandSettings?.brand_primary_color) {
      await updateBrandSettings({ brand_primary_color: accentColor });
    }

    toast({
      title: 'Settings Saved',
      description: 'Organization settings have been updated.',
    });
  };

  if (loading || tenantSettingsLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Tabs value={orgSubTab} onValueChange={handleOrgSubTabChange} className="space-y-6">
        <TabsList className="flex-wrap h-auto gap-1">
          <TabsTrigger value="company" className="gap-2">
            <MaterialIcon name="apartment" size="sm" />
            Company Info
          </TabsTrigger>
          <TabsTrigger value="address" className="gap-2">
            <MaterialIcon name="location_on" size="sm" />
            Address
          </TabsTrigger>
          <TabsTrigger value="preferences" className="gap-2">
            <MaterialIcon name="settings" size="sm" />
            Preferences
          </TabsTrigger>
          <TabsTrigger value="due-dates" className="gap-2">
            <MaterialIcon name="notifications" size="sm" />
            Due Dates
          </TabsTrigger>
        </TabsList>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            {/* Company Info Tab (merged General + Contact) */}
            <TabsContent value="company">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MaterialIcon name="apartment" size="md" />
                    Company Information
                  </CardTitle>
                  <CardDescription>
                    Organization details, contact information, and email settings
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Logo Upload */}
                  <OrganizationLogoUpload
                    logoUrl={tenantSettings?.logo_url || null}
                    uploading={logoUploading}
                    onUpload={uploadLogo}
                    onRemove={removeLogo}
                    organizationName={tenant?.name}
                  />

                  <Separator />

                  {/* Tenant Info (Read-only) */}
                  <div className="flex items-center gap-4">
                    <div className="flex-1">
                      <label className="text-sm font-medium text-muted-foreground">Organization Name</label>
                      <p className="text-lg font-medium">{tenant?.name}</p>
                    </div>
                    <Badge variant={tenant?.status === 'active' ? 'default' : 'secondary'}>
                      {tenant?.status}
                    </Badge>
                  </div>

                  <Separator />

                  {/* Company Name Override */}
                  <FormField
                    control={form.control}
                    name="company_name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          <HelpTip
                            tooltip="This name will be displayed on quotes, invoices, and alert templates sent to your customers."
                            pageKey="settings.organization"
                            fieldKey="company_name"
                          >
                            Display Name
                          </HelpTip>
                        </FormLabel>
                        <FormControl>
                          <Input placeholder="Company display name for emails and reports" {...field} />
                        </FormControl>
                        <FormDescription>
                          Override the organization name for external communications
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="company_email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Primary Email (Reply-To)</FormLabel>
                          <FormControl>
                            <Input type="email" placeholder="contact@company.com" {...field} />
                          </FormControl>
                          <FormDescription>
                            Used as the reply-to address on outgoing system emails and for billing notices (including price-change notifications).
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="company_phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Phone Number</FormLabel>
                          <FormControl>
                            <Input placeholder="(555) 123-4567" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <FormField
                      control={form.control}
                      name="company_website"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Website</FormLabel>
                          <FormControl>
                            <Input type="url" placeholder="https://www.example.com" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="app_base_url"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Portal URL</FormLabel>
                          <FormControl>
                            <Input type="url" placeholder="https://app.yourcompany.com" {...field} />
                          </FormControl>
                          <FormDescription>
                            Client portal URL used in email links and notifications
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>

                  {/* Brand Accent Color */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-1.5">
                      <label className="text-sm font-medium">Brand Accent Color</label>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help">
                              <MaterialIcon name="info" size="sm" className="text-muted-foreground" />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-xs text-left">
                            <p>Your primary brand color used in email headers, buttons, and template accents. Changes here sync with the Alerts &gt; Template Editor.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <div className="flex items-center gap-3">
                      <input
                        type="color"
                        value={accentColor}
                        onChange={(e) => setAccentColor(e.target.value)}
                        className="w-10 h-10 rounded border cursor-pointer flex-shrink-0"
                      />
                      <Input
                        value={accentColor}
                        onChange={(e) => setAccentColor(e.target.value)}
                        className="w-32"
                        placeholder="#FD5A2A"
                      />
                      <div
                        className="h-10 flex-1 rounded border"
                        style={{ backgroundColor: accentColor }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Used for email header bars, CTA buttons, and communication templates
                    </p>
                  </div>

                  <Separator />

                  {/* Alert Channel Clarity */}
                  <Alert className="border-blue-200 bg-blue-50">
                    <MaterialIcon name="info" size="sm" className="text-blue-600" />
                    <AlertDescription className="text-blue-900">
                      <p className="font-medium mb-1">In-App Alerts vs Email Alerts</p>
                      <p className="text-sm">
                        <strong>In-app alerts</strong> (bell icon, Messages page) are shown to logged-in users and do not send email.{' '}
                        <strong>Email alerts</strong> are sent via your configured email sender to the addresses below.
                        These are separate systems &mdash; configuring email recipients does not affect in-app notifications.
                      </p>
                    </AlertDescription>
                  </Alert>

                  {/* Office Alerts Email(s) */}
                  <FormField
                    control={form.control}
                    name="office_alert_emails"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-1.5">
                          Office Alerts Email(s)
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-help">
                                  <MaterialIcon name="info" size="sm" className="text-muted-foreground" />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="max-w-xs text-left">
                                <p className="mb-1">Internal recipients for automated office alerts (quotes, claims, flags, system notices). Separate multiple emails with commas. This can be used as a template token.</p>
                                <p className="font-mono text-xs opacity-80">[[office_alert_emails]] - full string</p>
                                <p className="font-mono text-xs opacity-80">[[office_alert_email_primary]] - first email</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="ops@company.com, alerts@company.com"
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Used as the default internal email destination for automated app alerts (quotes, claims, flags, approvals). You may add multiple emails separated by commas.
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex justify-end">
                    <SaveButton
                      type="button"
                      onClick={() => form.handleSubmit(onSubmit)()}
                      label="Save Changes"
                      savingLabel="Saving..."
                      savedLabel="Saved"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Legal Links Section */}
              <LegalLinksSection standalone />

              {/* Email Domain Configuration */}
              <EmailDomainSection />

              {/* SMS Add-On Activation */}
              <SmsAddonActivationCard settings={tenantSettings} />

              {/* SMS Consent Tracking */}
              <SmsConsentPanel />
            </TabsContent>

            {/* Address Tab */}
            <TabsContent value="address">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MaterialIcon name="location_on" size="md" />
                    Business Address
                  </CardTitle>
                  <CardDescription>
                    Your organization's physical address for invoices and reports
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField
                    control={form.control}
                    name="company_address"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Business Address</FormLabel>
                        <FormControl>
                          <Textarea
                            placeholder="123 Main Street&#10;Suite 100&#10;City, State 12345"
                            rows={4}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>
                          Your primary business address for correspondence
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <Separator />

                  <div className="space-y-4">
                    <div>
                      <h4 className="text-sm font-medium mb-3">Remit to Address</h4>
                      <p className="text-sm text-muted-foreground mb-4">
                        Address where payments should be sent. This will appear on invoices for payment remittance.
                      </p>
                    </div>

                    <FormField
                      control={form.control}
                      name="remit_address_line1"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Address Line 1</FormLabel>
                          <FormControl>
                            <Input placeholder="Street address or P.O. Box" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="remit_address_line2"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Address Line 2</FormLabel>
                          <FormControl>
                            <Input placeholder="Suite, unit, building, floor, etc. (optional)" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid gap-4 md:grid-cols-3">
                      <FormField
                        control={form.control}
                        name="remit_city"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>City</FormLabel>
                            <FormControl>
                              <Input placeholder="City" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="remit_state"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>State</FormLabel>
                            <FormControl>
                              <Input placeholder="State" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="remit_zip"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>ZIP Code</FormLabel>
                            <FormControl>
                              <Input placeholder="ZIP" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <SaveButton
                      type="button"
                      onClick={() => form.handleSubmit(onSubmit)()}
                      label="Save Changes"
                      savingLabel="Saving..."
                      savedLabel="Saved"
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Preferences Tab - now uses dedicated component */}
            <TabsContent value="preferences">
              <PreferencesContent />
            </TabsContent>

          </form>
        </Form>

        {/* Due Dates Tab - uses existing component */}
        <TabsContent value="due-dates">
          <DueDateRulesSettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
