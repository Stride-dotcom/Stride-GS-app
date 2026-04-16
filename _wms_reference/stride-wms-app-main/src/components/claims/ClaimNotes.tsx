import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Claim } from '@/hooks/useClaims';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { UnifiedNotesSection } from '@/components/notes/UnifiedNotesSection';

interface ClaimNotesProps {
  claim: Claim;
  isStaff?: boolean;
  readOnly?: boolean;
  onUpdate?: () => void;
}

export function ClaimNotes({ claim, isStaff = true, readOnly = false, onUpdate }: ClaimNotesProps) {
  void onUpdate;

  return (
    <div className="space-y-6">
      <UnifiedNotesSection
        entityType="claim"
        entityId={claim.id}
        title="Notes & Resolution Details"
        isClientUser={!isStaff}
        readOnly={readOnly}
        allowedNoteTypes={['internal', 'public']}
      />

      {/* Description (Read-only) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MaterialIcon name="lock" size="sm" />
            Original Description
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-3 bg-muted rounded-md min-h-[60px] whitespace-pre-wrap">
            {claim.description || 'No description provided'}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
