import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { ActiveBadge } from '@/components/ui/active-badge';
import { fieldDescriptions } from '@/lib/pricing/fieldDescriptions';
import { useClasses, type ItemClass } from '@/hooks/useClasses';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { formatClassCubicFeetLabel, getClassCubicFeetSingleValue } from '@/lib/pricing/classCubicFeet';

// =============================================================================
// CODE GENERATOR — derive class code from name
// =============================================================================

function generateClassCode(name: string): string {
  if (!name.trim()) return '';
  const trimmed = name.trim().toUpperCase();
  const words = trimmed.split(/\s+/);

  const abbreviations: Record<string, string> = {
    'EXTRA SMALL': 'XS',
    'EXTRA LARGE': 'XL',
    'EXTRA-SMALL': 'XS',
    'EXTRA-LARGE': 'XL',
  };
  const joined = words.join(' ');
  if (abbreviations[joined]) return abbreviations[joined];

  if (words.length === 1) {
    return words[0].substring(0, Math.min(3, words[0].length));
  }

  return words.map(w => w[0]).join('').substring(0, 4);
}

// =============================================================================
// CLASSES TAB
// =============================================================================

export function ClassesTab() {
  const { classes, loading, createClass, updateClass, deleteClass } = useClasses({ includeInactive: true });
  const { toast } = useToast();
  const [expandedItem, setExpandedItem] = useState<string>('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<ItemClass | null>(null);
  const [explainerOpen, setExplainerOpen] = useState(true);
  const [saving, setSaving] = useState(false);

  const handleDelete = async () => {
    if (!deleteConfirm) return;
    try {
      await deleteClass(deleteConfirm.id);
      toast({ title: 'Class deactivated' });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'An error occurred';
      toast({ variant: 'destructive', title: 'Error', description: message });
    }
    setDeleteConfirm(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Define item groups for class-based pricing. Each class can have a default cubic-feet size used to auto-fill item size.
          </p>
        </div>
        <Button onClick={() => setShowAddForm(true)} className="w-full sm:w-auto">
          <MaterialIcon name="add" size="sm" className="mr-1.5" />
          Add Class
        </Button>
      </div>

      {/* How Classes Work explainer */}
      <Collapsible open={explainerOpen} onOpenChange={setExplainerOpen}>
        <Card>
          <CollapsibleTrigger className="w-full">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MaterialIcon name="help_outline" size="sm" className="text-muted-foreground" />
                  How Classes Work
                </CardTitle>
                <MaterialIcon
                  name={explainerOpen ? 'expand_less' : 'expand_more'}
                  size="sm"
                  className="text-muted-foreground"
                />
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0">
              <p className="text-sm text-muted-foreground mb-4">
                {fieldDescriptions.classExplanation}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Card className="bg-muted/50">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <MaterialIcon name="straighten" size="sm" className="text-muted-foreground" />
                      <span className="font-medium text-sm">By Size</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Small, Medium, Large, Oversized — based on cubic feet
                    </p>
                  </CardContent>
                </Card>
                <Card className="bg-muted/50">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <MaterialIcon name="diamond" size="sm" className="text-muted-foreground" />
                      <span className="font-medium text-sm">By Value</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Bronze, Silver, Gold, Platinum — based on item value
                    </p>
                  </CardContent>
                </Card>
                <Card className="bg-muted/50">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2 mb-2">
                      <MaterialIcon name="inventory_2" size="sm" className="text-muted-foreground" />
                      <span className="font-medium text-sm">By Type</span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Standard, Fragile, High-Value, Hazmat — based on handling
                    </p>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>

      {/* Add New Class inline form */}
      {showAddForm && (
        <AddClassForm
          saving={saving}
          onSave={async (data) => {
            setSaving(true);
            try {
              await createClass(data);
              setShowAddForm(false);
              toast({ title: 'Class created' });
            } catch (error: unknown) {
              const message = error instanceof Error ? error.message : 'An error occurred';
              toast({ variant: 'destructive', title: 'Error', description: message });
            } finally {
              setSaving(false);
            }
          }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* Empty state */}
      {classes.length === 0 && !showAddForm ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <MaterialIcon name="label" size="xl" className="text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No classes defined</h3>
          <p className="text-muted-foreground mb-6 max-w-sm">
            Add classes to enable class-based pricing tiers.
          </p>
          <Button onClick={() => setShowAddForm(true)}>
            <MaterialIcon name="add" size="sm" className="mr-1.5" />
            Add First Class
          </Button>
        </div>
      ) : classes.length > 0 && (
        <Accordion
          type="single"
          collapsible
          value={expandedItem}
          onValueChange={setExpandedItem}
          className="space-y-2"
        >
          {classes.map((cls) => (
            <AccordionItem
              key={cls.id}
              value={cls.id}
              className="border rounded-lg overflow-hidden"
            >
              <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
                <div className="flex items-center gap-2 flex-1 min-w-0 text-left">
                  <Badge variant="outline" className="font-mono text-xs shrink-0">{cls.code}</Badge>
                  <span className={cn('font-medium text-sm', !cls.is_active && 'opacity-50')}>
                    {cls.name}
                  </span>
                  <div className="ml-auto mr-2 flex items-center gap-2">
                    <ActiveBadge active={cls.is_active ?? true} />
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <ClassEditForm
                  itemClass={cls}
                  saving={saving}
                  onSave={async (data) => {
                    setSaving(true);
                    try {
                      await updateClass(cls.id, data);
                      setExpandedItem('');
                      toast({ title: 'Class updated' });
                    } catch (error: unknown) {
                      const message = error instanceof Error ? error.message : 'An error occurred';
                      toast({ variant: 'destructive', title: 'Error', description: message });
                    } finally {
                      setSaving(false);
                    }
                  }}
                  onCancel={() => setExpandedItem('')}
                  onDelete={() => setDeleteConfirm(cls)}
                />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate Class?</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate the class "{deleteConfirm?.name}". Historical data will be preserved.
              Items currently assigned to this class will keep their assignment, but new items won't be classified into it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
            >
              Deactivate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// =============================================================================
// CLASS EDIT FORM — inline within accordion
// =============================================================================

interface ClassEditFormProps {
  itemClass: ItemClass;
  saving: boolean;
  onSave: (data: {
    code: string;
    name: string;
    min_cubic_feet?: number | null;
    max_cubic_feet?: number | null;
    is_active?: boolean | null;
    notes?: string | null;
  }) => Promise<void>;
  onCancel: () => void;
  onDelete: () => void;
}

function ClassEditForm({ itemClass, saving, onSave, onCancel, onDelete }: ClassEditFormProps) {
  const { toast } = useToast();
  const [name, setName] = useState(itemClass.name);
  const [code, setCode] = useState(itemClass.code);
  const [notes, setNotes] = useState(itemClass.notes ?? '');
  const [isActive, setIsActive] = useState(itemClass.is_active ?? true);
  const [cubicFeet, setCubicFeet] = useState<string>(String(getClassCubicFeetSingleValue(itemClass) ?? ''));
  const [cubicFeetTouched, setCubicFeetTouched] = useState(false);

  useEffect(() => {
    setName(itemClass.name);
    setCode(itemClass.code);
    setNotes(itemClass.notes ?? '');
    setIsActive(itemClass.is_active ?? true);
    setCubicFeet(String(getClassCubicFeetSingleValue(itemClass) ?? ''));
    setCubicFeetTouched(false);
  }, [itemClass]);

  const handleCancel = () => {
    setName(itemClass.name);
    setCode(itemClass.code);
    setNotes(itemClass.notes ?? '');
    setIsActive(itemClass.is_active ?? true);
    setCubicFeet(String(getClassCubicFeetSingleValue(itemClass) ?? ''));
    setCubicFeetTouched(false);
    onCancel();
  };

  const handleSave = async () => {
    if (!name.trim() || !code.trim()) return;
    const cubicRaw = cubicFeet.trim();
    const cubicVal = cubicRaw ? Number(cubicRaw) : null;
    const cubicValid = !cubicRaw || (Number.isFinite(cubicVal) && (cubicVal as number) >= 0);
    if (!cubicValid) {
      toast({
        variant: 'destructive',
        title: 'Invalid cubic feet',
        description: 'Please enter a valid non-negative number.',
      });
      return;
    }
    await onSave({
      name: name.trim(),
      code: code.toUpperCase().trim(),
      ...(cubicFeetTouched ? { min_cubic_feet: cubicVal, max_cubic_feet: cubicVal } : {}),
      is_active: isActive,
      notes: notes.trim() || null,
    });
  };

  const cubicRaw = cubicFeet.trim();
  const cubicAsNum = cubicRaw ? Number(cubicRaw) : null;
  const cubicValid = !cubicRaw || (Number.isFinite(cubicAsNum) && (cubicAsNum as number) >= 0);
  const legacyRange =
    (itemClass.min_cubic_feet !== null &&
      itemClass.max_cubic_feet !== null &&
      itemClass.min_cubic_feet !== itemClass.max_cubic_feet) ||
    (itemClass.min_cubic_feet !== null && itemClass.max_cubic_feet === null) ||
    (itemClass.min_cubic_feet === null && itemClass.max_cubic_feet !== null);

  return (
    <div className="space-y-4 pt-3 border-t border-dashed">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor={`cls-name-${itemClass.id}`} className="text-sm font-medium">Name</Label>
          <Input
            id={`cls-name-${itemClass.id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Small, Large, High Value"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`cls-code-${itemClass.id}`} className="text-sm font-medium">Code</Label>
          <Input
            id={`cls-code-${itemClass.id}`}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g., S, L, HV"
            className="font-mono"
            maxLength={10}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`cls-cubic-${itemClass.id}`} className="text-sm font-medium">
          Cubic Feet
        </Label>
        <Input
          id={`cls-cubic-${itemClass.id}`}
          value={cubicFeet}
          onChange={(e) => { setCubicFeet(e.target.value); setCubicFeetTouched(true); }}
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          placeholder="e.g., 12.5"
        />
        {legacyRange && (
          <p className="text-xs text-muted-foreground">
            This class previously had a legacy cubic-feet range/bound configured. Set a single value to enable auto-filling item size.
          </p>
        )}
        {!cubicValid && (
          <p className="text-xs text-destructive">
            Enter a valid number (0 or greater), or leave blank.
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor={`cls-notes-${itemClass.id}`} className="text-sm font-medium">Description</Label>
        <Input
          id={`cls-notes-${itemClass.id}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Optional description"
        />
      </div>

      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Active</Label>
        <Switch checked={isActive} onCheckedChange={setIsActive} />
      </div>

      <div className="flex items-center justify-between pt-2 border-t">
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onDelete}>
          <MaterialIcon name="delete" size="sm" className="mr-1" />
          Deactivate
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCancel} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !name.trim() || !code.trim() || !cubicValid}>
            {saving && <MaterialIcon name="progress_activity" size="sm" className="mr-1 animate-spin" />}
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// ADD CLASS FORM — inline at top of list
// =============================================================================

interface AddClassFormProps {
  saving: boolean;
  onSave: (data: {
    code: string;
    name: string;
    min_cubic_feet?: number | null;
    max_cubic_feet?: number | null;
    is_active?: boolean | null;
    notes?: string | null;
  }) => Promise<void>;
  onCancel: () => void;
}

function AddClassForm({ saving, onSave, onCancel }: AddClassFormProps) {
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeManual, setCodeManual] = useState(false);
  const [notes, setNotes] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [cubicFeet, setCubicFeet] = useState('');

  useEffect(() => {
    if (!codeManual && name) {
      setCode(generateClassCode(name));
    }
  }, [name, codeManual]);

  const handleSave = async () => {
    if (!name.trim() || !code.trim()) return;
    const cubicRaw = cubicFeet.trim();
    const cubicVal = cubicRaw ? Number(cubicRaw) : null;
    const cubicValid = !cubicRaw || (Number.isFinite(cubicVal) && (cubicVal as number) >= 0);
    if (!cubicValid) {
      toast({
        variant: 'destructive',
        title: 'Invalid cubic feet',
        description: 'Please enter a valid non-negative number.',
      });
      return;
    }
    await onSave({
      name: name.trim(),
      code: code.toUpperCase().trim(),
      min_cubic_feet: cubicVal,
      max_cubic_feet: cubicVal,
      is_active: isActive,
      notes: notes.trim() || null,
    });
  };

  const cubicRaw = cubicFeet.trim();
  const cubicAsNum = cubicRaw ? Number(cubicRaw) : null;
  const cubicValid = !cubicRaw || (Number.isFinite(cubicAsNum) && (cubicAsNum as number) >= 0);

  return (
    <Card className="border-primary/50">
      <CardContent className="pt-4 space-y-4">
        <p className="text-sm font-medium">New Class</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="new-cls-name" className="text-sm font-medium">Name</Label>
            <Input
              id="new-cls-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Small, Large, High Value"
              autoFocus
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="new-cls-code" className="text-sm font-medium">Code</Label>
            <div className="relative">
              <Input
                id="new-cls-code"
                value={code}
                onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeManual(true); }}
                placeholder="Auto-generated"
                className={cn('font-mono', !codeManual && code && 'text-muted-foreground')}
                maxLength={10}
              />
              {codeManual && (
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setCodeManual(false)}
                >
                  Auto
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="new-cls-cubic" className="text-sm font-medium">Cubic Feet</Label>
          <Input
            id="new-cls-cubic"
            value={cubicFeet}
            onChange={(e) => setCubicFeet(e.target.value)}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            placeholder="e.g., 12.5"
          />
          {!cubicValid && (
            <p className="text-xs text-destructive">
              Enter a valid number (0 or greater), or leave blank.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="new-cls-notes" className="text-sm font-medium">Description</Label>
          <Input
            id="new-cls-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional description"
          />
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Active</Label>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !name.trim() || !code.trim() || !cubicValid}>
            {saving && <MaterialIcon name="progress_activity" size="sm" className="mr-1 animate-spin" />}
            Create
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
