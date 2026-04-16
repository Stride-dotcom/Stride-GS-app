import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { SettlementTermSheet, ClaimItemSummary } from '@/components/claims/SettlementTermSheet';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import { useToast } from '@/hooks/use-toast';

interface ClaimData {
  id: string;
  tenant_id: string;
  claim_number: string;
  claim_type: string;
  status: string;
  description: string;
  account_id: string;
  account_name: string;
  total_approved_amount: number | null;
  settlement_terms_text: string | null;
  settlement_terms_version: string | null;
  payout_method: string | null;
  settlement_accepted_at: string | null;
  settlement_declined_at: string | null;
  acceptance_token_expires_at: string | null;
  sent_for_acceptance_at: string | null;
  item_count: number;
}

interface ClaimItemData {
  id: string;
  item_code: string | null;
  description: string | null;
  coverage_type: string | null;
  declared_value: number | null;
  weight_lbs: number | null;
  approved_amount: number | null;
  repairable: boolean | null;
  repair_cost: number | null;
  use_repair_cost: boolean;
}

export default function ClaimAcceptance() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [claim, setClaim] = useState<ClaimData | null>(null);
  const [items, setItems] = useState<ClaimItemData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const [actionComplete, setActionComplete] = useState<'accepted' | 'declined' | null>(null);

  useEffect(() => {
    if (token) {
      fetchClaimData();
    } else {
      setError('Invalid acceptance link');
      setLoading(false);
    }
  }, [token]);

  const fetchClaimData = async () => {
    if (!token) return;

    try {
      setLoading(true);
      setError(null);

      // Fetch claim by token
      const { data: claimData, error: claimError } = await supabase
        .rpc('get_claim_by_acceptance_token', { p_token: token });

      if (claimError) throw claimError;

      if (!claimData || claimData.length === 0) {
        setError('This acceptance link is invalid or has expired.');
        return;
      }

      const claimRecord = claimData[0] as ClaimData;
      setClaim(claimRecord);

      // Log the view
      await supabase.from('claim_acceptance_log').insert({
        tenant_id: claimRecord.tenant_id,
        claim_id: claimRecord.id,
        action: 'viewed',
        ip_address: null, // Would need server-side to get real IP
        user_agent: navigator.userAgent,
      });

      // Fetch claim items
      const { data: itemsData, error: itemsError } = await supabase
        .rpc('get_claim_items_by_acceptance_token', { p_token: token });

      if (itemsError) throw itemsError;
      setItems((itemsData || []) as ClaimItemData[]);

    } catch (err) {
      console.error('Error fetching claim:', err);
      setError('Failed to load claim details. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async () => {
    if (!token) return;

    try {
      setIsAccepting(true);

      const { data, error } = await supabase
        .rpc('accept_claim_settlement', {
          p_token: token,
          p_ip_address: null,
          p_user_agent: navigator.userAgent,
        });

      if (error) throw error;

      const result = data as { success: boolean; error?: string; claim_number?: string };

      if (!result.success) {
        throw new Error(result.error || 'Failed to accept settlement');
      }

      setActionComplete('accepted');
      toast({
        title: 'Settlement Accepted',
        description: `Claim ${result.claim_number} has been accepted. Thank you!`,
      });

    } catch (err) {
      console.error('Error accepting settlement:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to accept settlement',
      });
    } finally {
      setIsAccepting(false);
    }
  };

  const handleDecline = async (reason: string, counterOffer?: number, notes?: string) => {
    if (!token) return;

    try {
      setIsDeclining(true);

      const { data, error } = await supabase
        .rpc('decline_claim_settlement', {
          p_token: token,
          p_reason: reason,
          p_counter_offer_amount: counterOffer || null,
          p_counter_offer_notes: notes || null,
          p_ip_address: null,
          p_user_agent: navigator.userAgent,
        });

      if (error) throw error;

      const result = data as { success: boolean; error?: string; claim_number?: string; action?: string };

      if (!result.success) {
        throw new Error(result.error || 'Failed to submit response');
      }

      setActionComplete('declined');

      const isCounter = result.action === 'counter_offered';
      toast({
        title: isCounter ? 'Counter Offer Submitted' : 'Settlement Declined',
        description: isCounter
          ? 'Your counter offer has been submitted. The warehouse will review and respond.'
          : 'Your response has been recorded. The warehouse will be in touch.',
      });

    } catch (err) {
      console.error('Error declining settlement:', err);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: err instanceof Error ? err.message : 'Failed to submit response',
      });
    } finally {
      setIsDeclining(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4 sm:p-8">
        <div className="max-w-3xl mx-auto space-y-6">
          <Skeleton className="h-12 w-64 mx-auto" />
          <Skeleton className="h-64" />
          <Skeleton className="h-48" />
          <Skeleton className="h-96" />
        </div>
      </div>
    );
  }

  // Error state
  if (error || !claim) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <MaterialIcon name="error" size="xl" className="text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-2">Unable to Load Claim</h2>
            <p className="text-muted-foreground mb-6">
              {error || 'The claim could not be found. Please check your link and try again.'}
            </p>
            <p className="text-sm text-muted-foreground">
              If you believe this is an error, please contact the warehouse directly.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Action complete state
  if (actionComplete) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            {actionComplete === 'accepted' ? (
              <>
                <MaterialIcon name="check_circle" size="xl" className="text-green-500 mx-auto mb-4" />
                <h2 className="text-xl font-semibold mb-2">Settlement Accepted</h2>
                <p className="text-muted-foreground mb-6">
                  Thank you for accepting the settlement for Claim #{claim.claim_number}.
                  The warehouse has been notified and will process your payout shortly.
                </p>
              </>
            ) : (
              <>
                <MaterialIcon name="cancel" size="xl" className="text-amber-500 mx-auto mb-4" />
                <h2 className="text-xl font-semibold mb-2">Response Submitted</h2>
                <p className="text-muted-foreground mb-6">
                  Your response for Claim #{claim.claim_number} has been recorded.
                  The warehouse will review and follow up with you.
                </p>
              </>
            )}
            <p className="text-sm text-muted-foreground">
              You may close this window.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Check if already acted upon
  const alreadyAccepted = !!claim.settlement_accepted_at;
  const alreadyDeclined = !!claim.settlement_declined_at;

  // Calculate payout info
  const totalApproved = items.reduce((sum, item) => sum + (item.approved_amount || 0), 0);
  const hasDeductible = items.some(item => item.coverage_type === 'full_replacement_deductible');
  const deductibleApplied = hasDeductible ? 300 : 0;
  const netPayout = Math.max(0, totalApproved - deductibleApplied);

  // Transform items for the term sheet
  const termSheetItems: ClaimItemSummary[] = items.map(item => ({
    id: item.id,
    item_code: item.item_code || undefined,
    description: item.description || undefined,
    coverage_type: item.coverage_type,
    declared_value: item.declared_value,
    weight_lbs: item.weight_lbs,
    approved_amount: item.approved_amount,
    repairable: item.repairable,
    repair_cost: item.repair_cost,
    use_repair_cost: item.use_repair_cost,
  }));

  return (
    <div className="min-h-screen bg-background">
      {/* Simple header */}
      <header className="border-b bg-card">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <h1 className="text-lg font-semibold">Claim Settlement Review</h1>
        </div>
      </header>

      {/* Main content */}
      <main className="p-4 sm:p-8">
        <SettlementTermSheet
          claimNumber={claim.claim_number}
          claimType={claim.claim_type}
          description={claim.description || 'No description provided'}
          accountName={claim.account_name || 'Unknown Account'}
          items={termSheetItems}
          totalApprovedAmount={totalApproved}
          deductibleApplied={deductibleApplied}
          netPayoutAmount={claim.total_approved_amount || netPayout}
          payoutMethod={(claim.payout_method as 'credit' | 'check' | 'ach') || 'credit'}
          sentDate={claim.sent_for_acceptance_at ? new Date(claim.sent_for_acceptance_at) : undefined}
          onAccept={handleAccept}
          onDecline={handleDecline}
          isAccepting={isAccepting}
          isDeclining={isDeclining}
          alreadyAccepted={alreadyAccepted}
          alreadyDeclined={alreadyDeclined}
        />
      </main>
    </div>
  );
}
