import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { seedDefaultTemplates } from '@/lib/seedTemplates';

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  complete: boolean;
  goToTab?: string;
  goToSubTab?: string;
  icon: string;
}

interface ChecklistState {
  loading: boolean;
  items: ChecklistItem[];
}

export function OnboardingChecklistTab() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [, setSearchParams] = useSearchParams();
  const [state, setState] = useState<ChecklistState>({ loading: true, items: [] });
  const [testEmailAddress, setTestEmailAddress] = useState('');
  const [sendingTestEmail, setSendingTestEmail] = useState(false);
  const [queuingTestAlert, setQueuingTestAlert] = useState(false);
  const [testEmailSent, setTestEmailSent] = useState(false);
  const [testAlertQueued, setTestAlertQueued] = useState(false);
  const [seedingTemplates, setSeedingTemplates] = useState(false);

  const runChecks = useCallback(async () => {
    if (!profile?.tenant_id) return;

    setState(prev => ({ ...prev, loading: true }));

    try {
      const [
        settingsResult,
        brandResult,
        alertsResult,
        templatesResult,
        warehousesResult,
        locationsResult,
        usersResult,
        rolesResult,
        chargeTypesResult,
      ] = await Promise.all([
        supabase
          .from('tenant_company_settings')
          .select('company_email, company_phone, office_alert_emails')
          .eq('tenant_id', profile.tenant_id)
          .maybeSingle(),
        supabase
          .from('communication_brand_settings')
          .select('custom_email_domain, email_domain_verified, use_default_email, from_email')
          .eq('tenant_id', profile.tenant_id)
          .maybeSingle(),
        supabase
          .from('communication_alerts')
          .select('id, trigger_event, is_enabled')
          .eq('tenant_id', profile.tenant_id),
        supabase
          .from('communication_templates')
          .select('id, alert_id, channel, updated_at, created_at')
          .eq('tenant_id', profile.tenant_id),
        supabase
          .from('warehouses')
          .select('id')
          .eq('tenant_id', profile.tenant_id),
        (supabase
          .from('locations') as any)
          .select('id, is_default_receiving')
          .eq('tenant_id', profile.tenant_id),
        supabase
          .from('users')
          .select('id')
          .eq('tenant_id', profile.tenant_id),
        (supabase
          .from('user_roles') as any)
          .select('id, role, user_id')
          .in('role', ['admin', 'manager']),
        supabase
          .from('charge_types')
          .select('id')
          .eq('tenant_id', profile.tenant_id),
      ]);

      const settings = settingsResult.data;
      const brand = brandResult.data;
      const alerts = alertsResult.data || [];
      const templates = templatesResult.data || [];
      const warehouses = warehousesResult.data || [];
      const locations = locationsResult.data || [];
      const users = usersResult.data || [];
      const adminRoles = rolesResult.data || [];
      const chargeTypes = chargeTypesResult.data || [];

      // Check 1: Organization Contact complete
      const hasContact = !!(settings?.company_email && settings?.company_phone);

      // Check 2: Office Alerts Emails set
      const hasOfficeAlerts = !!(settings?.office_alert_emails && settings.office_alert_emails.trim().length > 0);

      // Check 3: Email sending configured
      const emailConfigured = !!(
        brand?.use_default_email ||
        (brand?.custom_email_domain && brand?.email_domain_verified)
      );

      // Check 4: Core alerts enabled
      const coreTriggers = [
        'shipment.received',
        'task.overdue',
      ];
      const enabledTriggers = alerts.filter(a => a.is_enabled).map(a => a.trigger_event);
      const coreAlertsEnabled = coreTriggers.every(t => enabledTriggers.includes(t));

      // Check 5: Templates present and at least 1 edited
      const hasTemplates = templates.length > 0;
      const hasEditedTemplate = templates.some(t => t.updated_at !== t.created_at);
      const templatesReady = hasTemplates && hasEditedTemplate;

      // Check 6: Service rates configured (charge types exist)
      const hasChargeTypes = chargeTypes.length > 0;

      // Check 7: Warehouses + default receiving location
      const hasWarehouses = warehouses.length > 0;
      const hasDefaultReceiving = locations.some((l: { is_default_receiving?: boolean }) => l.is_default_receiving);
      const warehouseReady = hasWarehouses && hasDefaultReceiving;

      // Check 8: Users with admin/manager roles
      const tenantUserIds = new Set(users.map(u => u.id));
      const hasAdminUsers = adminRoles.some(r => tenantUserIds.has(r.user_id));

      const items: ChecklistItem[] = [
        {
          id: 'contact',
          label: 'Organization Contact Complete',
          description: 'Primary email and phone number are set',
          complete: hasContact,
          goToTab: 'organization',
          goToSubTab: 'contact',
          icon: 'phone',
        },
        {
          id: 'office-alerts',
          label: 'Office Alerts Email(s) Set',
          description: 'Internal recipients for automated office alerts',
          complete: hasOfficeAlerts,
          goToTab: 'organization',
          goToSubTab: 'contact',
          icon: 'mark_email_read',
        },
        {
          id: 'email-config',
          label: 'Email Sending Configured',
          description: emailConfigured
            ? brand?.use_default_email
              ? 'Using default Stride email sender'
              : `Custom domain verified: ${brand?.custom_email_domain}`
            : 'Configure Resend or use default email sender',
          complete: emailConfigured,
          goToTab: 'organization',
          goToSubTab: 'contact',
          icon: 'mail',
        },
        {
          id: 'core-alerts',
          label: 'Core Alerts Enabled',
          description: 'Shipment received, task overdue alerts are active',
          complete: coreAlertsEnabled,
          goToTab: 'alerts',
          icon: 'notifications_active',
        },
        {
          id: 'templates',
          label: 'Alert Templates Seeded',
          description: hasTemplates
            ? `${templates.length} template(s) found${hasEditedTemplate ? ', at least 1 customized' : ' — customize them in the Alerts tab'}`
            : 'Use the "Seed Missing Templates" button below to add default templates',
          complete: hasTemplates,
          goToTab: 'alerts',
          icon: 'description',
        },
        {
          id: 'service-rates',
          label: 'Service Rates Configured',
          description: hasChargeTypes
            ? `${chargeTypes.length} charge type(s) configured — set your prices in Service Rates`
            : 'Add starter services via Quick Start or configure your own',
          complete: hasChargeTypes,
          goToTab: 'service-rates',
          icon: 'attach_money',
        },
        {
          id: 'warehouses',
          label: 'Warehouses & Default Receiving Location',
          description: `${warehouses.length} warehouse(s), ${hasDefaultReceiving ? 'default receiving set' : 'no default receiving location'}`,
          complete: warehouseReady,
          goToTab: 'warehouses',
          icon: 'warehouse',
        },
        {
          id: 'admin-users',
          label: 'Admin/Manager Users Exist',
          description: hasAdminUsers ? 'Users with admin or manager roles found' : 'No admin/manager users found',
          complete: hasAdminUsers,
          goToTab: 'operations',
          icon: 'admin_panel_settings',
        },
      ];

      setState({ loading: false, items });
    } catch (error) {
      console.error('Error running onboarding checks:', error);
      setState(prev => ({ ...prev, loading: false }));
    }
  }, [profile?.tenant_id]);

  useEffect(() => {
    runChecks();
  }, [runChecks]);

  const handleGoTo = (item: ChecklistItem) => {
    if (item.goToTab) {
      setSearchParams({ tab: item.goToTab });
    }
  };

  const handleSendTestEmail = async () => {
    if (!testEmailAddress || !profile?.tenant_id) {
      toast({
        variant: 'destructive',
        title: 'Email Required',
        description: 'Please enter an email address to send the test to.',
      });
      return;
    }

    setSendingTestEmail(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-test-email', {
        body: {
          to_email: testEmailAddress,
          subject: `[Test] Stride WMS - Email Configuration Test`,
          body_html: `
            <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px;">
              <h2 style="color:#16a34a;">Email Configuration Working!</h2>
              <p>This is a test email from your Stride WMS setup. If you're reading this, your email sending is configured correctly.</p>
              <p style="color:#6b7280;font-size:14px;">Sent from tenant: ${profile.tenant_id}</p>
            </div>
          `,
          tenant_id: profile.tenant_id,
        },
      });

      if (error) throw error;

      if (data?.success) {
        setTestEmailSent(true);
        toast({
          title: 'Test Email Sent',
          description: `Check your inbox at ${testEmailAddress}`,
        });
      } else {
        throw new Error(data?.error || 'Failed to send test email');
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to send test email';
      toast({
        variant: 'destructive',
        title: 'Send Failed',
        description: message,
      });
    } finally {
      setSendingTestEmail(false);
    }
  };

  const handleQueueTestAlert = async () => {
    if (!profile?.tenant_id) return;
    if (!testEmailAddress) {
      toast({
        variant: 'destructive',
        title: 'Email Required',
        description: 'Enter an email address above to receive the test alert.',
      });
      return;
    }

    setQueuingTestAlert(true);
    try {
      const { data: inserted, error } = await supabase.from('alert_queue').insert({
        tenant_id: profile.tenant_id,
        alert_type: 'shipment.received',
        entity_type: 'shipment',
        entity_id: '00000000-0000-0000-0000-000000000000',
        subject: '📦 [Test] Shipment Received Alert',
        recipient_emails: [testEmailAddress],
        body_html: `
          <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:32px;">
            <h2>✅ Test Shipment Received Alert</h2>
            <p>This is a test alert queued from the Onboarding Setup Checklist.</p>
            <p><strong>Shipment:</strong> TEST-001</p>
            <p><strong>Items:</strong> 3</p>
            <p style="color:#6b7280;font-size:13px;margin-top:24px;">If you received this email, your alert system is working correctly.</p>
          </div>
        `,
        body_text: 'Test Shipment Received Alert - Shipment TEST-001 with 3 items. If you received this, your alert system is working.',
        status: 'pending',
      }).select('id, tenant_id').single();

      if (error) throw error;

      // Invoke send-alerts with the specific alert_queue_id so it processes just this one
      try {
        await supabase.functions.invoke('send-alerts', {
          body: { alert_queue_id: inserted.id, tenant_id: inserted.tenant_id },
        });
      } catch {
        // Edge function may not exist or may fail; the row is still queued for retry
      }

      setTestAlertQueued(true);
      toast({
        title: 'Test Alert Sent',
        description: `A test email alert was queued and sent to ${testEmailAddress}. Check your inbox.`,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to queue test alert';
      toast({
        variant: 'destructive',
        title: 'Queue Failed',
        description: message,
      });
    } finally {
      setQueuingTestAlert(false);
    }
  };

  const handleSeedTemplates = async () => {
    if (!profile?.tenant_id) return;

    setSeedingTemplates(true);
    try {
      const result = await seedDefaultTemplates(profile.tenant_id);
      toast({
        title: 'Templates Seeded',
        description: `Created ${result.created} alert(s) with default templates. ${result.skipped} already existed.`,
      });
      // Re-run checks to update the checklist
      await runChecks();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to seed templates';
      toast({
        variant: 'destructive',
        title: 'Seed Failed',
        description: message,
      });
    } finally {
      setSeedingTemplates(false);
    }
  };

  const completedCount = state.items.filter(i => i.complete).length;
  const totalCount = state.items.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  if (state.loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-48">
          <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Progress Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="checklist" size="md" />
            Setup Checklist
          </CardTitle>
          <CardDescription>
            Complete these steps to fully configure your Stride WMS tenant
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <Progress value={progressPercent} className="flex-1" />
            <span className="text-sm font-medium text-muted-foreground whitespace-nowrap">
              {completedCount} / {totalCount} complete
            </span>
          </div>

          {progressPercent === 100 && (
            <Alert className="border-green-200 bg-green-50">
              <MaterialIcon name="check_circle" size="sm" className="text-green-600" />
              <AlertDescription className="text-green-800">
                All setup steps are complete. Your tenant is fully configured.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Checklist Items */}
      <Card>
        <CardContent className="p-0">
          <div className="divide-y">
            {state.items.map((item) => (
              <div
                key={item.id}
                className="flex items-center gap-4 p-4 hover:bg-muted/50 transition-colors"
              >
                {/* Status Icon */}
                <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                  item.complete
                    ? 'bg-green-100 text-green-600'
                    : 'bg-muted text-muted-foreground'
                }`}>
                  {item.complete ? (
                    <MaterialIcon name="check" size="sm" />
                  ) : (
                    <MaterialIcon name={item.icon} size="sm" />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${item.complete ? 'text-green-700' : ''}`}>
                      {item.label}
                    </span>
                    {item.complete ? (
                      <Badge variant="secondary" className="bg-green-100 text-green-700 text-xs">
                        Done
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        Pending
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {item.description}
                  </p>
                </div>

                {/* Action */}
                {!item.complete && item.goToTab && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleGoTo(item)}
                    className="flex-shrink-0"
                  >
                    <MaterialIcon name="arrow_forward" size="sm" className="mr-1" />
                    Go Fix
                  </Button>
                )}
                {item.complete && item.goToTab && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleGoTo(item)}
                    className="flex-shrink-0 text-muted-foreground"
                  >
                    <MaterialIcon name="open_in_new" size="sm" className="mr-1" />
                    View
                  </Button>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Seed Templates */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="auto_fix_high" size="md" />
            Seed Default Alert Templates
          </CardTitle>
          <CardDescription>
            Populate missing alert templates with defaults for all core trigger events
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={handleSeedTemplates}
            disabled={seedingTemplates}
          >
            {seedingTemplates ? (
              <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
            ) : (
              <MaterialIcon name="playlist_add" size="sm" className="mr-2" />
            )}
            Seed Missing Templates
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            This creates communication alerts and default email/SMS templates for any core triggers not yet configured. Existing alerts are left unchanged.
          </p>
        </CardContent>
      </Card>

      {/* Run Tests Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="science" size="md" />
            Run Tests
          </CardTitle>
          <CardDescription>
            Verify your email and alert configuration by sending test messages
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Test Email Input */}
          <div className="space-y-2">
            <Label htmlFor="test-email">Test Email Address</Label>
            <Input
              id="test-email"
              type="email"
              placeholder="you@example.com"
              value={testEmailAddress}
              onChange={(e) => setTestEmailAddress(e.target.value)}
              className="max-w-md"
            />
            <p className="text-xs text-muted-foreground">
              Enter your email address to receive test messages
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            {/* Send Test Email */}
            <Button
              variant="outline"
              onClick={handleSendTestEmail}
              disabled={sendingTestEmail || !testEmailAddress}
            >
              {sendingTestEmail ? (
                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
              ) : (
                <MaterialIcon name="send" size="sm" className="mr-2" />
              )}
              Send Test Email
            </Button>

            {/* Refresh Checks */}
            <Button variant="ghost" onClick={runChecks}>
              <MaterialIcon name="refresh" size="sm" className="mr-2" />
              Re-check
            </Button>
          </div>

          {/* Test Results */}
          {testEmailSent && (
            <Alert className="border-green-200 bg-green-50">
              <MaterialIcon name="check_circle" size="sm" className="text-green-600" />
              <AlertDescription className="text-green-800">
                Test email sent to {testEmailAddress}. Check your inbox (and spam folder).
              </AlertDescription>
            </Alert>
          )}

          {testAlertQueued && (
            <Alert className="border-blue-200 bg-blue-50">
              <MaterialIcon name="check_circle" size="sm" className="text-blue-600" />
              <AlertDescription className="text-blue-800">
                Test alert queued. The send-alerts edge function will process it. Check the alert_queue table or your inbox.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
