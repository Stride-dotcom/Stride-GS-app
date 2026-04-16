import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface InboundLink {
  id: string;
  dock_intake_id: string;
  linked_shipment_id: string;
  link_type: 'manifest' | 'expected';
  confidence_score: number | null;
  linked_at: string;
  linked_by: string | null;
  // Joined from shipments
  shipment_number: string;
  vendor_name: string | null;
  expected_pieces: number | null;
  inbound_kind: string;
  // Joined from accounts
  account_name: string | null;
}

export function useInboundLinks(dockIntakeId?: string) {
  const [links, setLinks] = useState<InboundLink[]>([]);
  const [loading, setLoading] = useState(true);
  const { profile } = useAuth();
  const { toast } = useToast();

  const fetchLinks = useCallback(async () => {
    if (!dockIntakeId || !profile?.tenant_id) {
      setLinks([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await (supabase as any)
        .from('inbound_links')
        .select(`
          id,
          dock_intake_id,
          linked_shipment_id,
          link_type,
          confidence_score,
          linked_at,
          linked_by,
          shipments!inbound_links_linked_shipment_id_fkey (
            shipment_number,
            vendor_name,
            expected_pieces,
            inbound_kind,
            account_id,
            accounts!shipments_account_id_fkey ( account_name )
          )
        `)
        .eq('dock_intake_id', dockIntakeId)
        .eq('tenant_id', profile.tenant_id)
        .order('linked_at', { ascending: false });

      if (error) throw error;

      const mapped: InboundLink[] = (data || []).map((row: any) => ({
        id: row.id,
        dock_intake_id: row.dock_intake_id,
        linked_shipment_id: row.linked_shipment_id,
        link_type: row.link_type,
        confidence_score: row.confidence_score,
        linked_at: row.linked_at,
        linked_by: row.linked_by,
        shipment_number: row.shipments?.shipment_number || '—',
        vendor_name: row.shipments?.vendor_name || null,
        expected_pieces: row.shipments?.expected_pieces || null,
        inbound_kind: row.shipments?.inbound_kind || row.link_type,
        account_name: row.shipments?.accounts?.account_name || null,
      }));

      setLinks(mapped);
    } catch (err) {
      console.error('[useInboundLinks] fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [dockIntakeId, profile?.tenant_id]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  const unlinkShipment = useCallback(
    async (linkId: string) => {
      if (!profile?.tenant_id) return;
      try {
        const { error } = await (supabase as any)
          .from('inbound_links')
          .delete()
          .eq('id', linkId)
          .eq('tenant_id', profile.tenant_id);

        if (error) throw error;

        setLinks((prev) => prev.filter((l) => l.id !== linkId));
        toast({ title: 'Unlinked', description: 'Shipment has been unlinked.' });
      } catch (err) {
        console.error('[useInboundLinks] unlink error:', err);
        toast({
          variant: 'destructive',
          title: 'Unlink Failed',
          description: err instanceof Error ? err.message : 'Failed to unlink.',
        });
      }
    },
    [profile?.tenant_id, toast]
  );

  return { links, loading, unlinkShipment, refetch: fetchLinks };
}
