import { useState, useEffect } from 'react';
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
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  useTechnicians,
  Technician,
  TechnicianFormData,
  TECHNICIAN_SPECIALTIES,
} from '@/hooks/useTechnicians';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface TechnicianDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  technician: Technician | null;
  onSuccess: () => void;
}

export function TechnicianDialog({
  open,
  onOpenChange,
  technician,
  onSuccess,
}: TechnicianDialogProps) {
  const { createTechnician, updateTechnician } = useTechnicians();
  const [saving, setSaving] = useState(false);
  const [specialtiesOpen, setSpecialtiesOpen] = useState(false);

  const [formData, setFormData] = useState<TechnicianFormData>({
    name: '',
    email: '',
    phone: '',
    markup_percent: 0,
    hourly_rate: null,
    specialties: [],
    is_active: true,
    notes: '',
  });

  useEffect(() => {
    if (open) {
      if (technician) {
        setFormData({
          name: technician.name,
          email: technician.email,
          phone: technician.phone || '',
          markup_percent: technician.markup_percent,
          hourly_rate: technician.hourly_rate,
          specialties: technician.specialties,
          is_active: technician.is_active,
          notes: technician.notes || '',
        });
      } else {
        setFormData({
          name: '',
          email: '',
          phone: '',
          markup_percent: 0,
          hourly_rate: null,
          specialties: [],
          is_active: true,
          notes: '',
        });
      }
    }
  }, [open, technician]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    try {
      if (technician) {
        const success = await updateTechnician(technician.id, formData);
        if (success) {
          onOpenChange(false);
          onSuccess();
        }
      } else {
        const newTech = await createTechnician(formData);
        if (newTech) {
          onOpenChange(false);
          onSuccess();
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const toggleSpecialty = (specialty: string) => {
    setFormData((prev) => ({
      ...prev,
      specialties: prev.specialties?.includes(specialty)
        ? prev.specialties.filter((s) => s !== specialty)
        : [...(prev.specialties || []), specialty],
    }));
  };

  const isEditing = !!technician;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {isEditing ? 'Edit Technician' : 'Add Technician'}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? 'Update technician information and settings'
                : 'Add a new external repair contractor'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="John Smith"
                required
              />
            </div>

            {/* Email */}
            <div className="space-y-2">
              <Label htmlFor="email">
                Email <span className="text-destructive">*</span>
              </Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="john@example.com"
                required
              />
              <p className="text-xs text-muted-foreground">
                Quote requests and notifications will be sent to this email
              </p>
            </div>

            {/* Phone */}
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                value={formData.phone || ''}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="(555) 123-4567"
              />
            </div>

            {/* Pricing Section */}
            <div className="grid grid-cols-2 gap-4">
              {/* Markup Percent */}
              <div className="space-y-2">
                <Label htmlFor="markup_percent">
                  Markup %
                </Label>
                <div className="relative">
                  <Input
                    id="markup_percent"
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    value={formData.markup_percent || 0}
                    onChange={(e) =>
                      setFormData({ ...formData, markup_percent: parseFloat(e.target.value) || 0 })
                    }
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    %
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Added to their quote for customer pricing
                </p>
              </div>

              {/* Hourly Rate */}
              <div className="space-y-2">
                <Label htmlFor="hourly_rate">Hourly Rate</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    $
                  </span>
                  <Input
                    id="hourly_rate"
                    type="number"
                    min="0"
                    step="0.01"
                    value={formData.hourly_rate || ''}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        hourly_rate: e.target.value ? parseFloat(e.target.value) : null,
                      })
                    }
                    className="pl-8"
                    placeholder="100.00"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Reference only, shown in dropdowns
                </p>
              </div>
            </div>

            {/* Specialties */}
            <Collapsible open={specialtiesOpen} onOpenChange={setSpecialtiesOpen}>
              <div className="space-y-2">
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full justify-between"
                  >
                    <span>
                      Specialties
                      {formData.specialties && formData.specialties.length > 0 && (
                        <Badge variant="secondary" className="ml-2">
                          {formData.specialties.length} selected
                        </Badge>
                      )}
                    </span>
                    <MaterialIcon
                      name="expand_more"
                      size="sm"
                      className={`transition-transform ${
                        specialtiesOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <div className="grid grid-cols-2 gap-2 p-3 border rounded-lg">
                    {TECHNICIAN_SPECIALTIES.map((specialty) => (
                      <div key={specialty} className="flex items-center space-x-2">
                        <Checkbox
                          id={`specialty-${specialty}`}
                          checked={formData.specialties?.includes(specialty)}
                          onCheckedChange={() => toggleSpecialty(specialty)}
                        />
                        <Label
                          htmlFor={`specialty-${specialty}`}
                          className="text-sm font-normal capitalize cursor-pointer"
                        >
                          {specialty}
                        </Label>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </div>
            </Collapsible>

            {/* Selected Specialties Preview */}
            {formData.specialties && formData.specialties.length > 0 && !specialtiesOpen && (
              <div className="flex flex-wrap gap-1">
                {formData.specialties.map((specialty) => (
                  <Badge key={specialty} variant="secondary" className="capitalize">
                    {specialty}
                  </Badge>
                ))}
              </div>
            )}

            {/* Notes */}
            <div className="space-y-2">
              <Label htmlFor="notes">Internal Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes || ''}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Notes about this technician (internal only)"
                rows={3}
              />
            </div>

            {/* Active Status */}
            <div className="flex items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="is_active">Active Status</Label>
                <p className="text-sm text-muted-foreground">
                  Inactive technicians won't appear in assignment dropdowns
                </p>
              </div>
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, is_active: checked })
                }
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
              {isEditing ? 'Save Changes' : 'Add Technician'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
