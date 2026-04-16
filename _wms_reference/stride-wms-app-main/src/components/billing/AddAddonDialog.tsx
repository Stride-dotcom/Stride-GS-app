import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { BILLING_DISABLED_ERROR } from '@/lib/billing/chargeTypeUtils';
import { createEventRaw } from '@/services/billing';
import { usePermissions } from '@/hooks/usePermissions';
import { useServiceEvents, ServiceEventForScan } from '@/hooks/useServiceEvents';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { SaveButton } from '@/components/ui/SaveButton';

interface AddAddonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Can work with accounts, items, tasks, or shipments
  accountId: string;
  accountName?: string;
  itemId?: string | null;
  itemCode?: string | null;
  taskId?: string | null;
  shipmentId?: string | null;
  sidemarkId?: string | null;
  classId?: string | null;
  onSuccess?: () => void;
}

export function AddAddonDialog({
  open,
  onOpenChange,
  accountId,
  accountName,
  itemId,
  itemCode,
  taskId,
  shipmentId,
  sidemarkId,
  classId,
  onSuccess,
}: AddAddonDialogProps) {
  const { toast } = useToast();
  const { profile } = useAuth();
  const { hasRole, isAdmin } = usePermissions();
  const { scanServiceEvents, loading: loadingServices } = useServiceEvents();

  // Role-based access — admin_dev passes all hasRole() checks, so guard
  // against false-positive on 'client' by also checking isAdmin.
  const isClient = hasRole('client') && !isAdmin;
  const isWarehouse = hasRole('warehouse') && !isAdmin;
  const canSeeRates = !isWarehouse; // Warehouse users cannot see rates
  const canAddCustomCharge = !isWarehouse; // Warehouse users cannot add custom charges

  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'service' | 'custom'>('service');

  // Service Event mode state
  const [selectedServiceCode, setSelectedServiceCode] = useState<string>('');
  const [selectedService, setSelectedService] = useState<ServiceEventForScan | null>(null);
  const [serviceQuantity, setServiceQuantity] = useState('1');
  const [serviceRateOverride, setServiceRateOverride] = useState('');

  // Custom Charge mode state
  const [customName, setCustomName] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [customDescription, setCustomDescription] = useState('');

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setActiveTab(canAddCustomCharge ? 'service' : 'service');
      setSelectedServiceCode('');
      setSelectedService(null);
      setServiceQuantity('1');
      setServiceRateOverride('');
      setCustomName('');
      setCustomAmount('');
      setCustomDescription('');
    }
  }, [open, canAddCustomCharge]);

  // Update selected service when service code changes
  useEffect(() => {
    if (selectedServiceCode) {
      const service = scanServiceEvents.find(s => s.service_code === selectedServiceCode);
      setSelectedService(service || null);
      setServiceRateOverride(''); // Reset override when service changes
    } else {
      setSelectedService(null);
    }
  }, [selectedServiceCode, scanServiceEvents]);

  const handleSubmit = async () => {
    if (!profile?.tenant_id) return;

    if (!accountId) {
      toast({
        title: 'Account missing',
        description: 'An account is required to add billing charges.',
        variant: 'destructive',
      });
      return;
    }

    // Validate based on active tab
    if (activeTab === 'service') {
      if (!selectedService) {
        toast({
          title: 'Service required',
          description: 'Please select a service event.',
          variant: 'destructive',
        });
        return;
      }

      const quantity = parseFloat(serviceQuantity) || 0;
      if (quantity <= 0) {
        toast({
          title: 'Invalid quantity',
          description: 'Please enter a valid quantity.',
          variant: 'destructive',
        });
        return;
      }

      // Use override rate if provided, otherwise use service rate
      const rate = serviceRateOverride ? parseFloat(serviceRateOverride) : selectedService.rate;
      if (isNaN(rate) || rate < 0) {
        toast({
          title: 'Invalid rate',
          description: 'Please enter a valid rate.',
          variant: 'destructive',
        });
        return;
      }

      await submitCharge(
        selectedService.service_code,
        selectedService.service_name,
        quantity,
        rate,
        `${selectedService.service_name}${itemCode ? ` - ${itemCode}` : ''}`
      );
    } else {
      // Custom charge mode
      if (!customName.trim()) {
        toast({
          title: 'Charge name required',
          description: 'Please enter a charge name.',
          variant: 'destructive',
        });
        return;
      }

      const amount = parseFloat(customAmount);
      if (isNaN(amount) || amount <= 0) {
        toast({
          title: 'Valid amount required',
          description: 'Please enter a valid positive amount.',
          variant: 'destructive',
        });
        return;
      }

      await submitCharge(
        customName.trim(),
        customName.trim(),
        1,
        amount,
        customDescription.trim() || null
      );
    }
  };

  const submitCharge = async (
    chargeType: string,
    chargeName: string,
    quantity: number,
    unitRate: number,
    description: string | null
  ) => {
    setLoading(true);
    try {
      const metadata: Record<string, any> = {
        source: activeTab === 'service' ? 'service_event_manual' : 'custom_charge',
      };

      if (taskId) metadata.task_id = taskId;
      if (shipmentId) metadata.shipment_id = shipmentId;

      const payload: any = {
        tenant_id: profile!.tenant_id,
        account_id: accountId,
        item_id: itemId || null,
        task_id: taskId || null,
        shipment_id: shipmentId || null,
        sidemark_id: sidemarkId || null,
        class_id: classId || null,

        event_type: 'addon',
        charge_type: chargeType,
        description,
        quantity,
        unit_rate: unitRate,
        total_amount: quantity * unitRate,
        status: 'unbilled',
        occurred_at: new Date().toISOString(),
        metadata,
        created_by: profile!.id,
      };

      // Check account_service_settings for is_enabled before creating billing event
      if (accountId && chargeType) {
        const { data: accountSetting } = await supabase
          .from('account_service_settings')
          .select('is_enabled')
          .eq('account_id', accountId)
          .eq('service_code', chargeType)
          .maybeSingle();

        if (accountSetting && accountSetting.is_enabled === false) {
          throw new Error(BILLING_DISABLED_ERROR);
        }
      }

      const result = await createEventRaw(payload);
      if (!result.success) throw new Error(result.error || 'Failed to create billing event');

      toast({
        title: 'Charge added',
        description: `$${(quantity * unitRate).toFixed(2)} charge added${accountName ? ` for ${accountName}` : ''}.`,
      });

      onSuccess?.();
      onOpenChange(false);
    } catch (error: any) {
      console.error('Error adding billing event:', error);
      toast({
        title: 'Error',
        description: error.message || 'Failed to add charge.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Don't render for client users
  if (isClient) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[525px]">
        <DialogHeader>
          <DialogTitle>Add Charge</DialogTitle>
          {accountName && (
            <DialogDescription>
              Adding charge to: {accountName}
              {itemCode && ` (Item: ${itemCode})`}
            </DialogDescription>
          )}
        </DialogHeader>

        {canAddCustomCharge ? (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'service' | 'custom')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="service">Service Event</TabsTrigger>
              <TabsTrigger value="custom">Custom Charge</TabsTrigger>
            </TabsList>

            <TabsContent value="service" className="space-y-4 mt-4">
              <ServiceEventForm
                scanServiceEvents={scanServiceEvents}
                loadingServices={loadingServices}
                selectedServiceCode={selectedServiceCode}
                setSelectedServiceCode={setSelectedServiceCode}
                selectedService={selectedService}
                serviceQuantity={serviceQuantity}
                setServiceQuantity={setServiceQuantity}
                serviceRateOverride={serviceRateOverride}
                setServiceRateOverride={setServiceRateOverride}
                canSeeRates={canSeeRates}
              />
            </TabsContent>

            <TabsContent value="custom" className="space-y-4 mt-4">
              <CustomChargeForm
                customName={customName}
                setCustomName={setCustomName}
                customAmount={customAmount}
                setCustomAmount={setCustomAmount}
                customDescription={customDescription}
                setCustomDescription={setCustomDescription}
              />
            </TabsContent>
          </Tabs>
        ) : (
          // Warehouse users only see Service Event mode
          <div className="space-y-4 py-4">
            <ServiceEventForm
              scanServiceEvents={scanServiceEvents}
              loadingServices={loadingServices}
              selectedServiceCode={selectedServiceCode}
              setSelectedServiceCode={setSelectedServiceCode}
              selectedService={selectedService}
              serviceQuantity={serviceQuantity}
              setServiceQuantity={setServiceQuantity}
              serviceRateOverride={serviceRateOverride}
              setServiceRateOverride={setServiceRateOverride}
              canSeeRates={canSeeRates}
            />
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <SaveButton
            onClick={handleSubmit}
            label="Add Charge"
            savingLabel="Adding..."
            savedLabel="Charge Added"
            icon="attach_money"
            saveDisabled={loading}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Service Event Form Component
interface ServiceEventFormProps {
  scanServiceEvents: ServiceEventForScan[];
  loadingServices: boolean;
  selectedServiceCode: string;
  setSelectedServiceCode: (code: string) => void;
  selectedService: ServiceEventForScan | null;
  serviceQuantity: string;
  setServiceQuantity: (qty: string) => void;
  serviceRateOverride: string;
  setServiceRateOverride: (rate: string) => void;
  canSeeRates: boolean;
}

function ServiceEventForm({
  scanServiceEvents,
  loadingServices,
  selectedServiceCode,
  setSelectedServiceCode,
  selectedService,
  serviceQuantity,
  setServiceQuantity,
  serviceRateOverride,
  setServiceRateOverride,
  canSeeRates,
}: ServiceEventFormProps) {
  const effectiveRate = serviceRateOverride 
    ? parseFloat(serviceRateOverride) || 0 
    : (selectedService?.rate || 0);
  const quantity = parseFloat(serviceQuantity) || 0;
  const subtotal = effectiveRate * quantity;

  return (
    <>
      <div className="space-y-2">
        <Label>Service *</Label>
        <Select value={selectedServiceCode} onValueChange={setSelectedServiceCode}>
          <SelectTrigger>
            <SelectValue placeholder={loadingServices ? 'Loading...' : 'Select a service...'} />
          </SelectTrigger>
          <SelectContent className="max-h-64 overflow-y-auto">
            {scanServiceEvents.map((service) => (
              <SelectItem key={service.service_code} value={service.service_code}>
                <div className="flex items-center justify-between gap-4 w-full">
                  <span>{service.service_name}</span>
                  {canSeeRates && (
                    <span className="text-muted-foreground text-xs">
                      ${service.rate.toFixed(2)}
                    </span>
                  )}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedService?.notes && (
          <p className="text-xs text-muted-foreground">{selectedService.notes}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="service_quantity">Quantity *</Label>
          <Input
            id="service_quantity"
            type="number"
            min="1"
            step="1"
            value={serviceQuantity}
            onChange={(e) => setServiceQuantity(e.target.value)}
            placeholder="1"
          />
        </div>

        {canSeeRates && (
          <div className="space-y-2">
            <Label htmlFor="service_rate">Rate Override</Label>
            <Input
              id="service_rate"
              type="number"
              step="0.01"
              min="0"
              value={serviceRateOverride}
              onChange={(e) => setServiceRateOverride(e.target.value)}
              placeholder={selectedService ? selectedService.rate.toFixed(2) : '0.00'}
            />
          </div>
        )}
      </div>

      {canSeeRates && selectedService && (
        <div className="flex items-center justify-between py-2 px-3 bg-muted/50 rounded-md">
          <span className="text-sm text-muted-foreground">Subtotal</span>
          <span className="text-lg font-semibold">${subtotal.toFixed(2)}</span>
        </div>
      )}
    </>
  );
}

// Custom Charge Form Component
interface CustomChargeFormProps {
  customName: string;
  setCustomName: (name: string) => void;
  customAmount: string;
  setCustomAmount: (amount: string) => void;
  customDescription: string;
  setCustomDescription: (desc: string) => void;
}

function CustomChargeForm({
  customName,
  setCustomName,
  customAmount,
  setCustomAmount,
  customDescription,
  setCustomDescription,
}: CustomChargeFormProps) {
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor="custom_charge_name">Charge Name *</Label>
        <Input
          id="custom_charge_name"
          value={customName}
          onChange={(e) => setCustomName(e.target.value)}
          placeholder="e.g., Material purchase reimbursement"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="custom_amount">Amount *</Label>
        <Input
          id="custom_amount"
          type="number"
          step="0.01"
          min="0.01"
          value={customAmount}
          onChange={(e) => setCustomAmount(e.target.value)}
          placeholder="0.00"
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="custom_description">Notes (optional)</Label>
        <Textarea
          id="custom_description"
          value={customDescription}
          onChange={(e) => setCustomDescription(e.target.value)}
          placeholder="Additional details for billing/reporting..."
          rows={3}
        />
      </div>
    </>
  );
}
