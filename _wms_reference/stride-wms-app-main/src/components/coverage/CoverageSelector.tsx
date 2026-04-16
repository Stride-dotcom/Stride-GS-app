import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { logItemActivity } from '@/lib/activity/logItemActivity';

// Canonical coverage types (matching database constraint)
export type CoverageType = 'standard' | 'full_replacement_no_deductible' | 'full_replacement_deductible' | 'pending';

interface CoverageSelectorProps {
  itemId: string;
  accountId?: string | null;
  sidemarkId?: string | null;
  classId?: string | null;
  currentCoverage?: CoverageType | null;
  currentDeclaredValue?: number | null;
  currentWeight?: number | null;
  isStaff?: boolean;
  readOnly?: boolean;
  compact?: boolean;
  onUpdate?: (coverageType: CoverageType, declaredValue: number | null) => void;
}

// Default rates
const DEFAULT_RATES = {
  standard: 0,
  full_replacement_no_deductible: 0.0188,
  full_replacement_deductible: 0.0142,
  pending: 0,
};

const DEFAULT_DEDUCTIBLE = 300;

export const COVERAGE_LABELS: Record<CoverageType, string> = {
  standard: 'Standard (60c/lb)',
  full_replacement_no_deductible: 'Full Replacement (No Deductible)',
  full_replacement_deductible: 'Full Replacement (With Deductible)',
  pending: 'Pending - Awaiting Selection',
};

export type CoverageSource = 'item' | 'shipment' | null;

// Coverage badge component for display in item lists
export function CoverageBadge({
  coverageType,
  coverageSource
}: {
  coverageType: CoverageType | null | undefined;
  coverageSource?: CoverageSource;
}) {
  if (!coverageType || coverageType === 'pending') {
    return (
      <Badge variant="outline" className="text-yellow-600 border-yellow-300 bg-yellow-50">
        <MaterialIcon name="schedule" className="h-3 w-3 mr-1" />
        Pending
      </Badge>
    );
  }

  const sourcePrefix = coverageSource === 'shipment' ? 'Via Shipment: ' : '';
  const sourceIcon = coverageSource === 'shipment' ? 'local_shipping' : 'verified_user';

  if (coverageType === 'standard') {
    return (
      <Badge variant="secondary" className="text-muted-foreground">
        <MaterialIcon name="shield" className="h-3 w-3 mr-1" />
        Standard
      </Badge>
    );
  }

  if (coverageType === 'full_replacement_no_deductible') {
    return (
      <Badge className="bg-blue-600 hover:bg-blue-700">
        <MaterialIcon name={sourceIcon} className="h-3 w-3 mr-1" />
        {sourcePrefix}Full (No Ded.)
      </Badge>
    );
  }

  if (coverageType === 'full_replacement_deductible') {
    return (
      <Badge className="bg-green-600 hover:bg-green-700">
        <MaterialIcon name={sourceIcon} className="h-3 w-3 mr-1" />
        {sourcePrefix}Full (w/ Ded.)
      </Badge>
    );
  }

  return null;
}

export function CoverageSelector({
  itemId,
  accountId,
  sidemarkId,
  classId,
  currentCoverage,
  currentDeclaredValue,
  currentWeight,
  isStaff = true,
  readOnly = false,
  compact = false,
  onUpdate,
}: CoverageSelectorProps) {
  const { toast } = useToast();
  const { profile } = useAuth();

  const [declaredValue, setDeclaredValue] = useState(currentDeclaredValue?.toString() || '');
  const [weightLbs, setWeightLbs] = useState(currentWeight?.toString() || '');
  const [saving, setSaving] = useState(false);

  // Coverage rates from tenant/account settings
  const [rates, setRates] = useState({
    full_replacement_no_deductible: DEFAULT_RATES.full_replacement_no_deductible,
    full_replacement_deductible: DEFAULT_RATES.full_replacement_deductible,
    deductible_amount: DEFAULT_DEDUCTIBLE,
  });

  // Fetch coverage rates via RPC
  useEffect(() => {
    async function fetchRates() {
      if (!accountId) return;
      try {
        const { data, error } = await supabase.rpc('rpc_get_effective_coverage_rates', {
          p_account_id: accountId,
        });
        if (!error && data) {
          const d = data as Record<string, number>;
          setRates({
            full_replacement_no_deductible: d.rate_full_replacement_no_deductible ?? DEFAULT_RATES.full_replacement_no_deductible,
            full_replacement_deductible: d.rate_full_replacement_deductible ?? DEFAULT_RATES.full_replacement_deductible,
            deductible_amount: d.deductible_amount ?? DEFAULT_DEDUCTIBLE,
          });
        }
      } catch {
        // Use defaults
      }
    }
    fetchRates();
  }, [accountId]);

  // Calculate coverage cost for display
  const calculateCost = (type: CoverageType, value: number): number => {
    if (type === 'standard' || type === 'pending') return 0;
    if (type === 'full_replacement_no_deductible') return value * rates.full_replacement_no_deductible;
    if (type === 'full_replacement_deductible') return value * rates.full_replacement_deductible;
    return 0;
  };

  const getDeductible = (type: CoverageType): number => {
    if (type === 'full_replacement_deductible') return rates.deductible_amount;
    return 0;
  };

  const getRate = (type: CoverageType): number => {
    if (type === 'full_replacement_no_deductible') return rates.full_replacement_no_deductible;
    if (type === 'full_replacement_deductible') return rates.full_replacement_deductible;
    return 0;
  };

  const calculateStandardCap = (weight: number): number => weight * 0.60;

  const declaredValueChanged = declaredValue !== (currentDeclaredValue?.toString() || '');
  const weightChanged = weightLbs !== (currentWeight?.toString() || '');
  const hasChanges = declaredValueChanged || weightChanged;

  // Save declared value via RPC — all billing is handled server-side
  const handleSaveDeclaredValue = async () => {
    const weightParsed = weightLbs.trim() === '' ? null : parseFloat(weightLbs);
    const weight = Number.isFinite(weightParsed) ? weightParsed : null;
    const currentWeightNormalized = currentWeight ?? null;
    const shouldUpdateWeightOnly = !declaredValueChanged && weight !== currentWeightNormalized;

    if (shouldUpdateWeightOnly) {
      setSaving(true);
      try {
        const { error } = await supabase.from('items').update({ weight_lbs: weight }).eq('id', itemId);
        if (error) throw error;
        toast({ title: 'Weight Updated' });
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : 'Failed to save';
        toast({ variant: 'destructive', title: 'Error', description: msg });
      } finally {
        setSaving(false);
      }
      return;
    }

    const dv = parseFloat(declaredValue);
    if (!dv || dv <= 0) {
      toast({ variant: 'destructive', title: 'Invalid', description: 'Declared value must be greater than 0.' });
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('rpc_update_item_declared_value', {
        p_item_id: itemId,
        p_declared_value: dv,
      });

      if (error) throw error;

      // Update weight separately (not coverage-related, direct update is fine)
      if (weight !== currentWeightNormalized) {
        await supabase.from('items').update({ weight_lbs: weight }).eq('id', itemId);
      }

      // Activity log (best-effort)
      if (profile?.tenant_id) {
        logItemActivity({
          tenantId: profile.tenant_id,
          itemId,
          actorUserId: profile.id,
          eventType: 'item_coverage_changed',
          eventLabel: `Declared value updated to $${dv.toFixed(2)}`,
          details: {
            from_declared_value: currentDeclaredValue ?? null,
            to_declared_value: dv,
          },
        });
      }

      const result = data as Record<string, number | boolean> | null;
      toast({ title: 'Declared Value Updated', description: result?.delta ? `Billing adjusted by $${(result.delta as number).toFixed(2)}` : undefined });
      onUpdate?.(currentCoverage || 'standard', dv);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to save';
      toast({ variant: 'destructive', title: 'Error', description: msg });
    } finally {
      setSaving(false);
    }
  };

  // Compact mode for quick entry table
  if (compact) {
    return (
      <div className="flex items-center gap-2">
        <CoverageBadge coverageType={currentCoverage} />
        <Input
          type="number"
          step="0.01"
          value={declaredValue}
          onChange={(e) => setDeclaredValue(e.target.value)}
          placeholder="$0.00"
          className="w-24 h-8 text-xs"
          disabled={readOnly}
        />
        {hasChanges && (
          <Button size="sm" variant="outline" onClick={handleSaveDeclaredValue} disabled={saving} className="h-8 px-2">
            {saving ? <MaterialIcon name="progress_activity" className="animate-spin" style={{ fontSize: '12px' }} /> : 'Save'}
          </Button>
        )}
      </div>
    );
  }

  const coverageType = currentCoverage || 'standard';

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MaterialIcon name="verified_user" size="md" className="text-blue-600" />
          Valuation Coverage
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Coverage Badge */}
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Coverage:</span>
          <CoverageBadge coverageType={currentCoverage} />
          {currentCoverage && currentCoverage !== 'standard' && currentCoverage !== 'pending' && (
            <span className="text-xs text-muted-foreground ml-1">
              (Managed at shipment level)
            </span>
          )}
        </div>

        {/* Weight */}
        <div className="space-y-2">
          <Label>Weight (lbs)</Label>
          <Input
            type="number"
            step="0.1"
            value={weightLbs}
            onChange={(e) => setWeightLbs(e.target.value)}
            placeholder="0.0"
            disabled={readOnly || (!isStaff && currentWeight !== null)}
          />
          {weightLbs && coverageType === 'standard' && (
            <p className="text-xs text-muted-foreground">
              Standard coverage cap: ${calculateStandardCap(parseFloat(weightLbs) || 0).toFixed(2)}
            </p>
          )}
        </div>

        {/* Declared Value */}
        <div className="space-y-2">
          <Label>
            Declared Value ($)
            {(coverageType === 'full_replacement_deductible' || coverageType === 'full_replacement_no_deductible') && (
              <span className="text-destructive ml-1">*</span>
            )}
          </Label>
          <Input
            type="number"
            step="0.01"
            value={declaredValue}
            onChange={(e) => setDeclaredValue(e.target.value)}
            placeholder="0.00"
            required={coverageType === 'full_replacement_deductible' || coverageType === 'full_replacement_no_deductible'}
            disabled={readOnly}
          />
          {(coverageType === 'full_replacement_deductible' || coverageType === 'full_replacement_no_deductible') && !declaredValue && (
            <p className="text-xs text-destructive">
              Declared value is required for full replacement coverage.
            </p>
          )}
        </div>

        {/* Coverage Cost Preview */}
        {(coverageType === 'full_replacement_deductible' || coverageType === 'full_replacement_no_deductible') && declaredValue && (
          <div className="p-3 bg-blue-50 border border-blue-200 rounded-md space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span>Coverage Rate:</span>
              <span className="font-mono">{(getRate(coverageType) * 100).toFixed(2)}%</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Deductible:</span>
              <span className="font-mono">${getDeductible(coverageType).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between font-medium pt-1 border-t">
              <span>Estimated Premium:</span>
              <span className="text-blue-600 font-mono">
                ${calculateCost(coverageType, parseFloat(declaredValue) || 0).toFixed(2)}
              </span>
            </div>
          </div>
        )}

        {/* Pending Coverage Notice */}
        {coverageType === 'pending' && (
          <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
            <div className="flex items-start gap-2">
              <MaterialIcon name="schedule" size="sm" className="text-yellow-600 mt-0.5" />
              <p className="text-sm text-yellow-700">
                Coverage is applied but a declared value is needed. Enter a declared value to activate billing.
              </p>
            </div>
          </div>
        )}

        {/* Save Button — saves declared value via RPC (billing is server-side) */}
        {!readOnly && hasChanges && (
          <Button
            onClick={handleSaveDeclaredValue}
            disabled={saving || (declaredValueChanged && (coverageType === 'full_replacement_deductible' || coverageType === 'full_replacement_no_deductible') && (!declaredValue || parseFloat(declaredValue) <= 0))}
            className="w-full"
          >
            {saving && <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-2" />}
            Save Changes
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
