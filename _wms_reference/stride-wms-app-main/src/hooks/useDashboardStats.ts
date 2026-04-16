import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useSelectedWarehouse } from '@/contexts/WarehouseContext';
import { format } from 'date-fns';

export interface DashboardStats {
  needToInspect: number;
  needToAssemble: number;
  incomingShipments: number;
  /** Cross-tenant "jobs in progress" (tasks + shipments + stocktakes) */
  activeJobsCount: number;
  putAwayCount: number;
  willCallCount: number;
  disposalCount: number;
  repairCount: number;
  repairQuotesCount: number;
  // Urgent counts
  urgentNeedToInspect: number;
  urgentNeedToAssemble: number;
  urgentNeedToRepair: number;
  putAwayUrgentCount: number;
  incomingShipmentsUrgentCount: number;
  // Time estimates (in minutes)
  inspectionTimeEstimate: number;
  assemblyTimeEstimate: number;
  repairTimeEstimate: number;
  putAwayTimeEstimate: number;
  incomingShipmentsTimeEstimate: number;
}

export interface TaskItem {
  id: string;
  title: string;
  task_type: string;
  due_date: string | null;
  priority: string;
  status: string;
  account?: {
    account_name: string;
  };
  item?: {
    item_code: string;
    description: string | null;
    location?: {
      code: string;
      name: string | null;
    };
  } | null;
}

export interface ShipmentItem {
  id: string;
  shipment_number: string;
  eta: string | null;
  status: string;
  carrier: string | null;
  inbound_kind?: string | null;
  inbound_status?: string | null;
  account?: {
    account_name: string;
  };
}

export interface PutAwayItem {
  id: string;
  item_code: string;
  description: string | null;
  client_account: string | null;
  received_at: string | null;
  location?: {
    code: string;
    name: string | null;
  };
}

export interface ActiveStocktakeJob {
  id: string;
  stocktake_number: string;
  name: string | null;
  status: string;
  started_at: string | null;
  warehouse?: { name: string } | null;
}

export function useDashboardStats() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { selectedWarehouseId, warehouses } = useSelectedWarehouse();
  const [stats, setStats] = useState<DashboardStats>({
    needToInspect: 0,
    needToAssemble: 0,
    incomingShipments: 0,
    activeJobsCount: 0,
    putAwayCount: 0,
    willCallCount: 0,
    disposalCount: 0,
    repairCount: 0,
    repairQuotesCount: 0,
    urgentNeedToInspect: 0,
    urgentNeedToAssemble: 0,
    urgentNeedToRepair: 0,
    putAwayUrgentCount: 0,
    incomingShipmentsUrgentCount: 0,
    inspectionTimeEstimate: 0,
    assemblyTimeEstimate: 0,
    repairTimeEstimate: 0,
    putAwayTimeEstimate: 0,
    incomingShipmentsTimeEstimate: 0,
  });
  const [inspectionTasks, setInspectionTasks] = useState<TaskItem[]>([]);
  const [assemblyTasks, setAssemblyTasks] = useState<TaskItem[]>([]);
  const [willCallTasks, setWillCallTasks] = useState<TaskItem[]>([]);
  const [disposalTasks, setDisposalTasks] = useState<TaskItem[]>([]);
  const [repairTasks, setRepairTasks] = useState<TaskItem[]>([]);
  const [incomingShipments, setIncomingShipments] = useState<ShipmentItem[]>([]);
  const [putAwayItems, setPutAwayItems] = useState<PutAwayItem[]>([]);
  const [activeJobTasks, setActiveJobTasks] = useState<TaskItem[]>([]);
  const [activeJobShipments, setActiveJobShipments] = useState<ShipmentItem[]>([]);
  const [activeJobStocktakes, setActiveJobStocktakes] = useState<ActiveStocktakeJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = useCallback(async () => {
    if (!profile?.tenant_id) return;

    try {
      setLoading(true);

      // Fetch inspection tasks (not completed, ordered by due date)
      const { data: inspections, count: inspectCount } = await (supabase
        .from('tasks') as any)
        .select(`
          id, title, task_type, due_date, priority, status,
          account:accounts(account_name)
        `, { count: 'exact' })
        .eq('tenant_id', profile.tenant_id)
        .eq('task_type', 'Inspection')
        .not('status', 'in', '("completed","cancelled")')
        .is('deleted_at', null)
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(10);

      // Fetch assembly tasks (not completed, ordered by due date) - include item & location
      const { data: assemblies, count: assemblyCount } = await (supabase
        .from('tasks') as any)
        .select(`
          id, title, task_type, due_date, priority, status,
          account:accounts(account_name),
          item:items!tasks_related_item_id_fkey(item_code, description, location:locations!items_current_location_id_fkey(code, name))
        `, { count: 'exact' })
        .eq('tenant_id', profile.tenant_id)
        .eq('task_type', 'Assembly')
        .not('status', 'in', '("completed","cancelled")')
        .is('deleted_at', null)
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(10);

      // Fetch Will Call tasks (not completed, ordered by due date)
      const { data: willCalls, count: willCallCount } = await (supabase
        .from('tasks') as any)
        .select(`
          id, title, task_type, due_date, priority, status,
          account:accounts(account_name)
        `, { count: 'exact' })
        .eq('tenant_id', profile.tenant_id)
        .eq('task_type', 'Will Call')
        .not('status', 'in', '("completed","cancelled")')
        .is('deleted_at', null)
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(10);

      // Fetch Disposal tasks (not completed, ordered by due date)
      const { data: disposals, count: disposalCount } = await (supabase
        .from('tasks') as any)
        .select(`
          id, title, task_type, due_date, priority, status,
          account:accounts(account_name)
        `, { count: 'exact' })
        .eq('tenant_id', profile.tenant_id)
        .eq('task_type', 'Disposal')
        .not('status', 'in', '("completed","cancelled")')
        .is('deleted_at', null)
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(10);

      // Fetch Repair tasks (not completed, ordered by due date)
      const { data: repairs, count: repairCount } = await (supabase
        .from('tasks') as any)
        .select(`
          id, title, task_type, due_date, priority, status,
          account:accounts(account_name)
        `, { count: 'exact' })
        .eq('tenant_id', profile.tenant_id)
        .eq('task_type', 'Repair')
        .not('status', 'in', '("completed","cancelled")')
        .is('deleted_at', null)
        .order('due_date', { ascending: true, nullsFirst: false })
        .limit(10);

      // Active tasks (started but not completed)
      const { data: activeTasks, count: activeTaskCount } = await (supabase
        .from('tasks') as any)
        .select(
          `
          id, title, task_type, due_date, priority, status,
          account:accounts(account_name)
        `,
          { count: 'exact' }
        )
        .eq('tenant_id', profile.tenant_id)
        .eq('status', 'in_progress')
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(10);

      // Fetch incoming shipments (ordered by expected arrival)
      // Match the Logistics Console "Expected Today" logic.
      const todayDate = format(new Date(), 'yyyy-MM-dd');
      const { data: shipments, count: shipmentCount } = await (supabase
        .from('shipments') as any)
        .select(`
          id, shipment_number, expected_arrival_date, status, carrier, inbound_kind, inbound_status,
          account:accounts(account_name)
        `, { count: 'exact' })
        .eq('tenant_id', profile.tenant_id)
        .eq('shipment_type', 'inbound')
        .in('inbound_kind', ['expected', 'manifest'])
        .eq('expected_arrival_date', todayDate)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(10);

      // Active shipments (started but not completed)
      const [{ data: inboundActiveShipments, count: inboundActiveCount }, { data: outboundActiveShipments, count: outboundActiveCount }] =
        await Promise.all([
          (supabase.from('shipments') as any)
            .select(
              `
              id, shipment_number, expected_arrival_date, status, carrier, inbound_kind, inbound_status,
              account:accounts(account_name)
            `,
              { count: 'exact' }
            )
            .eq('tenant_id', profile.tenant_id)
            .eq('shipment_type', 'inbound')
            .eq('inbound_kind', 'dock_intake')
            .in('inbound_status', ['draft', 'stage1_complete', 'receiving'])
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(10),
          (supabase.from('shipments') as any)
            .select(
              `
              id, shipment_number, expected_arrival_date, status, carrier, inbound_kind, inbound_status,
              account:accounts(account_name)
            `,
              { count: 'exact' }
            )
            .eq('tenant_id', profile.tenant_id)
            .eq('shipment_type', 'outbound')
            .eq('status', 'in_progress')
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(10),
        ]);

      const activeShipmentsCombined: ShipmentItem[] = [
        ...(inboundActiveShipments || []),
        ...(outboundActiveShipments || []),
      ];

      // Active stocktakes
      const { data: activeStocktakes, count: activeStocktakeCount } = await (supabase
        .from('stocktakes') as any)
        .select(
          `
          id, stocktake_number, status, started_at,
          warehouse:warehouses(name)
        `,
          { count: 'exact' }
        )
        .eq('tenant_id', profile.tenant_id)
        .eq('status', 'active')
        .is('deleted_at', null)
        .order('started_at', { ascending: false })
        .limit(10);

      // Fetch repair quotes needing action
      const { count: repairQuotesActionCount } = await (supabase
        .from('repair_quotes') as any)
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', profile.tenant_id)
        .in('status', ['awaiting_assignment', 'tech_submitted', 'under_review', 'sent_to_client']);

      // Fetch items at selected warehouse Put Away source locations
      let putAwayData: PutAwayItem[] = [];
      let putAwayCount = 0;
      const selectedWarehouse = warehouses.find((w) => w.id === selectedWarehouseId);
      const defaultReceivingLocationId = (selectedWarehouse as any)?.default_receiving_location_id || null;

      if (selectedWarehouseId && defaultReceivingLocationId) {
        const { data: extraRows } = await (supabase as any)
          .from('put_away_source_locations')
          .select('location_id')
          .eq('tenant_id', profile.tenant_id)
          .eq('warehouse_id', selectedWarehouseId);

        const sourceLocationIds = Array.from(
          new Set<string>([
            defaultReceivingLocationId,
            ...((extraRows || []).map((r: any) => r.location_id).filter(Boolean) as string[]),
          ]),
        );

        if (sourceLocationIds.length > 0) {
          const { data: putAwayItemsResult, count } = await (supabase
            .from('items') as any)
            .select(`
              id, item_code, description, client_account, received_at,
              location:locations!items_current_location_id_fkey(code, name)
            `, { count: 'exact' })
            .in('current_location_id', sourceLocationIds)
            .is('deleted_at', null)
            .eq('status', 'active')
            .order('received_at', { ascending: true })
            .limit(20);

          putAwayData = putAwayItemsResult || [];
          putAwayCount = count || 0;
        }
      }

      // Calculate urgent counts from fetched data
      const urgentInspections = (inspections || []).filter((t: any) => t.priority === 'urgent').length;
      const urgentAssemblies = (assemblies || []).filter((t: any) => t.priority === 'urgent').length;
      const urgentRepairs = (repairs || []).filter((t: any) => t.priority === 'urgent').length;

      // For put away urgent: items in source locations for more than 24 hours
      const now = new Date();
      const urgentPutAway = putAwayData.filter((item: PutAwayItem) => {
        if (!item.received_at) return false;
        const received = new Date(item.received_at);
        const hoursAtDock = (now.getTime() - received.getTime()) / (1000 * 60 * 60);
        return hoursAtDock > 24;
      }).length;

      // For shipments urgent: count shipments where expected arrival is today or past
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const urgentShipments = (shipments || []).filter((s: any) => {
        if (!s.expected_arrival_date) return false;
        const eta = new Date(s.expected_arrival_date);
        eta.setHours(0, 0, 0, 0);
        return eta <= today;
      }).length;

      // Fetch service time estimates from service_events
      const { data: serviceTimeData } = await (supabase
        .from('service_events') as any)
        .select('service_code, class_code, service_time_minutes')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .in('service_code', ['INSP', 'Assembly', '5MA', '15MA', '30MA', '45MA', '60MA', '90MA', '120MA', 'Repair', 'PUT_AWAY', 'PUTAWAY', 'RECEIVING', '1HRO']);

      // Create lookup for service times (use average if multiple class variants)
      const serviceTimeLookup: Record<string, number> = {};
      if (serviceTimeData) {
        const serviceGroups: Record<string, number[]> = {};
        for (const row of serviceTimeData) {
          const code = row.service_code;
          if (row.service_time_minutes) {
            if (!serviceGroups[code]) serviceGroups[code] = [];
            serviceGroups[code].push(row.service_time_minutes);
          }
        }
        // Calculate average time per service
        for (const [code, times] of Object.entries(serviceGroups)) {
          serviceTimeLookup[code] = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
        }
      }

      // Calculate time estimates
      // For inspection: count * average INSP time
      const inspAvgTime = serviceTimeLookup['INSP'] || 15; // default 15 min
      const inspectionTimeEstimate = (inspectCount || 0) * inspAvgTime;

      // For assembly: need to consider different assembly tiers
      // Use average of assembly service times or default
      const assemblyTimes = ['5MA', '15MA', '30MA', '45MA', '60MA', '90MA', '120MA', 'Assembly']
        .map(code => serviceTimeLookup[code])
        .filter(t => t !== undefined);
      const assemblyAvgTime = assemblyTimes.length > 0
        ? Math.round(assemblyTimes.reduce((a, b) => a + b, 0) / assemblyTimes.length)
        : 30; // default 30 min
      const assemblyTimeEstimate = (assemblyCount || 0) * assemblyAvgTime;

      // For repair - use 1HRO (1 Hour Response) service time
      const repairAvgTime = serviceTimeLookup['1HRO'] || 60; // default 60 min (1 hour)
      const repairTimeEstimate = (repairCount || 0) * repairAvgTime;

      // For put away - look for PUT_AWAY or PUTAWAY service code
      const putAwayAvgTime = serviceTimeLookup['PUT_AWAY'] || serviceTimeLookup['PUTAWAY'] || 2; // default 2 min per item
      const putAwayTimeEstimate = putAwayCount * putAwayAvgTime;

      // For incoming shipments - use RECEIVING service time
      const receivingAvgTime = serviceTimeLookup['RECEIVING'] || 5; // default 5 min per shipment
      const incomingShipmentsTimeEstimate = (shipmentCount || 0) * receivingAvgTime;

      const activeJobsCount =
        (activeTaskCount || 0) + (inboundActiveCount || 0) + (outboundActiveCount || 0) + (activeStocktakeCount || 0);

      setStats({
        needToInspect: inspectCount || 0,
        needToAssemble: assemblyCount || 0,
        incomingShipments: shipmentCount || 0,
        activeJobsCount,
        putAwayCount: putAwayCount,
        willCallCount: willCallCount || 0,
        disposalCount: disposalCount || 0,
        repairCount: repairCount || 0,
        repairQuotesCount: repairQuotesActionCount || 0,
        urgentNeedToInspect: urgentInspections,
        urgentNeedToAssemble: urgentAssemblies,
        urgentNeedToRepair: urgentRepairs,
        putAwayUrgentCount: urgentPutAway,
        incomingShipmentsUrgentCount: urgentShipments,
        inspectionTimeEstimate,
        assemblyTimeEstimate,
        repairTimeEstimate,
        putAwayTimeEstimate,
        incomingShipmentsTimeEstimate,
      });

      setInspectionTasks(inspections || []);
      setAssemblyTasks(assemblies || []);
      setWillCallTasks(willCalls || []);
      setDisposalTasks(disposals || []);
      setRepairTasks(repairs || []);
      setIncomingShipments(shipments || []);
      setPutAwayItems(putAwayData);
      setActiveJobTasks(activeTasks || []);
      setActiveJobShipments(activeShipmentsCombined);
      setActiveJobStocktakes((activeStocktakes || []) as unknown as ActiveStocktakeJob[]);
    } catch (error: any) {
      console.error('Error fetching dashboard stats:', error);
      const msg = error?.message || 'Unknown error';
      setError(msg);
      toast({ variant: 'destructive', title: 'Dashboard Error', description: 'Failed to load dashboard stats' });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, selectedWarehouseId, warehouses]);

  useEffect(() => {
    fetchStats();
  }, [fetchStats]);

  return {
    stats,
    inspectionTasks,
    assemblyTasks,
    willCallTasks,
    disposalTasks,
    repairTasks,
    incomingShipments,
    putAwayItems,
    activeJobTasks,
    activeJobShipments,
    activeJobStocktakes,
    loading,
    error,
    refetch: fetchStats,
  };
}
