import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { logActivity } from '@/lib/activity/logActivity';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  mergeServiceTimeActualSnapshot,
  mergeServiceTimeAdjustmentSnapshot,
} from '@/lib/time/serviceTimeSnapshot';

export function ServiceTimeAdjustmentDialog(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobType: 'task' | 'shipment' | 'stocktake' | (string & {});
  jobId: string | undefined;
  /** Optional prefill; will be re-read from DB when saving */
  currentMinutes?: number | null;
  onSaved?: () => void;
}) {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [minutesInput, setMinutesInput] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [saving, setSaving] = useState(false);

  const jobTypeLabel = useMemo(() => {
    if (props.jobType === 'task') return 'Task';
    if (props.jobType === 'shipment') return 'Shipment';
    if (props.jobType === 'stocktake') return 'Stocktake';
    return 'Job';
  }, [props.jobType]);

  useEffect(() => {
    if (!props.open) return;
    setMinutesInput(
      props.currentMinutes != null && Number.isFinite(props.currentMinutes)
        ? String(Math.round(props.currentMinutes))
        : ''
    );
    setReason('');
  }, [props.open, props.currentMinutes]);

  const parsedMinutes = useMemo(() => {
    const n = Number(minutesInput);
    if (!Number.isFinite(n)) return null;
    const rounded = Math.round(n);
    if (rounded < 0) return null;
    return rounded;
  }, [minutesInput]);

  const save = async () => {
    if (!profile?.tenant_id || !profile?.id) return;
    if (!props.jobId) return;

    if (parsedMinutes == null) {
      toast({
        variant: 'destructive',
        title: 'Invalid minutes',
        description: 'Enter a non-negative number of minutes.',
      });
      return;
    }

    if (!reason.trim()) {
      toast({
        variant: 'destructive',
        title: 'Reason required',
        description: 'Please enter a reason for the time adjustment.',
      });
      return;
    }

    setSaving(true);
    try {
      const nowIso = new Date().toISOString();

      if (props.jobType === 'task') {
        const { data: row, error } = await (supabase.from('tasks') as any)
          .select('duration_minutes, metadata')
          .eq('tenant_id', profile.tenant_id)
          .eq('id', props.jobId)
          .maybeSingle();
        if (error) throw error;

        const oldMinutes = Number(
          row?.duration_minutes
          ?? (row?.metadata as any)?.service_time?.actual_labor_minutes
          ?? 0
        );

        let merged = mergeServiceTimeActualSnapshot(row?.metadata ?? null, {
          actual_cycle_minutes: parsedMinutes,
          actual_labor_minutes: parsedMinutes,
          actual_snapshot_at: nowIso,
          actual_version: 1,
        });
        merged = mergeServiceTimeAdjustmentSnapshot(merged, {
          adjustment_version: 1,
          adjusted_at: nowIso,
          adjusted_by: profile.id,
          adjusted_reason: reason.trim(),
          adjusted_from_minutes: Number.isFinite(oldMinutes) ? Math.round(oldMinutes) : 0,
          adjusted_to_minutes: parsedMinutes,
        });

        const { error: updateErr } = await (supabase.from('tasks') as any)
          .update({
            duration_minutes: parsedMinutes,
            metadata: merged,
          })
          .eq('tenant_id', profile.tenant_id)
          .eq('id', props.jobId);
        if (updateErr) throw updateErr;

        void logActivity({
          entityType: 'task',
          tenantId: profile.tenant_id,
          entityId: props.jobId,
          actorUserId: profile.id,
          eventType: 'service_time_adjusted',
          eventLabel: 'Service time adjusted',
          details: {
            old_minutes: Number.isFinite(oldMinutes) ? Math.round(oldMinutes) : null,
            new_minutes: parsedMinutes,
            reason: reason.trim(),
          },
        });
      } else if (props.jobType === 'shipment') {
        const { data: row, error } = await (supabase.from('shipments') as any)
          .select('metadata')
          .eq('tenant_id', profile.tenant_id)
          .eq('id', props.jobId)
          .maybeSingle();
        if (error) throw error;

        const oldMinutes = Number((row?.metadata as any)?.service_time?.actual_labor_minutes ?? 0);

        let merged = mergeServiceTimeActualSnapshot(row?.metadata ?? null, {
          actual_cycle_minutes: parsedMinutes,
          actual_labor_minutes: parsedMinutes,
          actual_snapshot_at: nowIso,
          actual_version: 1,
        });
        merged = mergeServiceTimeAdjustmentSnapshot(merged, {
          adjustment_version: 1,
          adjusted_at: nowIso,
          adjusted_by: profile.id,
          adjusted_reason: reason.trim(),
          adjusted_from_minutes: Number.isFinite(oldMinutes) ? Math.round(oldMinutes) : 0,
          adjusted_to_minutes: parsedMinutes,
        });

        const { error: updateErr } = await (supabase.from('shipments') as any)
          .update({ metadata: merged })
          .eq('tenant_id', profile.tenant_id)
          .eq('id', props.jobId);
        if (updateErr) throw updateErr;

        void logActivity({
          entityType: 'shipment',
          tenantId: profile.tenant_id,
          entityId: props.jobId,
          actorUserId: profile.id,
          eventType: 'service_time_adjusted',
          eventLabel: 'Service time adjusted',
          details: {
            old_minutes: Number.isFinite(oldMinutes) ? Math.round(oldMinutes) : null,
            new_minutes: parsedMinutes,
            reason: reason.trim(),
          },
        });
      } else if (props.jobType === 'stocktake') {
        const { data: row, error } = await (supabase.from('stocktakes') as any)
          .select('duration_minutes, metadata')
          .eq('tenant_id', profile.tenant_id)
          .eq('id', props.jobId)
          .maybeSingle();
        if (error) throw error;

        const oldMinutes = Number(
          row?.duration_minutes
          ?? (row?.metadata as any)?.service_time?.actual_labor_minutes
          ?? 0
        );

        let merged = mergeServiceTimeActualSnapshot(row?.metadata ?? null, {
          actual_cycle_minutes: parsedMinutes,
          actual_labor_minutes: parsedMinutes,
          actual_snapshot_at: nowIso,
          actual_version: 1,
        });
        merged = mergeServiceTimeAdjustmentSnapshot(merged, {
          adjustment_version: 1,
          adjusted_at: nowIso,
          adjusted_by: profile.id,
          adjusted_reason: reason.trim(),
          adjusted_from_minutes: Number.isFinite(oldMinutes) ? Math.round(oldMinutes) : 0,
          adjusted_to_minutes: parsedMinutes,
        });

        const { error: updateErr } = await (supabase.from('stocktakes') as any)
          .update({
            duration_minutes: parsedMinutes,
            metadata: merged,
          })
          .eq('tenant_id', profile.tenant_id)
          .eq('id', props.jobId);
        if (updateErr) throw updateErr;

        void logActivity({
          entityType: 'stocktake',
          tenantId: profile.tenant_id,
          entityId: props.jobId,
          actorUserId: profile.id,
          eventType: 'service_time_adjusted',
          eventLabel: 'Service time adjusted',
          details: {
            old_minutes: Number.isFinite(oldMinutes) ? Math.round(oldMinutes) : null,
            new_minutes: parsedMinutes,
            reason: reason.trim(),
          },
        });
      } else {
        toast({
          variant: 'destructive',
          title: 'Unsupported job type',
          description: `Cannot adjust service time for job type "${props.jobType}".`,
        });
        return;
      }

      toast({
        title: 'Time adjusted',
        description: `Updated actual service time to ${parsedMinutes} minute${parsedMinutes === 1 ? '' : 's'}.`,
      });

      props.onOpenChange(false);
      props.onSaved?.();
    } catch (err: any) {
      toast({
        variant: 'destructive',
        title: 'Adjustment failed',
        description: err?.message || 'Unable to update service time.',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MaterialIcon name="edit" size="sm" />
            Adjust Service Time
          </DialogTitle>
          <DialogDescription>
            Managers/admins can correct actual service time for this {jobTypeLabel}. This is audit-logged.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label>Actual minutes</Label>
            <Input
              inputMode="numeric"
              placeholder="e.g. 30"
              value={minutesInput}
              onChange={(e) => setMinutesInput(e.target.value)}
              disabled={saving}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Textarea
              placeholder="Why is this adjustment needed?"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={saving}
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => props.onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving || parsedMinutes == null || !reason.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

