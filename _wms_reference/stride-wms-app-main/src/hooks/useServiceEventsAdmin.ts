/**
 * useServiceEventsAdmin - Admin hook for service events pricing management
 * Provides full CRUD operations, filtering, and audit history
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';

export interface ServiceEvent {
  id: string;
  tenant_id: string;
  class_code: string | null;
  service_code: string;
  service_name: string;
  billing_unit: 'Day' | 'Item' | 'Task';
  service_time_minutes: number | null;
  rate: number;
  taxable: boolean;
  uses_class_pricing: boolean;
  is_active: boolean;
  notes: string | null;
  add_flag: boolean;
  add_to_service_event_scan: boolean;
  alert_rule: string;
  billing_trigger: string;
  category_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServiceEventAudit {
  id: string;
  service_event_id: string | null;
  tenant_id: string;
  service_code: string;
  class_code: string | null;
  action: 'INSERT' | 'UPDATE' | 'DELETE';
  old_values: any;
  new_values: any;
  changed_fields: string[] | null;
  changed_by: string | null;
  changed_at: string;
  user?: {
    first_name: string;
    last_name: string;
    email: string;
  };
}

export interface CreateServiceEventInput {
  service_code: string;
  service_name: string;
  billing_unit: 'Day' | 'Item' | 'Task';
  rate: number;
  taxable?: boolean;
  uses_class_pricing?: boolean;
  is_active?: boolean;
  notes?: string;
  add_flag?: boolean;
  add_to_service_event_scan?: boolean;
  alert_rule?: string;
  billing_trigger?: string;
  service_time_minutes?: number;
  // For class-based pricing, array of class rates
  class_rates?: Array<{
    class_code: string;
    rate: number;
    service_time_minutes?: number;
  }>;
}

export interface UpdateServiceEventInput {
  id: string;
  rate?: number;
  service_name?: string;
  billing_unit?: 'Day' | 'Item' | 'Task';
  service_time_minutes?: number | null;
  taxable?: boolean;
  is_active?: boolean;
  notes?: string | null;
  add_flag?: boolean;
  add_to_service_event_scan?: boolean;
  alert_rule?: string;
  billing_trigger?: string;
  uses_class_pricing?: boolean;
  category_id?: string | null;
}

export interface ServiceEventFilters {
  service_code?: string;
  billing_trigger?: string;
  class_code?: string;
  is_active?: boolean;
  search?: string;
  category_id?: string;
}

export const BILLING_TRIGGERS = [
  { value: 'SCAN EVENT', label: 'Scan Event', description: 'Charge created when item is scanned for this service' },
  { value: 'AUTOCALCULATE', label: 'Autocalculate', description: 'System automatically calculates (e.g., daily storage)' },
  { value: 'Per Item Auto Calculated', label: 'Per Item Auto Calculated', description: 'Rate × quantity, automatically generated' },
  { value: 'Flag', label: 'Flag', description: 'Creates a flag for manual review before billing' },
  { value: 'Task - Assign Rate', label: 'Task - Assign Rate', description: 'Rate is locked in when task is assigned' },
  { value: 'Through Task', label: 'Through Task', description: 'Billed when associated task is completed' },
  { value: 'Shipment', label: 'Shipment', description: 'Billed per shipment, not per item' },
  { value: 'Stocktake', label: 'Stocktake', description: 'Billed during stocktake/inventory count' },
];

export const CLASS_CODES = ['XS', 'S', 'M', 'L', 'XL', 'XXL'];

export const CLASS_LABELS: Record<string, string> = {
  XS: 'XS - Extra Small',
  S: 'S - Small',
  M: 'M - Medium',
  L: 'L - Large',
  XL: 'XL - Extra Large',
  XXL: 'XXL - XX Large',
};

export const BILLING_UNITS = [
  { value: 'Day', label: 'Day' },
  { value: 'Item', label: 'Item' },
  { value: 'Task', label: 'Task' },
];

export const ALERT_RULES = [
  { value: 'none', label: 'None' },
  { value: 'email_office', label: 'Email Office' },
];

export function useServiceEventsAdmin() {
  const [serviceEvents, setServiceEvents] = useState<ServiceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [filters, setFilters] = useState<ServiceEventFilters>({});
  const { toast } = useToast();
  const { profile } = useAuth();

  // Fetch all service events (including inactive)
  const fetchServiceEvents = useCallback(async () => {
    if (!profile?.tenant_id) {
      setServiceEvents([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const { data, error } = await (supabase
        .from('service_events') as any)
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .order('service_code')
        .order('class_code');

      if (error) {
        console.error('[useServiceEventsAdmin] Fetch failed:', error);
        toast({
          variant: 'destructive',
          title: 'Error loading service events',
          description: error.message,
        });
        return;
      }

      setServiceEvents(data || []);
    } catch (error: any) {
      console.error('[useServiceEventsAdmin] Unexpected error:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to load service events',
      });
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, toast]);

  useEffect(() => {
    fetchServiceEvents();
  }, [fetchServiceEvents]);

  // Filter service events
  const filteredServiceEvents = useMemo(() => {
    let filtered = [...serviceEvents];

    if (filters.service_code) {
      filtered = filtered.filter(se => se.service_code === filters.service_code);
    }

    if (filters.billing_trigger) {
      filtered = filtered.filter(se => se.billing_trigger === filters.billing_trigger);
    }

    if (filters.class_code) {
      if (filters.class_code === 'none') {
        filtered = filtered.filter(se => !se.class_code);
      } else {
        filtered = filtered.filter(se => se.class_code === filters.class_code);
      }
    }

    if (filters.is_active !== undefined) {
      filtered = filtered.filter(se => se.is_active === filters.is_active);
    }

    if (filters.search) {
      const search = filters.search.toLowerCase();
      filtered = filtered.filter(se =>
        se.service_code.toLowerCase().includes(search) ||
        se.service_name.toLowerCase().includes(search) ||
        (se.notes && se.notes.toLowerCase().includes(search))
      );
    }

    if (filters.category_id) {
      if (filters.category_id === 'uncategorized') {
        filtered = filtered.filter(se => !se.category_id);
      } else {
        filtered = filtered.filter(se => se.category_id === filters.category_id);
      }
    }

    return filtered;
  }, [serviceEvents, filters]);

  // Group service events by service_code
  const groupedServiceEvents = useMemo(() => {
    const groups = new Map<string, ServiceEvent[]>();

    filteredServiceEvents.forEach(se => {
      const existing = groups.get(se.service_code) || [];
      existing.push(se);
      groups.set(se.service_code, existing);
    });

    // Sort each group by class_code
    groups.forEach((events, key) => {
      events.sort((a, b) => {
        if (!a.class_code && !b.class_code) return 0;
        if (!a.class_code) return -1;
        if (!b.class_code) return 1;
        const orderA = CLASS_CODES.indexOf(a.class_code);
        const orderB = CLASS_CODES.indexOf(b.class_code);
        return orderA - orderB;
      });
    });

    return groups;
  }, [filteredServiceEvents]);

  // Get unique service codes for filtering
  const uniqueServiceCodes = useMemo(() => {
    const codes = new Set(serviceEvents.map(se => se.service_code));
    return Array.from(codes).sort();
  }, [serviceEvents]);

  // Get unique billing triggers for filtering
  const uniqueBillingTriggers = useMemo(() => {
    const triggers = new Set(serviceEvents.map(se => se.billing_trigger));
    return Array.from(triggers).sort();
  }, [serviceEvents]);

  // Update a single service event
  const updateServiceEvent = useCallback(async (input: UpdateServiceEventInput): Promise<boolean> => {
    if (!profile?.tenant_id) return false;

    setSaving(true);
    try {
      const { id, ...updateData } = input;

      const { error } = await (supabase
        .from('service_events') as any)
        .update({
          ...updateData,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('tenant_id', profile.tenant_id);

      if (error) {
        console.error('[useServiceEventsAdmin] Update failed:', error);
        toast({
          variant: 'destructive',
          title: 'Update Failed',
          description: error.message,
        });
        return false;
      }

      toast({
        title: 'Service Updated',
        description: 'The service has been updated successfully.',
      });

      await fetchServiceEvents();
      return true;
    } catch (error: any) {
      console.error('[useServiceEventsAdmin] Update error:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to update service',
      });
      return false;
    } finally {
      setSaving(false);
    }
  }, [profile?.tenant_id, toast, fetchServiceEvents]);

  // Create a new service event (or multiple for class-based pricing)
  const createServiceEvent = useCallback(async (input: CreateServiceEventInput): Promise<boolean> => {
    if (!profile?.tenant_id) return false;

    setSaving(true);
    try {
      // Check if service_code already exists
      const existingCodes = serviceEvents.map(se => se.service_code.toUpperCase());
      if (existingCodes.includes(input.service_code.toUpperCase())) {
        toast({
          variant: 'destructive',
          title: 'Service Code Exists',
          description: `Service code "${input.service_code}" already exists. Please choose a unique code.`,
        });
        return false;
      }

      const baseData = {
        tenant_id: profile.tenant_id,
        service_code: input.service_code.toUpperCase(),
        service_name: input.service_name,
        billing_unit: input.billing_unit,
        taxable: input.taxable ?? true,
        uses_class_pricing: input.uses_class_pricing ?? false,
        is_active: input.is_active ?? true,
        notes: input.notes || null,
        add_flag: input.add_flag ?? false,
        add_to_service_event_scan: input.add_to_service_event_scan ?? false,
        alert_rule: input.alert_rule || 'none',
        billing_trigger: input.billing_trigger || 'SCAN EVENT',
      };

      // If class-based pricing, create multiple rows
      if (input.uses_class_pricing && input.class_rates && input.class_rates.length > 0) {
        const inserts = input.class_rates.map(cr => ({
          ...baseData,
          class_code: cr.class_code,
          rate: cr.rate,
          service_time_minutes: cr.service_time_minutes || null,
        }));

        const { error } = await (supabase
          .from('service_events') as any)
          .insert(inserts);

        if (error) {
          console.error('[useServiceEventsAdmin] Create failed:', error);
          toast({
            variant: 'destructive',
            title: 'Create Failed',
            description: error.message,
          });
          return false;
        }
      } else {
        // Single rate service
        const { error } = await (supabase
          .from('service_events') as any)
          .insert({
            ...baseData,
            class_code: null,
            rate: input.rate,
            service_time_minutes: input.service_time_minutes || null,
          });

        if (error) {
          console.error('[useServiceEventsAdmin] Create failed:', error);
          toast({
            variant: 'destructive',
            title: 'Create Failed',
            description: error.message,
          });
          return false;
        }
      }

      toast({
        title: 'Service Created',
        description: `Service "${input.service_name}" has been created successfully.`,
      });

      await fetchServiceEvents();
      return true;
    } catch (error: any) {
      console.error('[useServiceEventsAdmin] Create error:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to create service',
      });
      return false;
    } finally {
      setSaving(false);
    }
  }, [profile?.tenant_id, serviceEvents, toast, fetchServiceEvents]);

  // Delete a service event (or all variants of a service_code)
  const deleteServiceEvent = useCallback(async (id: string, deleteAllVariants: boolean = false): Promise<boolean> => {
    if (!profile?.tenant_id) return false;

    setSaving(true);
    try {
      if (deleteAllVariants) {
        // Find the service_code and delete all variants
        const service = serviceEvents.find(se => se.id === id);
        if (!service) return false;

        const { error } = await (supabase
          .from('service_events') as any)
          .delete()
          .eq('tenant_id', profile.tenant_id)
          .eq('service_code', service.service_code);

        if (error) {
          console.error('[useServiceEventsAdmin] Delete failed:', error);
          toast({
            variant: 'destructive',
            title: 'Delete Failed',
            description: error.message,
          });
          return false;
        }
      } else {
        // Delete single service event
        const { error } = await (supabase
          .from('service_events') as any)
          .delete()
          .eq('id', id)
          .eq('tenant_id', profile.tenant_id);

        if (error) {
          console.error('[useServiceEventsAdmin] Delete failed:', error);
          toast({
            variant: 'destructive',
            title: 'Delete Failed',
            description: error.message,
          });
          return false;
        }
      }

      toast({
        title: 'Service Deleted',
        description: 'The service has been deleted successfully.',
      });

      await fetchServiceEvents();
      return true;
    } catch (error: any) {
      console.error('[useServiceEventsAdmin] Delete error:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to delete service',
      });
      return false;
    } finally {
      setSaving(false);
    }
  }, [profile?.tenant_id, serviceEvents, toast, fetchServiceEvents]);

  // Toggle active status
  const toggleActive = useCallback(async (id: string): Promise<boolean> => {
    const service = serviceEvents.find(se => se.id === id);
    if (!service) return false;

    return updateServiceEvent({
      id,
      is_active: !service.is_active,
    });
  }, [serviceEvents, updateServiceEvent]);

  // Check if service code exists
  const serviceCodeExists = useCallback((code: string): boolean => {
    return serviceEvents.some(se => se.service_code.toUpperCase() === code.toUpperCase());
  }, [serviceEvents]);

  // Import services from CSV data
  const importServices = useCallback(async (services: CreateServiceEventInput[]): Promise<{ success: number; failed: number; errors: string[] }> => {
    if (!profile?.tenant_id) return { success: 0, failed: 0, errors: ['Not authenticated'] };

    const results = { success: 0, failed: 0, errors: [] as string[] };

    for (const service of services) {
      // Skip if service_code already exists
      if (serviceCodeExists(service.service_code)) {
        results.failed++;
        results.errors.push(`Service code "${service.service_code}" already exists`);
        continue;
      }

      const success = await createServiceEvent(service);
      if (success) {
        results.success++;
      } else {
        results.failed++;
        results.errors.push(`Failed to import "${service.service_code}"`);
      }
    }

    return results;
  }, [profile?.tenant_id, serviceCodeExists, createServiceEvent]);

  // Export services to CSV format
  const exportToCSV = useCallback((): string => {
    const headers = [
      'class_code',
      'service_code',
      'service_name',
      'billing_unit',
      'service_time_minutes',
      'rate',
      'taxable',
      'uses_class_pricing',
      'is_active',
      'notes',
      'add_flag',
      'add_to_service_event_scan',
      'alert_rule',
      'billing_trigger',
    ];

    const rows = serviceEvents.map(se => [
      se.class_code || '',
      se.service_code,
      se.service_name,
      se.billing_unit,
      se.service_time_minutes?.toString() || '',
      se.rate.toString(),
      se.taxable ? 'true' : 'false',
      se.uses_class_pricing ? 'true' : 'false',
      se.is_active ? 'true' : 'false',
      se.notes || '',
      se.add_flag ? 'true' : 'false',
      se.add_to_service_event_scan ? 'true' : 'false',
      se.alert_rule,
      se.billing_trigger,
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    return csvContent;
  }, [serviceEvents]);

  // Generate CSV template
  const generateTemplate = useCallback((): string => {
    const headers = [
      'class_code',
      'service_code',
      'service_name',
      'billing_unit',
      'service_time_minutes',
      'rate',
      'taxable',
      'uses_class_pricing',
      'is_active',
      'notes',
      'add_flag',
      'add_to_service_event_scan',
      'alert_rule',
      'billing_trigger',
    ];

    const comments = [
      '# Column descriptions:',
      '# class_code: XS, S, M, L, XL, XXL or empty for non-class services',
      '# service_code: Unique code (uppercase, underscores allowed)',
      '# service_name: Display name for the service',
      '# billing_unit: Day, Item, or Task',
      '# service_time_minutes: Estimated time in minutes (optional)',
      '# rate: Price as decimal (e.g., 25.00)',
      '# taxable: true or false',
      '# uses_class_pricing: true if rate varies by class',
      '# is_active: true or false',
      '# notes: Internal notes (optional)',
      '# add_flag: true to show in Item Details flags',
      '# add_to_service_event_scan: true to show in Service Event Scan',
      '# alert_rule: none or email_office',
      '# billing_trigger: SCAN EVENT, AUTOCALCULATE, Per Item Auto Calculated, Flag, Task - Assign Rate, Through Task, Shipment, Stocktake',
      '#',
    ];

    const exampleRows = [
      ['', 'CUSTOM_SERVICE', 'Custom Service', 'Item', '15', '25.00', 'true', 'false', 'true', 'Example non-class service', 'false', 'true', 'none', 'Through Task'],
      ['XS', 'SIZE_BASED_SVC', 'Size-Based Service', 'Item', '10', '10.00', 'true', 'true', 'true', 'XS rate for size-based service', 'false', 'false', 'none', 'SCAN EVENT'],
      ['S', 'SIZE_BASED_SVC', 'Size-Based Service', 'Item', '12', '15.00', 'true', 'true', 'true', 'S rate for size-based service', 'false', 'false', 'none', 'SCAN EVENT'],
    ];

    const csvContent = [
      ...comments,
      headers.join(','),
      ...exampleRows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n');

    return csvContent;
  }, []);

  // Bulk update multiple service events at once
  const bulkUpdateServiceEvents = useCallback(async (updates: UpdateServiceEventInput[]): Promise<boolean> => {
    if (!profile?.tenant_id || updates.length === 0) return false;

    setSaving(true);
    try {
      // Update each service event
      for (const update of updates) {
        const { id, ...updateData } = update;

        const { error } = await (supabase
          .from('service_events') as any)
          .update({
            ...updateData,
            updated_at: new Date().toISOString(),
          })
          .eq('id', id)
          .eq('tenant_id', profile.tenant_id);

        if (error) {
          console.error('[useServiceEventsAdmin] Bulk update failed:', error);
          toast({
            variant: 'destructive',
            title: 'Update Failed',
            description: error.message,
          });
          return false;
        }
      }

      toast({
        title: 'Changes Saved',
        description: `Updated ${updates.length} service${updates.length > 1 ? 's' : ''} successfully.`,
      });

      await fetchServiceEvents();
      return true;
    } catch (error: any) {
      console.error('[useServiceEventsAdmin] Bulk update error:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to save changes',
      });
      return false;
    } finally {
      setSaving(false);
    }
  }, [profile?.tenant_id, toast, fetchServiceEvents]);

  // Generate class pricing rows from a base service
  // Creates 6 class rows (XS, S, M, L, XL, XXL) copying config from the base service
  const generateClassPricing = useCallback(async (baseServiceId: string): Promise<boolean> => {
    if (!profile?.tenant_id) return false;

    // Find the base service
    const baseService = serviceEvents.find(se => se.id === baseServiceId);
    if (!baseService) {
      toast({
        variant: 'destructive',
        title: 'Service Not Found',
        description: 'Could not find the base service to generate class pricing from.',
      });
      return false;
    }

    // Check if this service already has class variants
    const existingClassRows = serviceEvents.filter(
      se => se.service_code === baseService.service_code && se.class_code
    );
    if (existingClassRows.length > 0) {
      toast({
        variant: 'destructive',
        title: 'Class Pricing Already Exists',
        description: `Service "${baseService.service_code}" already has ${existingClassRows.length} class variant(s). Delete them first to regenerate.`,
      });
      return false;
    }

    // Check if the base service has a class_code (it shouldn't)
    if (baseService.class_code) {
      toast({
        variant: 'destructive',
        title: 'Cannot Generate From Class Row',
        description: 'You can only generate class pricing from a base service (one without a class code).',
      });
      return false;
    }

    setSaving(true);
    try {
      // Generate 6 class rows copying config from base service
      // IMPORTANT: rate = null until user explicitly sets it (prevents accidental $0 billing)
      const classRows = CLASS_CODES.map(classCode => ({
        tenant_id: profile.tenant_id,
        service_code: baseService.service_code,
        service_name: baseService.service_name,
        class_code: classCode,
        billing_unit: baseService.billing_unit,
        rate: null, // NULL until user sets rate - UI will display placeholder
        service_time_minutes: baseService.service_time_minutes,
        taxable: baseService.taxable,
        uses_class_pricing: true,
        is_active: baseService.is_active,
        notes: baseService.notes,
        add_flag: baseService.add_flag,
        add_to_service_event_scan: baseService.add_to_service_event_scan,
        alert_rule: baseService.alert_rule,
        billing_trigger: baseService.billing_trigger,
        category_id: baseService.category_id,
      }));

      const { error } = await (supabase
        .from('service_events') as any)
        .insert(classRows);

      if (error) {
        console.error('[useServiceEventsAdmin] Generate class pricing failed:', error);
        toast({
          variant: 'destructive',
          title: 'Generation Failed',
          description: error.message,
        });
        return false;
      }

      // Also update the base service to mark it as using class pricing
      await (supabase
        .from('service_events') as any)
        .update({ uses_class_pricing: true, updated_at: new Date().toISOString() })
        .eq('id', baseServiceId)
        .eq('tenant_id', profile.tenant_id);

      toast({
        title: 'Class Pricing Generated',
        description: `Created ${CLASS_CODES.length} class variants for "${baseService.service_code}". Set rates for each class below (rates are unset until you enter values).`,
      });

      await fetchServiceEvents();
      return true;
    } catch (error: any) {
      console.error('[useServiceEventsAdmin] Generate class pricing error:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to generate class pricing',
      });
      return false;
    } finally {
      setSaving(false);
    }
  }, [profile?.tenant_id, serviceEvents, toast, fetchServiceEvents]);

  // Check if a service can have class pricing generated
  const canGenerateClassPricing = useCallback((serviceId: string): boolean => {
    const service = serviceEvents.find(se => se.id === serviceId);
    if (!service) return false;

    // Must be a base service (no class_code)
    if (service.class_code) return false;

    // Must not already have class variants
    const existingClassRows = serviceEvents.filter(
      se => se.service_code === service.service_code && se.class_code
    );
    return existingClassRows.length === 0;
  }, [serviceEvents]);

  // Fetch audit history for a service
  const fetchAuditHistory = useCallback(async (serviceCode?: string): Promise<ServiceEventAudit[]> => {
    if (!profile?.tenant_id) return [];

    try {
      let query = (supabase
        .from('service_events_audit') as any)
        .select(`
          *,
          user:users!service_events_audit_changed_by_fkey(first_name, last_name, email)
        `)
        .eq('tenant_id', profile.tenant_id)
        .order('changed_at', { ascending: false })
        .limit(100);

      if (serviceCode) {
        query = query.eq('service_code', serviceCode);
      }

      const { data, error } = await query;

      if (error) {
        console.error('[useServiceEventsAdmin] Audit fetch failed:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      console.error('[useServiceEventsAdmin] Audit fetch error:', error);
      return [];
    }
  }, [profile?.tenant_id]);

  return {
    // Data
    serviceEvents,
    filteredServiceEvents,
    groupedServiceEvents,
    uniqueServiceCodes,
    uniqueBillingTriggers,

    // State
    loading,
    saving,
    filters,

    // Actions
    setFilters,
    refetch: fetchServiceEvents,
    updateServiceEvent,
    bulkUpdateServiceEvents,
    createServiceEvent,
    deleteServiceEvent,
    toggleActive,
    serviceCodeExists,

    // Import/Export
    importServices,
    exportToCSV,
    generateTemplate,

    // Class pricing generation
    generateClassPricing,
    canGenerateClassPricing,

    // Audit
    fetchAuditHistory,
  };
}
