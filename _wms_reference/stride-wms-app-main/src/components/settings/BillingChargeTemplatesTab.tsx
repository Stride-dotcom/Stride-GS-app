import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useToast } from '@/hooks/use-toast';

interface ChargeTemplate {
  id: string;
  name: string;
  description: string | null;
  amount: number;
  charge_type: string | null;
  is_active: boolean;
}

const CHARGE_TYPES = [
  { value: 'handling', label: 'Handling' },
  { value: 'labor', label: 'Labor' },
  { value: 'materials', label: 'Materials' },
  { value: 'service', label: 'Service' },
  { value: 'fee', label: 'Fee' },
  { value: 'other', label: 'Other' },
];

export function BillingChargeTemplatesTab() {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [templates, setTemplates] = useState<ChargeTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ChargeTemplate | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    amount: 0,
    charge_type: '',
    is_active: true,
  });

  useEffect(() => {
    if (profile?.tenant_id) {
      fetchTemplates();
    }
  }, [profile?.tenant_id]);

  const fetchTemplates = async () => {
    if (!profile?.tenant_id) return;

    try {
      const { data, error } = await supabase
        .from('billing_charge_templates')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .order('name');

      if (error) throw error;
      setTemplates(data || []);
    } catch (error) {
      console.error('Error fetching templates:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenDialog = (template?: ChargeTemplate) => {
    if (template) {
      setEditingTemplate(template);
      setFormData({
        name: template.name,
        description: template.description || '',
        amount: template.amount,
        charge_type: template.charge_type || '',
        is_active: template.is_active ?? true,
      });
    } else {
      setEditingTemplate(null);
      setFormData({
        name: '',
        description: '',
        amount: 0,
        charge_type: '',
        is_active: true,
      });
    }
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!profile?.tenant_id || !formData.name) return;

    setSaving(true);
    try {
      if (editingTemplate) {
        // Update existing
        const { error } = await supabase
          .from('billing_charge_templates')
          .update({
            name: formData.name,
            description: formData.description || null,
            amount: formData.amount,
            charge_type: formData.charge_type || null,
            is_active: formData.is_active,
          })
          .eq('id', editingTemplate.id);

        if (error) throw error;

        setTemplates(prev =>
          prev.map(t =>
            t.id === editingTemplate.id
              ? {
                  ...t,
                  name: formData.name,
                  description: formData.description || null,
                  amount: formData.amount,
                  charge_type: formData.charge_type || null,
                  is_active: formData.is_active,
                }
              : t
          )
        );

        toast({ title: 'Template Updated' });
      } else {
        // Create new
        const { data, error } = await supabase
          .from('billing_charge_templates')
          .insert({
            tenant_id: profile.tenant_id,
            name: formData.name,
            description: formData.description || null,
            amount: formData.amount,
            charge_type: formData.charge_type || null,
            is_active: formData.is_active,
            created_by: profile.id,
          })
          .select()
          .single();

        if (error) throw error;

        setTemplates(prev => [...prev, data]);
        toast({ title: 'Template Created' });
      }

      setDialogOpen(false);
    } catch (error: any) {
      console.error('Error saving template:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error.message || 'Failed to save template.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (templateId: string) => {
    try {
      const { error } = await supabase
        .from('billing_charge_templates')
        .delete()
        .eq('id', templateId);

      if (error) throw error;

      setTemplates(prev => prev.filter(t => t.id !== templateId));
      toast({ title: 'Template Deleted' });
    } catch (error) {
      console.error('Error deleting template:', error);
    }
  };

  const handleToggleActive = async (templateId: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('billing_charge_templates')
        .update({ is_active: isActive })
        .eq('id', templateId);

      if (error) throw error;

      setTemplates(prev =>
        prev.map(t => (t.id === templateId ? { ...t, is_active: isActive } : t))
      );
    } catch (error) {
      console.error('Error toggling template:', error);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <MaterialIcon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MaterialIcon name="attach_money" size="md" />
                Custom Charge Templates
              </CardTitle>
              <CardDescription>
                Create reusable charge templates for quick billing
              </CardDescription>
            </div>
            <Button onClick={() => handleOpenDialog()}>
              <MaterialIcon name="add" size="sm" className="mr-2" />
              Add Template
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <div className="text-center py-8">
              <MaterialIcon name="attach_money" size="lg" className="mx-auto text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">No templates yet</h3>
              <p className="text-muted-foreground">
                Create charge templates for common billing items
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Active</TableHead>
                  <TableHead className="w-24">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map(template => (
                  <TableRow key={template.id}>
                    <TableCell className="font-medium">{template.name}</TableCell>
                    <TableCell className="max-w-[200px] truncate">
                      {template.description || '-'}
                    </TableCell>
                    <TableCell>
                      {template.charge_type ? (
                        <Badge variant="outline">{template.charge_type}</Badge>
                      ) : (
                        '-'
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      ${template.amount.toFixed(2)}
                    </TableCell>
                    <TableCell>
                      <Switch
                        checked={template.is_active ?? true}
                        onCheckedChange={(checked) =>
                          handleToggleActive(template.id, checked)
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenDialog(template)}
                        >
                          <MaterialIcon name="edit" size="sm" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDelete(template.id)}
                        >
                          <MaterialIcon name="delete" size="sm" className="text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Template Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingTemplate ? 'Edit Template' : 'Create Template'}
            </DialogTitle>
            <DialogDescription>
              {editingTemplate
                ? 'Update charge template details'
                : 'Create a reusable charge template'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name *</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Standard Handling Fee"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData(prev => ({ ...prev, description: e.target.value }))
                }
                placeholder="Optional description"
                rows={2}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="amount">Amount ($)</Label>
                <Input
                  id="amount"
                  type="number"
                  min={0}
                  step={0.01}
                  value={formData.amount}
                  onChange={(e) =>
                    setFormData(prev => ({
                      ...prev,
                      amount: parseFloat(e.target.value) || 0,
                    }))
                  }
                />
              </div>

              <div className="space-y-2">
                <Label>Charge Type</Label>
                <Select
                  value={formData.charge_type}
                  onValueChange={(value) =>
                    setFormData(prev => ({ ...prev, charge_type: value }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {CHARGE_TYPES.map(type => (
                      <SelectItem key={type.value} value={type.value}>
                        {type.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="is_active"
                checked={formData.is_active}
                onCheckedChange={(checked) =>
                  setFormData(prev => ({ ...prev, is_active: checked }))
                }
              />
              <Label htmlFor="is_active">Active</Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving || !formData.name}>
              {saving ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
