import * as React from "react";
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { AutocompleteInput } from "@/components/ui/autocomplete-input";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Mobile-first expected item card for shipment creation
 * Field order: Qty + Vendor → Description → Class + Sidemark + Room
 */

export interface ClassOption {
  id: string;
  code: string;
  name: string;
}

export interface ExpectedItemData {
  id: string;
  description: string;
  vendor: string;
  quantity: number;
  classId?: string;
  classCode?: string;
  sidemark?: string;
  room?: string;
}

export interface ExpectedItemErrors {
  description?: string;
  classCode?: string;
  quantity?: string;
}

export interface ExpectedItemCardProps {
  item: ExpectedItemData;
  index: number;
  vendorSuggestions: string[];
  descriptionSuggestions?: { value: string; label: string }[];
  sidemarkSuggestions?: { value: string; label: string }[];
  roomSuggestions?: { value: string; label: string }[];
  classes?: ClassOption[];
  classOptional?: boolean;
  errors?: ExpectedItemErrors;
  canDelete: boolean;
  onUpdate: (id: string, field: keyof ExpectedItemData, value: string | number) => void;
  onDelete: (id: string) => void;
  onDuplicate?: (item: ExpectedItemData) => void;
  onVendorUsed?: (value: string) => void;
}

export function ExpectedItemCard({
  item,
  index,
  vendorSuggestions,
  descriptionSuggestions = [],
  sidemarkSuggestions = [],
  roomSuggestions = [],
  classes = [],
  classOptional = false,
  errors,
  canDelete,
  onUpdate,
  onDelete,
  onDuplicate,
  onVendorUsed,
}: ExpectedItemCardProps) {
  const vendorSuggestionOptions = React.useMemo(
    () => vendorSuggestions.map((v) => ({ value: v, label: v })),
    [vendorSuggestions]
  );

  const classSuggestionOptions = React.useMemo(
    () => classes.map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` })),
    [classes]
  );

  const handleClassChange = (code: string) => {
    const matchedClass = classes.find(c => c.code === code);
    onUpdate(item.id, "classCode", code);
    onUpdate(item.id, "classId", matchedClass?.id || "");
  };

  return (
    <Card className="relative">
      <CardContent className="pt-4 pb-4 space-y-4">
        {/* Item header with number, duplicate, and delete */}
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">
            Item {index + 1}
          </span>
          <div className="flex items-center gap-1">
            {onDuplicate && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onDuplicate(item)}
                className="h-8 w-8"
                title="Duplicate item"
              >
                <MaterialIcon name="content_copy" size="sm" className="text-muted-foreground" />
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onDelete(item.id)}
              disabled={!canDelete}
              className="h-8 w-8"
              title="Delete item"
            >
              <MaterialIcon name="delete" size="sm" className={cn(
                canDelete ? "text-destructive" : "text-muted-foreground"
              )} />
            </Button>
          </div>
        </div>

        {/* Row 1: Quantity and Vendor */}
        <div className="grid grid-cols-2 gap-3">
          <FormField
            label="Qty"
            name={`item-${item.id}-quantity`}
            type="number"
            value={item.quantity}
            onChange={(v) => onUpdate(item.id, "quantity", parseInt(v) || 1)}
            min={1}
            max={9999}
            required
            error={errors?.quantity}
          />
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Vendor</label>
            <AutocompleteInput
              suggestions={vendorSuggestionOptions}
              value={item.vendor}
              onChange={(v) => {
                onUpdate(item.id, "vendor", v);
                if (v && onVendorUsed) onVendorUsed(v);
              }}
              placeholder="Vendor"
              className="min-h-[44px] text-base"
            />
          </div>
        </div>

        {/* Description - full width */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Description *</label>
          <AutocompleteInput
            suggestions={descriptionSuggestions}
            value={item.description}
            onChange={(v) => onUpdate(item.id, "description", v)}
            placeholder="Enter item description..."
            className={cn("min-h-[44px] text-base", errors?.description && "border-destructive")}
          />
          {errors?.description && (
            <span className="text-xs text-destructive">{errors.description}</span>
          )}
        </div>

        {/* Row 2: Class, Sidemark, Room */}
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Class{!classOptional && ' *'}</label>
            <AutocompleteInput
              suggestions={classSuggestionOptions}
              value={item.classCode || ""}
              onChange={handleClassChange}
              placeholder="Size"
              className={cn("min-h-[44px] text-base", errors?.classCode && "border-destructive")}
            />
            {errors?.classCode && (
              <span className="text-xs text-destructive">{errors.classCode}</span>
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Sidemark</label>
            <AutocompleteInput
              suggestions={sidemarkSuggestions}
              value={item.sidemark || ""}
              onChange={(v) => onUpdate(item.id, "sidemark", v)}
              placeholder="Sidemark"
              className="min-h-[44px] text-base"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Room</label>
            <AutocompleteInput
              suggestions={roomSuggestions}
              value={item.room || ""}
              onChange={(v) => onUpdate(item.id, "room", v)}
              placeholder="Room"
              className="min-h-[44px] text-base"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default ExpectedItemCard;
