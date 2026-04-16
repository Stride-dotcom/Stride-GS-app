import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/ui/page-header';
import { FieldHelpSettingsTab } from '@/components/settings/FieldHelpSettingsTab';
import { BackToDevConsoleButton } from '@/components/admin/BackToDevConsoleButton';

export default function HelpTool() {
  return (
    <DashboardLayout>
      <div className="space-y-6 px-2 sm:px-0">
        <PageHeader
          primaryText="Help"
          accentText="Tool"
          description="Manage field-level help content, tooltips, and contextual guidance across the app."
        />
        <BackToDevConsoleButton />
        <FieldHelpSettingsTab />
      </div>
    </DashboardLayout>
  );
}
