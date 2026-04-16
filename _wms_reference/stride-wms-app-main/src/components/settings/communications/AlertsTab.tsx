import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
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
import { CommunicationAlert, TRIGGER_EVENTS } from '@/hooks/useCommunications';
import { format } from 'date-fns';

interface AlertsTabProps {
  alerts: CommunicationAlert[];
  onCreateAlert: (alert: Omit<CommunicationAlert, 'id' | 'tenant_id' | 'created_at' | 'updated_at'>) => Promise<CommunicationAlert | null>;
  onUpdateAlert: (id: string, updates: Partial<CommunicationAlert>) => Promise<boolean>;
  onDeleteAlert: (id: string) => Promise<boolean>;
  onEditTemplate: (alertId: string, channel: 'email' | 'sms' | 'in_app') => void;
}

export function AlertsTab({
  alerts,
  onCreateAlert,
  onUpdateAlert,
  onDeleteAlert,
  onEditTemplate,
}: AlertsTabProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [alertToDelete, setAlertToDelete] = useState<CommunicationAlert | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  const [formData, setFormData] = useState({
    name: '',
    key: '',
    description: '',
    trigger_event: '',
    is_enabled: true,
    channels: { email: true, sms: true, in_app: false },
    timing_rule: 'immediate',
  });

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
      setShowCreateDialog(false);
      setFormData({
        name: '',
        key: '',
        description: '',
        trigger_event: '',
        is_enabled: true,
        channels: { email: true, sms: true, in_app: false },
        timing_rule: 'immediate',
      });
    }
  };

  const handleDeleteAlert = async () => {
    if (!alertToDelete) return;
    await onDeleteAlert(alertToDelete.id);
    setAlertToDelete(null);
  };

  const toggleChannel = async (alert: CommunicationAlert, channel: 'email' | 'sms' | 'in_app') => {
    const currentValue = channel === 'in_app' ? (alert.channels.in_app ?? false) : alert.channels[channel];
    const newChannels = {
      ...alert.channels,
      [channel]: !currentValue,
    };
    await onUpdateAlert(alert.id, { channels: newChannels });
  };

  const toggleEnabled = async (alert: CommunicationAlert) => {
    await onUpdateAlert(alert.id, { is_enabled: !alert.is_enabled });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">Alerts</h3>
          <p className="text-sm text-muted-foreground">
            Configure notification alerts and their channels
          </p>
        </div>
        <Button onClick={() => setShowCreateDialog(true)}>
          <MaterialIcon name="add" size="sm" className="mr-2" />
          Create Alert
        </Button>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>SMS</TableHead>
              <TableHead>In-App</TableHead>
              <TableHead>Trigger Event</TableHead>
              <TableHead>Updated</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {alerts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                  No alerts configured. Create your first alert to get started.
                </TableCell>
              </TableRow>
            ) : (
              alerts.map((alert) => (
                <TableRow key={alert.id}>
                  <TableCell className="font-medium">{alert.name}</TableCell>
                  <TableCell>
                    <code className="text-xs bg-muted px-2 py-1 rounded">{alert.key}</code>
                  </TableCell>
                  <TableCell>
                    <Switch
                      checked={alert.is_enabled}
                      onCheckedChange={() => toggleEnabled(alert)}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={alert.channels.email}
                        onCheckedChange={() => toggleChannel(alert, 'email')}
                      />
                      {alert.channels.email && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEditTemplate(alert.id, 'email')}
                        >
                          <MaterialIcon name="edit" size="sm" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={alert.channels.sms}
                        onCheckedChange={() => toggleChannel(alert, 'sms')}
                      />
                      {alert.channels.sms && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEditTemplate(alert.id, 'sms')}
                        >
                          <MaterialIcon name="edit" size="sm" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={alert.channels.in_app ?? false}
                        onCheckedChange={() => toggleChannel(alert, 'in_app')}
                      />
                      {(alert.channels.in_app ?? false) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onEditTemplate(alert.id, 'in_app')}
                        >
                          <MaterialIcon name="edit" size="sm" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {TRIGGER_EVENTS.find(e => e.value === alert.trigger_event)?.label || alert.trigger_event}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {format(new Date(alert.updated_at), 'MMM d, yyyy')}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setAlertToDelete(alert)}
                    >
                      <MaterialIcon name="delete" size="sm" className="text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Create Alert Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="sm:max-w-[500px]">
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
                  {TRIGGER_EVENTS.map((event) => (
                    <SelectItem key={event.value} value={event.value}>
                      {event.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
                    onCheckedChange={(checked) =>
                      setFormData(prev => ({ ...prev, channels: { ...prev.channels, sms: checked } }))
                    }
                  />
                  <MaterialIcon name="chat" size="sm" />
                  <span>SMS</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Switch
                    checked={formData.channels.in_app ?? false}
                    onCheckedChange={(checked) =>
                      setFormData(prev => ({ ...prev, channels: { ...prev.channels, in_app: checked } }))
                    }
                  />
                  <MaterialIcon name="notifications" size="sm" />
                  <span>In-App</span>
                </label>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
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

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!alertToDelete} onOpenChange={() => setAlertToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Alert</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{alertToDelete?.name}"? This will also delete all associated templates and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteAlert} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
