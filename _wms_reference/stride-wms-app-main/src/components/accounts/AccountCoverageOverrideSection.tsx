/**
 * AccountCoverageOverrideSection
 * Account-level coverage rate overrides for the Pricing tab
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useToast } from '@/hooks/use-toast';
import { useCoverageSettings } from '@/hooks/useCoverageSettings';
import { CoverageTypeValue } from '@/hooks/useOrganizationClaimSettings';

interface AccountCoverageOverrideSectionProps {
  accountId: string;
  accountName: string;
}

export function AccountCoverageOverrideSection({
  accountId,
  accountName,
}: AccountCoverageOverrideSectionProps) {
  const { toast } = useToast();
  const {
    loading,
    tenantSettings,
    accountOverride,
    effectiveRates,
    saveAccountOverride,
    refetchAccountOverride,
  } = useCoverageSettings({ accountId });

  const [formData, setFormData] = useState({
    override_enabled: false,
    full_replacement_no_deductible_rate: 0.0188,
    full_replacement_deductible_rate: 0.0142,
    deductible_amount: 300,
    default_coverage_type: 'standard' as CoverageTypeValue,
  });

  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize form from account override
  useEffect(() => {
    if (accountOverride) {
      setFormData({
        override_enabled: accountOverride.override_enabled || false,
        full_replacement_no_deductible_rate:
          accountOverride.full_replacement_no_deductible_rate ??
          tenantSettings?.full_replacement_no_deductible_rate ??
          0.0188,
        full_replacement_deductible_rate:
          accountOverride.full_replacement_deductible_rate ??
          tenantSettings?.full_replacement_deductible_rate ??
          0.0142,
        deductible_amount:
          accountOverride.deductible_amount ??
          tenantSettings?.deductible_amount ??
          300,
        default_coverage_type:
          accountOverride.default_coverage_type ??
          tenantSettings?.default_coverage_type ??
          'standard',
      });
    } else if (tenantSettings) {
      setFormData({
        override_enabled: false,
        full_replacement_no_deductible_rate: tenantSettings.full_replacement_no_deductible_rate ?? 0.0188,
        full_replacement_deductible_rate: tenantSettings.full_replacement_deductible_rate ?? 0.0142,
        deductible_amount: tenantSettings.deductible_amount ?? 300,
        default_coverage_type: tenantSettings.default_coverage_type ?? 'standard',
      });
    }
  }, [accountOverride, tenantSettings]);

  // Track changes
  useEffect(() => {
    if (!accountOverride && !formData.override_enabled) {
      setHasChanges(false);
      return;
    }

    const originalEnabled = accountOverride?.override_enabled || false;
    const originalNoDeductibleRate =
      accountOverride?.full_replacement_no_deductible_rate ??
      tenantSettings?.full_replacement_no_deductible_rate ??
      0.0188;
    const originalDeductibleRate =
      accountOverride?.full_replacement_deductible_rate ??
      tenantSettings?.full_replacement_deductible_rate ??
      0.0142;
    const originalDeductible =
      accountOverride?.deductible_amount ??
      tenantSettings?.deductible_amount ??
      300;
    const originalType =
      accountOverride?.default_coverage_type ??
      tenantSettings?.default_coverage_type ??
      'standard';

    const changed =
      formData.override_enabled !== originalEnabled ||
      (formData.override_enabled && (
        formData.full_replacement_no_deductible_rate !== originalNoDeductibleRate ||
        formData.full_replacement_deductible_rate !== originalDeductibleRate ||
        formData.deductible_amount !== originalDeductible ||
        formData.default_coverage_type !== originalType
      ));

    setHasChanges(changed);
  }, [formData, accountOverride, tenantSettings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const success = await saveAccountOverride({
        override_enabled: formData.override_enabled,
        full_replacement_no_deductible_rate: formData.override_enabled
          ? formData.full_replacement_no_deductible_rate
          : null,
        full_replacement_deductible_rate: formData.override_enabled
          ? formData.full_replacement_deductible_rate
          : null,
        deductible_amount: formData.override_enabled
          ? formData.deductible_amount
          : null,
        default_coverage_type: formData.override_enabled
          ? formData.default_coverage_type
          : null,
      });

      if (success) {
        toast({
          title: 'Coverage Settings Saved',
          description: formData.override_enabled
            ? `Custom coverage rates applied to ${accountName}.`
            : `${accountName} will use organization default rates.`,
        });
        setHasChanges(false);
        refetchAccountOverride();
      } else {
        throw new Error('Failed to save');
      }
    } catch (error) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to save coverage settings.',
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center">
            <MaterialIcon name="progress_activity" className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        </CardContent>
      </Card>
    );
  }

  // Don't show if coverage is disabled at tenant level
  if (!tenantSettings?.coverage_enabled) {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MaterialIcon name="verified_user" size="md" />
          Valuation Coverage Overrides
        </CardTitle>
        <CardDescription>
          Override organization default coverage rates for this account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Enable Override Toggle */}
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label htmlFor="override_enabled">Override Tenant Defaults</Label>
            <p className="text-sm text-muted-foreground">
              Use custom coverage rates for this account instead of organization defaults.
            </p>
          </div>
          <Switch
            id="override_enabled"
            checked={formData.override_enabled}
            onCheckedChange={(checked) =>
              setFormData((prev) => ({ ...prev, override_enabled: checked }))
            }
          />
        </div>

        {/* Override Fields */}
        {formData.override_enabled && (
          <div className="space-y-6 pl-4 border-l-2 border-primary/20">
            {/* Default Coverage Type */}
            <div className="space-y-2">
              <Label htmlFor="default_coverage_type">Default Coverage Type</Label>
              <Select
                value={formData.default_coverage_type}
                onValueChange={(value: CoverageTypeValue) =>
                  setFormData((prev) => ({ ...prev, default_coverage_type: value }))
                }
              >
                <SelectTrigger className="max-w-md">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard Coverage (No charge)</SelectItem>
                  <SelectItem value="full_replacement_no_deductible">Full Replacement (No deductible)</SelectItem>
                  <SelectItem value="full_replacement_deductible">Full Replacement (With deductible)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Full Replacement No Deductible Rate */}
            <div className="space-y-2">
              <Label htmlFor="no_deductible_rate">
                Full Replacement (No Deductible) Rate
              </Label>
              <div className="flex items-center gap-2 max-w-xs">
                <Input
                  id="no_deductible_rate"
                  type="number"
                  step="0.0001"
                  min="0"
                  max="1"
                  value={formData.full_replacement_no_deductible_rate}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      full_replacement_no_deductible_rate: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="w-28"
                />
                <span className="text-sm text-muted-foreground">
                  ({(formData.full_replacement_no_deductible_rate * 100).toFixed(2)}%)
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Org default: {((tenantSettings?.full_replacement_no_deductible_rate ?? 0.0188) * 100).toFixed(2)}%
              </p>
            </div>

            {/* Full Replacement Deductible Rate */}
            <div className="space-y-2">
              <Label htmlFor="deductible_rate">
                Full Replacement (With Deductible) Rate
              </Label>
              <div className="flex items-center gap-2 max-w-xs">
                <Input
                  id="deductible_rate"
                  type="number"
                  step="0.0001"
                  min="0"
                  max="1"
                  value={formData.full_replacement_deductible_rate}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      full_replacement_deductible_rate: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="w-28"
                />
                <span className="text-sm text-muted-foreground">
                  ({(formData.full_replacement_deductible_rate * 100).toFixed(2)}%)
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Org default: {((tenantSettings?.full_replacement_deductible_rate ?? 0.0142) * 100).toFixed(2)}%
              </p>
            </div>

            {/* Deductible Amount */}
            <div className="space-y-2">
              <Label htmlFor="deductible_amount">Deductible Amount</Label>
              <div className="relative max-w-xs">
                <MaterialIcon name="attach_money" size="sm" className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="deductible_amount"
                  type="number"
                  step="50"
                  min="0"
                  value={formData.deductible_amount}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      deductible_amount: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="pl-8 w-32"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Org default: ${(tenantSettings?.deductible_amount ?? 300).toFixed(0)}
              </p>
            </div>
          </div>
        )}

        {/* Effective Rates Summary */}
        {!formData.override_enabled && (
          <div className="bg-muted/50 rounded-lg p-4">
            <p className="text-sm font-medium mb-2">Current Effective Rates (Organization Defaults)</p>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">No Deductible Rate:</span>
                <span className="ml-2 font-mono">{(effectiveRates.full_replacement_no_deductible_rate * 100).toFixed(2)}%</span>
              </div>
              <div>
                <span className="text-muted-foreground">With Deductible Rate:</span>
                <span className="ml-2 font-mono">{(effectiveRates.full_replacement_deductible_rate * 100).toFixed(2)}%</span>
              </div>
              <div>
                <span className="text-muted-foreground">Deductible Amount:</span>
                <span className="ml-2 font-mono">${effectiveRates.deductible_amount.toFixed(0)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Save Button */}
        {hasChanges && (
          <div className="pt-4 border-t">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-2" />
                  Saving...
                </>
              ) : (
                'Save Coverage Settings'
              )}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
