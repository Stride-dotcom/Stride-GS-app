import { useState, useRef, useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from '@/lib/utils';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { useAccountRoomSuggestions } from '@/hooks/useAccountRoomSuggestions';

interface RoomInlineEditProps {
  value: string;
  accountId: string | null;
  onSave: (value: string) => Promise<boolean>;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function RoomInlineEdit({
  value,
  accountId,
  onSave,
  placeholder = 'Add room',
  className,
  disabled = false,
}: RoomInlineEditProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const [saving, setSaving] = useState(false);
  const { rooms, loading, addOrUpdateRoom } = useAccountRoomSuggestions(accountId);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setInputValue(value);
  }, [value]);

  const filteredSuggestions = useMemo(() => {
    if (!inputValue) return rooms;
    return rooms.filter(s =>
      s.room.toLowerCase().includes(inputValue.toLowerCase())
    );
  }, [rooms, inputValue]);

  const handleSave = async (newValue: string) => {
    if (newValue === value) {
      setIsEditing(false);
      return;
    }

    setSaving(true);
    try {
      const success = await onSave(newValue);
      if (success) {
        // Record usage for autocomplete
        if (newValue.trim() && accountId) {
          await addOrUpdateRoom(newValue.trim());
        }
        setIsEditing(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSelect = (selectedValue: string) => {
    setInputValue(selectedValue);
    handleSave(selectedValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSave(inputValue);
    } else if (e.key === 'Escape') {
      setInputValue(value);
      setIsEditing(false);
    }
  };

  if (disabled) {
    return (
      <span className={cn('text-sm', className)}>
        {value || <span className="text-muted-foreground">{placeholder}</span>}
      </span>
    );
  }

  return (
    <Popover open={isEditing} onOpenChange={(open) => {
      setIsEditing(open);
      if (!open && inputValue !== value) {
        handleSave(inputValue);
      }
    }}>
      <PopoverTrigger asChild>
        <button
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
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <div className="p-2 border-b">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Enter room name..."
            className="h-8"
            autoFocus
          />
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <MaterialIcon name="progress_activity" size="sm" className="animate-spin text-muted-foreground" />
          </div>
        ) : filteredSuggestions.length > 0 ? (
          <div className="max-h-48 overflow-y-auto p-1">
            {filteredSuggestions.map((s) => (
              <button
                key={s.id}
                onClick={() => handleSelect(s.room)}
                disabled={saving}
                className={cn(
                  'flex items-center justify-between w-full px-2 py-1.5 text-sm rounded-sm hover:bg-muted',
                  s.room === value && 'bg-muted'
                )}
              >
                <span>{s.room}</span>
                {s.room === value && (
                  <MaterialIcon name="check" size="sm" className="text-primary" />
                )}
              </button>
            ))}
          </div>
        ) : inputValue ? (
          <div className="p-2 text-center text-sm text-muted-foreground">
            Press Enter to save "{inputValue}"
          </div>
        ) : (
          <div className="p-2 text-center text-sm text-muted-foreground">
            No previous rooms found
          </div>
        )}
        <div className="border-t p-2 flex gap-2">
          <Button
            size="sm"
            className="flex-1"
            onClick={() => handleSave(inputValue)}
            disabled={saving}
          >
            {saving ? <MaterialIcon name="progress_activity" size="sm" className="animate-spin" /> : <MaterialIcon name="check" size="sm" className="mr-2" />}
            Save
          </Button>
          {value && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleSave('')}
              disabled={saving}
            >
              <MaterialIcon name="close" size="sm" />
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
