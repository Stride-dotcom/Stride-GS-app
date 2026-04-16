import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { TaskCustomCharge, ChargeTemplate } from '@/hooks/useTaskCustomCharges';

interface TaskCustomChargesSectionProps {
  charges: TaskCustomCharge[];
  templates: ChargeTemplate[];
  onAddCharge: (chargeName: string, chargeAmount: number, templateId?: string, chargeType?: string, chargeDescription?: string) => Promise<TaskCustomCharge | void>;
  onUpdateCharge: (chargeId: string, updates: { charge_name?: string; charge_amount?: number; charge_description?: string }) => Promise<boolean | void>;
  onDeleteCharge: (chargeId: string) => Promise<boolean | void>;
  totalCharges: number;
  disabled?: boolean;
}

export function TaskCustomChargesSection({
  charges,
  templates,
  onAddCharge,
  onUpdateCharge,
  onDeleteCharge,
  totalCharges,
  disabled = false,
}: TaskCustomChargesSectionProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [manualName, setManualName] = useState('');
  const [manualAmount, setManualAmount] = useState<number>(0);
  const [addingManual, setAddingManual] = useState(false);

  const handleAddFromTemplate = async (templateId: string) => {
    const template = templates.find(t => t.id === templateId);
    if (!template) return;

    await onAddCharge(
      template.name,
      template.amount,
      templateId,
      template.charge_type || undefined,
      template.description || undefined
    );
    setSelectedTemplateId('');
  };

  const handleAddManual = async () => {
    if (!manualName.trim() || manualAmount <= 0) return;

    await onAddCharge(manualName.trim(), manualAmount);
    setManualName('');
    setManualAmount(0);
    setAddingManual(false);
    setShowAddForm(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Label className="flex items-center gap-2">
          <MaterialIcon name="attach_money" size="sm" />
          Custom Charges
        </Label>
        {totalCharges > 0 && (
          <Badge variant="secondary" className="font-mono">
            Total: ${totalCharges.toFixed(2)}
          </Badge>
        )}
      </div>

      {/* Existing Charges */}
      {charges.length > 0 && (
        <div className="space-y-2">
          {charges.map(charge => (
            <div
              key={charge.id}
              className="flex items-center gap-2 p-2 rounded-md bg-muted/50 text-sm"
            >
              <div className="flex-1 flex items-center gap-2">
                {charge.template_id && (
                  <MaterialIcon name="description" className="h-3 w-3 text-muted-foreground" />
                )}
                <span className="truncate">{charge.charge_name}</span>
              </div>
              <span className="font-mono text-muted-foreground">
                ${charge.charge_amount.toFixed(2)}
              </span>
              {!disabled && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => onDeleteCharge(charge.id)}
                >
                  <MaterialIcon name="delete" className="h-3 w-3 text-destructive" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Charge Section */}
      {!disabled && (
        <>
          {!showAddForm ? (
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() => setShowAddForm(true)}
            >
              <MaterialIcon name="add" size="sm" className="mr-2" />
              Add Custom Charge
            </Button>
          ) : (
            <div className="space-y-3 p-3 rounded-md border bg-background">
              {/* Template Selection */}
              {templates.length > 0 && !addingManual && (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">From Template</Label>
                  <div className="flex gap-2">
                    <Select
                      value={selectedTemplateId}
                      onValueChange={handleAddFromTemplate}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select a template..." />
                      </SelectTrigger>
                      <SelectContent>
                        {templates.map(template => (
                          <SelectItem key={template.id} value={template.id}>
                            <span className="flex items-center justify-between gap-4 w-full">
                              <span>{template.name}</span>
                              <span className="text-muted-foreground font-mono text-xs">
                                ${template.amount.toFixed(2)}
                              </span>
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="text-center text-xs text-muted-foreground">
                    — or —
                  </div>
                </div>
              )}

              {/* Manual Entry */}
              {!addingManual && templates.length > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => setAddingManual(true)}
                >
                  Enter custom amount
                </Button>
              ) : (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Name</Label>
                    <Input
                      value={manualName}
                      onChange={e => setManualName(e.target.value)}
                      placeholder="e.g., Special handling fee"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Amount ($)</Label>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={manualAmount || ''}
                      onChange={e => setManualAmount(parseFloat(e.target.value) || 0)}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => {
                        setAddingManual(false);
                        setShowAddForm(false);
                        setManualName('');
                        setManualAmount(0);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={handleAddManual}
                      disabled={!manualName.trim() || manualAmount <= 0}
                    >
                      Add Charge
                    </Button>
                  </div>
                </div>
              )}

              {/* Close button when showing template selection */}
              {!addingManual && templates.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-muted-foreground"
                  onClick={() => setShowAddForm(false)}
                >
                  Cancel
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {charges.length === 0 && !showAddForm && (
        <p className="text-xs text-muted-foreground text-center py-2">
          No custom charges added
        </p>
      )}
    </div>
  );
}
