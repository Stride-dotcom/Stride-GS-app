import { useState, useRef, useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from '@/lib/utils';

interface InlineEditableCellProps {
  value: string | number | null;
  suggestions?: string[];
  onSave: (newValue: string) => Promise<void>;
  placeholder?: string;
  type?: 'text' | 'number';
  className?: string;
  align?: 'left' | 'right';
  showEditIcon?: boolean;
}

export function InlineEditableCell({
  value,
  suggestions = [],
  onSave,
  placeholder = '-',
  type = 'text',
  className,
  align = 'left',
  showEditIcon = true,
}: InlineEditableCellProps) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(String(value ?? ''));
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setInputValue(String(value ?? ''));
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
    }
  }, [open, value]);

  const filteredSuggestions = useMemo(() => {
    if (type === 'number' || suggestions.length === 0) return [];
    const trimmed = String(inputValue).trim();
    if (!trimmed) return suggestions.slice(0, 20);
    const lower = trimmed.toLowerCase();
    return suggestions.filter(s => s.toLowerCase().includes(lower)).slice(0, 20);
  }, [inputValue, suggestions, type]);

  const isNewValue = type === 'text' && String(inputValue).trim() && suggestions.length > 0 &&
    !suggestions.some(s => s.toLowerCase() === String(inputValue).trim().toLowerCase());

  const displayValue = value !== null && value !== undefined && value !== '' ? String(value) : placeholder;

  const handleSelect = async (val: string) => {
    setSaving(true);
    try {
      await onSave(val);
      setOpen(false);
    } catch (e) {
      console.error('Failed to save:', e);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const trimmed = String(inputValue).trim();
      if (type === 'number') {
        // For numbers, allow saving even if empty (will be handled as 0 or cleared)
        handleSelect(trimmed || '0');
      } else if (trimmed) {
        handleSelect(trimmed);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const showSuggestionsList = type === 'text' && suggestions.length > 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          className={cn(
            "group flex items-center gap-1 cursor-default min-h-[24px] px-1 -mx-1 rounded hover:bg-muted/80 transition-colors",
            align === 'right' && "justify-end",
            className
          )}
          onClick={(e) => {
            e.stopPropagation();
          }}
          onDoubleClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
        >
          <span className={cn(
            "text-sm truncate",
            (value === null || value === undefined || value === '') && "text-muted-foreground"
          )}>
            {displayValue}
          </span>
          {showEditIcon && (
            <MaterialIcon name="edit" className="text-[12px] text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
          )}
        </div>
      </PopoverTrigger>
      <PopoverContent
        className={cn("p-2", showSuggestionsList ? "w-56" : "w-40")}
        align={align === 'right' ? 'end' : 'start'}
        side="bottom"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <Input
          ref={inputRef}
          type={type}
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={type === 'number' ? "Enter value..." : "Type to search or add..."}
          className={cn("h-8 text-sm", showSuggestionsList && "mb-1", type === 'number' && "text-right")}
          disabled={saving}
          min={type === 'number' ? 0 : undefined}
        />
        {showSuggestionsList && (
          <div className="max-h-40 overflow-y-auto">
            {isNewValue && (
              <button
                className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-left rounded hover:bg-muted/80 text-primary"
                onClick={() => handleSelect(String(inputValue).trim())}
                disabled={saving}
              >
                <MaterialIcon name="add" className="text-[12px]" />
                Add "{String(inputValue).trim()}"
              </button>
            )}
            {filteredSuggestions.map((suggestion) => (
              <button
                key={suggestion}
                className="flex items-center gap-2 w-full px-2 py-1.5 text-sm text-left rounded hover:bg-muted/80"
                onClick={() => handleSelect(suggestion)}
                disabled={saving}
              >
                {suggestion === String(value) && <MaterialIcon name="check" className="text-[12px] text-primary" />}
                {suggestion !== String(value) && <span className="w-3" />}
                <span className="truncate">{suggestion}</span>
              </button>
            ))}
            {filteredSuggestions.length === 0 && !isNewValue && (
              <p className="text-xs text-muted-foreground px-2 py-2">No matches found</p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
