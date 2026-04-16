import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useCommunications, CommunicationAlert } from '@/hooks/useCommunications';
import { useAuth } from '@/contexts/AuthContext';
import { AlertList } from './alerts/AlertList';
import { AlertTemplateEditor } from './alerts/AlertTemplateEditor';
import { TemplateRolloutInboxCard } from './alerts/TemplateRolloutInboxCard';
import { InAppRoleEligibilityCard } from './alerts/InAppRoleEligibilityCard';

export function AlertsSettingsTab() {
  const {
    alerts,
    templates,
    brandSettings,
    tenantCompanyInfo,
    triggerCatalog,
    loading,
    createAlert,
    updateAlert,
    deleteAlert,
    createTemplate,
    updateTemplate,
    updateBrandSettings,
  } = useCommunications();

  const { profile } = useAuth();
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const tenantId = profile?.tenant_id || '';

  const handleSelectAlert = (alert: CommunicationAlert) => {
    setSelectedAlertId(alert.id);
  };

  const handleBack = () => {
    setSelectedAlertId(null);
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="notifications" size="md" />
            Alerts
          </CardTitle>
          <CardDescription>Loading alert settings...</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    );
  }

  // Show unified template editor when alert is selected
  if (selectedAlertId) {
    return (
      <div className="flex flex-col -m-6 min-h-0" style={{ height: 'calc(100vh - 80px)' }}>
        <AlertTemplateEditor
          alerts={alerts}
          templates={templates}
          brandSettings={brandSettings}
          tenantCompanyInfo={tenantCompanyInfo}
          onUpdateAlert={updateAlert}
          onUpdateTemplate={updateTemplate}
          onCreateTemplate={createTemplate}
          onUpdateBrandSettings={updateBrandSettings}
          onBack={handleBack}
          selectedAlertId={selectedAlertId}
        />
      </div>
    );
  }

  // Show alert list when no alert is selected
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MaterialIcon name="notifications" size="md" />
          Alerts
        </CardTitle>
        <CardDescription>
          Configure notification alerts and manage their templates
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <TemplateRolloutInboxCard />
          <InAppRoleEligibilityCard />
          <AlertList
            alerts={alerts}
            templates={templates}
            triggerCatalog={triggerCatalog}
            tenantId={tenantId}
            onCreateAlert={createAlert}
            onUpdateAlert={updateAlert}
            onDeleteAlert={deleteAlert}
            onSelectAlert={handleSelectAlert}
          />
        </div>
      </CardContent>
    </Card>
  );
}
