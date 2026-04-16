import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from '@/lib/utils';

interface InlineEditFieldProps {
  value: string;
  onSave: (value: string) => Promise<boolean>;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function InlineEditField({
  value,
  onSave,
  placeholder = 'Click to edit',
  className,
  disabled = false,
}: InlineEditFieldProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = async () => {
    if (editValue === value) {
      setIsEditing(false);
      return;
    }

    setSaving(true);
    try {
      const success = await onSave(editValue);
      if (success) {
        setIsEditing(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditValue(value);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    } else if (e.key === 'Escape') {
      handleCancel();
    }
  };

  if (disabled) {
    return (
      <span className={cn('text-sm', className)}>
        {value || <span className="text-muted-foreground">{placeholder}</span>}
      </span>
    );
  }

  if (isEditing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          ref={inputRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            // Small delay to allow button clicks to register
            setTimeout(() => {
              if (document.activeElement !== inputRef.current) {
                handleSave();
              }
            }, 150);
          }}
          className="h-7 text-sm"
          disabled={saving}
        />
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={handleSave}
          disabled={saving}
        >
          <MaterialIcon name="check" className="text-[12px]" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={handleCancel}
          disabled={saving}
        >
          <MaterialIcon name="close" className="text-[12px]" />
        </Button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setIsEditing(true)}
      className={cn(
        'group flex items-center gap-1 text-left hover:bg-muted/50 rounded px-1 -mx-1 py-0.5 transition-colors',
        className
      )}
    >
      <span className={cn('font-medium', !value && 'text-muted-foreground')}>
        {value || placeholder}
      </span>
      <MaterialIcon name="edit" className="text-[12px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}
