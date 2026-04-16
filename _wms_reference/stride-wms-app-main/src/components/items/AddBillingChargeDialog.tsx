import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { BILLING_DISABLED_ERROR } from '@/lib/billing/chargeTypeUtils';
import { useAuth } from '@/contexts/AuthContext';
import { createEventRaw } from '@/services/billing';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { logItemActivity } from '@/lib/activity/logItemActivity';

interface ChargeTemplate {
  id: string;
  name: string;
  amount: number;
  description?: string;
}

interface AddBillingChargeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  itemCode: string;
  accountId: string | null;
  sidemarkId?: string | null;
  classId?: string | null;
  onSuccess: () => void;
}

export function AddBillingChargeDialog({
  open,
  onOpenChange,
  itemId,
  itemCode,
  accountId,
  sidemarkId,
  classId,
  onSuccess,
}: AddBillingChargeDialogProps) {
  const { toast } = useToast();
  const { profile } = useAuth();

  const [loading, setLoading] = useState(false);
  const [templates, setTemplates] = useState<ChargeTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>('custom');

  const [formData, setFormData] = useState({
    charge_name: '',
    amount: '',
    description: '',
  });

  useEffect(() => {
    if (open) {
      fetchChargeTemplates();
      setSelectedTemplate('custom');
      setFormData({ charge_name: '', amount: '', description: '' });
    }
  }, [open]);

  const fetchChargeTemplates = async () => {
    // Optional helper: if your repo has a table for templates, load it.
    // If not found, we silently skip and leave templates empty.
    try {
      const { data, error } = await supabase
        .from('billing_charge_templates' as any)
        .select('id, name, amount, description')
        .order('name');

      if (error) return;
      setTemplates((data || []) as any);
    } catch {
      setTemplates([]);
    }
  };

  const handleTemplateSelect = (templateId: string) => {
    setSelectedTemplate(templateId);

    if (templateId === 'custom') {
      setFormData({ charge_name: '', amount: '', description: '' });
      return;
    }

    const template = templates.find(t => t.id === templateId);
    if (template) {
      setFormData({
        charge_name: template.name,
        amount: template.amount.toString(),
        description: template.description || '',
      });
    }
  };

  const handleSubmit = async () => {
    if (!profile?.tenant_id) return;

    if (!accountId) {
      toast({
        title: 'Account missing',
        description: 'This item does not have an account assigned. Assign an account before adding charges.',
        variant: 'destructive',
      });
      return;
    }

    if (!formData.charge_name.trim()) {
      toast({
        title: 'Charge name required',
        description: 'Please enter a charge name.',
        variant: 'destructive',
      });
      return;
    }

    const amount = parseFloat(formData.amount);
    if (isNaN(amount) || amount <= 0) {
      toast({
        title: 'Valid amount required',
        description: 'Please enter a valid positive amount.',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      const payload: any = {
        tenant_id: profile.tenant_id,
        item_id: itemId,
        account_id: accountId,
        sidemark_id: sidemarkId || null,
        class_id: classId || null,

        // Ledger fields
        event_type: 'addon',
        charge_type: formData.charge_name.trim(),
        description: formData.description.trim() || null,
        quantity: 1,
        unit_rate: amount,
        total_amount: amount,
        status: 'unbilled',
        occurred_at: new Date().toISOString(),
        metadata: {
          source: 'manual_addon',
          template_id: selectedTemplate !== 'custom' ? selectedTemplate : null,
        },
        created_by: profile.id,
      };

      // Check account_service_settings for is_enabled before creating billing event
      if (accountId && formData.charge_name.trim()) {
        const { data: accountSetting } = await supabase
          .from('account_service_settings')
          .select('is_enabled')
          .eq('account_id', accountId)
          .eq('service_code', formData.charge_name.trim())
          .maybeSingle();

        if (accountSetting && accountSetting.is_enabled === false) {
          throw new Error(BILLING_DISABLED_ERROR);
        }
      }

      const result = await createEventRaw(payload);
      if (!result.success) throw new Error(result.error || 'Failed to create billing event');

      toast({
        title: 'Add-on added',
        description: `$${amount.toFixed(2)} add-on added to ${itemCode}.`,
      });

      logItemActivity({
        tenantId: profile.tenant_id,
        itemId,
        actorUserId: profile.id,
        eventType: 'billing_charge_added',
        eventLabel: `Manual charge added: ${formData.charge_name.trim()}`,
        details: { charge_name: formData.charge_name.trim(), amount, description: formData.description.trim() || null },
      });

      onSuccess();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error adding billing event:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to add add-on.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>Add Charge</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4">
          {templates.length > 0 && (
            <div className="grid gap-2">
              <Label>Template</Label>
              <Select value={selectedTemplate} onValueChange={handleTemplateSelect}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a template..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="custom">Custom</SelectItem>
                  {templates.map(template => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name} (${template.amount})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="charge_name">Charge name *</Label>
            <Input
              id="charge_name"
              value={formData.charge_name}
              onChange={e => setFormData(prev => ({ ...prev, charge_name: e.target.value }))}
              placeholder="e.g., Crate disposal"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="amount">Amount *</Label>
            <Input
              id="amount"
              type="number"
              step="0.01"
              value={formData.amount}
              onChange={e => setFormData(prev => ({ ...prev, amount: e.target.value }))}
              placeholder="0.00"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="description">Notes (optional)</Label>
            <Textarea
              id="description"
              value={formData.description}
              onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
              placeholder="Extra details for billing/reporting…"
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" /> : null}
            Add Charge
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}