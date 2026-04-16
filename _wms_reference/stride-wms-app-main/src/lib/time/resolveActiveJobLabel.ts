import { supabase } from '@/integrations/supabase/client';

export async function resolveActiveJobLabel(
  tenantId: string | null | undefined,
  jobType: string | null | undefined,
  jobId: string | null | undefined,
): Promise<string> {
  if (!tenantId || !jobType || !jobId) return 'another job';

  try {
    if (jobType === 'task') {
      const { data: t } = await (supabase.from('tasks') as any)
        .select('title, task_type, task_number')
        .eq('tenant_id', tenantId)
        .eq('id', jobId)
        .maybeSingle();
      if (t?.task_type && t?.task_number) return `${t.task_type} ${t.task_number}`;
      if (t?.title) return t.title;
      return t?.task_type ? `${t.task_type} task` : 'another task';
    }

    if (jobType === 'shipment') {
      const { data: s } = await (supabase.from('shipments') as any)
        .select('shipment_number')
        .eq('tenant_id', tenantId)
        .eq('id', jobId)
        .maybeSingle();
      return s?.shipment_number ? `Shipment ${s.shipment_number}` : 'another shipment';
    }

    if (jobType === 'stocktake') {
      const { data: st } = await (supabase.from('stocktakes') as any)
        .select('stocktake_number, name')
        .eq('tenant_id', tenantId)
        .eq('id', jobId)
        .maybeSingle();
      return st?.name || (st?.stocktake_number ? `Stocktake ${st.stocktake_number}` : 'another stocktake');
    }

    return `${jobType} job`;
  } catch {
    return 'another job';
  }
}

