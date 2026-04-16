/**
 * ItemFlagsSection - Displays flags from the Price List (charge_types with add_flag=true)
 * Billing flags: When toggled, creates a billing event using the rate from the Price List
 * Indicator flags: When toggled, stores state in item_flags table (no billing event)
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';

import { useServiceEvents, ServiceEvent } from '@/hooks/useServiceEvents';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/lib/toastShim';
import { createEventRaw, deleteUnbilledEventsByFilter } from '@/services/billing';
import { queueBillingEventAlert, queueFlagAddedAlert } from '@/lib/alertQueue';
import { BILLING_DISABLED_ERROR } from '@/lib/billing/chargeTypeUtils';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { logItemActivity } from '@/lib/activity/logItemActivity';
import { BUILTIN_ITEM_EXCEPTION_FLAGS } from '@/lib/items/builtinItemExceptionFlags';
import { cn } from '@/lib/utils';

interface ItemFlagsSectionProps {
  itemId: string;
  accountId?: string;
  onFlagsChange?: () => void;
  isClientUser?: boolean;
}

export function ItemFlagsSection({
  itemId,
  accountId,
  onFlagsChange,
  isClientUser = false,
}: ItemFlagsSectionProps) {
  const { profile } = useAuth();

  const [updatingFlag, setUpdatingFlag] = useState<string | null>(null);
  const [enabledBillingFlags, setEnabledBillingFlags] = useState<Set<string>>(new Set());
  const [enabledIndicatorFlags, setEnabledIndicatorFlags] = useState<Set<string>>(new Set());
  const [loadingFlags, setLoadingFlags] = useState(true);
  const [expanded, setExpanded] = useState(false);

  // Fetch flags from Price List (service_events with add_flag = true)
  const { flagServiceEvents, getServiceRate, loading: serviceEventsLoading } = useServiceEvents();

  // Fetch which billing flags are enabled (via billing_events with event_type = 'flag_change')
  // and which indicator flags are enabled (via item_flags table)
  const fetchEnabledFlags = useCallback(async () => {
    if (!profile?.tenant_id) return;

    try {
      // Fetch billing flags
      const { data: billingData, error: billingError } = await (supabase
        .from('billing_events') as any)
        .select('charge_type')
        .eq('item_id', itemId)
        .eq('event_type', 'flag_change')
        .eq('status', 'unbilled');

      if (billingError) {
        console.error('[ItemFlagsSection] Error fetching billing flags:', billingError);
      }

      const billingCodes = new Set<string>((billingData || []).map((d: any) => d.charge_type));
      setEnabledBillingFlags(billingCodes);

      // Fetch indicator flags from item_flags table
      const { data: indicatorData, error: indicatorError } = await (supabase
        .from('item_flags') as any)
        .select('service_code')
        .eq('item_id', itemId);

      if (indicatorError) {
        // Table may not exist yet — ignore gracefully
        if (indicatorError.code !== '42P01') {
          console.error('[ItemFlagsSection] Error fetching indicator flags:', indicatorError);
        }
      }

      const indicatorCodes = new Set<string>((indicatorData || []).map((d: any) => d.service_code));
      setEnabledIndicatorFlags(indicatorCodes);
    } catch (error) {
      console.error('[ItemFlagsSection] Unexpected error:', error);
    } finally {
      setLoadingFlags(false);
    }
  }, [profile?.tenant_id, itemId]);

  useEffect(() => {
    fetchEnabledFlags();
  }, [fetchEnabledFlags]);

  // Check if a flag is enabled (billing OR indicator)
  const isFlagEnabled = (service: ServiceEvent): boolean => {
    if (service.flag_is_indicator) {
      return enabledIndicatorFlags.has(service.service_code);
    }
    return enabledBillingFlags.has(service.service_code);
  };

  // Handle flag toggle
  const handleFlagToggle = async (service: ServiceEvent, currentlyEnabled: boolean) => {
    if (isClientUser) {
      toast.error('Only warehouse staff can modify flags.');
      return;
    }

    setUpdatingFlag(service.service_code);

    try {
      if (service.flag_is_indicator) {
        // INDICATOR FLAG — use item_flags table
        await handleIndicatorFlagToggle(service, currentlyEnabled);
      } else {
        // BILLING FLAG — use billing_events table
        await handleBillingFlagToggle(service, currentlyEnabled);
      }

      onFlagsChange?.();
    } catch (error: any) {
      console.error('[ItemFlagsSection] Error toggling flag:', error);
      toast.error(error.message || 'Failed to update flag');
    } finally {
      setUpdatingFlag(null);
    }
  };

  const handleBuiltinFlagToggle = async (flagCode: string, flagLabel: string, currentlyEnabled: boolean) => {
    if (isClientUser) {
      toast.error('Only warehouse staff can modify flags.');
      return;
    }
    if (!profile?.tenant_id || !profile?.id) return;

    setUpdatingFlag(flagCode);
    try {
      if (currentlyEnabled) {
        const { error } = await (supabase
          .from('item_flags') as any)
          .delete()
          .eq('item_id', itemId)
          .eq('service_code', flagCode);
        if (error) throw error;

        setEnabledIndicatorFlags((prev) => {
          const next = new Set(prev);
          next.delete(flagCode);
          return next;
        });

        toast.success(`${flagLabel} removed`);
        logItemActivity({
          tenantId: profile.tenant_id,
          itemId,
          actorUserId: profile.id,
          eventType: 'item_exception_flag_removed',
          eventLabel: `Exception flag removed: ${flagLabel}`,
          details: { service_code: flagCode, service_name: flagLabel, flag_type: 'builtin_exception' },
        });
      } else {
        const { error } = await (supabase
          .from('item_flags') as any)
          .insert({
            tenant_id: profile.tenant_id,
            item_id: itemId,
            charge_type_id: null,
            service_code: flagCode,
            created_by: profile.id,
          });
        if (error) throw error;

        setEnabledIndicatorFlags((prev) => {
          const next = new Set(prev);
          next.add(flagCode);
          return next;
        });

        toast.success(`${flagLabel} applied`);
        logItemActivity({
          tenantId: profile.tenant_id,
          itemId,
          actorUserId: profile.id,
          eventType: 'item_exception_flag_applied',
          eventLabel: `Exception flag applied: ${flagLabel}`,
          details: { service_code: flagCode, service_name: flagLabel, flag_type: 'builtin_exception' },
        });
      }

      onFlagsChange?.();
    } catch (error: any) {
      console.error('[ItemFlagsSection] Error toggling built-in flag:', error);
      toast.error(error?.message || 'Failed to update flag');
    } finally {
      setUpdatingFlag(null);
    }
  };

  // Handle indicator flag toggle (item_flags table)
  const handleIndicatorFlagToggle = async (service: ServiceEvent, currentlyEnabled: boolean) => {
    if (currentlyEnabled) {
      // Remove from item_flags
      const { error } = await (supabase
        .from('item_flags') as any)
        .delete()
        .eq('item_id', itemId)
        .eq('service_code', service.service_code);

      if (error) throw error;

      toast.success(`${service.service_name} removed`);

      logItemActivity({
        tenantId: profile!.tenant_id,
        itemId,
        actorUserId: profile!.id,
        eventType: 'item_flag_removed',
        eventLabel: `Flag removed: ${service.service_name}`,
        details: { service_code: service.service_code, service_name: service.service_name, flag_type: 'indicator' },
      });

      logItemActivity({
        tenantId: profile!.tenant_id,
        itemId,
        actorUserId: profile!.id,
        eventType: 'indicator_removed',
        eventLabel: `Indicator removed: ${service.service_name}`,
        details: { service_code: service.service_code, service_name: service.service_name },
      });

      setEnabledIndicatorFlags(prev => {
        const next = new Set(prev);
        next.delete(service.service_code);
        return next;
      });
    } else {
      // Insert into item_flags
      const { error } = await (supabase
        .from('item_flags') as any)
        .insert({
          tenant_id: profile!.tenant_id,
          item_id: itemId,
          charge_type_id: service.charge_type_id || null,
          service_code: service.service_code,
          created_by: profile!.id,
        });

      if (error) throw error;

      // Queue alert if service has alert rule
      if (service.alert_rule && service.alert_rule !== 'none') {
        // Get item info for alert
        const { data: itemData } = await (supabase.from('items') as any)
          .select('item_code, account_id, accounts:account_id(account_name)')
          .eq('id', itemId)
          .single();

        if (itemData) {
          await queueFlagAddedAlert({
            tenantId: profile!.tenant_id,
            itemId,
            itemCode: itemData.item_code || '',
            flagServiceName: service.service_name,
            flagServiceCode: service.service_code,
            actorUserId: profile!.id,
            actorName: [profile!.first_name, profile!.last_name].filter(Boolean).join(' ') || profile!.email || undefined,
          });
        }

        // Log alert sent activity
        logItemActivity({
          tenantId: profile!.tenant_id,
          itemId,
          actorUserId: profile!.id,
          eventType: 'flag_alert_sent',
          eventLabel: `Alert sent for flag: ${service.service_name}`,
          details: { service_code: service.service_code, service_name: service.service_name, flag_type: 'indicator' },
        });

        toast.success(`${service.service_name} applied (alert sent)`);
      } else {
        toast.success(`${service.service_name} applied`);
      }

      logItemActivity({
        tenantId: profile!.tenant_id,
        itemId,
        actorUserId: profile!.id,
        eventType: 'item_flag_applied',
        eventLabel: `Flag applied: ${service.service_name}`,
        details: { service_code: service.service_code, service_name: service.service_name, flag_type: 'indicator' },
      });

      logItemActivity({
        tenantId: profile!.tenant_id,
        itemId,
        actorUserId: profile!.id,
        eventType: 'indicator_applied',
        eventLabel: `Indicator applied: ${service.service_name}`,
        details: { service_code: service.service_code, service_name: service.service_name },
      });

      setEnabledIndicatorFlags(prev => {
        const next = new Set(prev);
        next.add(service.service_code);
        return next;
      });
    }
  };

  // Handle billing flag toggle (billing_events table)
  const handleBillingFlagToggle = async (service: ServiceEvent, currentlyEnabled: boolean) => {
    if (currentlyEnabled) {
      // Remove the billing event for this flag
      const deleteResult = await deleteUnbilledEventsByFilter({
        itemId: itemId,
        chargeType: service.service_code,
        eventType: 'flag_change',
      });

      if (!deleteResult.success) throw new Error(deleteResult.error || 'Failed to delete billing event');

      toast.success(`${service.service_name} removed`);

      // Log flag removal AND billing event void (billing event was deleted, but history stays)
      logItemActivity({
        tenantId: profile!.tenant_id,
        itemId,
        actorUserId: profile!.id,
        eventType: 'item_flag_removed',
        eventLabel: `Flag removed: ${service.service_name}`,
        details: { service_code: service.service_code, service_name: service.service_name, flag_type: 'billing' },
      });
      logItemActivity({
        tenantId: profile!.tenant_id,
        itemId,
        actorUserId: profile!.id,
        eventType: 'billing_event_voided',
        eventLabel: `Unbilled charge removed: ${service.service_name}`,
        details: { service_code: service.service_code, reason: 'flag_unchecked' },
      });

      setEnabledBillingFlags(prev => {
        const next = new Set(prev);
        next.delete(service.service_code);
        return next;
      });
    } else {
      // Get item details for rate calculation and account info.
      // NOTE: items.class_id has no FK to classes — fetch class_id as a column
      // and resolve the class code separately.
      const { data: itemData } = await (supabase
        .from('items') as any)
        .select('account_id, sidemark_id, class_id, item_code, account:accounts(account_name)')
        .eq('id', itemId)
        .single();

      let classCode: string | null = null;
      if (itemData?.class_id) {
        const { data: cls } = await supabase
          .from('classes')
          .select('code')
          .eq('id', itemData.class_id)
          .maybeSingle();
        classCode = cls?.code || null;
      }

      const rateInfo = getServiceRate(service.service_code, classCode);
      const itemAccountId = itemData?.account_id || accountId || null;

      // Block class-based services when item has no class assigned
      if (service.uses_class_pricing && !classCode) {
        toast.error('Item class required to apply this service.');
        return;
      }

      // Check account_service_settings for is_enabled before creating billing event
      if (itemAccountId) {
        const { data: accountSetting } = await supabase
          .from('account_service_settings')
          .select('is_enabled')
          .eq('account_id', itemAccountId)
          .eq('service_code', service.service_code)
          .maybeSingle();

        if (accountSetting && accountSetting.is_enabled === false) {
          toast.error(BILLING_DISABLED_ERROR);
          return;
        }
      }

      // Create a billing event for this flag
      const result = await createEventRaw({
        tenant_id: profile!.tenant_id,
        account_id: itemAccountId,
        item_id: itemId,
        sidemark_id: itemData?.sidemark_id || null,
        event_type: 'flag_change',
        charge_type: service.service_code,
        description: `${service.service_name}`,
        quantity: 1,
        unit_rate: rateInfo.rate,
        total_amount: rateInfo.rate,
        status: 'unbilled',
        created_by: profile!.id,
        has_rate_error: rateInfo.hasError,
        rate_error_message: rateInfo.errorMessage,
      });

      if (!result.success) throw new Error(result.error || 'Failed to create billing event');

      // Queue alert if service has alert rule
      if (service.alert_rule && service.alert_rule !== 'none' && result.billingEventId) {
        await queueFlagAddedAlert({
          tenantId: profile!.tenant_id,
          itemId,
          itemCode: itemData?.item_code || '',
          flagServiceName: service.service_name,
          flagServiceCode: service.service_code,
          actorUserId: profile!.id,
          actorName: [profile!.first_name, profile!.last_name].filter(Boolean).join(' ') || profile!.email || undefined,
        });

        // Log alert sent activity
        logItemActivity({
          tenantId: profile!.tenant_id,
          itemId,
          actorUserId: profile!.id,
          eventType: 'flag_alert_sent',
          eventLabel: `Alert sent for flag: ${service.service_name}`,
          details: { service_code: service.service_code, service_name: service.service_name, flag_type: 'billing', rate: rateInfo.rate },
        });

        toast.success(`${service.service_name} enabled (billing event created, alert sent)`);
      } else {
        toast.success(`${service.service_name} enabled (billing event created)`);
      }

      // Log flag applied + billing event created
      logItemActivity({
        tenantId: profile!.tenant_id,
        itemId,
        actorUserId: profile!.id,
        eventType: 'item_flag_applied',
        eventLabel: `Flag applied: ${service.service_name}`,
        details: { service_code: service.service_code, service_name: service.service_name, flag_type: 'billing', rate: rateInfo.rate },
      });
      logItemActivity({
        tenantId: profile!.tenant_id,
        itemId,
        actorUserId: profile!.id,
        eventType: 'billing_event_created',
        eventLabel: `Billing charge created: ${service.service_name}`,
        details: { service_code: service.service_code, amount: rateInfo.rate, status: 'unbilled' },
      });

      setEnabledBillingFlags(prev => {
        const next = new Set(prev);
        next.add(service.service_code);
        return next;
      });
    }
  };

  // Loading state
  if (serviceEventsLoading || loadingFlags) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <MaterialIcon name="flag" size="md" />
              Item Flags
            </CardTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setExpanded((v) => !v)}
              aria-label={expanded ? 'Collapse flags' : 'Expand flags'}
              aria-expanded={expanded}
            >
              <MaterialIcon
                name="expand_more"
                size="sm"
                className={cn("transition-transform duration-200", expanded && "rotate-180")}
              />
            </Button>
          </div>
        </CardHeader>
        {expanded && (
          <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="flex items-center gap-3 p-2">
                <Skeleton className="h-4 w-4" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
          </CardContent>
        )}
      </Card>
    );
  }

  // Check if any damage-related flag is enabled
  const allEnabledFlags = new Set([...enabledBillingFlags, ...enabledIndicatorFlags]);
  const hasDamage = Array.from(allEnabledFlags).some(code =>
    code.toLowerCase().includes('damage') ||
    code.toLowerCase().includes('repair')
  );

  // Get active indicator flags for display in parent (exposed via data attribute)
  const activeIndicatorFlags = flagServiceEvents.filter(
    s => s.flag_is_indicator && enabledIndicatorFlags.has(s.service_code)
  );
  const activeBuiltinFlags = BUILTIN_ITEM_EXCEPTION_FLAGS
    .filter((f) => enabledIndicatorFlags.has(f.code))
    .map((f) => ({ code: f.code, name: f.label }));
  const activeIndicatorForData = [
    ...activeBuiltinFlags,
    ...activeIndicatorFlags.map((f) => ({ code: f.service_code, name: f.service_name })),
  ];

  return (
    <Card data-active-indicators={JSON.stringify(activeIndicatorForData)}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <MaterialIcon name="flag" size="md" />
            Item Flags
            {hasDamage && (
              <Badge variant="destructive" className="ml-2">
                <MaterialIcon name="warning" className="text-[12px] mr-1" />
                Attention Required
              </Badge>
            )}
          </CardTitle>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? 'Collapse flags' : 'Expand flags'}
            aria-expanded={expanded}
          >
            <MaterialIcon
              name="expand_more"
              size="sm"
              className={cn("transition-transform duration-200", expanded && "rotate-180")}
            />
          </Button>
        </div>
      </CardHeader>
      {expanded && (
        <CardContent>
        <div className="space-y-4">
          {/* Built-in exception flags (always available) */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <MaterialIcon name="verified" size="sm" />
              Built-in item exceptions
              <Badge variant="outline" className="text-[10px] px-1">SYSTEM</Badge>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {BUILTIN_ITEM_EXCEPTION_FLAGS.map((f) => {
                const isEnabled = enabledIndicatorFlags.has(f.code);
                const isUpdating = updatingFlag === f.code;
                return (
                  <div
                    key={f.code}
                    className={`flex items-center gap-3 p-2 rounded-md transition-colors ${
                      isClientUser ? 'opacity-60' : 'hover:bg-muted/50'
                    } ${isEnabled ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800' : ''}`}
                    title={f.description}
                  >
                    <Checkbox
                      id={`builtin-flag-${f.code}`}
                      checked={isEnabled}
                      onCheckedChange={() => handleBuiltinFlagToggle(f.code, f.label, isEnabled)}
                      disabled={isClientUser || isUpdating}
                    />
                    <Label
                      htmlFor={`builtin-flag-${f.code}`}
                      className={`flex items-center gap-2 flex-1 ${
                        isClientUser ? 'cursor-not-allowed' : 'cursor-pointer'
                      }`}
                    >
                      {isUpdating ? (
                        <MaterialIcon name="progress_activity" size="sm" className="animate-spin text-muted-foreground" />
                      ) : (
                        <MaterialIcon
                          name={f.icon || 'warning'}
                          size="sm"
                          className={isEnabled ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}
                        />
                      )}
                      <span className="text-sm">{f.label}</span>
                      <div className="flex items-center gap-1 ml-auto">
                        <Badge
                          variant="outline"
                          className="text-xs px-1 bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800"
                        >
                          <MaterialIcon name="warning" className="text-[12px]" />
                        </Badge>
                      </div>
                    </Label>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Pricing-configured flags */}
          {flagServiceEvents.length > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <MaterialIcon name="tune" size="sm" />
                Pricing flags
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {flagServiceEvents.map((service) => {
                  const isEnabled = isFlagEnabled(service);
                  const isUpdating = updatingFlag === service.service_code;
                  const hasAlert = service.alert_rule && service.alert_rule !== 'none';
                  const isIndicator = service.flag_is_indicator;

                  return (
                    <div
                      key={service.service_code}
                      className={`flex items-center gap-3 p-2 rounded-md transition-colors ${
                        isClientUser ? 'opacity-60' : 'hover:bg-muted/50'
                      } ${isEnabled ? (isIndicator ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800' : 'bg-primary/5 border border-primary/20') : ''}`}
                      title={service.notes || undefined}
                    >
                      <Checkbox
                        id={`flag-${service.service_code}`}
                        checked={isEnabled}
                        onCheckedChange={() => handleFlagToggle(service, isEnabled)}
                        disabled={isClientUser || isUpdating}
                      />
                      <Label
                        htmlFor={`flag-${service.service_code}`}
                        className={`flex items-center gap-2 flex-1 ${
                          isClientUser ? 'cursor-not-allowed' : 'cursor-pointer'
                        }`}
                      >
                        {isUpdating ? (
                          <MaterialIcon name="progress_activity" size="sm" className="animate-spin text-muted-foreground" />
                        ) : (
                          <MaterialIcon
                            name="flag"
                            size="sm"
                            className={isEnabled ? 'text-primary' : 'text-muted-foreground'}
                          />
                        )}
                        <span className="text-sm">{service.service_name}</span>
                        <div className="flex items-center gap-1 ml-auto">
                          {!isIndicator && (
                            <Badge variant="outline" className="text-xs px-1">
                              <MaterialIcon name="attach_money" className="text-[12px]" />
                            </Badge>
                          )}
                          {isIndicator && (
                            <Badge variant="outline" className="text-xs px-1 bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800">
                              <MaterialIcon name="warning" className="text-[12px]" />
                            </Badge>
                          )}
                          {hasAlert && (
                            <Badge variant="outline" className="text-xs px-1">
                              <MaterialIcon name="notifications" className="text-[12px]" />
                            </Badge>
                          )}
                        </div>
                      </Label>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              No pricing flags configured. Add services with "Add Flag" enabled in Settings → Pricing.
            </p>
          )}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 mt-4 pt-4 border-t text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <MaterialIcon name="attach_money" className="text-[12px]" />
            <span>Billing</span>
          </div>
          <div className="flex items-center gap-1">
            <MaterialIcon name="warning" className="text-[12px] text-amber-600 dark:text-amber-400" />
            <span>Indicator</span>
          </div>
          <div className="flex items-center gap-1">
            <MaterialIcon name="notifications" className="text-[12px]" />
            <span>Alert</span>
          </div>
        </div>

        {isClientUser && (
          <p className="text-xs text-muted-foreground mt-4">
            Flags can only be modified by warehouse staff.
          </p>
        )}
        </CardContent>
      )}
    </Card>
  );
}
