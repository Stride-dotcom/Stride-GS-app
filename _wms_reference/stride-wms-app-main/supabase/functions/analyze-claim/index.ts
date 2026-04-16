/**
 * Analyze Claim Edge Function
 * AI-powered claim analysis for liability claims
 * Generates standardized recommendations using system rules
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.38.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ClaimAnalysisInput {
  claim_id: string;
  claim_type: string;
  claim_category: string;
  coverage_source: string | null;
  coverage_type: string | null;
  declared_value: number | null;
  shipment_declared_value_total: number | null;
  prorated_cap: number | null;
  pop_required: boolean;
  pop_provided: boolean;
  pop_value: number | null;
  repairable: boolean | null;
  repair_estimate: number | null;
  replacement_estimate: number | null;
  deductible: number | null;
  photos_present: boolean;
  damage_description: string | null;
  item_count: number;
  account_claim_count: number;
  account_claim_total: number;
  auto_approval_threshold: number;
}

interface ClaimAnalysisResult {
  recommendation_amount: number | null;
  recommended_action: 'auto_approve' | 'approve' | 'request_info' | 'deny';
  confidence_level: 'low' | 'medium' | 'high';
  flags: string[];
  reasoning: string;
}

function analyzeClaimData(input: ClaimAnalysisInput): ClaimAnalysisResult {
  const flags: string[] = [];
  let confidence: 'low' | 'medium' | 'high' = 'medium';
  let reasoning = '';
  let recommendedAmount: number | null = null;
  let action: 'auto_approve' | 'approve' | 'request_info' | 'deny' = 'approve';

  // Skip analysis for non-liability claims
  if (input.claim_category !== 'liability') {
    return {
      recommendation_amount: null,
      recommended_action: 'approve',
      confidence_level: 'high',
      flags: ['non_liability_claim'],
      reasoning: 'This is a shipping damage claim (assistance only). No payout calculation required.',
    };
  }

  // Check for missing documentation
  if (!input.photos_present) {
    flags.push('missing_photos');
    confidence = 'low';
  }

  // Check POP requirements for shipment coverage
  if (input.coverage_source === 'shipment' && input.pop_required && !input.pop_provided) {
    flags.push('pop_required_not_provided');
    reasoning += 'POP required but not provided. Using prorated valuation. ';
  }

  // Calculate recommended amount based on coverage rules
  if (input.coverage_type === 'standard' || !input.coverage_type) {
    // Standard coverage: weight-based (handled elsewhere, no declared value)
    recommendedAmount = input.replacement_estimate || 0;
    reasoning += 'Standard coverage applies (weight-based valuation). ';
  } else if (input.coverage_source === 'shipment') {
    // Shipment-level coverage with proration
    if (input.pop_provided && input.pop_value != null) {
      // POP provided - use min of POP value and cap
      const cap = input.prorated_cap || input.declared_value || input.pop_value;
      recommendedAmount = Math.min(input.pop_value, cap);
      reasoning += `POP provided ($${input.pop_value.toLocaleString()}). Capped at prorated value. `;
    } else {
      // No POP - use prorated cap
      recommendedAmount = input.prorated_cap || 0;
      reasoning += `Using prorated cap ($${(input.prorated_cap || 0).toLocaleString()}) based on shipment total. `;
    }
  } else {
    // Item-level coverage
    recommendedAmount = input.declared_value || 0;
    reasoning += `Using item declared value ($${(input.declared_value || 0).toLocaleString()}). `;
  }

  // Apply repair vs replace logic
  if (input.repairable && input.repair_estimate != null && input.repair_estimate > 0) {
    if (input.repair_estimate < (recommendedAmount || 0)) {
      recommendedAmount = input.repair_estimate;
      flags.push('repair_recommended');
      reasoning += `Repair estimate ($${input.repair_estimate.toLocaleString()}) is lower than replacement. `;
    }
  }

  // Apply deductible for full_replacement_deductible coverage
  if (input.coverage_type === 'full_replacement_deductible' && input.deductible != null) {
    if (recommendedAmount != null) {
      recommendedAmount = Math.max(0, recommendedAmount - input.deductible);
      reasoning += `Deductible of $${input.deductible.toLocaleString()} applied. `;
    }
  }

  // Check account claim history for potential issues
  if (input.account_claim_count > 5) {
    flags.push('high_claim_frequency');
    if (input.account_claim_count > 10) {
      confidence = 'low';
      reasoning += 'Account has high claim frequency - review recommended. ';
    }
  }

  // Determine action based on amount and threshold
  if (recommendedAmount === null || recommendedAmount === 0) {
    action = 'deny';
    reasoning += 'No valid payout amount calculated. ';
  } else if (recommendedAmount <= input.auto_approval_threshold) {
    // Check if we have enough confidence for auto-approval
    if (confidence !== 'low' && flags.length <= 1 && input.photos_present) {
      action = 'auto_approve';
      reasoning += `Amount ($${recommendedAmount.toLocaleString()}) is under auto-approval threshold ($${input.auto_approval_threshold.toLocaleString()}). `;
    } else {
      action = 'approve';
      reasoning += `Amount qualifies for approval but requires manual review due to flags. `;
    }
  } else {
    action = 'approve';
    reasoning += `Amount ($${recommendedAmount.toLocaleString()}) exceeds auto-approval threshold - manual review required. `;
  }

  // Request more info if critical data is missing
  if (flags.includes('missing_photos') && flags.length > 1) {
    action = 'request_info';
    reasoning += 'Additional documentation needed before processing. ';
  }

  // Boost confidence for straightforward claims
  if (flags.length === 0 && input.photos_present && recommendedAmount != null && recommendedAmount > 0) {
    confidence = 'high';
  }

  return {
    recommendation_amount: recommendedAmount,
    recommended_action: action,
    confidence_level: confidence,
    flags,
    reasoning: reasoning.trim(),
  };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { claim_id, tenant_id } = await req.json();

    if (!claim_id || !tenant_id) {
      throw new Error('Missing required parameters: claim_id and tenant_id');
    }

    // Fetch claim data
    const { data: claim, error: claimError } = await supabase
      .from('claims')
      .select(`
        *,
        account:accounts(id, account_name),
        claim_items(*)
      `)
      .eq('id', claim_id)
      .single();

    if (claimError || !claim) {
      throw new Error('Claim not found');
    }

    // Fetch tenant settings
    const { data: settings } = await supabase
      .from('organization_claim_settings')
      .select('auto_approval_threshold, enable_ai_analysis')
      .eq('tenant_id', tenant_id)
      .single();

    if (!settings?.enable_ai_analysis) {
      return new Response(
        JSON.stringify({ error: 'AI analysis is disabled for this tenant' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Fetch account claim history
    const { count: accountClaimCount } = await supabase
      .from('claims')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', claim.account_id)
      .eq('tenant_id', tenant_id);

    const { data: accountClaimTotals } = await supabase
      .from('claims')
      .select('approved_payout_amount')
      .eq('account_id', claim.account_id)
      .eq('tenant_id', tenant_id)
      .not('approved_payout_amount', 'is', null);

    const accountClaimTotal = (accountClaimTotals || []).reduce(
      (sum: number, c: any) => sum + (c.approved_payout_amount || 0),
      0
    );

    // Check for photos
    const { count: photoCount } = await supabase
      .from('claim_attachments')
      .select('id', { count: 'exact', head: true })
      .eq('claim_id', claim_id)
      .ilike('file_name', '%.jpg')
      .or('file_name.ilike.%.jpeg,file_name.ilike.%.png,file_name.ilike.%.gif');

    // Get coverage and valuation data from claim items
    let coverageSource = null;
    let coverageType = null;
    let declaredValue = 0;
    let proratedCap = null;
    let popRequired = false;
    let popProvided = false;
    let popValue = null;
    let repairable = null;
    let repairEstimate = null;
    let deductible = null;

    const claimItems = claim.claim_items || [];
    for (const item of claimItems) {
      coverageSource = item.coverage_source || coverageSource;
      coverageType = item.coverage_type || coverageType;
      declaredValue += item.declared_value || 0;
      proratedCap = item.prorated_cap || proratedCap;
      popRequired = popRequired || item.pop_required;
      popProvided = popProvided || item.pop_provided;
      popValue = item.pop_value || popValue;
      repairable = item.repairable ?? repairable;
      repairEstimate = item.repair_cost || repairEstimate;
      deductible = item.coverage_deductible || deductible;
    }

    // Build analysis input
    const analysisInput: ClaimAnalysisInput = {
      claim_id,
      claim_type: claim.claim_type,
      claim_category: claim.claim_category || 'liability',
      coverage_source: coverageSource,
      coverage_type: coverageType,
      declared_value: declaredValue,
      shipment_declared_value_total: (claim.coverage_snapshot as any)?.shipment_total || null,
      prorated_cap: proratedCap,
      pop_required: popRequired,
      pop_provided: popProvided,
      pop_value: popValue,
      repairable,
      repair_estimate: repairEstimate,
      replacement_estimate: declaredValue,
      deductible,
      photos_present: (photoCount || 0) > 0,
      damage_description: claim.description,
      item_count: claimItems.length,
      account_claim_count: accountClaimCount || 0,
      account_claim_total: accountClaimTotal,
      auto_approval_threshold: settings.auto_approval_threshold || 1000,
    };

    // Run analysis
    const result = analyzeClaimData(analysisInput);

    // Store analysis result
    const { data: analysis, error: analysisError } = await supabase
      .from('claim_ai_analysis')
      .upsert({
        tenant_id,
        claim_id,
        recommendation_amount: result.recommendation_amount,
        recommended_action: result.recommended_action,
        confidence_level: result.confidence_level,
        flags: result.flags,
        reasoning: result.reasoning,
        input_snapshot: analysisInput,
        model_version: 'v1-rules-based',
      }, {
        onConflict: 'claim_id',
      })
      .select()
      .single();

    if (analysisError) {
      console.error('Error storing analysis:', analysisError);
      throw new Error('Failed to store analysis result');
    }

    // Auto-approve if recommended and below threshold
    if (result.recommended_action === 'auto_approve' && result.recommendation_amount != null) {
      await supabase
        .from('claims')
        .update({
          status: 'approved',
          auto_approved: true,
          approved_by_system: true,
          approved_payout_amount: result.recommendation_amount,
          approved_at: new Date().toISOString(),
        })
        .eq('id', claim_id);

      // Create audit entry for auto-approval
      await supabase.from('claim_audit').insert({
        tenant_id,
        claim_id,
        actor_id: null, // System action
        action: 'auto_approved',
        details: {
          recommendation_amount: result.recommendation_amount,
          confidence_level: result.confidence_level,
          reasoning: result.reasoning,
        },
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        analysis,
        auto_approved: result.recommended_action === 'auto_approve',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error analyzing claim:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
