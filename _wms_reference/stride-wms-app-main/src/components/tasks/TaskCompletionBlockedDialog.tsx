import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { TaskCompletionValidationResult, formatMissingRate } from '@/lib/billing/taskCompletionValidation';

interface TaskCompletionBlockedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  validationResult: TaskCompletionValidationResult | null;
  onGoToItems?: () => void;
}

export function TaskCompletionBlockedDialog({
  open,
  onOpenChange,
  validationResult,
  onGoToItems,
}: TaskCompletionBlockedDialogProps) {
  if (!validationResult) return null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <MaterialIcon name="block" className="text-red-600 dark:text-red-400" />
            </div>
            <AlertDialogTitle>Cannot Complete Task</AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-left mt-4">
            This task cannot be completed because required data is missing.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-4 py-2">
          {/* Missing Items */}
          {validationResult.missingItems && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/50">
              <div className="flex gap-3">
                <MaterialIcon name="inventory_2" className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-red-800 dark:text-red-200">No Items Attached</p>
                  <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                    This task requires at least one item. Add items to the task before completing.
                  </p>
                  <button
                    type="button"
                    className="mt-2 text-xs text-red-600 dark:text-red-400 flex items-center gap-1 hover:underline cursor-pointer"
                    onClick={() => {
                      onOpenChange(false);
                      onGoToItems?.();
                    }}
                  >
                    <MaterialIcon name="arrow_forward" size="sm" />
                    <span>Go to Items tab to add items</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Missing Rates */}
          {validationResult.missingRates.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-950/50">
              <div className="flex gap-3">
                <MaterialIcon name="attach_money" className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-red-800 dark:text-red-200">Missing Pricing Rates</p>
                  <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                    Billing rates are not set for the following:
                  </p>
                  <ul className="mt-2 space-y-1">
                    {validationResult.missingRates.map((rate, idx) => (
                      <li
                        key={idx}
                        className="text-sm text-red-700 dark:text-red-300 flex items-center gap-2"
                      >
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                        {formatMissingRate(rate)}
                        {rate.item_code && (
                          <span className="text-red-500 text-xs">({rate.item_code})</span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-2 text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                    <MaterialIcon name="arrow_forward" size="sm" />
                    <span>Go to Settings → Pricing to set rates</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogAction onClick={() => onOpenChange(false)}>
            Understood
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
