import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

type DevConsoleRouteTab = {
  value: string;
  label: string;
  icon: string;
  route: string;
  description: string;
  roleScope: 'admin_dev' | 'admin_dev_or_admin';
};

const DEV_CONSOLE_ROUTE_TABS: DevConsoleRouteTab[] = [
  {
    value: 'pricing-ops',
    label: 'Pricing Ops',
    icon: 'tune',
    route: '/admin/pricing-ops',
    description: 'Manage global SaaS pricing versions, rollout effective dates, and customer notices.',
    roleScope: 'admin_dev',
  },
  {
    value: 'stripe-ops',
    label: 'Stripe Ops',
    icon: 'credit_card',
    route: '/admin/stripe-ops',
    description: 'Inspect Stripe subscription state, linked customer IDs, and billing observability data.',
    roleScope: 'admin_dev',
  },
  {
    value: 'sms-sender-ops',
    label: 'SMS Sender Ops',
    icon: 'sms',
    route: '/admin/sms-sender-ops',
    description: 'Monitor SMS sender identities and enforce sender-level operational controls.',
    roleScope: 'admin_dev',
  },
  {
    value: 'billing-overrides-ops',
    label: 'Billing Overrides Ops',
    icon: 'money_off',
    route: '/admin/billing-overrides-ops',
    description: 'Apply and audit tenant-level billing override controls used for support interventions.',
    roleScope: 'admin_dev',
  },
  {
    value: 'email-ops',
    label: 'Email Ops',
    icon: 'mail',
    route: '/admin/email-ops',
    description: 'Review global email sender health, diagnostics, and delivery operations tooling.',
    roleScope: 'admin_dev',
  },
  {
    value: 'alert-template-ops',
    label: 'Template Ops',
    icon: 'design_services',
    route: '/admin/alert-template-ops',
    description: 'Manage global alert templates, wrapper versions, and tenant rollout strategy.',
    roleScope: 'admin_dev',
  },
  {
    value: 'diagnostics',
    label: 'Diagnostics',
    icon: 'monitoring',
    route: '/diagnostics',
    description: 'Review grouped app issues, severity fingerprints, and operational status transitions.',
    roleScope: 'admin_dev_or_admin',
  },
  {
    value: 'bot-qa',
    label: 'Bot QA',
    icon: 'science',
    route: '/admin/bot-qa',
    description: 'Run bot QA suites and inspect scenario-level pass/fail detail for assistant behavior.',
    roleScope: 'admin_dev_or_admin',
  },
  {
    value: 'qa-center',
    label: 'QA Center',
    icon: 'biotech',
    route: '/qa',
    description: 'Access admin-dev QA center workflows, including role management and test utilities.',
    roleScope: 'admin_dev',
  },
  {
    value: 'help-tool',
    label: 'Help Tool',
    icon: 'help',
    route: '/admin/help-tool',
    description: 'Manage field-level help content, tooltips, and contextual guidance across the app.',
    roleScope: 'admin_dev',
  },
];

export function DevConsoleSettingsTab() {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="terminal" size="md" />
            Dev Console
          </CardTitle>
          <CardDescription>Admin-dev control surface for operational tooling.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Use cards below to launch each admin_dev module.
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {DEV_CONSOLE_ROUTE_TABS.map((tab) => (
          <Link key={tab.value} to={tab.route} className="group">
            <Card className="h-full transition-all hover:shadow-md hover:border-primary/30">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <MaterialIcon name={tab.icon} size="md" className="text-primary" />
                  <CardTitle className="text-base">{tab.label}</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <CardDescription className="line-clamp-2">{tab.description}</CardDescription>
                <Badge variant="outline" className="text-[10px]">
                  {tab.roleScope === 'admin_dev' ? 'admin_dev' : 'admin_dev · admin'}
                </Badge>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
