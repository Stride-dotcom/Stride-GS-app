/**
 * useClaimAnalysis Hook
 * Manages AI-powered claim analysis for liability claims
 * Note: Analysis uses standardized rules - never expose "AI" wording to customers
 */

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import type { ClaimAIAnalysis, AIRecommendedAction, AIConfidenceLevel } from './useClaims';

export interface ClaimAnalysisResult {
  analysis: ClaimAIAnalysis | null;
  auto_approved: boolean;
}

export function useClaimAnalysis() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<ClaimAIAnalysis | null>(null);

  /**
   * Fetch existing analysis for a claim
   */
  const fetchAnalysis = useCallback(async (claimId: string): Promise<ClaimAIAnalysis | null> => {
    if (!profile?.tenant_id) return null;

    try {
      const { data, error } = await (supabase as any)
        .from('claim_ai_analysis')
        .select('*')
        .eq('claim_id', claimId)
        .eq('tenant_id', profile.tenant_id)
        .maybeSingle();

      if (error) throw error;
      setAnalysis(data as ClaimAIAnalysis | null);
      return data as ClaimAIAnalysis | null;
    } catch (error) {
      console.error('Error fetching claim analysis:', error);
      return null;
    }
  }, [profile?.tenant_id]);

  /**
   * Run analysis on a liability claim
   * This calls the edge function to analyze the claim using standardized rules
   */
  const analyzeClaim = useCallback(async (claimId: string): Promise<ClaimAnalysisResult | null> => {
    if (!profile?.tenant_id) {
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Not authenticated',
      });
      return null;
    }

    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke('analyze-claim', {
        body: {
          claim_id: claimId,
          tenant_id: profile.tenant_id,
        },
      });

      if (error) throw error;

      if (data?.analysis) {
        setAnalysis(data.analysis as ClaimAIAnalysis);
      }

      if (data?.auto_approved) {
        toast({
          title: 'Claim Auto-Approved',
          description: 'Claim meets criteria for automatic approval based on standardized rules.',
        });
      } else {
        toast({
          title: 'Analysis Complete',
          description: 'Claim has been analyzed. Review the recommendation.',
        });
      }

      return {
        analysis: data?.analysis || null,
        auto_approved: data?.auto_approved || false,
      };
    } catch (error) {
      console.error('Error analyzing claim:', error);
      toast({
        variant: 'destructive',
        title: 'Analysis Failed',
        description: 'Could not analyze claim. Please try again.',
      });
      return null;
    } finally {
      setAnalyzing(false);
    }
  }, [profile?.tenant_id, toast]);

  /**
   * Apply the analysis recommendation
   * Used when manually approving based on system recommendation
   */
  const applyRecommendation = useCallback(async (
    claimId: string,
    analysisId: string,
    approvedAmount: number
  ): Promise<boolean> => {
    if (!profile?.tenant_id || !profile?.id) return false;

    try {
      // Update claim with approved amount
      const { error: claimError } = await supabase
        .from('claims')
        .update({
          status: 'approved',
          approved_payout_amount: approvedAmount,
          approved_at: new Date().toISOString(),
          approved_by: profile.id,
        })
        .eq('id', claimId);

      if (claimError) throw claimError;

      // Create audit entry
      await supabase.from('claim_audit').insert({
        tenant_id: profile.tenant_id,
        claim_id: claimId,
        actor_id: profile.id,
        action: 'approved_with_recommendation',
        details: {
          analysis_id: analysisId,
          approved_amount: approvedAmount,
        },
      });

      toast({
        title: 'Claim Approved',
        description: `Claim approved for $${approvedAmount.toFixed(2)}`,
      });

      return true;
    } catch (error) {
      console.error('Error applying recommendation:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: 'Failed to apply recommendation',
      });
      return false;
    }
  }, [profile?.tenant_id, profile?.id, toast]);

  /**
   * Get human-readable action label
   * Note: Uses "system" wording, never "AI"
   */
  const getActionLabel = (action: AIRecommendedAction): string => {
    switch (action) {
      case 'auto_approve':
        return 'Auto-Approve (System)';
      case 'approve':
        return 'Approve';
      case 'request_info':
        return 'Request Information';
      case 'deny':
        return 'Deny';
      default:
        return action;
    }
  };

  /**
   * Get confidence badge color
   */
  const getConfidenceColor = (level: AIConfidenceLevel): string => {
    switch (level) {
      case 'high':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'low':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  /**
   * Get action badge color
   */
  const getActionColor = (action: AIRecommendedAction): string => {
    switch (action) {
      case 'auto_approve':
        return 'bg-green-600';
      case 'approve':
        return 'bg-blue-600';
      case 'request_info':
        return 'bg-yellow-600';
      case 'deny':
        return 'bg-red-600';
      default:
        return 'bg-gray-600';
    }
  };

  return {
    analyzing,
    analysis,
    fetchAnalysis,
    analyzeClaim,
    applyRecommendation,
    getActionLabel,
    getConfidenceColor,
    getActionColor,
  };
}
