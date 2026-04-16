/**
 * TaskServiceChips - Chip-based UI for selecting services on a task.
 *
 * - Selected services appear as compact chips
 * - "+ Add Service" opens a searchable picker inline
 * - Suggested services (from template) appear first
 * - Hover (*) icons show help text
 * - No tables, no modals for basic actions
 */

import { useState, useEffect, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { TaskServiceLine } from '@/hooks/useTaskServiceLines';

// =============================================================================
// TYPES
// =============================================================================

export interface ChargeTypeOption {
  id: string;
  charge_code: string;
  charge_name: string;
  category: string;
  input_mode: string;
  notes: string | null;
  is_suggested?: boolean;
}

interface TaskServiceChipsProps {
  serviceLines: TaskServiceLine[];
  availableServices: ChargeTypeOption[];
  suggestedChargeTypeIds: string[];
  onAdd: (service: ChargeTypeOption) => void;
  onRemove: (lineId: string) => void;
  disabled?: boolean;
  loading?: boolean;
}

// =============================================================================
// CATEGORY COLORS
// =============================================================================

const categoryColors: Record<string, string> = {
  receiving: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  storage: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
  handling: 'bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
  task: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300',
  shipping: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  service: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300',
};

function getCategoryColor(category: string): string {
  return categoryColors[category] || categoryColors.service;
}

// =============================================================================
// INPUT MODE LABELS
// =============================================================================

function getInputModeLabel(mode: string): string {
  switch (mode) {
    case 'qty': return 'Qty';
    case 'time': return 'Time';
    case 'both': return 'Qty+Time';
    default: return 'Qty';
  }
}

// =============================================================================
// COMPONENT
// =============================================================================

export function TaskServiceChips({
  serviceLines,
  availableServices,
  suggestedChargeTypeIds,
  onAdd,
  onRemove,
  disabled = false,
  loading = false,
}: TaskServiceChipsProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Close picker when disabled
  useEffect(() => {
    if (disabled) setPickerOpen(false);
  }, [disabled]);

  // Build the set of already-selected charge codes
  const selectedCodes = useMemo(
    () => new Set(serviceLines.map(sl => sl.charge_code)),
    [serviceLines],
  );

  // Filter and sort available services for the picker
  const filteredServices = useMemo(() => {
    const lowerSearch = search.toLowerCase().trim();

    // Filter out already-selected
    let available = availableServices.filter(s => !selectedCodes.has(s.charge_code));

    // Apply search filter
    if (lowerSearch) {
      available = available.filter(
        s =>
          s.charge_name.toLowerCase().includes(lowerSearch) ||
          s.charge_code.toLowerCase().includes(lowerSearch) ||
          s.category.toLowerCase().includes(lowerSearch),
      );
    }

    // Mark suggested
    const suggestedSet = new Set(suggestedChargeTypeIds);
    available = available.map(s => ({
      ...s,
      is_suggested: suggestedSet.has(s.id),
    }));

    // Sort: suggested first, then alphabetical
    available.sort((a, b) => {
      if (a.is_suggested && !b.is_suggested) return -1;
      if (!a.is_suggested && b.is_suggested) return 1;
      return a.charge_name.localeCompare(b.charge_name);
    });

    return available;
  }, [availableServices, selectedCodes, suggestedChargeTypeIds, search]);

  const handleSelect = (service: ChargeTypeOption) => {
    onAdd(service);
    setSearch('');
    setPickerOpen(false);
  };

  return (
    <div className="space-y-2">
      {/* Chips Row */}
      <div className="flex flex-wrap gap-2 min-h-[32px]">
        {serviceLines.length === 0 && !loading && (
          <span className="text-xs text-muted-foreground py-1">
            No services added yet
          </span>
        )}

        <TooltipProvider delayDuration={300}>
          {serviceLines.map(line => (
            <Tooltip key={line.id}>
              <TooltipTrigger asChild>
                <Badge
                  variant="secondary"
                  className={`
                    flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium cursor-default
                    ${getCategoryColor(availableServices.find(s => s.charge_code === line.charge_code)?.category || 'service')}
                  `}
                >
                  <span>{line.charge_name}</span>
                  <span className="text-[10px] opacity-60">
                    ({getInputModeLabel(line.input_mode)})
                  </span>
                  {!disabled && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(line.id);
                      }}
                      className="ml-0.5 hover:text-destructive transition-colors"
                    >
                      <MaterialIcon name="close" className="h-3 w-3" />
                    </button>
                  )}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-[250px]">
                <div className="space-y-1">
                  <p className="font-medium">{line.charge_name}</p>
                  <p className="text-xs">Code: {line.charge_code}</p>
                  <p className="text-xs">Input: {getInputModeLabel(line.input_mode)}</p>
                  {line.qty > 0 && <p className="text-xs">Qty: {line.qty}</p>}
                  {line.minutes > 0 && <p className="text-xs">Minutes: {line.minutes}</p>}
                </div>
              </TooltipContent>
            </Tooltip>
          ))}
        </TooltipProvider>

        {/* Add Service Button */}
        {!disabled && !pickerOpen && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs gap-1"
            onClick={() => setPickerOpen(true)}
          >
            <MaterialIcon name="add" className="h-3.5 w-3.5" />
            Add Service
          </Button>
        )}
      </div>

      {/* Searchable Picker (inline, not a modal) */}
      {pickerOpen && !disabled && (
        <div className="border rounded-lg bg-background shadow-sm">
          {/* Search input */}
          <div className="p-2 border-b">
            <div className="relative">
              <MaterialIcon
                name="search"
                className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"
              />
              <Input
                placeholder="Search services..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-8 pl-7 text-xs"
                autoFocus
              />
            </div>
          </div>

          {/* Results */}
          <div className="max-h-[200px] overflow-y-auto">
            {filteredServices.length === 0 ? (
              <div className="p-3 text-center text-xs text-muted-foreground">
                {search ? 'No matching services' : 'All services already added'}
              </div>
            ) : (
              filteredServices.map(service => (
                <button
                  key={service.id}
                  type="button"
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors text-xs"
                  onClick={() => handleSelect(service)}
                >
                  {service.is_suggested && (
                    <MaterialIcon
                      name="star"
                      className="h-3 w-3 text-amber-500 shrink-0"
                    />
                  )}
                  <span className="font-medium truncate flex-1">
                    {service.charge_name}
                  </span>
                  <span className="text-muted-foreground shrink-0">{service.charge_code}</span>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                    {service.category}
                  </Badge>
                </button>
              ))
            )}
          </div>

          {/* Close */}
          <div className="p-1.5 border-t">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full h-7 text-xs text-muted-foreground"
              onClick={() => {
                setPickerOpen(false);
                setSearch('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
