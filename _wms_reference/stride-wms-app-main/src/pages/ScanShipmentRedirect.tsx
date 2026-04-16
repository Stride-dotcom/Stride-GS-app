/**
 * ScanShipmentRedirect - Handles deep-link redirects for shipments
 * Accepts either UUID or shipment_number and redirects to the appropriate detail page.
 *
 * This is used by Activity and chat links so users can tap SHP/MAN/EXP/INT/OUT numbers
 * and navigate reliably even when the UI only has the human-readable number.
 */
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

// UUID v4 regex pattern
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(str: string): boolean {
  return UUID_REGEX.test(str);
}

function getShipmentDetailBaseRoute(shipmentNumber: string): string {
  const upper = shipmentNumber.toUpperCase();
  if (upper.startsWith('MAN-')) return '/incoming/manifest';
  if (upper.startsWith('EXP-')) return '/incoming/expected';
  if (upper.startsWith('INT-')) return '/incoming/dock-intake';
  return '/shipments';
}

export default function ScanShipmentRedirect() {
  const { numberOrId } = useParams<{ numberOrId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const lookup = async () => {
      if (!numberOrId) {
        navigate('/shipments', { replace: true });
        return;
      }

      try {
        // If it's a valid UUID, go directly to the correct detail page for that shipment.
        if (isValidUuid(numberOrId)) {
          const { data, error } = await supabase
            .from('shipments')
            .select('id, shipment_number')
            .eq('id', numberOrId)
            .is('deleted_at', null)
            .maybeSingle();

          if (error) throw error;
          if (!data?.id || !data.shipment_number) {
            setError('Shipment not found');
            toast({
              variant: 'destructive',
              title: 'Shipment Not Found',
              description: 'The link does not match any shipment.',
            });
            setTimeout(() => navigate('/shipments', { replace: true }), 2000);
            return;
          }

          const base = getShipmentDetailBaseRoute(data.shipment_number);
          navigate(`${base}/${data.id}`, { replace: true });
          return;
        }

        // Otherwise, look up by shipment_number.
        const upper = numberOrId.toUpperCase();
        const { data, error } = await supabase
          .from('shipments')
          .select('id, shipment_number')
          .eq('shipment_number', upper)
          .is('deleted_at', null)
          .maybeSingle();

        if (error) throw error;

        if (!data?.id || !data.shipment_number) {
          setError('Shipment not found');
          toast({
            variant: 'destructive',
            title: 'Shipment Not Found',
            description: `No shipment found with number "${upper}".`,
          });
          setTimeout(() => navigate('/shipments', { replace: true }), 2000);
          return;
        }

        const base = getShipmentDetailBaseRoute(data.shipment_number);
        navigate(`${base}/${data.id}`, { replace: true });
      } catch (err) {
        console.error('Error looking up shipment:', err);
        setError('Lookup failed');
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to look up shipment. Please try again.',
        });
        setTimeout(() => navigate('/shipments', { replace: true }), 2000);
      }
    };

    void lookup();
  }, [numberOrId, navigate, toast]);

  return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        {error ? (
          <>
            <p className="text-destructive font-medium">{error}</p>
            <p className="text-muted-foreground text-sm">Redirecting to shipments...</p>
          </>
        ) : (
          <>
            <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-primary" />
            <p className="text-muted-foreground">Looking up shipment...</p>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

