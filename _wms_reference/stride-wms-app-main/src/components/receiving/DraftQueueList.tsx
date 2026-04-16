import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface DraftIntake {
  id: string;
  shipment_number: string;
  vendor_name: string | null;
  signed_pieces: number | null;
  inbound_status: string | null;
  created_at: string;
  account_name?: string | null;
}

interface DraftQueueListProps {
  onSelect: (id: string) => void;
}

// TODO: draft expiry cleanup deferred (future phase)

export function DraftQueueList({ onSelect }: DraftQueueListProps) {
  const { profile } = useAuth();
  const [drafts, setDrafts] = useState<DraftIntake[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchDrafts();
  }, [profile?.tenant_id]);

  const fetchDrafts = async () => {
    if (!profile?.tenant_id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('shipments')
        .select(`
          id,
          shipment_number,
          vendor_name,
          signed_pieces,
          inbound_status,
          created_at,
          accounts(account_name)
        `)
        .eq('tenant_id', profile.tenant_id)
        .eq('inbound_kind', 'dock_intake')
        .in('inbound_status', ['draft', 'stage1_complete', 'receiving'])
        .order('created_at', { ascending: false });

      if (error) throw error;

      const mapped = (data || []).map((d: any) => ({
        ...d,
        account_name: d.accounts?.account_name || null,
      }));

      setDrafts(mapped);
    } catch (err) {
      console.error('[DraftQueueList] fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  const statusLabel = (status: string | null) => {
    switch (status) {
      case 'draft':
        return { label: 'Draft', variant: 'outline' as const };
      case 'stage1_complete':
        return { label: 'Pending Confirm', variant: 'secondary' as const };
      case 'receiving':
        return { label: 'Receiving', variant: 'default' as const };
      default:
        return { label: status || 'Unknown', variant: 'outline' as const };
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-sm text-muted-foreground">
          Draft Dock Intakes ({drafts.length})
        </h3>
        <div className="text-xs text-muted-foreground">
          Use "Start Dock Intake" above
        </div>
      </div>

      {drafts.length === 0 ? (
        <Card>
          <CardContent className="text-center py-8 text-muted-foreground">
            <MaterialIcon name="inbox" size="xl" className="mb-2 opacity-40" />
            <p>No draft dock intakes.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {drafts.map((draft) => {
            const statusInfo = statusLabel(draft.inbound_status);
            return (
              <Card
                key={draft.id}
                className="cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => onSelect(draft.id)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <MaterialIcon name="local_shipping" size="md" className="text-muted-foreground shrink-0" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-medium text-sm">
                            {draft.shipment_number}
                          </span>
                          <Badge variant={statusInfo.variant} className="text-xs">
                            {statusInfo.label}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                          {draft.vendor_name && <span>{draft.vendor_name}</span>}
                          {draft.account_name && <span>· {draft.account_name}</span>}
                          {draft.signed_pieces != null && <span>· {draft.signed_pieces} pcs</span>}
                        </div>
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground shrink-0 ml-2">
                      {new Date(draft.created_at).toLocaleDateString()}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
