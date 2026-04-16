import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { PromptUpgradeSuggestion } from '@/types/guidedPrompts';
import { cn } from '@/lib/utils';

export function UpgradeNotificationBanner() {
  const { profile } = useAuth();
  const [suggestion, setSuggestion] = useState<PromptUpgradeSuggestion | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const fetchSuggestion = async () => {
      if (!profile?.tenant_id || !profile?.id) return;

      try {
        const { data } = await (supabase
          .from('prompt_upgrade_suggestions') as any)
          .select('*')
          .eq('tenant_id', profile.tenant_id)
          .eq('user_id', profile.id)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (data) {
          setSuggestion(data);
        }
      } catch {
        // No pending suggestion
      }
    };

    fetchSuggestion();
  }, [profile?.tenant_id, profile?.id]);

  if (!suggestion || dismissed) return null;

  const levelLabels: Record<string, string> = {
    training: 'Training',
    standard: 'Standard',
    advanced: 'Advanced',
  };

  return (
    <div className={cn(
      'bg-gradient-to-r from-blue-50 to-indigo-50',
      'border-b border-blue-200',
      'px-4 py-3',
      'flex items-center justify-between gap-4',
      'flex-wrap'
    )}>
      <div className="flex items-center gap-3">
        <div className="bg-blue-100 rounded-full p-2">
          <MaterialIcon name="trending_up" className="text-blue-600" />
        </div>
        <div>
          <p className="font-medium text-sm text-blue-900">
            Level Upgrade Available
          </p>
          <p className="text-xs text-blue-700">
            You may qualify for {levelLabels[suggestion.suggested_level]} mode with fewer prompts.
            A manager will review your progress.
          </p>
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setDismissed(true)}
        className="text-blue-700 hover:text-blue-900 hover:bg-blue-100"
      >
        <MaterialIcon name="close" size="sm" />
      </Button>
    </div>
  );
}
