import { useParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { ReceivingStageRouter } from '@/components/receiving/ReceivingStageRouter';

export default function DockIntakeReceiving() {
  const { id } = useParams<{ id: string }>();

  if (!id) {
    return (
      <DashboardLayout>
        <div className="text-center py-12 text-muted-foreground">
          <p>No shipment ID provided.</p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="max-w-[1500px] mx-auto w-full overflow-x-hidden">
        <ReceivingStageRouter shipmentId={id} />
      </div>
    </DashboardLayout>
  );
}
