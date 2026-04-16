import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { CommunicationBrandSettings } from '@/hooks/useCommunications';

interface BrandSettingsCardProps {
  brandSettings: CommunicationBrandSettings | null;
  onUpdate: (updates: Partial<CommunicationBrandSettings>) => Promise<boolean>;
}

export function BrandSettingsCard({ brandSettings, onUpdate }: BrandSettingsCardProps) {
  const [formData, setFormData] = useState({
    brand_logo_url: '',
    brand_primary_color: '#FD5A2A',
    brand_support_email: '',
    portal_base_url: '',
    from_name: '',
    from_email: '',
    sms_sender_id: '',
  });
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (brandSettings) {
      setFormData({
        brand_logo_url: brandSettings.brand_logo_url || '',
        brand_primary_color: brandSettings.brand_primary_color || '#FD5A2A',
        brand_support_email: brandSettings.brand_support_email || '',
        portal_base_url: brandSettings.portal_base_url || '',
        from_name: brandSettings.from_name || '',
        from_email: brandSettings.from_email || '',
        sms_sender_id: brandSettings.sms_sender_id || '',
      });
    }
  }, [brandSettings]);

  const handleSave = async () => {
    setIsSaving(true);
    await onUpdate({
      brand_logo_url: formData.brand_logo_url || null,
      brand_primary_color: formData.brand_primary_color,
      brand_support_email: formData.brand_support_email || null,
      portal_base_url: formData.portal_base_url || null,
      from_name: formData.from_name || null,
      from_email: formData.from_email || null,
      sms_sender_id: formData.sms_sender_id || null,
    });
    setIsSaving(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MaterialIcon name="palette" size="md" className="text-primary flex-shrink-0" />
          <div>
            <CardTitle>Brand Settings</CardTitle>
            <CardDescription>
              Configure default branding for all communication templates
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          {/* Brand Identity */}
          <div className="space-y-4">
            <h4 className="font-medium text-sm">Brand Identity</h4>
            
            <div className="space-y-2">
              <Label htmlFor="brand_logo_url">Logo URL</Label>
              <Input
                id="brand_logo_url"
                type="url"
                placeholder="https://example.com/logo.png"
                value={formData.brand_logo_url}
                onChange={(e) => setFormData(prev => ({ ...prev, brand_logo_url: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                URL to your company logo. Appears in email headers.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="brand_primary_color">Primary Brand Color</Label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  id="brand_primary_color"
                  value={formData.brand_primary_color}
                  onChange={(e) => setFormData(prev => ({ ...prev, brand_primary_color: e.target.value }))}
                  className="w-10 h-10 rounded border cursor-pointer flex-shrink-0"
                />
                <Input
                  value={formData.brand_primary_color}
                  onChange={(e) => setFormData(prev => ({ ...prev, brand_primary_color: e.target.value }))}
                  className="flex-1"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="brand_support_email">Support Email</Label>
              <Input
                id="brand_support_email"
                type="email"
                placeholder="support@yourcompany.com"
                value={formData.brand_support_email}
                onChange={(e) => setFormData(prev => ({ ...prev, brand_support_email: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="portal_base_url">Portal Base URL</Label>
              <Input
                id="portal_base_url"
                type="url"
                placeholder="https://portal.yourcompany.com"
                value={formData.portal_base_url}
                onChange={(e) => setFormData(prev => ({ ...prev, portal_base_url: e.target.value }))}
              />
            </div>
          </div>

          {/* Sender Defaults */}
          <div className="space-y-4">
            <h4 className="font-medium text-sm">Default Sender Settings</h4>
            
            <div className="space-y-2">
              <Label htmlFor="from_name">Default From Name</Label>
              <Input
                id="from_name"
                placeholder="e.g., Stride Logistics"
                value={formData.from_name}
                onChange={(e) => setFormData(prev => ({ ...prev, from_name: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="from_email">Default From Email</Label>
              <Input
                id="from_email"
                type="email"
                placeholder="notifications@yourcompany.com"
                value={formData.from_email}
                onChange={(e) => setFormData(prev => ({ ...prev, from_email: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sms_sender_id">Default SMS Sender ID</Label>
              <Input
                id="sms_sender_id"
                placeholder="e.g., STRIDE or +1234567890"
                value={formData.sms_sender_id}
                onChange={(e) => setFormData(prev => ({ ...prev, sms_sender_id: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground">
                Alphanumeric ID or phone number (requires Twilio)
              </p>
            </div>

            {/* Preview */}
            {formData.brand_logo_url && (
              <div className="space-y-2">
                <Label>Logo Preview</Label>
                <div className="border rounded-lg p-4 bg-muted/30">
                  <img
                    src={formData.brand_logo_url}
                    alt="Brand logo preview"
                    className="max-h-12 object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Save Button - Full width on mobile */}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end pt-4 border-t gap-2">
          <Button onClick={handleSave} disabled={isSaving} className="w-full sm:w-auto">
            <MaterialIcon name="save" size="sm" className="mr-2" />
            {isSaving ? 'Saving...' : 'Save Brand Settings'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
