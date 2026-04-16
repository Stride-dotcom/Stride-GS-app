/**
 * BillingChargesSection - Displays and allows editing of billing charges
 *
 * IMPORTANT: This component dynamically looks up services from the Price List (service_events).
 * It does NOT use hardcoded service codes - it adapts to whatever services exist in the tenant's
 * Price List, similar to how the Quote tool works.
 *
 * Service matching uses:
 * 1. billing_trigger field (e.g., 'Shipment', 'Task', 'Through Task')
 * 2. Pattern matching on service names/codes
 * 3. Fallback for missing services
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { useServiceEvents, ServiceEvent } from '@/hooks/useServiceEvents';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { updateBillingEventFields, updateBillingEventStatus } from '@/services/billing';

interface BillingCharge {
  id: string;
  charge_type: string;
  description: string | null;
  quantity: number;
  unit_rate: number;
  total_amount: number | null;
  status: string;
  event_type: string;
}

interface BillingChargesSectionProps {
  taskId?: string;
  shipmentId?: string;
  accountId?: string;
  accountName?: string;
  taskType?: string;
  itemCount?: number;
  refreshKey?: number;
  // For Assembly tasks - service selection
  selectedServiceCode?: string | null;
  billingQuantity?: number | null;
  billingRate?: number | null;
  onServiceChange?: (serviceCode: string | null) => void;
  onQuantityChange?: (quantity: number) => void;
  onRateChange?: (rate: number | null) => void;
  onTotalChange?: (total: number) => void;
  onSuccess?: () => void;
}

// Service matching patterns - used to dynamically find services by name/code
// This allows the component to work regardless of exact service code values
const SERVICE_PATTERNS = {
  // Shipment services (billing_trigger = 'Shipment')
  receiving: [/receiv/i, /rcvg/i, /inbound/i],
  shipping: [/ship(?!ment)/i, /outbound/i, /dispatch/i],
  returns: [/return/i, /rtrn/i],

  // Task services (billing_trigger contains 'Task')
  inspection: [/insp/i, /inspect/i],
  willCall: [/will.?call/i, /pickup/i],
  disposal: [/dispos/i, /donation/i],
  delivery: [/deliver/i, /dlvr/i],

  // Assembly services - match by pattern in name/code
  assembly: [/assemb/i, /\d+ma$/i],

  // Repair services
  repair: [/repair/i, /hro$/i, /hr.?repair/i],
};

// Task types that use per-task billing with manual quantity
const PER_TASK_BILLING_TYPES = ['Assembly', 'Repair'];

/**
 * Dynamically find a service that matches the given context
 * Uses pattern matching like the Quote tool does
 */
function findMatchingService(
  services: ServiceEvent[],
  context: 'receiving' | 'shipping' | 'returns' | 'inspection' | 'willCall' | 'disposal' | 'delivery' | 'assembly' | 'repair',
  classCode?: string | null
): ServiceEvent | null {
  const patterns = SERVICE_PATTERNS[context];
  if (!patterns) return null;

  // First try to find a class-specific match
  if (classCode) {
    for (const pattern of patterns) {
      const match = services.find(s =>
        s.class_code === classCode &&
        (pattern.test(s.service_name) || pattern.test(s.service_code))
      );
      if (match) return match;
    }
  }

  // Fall back to a non-class-specific match
  for (const pattern of patterns) {
    const match = services.find(s =>
      !s.class_code &&
      (pattern.test(s.service_name) || pattern.test(s.service_code))
    );
    if (match) return match;
  }

  // Last resort: any match regardless of class_code
  for (const pattern of patterns) {
    const match = services.find(s =>
      pattern.test(s.service_name) || pattern.test(s.service_code)
    );
    if (match) return match;
  }

  return null;
}

/**
 * Find all assembly services for the dropdown
 */
function findAssemblyServices(services: ServiceEvent[]): ServiceEvent[] {
  return services
    .filter(s =>
      !s.class_code && // Only non-class-based assembly services
      (SERVICE_PATTERNS.assembly.some(p => p.test(s.service_name) || p.test(s.service_code)))
    )
    .sort((a, b) => {
      // Sort by numeric part of service code (e.g., 5MA < 15MA < 30MA)
      const aNum = parseInt(a.service_code) || 999;
      const bNum = parseInt(b.service_code) || 999;
      return aNum - bNum;
    });
}

/**
 * Find the repair service (1HRO or similar)
 */
function findRepairService(services: ServiceEvent[]): ServiceEvent | null {
  return services.find(s =>
    !s.class_code &&
    SERVICE_PATTERNS.repair.some(p => p.test(s.service_name) || p.test(s.service_code))
  ) || null;
}

/**
 * Map task type to service context for pattern matching
 */
function getServiceContext(taskType: string, isShipment: boolean, isInbound: boolean): keyof typeof SERVICE_PATTERNS | null {
  // For shipments, use shipment-specific services
  if (isShipment) {
    return isInbound ? 'receiving' : 'shipping';
  }

  // Map task types to service contexts
  const taskTypeMapping: Record<string, keyof typeof SERVICE_PATTERNS> = {
    'Inspection': 'inspection',
    'Will Call': 'willCall',
    'Disposal': 'disposal',
    'Assembly': 'assembly',
    'Repair': 'repair',
    'Receiving': 'receiving',
    'Returns': 'returns',
    'Shipping': 'shipping',
    'Delivery': 'delivery',
  };

  return taskTypeMapping[taskType] || null;
}

export function BillingChargesSection({
  taskId,
  shipmentId,
  accountId,
  accountName,
  taskType,
  itemCount = 1,
  refreshKey = 0,
  selectedServiceCode,
  billingQuantity,
  billingRate,
  onServiceChange,
  onQuantityChange,
  onRateChange,
  onTotalChange,
  onSuccess,
}: BillingChargesSectionProps) {
  const { profile } = useAuth();
  const { hasRole } = usePermissions();
  const { toast } = useToast();
  const { serviceEvents, getServiceRate, loading: serviceEventsLoading } = useServiceEvents();

  const canEditBilling = hasRole('admin') || hasRole('manager') || hasRole('billing_manager');
  const isAssemblyTask = taskType === 'Assembly';
  const isRepairTask = taskType === 'Repair';
  const isPerTaskBilling = PER_TASK_BILLING_TYPES.includes(taskType || '');
  const isShipment = !!shipmentId && !taskId;
  const isInboundShipment = taskType === 'Receiving' || taskType === 'Returns';

  const [charges, setCharges] = useState<BillingCharge[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAmount, setEditAmount] = useState<string>('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [calculatedBaseRate, setCalculatedBaseRate] = useState<number>(0);

  // Local state for Assembly inputs
  const [localQuantity, setLocalQuantity] = useState<string>('0');
  const [localRate, setLocalRate] = useState<string>('');
  const rateInitialized = useRef(false);

  // Dynamically find assembly services for dropdown (uses pattern matching, not hardcoded codes)
  const assemblyServices = useMemo(() => {
    return findAssemblyServices(serviceEvents);
  }, [serviceEvents]);

  // Get selected assembly service
  const selectedAssemblyService = useMemo(() => {
    if (!isAssemblyTask || !selectedServiceCode) return null;
    return assemblyServices.find(s => s.service_code === selectedServiceCode);
  }, [isAssemblyTask, selectedServiceCode, assemblyServices]);

  // Dynamically find repair service (uses pattern matching, not hardcoded code)
  const repairService = useMemo(() => {
    if (!isRepairTask) return null;
    return findRepairService(serviceEvents);
  }, [isRepairTask, serviceEvents]);

  // Calculate rate for per-task billing (Assembly or Repair)
  const getServiceRateForTask = () => {
    if (isAssemblyTask) return selectedAssemblyService?.rate || 0;
    if (isRepairTask) return repairService?.rate || 0;
    return 0;
  };
  const taskServiceRate = getServiceRateForTask();
  const effectiveTaskRate = billingRate !== null && billingRate !== undefined ? billingRate : taskServiceRate;
  const effectiveQuantity = billingQuantity ?? 0;
  const taskBillingTotal = effectiveTaskRate * effectiveQuantity;

  // Fetch billing events
  const fetchCharges = useCallback(async () => {
    if (!profile?.tenant_id || (!taskId && !shipmentId)) {
      setLoading(false);
      return;
    }

    try {
      let query = (supabase.from('billing_events') as any)
        .select('id, charge_type, description, quantity, unit_rate, total_amount, status, event_type')
        .eq('tenant_id', profile.tenant_id)
        .eq('status', 'unbilled');

      if (taskId) {
        query = query.eq('task_id', taskId);
      } else if (shipmentId) {
        query = query.eq('shipment_id', shipmentId);
      }

      const { data, error } = await query.order('created_at', { ascending: true });

      if (error) {
        console.error('[BillingChargesSection] Error fetching charges:', error);
      }

      setCharges(data || []);
    } catch (error) {
      console.error('[BillingChargesSection] Unexpected error:', error);
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, taskId, shipmentId]);

  useEffect(() => {
    fetchCharges();
  }, [fetchCharges, refreshKey]);

  // Calculate base rate for non-Assembly tasks (per-item billing)
  // Uses dynamic service lookup based on context and pattern matching
  const calculateBaseRate = useCallback(async () => {
    if (!profile?.tenant_id || serviceEventsLoading || isPerTaskBilling) {
      setCalculatedBaseRate(0);
      return;
    }

    // Determine service context using pattern matching (not hardcoded service codes)
    const serviceContext = getServiceContext(taskType || '', isShipment, isInboundShipment);
    if (!serviceContext) {
      setCalculatedBaseRate(0);
      return;
    }

    try {
      let totalRate = 0;

      // Fetch classes for mapping class_id to class_code
      const { data: classes } = await supabase
        .from('classes')
        .select('id, code')
        .eq('tenant_id', profile.tenant_id);
      const classMap = new Map((classes || []).map((c: any) => [c.id, c.code]));

      if (taskId) {
        // Get task items with class info for per-item calculation
        const { data: taskItems } = await (supabase
          .from('task_items') as any)
          .select(`
            item_id,
            quantity,
            items:item_id(class_id)
          `)
          .eq('task_id', taskId);

        if (taskItems && taskItems.length > 0) {
          // Calculate rate per item based on class
          for (const ti of taskItems) {
            const classCode = ti.items?.class_id ? classMap.get(ti.items.class_id) : null;
            // Use dynamic service lookup instead of getServiceRate with hardcoded service code
            const matchingService = findMatchingService(serviceEvents, serviceContext, classCode);
            const rate = matchingService?.rate || 0;
            const qty = ti.quantity || 1;
            totalRate += rate * qty;
          }
        }
      } else if (shipmentId) {
        // Get shipment items with class info for per-item calculation
        const { data: shipmentItems } = await (supabase
          .from('shipment_items') as any)
          .select(`
            item_id,
            quantity_expected,
            quantity_received,
            items:item_id(class_id)
          `)
          .eq('shipment_id', shipmentId);

        if (shipmentItems && shipmentItems.length > 0) {
          // Calculate rate per item based on class
          for (const si of shipmentItems) {
            const classCode = si.items?.class_id ? classMap.get(si.items.class_id) : null;
            // Use dynamic service lookup instead of hardcoded service code
            const matchingService = findMatchingService(serviceEvents, serviceContext, classCode);
            const rate = matchingService?.rate || 0;
            // Use received quantity if available, otherwise expected
            const qty = si.quantity_received || si.quantity_expected || 1;
            totalRate += rate * qty;
          }
        }
      }

      setCalculatedBaseRate(totalRate);
    } catch (error) {
      console.error('[BillingChargesSection] Error calculating rate:', error);
      setCalculatedBaseRate(0);
    }
  }, [profile?.tenant_id, taskId, shipmentId, taskType, serviceEventsLoading, isPerTaskBilling, serviceEvents, isShipment, isInboundShipment]);

  // Re-calculate when service events load or dependencies change
  useEffect(() => {
    if (!isPerTaskBilling && !serviceEventsLoading && serviceEvents.length > 0) {
      calculateBaseRate();
    }
  }, [calculateBaseRate, refreshKey, isPerTaskBilling, serviceEventsLoading, serviceEvents.length]);

  // Initialize local state from props (Assembly)
  useEffect(() => {
    if (billingQuantity !== null && billingQuantity !== undefined) {
      setLocalQuantity(billingQuantity.toString());
    }
  }, [billingQuantity]);

  useEffect(() => {
    if (billingRate !== null && billingRate !== undefined) {
      setLocalRate(billingRate.toString());
      rateInitialized.current = true;
    } else if (taskServiceRate > 0 && !rateInitialized.current) {
      setLocalRate('');
    }
  }, [billingRate, taskServiceRate]);

  // Calculate totals
  const addOnTotal = charges.reduce((sum, charge) => {
    return sum + (charge.total_amount || charge.unit_rate * charge.quantity);
  }, 0);

  const baseTotal = isPerTaskBilling ? taskBillingTotal : calculatedBaseRate;
  const grandTotal = baseTotal + addOnTotal;

  // Notify parent of total changes
  useEffect(() => {
    onTotalChange?.(grandTotal);
  }, [grandTotal, onTotalChange]);

  // Assembly service change handler
  const handleAssemblyServiceChange = (serviceCode: string) => {
    onServiceChange?.(serviceCode);
    // Reset rate override when service changes
    if (billingRate !== null) {
      onRateChange?.(null);
    }
    rateInitialized.current = false;
    setLocalRate('');
  };

  // Quantity handlers (Assembly)
  const handleQuantityChange = (value: string) => {
    setLocalQuantity(value);
  };

  const handleQuantityBlur = () => {
    const qty = parseFloat(localQuantity) || 0;
    if (qty !== billingQuantity) {
      onQuantityChange?.(qty);
    }
  };

  // Rate override handlers (Assembly)
  const handleRateChange = (value: string) => {
    setLocalRate(value);
  };

  const handleRateBlur = () => {
    const rate = localRate === '' ? null : parseFloat(localRate);
    if (localRate !== '' && (isNaN(rate!) || rate! < 0)) return;
    const currentRate = billingRate !== null && billingRate !== undefined ? billingRate : null;
    if (rate !== currentRate) {
      onRateChange?.(rate);
    }
  };

  // Edit handlers for add-on charges
  const handleStartEdit = (charge: BillingCharge) => {
    setEditingId(charge.id);
    setEditAmount((charge.total_amount || charge.unit_rate * charge.quantity).toFixed(2));
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditAmount('');
  };

  const handleSaveEdit = async (chargeId: string) => {
    const amount = parseFloat(editAmount);
    if (isNaN(amount) || amount < 0) {
      toast({ variant: 'destructive', title: 'Invalid amount' });
      return;
    }

    setSavingId(chargeId);
    try {
      const result = await updateBillingEventFields({
        eventId: chargeId,
        patch: {
          unit_rate: amount,
          quantity: 1,
          total_amount: amount,
        },
      });

      if (!result.success) throw new Error(result.error);

      setCharges(prev => prev.map(c =>
        c.id === chargeId
          ? { ...c, unit_rate: amount, quantity: 1, total_amount: amount }
          : c
      ));
      setEditingId(null);
      toast({ title: 'Charge updated' });
    } catch (error) {
      console.error('[BillingChargesSection] Save failed:', error);
      toast({ variant: 'destructive', title: 'Failed to save' });
    } finally {
      setSavingId(null);
    }
  };

  const handleDeleteCharge = async (chargeId: string) => {
    setSavingId(chargeId);
    try {
      const result = await updateBillingEventStatus({ eventId: chargeId, status: 'void' });

      if (!result.success) throw new Error(result.error);

      setCharges(prev => prev.filter(c => c.id !== chargeId));
      toast({ title: 'Charge removed' });
    } catch (error) {
      console.error('[BillingChargesSection] Delete failed:', error);
      toast({ variant: 'destructive', title: 'Failed to remove charge' });
    } finally {
      setSavingId(null);
    }
  };

  // Loading state
  if (loading || serviceEventsLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <MaterialIcon name="attach_money" size="sm" />
            Billing Charges
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-3/4" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <MaterialIcon name="attach_money" size="sm" />
          Billing Charges
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Assembly Task - Service Selector + Quantity */}
        {isAssemblyTask && (
          <div className="space-y-3">
            {/* Assembly Service Dropdown */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Assembly Service</label>
              {canEditBilling ? (
                <Select
                  value={selectedServiceCode || '60MA'}
                  onValueChange={handleAssemblyServiceChange}
                >
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Select assembly time..." />
                  </SelectTrigger>
                  <SelectContent>
                    {assemblyServices.map((service) => (
                      <SelectItem key={service.service_code} value={service.service_code}>
                        <div className="flex items-center justify-between gap-4 w-full">
                          <span>{service.service_name}</span>
                          <span className="text-muted-foreground text-xs">
                            ${service.rate.toFixed(2)}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div className="text-sm font-medium">
                  {selectedAssemblyService?.service_name || 'Assembly 60m'}
                </div>
              )}
            </div>

            {/* Quantity and Rate Row */}
            <div className="flex items-center gap-3 py-2 border-y">
              <div className="flex-1 space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Qty</label>
                {canEditBilling ? (
                  <Input
                    type="number"
                    min="0"
                    step="0.1"
                    value={localQuantity}
                    onChange={(e) => handleQuantityChange(e.target.value)}
                    onBlur={handleQuantityBlur}
                    className="h-8 w-20"
                  />
                ) : (
                  <div className="text-sm font-medium">{effectiveQuantity}</div>
                )}
              </div>
              <div className="text-muted-foreground">×</div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-1">
                  <label className="text-xs font-medium text-muted-foreground">Rate</label>
                  {billingRate !== null && billingRate !== undefined && (
                    <Badge variant="secondary" className="text-[10px] px-1">Override</Badge>
                  )}
                </div>
                {canEditBilling ? (
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={localRate}
                    onChange={(e) => handleRateChange(e.target.value)}
                    onBlur={handleRateBlur}
                    placeholder={taskServiceRate > 0 ? taskServiceRate.toFixed(2) : '0.00'}
                    className="h-8 w-24"
                  />
                ) : (
                  <div className="text-sm font-medium">${effectiveTaskRate.toFixed(2)}</div>
                )}
              </div>
              <div className="text-muted-foreground">=</div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Subtotal</label>
                <div className="text-sm font-semibold">${taskBillingTotal.toFixed(2)}</div>
              </div>
            </div>

            {/* Warning if quantity is 0 */}
            {effectiveQuantity === 0 && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <MaterialIcon name="warning" size="sm" />
                Set quantity to complete task
              </p>
            )}
          </div>
        )}

        {/* Repair Task - Quantity + Rate (uses 1HRO service) */}
        {isRepairTask && (
          <div className="space-y-3">
            {/* Service Info */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Repair Service</label>
              <div className="text-sm font-medium flex items-center gap-2">
                {repairService?.service_name || '1 Hr Repair'}
                <span className="text-muted-foreground text-xs">
                  (${repairService?.rate?.toFixed(2) || '0.00'}/hr)
                </span>
              </div>
            </div>

            {/* Quantity and Rate Row */}
            <div className="flex items-center gap-3 py-2 border-y">
              <div className="flex-1 space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Hours</label>
                {canEditBilling ? (
                  <Input
                    type="number"
                    min="0"
                    step="0.25"
                    value={localQuantity}
                    onChange={(e) => handleQuantityChange(e.target.value)}
                    onBlur={handleQuantityBlur}
                    className="h-8 w-20"
                    placeholder="0"
                  />
                ) : (
                  <div className="text-sm font-medium">{effectiveQuantity}</div>
                )}
              </div>
              <div className="text-muted-foreground">×</div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-1">
                  <label className="text-xs font-medium text-muted-foreground">Rate</label>
                  {billingRate !== null && billingRate !== undefined && (
                    <Badge variant="secondary" className="text-[10px] px-1">Override</Badge>
                  )}
                </div>
                {canEditBilling ? (
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    value={localRate}
                    onChange={(e) => handleRateChange(e.target.value)}
                    onBlur={handleRateBlur}
                    placeholder={taskServiceRate > 0 ? taskServiceRate.toFixed(2) : '0.00'}
                    className="h-8 w-24"
                  />
                ) : (
                  <div className="text-sm font-medium">${effectiveTaskRate.toFixed(2)}</div>
                )}
              </div>
              <div className="text-muted-foreground">=</div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Subtotal</label>
                <div className="text-sm font-semibold">${taskBillingTotal.toFixed(2)}</div>
              </div>
            </div>

            {/* Warning if quantity is 0 */}
            {effectiveQuantity === 0 && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <MaterialIcon name="warning" size="sm" />
                Set hours to complete task
              </p>
            )}
          </div>
        )}

        {/* Non-Assembly/Repair Tasks - Auto-calculated Rate */}
        {!isPerTaskBilling && (
          <div className="flex items-center justify-between py-2 border-b">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">
                {taskType ? `${taskType} Rate` : 'Base Rate'}
              </span>
              {calculatedBaseRate > 0 && (
                <Badge variant="outline" className="text-xs">Auto</Badge>
              )}
            </div>
            <span className="text-sm font-medium">
              ${calculatedBaseRate.toFixed(2)}
            </span>
          </div>
        )}

        {/* Add-on Charges */}
        {charges.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground uppercase tracking-wide pt-2">
              Add-on Charges
            </p>
            {charges.map((charge) => (
              <div
                key={charge.id}
                className="flex items-center justify-between py-2 border-b last:border-b-0"
              >
                <div className="flex-1 min-w-0">
                  <span className="text-sm truncate block">
                    {charge.charge_type}
                  </span>
                  {charge.description && (
                    <span className="text-xs text-muted-foreground truncate block">
                      {charge.description}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-2">
                  {editingId === charge.id ? (
                    <>
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={editAmount}
                        onChange={(e) => setEditAmount(e.target.value)}
                        className="w-20 h-7 text-right text-sm"
                        autoFocus
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => handleSaveEdit(charge.id)}
                        disabled={savingId === charge.id}
                      >
                        {savingId === charge.id ? (
                          <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                        ) : (
                          <MaterialIcon name="save" size="sm" />
                        )}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={handleCancelEdit}
                      >
                        <MaterialIcon name="close" size="sm" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <span className="text-sm font-medium min-w-[60px] text-right">
                        ${(charge.total_amount || charge.unit_rate * charge.quantity).toFixed(2)}
                      </span>
                      {canEditBilling && (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => handleStartEdit(charge)}
                          >
                            <MaterialIcon name="edit" size="sm" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7 text-destructive"
                            onClick={() => handleDeleteCharge(charge.id)}
                            disabled={savingId === charge.id}
                          >
                            {savingId === charge.id ? (
                              <MaterialIcon name="progress_activity" size="sm" className="animate-spin" />
                            ) : (
                              <MaterialIcon name="delete" size="sm" />
                            )}
                          </Button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Total */}
        <div className="flex items-center justify-between pt-3 border-t">
          <span className="text-sm font-semibold">Total</span>
          <span className="text-lg font-bold text-primary">
            ${grandTotal.toFixed(2)}
          </span>
        </div>

        {/* Breakdown summary */}
        {(baseTotal > 0 || charges.length > 0) && (
          <div className="text-xs text-muted-foreground text-right">
            {baseTotal > 0 && (
              <span>Base: ${baseTotal.toFixed(2)}</span>
            )}
            {baseTotal > 0 && charges.length > 0 && ' + '}
            {charges.length > 0 && (
              <span>Add-ons: ${addOnTotal.toFixed(2)}</span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
