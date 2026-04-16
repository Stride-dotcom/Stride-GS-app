import { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useInvoices } from '@/hooks/useInvoices';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { MaterialIcon } from '@/components/ui/MaterialIcon';

export function StorageGenerationSection() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { generateStorageForDate } = useInvoices();

  // Single day generation
  const [storageDate, setStorageDate] = useState<string>(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10);
  });
  const [generatingSingle, setGeneratingSingle] = useState(false);

  // Period generation
  const [periodStart, setPeriodStart] = useState<string>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
  });
  const [periodEnd, setPeriodEnd] = useState<string>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
  });
  const [generatingPeriod, setGeneratingPeriod] = useState(false);

  // Calculate days in period
  const daysInPeriod = Math.max(0, Math.ceil(
    (new Date(periodEnd).getTime() - new Date(periodStart).getTime()) / (1000 * 60 * 60 * 24)
  ) + 1);

  const handleGenerateForDay = async () => {
    setGeneratingSingle(true);
    try {
      await generateStorageForDate(storageDate);
      toast({
        title: 'Storage charges generated',
        description: `Storage charges for ${storageDate} have been created.`,
      });
    } catch (err) {
      toast({
        title: 'Error generating storage charges',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setGeneratingSingle(false);
    }
  };

  const handleGenerateForPeriod = async () => {
    if (new Date(periodStart) > new Date(periodEnd)) {
      toast({ title: 'Start date must be before end date', variant: 'destructive' });
      return;
    }

    setGeneratingPeriod(true);
    try {
      // Generate for each day in the period
      const start = new Date(periodStart);
      const end = new Date(periodEnd);
      let count = 0;

      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        await generateStorageForDate(d.toISOString().slice(0, 10));
        count++;
      }

      toast({
        title: 'Storage charges generated',
        description: `Storage charges for ${count} days have been created.`,
      });
    } catch (err) {
      toast({
        title: 'Error generating storage charges',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      setGeneratingPeriod(false);
    }
  };

  const handleQuickPreset = (preset: 'lastMonth' | 'thisMonth' | 'lastWeek') => {
    const now = new Date();
    let start: Date;
    let end: Date;

    switch (preset) {
      case 'lastMonth':
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        end = new Date(now.getFullYear(), now.getMonth(), 0);
        break;
      case 'thisMonth':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'lastWeek': {
        const lastSunday = new Date(now);
        lastSunday.setDate(now.getDate() - now.getDay() - 7);
        start = lastSunday;
        end = new Date(lastSunday);
        end.setDate(end.getDate() + 6);
        break;
      }
    }

    setPeriodStart(start.toISOString().slice(0, 10));
    setPeriodEnd(end.toISOString().slice(0, 10));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MaterialIcon name="calendar_today" size="sm" />
          Storage Charge Billing
        </CardTitle>
        <CardDescription>
          Generate storage charges for a date range or specific date. Storage charges are calculated daily based on item rates.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Single Day Generation */}
        <div className="space-y-3">
          <h3 className="font-medium">Single Day Generation</h3>
          <div className="flex items-end gap-3">
            <div className="space-y-1">
              <Label>Date</Label>
              <Input
                type="date"
                value={storageDate}
                onChange={(e) => setStorageDate(e.target.value)}
                className="w-[180px]"
              />
            </div>
            <Button onClick={handleGenerateForDay} disabled={generatingSingle}>
              {generatingSingle ? (
                <>
                  <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                'Generate for Day'
              )}
            </Button>
          </div>
        </div>

        <div className="border-t pt-6">
          {/* Period Generation */}
          <div className="space-y-3">
            <h3 className="font-medium">Period Storage Generation</h3>
            <p className="text-sm text-muted-foreground">
              Generate storage charges for all days in a period. Useful for monthly storage billing.
            </p>

            <div className="flex items-end gap-3 flex-wrap">
              <div className="space-y-1">
                <Label>Period Start</Label>
                <Input
                  type="date"
                  value={periodStart}
                  onChange={(e) => setPeriodStart(e.target.value)}
                  className="w-[180px]"
                />
              </div>
              <div className="space-y-1">
                <Label>Period End</Label>
                <Input
                  type="date"
                  value={periodEnd}
                  onChange={(e) => setPeriodEnd(e.target.value)}
                  className="w-[180px]"
                />
              </div>
              <Button
                onClick={handleGenerateForPeriod}
                disabled={generatingPeriod}
                variant="default"
              >
                {generatingPeriod ? (
                  <>
                    <MaterialIcon name="progress_activity" size="sm" className="mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <MaterialIcon name="date_range" size="sm" className="mr-2" />
                    Generate for Period
                  </>
                )}
              </Button>
              <span className="text-sm text-muted-foreground">
                {daysInPeriod} day(s)
              </span>
            </div>

            {/* Quick Presets */}
            <div className="flex items-center gap-2 pt-2">
              <span className="text-sm text-muted-foreground">Quick Presets:</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleQuickPreset('lastMonth')}
              >
                Last Month
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleQuickPreset('thisMonth')}
              >
                This Month
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleQuickPreset('lastWeek')}
              >
                Last Week
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
