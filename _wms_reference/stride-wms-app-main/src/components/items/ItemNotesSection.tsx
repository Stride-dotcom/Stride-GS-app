import { UnifiedNotesSection } from '@/components/notes/UnifiedNotesSection';

interface ItemNotesSectionProps {
  itemId: string;
  isClientUser?: boolean;
}

export function ItemNotesSection({ itemId, isClientUser = false }: ItemNotesSectionProps) {
  return (
    <UnifiedNotesSection
      entityType="item"
      entityId={itemId}
      isClientUser={isClientUser}
      title="Notes"
      readOnlyLinkedSources
      allowedNoteTypes={['internal', 'public']}
    />
  );
}
