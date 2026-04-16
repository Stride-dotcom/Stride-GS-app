import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Card } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { queueClaimSentForAcceptanceAlert } from '@/lib/alertQueue';
import { MaterialIcon } from '@/components/ui/MaterialIcon';
import type { Claim, ClaimItem } from '@/hooks/useClaims';

interface SendForAcceptanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claim: Claim;
  claimItems: ClaimItem[];
  onSuccess?: () => void;
}

const DEFAULT_TERMS_TEMPLATE = `By accepting this settlement, you acknowledge and agree that:

1. The payment represents the complete and final settlement of this claim.
2. You release the warehouse, its employees, agents, and affiliates from any and all claims, demands, damages, actions, or causes of action arising from or related to the items and/or property described in this claim.
3. The warehouse shall have no further liability, obligation, or responsibility regarding the items or property covered by this claim.
4. You waive any right to pursue additional compensation or make future claims related to the items, property, or incidents described herein.
5. You confirm that you have read and understand these terms, and are accepting this settlement voluntarily.`;

export function SendForAcceptanceDialog({
  open,
  onOpenChange,
  claim,
  claimItems,
  onSuccess,
}: SendForAcceptanceDialogProps) {
  const { profile } = useAuth();
  const { toast } = useToast();

  const [payoutMethod, setPayoutMethod] = useState<'credit' | 'check' | 'ach'>('credit');
  const [settlementTerms, setSettlementTerms] = useState(DEFAULT_TERMS_TEMPLATE);
  const [isSending, setIsSending] = useState(false);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [approvalThreshold, setApprovalThreshold] = useState(1000);
  const [linkCopied, setLinkCopied] = useState(false);
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);

  // Calculate totals from claim items
  const calculateTotals = () => {
    let totalApproved = 0;
    let hasDeductible = false;

    for (const item of claimItems) {
      totalApproved += item.approved_amount || 0;
      if (item.coverage_type === 'full_replacement_deductible') {
        hasDeductible = true;
      }
    }

    const deductible = hasDeductible ? 300 : 0;
    const netPayout = Math.max(0, totalApproved - deductible);

    return { totalApproved, deductible, netPayout };
  };

  const { totalApproved, deductible, netPayout } = calculateTotals();

  // Load organization settings
  useEffect(() => {
    if (open && profile?.tenant_id) {
      loadOrgSettings();
    }
  }, [open, profile?.tenant_id]);

  const loadOrgSettings = async () => {
    if (!profile?.tenant_id) return;

    try {
      const { data } = await supabase
        .from('organization_claim_settings' as any)
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .single();

      if (data) {
        const settings = data as any;
        if (settings.settlement_terms_template) {
          setSettlementTerms(settings.settlement_terms_template);
        }
        if (settings.default_payout_method) {
          setPayoutMethod(settings.default_payout_method as 'credit' | 'check' | 'ach');
        }
        if (settings.approval_threshold_amount) {
          setApprovalThreshold(settings.approval_threshold_amount);
          setApprovalRequired(
            settings.approval_required_above_threshold && netPayout > settings.approval_threshold_amount
          );
        }
      }
    } catch (error) {
      console.error('Error loading org settings:', error);
    }
  };

  const handleSend = async () => {
    if (!profile?.id || !profile?.tenant_id) return;

    try {
      setIsSending(true);

      // Call the send_claim_for_acceptance function
      const { data, error } = await (supabase as any).rpc('send_claim_for_acceptance', {
        p_claim_id: claim.id,
        p_settlement_terms: settlementTerms,
        p_payout_method: payoutMethod,
        p_sent_by: profile.id,
      });

      if (error) throw error;

      const result = data as { success: boolean; error?: string; acceptance_token?: string; expires_at?: string };

      if (!result.success) {
        throw new Error(result.error || 'Failed to send for acceptance');
      }

      // Generate the acceptance link
      const baseUrl = window.location.origin;
      const acceptanceLink = `${baseUrl}/claim/accept/${result.acceptance_token}`;
      setGeneratedLink(acceptanceLink);

      // Update the claim's total_approved_amount
      await supabase
        .from('claims' as any)
        .update({ approved_amount: netPayout })
        .eq('id', claim.id);

      // Get account contact email for the alert
      let recipientEmail: string | undefined;
      if (claim.account_id) {
        const { data: account } = await supabase
          .from('accounts' as any)
          .select('primary_contact_email')
          .eq('id', claim.account_id)
          .single();
        recipientEmail = (account as any)?.primary_contact_email || undefined;
      }

      // Queue the alert email
      await queueClaimSentForAcceptanceAlert(
        profile.tenant_id,
        claim.id,
        claim.claim_number,
        netPayout,
        acceptanceLink,
        recipientEmail
      );

      toast({
        title: 'Sent for Acceptance',
        description: 'The client has been notified and can now review the settlement.',
      });

      onSuccess?.();
    } catch (error) {
      console.error('Error sending for acceptance:', error);
      toast({
        variant: 'destructive',
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to send for acceptance',
      });
    } finally {
      setIsSending(false);
    }
  };

  const copyLink = () => {
    if (generatedLink) {
      navigator.clipboard.writeText(generatedLink);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
    }
  };

  // Check if all items have approved amounts
  const allItemsApproved = claimItems.length > 0 && claimItems.every(item => item.approved_amount != null);
  const canSend = allItemsApproved && netPayout > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MaterialIcon name="send" size="md" />
            Send Claim for Acceptance
          </DialogTitle>
          <DialogDescription>
            Send claim {claim.claim_number} to the client for review and acceptance.
          </DialogDescription>
        </DialogHeader>

        {generatedLink ? (
          // Success state with link
          <div className="space-y-4 py-4">
            <div className="flex items-center justify-center gap-2 p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
              <MaterialIcon name="check_circle" size="lg" className="text-green-600" />
              <span className="text-green-700 dark:text-green-400 font-medium">
                Claim sent for acceptance!
              </span>
            </div>

            <Card className="p-4">
              <Label className="text-sm font-medium">Acceptance Link</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Share this link with the client or it will be included in the notification email.
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={generatedLink}
                  autoCapitalize="none"
                  className="flex-1 text-sm p-2 bg-muted rounded border"
                />
                <Button variant="outline" size="sm" onClick={copyLink}>
                  {linkCopied ? <MaterialIcon name="check_circle" size="sm" /> : <MaterialIcon name="content_copy" size="sm" />}
                </Button>
              </div>
            </Card>

            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <>
            <div className="space-y-6 py-4">
              {/* Approval Warning */}
              {approvalRequired && (
                <Alert variant="destructive">
                  <MaterialIcon name="warning" size="sm" />
                  <AlertDescription>
                    This claim exceeds the approval threshold (${approvalThreshold.toFixed(2)}) and requires admin approval before sending.
                  </AlertDescription>
                </Alert>
              )}

              {/* Payout Summary */}
              <Card className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <MaterialIcon name="attach_money" size="md" className="text-muted-foreground" />
                  <h4 className="font-medium">Payout Summary</h4>
                </div>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Items ({claimItems.length})</span>
                    <span>${totalApproved.toFixed(2)}</span>
                  </div>
                  {deductible > 0 && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Deductible</span>
                      <span className="text-red-600">-${deductible.toFixed(2)}</span>
                    </div>
                  )}
                  <Separator />
                  <div className="flex justify-between font-semibold">
                    <span>Net Payout</span>
                    <span className="text-primary">${netPayout.toFixed(2)}</span>
                  </div>
                </div>
              </Card>

              {/* Validation Warning */}
              {!canSend && (
                <Alert>
                  <MaterialIcon name="warning" size="sm" />
                  <AlertDescription>
                    {claimItems.length === 0
                      ? 'No items in this claim. Add items before sending.'
                      : !allItemsApproved
                      ? 'All items must have approved amounts before sending.'
                      : 'Cannot send a claim with $0 payout.'}
                  </AlertDescription>
                </Alert>
              )}

              {/* Payout Method */}
              <div className="space-y-3">
                <Label>Payout Method</Label>
                <RadioGroup
                  value={payoutMethod}
                  onValueChange={(v) => setPayoutMethod(v as 'credit' | 'check' | 'ach')}
                  className="flex flex-col space-y-2"
                >
                  <div className="flex items-center space-x-3">
                    <RadioGroupItem value="credit" id="credit" />
                    <Label htmlFor="credit" className="font-normal cursor-pointer">
                      Account Credit
                      <span className="text-muted-foreground text-xs ml-2">(default)</span>
                    </Label>
                  </div>
                  <div className="flex items-center space-x-3">
                    <RadioGroupItem value="check" id="check" />
                    <Label htmlFor="check" className="font-normal cursor-pointer">
                      Check
                    </Label>
                  </div>
                  <div className="flex items-center space-x-3">
                    <RadioGroupItem value="ach" id="ach" />
                    <Label htmlFor="ach" className="font-normal cursor-pointer">
                      ACH / Bank Transfer
                    </Label>
                  </div>
                </RadioGroup>
              </div>

              {/* Settlement Terms */}
              <div className="space-y-2">
                <Label htmlFor="terms">Settlement Terms</Label>
                <p className="text-xs text-muted-foreground">
                  These terms will be shown to the client as part of the acceptance process.
                </p>
                <Textarea
                  id="terms"
                  value={settlementTerms}
                  onChange={(e) => setSettlementTerms(e.target.value)}
                  rows={8}
                  className="text-sm"
                />
              </div>

              {/* Status Info */}
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Current Status</span>
                <Badge variant="outline">{claim.status}</Badge>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSend}
                disabled={isSending || !canSend || approvalRequired}
              >
                {isSending ? (
                  <>
                    <span className="animate-spin mr-2">⏳</span>
                    Sending...
                  </>
                ) : (
                  <>
                    <MaterialIcon name="send" size="sm" className="mr-2" />
                    Send for Acceptance
                  </>
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
