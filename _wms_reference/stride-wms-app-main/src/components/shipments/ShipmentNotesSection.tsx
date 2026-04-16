import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { UnifiedNotesSection } from '@/components/notes/UnifiedNotesSection';
import type { UnifiedNoteType } from '@/lib/notes/entityMeta';

interface ShipmentNotesSectionProps {
  shipmentId: string;
  isClientUser?: boolean;
  allowClientWrite?: boolean;
  accountId?: string | null;
  className?: string;
  embedded?: boolean;
  forcedNoteType?: UnifiedNoteType;
}

export function ShipmentNotesSection({
  shipmentId,
  isClientUser = false,
  allowClientWrite = false,
  accountId,
  className,
  embedded = false,
  forcedNoteType,
}: ShipmentNotesSectionProps) {
  const { profile } = useAuth();
  const [accountDefaultShipmentNotes, setAccountDefaultShipmentNotes] = useState<string | null>(null);
  const [accountHighlightShipmentNotes, setAccountHighlightShipmentNotes] = useState(false);

  useEffect(() => {
    if (!accountId || !profile?.tenant_id || isClientUser) {
      setAccountDefaultShipmentNotes(null);
      setAccountHighlightShipmentNotes(false);
      return;
    }

    let cancelled = false;
    const load = async () => {
      const { data, error } = await (supabase.from('accounts') as any)
        .select('default_shipment_notes, highlight_shipment_notes')
        .eq('tenant_id', profile.tenant_id)
        .eq('id', accountId)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        console.warn('[ShipmentNotesSection] Failed to load account default shipment notes:', error.message);
        setAccountDefaultShipmentNotes(null);
        setAccountHighlightShipmentNotes(false);
        return;
      }

      setAccountDefaultShipmentNotes((data?.default_shipment_notes as string | null) ?? null);
      setAccountHighlightShipmentNotes(!!data?.highlight_shipment_notes);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [accountId, profile?.tenant_id, isClientUser]);

  return (
    <UnifiedNotesSection
      entityType="shipment"
      entityId={shipmentId}
      title="Notes"
      isClientUser={isClientUser}
      allowClientWrite={allowClientWrite}
      className={className}
      embedded={embedded}
      forcedNoteType={forcedNoteType}
      allowedNoteTypes={['internal', 'public', 'exception']}
      topContent={
        accountHighlightShipmentNotes && accountDefaultShipmentNotes?.trim() && !isClientUser ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <div className="font-medium mb-1">Default Shipment Notes</div>
            <p className="whitespace-pre-wrap">{accountDefaultShipmentNotes}</p>
          </div>
        ) : null
      }
    />
  );
}
