import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

interface BillingRatesSectionProps {
  dailyStorageRatePerCuft: number;
  onDailyStorageRateChange: (value: number) => void;
  salesTaxRate: number;
  onSalesTaxRateChange: (value: number) => void;
  willCallMinimum: number;
  onWillCallMinimumChange: (value: number) => void;
  receivingChargeMinimum: number;
  onReceivingChargeMinimumChange: (value: number) => void;
  // Future fields (read-only display)
  shipmentMinimum?: number | null;
  hourlyRate?: number | null;
  baseRateIncludesPieces?: number | null;
  additionalPieceRate?: number | null;
}

export function BillingRatesSection({
  dailyStorageRatePerCuft,
  onDailyStorageRateChange,
  salesTaxRate,
  onSalesTaxRateChange,
  willCallMinimum,
  onWillCallMinimumChange,
  receivingChargeMinimum,
  onReceivingChargeMinimumChange,
  shipmentMinimum,
  hourlyRate,
  baseRateIncludesPieces,
  additionalPieceRate,
}: BillingRatesSectionProps) {
  // Handle text input for sales tax rate
  const handleSalesTaxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^0-9.]/g, '');
    const numValue = parseFloat(value) || 0;
    onSalesTaxRateChange(numValue / 100);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MaterialIcon name="attach_money" size="sm" />
          Billing & Rates
        </CardTitle>
        <CardDescription className="text-xs">
          Configure billing rates for storage and services
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Active Fields - Compact Grid */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5">
            <Label htmlFor="daily_storage_rate" className="text-sm">Storage Rate/cu ft</Label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                id="daily_storage_rate"
                type="text"
                inputMode="decimal"
                value={dailyStorageRatePerCuft}
                onChange={(e) => {
                  const value = e.target.value.replace(/[^0-9.]/g, '');
                  onDailyStorageRateChange(parseFloat(value) || 0);
                }}
                className="pl-6 h-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sales_tax_rate" className="text-sm">Sales Tax Rate</Label>
            <div className="relative">
              <Input
                id="sales_tax_rate"
                type="text"
                inputMode="decimal"
                value={(salesTaxRate * 100).toFixed(2)}
                onChange={handleSalesTaxChange}
                className="pr-7 h-9"
              />
              <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">%</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="will_call_minimum" className="text-sm">Will Call Min</Label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                id="will_call_minimum"
                type="text"
                inputMode="decimal"
                value={willCallMinimum}
                onChange={(e) => {
                  const value = e.target.value.replace(/[^0-9.]/g, '');
                  onWillCallMinimumChange(parseFloat(value) || 0);
                }}
                className="pl-6 h-9"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="receiving_charge_minimum" className="text-sm">Receiving Min</Label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                id="receiving_charge_minimum"
                type="text"
                inputMode="decimal"
                value={receivingChargeMinimum}
                onChange={(e) => {
                  const value = e.target.value.replace(/[^0-9.]/g, '');
                  onReceivingChargeMinimumChange(parseFloat(value) || 0);
                }}
                className="pl-6 h-9"
              />
            </div>
          </div>
        </div>

        {/* Future Fields - Coming Soon - Compact */}
        <div className="rounded-lg border border-dashed p-3 opacity-60">
          <div className="flex items-center gap-2 mb-3">
            <Badge variant="secondary" className="text-xs">Coming Soon</Badge>
            <span className="text-xs text-muted-foreground">Additional billing settings</span>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 pointer-events-none">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Shipment Min</Label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                <Input
                  type="number"
                  value={shipmentMinimum || 0}
                  disabled
                  className="pl-6 h-8 bg-muted text-sm"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Hourly Rate</Label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                <Input
                  type="number"
                  value={hourlyRate || 0}
                  disabled
                  className="pl-6 h-8 bg-muted text-sm"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Base Pieces</Label>
              <Input
                type="number"
                value={baseRateIncludesPieces || 0}
                disabled
                className="h-8 bg-muted text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Extra Piece Rate</Label>
              <div className="relative">
                <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                <Input
                  type="number"
                  value={additionalPieceRate || 0}
                  disabled
                  className="pl-6 h-8 bg-muted text-sm"
                />
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
