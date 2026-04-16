import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { CommunicationTemplate } from '@/hooks/useCommunications';

interface TestSendDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  alertName: string;
  emailEnabled: boolean;
  smsEnabled: boolean;
  emailTemplate: CommunicationTemplate | null;
  smsTemplate: CommunicationTemplate | null;
}

export function TestSendDialog({
  open,
  onOpenChange,
  alertName,
  emailEnabled,
  smsEnabled,
  emailTemplate,
  smsTemplate,
}: TestSendDialogProps) {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [testPhone, setTestPhone] = useState('');
  const [activeTab, setActiveTab] = useState(emailEnabled ? 'email' : 'sms');
  const [lastSentTo, setLastSentTo] = useState<{ type: 'email' | 'sms'; value: string } | null>(null);

  const handleSendTestEmail = async () => {
    if (!testEmail || !profile?.tenant_id) {
      toast({
        variant: 'destructive',
        title: 'Email Required',
        description: 'Please enter an email address to send the test to.',
      });
      return;
    }

    if (!emailTemplate) {
      toast({
        variant: 'destructive',
        title: 'No Template',
        description: 'Please create an email template first before testing.',
      });
      return;
    }

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-test-email', {
        body: {
          to_email: testEmail,
          subject: emailTemplate.subject_template || `Test: ${alertName}`,
          body_html: emailTemplate.body_template || '<p>This is a test email. Your template content will appear here.</p>',
          tenant_id: profile.tenant_id,
        },
      });

      if (error) throw error;

      if (data?.success) {
        setLastSentTo({ type: 'email', value: testEmail });
        toast({
          title: 'Test Email Sent!',
          description: `Check your inbox at ${testEmail}`,
        });
      } else {
        throw new Error(data?.error || 'Failed to send test email');
      }
    } catch (error: any) {
      console.error('Error sending test email:', error);
      toast({
        variant: 'destructive',
        title: 'Send Failed',
        description: error.message || 'Failed to send test email. Please try again.',
      });
    } finally {
      setSending(false);
    }
  };

  const handleSendTestSms = async () => {
    if (!testPhone || !profile?.tenant_id) {
      toast({
        variant: 'destructive',
        title: 'Phone Number Required',
        description: 'Please enter a phone number to send the test to.',
      });
      return;
    }

    if (!smsTemplate) {
      toast({
        variant: 'destructive',
        title: 'No Template',
        description: 'Please create an SMS template first before testing.',
      });
      return;
    }

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-test-sms', {
        body: {
          to_phone: testPhone,
          body: smsTemplate.body_template || `Test message for ${alertName}. Your SMS content will appear here.`,
          tenant_id: profile.tenant_id,
        },
      });

      if (error) throw error;

      if (data?.success) {
        setLastSentTo({ type: 'sms', value: testPhone });
        toast({
          title: 'Test SMS Sent!',
          description: `Check your phone at ${testPhone}`,
        });
      } else {
        throw new Error(data?.error || 'Failed to send test SMS');
      }
    } catch (error: any) {
      console.error('Error sending test SMS:', error);
      toast({
        variant: 'destructive',
        title: 'Send Failed',
        description: error.message || 'Failed to send test SMS. Please try again.',
      });
    } finally {
      setSending(false);
    }
  };

  const hasNoChannels = !emailEnabled && !smsEnabled;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MaterialIcon name="send" size="md" />
            Send Test Alert
          </DialogTitle>
          <DialogDescription>
            Send a test notification to yourself to preview how it will look
          </DialogDescription>
        </DialogHeader>

        {hasNoChannels ? (
          <Alert variant="destructive">
            <MaterialIcon name="warning" size="sm" />
            <AlertDescription>
              No channels are enabled for this alert. Enable Email or SMS in the header above to send test notifications.
            </AlertDescription>
          </Alert>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-4">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="email" disabled={!emailEnabled} className="gap-2">
                <MaterialIcon name="mail" size="sm" />
                Email
              </TabsTrigger>
              <TabsTrigger value="sms" disabled={!smsEnabled} className="gap-2">
                <MaterialIcon name="chat" size="sm" />
                SMS
              </TabsTrigger>
            </TabsList>

            <TabsContent value="email" className="space-y-4 mt-4">
              {!emailTemplate ? (
                <Alert>
                  <MaterialIcon name="info" size="sm" />
                  <AlertDescription>
                    No email template has been created yet. Go to the "Email HTML" tab to create your template first.
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="test-email">Your Email Address</Label>
                    <Input
                      id="test-email"
                      type="email"
                      placeholder="you@example.com"
                      value={testEmail}
                      onChange={(e) => setTestEmail(e.target.value)}
                      disabled={sending}
                    />
                    <p className="text-xs text-muted-foreground">
                      A test email will be sent with your current template. Sample data will be used for any variables.
                    </p>
                  </div>

                  {lastSentTo?.type === 'email' && (
                    <Alert className="border-green-200 bg-green-50">
                      <MaterialIcon name="check_circle" size="sm" className="text-green-600" />
                      <AlertDescription className="text-green-800">
                        Test sent to {lastSentTo.value}! Check your inbox (and spam folder).
                      </AlertDescription>
                    </Alert>
                  )}

                  <Button
                    onClick={handleSendTestEmail}
                    disabled={sending || !testEmail}
                    className="w-full"
                  >
                    {sending ? (
                      <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                    ) : (
                      <MaterialIcon name="send" size="sm" className="mr-2" />
                    )}
                    Send Test Email
                  </Button>
                </>
              )}
            </TabsContent>

            <TabsContent value="sms" className="space-y-4 mt-4">
              {!smsTemplate ? (
                <Alert>
                  <MaterialIcon name="info" size="sm" />
                  <AlertDescription>
                    No SMS template has been created yet. Go to the "SMS" tab to create your template first.
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="test-phone">Your Phone Number</Label>
                    <Input
                      id="test-phone"
                      type="tel"
                      placeholder="(555) 123-4567"
                      value={testPhone}
                      onChange={(e) => setTestPhone(e.target.value)}
                      disabled={sending}
                    />
                    <p className="text-xs text-muted-foreground">
                      Include country code if outside US (e.g., +44 for UK). Sample data will be used for any variables.
                    </p>
                  </div>

                  {lastSentTo?.type === 'sms' && (
                    <Alert className="border-green-200 bg-green-50">
                      <MaterialIcon name="check_circle" size="sm" className="text-green-600" />
                      <AlertDescription className="text-green-800">
                        Test sent to {lastSentTo.value}! Check your phone.
                      </AlertDescription>
                    </Alert>
                  )}

                  <Alert className="bg-amber-50 border-amber-200">
                    <MaterialIcon name="info" size="sm" className="text-amber-600" />
                    <AlertDescription className="text-amber-800 text-xs">
                      <strong>Note:</strong> If using a Twilio trial account, you can only send to verified phone numbers.
                      Verify your number in the Twilio console first.
                    </AlertDescription>
                  </Alert>

                  <Button
                    onClick={handleSendTestSms}
                    disabled={sending || !testPhone}
                    className="w-full"
                  >
                    {sending ? (
                      <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                    ) : (
                      <MaterialIcon name="send" size="sm" className="mr-2" />
                    )}
                    Send Test SMS
                  </Button>
                </>
              )}
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
