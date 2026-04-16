import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import {
  CommunicationAlert,
  CommunicationTemplate,
  CommunicationTemplateVersion,
  CommunicationDesignElement,
  CommunicationBrandSettings,
  COMMUNICATION_VARIABLES,
} from '@/hooks/useCommunications';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';
import { VariablesDrawer } from './VariablesDrawer';

interface TemplatesTabProps {
  alerts: CommunicationAlert[];
  templates: CommunicationTemplate[];
  designElements: CommunicationDesignElement[];
  brandSettings: CommunicationBrandSettings | null;
  selectedAlertId: string | null;
  selectedChannel: 'email' | 'sms' | 'in_app' | null;
  tenantId: string;
  onUpdateTemplate: (id: string, updates: Partial<CommunicationTemplate>) => Promise<boolean>;
  getTemplateVersions: (templateId: string) => Promise<CommunicationTemplateVersion[]>;
  revertToVersion: (templateId: string, version: CommunicationTemplateVersion) => Promise<boolean>;
  onClose: () => void;
}

export function TemplatesTab({
  alerts,
  templates,
  designElements,
  brandSettings,
  selectedAlertId,
  selectedChannel,
  tenantId,
  onUpdateTemplate,
  getTemplateVersions,
  revertToVersion,
  onClose,
}: TemplatesTabProps) {
  // Initialize with selectedAlertId or first alert
  const [currentAlertId, setCurrentAlertId] = useState(() => 
    selectedAlertId || alerts[0]?.id || ''
  );
  const [currentChannel, setCurrentChannel] = useState<'email' | 'sms' | 'in_app'>(selectedChannel || 'email');
  const [editorMode, setEditorMode] = useState<'rich' | 'code'>('code');
  const [previewContext, setPreviewContext] = useState<'shipment' | 'task' | 'release'>('shipment');
  const [variableSearch, setVariableSearch] = useState('');
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<CommunicationTemplateVersion[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [showTestDialog, setShowTestDialog] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [copiedVar, setCopiedVar] = useState<string | null>(null);
  const [showVariablesDrawer, setShowVariablesDrawer] = useState(false);
  const [showEditorSheet, setShowEditorSheet] = useState(false);
  const { toast } = useToast();
  
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  
  const currentTemplate = templates.find(
    t => t.alert_id === currentAlertId && t.channel === currentChannel
  );
  
  const currentAlert = alerts.find(a => a.id === currentAlertId);
  
  const [formData, setFormData] = useState({
    subject_template: '',
    body_template: '',
    from_name: '',
    from_email: '',
    sms_sender_id: '',
    in_app_recipients: '',
  });

  // Update currentAlertId when selectedAlertId changes or when alerts load
  useEffect(() => {
    if (selectedAlertId) {
      setCurrentAlertId(selectedAlertId);
    } else if (!currentAlertId && alerts.length > 0) {
      setCurrentAlertId(alerts[0].id);
    }
  }, [selectedAlertId, alerts]);

  useEffect(() => {
    if (currentTemplate) {
      setFormData({
        subject_template: currentTemplate.subject_template || '',
        body_template: currentTemplate.body_template || '',
        from_name: currentTemplate.from_name || brandSettings?.from_name || '',
        from_email: currentTemplate.from_email || brandSettings?.from_email || '',
        sms_sender_id: currentTemplate.sms_sender_id || brandSettings?.sms_sender_id || '',
        in_app_recipients: currentTemplate.in_app_recipients || '',
      });
    }
  }, [currentTemplate, brandSettings]);

  useEffect(() => {
    if (selectedChannel) {
      setCurrentChannel(selectedChannel as 'email' | 'sms' | 'in_app');
    }
  }, [selectedChannel]);

  const filteredVariables = COMMUNICATION_VARIABLES.filter(v =>
    v.key.toLowerCase().includes(variableSearch.toLowerCase()) ||
    v.label.toLowerCase().includes(variableSearch.toLowerCase()) ||
    v.group.toLowerCase().includes(variableSearch.toLowerCase())
  );

  const groupedVariables = filteredVariables.reduce((acc, v) => {
    if (!acc[v.group]) acc[v.group] = [];
    acc[v.group].push(v);
    return acc;
  }, {} as Record<string, typeof COMMUNICATION_VARIABLES>);

  const insertVariable = (varKey: string) => {
    const variable = varKey.startsWith('{{') ? varKey : `{{${varKey}}}`;
    setFormData(prev => ({ ...prev, body_template: prev.body_template + variable }));
  };

  const copyVariable = (varKey: string) => {
    navigator.clipboard.writeText(`{{${varKey}}}`);
    setCopiedVar(varKey);
    setTimeout(() => setCopiedVar(null), 2000);
  };

  const insertDesignElement = (element: CommunicationDesignElement) => {
    setFormData(prev => ({ ...prev, body_template: prev.body_template + element.html_snippet }));
  };

  const handleSave = async () => {
    if (!currentTemplate) return;

    setIsSaving(true);
    await onUpdateTemplate(currentTemplate.id, {
      subject_template: formData.subject_template || null,
      body_template: formData.body_template,
      from_name: formData.from_name || null,
      from_email: formData.from_email || null,
      sms_sender_id: formData.sms_sender_id || null,
      in_app_recipients: formData.in_app_recipients || null,
    } as Partial<CommunicationTemplate>);
    setIsSaving(false);
    setShowEditorSheet(false);
    toast({
      title: 'Template saved',
      description: 'Your changes have been saved.',
    });
  };

  const loadVersions = async () => {
    if (!currentTemplate) return;
    const vers = await getTemplateVersions(currentTemplate.id);
    setVersions(vers);
    setShowVersions(true);
  };

  const handleSendTest = async () => {
    if (!testEmail || !formData.subject_template || !tenantId) return;
    
    setIsSendingTest(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-test-email', {
        body: {
          to_email: testEmail,
          subject: formData.subject_template,
          body_html: formData.body_template,
          from_name: formData.from_name,
          from_email: formData.from_email,
          tenant_id: tenantId,
        },
      });

      if (error) throw error;

      toast({
        title: 'Test email sent',
        description: `Email sent to ${testEmail}`,
      });
      setShowTestDialog(false);
      setTestEmail('');
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Failed to send test',
        description: err.message,
      });
    } finally {
      setIsSendingTest(false);
    }
  };

  const handleRevert = async (version: CommunicationTemplateVersion) => {
    if (!currentTemplate) return;
    await revertToVersion(currentTemplate.id, version);
    setShowVersions(false);
  };

  const renderPreview = () => {
    if (!formData.body_template) {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground p-4 text-center">
          No template content to preview
        </div>
      );
    }

    // Replace variables with sample data
    let html = formData.body_template;
    COMMUNICATION_VARIABLES.forEach(v => {
      html = html.replace(new RegExp(`{{${v.key}}}`, 'g'), v.sample);
    });

    // Replace brand settings
    if (brandSettings) {
      html = html.replace(/{{brand_logo_url}}/g, brandSettings.brand_logo_url || '');
      html = html.replace(/{{brand_primary_color}}/g, brandSettings.brand_primary_color);
      html = html.replace(/{{brand_support_email}}/g, brandSettings.brand_support_email || 'support@example.com');
      html = html.replace(/{{portal_base_url}}/g, brandSettings.portal_base_url || 'https://portal.example.com');
    }

    // Sample items list for preview
    const sampleItemsHtml = `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;">
        <tr>
          <td style="background-color:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-weight:600;color:#111111;font-size:15px;">1x Office Chair</td>
              </tr>
              <tr>
                <td style="color:#6b7280;font-size:13px;padding-top:6px;">ITM-001 • Supplier Inc • Row A, Rack 5</td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    `;
    html = html.replace(/{{items_list_html}}/g, sampleItemsHtml);

    // Sample items table for preview
    const sampleItemsTableHtml = `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;border-collapse:collapse;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
        <thead>
          <tr style="background-color:#111111;">
            <th style="padding:14px 16px;text-align:left;font-weight:600;color:#ffffff;font-size:13px;">Item ID</th>
            <th style="padding:14px 16px;text-align:left;font-weight:600;color:#ffffff;font-size:13px;">Description</th>
            <th style="padding:14px 16px;text-align:left;font-weight:600;color:#ffffff;font-size:13px;">Vendor</th>
            <th style="padding:14px 16px;text-align:left;font-weight:600;color:#ffffff;font-size:13px;">Location</th>
          </tr>
        </thead>
        <tbody>
          <tr style="background-color:#ffffff;">
            <td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;font-weight:500;color:#111111;">ITM-001</td>
            <td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;color:#374151;">Office Chair - Black</td>
            <td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Supplier Inc</td>
            <td style="padding:14px 16px;border-bottom:1px solid #e5e7eb;color:#6b7280;">Row A, Rack 5</td>
          </tr>
        </tbody>
      </table>
    `;
    html = html.replace(/{{items_table_html}}/g, sampleItemsTableHtml);

    if (currentChannel === 'sms') {
      return (
        <div className="flex justify-center p-4">
          <div className="w-full max-w-[320px] rounded-[40px] bg-[#111111] p-4 shadow-xl">
            <div className="rounded-[32px] bg-white overflow-hidden">
              <div className="bg-muted p-3 text-center text-xs font-medium border-b">
                Messages
              </div>
              <div className="p-4 min-h-[300px] sm:min-h-[400px] bg-[#f3f4f6]">
                <div className="bg-primary text-primary-foreground rounded-2xl rounded-tl-sm p-3 max-w-[85%] text-sm whitespace-pre-wrap">
                  {formData.body_template.replace(/{{(\w+)}}/g, (_, key) => {
                    const variable = COMMUNICATION_VARIABLES.find(v => v.key === key);
                    return variable?.sample || `[${key}]`;
                  })}
                </div>
                <div className="text-xs text-muted-foreground text-center mt-2">
                  {formData.body_template.length} / 160 characters
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (currentChannel === 'in_app') {
      // Replace variables with sample data for preview
      const previewTitle = (formData.subject_template || currentAlert?.name || 'Notification').replace(/\[\[(\w+)\]\]/g, (_, key) => {
        const variable = COMMUNICATION_VARIABLES.find(v => v.key === key);
        return variable?.sample || `[${key}]`;
      }).replace(/{{(\w+)}}/g, (_, key) => {
        const variable = COMMUNICATION_VARIABLES.find(v => v.key === key);
        return variable?.sample || `[${key}]`;
      });

      const previewBody = formData.body_template.replace(/\[\[(\w+)\]\]/g, (_, key) => {
        const variable = COMMUNICATION_VARIABLES.find(v => v.key === key);
        return variable?.sample || `[${key}]`;
      }).replace(/{{(\w+)}}/g, (_, key) => {
        const variable = COMMUNICATION_VARIABLES.find(v => v.key === key);
        return variable?.sample || `[${key}]`;
      });

      // Determine category from trigger event
      const triggerEvent = currentAlert?.trigger_event || '';
      const category = triggerEvent.split('.')[0].split('_')[0] || 'system';

      // Parse recipient roles for display
      const recipientRoles = (formData.in_app_recipients || '').split(',')
        .map(r => r.trim().replace(/\[\[|\]\]|{{|}}/g, '').replace(/_role$/, ''))
        .filter(Boolean)
        .map(r => r.replace(/_/g, ' '));

      return (
        <div className="flex flex-col items-center justify-center p-4 sm:p-6 gap-6">
          {/* iPhone-style notification preview */}
          <div className="w-full max-w-[380px]">
            {/* Lock screen notification */}
            <div className="rounded-2xl bg-white/80 dark:bg-white/10 backdrop-blur-xl border border-white/20 dark:border-white/10 shadow-lg overflow-hidden">
              {/* Notification header */}
              <div className="flex items-center gap-3 px-4 pt-3 pb-1">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center flex-shrink-0 shadow-sm">
                  <MaterialIcon name="notifications" size="sm" className="text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
                      {brandSettings?.from_name || 'Stride WMS'}
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">now</span>
                  </div>
                </div>
              </div>
              {/* Notification content */}
              <div className="px-4 pb-3">
                <p className="text-[15px] font-semibold text-gray-900 dark:text-gray-100 leading-tight">
                  {previewTitle}
                </p>
                <p className="text-[14px] text-gray-600 dark:text-gray-300 mt-0.5 leading-snug line-clamp-3">
                  {previewBody}
                </p>
              </div>
            </div>

            {/* In-app notification card (how it looks in Messages tab) */}
            <div className="mt-6">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Messages / Notifications Tab</p>
              <div className="rounded-xl border bg-card overflow-hidden shadow-sm">
                <div className="flex items-start gap-3 p-4 bg-blue-50/50 dark:bg-blue-950/20 border-l-2 border-l-blue-500">
                  {/* Unread indicator */}
                  <div className="w-2.5 h-2.5 rounded-full bg-blue-500 mt-1.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold text-sm text-foreground truncate">{previewTitle}</p>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">2 min ago</span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-0.5 line-clamp-2">{previewBody}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="secondary" className="text-xs capitalize">{category}</Badge>
                      {recipientRoles.length > 0 && (
                        <span className="text-xs text-muted-foreground">
                          → {recipientRoles.join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <iframe
        srcDoc={html}
        className="w-full h-full border-0 bg-white min-h-[300px]"
        title="Email Preview"
        sandbox="allow-same-origin"
      />
    );
  };

  const recipientsInputRef = useRef<HTMLInputElement>(null);

  const insertRecipientVariable = (varKey: string) => {
    const token = `[[${varKey}]]`;
    const current = formData.in_app_recipients;
    const updated = current ? `${current}, ${token}` : token;
    setFormData(prev => ({ ...prev, in_app_recipients: updated }));
  };

  const renderEditorPanel = () => (
    <div className="flex flex-col gap-4 overflow-auto h-full">
      {/* From Settings (Email only) */}
      {currentChannel === 'email' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="from_name">From Name</Label>
            <Input
              id="from_name"
              placeholder="e.g., Stride Logistics"
              value={formData.from_name}
              onChange={(e) => setFormData(prev => ({ ...prev, from_name: e.target.value }))}
              className="h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="from_email">From Email</Label>
            <Input
              id="from_email"
              type="email"
              placeholder="e.g., notifications@stride.com"
              value={formData.from_email}
              onChange={(e) => setFormData(prev => ({ ...prev, from_email: e.target.value }))}
              className="h-11"
            />
          </div>
        </div>
      )}

      {/* SMS Sender (SMS only) */}
      {currentChannel === 'sms' && (
        <div className="space-y-2">
          <Label htmlFor="sms_sender">SMS Sender ID</Label>
          <Input
            id="sms_sender"
            placeholder="e.g., STRIDE or +1234567890"
            value={formData.sms_sender_id}
            onChange={(e) => setFormData(prev => ({ ...prev, sms_sender_id: e.target.value }))}
            className="h-11"
          />
          <p className="text-xs text-muted-foreground">
            Alphanumeric sender ID or phone number (requires Twilio)
          </p>
        </div>
      )}

      {/* In-App Notification Recipients */}
      {currentChannel === 'in_app' && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="in_app_recipients">Recipients</Label>
            <Input
              ref={recipientsInputRef}
              id="in_app_recipients"
              placeholder="e.g., [[manager_role]], [[client_user_role]]"
              value={formData.in_app_recipients}
              onChange={(e) => setFormData(prev => ({ ...prev, in_app_recipients: e.target.value }))}
              className="h-11 font-mono text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated role tokens. Use the variables panel to insert recipient roles.
            </p>
          </div>

          {/* Quick role buttons */}
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Quick Add Roles</Label>
            <div className="flex flex-wrap gap-2">
              {[
                { key: 'admin_role', label: 'Admin', icon: 'shield_person' },
                { key: 'manager_role', label: 'Manager', icon: 'supervisor_account' },
                { key: 'warehouse_role', label: 'Warehouse', icon: 'warehouse' },
                { key: 'client_user_role', label: 'Client User', icon: 'person' },
              ].map(role => {
                const isActive = formData.in_app_recipients.includes(`[[${role.key}]]`);
                return (
                  <Button
                    key={role.key}
                    variant={isActive ? 'default' : 'outline'}
                    size="sm"
                    className="h-9 gap-1.5"
                    onClick={() => {
                      if (isActive) {
                        // Remove role token
                        const updated = formData.in_app_recipients
                          .replace(new RegExp(`\\[\\[${role.key}\\]\\],?\\s*`), '')
                          .replace(/,\s*$/, '')
                          .trim();
                        setFormData(prev => ({ ...prev, in_app_recipients: updated }));
                      } else {
                        insertRecipientVariable(role.key);
                      }
                    }}
                  >
                    <MaterialIcon name={role.icon} size="sm" />
                    {role.label}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Auto-generated notification info */}
          <Card>
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                <MaterialIcon name="info" size="sm" className="text-blue-500 mt-0.5" />
                <div className="text-sm text-muted-foreground">
                  <p className="font-medium text-foreground mb-1">Auto-generated content</p>
                  <p>The notification title and body are automatically generated from the alert type. The preview on the right shows what recipients will see.</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Subject (Email only) */}
      {currentChannel === 'email' && (
        <div className="space-y-2">
          <Label htmlFor="subject">Subject Line</Label>
          <Input
            ref={subjectRef}
            id="subject"
            placeholder="Email subject with {{variables}}"
            value={formData.subject_template}
            onChange={(e) => setFormData(prev => ({ ...prev, subject_template: e.target.value }))}
            className="h-11"
          />
        </div>
      )}

      {/* Body Editor (Email and SMS only) */}
      {currentChannel !== 'in_app' && <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <Label>Body</Label>
          {currentChannel === 'email' && (
            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-9 touch-target">
                    <span className="hidden sm:inline">Insert Element</span>
                    <span className="sm:hidden">Insert</span>
                    <MaterialIcon name="expand_more" size="sm" className="ml-2" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[200px]">
                  {['icon', 'divider', 'callout', 'button', 'header_block'].map(category => {
                    const categoryElements = designElements.filter(e => e.category === category);
                    if (categoryElements.length === 0) return null;
                    return (
                      <div key={category}>
                        <DropdownMenuLabel className="capitalize">{category.replace('_', ' ')}</DropdownMenuLabel>
                        {categoryElements.map(element => (
                          <DropdownMenuItem
                            key={element.id}
                            onClick={() => insertDesignElement(element)}
                            className="h-11"
                          >
                            {element.name}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                      </div>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
              
              <Tabs value={editorMode} onValueChange={(v) => setEditorMode(v as 'rich' | 'code')}>
                <TabsList className="h-9">
                  <TabsTrigger value="code" className="text-xs px-3 h-7">
                    <MaterialIcon name="code" size="sm" className="mr-1" />
                    <span className="hidden sm:inline">Code</span>
                  </TabsTrigger>
                  <TabsTrigger value="rich" className="text-xs px-3 h-7" disabled>
                    <span className="hidden sm:inline">Rich</span>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          )}
        </div>
        
        <Textarea
          ref={bodyRef}
          className="flex-1 min-h-[200px] font-mono text-sm resize-none"
          placeholder={currentChannel === 'email' ? 'HTML template with {{variables}}' : 'SMS message with {{variables}}'}
          value={formData.body_template}
          onChange={(e) => setFormData(prev => ({ ...prev, body_template: e.target.value }))}
        />
        
        {currentChannel === 'sms' && (
          <div className="flex items-center justify-between mt-2 text-sm">
            <span className="text-muted-foreground">Characters: {formData.body_template.length}</span>
            <span className={formData.body_template.length > 160 ? 'text-destructive' : 'text-muted-foreground'}>
              {Math.ceil(formData.body_template.length / 160)} SMS segment(s)
            </span>
          </div>
        )}
      </div>}

      {/* Variables Panel - Desktop only */}
      <Card className="flex-shrink-0 hidden lg:block">
        <CardHeader className="py-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm font-medium">Variables</CardTitle>
            <div className="relative w-full sm:w-[200px]">
              <MaterialIcon name="search" size="sm" className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search variables..."
                className="pl-8 h-8 text-sm"
                value={variableSearch}
                onChange={(e) => setVariableSearch(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <ScrollArea className="h-[200px]">
            <div className="space-y-4">
              {Object.entries(groupedVariables).map(([group, vars]) => (
                <div key={group}>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                    {group}
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {vars.map((variable) => (
                      <TooltipProvider key={variable.key}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className="flex items-center justify-between p-2 rounded-md hover:bg-muted cursor-pointer group text-sm touch-target"
                              onClick={() => insertVariable(variable.key)}
                            >
                              <span className="font-mono text-xs truncate">
                                {`{{${variable.key}}}`}
                              </span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  copyVariable(variable.key);
                                }}
                              >
                                {copiedVar === variable.key ? (
                                  <MaterialIcon name="check" size="sm" className="text-green-500" />
                                ) : (
                                  <MaterialIcon name="content_copy" size="sm" />
                                )}
                              </Button>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-[250px]">
                            <p className="font-medium">{variable.label}</p>
                            <p className="text-xs text-muted-foreground">{variable.description}</p>
                            <p className="text-xs mt-1">Sample: <code>{variable.sample}</code></p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );

  const renderPreviewPanel = () => (
    <div className="flex flex-col border rounded-lg overflow-hidden bg-muted/30 h-full min-h-[400px]">
      <div className="flex items-center justify-between p-3 border-b bg-background flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <MaterialIcon name="visibility" size="sm" />
          <span className="font-medium text-sm">Live Preview</span>
        </div>
        <Select value={previewContext} onValueChange={(v) => setPreviewContext(v as any)}>
          <SelectTrigger className="w-full sm:w-[150px] h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="shipment">Sample Shipment</SelectItem>
            <SelectItem value="task">Sample Task</SelectItem>
            <SelectItem value="release">Sample Release</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex-1 overflow-auto">
        {renderPreview()}
      </div>
    </div>
  );

  // Show selection UI if no alert is selected
  if (!currentAlertId || !alerts.find(a => a.id === currentAlertId)) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center px-4">
        <MaterialIcon name="mail" size="lg" className="text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">Select an Alert to Edit Templates</h3>
        <p className="text-muted-foreground mb-4">
          Choose an alert from the dropdown or go to the Alerts tab to create one.
        </p>
        <Select value={currentAlertId} onValueChange={setCurrentAlertId}>
          <SelectTrigger className="w-full max-w-[300px] h-11">
            <SelectValue placeholder="Select an alert" />
          </SelectTrigger>
          <SelectContent>
            {alerts.map((alert) => (
              <SelectItem key={alert.id} value={alert.id}>
                {alert.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    );
  }

  return (
    <>
      {/* Mobile Layout - Optimized for native apps */}
      <div className="flex flex-col h-[calc(100dvh-200px)] lg:hidden">
        {/* Compact Mobile Header - 48px with touch targets */}
        <div className="flex items-center gap-2 py-2 border-b bg-background">
          {/* Alert Selector */}
          <Select value={currentAlertId} onValueChange={setCurrentAlertId}>
            <SelectTrigger className="flex-1 h-11 min-w-0">
              <SelectValue placeholder="Select alert" />
            </SelectTrigger>
            <SelectContent>
              {alerts.map((alert) => (
                <SelectItem key={alert.id} value={alert.id}>
                  {alert.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          {/* Channel Toggle - Icon only for space */}
          <div className="flex border rounded-lg">
            <button
              onClick={() => setCurrentChannel('email')}
              className={`h-11 w-11 flex items-center justify-center rounded-l-lg transition-colors ${
                currentChannel === 'email'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-muted'
              }`}
            >
              <MaterialIcon name="mail" size="md" />
            </button>
            <button
              onClick={() => setCurrentChannel('sms')}
              className={`h-11 w-11 flex items-center justify-center transition-colors ${
                currentChannel === 'sms'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-muted'
              }`}
            >
              <MaterialIcon name="chat" size="md" />
            </button>
            <button
              onClick={() => setCurrentChannel('in_app')}
              className={`h-11 w-11 flex items-center justify-center rounded-r-lg transition-colors ${
                currentChannel === 'in_app'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-background hover:bg-muted'
              }`}
            >
              <MaterialIcon name="notifications" size="md" />
            </button>
          </div>
          
          {/* More Actions Menu */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className="h-11 w-11 shrink-0">
                <MaterialIcon name="more_vert" size="md" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => setShowVariablesDrawer(true)} className="h-11">
                <MaterialIcon name="data_object" size="sm" className="mr-2" />
                Insert Variable
              </DropdownMenuItem>
              <DropdownMenuItem onClick={loadVersions} className="h-11">
                <MaterialIcon name="history" size="sm" className="mr-2" />
                Version History
              </DropdownMenuItem>
              {currentChannel === 'email' && (
                <DropdownMenuItem onClick={() => setShowTestDialog(true)} className="h-11">
                  <MaterialIcon name="send" size="sm" className="mr-2" />
                  Send Test Email
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSave} disabled={isSaving} className="h-11">
                <MaterialIcon name="save" size="sm" className="mr-2" />
                {isSaving ? 'Saving...' : 'Save Template'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Full-height Preview */}
        <div className="flex-1 overflow-hidden py-2">
          {renderPreviewPanel()}
        </div>

        {/* Sticky Bottom Edit Button - 48px height with safe area */}
        <div className="border-t bg-background p-2 pb-safe">
          <Button 
            onClick={() => setShowEditorSheet(true)} 
            className="w-full h-12 text-base font-medium"
          >
            <MaterialIcon name="edit" size="md" className="mr-2" />
            Edit Template
          </Button>
        </div>
      </div>

      {/* Desktop Layout */}
      <div className="hidden lg:flex lg:flex-col h-[calc(100vh-350px)] min-h-[600px]">
        {/* Header */}
        <div className="flex flex-col gap-4 pb-4 border-b">
          {/* Row 1: Alert selector and channel toggle */}
          <div className="flex gap-4 items-center">
            <Select value={currentAlertId} onValueChange={setCurrentAlertId}>
              <SelectTrigger className="w-[250px]">
                <SelectValue placeholder="Select alert" />
              </SelectTrigger>
              <SelectContent>
                {alerts.map((alert) => (
                  <SelectItem key={alert.id} value={alert.id}>
                    {alert.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <Tabs value={currentChannel} onValueChange={(v) => setCurrentChannel(v as 'email' | 'sms' | 'in_app')}>
              <TabsList>
                <TabsTrigger value="email" className="gap-2">
                  <MaterialIcon name="mail" size="sm" />
                  Email
                </TabsTrigger>
                <TabsTrigger value="sms" className="gap-2">
                  <MaterialIcon name="chat" size="sm" />
                  SMS
                </TabsTrigger>
                <TabsTrigger value="in_app" className="gap-2">
                  <MaterialIcon name="notifications" size="sm" />
                  In-App
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          
          {/* Row 2: Actions */}
          <div className="flex items-center gap-2 justify-end">
            {currentChannel === 'email' && (
              <Button variant="outline" size="sm" onClick={() => setShowTestDialog(true)}>
                <MaterialIcon name="send" size="sm" className="mr-2" />
                Send Test
              </Button>
            )}
            
            <Button variant="outline" size="sm" onClick={loadVersions}>
              <MaterialIcon name="history" size="sm" className="mr-2" />
              Versions
            </Button>
            
            <Button onClick={handleSave} disabled={isSaving} size="sm">
              <MaterialIcon name="save" size="sm" className="mr-2" />
              {isSaving ? 'Saving...' : 'Save Template'}
            </Button>
          </div>
        </div>

        {/* Side by side */}
        <div className="grid grid-cols-2 gap-4 pt-4 flex-1 overflow-hidden">
          {renderEditorPanel()}
          {renderPreviewPanel()}
        </div>
      </div>

      {/* Mobile Editor Sheet - 90vh height */}
      <Sheet open={showEditorSheet} onOpenChange={setShowEditorSheet}>
        <SheetContent side="bottom" className="h-[90vh] flex flex-col p-0">
          <SheetHeader className="px-4 py-3 border-b">
            <div className="flex items-center justify-between">
              <SheetTitle className="text-base">Edit Template</SheetTitle>
              <Button 
                variant="ghost" 
                size="icon" 
                className="h-9 w-9"
                onClick={() => setShowEditorSheet(false)}
              >
                <MaterialIcon name="close" size="md" />
              </Button>
            </div>
          </SheetHeader>
          
          <div className="flex-1 overflow-auto p-4">
            {renderEditorPanel()}
          </div>
          
          <SheetFooter className="px-4 py-3 border-t pb-safe">
            <div className="flex gap-3 w-full">
              <Button 
                variant="outline" 
                onClick={() => setShowEditorSheet(false)}
                className="flex-1 h-12"
              >
                Cancel
              </Button>
              <Button 
                onClick={handleSave} 
                disabled={isSaving}
                className="flex-1 h-12"
              >
                {isSaving ? (
                  <>
                    <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <MaterialIcon name="save" size="sm" className="mr-2" />
                    Save
                  </>
                )}
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Variables Drawer */}
      <VariablesDrawer
        open={showVariablesDrawer}
        onOpenChange={setShowVariablesDrawer}
        designElements={designElements}
        onInsertVariable={insertVariable}
        onInsertDesignElement={insertDesignElement}
      />

      {/* Version History Dialog */}
      <Dialog open={showVersions} onOpenChange={setShowVersions}>
        <DialogContent className="max-w-[600px] max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Template Version History</DialogTitle>
            <DialogDescription>
              View and restore previous versions of this template.
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="flex-1 max-h-[400px]">
            {versions.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No version history available yet.
              </div>
            ) : (
              <div className="space-y-3 pr-4">
                {versions.map((version) => (
                  <Card key={version.id}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <Badge variant="outline">Version {version.version_number}</Badge>
                          <p className="text-sm text-muted-foreground mt-1">
                            {format(new Date(version.created_at), 'MMM d, yyyy h:mm a')}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRevert(version)}
                          className="h-11"
                        >
                          Restore
                        </Button>
                      </div>
                      {version.subject_template && (
                        <p className="text-sm mt-2 truncate">
                          Subject: {version.subject_template}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Send Test Dialog */}
      <Dialog open={showTestDialog} onOpenChange={setShowTestDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send Test Email</DialogTitle>
            <DialogDescription>Enter an email address to send a test of this template</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="test-email">Email Address</Label>
              <Input
                id="test-email"
                type="email"
                placeholder="your@email.com"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                className="h-11"
              />
            </div>
          </div>
          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button variant="outline" onClick={() => setShowTestDialog(false)} className="w-full sm:w-auto h-12">
              Cancel
            </Button>
            <Button onClick={handleSendTest} disabled={isSendingTest || !testEmail} className="w-full sm:w-auto h-12">
              {isSendingTest ? <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" /> : <MaterialIcon name="send" size="sm" className="mr-2" />}
              {isSendingTest ? 'Sending...' : 'Send Test'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
