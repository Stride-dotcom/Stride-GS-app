/**
 * AddShipmentDialog - Dialog for selecting shipment type before creation
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface AddShipmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const SHIPMENT_TYPES = [
  {
    value: 'inbound',
    label: 'Incoming Shipment',
    description: 'Receive goods into the warehouse',
    iconName: 'download',
    route: '/shipments/new',
  },
  {
    value: 'outbound',
    label: 'Outbound Shipment',
    description: 'Ship goods out of the warehouse',
    iconName: 'upload',
    route: '/shipments/outbound/new',
  },
  {
    value: 'return',
    label: 'Return Shipment',
    description: 'Process customer returns',
    iconName: 'undo',
    route: '/shipments/return/new',
  },
] as const;

export function AddShipmentDialog({ open, onOpenChange }: AddShipmentDialogProps) {
  const navigate = useNavigate();
  const [selectedType, setSelectedType] = useState<string>('inbound');

  const handleCreate = () => {
    const shipmentType = SHIPMENT_TYPES.find(t => t.value === selectedType);
    if (shipmentType) {
      onOpenChange(false);
      navigate(shipmentType.route);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Shipment</DialogTitle>
          <DialogDescription>
            Select the type of shipment you want to create
          </DialogDescription>
        </DialogHeader>

        <RadioGroup
          value={selectedType}
          onValueChange={setSelectedType}
          className="space-y-3 py-4"
        >
          {SHIPMENT_TYPES.map((type) => (
              <div
                key={type.value}
                className={`flex items-center space-x-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  selectedType === type.value
                    ? 'border-primary bg-primary/5'
                    : 'border-border hover:bg-muted/50'
                }`}
                onClick={() => setSelectedType(type.value)}
              >
                <RadioGroupItem value={type.value} id={type.value} />
                <MaterialIcon name={type.iconName} size="md" className="text-muted-foreground" />
                <Label htmlFor={type.value} className="flex-1 cursor-pointer">
                  <div className="font-medium">{type.label}</div>
                  <div className="text-sm text-muted-foreground">{type.description}</div>
                </Label>
              </div>
            ))}
        </RadioGroup>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button data-testid="shipment-type-continue" onClick={handleCreate}>
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
