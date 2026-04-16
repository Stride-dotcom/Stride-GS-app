/**
 * AccountCoverageOverridesSection - Account-specific coverage rate overrides
 * Allows setting custom coverage rates for specific accounts
 */

import { useState, useEffect } from 'react';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useAccountCoverageSettings } from '@/hooks/useAccountCoverageSettings';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface AccountCoverageOverridesSectionProps {
  accountId: string;
  accountName: string;
}

export function AccountCoverageOverridesSection({
  accountId,
  accountName,
}: AccountCoverageOverridesSectionProps) {
  const {
    settings,
    tenantDefaults,
    loading,
    saving,
    updateSettings,
    deleteSettings,
    getEffectiveRates,
  } = useAccountCoverageSettings(accountId);

  const [formData, setFormData] = useState({
    override_enabled: false,
    coverage_rate_full_no_deductible: 0.0188,
    coverage_rate_full_deductible: 0.0142,
    coverage_deductible_amount: 300,
    default_coverage_type: 'standard' as 'standard' | 'full_replacement_no_deductible' | 'full_replacement_deductible',
    auto_apply_coverage_on_receiving: false,
  });

  const [hasChanges, setHasChanges] = useState(false);
  const [removeConfirm, setRemoveConfirm] = useState(false);

  // Initialize form data from settings or tenant defaults
  useEffect(() => {
    if (settings) {
      setFormData({
        override_enabled: settings.override_enabled,
        coverage_rate_full_no_deductible: settings.coverage_rate_full_no_deductible ?? tenantDefaults?.coverage_rate_full_no_deductible ?? 0.0188,
        coverage_rate_full_deductible: settings.coverage_rate_full_deductible ?? tenantDefaults?.coverage_rate_full_deductible ?? 0.0142,
        coverage_deductible_amount: settings.coverage_deductible_amount ?? tenantDefaults?.coverage_deductible_amount ?? 300,
        default_coverage_type: settings.default_coverage_type ?? tenantDefaults?.coverage_default_type ?? 'standard',
        auto_apply_coverage_on_receiving: false,
      });
    } else if (tenantDefaults) {
      setFormData({
        override_enabled: false,
        coverage_rate_full_no_deductible: tenantDefaults.coverage_rate_full_no_deductible,
        coverage_rate_full_deductible: tenantDefaults.coverage_rate_full_deductible,
        coverage_deductible_amount: tenantDefaults.coverage_deductible_amount,
        default_coverage_type: tenantDefaults.coverage_default_type,
        auto_apply_coverage_on_receiving: false,
      });
    }
  }, [settings, tenantDefaults]);

  // Track changes
  useEffect(() => {
    if (!tenantDefaults) return;

    const originalOverrideEnabled = settings?.override_enabled ?? false;
    const originalRateNoDeductible = settings?.coverage_rate_full_no_deductible ?? tenantDefaults.coverage_rate_full_no_deductible;
    const originalRateDeductible = settings?.coverage_rate_full_deductible ?? tenantDefaults.coverage_rate_full_deductible;
    const originalDeductibleAmount = settings?.coverage_deductible_amount ?? tenantDefaults.coverage_deductible_amount;
    const originalDefaultType = settings?.default_coverage_type ?? tenantDefaults.coverage_default_type;

    const changed =
      formData.override_enabled !== originalOverrideEnabled ||
      formData.coverage_rate_full_no_deductible !== originalRateNoDeductible ||
      formData.coverage_rate_full_deductible !== originalRateDeductible ||
      formData.coverage_deductible_amount !== originalDeductibleAmount ||
      formData.default_coverage_type !== originalDefaultType;

    setHasChanges(changed);
  }, [formData, settings, tenantDefaults]);

  const handleSave = async () => {
    await updateSettings({
      override_enabled: formData.override_enabled,
      coverage_rate_full_no_deductible: formData.coverage_rate_full_no_deductible,
      coverage_rate_full_deductible: formData.coverage_rate_full_deductible,
      coverage_deductible_amount: formData.coverage_deductible_amount,
      default_coverage_type: formData.default_coverage_type,
    });
    setHasChanges(false);
  };

  const handleRemove = async () => {
    await deleteSettings();
    setRemoveConfirm(false);
    setFormData({
      override_enabled: false,
      coverage_rate_full_no_deductible: tenantDefaults?.coverage_rate_full_no_deductible ?? 0.0188,
      coverage_rate_full_deductible: tenantDefaults?.coverage_rate_full_deductible ?? 0.0142,
      coverage_deductible_amount: tenantDefaults?.coverage_deductible_amount ?? 300,
      default_coverage_type: tenantDefaults?.coverage_default_type ?? 'standard',
      auto_apply_coverage_on_receiving: false,
    });
  };

  const effectiveRates = getEffectiveRates();
  const { toast: toastNotify } = useToast();
  const [autoApplyCoverage, setAutoApplyCoverage] = useState(false);
  const [autoApplyLoading, setAutoApplyLoading] = useState(true);
  const [autoApplySaving, setAutoApplySaving] = useState(false);

  // Fetch auto_apply_coverage_on_receiving from accounts table
  useEffect(() => {
    if (!accountId) return;
    (async () => {
      try {
        const { data, error } = await (supabase.from('accounts') as any)
          .select('auto_apply_coverage_on_receiving')
          .eq('id', accountId)
          .maybeSingle();
        if (!error && data) {
          setAutoApplyCoverage(data.auto_apply_coverage_on_receiving ?? false);
        }
      } catch {
        // ignore
      } finally {
        setAutoApplyLoading(false);
      }
    })();
  }, [accountId]);

  const handleAutoApplyToggle = async (enabled: boolean) => {
    setAutoApplySaving(true);
    try {
      const defaultType = enabled
        ? (formData.default_coverage_type !== 'standard' ? formData.default_coverage_type : 'full_replacement_no_deductible')
        : null;
      const { data, error } = await supabase.rpc('rpc_set_account_auto_coverage', {
        p_account_id: accountId,
        p_enabled: enabled,
        p_default_type: defaultType,
      });
      if (error) throw error;
      setAutoApplyCoverage(enabled);
      toastNotify({
        title: enabled ? 'Auto-Apply Enabled' : 'Auto-Apply Disabled',
        description: enabled
          ? 'Coverage will be auto-applied when shipments for this account are received.'
          : 'Auto-apply coverage has been disabled for this account.',
      });
    } catch (err) {
      toastNotify({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to update auto-apply setting',
      });
    } finally {
      setAutoApplySaving(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <MaterialIcon name="progress_activity" className="h-5 w-5 animate-spin text-muted-foreground" />
            <span className="text-muted-foreground">Loading coverage settings...</span>
          </div>
        </CardHeader>
      </Card>
    );
  }

  // Don't show if tenant has coverage disabled
  if (!tenantDefaults?.coverage_enabled) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="verified_user" className="text-muted-foreground" />
            Valuation Coverage
          </CardTitle>
          <CardDescription>
            Valuation coverage is disabled at the organization level.
            Enable it in Settings &rarr; Organization &rarr; Preferences &rarr; Claims.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MaterialIcon name="verified_user" className="text-blue-600" />
          Valuation Coverage Overrides
        </CardTitle>
        <CardDescription>
          Set custom coverage rates for {accountName}. When disabled, organization defaults apply.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Enable Override Toggle */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
          <div className="space-y-0.5">
            <Label htmlFor="override_enabled" className="text-base font-medium">Enable Custom Rates</Label>
            <p className="text-sm text-muted-foreground">
              Override organization default coverage rates for this account.
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
          <div className="space-y-4 pl-4 border-l-2 border-blue-200 bg-blue-50/50 rounded-r-lg p-4">
            {/* Default Coverage Type */}
            <div className="space-y-2">
              <Label htmlFor="default_coverage_type">Default Coverage Type</Label>
              <Select
                value={formData.default_coverage_type}
                onValueChange={(value: 'standard' | 'full_replacement_no_deductible' | 'full_replacement_deductible') =>
                  setFormData((prev) => ({ ...prev, default_coverage_type: value }))
                }
              >
                <SelectTrigger className="max-w-sm bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="standard">Standard (60c/lb)</SelectItem>
                  <SelectItem value="full_replacement_no_deductible">Full Replacement (No Deductible)</SelectItem>
                  <SelectItem value="full_replacement_deductible">Full Replacement (With Deductible)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Coverage Rates */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="rate_no_deductible">Rate (No Deductible)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="rate_no_deductible"
                    type="number"
                    step="0.0001"
                    min="0"
                    max="1"
                    value={formData.coverage_rate_full_no_deductible}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        coverage_rate_full_no_deductible: parseFloat(e.target.value) || 0,
                      }))
                    }
                    className="w-28 bg-white"
                  />
                  <span className="text-sm text-muted-foreground">
                    = {(formData.coverage_rate_full_no_deductible * 100).toFixed(2)}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Org default: {((tenantDefaults?.coverage_rate_full_no_deductible ?? 0.0188) * 100).toFixed(2)}%
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="rate_deductible">Rate (With Deductible)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="rate_deductible"
                    type="number"
                    step="0.0001"
                    min="0"
                    max="1"
                    value={formData.coverage_rate_full_deductible}
                    onChange={(e) =>
                      setFormData((prev) => ({
                        ...prev,
                        coverage_rate_full_deductible: parseFloat(e.target.value) || 0,
                      }))
                    }
                    className="w-28 bg-white"
                  />
                  <span className="text-sm text-muted-foreground">
                    = {(formData.coverage_rate_full_deductible * 100).toFixed(2)}%
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Org default: {((tenantDefaults?.coverage_rate_full_deductible ?? 0.0142) * 100).toFixed(2)}%
                </p>
              </div>
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
                  value={formData.coverage_deductible_amount}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      coverage_deductible_amount: parseFloat(e.target.value) || 0,
                    }))
                  }
                  className="pl-8 bg-white"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Org default: ${(tenantDefaults?.coverage_deductible_amount ?? 300).toFixed(2)}
              </p>
            </div>
          </div>
        )}

        {/* Effective Rates Summary */}
        <div className="rounded-lg border p-4 bg-muted/20">
          <div className="flex items-center gap-2 mb-3">
            <MaterialIcon name="info" size="sm" className="text-blue-600" />
            <span className="font-medium">Effective Coverage Rates</span>
            <Badge variant={effectiveRates.source === 'account' ? 'default' : 'secondary'}>
              {effectiveRates.source === 'account' ? 'Account Override' : 'Organization Default'}
            </Badge>
          </div>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Full (No Deductible)</p>
              <p className="font-mono font-medium">{(effectiveRates.rate_full_no_deductible * 100).toFixed(2)}%</p>
            </div>
            <div>
              <p className="text-muted-foreground">Full (With Deductible)</p>
              <p className="font-mono font-medium">{(effectiveRates.rate_full_deductible * 100).toFixed(2)}%</p>
            </div>
            <div>
              <p className="text-muted-foreground">Deductible Amount</p>
              <p className="font-mono font-medium">${effectiveRates.deductible_amount.toFixed(2)}</p>
            </div>
          </div>
        </div>

        {/* Auto-Apply Coverage on Receiving */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
          <div className="space-y-0.5">
            <Label htmlFor="auto_apply_coverage" className="text-base font-medium">
              Auto-Apply Coverage on Receiving
            </Label>
            <p className="text-sm text-muted-foreground">
              Automatically apply the default coverage type when shipments for this account are received.
            </p>
          </div>
          <Switch
            id="auto_apply_coverage"
            checked={autoApplyCoverage}
            onCheckedChange={handleAutoApplyToggle}
            disabled={autoApplyLoading || autoApplySaving}
          />
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-2">
          {hasChanges && (
            <Button onClick={handleSave} disabled={saving}>
              {saving ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="animate-spin mr-2" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          )}
          {settings && (
            <Button
              variant="outline"
              onClick={() => setRemoveConfirm(true)}
              disabled={saving}
            >
              <MaterialIcon name="delete" size="sm" className="mr-1" />
              Remove Override
            </Button>
          )}
        </div>
      </CardContent>

      {/* Remove Confirmation */}
      <AlertDialog open={removeConfirm} onOpenChange={setRemoveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Coverage Override?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the custom coverage rates for {accountName}.
              The account will use organization default rates instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleRemove}>
              Remove Override
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
