import { useState, useEffect } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
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
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface SelectOption {
  value: string;
  label: string;
}

interface AccountSelectProps {
  value?: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  className?: string;
}

/**
 * Reusable account selector that fetches accounts for the current tenant.
 */
export function AccountSelect({
  value,
  onChange,
  placeholder = 'Select account...',
  disabled = false,
  clearable = true,
  className,
}: AccountSelectProps) {
  const { profile } = useAuth();
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const fetchAccounts = async () => {
    if (!profile?.tenant_id) return;

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('accounts')
        .select('id, account_name, account_code')
        .eq('tenant_id', profile.tenant_id)
        .is('deleted_at', null)
        .order('account_name');

      if (error) {
        console.error('Error fetching accounts:', error);
        return;
      }

      setOptions(
        (data || []).map((a) => ({
          value: a.id,
          label: a.account_code ? `${a.account_name} (${a.account_code})` : a.account_name,
        }))
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAccounts();
  }, [profile?.tenant_id]);

  const filteredOptions = search
    ? options.filter((opt) => opt.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const selectedOption = options.find((opt) => opt.value === value);

  const handleSelect = (selectedValue: string) => {
    if (selectedValue === value && clearable) {
      onChange('');
    } else {
      onChange(selectedValue);
    }
    setOpen(false);
    setSearch('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || loading}
          className={cn(
            'w-full min-h-[44px] justify-between font-normal text-base',
            className
          )}
        >
          <span className="truncate">
            {loading ? (
              <span className="flex items-center gap-2">
                <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                Loading...
              </span>
            ) : (
              selectedOption?.label || (
                <span className="text-muted-foreground">{placeholder}</span>
              )
            )}
          </span>
          <MaterialIcon name="unfold_more" size="sm" className="ml-2 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>

      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[200px] p-0"
        align="start"
        sideOffset={4}
        style={{ zIndex: 100 }}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search accounts..."
            value={search}
            onValueChange={setSearch}
            className="text-base"
          />
          <CommandList className="max-h-[280px] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-6">
                <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                {filteredOptions.length === 0 && (
                  <CommandEmpty>No accounts found</CommandEmpty>
                )}

                {/* Existing options */}
                {filteredOptions.length > 0 && (
                  <CommandGroup>
                    {filteredOptions.map((opt) => (
                      <CommandItem
                        key={opt.value}
                        value={opt.value}
                        onSelect={() => handleSelect(opt.value)}
                        className="min-h-[44px]"
                      >
                        <MaterialIcon
                          name="check"
                          size="sm"
                          className={cn(
                            'mr-2 shrink-0',
                            value === opt.value ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        <span className="truncate">{opt.label}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}

                {/* Clear option */}
                {clearable && value && (
                  <CommandGroup>
                    <CommandItem
                      value="__clear__"
                      onSelect={() => handleSelect('')}
                      className="min-h-[44px] text-muted-foreground"
                    >
                      Clear selection
                    </CommandItem>
                  </CommandGroup>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export default AccountSelect;
