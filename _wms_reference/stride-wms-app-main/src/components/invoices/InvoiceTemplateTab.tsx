import { useEffect, useState } from 'react';
import { ArrowLeft, Save, RotateCcw, Plus, Trash2, Star, Copy } from 'lucide-react';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { TemplateEditor, TemplateSettings } from '@/components/templateEditor';
import { useInvoiceTemplates } from '@/hooks/useInvoiceTemplates';
import { INVOICE_TOKENS } from '@/lib/templateEditor/tokens';
import { DEFAULT_INVOICE_TEMPLATE, DEFAULT_INVOICE_TEMPLATE_SETTINGS } from '@/lib/templateEditor/defaultInvoiceTemplate';

export function InvoiceTemplateTab() {
  const { toast } = useToast();
  const {
    templates,
    currentTemplate,
    isLoading,
    createTemplate,
    updateTemplate,
    deleteTemplate,
    setDefaultTemplate,
    loadTemplate,
    duplicateTemplate,
  } = useInvoiceTemplates();

  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [htmlContent, setHtmlContent] = useState(DEFAULT_INVOICE_TEMPLATE);
  const [settings, setSettings] = useState<TemplateSettings>(DEFAULT_INVOICE_TEMPLATE_SETTINGS);
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');

  // Load default or first template on mount
  useEffect(() => {
    if (templates.length > 0 && !selectedTemplateId) {
      const defaultTemplate = templates.find(t => t.is_default) || templates[0];
      setSelectedTemplateId(defaultTemplate.id);
    }
  }, [templates, selectedTemplateId]);

  // Load template content when selection changes
  useEffect(() => {
    if (selectedTemplateId) {
      loadTemplate(selectedTemplateId);
    }
  }, [selectedTemplateId, loadTemplate]);

  // Update local state when template loads
  useEffect(() => {
    if (currentTemplate) {
      setHtmlContent(currentTemplate.html_content);
      setSettings(currentTemplate.settings as TemplateSettings || DEFAULT_INVOICE_TEMPLATE_SETTINGS);
      setHasChanges(false);
    }
  }, [currentTemplate]);

  const handleContentChange = (html: string) => {
    setHtmlContent(html);
    setHasChanges(true);
  };

  const handleSettingsChange = (newSettings: TemplateSettings) => {
    setSettings(newSettings);
    setHasChanges(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (selectedTemplateId) {
        await updateTemplate(selectedTemplateId, {
          html_content: htmlContent,
          settings: settings as Record<string, unknown>,
        });
        setHasChanges(false);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setHtmlContent(DEFAULT_INVOICE_TEMPLATE);
    setSettings(DEFAULT_INVOICE_TEMPLATE_SETTINGS);
    setHasChanges(true);
  };

  const handleCreateNew = async () => {
    if (!newTemplateName.trim()) {
      toast({
        title: 'Name required',
        description: 'Please enter a name for the new template',
        variant: 'destructive',
      });
      return;
    }

    const newTemplate = await createTemplate({
      name: newTemplateName.trim(),
      html_content: DEFAULT_INVOICE_TEMPLATE,
      settings: DEFAULT_INVOICE_TEMPLATE_SETTINGS as Record<string, unknown>,
    });

    if (newTemplate) {
      setSelectedTemplateId(newTemplate.id);
      setShowNewDialog(false);
      setNewTemplateName('');
    }
  };

  const handleDelete = async () => {
    if (selectedTemplateId) {
      await deleteTemplate(selectedTemplateId);
      const remaining = templates.filter(t => t.id !== selectedTemplateId);
      setSelectedTemplateId(remaining[0]?.id || null);
    }
  };

  const handleSetDefault = async () => {
    if (selectedTemplateId) {
      await setDefaultTemplate(selectedTemplateId);
    }
  };

  const handleDuplicate = async () => {
    if (selectedTemplateId) {
      const newTemplate = await duplicateTemplate(selectedTemplateId);
      if (newTemplate) {
        setSelectedTemplateId(newTemplate.id);
      }
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <MaterialIcon name="progress_activity" className="animate-spin h-8 w-8 text-muted-foreground" />
      </div>
    );
  }

  // If no templates exist, show create button
  if (templates.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 space-y-4">
        <MaterialIcon name="description" size="xl" className="text-muted-foreground" />
        <div className="text-center">
          <h3 className="text-lg font-semibold">No Invoice Templates</h3>
          <p className="text-muted-foreground text-sm">Create your first invoice template to get started</p>
        </div>
        <Button onClick={() => setShowNewDialog(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Template
        </Button>

        <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New Template</DialogTitle>
              <DialogDescription>
                Give your new invoice template a name
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <Label htmlFor="template-name">Template Name</Label>
              <Input
                id="template-name"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                placeholder="e.g., Standard Invoice"
                className="mt-2"
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowNewDialog(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateNew}>
                Create Template
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-200px)] flex flex-col -mx-6 -mt-6">
      {/* Header */}
      <div className="bg-background border-b px-6 py-3">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-4">
            <div className="text-lg font-semibold">
              Invoice Template Editor
            </div>

            {/* Template Selector */}
            <Select
              value={selectedTemplateId || ''}
              onValueChange={setSelectedTemplateId}
            >
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select template..." />
              </SelectTrigger>
              <SelectContent>
                {templates.map(template => (
                  <SelectItem key={template.id} value={template.id}>
                    <div className="flex items-center gap-2">
                      {template.name}
                      {template.is_default && (
                        <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowNewDialog(true)}
            >
              <Plus className="h-4 w-4 mr-2" />
              New
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleDuplicate}
              disabled={!selectedTemplateId}
            >
              <Copy className="h-4 w-4 mr-2" />
              Duplicate
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleSetDefault}
              disabled={!selectedTemplateId || currentTemplate?.is_default}
            >
              <Star className="h-4 w-4 mr-2" />
              Set Default
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={handleReset}
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              Reset
            </Button>

            {selectedTemplateId && templates.length > 1 && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Template?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will permanently delete this invoice template. This action cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}

            <Button
              onClick={handleSave}
              disabled={!hasChanges || saving}
              className="bg-primary hover:bg-primary/90"
            >
              {saving ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Save Template
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <TemplateEditor
          initialContent={htmlContent}
          onChange={handleContentChange}
          tokens={INVOICE_TOKENS}
          settings={settings}
          onSettingsChange={handleSettingsChange}
          mode="invoice"
          showSettings={true}
        />
      </div>

      {/* New Template Dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Template</DialogTitle>
            <DialogDescription>
              Give your new invoice template a name
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="template-name">Template Name</Label>
            <Input
              id="template-name"
              value={newTemplateName}
              onChange={(e) => setNewTemplateName(e.target.value)}
              placeholder="e.g., Standard Invoice"
              className="mt-2"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleCreateNew();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowNewDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateNew}>
              Create Template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
