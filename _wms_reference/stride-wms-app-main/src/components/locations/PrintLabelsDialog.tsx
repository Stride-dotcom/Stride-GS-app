import { useState, useMemo } from 'react';
import { Location } from '@/hooks/useLocations';
import { Warehouse } from '@/hooks/useWarehouses';
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
import { generateLocationLabelsPDF, printLabels, downloadPDF, PrintPopupBlockedError } from '@/lib/labelGenerator';

interface PrintLabelsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locations: Location[];
  warehouses: Warehouse[];
}

export function PrintLabelsDialog({
  open,
  onOpenChange,
  locations,
  warehouses,
}: PrintLabelsDialogProps) {
  const [generating, setGenerating] = useState(false);
  const { toast } = useToast();

  const warehouseMap = useMemo(() => {
    return new Map(warehouses.map((w) => [w.id, w]));
  }, [warehouses]);

  const getLabelData = () => {
    return locations.map((location) => {
      const warehouse = warehouseMap.get(location.warehouse_id);
      return {
        id: location.id,
        code: location.code,
        name: location.name || '',
        type: location.type,
        warehouseName: warehouse?.name || '',
        warehouseCode: warehouse?.code || '',
      };
    });
  };

  const handlePrint = async () => {
    try {
      setGenerating(true);
      const labelData = getLabelData();
      const pdfBlob = await generateLocationLabelsPDF(labelData);
      const filename = `location-labels-${new Date().toISOString().split('T')[0]}.pdf`;
      
      await printLabels(pdfBlob, filename);
      onOpenChange(false);
    } catch (error) {
      console.error('Error printing labels:', error);
      if (error instanceof PrintPopupBlockedError) {
        toast({
          variant: 'destructive',
          title: 'Print Window Blocked',
          description: 'Your browser or an extension (ad blocker/privacy tool) blocked the print window. Please allow popups for this site or try downloading the PDF instead.',
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to print labels. Please try downloading instead.',
        });
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleDownload = async () => {
    try {
      setGenerating(true);
      const labelData = getLabelData();
      const pdfBlob = await generateLocationLabelsPDF(labelData);
      const filename = `location-labels-${new Date().toISOString().split('T')[0]}.pdf`;
      
      downloadPDF(pdfBlob, filename);

      toast({
        title: 'Labels downloaded',
        description: `${locations.length} label${locations.length !== 1 ? 's' : ''} ready for printing.`,
      });

      onOpenChange(false);
    } catch (error) {
      console.error('Error generating labels:', error);
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
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Print Location Labels</DialogTitle>
          <DialogDescription>
            Generate a PDF with QR code labels for the selected locations.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <div className="bg-muted rounded-lg p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Labels to print:</span>
              <span className="text-2xl font-bold">{locations.length}</span>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              Labels will be generated as 4×6 inch format with QR codes
            </p>
          </div>

          <div className="mt-4 text-sm text-muted-foreground">
            <p className="font-medium mb-2">Each label includes:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Location code (large)</li>
              <li>Location name (if set)</li>
              <li>Location type</li>
              <li>Warehouse name</li>
              <li>QR code with deep link</li>
            </ul>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={generating}>
            Cancel
          </Button>
          <Button variant="outline" onClick={handleDownload} disabled={generating || locations.length === 0}>
            {generating ? (
              <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
            ) : (
              <MaterialIcon name="download" size="sm" className="mr-2" />
            )}
            Download PDF
          </Button>
          <Button onClick={handlePrint} disabled={generating || locations.length === 0}>
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
