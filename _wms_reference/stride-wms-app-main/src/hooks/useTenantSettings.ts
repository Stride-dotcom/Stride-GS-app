import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface TenantCompanySettings {
  id: string;
  tenant_id: string;
  company_name: string | null;
  company_email: string | null;
  company_phone: string | null;
  company_website: string | null;
  company_address: string | null;
  remit_address_line1: string | null;
  remit_address_line2: string | null;
  remit_city: string | null;
  remit_state: string | null;
  remit_zip: string | null;
  logo_url: string | null;
  logo_storage_path: string | null;
  office_alert_emails: string | null;
  app_base_url: string | null;
  app_subdomain: string | null;
  email_signature_enabled: boolean;
  email_signature_custom_text: string | null;
  twilio_account_sid: string | null;
  twilio_messaging_service_sid: string | null;
  twilio_from_phone: string | null;
  sms_sender_name: string | null;
  sms_enabled: boolean;
  sms_opt_in_message: string | null;
  sms_help_message: string | null;
  sms_stop_message: string | null;
  sms_opt_in_keywords: string | null;
  sms_privacy_policy_url: string | null;
  sms_terms_conditions_url: string | null;
  sms_use_case_description: string | null;
  sms_sample_message: string | null;
  sms_estimated_monthly_volume: string | null;
  sms_opt_in_type: string | null;
  sms_use_case_categories: string | null;
  sms_notification_email: string | null;
  sms_proof_of_consent_url: string | null;
  sms_additional_info: string | null;
  created_at: string;
  updated_at: string;
}

export function useTenantSettings() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<TenantCompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);

  const fetchSettings = useCallback(async () => {
    if (!profile?.tenant_id) return;

    try {
      const { data, error } = await supabase
        .from('tenant_company_settings')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        // Create default settings if none exist
        const { data: newSettings, error: createError } = await supabase
          .from('tenant_company_settings')
          .insert({
            tenant_id: profile.tenant_id,
            created_by: profile.id,
          })
          .select()
          .single();

        if (createError) throw createError;
        setSettings(newSettings as TenantCompanySettings);
      } else {
        setSettings(data as TenantCompanySettings);
      }
    } catch (error) {
      console.error('Error fetching tenant settings:', error);
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, profile?.id]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const updateSettings = async (updates: Partial<TenantCompanySettings>) => {
    if (!profile?.tenant_id || !settings) return false;

    try {
      const { error } = await supabase
        .from('tenant_company_settings')
        .update({
          ...updates,
          updated_by: profile.id,
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', profile.tenant_id);

      if (error) throw error;

      setSettings((prev) => prev ? { ...prev, ...updates } : null);
      toast({
        title: 'Settings Updated',
        description: 'Organization settings have been saved.',
      });
      return true;
    } catch (error) {
      console.error('Error updating tenant settings:', error);
      toast({
        variant: 'destructive',
        title: 'Update Failed',
        description: 'Failed to update settings. Please try again.',
      });
      return false;
    }
  };

  const uploadLogo = async (file: File) => {
    if (!profile?.tenant_id) return null;

    setUploading(true);
    try {
      // Delete old logo if exists
      if (settings?.logo_storage_path) {
        await supabase.storage.from('logos').remove([settings.logo_storage_path]);
      }

      // Upload new logo
      const fileExt = file.name.split('.').pop();
      const fileName = `${profile.tenant_id}/logo-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('logos')
        .upload(fileName, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: urlData } = supabase.storage
        .from('logos')
        .getPublicUrl(fileName);

      const logoUrl = urlData.publicUrl;

      // Update settings with new logo URL
      await updateSettings({
        logo_url: logoUrl,
        logo_storage_path: fileName,
      });

      return logoUrl;
    } catch (error) {
      console.error('Error uploading logo:', error);
      toast({
        variant: 'destructive',
        title: 'Upload Failed',
        description: 'Failed to upload logo. Please try again.',
      });
      return null;
    } finally {
      setUploading(false);
    }
  };

  const removeLogo = async () => {
    if (!profile?.tenant_id || !settings?.logo_storage_path) return false;

    try {
      await supabase.storage.from('logos').remove([settings.logo_storage_path]);
      await updateSettings({
        logo_url: null,
        logo_storage_path: null,
      });
      return true;
    } catch (error) {
      console.error('Error removing logo:', error);
      toast({
        variant: 'destructive',
        title: 'Remove Failed',
        description: 'Failed to remove logo. Please try again.',
      });
      return false;
    }
  };

  return {
    settings,
    loading,
    uploading,
    updateSettings,
    uploadLogo,
    removeLogo,
    refetch: fetchSettings,
  };
}
