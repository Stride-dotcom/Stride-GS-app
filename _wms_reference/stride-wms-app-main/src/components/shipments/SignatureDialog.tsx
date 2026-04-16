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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { SignaturePad } from './SignaturePad';

interface SignatureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  releasedToName?: string;
  itemCount: number;
  onConfirm: (data: { signatureData: string | null; signatureName: string }) => Promise<void>;
}

export function SignatureDialog({
  open,
  onOpenChange,
  releasedToName,
  itemCount,
  onConfirm,
}: SignatureDialogProps) {
  const [signatureData, setSignatureData] = useState<string | null>(null);
  const [typedSigName, setTypedSigName] = useState('');
  const [pickedUpBy, setPickedUpBy] = useState(releasedToName || '');
  const [submitting, setSubmitting] = useState(false);

  const hasSignature = !!signatureData || !!typedSigName.trim();
  const hasName = !!pickedUpBy.trim();

  const handleSignatureChange = (data: { signatureData: string | null; signatureName: string }) => {
    setSignatureData(data.signatureData);
    setTypedSigName(data.signatureName);
  };

  const handleConfirm = async () => {
    if (!hasSignature || !hasName) return;
    setSubmitting(true);
    try {
      // Send signature data (drawn or null) and the picked-up-by name
      await onConfirm({ signatureData, signatureName: pickedUpBy.trim() });
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (submitting) return;
    if (!nextOpen) {
      setSignatureData(null);
      setTypedSigName('');
      setPickedUpBy(releasedToName || '');
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MaterialIcon name="draw" size="sm" />
            Pickup Signature
          </DialogTitle>
          <DialogDescription>
            A signature is required to release {itemCount} item{itemCount !== 1 ? 's' : ''}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Picked Up By - always editable */}
          <div className="space-y-2">
            <Label htmlFor="picked-up-by">Picked Up By <span className="text-destructive">*</span></Label>
            <Input
              id="picked-up-by"
              value={pickedUpBy}
              onChange={(e) => setPickedUpBy(e.target.value)}
              placeholder="Name of person picking up"
            />
          </div>

          {/* Signature pad */}
          <SignaturePad
            onSignatureChange={handleSignatureChange}
            initialName=""
          />
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!hasSignature || !hasName || submitting}
          >
            {submitting ? (
              <>
                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                Completing...
              </>
            ) : (
              <>
                <MaterialIcon name="check" size="sm" className="mr-2" />
                Sign & Complete
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
