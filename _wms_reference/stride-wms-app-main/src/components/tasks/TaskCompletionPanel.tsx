/**
 * TaskCompletionPanel - Clean write-up panel shown before task completion.
 *
 * Displays each service line with qty/time inputs based on input_mode.
 * User confirms values, then completion proceeds with billing event creation.
 */

import { useState, useEffect } from 'react';
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
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { TaskServiceLine } from '@/hooks/useTaskServiceLines';

// =============================================================================
// TYPES
// =============================================================================

export interface CompletionLineValues {
  lineId: string;
  charge_code: string;
  charge_name: string;
  qty: number;
  minutes: number;
  input_mode: string;
  charge_type_id: string | null;
}

interface TaskCompletionPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskTitle: string;
  taskType: string;
  serviceLines: TaskServiceLine[];
  onConfirm: (values: CompletionLineValues[]) => void;
  loading?: boolean;
}

// =============================================================================
// COMPONENT
// =============================================================================

export function TaskCompletionPanel({
  open,
  onOpenChange,
  taskTitle,
  taskType,
  serviceLines,
  onConfirm,
  loading = false,
}: TaskCompletionPanelProps) {
  // Local state for editable values
  const [lineValues, setLineValues] = useState<CompletionLineValues[]>([]);

  // Initialize from service lines when dialog opens
  useEffect(() => {
    if (open && serviceLines.length > 0) {
      setLineValues(
        serviceLines.map(sl => ({
          lineId: sl.id,
          charge_code: sl.charge_code,
          charge_name: sl.charge_name,
          qty: sl.qty || 1,
          minutes: sl.minutes || 0,
          input_mode: sl.input_mode || 'qty',
          charge_type_id: sl.charge_type_id,
        })),
      );
    }
  }, [open, serviceLines]);

  const updateLine = (lineId: string, field: 'qty' | 'minutes', value: number) => {
    setLineValues(prev =>
      prev.map(lv =>
        lv.lineId === lineId ? { ...lv, [field]: value } : lv,
      ),
    );
  };

  const handleConfirm = () => {
    onConfirm(lineValues);
  };

  // Validate: every line must have qty > 0 for all input modes
  // (quantity is just quantity - no special minutes handling)
  const isValid = lineValues.every(lv => lv.qty > 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MaterialIcon name="check_circle" size="md" className="text-green-600" />
            Complete {taskType}
          </DialogTitle>
          <DialogDescription>
            Confirm service quantities for "{taskTitle}" before completing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4 max-h-[400px] overflow-y-auto">
          {lineValues.map(lv => (
            <div
              key={lv.lineId}
              className="flex flex-col gap-2 p-3 rounded-lg border bg-muted/30"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-sm">{lv.charge_name}</span>
                <Badge variant="outline" className="text-[10px]">
                  {lv.charge_code}
                </Badge>
              </div>

              <div className="flex gap-3">
                {/* Qty input - shown for ALL modes (quantity is always just quantity) */}
                <div className="flex-1 space-y-1">
                  <Label className="text-xs text-muted-foreground">Quantity</Label>
                  <Input
                    type="number"
                    min={0}
                    step={0.25}
                    value={lv.qty || ''}
                    onChange={e =>
                      updateLine(lv.lineId, 'qty', parseFloat(e.target.value) || 0)
                    }
                    className="h-8 text-sm"
                  />
                </div>
              </div>
            </div>
          ))}

          {lineValues.length === 0 && (
            <div className="text-center text-sm text-muted-foreground py-4">
              No services on this task. Add services before completing.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={loading || !isValid || lineValues.length === 0}
          >
            {loading && (
              <MaterialIcon
                name="progress_activity"
                size="sm"
                className="mr-2 animate-spin"
              />
            )}
            Complete Task
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
