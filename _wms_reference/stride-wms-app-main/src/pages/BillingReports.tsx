import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { StatusIndicator } from '@/components/ui/StatusIndicator';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfMonth, endOfMonth, subMonths, differenceInDays } from 'date-fns';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { cn } from '@/lib/utils';
import { jsonToWorkbook, downloadWorkbook } from '@/lib/excelUtils';
import { PushToQuickBooksButton } from '@/components/billing/PushToQuickBooksButton';
import { ApplyPromoDialog } from '@/components/billing/ApplyPromoDialog';
import { BillingEventForSync } from '@/hooks/useQuickBooks';
import { useInvoices } from '@/hooks/useInvoices';
import { createEventsRaw, updateBillingEventStatus as updateBillingEventStatusGateway } from '@/services/billing';

interface BillingEvent {
  id: string;
  tenant_id: string;
  account_id: string | null;
  sidemark_id: string | null;
  class_id: string | null;
  service_id: string | null;
  item_id: string | null;
  task_id: string | null;
  shipment_id: string | null;
  event_type: string;
  charge_type: string;
  description: string | null;
  quantity: number;
  unit_rate: number;
  total_amount: number;
  status: string;
  occurred_at: string;
  created_at: string;
  metadata: Record<string, any>;
  // Rate error tracking
  has_rate_error: boolean;
  rate_error_message: string | null;
  // Joined fields
  account_name?: string;
  sidemark_name?: string;
  class_name?: string;
  service_name?: string;
  item_code?: string;
}

interface Account {
  id: string;
  account_name: string;
  account_code: string;
}

interface Sidemark {
  id: string;
  sidemark_name: string;
}

interface Service {
  id: string;
  service_code: string;
  service_name: string;
}

interface ItemClass {
  id: string;
  name: string;
}

interface StoragePreviewItem {
  item_id: string;
  item_code: string;
  description: string;
  account_id: string;
  account_name: string;
  sidemark_id: string | null;
  sidemark_name: string | null;
  class_id: string | null;
  class_name: string | null;
  received_at: string;
  released_at: string | null;
  cubic_feet: number;
  free_days: number;
  billable_days: number;
  daily_rate: number;
  total_amount: number;
}

const STATUS_OPTIONS = [
  { value: 'all', label: 'All Statuses' },
  { value: 'unbilled', label: 'Unbilled' },
  { value: 'invoiced', label: 'Invoiced' },
  { value: 'void', label: 'Void' },
];

export default function BillingReports() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { profile } = useAuth();

  // State
  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<BillingEvent[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [sidemarks, setSidemarks] = useState<Sidemark[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [classes, setClasses] = useState<ItemClass[]>([]);

  // Filters
  const [dateFrom, setDateFrom] = useState<Date>(startOfMonth(subMonths(new Date(), 1)));
  const [dateTo, setDateTo] = useState<Date>(endOfMonth(new Date()));
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [selectedSidemarks, setSelectedSidemarks] = useState<string[]>([]);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [selectedClasses, setSelectedClasses] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showTimeColumns, setShowTimeColumns] = useState(false);

  // Sorting
  const [sortColumn, setSortColumn] = useState<string>('occurred_at');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  // Storage calculator
  const [storageDialogOpen, setStorageDialogOpen] = useState(false);
  const [storageLoading, setStorageLoading] = useState(false);
  const [storagePreview, setStoragePreview] = useState<StoragePreviewItem[]>([]);
  const [storageFrom, setStorageFrom] = useState<Date>(startOfMonth(new Date()));
  const [storageTo, setStorageTo] = useState<Date>(endOfMonth(new Date()));
  const [generatingStorage, setGeneratingStorage] = useState(false);

  // Promo code dialog
  const [promoDialogOpen, setPromoDialogOpen] = useState(false);
  const [selectedEventForPromo, setSelectedEventForPromo] = useState<BillingEvent | null>(null);

  // Status change
  const [updatingStatus, setUpdatingStatus] = useState<string | null>(null);

  // Batch invoice creation
  const { createBatchInvoices } = useInvoices();
  const [creatingInvoices, setCreatingInvoices] = useState(false);
  const [invoiceConfirmOpen, setInvoiceConfirmOpen] = useState(false);

  // Load reference data
  useEffect(() => {
    if (profile?.tenant_id) {
      loadReferenceData();
    }
  }, [profile?.tenant_id]);

  // Load events when filters change
  useEffect(() => {
    if (profile?.tenant_id) {
      loadEvents();
    }
  }, [profile?.tenant_id, dateFrom, dateTo, statusFilter]);

  const loadReferenceData = async () => {
    if (!profile?.tenant_id) return;

    try {
      const [accountsRes, sidemarksRes, servicesRes, classesRes] = await Promise.all([
        supabase
          .from('accounts')
          .select('id, account_name, account_code')
          .eq('tenant_id', profile.tenant_id)
          .is('deleted_at', null)
          .order('account_name'),
        supabase
          .from('sidemarks')
          .select('id, sidemark_name')
          .eq('tenant_id', profile.tenant_id)
          .is('deleted_at', null)
          .order('sidemark_name'),
        supabase
          .from('service_events')
          .select('id, service_code, service_name')
          .eq('tenant_id', profile.tenant_id)
          .eq('is_active', true)
          .is('class_code', null)
          .order('service_name'),
        supabase
          .from('classes')
          .select('id, name')
          .eq('tenant_id', profile.tenant_id)
          .eq('is_active', true)
          .order('sort_order'),
      ]);

      if (accountsRes.data) setAccounts(accountsRes.data);
      if (sidemarksRes.data) setSidemarks(sidemarksRes.data);
      if (servicesRes.data) setServices(servicesRes.data);
      if (classesRes.data) setClasses(classesRes.data);
    } catch (error) {
      console.error('Error loading reference data:', error);
    }
  };

  const loadEvents = async () => {
    if (!profile?.tenant_id) return;

    setLoading(true);
    try {
      let query = supabase
        .from('billing_events')
        .select(`
          *,
          accounts:account_id(account_name),
          sidemarks:sidemark_id(sidemark_name),
          classes:class_id(name),
          items:item_id(item_code)
        `)
        .eq('tenant_id', profile.tenant_id)
        .gte('occurred_at', format(dateFrom, 'yyyy-MM-dd'))
        .lte('occurred_at', format(dateTo, 'yyyy-MM-dd') + 'T23:59:59')
        .order('occurred_at', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;

      if (error) throw error;

      // Service code to readable name mapping
      const serviceCodeMap: Record<string, string> = {
        'INSPECT': 'Inspection',
        'INSP': 'Inspection',
        'RECV': 'Receiving',
        'RECEIVING': 'Receiving',
        'STORAGE': 'Storage',
        'PULLPREP': 'Pull & Prep',
        'PULL_PREP': 'Pull & Prep',
        'PUT_AWAY': 'Put Away',
        'PUTAWAY': 'Put Away',
        'Assembly': 'Assembly',
        'Repair': 'Repair',
        '5MA': '5-Min Assembly',
        '15MA': '15-Min Assembly',
        '30MA': '30-Min Assembly',
        '45MA': '45-Min Assembly',
        '60MA': '60-Min Assembly',
        '90MA': '90-Min Assembly',
        '120MA': '120-Min Assembly',
        '1HRO': '1-Hour Response',
        'SHIPPING': 'Shipping',
        'PACKING': 'Packing',
        'CUSTOM_PKG': 'Custom Packaging',
        'MINOR_TOUCHUP': 'Minor Touch-Up',
        'PALLET_SALE': 'Pallet Sale',
        'PICKING': 'Picking',
      };

      // Transform data with joined fields
      const transformed = (data || []).map((event: any) => ({
        ...event,
        account_name: event.accounts?.account_name || 'Unknown',
        sidemark_name: event.sidemarks?.sidemark_name || null,
        class_name: event.classes?.name || null,
        service_name: serviceCodeMap[event.charge_type] || event.charge_type,
        item_code: event.items?.item_code || null,
      }));

      setEvents(transformed);
    } catch (error) {
      console.error('Error loading billing events:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load billing events',
      });
    } finally {
      setLoading(false);
    }
  };

  // Handle column sort
  const handleSort = useCallback((column: string) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }, [sortColumn]);

  // Filtered and sorted events
  const filteredEvents = useMemo(() => {
    const filtered = events.filter((event) => {
      // Account filter
      if (selectedAccounts.length > 0 && event.account_id && !selectedAccounts.includes(event.account_id)) {
        return false;
      }
      // Sidemark filter
      if (selectedSidemarks.length > 0 && event.sidemark_id && !selectedSidemarks.includes(event.sidemark_id)) {
        return false;
      }
      // Service filter (match by charge_type which is the service_code)
      if (selectedServices.length > 0 && !selectedServices.includes(event.charge_type)) {
        return false;
      }
      // Class filter
      if (selectedClasses.length > 0 && event.class_id && !selectedClasses.includes(event.class_id)) {
        return false;
      }
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        return (
          event.description?.toLowerCase().includes(query) ||
          event.item_code?.toLowerCase().includes(query) ||
          event.account_name?.toLowerCase().includes(query) ||
          event.charge_type?.toLowerCase().includes(query)
        );
      }
      return true;
    });

    // Sort the filtered events
    return filtered.sort((a, b) => {
      let aVal: any;
      let bVal: any;

      switch (sortColumn) {
        case 'occurred_at':
          aVal = new Date(a.occurred_at).getTime();
          bVal = new Date(b.occurred_at).getTime();
          break;
        case 'account_name':
          aVal = a.account_name?.toLowerCase() || '';
          bVal = b.account_name?.toLowerCase() || '';
          break;
        case 'sidemark_name':
          aVal = a.sidemark_name?.toLowerCase() || '';
          bVal = b.sidemark_name?.toLowerCase() || '';
          break;
        case 'item_code':
          aVal = a.item_code?.toLowerCase() || '';
          bVal = b.item_code?.toLowerCase() || '';
          break;
        case 'service_name':
          aVal = a.service_name?.toLowerCase() || '';
          bVal = b.service_name?.toLowerCase() || '';
          break;
        case 'class_name':
          aVal = a.class_name?.toLowerCase() || '';
          bVal = b.class_name?.toLowerCase() || '';
          break;
        case 'quantity':
          aVal = a.quantity || 0;
          bVal = b.quantity || 0;
          break;
        case 'unit_rate':
          aVal = a.unit_rate || 0;
          bVal = b.unit_rate || 0;
          break;
        case 'total_amount':
          aVal = a.total_amount || 0;
          bVal = b.total_amount || 0;
          break;
        case 'status':
          aVal = a.status?.toLowerCase() || '';
          bVal = b.status?.toLowerCase() || '';
          break;
        default:
          aVal = a.occurred_at;
          bVal = b.occurred_at;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [events, selectedAccounts, selectedSidemarks, selectedServices, selectedClasses, searchQuery, services, sortColumn, sortDirection]);

  // Totals
  const totals = useMemo(() => {
    const unbilled = filteredEvents.filter((e) => e.status === 'unbilled').reduce((sum, e) => sum + (e.total_amount || 0), 0);
    const invoiced = filteredEvents.filter((e) => e.status === 'invoiced').reduce((sum, e) => sum + (e.total_amount || 0), 0);
    const voided = filteredEvents.filter((e) => e.status === 'void').reduce((sum, e) => sum + (e.total_amount || 0), 0);
    const rateErrors = filteredEvents.filter((e) => e.has_rate_error).length;
    const promoDiscounts = filteredEvents.reduce((sum, e) => sum + (e.metadata?.promo_discount?.discount_amount || 0), 0);
    return { unbilled, invoiced, voided, total: unbilled + invoiced, rateErrors, promoDiscounts };
  }, [filteredEvents]);

  // Transform unbilled events for QuickBooks sync
  const unbilledEventsForSync: BillingEventForSync[] = useMemo(() => {
    return filteredEvents
      .filter((e) => e.status === 'unbilled' && e.account_id)
      .map((e) => ({
        id: e.id,
        account_id: e.account_id!,
        event_type: e.event_type,
        charge_type: e.charge_type,
        description: e.description || `${e.charge_type} charge`,
        quantity: e.quantity,
        unit_rate: e.unit_rate,
        total_amount: e.total_amount,
        occurred_at: e.occurred_at,
        item_id: e.item_id || undefined,
        item_code: e.item_code || undefined,
      }));
  }, [filteredEvents]);

  // Export to Excel
  const handleExport = useCallback(async () => {
    if (filteredEvents.length === 0) {
      toast({
        variant: 'destructive',
        title: 'No data',
        description: 'No events to export',
      });
      return;
    }

    if (filteredEvents.length > 10000) {
      toast({
        variant: 'destructive',
        title: 'Too many rows',
        description: 'Please narrow your filters to export fewer than 10,000 rows',
      });
      return;
    }

    const exportData = filteredEvents.map((event) => ({
      'Date': format(new Date(event.occurred_at), 'yyyy-MM-dd'),
      'Account': event.account_name || '',
      'Sidemark': event.sidemark_name || '',
      'Item Code': event.item_code || (event.metadata?.task_item_codes?.join(', ') || ''),
      'Service': event.service_name || event.charge_type,
      'Class': event.class_name || '',
      'Description': event.description || '',
      'Qty': event.quantity || 1,
      'Unit Rate': event.unit_rate || 0,
      'Amount': event.total_amount || 0,
      'Promo Code': event.metadata?.promo_discount?.promo_code || '',
      'Original Amount': event.metadata?.promo_discount?.original_amount || '',
      'Discount Amount': event.metadata?.promo_discount?.discount_amount || '',
      'Status': event.status,
      'Event Type': event.event_type,
      'Rate Error': event.has_rate_error ? 'Yes' : '',
      'Error Message': event.rate_error_message || '',
      ...(showTimeColumns ? {
        'Time (min)': event.metadata?.time_minutes || '',
        'Pull/Prep (min)': event.metadata?.pull_prep_minutes || '',
      } : {}),
    }));

    const fileName = `billing-events-${format(dateFrom, 'yyyyMMdd')}-${format(dateTo, 'yyyyMMdd')}.xlsx`;
    const { workbook } = jsonToWorkbook(exportData, 'Billing Events');
    await downloadWorkbook(workbook, fileName);

    toast({
      title: 'Export complete',
      description: `Exported ${filteredEvents.length} rows to ${fileName}`,
    });
  }, [filteredEvents, dateFrom, dateTo, showTimeColumns, toast]);

  // Navigate to entity
  const handleRowClick = (event: BillingEvent) => {
    if (event.task_id) {
      navigate(`/tasks?id=${event.task_id}`);
    } else if (event.shipment_id) {
      navigate(`/shipments/${event.shipment_id}`);
    } else if (event.item_id) {
      navigate(`/inventory/${event.item_id}`);
    }
  };

  // Storage calculator
  const calculateStorage = async () => {
    if (!profile?.tenant_id) return;

    setStorageLoading(true);
    try {
      // Get items that were in storage during the period
      const { data: items, error } = await supabase
        .from('items')
        .select(`
          id,
          item_code,
          description,
          account_id,
          sidemark_id,
          class_id,
          received_at,
          released_at,
          length,
          width,
          height,
          accounts:account_id(account_name, free_storage_days),
          sidemarks:sidemark_id(sidemark_name),
          classes:class_id(name)
        `)
        .eq('tenant_id', profile.tenant_id)
        .is('deleted_at', null)
        .not('received_at', 'is', null)
        .or(`released_at.is.null,released_at.gte.${format(storageFrom, 'yyyy-MM-dd')}`);

      if (error) throw error;

      // Get storage rates from service_events (Price List) - keyed by class_code
      const { data: storageRates } = await supabase
        .from('service_events')
        .select('class_code, rate')
        .eq('tenant_id', profile.tenant_id)
        .eq('service_code', 'STORAGE')
        .eq('is_active', true);

      // Build map of class_code -> daily rate
      const rateByClass = new Map<string | null, number>();
      let baseRate = 0.05; // Default fallback
      (storageRates || []).forEach((sr: any) => {
        if (sr.class_code === null) {
          baseRate = sr.rate || 0.05;
        } else {
          rateByClass.set(sr.class_code, sr.rate);
        }
      });

      // Get all classes to map class_id -> class_code
      const { data: allClasses } = await supabase
        .from('classes')
        .select('id, code')
        .eq('tenant_id', profile.tenant_id);
      const classCodeMap = new Map((allClasses || []).map((c: any) => [c.id, c.code]));

      // Calculate for each item
      const preview: StoragePreviewItem[] = (items || [])
        .filter((item: any) => {
          const receivedAt = new Date(item.received_at);
          const releasedAt = item.released_at ? new Date(item.released_at) : null;
          // Item must have been in storage during the period
          return receivedAt <= storageTo && (!releasedAt || releasedAt >= storageFrom);
        })
        .map((item: any) => {
          const receivedAt = new Date(item.received_at);
          const releasedAt = item.released_at ? new Date(item.released_at) : null;

          // Calculate cubic feet
          const l = item.length || 0;
          const w = item.width || 0;
          const h = item.height || 0;
          const cubicFeet = (l * w * h) / 1728; // Convert cubic inches to cubic feet

          // Get free days from account or default
          const freeDays = item.accounts?.free_storage_days || 0;

          // Calculate billable period
          const billStart = new Date(Math.max(storageFrom.getTime(), receivedAt.getTime()));
          const billEnd = releasedAt
            ? new Date(Math.min(storageTo.getTime(), releasedAt.getTime()))
            : storageTo;

          // Subtract free days from start
          const freeEndDate = new Date(receivedAt);
          freeEndDate.setDate(freeEndDate.getDate() + freeDays);

          const actualBillStart = new Date(Math.max(billStart.getTime(), freeEndDate.getTime()));
          const billableDays = Math.max(0, differenceInDays(billEnd, actualBillStart) + 1);

          // Get rate based on item's class from Price List
          const classCode = item.class_id ? classCodeMap.get(item.class_id) : null;
          const dailyRate = classCode && rateByClass.has(classCode)
            ? rateByClass.get(classCode)!
            : baseRate;

          const totalAmount = billableDays * dailyRate * Math.max(1, cubicFeet);

          return {
            item_id: item.id,
            item_code: item.item_code,
            description: item.description || '',
            account_id: item.account_id,
            account_name: item.accounts?.account_name || 'Unknown',
            sidemark_id: item.sidemark_id,
            sidemark_name: item.sidemarks?.sidemark_name || null,
            class_id: item.class_id,
            class_name: item.classes?.name || null,
            received_at: item.received_at,
            released_at: item.released_at,
            cubic_feet: cubicFeet,
            free_days: freeDays,
            billable_days: billableDays,
            daily_rate: dailyRate,
            total_amount: totalAmount,
          };
        })
        .filter((item: StoragePreviewItem) => item.billable_days > 0);

      setStoragePreview(preview);
    } catch (error) {
      console.error('Error calculating storage:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to calculate storage charges',
      });
    } finally {
      setStorageLoading(false);
    }
  };

  const generateStorageEvents = async () => {
    if (!profile?.tenant_id || storagePreview.length === 0) return;

    setGeneratingStorage(true);
    try {
      const eventsToInsert = storagePreview.map((item) => ({
        tenant_id: profile.tenant_id,
        account_id: item.account_id,
        sidemark_id: item.sidemark_id,
        class_id: item.class_id,
        item_id: item.item_id,
        event_type: 'storage',
        charge_type: 'STORAGE', // service_code from Price List
        description: `Storage: ${item.item_code} (${item.billable_days} days)`,
        quantity: item.billable_days,
        unit_rate: item.daily_rate * Math.max(1, item.cubic_feet),
        total_amount: item.total_amount,
        status: 'unbilled',
        occurred_at: format(storageTo, 'yyyy-MM-dd'),
        metadata: {
          date_from: format(storageFrom, 'yyyy-MM-dd'),
          date_to: format(storageTo, 'yyyy-MM-dd'),
          billable_days: item.billable_days,
          cubic_feet: item.cubic_feet,
          daily_rate: item.daily_rate,
        },
        created_by: profile.id,
      }));

      const insertResult = await createEventsRaw(eventsToInsert as any);

      if (!insertResult.success) throw new Error(insertResult.error);

      toast({
        title: 'Storage events created',
        description: `Created ${eventsToInsert.length} storage billing events`,
      });

      setStorageDialogOpen(false);
      setStoragePreview([]);
      loadEvents();
    } catch (error) {
      console.error('Error generating storage events:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to generate storage events',
      });
    } finally {
      setGeneratingStorage(false);
    }
  };

  const getStatusBadge = (status: string) => (
    <StatusIndicator status={status} size="sm" />
  );

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
  };

  // Update billing event status
  const updateBillingEventStatus = async (eventId: string, newStatus: string) => {
    setUpdatingStatus(eventId);
    try {
      const result = await updateBillingEventStatusGateway({ eventId, status: newStatus });

      if (!result.success) throw new Error(result.error);

      toast({
        title: 'Status Updated',
        description: `Billing event marked as ${newStatus}`,
      });

      loadEvents();
    } catch (error) {
      console.error('Error updating billing event status:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update billing status',
      });
    } finally {
      setUpdatingStatus(null);
    }
  };

  // Get unbilled events for batch invoicing
  const unbilledEvents = useMemo(() => {
    return filteredEvents.filter((e) => e.status === 'unbilled' && e.account_id);
  }, [filteredEvents]);

  // Group unbilled events by account for preview
  const unbilledByAccount = useMemo(() => {
    const groups: Record<string, { accountName: string; count: number; total: number }> = {};
    unbilledEvents.forEach((e) => {
      if (!e.account_id) return;
      if (!groups[e.account_id]) {
        groups[e.account_id] = { accountName: e.account_name || 'Unknown', count: 0, total: 0 };
      }
      groups[e.account_id].count++;
      groups[e.account_id].total += e.total_amount || 0;
    });
    return groups;
  }, [unbilledEvents]);

  // Handle batch invoice creation
  const handleCreateBatchInvoices = async () => {
    setCreatingInvoices(true);
    try {
      const eventIds = unbilledEvents.map((e) => e.id);
      const result = await createBatchInvoices(
        eventIds,
        format(dateFrom, 'yyyy-MM-dd'),
        format(dateTo, 'yyyy-MM-dd')
      );
      setInvoiceConfirmOpen(false);
      loadEvents();

      // If invoices were created, offer to navigate to Invoices page
      if (result.success > 0) {
        toast({
          title: 'Invoices Created',
          description: `${result.success} invoice(s) created as drafts. View them on the Invoices page.`,
        });
      }
    } finally {
      setCreatingInvoices(false);
    }
  };

  // Sortable header component
  const SortableHeader = ({ column, children, className }: { column: string; children: React.ReactNode; className?: string }) => (
    <TableHead
      className={cn("cursor-pointer hover:bg-muted/50 select-none", className)}
      onClick={() => handleSort(column)}
    >
      <div className="flex items-center gap-1">
        {children}
        {sortColumn === column && (
          <MaterialIcon
            name={sortDirection === 'asc' ? 'arrow_upward' : 'arrow_downward'}
            size="sm"
            className="text-muted-foreground"
          />
        )}
      </div>
    </TableHead>
  );

  return (
    <DashboardLayout>
      <div className="space-y-6">
        <PageHeader
          primaryText="Billing"
          accentText="Reports"
          description="View and export billing events across all accounts"
        />

        {/* Summary Cards */}
        <div className="grid gap-4 md:grid-cols-6">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Unbilled</CardDescription>
              <CardTitle className="text-2xl text-yellow-500">{formatCurrency(totals.unbilled)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Invoiced</CardDescription>
              <CardTitle className="text-2xl text-green-500">{formatCurrency(totals.invoiced)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Void</CardDescription>
              <CardTitle className="text-2xl text-red-500">{formatCurrency(totals.voided)}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total (excl. void)</CardDescription>
              <CardTitle className="text-2xl">{formatCurrency(totals.total)}</CardTitle>
            </CardHeader>
          </Card>
          <Card className={totals.promoDiscounts > 0 ? "border-green-500/50 bg-green-500/5" : ""}>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                {totals.promoDiscounts > 0 && <MaterialIcon name="confirmation_number" className="h-3 w-3 text-green-500" />}
                Promo Discounts
              </CardDescription>
              <CardTitle className={cn("text-2xl", totals.promoDiscounts > 0 ? "text-green-500" : "text-muted-foreground")}>
                -{formatCurrency(totals.promoDiscounts)}
              </CardTitle>
            </CardHeader>
          </Card>
          <Card className={totals.rateErrors > 0 ? "border-amber-500/50 bg-amber-500/5" : ""}>
            <CardHeader className="pb-2">
              <CardDescription className="flex items-center gap-1">
                {totals.rateErrors > 0 && <MaterialIcon name="warning" className="h-3 w-3 text-amber-500" />}
                Rate Errors
              </CardDescription>
              <CardTitle className={cn("text-2xl", totals.rateErrors > 0 ? "text-amber-500" : "text-muted-foreground")}>
                {totals.rateErrors}
              </CardTitle>
            </CardHeader>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="filter_list" size="md" />
              Filters
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
              {/* Date From */}
              <div className="space-y-2">
                <Label>From Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      <MaterialIcon name="calendar_today" size="sm" className="mr-2" />
                      {format(dateFrom, 'MMM d, yyyy')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={dateFrom} onSelect={(d) => d && setDateFrom(d)} />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Date To */}
              <div className="space-y-2">
                <Label>To Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full justify-start text-left font-normal">
                      <MaterialIcon name="calendar_today" size="sm" className="mr-2" />
                      {format(dateTo, 'MMM d, yyyy')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0">
                    <Calendar mode="single" selected={dateTo} onSelect={(d) => d && setDateTo(d)} />
                  </PopoverContent>
                </Popover>
              </div>

              {/* Status */}
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Account */}
              <div className="space-y-2">
                <Label>Account</Label>
                <Select
                  value={selectedAccounts[0] || 'all'}
                  onValueChange={(v) => setSelectedAccounts(v === 'all' ? [] : [v])}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Accounts" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Accounts</SelectItem>
                    {accounts.map((acc) => (
                      <SelectItem key={acc.id} value={acc.id}>{acc.account_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Service */}
              <div className="space-y-2">
                <Label>Service</Label>
                <Select
                  value={selectedServices[0] || 'all'}
                  onValueChange={(v) => setSelectedServices(v === 'all' ? [] : [v])}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Services" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Services</SelectItem>
                    {services.map((svc) => (
                      <SelectItem key={svc.id} value={svc.service_code}>{svc.service_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Search */}
              <div className="space-y-2">
                <Label>Search</Label>
                <Input
                  placeholder="Search..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-wrap gap-2 mt-4">
              <Button variant="outline" onClick={loadEvents} disabled={loading}>
                <MaterialIcon name={loading ? "progress_activity" : "refresh"} size="sm" className={cn("mr-2", loading && "animate-spin")} />
                Refresh
              </Button>
              <Button variant="outline" onClick={() => setStorageDialogOpen(true)}>
                <MaterialIcon name="calculate" size="sm" className="mr-2" />
                Storage Calculator
              </Button>
              <Button onClick={handleExport} disabled={filteredEvents.length === 0}>
                <MaterialIcon name="download" size="sm" className="mr-2" />
                Export Excel
              </Button>
              <Button
                variant="default"
                onClick={() => setInvoiceConfirmOpen(true)}
                disabled={unbilledEvents.length === 0}
              >
                <MaterialIcon name="receipt_long" size="sm" className="mr-2" />
                Create Invoices ({Object.keys(unbilledByAccount).length})
              </Button>
              <PushToQuickBooksButton
                billingEvents={unbilledEventsForSync}
                periodStart={format(dateFrom, 'yyyy-MM-dd')}
                periodEnd={format(dateTo, 'yyyy-MM-dd')}
                disabled={unbilledEventsForSync.length === 0}
                onSyncComplete={() => loadEvents()}
              />
              <div className="flex items-center gap-2 ml-auto">
                <Checkbox
                  id="showTime"
                  checked={showTimeColumns}
                  onCheckedChange={(checked) => setShowTimeColumns(checked === true)}
                />
                <Label htmlFor="showTime" className="text-sm">Show time columns</Label>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Events Table */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MaterialIcon name="table_chart" size="md" />
              Billing Events
              <Badge variant="secondary" className="ml-2">{filteredEvents.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <MaterialIcon name="progress_activity" size="xl" className="animate-spin text-muted-foreground" />
              </div>
            ) : filteredEvents.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No billing events found for the selected filters
              </div>
            ) : (
              <ScrollArea className="h-[600px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <SortableHeader column="occurred_at">Date</SortableHeader>
                      <SortableHeader column="account_name">Account</SortableHeader>
                      <SortableHeader column="sidemark_name">Sidemark</SortableHeader>
                      <SortableHeader column="item_code">Item</SortableHeader>
                      <SortableHeader column="service_name">Service</SortableHeader>
                      <SortableHeader column="class_name">Class</SortableHeader>
                      <SortableHeader column="quantity" className="text-right">Qty</SortableHeader>
                      <SortableHeader column="unit_rate" className="text-right">Rate</SortableHeader>
                      <SortableHeader column="total_amount" className="text-right">Amount</SortableHeader>
                      <SortableHeader column="status">Status</SortableHeader>
                      {showTimeColumns && (
                        <>
                          <TableHead className="text-right">Time</TableHead>
                          <TableHead className="text-right">Prep</TableHead>
                        </>
                      )}
                      <TableHead className="w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredEvents.map((event) => (
                      <TableRow
                        key={event.id}
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => handleRowClick(event)}
                      >
                        <TableCell>{format(new Date(event.occurred_at), 'MMM d, yyyy')}</TableCell>
                        <TableCell className="font-medium">{event.account_name}</TableCell>
                        <TableCell className="text-muted-foreground">{event.sidemark_name || '-'}</TableCell>
                        <TableCell>
                          {event.item_code ? (
                            <span className="font-mono text-sm">{event.item_code}</span>
                          ) : event.metadata?.task_item_codes?.length > 0 ? (
                            <span className="font-mono text-sm text-muted-foreground">
                              {event.metadata.task_item_codes.slice(0, 3).join(', ')}
                              {event.metadata.task_item_codes.length > 3 && ` +${event.metadata.task_item_codes.length - 3}`}
                            </span>
                          ) : '-'}
                        </TableCell>
                        <TableCell>{event.service_name}</TableCell>
                        <TableCell className="text-muted-foreground">{event.class_name || '-'}</TableCell>
                        <TableCell className="text-right">{event.quantity || 1}</TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {event.has_rate_error && (
                              <span title={event.rate_error_message || 'Rate error'}>
                                <MaterialIcon name="warning" size="sm" className="text-amber-500" />
                              </span>
                            )}
                            {formatCurrency(event.unit_rate || 0)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          <div className="flex items-center justify-end gap-1">
                            {event.has_rate_error && (
                              <Badge variant="outline" className="text-xs text-amber-500 border-amber-500/30 bg-amber-500/10">
                                Est.
                              </Badge>
                            )}
                            {event.metadata?.promo_discount && (
                              <Badge variant="outline" className="text-xs text-green-500 border-green-500/30 bg-green-500/10" title={`${event.metadata.promo_discount.promo_code}: -${formatCurrency(event.metadata.promo_discount.discount_amount)}`}>
                                {event.metadata.promo_discount.promo_code}
                              </Badge>
                            )}
                            {formatCurrency(event.total_amount || 0)}
                          </div>
                        </TableCell>
                        <TableCell>{getStatusBadge(event.status)}</TableCell>
                        {showTimeColumns && (
                          <>
                            <TableCell className="text-right text-muted-foreground">
                              {event.metadata?.time_minutes || '-'}
                            </TableCell>
                            <TableCell className="text-right text-muted-foreground">
                              {event.metadata?.pull_prep_minutes || '-'}
                            </TableCell>
                          </>
                        )}
                        <TableCell onClick={(e) => e.stopPropagation()}>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                disabled={updatingStatus === event.id}
                              >
                                {updatingStatus === event.id ? (
                                  <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                                ) : (
                                  <MaterialIcon name="more_vert" size="sm" />
                                )}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              {event.status === 'unbilled' && (
                                <>
                                  <DropdownMenuItem
                                    onClick={() => updateBillingEventStatus(event.id, 'invoiced')}
                                  >
                                    <MaterialIcon name="check_circle" size="sm" className="mr-2 text-green-500" />
                                    Mark as Invoiced
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setSelectedEventForPromo(event);
                                      setPromoDialogOpen(true);
                                    }}
                                  >
                                    <MaterialIcon name="confirmation_number" size="sm" className="mr-2" />
                                    {event.metadata?.promo_discount ? 'Manage Promo Code' : 'Apply Promo Code'}
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => updateBillingEventStatus(event.id, 'void')}
                                    className="text-red-500"
                                  >
                                    <MaterialIcon name="cancel" size="sm" className="mr-2" />
                                    Mark as Void
                                  </DropdownMenuItem>
                                </>
                              )}
                              {event.status === 'invoiced' && (
                                <>
                                  <DropdownMenuItem
                                    onClick={() => updateBillingEventStatus(event.id, 'unbilled')}
                                  >
                                    <MaterialIcon name="undo" size="sm" className="mr-2" />
                                    Revert to Unbilled
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => updateBillingEventStatus(event.id, 'void')}
                                    className="text-red-500"
                                  >
                                    <MaterialIcon name="cancel" size="sm" className="mr-2" />
                                    Mark as Void
                                  </DropdownMenuItem>
                                </>
                              )}
                              {event.status === 'void' && (
                                <DropdownMenuItem
                                  onClick={() => updateBillingEventStatus(event.id, 'unbilled')}
                                >
                                  <MaterialIcon name="undo" size="sm" className="mr-2" />
                                  Restore to Unbilled
                                </DropdownMenuItem>
                              )}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Storage Calculator Dialog */}
      <Dialog open={storageDialogOpen} onOpenChange={setStorageDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="calculate" size="md" />
              Storage Charge Calculator
            </DialogTitle>
            <DialogDescription>
              Calculate storage charges for items in the selected date range
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-4 py-4">
            <div className="space-y-2">
              <Label>From Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-40 justify-start">
                    <MaterialIcon name="calendar_today" size="sm" className="mr-2" />
                    {format(storageFrom, 'MMM d, yyyy')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={storageFrom} onSelect={(d) => d && setStorageFrom(d)} />
                </PopoverContent>
              </Popover>
            </div>
            <div className="space-y-2">
              <Label>To Date</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-40 justify-start">
                    <MaterialIcon name="calendar_today" size="sm" className="mr-2" />
                    {format(storageTo, 'MMM d, yyyy')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0">
                  <Calendar mode="single" selected={storageTo} onSelect={(d) => d && setStorageTo(d)} />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex items-end">
              <Button onClick={calculateStorage} disabled={storageLoading}>
                {storageLoading ? <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" /> : <MaterialIcon name="calculate" size="sm" className="mr-2" />}
                Calculate
              </Button>
            </div>
          </div>

          {storagePreview.length > 0 && (
            <>
              <ScrollArea className="flex-1 border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Class</TableHead>
                      <TableHead className="text-right">Cu.Ft.</TableHead>
                      <TableHead className="text-right">Free Days</TableHead>
                      <TableHead className="text-right">Bill Days</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {storagePreview.map((item) => (
                      <TableRow key={item.item_id}>
                        <TableCell className="font-mono text-sm">{item.item_code}</TableCell>
                        <TableCell>{item.account_name}</TableCell>
                        <TableCell>{item.class_name || '-'}</TableCell>
                        <TableCell className="text-right">{item.cubic_feet.toFixed(2)}</TableCell>
                        <TableCell className="text-right">{item.free_days}</TableCell>
                        <TableCell className="text-right">{item.billable_days}</TableCell>
                        <TableCell className="text-right font-medium">{formatCurrency(item.total_amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </ScrollArea>

              <div className="flex justify-between items-center pt-4 border-t">
                <div className="text-sm text-muted-foreground">
                  {storagePreview.length} items • Total: {formatCurrency(storagePreview.reduce((sum, i) => sum + i.total_amount, 0))}
                </div>
              </div>
            </>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setStorageDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={generateStorageEvents}
              disabled={storagePreview.length === 0 || generatingStorage}
            >
              {generatingStorage ? <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" /> : <MaterialIcon name="attach_money" size="sm" className="mr-2" />}
              Generate Storage Events
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Apply Promo Code Dialog */}
      <ApplyPromoDialog
        open={promoDialogOpen}
        onOpenChange={setPromoDialogOpen}
        billingEvent={selectedEventForPromo ? {
          id: selectedEventForPromo.id,
          account_id: selectedEventForPromo.account_id || '',
          charge_type: selectedEventForPromo.charge_type,
          description: selectedEventForPromo.description,
          total_amount: selectedEventForPromo.total_amount,
          metadata: selectedEventForPromo.metadata,
        } : null}
        onSuccess={() => {
          setSelectedEventForPromo(null);
          loadEvents();
        }}
      />

      {/* Batch Invoice Creation Dialog */}
      <Dialog open={invoiceConfirmOpen} onOpenChange={setInvoiceConfirmOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MaterialIcon name="receipt_long" size="md" />
              Create Batch Invoices
            </DialogTitle>
            <DialogDescription>
              Create invoices for unbilled charges from {format(dateFrom, 'MMM d, yyyy')} to {format(dateTo, 'MMM d, yyyy')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="text-sm text-muted-foreground">
              This will create one invoice per customer with all their unbilled charges.
            </div>

            <div className="border rounded-lg max-h-64 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead className="text-right">Charges</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(unbilledByAccount).map(([accountId, data]) => (
                    <TableRow key={accountId}>
                      <TableCell className="font-medium">{data.accountName}</TableCell>
                      <TableCell className="text-right">{data.count}</TableCell>
                      <TableCell className="text-right font-medium">{formatCurrency(data.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="flex justify-between items-center pt-2 border-t">
              <div className="text-sm font-medium">
                {Object.keys(unbilledByAccount).length} invoice(s) to create
              </div>
              <div className="text-lg font-bold">
                Total: {formatCurrency(unbilledEvents.reduce((sum, e) => sum + (e.total_amount || 0), 0))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setInvoiceConfirmOpen(false)} disabled={creatingInvoices}>
              Cancel
            </Button>
            <Button onClick={handleCreateBatchInvoices} disabled={creatingInvoices || unbilledEvents.length === 0}>
              {creatingInvoices ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <MaterialIcon name="receipt_long" size="sm" className="mr-2" />
                  Create {Object.keys(unbilledByAccount).length} Invoice(s)
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  );
}
