import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
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
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { ActiveBadge } from '@/components/ui/active-badge';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useChargeTypes, type ChargeType } from '@/hooks/useChargeTypes';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

// =============================================================================
// TYPES
// =============================================================================

interface TaskType {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_billable: boolean;
  is_active: boolean;
  sort_order: number | null;
  created_at: string;
}

interface TaskTypeChargeLink {
  id: string;
  task_type_id: string;
  charge_type_id: string;
  scope: string;
  auto_calculate: boolean;
  sort_order: number;
}

interface TaskTemplateWithLinks extends TaskType {
  links: (TaskTypeChargeLink & { charge_type?: ChargeType })[];
}

// =============================================================================
// HOOK — with stable dependencies to avoid infinite loops
// =============================================================================

function useTaskTemplates() {
  const [templates, setTemplates] = useState<TaskTemplateWithLinks[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { profile } = useAuth();
  const { toast } = useToast();
  const { chargeTypes } = useChargeTypes();

  const chargeTypesRef = useRef(chargeTypes);
  chargeTypesRef.current = chargeTypes;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  const fetchTemplates = useCallback(async () => {
    if (!profile?.tenant_id) return;

    try {
      setLoading(true);
      setError(null);

      const { data: taskTypes, error: ttError } = await (supabase as any)
        .from('task_types')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .order('sort_order', { ascending: true, nullsFirst: false })
        .order('name');

      if (ttError) {
        if (ttError.code === '42P01') {
          setTemplates([]);
          return;
        }
        throw ttError;
      }

      if (!taskTypes || taskTypes.length === 0) {
        setTemplates([]);
        return;
      }

      const taskTypeIds = taskTypes.map((tt: TaskType) => tt.id);
      let links: TaskTypeChargeLink[] = [];

      try {
        const { data: linksData, error: linksError } = await (supabase as any)
          .from('task_type_charge_links')
          .select('*')
          .in('task_type_id', taskTypeIds)
          .order('sort_order');

        if (linksError && linksError.code !== '42P01') {
          throw linksError;
        }
        links = (linksData || []) as TaskTypeChargeLink[];
      } catch {
        links = [];
      }

      const currentChargeTypes = chargeTypesRef.current;
      const combined: TaskTemplateWithLinks[] = (taskTypes as TaskType[]).map(tt => ({
        ...tt,
        links: links
          .filter(l => l.task_type_id === tt.id)
          .map(l => ({
            ...l,
            charge_type: currentChargeTypes.find(ct => ct.id === l.charge_type_id),
          })),
      }));

      setTemplates(combined);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      setError(message);
      toastRef.current({ variant: 'destructive', title: 'Error loading templates', description: message });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  useEffect(() => {
    if (chargeTypes.length > 0 && templates.length > 0) {
      setTemplates(prev => prev.map(tt => ({
        ...tt,
        links: tt.links.map(l => ({
          ...l,
          charge_type: chargeTypes.find(ct => ct.id === l.charge_type_id),
        })),
      })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargeTypes.length]);

  const createTemplate = async (data: {
    name: string;
    description?: string;
    is_billable: boolean;
    is_active: boolean;
  }): Promise<TaskType | null> => {
    if (!profile?.tenant_id) return null;
    try {
      const { data: result, error } = await (supabase as any)
        .from('task_types')
        .insert({
          tenant_id: profile.tenant_id,
          name: data.name,
          description: data.description || null,
          is_billable: data.is_billable,
          is_active: data.is_active,
        })
        .select()
        .single();

      if (error) throw error;
      toastRef.current({ title: 'Template created', description: `Created "${data.name}"` });
      await fetchTemplates();
      return result;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      toastRef.current({ variant: 'destructive', title: 'Error', description: message });
      return null;
    }
  };

  const updateTemplate = async (id: string, data: Partial<{
    name: string;
    description: string | null;
    is_billable: boolean;
    is_active: boolean;
  }>): Promise<boolean> => {
    try {
      const { error } = await (supabase as any)
        .from('task_types')
        .update(data)
        .eq('id', id);
      if (error) throw error;
      toastRef.current({ title: 'Template updated' });
      await fetchTemplates();
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      toastRef.current({ variant: 'destructive', title: 'Error', description: message });
      return false;
    }
  };

  const deleteTemplate = async (id: string): Promise<boolean> => {
    try {
      await (supabase as any)
        .from('task_type_charge_links')
        .delete()
        .eq('task_type_id', id);

      const { error } = await (supabase as any)
        .from('task_types')
        .delete()
        .eq('id', id);
      if (error) throw error;
      toastRef.current({ title: 'Template deleted' });
      await fetchTemplates();
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      toastRef.current({ variant: 'destructive', title: 'Error', description: message });
      return false;
    }
  };

  const replaceLinks = async (taskTypeId: string, chargeTypeIds: string[]): Promise<boolean> => {
    if (!profile?.tenant_id) return false;
    try {
      await (supabase as any)
        .from('task_type_charge_links')
        .delete()
        .eq('task_type_id', taskTypeId);

      if (chargeTypeIds.length > 0) {
        const inserts = chargeTypeIds.map((ctId, idx) => ({
          tenant_id: profile.tenant_id,
          task_type_id: taskTypeId,
          charge_type_id: ctId,
          scope: 'per_item',
          auto_calculate: true,
          sort_order: idx + 1,
        }));
        const { error } = await (supabase as any)
          .from('task_type_charge_links')
          .insert(inserts);
        if (error) throw error;
      }

      await fetchTemplates();
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      toastRef.current({ variant: 'destructive', title: 'Error saving services', description: message });
      return false;
    }
  };

  return {
    templates,
    loading,
    error,
    refetch: fetchTemplates,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    replaceLinks,
  };
}

// =============================================================================
// TASK TEMPLATES TAB
// =============================================================================

type FilterType = 'all' | 'billable' | 'non-billable';

export function TaskTemplatesTab() {
  const {
    templates,
    loading,
    error,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    replaceLinks,
  } = useTaskTemplates();
  const { chargeTypes } = useChargeTypes();

  const [filter, setFilter] = useState<FilterType>('all');
  const [expandedItem, setExpandedItem] = useState<string>('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<TaskTemplateWithLinks | null>(null);

  const filtered = templates.filter(t => {
    if (filter === 'billable') return t.is_billable;
    if (filter === 'non-billable') return !t.is_billable;
    return true;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
          <MaterialIcon name="error" size="xl" className="text-destructive" />
        </div>
        <h3 className="text-lg font-semibold mb-2">Failed to load templates</h3>
        <p className="text-muted-foreground mb-4 max-w-sm">{error}</p>
        <p className="text-xs text-muted-foreground mb-4">
          This may happen if the task_types table hasn't been set up yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">
            Preconfigured service bundles for common task workflows. When a task uses a template, linked services are automatically added.
          </p>
        </div>
        <Button onClick={() => setShowAddForm(true)} className="w-full sm:w-auto">
          <MaterialIcon name="add" size="sm" className="mr-1.5" />
          Add Template
        </Button>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2">
        {(['all', 'billable', 'non-billable'] as FilterType[]).map((f) => (
          <button
            key={f}
            className={cn(
              'px-3 py-1 rounded-full text-sm transition-colors',
              filter === f
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'All' : f === 'billable' ? 'Billable' : 'Non-Billable'}
          </button>
        ))}
      </div>

      {/* Add New Template inline form */}
      {showAddForm && (
        <AddTemplateForm
          chargeTypes={chargeTypes}
          onSave={async (data, serviceIds) => {
            const result = await createTemplate(data);
            if (result) {
              if (serviceIds.length > 0) {
                await replaceLinks(result.id, serviceIds);
              }
              setShowAddForm(false);
            }
          }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* Empty state */}
      {templates.length === 0 && !showAddForm ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <MaterialIcon name="assignment" size="xl" className="text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No task templates</h3>
          <p className="text-muted-foreground mb-6 max-w-sm">
            Create templates to define which services are automatically added to tasks.
          </p>
          <Button onClick={() => setShowAddForm(true)}>
            <MaterialIcon name="add" size="sm" className="mr-1.5" />
            Add First Template
          </Button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No templates match the current filter.
        </div>
      ) : (
        <Accordion
          type="single"
          collapsible
          value={expandedItem}
          onValueChange={setExpandedItem}
          className="space-y-2"
        >
          {filtered.map((template) => (
            <AccordionItem key={template.id} value={template.id} className="border rounded-lg overflow-hidden">
              <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
                <div className="flex flex-col flex-1 min-w-0 text-left gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className={cn('font-medium text-sm', !template.is_active && 'opacity-50')}>
                      {template.name}
                    </span>
                    <Badge variant={template.is_billable ? 'default' : 'secondary'} className="text-xs">
                      {template.is_billable ? 'Billable' : 'Non-Billable'}
                    </Badge>
                    <div className="ml-auto mr-2 flex items-center gap-2">
                      <span className={cn(
                        'text-xs',
                        template.is_billable && template.links.length === 0
                          ? 'text-amber-600 dark:text-amber-400 font-medium'
                          : 'text-muted-foreground'
                      )}>
                        {template.links.length > 0
                          ? `${template.links.length} service${template.links.length !== 1 ? 's' : ''}`
                          : template.is_billable ? 'No services' : 'No services'}
                      </span>
                      {template.is_billable && template.links.length === 0 && (
                        <MaterialIcon name="warning" size="sm" className="text-amber-500" />
                      )}
                      <ActiveBadge active={template.is_active} />
                    </div>
                  </div>
                  {template.description && (
                    <p className="text-xs text-muted-foreground truncate">{template.description}</p>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <TemplateEditForm
                  template={template}
                  chargeTypes={chargeTypes}
                  onSave={async (data, serviceIds) => {
                    const ok = await updateTemplate(template.id, data);
                    if (ok) {
                      await replaceLinks(template.id, serviceIds);
                      setExpandedItem('');
                    }
                  }}
                  onCancel={() => setExpandedItem('')}
                  onDelete={() => setDeleteConfirm(template)}
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
            <AlertDialogTitle>Delete Template?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteConfirm?.name}"? This will also remove all linked services.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                if (deleteConfirm) {
                  await deleteTemplate(deleteConfirm.id);
                  setDeleteConfirm(null);
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// =============================================================================
// TEMPLATE EDIT FORM — inline within accordion, with service checklist
// =============================================================================

interface TemplateEditFormProps {
  template: TaskTemplateWithLinks;
  chargeTypes: ChargeType[];
  onSave: (
    data: { name: string; description: string | null; is_billable: boolean; is_active: boolean },
    serviceIds: string[],
  ) => Promise<void>;
  onCancel: () => void;
  onDelete: () => void;
}

function TemplateEditForm({ template, chargeTypes, onSave, onCancel, onDelete }: TemplateEditFormProps) {
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description || '');
  const [isBillable, setIsBillable] = useState(template.is_billable);
  const [isActive, setIsActive] = useState(template.is_active);
  const [assignedIds, setAssignedIds] = useState<string[]>(template.links.map(l => l.charge_type_id));
  const [searchQuery, setSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setName(template.name);
    setDescription(template.description || '');
    setIsBillable(template.is_billable);
    setIsActive(template.is_active);
    setAssignedIds(template.links.map(l => l.charge_type_id));
    setSearchQuery('');
  }, [template]);

  const handleCancel = () => {
    setName(template.name);
    setDescription(template.description || '');
    setIsBillable(template.is_billable);
    setIsActive(template.is_active);
    setAssignedIds(template.links.map(l => l.charge_type_id));
    setSearchQuery('');
    onCancel();
  };

  const needsServicesWarning = isBillable && assignedIds.length === 0;

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave(
        {
          name: name.trim(),
          description: description.trim() || null,
          is_billable: isBillable,
          is_active: isActive,
        },
        assignedIds,
      );
    } finally {
      setSaving(false);
    }
  };

  const toggleService = (chargeTypeId: string) => {
    setAssignedIds(prev =>
      prev.includes(chargeTypeId)
        ? prev.filter(id => id !== chargeTypeId)
        : [...prev, chargeTypeId]
    );
  };

  // Active services, sorted: checked first, then alphabetical
  const activeServices = useMemo(() => {
    const filtered = chargeTypes.filter(ct => {
      if (!ct.is_active) return false;
      if (!searchQuery) return true;
      return ct.charge_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ct.charge_code.toLowerCase().includes(searchQuery.toLowerCase());
    });

    return filtered.sort((a, b) => {
      const aChecked = assignedIds.includes(a.id);
      const bChecked = assignedIds.includes(b.id);
      if (aChecked && !bChecked) return -1;
      if (!aChecked && bChecked) return 1;
      return a.charge_name.localeCompare(b.charge_name);
    });
  }, [chargeTypes, searchQuery, assignedIds]);

  return (
    <div className="space-y-4 pt-3 border-t border-dashed">
      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor={`tmpl-name-${template.id}`} className="text-sm font-medium">Name</Label>
        <Input
          id={`tmpl-name-${template.id}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Template name"
        />
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor={`tmpl-desc-${template.id}`} className="text-sm font-medium">Description</Label>
        <Input
          id={`tmpl-desc-${template.id}`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
        />
      </div>

      {/* Toggles */}
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Active</Label>
        <Switch checked={isActive} onCheckedChange={setIsActive} />
      </div>

      {/* Assigned Services — checklist */}
      <div className="space-y-2">
        <Label className="text-sm font-medium">
          Billing Services{isBillable ? ' (required)' : ''}
        </Label>
        <div className="relative">
          <MaterialIcon name="search" size="sm" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter services..."
            className="pl-8"
          />
        </div>
        <div className="border rounded-md max-h-[250px] overflow-y-auto">
          {activeServices.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
              {searchQuery ? 'No matching services found' : 'No active services available'}
            </div>
          ) : (
            activeServices.map((ct) => {
              const isChecked = assignedIds.includes(ct.id);
              return (
                <label
                  key={ct.id}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer transition-colors border-b last:border-b-0',
                    isChecked && 'bg-primary/5'
                  )}
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => toggleService(ct.id)}
                    className="shrink-0"
                  />
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-sm truncate">{ct.charge_name}</span>
                    <Badge variant="outline" className="font-mono text-xs shrink-0">{ct.charge_code}</Badge>
                  </div>
                </label>
              );
            })
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {assignedIds.length} service{assignedIds.length !== 1 ? 's' : ''} assigned
        </p>
      </div>

      {/* Warning: billable task type with no services */}
      {needsServicesWarning && (
        <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30">
          <MaterialIcon name="warning" size="sm" className="text-amber-600 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-800 dark:text-amber-200">
            Billable task types need at least one service assigned. Tasks of this type won't be able to complete without services.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between pt-2 border-t">
        <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onDelete}>
          <MaterialIcon name="delete" size="sm" className="mr-1" />
          Delete
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleCancel} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving && <MaterialIcon name="progress_activity" size="sm" className="mr-1 animate-spin" />}
            Save Changes
          </Button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// ADD TEMPLATE FORM — inline at top of list
// =============================================================================

interface AddTemplateFormProps {
  chargeTypes: ChargeType[];
  onSave: (
    data: { name: string; description?: string; is_billable: boolean; is_active: boolean },
    serviceIds: string[],
  ) => Promise<void>;
  onCancel: () => void;
}

function AddTemplateForm({ chargeTypes, onSave, onCancel }: AddTemplateFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isBillable, setIsBillable] = useState(true);
  const [isActive, setIsActive] = useState(true);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const toggleService = (chargeTypeId: string) => {
    setAssignedIds(prev =>
      prev.includes(chargeTypeId)
        ? prev.filter(id => id !== chargeTypeId)
        : [...prev, chargeTypeId]
    );
  };

  const activeServices = useMemo(() => {
    const filtered = chargeTypes.filter(ct => {
      if (!ct.is_active) return false;
      if (!searchQuery) return true;
      return ct.charge_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ct.charge_code.toLowerCase().includes(searchQuery.toLowerCase());
    });

    return filtered.sort((a, b) => {
      const aChecked = assignedIds.includes(a.id);
      const bChecked = assignedIds.includes(b.id);
      if (aChecked && !bChecked) return -1;
      if (!aChecked && bChecked) return 1;
      return a.charge_name.localeCompare(b.charge_name);
    });
  }, [chargeTypes, searchQuery, assignedIds]);

  const needsServicesWarning = isBillable && assignedIds.length === 0;

  const handleSave = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave(
        {
          name: name.trim(),
          description: description.trim() || undefined,
          is_billable: isBillable,
          is_active: isActive,
        },
        assignedIds,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-primary/50">
      <CardContent className="pt-4 space-y-4">
        <p className="text-sm font-medium">New Template</p>

        <div className="space-y-2">
          <Label htmlFor="new-tmpl-name" className="text-sm font-medium">Name</Label>
          <Input
            id="new-tmpl-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Standard Inspection"
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="new-tmpl-desc" className="text-sm font-medium">Description</Label>
          <Input
            id="new-tmpl-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
          />
        </div>

        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Active</Label>
          <Switch checked={isActive} onCheckedChange={setIsActive} />
        </div>

        {/* Assigned Services */}
        <div className="space-y-2">
          <Label className="text-sm font-medium">
            Billing Services{isBillable ? ' (required)' : ''}
          </Label>
          <div className="relative">
            <MaterialIcon name="search" size="sm" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter services..."
              className="pl-8"
            />
          </div>
          <div className="border rounded-md max-h-[200px] overflow-y-auto">
            {activeServices.length === 0 ? (
              <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                {searchQuery ? 'No matching services found' : 'No active services available'}
              </div>
            ) : (
              activeServices.map((ct) => {
                const isChecked = assignedIds.includes(ct.id);
                return (
                  <label
                    key={ct.id}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 hover:bg-muted/50 cursor-pointer transition-colors border-b last:border-b-0',
                      isChecked && 'bg-primary/5'
                    )}
                  >
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={() => toggleService(ct.id)}
                      className="shrink-0"
                    />
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-sm truncate">{ct.charge_name}</span>
                      <Badge variant="outline" className="font-mono text-xs shrink-0">{ct.charge_code}</Badge>
                    </div>
                  </label>
                );
              })
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            {assignedIds.length} service{assignedIds.length !== 1 ? 's' : ''} selected
          </p>
        </div>

        {/* Warning: billable task type with no services */}
        {needsServicesWarning && (
          <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/30">
            <MaterialIcon name="warning" size="sm" className="text-amber-600 mt-0.5 shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Billable task types need at least one service assigned. Tasks of this type won't be able to complete without services.
            </p>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving && <MaterialIcon name="progress_activity" size="sm" className="mr-1 animate-spin" />}
            Create
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
