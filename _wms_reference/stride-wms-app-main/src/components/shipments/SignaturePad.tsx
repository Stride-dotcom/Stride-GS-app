import { useRef, useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface SignaturePadProps {
  onSignatureChange: (data: { signatureData: string | null; signatureName: string }) => void;
  initialName?: string;
}

export function SignaturePad({ onSignatureChange, initialName = '' }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [typedName, setTypedName] = useState(initialName);
  const [activeTab, setActiveTab] = useState<'draw' | 'type'>('draw');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set up canvas
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Clear canvas with white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  const getCanvasCoordinates = (e: React.MouseEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };

    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    if ('touches' in e) {
      const touch = e.touches[0];
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      };
    }

    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const startDrawing = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    const { x, y } = getCanvasCoordinates(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    const { x, y } = getCanvasCoordinates(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    setHasSignature(true);
  };

  const stopDrawing = () => {
    setIsDrawing(false);
    updateSignature();
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
    onSignatureChange({ signatureData: null, signatureName: '' });
  };

  const updateSignature = () => {
    if (activeTab === 'draw') {
      const canvas = canvasRef.current;
      if (!canvas || !hasSignature) return;
      
      const signatureData = canvas.toDataURL('image/png');
      onSignatureChange({ signatureData, signatureName: '' });
    } else {
      onSignatureChange({ signatureData: null, signatureName: typedName });
    }
  };

  const handleTypedNameChange = (value: string) => {
    setTypedName(value);
    onSignatureChange({ signatureData: null, signatureName: value });
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value as 'draw' | 'type');
    if (value === 'type' && typedName) {
      onSignatureChange({ signatureData: null, signatureName: typedName });
    } else if (value === 'draw' && hasSignature) {
      const canvas = canvasRef.current;
      if (canvas) {
        const signatureData = canvas.toDataURL('image/png');
        onSignatureChange({ signatureData, signatureName: '' });
      }
    }
  };

  return (
    <div className="space-y-4">
      <Label>Signature</Label>
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="draw" className="flex items-center gap-2">
            <MaterialIcon name="draw" size="sm" />
            Draw
          </TabsTrigger>
          <TabsTrigger value="type" className="flex items-center gap-2">
            Type Name
          </TabsTrigger>
        </TabsList>

        <TabsContent value="draw" className="space-y-3">
          <div className="border rounded-lg p-2 bg-white">
            <canvas
              ref={canvasRef}
              width={400}
              height={150}
              className="w-full touch-none cursor-crosshair border border-dashed border-muted-foreground/30 rounded"
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
            />
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Sign above using your mouse or finger
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={clearSignature}
              disabled={!hasSignature}
            >
              <MaterialIcon name="ink_eraser" size="sm" className="mr-1" />
              Clear
            </Button>
          </div>
        </TabsContent>

        <TabsContent value="type" className="space-y-3">
          <div className="space-y-2">
            <Input
              placeholder="Type your full name"
              value={typedName}
              onChange={(e) => handleTypedNameChange(e.target.value)}
              className="text-xl font-cursive"
            />
            {typedName && (
              <div className="border rounded-lg p-4 bg-white min-h-[100px] flex items-center justify-center">
                <span className="text-3xl font-cursive italic text-gray-800">
                  {typedName}
                </span>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Your typed name will serve as your electronic signature
          </p>
        </TabsContent>
      </Tabs>

      {(hasSignature || typedName) && (
        <div className="flex items-center gap-2 text-sm text-green-600">
          <MaterialIcon name="check" size="sm" />
          Signature captured
        </div>
      )}
    </div>
  );
}
