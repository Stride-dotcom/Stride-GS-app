import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { usePromptAdmin } from '@/hooks/usePromptAdmin';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { PromptLevel, PromptWorkflow, GuidedPrompt, PromptUIType, PromptTriggerPoint, TenantPromptDefaults } from '@/types/guidedPrompts';
import { Skeleton } from '@/components/ui/skeleton';
import { X } from 'lucide-react';

const LEVEL_LABELS: Record<PromptLevel, string> = {
  training: 'Training (All Prompts)',
  standard: 'Standard (Critical Only)',
  advanced: 'Advanced (Help Only)',
};

const WORKFLOW_LABELS: Record<PromptWorkflow, string> = {
  receiving: 'Receiving',
  inspection: 'Inspection',
  assembly: 'Assembly',
  repair: 'Repair',
  movement: 'Movement',
  stocktake: 'Stocktake',
  scan_hub: 'Scan Hub',
  outbound: 'Outbound',
  claims: 'Claims',
  will_call: 'Will Call',
};

interface EditFormState {
  title: string;
  message: string;
  tip_text: string;
  checklist_items: { label: string; required: boolean }[];
  prompt_type: PromptUIType;
  trigger_point: PromptTriggerPoint;
  min_level: PromptLevel;
  is_active: boolean;
}

export function PromptsSettingsTab() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const {
    isLoading,
    allUserSettings,
    tenantDefaults,
    pendingSuggestions,
    allPrompts,
    updateUserSettings,
    updateTenantDefaults,
    approveSuggestion,
    dismissSuggestion,
    togglePromptActive,
    updatePrompt,
    deletePrompt,
  } = usePromptAdmin();

  const [activeSubTab, setActiveSubTab] = useState('users');

  // -- 1.1 Local state for user settings (optimistic updates) --
  const [localUserSettings, setLocalUserSettings] = useState(allUserSettings);
  useEffect(() => {
    setLocalUserSettings(allUserSettings);
  }, [allUserSettings]);

  // -- 1.2 Local state for tenant defaults (debounced saves) --
  const [localDefaults, setLocalDefaults] = useState<TenantPromptDefaults | null>(tenantDefaults);
  useEffect(() => {
    setLocalDefaults(tenantDefaults);
  }, [tenantDefaults]);

  // -- 1.3 Prompt edit dialog state --
  const [editingPrompt, setEditingPrompt] = useState<GuidedPrompt | null>(null);
  const [editForm, setEditForm] = useState<EditFormState>({
    title: '',
    message: '',
    tip_text: '',
    checklist_items: [],
    prompt_type: 'modal',
    trigger_point: 'before',
    min_level: 'training',
    is_active: true,
  });
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [isSavingPrompt, setIsSavingPrompt] = useState(false);

  const openEditDialog = (prompt: GuidedPrompt) => {
    setEditingPrompt(prompt);
    setEditForm({
      title: prompt.title || '',
      message: prompt.message || '',
      tip_text: prompt.tip_text || '',
      checklist_items: (prompt.checklist_items || []).map(item => ({
        label: item.label,
        required: item.required,
      })),
      prompt_type: prompt.prompt_type || 'modal',
      trigger_point: prompt.trigger_point || 'before',
      min_level: prompt.min_level || 'training',
      is_active: prompt.is_active ?? true,
    });
  };

  const closeEditDialog = () => {
    setEditingPrompt(null);
  };

  const updateChecklistItem = (index: number, field: string, value: string | boolean) => {
    setEditForm(prev => ({
      ...prev,
      checklist_items: prev.checklist_items.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      ),
    }));
  };

  const removeChecklistItem = (index: number) => {
    setEditForm(prev => ({
      ...prev,
      checklist_items: prev.checklist_items.filter((_, i) => i !== index),
    }));
  };

  const addChecklistItem = () => {
    setEditForm(prev => ({
      ...prev,
      checklist_items: [...prev.checklist_items, { label: '', required: false }],
    }));
  };

  const handleSavePrompt = async () => {
    if (!editingPrompt) return;
    setIsSavingPrompt(true);

    const checklistWithKeys = editForm.checklist_items.map((item, idx) => ({
      key: `item_${idx}`,
      label: item.label,
      required: item.required,
    }));

    const success = await updatePrompt(editingPrompt.id, {
      title: editForm.title,
      message: editForm.message,
      tip_text: editForm.tip_text || null,
      checklist_items: checklistWithKeys.length > 0 ? checklistWithKeys : null,
      prompt_type: editForm.prompt_type,
      trigger_point: editForm.trigger_point,
      min_level: editForm.min_level,
      is_active: editForm.is_active,
    });

    setIsSavingPrompt(false);
    if (success) {
      closeEditDialog();
    }
  };

  const handleDeletePrompt = async () => {
    if (!editingPrompt) return;
    const success = await deletePrompt(editingPrompt.id);
    if (success) {
      setDeleteConfirmOpen(false);
      closeEditDialog();
    }
  };

  // -- Helpers for Organization Defaults tab --
  const handleDefaultFieldBlur = (field: keyof TenantPromptDefaults, value: number) => {
    updateTenantDefaults({ [field]: value });
  };

  const handleDefaultFieldKeyDown = (
    e: React.KeyboardEvent<HTMLInputElement>,
    field: keyof TenantPromptDefaults,
    value: number
  ) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
      updateTenantDefaults({ [field]: value });
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <>
      <Tabs value={activeSubTab} onValueChange={setActiveSubTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="users">User Settings</TabsTrigger>
          <TabsTrigger value="organization">Organization Defaults</TabsTrigger>
          <TabsTrigger value="prompts">Prompt Management</TabsTrigger>
        </TabsList>

        {/* User Settings Tab */}
        <TabsContent value="users" className="space-y-4">
          {/* Pending Upgrade Suggestions */}
          {pendingSuggestions.length > 0 && (
            <Card className="border-blue-200 bg-blue-50">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <MaterialIcon name="trending_up" className="text-blue-600" />
                  Pending Upgrade Suggestions
                </CardTitle>
                <CardDescription>
                  Review employees who may be ready for reduced prompts.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {pendingSuggestions.map(suggestion => (
                    <div
                      key={suggestion.id}
                      className="flex items-center justify-between bg-white rounded-lg p-3 border"
                    >
                      <div>
                        <p className="font-medium text-sm">
                          {suggestion.users?.first_name} {suggestion.users?.last_name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {LEVEL_LABELS[suggestion.current_level]} → {LEVEL_LABELS[suggestion.suggested_level]}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {suggestion.reason}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => dismissSuggestion(suggestion.id)}
                        >
                          Dismiss
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => approveSuggestion(suggestion.id)}
                        >
                          Approve
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* User Settings Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Employee Prompt Levels</CardTitle>
              <CardDescription>
                Manage prompt settings for individual employees.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employee</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Prompt Level</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {localUserSettings.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground">
                        No user settings found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    localUserSettings.map(setting => (
                      <TableRow key={setting.id}>
                        <TableCell className="font-medium">
                          {setting.users?.first_name} {setting.users?.last_name}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {setting.users?.email}
                        </TableCell>
                        <TableCell>
                          <Select
                            value={setting.prompt_level}
                            onValueChange={(value: PromptLevel) => {
                              // Optimistic local update
                              setLocalUserSettings(prev =>
                                prev.map(s =>
                                  s.id === setting.id ? { ...s, prompt_level: value } : s
                                )
                              );
                              // Persist to database
                              updateUserSettings(setting.user_id, { prompt_level: value });
                            }}
                          >
                            <SelectTrigger className="w-48">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="training">Training</SelectItem>
                              <SelectItem value="standard">Standard</SelectItem>
                              <SelectItem value="advanced">Advanced</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant={
                              setting.prompt_level === 'training' ? 'default' :
                              setting.prompt_level === 'standard' ? 'secondary' : 'outline'
                            }
                          >
                            {setting.prompt_level}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Organization Defaults Tab */}
        <TabsContent value="organization" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Default Settings</CardTitle>
              <CardDescription>
                Configure default prompt settings for new employees.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Default Prompt Level</Label>
                  <Select
                    value={localDefaults?.default_prompt_level || 'training'}
                    onValueChange={(value: PromptLevel) => {
                      setLocalDefaults(prev => prev ? { ...prev, default_prompt_level: value } : prev);
                      updateTenantDefaults({ default_prompt_level: value });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="training">Training</SelectItem>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="advanced">Advanced</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    New employees will start at this level.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Reminder Interval (Days)</Label>
                  <Input
                    type="number"
                    value={localDefaults?.default_reminder_days ?? 30}
                    onChange={(e) =>
                      setLocalDefaults(prev =>
                        prev ? { ...prev, default_reminder_days: parseInt(e.target.value) || 30 } : prev
                      )
                    }
                    onBlur={() =>
                      handleDefaultFieldBlur('default_reminder_days', localDefaults?.default_reminder_days ?? 30)
                    }
                    onKeyDown={(e) =>
                      handleDefaultFieldKeyDown(e, 'default_reminder_days', localDefaults?.default_reminder_days ?? 30)
                    }
                    min={1}
                    max={365}
                  />
                  <p className="text-xs text-muted-foreground">
                    Days before sending a reminder to review prompt levels.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Competency Thresholds</CardTitle>
              <CardDescription>
                Configure when employees qualify for prompt level upgrades.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Tasks Required</Label>
                  <Input
                    type="number"
                    value={localDefaults?.competency_tasks_required ?? 10}
                    onChange={(e) =>
                      setLocalDefaults(prev =>
                        prev ? { ...prev, competency_tasks_required: parseInt(e.target.value) || 10 } : prev
                      )
                    }
                    onBlur={() =>
                      handleDefaultFieldBlur('competency_tasks_required', localDefaults?.competency_tasks_required ?? 10)
                    }
                    onKeyDown={(e) =>
                      handleDefaultFieldKeyDown(e, 'competency_tasks_required', localDefaults?.competency_tasks_required ?? 10)
                    }
                    min={1}
                  />
                  <p className="text-xs text-muted-foreground">
                    Tasks completed before qualifying for upgrade.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Max Errors Allowed</Label>
                  <Input
                    type="number"
                    value={localDefaults?.competency_max_errors ?? 0}
                    onChange={(e) =>
                      setLocalDefaults(prev =>
                        prev ? { ...prev, competency_max_errors: parseInt(e.target.value) || 0 } : prev
                      )
                    }
                    onBlur={() =>
                      handleDefaultFieldBlur('competency_max_errors', localDefaults?.competency_max_errors ?? 0)
                    }
                    onKeyDown={(e) =>
                      handleDefaultFieldKeyDown(e, 'competency_max_errors', localDefaults?.competency_max_errors ?? 0)
                    }
                    min={0}
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum errors allowed while still qualifying.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Max Missing Photos</Label>
                  <Input
                    type="number"
                    value={localDefaults?.competency_max_missing_photos ?? 0}
                    onChange={(e) =>
                      setLocalDefaults(prev =>
                        prev ? { ...prev, competency_max_missing_photos: parseInt(e.target.value) || 0 } : prev
                      )
                    }
                    onBlur={() =>
                      handleDefaultFieldBlur('competency_max_missing_photos', localDefaults?.competency_max_missing_photos ?? 0)
                    }
                    onKeyDown={(e) =>
                      handleDefaultFieldKeyDown(e, 'competency_max_missing_photos', localDefaults?.competency_max_missing_photos ?? 0)
                    }
                    min={0}
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum missing photos allowed.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Max Location Errors</Label>
                  <Input
                    type="number"
                    value={localDefaults?.competency_max_location_errors ?? 0}
                    onChange={(e) =>
                      setLocalDefaults(prev =>
                        prev ? { ...prev, competency_max_location_errors: parseInt(e.target.value) || 0 } : prev
                      )
                    }
                    onBlur={() =>
                      handleDefaultFieldBlur('competency_max_location_errors', localDefaults?.competency_max_location_errors ?? 0)
                    }
                    onKeyDown={(e) =>
                      handleDefaultFieldKeyDown(e, 'competency_max_location_errors', localDefaults?.competency_max_location_errors ?? 0)
                    }
                    min={0}
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum location errors allowed.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t">
                <div>
                  <Label className="text-base">Auto-Suggestions</Label>
                  <p className="text-sm text-muted-foreground">
                    Automatically suggest upgrades when employees qualify.
                  </p>
                </div>
                <Switch
                  checked={localDefaults?.auto_suggestion_enabled ?? true}
                  onCheckedChange={(checked) => {
                    setLocalDefaults(prev => prev ? { ...prev, auto_suggestion_enabled: checked } : prev);
                    updateTenantDefaults({ auto_suggestion_enabled: checked });
                  }}
                />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Prompt Management Tab */}
        <TabsContent value="prompts" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Prompt Library</CardTitle>
              <CardDescription>
                Enable or disable individual prompts across workflows. Click a prompt to edit it.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {(Object.keys(WORKFLOW_LABELS) as PromptWorkflow[]).map(workflow => {
                  const workflowPrompts = allPrompts.filter(p => p.workflow === workflow);
                  if (workflowPrompts.length === 0) return null;

                  return (
                    <div key={workflow} className="space-y-3">
                      <h4 className="font-medium text-sm flex items-center gap-2">
                        <MaterialIcon name="folder" size="sm" className="text-muted-foreground" />
                        {WORKFLOW_LABELS[workflow]}
                        <Badge variant="outline" className="ml-2">
                          {workflowPrompts.filter(p => p.is_active).length}/{workflowPrompts.length}
                        </Badge>
                      </h4>
                      <div className="grid gap-2">
                        {workflowPrompts
                          .sort((a, b) => a.sort_order - b.sort_order)
                          .map(prompt => (
                            <div
                              key={prompt.id}
                              className="flex items-center justify-between p-3 bg-muted/50 rounded-lg cursor-pointer hover:bg-muted/80 transition-colors"
                              onClick={() => openEditDialog(prompt)}
                            >
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-medium text-sm">{prompt.title}</span>
                                  <Badge variant="outline" className="text-xs">
                                    {prompt.trigger_point}
                                  </Badge>
                                  <Badge
                                    variant={
                                      prompt.min_level === 'training' ? 'default' :
                                      prompt.min_level === 'standard' ? 'secondary' : 'outline'
                                    }
                                    className="text-xs"
                                  >
                                    {prompt.min_level}+
                                  </Badge>
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">
                                  {prompt.message.substring(0, 80)}
                                  {prompt.message.length > 80 ? '...' : ''}
                                </p>
                              </div>
                              <Switch
                                checked={prompt.is_active}
                                onCheckedChange={(checked) => togglePromptActive(prompt.id, checked)}
                                onClick={(e) => e.stopPropagation()}
                              />
                            </div>
                          ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Prompt Dialog */}
      <Dialog open={!!editingPrompt} onOpenChange={(open) => { if (!open) closeEditDialog(); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Prompt</DialogTitle>
            <DialogDescription>
              Modify the prompt details below. Changes are saved when you click Save.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* Title */}
            <div className="space-y-2">
              <Label>Title</Label>
              <Input
                value={editForm.title}
                onChange={(e) => setEditForm(prev => ({ ...prev, title: e.target.value }))}
                placeholder="Prompt title"
              />
            </div>

            {/* Message */}
            <div className="space-y-2">
              <Label>Message</Label>
              <Textarea
                value={editForm.message}
                onChange={(e) => setEditForm(prev => ({ ...prev, message: e.target.value }))}
                placeholder="Prompt message displayed to the user"
                rows={3}
              />
            </div>

            {/* Tip Text */}
            <div className="space-y-2">
              <Label>Tip Text</Label>
              <Textarea
                value={editForm.tip_text}
                onChange={(e) => setEditForm(prev => ({ ...prev, tip_text: e.target.value }))}
                placeholder="Optional tip or additional context"
                rows={2}
              />
            </div>

            {/* Checklist Items */}
            <div className="space-y-2">
              <Label>Checklist Items</Label>
              {editForm.checklist_items.length > 0 && (
                <div className="space-y-2">
                  {editForm.checklist_items.map((item, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <Input
                        value={item.label}
                        onChange={(e) => updateChecklistItem(index, 'label', e.target.value)}
                        placeholder="Checklist item label"
                        className="flex-1"
                      />
                      <div className="flex items-center gap-1.5">
                        <Switch
                          checked={item.required}
                          onCheckedChange={(checked) => updateChecklistItem(index, 'required', checked)}
                        />
                        <span className="text-xs text-muted-foreground whitespace-nowrap">Required</span>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => removeChecklistItem(index)}
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={addChecklistItem}
                className="mt-1"
              >
                Add Item
              </Button>
            </div>

            {/* Row: Prompt Type + Trigger Point */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Prompt Type</Label>
                <Select
                  value={editForm.prompt_type}
                  onValueChange={(value: PromptUIType) =>
                    setEditForm(prev => ({ ...prev, prompt_type: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="modal">Modal</SelectItem>
                    <SelectItem value="slide_panel">Slide Panel</SelectItem>
                    <SelectItem value="tooltip">Tooltip</SelectItem>
                    <SelectItem value="toast">Toast</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Trigger Point</Label>
                <Select
                  value={editForm.trigger_point}
                  onValueChange={(value: PromptTriggerPoint) =>
                    setEditForm(prev => ({ ...prev, trigger_point: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="before">Before</SelectItem>
                    <SelectItem value="during">During</SelectItem>
                    <SelectItem value="after">After</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Row: Min Level + Active */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>Min Level</Label>
                <Select
                  value={editForm.min_level}
                  onValueChange={(value: PromptLevel) =>
                    setEditForm(prev => ({ ...prev, min_level: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="training">Training</SelectItem>
                    <SelectItem value="standard">Standard</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Active</Label>
                <div className="flex items-center gap-2 pt-2">
                  <Switch
                    checked={editForm.is_active}
                    onCheckedChange={(checked) =>
                      setEditForm(prev => ({ ...prev, is_active: checked }))
                    }
                  />
                  <span className="text-sm text-muted-foreground">
                    {editForm.is_active ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="flex justify-between sm:justify-between">
            <Button
              variant="destructive"
              onClick={() => setDeleteConfirmOpen(true)}
            >
              Delete
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={closeEditDialog}>
                Cancel
              </Button>
              <Button onClick={handleSavePrompt} disabled={isSavingPrompt}>
                {isSavingPrompt ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Prompt</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete &quot;{editingPrompt?.title}&quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeletePrompt}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
