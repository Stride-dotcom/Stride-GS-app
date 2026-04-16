import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
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
import { ScrollArea } from '@/components/ui/scroll-area';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useTestAlertPreferences } from '@/hooks/useTestAlertPreferences';
import { useRecentEntities } from '@/hooks/useRecentEntities';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { COMMUNICATION_VARIABLES } from '@/hooks/useCommunications';

interface SendTestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tenantId: string;
  channel?: 'email' | 'sms';
  subject?: string;
  bodyHtml?: string;
  bodyText?: string;
  fromName?: string;
  fromEmail?: string;
}

export function SendTestDialog({
  open,
  onOpenChange,
  tenantId,
  channel = 'email',
  subject = '',
  bodyHtml = '',
  bodyText = '',
  fromName,
  fromEmail,
}: SendTestDialogProps) {
  const { toast } = useToast();
  const { testEmail, testPhone, setTestEmail, setTestPhone, loading: prefsLoading } = useTestAlertPreferences();
  const { shipments, tasks, items, loading: entitiesLoading } = useRecentEntities(tenantId);

  const [activeChannel, setActiveChannel] = useState<'email' | 'sms'>(channel);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [rememberEmail, setRememberEmail] = useState(true);
  const [rememberPhone, setRememberPhone] = useState(true);
  const [dataSource, setDataSource] = useState<string>('sample');
  const [isSending, setIsSending] = useState(false);

  // Initialize from saved preferences
  useEffect(() => {
    if (!prefsLoading) {
      if (testEmail) setEmail(testEmail);
      if (testPhone) setPhone(testPhone);
    }
  }, [testEmail, testPhone, prefsLoading]);

  // Reset channel when dialog opens
  useEffect(() => {
    if (open) {
      setActiveChannel(channel);
    }
  }, [open, channel]);

  const parseDataSource = () => {
    if (dataSource === 'sample') return { type: null, id: null };
    const [type, id] = dataSource.split(':');
    return { type: type as 'shipment' | 'task' | 'item', id };
  };

  const getPreviewText = () => {
    const text = activeChannel === 'email' ? bodyHtml : bodyText;
    if (!text) return 'No message content';

    let preview = text;
    COMMUNICATION_VARIABLES.forEach(v => {
      const regexBraces = new RegExp(`{{${v.key}}}`, 'g');
      const regexBrackets = new RegExp(`\\[\\[${v.key}\\]\\]`, 'g');
      preview = preview.replace(regexBraces, v.sample).replace(regexBrackets, v.sample);
    });

    // Strip HTML for preview
    if (activeChannel === 'email') {
      const div = document.createElement('div');
      div.innerHTML = preview;
      preview = div.textContent || div.innerText || '';
    }

    return preview.slice(0, 200) + (preview.length > 200 ? '...' : '');
  };

  const handleSend = async () => {
    const { type: entityType, id: entityId } = parseDataSource();

    if (activeChannel === 'email') {
      if (!email) {
        toast({ variant: 'destructive', title: 'Email required', description: 'Please enter an email address' });
        return;
      }
    } else {
      if (!phone) {
        toast({ variant: 'destructive', title: 'Phone required', description: 'Please enter a phone number' });
        return;
      }
    }

    setIsSending(true);

    try {
      if (activeChannel === 'email') {
        // Save preference if checked
        if (rememberEmail && email !== testEmail) {
          await setTestEmail(email);
        }

        console.log('Sending test email to:', email);
        const { data, error } = await supabase.functions.invoke('send-test-email', {
          body: {
            to_email: email,
            subject: subject || 'Test Email',
            body_html: bodyHtml || '<p>This is a test email.</p>',
            from_name: fromName,
            from_email: fromEmail,
            tenant_id: tenantId,
            entity_type: entityType,
            entity_id: entityId,
          },
        });

        console.log('Email response:', data, error);
        if (error) throw error;

        toast({
          title: 'Test email sent',
          description: `Email sent to ${email}`,
        });
      } else {
        // Save preference if checked
        if (rememberPhone && phone !== testPhone) {
          await setTestPhone(phone);
        }

        // Use bodyText for SMS, fall back to stripped HTML if needed
        let smsBody = bodyText;
        if (!smsBody && bodyHtml) {
          const div = document.createElement('div');
          div.innerHTML = bodyHtml;
          smsBody = div.textContent || div.innerText || '';
        }

        console.log('Sending test SMS to:', phone, 'body:', smsBody);
        const { data, error } = await supabase.functions.invoke('send-test-sms', {
          body: {
            to_phone: phone,
            body: smsBody || 'This is a test SMS message.',
            tenant_id: tenantId,
            entity_type: entityType,
            entity_id: entityId,
          },
        });

        console.log('SMS response:', data, error);
        if (error) throw error;

        toast({
          title: 'Test SMS sent',
          description: `SMS sent to ${phone}`,
        });
      }

      onOpenChange(false);
    } catch (error: any) {
      console.error('Error sending test:', error);
      
      // Extract detailed error message if available
      let errorMessage = 'An error occurred';
      if (error?.context?.body?.error) {
        errorMessage = error.context.body.error;
      } else if (error?.message) {
        errorMessage = error.message;
      }
      
      toast({
        variant: 'destructive',
        title: 'Failed to send test',
        description: errorMessage,
      });
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90dvh] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>Send Test Alert</DialogTitle>
          <DialogDescription>
            Send a test notification to verify your template looks correct
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0 space-y-4">
          <Tabs value={activeChannel} onValueChange={(v) => setActiveChannel(v as 'email' | 'sms')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="email" className="gap-2">
                <MaterialIcon name="mail" size="sm" />
                Email
              </TabsTrigger>
              <TabsTrigger value="sms" className="gap-2">
                <MaterialIcon name="chat" size="sm" />
                SMS
              </TabsTrigger>
            </TabsList>

            <TabsContent value="email" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="test-email">Email Address</Label>
                <Input
                  id="test-email"
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="remember-email"
                  checked={rememberEmail}
                  onCheckedChange={(checked) => setRememberEmail(checked === true)}
                />
                <Label htmlFor="remember-email" className="text-sm text-muted-foreground">
                  Remember for next time
                </Label>
              </div>
            </TabsContent>

            <TabsContent value="sms" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="test-phone">Phone Number</Label>
                <Input
                  id="test-phone"
                  type="tel"
                  placeholder="+1 (555) 123-4567"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Include country code for international numbers
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="remember-phone"
                  checked={rememberPhone}
                  onCheckedChange={(checked) => setRememberPhone(checked === true)}
                />
                <Label htmlFor="remember-phone" className="text-sm text-muted-foreground">
                  Remember for next time
                </Label>
              </div>
            </TabsContent>
          </Tabs>

          <div className="space-y-2 pt-2">
            <Label>Test Data Source</Label>
            <Select value={dataSource} onValueChange={setDataSource}>
              <SelectTrigger>
                <SelectValue placeholder="Select data source" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sample">
                  <span className="flex items-center gap-2">
                    Use sample data
                  </span>
                </SelectItem>
                
                {shipments.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground flex items-center gap-2">
                      <MaterialIcon name="package_2" size="sm" />
                      Recent Shipments
                    </div>
                    {shipments.map((s) => (
                      <SelectItem key={s.id} value={`shipment:${s.id}`}>
                        {s.shipment_number} {s.account_name ? `- ${s.account_name}` : ''}
                      </SelectItem>
                    ))}
                  </>
                )}

                {tasks.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground flex items-center gap-2">
                      <MaterialIcon name="checklist" size="sm" />
                      Recent Tasks
                    </div>
                    {tasks.map((t) => (
                      <SelectItem key={t.id} value={`task:${t.id}`}>
                        {t.title} ({t.task_type})
                      </SelectItem>
                    ))}
                  </>
                )}

                {items.length > 0 && (
                  <>
                    <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground flex items-center gap-2">
                      <MaterialIcon name="inventory_2" size="sm" />
                      Recent Items
                    </div>
                    {items.map((i) => (
                      <SelectItem key={i.id} value={`item:${i.id}`}>
                        {i.item_code} {i.description ? `- ${i.description.slice(0, 30)}` : ''}
                      </SelectItem>
                    ))}
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Preview */}
          <div className="rounded-lg border bg-muted/50 p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">Preview</p>
            <ScrollArea className="h-[80px]">
              <p className="text-sm">{getPreviewText()}</p>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter className="flex-shrink-0 gap-2 sm:gap-0 pt-4 border-t mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSend} disabled={isSending}>
            {isSending ? (
              <>
                <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                Sending...
              </>
            ) : (
              <>
                <MaterialIcon name="send" size="sm" className="mr-2" />
                Send Test {activeChannel === 'email' ? 'Email' : 'SMS'}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
