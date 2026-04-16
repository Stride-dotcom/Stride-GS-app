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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

interface SelectOption {
  value: string;
  label: string;
}

interface SidemarkSelectProps {
  accountId?: string | null;
  value?: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  clearable?: boolean;
  className?: string;
  allowCreate?: boolean;
}

/**
 * Reusable sidemark selector that fetches sidemarks for a given account.
 * Falls back to tenant-wide sidemarks if no accountId is provided.
 * Supports creating new sidemarks inline when allowCreate is true.
 */
export function SidemarkSelect({
  accountId,
  value,
  onChange,
  placeholder = 'Select sidemark...',
  disabled = false,
  clearable = true,
  className,
  allowCreate = false,
}: SidemarkSelectProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newSidemarkName, setNewSidemarkName] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchSidemarks = async () => {
    if (!profile?.tenant_id) return;

    setLoading(true);
    try {
      let query = supabase
        .from('sidemarks')
        .select('id, sidemark_name, sidemark_code')
        .eq('tenant_id', profile.tenant_id)
        .is('deleted_at', null)
        .order('sidemark_name');

      if (accountId) {
        query = query.eq('account_id', accountId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching sidemarks:', error);
        return;
      }

      setOptions(
        (data || []).map((s) => ({
          value: s.id,
          label: s.sidemark_code ? `${s.sidemark_name} (${s.sidemark_code})` : s.sidemark_name,
        }))
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSidemarks();
  }, [profile?.tenant_id, accountId]);

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

  const handleCreateNew = () => {
    setNewSidemarkName(search);
    setCreateDialogOpen(true);
  };

  const handleCreateSidemark = async () => {
    if (!profile?.tenant_id || !accountId || !newSidemarkName.trim()) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: accountId ? 'Please enter a sidemark name' : 'Account is required to create a sidemark',
      });
      return;
    }

    setCreating(true);
    try {
      const { data, error } = await supabase
        .from('sidemarks')
        .insert([{
          tenant_id: profile.tenant_id,
          account_id: accountId,
          sidemark_name: newSidemarkName.trim(),
        }])
        .select()
        .single();

      if (error) throw error;

      toast({
        title: 'Sidemark Created',
        description: `"${newSidemarkName.trim()}" has been added.`,
      });

      // Refresh options and select the new sidemark
      await fetchSidemarks();
      onChange(data.id);
      setCreateDialogOpen(false);
      setOpen(false);
      setSearch('');
      setNewSidemarkName('');
    } catch (error) {
      console.error('Error creating sidemark:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to create sidemark',
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <>
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
              placeholder="Search sidemarks..."
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
                  {filteredOptions.length === 0 && !allowCreate && (
                    <CommandEmpty>No sidemarks found</CommandEmpty>
                  )}

                  {/* Add New option */}
                  {allowCreate && accountId && (
                    <CommandGroup>
                      <CommandItem
                        value="__create_new__"
                        onSelect={handleCreateNew}
                        className="min-h-[44px] text-primary"
                      >
                        <MaterialIcon name="add" size="sm" className="mr-2" />
                        <span>Add new sidemark{search ? `: "${search}"` : ''}</span>
                      </CommandItem>
                    </CommandGroup>
                  )}

                  {/* Existing options */}
                  {filteredOptions.length > 0 && (
                    <CommandGroup heading={allowCreate ? 'Existing' : undefined}>
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

      {/* Create Sidemark Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Add New Sidemark</DialogTitle>
            <DialogDescription>
              Create a new sidemark for this account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="sidemark-name">Sidemark Name</Label>
              <Input
                id="sidemark-name"
                value={newSidemarkName}
                onChange={(e) => setNewSidemarkName(e.target.value)}
                placeholder="e.g., Living Room, Project Alpha"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateSidemark} disabled={creating || !newSidemarkName.trim()}>
              {creating && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default SidemarkSelect;
