import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from '@/lib/utils';

export interface LocationPickerOption {
  id: string;
  code: string;
  name?: string | null;
}

interface LocationMultiPickerProps {
  options: LocationPickerOption[];
  selectedIds: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  emptyText?: string;
  searchPlaceholder?: string;
}

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    const value = String(id || '').trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

export function LocationMultiPicker({
  options,
  selectedIds,
  onChange,
  placeholder = 'Select locations…',
  disabled,
  className,
  emptyText = 'No locations found.',
  searchPlaceholder = 'Search locations…',
}: LocationMultiPickerProps) {
  const [open, setOpen] = useState(false);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);




  const selectedCodes = useMemo(() => {
    const byId = new Map(options.map((option) => [option.id, option.code]));
    return selectedIds.map((id) => byId.get(id)).filter(Boolean) as string[];
  }, [options, selectedIds]);

  const triggerLabel = useMemo(() => {
    if (selectedCodes.length === 0) return placeholder;
    if (selectedCodes.length <= 2) return selectedCodes.join(', ');
    return `${selectedCodes.length} locations selected`;
  }, [placeholder, selectedCodes]);

  const toggle = (locationId: string) => {
    if (selectedSet.has(locationId)) {
      onChange(selectedIds.filter((id) => id !== locationId));
      return;
    }
    onChange(uniqueIds([...selectedIds, locationId]));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn('w-full justify-between font-normal', className)}
          disabled={disabled}
        >
          <span className="truncate text-left">{triggerLabel}</span>
          <MaterialIcon name="unfold_more" size="sm" className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command shouldFilter>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="max-h-72">
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((option) => {
                const checked = selectedSet.has(option.id);
                return (
                  <CommandItem
                    key={option.id}
                    value={`${option.code} ${option.name || ''}`}
                    onSelect={() => toggle(option.id)}
                    className="gap-2"
                  >
                    <MaterialIcon
                      name="check"
                      size="sm"
                      className={cn(checked ? 'opacity-100' : 'opacity-0')}
                    />
                    <div className="min-w-0">
                      <div className="font-mono text-xs truncate">{option.code}</div>
                      {option.name ? (
                        <div className="text-[11px] text-muted-foreground truncate">{option.name}</div>
                      ) : null}
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="border-t p-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-center text-xs"
            onClick={() => onChange([])}
            disabled={disabled || selectedIds.length === 0}
          >
            Clear selected
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

