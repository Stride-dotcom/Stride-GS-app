/**
 * useClaimSLA Hook
 * Handles SLA tracking, pause/resume, and status calculation for claims
 */

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useOrganizationClaimSettings } from './useOrganizationClaimSettings';
import { addHours, addMinutes, differenceInMinutes, isBefore, isAfter } from 'date-fns';

export type SLAStage =
  | 'acknowledged'
  | 'initial_review'
  | 'auto_approved'
  | 'manual_review'
  | 'awaiting_customer'
  | 'packet_preparation'
  | 'report_ready';

export type SLAStatus = 'on_track' | 'due_soon' | 'overdue' | 'paused';

export interface ClaimSLAData {
  sla_stage: SLAStage | null;
  sla_due_at: string | null;
  sla_status: SLAStatus;
  sla_paused_at: string | null;
  sla_pause_reason: string | null;
  sla_total_paused_minutes: number;
}

export interface SLAUpdateResult {
  success: boolean;
  error?: string;
}

// SLA stage labels for display (internal only)
export const SLA_STAGE_LABELS: Record<SLAStage, string> = {
  acknowledged: 'Acknowledged',
  initial_review: 'Initial Review',
  auto_approved: 'Auto-Approved Payout',
  manual_review: 'Manual Review',
  awaiting_customer: 'Awaiting Customer',
  packet_preparation: 'Packet Preparation',
  report_ready: 'Report Ready',
};

// SLA status colors for badges
export const SLA_STATUS_COLORS: Record<SLAStatus, string> = {
  on_track: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  due_soon: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  overdue: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  paused: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300',
};

export const SLA_STATUS_LABELS: Record<SLAStatus, string> = {
  on_track: 'On Track',
  due_soon: 'Due Soon',
  overdue: 'Overdue',
  paused: 'Paused',
};

export function useClaimSLA() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const { settings } = useOrganizationClaimSettings();
  const [updating, setUpdating] = useState(false);

  /**
   * Calculate the due date for a given SLA stage
   */
  const calculateSLADueDate = useCallback(
    (stage: SLAStage, baseDate: Date, claimCategory: 'liability' | 'shipping_damage'): Date => {
      let dueDate = new Date(baseDate);

      if (claimCategory === 'liability') {
        switch (stage) {
          case 'acknowledged':
            dueDate = addMinutes(baseDate, settings.sla_ack_minutes);
            break;
          case 'initial_review':
            dueDate = addHours(baseDate, settings.sla_initial_review_business_hours);
            break;
          case 'auto_approved':
            dueDate = addHours(baseDate, settings.sla_auto_approved_payout_hours);
            break;
          case 'manual_review':
            dueDate = addHours(baseDate, settings.sla_manual_review_business_hours);
            break;
          case 'awaiting_customer':
            // No due date when paused
            break;
        }
      } else {
        // shipping_damage
        switch (stage) {
          case 'initial_review':
            dueDate = addHours(baseDate, settings.sla_initial_review_business_hours);
            break;
          case 'packet_preparation':
            dueDate = addHours(baseDate, settings.sla_shipping_damage_packet_business_hours);
            break;
          case 'report_ready':
            dueDate = addHours(baseDate, settings.sla_public_report_business_hours);
            break;
          case 'awaiting_customer':
            // No due date when paused
            break;
        }
      }

      return dueDate;
    },
    [settings]
  );

  /**
   * Calculate current SLA status based on due date
   */
  const calculateSLAStatus = useCallback((dueAt: Date | null, isPaused: boolean): SLAStatus => {
    if (isPaused) return 'paused';
    if (!dueAt) return 'on_track';

    const now = new Date();
    const dueSoonThreshold = addHours(now, 24); // 24 hours before due

    if (isAfter(now, dueAt)) {
      return 'overdue';
    } else if (isAfter(now, addHours(dueAt, -24))) {
      return 'due_soon';
    }
    return 'on_track';
  }, []);

  /**
   * Initialize SLA for a new claim
   */
  const initializeSLA = useCallback(
    async (
      claimId: string,
      claimCategory: 'liability' | 'shipping_damage',
      createdAt: Date
    ): Promise<SLAUpdateResult> => {
      if (!profile?.tenant_id || !settings.enable_sla_tracking) {
        return { success: true }; // SLA tracking disabled
      }

      try {
        setUpdating(true);

        const initialStage: SLAStage = 'initial_review';
        const dueAt = calculateSLADueDate(initialStage, createdAt, claimCategory);
        const status = calculateSLAStatus(dueAt, false);

        const { error } = await supabase
          .from('claims')
          .update({
            sla_stage: initialStage,
            sla_due_at: dueAt.toISOString(),
            sla_status: status,
            sla_paused_at: null,
            sla_pause_reason: null,
            sla_total_paused_minutes: 0,
          })
          .eq('id', claimId)
          .eq('tenant_id', profile.tenant_id);

        if (error) throw error;
        return { success: true };
      } catch (error) {
        console.error('Error initializing SLA:', error);
        return { success: false, error: 'Failed to initialize SLA' };
      } finally {
        setUpdating(false);
      }
    },
    [profile?.tenant_id, settings.enable_sla_tracking, calculateSLADueDate, calculateSLAStatus]
  );

  /**
   * Advance SLA to next stage
   */
  const advanceSLAStage = useCallback(
    async (
      claimId: string,
      newStage: SLAStage,
      claimCategory: 'liability' | 'shipping_damage'
    ): Promise<SLAUpdateResult> => {
      if (!profile?.tenant_id || !settings.enable_sla_tracking) {
        return { success: true };
      }

      try {
        setUpdating(true);

        const now = new Date();
        const dueAt = calculateSLADueDate(newStage, now, claimCategory);
        const status = calculateSLAStatus(dueAt, newStage === 'awaiting_customer');

        const updates: Record<string, unknown> = {
          sla_stage: newStage,
          sla_due_at: newStage === 'awaiting_customer' ? null : dueAt.toISOString(),
          sla_status: status,
        };

        if (newStage === 'awaiting_customer') {
          updates.sla_paused_at = now.toISOString();
          updates.sla_pause_reason = 'Awaiting customer documents';
        }

        const { error } = await supabase
          .from('claims')
          .update(updates)
          .eq('id', claimId)
          .eq('tenant_id', profile.tenant_id);

        if (error) throw error;
        return { success: true };
      } catch (error) {
        console.error('Error advancing SLA stage:', error);
        return { success: false, error: 'Failed to advance SLA stage' };
      } finally {
        setUpdating(false);
      }
    },
    [profile?.tenant_id, settings.enable_sla_tracking, calculateSLADueDate, calculateSLAStatus]
  );

  /**
   * Pause SLA clock
   */
  const pauseSLA = useCallback(
    async (claimId: string, reason: string): Promise<SLAUpdateResult> => {
      if (!profile?.tenant_id) return { success: false, error: 'Not authenticated' };

      try {
        setUpdating(true);

        const { error } = await supabase
          .from('claims')
          .update({
            sla_status: 'paused',
            sla_paused_at: new Date().toISOString(),
            sla_pause_reason: reason,
          })
          .eq('id', claimId)
          .eq('tenant_id', profile.tenant_id);

        if (error) throw error;

        toast({
          title: 'SLA Paused',
          description: `SLA clock paused: ${reason}`,
        });

        return { success: true };
      } catch (error) {
        console.error('Error pausing SLA:', error);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to pause SLA',
        });
        return { success: false, error: 'Failed to pause SLA' };
      } finally {
        setUpdating(false);
      }
    },
    [profile?.tenant_id, toast]
  );

  /**
   * Resume SLA clock and adjust due date
   */
  const resumeSLA = useCallback(
    async (claimId: string, currentSlaData: ClaimSLAData): Promise<SLAUpdateResult> => {
      if (!profile?.tenant_id) return { success: false, error: 'Not authenticated' };
      if (!currentSlaData.sla_paused_at || !currentSlaData.sla_due_at) {
        return { success: false, error: 'SLA was not paused or has no due date' };
      }

      try {
        setUpdating(true);

        const pausedAt = new Date(currentSlaData.sla_paused_at);
        const now = new Date();
        const pausedMinutes = differenceInMinutes(now, pausedAt);

        // Push due date forward by paused duration
        const originalDueAt = new Date(currentSlaData.sla_due_at);
        const newDueAt = addMinutes(originalDueAt, pausedMinutes);
        const newStatus = calculateSLAStatus(newDueAt, false);

        const { error } = await supabase
          .from('claims')
          .update({
            sla_status: newStatus,
            sla_due_at: newDueAt.toISOString(),
            sla_paused_at: null,
            sla_pause_reason: null,
            sla_total_paused_minutes: (currentSlaData.sla_total_paused_minutes || 0) + pausedMinutes,
          })
          .eq('id', claimId)
          .eq('tenant_id', profile.tenant_id);

        if (error) throw error;

        toast({
          title: 'SLA Resumed',
          description: `SLA clock resumed. Due date adjusted by ${pausedMinutes} minutes.`,
        });

        return { success: true };
      } catch (error) {
        console.error('Error resuming SLA:', error);
        toast({
          variant: 'destructive',
          title: 'Error',
          description: 'Failed to resume SLA',
        });
        return { success: false, error: 'Failed to resume SLA' };
      } finally {
        setUpdating(false);
      }
    },
    [profile?.tenant_id, toast, calculateSLAStatus]
  );

  /**
   * Update SLA status based on current time (for batch updates)
   */
  const refreshSLAStatus = useCallback(
    async (claimId: string, currentDueAt: string | null, isPaused: boolean): Promise<SLAStatus> => {
      if (isPaused) return 'paused';
      if (!currentDueAt) return 'on_track';

      const dueAt = new Date(currentDueAt);
      const newStatus = calculateSLAStatus(dueAt, isPaused);

      // Update in database if status changed (optional - could be done in batch)
      if (profile?.tenant_id) {
        await supabase
          .from('claims')
          .update({ sla_status: newStatus })
          .eq('id', claimId)
          .eq('tenant_id', profile.tenant_id);
      }

      return newStatus;
    },
    [profile?.tenant_id, calculateSLAStatus]
  );

  /**
   * Get SLA badge props for display
   */
  const getSLABadgeProps = useCallback(
    (status: SLAStatus | null | undefined): { label: string; className: string } => {
      const safeStatus = status || 'on_track';
      return {
        label: SLA_STATUS_LABELS[safeStatus],
        className: SLA_STATUS_COLORS[safeStatus],
      };
    },
    []
  );

  /**
   * Get SLA stage label
   */
  const getSLAStageLabel = useCallback((stage: SLAStage | null | undefined): string => {
    if (!stage) return 'Not Started';
    return SLA_STAGE_LABELS[stage] || stage;
  }, []);

  return {
    updating,
    initializeSLA,
    advanceSLAStage,
    pauseSLA,
    resumeSLA,
    refreshSLAStatus,
    calculateSLAStatus,
    getSLABadgeProps,
    getSLAStageLabel,
    SLA_STAGE_LABELS,
    SLA_STATUS_COLORS,
    SLA_STATUS_LABELS,
  };
}
