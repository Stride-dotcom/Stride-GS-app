import { UnifiedNotesSection } from '@/components/notes/UnifiedNotesSection';
import type { UnifiedNoteType } from '@/lib/notes/entityMeta';

interface DockIntakeNotesPanelProps {
  shipmentId: string;
  noteType: UnifiedNoteType;
}

export function DockIntakeNotesPanel({ shipmentId, noteType }: DockIntakeNotesPanelProps) {
  return (
    <UnifiedNotesSection
      entityType="shipment"
      entityId={shipmentId}
      embedded
      forcedNoteType={noteType}
      allowedNoteTypes={['internal', 'public', 'exception']}
      listHeightClassName="h-[220px] pr-2"
    />
  );
}
