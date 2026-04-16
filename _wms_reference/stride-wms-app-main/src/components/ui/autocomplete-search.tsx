import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';

export interface AutocompleteSuggestion {
  value: string;
  label?: string;
}

interface AutocompleteSearchProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  suggestions?: AutocompleteSuggestion[];
  emptyMessage?: string;
  maxSuggestions?: number;
}

/**
 * AutocompleteSearchInput
 * - Free-text input (does NOT constrain to suggestions)
 * - Shows a dropdown of suggestions as you type
 * - Uses a portal-based Popover so it won't be clipped by tables/cards
 */
export function AutocompleteSearchInput({
  value,
  onValueChange,
  placeholder = 'Search...',
  disabled = false,
  className,
  suggestions = [],
  emptyMessage = 'No suggestions',
  maxSuggestions = 8,
}: AutocompleteSearchProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dropdownWidth, setDropdownWidth] = useState<number | undefined>(undefined);

  const shownSuggestions = useMemo(
    () => suggestions.filter((s) => s.value).slice(0, maxSuggestions),
    [suggestions, maxSuggestions]
  );

  const canShow = !disabled && (value.trim().length > 0 || shownSuggestions.length > 0);
  const isOpen = open && canShow;

  // Avoid stale open state when the popover cannot be shown.
  useEffect(() => {
    if (!canShow && open) setOpen(false);
  }, [canShow, open]);

  // Keep popover width synced to the input
  useEffect(() => {
    if (!isOpen) return;
    const update = () => {
      const width = anchorRef.current?.getBoundingClientRect().width;
      if (width && Number.isFinite(width)) setDropdownWidth(width);
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [isOpen]);

  return (
    <Popover open={isOpen} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div ref={anchorRef} className={cn('relative', className)} data-autocomplete-anchor>
          <MaterialIcon
            name="search"
            size="sm"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            ref={inputRef}
            placeholder={placeholder}
            value={value}
            disabled={disabled}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onChange={(e) => {
              onValueChange(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
            }}
            className="pl-10"
            autoComplete="off"
            spellCheck={false}
          />
        </div>
      </PopoverAnchor>

      <PopoverContent
        align="start"
        sideOffset={4}
        className="p-0"
        style={{ width: dropdownWidth, zIndex: 100 } as CSSProperties}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('[data-autocomplete-anchor]')) {
            e.preventDefault();
          }
        }}
      >
        <Command shouldFilter={false}>
          <CommandList className="max-h-[260px] overflow-y-auto">
            {shownSuggestions.length === 0 ? (
              <CommandEmpty>{emptyMessage}</CommandEmpty>
            ) : (
              <CommandGroup>
                {shownSuggestions.map((s) => (
                  <CommandItem
                    key={s.value}
                    value={s.value}
                    onSelect={() => {
                      onValueChange(s.value);
                      setOpen(false);
                      // Keep focus so you can continue typing immediately
                      setTimeout(() => inputRef.current?.focus(), 0);
                    }}
                    className="min-h-[40px] cursor-pointer"
                  >
                    <span className="truncate">{s.label || s.value}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

