/**
 * useClaimInsights Hook
 * Provides KPIs, trends, and operational metrics for the Claims Dashboard
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { startOfDay, subDays, format, startOfWeek, endOfWeek } from 'date-fns';

export interface ClaimKPIs {
  claimsOpened: number;
  claimsClosed: number;
  totalPayouts: number;
  averagePayout: number;
  autoApprovedClaims: number;
  shippingDamageClaims: number;
  assistanceFeesBilled: number;
}

export interface ClaimTrend {
  week: string;
  claimsOpened: number;
  payouts: number;
  autoApprovals: number;
}

export interface SLAPerformance {
  onTimePercent: number;
  overduePercent: number;
  avgTimeToDecisionHours: number;
  avgTimePerStageHours: Record<string, number>;
  totalPausedMinutes: number;
}

export interface AIPerformance {
  acceptanceRate: number;
  overrideRate: number;
  averageDelta: number;
  topOverrideReasons: { reason: string; count: number }[];
  breakdownByType: { type: string; accepted: number; overridden: number }[];
}

export interface OperationalQueues {
  needingReview: number;
  overdue: number;
  paused: number;
  shippingDamagePending: number;
}

export interface ClaimInsightsData {
  kpis: ClaimKPIs;
  trends: ClaimTrend[];
  slaPerformance: SLAPerformance;
  aiPerformance: AIPerformance;
  queues: OperationalQueues;
}

const DEFAULT_KPIS: ClaimKPIs = {
  claimsOpened: 0,
  claimsClosed: 0,
  totalPayouts: 0,
  averagePayout: 0,
  autoApprovedClaims: 0,
  shippingDamageClaims: 0,
  assistanceFeesBilled: 0,
};

const DEFAULT_SLA_PERFORMANCE: SLAPerformance = {
  onTimePercent: 100,
  overduePercent: 0,
  avgTimeToDecisionHours: 0,
  avgTimePerStageHours: {},
  totalPausedMinutes: 0,
};

const DEFAULT_AI_PERFORMANCE: AIPerformance = {
  acceptanceRate: 0,
  overrideRate: 0,
  averageDelta: 0,
  topOverrideReasons: [],
  breakdownByType: [],
};

const DEFAULT_QUEUES: OperationalQueues = {
  needingReview: 0,
  overdue: 0,
  paused: 0,
  shippingDamagePending: 0,
};

export function useClaimInsights(dateRangeDays: number = 30) {
  const { profile } = useAuth();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ClaimInsightsData>({
    kpis: DEFAULT_KPIS,
    trends: [],
    slaPerformance: DEFAULT_SLA_PERFORMANCE,
    aiPerformance: DEFAULT_AI_PERFORMANCE,
    queues: DEFAULT_QUEUES,
  });

  const fetchInsights = useCallback(async () => {
    if (!profile?.tenant_id) return;

    try {
      setLoading(true);
      const startDate = startOfDay(subDays(new Date(), dateRangeDays));
      const startDateStr = startDate.toISOString();

      // Fetch KPIs - claims in date range
      const { data: recentClaims, error: claimsError } = await (supabase as any)
        .from('claims')
        .select('id, status, claim_category, auto_approved, approved_payout_amount, created_at, resolved_at, sla_status, sla_total_paused_minutes')
        .eq('tenant_id', profile.tenant_id)
        .gte('created_at', startDateStr);

      if (claimsError) throw claimsError;

      // Fetch assistance billing events
      const { data: assistanceEvents, error: billingError } = await supabase
        .from('billing_events')
        .select('total_amount')
        .eq('tenant_id', profile.tenant_id)
        .eq('charge_type', 'claim_assistance')
        .gte('created_at', startDateStr);

      if (billingError) throw billingError;

      // Fetch AI feedback for performance metrics
      const { data: feedbackData, error: feedbackError } = await (supabase as any)
        .from('claim_ai_feedback')
        .select('decision_source, override_reason_code, delta_amount, final_status')
        .eq('tenant_id', profile.tenant_id)
        .gte('created_at', startDateStr);

      if (feedbackError) throw feedbackError;

      // Fetch operational queue counts
      const { data: queueCounts, error: queueError } = await (supabase as any)
        .from('claims')
        .select('id, status, sla_status, claim_category')
        .eq('tenant_id', profile.tenant_id)
        .in('status', ['initiated', 'under_review', 'pending_approval']);

      if (queueError) throw queueError;

      // Calculate KPIs
      const claims = recentClaims || [];
      const opened = claims.length;
      const closed = claims.filter(c =>
        ['accepted', 'credited', 'paid', 'closed', 'denied', 'declined'].includes(c.status)
      ).length;
      const payouts = claims
        .filter(c => c.approved_payout_amount != null)
        .map(c => c.approved_payout_amount || 0);
      const totalPayouts = payouts.reduce((sum, p) => sum + p, 0);
      const avgPayout = payouts.length > 0 ? totalPayouts / payouts.length : 0;
      const autoApproved = claims.filter(c => c.auto_approved).length;
      const shippingDamage = claims.filter(c => c.claim_category === 'shipping_damage').length;
      const assistanceFees = (assistanceEvents || []).reduce((sum, e) => sum + (e.total_amount || 0), 0);

      const kpis: ClaimKPIs = {
        claimsOpened: opened,
        claimsClosed: closed,
        totalPayouts,
        averagePayout: avgPayout,
        autoApprovedClaims: autoApproved,
        shippingDamageClaims: shippingDamage,
        assistanceFeesBilled: assistanceFees,
      };

      // Calculate trends (group by week)
      const trendMap = new Map<string, ClaimTrend>();
      claims.forEach(claim => {
        const weekStart = startOfWeek(new Date(claim.created_at));
        const weekKey = format(weekStart, 'MMM d');

        if (!trendMap.has(weekKey)) {
          trendMap.set(weekKey, { week: weekKey, claimsOpened: 0, payouts: 0, autoApprovals: 0 });
        }

        const trend = trendMap.get(weekKey)!;
        trend.claimsOpened += 1;
        trend.payouts += claim.approved_payout_amount || 0;
        if (claim.auto_approved) trend.autoApprovals += 1;
      });

      const trends = Array.from(trendMap.values()).sort((a, b) =>
        new Date(a.week).getTime() - new Date(b.week).getTime()
      );

      // Calculate SLA Performance
      const claimsWithSLA = claims.filter(c => c.sla_status);
      const onTime = claimsWithSLA.filter(c => c.sla_status === 'on_track' || c.sla_status === 'due_soon').length;
      const overdue = claimsWithSLA.filter(c => c.sla_status === 'overdue').length;
      const totalPausedMinutes = claims.reduce((sum, c) => sum + (c.sla_total_paused_minutes || 0), 0);

      const slaPerformance: SLAPerformance = {
        onTimePercent: claimsWithSLA.length > 0 ? (onTime / claimsWithSLA.length) * 100 : 100,
        overduePercent: claimsWithSLA.length > 0 ? (overdue / claimsWithSLA.length) * 100 : 0,
        avgTimeToDecisionHours: 0, // Would need more complex calculation
        avgTimePerStageHours: {},
        totalPausedMinutes,
      };

      // Calculate AI Performance from feedback
      const feedback = feedbackData || [];
      const totalFeedback = feedback.length;
      const acceptedCount = feedback.filter(f => f.decision_source === 'human_accept' || f.decision_source === 'system_auto').length;
      const overrideCount = feedback.filter(f => f.decision_source === 'human_override').length;
      const deltas = feedback.filter(f => f.delta_amount != null).map(f => Math.abs(f.delta_amount || 0));
      const avgDelta = deltas.length > 0 ? deltas.reduce((sum, d) => sum + d, 0) / deltas.length : 0;

      // Count override reasons
      const reasonCounts = new Map<string, number>();
      feedback
        .filter(f => f.override_reason_code)
        .forEach(f => {
          const count = reasonCounts.get(f.override_reason_code!) || 0;
          reasonCounts.set(f.override_reason_code!, count + 1);
        });

      const topOverrideReasons = Array.from(reasonCounts.entries())
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      const aiPerformance: AIPerformance = {
        acceptanceRate: totalFeedback > 0 ? (acceptedCount / totalFeedback) * 100 : 0,
        overrideRate: totalFeedback > 0 ? (overrideCount / totalFeedback) * 100 : 0,
        averageDelta: avgDelta,
        topOverrideReasons,
        breakdownByType: [], // Would need claim_type joined
      };

      // Calculate operational queues
      const queues = queueCounts || [];
      const operationalQueues: OperationalQueues = {
        needingReview: queues.filter(q => q.status === 'initiated' || q.status === 'under_review').length,
        overdue: queues.filter(q => q.sla_status === 'overdue').length,
        paused: queues.filter(q => q.sla_status === 'paused').length,
        shippingDamagePending: queues.filter(q => q.claim_category === 'shipping_damage').length,
      };

      setData({
        kpis,
        trends,
        slaPerformance,
        aiPerformance,
        queues: operationalQueues,
      });
    } catch (error) {
      console.error('Error fetching claim insights:', error);
    } finally {
      setLoading(false);
    }
  }, [profile?.tenant_id, dateRangeDays]);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  return {
    loading,
    ...data,
    refetch: fetchInsights,
  };
}
