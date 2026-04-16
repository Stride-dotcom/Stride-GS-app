import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface OutboundCompletionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shipmentNumber: string;
  itemCount: number;
  companyName?: string;
  onComplete: (data: {
    driver_name: string;
    signature_data: string;
    signature_name: string;
    liability_accepted: boolean;
  }) => Promise<boolean>;
}

export function OutboundCompletionDialog({
  open,
  onOpenChange,
  shipmentNumber,
  itemCount,
  companyName = 'the Warehouse',
  onComplete,
}: OutboundCompletionDialogProps) {
  const [driverName, setDriverName] = useState('');
  const [liabilityAccepted, setLiabilityAccepted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);

  // Canvas for signature
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [lastPos, setLastPos] = useState({ x: 0, y: 0 });

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setDriverName('');
      setLiabilityAccepted(false);
      setHasSignature(false);
      clearSignature();
    }
  }, [open]);

  // Initialize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2; // Higher resolution
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);

    // Set drawing styles
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Clear canvas
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, [open]);

  // Drawing handlers
  const getPos = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();

    if ('touches' in e) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    }

    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    setIsDrawing(true);
    const pos = getPos(e);
    setLastPos(pos);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    const pos = getPos(e);

    ctx.beginPath();
    ctx.moveTo(lastPos.x, lastPos.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();

    setLastPos(pos);
    setHasSignature(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  };

  const getSignatureData = (): string => {
    const canvas = canvasRef.current;
    if (!canvas) return '';
    return canvas.toDataURL('image/png');
  };

  const handleSubmit = async () => {
    if (!driverName.trim()) return;
    if (!hasSignature) return;
    if (!liabilityAccepted) return;

    setIsSubmitting(true);
    try {
      const success = await onComplete({
        driver_name: driverName.trim(),
        signature_data: getSignatureData(),
        signature_name: driverName.trim(),
        liability_accepted: liabilityAccepted,
      });

      if (success) {
        onOpenChange(false);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const isValid = driverName.trim() && hasSignature && liabilityAccepted;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Complete Shipment</DialogTitle>
          <DialogDescription>
            Release {itemCount} item{itemCount !== 1 ? 's' : ''} for shipment {shipmentNumber}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Driver Name */}
          <div className="space-y-2">
            <Label htmlFor="driver-name">
              Driver / Recipient Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="driver-name"
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              placeholder="Enter name of person receiving items"
              autoFocus
            />
          </div>

          {/* Signature */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>
                Signature <span className="text-destructive">*</span>
              </Label>
              {hasSignature && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={clearSignature}
                  className="h-7 px-2 text-xs"
                >
                  <MaterialIcon name="delete" className="text-xs mr-1" />
                  Clear
                </Button>
              )}
            </div>
            <div className="border rounded-lg overflow-hidden bg-white">
              <canvas
                ref={canvasRef}
                className="w-full h-32 cursor-crosshair touch-none"
                onMouseDown={startDrawing}
                onMouseMove={draw}
                onMouseUp={stopDrawing}
                onMouseLeave={stopDrawing}
                onTouchStart={startDrawing}
                onTouchMove={draw}
                onTouchEnd={stopDrawing}
              />
            </div>
            {!hasSignature && (
              <p className="text-xs text-muted-foreground">Sign above using mouse or touch</p>
            )}
          </div>

          {/* Liability Disclaimer */}
          <div className="space-y-2">
            <div className="flex items-start space-x-3 p-3 bg-muted/50 rounded-lg">
              <Checkbox
                id="liability"
                checked={liabilityAccepted}
                onCheckedChange={(checked) => setLiabilityAccepted(checked === true)}
                className="mt-1"
              />
              <label
                htmlFor="liability"
                className="text-sm leading-relaxed cursor-pointer"
              >
                By signing, I accept full responsibility for the loading, securing, and transport
                of this cargo and release <strong>{companyName}</strong> from any liability for
                damage or injury occurring after the goods leave the dock. All items are in good
                condition unless otherwise noted.
              </label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid || isSubmitting}
          >
            {isSubmitting ? (
              <>
                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                Completing...
              </>
            ) : (
              <>
                <MaterialIcon name="check" size="sm" className="mr-2" />
                Complete Shipment
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
