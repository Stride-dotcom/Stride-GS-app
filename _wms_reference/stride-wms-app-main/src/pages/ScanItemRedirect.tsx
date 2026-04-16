/**
 * ScanItemRedirect - Handles QR code scan redirects for items
 * Accepts either UUID or item_code and redirects to item detail
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

export default function ScanItemRedirect() {
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
        // If it's a valid UUID, go directly to item detail
        if (isValidUuid(codeOrId)) {
          // Verify item exists
          const { data, error } = await supabase
            .from('items')
            .select('id')
            .eq('id', codeOrId)
            .is('deleted_at', null)
            .maybeSingle();

          if (error) throw error;

          if (data) {
            navigate(`/inventory/${codeOrId}`, { replace: true });
          } else {
            setError('Item not found');
            toast({
              variant: 'destructive',
              title: 'Item Not Found',
              description: 'The scanned QR code does not match any item.',
            });
            setTimeout(() => navigate('/inventory', { replace: true }), 2000);
          }
          return;
        }

        // Otherwise, look up by item_code
        const { data, error } = await supabase
          .from('items')
          .select('id')
          .eq('item_code', codeOrId)
          .is('deleted_at', null)
          .maybeSingle();

        if (error) throw error;

        if (data) {
          navigate(`/inventory/${data.id}`, { replace: true });
        } else {
          setError('Item not found');
          toast({
            variant: 'destructive',
            title: 'Item Not Found',
            description: `No item found with code "${codeOrId}".`,
          });
          setTimeout(() => navigate('/inventory', { replace: true }), 2000);
        }
      } catch (err) {
        console.error('Error looking up item:', err);
        setError('Lookup failed');
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to look up item. Please try again.',
        });
        setTimeout(() => navigate('/inventory', { replace: true }), 2000);
      }
    };

    lookup();
  }, [codeOrId, navigate, toast]);

  return (
    <DashboardLayout>
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        {error ? (
          <>
            <p className="text-destructive font-medium">{error}</p>
            <p className="text-muted-foreground text-sm">Redirecting to inventory...</p>
          </>
        ) : (
          <>
            <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-primary" />
            <p className="text-muted-foreground">Looking up item...</p>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
