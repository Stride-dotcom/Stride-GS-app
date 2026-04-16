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
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface WillCallItem {
  id: string;
  item_code: string;
  description: string | null;
}

interface WillCallCompletionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskTitle: string;
  items: WillCallItem[];
  onComplete: (pickupName: string) => Promise<boolean>;
}

export function WillCallCompletionDialog({
  open,
  onOpenChange,
  taskTitle,
  items,
  onComplete,
}: WillCallCompletionDialogProps) {
  const [pickupName, setPickupName] = useState('');
  const [loading, setLoading] = useState(false);

  const handleComplete = async () => {
    if (!pickupName.trim()) return;

    setLoading(true);
    try {
      const success = await onComplete(pickupName.trim());
      if (success) {
        setPickupName('');
        onOpenChange(false);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setPickupName('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Complete Will Call</DialogTitle>
          <DialogDescription>
            Enter the name of the person picking up the items to complete this will call.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Task Info */}
          <div className="p-3 bg-muted rounded-lg">
            <p className="font-medium text-sm">{taskTitle}</p>
            <div className="flex items-center gap-2 mt-1">
              <MaterialIcon name="inventory_2" size="sm" className="text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                {items.length} item{items.length !== 1 ? 's' : ''} to release
              </span>
            </div>
          </div>

          {/* Items List */}
          {items.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Items being released:</Label>
              <ScrollArea className="max-h-32 border rounded-md p-2">
                <div className="space-y-1">
                  {items.map((item) => (
                    <div key={item.id} className="flex items-center gap-2 text-sm">
                      <Badge variant="outline" className="font-mono text-xs">
                        {item.item_code}
                      </Badge>
                      <span className="text-muted-foreground truncate">
                        {item.description || 'No description'}
                      </span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Pickup Name Input */}
          <div className="space-y-2">
            <Label htmlFor="pickup-name" className="flex items-center gap-2">
              <MaterialIcon name="person" size="sm" />
              Picked up by *
            </Label>
            <Input
              id="pickup-name"
              placeholder="Enter name of person picking up"
              value={pickupName}
              onChange={(e) => setPickupName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && pickupName.trim()) {
                  handleComplete();
                }
              }}
              autoFocus
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleComplete}
            disabled={!pickupName.trim() || loading}
          >
            {loading ? (
              <>
                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                Completing...
              </>
            ) : (
              'Complete Will Call'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
