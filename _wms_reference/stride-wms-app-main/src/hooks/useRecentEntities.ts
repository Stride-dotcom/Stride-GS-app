import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface RecentShipment {
  id: string;
  shipment_number: string;
  account_name: string | null;
}

interface RecentTask {
  id: string;
  title: string;
  task_type: string;
}

interface RecentItem {
  id: string;
  item_code: string;
  description: string | null;
}

interface RecentEntities {
  shipments: RecentShipment[];
  tasks: RecentTask[];
  items: RecentItem[];
}

export function useRecentEntities(tenantId: string | null) {
  const [entities, setEntities] = useState<RecentEntities>({
    shipments: [],
    tasks: [],
    items: [],
  });
  const [loading, setLoading] = useState(true);

  const fetchEntities = useCallback(async () => {
    if (!tenantId) {
      setLoading(false);
      return;
    }

    try {
      // Fetch recent shipments
      const { data: shipments } = await supabase
        .from('shipments')
        .select(`
          id,
          shipment_number,
          account:accounts(account_name)
        `)
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(10);

      // Fetch recent tasks
      const { data: tasks } = await supabase
        .from('tasks')
        .select('id, title, task_type')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(10);

      // Fetch recent items
      const { data: items } = await supabase
        .from('items')
        .select('id, item_code, description')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(10);

      setEntities({
        shipments: (shipments || []).map((s: any) => ({
          id: s.id,
          shipment_number: s.shipment_number,
          account_name: s.account?.account_name || null,
        })),
        tasks: (tasks || []).map((t: any) => ({
          id: t.id,
          title: t.title || `Task ${t.id.slice(0, 8)}`,
          task_type: t.task_type,
        })),
        items: (items || []).map((i: any) => ({
          id: i.id,
          item_code: i.item_code,
          description: i.description,
        })),
      });
    } catch (error) {
      console.error('Error fetching recent entities:', error);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    fetchEntities();
  }, [fetchEntities]);

  return {
    ...entities,
    loading,
    refetch: fetchEntities,
  };
}
