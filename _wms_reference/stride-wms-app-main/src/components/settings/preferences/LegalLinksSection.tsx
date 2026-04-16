import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useTenantPreferences } from '@/hooks/useTenantPreferences';

interface LegalLinksSectionProps {
  // Legacy props for backward compatibility with PreferencesContent
  termsOfServiceUrl?: string;
  privacyPolicyUrl?: string;
  onTermsOfServiceUrlChange?: (value: string) => void;
  onPrivacyPolicyUrlChange?: (value: string) => void;
  // When standalone=true, manages its own state
  standalone?: boolean;
}

export function LegalLinksSection({
  termsOfServiceUrl,
  privacyPolicyUrl,
  onTermsOfServiceUrlChange,
  onPrivacyPolicyUrlChange,
  standalone = false,
}: LegalLinksSectionProps) {
  const { preferences, updatePreferences, saving } = useTenantPreferences();
  const [localTerms, setLocalTerms] = useState('');
  const [localPrivacy, setLocalPrivacy] = useState('');

  // Sync with preferences when standalone
  useEffect(() => {
    if (standalone && preferences) {
      setLocalTerms(preferences.terms_of_service_url || '');
      setLocalPrivacy(preferences.privacy_policy_url || '');
    }
  }, [standalone, preferences]);

  const handleSave = async () => {
    await updatePreferences({
      terms_of_service_url: localTerms || null,
      privacy_policy_url: localPrivacy || null,
    });
  };

  const effectiveTerms = standalone ? localTerms : (termsOfServiceUrl ?? '');
  const effectivePrivacy = standalone ? localPrivacy : (privacyPolicyUrl ?? '');

  const handleTermsChange = (value: string) => {
    if (standalone) {
      setLocalTerms(value);
    } else {
      onTermsOfServiceUrlChange?.(value);
    }
  };

  const handlePrivacyChange = (value: string) => {
    if (standalone) {
      setLocalPrivacy(value);
    } else {
      onPrivacyPolicyUrlChange?.(value);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <MaterialIcon name="balance" size="sm" />
          Legal & Policy Links
        </CardTitle>
        <CardDescription>
          Links to your organization's legal documents
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="terms_url">Terms of Service URL</Label>
          <Input
            id="terms_url"
            type="url"
            placeholder="https://yourcompany.com/terms"
            value={effectiveTerms}
            onChange={(e) => handleTermsChange(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="privacy_url">Privacy Policy URL</Label>
          <Input
            id="privacy_url"
            type="url"
            placeholder="https://yourcompany.com/privacy"
            value={effectivePrivacy}
            onChange={(e) => handlePrivacyChange(e.target.value)}
          />
        </div>

        {standalone && (
          <div className="flex justify-end pt-2">
            <Button onClick={handleSave} disabled={saving} size="sm">
              {saving ? (
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
        )}
      </CardContent>
    </Card>
  );
}
