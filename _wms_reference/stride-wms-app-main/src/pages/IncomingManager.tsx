import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/ui/page-header';
import { IncomingContent } from '@/components/shipments/IncomingContent';

export default function IncomingManager() {
  const [searchParams] = useSearchParams();

  const initialSubTab = useMemo(() => {
    const tab = (searchParams.get('tab') || '').toLowerCase();
    if (tab === 'expected') return 'expected' as const;
    if (tab === 'intakes' || tab === 'dock' || tab === 'dock_intakes') return 'intakes' as const;
    if (tab === 'manifests' || tab === 'manifest') return 'manifests' as const;
    return 'intakes' as const;
  }, [searchParams]);

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <PageHeader
            primaryText="Incoming"
            accentText="Manager"
            description="Plan, track, and allocate inbound shipments"
          />
        </div>
        <IncomingContent initialSubTab={initialSubTab} />
      </div>
    </DashboardLayout>
  );
}
