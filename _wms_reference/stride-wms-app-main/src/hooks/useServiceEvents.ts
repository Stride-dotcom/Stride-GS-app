/**
 * useServiceEvents - Hook for service events pricing and billing
 *
 * COMPATIBILITY LAYER: This hook now reads from the new charge_types + pricing_rules
 * system when available, falling back to legacy service_events.
 *
 * The returned interface remains unchanged for backward compatibility.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { queueBillingEventAlert } from '@/lib/alertQueue';
import { logItemActivity } from '@/lib/activity/logItemActivity';
import { createEventRaw } from '@/services/billing';
import {
  getEffectiveRate,
  mapUnitToLegacy,
  mapTriggerToLegacy,
  createBillingMetadata,
  BILLING_DISABLED_ERROR,
  type ChargeType,
  type PricingRule,
  type EffectiveRateResult,
} from '@/lib/billing/chargeTypeUtils';

export interface ServiceEvent {
  id: string;
  tenant_id: string;
  class_code: string | null;
  service_code: string;
  service_name: string;
  billing_unit: string;
  service_time_minutes: number | null;
  rate: number;
  taxable: boolean;
  uses_class_pricing: boolean;
  is_active: boolean;
  notes: string | null;
  add_flag: boolean;
  flag_is_indicator: boolean;
  add_to_service_event_scan: boolean;
  alert_rule: string;
  billing_trigger: string;
  created_at: string;
  updated_at: string;
  // New fields from charge_types (optional for compatibility)
  charge_type_id?: string;
  category?: string;
  default_trigger?: string;
  input_mode?: string;
}

export interface ServiceEventForScan {
  service_code: string;
  service_name: string;
  rate: number;
  billing_unit: string;
  uses_class_pricing: boolean;
  notes: string | null;
  // New fields
  charge_type_id?: string;
}

export function useServiceEvents() {
  const [serviceEvents, setServiceEvents] = useState<ServiceEvent[]>([]);
  const [scanServiceEvents, setScanServiceEvents] = useState<ServiceEventForScan[]>([]);
  const [flagServiceEvents, setFlagServiceEvents] = useState<ServiceEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [usingNewSystem, setUsingNewSystem] = useState(false);
  const { toast } = useToast();
  const { profile } = useAuth();

  // Fetch service events - tries new system first, falls back to legacy
  const fetchServiceEvents = useCallback(async () => {
    if (!profile?.tenant_id) {
      setServiceEvents([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      // Try new system first (charge_types + pricing_rules)
      const newSystemData = await fetchFromNewSystem(profile.tenant_id);

      if (newSystemData && newSystemData.length > 0) {
        setUsingNewSystem(true);
        setServiceEvents(newSystemData);

        // Extract scan services
        const scanServices = newSystemData
          .filter((se: ServiceEvent) => se.add_to_service_event_scan)
          .reduce((acc: ServiceEventForScan[], se: ServiceEvent) => {
            if (!acc.find(s => s.service_code === se.service_code)) {
              acc.push({
                service_code: se.service_code,
                service_name: se.service_name,
                rate: se.rate,
                billing_unit: se.billing_unit,
                uses_class_pricing: se.uses_class_pricing,
                notes: se.notes,
                charge_type_id: se.charge_type_id,
              });
            }
            return acc;
          }, []);

        setScanServiceEvents(scanServices);
        setFlagServiceEvents(newSystemData.filter((se: ServiceEvent) => se.add_flag));
        return;
      }

      // Fall back to legacy service_events
      setUsingNewSystem(false);
      const { data, error } = await (supabase
        .from('service_events') as any)
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('is_active', true)
        .order('service_name');

      if (error) {
        console.error('[useServiceEvents] Fetch failed:', error);
        toast({
          variant: 'destructive',
          title: 'Error loading service events',
          description: error.message,
        });
        return;
      }

      setServiceEvents(data || []);

      // Extract unique services for scan (where add_to_service_event_scan = true)
      const scanServices = (data || [])
        .filter((se: ServiceEvent) => se.add_to_service_event_scan)
        .reduce((acc: ServiceEventForScan[], se: ServiceEvent) => {
          // Only add if we haven't seen this service_code yet
          if (!acc.find(s => s.service_code === se.service_code)) {
            acc.push({
              service_code: se.service_code,
              service_name: se.service_name,
              rate: se.rate,
              billing_unit: se.billing_unit,
              uses_class_pricing: se.uses_class_pricing,
              notes: se.notes,
            });
          }
          return acc;
        }, []);

      setScanServiceEvents(scanServices);

      // Extract services with add_flag = true
      const flagServices = (data || []).filter((se: ServiceEvent) => se.add_flag);
      setFlagServiceEvents(flagServices);

    } catch (error: any) {
      console.error('[useServiceEvents] Unexpected error:', error);
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

  // Get rate for a specific service and class
  // Uses getEffectiveRate from chargeTypeUtils for lookup
  const getServiceRate = useCallback((serviceCode: string, classCode?: string | null, accountId?: string | null): {
    rate: number;
    serviceName: string;
    billingUnit: string;
    alertRule: string;
    hasError: boolean;
    errorMessage: string | null;
    chargeTypeId?: string;
    rateResult?: EffectiveRateResult;
  } => {
    // Synchronous lookup from cached serviceEvents (for backward compatibility)
    // For async lookup with account adjustments, use getServiceRateAsync

    // First try class-specific rate
    if (classCode) {
      const classSpecific = serviceEvents.find(
        se => se.service_code === serviceCode && se.class_code === classCode
      );
      if (classSpecific) {
        return {
          rate: classSpecific.rate,
          serviceName: classSpecific.service_name,
          billingUnit: classSpecific.billing_unit,
          alertRule: classSpecific.alert_rule || 'none',
          hasError: false,
          errorMessage: null,
          chargeTypeId: classSpecific.charge_type_id,
        };
      }
    }

    // Try non-class-specific rate
    const general = serviceEvents.find(
      se => se.service_code === serviceCode && !se.class_code
    );

    if (general) {
      // Check if this service normally uses class pricing
      if (general.uses_class_pricing && !classCode) {
        return {
          rate: general.rate,
          serviceName: general.service_name,
          billingUnit: general.billing_unit,
          alertRule: general.alert_rule || 'none',
          hasError: true,
          errorMessage: 'Item has no class assigned - using default rate',
          chargeTypeId: general.charge_type_id,
        };
      }
      return {
        rate: general.rate,
        serviceName: general.service_name,
        billingUnit: general.billing_unit,
        alertRule: general.alert_rule || 'none',
        hasError: false,
        errorMessage: null,
        chargeTypeId: general.charge_type_id,
      };
    }

    // Service not found
    return {
      rate: 0,
      serviceName: serviceCode,
      billingUnit: 'Item',
      alertRule: 'none',
      hasError: true,
      errorMessage: `Service not found: ${serviceCode}`,
    };
  }, [serviceEvents]);

  // Async version of getServiceRate that includes account adjustments
  const getServiceRateAsync = useCallback(async (
    serviceCode: string,
    classCode?: string | null,
    accountId?: string | null
  ): Promise<{
    rate: number;
    serviceName: string;
    billingUnit: string;
    alertRule: string;
    hasError: boolean;
    errorMessage: string | null;
    chargeTypeId?: string;
    rateResult: EffectiveRateResult;
  }> => {
    if (!profile?.tenant_id) {
      return {
        rate: 0,
        serviceName: serviceCode,
        billingUnit: 'Item',
        alertRule: 'none',
        hasError: true,
        errorMessage: 'Not authenticated',
        rateResult: {
          charge_type_id: null,
          charge_code: serviceCode,
          charge_name: null,
          category: null,
          is_taxable: false,
          default_trigger: 'manual',
          input_mode: 'qty',
          service_time_minutes: 0,
          add_to_scan: false,
          add_flag: false,
          alert_rule: 'none',
          unit: 'each',
          base_rate: 0,
          effective_rate: 0,
          adjustment_type: null,
          adjustment_applied: false,
          has_error: true,
          error_message: 'Not authenticated',
        },
      };
    }

    const rateResult = await getEffectiveRate({
      tenantId: profile.tenant_id,
      chargeCode: serviceCode,
      accountId: accountId || undefined,
      classCode: classCode || undefined,
    });

    return {
      rate: rateResult.effective_rate,
      serviceName: rateResult.charge_name || serviceCode,
      billingUnit: mapUnitToLegacy(rateResult.unit),
      alertRule: rateResult.alert_rule || 'none',
      hasError: rateResult.has_error,
      errorMessage: rateResult.error_message,
      chargeTypeId: rateResult.charge_type_id || undefined,
      rateResult,
    };
  }, [profile?.tenant_id]);

  // Create billing events for items with selected services
  const createBillingEvents = useCallback(async (
    items: Array<{ id: string; item_code: string; class_code?: string | null; account_id?: string | null; sidemark_id?: string | null; account_name?: string }>,
    serviceCodes: string[]
  ): Promise<{ success: boolean; count: number; errors: number }> => {
    if (!profile?.tenant_id || !profile?.id) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Not authenticated',
      });
      return { success: false, count: 0, errors: 0 };
    }

    let successCount = 0;
    let errorCount = 0;

    // Build a set of class-based service codes for blocking logic
    const classBasedServices = new Set(
      serviceEvents
        .filter(se => se.uses_class_pricing)
        .map(se => se.service_code)
    );

    let classBlockedCount = 0;

    for (const item of items) {
      for (const serviceCode of serviceCodes) {
        try {
          // Block class-based services when item has no class assigned
          if (classBasedServices.has(serviceCode) && !item.class_code) {
            classBlockedCount++;
            errorCount++;
            continue;
          }

          // Use async rate lookup to get account adjustments
          const rateInfo = await getServiceRateAsync(serviceCode, item.class_code, item.account_id);
          const description = `${rateInfo.serviceName} - ${item.item_code}`;

          // Create metadata for provenance tracking
          const metadata = createBillingMetadata(
            'scan',
            item.id,
            rateInfo.rateResult,
            { item_code: item.item_code }
          );

          const result = await createEventRaw({
              tenant_id: profile.tenant_id,
              account_id: item.account_id,
              item_id: item.id,
              sidemark_id: item.sidemark_id,
              // Must match billing_events_event_type_check allowed values.
              event_type: 'addon',
              charge_type: serviceCode,
              description,
              quantity: 1,
              unit_rate: rateInfo.rate,
              total_amount: rateInfo.rate,
              status: 'unbilled',
              created_by: profile.id,
              has_rate_error: rateInfo.hasError,
              rate_error_message: rateInfo.errorMessage,
              calculation_metadata: metadata,
            } as any);

          if (!result.success) {
            console.error('[useServiceEvents] Failed to create billing event:', result.error);
            errorCount++;
          } else {
            successCount++;

            // Log activity for this item
            logItemActivity({
              tenantId: profile.tenant_id,
              itemId: item.id,
              actorUserId: profile.id,
              eventType: 'item_scan_charge_applied',
              eventLabel: `Scan service applied: ${rateInfo.serviceName}`,
              details: {
                billing_event_id: result.billingEventId || null,
                service_code: serviceCode,
                service_name: rateInfo.serviceName,
                amount: rateInfo.rate,
                item_code: item.item_code,
                calculation_metadata: metadata,
              },
            });

            // Queue alert if service has email_office alert rule
            if (rateInfo.alertRule === 'email_office' && result.billingEventId) {
              await queueBillingEventAlert(
                profile.tenant_id,
                result.billingEventId,
                rateInfo.serviceName,
                item.item_code,
                item.account_name || 'Unknown Account',
                rateInfo.rate,
                description
              );
            }
          }
        } catch (err: any) {
          if (err?.message === BILLING_DISABLED_ERROR) {
            toast({
              variant: 'destructive',
              title: 'Billing Disabled',
              description: BILLING_DISABLED_ERROR,
            });
            return { success: false, count: successCount, errors: errorCount + 1 };
          }
          console.error('[useServiceEvents] Unexpected error creating billing event:', err);
          errorCount++;
        }
      }
    }

    if (classBlockedCount > 0) {
      toast({
        variant: 'destructive',
        title: 'Item class required',
        description: `${classBlockedCount} item${classBlockedCount !== 1 ? 's' : ''} skipped — item class required to apply class-based services.`,
      });
    }

    if (errorCount > 0 && errorCount !== classBlockedCount) {
      toast({
        variant: 'destructive',
        title: 'Some billing events failed',
        description: `Created ${successCount}, failed ${errorCount - classBlockedCount}`,
      });
    } else if (successCount > 0) {
      toast({
        title: 'Billing events created',
        description: `Created ${successCount} billing event${successCount !== 1 ? 's' : ''}`,
      });
    }

    return { success: errorCount === 0, count: successCount, errors: errorCount };
  }, [profile, getServiceRateAsync, toast]);

  // Seed service events for tenant
  const seedServiceEvents = useCallback(async () => {
    if (!profile?.tenant_id) return;

    const { error } = await (supabase.rpc as any)('seed_service_events', {
      p_tenant_id: profile.tenant_id,
    });

    if (error) {
      console.error('[useServiceEvents] Seed failed:', error);
      toast({
        variant: 'destructive',
        title: 'Failed to seed service events',
        description: error.message,
      });
      return;
    }

    toast({
      title: 'Service events seeded',
      description: 'Price list has been populated.',
    });

    fetchServiceEvents();
  }, [profile?.tenant_id, toast, fetchServiceEvents]);

  return {
    serviceEvents,
    scanServiceEvents,
    flagServiceEvents,
    loading,
    usingNewSystem,
    refetch: fetchServiceEvents,
    getServiceRate,
    getServiceRateAsync,
    createBillingEvents,
    seedServiceEvents,
  };
}


// =============================================================================
// HELPER: Fetch from new charge_types + pricing_rules system
// =============================================================================

async function fetchFromNewSystem(tenantId: string): Promise<ServiceEvent[] | null> {
  try {
    // Check if charge_types table exists and has data
    const { data: chargeTypes, error: ctError } = await supabase
      .from('charge_types')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('charge_name');

    // If table doesn't exist or query fails, fall back to legacy
    if (ctError) {
      if (ctError.code === '42P01') {
        // Table doesn't exist yet
        return null;
      }
      console.warn('[useServiceEvents] Error fetching charge_types:', ctError);
      return null;
    }

    if (!chargeTypes || chargeTypes.length === 0) {
      // No data in new system, fall back to legacy
      return null;
    }

    // Fetch all pricing rules for these charge types
    const chargeTypeIds = chargeTypes.map(ct => ct.id);
    const { data: pricingRules, error: prError } = await supabase
      .from('pricing_rules')
      .select('*')
      .in('charge_type_id', chargeTypeIds);

    if (prError) {
      console.warn('[useServiceEvents] Error fetching pricing_rules:', prError);
      return null;
    }

    // Convert to ServiceEvent format for backward compatibility
    const serviceEvents: ServiceEvent[] = [];

    for (const ct of chargeTypes) {
      const rules = (pricingRules || []).filter(pr => pr.charge_type_id === ct.id);

      if (rules.length === 0) {
        // Charge type with no pricing rules - create placeholder
        serviceEvents.push(chargeTypeToServiceEvent(ct, null));
      } else {
        // Create one ServiceEvent per pricing rule (to match legacy behavior)
        for (const rule of rules) {
          serviceEvents.push(chargeTypeToServiceEvent(ct, rule));
        }
      }
    }

    return serviceEvents;

  } catch (error) {
    console.error('[useServiceEvents] Error in fetchFromNewSystem:', error);
    return null;
  }
}

/**
 * Convert ChargeType + PricingRule to legacy ServiceEvent format
 */
function chargeTypeToServiceEvent(ct: any, pr: any | null): ServiceEvent {
  const unit = pr?.unit || 'each';
  const billingUnit = mapUnitToLegacy(unit);

  return {
    id: pr?.id || ct.id,
    tenant_id: ct.tenant_id,
    class_code: pr?.class_code || null,
    service_code: ct.charge_code,
    service_name: ct.charge_name,
    billing_unit: billingUnit as 'Day' | 'Item' | 'Task',
    service_time_minutes: pr?.service_time_minutes || 0,
    rate: pr?.rate || 0,
    taxable: ct.is_taxable || false,
    uses_class_pricing: pr?.pricing_method === 'class_based' || (pr?.class_code !== null),
    is_active: ct.is_active,
    notes: ct.notes,
    add_flag: ct.add_flag || false,
    flag_is_indicator: ct.flag_is_indicator || false,
    add_to_service_event_scan: ct.add_to_scan || false,
    alert_rule: ct.alert_rule || 'none',
    billing_trigger: mapTriggerToLegacy(ct.default_trigger),
    created_at: ct.created_at,
    updated_at: ct.updated_at,
    // New fields
    charge_type_id: ct.id,
    category: ct.category,
    default_trigger: ct.default_trigger,
    input_mode: ct.input_mode,
  };
}
