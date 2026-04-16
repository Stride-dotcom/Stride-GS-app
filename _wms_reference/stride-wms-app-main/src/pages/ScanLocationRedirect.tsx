/**
 * ScanLocationRedirect - Handles QR code scan redirects for locations
 * Accepts either UUID or location.code and redirects to location detail
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

export default function ScanLocationRedirect() {
  const { codeOrId } = useParams<{ codeOrId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const lookup = async () => {
      if (!codeOrId) {
        navigate('/inventory', { replace: true });
        return;
      }

      try {
        // If it's a valid UUID, go directly to location detail
        if (isValidUuid(codeOrId)) {
          const { data, error } = await supabase
            .from('locations')
            .select('id')
            .eq('id', codeOrId)
            .is('deleted_at', null)
            .maybeSingle();

          if (error) throw error;

          if (data) {
            navigate(`/locations/${codeOrId}`, { replace: true });
          } else {
            setError('Location not found');
            toast({
              variant: 'destructive',
              title: 'Location Not Found',
              description: 'The scanned QR code does not match any location.',
            });
            setTimeout(() => navigate('/inventory', { replace: true }), 2000);
          }
          return;
        }

        // Otherwise, look up by code
        const raw = codeOrId.trim();
        const { data, error } = await supabase
          .from('locations')
          .select('id')
          .eq('code', raw)
          .is('deleted_at', null)
          .maybeSingle();

        if (error) throw error;

        if (data) {
          navigate(`/locations/${data.id}`, { replace: true });
        } else {
          setError('Location not found');
          toast({
            variant: 'destructive',
            title: 'Location Not Found',
            description: `No location found with code "${raw}".`,
          });
          setTimeout(() => navigate('/inventory', { replace: true }), 2000);
        }
      } catch (err) {
        console.error('Error looking up location:', err);
        setError('Lookup failed');
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to look up location. Please try again.',
        });
        setTimeout(() => navigate('/inventory', { replace: true }), 2000);
      }
    };

    void lookup();
  }, [codeOrId, navigate, toast]);

  return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        {error ? (
          <>
            <p className="text-destructive font-medium">{error}</p>
            <p className="text-muted-foreground text-sm">Redirecting…</p>
          </>
        ) : (
          <>
            <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-primary" />
            <p className="text-muted-foreground">Looking up location…</p>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}

