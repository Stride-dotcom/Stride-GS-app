import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useLaborSettings } from '@/hooks/useLaborSettings';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

export function LaborSettingsTab() {
  const { settings, loading, saveSettings } = useLaborSettings();
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    currency_code: 'USD',
    overtime_multiplier: 1.5,
    standard_workweek_hours: 40,
    rounding_rule_minutes: 1,
  });

  useEffect(() => {
    if (settings) {
      setFormData({
        currency_code: settings.currency_code,
        overtime_multiplier: settings.overtime_multiplier,
        standard_workweek_hours: settings.standard_workweek_hours,
        rounding_rule_minutes: settings.rounding_rule_minutes,
      });
    }
  }, [settings]);

  const handleSave = async () => {
    setIsSaving(true);
    await saveSettings(formData);
    setIsSaving(false);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-[200px] w-full" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Labor Settings</h3>
        <p className="text-sm text-muted-foreground">
          Configure labor cost calculation settings for your organization.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="attach_money" size="md" />
            Currency & Pay Settings
          </CardTitle>
          <CardDescription>
            Configure how labor costs are calculated and displayed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Input
                id="currency"
                value={formData.currency_code}
                disabled
                className="bg-muted"
              />
              <p className="text-xs text-muted-foreground">
                Currency is fixed to USD for this version.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="overtime_multiplier">Overtime Multiplier</Label>
              <div className="relative">
                <Input
                  id="overtime_multiplier"
                  type="number"
                  step="0.1"
                  min="1"
                  max="3"
                  value={formData.overtime_multiplier}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      overtime_multiplier: parseFloat(e.target.value) || 1.5,
                    }))
                  }
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  x
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Overtime rate = base rate × multiplier (e.g., 1.5x = time and a half)
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="schedule" size="md" />
            Work Week Settings
          </CardTitle>
          <CardDescription>
            Define standard work hours for overtime calculations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="workweek_hours">Standard Workweek Hours</Label>
              <div className="relative">
                <Input
                  id="workweek_hours"
                  type="number"
                  min="1"
                  max="168"
                  value={formData.standard_workweek_hours}
                  onChange={(e) =>
                    setFormData((prev) => ({
                      ...prev,
                      standard_workweek_hours: parseInt(e.target.value) || 40,
                    }))
                  }
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                  hrs
                </span>
              </div>
              <p className="text-xs text-muted-foreground">
                Hours worked beyond this weekly threshold are overtime.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rounding">Time Rounding</Label>
              <Select
                value={formData.rounding_rule_minutes.toString()}
                onValueChange={(value) =>
                  setFormData((prev) => ({
                    ...prev,
                    rounding_rule_minutes: parseInt(value),
                  }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1 minute (no rounding)</SelectItem>
                  <SelectItem value="5">5 minutes</SelectItem>
                  <SelectItem value="6">6 minutes (1/10 hour)</SelectItem>
                  <SelectItem value="15">15 minutes (quarter hour)</SelectItem>
                  <SelectItem value="30">30 minutes (half hour)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Round task durations to nearest increment for billing.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MaterialIcon name="calculate" size="md" />
            Overtime Calculation Example
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-muted p-4 text-sm">
            <p className="font-medium mb-2">Example Calculation:</p>
            <ul className="space-y-1 text-muted-foreground">
              <li>• Employee hourly rate: $20.00/hr</li>
              <li>• Weekly hours worked: 45 hours</li>
              <li>• Standard hours: {formData.standard_workweek_hours} hrs @ $20.00 = ${(formData.standard_workweek_hours * 20).toFixed(2)}</li>
              <li>• Overtime hours: {Math.max(0, 45 - formData.standard_workweek_hours)} hrs @ ${(20 * formData.overtime_multiplier).toFixed(2)} = ${(Math.max(0, 45 - formData.standard_workweek_hours) * 20 * formData.overtime_multiplier).toFixed(2)}</li>
              <li className="font-medium text-foreground pt-2">
                • Total weekly cost: ${((formData.standard_workweek_hours * 20) + (Math.max(0, 45 - formData.standard_workweek_hours) * 20 * formData.overtime_multiplier)).toFixed(2)}
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving && <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />}
          Save Labor Settings
        </Button>
      </div>
    </div>
  );
}
