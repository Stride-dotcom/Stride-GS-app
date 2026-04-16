import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { useItemDisplaySettings } from '@/hooks/useItemDisplaySettings';
import { usePermissions } from '@/hooks/usePermissions';
import {
  BUILTIN_ITEM_COLUMNS,
  REQUIRED_ITEM_COLUMNS,
  type BuiltinItemColumnKey,
  type ItemColumnKey,
  type ItemCustomFieldDefinition,
  type ItemCustomFieldType,
  type ItemDisplaySettingsV1,
  type ItemListViewDefinition,
  customFieldColumnKey,
  getColumnLabel,
  getDefaultViewId,
  getViewById,
  getVisibleColumnsForView,
  normalizeItemDisplaySettings,
} from '@/lib/items/itemDisplaySettings';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

function slugifyKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function SortableColumnRow({
  columnKey,
  label,
  visible,
  required,
  onToggleVisible,
  disabled,
}: {
  columnKey: ItemColumnKey;
  label: string;
  visible: boolean;
  required: boolean;
  onToggleVisible: () => void;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: columnKey,
    disabled,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 rounded-md border px-3 py-2 bg-background"
    >
      <button
        type="button"
        className={disabled ? "cursor-default touch-none text-muted-foreground" : "cursor-grab touch-none text-muted-foreground hover:text-foreground"}
        {...(disabled ? {} : attributes)}
        {...(disabled ? {} : listeners)}
        aria-label="Drag to reorder"
      >
        <MaterialIcon name="drag_indicator" size="sm" />
      </button>

      <Checkbox checked={visible} disabled={required || disabled} onCheckedChange={onToggleVisible} className="h-4 w-4" />

      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{label}</div>
        {required && <div className="text-xs text-muted-foreground">Required</div>}
      </div>
    </div>
  );
}

type CustomFieldDraft = {
  id?: string;
  label: string;
  key: string;
  type: ItemCustomFieldType;
  optionsText: string;
  enabled: boolean;
  show_in_lists: boolean;
  show_on_detail: boolean;
};

const CUSTOM_FIELD_TYPE_OPTIONS: Array<{ value: ItemCustomFieldType; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'date', label: 'Date' },
  { value: 'select', label: 'Select' },
  { value: 'checkbox', label: 'Checkbox' },
];

export function ItemDisplaySettingsSection() {
  const { toast } = useToast();
  const { hasRole } = usePermissions();
  const { settings, loading, saving, defaultViewId, saveSettings } = useItemDisplaySettings();
  const canManage = hasRole('admin') || hasRole('manager') || hasRole('admin_dev');
  const readOnly = !canManage;

  const [draft, setDraft] = useState<ItemDisplaySettingsV1>(settings);
  const [activeViewId, setActiveViewId] = useState<string>(defaultViewId);
  const [open, setOpen] = useState(true);

  // Dialogs
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [viewDialogMode, setViewDialogMode] = useState<'new' | 'rename'>('new');
  const [viewName, setViewName] = useState('');
  const [confirmDeleteViewOpen, setConfirmDeleteViewOpen] = useState(false);

  const [fieldDialogOpen, setFieldDialogOpen] = useState(false);
  const [fieldDialogMode, setFieldDialogMode] = useState<'new' | 'edit'>('new');
  const [fieldDraft, setFieldDraft] = useState<CustomFieldDraft>({
    label: '',
    key: '',
    type: 'text',
    optionsText: '',
    enabled: true,
    show_in_lists: true,
    show_on_detail: true,
  });
  const [confirmDeleteFieldOpen, setConfirmDeleteFieldOpen] = useState(false);
  const [pendingDeleteFieldId, setPendingDeleteFieldId] = useState<string | null>(null);

  useEffect(() => {
    setDraft(settings);
  }, [settings]);

  useEffect(() => {
    // Ensure active view exists whenever settings change
    const nextDefault = getDefaultViewId(draft);
    if (!getViewById(draft, activeViewId)) {
      setActiveViewId(nextDefault);
    }
  }, [draft, activeViewId]);

  const activeView: ItemListViewDefinition = useMemo(() => {
    return getViewById(draft, activeViewId) || draft.views[0];
  }, [draft, activeViewId]);

  const visibleColumns = useMemo(() => getVisibleColumnsForView(activeView), [activeView]);

  const REQUIREABLE_BUILTIN_FIELDS: BuiltinItemColumnKey[] = [
    'quantity',
    'size',
    'vendor',
    'description',
    'sku',
    'location',
    'client_account',
    'class',
  ];

  /** Built-in columns flagged as tenant_custom appear in custom fields sections instead of built-in */
  const TENANT_CUSTOM_BUILTIN_KEYS = BUILTIN_ITEM_COLUMNS.filter((c) => c.tenant_custom).map((c) => c.key);

  const isBuiltinRequired = (key: BuiltinItemColumnKey) => {
    return !!draft.required_builtin?.[key];
  };

  const setBuiltinRequired = (key: BuiltinItemColumnKey, required: boolean) => {
    if (readOnly) return;
    setDraft((prev) => {
      const nextMap: Record<string, boolean> = { ...(prev.required_builtin || {}) } as any;
      if (required) nextMap[key] = true;
      else delete (nextMap as any)[key];
      return { ...prev, required_builtin: nextMap as any };
    });
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const updateActiveView = (updater: (view: ItemListViewDefinition) => ItemListViewDefinition) => {
    setDraft((prev) => {
      const nextViews = prev.views.map((v) => (v.id === activeView.id ? updater(v) : v));
      return { ...prev, views: nextViews };
    });
  };

  const handleColumnDragEnd = (event: DragEndEvent) => {
    if (readOnly) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    updateActiveView((view) => {
      const oldIndex = view.order.indexOf(active.id as ItemColumnKey);
      const newIndex = view.order.indexOf(over.id as ItemColumnKey);
      if (oldIndex === -1 || newIndex === -1) return view;
      return { ...view, order: arrayMove(view.order, oldIndex, newIndex) };
    });
  };

  const toggleColumnVisible = (key: ItemColumnKey) => {
    if (readOnly) return;
    if (REQUIRED_ITEM_COLUMNS.has(key)) return;
    updateActiveView((view) => {
      const isHidden = view.hidden.includes(key);
      return {
        ...view,
        hidden: isHidden ? view.hidden.filter((k) => k !== key) : [...view.hidden, key],
      };
    });
  };

  const handleOpenNewView = () => {
    if (readOnly) return;
    setViewDialogMode('new');
    setViewName('');
    setViewDialogOpen(true);
  };

  const handleOpenRenameView = () => {
    if (readOnly) return;
    setViewDialogMode('rename');
    setViewName(activeView.name);
    setViewDialogOpen(true);
  };

  const handleSaveViewDialog = () => {
    const name = viewName.trim();
    if (!name) {
      toast({ title: 'Name required', description: 'Please enter a view name.', variant: 'destructive' });
      return;
    }

    if (viewDialogMode === 'rename') {
      setDraft((prev) => ({
        ...prev,
        views: prev.views.map((v) => (v.id === activeView.id ? { ...v, name } : v)),
      }));
      setViewDialogOpen(false);
      return;
    }

    // new view: copy active view config
    const id = crypto.randomUUID();
    setDraft((prev) => {
      const nextView: ItemListViewDefinition = {
        ...activeView,
        id,
        name,
        is_default: false,
      };
      return { ...prev, views: [...prev.views, nextView] };
    });
    setActiveViewId(id);

    setViewDialogOpen(false);
  };

  const handleDuplicateView = () => {
    if (readOnly) return;
    setDraft((prev) => {
      const id = crypto.randomUUID();
      const nextView: ItemListViewDefinition = {
        ...activeView,
        id,
        name: `Copy of ${activeView.name}`,
        is_default: false,
      };
      return { ...prev, views: [...prev.views, nextView] };
    });
    toast({ title: 'View duplicated' });
  };

  const handleSetDefaultView = () => {
    if (readOnly) return;
    setDraft((prev) => ({
      ...prev,
      views: prev.views.map((v) => ({ ...v, is_default: v.id === activeView.id })),
    }));
    toast({ title: 'Default view updated' });
  };

  const handleDeleteView = () => {
    if (readOnly) return;
    // Do not delete if it's the only view.
    if (draft.views.length <= 1) return;

    setDraft((prev) => {
      const remaining = prev.views.filter((v) => v.id !== activeView.id);
      // Ensure a default exists
      const next = normalizeItemDisplaySettings({ ...prev, views: remaining }) as ItemDisplaySettingsV1;
      return next;
    });

    setConfirmDeleteViewOpen(false);
    toast({ title: 'View deleted' });
  };

  const handleOpenNewField = () => {
    if (readOnly) return;
    setFieldDialogMode('new');
    setFieldDraft({
      label: '',
      key: '',
      type: 'text',
      optionsText: '',
      enabled: true,
      show_in_lists: true,
      show_on_detail: true,
    });
    setFieldDialogOpen(true);
  };

  const handleOpenEditField = (field: ItemCustomFieldDefinition) => {
    if (readOnly) return;
    setFieldDialogMode('edit');
    setFieldDraft({
      id: field.id,
      label: field.label,
      key: field.key,
      type: field.type,
      optionsText: (field.options || []).join('\n'),
      enabled: field.enabled,
      show_in_lists: field.show_in_lists,
      show_on_detail: field.show_on_detail,
    });
    setFieldDialogOpen(true);
  };

  const handleSaveFieldDialog = () => {
    if (readOnly) return;
    const label = fieldDraft.label.trim();
    const key = (fieldDraft.key || slugifyKey(label)).trim();
    if (!label) {
      toast({ title: 'Label required', description: 'Please enter a field label.', variant: 'destructive' });
      return;
    }
    if (!key) {
      toast({ title: 'Key required', description: 'Please enter a field key.', variant: 'destructive' });
      return;
    }
    if (BUILTIN_ITEM_COLUMNS.some((c) => c.key === (key as any))) {
      toast({ title: 'Key not allowed', description: 'This key conflicts with a built-in column.', variant: 'destructive' });
      return;
    }
    if (draft.custom_fields.some((f) => f.key === key && f.id !== fieldDraft.id)) {
      toast({ title: 'Duplicate key', description: 'Another custom field already uses this key.', variant: 'destructive' });
      return;
    }

    const options =
      fieldDraft.type === 'select'
        ? fieldDraft.optionsText
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
        : undefined;

    setDraft((prev) => {
      const nextField: ItemCustomFieldDefinition = {
        id: fieldDraft.id || crypto.randomUUID(),
        key,
        label,
        type: fieldDraft.type,
        options,
        enabled: fieldDraft.enabled,
        show_in_lists: fieldDraft.show_in_lists,
        show_on_detail: fieldDraft.show_on_detail,
      };

      const existingIdx = prev.custom_fields.findIndex((f) => f.id === nextField.id);
      const nextFields =
        existingIdx >= 0
          ? prev.custom_fields.map((f) => (f.id === nextField.id ? nextField : f))
          : [...prev.custom_fields, nextField];

      // Ensure the new column exists in view orders so it can be enabled immediately.
      const cfCol = customFieldColumnKey(nextField.key);
      const nextViews = prev.views.map((v) => {
        const shouldBeInLists = nextField.enabled && nextField.show_in_lists;
        if (!shouldBeInLists) {
          return {
            ...v,
            order: v.order.filter((k) => k !== cfCol),
            hidden: v.hidden.filter((k) => k !== cfCol),
          };
        }
        return v.order.includes(cfCol) ? v : { ...v, order: [...v.order, cfCol] };
      });

      return { ...prev, custom_fields: nextFields, views: nextViews };
    });

    setFieldDialogOpen(false);
  };

  const requestDeleteField = (field: ItemCustomFieldDefinition) => {
    if (readOnly) return;
    setPendingDeleteFieldId(field.id);
    setConfirmDeleteFieldOpen(true);
  };

  const handleDeleteField = () => {
    if (readOnly) return;
    if (!pendingDeleteFieldId) return;
    setDraft((prev) => {
      const field = prev.custom_fields.find((f) => f.id === pendingDeleteFieldId);
      const nextFields = prev.custom_fields.filter((f) => f.id !== pendingDeleteFieldId);
      if (!field) return { ...prev, custom_fields: nextFields };

      const cfCol = customFieldColumnKey(field.key);
      const nextViews = prev.views.map((v) => ({
        ...v,
        order: v.order.filter((k) => k !== cfCol),
        hidden: v.hidden.filter((k) => k !== cfCol),
      }));

      return { ...prev, custom_fields: nextFields, views: nextViews };
    });

    setConfirmDeleteFieldOpen(false);
    setPendingDeleteFieldId(null);
    toast({ title: 'Field deleted' });
  };

  const hasUnsavedChanges = useMemo(() => JSON.stringify(settings) !== JSON.stringify(draft), [settings, draft]);

  const handleSaveAll = async () => {
    if (readOnly) return;
    const ok = await saveSettings(draft);
    if (!ok) return;
  };

  const handleResetDraft = () => {
    if (readOnly) return;
    setDraft(settings);
    setActiveViewId(getDefaultViewId(settings));
    toast({ title: 'Changes reverted' });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="view_column" size="sm" />
              Item Fields &amp; Views
            </CardTitle>
            <CardDescription>
              Configure item list columns systemwide (Inventory, Tasks, Shipments) and create custom item fields.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? 'Collapse section' : 'Expand section'}
            title={open ? 'Collapse' : 'Expand'}
          >
            <MaterialIcon name={open ? 'expand_less' : 'expand_more'} size="sm" />
          </Button>
        </div>
      </CardHeader>
      {open ? (
      <CardContent className="space-y-4">
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading item display settings…</div>
        ) : (
          <>
            {readOnly && (
              <div className="rounded-md border p-3 text-sm text-muted-foreground">
                You can view these settings, but only Managers/Admins can edit tenant-wide item views and custom fields.
              </div>
            )}
            <Tabs defaultValue="views">
              <TabsList>
                <TabsTrigger value="views">Views</TabsTrigger>
                <TabsTrigger value="custom-fields">Custom Fields</TabsTrigger>
                <TabsTrigger value="required">Required Fields</TabsTrigger>
              </TabsList>

              <TabsContent value="views" className="space-y-4">
                <div className="flex flex-col lg:flex-row lg:items-end gap-3">
                  <div className="space-y-1.5 flex-1">
                    <Label>Active view</Label>
                    <Select value={activeViewId} onValueChange={setActiveViewId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select view…" />
                      </SelectTrigger>
                      <SelectContent>
                        {draft.views.map((v) => (
                          <SelectItem key={v.id} value={v.id}>
                            {v.name}{v.is_default ? ' (default)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" onClick={handleSetDefaultView} disabled={readOnly || activeView.is_default}>
                      Set Default
                    </Button>
                    <Button type="button" variant="outline" onClick={handleOpenRenameView} disabled={readOnly}>
                      Rename
                    </Button>
                    <Button type="button" variant="outline" onClick={handleDuplicateView} disabled={readOnly}>
                      Duplicate
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setConfirmDeleteViewOpen(true)}
                      disabled={readOnly || draft.views.length <= 1}
                    >
                      Delete
                    </Button>
                    <Button type="button" onClick={handleOpenNewView} disabled={readOnly}>
                      <MaterialIcon name="add" size="sm" className="mr-2" />
                      New View
                    </Button>
                  </div>
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">Columns</div>
                      <div className="text-xs text-muted-foreground">
                        Drag to reorder. Uncheck to hide a column in this view.
                      </div>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Showing {visibleColumns.length} / {activeView.order.length}
                    </div>
                  </div>

                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleColumnDragEnd}>
                    <SortableContext items={activeView.order} strategy={verticalListSortingStrategy}>
                      <div className="space-y-2">
                        {activeView.order.map((key) => (
                          <SortableColumnRow
                            key={key}
                            columnKey={key}
                            label={getColumnLabel(draft, key)}
                            visible={!activeView.hidden.includes(key)}
                            required={REQUIRED_ITEM_COLUMNS.has(key)}
                            onToggleVisible={() => toggleColumnVisible(key)}
                            disabled={readOnly}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                </div>
              </TabsContent>

              <TabsContent value="custom-fields" className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-medium">Custom Fields</div>
                    <div className="text-xs text-muted-foreground">
                      Stored on each item under metadata.custom_fields.
                    </div>
                  </div>
                  <Button type="button" onClick={handleOpenNewField} disabled={readOnly}>
                    <MaterialIcon name="add" size="sm" className="mr-2" />
                    Add Field
                  </Button>
                </div>

                {draft.custom_fields.length === 0 ? (
                  <div className="text-sm text-muted-foreground border rounded-md p-4">
                    No custom fields yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {draft.custom_fields.map((f) => (
                      <div key={f.id} className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-md border p-3">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">{f.label}</div>
                          <div className="text-xs text-muted-foreground">
                            key: <span className="font-mono">{f.key}</span> • type: {f.type}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-4 text-sm">
                            <label className="flex items-center gap-2">
                              <Switch
                                checked={f.enabled}
                                disabled={readOnly}
                                onCheckedChange={(checked) => {
                                  setDraft((prev) => {
                                    const nextFields = prev.custom_fields.map((x) =>
                                      x.id === f.id ? { ...x, enabled: checked, required: checked ? x.required : false } : x
                                    );
                                    const nextField = nextFields.find((x) => x.id === f.id);
                                    if (!nextField) return { ...prev, custom_fields: nextFields };

                                    const cfCol = customFieldColumnKey(nextField.key);
                                    const shouldBeInLists = nextField.enabled && nextField.show_in_lists;
                                    const nextViews = prev.views.map((v) => {
                                      if (!shouldBeInLists) {
                                        return {
                                          ...v,
                                          order: v.order.filter((k) => k !== cfCol),
                                          hidden: v.hidden.filter((k) => k !== cfCol),
                                        };
                                      }
                                      return v.order.includes(cfCol) ? v : { ...v, order: [...v.order, cfCol] };
                                    });

                                    return { ...prev, custom_fields: nextFields, views: nextViews };
                                  });
                                }}
                              />
                              Enabled
                            </label>
                            <label className="flex items-center gap-2">
                              <Switch
                                checked={f.show_in_lists}
                                disabled={readOnly}
                                onCheckedChange={(checked) => {
                                  setDraft((prev) => {
                                    const nextFields = prev.custom_fields.map((x) => (x.id === f.id ? { ...x, show_in_lists: checked } : x));
                                    const nextField = nextFields.find((x) => x.id === f.id);
                                    if (!nextField) return { ...prev, custom_fields: nextFields };

                                    const cfCol = customFieldColumnKey(nextField.key);
                                    const shouldBeInLists = nextField.enabled && nextField.show_in_lists;
                                    const nextViews = prev.views.map((v) => {
                                      if (!shouldBeInLists) {
                                        return {
                                          ...v,
                                          order: v.order.filter((k) => k !== cfCol),
                                          hidden: v.hidden.filter((k) => k !== cfCol),
                                        };
                                      }
                                      return v.order.includes(cfCol) ? v : { ...v, order: [...v.order, cfCol] };
                                    });

                                    return { ...prev, custom_fields: nextFields, views: nextViews };
                                  });
                                }}
                              />
                              Show in lists
                            </label>
                            <label className="flex items-center gap-2">
                              <Switch
                                checked={f.show_on_detail}
                                disabled={readOnly}
                                onCheckedChange={(checked) => {
                                  setDraft((prev) => ({
                                    ...prev,
                                    custom_fields: prev.custom_fields.map((x) =>
                                      x.id === f.id ? { ...x, show_on_detail: checked, required: checked ? x.required : false } : x
                                    ),
                                  }));
                                }}
                              />
                              Show on detail
                            </label>
                          </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                          <Button type="button" variant="outline" onClick={() => handleOpenEditField(f)} disabled={readOnly}>
                            Edit
                          </Button>
                          <Button type="button" variant="outline" onClick={() => requestDeleteField(f)} disabled={readOnly}>
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="required" className="space-y-4">
                <div className="rounded-md border p-3 text-sm text-muted-foreground">
                  Configure which fields must be filled in item create/edit forms. (View columns are separate.)
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <MaterialIcon name="rule" size="sm" className="text-primary" />
                    Built-in fields
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {REQUIREABLE_BUILTIN_FIELDS.map((key) => (
                      <div key={key} className="flex items-center justify-between rounded-md border px-3 py-2">
                        <div className="text-sm font-medium">
                          {BUILTIN_ITEM_COLUMNS.find((c) => c.key === key)?.label ?? key}
                        </div>
                        <Switch
                          checked={isBuiltinRequired(key)}
                          onCheckedChange={(checked) => setBuiltinRequired(key, checked)}
                          disabled={readOnly}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <MaterialIcon name="dynamic_form" size="sm" className="text-primary" />
                    Custom fields
                  </div>
                  {(() => {
                    const tcBuiltins = TENANT_CUSTOM_BUILTIN_KEYS.map((key) => {
                      const col = BUILTIN_ITEM_COLUMNS.find((c) => c.key === key);
                      return { key, label: col?.label ?? key };
                    });
                    const enabledCF = draft.custom_fields.filter((f) => f.enabled);
                    if (tcBuiltins.length === 0 && enabledCF.length === 0) {
                      return <div className="text-sm text-muted-foreground">No custom fields configured.</div>;
                    }
                    return (
                      <div className="space-y-2">
                        {tcBuiltins.map(({ key, label }) => (
                          <div key={key} className="flex items-center justify-between rounded-md border px-3 py-2">
                            <div className="min-w-0">
                              <div className="text-sm font-medium truncate">{label}</div>
                              <div className="text-xs text-muted-foreground truncate">Built-in custom field</div>
                            </div>
                            <Switch checked={isBuiltinRequired(key)} onCheckedChange={(checked) => setBuiltinRequired(key, checked)} disabled={readOnly} />
                          </div>
                        ))}
                        {enabledCF.map((f) => {
                          const requiredDisabled = !f.show_on_detail || f.type === 'checkbox';
                          return (
                            <div key={f.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate">{f.label}</div>
                                <div className="text-xs text-muted-foreground truncate">
                                  Key: {f.key}
                                  {requiredDisabled ? (f.type === 'checkbox' ? ' · Checkbox fields cannot be required' : ' · Enable "Show on detail" to require') : ''}
                                </div>
                              </div>
                              <Switch
                                checked={f.required === true}
                                onCheckedChange={(checked) => { if (readOnly) return; setDraft((prev) => ({ ...prev, custom_fields: prev.custom_fields.map((x) => x.id === f.id ? { ...x, required: checked } : x) })); }}
                                disabled={readOnly || requiredDisabled}
                              />
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </div>
              </TabsContent>
            </Tabs>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2 pt-2">
              <Button type="button" variant="outline" onClick={handleResetDraft} disabled={readOnly || !hasUnsavedChanges || saving}>
                Revert
              </Button>
              <Button type="button" onClick={() => void handleSaveAll()} disabled={readOnly || !hasUnsavedChanges || saving}>
                {saving ? (
                  <>
                    <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                    Saving…
                  </>
                ) : (
                  <>
                    <MaterialIcon name="save" size="sm" className="mr-2" />
                    Save Item Views
                  </>
                )}
              </Button>
            </div>
          </>
        )}

        {/* View create/rename dialog */}
        <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{viewDialogMode === 'new' ? 'New View' : 'Rename View'}</DialogTitle>
              <DialogDescription>
                {viewDialogMode === 'new'
                  ? 'Create a new view based on the current view.'
                  : 'Update the name of this view.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2">
              <Label htmlFor="view_name">View name</Label>
              <Input id="view_name" value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="e.g., Warehouse View" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setViewDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={handleSaveViewDialog}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Confirm delete view */}
        <Dialog open={confirmDeleteViewOpen} onOpenChange={setConfirmDeleteViewOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete view?</DialogTitle>
              <DialogDescription>
                This will remove the view "{activeView?.name}". This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConfirmDeleteViewOpen(false)}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" onClick={handleDeleteView}>
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Custom field create/edit dialog */}
        <Dialog open={fieldDialogOpen} onOpenChange={setFieldDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{fieldDialogMode === 'new' ? 'Add Custom Field' : 'Edit Custom Field'}</DialogTitle>
              <DialogDescription>
                Custom fields are stored per item and can be used as list columns.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="cf_label">Label</Label>
                <Input
                  id="cf_label"
                  value={fieldDraft.label}
                  onChange={(e) => {
                    const nextLabel = e.target.value;
                    setFieldDraft((prev) => ({
                      ...prev,
                      label: nextLabel,
                      key: prev.key || slugifyKey(nextLabel),
                    }));
                  }}
                  placeholder="e.g., PO Number"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="cf_key">Key</Label>
                <Input
                  id="cf_key"
                  value={fieldDraft.key}
                  onChange={(e) => setFieldDraft((prev) => ({ ...prev, key: e.target.value }))}
                  placeholder="e.g., po_number"
                />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={fieldDraft.type} onValueChange={(v) => setFieldDraft((prev) => ({ ...prev, type: v as ItemCustomFieldType }))}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select type…" />
                  </SelectTrigger>
                  <SelectContent>
                    {CUSTOM_FIELD_TYPE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {fieldDraft.type === 'select' && (
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="cf_options">Options (one per line)</Label>
                  <textarea
                    id="cf_options"
                    value={fieldDraft.optionsText}
                    onChange={(e) => setFieldDraft((prev) => ({ ...prev, optionsText: e.target.value }))}
                    className="w-full min-h-[120px] rounded-md border bg-background p-2 text-sm"
                    placeholder={`Option 1\nOption 2\nOption 3`}
                  />
                </div>
              )}

              <div className="sm:col-span-2 flex flex-wrap gap-4 pt-1">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={fieldDraft.enabled} onCheckedChange={(checked) => setFieldDraft((prev) => ({ ...prev, enabled: checked }))} />
                  Enabled
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={fieldDraft.show_in_lists} onCheckedChange={(checked) => setFieldDraft((prev) => ({ ...prev, show_in_lists: checked }))} />
                  Show in lists
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={fieldDraft.show_on_detail} onCheckedChange={(checked) => setFieldDraft((prev) => ({ ...prev, show_on_detail: checked }))} />
                  Show on detail
                </label>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setFieldDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={handleSaveFieldDialog}>
                Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Confirm delete field */}
        <Dialog open={confirmDeleteFieldOpen} onOpenChange={setConfirmDeleteFieldOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete field?</DialogTitle>
              <DialogDescription>
                This will remove the custom field definition. Existing values on items will remain in metadata, but will no longer display.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setConfirmDeleteFieldOpen(false)}>
                Cancel
              </Button>
              <Button type="button" variant="destructive" onClick={handleDeleteField}>
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
      ) : null}
    </Card>
  );
}

