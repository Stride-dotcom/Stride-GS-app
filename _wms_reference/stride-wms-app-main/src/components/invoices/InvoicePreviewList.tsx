import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { InvoicePreview } from '@/lib/invoiceBuilder/types';
import { InvoicePreviewCard } from './InvoicePreviewCard';

interface InvoicePreviewListProps {
  previews: InvoicePreview[];
  selectedPreviews: Set<string>;
  onToggleSelection: (previewId: string) => void;
  onToggleSelectAll: () => void;
  onUpdateNotes: (previewId: string, notes: string) => void;
}

export function InvoicePreviewList({
  previews,
  selectedPreviews,
  onToggleSelection,
  onToggleSelectAll,
  onUpdateNotes,
}: InvoicePreviewListProps) {
  const allSelected = previews.length > 0 && selectedPreviews.size === previews.length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Invoice Preview</CardTitle>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="select-all"
              checked={allSelected}
              onCheckedChange={onToggleSelectAll}
            />
            <Label htmlFor="select-all" className="text-sm">
              Select All ({previews.length})
            </Label>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {previews.map((preview) => (
          <InvoicePreviewCard
            key={preview.id}
            preview={preview}
            isSelected={selectedPreviews.has(preview.id)}
            onSelectionChange={(selected) => {
              if (selected !== selectedPreviews.has(preview.id)) {
                onToggleSelection(preview.id);
              }
            }}
            onNotesChange={(notes) => onUpdateNotes(preview.id, notes)}
          />
        ))}

        {previews.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No invoices to preview
          </div>
        )}
      </CardContent>
    </Card>
  );
}
