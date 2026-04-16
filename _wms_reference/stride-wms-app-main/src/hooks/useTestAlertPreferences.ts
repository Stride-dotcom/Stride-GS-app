import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

interface TestAlertPreferences {
  testEmail: string | null;
  testPhone: string | null;
}

export function useTestAlertPreferences() {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<TestAlertPreferences>({
    testEmail: null,
    testPhone: null,
  });
  const [loading, setLoading] = useState(true);

  const fetchPreferences = useCallback(async () => {
    if (!user?.id) {
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('user_dashboard_preferences')
        .select('test_email, test_phone')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setPreferences({
          testEmail: data.test_email,
          testPhone: data.test_phone,
        });
      }
    } catch (error) {
      console.error('Error fetching test preferences:', error);
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchPreferences();
  }, [fetchPreferences]);

  const setTestEmail = async (email: string) => {
    if (!user?.id) return;

    try {
      const { data: existing } = await supabase
        .from('user_dashboard_preferences')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('user_dashboard_preferences')
          .update({ test_email: email })
          .eq('user_id', user.id);
      } else {
        await supabase
          .from('user_dashboard_preferences')
          .insert({ user_id: user.id, test_email: email });
      }

      setPreferences(prev => ({ ...prev, testEmail: email }));
    } catch (error) {
      console.error('Error saving test email:', error);
    }
  };

  const setTestPhone = async (phone: string) => {
    if (!user?.id) return;

    try {
      const { data: existing } = await supabase
        .from('user_dashboard_preferences')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('user_dashboard_preferences')
          .update({ test_phone: phone })
          .eq('user_id', user.id);
      } else {
        await supabase
          .from('user_dashboard_preferences')
          .insert({ user_id: user.id, test_phone: phone });
      }

      setPreferences(prev => ({ ...prev, testPhone: phone }));
    } catch (error) {
      console.error('Error saving test phone:', error);
    }
  };

  return {
    testEmail: preferences.testEmail,
    testPhone: preferences.testPhone,
    setTestEmail,
    setTestPhone,
    loading,
  };
}
