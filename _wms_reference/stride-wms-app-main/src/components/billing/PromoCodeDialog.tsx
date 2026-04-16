/**
 * PromoCodeDialog - Create/Edit promo code dialog
 */

import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { SaveButton } from '@/components/ui/SaveButton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import {
  PromoCode,
  PromoCodeInput,
  DiscountType,
  ExpirationType,
  ServiceScopeType,
  UsageLimitType,
} from '@/hooks/usePromoCodes';
import { useServiceEvents } from '@/hooks/useServiceEvents';

interface PromoCodeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  promoCode?: PromoCode | null;
  onSave: (input: PromoCodeInput) => Promise<boolean>;
}

export function PromoCodeDialog({
  open,
  onOpenChange,
  promoCode,
  onSave,
}: PromoCodeDialogProps) {
  const { serviceEvents } = useServiceEvents();

  // Form state
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<DiscountType>('percentage');
  const [discountValue, setDiscountValue] = useState('');
  const [expirationType, setExpirationType] = useState<ExpirationType>('none');
  const [expirationDate, setExpirationDate] = useState('');
  const [serviceScope, setServiceScope] = useState<ServiceScopeType>('all');
  const [selectedServices, setSelectedServices] = useState<string[]>([]);
  const [usageLimitType, setUsageLimitType] = useState<UsageLimitType>('unlimited');
  const [usageLimit, setUsageLimit] = useState('');
  const [isActive, setIsActive] = useState(true);

  // Reset form when dialog opens/closes or promoCode changes
  useEffect(() => {
    if (open) {
      if (promoCode) {
        setCode(promoCode.code);
        setDiscountType(promoCode.discount_type);
        setDiscountValue(promoCode.discount_value.toString());
        setExpirationType(promoCode.expiration_type);
        setExpirationDate(promoCode.expiration_date?.split('T')[0] || '');
        setServiceScope(promoCode.service_scope);
        setSelectedServices(promoCode.selected_services || []);
        setUsageLimitType(promoCode.usage_limit_type);
        setUsageLimit(promoCode.usage_limit?.toString() || '');
        setIsActive(promoCode.is_active);
      } else {
        // Reset to defaults for new promo code
        setCode('');
        setDiscountType('percentage');
        setDiscountValue('');
        setExpirationType('none');
        setExpirationDate('');
        setServiceScope('all');
        setSelectedServices([]);
        setUsageLimitType('unlimited');
        setUsageLimit('');
        setIsActive(true);
      }
    }
  }, [open, promoCode]);

  const handleSave = async () => {
    const input: PromoCodeInput = {
      code,
      discount_type: discountType,
      discount_value: parseFloat(discountValue) || 0,
      expiration_type: expirationType,
      expiration_date: expirationType === 'date' ? expirationDate : null,
      service_scope: serviceScope,
      selected_services: serviceScope === 'selected' ? selectedServices : null,
      usage_limit_type: usageLimitType,
      usage_limit: usageLimitType === 'limited' ? parseInt(usageLimit) || null : null,
      is_active: isActive,
    };

    const success = await onSave(input);
    if (!success) throw new Error('Failed to save promo code');
    onOpenChange(false);
  };

  const toggleService = (serviceCode: string) => {
    setSelectedServices(prev =>
      prev.includes(serviceCode)
        ? prev.filter(s => s !== serviceCode)
        : [...prev, serviceCode]
    );
  };

  // Get unique services for selection
  const uniqueServices = serviceEvents.reduce((acc, se) => {
    if (!acc.find(s => s.service_code === se.service_code)) {
      acc.push({ service_code: se.service_code, service_name: se.service_name });
    }
    return acc;
  }, [] as { service_code: string; service_name: string }[]);

  const isValid = code.trim() && discountValue && parseFloat(discountValue) > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {promoCode ? 'Edit Promo Code' : 'Create Promo Code'}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
          {/* Code */}
          <div className="space-y-2">
            <Label htmlFor="code">Promo Code</Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g., SUMMER25"
              className="uppercase"
              disabled={!!promoCode}
            />
            {promoCode && (
              <p className="text-xs text-muted-foreground">Code cannot be changed after creation</p>
            )}
          </div>

          {/* Discount Type & Value */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Discount Type</Label>
              <Select value={discountType} onValueChange={(v) => setDiscountType(v as DiscountType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="percentage">Percentage (%)</SelectItem>
                  <SelectItem value="flat_rate">Flat Amount ($)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="discountValue">
                {discountType === 'percentage' ? 'Discount %' : 'Discount Amount'}
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  {discountType === 'percentage' ? '%' : '$'}
                </span>
                <Input
                  id="discountValue"
                  type="number"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  className="pl-8"
                  min="0"
                  max={discountType === 'percentage' ? '100' : undefined}
                  step={discountType === 'percentage' ? '1' : '0.01'}
                />
              </div>
            </div>
          </div>

          {/* Expiration */}
          <div className="space-y-2">
            <Label>Expiration</Label>
            <Select value={expirationType} onValueChange={(v) => setExpirationType(v as ExpirationType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Never expires</SelectItem>
                <SelectItem value="date">Expires on date</SelectItem>
              </SelectContent>
            </Select>
            {expirationType === 'date' && (
              <Input
                type="date"
                value={expirationDate}
                onChange={(e) => setExpirationDate(e.target.value)}
                min={new Date().toISOString().split('T')[0]}
              />
            )}
          </div>

          {/* Service Scope */}
          <div className="space-y-2">
            <Label>Applies To</Label>
            <Select value={serviceScope} onValueChange={(v) => setServiceScope(v as ServiceScopeType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Services</SelectItem>
                <SelectItem value="selected">Selected Services Only</SelectItem>
              </SelectContent>
            </Select>
            {serviceScope === 'selected' && (
              <div className="border rounded-lg p-3 max-h-40 overflow-y-auto space-y-2">
                {uniqueServices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No services configured</p>
                ) : (
                  uniqueServices.map((service) => (
                    <label
                      key={service.service_code}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedServices.includes(service.service_code)}
                        onChange={() => toggleService(service.service_code)}
                        className="rounded"
                      />
                      <span className="text-sm">{service.service_name}</span>
                    </label>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Usage Limit */}
          <div className="space-y-2">
            <Label>Usage Limit</Label>
            <Select value={usageLimitType} onValueChange={(v) => setUsageLimitType(v as UsageLimitType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unlimited">Unlimited uses</SelectItem>
                <SelectItem value="limited">Limited uses</SelectItem>
              </SelectContent>
            </Select>
            {usageLimitType === 'limited' && (
              <Input
                type="number"
                value={usageLimit}
                onChange={(e) => setUsageLimit(e.target.value)}
                placeholder="Max number of uses"
                min="1"
              />
            )}
          </div>

          {/* Active Status */}
          <div className="flex items-center justify-between py-2">
            <div>
              <Label>Active</Label>
              <p className="text-xs text-muted-foreground">Enable this promo code for use</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <SaveButton
              onClick={handleSave}
              label={promoCode ? 'Save Changes' : 'Create Promo Code'}
              savingLabel={promoCode ? 'Saving...' : 'Creating...'}
              savedLabel={promoCode ? 'Saved' : 'Created'}
              saveDisabled={!isValid}
            />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
