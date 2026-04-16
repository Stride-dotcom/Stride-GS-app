/**
 * TaskServiceLinesEditor - Compact editor for task service lines with inline qty editing.
 *
 * - Each service line shows as a row/card with editable quantity
 * - Shows per-unit rate and line total (when showRates is true)
 * - "+ Add Service" opens an inline searchable picker
 * - Mobile-first design with vertical stacking on narrow screens
 */

import { useState, useEffect, useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useToast } from '@/hooks/use-toast';
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

export interface RateInfo {
  rate: number;
  serviceName: string;
  hasError: boolean;
}

interface TaskServiceLinesEditorProps {
  serviceLines: TaskServiceLine[];
  availableServices: ChargeTypeOption[];
  suggestedChargeTypeIds: string[];
  onAdd: (service: ChargeTypeOption) => void;
  onRemove: (lineId: string) => void;
  onUpdate: (lineId: string, updates: { qty?: number; minutes?: number }) => Promise<boolean>;
  // Rate lookup for live totals (optional — only shown when user has billing permission)
  rates?: Map<string, RateInfo>;
  showRates?: boolean;
  loading?: boolean;
  disabled?: boolean;
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
// CURRENCY FORMATTING
// =============================================================================

const formatCurrency = (amount: number) => {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};

// =============================================================================
// COMPONENT
// =============================================================================

export function TaskServiceLinesEditor({
  serviceLines,
  availableServices,
  suggestedChargeTypeIds,
  onAdd,
  onRemove,
  onUpdate,
  rates,
  showRates = false,
  loading = false,
  disabled = false,
}: TaskServiceLinesEditorProps) {
  const { toast } = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  // Local qty/minutes state for controlled inputs (allows typing without immediate save)
  const [localQtys, setLocalQtys] = useState<Record<string, string>>({});
  const [localMins, setLocalMins] = useState<Record<string, string>>({});

  // Initialize local qty/minutes state from service lines
  useEffect(() => {
    const newLocalQtys: Record<string, string> = {};
    const newLocalMins: Record<string, string> = {};
    serviceLines.forEach(line => {
      // Only initialize if we don't already have a local value (preserves user edits)
      if (localQtys[line.id] === undefined) {
        newLocalQtys[line.id] = String(line.qty || 1);
      } else {
        newLocalQtys[line.id] = localQtys[line.id];
      }
      if (localMins[line.id] === undefined) {
        newLocalMins[line.id] = String(line.minutes || 0);
      } else {
        newLocalMins[line.id] = localMins[line.id];
      }
    });
    setLocalQtys(newLocalQtys);
    setLocalMins(newLocalMins);
  }, [serviceLines.map(l => l.id).join(',')]); // Re-init when line IDs change

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

  const handleQtyChange = (lineId: string, value: string) => {
    setLocalQtys(prev => ({ ...prev, [lineId]: value }));
  };

  const handleQtyBlur = async (lineId: string, originalQty: number) => {
    const localValue = localQtys[lineId] ?? String(originalQty);
    const parsed = parseFloat(localValue);

    // Round to 2 decimal places
    const rounded = isNaN(parsed) || parsed < 0 ? originalQty : Math.round(parsed * 100) / 100;

    if (rounded === originalQty) {
      // No change, just normalize the display
      setLocalQtys(prev => ({ ...prev, [lineId]: String(rounded) }));
      return;
    }

    // Attempt update
    const success = await onUpdate(lineId, { qty: rounded });
    if (!success) {
      // Revert to original value
      setLocalQtys(prev => ({ ...prev, [lineId]: String(originalQty) }));
      toast({
        variant: 'destructive',
        title: 'Update failed',
        description: 'Failed to update service line. Please try again.',
      });
    } else {
      // Normalize the display value
      setLocalQtys(prev => ({ ...prev, [lineId]: String(rounded) }));
    }
  };

  const handleMinsChange = (lineId: string, value: string) => {
    setLocalMins(prev => ({ ...prev, [lineId]: value }));
  };

  const handleMinsBlur = async (lineId: string, originalMins: number) => {
    const localValue = localMins[lineId] ?? String(originalMins);
    const parsed = parseInt(localValue, 10);
    const rounded = isNaN(parsed) || parsed < 0 ? originalMins : parsed;

    if (rounded === originalMins) {
      setLocalMins(prev => ({ ...prev, [lineId]: String(rounded) }));
      return;
    }

    const success = await onUpdate(lineId, { minutes: rounded });
    if (!success) {
      setLocalMins(prev => ({ ...prev, [lineId]: String(originalMins) }));
      toast({
        variant: 'destructive',
        title: 'Update failed',
        description: 'Failed to update service time. Please try again.',
      });
    } else {
      setLocalMins(prev => ({ ...prev, [lineId]: String(rounded) }));
    }
  };

  // Calculate subtotal
  const subtotal = useMemo(() => {
    if (!showRates || !rates) return 0;
    return serviceLines.reduce((sum, line) => {
      const rateInfo = rates.get(line.charge_code);
      if (!rateInfo || rateInfo.hasError) return sum;
      return sum + (line.qty || 1) * rateInfo.rate;
    }, 0);
  }, [serviceLines, rates, showRates]);

  return (
    <div className="space-y-3 min-w-0">
      {/* Service Lines List */}
      <div className="space-y-2 overflow-x-auto">
        {serviceLines.length === 0 && !loading && (
          <div className="text-xs text-muted-foreground py-2 text-center">
            No services added yet
          </div>
        )}

        {serviceLines.map(line => {
          const rateInfo = rates?.get(line.charge_code);
          const category = availableServices.find(s => s.charge_code === line.charge_code)?.category || 'service';
          const localQtyValue = localQtys[line.id] ?? String(line.qty || 1);
          const qty = parseFloat(localQtyValue) || line.qty || 1;
          const lineTotal = rateInfo && !rateInfo.hasError ? qty * rateInfo.rate : 0;

          const showQty = line.input_mode === 'qty' || line.input_mode === 'both';
          const showTime = line.input_mode === 'time' || line.input_mode === 'both';
          const localMinsValue = localMins[line.id] ?? String(line.minutes || 0);

          return (
            <div
              key={line.id}
              className="border rounded-lg p-2.5 bg-muted/30 space-y-2"
            >
              {/* Row 1: Service name + code badge */}
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-sm truncate flex-1 min-w-0">
                  {line.charge_name}
                </span>
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 shrink-0 ${getCategoryColor(category)}`}
                >
                  {line.charge_code}
                </Badge>
              </div>

              {/* Row 2: Qty/Time inputs + rate/total + remove button */}
              <div className="flex items-center gap-2">
                {/* Qty input */}
                {showQty && (
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-muted-foreground">Qty:</label>
                  <Input
                    type="number"
                    step="0.25"
                    min="0"
                    value={localQtyValue}
                    onChange={(e) => handleQtyChange(line.id, e.target.value)}
                    onBlur={() => handleQtyBlur(line.id, line.qty || 1)}
                    disabled={disabled}
                    className="h-7 w-16 text-sm text-center"
                  />
                </div>
                )}

                {/* Time/minutes input */}
                {showTime && (
                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-muted-foreground">Min:</label>
                  <Input
                    type="number"
                    step="1"
                    min="0"
                    value={localMinsValue}
                    onChange={(e) => handleMinsChange(line.id, e.target.value)}
                    onBlur={() => handleMinsBlur(line.id, line.minutes || 0)}
                    disabled={disabled}
                    className="h-7 w-16 text-sm text-center"
                  />
                </div>
                )}

                {/* Rate and total (only if showRates) */}
                {showRates && (
                  <div className="flex items-center gap-2 text-xs flex-1 justify-end min-w-0">
                    {rateInfo?.hasError ? (
                      <span className="text-muted-foreground italic">No rate</span>
                    ) : rateInfo ? (
                      <>
                        <span className="text-muted-foreground">
                          @ {formatCurrency(rateInfo.rate)}
                        </span>
                        <span className="font-medium">
                          = {formatCurrency(lineTotal)}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground italic">Loading...</span>
                    )}
                  </div>
                )}

                {/* Remove button */}
                {!disabled && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => onRemove(line.id)}
                  >
                    <MaterialIcon name="delete" className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Subtotal (only if showRates and has lines) */}
      {showRates && serviceLines.length > 0 && (
        <div className="flex items-center justify-between pt-2 border-t text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="font-semibold">{formatCurrency(subtotal)}</span>
        </div>
      )}

      {/* Add Service Button / Picker */}
      {!disabled && !pickerOpen && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full h-8 text-xs gap-1"
          onClick={() => setPickerOpen(true)}
        >
          <MaterialIcon name="add" className="h-3.5 w-3.5" />
          Add Service
        </Button>
      )}

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
                  <span className="font-medium truncate flex-1 min-w-0">
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
