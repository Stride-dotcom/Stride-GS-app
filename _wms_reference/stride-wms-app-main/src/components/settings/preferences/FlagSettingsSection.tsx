import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/lib/toastShim';

interface FlagService {
  id: string;
  service_code: string;
  service_name: string;
  notes: string | null;
  rate: number;
  is_active: boolean;
}

export function FlagSettingsSection() {
  const { profile } = useAuth();
  const [flags, setFlags] = useState<FlagService[]>([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const fetchFlags = useCallback(async () => {
    if (!profile?.tenant_id) return;

    try {
      const { data, error } = await (supabase
        .from('service_events') as any)
        .select('id, service_code, service_name, notes, rate, is_active')
        .eq('tenant_id', profile.tenant_id)
        .eq('billing_trigger', 'Flag')
        .eq('add_flag', true)
        .is('class_code', null)
        .order('service_name');

      if (error) throw error;
      setFlags(data || []);
    } catch (error) {
      console.error('Error fetching flag services:', error);
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id]);

  useEffect(() => {
    fetchFlags();
  }, [fetchFlags]);

  const handleToggle = async (flag: FlagService) => {
    setUpdatingId(flag.id);

    try {
      const { error } = await (supabase
        .from('service_events') as any)
        .update({ is_active: !flag.is_active, updated_at: new Date().toISOString() })
        .eq('id', flag.id);

      if (error) throw error;

      setFlags(prev =>
        prev.map(f =>
          f.id === flag.id ? { ...f, is_active: !f.is_active } : f
        )
      );

      toast.success(`${flag.service_name} ${!flag.is_active ? 'enabled' : 'disabled'}`);
    } catch (error: any) {
      console.error('Error toggling flag:', error);
      toast.error(error.message || 'Failed to update flag');
    } finally {
      setUpdatingId(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MaterialIcon name="flag" size="sm" />
            Item Flags
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (flags.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <MaterialIcon name="flag" size="sm" />
            Item Flags
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No flag services configured. Add flags in Pricing settings.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MaterialIcon name="flag" size="sm" />
          Item Flags
        </CardTitle>
        <CardDescription className="text-xs">
          Enable or disable flags available on item details. Tap a flag name for details.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-2">
          {flags.map((flag) => {
            const isUpdating = updatingId === flag.id;
            return (
              <div key={flag.id} className="flex items-center gap-2 min-w-0">
                {isUpdating ? (
                  <MaterialIcon name="progress_activity" size="sm" className="animate-spin text-muted-foreground flex-shrink-0" />
                ) : (
                  <Checkbox
                    id={`flag-${flag.id}`}
                    checked={flag.is_active}
                    onCheckedChange={() => handleToggle(flag)}
                    disabled={isUpdating}
                    className="flex-shrink-0"
                  />
                )}
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="text-xs cursor-pointer truncate text-left hover:underline"
                    >
                      {flag.service_name}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="top" className="max-w-xs p-3">
                    <p className="font-medium text-sm">{flag.service_name}</p>
                    {flag.notes && (
                      <p className="text-xs text-muted-foreground mt-1">{flag.notes}</p>
                    )}
                    <p className="text-xs mt-1">Rate: ${flag.rate.toFixed(2)}</p>
                  </PopoverContent>
                </Popover>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
