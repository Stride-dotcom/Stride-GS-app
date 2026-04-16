import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { CommunicationAlert, TriggerCatalogEntry, TRIGGER_EVENTS } from '@/hooks/useCommunications';
import { useSmsAddonActivation } from '@/hooks/useSmsAddonActivation';

interface CreateAlertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreateAlert: (alert: Omit<CommunicationAlert, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>) => Promise<CommunicationAlert | null>;
  triggerCatalog?: TriggerCatalogEntry[];
}

export function CreateAlertDialog({
  open,
  onOpenChange,
  onCreateAlert,
  triggerCatalog = [],
}: CreateAlertDialogProps) {
  const { data: smsAddonState } = useSmsAddonActivation();
  const smsAddonActive = smsAddonState?.is_active === true;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showLegacyTriggers, setShowLegacyTriggers] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    key: '',
    description: '',
    trigger_event: '',
    is_enabled: true,
    channels: { email: true, sms: true },
    timing_rule: 'immediate',
  });

  const fallbackLegacyKeys = new Set(['task_assigned', 'task_completed', 'task_overdue']);

  const filteredCatalogTriggers = triggerCatalog.filter((trigger) => {
    const isLegacy =
      trigger.is_legacy === true ||
      trigger.display_name.toLowerCase().includes('(legacy)') ||
      (trigger.description || '').toLowerCase().includes('legacy');
    return showLegacyTriggers || !isLegacy;
  });

  const filteredFallbackTriggers = TRIGGER_EVENTS.filter((event) => {
    if (showLegacyTriggers) return true;
    return !fallbackLegacyKeys.has(event.value);
  });

  useEffect(() => {
    if (!smsAddonActive && formData.channels.sms) {
      setFormData((prev) => ({ ...prev, channels: { ...prev.channels, sms: false } }));
    }
  }, [smsAddonActive, formData.channels.sms]);

  const generateKey = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '');
  };

  const handleNameChange = (name: string) => {
    setFormData(prev => ({
      ...prev,
      name,
      key: generateKey(name),
    }));
  };

  const handleCreateAlert = async () => {
    if (!formData.name || !formData.trigger_event) return;
    
    setIsSubmitting(true);
    const result = await onCreateAlert(formData);
    setIsSubmitting(false);
    
    if (result) {
      onOpenChange(false);
      setFormData({
        name: '',
        key: '',
        description: '',
        trigger_event: '',
        is_enabled: true,
        channels: { email: true, sms: smsAddonActive },
        timing_rule: 'immediate',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create New Alert</DialogTitle>
          <DialogDescription>
            Configure a new notification alert. Default templates will be created for enabled channels.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Alert Name</Label>
            <Input
              id="name"
              placeholder="e.g., Shipment Received Notification"
              value={formData.name}
              onChange={(e) => handleNameChange(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="key">Alert Key</Label>
            <Input
              id="key"
              placeholder="e.g., shipment_received"
              value={formData.key}
              onChange={(e) => setFormData(prev => ({ ...prev, key: e.target.value }))}
            />
            <p className="text-xs text-muted-foreground">
              Unique identifier used in code. Auto-generated from name.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              placeholder="Describe when this alert is triggered..."
              value={formData.description}
              onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="trigger">Trigger Event</Label>
            <Select
              value={formData.trigger_event}
              onValueChange={(value) => setFormData(prev => ({ ...prev, trigger_event: value }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select trigger event" />
              </SelectTrigger>
              <SelectContent>
                {filteredCatalogTriggers.length > 0
                  ? filteredCatalogTriggers.map((event) => (
                      <SelectItem key={event.key} value={event.key}>
                        {event.display_name}
                      </SelectItem>
                    ))
                  : filteredFallbackTriggers.map((event) => (
                      <SelectItem key={event.value} value={event.value}>
                        {event.label}
                      </SelectItem>
                    ))}
              </SelectContent>
            </Select>
            <div className="flex items-center justify-between rounded-md border p-2 mt-2">
              <p className="text-xs text-muted-foreground">Legacy trigger events are hidden by default.</p>
              <label className="inline-flex items-center gap-2 text-xs font-medium">
                Show legacy
                <Switch checked={showLegacyTriggers} onCheckedChange={setShowLegacyTriggers} />
              </label>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Channels</Label>
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch
                  checked={formData.channels.email}
                  onCheckedChange={(checked) =>
                    setFormData(prev => ({ ...prev, channels: { ...prev.channels, email: checked } }))
                  }
                />
                <MaterialIcon name="mail" size="sm" />
                <span>Email</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <Switch
                  checked={formData.channels.sms}
                  disabled={!smsAddonActive}
                  onCheckedChange={(checked) =>
                    setFormData(prev => ({ ...prev, channels: { ...prev.channels, sms: checked } }))
                  }
                />
                <MaterialIcon name="chat" size="sm" />
                <span className={!smsAddonActive ? "text-muted-foreground" : ""}>
                  {smsAddonActive ? "SMS" : "SMS (locked)"}
                </span>
              </label>
            </div>
            {!smsAddonActive && (
              <p className="text-xs text-muted-foreground">
                SMS channel requires an active SMS add-on (Settings → SMS).
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleCreateAlert} 
            disabled={!formData.name || !formData.trigger_event || isSubmitting}
          >
            {isSubmitting ? 'Creating...' : 'Create Alert'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
