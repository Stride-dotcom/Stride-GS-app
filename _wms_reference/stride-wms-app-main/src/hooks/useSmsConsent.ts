import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';

export interface SmsConsentRecord {
  id: string;
  tenant_id: string;
  phone_number: string;
  account_id: string | null;
  contact_name: string | null;
  status: 'opted_in' | 'opted_out' | 'pending';
  consent_method: 'text_keyword' | 'web_form' | 'verbal' | 'admin_manual' | 'imported' | null;
  opted_in_at: string | null;
  opted_out_at: string | null;
  last_keyword: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface SmsConsentLogEntry {
  id: string;
  tenant_id: string;
  consent_id: string;
  phone_number: string;
  action: 'opt_in' | 'opt_out' | 'status_change' | 'created';
  method: string | null;
  keyword: string | null;
  previous_status: string | null;
  new_status: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  ip_address: string | null;
  created_at: string;
}

interface CreateConsentParams {
  phone_number: string;
  account_id?: string | null;
  contact_name?: string | null;
  status?: 'opted_in' | 'opted_out' | 'pending';
  consent_method?: SmsConsentRecord['consent_method'];
}

interface UpdateConsentParams {
  status: 'opted_in' | 'opted_out' | 'pending';
  consent_method?: SmsConsentRecord['consent_method'];
}

export function useSmsConsent() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [records, setRecords] = useState<SmsConsentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchRecords = useCallback(async () => {
    if (!profile?.tenant_id) return;

    try {
      const { data, error } = await supabase
        .from('sms_consent')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setRecords((data || []) as SmsConsentRecord[]);
    } catch (error) {
      console.error('Error fetching SMS consent records:', error);
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id]);

  useEffect(() => {
    fetchRecords();
  }, [fetchRecords]);

  const createConsent = async (params: CreateConsentParams): Promise<SmsConsentRecord | null> => {
    if (!profile?.tenant_id) return null;

    try {
      const now = new Date().toISOString();
      const insertData = {
        tenant_id: profile.tenant_id,
        phone_number: params.phone_number,
        account_id: params.account_id || null,
        contact_name: params.contact_name || null,
        status: params.status || 'pending',
        consent_method: params.consent_method || 'admin_manual',
        created_by: profile.id,
        opted_in_at: params.status === 'opted_in' ? now : null,
        opted_out_at: params.status === 'opted_out' ? now : null,
      };

      const { data, error } = await supabase
        .from('sms_consent')
        .insert(insertData as any)
        .select()
        .single();

      if (error) throw error;

      const record = data as SmsConsentRecord;

      // Log the creation
      await supabase.from('sms_consent_log').insert({
        tenant_id: profile.tenant_id,
        consent_id: record.id,
        phone_number: record.phone_number,
        action: 'created',
        method: params.consent_method || 'admin_manual',
        new_status: record.status,
        actor_user_id: profile.id,
        actor_name: [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email || null,
      });

      setRecords((prev) => [record, ...prev]);
      toast({ title: 'Consent Record Created', description: `Added consent record for ${params.phone_number}` });
      return record;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to create consent record';
      // Handle unique constraint violation
      if (msg.includes('duplicate key') || msg.includes('unique constraint')) {
        toast({
          variant: 'destructive',
          title: 'Duplicate Phone Number',
          description: 'A consent record for this phone number already exists.',
        });
      } else {
        toast({ variant: 'destructive', title: 'Error', description: msg });
      }
      return null;
    }
  };

  const updateConsent = async (id: string, params: UpdateConsentParams): Promise<boolean> => {
    if (!profile?.tenant_id) return false;

    try {
      const existing = records.find((r) => r.id === id);
      if (!existing) return false;

      const now = new Date().toISOString();
      const updateData: Record<string, unknown> = {
        status: params.status,
      };

      if (params.consent_method) {
        updateData.consent_method = params.consent_method;
      }

      if (params.status === 'opted_in' && existing.status !== 'opted_in') {
        updateData.opted_in_at = now;
      } else if (params.status === 'opted_out' && existing.status !== 'opted_out') {
        updateData.opted_out_at = now;
      }

      const { error } = await supabase
        .from('sms_consent')
        .update(updateData)
        .eq('id', id)
        .eq('tenant_id', profile.tenant_id);

      if (error) throw error;

      // Determine action for log
      let action: string = 'status_change';
      if (params.status === 'opted_in' && existing.status !== 'opted_in') action = 'opt_in';
      if (params.status === 'opted_out' && existing.status !== 'opted_out') action = 'opt_out';

      // Log the change
      await supabase.from('sms_consent_log').insert({
        tenant_id: profile.tenant_id,
        consent_id: id,
        phone_number: existing.phone_number,
        action,
        method: params.consent_method || existing.consent_method || 'admin_manual',
        previous_status: existing.status,
        new_status: params.status,
        actor_user_id: profile.id,
        actor_name: [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email || null,
      });

      setRecords((prev) =>
        prev.map((r) => (r.id === id ? { ...r, ...updateData, updated_at: now } as SmsConsentRecord : r))
      );

      toast({ title: 'Consent Updated', description: `Status changed to ${params.status.replace('_', ' ')}` });
      return true;
    } catch (error) {
      console.error('Error updating consent:', error);
      toast({ variant: 'destructive', title: 'Update Failed', description: 'Failed to update consent record.' });
      return false;
    }
  };

  const deleteConsent = async (id: string): Promise<boolean> => {
    if (!profile?.tenant_id) return false;

    try {
      const { error } = await supabase
        .from('sms_consent')
        .delete()
        .eq('id', id)
        .eq('tenant_id', profile.tenant_id);

      if (error) throw error;

      setRecords((prev) => prev.filter((r) => r.id !== id));
      toast({ title: 'Record Deleted', description: 'Consent record has been removed.' });
      return true;
    } catch (error) {
      console.error('Error deleting consent:', error);
      toast({ variant: 'destructive', title: 'Delete Failed', description: 'Failed to delete consent record.' });
      return false;
    }
  };

  const fetchConsentLog = async (consentId: string): Promise<SmsConsentLogEntry[]> => {
    if (!profile?.tenant_id) return [];

    try {
      const { data, error } = await supabase
        .from('sms_consent_log')
        .select('*')
        .eq('consent_id', consentId)
        .eq('tenant_id', profile.tenant_id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data || []) as SmsConsentLogEntry[];
    } catch (error) {
      console.error('Error fetching consent log:', error);
      return [];
    }
  };

  return {
    records,
    loading,
    createConsent,
    updateConsent,
    deleteConsent,
    fetchConsentLog,
    refetch: fetchRecords,
  };
}
