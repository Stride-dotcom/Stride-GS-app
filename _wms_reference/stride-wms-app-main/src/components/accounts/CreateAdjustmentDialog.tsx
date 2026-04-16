/**
 * CreateAdjustmentDialog - Create new pricing adjustments for an account
 * Supports multi-select services with autocomplete
 */

import { useState, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
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
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useAccountPricing, ServiceEvent, CreateAdjustmentInput } from '@/hooks/useAccountPricing';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface CreateAdjustmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  availableServices: ServiceEvent[];
  existingServiceKeys: Set<string>;
  onSuccess: () => void;
}

type AdjustmentType = 'fixed' | 'percentage' | 'override';

export function CreateAdjustmentDialog({
  open,
  onOpenChange,
  accountId,
  availableServices,
  existingServiceKeys,
  onSuccess,
}: CreateAdjustmentDialogProps) {
  const { createAdjustments, saving } = useAccountPricing(accountId);

  const [selectedServices, setSelectedServices] = useState<ServiceEvent[]>([]);
  const [adjustmentType, setAdjustmentType] = useState<AdjustmentType>('percentage');
  const [adjustmentValue, setAdjustmentValue] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Group services by service_code
  const groupedServices = useMemo(() => {
    const groups = new Map<string, ServiceEvent[]>();
    for (const service of availableServices) {
      const existing = groups.get(service.service_code) || [];
      existing.push(service);
      groups.set(service.service_code, existing);
    }
    return groups;
  }, [availableServices]);

  // Filter services based on search
  const filteredGroups = useMemo(() => {
    if (!searchQuery) return groupedServices;
    const query = searchQuery.toLowerCase();
    const filtered = new Map<string, ServiceEvent[]>();
    for (const [code, services] of groupedServices) {
      const matches = services.filter(
        (s) =>
          s.service_code.toLowerCase().includes(query) ||
          s.service_name.toLowerCase().includes(query)
      );
      if (matches.length > 0) {
        filtered.set(code, matches);
      }
    }
    return filtered;
  }, [groupedServices, searchQuery]);

  // Check for conflicts (services that already have adjustments)
  const conflicts = useMemo(() => {
    return selectedServices.filter((s) => {
      const key = `${s.service_code}|${s.class_code || ''}`;
      return existingServiceKeys.has(key);
    });
  }, [selectedServices, existingServiceKeys]);

  // Calculate preview
  const preview = useMemo(() => {
    const numValue = parseFloat(adjustmentValue) || 0;
    return selectedServices.map((service) => {
      const baseRate = service.rate ?? 0;
      let effectiveRate = baseRate;
      switch (adjustmentType) {
        case 'fixed':
          effectiveRate = baseRate + numValue;
          break;
        case 'percentage':
          effectiveRate = baseRate * (1 + numValue / 100);
          break;
        case 'override':
          effectiveRate = numValue;
          break;
      }
      return {
        service,
        baseRate,
        effectiveRate: Math.max(0, effectiveRate),
      };
    });
  }, [selectedServices, adjustmentType, adjustmentValue]);

  // Toggle service selection
  const toggleService = (service: ServiceEvent) => {
    const key = `${service.service_code}|${service.class_code || ''}`;
    const isSelected = selectedServices.some(
      (s) => s.service_code === service.service_code && s.class_code === service.class_code
    );
    if (isSelected) {
      setSelectedServices(
        selectedServices.filter(
          (s) => !(s.service_code === service.service_code && s.class_code === service.class_code)
        )
      );
    } else {
      setSelectedServices([...selectedServices, service]);
    }
  };

  // Remove selected service
  const removeService = (service: ServiceEvent) => {
    setSelectedServices(
      selectedServices.filter(
        (s) => !(s.service_code === service.service_code && s.class_code === service.class_code)
      )
    );
  };

  // Handle save
  const handleSave = async () => {
    // Filter out conflicts
    const validServices = selectedServices.filter((s) => {
      const key = `${s.service_code}|${s.class_code || ''}`;
      return !existingServiceKeys.has(key);
    });

    if (validServices.length === 0) return;

    const numValue = parseFloat(adjustmentValue) || 0;
    const inputs: CreateAdjustmentInput[] = validServices.map((service) => ({
      service_code: service.service_code,
      class_code: service.class_code,
      adjustment_type: adjustmentType,
      adjustment_value: numValue,
      notes: notes || undefined,
    }));

    const success = await createAdjustments(inputs);
    if (success) {
      // Reset form
      setSelectedServices([]);
      setAdjustmentType('percentage');
      setAdjustmentValue('');
      setNotes('');
      onSuccess();
    }
  };

  // Reset on close
  const handleClose = () => {
    setSelectedServices([]);
    setAdjustmentType('percentage');
    setAdjustmentValue('');
    setNotes('');
    setSearchQuery('');
    onOpenChange(false);
  };

  const validCount = selectedServices.length - conflicts.length;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent 
        className="max-w-2xl max-h-[90vh] overflow-y-auto"
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Create Pricing Adjustment</DialogTitle>
          <DialogDescription>
            Select services and define how their rates should be adjusted for this account.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Service Selection */}
          <div className="space-y-2">
            <Label>Services *</Label>
            <Popover open={searchOpen} onOpenChange={setSearchOpen} modal={true}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  role="combobox"
                  aria-expanded={searchOpen}
                  className="w-full justify-between"
                >
                  {selectedServices.length > 0
                    ? `${selectedServices.length} service${selectedServices.length !== 1 ? 's' : ''} selected`
                    : 'Select services...'}
                  <MaterialIcon name="unfold_more" size="sm" className="ml-2 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[500px] p-0" align="start">
                <Command shouldFilter={false}>
                  <CommandInput
                    placeholder="Search services..."
                    value={searchQuery}
                    onValueChange={setSearchQuery}
                  />
                  <CommandList>
                    <CommandEmpty>No services found.</CommandEmpty>
                    <ScrollArea className="h-[300px]">
                      {Array.from(filteredGroups.entries()).map(([code, services]) => (
                        <CommandGroup key={code} heading={code}>
                          {services.map((service) => {
                            const key = `${service.service_code}|${service.class_code || ''}`;
                            const isSelected = selectedServices.some(
                              (s) =>
                                s.service_code === service.service_code &&
                                s.class_code === service.class_code
                            );
                            const hasExisting = existingServiceKeys.has(key);
                            return (
                              <CommandItem
                                key={key}
                                value={key}
                                onSelect={() => toggleService(service)}
                                className={cn(hasExisting && 'opacity-50')}
                              >
                                <MaterialIcon
                                  name="check"
                                  size="sm"
                                  className={cn(
                                    'mr-2',
                                    isSelected ? 'opacity-100' : 'opacity-0'
                                  )}
                                />
                                <div className="flex-1">
                                  <span className="font-medium">{service.service_name}</span>
                                  {service.class_code && (
                                    <Badge variant="outline" className="ml-2 text-xs">
                                      {service.class_code}
                                    </Badge>
                                  )}
                                  {hasExisting && (
                                    <Badge variant="secondary" className="ml-2 text-xs">
                                      Has adjustment
                                    </Badge>
                                  )}
                                </div>
                                <span className="text-muted-foreground font-mono text-sm">
                                  ${(service.rate ?? 0).toFixed(2)}
                                </span>
                              </CommandItem>
                            );
                          })}
                        </CommandGroup>
                      ))}
                    </ScrollArea>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>

            {/* Selected Services Tags */}
            {selectedServices.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {selectedServices.map((service) => {
                  const key = `${service.service_code}|${service.class_code || ''}`;
                  const hasConflict = existingServiceKeys.has(key);
                  return (
                    <Badge
                      key={key}
                      variant={hasConflict ? 'destructive' : 'secondary'}
                      className="gap-1"
                    >
                      {service.service_code}
                      {service.class_code && ` (${service.class_code})`}
                      <button
                        onClick={() => removeService(service)}
                        className="ml-1 hover:bg-black/10 rounded-full"
                      >
                        <MaterialIcon name="close" className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })}
              </div>
            )}
          </div>

          {/* Conflict Warning */}
          {conflicts.length > 0 && (
            <Alert variant="destructive">
              <MaterialIcon name="warning" size="sm" />
              <AlertDescription>
                {conflicts.length} selected service{conflicts.length !== 1 ? 's' : ''} already{' '}
                {conflicts.length !== 1 ? 'have' : 'has'} adjustments and will be skipped:
                <span className="font-medium ml-1">
                  {conflicts.map((c) => c.service_code).join(', ')}
                </span>
              </AlertDescription>
            </Alert>
          )}

          {/* Adjustment Type */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Adjustment Type *</Label>
              <Select
                value={adjustmentType}
                onValueChange={(v) => setAdjustmentType(v as AdjustmentType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fixed">Fixed Amount (+/-)</SelectItem>
                  <SelectItem value="percentage">Percentage (+/-)</SelectItem>
                  <SelectItem value="override">Override Rate</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {adjustmentType === 'fixed' &&
                  'Adds or subtracts a dollar amount from the base rate'}
                {adjustmentType === 'percentage' &&
                  'Applies a percentage markup or discount to the base rate'}
                {adjustmentType === 'override' && 'Replaces the base rate entirely'}
              </p>
            </div>

            <div className="space-y-2">
              <Label>Adjustment Value *</Label>
              <div className="relative">
                {adjustmentType !== 'percentage' && (
                  <span className="absolute left-3 top-2.5 text-muted-foreground">$</span>
                )}
                <Input
                  type="number"
                  step={adjustmentType === 'percentage' ? '1' : '0.01'}
                  value={adjustmentValue}
                  onChange={(e) => setAdjustmentValue(e.target.value)}
                  className={cn(adjustmentType !== 'percentage' && 'pl-7')}
                  placeholder={
                    adjustmentType === 'percentage'
                      ? 'e.g., 10 for +10%, -10 for -10%'
                      : adjustmentType === 'fixed'
                      ? 'e.g., 5.00 or -2.50'
                      : 'e.g., 50.00'
                  }
                />
                {adjustmentType === 'percentage' && (
                  <span className="absolute right-3 top-2.5 text-muted-foreground">%</span>
                )}
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label>Notes (Optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for this adjustment..."
              rows={2}
            />
          </div>

          {/* Preview */}
          {selectedServices.length > 0 && adjustmentValue && (
            <div className="space-y-2">
              <Label>Preview</Label>
              <div className="border rounded-lg max-h-[200px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Service</TableHead>
                      <TableHead className="text-right">Base Rate</TableHead>
                      <TableHead className="text-right">Adjustment</TableHead>
                      <TableHead className="text-right">Effective Rate</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.slice(0, 10).map(({ service, baseRate, effectiveRate }) => {
                      const key = `${service.service_code}|${service.class_code || ''}`;
                      const hasConflict = existingServiceKeys.has(key);
                      return (
                        <TableRow
                          key={key}
                          className={cn(hasConflict && 'opacity-50 line-through')}
                        >
                          <TableCell>
                            {service.service_code}
                            {service.class_code && (
                              <Badge variant="outline" className="ml-2 text-xs">
                                {service.class_code}
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right font-mono text-muted-foreground">
                            ${baseRate.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {adjustmentType === 'percentage' && (
                              <span
                                className={cn(
                                  parseFloat(adjustmentValue) >= 0 ? 'text-red-600' : 'text-green-600'
                                )}
                              >
                                {parseFloat(adjustmentValue) >= 0 ? '+' : ''}
                                {adjustmentValue}%
                              </span>
                            )}
                            {adjustmentType === 'fixed' && (
                              <span
                                className={cn(
                                  parseFloat(adjustmentValue) >= 0 ? 'text-red-600' : 'text-green-600'
                                )}
                              >
                                {parseFloat(adjustmentValue) >= 0 ? '+' : ''}$
                                {parseFloat(adjustmentValue).toFixed(2)}
                              </span>
                            )}
                            {adjustmentType === 'override' && (
                              <span className="text-blue-600">override</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <MaterialIcon name="arrow_forward" className="h-3 w-3 text-muted-foreground" />
                              <span className="font-mono font-medium">
                                ${effectiveRate.toFixed(2)}
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                    {preview.length > 10 && (
                      <TableRow>
                        <TableCell colSpan={4} className="text-center text-muted-foreground">
                          ... and {preview.length - 10} more
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || validCount === 0 || !adjustmentValue}
          >
            {saving && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
            Create {validCount > 0 ? `${validCount} ` : ''}Adjustment
            {validCount !== 1 ? 's' : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
