import { useState, useEffect, useCallback } from 'react';
import { Button, ButtonProps } from '@/components/ui/button';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from '@/lib/utils';

interface SaveButtonProps extends Omit<ButtonProps, 'onClick'> {
  /** The async save handler */
  onClick: () => Promise<void> | void;
  /** Label while idle (default: "Save") */
  label?: string;
  /** Label while saving (default: "Saving...") */
  savingLabel?: string;
  /** Label after saved (default: "Saved") */
  savedLabel?: string;
  /** Icon name for idle state (default: "save") */
  icon?: string;
  /** Whether save was successful externally (controlled mode) */
  saved?: boolean;
  /** Duration in ms to show saved state (default: 2500) */
  savedDuration?: number;
  /** Additional disabled condition */
  saveDisabled?: boolean;
}

export function SaveButton({
  onClick,
  label = 'Save',
  savingLabel = 'Saving...',
  savedLabel = 'Saved',
  icon = 'save',
  saved: externalSaved,
  savedDuration = 2500,
  saveDisabled,
  className,
  variant,
  size,
  ...props
}: SaveButtonProps) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Allow external control of saved state
  useEffect(() => {
    if (externalSaved) {
      setSaved(true);
    }
  }, [externalSaved]);

  // Auto-reset saved state after duration
  useEffect(() => {
    if (!saved) return;
    const timer = setTimeout(() => setSaved(false), savedDuration);
    return () => clearTimeout(timer);
  }, [saved, savedDuration]);

  const handleClick = useCallback(async () => {
    if (saving || saved) return;
    setSaving(true);
    try {
      await onClick();
      setSaved(true);
    } catch {
      // Error handling is expected to be in the onClick handler
    } finally {
      setSaving(false);
    }
  }, [onClick, saving, saved]);

  const isDisabled = saving || saved || saveDisabled || props.disabled;

  return (
    <Button
      {...props}
      variant={saved ? 'outline' : (variant || 'default')}
      size={size}
      className={cn(
        saved && 'border-green-500 text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400 dark:border-green-600 hover:bg-green-50 dark:hover:bg-green-950/30',
        className,
      )}
      onClick={handleClick}
      disabled={isDisabled}
    >
      {saving ? (
        <>
          <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
          {savingLabel}
        </>
      ) : saved ? (
        <>
          <MaterialIcon name="check_circle" size="sm" className="mr-2" />
          {savedLabel}
        </>
      ) : (
        <>
          {icon && <MaterialIcon name={icon} size="sm" className="mr-2" />}
          {label}
        </>
      )}
    </Button>
  );
}
