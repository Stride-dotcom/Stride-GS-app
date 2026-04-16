import * as React from 'react';
import { Input } from '@/components/ui/input';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverAnchor,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';

interface AutocompleteInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
  suggestions: { value: string; label?: string }[];
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  className?: string;
}

export function AutocompleteInput({
  suggestions,
  value,
  onChange,
  onBlur,
  placeholder,
  className,
  ...props
}: AutocompleteInputProps) {
  const [open, setOpen] = React.useState(false);
  const [inputValue, setInputValue] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Sync inputValue with value prop
  React.useEffect(() => {
    setInputValue(value);
  }, [value]);

  const filteredSuggestions = React.useMemo(() => {
    if (!inputValue.trim()) return suggestions.slice(0, 10);
    
    const query = inputValue.toLowerCase();
    return suggestions
      .filter(s => s.value.toLowerCase().includes(query))
      .slice(0, 10);
  }, [suggestions, inputValue]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onChange(newValue);
    
    // Open suggestions when typing
    if (suggestions.length > 0) {
      setOpen(true);
    }
  };

  const handleSelect = (selectedValue: string) => {
    setInputValue(selectedValue);
    onChange(selectedValue);
    setOpen(false);
    inputRef.current?.focus();
  };

  const handleBlur = () => {
    // Delay closing to allow click on suggestion
    setTimeout(() => {
      setOpen(false);
      onBlur?.();
    }, 150);
  };

  const handleFocus = () => {
    if (suggestions.length > 0) {
      setOpen(true);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          ref={inputRef}
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={placeholder}
          className={cn(className)}
          {...props}
        />
      </PopoverAnchor>
      <PopoverContent 
        className="w-[--radix-popover-trigger-width] p-0 z-50 bg-popover border shadow-md" 
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          // Don't close if clicking on the input
          if (inputRef.current?.contains(e.target as Node)) {
            e.preventDefault();
          }
        }}
      >
        <Command>
          <CommandList>
            {filteredSuggestions.length === 0 ? (
              <CommandEmpty className="py-2 text-center text-sm text-muted-foreground">
                No suggestions
              </CommandEmpty>
            ) : (
              <CommandGroup>
                {filteredSuggestions.map((suggestion, index) => (
                  <CommandItem
                    key={`${suggestion.value}-${index}`}
                    value={suggestion.value}
                    onSelect={() => handleSelect(suggestion.value)}
                    className="cursor-pointer"
                  >
                    {suggestion.label || suggestion.value}
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
