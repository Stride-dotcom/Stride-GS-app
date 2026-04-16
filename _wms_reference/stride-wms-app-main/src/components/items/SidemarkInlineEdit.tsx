import { useState, useRef, useEffect } from 'react';
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
import { useAccountSidemarks } from '@/hooks/useAccountSidemarks';

interface SidemarkInlineEditProps {
  value: string;
  accountId: string | null;
  onSave: (value: string) => Promise<boolean>;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function SidemarkInlineEdit({
  value,
  accountId,
  onSave,
  placeholder = 'Add sidemark',
  className,
  disabled = false,
}: SidemarkInlineEditProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [saving, setSaving] = useState(false);
  const { sidemarks, loading, addSidemark } = useAccountSidemarks(accountId);

  const handleSelect = async (selectedValue: string) => {
    setSaving(true);
    try {
      const success = await onSave(selectedValue);
      if (success) {
        setIsEditing(false);
        setSearchValue('');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleAddNew = async () => {
    if (!searchValue.trim()) return;
    
    setSaving(true);
    try {
      // Add to master list
      await addSidemark(searchValue.trim());
      // Then save to item
      const success = await onSave(searchValue.trim());
      if (success) {
        setIsEditing(false);
        setSearchValue('');
      }
    } finally {
      setSaving(false);
    }
  };

  const filteredSidemarks = sidemarks.filter(s =>
    s.sidemark.toLowerCase().includes(searchValue.toLowerCase())
  );

  const showAddNew = searchValue.trim() && 
    !filteredSidemarks.some(s => s.sidemark.toLowerCase() === searchValue.toLowerCase());

  if (disabled) {
    return (
      <span className={cn('text-sm', className)}>
        {value || <span className="text-muted-foreground">{placeholder}</span>}
      </span>
    );
  }

  return (
    <Popover open={isEditing} onOpenChange={setIsEditing}>
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
        <Command>
          <CommandInput
            placeholder="Search sidemarks..."
            value={searchValue}
            onValueChange={setSearchValue}
          />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <MaterialIcon name="progress_activity" size="sm" className="animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <CommandEmpty>
                  {showAddNew ? (
                    <button
                      onClick={handleAddNew}
                      disabled={saving}
                      className="flex items-center gap-2 w-full px-2 py-1.5 text-sm hover:bg-muted rounded-sm"
                    >
                      <MaterialIcon name="add" size="sm" />
                      Add "{searchValue}"
                    </button>
                  ) : (
                    <span className="text-muted-foreground">No sidemarks found</span>
                  )}
                </CommandEmpty>
                <CommandGroup>
                  {filteredSidemarks.map((s) => (
                    <CommandItem
                      key={s.id}
                      value={s.sidemark}
                      onSelect={() => handleSelect(s.sidemark)}
                      disabled={saving}
                    >
                      {s.sidemark}
                      {s.sidemark === value && (
                        <MaterialIcon name="check" size="sm" className="ml-auto" />
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
                {showAddNew && filteredSidemarks.length > 0 && (
                  <CommandGroup>
                    <CommandItem
                      onSelect={handleAddNew}
                      disabled={saving}
                      className="text-primary"
                    >
                      <MaterialIcon name="add" size="sm" className="mr-2" />
                      Add "{searchValue}"
                    </CommandItem>
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
        {value && (
          <div className="border-t p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-destructive hover:text-destructive"
              onClick={() => handleSelect('')}
              disabled={saving}
            >
              <MaterialIcon name="close" size="sm" className="mr-2" />
              Clear sidemark
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
