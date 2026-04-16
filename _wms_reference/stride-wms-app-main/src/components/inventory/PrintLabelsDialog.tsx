import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { generateItemLabelsPDF, downloadPDF, printLabels, PrintPopupBlockedError, ItemLabelData } from '@/lib/labelGenerator';
import { useToast } from '@/hooks/use-toast';
import { useTenantPreferences, DEFAULT_LABEL_CONFIG } from '@/hooks/useTenantPreferences';
import type { LabelConfig } from '@/hooks/useTenantPreferences';

interface PrintLabelsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: ItemLabelData[];
  title?: string;
  description?: string;
}

export function PrintLabelsDialog({
  open,
  onOpenChange,
  items,
  title = 'Print Labels',
  description,
}: PrintLabelsDialogProps) {
  const [generating, setGenerating] = useState(false);
  const { toast } = useToast();
  const { preferences } = useTenantPreferences();

  const labelConfig: LabelConfig = (preferences?.label_config as LabelConfig | null) ?? DEFAULT_LABEL_CONFIG;
  const enabledFields = labelConfig.fields.filter(f => f.enabled);

  const handlePrint = async () => {
    if (items.length === 0) return;

    setGenerating(true);
    try {
      const blob = await generateItemLabelsPDF(items, labelConfig);
      const filename = items.length === 1
        ? `label-${items[0].itemCode}.pdf`
        : `labels-${items.length}-items.pdf`;
      await printLabels(blob, filename);
      onOpenChange(false);
    } catch (error) {
      console.error('Error generating labels:', error);
      if (error instanceof PrintPopupBlockedError) {
        toast({
          variant: 'destructive',
          title: 'Print Window Blocked',
          description: 'Your browser or an extension (ad blocker/privacy tool) blocked the print window. Please allow popups for this site or try downloading the PDF instead.',
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Print Error',
          description: 'Failed to generate labels. Please try downloading instead.',
        });
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = async () => {
    if (items.length === 0) return;

    setGenerating(true);
    try {
      const blob = await generateItemLabelsPDF(items, labelConfig);
      const filename = items.length === 1
        ? `label-${items[0].itemCode}.pdf`
        : `labels-${items.length}-items.pdf`;
      downloadPDF(blob, filename);
      onOpenChange(false);
    } catch (error) {
      console.error('Error generating labels:', error);
    } finally {
      setGenerating(false);
    }
  };

  const defaultDescription = items.length === 1
    ? `Generate a 4x6 label for ${items[0].itemCode}`
    : `Generate 4x6 labels for ${items.length} items`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {description || defaultDescription}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="rounded-lg border p-4 bg-muted/50">
            <h4 className="font-medium mb-2">Label Contents:</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              {enabledFields.map(f => (
                <li key={f.key}>
                  &bull; {f.label} ({f.fontSize}pt{f.bold ? ', bold' : ''})
                </li>
              ))}
              {labelConfig.showQR && (
                <li>&bull; QR Code (links to item detail page)</li>
              )}
            </ul>
            <p className="text-xs text-muted-foreground mt-2">
              Customize in Settings &gt; Organization &gt; Preferences
            </p>
          </div>

          {items.length > 1 && (
            <p className="text-sm text-muted-foreground mt-3">
              Each item will be printed on a separate 4x6 label.
            </p>
          )}
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={generating}
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            onClick={handleDownload}
            disabled={generating || items.length === 0}
          >
            {generating ? (
              <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
            ) : (
              <MaterialIcon name="download" size="sm" className="mr-2" />
            )}
            Download PDF
          </Button>
          <Button
            onClick={handlePrint}
            disabled={generating || items.length === 0}
          >
            {generating ? (
              <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
            ) : (
              <MaterialIcon name="print" size="sm" className="mr-2" />
            )}
            Print Labels
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
