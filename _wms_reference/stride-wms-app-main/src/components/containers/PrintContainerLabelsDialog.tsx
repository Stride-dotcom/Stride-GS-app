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
import { useToast } from '@/hooks/use-toast';
import {
  type ContainerLabelData,
  generateContainerLabelsPDF,
  printLabels,
  downloadPDF,
  PrintPopupBlockedError,
} from '@/lib/labelGenerator';

interface PrintContainerLabelsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  containers: ContainerLabelData[];
}

export function PrintContainerLabelsDialog({
  open,
  onOpenChange,
  containers,
}: PrintContainerLabelsDialogProps) {
  const [generating, setGenerating] = useState(false);
  const { toast } = useToast();

  const handlePrint = async () => {
    try {
      setGenerating(true);
      const pdfBlob = await generateContainerLabelsPDF(containers);
      const filename = `container-labels-${new Date().toISOString().split('T')[0]}.pdf`;
      await printLabels(pdfBlob, filename);
      onOpenChange(false);
    } catch (error) {
      console.error('Error printing container labels:', error);
      if (error instanceof PrintPopupBlockedError) {
        toast({
          variant: 'destructive',
          title: 'Print Window Blocked',
          description: 'Your browser blocked printing. Please allow popups or download the PDF instead.',
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to print container labels. Try downloading instead.',
        });
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = async () => {
    try {
      setGenerating(true);
      const pdfBlob = await generateContainerLabelsPDF(containers);
      const filename = `container-labels-${new Date().toISOString().split('T')[0]}.pdf`;
      downloadPDF(pdfBlob, filename);
      toast({
        title: 'Labels downloaded',
        description: `${containers.length} label${containers.length !== 1 ? 's' : ''} ready for printing.`,
      });
      onOpenChange(false);
    } catch (error) {
      console.error('Error generating container labels:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to generate labels. Please try again.',
      });
    } finally {
      setGenerating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Print Container Labels</DialogTitle>
          <DialogDescription>
            Generate a PDF with QR code labels for the selected container{containers.length !== 1 ? 's' : ''}.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="bg-muted rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Labels to print:</span>
              <span className="text-2xl font-bold">{containers.length}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Labels are generated in 4×6 inch format with QR codes.
            </p>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={generating}>
            Cancel
          </Button>
          <Button variant="outline" onClick={handleDownload} disabled={generating || containers.length === 0}>
            {generating ? (
              <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
            ) : (
              <MaterialIcon name="download" size="sm" className="mr-2" />
            )}
            Download PDF
          </Button>
          <Button onClick={handlePrint} disabled={generating || containers.length === 0}>
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

