import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
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
import { useServiceCategories, type ServiceCategory } from '@/hooks/useServiceCategories';
import { cn } from '@/lib/utils';

export function CategoriesTab() {
  const {
    categories,
    loading,
    saving,
    createCategory,
    updateCategory,
    deleteCategory,
  } = useServiceCategories();

  const [expandedItem, setExpandedItem] = useState<string>('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<ServiceCategory | null>(null);

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm) return;
    await deleteCategory(deleteConfirm.id);
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
            Organize your services into categories for menus, filters, and reports. Categories do not affect billing.
          </p>
        </div>
        <Button onClick={() => setShowAddForm(true)} className="w-full sm:w-auto">
          <MaterialIcon name="add" size="sm" className="mr-1.5" />
          Add Category
        </Button>
      </div>

      {/* Add New Category inline form */}
      {showAddForm && (
        <AddCategoryForm
          saving={saving}
          onSave={async (data) => {
            const success = await createCategory(data);
            if (success) setShowAddForm(false);
          }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {/* Empty state */}
      {categories.length === 0 && !showAddForm ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <MaterialIcon name="folder" size="xl" className="text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No categories yet</h3>
          <p className="text-muted-foreground mb-6 max-w-sm">
            Create categories to organize your price list services.
          </p>
          <Button onClick={() => setShowAddForm(true)}>
            <MaterialIcon name="add" size="sm" className="mr-1.5" />
            Add First Category
          </Button>
        </div>
      ) : categories.length > 0 && (
        <Accordion
          type="single"
          collapsible
          value={expandedItem}
          onValueChange={setExpandedItem}
          className="space-y-2"
        >
          {categories.map((category) => (
            <AccordionItem
              key={category.id}
              value={category.id}
              className="border rounded-lg overflow-hidden"
            >
              <AccordionTrigger className="px-4 py-3 hover:no-underline hover:bg-muted/50">
                <div className="flex flex-col flex-1 min-w-0 text-left gap-0.5">
                  <div className="flex items-center gap-2">
                    <span className={cn('font-medium text-sm', !category.is_active && 'opacity-50')}>
                      {category.name}
                    </span>
                    {category.is_system && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">System</span>
                    )}
                    <div className="ml-auto mr-2">
                      <ActiveBadge active={category.is_active} />
                    </div>
                  </div>
                  {category.description && (
                    <p className="text-xs text-muted-foreground truncate">{category.description}</p>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                <CategoryEditForm
                  category={category}
                  saving={saving}
                  onSave={async (data) => {
                    const success = await updateCategory({ id: category.id, ...data });
                    if (success) setExpandedItem('');
                  }}
                  onCancel={() => setExpandedItem('')}
                  onDelete={!category.is_system ? () => setDeleteConfirm(category) : undefined}
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
            <AlertDialogTitle>Delete Category?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteConfirm?.name}"?
              If any services are using this category, deletion will fail.
              You may want to disable the category instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteConfirm}
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
// CATEGORY EDIT FORM — inline within accordion
// =============================================================================

interface CategoryEditFormProps {
  category: ServiceCategory;
  saving: boolean;
  onSave: (data: { name: string; description: string | null; is_active: boolean }) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => void;
}

function CategoryEditForm({ category, saving, onSave, onCancel, onDelete }: CategoryEditFormProps) {
  const [name, setName] = useState(category.name);
  const [description, setDescription] = useState(category.description || '');
  const [isActive, setIsActive] = useState(category.is_active);

  useEffect(() => {
    setName(category.name);
    setDescription(category.description || '');
    setIsActive(category.is_active);
  }, [category]);

  const handleSave = async () => {
    if (!name.trim()) return;
    await onSave({
      name: name.trim(),
      description: description.trim() || null,
      is_active: isActive,
    });
  };

  const handleCancel = () => {
    setName(category.name);
    setDescription(category.description || '');
    setIsActive(category.is_active);
    onCancel();
  };

  return (
    <div className="space-y-4 pt-3 border-t border-dashed">
      <div className="space-y-2">
        <Label htmlFor={`cat-name-${category.id}`} className="text-sm font-medium">Name</Label>
        <Input
          id={`cat-name-${category.id}`}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Category name"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`cat-desc-${category.id}`} className="text-sm font-medium">Description</Label>
        <Input
          id={`cat-desc-${category.id}`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description"
        />
      </div>

      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">Active</Label>
        <Switch checked={isActive} onCheckedChange={setIsActive} />
      </div>

      <div className="flex items-center justify-between pt-2 border-t">
        {onDelete ? (
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={onDelete}>
            <MaterialIcon name="delete" size="sm" className="mr-1" />
            Delete
          </Button>
        ) : (
          <div />
        )}
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
// ADD CATEGORY FORM — inline at top of list
// =============================================================================

interface AddCategoryFormProps {
  saving: boolean;
  onSave: (data: { name: string; description?: string; is_active?: boolean }) => Promise<void>;
  onCancel: () => void;
}

function AddCategoryForm({ saving, onSave, onCancel }: AddCategoryFormProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);

  const handleSave = async () => {
    if (!name.trim()) return;
    await onSave({
      name: name.trim(),
      description: description.trim() || undefined,
      is_active: isActive,
    });
  };

  return (
    <Card className="border-primary/50">
      <CardContent className="pt-4 space-y-4">
        <p className="text-sm font-medium">New Category</p>

        <div className="space-y-2">
          <Label htmlFor="new-cat-name" className="text-sm font-medium">Name</Label>
          <Input
            id="new-cat-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Receiving"
            autoFocus
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="new-cat-desc" className="text-sm font-medium">Description</Label>
          <Input
            id="new-cat-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
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
          <Button size="sm" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving && <MaterialIcon name="progress_activity" size="sm" className="mr-1 animate-spin" />}
            Save
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
