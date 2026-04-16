import { useEffect } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

export type OverrideReason =
  | 'OVER_UTILIZATION'
  | 'FLAG_MISMATCH'
  | 'OVERFLOW'
  | 'MIXED_SOURCE_BATCH';

const REASON_MESSAGES: Record<string, string> = {
  OVER_UTILIZATION: 'This location will exceed 90% capacity.',
  FLAG_MISMATCH: 'This location does not match item requirements.',
  OVERFLOW: "This move exceeds the location's available capacity.",
};

function playWarningTone() {
  try {
    const AudioCtx =
      window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 440;
    gain.gain.value = 0.05;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    setTimeout(() => {
      osc.stop();
      ctx.close();
    }, 150);
  } catch {
    /* non-blocking */
  }
}

function triggerHaptic() {
  if ('vibrate' in navigator) {
    navigator.vibrate(200);
  }
}

interface OverrideConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blockingReasons: OverrideReason[];
  allReasons: OverrideReason[];
  onConfirm: () => void;
  onCancel: () => void;
}

export function OverrideConfirmModal({
  open,
  onOpenChange,
  blockingReasons,
  allReasons,
  onConfirm,
  onCancel,
}: OverrideConfirmModalProps) {
  // Haptic + audio on modal open
  useEffect(() => {
    if (open) {
      triggerHaptic();
      playWarningTone();
    }
  }, [open]);

  const hasMixedSource = allReasons.includes('MIXED_SOURCE_BATCH');

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="border-amber-300 dark:border-amber-800">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
            <MaterialIcon name="warning" size="md" />
            Location Warning
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              <ul className="list-disc pl-5 space-y-1 text-foreground">
                {blockingReasons.map((reason) => (
                  <li key={reason}>{REASON_MESSAGES[reason]}</li>
                ))}
              </ul>
              {hasMixedSource && (
                <p className="text-xs text-muted-foreground italic">
                  Note: Batch contains items from multiple source locations.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm}>
            Move Anyway
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
