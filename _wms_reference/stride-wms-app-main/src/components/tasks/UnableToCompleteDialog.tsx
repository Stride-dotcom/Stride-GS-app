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
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface UnableToCompleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskTitle: string;
  onConfirm: (note: string) => Promise<boolean>;
}

export function UnableToCompleteDialog({
  open,
  onOpenChange,
  taskTitle,
  onConfirm,
}: UnableToCompleteDialogProps) {
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    if (!note.trim()) return;
    
    setLoading(true);
    const success = await onConfirm(note);
    setLoading(false);
    
    if (success) {
      setNote('');
      onOpenChange(false);
    }
  };

  const handleClose = (open: boolean) => {
    if (!open) {
      setNote('');
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MaterialIcon name="warning" size="md" className="text-destructive" />
            Unable to Complete Task
          </DialogTitle>
          <DialogDescription>
            Mark "{taskTitle}" as unable to complete. A note explaining why is required.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="note">Reason (Required) *</Label>
            <Textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Explain why this task cannot be completed..."
              rows={4}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={loading || !note.trim()}
          >
            {loading ? (
              <>
                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                Saving...
              </>
            ) : (
              'Mark Unable to Complete'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
