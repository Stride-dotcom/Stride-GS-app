/**
 * TaskTypeManagementCard - Manage task types with category-first service mapping
 *
 * Features:
 * - List all task types with category, service, requires_items, active
 * - Create new task types (Custom)
 * - Edit existing task types (restrictions apply to System types)
 * - Clone system task types to create custom versions
 * - Category-first service selection (service dropdown filtered by category)
 * - Activate/deactivate task types (soft-delete)
 * - System vs Custom distinction with badges and protections
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogBody,
} from '@/components/ui/dialog';
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useServiceCategories } from '@/hooks/useServiceCategories';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

interface TaskType {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  is_active: boolean;
  sort_order: number;
  // Legacy fields - kept for backward compatibility but not used in new UI
  billing_service_code: string | null;
  default_service_code: string | null;
  // New simplified model: only category_id determines pricing
  category_id: string | null;
  requires_items: boolean;
  allow_rate_override: boolean;
  // New fields for task categorization and billing
  task_kind: string;
  primary_service_code: string | null;
}

type TaskKindEnum = 'inspection' | 'assembly' | 'repair' | 'disposal' | 'other';
const TASK_KIND_OPTIONS: { value: TaskKindEnum; label: string }[] = [
  { value: 'inspection', label: 'Inspection' },
  { value: 'assembly', label: 'Assembly' },
  { value: 'repair', label: 'Repair' },
  { value: 'disposal', label: 'Disposal' },
  { value: 'other', label: 'Other' },
];

interface TaskTypeFormData {
  name: string;
  description: string;
  category_id: string | null;
  requires_items: boolean;
  allow_rate_override: boolean;
  is_active: boolean;
  task_kind: TaskKindEnum;
  primary_service_code: string | null;
}

// ============================================================================
// Edit/Create Dialog Component
// ============================================================================

type DialogMode = 'create' | 'edit' | 'clone';

interface TaskTypeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskType: TaskType | null;
  mode: DialogMode;
  categories: Array<{ id: string; name: string }>;
  onSave: (data: TaskTypeFormData, isClone: boolean) => Promise<boolean>;
  saving: boolean;
}

function TaskTypeDialog({
  open,
  onOpenChange,
  taskType,
  mode,
  categories,
  onSave,
  saving,
}: TaskTypeDialogProps) {
  const [formData, setFormData] = useState<TaskTypeFormData>({
    name: '',
    description: '',
    category_id: null,
    requires_items: true,
    allow_rate_override: true,
    is_active: true,
    task_kind: 'other',
    primary_service_code: null,
  });
  const [serviceCodeOptions, setServiceCodeOptions] = useState<string[]>([]);

  // Load service code options from charge_types
  useEffect(() => {
    if (!open) return;
    const loadServiceCodes = async () => {
      const { data } = await (supabase
        .from('charge_types') as any)
        .select('charge_code')
        .eq('is_active', true)
        .order('charge_code');
      setServiceCodeOptions(data?.map((d: { charge_code: string }) => d.charge_code) || []);
    };
    loadServiceCodes();
  }, [open]);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      if (taskType) {
        if (mode === 'clone') {
          // Clone mode: pre-fill with original data but new name
          setFormData({
            name: `${taskType.name} (Custom)`,
            description: taskType.description || '',
            category_id: taskType.category_id,
            requires_items: taskType.requires_items ?? true,
            allow_rate_override: taskType.allow_rate_override ?? true,
            is_active: true, // New clones are active by default
            task_kind: (taskType.task_kind as TaskKindEnum) || 'other',
            primary_service_code: taskType.primary_service_code,
          });
        } else {
          // Edit mode
          setFormData({
            name: taskType.name,
            description: taskType.description || '',
            category_id: taskType.category_id,
            requires_items: taskType.requires_items ?? true,
            allow_rate_override: taskType.allow_rate_override ?? true,
            is_active: taskType.is_active,
            task_kind: (taskType.task_kind as TaskKindEnum) || 'other',
            primary_service_code: taskType.primary_service_code,
          });
        }
      } else {
        // Create mode
        setFormData({
          name: '',
          description: '',
          category_id: null,
          requires_items: true,
          allow_rate_override: true,
          is_active: true,
          task_kind: 'other',
          primary_service_code: null,
        });
      }
    }
  }, [open, taskType, mode]);

  const handleSave = async () => {
    if (!formData.name.trim()) return;
    const success = await onSave(formData, mode === 'clone');
    if (success) {
      onOpenChange(false);
    }
  };

  const isEditing = mode === 'edit';
  const isCloning = mode === 'clone';
  const isCreating = mode === 'create';
  const isSystemTask = isEditing && (taskType?.is_system ?? false);

  // Get dialog title and description based on mode
  const getDialogTitle = () => {
    if (isCloning) return 'Clone Task Type';
    if (isEditing) return isSystemTask ? 'Edit System Task Type' : 'Edit Task Type';
    return 'Add Task Type';
  };

  const getDialogDescription = () => {
    if (isCloning) {
      return `Create a custom copy of "${taskType?.name}" that you can fully customize.`;
    }
    if (isEditing && isSystemTask) {
      return 'System task types have limited editing. Clone to create a fully editable custom version.';
    }
    if (isEditing) {
      return 'Update the task type configuration.';
    }
    return 'Create a new task type with category and service mapping.';
  };

  const getButtonText = () => {
    if (isCloning) return 'Create Clone';
    if (isEditing) return 'Save Changes';
    return 'Create Task Type';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {getDialogTitle()}
            {isCloning && (
              <Badge variant="secondary" className="ml-2">
                <MaterialIcon name="content_copy" size="sm" className="mr-1" />
                Clone
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {getDialogDescription()}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="space-y-4 py-4">
            {/* System Task Warning Banner */}
            {isSystemTask && (
              <div className="p-3 border rounded-lg bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
                <div className="flex items-start gap-2">
                  <MaterialIcon name="lock" size="sm" className="text-blue-600 dark:text-blue-400 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-blue-800 dark:text-blue-200">System Task Type</p>
                    <p className="text-blue-700 dark:text-blue-300 mt-0.5">
                      Name cannot be changed. You can modify settings, category, and service mapping.
                      To create a fully editable version, use the <strong>Clone</strong> action.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Clone Info Banner */}
            {isCloning && (
              <div className="p-3 border rounded-lg bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800">
                <div className="flex items-start gap-2">
                  <MaterialIcon name="content_copy" size="sm" className="text-green-600 dark:text-green-400 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-green-800 dark:text-green-200">Creating Custom Copy</p>
                    <p className="text-green-700 dark:text-green-300 mt-0.5">
                      This will create a new custom task type based on "{taskType?.name}".
                      You can fully customize all fields.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Task Type Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Assembly, Inspection"
                disabled={isSystemTask}
              />
              {isSystemTask && (
                <p className="text-xs text-muted-foreground">
                  System task types cannot be renamed. Clone to create an editable copy.
                </p>
              )}
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Optional description..."
                rows={2}
              />
            </div>

            {/* Task Kind */}
            <div className="space-y-2">
              <Label>Task Kind *</Label>
              <Select
                value={formData.task_kind}
                onValueChange={(value) => setFormData({
                  ...formData,
                  task_kind: value as TaskKindEnum,
                })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select kind..." />
                </SelectTrigger>
                <SelectContent>
                  {TASK_KIND_OPTIONS.map(opt => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Used for automation routing (e.g. damage creates repair tasks).
              </p>
            </div>

            {/* Primary Service Code */}
            <div className="space-y-2">
              <Label>Primary Service Code (For Billing)</Label>
              <Select
                value={formData.primary_service_code || '__none__'}
                onValueChange={(value) => setFormData({
                  ...formData,
                  primary_service_code: value === '__none__' ? null : value,
                })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="None (non-billable)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    <span className="text-muted-foreground">None (non-billable)</span>
                  </SelectItem>
                  {serviceCodeOptions.map((code: string) => (
                    <SelectItem key={code} value={code}>{code}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Charge code used for billing when tasks of this type are completed.
              </p>
            </div>

            {/* Category Selection - determines pricing lookup */}
            <div className="space-y-2">
              <Label>Category *</Label>
              <Select
                value={formData.category_id || 'none'}
                onValueChange={(value) => setFormData({
                  ...formData,
                  category_id: value === 'none' ? null : value,
                })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select category..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">
                    <span className="text-muted-foreground">No category (no billing)</span>
                  </SelectItem>
                  {categories.map(cat => (
                    <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Pricing is determined automatically per item based on this category and the item's class.
              </p>
            </div>

            {/* Pricing explanation */}
            {formData.category_id && (
              <div className="p-3 border rounded-lg bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800">
                <div className="flex items-start gap-2">
                  <MaterialIcon name="info" size="sm" className="text-blue-600 dark:text-blue-400 mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-blue-800 dark:text-blue-200">Automatic Pricing</p>
                    <p className="text-blue-700 dark:text-blue-300 mt-0.5">
                      When this task completes, each item will be billed using the rate for this category + the item's class (XS, S, M, L, XL, XXL).
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Options */}
            <div className="space-y-4 pt-2 border-t">
              <Label className="text-sm font-medium">Options</Label>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="requires_items"
                  checked={formData.requires_items}
                  onCheckedChange={(checked) => setFormData({
                    ...formData,
                    requires_items: !!checked,
                  })}
                />
                <div>
                  <Label htmlFor="requires_items" className="cursor-pointer">
                    Requires Items
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Task must have items attached before billing
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="allow_rate_override"
                  checked={formData.allow_rate_override}
                  onCheckedChange={(checked) => setFormData({
                    ...formData,
                    allow_rate_override: !!checked,
                  })}
                />
                <div>
                  <Label htmlFor="allow_rate_override" className="cursor-pointer">
                    Allow Rate Override
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Admins can override the rate for this task type
                  </p>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="is_active"
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({
                    ...formData,
                    is_active: checked,
                  })}
                />
                <Label htmlFor="is_active" className="cursor-pointer">
                  Active
                </Label>
              </div>
            </div>

            {/* Extra bottom padding for mobile scrolling comfort */}
            <div className="h-8" />
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving || !formData.name.trim()}>
            {saving && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
            {getButtonText()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function TaskTypeManagementCard() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { activeCategories, getCategoryName } = useServiceCategories();

  const [taskTypes, setTaskTypes] = useState<TaskType[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] = useState<DialogMode>('create');
  const [editingTaskType, setEditingTaskType] = useState<TaskType | null>(null);

  // Delete confirmation dialog
  const [deleteConfirm, setDeleteConfirm] = useState<TaskType | null>(null);

  // Filter state
  const [showInactive, setShowInactive] = useState(false);
  const [typeFilter, setTypeFilter] = useState<'all' | 'system' | 'custom'>('all');

  // Fetch data
  const fetchData = useCallback(async () => {
    if (!profile?.tenant_id) return;

    setLoading(true);
    try {
      // Fetch task types
      const { data: taskTypesData, error: taskTypesError } = await (supabase
        .from('task_types') as any)
        .select('id, tenant_id, name, description, is_system, is_active, sort_order, billing_service_code, category_id, default_service_code, requires_items, allow_rate_override, task_kind, primary_service_code')
        .eq('tenant_id', profile.tenant_id)
        .order('sort_order')
        .order('name');

      if (taskTypesError) throw taskTypesError;

      setTaskTypes(taskTypesData || []);
    } catch (error) {
      console.error('Error fetching task types:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load task types',
      });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filter task types
  const filteredTaskTypes = useMemo(() => {
    let result = taskTypes;

    // Filter by active status
    if (!showInactive) {
      result = result.filter(t => t.is_active);
    }

    // Filter by type (System/Custom)
    if (typeFilter === 'system') {
      result = result.filter(t => t.is_system);
    } else if (typeFilter === 'custom') {
      result = result.filter(t => !t.is_system);
    }

    return result;
  }, [taskTypes, showInactive, typeFilter]);

  // Count stats
  const systemCount = taskTypes.filter(t => t.is_system).length;
  const customCount = taskTypes.filter(t => !t.is_system).length;

  // Handle create new
  const handleCreate = () => {
    setEditingTaskType(null);
    setDialogMode('create');
    setDialogOpen(true);
  };

  // Handle edit
  const handleEdit = (taskType: TaskType) => {
    setEditingTaskType(taskType);
    setDialogMode('edit');
    setDialogOpen(true);
  };

  // Handle clone (for system task types)
  const handleClone = (taskType: TaskType) => {
    setEditingTaskType(taskType);
    setDialogMode('clone');
    setDialogOpen(true);
  };

  // Handle save
  const handleSave = async (data: TaskTypeFormData, isClone: boolean): Promise<boolean> => {
    if (!profile?.tenant_id) return false;

    setSaving(true);
    try {
      if (editingTaskType && !isClone) {
        // Update existing (not a clone)
        const updateData: any = {
          description: data.description || null,
          category_id: data.category_id,
          // Clear legacy service fields - pricing is now determined by category + item class
          default_service_code: null,
          billing_service_code: null,
          requires_items: data.requires_items,
          allow_rate_override: data.allow_rate_override,
          is_active: data.is_active,
          task_kind: data.task_kind,
          primary_service_code: data.primary_service_code,
        };

        // Only update name if not system task
        if (!editingTaskType.is_system) {
          updateData.name = data.name.trim();
        }

        const { error } = await (supabase
          .from('task_types') as any)
          .update(updateData)
          .eq('id', editingTaskType.id);

        if (error) throw error;

        toast({
          title: 'Task Type Updated',
          description: `"${data.name}" has been updated.`,
        });
      } else {
        // Create new or clone
        const { error } = await (supabase
          .from('task_types') as any)
          .insert({
            tenant_id: profile.tenant_id,
            name: data.name.trim(),
            description: data.description || null,
            category_id: data.category_id,
            // No legacy service code - pricing is determined by category + item class
            default_service_code: null,
            billing_service_code: null,
            requires_items: data.requires_items,
            allow_rate_override: data.allow_rate_override,
            is_active: data.is_active,
            is_system: false, // Clones and new tasks are always custom
            sort_order: taskTypes.length + 1,
            task_kind: data.task_kind,
            primary_service_code: data.primary_service_code,
          });

        if (error) throw error;

        toast({
          title: isClone ? 'Task Type Cloned' : 'Task Type Created',
          description: isClone
            ? `Created custom copy "${data.name}" from "${editingTaskType?.name}".`
            : `"${data.name}" has been created.`,
        });
      }

      await fetchData();
      return true;
    } catch (error: any) {
      console.error('Error saving task type:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to save task type',
      });
      return false;
    } finally {
      setSaving(false);
    }
  };

  // Handle delete (soft-delete by deactivating, only for custom types)
  const handleDelete = async (taskType: TaskType) => {
    if (taskType.is_system) {
      toast({
        variant: 'destructive',
        title: 'Cannot Delete',
        description: 'System task types cannot be deleted. You can deactivate them instead.',
      });
      return;
    }

    try {
      const { error } = await (supabase
        .from('task_types') as any)
        .delete()
        .eq('id', taskType.id)
        .eq('is_system', false); // Extra safety check

      if (error) throw error;

      setTaskTypes(prev => prev.filter(t => t.id !== taskType.id));
      setDeleteConfirm(null);

      toast({
        title: 'Task Type Deleted',
        description: `"${taskType.name}" has been deleted.`,
      });
    } catch (error) {
      console.error('Error deleting task type:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to delete task type',
      });
    }
  };

  // Toggle active
  const handleToggleActive = async (taskType: TaskType) => {
    try {
      const { error } = await (supabase
        .from('task_types') as any)
        .update({ is_active: !taskType.is_active })
        .eq('id', taskType.id);

      if (error) throw error;

      setTaskTypes(prev =>
        prev.map(t => t.id === taskType.id ? { ...t, is_active: !t.is_active } : t)
      );

      toast({
        title: taskType.is_active ? 'Task Type Deactivated' : 'Task Type Activated',
        description: `"${taskType.name}" has been ${taskType.is_active ? 'deactivated' : 'activated'}.`,
      });
    } catch (error) {
      console.error('Error toggling task type:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update task type',
      });
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center">
            <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MaterialIcon name="assignment" size="md" className="text-primary" />
            <div>
              <CardTitle className="text-lg">Task Type Management</CardTitle>
              <CardDescription>
                Task Types define the type of work. Pricing is determined automatically per item based on the task's category and each item's class.
              </CardDescription>
            </div>
          </div>
          <Button onClick={handleCreate}>
            <MaterialIcon name="add" size="sm" className="mr-2" />
            Add Task Type
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {/* Filters */}
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <div className="flex items-center space-x-2">
            <Checkbox
              id="showInactive"
              checked={showInactive}
              onCheckedChange={(checked) => setShowInactive(!!checked)}
            />
            <Label htmlFor="showInactive" className="cursor-pointer text-sm">
              Show inactive
            </Label>
          </div>

          {/* Type Filter */}
          <Select
            value={typeFilter}
            onValueChange={(value: 'all' | 'system' | 'custom') => setTypeFilter(value)}
          >
            <SelectTrigger className="w-[140px] h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types ({taskTypes.length})</SelectItem>
              <SelectItem value="system">System ({systemCount})</SelectItem>
              <SelectItem value="custom">Custom ({customCount})</SelectItem>
            </SelectContent>
          </Select>

          <span className="text-sm text-muted-foreground ml-auto">
            {filteredTaskTypes.length} task type{filteredTaskTypes.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">Type</TableHead>
              <TableHead>Task Type</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-center w-28">Requires Items</TableHead>
              <TableHead className="text-center w-20">Active</TableHead>
              <TableHead className="w-32">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredTaskTypes.map(taskType => {
              const categoryName = getCategoryName(taskType.category_id);

              return (
                <TableRow
                  key={taskType.id}
                  className={cn(!taskType.is_active && 'opacity-50')}
                >
                  {/* Type Column */}
                  <TableCell>
                    {taskType.is_system ? (
                      <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800">
                        <MaterialIcon name="lock" size="sm" className="mr-1" />
                        System
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800">
                        <MaterialIcon name="person" size="sm" className="mr-1" />
                        Custom
                      </Badge>
                    )}
                  </TableCell>

                  {/* Task Type Name */}
                  <TableCell>
                    <div className="font-medium">{taskType.name}</div>
                    {taskType.description && (
                      <p className="text-xs text-muted-foreground mt-0.5">{taskType.description}</p>
                    )}
                  </TableCell>

                  {/* Category */}
                  <TableCell>
                    {categoryName ? (
                      <Badge variant="secondary">{categoryName}</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300">
                        <MaterialIcon name="info" size="sm" className="mr-1" />
                        No billing
                      </Badge>
                    )}
                  </TableCell>

                  {/* Requires Items */}
                  <TableCell className="text-center">
                    {taskType.requires_items ? (
                      <MaterialIcon name="check" size="sm" className="text-green-600" />
                    ) : (
                      <MaterialIcon name="remove" size="sm" className="text-muted-foreground" />
                    )}
                  </TableCell>

                  {/* Active Status */}
                  <TableCell className="text-center">
                    <Badge variant={taskType.is_active ? 'default' : 'secondary'}>
                      {taskType.is_active ? 'Yes' : 'No'}
                    </Badge>
                  </TableCell>

                  {/* Actions */}
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {/* Edit */}
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleEdit(taskType)}
                            >
                              <MaterialIcon name="edit" size="sm" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {taskType.is_system ? 'Edit (limited)' : 'Edit'}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      {/* Clone (for system tasks or any task) */}
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleClone(taskType)}
                            >
                              <MaterialIcon name="content_copy" size="sm" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {taskType.is_system ? 'Clone to Custom' : 'Clone'}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      {/* Toggle Active */}
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => handleToggleActive(taskType)}
                            >
                              <MaterialIcon
                                name={taskType.is_active ? 'visibility_off' : 'visibility'}
                                size="sm"
                              />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {taskType.is_active ? 'Deactivate' : 'Activate'}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>

                      {/* Delete (only for custom tasks) */}
                      {!taskType.is_system && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => setDeleteConfirm(taskType)}
                              >
                                <MaterialIcon name="delete" size="sm" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Delete</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {filteredTaskTypes.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  {typeFilter !== 'all'
                    ? `No ${typeFilter} task types found.`
                    : showInactive
                    ? 'No task types found.'
                    : 'No active task types found. Check "Show inactive" to see all.'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>

      {/* Edit/Create/Clone Dialog */}
      <TaskTypeDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        taskType={editingTaskType}
        mode={dialogMode}
        categories={activeCategories}
        onSave={handleSave}
        saving={saving}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task Type</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteConfirm?.name}"? This action cannot be undone.
              <br /><br />
              <strong>Tip:</strong> Consider deactivating instead of deleting to preserve historical data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
